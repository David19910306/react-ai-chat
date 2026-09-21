import express from 'express';
import multer from 'multer';
import { UploadFiles, deleteFile, queryFiles, } from '../controller/fileHandler.controller';
import { UPLOAD_DIR } from '../config';

const router = express.Router();
const storage = multer.diskStorage({
  destination: (_, file: Express.Multer.File, callback: (error: Error | null, destination: string) => void) => {
    callback(null, UPLOAD_DIR)
  },
  filename: (_, file: Express.Multer.File, callback: (error: Error | null, destination: string) => void) => {
    const filename = Buffer.from(file.originalname, 'binary').toString('utf8'); // 防止文件中文名称乱码
    callback(null, filename)
  },
})
const upload = multer({ storage, });

router.post('/api/file/upload', upload.any(), UploadFiles);
router.delete('/api/file/delete/:fileId', deleteFile);
router.get('/api/file/lists', queryFiles);

export default router;