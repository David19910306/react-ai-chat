/**
 * 入口文件，启动服务、注册全局中间件
 */
import { configDotenv } from "dotenv";
import app from './app';
import { ErrorMiddleWare } from "./middleware/error.middleware";

const PORT = configDotenv().parsed?.PORT ?? '3000';

app.use(ErrorMiddleWare); // 错误处理中间件

app.listen(PORT, () => {
  console.log('server is available, running in http://localhost:' + PORT);
});