import express from "express";
import {
  deleteConversationHandler,
  getMessagesHandler,
  listConversationsHandler,
} from "../controller/conversation.controller";

const router = express.Router();

router.get('/api/conversations', listConversationsHandler);
router.get('/api/conversations/:conversationId/messages', getMessagesHandler);
router.delete('/api/conversations/:conversationId', deleteConversationHandler);

export default router;
