/**
 * 历史对话接口：会话列表 / 会话消息 / 删除会话
 * 认证由全局 token 中间件完成，这里只负责取 req.user 并把 userId 传进 service
 */
import { type Request, type Response } from "express";

import {
  deleteConversation,
  getMessages,
  isOwnConversation,
  listConversations,
  type ConversationCursor,
} from "../services/conversation.service";

type ConversationParams = { conversationId: string };

/*************  会话列表（游标分页）  ***************/
async function listConversationsHandler(req: Request, res: Response) {
  const userId = req.user?.userId;
  if (!userId) {
    return res.status(401).json({ message: '未携带认证令牌' });
  }

  const { limit, cursorTime, cursorId } = req.query;

  // 游标两个字段必须成对出现，只传一个是调用方的 bug，早点报错好过静默从头返回
  if (Boolean(cursorTime) !== Boolean(cursorId)) {
    return res.status(400).json({ message: '游标参数不完整' });
  }

  let cursor: ConversationCursor | undefined;
  if (cursorTime && cursorId) {
    // 游标由客户端原样回传，必须校验，否则会直接拼进 SQL 的日期比较
    const parsedTime = new Date(String(cursorTime));
    if (Number.isNaN(parsedTime.getTime())) {
      return res.status(400).json({ message: '游标参数无效' });
    }
    cursor = { updateTime: parsedTime, conversationId: String(cursorId) };
  }

  // limit 不合法时由 service 回落到默认值，不在这里单独报错
  const page = await listConversations(userId, {
    limit: limit === undefined ? undefined : Number(limit),
    cursor,
  });
  res.status(200).json(page);
}

/*************  某会话的消息  ***************/
async function getMessagesHandler(req: Request<ConversationParams>, res: Response) {
  const userId = req.user?.userId;
  if (!userId) {
    return res.status(401).json({ message: '未携带认证令牌' });
  }

  const { conversationId } = req.params;
  // 不区分「不存在」和「不属于当前用户」，避免被用来探测他人的会话ID
  if (!(await isOwnConversation(conversationId, userId))) {
    return res.status(404).json({ message: '会话不存在' });
  }

  // userId 也传进去：查询自身带上归属条件，不依赖上面那次校验一直记得做
  const messages = await getMessages(conversationId, userId);
  res.status(200).json({ messages });
}

/*************  删除会话及消息  ***************/
async function deleteConversationHandler(req: Request<ConversationParams>, res: Response) {
  const userId = req.user?.userId;
  if (!userId) {
    return res.status(401).json({ message: '未携带认证令牌' });
  }

  const deleted = await deleteConversation(req.params.conversationId, userId);
  if (!deleted) {
    return res.status(404).json({ message: '会话不存在' });
  }

  res.status(200).json({ message: '删除成功' });
}

export {
  listConversationsHandler,
  getMessagesHandler,
  deleteConversationHandler,
}
