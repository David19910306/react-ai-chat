import express from 'express';
import { sseHandler } from '../controller/sse.controller';
import { chatLimiter } from '../middleware/rateLimit.middleware';

const router = express.Router();

// chatLimiter 按 userId 计数，依赖全局 token 中间件已经填好 req.user
router.post('/api/sse/chat', chatLimiter, sseHandler);
export default router;
