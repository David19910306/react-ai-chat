import { type Request, type Response } from 'express';
import fs from 'node:fs/promises';
import OpenAI from 'openai';

import {
  createConversation,
  getRecentMessagesForContext,
  insertMessage,
  isOwnConversation,
  type MessageRow,
} from '../services/conversation.service';
import {
  bindFilesToMessage,
  getAttachmentsByMessageIds,
  getFilesForOwner,
  getOrExtractFileText,
  type FileRow,
  type MessageAttachment,
} from '../services/file.service';
import { extractText } from '../services/fileParse.service';
import {
  IMAGE_CONTENT_TYPE,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_CHARS_PER_REQUEST,
} from '../config';

// SSE 心跳间隔。模型产出首个 token 前可能长时间无字节，中间的反向代理（nginx / ALB）
// 会按 idle 超时掐断连接，定期发一个注释帧把连接保活。
const HEARTBEAT_INTERVAL = 15_000;

// 用户只挂了附件、没打字时，替它生成一句默认提问。
// 服务端替用户"说话"听起来别扭，但比两种替代方案都好：
// 存空 content 会让会话标题为空、气泡空白；前端硬编码一句话则把这个规则复制到了两个地方
const DEFAULT_ATTACHMENT_PROMPT = '请阅读并分析我上传的附件内容。';

/**
 * OpenAI 客户端单例：SDK 内部持有连接池，每次请求 new 一个会导致每次都重新建连 + TLS 握手。
 * 仍然懒加载——首屏未配置 key 时不在模块加载阶段崩溃，而是在请求时给出明确错误。
 */
let openAIClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (openAIClient) return openAIClient;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('未配置 OPENAI_API_KEY，请在 server/.env.development 中填写');
  }
  openAIClient = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL,
  });
  return openAIClient;
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
 * 从共享预算里取一段文本。超预算就截断并说明——
 * 静默丢弃会让模型以为文件是空的，进而编内容
 */
function consumeBudget(budget: { remaining: number }, text: string): string {
  if (budget.remaining <= 0) return '（附件内容过多，本次已省略）';
  if (text.length <= budget.remaining) {
    budget.remaining -= text.length;
    return text;
  }
  const kept = text.slice(0, budget.remaining);
  budget.remaining = 0;
  return `${kept}\n\n（附件内容过多，本次仅发送了前一部分）`;
}

