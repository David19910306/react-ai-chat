// 历史对话相关接口封装
import { request } from './request';

type Conversation = {
  conversationId: string;
  title: string;
  createTime: string;
  updateTime: string;
};

type ConversationMessage = {
  messageId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createTime: string;
};

// 游标指向「上一页最后一条」，原样回传给服务端即可取下一页
type ConversationCursor = {
  updateTime: string;
  conversationId: string;
};

type ConversationPage = {
  conversations: Conversation[];
  // 为 null 表示没有下一页了
  nextCursor: ConversationCursor | null;
};

// 会话列表（最近活跃在前，游标分页）
export async function listConversationsApi(options?: {
  limit?: number;
  cursor?: ConversationCursor | null;
}): Promise<ConversationPage> {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) params.set('limit', String(options.limit));
  if (options?.cursor) {
    params.set('cursorTime', options.cursor.updateTime);
    params.set('cursorId', options.cursor.conversationId);
  }

  const query = params.toString();
  return request<ConversationPage>(`/conversations${query ? `?${query}` : ''}`);
}

// 某会话的全部消息
export async function getConversationMessagesApi(conversationId: string): Promise<ConversationMessage[]> {
  const data = await request<{ messages: ConversationMessage[] }>(
    `/conversations/${encodeURIComponent(conversationId)}/messages`
  );
  return data.messages;
}

// 删除会话及其消息
export async function deleteConversationApi(conversationId: string): Promise<void> {
  await request<{ message: string }>(`/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'DELETE',
  });
}

export type { Conversation, ConversationCursor, ConversationMessage, ConversationPage };
