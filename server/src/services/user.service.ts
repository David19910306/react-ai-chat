/**
 * 用户注册、登录逻辑
 * 所有 SQL 一律使用参数化查询，避免 SQL 注入
 */
import type { QueryResult } from "mysql2";
import { type Request, type Response } from "express";
import { Snowflake } from "@theinternetfolks/snowflake";
import jsonwebtoken from "jsonwebtoken";

import connection from "./initialDb.service";
import { hashPassword, verifyPassword } from "../utils";

const JWT_SECRET = process.env.JWT_SECRET ?? '';

/*************  检查用户名是否存在  ***************/
async function findUserName(username: string): Promise<QueryResult> {
  const [res] = await connection.query('select user.username from user where username = ? limit 1', [username]);
  return res;
}

/*************  新增用户数据  *******************/
async function registerUser(req: Request, res: Response) {
  const { username, address, tel, email, password } = req.body ?? {};

  // 1、参数验证
  if (!username) {
    return res.status(400).json({ message: '用户名不能为空' });
  }
  if (!password) {
    return res.status(400).json({ message: '密码不能为空' });
  }

  // 2、检查用户名是否存在
  const result = await findUserName(username) as Record<string, string>[];
  if (result.length > 0) {
    return res.status(409).json({ message: '存在相同的用户名' });
  }

  // 3、密码哈希（加盐慢哈希，不可逆）
  const userId = String(Snowflake.generate());

  // 4、创建用户
  const [addRes]: any = await connection.query(
    'insert into user(userId, username, address, tel, email, password) values(?, ?, ?, ?, ?, ?)',
    // 可选字段用空字符串占位（表结构 NOT NULL 且无默认值，不能传 null）
    [userId, username, address ?? '', tel ?? '', email ?? '', hashPassword(password)]
  );
  if (addRes.affectedRows !== 1) {
    return res.status(500).json({ message: '用户新增失败' });
  }

  // 5、创建token
  const token = jsonwebtoken.sign(
    { userId, username },
    JWT_SECRET,
    { expiresIn: '5h' }
  );

  // 6、返回token + 用户信息（绝不返回密码哈希）
  res.status(200).json({ user: { userId, username, token } });
}

/*************  用户登录  *******************/
async function loginUser(username: string, password: string) {
  // 1、根据用户名/邮箱/手机号 查询用户记录（参数化查询防注入）
  const [rows]: any = await connection.query(
    'select userId, username, password from user where username = ? or tel = ? or email = ? limit 1',
    [username, username, username]
  );
  const user = rows?.[0];

  // 2、没找到用户 / 密码不匹配：统一返回失败
  if (!user || !verifyPassword(password, user.password)) {
    return { isLogin: false, userId: null, username: '' };
  }

  return { isLogin: true, userId: user.userId, username: user.username };
}

export {
  findUserName,
  registerUser,
  loginUser,
}
