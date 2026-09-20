import type { Request, Response } from "express";
import crypto from 'crypto';
import fs from 'fs';
import { saveUploadFile, type fileOptions } from "../services/upload.service";

// 计算上传文件的md5
function getFilesMD5(uploadFiles: Express.Multer.File[] | undefined) {
  return Promise.all(uploadFiles?.map(async (file: Express.Multer.File) => {
    const md5 = await new Promise((resolve, reject) => {
      const filePath = file.path;
      const hash = crypto.createHash('md5');
      // 创建文件可读流，流式计算，不会一次性读全部文件进内存
      const stream = fs.createReadStream(filePath);
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', ()=> resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
    return {md5, filename: file.originalname};
  }) ?? []);
}

async function UploadFiles (req: Request, res: Response) {
  const userId = req.user?.userId;
  const md5Array = await getFilesMD5(req.files as Express.Multer.File[]);
  // console.log(md5Array, req.files, 'req');
  res.setHeader('Content-Type', 'text/html');
  const dataSource = (req.files as Express.Multer.File[])?.map((file: Express.Multer.File) => {
    const md5 = md5Array.find((_md5: {md5: unknown, filename: string}) => _md5.filename === file.originalname)?.md5 ?? '';
    return {
      ...file,
      userId,
      md5,
    }
  }) ?? []
  try {
    await Promise.all(dataSource.map((data: fileOptions) => {
      return saveUploadFile(data);
    }));
    res.status(200).json({ 
      message: '文件上传成功', 
      uploadedFiles: dataSource.map((data: fileOptions) => {
      return {
        previewUrl: `/uploadFiles/${data.originalname}`,
        filename: data.originalname,
      }
    }) 
  });
  }catch (error: any) {
    res.status(500).json({ message: error instanceof Error? error.message: error })
  }
}

export {
  UploadFiles,
}