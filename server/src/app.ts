/**
 * express实例，配置中间件/路由（分离启动和实例，方便单元测试）
 */
import express, { type Express, } from "express";
import { useRouter } from "./router";

const app: Express = express();
app.use(useRouter)

export default app;