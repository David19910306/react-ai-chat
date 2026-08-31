// 接口请求的token校验
import { configDotenv } from "dotenv";
import { type NextFunction, type Request, type Response } from "express";
import jsonwebtoken from "jsonwebtoken";

const JWT_SECRET = configDotenv({ path: '.env.development' }).parsed?.JWT_SECRET ?? '';

function validateAccessToken(req: Request, res: Response, next: NextFunction) {
  if (req.url === '/api/add/user' || req.url === '/api/login/user') { // 用户注册和登录无需token
    next();
    return;
  }
  // 从请求头取 Authorization
  const authHeader = req.headers.authorization ?? '';
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ message: '未携带认证令牌' });
  }
  // 提取token
  const token = authHeader.split(' ')?.[1];
  // 验证token是否有效
  try {
    const _token = jsonwebtoken.verify(token, JWT_SECRET);
    console.log(_token);
    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: '令牌已过期，请重新登录' });
    }
    return res.status(401).json({ message: '令牌无效' });
  }
}

export default validateAccessToken;