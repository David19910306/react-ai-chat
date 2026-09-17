/**
 * express实例，配置中间件/路由（分离启动和实例，方便单元测试）
 *
 * 错误中间件和 404 兜底也在这里注册，而不是放在 index.ts——否则 import 本模块做测试时
 * 拿到的是一个没有错误处理的残缺应用，测不出真实的错误响应
 */
import express, { type Express, } from "express";
import cors from 'cors';
import helmet from "helmet";
import { conversationRouter, sseRouter, useRouter } from "./router";
import { ErrorMiddleWare } from "./middleware/error.middleware";
import { globalLimiter } from "./middleware/rateLimit.middleware";
import validateAccessToken from "./middleware/token.middleware";

const app: Express = express();

// 注册全局中间件
app.use(cors());
// 限流放在 body 解析之前：被限流的请求没必要先把请求体读进内存
app.use(globalLimiter);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet());
app.use(validateAccessToken); // token验证

app.use(useRouter);
app.use(conversationRouter);
app.use(sseRouter);

// 404 兜底：放在所有路由之后。不加的话未匹配路由会落到 Express 默认的 HTML 错误页，
// 与其余接口的 JSON 响应格式不一致
app.use((req, res) => {
  res.status(404).json({ message: '接口不存在' });
});

// 错误处理中间件（必须放在所有路由之后）
app.use(ErrorMiddleWare);

export default app;
