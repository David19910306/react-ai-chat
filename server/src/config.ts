/**
 * 统一加载环境变量：只在入口加载一次，其他模块直接读 process.env
 * 生产环境读 .env，开发环境读 .env.development
 * 必须在 index.ts 中第一个 import，确保其他模块在 module 作用域读 env 时已加载完成
 */
import { configDotenv } from 'dotenv';
import path from 'node:path';

const envFile = process.env.NODE_ENV === 'production' ? '.env' : '.env.development';

// 用 __dirname 而不是 process.cwd() 定位：从仓库根目录或任意目录启动都能找到 env 文件，
// 与 schema.service.ts 读取 sql/schema.sql 的方式保持一致。
// 开发时 __dirname 是 server/src，构建后是 server/dist，两者上一级都是 server/
configDotenv({ path: path.resolve(__dirname, '..', envFile) });

// JWT 有效期，登录和注册两处签发 token 共用，避免各写一份后改漏
const JWT_EXPIRES_IN = '5h';

/**
 * 启动期校验必需的环境变量。
 * 缺 JWT_SECRET 时 jsonwebtoken.sign 会在请求阶段抛错，而 verify 的抛错会被中间件
 * 当成「令牌无效」，把配置问题伪装成鉴权失败，排查成本很高——所以宁可直接启动失败。
 * 在 index.ts 中调用，确保在建表/监听端口之前就暴露问题。
 */
function assertEnv(): void {
  const missing: string[] = [];

  if (!process.env.JWT_SECRET) missing.push('JWT_SECRET');
  if (!process.env.OPENAI_API_KEY) missing.push('OPENAI_API_KEY');

  if (missing.length > 0) {
    throw new Error(
      `缺少必需的环境变量: ${missing.join(', ')}（请参考 server/.env.example 配置 ${envFile}）`
    );
  }

  // 数据库配置带有默认值，缺了不会报错但会连到错误的库，这里只做提醒
  const dbFallbacks = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'].filter(
    (key) => !process.env[key]
  );
  if (dbFallbacks.length > 0) {
    console.warn(`未配置 ${dbFallbacks.join(', ')}，正在使用代码中的默认值`);
  }
}

// 校验通过后再取，保证类型上是确定的 string，调用方不必再 ?? ''
const JWT_SECRET = process.env.JWT_SECRET ?? '';

export {
  JWT_EXPIRES_IN,
  JWT_SECRET,
  assertEnv,
};
