import type { NextFunction, Request, Response } from "express";

export function ErrorMiddleWare(err: any, req: Request, res: Response, next: NextFunction) {
  // 打日志：完整错误信息只进日志，不返回给前端
  console.error(`[${new Date().toISOString()}]`, req.method, req.originalUrl, err);

  // 分类处理数据库错误
  if (err.code === 'ER_DUP_ENTRY') {          // MySQL 主键/唯一键冲突
    return res.status(409).json({ message: '数据已存在' });
  }
  if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {  // 数据库连接失败
    return res.status(503).json({ message: '数据库暂时不可用' });
  }
  if (err.name === 'SequelizeUniqueConstraintError' || err.code === '11000') {
    // Sequelize / MongoDB 唯一约束冲突
    return res.status(409).json({ message: '数据已存在' });
  }

  // 其他未知错误：返回通用信息，避免暴露内部细节
  res.status(err.status || 500).json({
    message: '服务器内部错误',
    ...(process.env.NODE_ENV === 'development' && { detail: err.message }),
  });
}