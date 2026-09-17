import { type Request, type Response } from "express";
import jsonwebtoken from 'jsonwebtoken';
import { registerUser, loginUser as login } from "../services/user.service";
import { JWT_EXPIRES_IN, JWT_SECRET } from "../config";

// 用户注册
async function addUser(req: Request, res: Response) {
  await registerUser(req, res);
}

// 用户登录
async function loginUser(req: Request, res: Response) {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ message: '用户名和密码不能为空' });
  }

  const { isLogin, userId, username: realUsername } = await login(username, password);
  if (!isLogin) {
    // 不区分"用户不存在/密码错误"，避免枚举用户名
    return res.status(401).json({ message: '用户名或密码错误' });
  }

  const token = jsonwebtoken.sign(
    { userId, username: realUsername },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
  res.status(200).json({ user: { userId, username: realUsername, token } });
}

export {
  addUser,
  loginUser,
}
