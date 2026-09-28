/**
 * 上传目录内文件的磁盘操作
 *
 * 抽出来是因为有两个调用方：请求链路上的删除（fileHandler.controller）和
 * 后台清理任务（fileCleanup.service）。两边都写一份的话，
 * 「删之前先确认路径在上传目录内」这条防御迟早只在一侧被记得
 */
import fs from 'node:fs/promises';
import fsExtra from 'node:fs';
import path from 'node:path';

import { UPLOAD_DIR } from '../config';

/**
 * 校验路径确实落在上传目录内。storage_path 是服务端自己写入的，正常不会越界，
 * 这里是纵深防御：万一库里的值被改过，也不至于变成任意文件删除/读取
 */
export function isInUploadDir(filePath: string): boolean {
  const relative = path.relative(UPLOAD_DIR, path.resolve(filePath));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * 尽力而为地删掉磁盘文件，失败只记日志。
 *
 * 刻意不抛：调用方要么处在「已经要返回错误」的路径上（再抛一次只会把真正的错因盖掉），
 * 要么是后台清理任务（一个文件删不掉不该让整轮清理中断）
 */
export async function removeFileQuietly(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    console.error('清理磁盘文件失败:', filePath, error);
  }
}

/**
 * 删磁盘文件，但先确认它在上传目录内。
 * 删除是不可逆操作，这一步不能省——库里的 storage_path 一旦被写坏（被注入、被手工改错），
 * 直接 unlink 就等于给了任意文件删除的能力
 */
export async function removeUploadedFile(filePath: string): Promise<void> {
  if (!isInUploadDir(filePath)) {
    console.error('拒绝删除上传目录之外的文件:', filePath);
    return;
  }
  if (!fsExtra.existsSync(filePath)) return;
  await removeFileQuietly(filePath);
}
