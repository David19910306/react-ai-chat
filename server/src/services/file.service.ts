/**
 * 上传文件的持久化
 *
 * 与 conversation.service.ts 同样的两条硬性约束：
 * 1、所有 SQL 一律参数化，禁止把 fileId 之类的入参拼进 SQL 字符串
 * 2、所有按 fileId 的查询/删除都必须带 userId 条件——fileId 是雪花ID，可预测性不低，
 *    少一个条件就能凭 ID 读到或删掉别人的文件
 */
import { Snowflake } from "@theinternetfolks/snowflake";
import { getCurrentTime, getSuffix } from "../utils";
import connection from "./dbPool.service";

export type SaveFileOptions = {
  /** 用户看到的原始文件名（已解码、已剥离路径） */
  originalname: string;
  /** 浏览器声明的 MIME，仅记录，不作为鉴别依据 */
  mimetype: string;
  /** 磁盘绝对路径，仅服务端使用，不下发前端 */
  path: string;
  size: number;
  md5: string;
  userId: string;
};

/** 下发给前端的文件信息。刻意不含 storage_path / create_by，避免泄漏服务器目录结构与他人ID */
export type FileDTO = {
  id: string;
  filename: string;
  type: string;
  size: number;
  md5: string;
  previewUrl: string;
};

/** 服务端内部使用：读原文件所需的全部信息 */
export type FileRow = {
  fileId: string;
  fileName: string;
  suffix: string;
  storagePath: string;
  size: number;
};

// 预览地址由 fileId 推导，集中在这里生成，避免前后端各拼一份拼歪
function buildPreviewUrl(fileId: string): string {
  return `/api/file/preview/${fileId}`;
}

