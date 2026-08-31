import { type NextFunction, type Request, type Response } from "express";
import jsonwebtoken from 'jsonwebtoken';
import { configDotenv } from "dotenv";
import { registerUser, loginUser as login } from "../services/user.service";
import { encrypted } from "../utils";

const JWT_SECRET = configDotenv({ path: '.env.development' }).parsed?.JWT_SECRET ?? '';

// 用户注册
async function addUser(req: Request, res: Response) {
  registerUser(req, res)
}

// 用户登录
async function loginUser(req: Request, res: Response, next: NextFunction) {
  const { username, password } = req.body;
  const {isLogin, userId} = await login(username, password);
  if (!isLogin) {
    res.status(401).json({ message: '用户不存在' });
    return;
  }
  // 更新用户信息，并生成token
  const token = jsonwebtoken.sign(
    { userId, username, },
    JWT_SECRET,
    { expiresIn: '2h' }
  );
  const _user = { userId, username, password: encrypted(password), token, };
  res.status(200).json({ user: _user });
}

export {
  addUser,
  loginUser,
}