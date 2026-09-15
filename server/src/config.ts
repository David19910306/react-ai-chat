/**
 * 统一加载环境变量：只在入口加载一次，其他模块直接读 process.env
 * 生产环境读 .env，开发环境读 .env.development
 * 必须在 index.ts 中第一个 import，确保其他模块在 module 作用域读 env 时已加载完成
 */
import { configDotenv } from 'dotenv';
import path from 'node:path';

const envFile = process.env.NODE_ENV === 'production' ? '.env' : '.env.development';

configDotenv({ path: path.resolve(process.cwd(), envFile) });
