import { Snowflake } from "@theinternetfolks/snowflake";
import { getCurrentTime } from "../utils";
import connection from "./dbPool.service";

export type fileOptions = {
  originalname: string;
  mimetype: string;
  path: string;
  size: number;
  md5: unknown;
  userId: string | undefined;
  [key: string]: any;
}

async function saveUploadFile (fileOptions: fileOptions): Promise<string> {
  const {
    originalname, mimetype, path, size, md5, userId = '',
  } = fileOptions;
  const fileId = String(Snowflake.generate());
  const suffix = originalname.split('.')[1];
  const createTime = getCurrentTime();
  const previewUrl = `uploadFiles/${originalname}`;

  await connection.query(
    `insert into file(fileId, file_name, file_suffix, mime_type, file_size, storage_path, previewUrl, md5, create_by, create_time)
      values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [fileId, originalname, suffix, mimetype, size, path, previewUrl, md5, userId, createTime]
  );

  return fileId;
}

async function queryFilePathById(fileId: string) {
  const querySql = `select file.storage_path from file where file.fileId = ${fileId}`;
  const [filePath] : any = await connection.query(querySql);
  return filePath?.[0].storage_path;
}

async function deleteFileById(fileId: string): Promise<boolean> {
  const deleteSql = `delete from file where fileId = ${fileId}`;
  try {
    const [result]: any = await connection.query(deleteSql);
    if (result?.[0]?.affectedRows === 1) {
      return true;
    }
    return false;
  } catch (error) {
    console.log('删除报错: ' + error);
    return false;
  }
}

async function getAllFiles() {
  const querySql = 'select * from file';
  try {
    const [queryList]: any = await connection.query(querySql);
    return queryList.map((file: any) => ({
      ...file,
      filename: file.file_name,
      type: file.file_suffix,
      id: file.fileId,
      filePath: file.storage_path,
    }));
  } catch (error) {
    console.log('查询出错: ' + error);
    return;
  }
}

export { saveUploadFile, queryFilePathById, deleteFileById, getAllFiles };