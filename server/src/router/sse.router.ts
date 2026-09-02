import express from 'express';
import { sseHandler } from '../controller/sse.controller';

const router = express.Router();

router.post('/api/sse/chat', sseHandler);
export default router;