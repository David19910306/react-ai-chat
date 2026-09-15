// 数据库连接池（全局共享，禁止在单次请求后 end()）
import mysql from 'mysql2/promise';

const connection = mysql.createPool({
  host: process.env.DB_HOST ?? 'localhost',
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '123456',
  database: process.env.DB_NAME ?? 'database',
  waitForConnections: true,
  connectionLimit: 10,
})

connection.on('connection', (connection) => {
  connection.on('error', (err) => console.log(`数据库连接出错: ${err}`))
})

export default connection;
