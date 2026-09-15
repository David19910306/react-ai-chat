import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, App as AntdApp } from 'antd';
import {
  ListClockIcon,
  LoaderCircleIcon,
  LogOutIcon,
  MessageSquareIcon,
  PlusIcon,
  SendHorizonalIcon,
  SparklesIcon,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import ThemeToggle from '@/components/ThemeToggle';
import useFetchSSE from '@/hooks/useSSE';
import { clearToken, getCurrentUser, getToken } from '@/utils/auth';
import {
  getConversationMessagesApi,
  listConversationsApi,
  type Conversation,
  type ConversationCursor,
} from '@/api/chat';

import './index.less';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
};

const createId = () =>
  typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : String(Date.now());

export default function Home() {
  const navigate = useNavigate();
  const { notification } = AntdApp.useApp();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // SSE 累积的回复内容：用 ref 保存，避免跨渲染丢失；每次发送前必须重置
  const assistantReplyRef = useRef('');

  const [currentBtn, setCurrentBtn] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [value, setValue] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  // 会话列表游标分页：nextCursor 为 null 表示已经到底
  const [nextCursor, setNextCursor] = useState<ConversationCursor | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // 侧边栏底部展示的登录用户：从 token 解析，刷新页面后依然可用
  const user = useMemo(() => getCurrentUser(), []);
  const username = user?.username ?? '未登录用户';
  // 无头像字段，取用户名首字符作为头像文案（中文取第一个字，英文取首字母大写）
  const avatarText = username.trim().slice(0, 1).toUpperCase();

  const { connect, disconnect } = useFetchSSE({
    url: '/api/sse/chat',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken() ?? ''}`,
    },
  });

  // 请求失败时的统一提示
  const notifyError = useCallback((message: string, error: unknown) => {
    notification.error({
      message,
      description: error instanceof Error ? error.message : '请求失败',
    });
  }, [notification]);

  // 主动刷新会话列表（发消息后调用）。只取第一页并重置游标：
  // 刚聊过的会话必然被顶到最前，一定落在第一页里
  const refreshConversations = useCallback(async () => {
    try {
      const page = await listConversationsApi();
      setConversations(page.conversations);
      setNextCursor(page.nextCursor);
    } catch (error) {
      notifyError('会话列表获取失败', error);
    }
  }, [notifyError]);

  // 加载下一页并追加
  const onLoadMore = async () => {
    if (!nextCursor || loadingMore) return;

    setLoadingMore(true);
    try {
      const page = await listConversationsApi({ cursor: nextCursor });
      // 按 conversationId 去重再追加：翻页期间如果发过消息，列表顺序会变，
      // 新的一页可能带回已经在列表里的会话
      setConversations((prev) => {
        const seen = new Set(prev.map((item) => item.conversationId));
        return [...prev, ...page.conversations.filter((item) => !seen.has(item.conversationId))];
      });
      setNextCursor(page.nextCursor);
    } catch (error) {
      notifyError('会话列表加载失败', error);
    } finally {
      setLoadingMore(false);
    }
  };

  // 未登录跳转登录页，否则加载会话列表
  useEffect(() => {
    if (!getToken()) {
      navigate('/login', { replace: true });
      return;
    }

    // 在 then 回调里更新状态，而不是在 effect 体内同步 setState，避免级联渲染；
    // cancelled 用于防止组件已卸载后回填状态
    let cancelled = false;
    listConversationsApi()
      .then((page) => {
        if (cancelled) return;
        setConversations(page.conversations);
        setNextCursor(page.nextCursor);
      })
      .catch((error) => { if (!cancelled) notifyError('会话列表获取失败', error); });

    return () => { cancelled = true; };
  }, [navigate, notifyError]);

  // 新消息时自动滚动到底部
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 组件卸载时断开 SSE 连接
  useEffect(() => () => disconnect(), [disconnect]);

  // 退出登录：断开流式连接 → 清除 token → 回登录页
  const onLogout = () => {
    disconnect();
    clearToken();
    notification.success({ message: '已退出登录' });
    navigate('/login', { replace: true });
  };

  // 重置为空白会话。注意要显式清掉 loading：断开连接不会触发 onDone/onError
  const onNewChat = () => {
    disconnect();
    setCurrentBtn('newChat');
    setConversationId(null);
    setMessages([]);
    setValue('');
    setLoading(false);
    setLoadingHistory(false);
    assistantReplyRef.current = '';
  };

  // 切换历史会话：先断开当前流再加载消息
  const onSelectConversation = async (id: string) => {
    if (id === conversationId) return;

    disconnect();
    setLoading(false);
    setCurrentBtn('historyChat');
    setConversationId(id);
    setMessages([]);
    assistantReplyRef.current = '';
    setLoadingHistory(true);

    try {
      const history = await getConversationMessagesApi(id);
      setMessages(history.map((item) => ({
        id: item.messageId,
        role: item.role,
        content: item.content,
      })));
    } catch (error) {
      notifyError('消息加载失败', error);
    } finally {
      setLoadingHistory(false);
    }
  };

  const onSend = () => {
    const content = value.trim();
    if (!content) {
      textareaRef.current?.focus();
      notification.warning({ message: '请输入内容' });
      return;
    }
    if (loading) return;

    // 追加用户消息 + 空的助手消息（等待流式填充）
    const userMsg: ChatMessage = { id: createId(), role: 'user', content };
    setMessages((prev) => [...prev, userMsg, { id: createId(), role: 'assistant', content: '' }]);
    setValue('');
    assistantReplyRef.current = '';
    setLoading(true);

    // 上下文由服务端从数据库读取拼接，这里只发本次内容和会话ID
    connect(
      JSON.stringify({ conversationId: conversationId ?? undefined, content }),
      {
        onEvent: (name, data) => {
          if (name !== 'conversation') return;
          const id = (data as { conversationId?: string })?.conversationId;
          if (!id) return;
          // 首轮会话ID由服务端生成，收到后绑定；同时刷新列表让新会话/最新排序立刻生效
          setConversationId(id);
          refreshConversations();
        },
        onChunk: (data) => {
          const delta = (data as { choices?: { delta?: { content?: string } }[] })?.choices?.[0]?.delta?.content;
          if (!delta) return;
          assistantReplyRef.current += delta;
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = { ...copy[copy.length - 1], content: assistantReplyRef.current };
            return copy;
          });
        },
        onDone: () => setLoading(false),
        onError: (error) => {
          setLoading(false);
          notification.error({
            message: '请求错误',
            description: error.message,
          });
        },
      }
    );
  };

  return (
    <div className='chat-container'>
      <section className='chat-catalog'>
        <h1>chat-ai</h1>
        <button
          type='button'
          className={`chat-menu-item${currentBtn === 'newChat' ? ' chat-menu-item-active' : ''}`}
          onClick={onNewChat}
        >
          <PlusIcon size={18} />
          <span className='chat-menu-label'>新对话</span>
        </button>
        <button
          type='button'
          className={`chat-menu-item${currentBtn === 'historyChat' ? ' chat-menu-item-active' : ''}`}
          onClick={() => setCurrentBtn('historyChat')}
        >
          <ListClockIcon size={18} />
          <span className='chat-menu-label'>历史对话</span>
        </button>
        {/* 历史对话列表 */}
        <section className='history-chats'>
          {conversations.length === 0 && (
            <div className='history-empty'>暂无历史对话</div>
          )}
          {conversations.map((item) => (
            <div
              key={item.conversationId}
              className={`history-item${item.conversationId === conversationId ? ' history-item-active' : ''}`}
              onClick={() => onSelectConversation(item.conversationId)}
            >
              <MessageSquareIcon size={14} className='history-item-icon' />
              <span className='history-item-title'>{item.title || '新对话'}</span>
            </div>
          ))}
          {nextCursor && (
            <button
              type='button'
              className='history-more'
              onClick={onLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? '加载中…' : '加载更多'}
            </button>
          )}
        </section>
        {/* 当前登录用户：头像 + 在线状态 */}
        <div className='chat-user'>
          <div className='chat-user-avatar'>
            {avatarText}
            <span className='chat-user-badge' />
          </div>
          <div className='chat-user-info'>
            <span className='chat-user-name' title={username}>{username}</span>
            <span className='chat-user-status'>在线</span>
          </div>
        </div>
        {/* 主题切换：和「退出登录」同属底部次级操作区 */}
        <ThemeToggle />
        <button type='button' className='chat-menu-item chat-logout-item' onClick={onLogout}>
          <LogOutIcon size={18} />
          <span className='chat-menu-label'>退出登录</span>
        </button>
      </section>
      <section className='chat-main'>
        <div className='chat-messages'>
          <div className='chat-messages-inner'>
            {loadingHistory && (
              <div className='chat-placeholder'>
                <LoaderCircleIcon size={28} className='chat-placeholder-icon animate-spin' />
                <span>加载中…</span>
              </div>
            )}
            {!loadingHistory && messages.length === 0 && (
              <div className='chat-placeholder'>
                <SparklesIcon size={28} className='chat-placeholder-icon' />
                <span>开始你的第一段对话吧</span>
              </div>
            )}
            {messages.map((message) =>
              message.role === 'assistant' ? (
                <div key={message.id} className='chat-row'>
                  <div className='chat-avatar'>AI</div>
                  <div className='chat-answer chat-markdown'>
                    {message.content ? (
                      <ReactMarkdown>{message.content}</ReactMarkdown>
                    ) : (
                      loading && <span className='text-(--text-muted)'>思考中…</span>
                    )}
                  </div>
                </div>
              ) : (
                <div key={message.id} className='chat-row chat-row-user'>
                  <div className='chat-bubble-user'>{message.content}</div>
                </div>
              )
            )}
            <div ref={scrollRef} />
          </div>
        </div>
        <div className='chat-composer'>
          <div className={`chat-input-box${isFocused ? ' chat-input-box-focused' : ''}`}>
            <textarea
              ref={textareaRef}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              name='textarea'
              rows={1}
              placeholder='输入消息，Enter 发送，Shift + Enter 换行'
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
            />

            <div className='chat-input-actions'>
              <Button
                type='primary'
                icon={<SendHorizonalIcon size={16} />}
                onClick={onSend}
                loading={loading}
              >
                {loading ? '发送中' : '发送'}
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
