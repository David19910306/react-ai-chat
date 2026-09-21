import type { Request, Response } from "express";
import crypto from 'crypto';
import fsExtra from 'fs';
import fs from 'fs/promises';
import { saveUploadFile, queryFilePathById, getAllFiles, type fileOptions, deleteFileById } from "../services/file.service";

// 计算上传文件的md5
function getFilesMD5(uploadFiles: Express.Multer.File[] | undefined) {
  return Promise.all(uploadFiles?.map(async (file: Express.Multer.File) => {
    const md5 = await new Promise((resolve, reject) => {
      const filePath = file.path;
      const hash = crypto.createHash('md5');
      // 创建文件可读流，流式计算，不会一次性读全部文件进内存
      const stream = fsExtra.createReadStream(filePath);
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
  res.setHeader('Content-Type', 'multipart/form-data');
  const dataSource = (req.files as Express.Multer.File[])?.map((file: Express.Multer.File) => {
    const md5 = md5Array.find((_md5: {md5: unknown, filename: string}) => _md5.filename === file.originalname)?.md5 ?? '';
    const filename = Buffer.from(file.originalname, 'binary').toString('utf8');
    return {
      ...file,
      userId,
      md5,
      originalname: filename,
    }
  }) ?? []
  try {
    const fileIds = await Promise.all(dataSource.map((data: fileOptions) => {
      return saveUploadFile(data);
    }));
    res.status(200).json({ 
      message: '文件上传成功', 
      uploadedFiles: dataSource.map((data: fileOptions, index: number) => {
      return {
        previewUrl: `uploadFiles/${data.originalname}`,
        filename: data.originalname,
        type: data.originalname.split('.')[1],
        md5: data.md5,
        id: fileIds[index],
        filePath: data.path,
      }
    }) 
  });
  }catch (error: any) {
    res.status(500).json({ message: error instanceof Error? error.message: error })
  }finally {
    res.end();
  }
}

async function deleteFile(req: Request, res: Response) {
  const { fileId } = req.params;
  try {
    // 1、根据文件id查询存储路径
    const filePath = await queryFilePathById(fileId as string);
    // 2、通过存储路径使用fs.unlink删除文件
    if (fsExtra.existsSync(filePath)) {
      await fs.unlink(filePath);
      console.log('磁盘文件删除成功');
      // 3、删除数据库里的记录
      const result = await deleteFileById(fileId as string);
      if (result) {
        res.status(200).json({ code: 200, message: '删除成功', data: true, });
      }
    }
  } catch (error) {
    res.status(500).json({ code: 500, data: false, message: '删除失败：' + error, });
  } finally {
    res.end();
  }
}

async function queryFiles(_: Request, res: Response) {
  try {
    const fileList = await getAllFiles();
    if (Array.isArray(fileList)) {
      res.status(200).json({
        code: 200,
        data: fileList,
        message: '查询成功',
      })
    }
  } catch (error) {
    res.status(500).json({ code: 500, data: undefined, message: '查询失败：' + error, });
  } finally {
    res.end();
  }
}

export {
  UploadFiles,
  deleteFile,
  queryFiles,
}