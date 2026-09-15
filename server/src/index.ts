/**
 * 入口文件：先加载环境变量，再初始化表结构、启动服务、注册全局错误中间件
 */
import './config';
import app from './app';
import { ErrorMiddleWare } from './middleware/error.middleware';
import { initSchema } from './services/schema.service';

const PORT = Number(process.env.PORT ?? 3000);

app.use(ErrorMiddleWare); // 错误处理中间件（必须放在所有路由之后）

// 先建表再监听：表结构不对时直接启动失败并给出明确报错，避免请求阶段才暴露问题
initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log('server is available, running in http://localhost:' + PORT);
    });
  })
  .catch((error) => {
    console.error('数据库初始化失败，服务未启动:', error);
    process.exit(1);
  });
