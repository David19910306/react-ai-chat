/**
 * 扩展 Express 的 Request 类型：token 中间件校验通过后会把 JWT payload 挂到 req.user，
 * 供后续 controller 取当前登录用户（见 src/middleware/token.middleware.ts）
 */
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        username: string;
      };
    }
  }
}

export {};
