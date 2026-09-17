// 接口请求的token校验
import { type NextFunction, type Request, type Response } from "express";
import jsonwebtoken from "jsonwebtoken";

import { JWT_SECRET } from "../config";

// 无需 token 的白名单路由（注册、登录）
const WHITE_LIST = new Set(['/api/add/user', '/api/login/user']);

function validateAccessToken(req: Request, res: Response, next: NextFunction) {
  if (WHITE_LIST.has(req.path)) {
    next();
    return;
  }

  // 从请求头取 Authorization
  const authHeader = req.headers.authorization ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: '未携带认证令牌' });
  }

  const token = authHeader.split(' ')[1];
  // 验证token是否有效，并通过 req.user 把当前登录用户透给后续 controller
  try {
    const payload = jsonwebtoken.verify(token, JWT_SECRET) as jsonwebtoken.JwtPayload;
    req.user = {
      userId: String(payload.userId ?? ''),
      username: String(payload.username ?? ''),
    };
    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: '令牌已过期，请重新登录' });
    }
    return res.status(401).json({ message: '令牌无效' });
  }
}

export default validateAccessToken;
