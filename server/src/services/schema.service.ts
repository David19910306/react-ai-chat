/**
 * 启动时初始化表结构
 * 读取 sql/schema.sql（权威定义）逐条执行，脚本内统一使用 CREATE TABLE IF NOT EXISTS，可重复执行
 *
 * 注意与 dbPool.service.ts 区分：本文件负责建表，连接池在 dbPool.service.ts
 */
import fs from 'node:fs';
import path from 'node:path';

import connection from './dbPool.service';

// 用 __dirname 而不是 process.cwd() 定位，保证从任何目录启动都能找到 schema 文件
const SCHEMA_FILE = path.resolve(__dirname, '../../sql/schema.sql');

// 去掉 -- 注释行，再按分号切分成一条条可执行的语句
function parseStatements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function initSchema() {
  const sql = fs.readFileSync(SCHEMA_FILE, 'utf-8');
  const statements = parseStatements(sql);

  for (const statement of statements) {
    await connection.query(statement);
  }

  console.log(`数据库表结构初始化完成，共执行 ${statements.length} 条语句`);
}

export { initSchema };
