import { type Request, type Response } from 'express';
import OpenAI from 'openai';

import {
  createConversation,
  getRecentMessagesForContext,
  insertMessage,
  isOwnConversation,
  type MessageRow,
} from '../services/conversation.service';

/**
 * 懒加载 OpenAI 客户端：未配置 API Key 时不在模块加载阶段崩溃，
 * 而是在请求时返回明确的错误提示
 */
function createOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('未配置 OPENAI_API_KEY，请在 server/.env.development 中填写');
  }
  return new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL,
  });
}

/**
 * 把库里的消息转成模型入参。role 列是 VARCHAR，类型上虽然收窄成 Role，运行时仍可能是别的值；
 * 认不出来就返回 null 让调用方跳过
 */
function toChatMessage(
  item: Pick<MessageRow, 'role' | 'content'>
): OpenAI.Chat.Completions.ChatCompletionMessageParam | null {
  switch (item.role) {
    case 'user':
      return { role: 'user', content: item.content };
    case 'assistant':
      return { role: 'assistant', content: item.content };
    case 'system':
      return { role: 'system', content: item.content };
    default:
      return null;
  }
}

/**
 * 请求体：{ conversationId?: string, content: string }
 * 首轮不带 conversationId，由服务端新建会话并通过 SSE 的 conversation 事件回传会话ID，
 * 后续轮次带上它即可续聊（上下文由服务端从数据库读取拼接，前端不需要维护 messages）
 */
async function sseHandler(req: Request, res: Response) {
  const { conversationId: rawConversationId, content } = req.body ?? {};
  const userId = req.user?.userId;

  if (!userId) {
    return res.status(401).json({ message: '未携带认证令牌' });
  }
  if (typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ message: 'content 不能为空' });
  }

  // 1、确定会话：带了 conversationId 就校验归属，否则新建
  let conversationId: string;
  if (rawConversationId) {
    if (typeof rawConversationId !== 'string' || !(await isOwnConversation(rawConversationId, userId))) {
      return res.status(404).json({ message: '会话不存在' });
    }
    conversationId = rawConversationId;
  } else {
    conversationId = await createConversation(userId, content);
  }

  /**
   * 2、先落库用户消息：上游模型调用失败也不会丢掉用户输入
   * 先将用户输入的消息存储到message表中
   */
  await insertMessage({ conversationId, userId, role: 'user', content });

  // 3、拼上下文。刚写入的这条用户消息也在其中，所以这里取完直接就是完整对话
  const history = await getRecentMessagesForContext(conversationId, userId);
  // 逐角色构造：既满足 SDK 的可辨识联合类型，也能兜住库里出现的意外 role。
  // 认不出来的 role 直接跳过并告警，不猜成 user——猜错会把脏数据伪装成用户发言送进模型，
  // 污染上下文的同时还掩盖了数据问题
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  for (const item of history) {
    const message = toChatMessage(item);
    if (message) {
      messages.push(message);
    } else {
      console.warn(`跳过 role 非法的消息: messageId=${item.messageId} role=${item.role}`);
    }
  }

  const abortControl = new AbortController();
  // 客户端断开时中止上游大模型请求，避免资源泄漏。
  // 注意：不能用 req.on('close')——Node 16+ 起 IncomingMessage 的 'close' 语义是
  // 「请求消息接收完毕」，express.json() 消费完 body 后就会立刻触发，正常请求也会被误判为断开，
  // 导致上游请求被 abort（报错 "Request was aborted."）。只能监听 res，并用 writableEnded 区分
  // 「正常结束」（true）和「客户端真的断开」（false）。
  res.on('close', () => {
    if (!res.writableEnded) abortControl.abort();
  });

  // 先建立上游连接：认证失败、未配置 key 等错误以普通 JSON 返回，
  // 避免已 flush 的 SSE 头无法回传 HTTP 错误码
  let stream: Awaited<ReturnType<ReturnType<typeof createOpenAIClient>['chat']['completions']['create']>>;
  try {
    const openai = createOpenAIClient();
    stream = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? 'deepseek-chat',
      messages,
      stream: true,
    }, { signal: abortControl.signal });
  } catch (err: any) {
    return res.status(err.status ?? 500).json({ message: err.message ?? '上游模型请求失败' });
  }

  // sse 请求头设置
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // 4、首帧回传会话ID，前端据此绑定会话，后续发送带上它即可续聊
  res.write(`event: conversation\ndata: ${JSON.stringify({ conversationId })}\n\n`);

  // 累加助手回复，流结束后统一落库
  let assistantContent = '';
  let persisted = false;

  // 落库助手回复。客户端中途断开时也把已生成的部分内容存下来——用户已经看到了，
  // 丢掉更难解释。失败只记日志，不影响已经发出的响应。用 persisted 保证只落一次。
  /**
   * AI助手回复消息保存入库，回复内容存储在assisstantContent变量中
   * @returns 
   */
  const persistAssistant = async () => {
    if (persisted || !assistantContent) return;
    persisted = true;
    try {
      // AI助手回复消息保存入库，回复内容存储在assisstantContent变量中
      await insertMessage({ conversationId, userId, role: 'assistant', content: assistantContent });
    } catch (err) {
      console.error('助手回复落库失败:', err);
    }
  };

  try {
    // 发送消息
    for await (const event of stream) {
      if (res.destroyed) break;
      const delta = event.choices?.[0]?.delta?.content;
      if (delta) assistantContent += delta;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    // 先落库再宣告结束：客户端收到 [DONE] 时数据已经持久化，
    // 否则「刚聊完立刻刷新页面」可能查不到最后这条回复
    await persistAssistant();
    res.write('data: [DONE]\n\n');
  } catch (err: any) {
    // 流中途出错：以标准 SSE error 事件通知客户端
    if (!res.destroyed) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message ?? 'stream error' })}\n\n`);
    }
  } finally {
    if (!res.destroyed) res.end();
    // 兜底：客户端中途断开时上面的落库不会执行到，这里补上（已落库则是空操作）
    await persistAssistant();
  }
}

export {
  sseHandler,
}
