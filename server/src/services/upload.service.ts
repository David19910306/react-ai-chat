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

  await connection.query(
    `insert into file(fileId, file_name, file_suffix, mime_type, file_size, storage_path, md5, create_by, create_time)
      values(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [fileId, originalname, suffix, mimetype, size, path, md5, userId, createTime]
  );

  return fileId;
}

export { saveUploadFile };