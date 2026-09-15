/**
 * 入口文件：先加载环境变量，再启动服务、注册全局错误中间件
 */
import './config';
import app from './app';
import { ErrorMiddleWare } from './middleware/error.middleware';

const PORT = Number(process.env.PORT ?? 3000);

app.use(ErrorMiddleWare); // 错误处理中间件（必须放在所有路由之后）

app.listen(PORT, () => {
  console.log('server is available, running in http://localhost:' + PORT);
});
