/**
 * express实例，配置中间件/路由（分离启动和实例，方便单元测试）
 */
import express, { type Express, } from "express";
import cors from 'cors';
import helmet from "helmet";
import { sseRouter, useRouter } from "./router";
import validateAccessToken from "./middleware/token.middleware";

const app: Express = express();

// 注册全局中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet());
app.use(validateAccessToken); // token验证

app.use(useRouter);
app.use(sseRouter);

export default app;