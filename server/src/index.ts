/**
 * 入口文件，启动服务、注册全局中间件
 */
import express, {  type Request, type Response} from "express";
import { configDotenv } from "dotenv";
import cors from 'cors';
import helmet from "helmet";

import app from './app';

const PORT = configDotenv().parsed?.PORT ?? '3000';

// 注册全局中间件
app.use(cors());
app.use(express.json());
app.use(helmet());

app.listen(PORT, () => {
  console.log('server is available, running in http://localhost:' + PORT);
});