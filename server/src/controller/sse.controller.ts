import { type Request, type Response } from 'express';
import OpenAI from 'openai';

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

async function sseHandler(req: Request, res: Response) {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: 'Invalid request body' });
    return;
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

  try {
    // 发送消息
    for await (const event of stream) {
      if (res.destroyed) break;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    res.write('data: [DONE]\n\n');
  } catch (err: any) {
    // 流中途出错：以标准 SSE error 事件通知客户端
    if (!res.destroyed) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message ?? 'stream error' })}\n\n`);
    }
  } finally {
    if (!res.destroyed) res.end();
  }
}

export {
  sseHandler,
}
