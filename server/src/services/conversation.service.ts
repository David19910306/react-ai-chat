/**
 * 会话与消息的持久化
 *
 * 两条硬性约束：
 * 1、所有 SQL 一律使用参数化查询，避免 SQL 注入
 * 2、所有查询都必须带上 userId 条件，否则 conversationId 一旦泄漏就能读到别人的对话（越权）
 */
import { Snowflake } from '@theinternetfolks/snowflake';

import connection from './dbPool.service';

// 送进模型的上下文消息条数上限，用来兜住 token 开销
const CONTEXT_MESSAGE_LIMIT = 20;
// 侧边栏默认每页返回的会话数
const CONVERSATION_PAGE_SIZE = 30;
// 单页上限，防止调用方传个巨大的 limit 把库拖垮
const CONVERSATION_PAGE_MAX = 100;
// 会话标题长度上限
const TITLE_MAX_LENGTH = 30;

type Role = 'user' | 'assistant' | 'system';

type MessageRow = {
  messageId: string;
  conversationId: string;
  userId: string;
  role: Role;
  content: string;
  createTime: Date;
};

type ConversationRow = {
  conversationId: string;
  title: string;
  createTime: Date;
  updateTime: Date;
};

// 游标：指向「上一页最后一条」，下一页从它之后继续取
type ConversationCursor = {
  updateTime: Date;
  conversationId: string;
};

type ConversationPage = {
  conversations: ConversationRow[];
  nextCursor: ConversationCursor | null;
};

// 取首条用户消息生成标题。用 Array.from 按码点截断，避免把 emoji 的代理对切成半个字符
function buildTitle(content: string): string {
  const chars = Array.from(content.trim());
  if (chars.length <= TITLE_MAX_LENGTH) return chars.join('');
  return chars.slice(0, TITLE_MAX_LENGTH).join('') + '…';
}

// 把外部传入的每页条数收敛到 [1, CONVERSATION_PAGE_MAX]；
// 非数字（NaN / Infinity / undefined）一律回落到默认值，避免拼进 SQL 变成意外值
function normalizePageSize(raw?: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return CONVERSATION_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(raw), 1), CONVERSATION_PAGE_MAX);
}

/*************  校验会话是否属于该用户  ***************/
async function isOwnConversation(conversationId: string, userId: string): Promise<boolean> {
  const [rows] = await connection.query(
    'select 1 from conversation where conversationId = ? and userId = ? limit 1',
    [conversationId, userId]
  );
  return (rows as unknown[]).length > 0;
}

/*************  新建会话，返回会话ID  ***************/
async function createConversation(userId: string, content: string): Promise<string> {
  const conversationId = String(Snowflake.generate());
  await connection.query(
    'insert into conversation(conversationId, userId, title) values(?, ?, ?)',
    [conversationId, userId, buildTitle(content)]
  );
  return conversationId;
}

/*************  写入一条消息，并刷新会话的活跃时间  ***************/
async function insertMessage(params: {
  conversationId: string;
  userId: string;
  role: Role;
  content: string;
}): Promise<string> {
  const { conversationId, userId, role, content } = params;
  const messageId = String(Snowflake.generate());

  await connection.query(
    'insert into message(messageId, conversationId, userId, role, content) values(?, ?, ?, ?, ?)',
    [messageId, conversationId, userId, role, content]
  );
  // 显式刷新：会话列表按 updateTime 倒序，靠它把刚聊过的会话顶到最前。
  // 插入 message 不会 UPDATE conversation 行，所以列的 ON UPDATE 子句在这里不会触发
  await connection.query(
    'update conversation set updateTime = now(3) where conversationId = ? and userId = ?',
    [conversationId, userId]
  );

  return messageId;
}

