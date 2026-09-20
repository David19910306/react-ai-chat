import express from 'express';
import multer from 'multer';
import { UploadFiles } from '../controller/upload.controller';
import { UPLOAD_DIR } from '../config';

const router = express.Router();
const storage = multer.diskStorage({
  destination: (_, file: Express.Multer.File, callback: (error: Error | null, destination: string) => void) => {
    callback(null, UPLOAD_DIR)
  },
  filename: (_, file: Express.Multer.File, callback: (error: Error | null, destination: string) => void) => {
    callback(null, file.originalname)
  }
})
const upload = multer({ storage, });

router.post('/api/file/upload', upload.any(), UploadFiles);

export default router;