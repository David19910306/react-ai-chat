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

/* 文件上传 */
CREATE TABLE IF NOT EXISTS `file` (
  `fileId` VARCHAR(32) NOT NULL COMMENT '主键雪花ID',
  `file_name` VARCHAR(255) NOT NULL COMMENT '文件名',
  `file_suffix` VARCHAR(50) NOT NULL COMMENT '文件后缀名',
  `mime_type` VARCHAR(100) NOT NULL COMMENT 'MIME文件类型：application/pdf',
  `file_size` BIGINT NOT NULL COMMENT '文件大小',
  `previewUrl` VARCHAR(100) NOT NULL COMMENT '预览地址',
  `storage_path` VARCHAR(512) NOT NULL COMMENT '存储地址（本地相对路径）',
  `md5` VARCHAR(32) NOT NULL COMMENT '文件 md5，用于**秒传、重复文件校验**',
  `create_by` VARCHAR(32) NOT NULL COMMENT '上传人id',
  `create_time` DATETIME(3) NOT NULL COMMENT '上传时间',
  PRIMARY KEY (`fileId`),
  KEY `idx_file_time` (`fileId`, `create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='文件存储表';

/* 消息与附件的关联 */
-- 用独立的关联表而不是给 file 表加 messageId 列，原因有二：
-- 1、schema.sql 的约定是「全部 CREATE TABLE IF NOT EXISTS，可重复执行」，而 MySQL 没有
--    ADD COLUMN IF NOT EXISTS，加列只能引入迁移逻辑或容忍重复执行报错，破坏这个约定
-- 2、md5 列的注释提到秒传：同一个物理文件将来可能被多条消息复用，关联表天然支持，
--    加列则会退化成一对一
-- 没有建外键，与本库既有表保持一致（约束放在应用层显式处理）
CREATE TABLE IF NOT EXISTS `message_file` (
  `messageId`  VARCHAR(32) NOT NULL COMMENT '消息ID',
  `fileId`     VARCHAR(32) NOT NULL COMMENT '文件ID',
  `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  -- 联合主键顺带兜住重复绑定：同一条消息重复挂同一个文件会被主键挡掉
  PRIMARY KEY (`messageId`, `fileId`),
  KEY `idx_file` (`fileId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='消息附件关联表';

/* 附件文本提取结果的缓存 */
-- 为什么不把提取出的文本直接拼进 message.content：
-- 1、content 同时用于渲染聊天气泡，拼进去会把整篇 PDF 正文倒进气泡里
-- 2、content 也是后续轮次拼上下文的来源，不缓存的话每轮都要重新解析一遍 PDF
-- 单独缓存后，解析只发生一次；文件删除时由应用层一并清理
CREATE TABLE IF NOT EXISTS `file_text` (
  `fileId`     VARCHAR(32) NOT NULL COMMENT '文件ID',
  `content`    MEDIUMTEXT NOT NULL COMMENT '提取出的纯文本',
  `truncated`  TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否因超长被截断',
  `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`fileId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='附件文本提取缓存';