/** 读磁盘图片转成 base64 data URL。DeepSeek 这边实测接受 data URL 形式，不必先传到对象存储 */
async function toImageDataUrl(file: FileRow): Promise<string> {
  const buffer = await fs.readFile(file.storagePath);
  const mime = IMAGE_CONTENT_TYPE[file.suffix] ?? 'application/octet-stream';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

/**
 * 拼当前这一轮的附件内容，输出多模态数组。
 *
 * 图片走 image_url 直传（模型能真正看图）；文档走文本提取。
 * 每个附件单独 try：一个文件读失败不该让整条消息发不出去
 */
async function buildCurrentUserContent(
  text: string,
  files: FileRow[],
  budget: { remaining: number }
): Promise<OpenAI.Chat.Completions.ChatCompletionContentPart[]> {
  const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [{ type: 'text', text }];

  for (const file of files) {
    if (IMAGE_CONTENT_TYPE[file.suffix]) {
      try {
        parts.push({ type: 'image_url', image_url: { url: await toImageDataUrl(file) } });
      } catch (error) {
        console.error(`读取图片失败: ${file.fileName}`, error);
        parts.push({ type: 'text', text: `【附件：${file.fileName}】读取失败，未能发送。` });
      }
      continue;
    }

    // 走缓存：文档文本解析一次就够，后续轮次直接读 file_text
    const extracted = await getOrExtractFileText(file, extractText);
    parts.push({
      type: 'text',
      text: `【附件：${file.fileName}】\n${consumeBudget(budget, extracted)}`,
    });
  }

  return parts;
}

/**
 * 把历史消息的附件正文追加到它原本的文本后面。
 *
 * 图片在这里只留一句说明而不重发：历史里的每张图都要重新读盘、重新 base64，
 * 一轮对话挂着二十条历史就会拼出几十兆的请求体。如实告诉模型"图片没带过来"，
 * 比让它对着不存在的信息硬答要好——后者就是幻觉的来源
 */
function withAttachmentContext(
  base: string,
  attachments: MessageAttachment[],
  budget: { remaining: number }
): string {
  const blocks = attachments.map((attachment) => {
    if (attachment.extractedText === null) {
      const kind = IMAGE_CONTENT_TYPE[attachment.suffix] ? '图片内容' : '内容';
      return `【附件：${attachment.fileName}】（${kind}未包含在本次上下文中，如需查看请重新发送该附件）`;
    }
    return `【附件：${attachment.fileName}】\n${consumeBudget(budget, attachment.extractedText)}`;
  });

  // 用户只挂附件没打字时存的是空串，这时不能再拼一个前导换行
  return base ? `${base}\n\n${blocks.join('\n\n')}` : blocks.join('\n\n');
}

/**
 * 请求体：{ conversationId?: string, content: string, fileIds?: string[] }
 * 首轮不带 conversationId，由服务端新建会话并通过 SSE 的 conversation 事件回传会话ID，
 * 后续轮次带上它即可续聊（上下文由服务端从数据库读取拼接，前端不需要维护 messages）
 */
async function sseHandler(req: Request, res: Response) {
  const { conversationId: rawConversationId, content, fileIds: rawFileIds } = req.body ?? {};
  const userId = req.user?.userId;

  if (!userId) {
    return res.status(401).json({ message: '未携带认证令牌' });
  }

  // 过掉非字符串项：客户端传个 null / 对象进来不该把后面 where in (?) 的参数搞坏。
  // 再用 Set 去重：去重不是可选的，下面的归属校验是靠「查回来的条数」判断的，
  // 同一个 fileId 传两遍时查回来只有一行，条数对不上会被误判成越权而返回 404。
  // 秒传让这条路径变得很容易走到——同一份文件在待发送区里被选中两次就会重复
  const fileIds: string[] = Array.from(new Set(
    Array.isArray(rawFileIds)
      ? rawFileIds.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
      : []
  ));
  // 先去掉重复再判数量：10 个重复的同一个文件其实只算 1 个附件
  if (fileIds.length > MAX_ATTACHMENTS) {
    // 不静默截断：截掉的那几个用户以为发出去了，实际模型看不到，不如直接报错
    return res.status(400).json({ message: `一次最多携带 ${MAX_ATTACHMENTS} 个附件` });
  }

  const text = typeof content === 'string' ? content.trim() : '';
  // 只挂附件不打字是允许的，两者都没有才是空请求
  if (!text && fileIds.length === 0) {
    return res.status(400).json({ message: 'content 不能为空' });
  }

  /**
   * 附件归属校验放在建会话之前：越权或文件不存在时直接拒绝，
   * 否则会先建出一个空会话再报错，侧边栏里多一条永远没有消息的记录
   *
   * 用「查回来的条数」而不是逐条校验来判断：数量对不上就说明有 ID 不存在或不属于当前用户，
   * 两种情况合并成同一个响应，不泄漏"这个 ID 确实存在但不是你的"
   */
  let files: FileRow[] = [];
  if (fileIds.length > 0) {
    files = await getFilesForOwner(fileIds, userId);
    if (files.length !== fileIds.length) {
      return res.status(404).json({ message: '附件不存在或无权访问' });
    }
  }

  // 服务端补一句默认提问，见 DEFAULT_ATTACHMENT_PROMPT 处的说明
  const modelText = text || DEFAULT_ATTACHMENT_PROMPT;
  // 会话标题单独取素材：文件名叫"图片.png"也比默认提问更有信息量
  const titleSource = text || files.map((file) => file.fileName).join('、');

  // 1、确定会话：带了 conversationId 就校验归属，否则新建
  let conversationId: string;
  if (rawConversationId) {
    if (typeof rawConversationId !== 'string' || !(await isOwnConversation(rawConversationId, userId))) {
      return res.status(404).json({ message: '会话不存在' });
    }
    conversationId = rawConversationId;
  } else {
    conversationId = await createConversation(userId, titleSource);
  }

  /**
   * 2、先落库用户消息：上游模型调用失败也不会丢掉用户输入
   * 先将用户输入的消息存储到message表中
   *
   * 存的是纯文本，不含附件正文——content 同时用于渲染聊天气泡，
   * 把提取出的 PDF 正文拼进去会把整篇文档倒进气泡里。附件文本另存在 file_text，
   * 拼上下文时再按 messageId 取回来
   *
   * 存用户实际输入的 text（可能是空串）而不是 modelText：这一列会渲染成聊天气泡，
   * 替用户补的那句默认提问不该出现在界面上
   */
  const userMessageId = await insertMessage({
    conversationId,
    userId,
    role: 'user',
    content: text,
  });

  /**
   * 预算对象在整个请求内共享。先给当前轮的附件用，再轮到历史消息：
   * 当前轮是用户最关心的，历史里那些附件挤掉它才是本末倒置
   */
  const budget = { remaining: MAX_ATTACHMENT_CHARS_PER_REQUEST };
  // 当前轮已经带上的附件，历史注入时跳过，避免同一个文件在一份请求里出现两遍
  const currentFileIds = new Set(files.map((file) => file.fileId));

  // 先把当前轮的附件内容拼好（含图片转 data URL），占掉预算
  const currentContent = files.length > 0
    ? await buildCurrentUserContent(modelText, files, budget)
    : null;

  // 绑定附件与消息。放在落库之后：绑定要 messageId
  await bindFilesToMessage(fileIds, userMessageId);

  // 3、拼上下文。刚写入的这条用户消息也在其中，所以这里取完直接就是完整对话
  const history = await getRecentMessagesForContext(conversationId, userId);
  // 一次查出历史消息的附件，避免在循环里逐条查询（N+1）
  const attachmentsByMessage = await getAttachmentsByMessageIds(
    history.map((item) => item.messageId),
    userId
  );

  // 逐角色构造：既满足 SDK 的可辨识联合类型，也能兜住库里出现的意外 role。
  // 认不出来的 role 直接跳过并告警，不猜成 user——猜错会把脏数据伪装成用户发言送进模型，
  // 污染上下文的同时还掩盖了数据问题
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  for (const item of history) {
    // 当前这条用户消息已经拼成多模态数组了，直接用，不要再走纯文本分支
    if (item.messageId === userMessageId && currentContent) {
      messages.push({ role: 'user', content: currentContent });
      continue;
    }

    const attachments = (attachmentsByMessage.get(item.messageId) ?? [])
      .filter((attachment) => !currentFileIds.has(attachment.fileId));
    const contentWithAttachments = attachments.length > 0 && item.role === 'user'
      ? withAttachmentContext(item.content, attachments, budget)
      : item.content;

    const message = toChatMessage({ role: item.role, content: contentWithAttachments });
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
  let stream: Awaited<ReturnType<ReturnType<typeof getOpenAIClient>['chat']['completions']['create']>>;
  try {
    const openai = getOpenAIClient();
    stream = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? 'deepseek-v4-flash',
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
  // 让 nginx 之类的反向代理关闭缓冲，否则响应会被攒够一个 buffer 才下发，流式效果消失
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // 4、首帧回传会话ID，前端据此绑定会话，后续发送带上它即可续聊
  res.write(`event: conversation\ndata: ${JSON.stringify({ conversationId })}\n\n`);

  // 心跳：SSE 注释帧（以冒号开头），客户端解析时直接跳过，只用于保活
  const heartbeat = setInterval(() => {
    if (res.writableEnded || res.destroyed) return;
    res.write(': ping\n\n');
  }, HEARTBEAT_INTERVAL);

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
    // 先停心跳再收尾，避免 res.end() 之后定时器还在往里写
    clearInterval(heartbeat);
    if (!res.destroyed) res.end();
    // 兜底：客户端中途断开时上面的落库不会执行到，这里补上（已落库则是空操作）
    await persistAssistant();
  }
}

export {
  sseHandler,
}
