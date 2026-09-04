import { type Request, type Response } from 'express';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

async function sseHandler(req: Request, res: Response) {
  const { messages } = req.body;
  if (!messages) {
    res.status(400).json({ error: 'Invalid request body' });
    return;
  }
  // sse 请求头设置
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const abortControl = new AbortController();

  // 监听客户断开
  req.on('close', () => {
    if (!res.writableEnded) abortControl.abort();
  });

  try{
    const stream = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? 'deepseek-chat',
      messages,
      stream: true,
    }, { signal: abortControl.signal });

    // 发送消息
    for await (const event of stream) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    res.write('data: [DONE]\n\n');
  }catch (err: any) {
    const error = JSON.stringify({error: err.message });
    res.write(`event: ${error}, someting wrong\n\n`);
  }finally {
    res.end();
  }
}

export {
  sseHandler,
}