import type { Request, Response } from "express";
import crypto from 'node:crypto';
import fsExtra from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { IMAGE_CONTENT_TYPE, UPLOAD_DIR } from "../config";
import {
  saveUploadFile,
  getFileForOwner,
  getFilesByUser,
  deleteFileById,
  type FileDTO,
} from "../services/file.service";

/**
 * 流式计算文件 md5，不一次性把文件读进内存。
 * 按 filePath 而不是 originalname 计算：同一批里传两个同名文件时，
 * 按原名回查会把两份 md5 串错，落库的校验值直接失效
 */
function getFileMD5(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fsExtra.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// 尽力而为地删掉磁盘文件，失败只记日志：调用方都处在「已经要返回错误」的路径上，
// 再抛一次只会把真正的错因盖掉
async function removeFileQuietly(filePath: string) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    console.error('清理磁盘文件失败:', filePath, error);
  }
}

// 校验路径确实落在上传目录内。storage_path 是服务端自己写入的，正常不会越界，
// 这里是纵深防御：万一库里的值被改过，也不至于变成任意文件读取
function isInUploadDir(filePath: string): boolean {
  const relative = path.relative(UPLOAD_DIR, path.resolve(filePath));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function UploadFiles(req: Request, res: Response) {
  const userId = req.user?.userId;
  const files = (req.files as Express.Multer.File[]) ?? [];

  // 理论上 token 中间件已经拦掉了，但这里必须再挡一道：
  // userId 为空会让记录的 create_by 变成空串，等于这批文件谁都能查到、谁都能删
  if (!userId) {
    await Promise.all(files.map((file) => removeFileQuietly(file.path)));
    return res.status(401).json({ message: '未携带认证令牌' });
  }
  if (files.length === 0) {
    return res.status(400).json({ message: '未接收到文件' });
  }

  try {
    const uploadedFiles: FileDTO[] = [];
    for (const file of files) {
      const md5 = await getFileMD5(file.path);
      uploadedFiles.push(await saveUploadFile({
        // 落盘名是随机 UUID，原名由 multer 的 fileFilter 解码后挂在这里（见 file.router.ts）
        originalname: file.originalname,
        mimetype: file.mimetype,
        path: file.path,
        size: file.size,
        md5,
        userId,
      }));
    }
    res.status(200).json({ message: '文件上传成功', uploadedFiles });
  } catch (error) {
    // 入库失败就把已落盘的文件清掉，否则磁盘上会留下一批没有任何记录指向的孤儿文件
    await Promise.all(files.map((file) => removeFileQuietly(file.path)));
    console.error('文件入库失败:', error);
    res.status(500).json({ message: '文件上传失败' });
  }
}

async function deleteFile(req: Request, res: Response) {
  const userId = req.user?.userId;
  // Express 5 的 params 类型含 string[]（通配符路由会给出数组），本路由是单段参数，收窄成 string
  const fileId = typeof req.params.fileId === 'string' ? req.params.fileId : '';

  if (!userId) return res.status(401).json({ message: '未携带认证令牌' });
  if (!fileId) return res.status(400).json({ message: '缺少 fileId' });

  try {
    // 先按「归属人」取记录：不存在和不属于当前用户都返回 404，
    // 不区分两者，避免让调用方靠状态码探测出某个 fileId 是否存在
    const file = await getFileForOwner(fileId, userId);
    if (!file) {
      return res.status(404).json({ code: 404, data: false, message: '文件不存在' });
    }

    // 先删库再删盘：反过来的话，磁盘删成功而删库失败会留下一条指向空文件的记录，
    // 列表里能看到、点开是 404，比单纯残留一个磁盘文件更难解释
    const deleted = await deleteFileById(fileId, userId);
    if (!deleted) {
      return res.status(404).json({ code: 404, data: false, message: '文件不存在' });
    }
    if (isInUploadDir(file.storagePath) && fsExtra.existsSync(file.storagePath)) {
      await removeFileQuietly(file.storagePath);
    }

    res.status(200).json({ code: 200, data: true, message: '删除成功' });
  } catch (error) {
    console.error('文件删除失败:', error);
    res.status(500).json({ code: 500, data: false, message: '删除失败' });
  }
}

async function queryFiles(req: Request, res: Response) {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: '未携带认证令牌' });

  try {
    const fileList = await getFilesByUser(userId);
    res.status(200).json({ code: 200, data: fileList, message: '查询成功' });
  } catch (error) {
    console.error('文件列表查询失败:', error);
    res.status(500).json({ code: 500, data: [], message: '查询失败' });
  }
}

/**
 * 文件预览/下载。取代原先 express.static 直接托管 uploadFiles 目录的做法——
 * 那条路由既不鉴权、路径又是可猜的原文件名，等于任何人都能遍历下载别人的文件。
 */
async function previewFile(req: Request, res: Response) {
  const userId = req.user?.userId;
  const fileId = typeof req.params.fileId === 'string' ? req.params.fileId : '';

  if (!userId) return res.status(401).json({ message: '未携带认证令牌' });
  if (!fileId) return res.status(400).json({ message: '缺少 fileId' });

  try {
    const file = await getFileForOwner(fileId, userId);
    if (!file || !isInUploadDir(file.storagePath) || !fsExtra.existsSync(file.storagePath)) {
      return res.status(404).json({ message: '文件不存在' });
    }

    /**
     * Content-Type 按库里的后缀推导，不用浏览器上传时声明的 mime_type——后者是客户端可控的，
     * 声明成 text/html 就能让上传的文件在本站域下被当成页面渲染（存储型 XSS）。
     * 只有图片内联展示，其余一律 attachment 强制下载；再配 nosniff 阻止浏览器猜类型。
     */
    const contentType = IMAGE_CONTENT_TYPE[file.suffix];
    const disposition = contentType ? 'inline' : 'attachment';
    // filename* 用 RFC 5987 编码，中文名才不会在下载时变成乱码
    const encodedName = encodeURIComponent(file.fileName);

    res.setHeader('Content-Type', contentType ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodedName}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    res.sendFile(file.storagePath, (error) => {
      // 发送过程中出错时响应头多半已经 flush 了，改不了状态码，只能记日志并断开
      if (error) {
        console.error('文件发送失败:', file.storagePath, error);
        if (!res.headersSent) res.status(500).json({ message: '文件读取失败' });
        else res.end();
      }
    });
  } catch (error) {
    console.error('文件预览失败:', error);
    res.status(500).json({ message: '文件读取失败' });
  }
}

export {
  UploadFiles,
  deleteFile,
  queryFiles,
  previewFile,
}
