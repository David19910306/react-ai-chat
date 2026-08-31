/**
 * 用户增删改查，登录等逻辑
 */
import type { QueryResult } from "mysql2";
import { configDotenv } from "dotenv";
import { type Request, type Response } from "express";
import { Snowflake } from "@theinternetfolks/snowflake";
import jsonwebtoken from "jsonwebtoken";

import connection from "./initialDb.service";
import { comparePwdHash, encrypted } from "../utils";

const JWT_SECRET = configDotenv({ path: '.env.development' }).parsed?.JWT_SECRET ?? '';

/*************  检查用户名是否存在  ***************/
async function findUserName(username: string): Promise<QueryResult> {
  const findSql = `select user.username from user where username = '${username}'`;
  const [ res ] = await connection.query(findSql);
  return res;
}

/*************  新增用户数据  *******************/
async function registerUser(req: Request, res: Response) {
  const { 
    username, address, tel, email, password
  } = req.body ?? {};
  // 1、参数验证
  if (!username) {
    return res.status(400).json({ message: '用户名不能为空' });
  }

  // 2、检查用户名是否存在
  const result = await findUserName(username) as Record<string, string>[];
  if (result.length > 0) {
    return res.status(500).json({ message: '存在相同的用户名', });
  }

  // 3、密码加密
  if (!password) {
    return res.status(400).json({ message: '密码不能为空' });
  }
  const encryptPwd = encrypted(password);

  // 4、创建用户
  const userId = Snowflake.generate();
  const addUser = 'insert into user(userId, username, address, tel, email, password) values(?, ?, ?, ?, ?, ?)';
  const addParams = [`${userId}`, `${username}`, `${address}`, `${tel}`, `${email}`, `${encryptPwd}`];
  const [ addRes ]: any = await connection.query(addUser, addParams);
  if (addRes.affectedRows !== 1) {
    res.status(500).json({ message: '用户新增失败' });
  }
  // 5、创建token
  const token = jsonwebtoken.sign(
    { userId, username, },
    JWT_SECRET,
    { expiresIn: '2h' }
  );

  // 6、返回token + 用户信息
  const _user = { userId, username, address, tel, email, password: encryptPwd, token, };
  res.status(200).json({ user: _user });
  connection.end();
}

/*************  用户登录  *******************/
async function loginUser(username: string, password: string) {
  // 1、根据用户名/邮箱/手机号 查询用户记录
  const queryNameSql = `select user.username from user where username = '${username}'`;
  const queryTelSql = `select user.tel from user where tel = '${username}'`;
  const queryEmailSql = `select user.email from user where email = '${username}'`;
  const [[user], [tel], [email]]: any = await Promise.all([queryNameSql, queryTelSql, queryEmailSql].map(sql => connection.query(sql)))
  if (user.length === 0 && tel.length === 0 && email.length === 0) {
    // 没找到对应的用户
    connection.end();
    return {isLogin: false, userId: null};
  }

  // 2、比对密码哈希值
  const queryPwdSql = `select user.password from user where username = '${username}' or tel = '${username}' or email = '${username}'`
  const queryuserIdSql = `select user.userId from user where username = '${username}' or tel = '${username}' or email = '${username}'`
  const [[pwd]]: any = await connection.query(queryPwdSql); // 差查询出数据表中对应用户的密码
  const [[userId]]: any = await connection.query(queryuserIdSql); // 差查询出数据表中对应用户的密码
  connection.end();
  return {isLogin: comparePwdHash(pwd?.password, password), userId};
}

export {
  findUserName,
  registerUser,
  loginUser,
}