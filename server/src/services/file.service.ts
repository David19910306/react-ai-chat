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

/** 删除记录。返回是否真的删掉了一行，调用方据此区分 404 */
async function deleteFileById(fileId: string, userId: string): Promise<boolean> {
  // mysql2 的 query 返回 [result, fields]，DELETE 的 result 本身就是 ResultSetHeader。
  // 之前写成 result[0].affectedRows 多取了一层，永远是 undefined，删除接口从来没返回过成功
  const [result] = await connection.query<any>(
    'delete from file where fileId = ? and create_by = ?',
    [fileId, userId]
  );
  return result?.affectedRows > 0;
}

/** 当前用户的文件列表 */
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

export { saveUploadFile, getFileForOwner, deleteFileById, getFilesByUser };