async function saveUploadFile(options: SaveFileOptions): Promise<FileDTO> {
  const { originalname, mimetype, path, size, md5, userId } = options;
  const fileId = String(Snowflake.generate());
  const suffix = getSuffix(originalname);
  const previewUrl = buildPreviewUrl(fileId);

  await connection.query(
    `insert into file(fileId, file_name, file_suffix, mime_type, file_size, storage_path, previewUrl, md5, create_by, create_time)
      values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [fileId, originalname, suffix, mimetype, size, path, previewUrl, md5, userId, getCurrentTime()]
  );

  return { id: fileId, filename: originalname, type: suffix, size, md5, previewUrl };
}

/**
 * 按 fileId + 归属人取文件。查不到（不存在或不属于该用户）返回 null，
 * 调用方统一按 404 处理：不区分两者，避免把「文件存在但不是你的」这个信息泄漏出去
 */
async function getFileForOwner(fileId: string, userId: string): Promise<FileRow | null> {
  const [rows] = await connection.query<any[]>(
    `select fileId, file_name, file_suffix, storage_path, file_size
      from file where fileId = ? and create_by = ?`,
    [fileId, userId]
  );
  const row = rows?.[0];
  if (!row) return null;

  return {
    fileId: String(row.fileId),
    fileName: row.file_name,
    suffix: row.file_suffix,
    storagePath: row.storage_path,
    size: Number(row.file_size),
  };
}

/**
 * 删除记录。返回是否真的删掉了一行，调用方据此区分 404。
 *
 * 顺带清理 file_text 缓存和 message_file 绑定，且放在同一个事务里：
 * 只删 file 会留下指向空文件的文本缓存和悬空绑定，前者白占空间，
 * 后者会让"这条消息有附件"和"附件查不到"同时成立
 */
async function deleteFileById(fileId: string, userId: string): Promise<boolean> {
  const conn = await connection.getConnection();
  try {
    await conn.beginTransaction();

    // mysql2 的 query 返回 [result, fields]，DELETE 的 result 本身就是 ResultSetHeader。
    // 之前写成 result[0].affectedRows 多取了一层，永远是 undefined，删除接口从来没返回过成功
    const [result] = await conn.query<any>(
      'delete from file where fileId = ? and create_by = ?',
      [fileId, userId]
    );
    // affectedRows 为 0 说明文件不存在或不属于该用户，此时不能去动旁表
    const deleted = result?.affectedRows > 0;
    if (deleted) {
      await conn.query('delete from file_text where fileId = ?', [fileId]);
      await conn.query('delete from message_file where fileId = ?', [fileId]);
    }

    await conn.commit();
    return deleted;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * 当前用户的文件列表
 *
 * 注意：返回的是**该用户的全部文件**，包含已经挂到消息上的。
 * 前端曾用它预加载「待发送区」，结果是每次打开页面都把历史附件倒进输入框，
 * 还顺带提供了误删入口。待发送区只能由本次会话新上传/秒传的文件构成，
 * 这个接口若要复用，得先想清楚「选中的是哪一类文件」
 */
async function getFilesByUser(userId: string): Promise<FileDTO[]> {
  const [rows] = await connection.query<any[]>(
    `select fileId, file_name, file_suffix, file_size, md5, previewUrl
        from file where create_by = ? order by create_time desc`,
    [userId]
  );

  return (rows ?? []).map((file) => ({
    id: String(file.fileId),
    filename: file.file_name,
    type: file.file_suffix,
    size: Number(file.file_size),
    md5: file.md5,
    // 历史数据里存的是早期的 uploadFiles/xxx 明文路径，那条静态路由已经下线，
    // 统一按 fileId 重新推导，老记录也能正常预览
    previewUrl: buildPreviewUrl(String(file.fileId)),
  }));
}

/**
 * 按一批 fileId 取当前用户的文件。发消息带附件时用它校验归属。
 *
 * 逐条校验不如一次查完：调用方拿返回数量与请求数量比对，少了就说明有 ID 越权或不存在。
 * 用 in (?) 传数组，mysql2 会展开成占位符列表，不会退化成字符串拼接
 */
async function getFilesForOwner(fileIds: string[], userId: string): Promise<FileRow[]> {
  if (fileIds.length === 0) return [];

  const [rows] = await connection.query<any[]>(
    `select fileId, file_name, file_suffix, storage_path, file_size
      from file where fileId in (?) and create_by = ?`,
    [fileIds, userId]
  );

  return (rows ?? []).map((row) => ({
    fileId: String(row.fileId),
    fileName: row.file_name,
    suffix: row.file_suffix,
    storagePath: row.storage_path,
    size: Number(row.file_size),
  }));
}

/**
 * 把附件绑定到消息上。
 *
 * 这里不再校验归属：调用方必须先用 getFilesForOwner 校验过。
 * 重复绑定同一个文件到同一条消息会被联合主键挡掉，所以用 insert ignore，
 * 避免因为主键冲突把整轮对话打挂
 */
async function bindFilesToMessage(fileIds: string[], messageId: string): Promise<void> {
  if (fileIds.length === 0) return;

  const values = fileIds.map((fileId) => [messageId, fileId]);
  await connection.query('insert ignore into message_file(messageId, fileId) values ?', [values]);
}

/** 一条消息的附件（含提取出的文本，可能为 null 表示尚未提取） */
export type MessageAttachment = {
  messageId: string;
  fileId: string;
  fileName: string;
  suffix: string;
  /** null 表示还没提取过（图片属于这种情况） */
  extractedText: string | null;
};

/**
 * 取这批消息的附件，用于拼模型上下文。
 * 带 userId 条件：messageId 来自本用户，但多一层条件能兜住脏数据
 */
async function getAttachmentsByMessageIds(
  messageIds: string[],
  userId: string
): Promise<Map<string, MessageAttachment[]>> {
  const grouped = new Map<string, MessageAttachment[]>();
  if (messageIds.length === 0) return grouped;

  const [rows] = await connection.query<any[]>(
    `select mf.messageId, f.fileId, f.file_name, f.file_suffix, ft.content
       from message_file mf
       join file f on f.fileId = mf.fileId
       left join file_text ft on ft.fileId = mf.fileId
      where mf.messageId in (?) and f.create_by = ?
      order by mf.createTime asc, f.fileId asc`,
    [messageIds, userId]
  );

  for (const row of rows ?? []) {
    const list = grouped.get(row.messageId) ?? [];
    list.push({
      messageId: row.messageId,
      fileId: String(row.fileId),
      fileName: row.file_name,
      suffix: row.file_suffix,
      extractedText: row.content ?? null,
    });
    grouped.set(row.messageId, list);
  }
  return grouped;
}

/**
 * 取附件文本，未缓存则解析并写入缓存。
 * 缓存的意义：拼上下文时每条带附件的消息都要用文本，不缓存的话每轮对话都要把 PDF 重解析一遍
 */
async function getOrExtractFileText(
  file: FileRow,
  extract: (file: FileRow) => Promise<{ text: string; truncated: boolean }>
): Promise<string> {
  const [cached] = await connection.query<any[]>(
    'select content, truncated from file_text where fileId = ?',
    [file.fileId]
  );
  const hit = cached?.[0];
  if (hit) {
    return hit.truncated ? `${hit.content}\n\n（内容过长，已截断）` : hit.content;
  }

  const { text, truncated } = await extract(file);
  // insert ignore：并发下两个请求可能同时解析同一个文件，
  // 后到的被主键挡掉即可，不必加锁
  await connection.query(
    'insert ignore into file_text(fileId, content, truncated) values(?, ?, ?)',
    [file.fileId, text, truncated ? 1 : 0]
  );

  return truncated ? `${text}\n\n（内容过长，已截断）` : text;
}

/**
 * 按「内容指纹」查当前用户已有的文件，用于秒传。
 *
 * 条件里必须带 create_by：不能跨用户命中。文件指纹不是秘密——公开的安装包、
 * 常见文档都能对上，一旦允许跨用户复用，别人只要猜到 md5 就能拿到一个 fileId，
 * 等于给出了「服务器上有这个文件」以及后续越权尝试的入口。
 *
 * 用 md5 + size 两个条件而不是只比 md5：md5 理论上存在碰撞，
 * 而同一批里两个大小不同的文件更可能是不同版本被算错，两个都对上才认定是同一份内容
 */
async function findFileByFingerprint(params: {
  md5: string;
  size: number;
  userId: string;
}): Promise<FileDTO | null> {
  const { md5, size, userId } = params;

  // 取最新一条：同一份内容理论上可能有重复记录（并发上传时会各插一行，见 saveUploadFile 处的说明），
  // 复用时挑最近的那条，更不容易正撞上后台回收的时间窗
  const [rows] = await connection.query<any[]>(
    `select fileId, file_name, file_suffix, file_size, md5
       from file
      where md5 = ? and file_size = ? and create_by = ?
      order by create_time desc
      limit 1`,
    [md5, size, userId]
  );

  const row = rows?.[0];
  if (!row) return null;

  return {
    id: String(row.fileId),
    filename: row.file_name,
    type: row.file_suffix,
    size: Number(row.file_size),
    md5: row.md5,
    previewUrl: buildPreviewUrl(String(row.fileId)),
  };
}

/**
 * 刷新文件的 create_time，相当于给它「续期」。
 *
 * 复用时必须调一次：create_time 同时是后台回收任务的判据，
 * 秒传命中的很可能是一条传了很久、马上就要被当成孤儿回收的记录。
 * 不复用就续期的话，用户挂上附件、还没点发送，文件就被清理任务删了，
 * 报错发生在发送那一刻的 404 上，几乎不可能联想到是回收干的
 */
async function touchFile(fileId: string, userId: string): Promise<void> {
  await connection.query(
    'update file set create_time = ? where fileId = ? and create_by = ?',
    [getCurrentTime(), fileId, userId]
  );
}

/**
 * 找出可以回收的孤儿文件：上传后一直没有被任何消息引用、且已经超过保留时长的。
 *
 * 用 not exists 而不是 left join ... is null：语义更直接，且能直接命中
 * message_file 的 idx_file 索引（left join 的写法容易被优化成扫全表）
 */
async function findOrphanFiles(
  before: Date,
  limit: number
): Promise<Array<{ fileId: string; storagePath: string }>> {
  const [rows] = await connection.query<any[]>(
    `select f.fileId, f.storage_path
       from file f
      where f.create_time < ?
        and not exists (select 1 from message_file mf where mf.fileId = f.fileId)
      order by f.create_time asc
      limit ?`,
    [before, limit]
  );

  return (rows ?? []).map((row) => ({
    fileId: String(row.fileId),
    storagePath: row.storage_path,
  }));
}

/**
 * 彻底回收一个文件：记录 + 文本缓存 + 消息绑定。
 *
 * 与 deleteFileById 的区别是这里不带也不校验 userId，**仅供后台清理任务使用**：
 * 清理任务扫出来的是全库范围的孤儿，天然跨用户，逐条去要 userId 也无从取得。
 * 因此 fileId 必须来自可信来源（本文件的 findOrphanFiles）；
 * 凡是来自请求入参的 fileId，一律走 deleteFileById
 *
 * 返回是否真的删掉了一行——并发下（两次清理、或用户同时手动删）可能已经不存在了，
 * 调用方据此决定还要不要动磁盘
 */
async function purgeFileById(fileId: string): Promise<boolean> {
  const conn = await connection.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query<any>('delete from file where fileId = ?', [fileId]);
    const deleted = result?.affectedRows > 0;
    if (deleted) {
      await conn.query('delete from file_text where fileId = ?', [fileId]);
      await conn.query('delete from message_file where fileId = ?', [fileId]);
    }

    await conn.commit();
    return deleted;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * 按消息批量取附件，给前端渲染历史消息用。
 *
 * 没有复用 getAttachmentsByMessageIds：那个是给模型拼上下文的，会 join file_text
 * 把提取出的正文一起读出来。历史列表一次可能带几十条消息，每条都拖回一份
 * PDF 全文（MEDIUMTEXT）纯属白读——前端只需要文件名和体积
 */
async function getAttachmentDtosByMessageIds(
  messageIds: string[],
  userId: string
): Promise<Map<string, FileDTO[]>> {
  const grouped = new Map<string, FileDTO[]>();
  if (messageIds.length === 0) return grouped;

  // 次级排序键用 fileId：同一条消息里的多个附件是在一次 insert 里绑定的，
  // createTime 可能精确到同一毫秒，光靠它定不了顺序，渲染出来会随查询计划抖动。
  // 雪花ID 单调递增，能兜住并列——例外是秒传复用的老文件，它会按原始 fileId 排到前面
  const [rows] = await connection.query<any[]>(
    `select mf.messageId, f.fileId, f.file_name, f.file_suffix, f.file_size, f.md5
       from message_file mf
       join file f on f.fileId = mf.fileId
      where mf.messageId in (?) and f.create_by = ?
      order by mf.createTime asc, f.fileId asc`,
    [messageIds, userId]
  );

  for (const row of rows ?? []) {
    const list = grouped.get(row.messageId) ?? [];
    list.push({
      id: String(row.fileId),
      filename: row.file_name,
      type: row.file_suffix,
      size: Number(row.file_size),
      md5: row.md5,
      previewUrl: buildPreviewUrl(String(row.fileId)),
    });
    grouped.set(row.messageId, list);
  }
  return grouped;
}

export {
  saveUploadFile,
  getFileForOwner,
  deleteFileById,
  getFilesByUser,
  getFilesForOwner,
  bindFilesToMessage,
  getAttachmentsByMessageIds,
  getOrExtractFileText,
  findFileByFingerprint,
  touchFile,
  findOrphanFiles,
  purgeFileById,
  getAttachmentDtosByMessageIds,
};
