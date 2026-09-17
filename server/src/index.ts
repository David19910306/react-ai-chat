/**
 * 入口文件：先校验配置，再初始化表结构、启动服务、注册进程信号处理
 */
import './config';
import app from './app';
import { assertEnv } from './config';
import { initSchema } from './services/schema.service';
import connection from './services/dbPool.service';

const PORT = Number(process.env.PORT ?? 3000);

// 优雅关闭的兜底超时：SSE 长连接可能一直不结束，超时后强制退出，避免进程挂死不退出
const SHUTDOWN_TIMEOUT = 10_000;
// 停止接收新连接后，给在途请求留的收尾时间
const CLOSE_GRACE = 3_000;

// 配置缺失时直接启动失败并给出明确报错，避免在请求阶段才暴露成 500/401
try {
  assertEnv();
} catch (error) {
  console.error('环境变量校验失败，服务未启动:', error instanceof Error ? error.message : error);
  process.exit(1);
}

// 先建表再监听：表结构不对时直接启动失败并给出明确报错，避免请求阶段才暴露问题
initSchema()
  .then(() => {
    const server = app.listen(PORT, () => {
      console.log('server is available, running in http://localhost:' + PORT);
    });

    let shuttingDown = false;

    async function shutdown(signal: string) {
      // 连按两次 Ctrl+C 时不要并发走两遍关闭流程
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`收到 ${signal}，开始优雅关闭...`);

      const forceTimer = setTimeout(() => {
        console.error('优雅关闭超时，强制退出');
        process.exit(1);
      }, SHUTDOWN_TIMEOUT);
      // 不因为定时器本身而拖住进程退出
      forceTimer.unref();

      try {
        const closed = new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
        // 先断开空闲的 keep-alive 连接，再给在途请求留一小段收尾时间；
        // SSE 是长连接不会自行结束，超时后必须强制断开，否则 close() 会一直等下去
        server.closeIdleConnections();
        const graceTimer = setTimeout(() => server.closeAllConnections(), CLOSE_GRACE);
        graceTimer.unref();

        await closed;
        clearTimeout(graceTimer);

        // 关掉连接池，让在途 SQL 结束、句柄释放
        await connection.end();

        clearTimeout(forceTimer);
        console.log('已关闭 HTTP 服务与数据库连接池');
        process.exit(0);
      } catch (error) {
        console.error('优雅关闭出错:', error);
        clearTimeout(forceTimer);
        process.exit(1);
      }
    }

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  })
  .catch((error) => {
    console.error('数据库初始化失败，服务未启动:', error);
    process.exit(1);
  });
