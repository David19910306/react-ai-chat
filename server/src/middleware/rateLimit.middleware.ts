/**
 * 接口限流
 *
 * 三类限流各管一件事：
 * - globalLimiter: 兜底，防止单 IP 高频刷接口
 * - authLimiter:   登录/注册，防止密码爆破（这两个接口是唯一不需要 token 的入口）
 * - chatLimiter:   聊天接口，按用户维度限制——每次调用都会真实消耗上游模型的 token 配额
 *
 * 存储用的是 express-rate-limit 默认的内存实现，只对单进程有效。
 * 若将来多进程/多实例部署，需要换成 Redis 之类的共享 store，否则每个进程各算各的。
 *
 * 另：默认按 req.ip 计限，Express 的 trust proxy 默认为 false，拿到的是直连地址。
 * 部署在反向代理后面时需要 app.set('trust proxy', ...)，否则所有用户会被算成同一个 IP。
 */
import { MINUTE, rateLimit } from 'express-rate-limit';
import type { Request, Response } from 'express';

// 统一的 429 响应体，和其余接口的 { message } 格式保持一致
function tooManyRequests(_req: Request, res: Response) {
  res.status(429).json({ message: '请求过于频繁，请稍后再试' });
}

const RATE_LIMIT_OPTIONS = {
  standardHeaders: 'draft-7' as const,
  legacyHeaders: false,
  handler: tooManyRequests,
  // 浏览器预检请求不该被计数，否则 OPTIONS 被限流会导致正常请求也发不出去
  skip: (req: Request) => req.method === 'OPTIONS',
};

// 全局兜底：单 IP 每分钟最多 200 次
const globalLimiter = rateLimit({
  windowMs: MINUTE,
  limit: 200,
  ...RATE_LIMIT_OPTIONS,
});

// 登录/注册：单 IP 每 15 分钟最多 10 次。正常用户不会连登 10 次，爆破则一眼可见
const authLimiter = rateLimit({
  windowMs: 15 * MINUTE,
  limit: 10,
  ...RATE_LIMIT_OPTIONS,
});

// 聊天：按 userId 限流，每分钟 20 次。
// 必须挂在 token 中间件之后——这里依赖 req.user 已经被填充。
// 只按 userId 计数、不掺 IP，避免同一公司出口 IP 下的用户互相影响。
const chatLimiter = rateLimit({
  windowMs: MINUTE,
  limit: 20,
  ...RATE_LIMIT_OPTIONS,
  keyGenerator: (req: Request) => req.user?.userId ?? 'anonymous',
});

export {
  authLimiter,
  chatLimiter,
  globalLimiter,
};
