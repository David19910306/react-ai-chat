import express from "express";
import { addUser, loginUser } from "../controller/use.controller";

const router = express.Router();

router.post('/api/add/user', addUser);
router.post('/api/login/user', loginUser);

export default router;