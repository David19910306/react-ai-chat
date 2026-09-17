import express from "express";
import { addUser, loginUser } from "../controller/use.controller";
import { authLimiter } from "../middleware/rateLimit.middleware";

const router = express.Router();

// 这两个是唯一不需要 token 的入口，加上更严格的限流防密码爆破
router.post('/api/add/user', authLimiter, addUser);
router.post('/api/login/user', authLimiter, loginUser);

export default router;
