import express, { type NextFunction, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import multer from 'multer';

import { UploadFiles, deleteFile, queryFiles, previewFile } from '../controller/fileHandler.controller';
import {
  UPLOAD_DIR,
  UPLOAD_ALLOWED_SUFFIXES,
  UPLOAD_MAX_FILES,
  UPLOAD_MAX_FILE_SIZE,
} from '../config';
import { decodeOriginalName, getSuffix } from '../utils';

const router = express.Router();

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, UPLOAD_DIR),
  filename: (_req, file, callback) => {
    /**
     * 落盘名一律用随机 UUID，不用 originalname，原名只存库：
     * 1、原名相同的文件会互相覆盖——两个人各传一份「报告.pdf」，后传的直接顶掉先传的
     * 2、原名可枚举，谁都能猜出路径
     * 后缀保留，方便直接在服务器上看文件、也让 sendFile 的类型推导有依据
     */
    const suffix = getSuffix(decodeOriginalName(file.originalname));
    callback(null, suffix ? `${crypto.randomUUID()}.${suffix}` : crypto.randomUUID());
  },
});

const upload = multer({
  storage,
  limits: { fileSize: UPLOAD_MAX_FILE_SIZE, files: UPLOAD_MAX_FILES },
  fileFilter: (_req, file, callback) => {
    // 顺带把 originalname 就地解码成 utf8：后续 controller、service 都直接用这个值，
    // 不必各自再 Buffer.from 一次（之前 router 和 controller 各解了一遍）
    file.originalname = decodeOriginalName(file.originalname);

    if (!UPLOAD_ALLOWED_SUFFIXES.has(getSuffix(file.originalname))) {
      // 传 Error 而不是 callback(null, false)：静默丢弃会让前端以为上传成功了
      callback(new Error(`不支持的文件类型：${file.originalname}`));
      return;
    }
    callback(null, true);
  },
});

/**
 * multer 的错误转成 400。
 * 四个参数才会被 Express 认成错误处理中间件，只在 upload 出错时进来，正常请求会跳过它。
 * 不加的话超限/类型不符会一路落到全局 ErrorMiddleWare，返回「服务器内部错误」500，
 * 用户看不出是自己文件太大，还以为是服务挂了
 */
function handleUploadError(err: unknown, _req: Request, res: Response, next: NextFunction) {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE' ? `文件大小不能超过 ${UPLOAD_MAX_FILE_SIZE / 1024 / 1024}MB`
      : err.code === 'LIMIT_FILE_COUNT' ? `一次最多上传 ${UPLOAD_MAX_FILES} 个文件`
      : err.code === 'LIMIT_UNEXPECTED_FILE' ? '文件字段名不正确'
      : '文件上传失败';
    return res.status(400).json({ message });
  }
  if (err instanceof Error) {
    return res.status(400).json({ message: err.message });
  }
  next(err);
}

// 用 array('file') 而不是 any()：any 会照单全收任意字段名的文件，
// 字段名约定坏掉时反而不报错，问题被推迟到更难查的地方
router.post('/api/file/upload', upload.array('file', UPLOAD_MAX_FILES), handleUploadError, UploadFiles);
router.get('/api/file/preview/:fileId', previewFile);
router.delete('/api/file/delete/:fileId', deleteFile);
router.get('/api/file/lists', queryFiles);

export default router;
