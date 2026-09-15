-- 聊天记录表结构（权威定义）
--
-- 服务启动时由 src/services/schema.service.ts 自动执行本文件，也可手动执行：
--   mysql -u root -p <database> < server/sql/schema.sql
--
-- 语句统一使用 CREATE TABLE IF NOT EXISTS，可重复执行。
-- 注意：本文件只维护「会话」与「消息」两张表；既有的 `user` 表不在仓库内维护。
--
-- 排序规则刻意不写死 COLLATE：继承数据库默认值，才能和既有的 `user` 表保持一致
-- （本机默认是 utf8mb4_0900_ai_ci）。若写死 utf8mb4_unicode_ci，跨表比较列时会报
-- ER_CANT_AGGREGATE_2COLLATIONS；而写死 utf8mb4_0900_ai_ci 又会在 MySQL 5.7 上不存在。

CREATE TABLE IF NOT EXISTS `conversation` (
  `conversationId` VARCHAR(32) NOT NULL COMMENT '会话ID（雪花ID）',
  `userId`         VARCHAR(32) NOT NULL COMMENT '所属用户ID',
  `title`          VARCHAR(255) NOT NULL DEFAULT '' COMMENT '会话标题，取首条用户消息截断',
  `createTime`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updateTime`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '最近活跃时间，会话列表按它倒序',
  PRIMARY KEY (`conversationId`),
  KEY `idx_user_update` (`userId`, `updateTime`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='会话表';

CREATE TABLE IF NOT EXISTS `message` (
  `messageId`      VARCHAR(32) NOT NULL COMMENT '消息ID（雪花ID）',
  `conversationId` VARCHAR(32) NOT NULL COMMENT '所属会话ID',
  `userId`         VARCHAR(32) NOT NULL COMMENT '所属用户ID',
  `role`           VARCHAR(16) NOT NULL COMMENT 'user / assistant / system',
  `content`        MEDIUMTEXT NOT NULL COMMENT '消息内容，长回复不截断',
  `createTime`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`messageId`),
  KEY `idx_conversation_time` (`conversationId`, `createTime`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='消息表';