/*************  当前用户的会话列表（最近活跃在前，游标分页）  ***************/
async function listConversations(
  userId: string,
  options: { limit?: number; cursor?: ConversationCursor | null } = {}
): Promise<ConversationPage> {
  const pageSize = normalizePageSize(options.limit);
  const { cursor } = options;

  // 多取一条用来判断还有没有下一页，返回前丢掉
  const fetchSize = pageSize + 1;

  // 用游标（keyset）而不是 offset 分页：会话列表按 updateTime 倒序，而每发一条消息都会把
  // 会话顶到最前——排序键会在翻页途中变化，offset 分页会因此重复或漏掉记录。
  //
  // 排序带上 conversationId 作为次级键：updateTime 是 DATETIME(3)，同一毫秒更新的两个会话
  // 光靠它分不出先后，顺序不稳定；雪花ID 单调递增，可以兜住并列。
  // 这一列不用单独建索引：InnoDB 的二级索引会隐式追加主键，
  // idx_user_update(userId, updateTime) 的实际键序已经是 (userId, updateTime, conversationId)。
  const sql = cursor
    ? `select conversationId, title, createTime, updateTime
       from conversation
       where userId = ? and (updateTime, conversationId) < (?, ?)
       order by updateTime desc, conversationId desc
       limit ?`
    : `select conversationId, title, createTime, updateTime
       from conversation
       where userId = ?
       order by updateTime desc, conversationId desc
       limit ?`;
  const params = cursor
    ? [userId, cursor.updateTime, cursor.conversationId, fetchSize]
    : [userId, fetchSize];

  const [rows] = await connection.query(sql, params);
  const all = rows as ConversationRow[];

  const hasMore = all.length > pageSize;
  const conversations = hasMore ? all.slice(0, pageSize) : all;
  const last = conversations[conversations.length - 1];

  return {
    conversations,
    nextCursor: hasMore && last
      ? { updateTime: last.updateTime, conversationId: last.conversationId }
      : null,
  };
}

/*************  某会话的全部消息（时间正序）。userId 用于兜住越权  ***************/
async function getMessages(conversationId: string, userId: string): Promise<MessageRow[]> {
  const [rows] = await connection.query(
    'select messageId, conversationId, userId, role, content, createTime from message where conversationId = ? and userId = ? order by createTime asc, messageId asc',
    [conversationId, userId]
  );
  return rows as MessageRow[];
}

/*************  取最近 N 条作为模型上下文  ***************/
async function getRecentMessagesForContext(
  conversationId: string,
  userId: string
): Promise<Pick<MessageRow, 'messageId' | 'role' | 'content'>[]> {
  // SQL 里按时间倒序 + limit 取「最近 N 条」，再翻回正序才是模型要求的对话顺序
  // messageId 一并取出，供调用方在遇到非法 role 时能定位到具体是哪条数据
  const [rows] = await connection.query(
    'select messageId, role, content from message where conversationId = ? and userId = ? order by createTime desc, messageId desc limit ?',
    [conversationId, userId, CONTEXT_MESSAGE_LIMIT]
  );
  return (rows as Pick<MessageRow, 'messageId' | 'role' | 'content'>[]).reverse();
}

/*************  删除会话及其消息（事务保证不留孤儿消息）  ***************/
async function deleteConversation(conversationId: string, userId: string): Promise<boolean> {
  const conn = await connection.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      'delete from message where conversationId = ? and userId = ?',
      [conversationId, userId]
    );
    const [result]: any = await conn.query(
      'delete from conversation where conversationId = ? and userId = ?',
      [conversationId, userId]
    );

    await conn.commit();
    // affectedRows 为 0 说明会话不存在或不属于该用户
    return result.affectedRows > 0;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export {
  CONTEXT_MESSAGE_LIMIT,
  buildTitle,
  createConversation,
  deleteConversation,
  getMessages,
  getRecentMessagesForContext,
  insertMessage,
  isOwnConversation,
  listConversations,
  type ConversationCursor,
  type ConversationPage,
  type ConversationRow,
  type MessageRow,
  type Role,
};
