import type { Request, Response } from "express";
import crypto from 'node:crypto';
import fsExtra from 'node:fs';

import { IMAGE_CONTENT_TYPE } from "../config";
import {
  saveUploadFile,
  getFileForOwner,
  getFilesByUser,
  deleteFileById,
  findFileByFingerprint,
  touchFile,
  type FileDTO,
} from "../services/file.service";
import { isInUploadDir, removeUploadedFile } from "../utils/file";

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

async function UploadFiles(req: Request, res: Response) {
  const userId = req.user?.userId;
  const files = (req.files as Express.Multer.File[]) ?? [];

  // 理论上 token 中间件已经拦掉了，但这里必须再挡一道：
  // userId 为空会让记录的 create_by 变成空串，等于这批文件谁都能查到、谁都能删
  if (!userId) {
    await Promise.all(files.map((file) => removeUploadedFile(file.path)));
    return res.status(401).json({ message: '未携带认证令牌' });
  }
  if (files.length === 0) {
    return res.status(400).json({ message: '未接收到文件' });
  }

  try {
    const uploadedFiles: FileDTO[] = [];
    for (const file of files) {
      const md5 = await getFileMD5(file.path);

      /**
       * 服务端自己算一遍再判重，而不是信任前端传上来的 md5。
       *
       * 前端那份 md5 只是为了「省流量」的建议（在本地算完先问一句，命中就不传了），
       * 客户端可以伪造、也可能算错，真正决定复不复用得由这里的哈希说话。
       * 前端算对了会走 /api/file/check 直接命中，根本到不了这里；
       * 所以这段是兜底——前端没算、算错、或换了个客户端上来重复传，都能收口到同一份文件。
       */
      const existing = await findFileByFingerprint({ md5, size: file.size, userId });
      if (existing) {
        // 刚落盘的这份是多余的，删掉复用已有记录。
        // 复用还顺带保住了这条记录的 file_text 解析缓存，文档不必重新解析一遍
        await removeUploadedFile(file.path);
        // 续期：见 file.service 里 touchFile 的说明，不续期会被回收任务盯上
        await touchFile(existing.id, userId);
        uploadedFiles.push(existing);
        continue;
      }

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
    // 入库失败就把已落盘的文件清掉，否则磁盘上会留下一批没有任何记录指向的孤儿文件。
    // 这里用 removeUploadedFile 而不是直接 unlink：走到这一步时，
    // 前面已经判重删掉的那几个文件不在磁盘上了，unlink 会抛 ENOENT 把真正的错因盖掉
    await Promise.all(files.map((file) => removeUploadedFile(file.path)));
    console.error('文件入库失败:', error);
    res.status(500).json({ message: '文件上传失败' });
  }
}

/**
 * 秒传探测：客户端先在本地算出文件 md5，拿它来问「这个文件我是不是已经传过了」。
 * 命中就不必再传文件内容——20MB 的 PDF 只发一个 32 字节的指纹过去。
 *
 * 前端算的 md5 在这里只是查询条件，不产生任何写入，所以不担心被伪造；
 * 真正的判重兜底在 UploadFiles 里
 */
async function checkInstantUpload(req: Request, res: Response) {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: '未携带认证令牌' });

  const { md5, size } = req.body ?? {};
  const sizeNumber = Number(size);

  // 先校验格式再查库。参数化已经挡住了注入，但格式不对说明调用方有 bug，
  // 直接返回一个明确的 400 比让它静默查不到、白跑一次全量上传要好
  if (typeof md5 !== 'string' || !/^[a-f0-9]{32}$/i.test(md5) || !Number.isFinite(sizeNumber)) {
    return res.status(400).json({ message: '参数不合法' });
  }

  try {
    // 库里存的是 crypto digest('hex') 的小写形式，大小写统一后再比，
    // 免得客户端用大写十六进制算出来的 md5 永远命中不了
    const normalized = md5.toLowerCase();
    const file = await findFileByFingerprint({ md5: normalized, size: sizeNumber, userId });
    if (file) await touchFile(file.id, userId);

    res.status(200).json({ code: 200, data: { exists: Boolean(file), file: file ?? null } });
  } catch (error) {
    console.error('秒传校验失败:', error);
    // 探测失败时返回 exists:false，让客户端老老实实走完整上传。
    // 这里不返回 5xx：秒传只是一个优化，它挂了不该让用户连文件都传不上去
    res.status(200).json({ code: 200, data: { exists: false, file: null } });
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
    await removeUploadedFile(file.storagePath);

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
    // isInUploadDir 是纵深防御：storage_path 由服务端自己写入，正常不会越界，
    // 但万一库里的值被改过，这里不能再无条件 sendFile
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
  checkInstantUpload,
  deleteFile,
  queryFiles,
  previewFile,
}
