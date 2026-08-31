// 数据库初始化

import mysql from 'mysql2/promise';
import { configDotenv } from "dotenv";

const HOST = configDotenv().parsed?.HOST ?? 'localhost';
const USER = configDotenv().parsed?.USER ?? 'root';
const PASS_WORD = configDotenv().parsed?.PASS_WORD ?? '123456';
const DATA_BASE = configDotenv().parsed?.DATA_BASE ?? 'database';

const connection = mysql.createPool({
  host: HOST,
  user: USER,
  password: PASS_WORD,
  database: DATA_BASE,
  waitForConnections: true,
  connectionLimit: 10,
})

connection.on('connection', (connection) => {
  connection.on('error', (err) => console.log(`数据库连接出错: ${err}`))
})

export default connection;