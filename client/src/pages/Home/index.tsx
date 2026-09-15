import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, App as AntdApp } from 'antd';
import { ListClockIcon, LogOutIcon, PlusIcon, SendHorizonalIcon } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import useFetchSSE from '@/hooks/useSSE';
import { clearToken, getToken } from '@/utils/auth';

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
  const [value, setValue] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const { connect, disconnect } = useFetchSSE({
    url: '/api/sse/chat',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken() ?? ''}`,
    },
  });

  // 未登录跳转登录页
  useEffect(() => {
    if (!getToken()) {
      navigate('/login', { replace: true });
    }
  }, [navigate]);

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

    connect(
      JSON.stringify({ messages: [{ role: 'user', content }] }),
      {
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
        <Button
          className='chat-menu-item'
          style={currentBtn === 'newChat' ? { background: '#eff6ff' } : {}}
          onClick={() => setCurrentBtn('newChat')}
        >
          <PlusIcon size='18' />新对话
        </Button>
        <Button
          className='chat-menu-item'
          style={currentBtn === 'historyChat' ? { background: '#eff6ff' } : {}}
          onClick={() => setCurrentBtn('historyChat')}
        >
          <ListClockIcon size='18' />历史对话
        </Button>
        {/* 历史对话区域 TODO */}
        <section className='history-chats'></section>
        <Button className='chat-menu-item chat-logout-item' onClick={onLogout}>
          <LogOutIcon size='18' />退出登录
        </Button>
      </section>
      <section className='h-full flex-1 flex flex-col bg-panel transition-colors pb-4'>
        <div className='relative flex-1 overflow-y-auto'>
          <div className='w-[80%] mx-auto p-4 space-y-4'>
            {messages.length === 0 && (
              <div className='text-center text-gray-400 mt-20'>开始你的第一段对话吧</div>
            )}
            {messages.map((message) =>
              message.role === 'assistant' ? (
                <div key={message.id} className='flex items-start text-start'>
                  <div className='shrink-0 w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold mr-3'>
                    AI
                  </div>
                  <div className='flex-1'>
                    {message.content ? (
                      <ReactMarkdown>{message.content}</ReactMarkdown>
                    ) : (
                      loading && <span className='text-gray-400'>思考中…</span>
                    )}
                  </div>
                </div>
              ) : (
                <div className='flex justify-end' key={message.id}>
                  <div className='bg-(--user-bubble-bg) text-(--user-bubble-text) px-4 py-2 rounded-l-2xl rounded-tr-2xl rounded-br-sm wrap-break-word whitespace-pre-wrap transition-colors'>
                    {message.content}
                  </div>
                </div>
              )
            )}
            <div ref={scrollRef} />
          </div>
        </div>
        <div
          className={`
            relative bg-panel rounded-xl border transition-all duration-200 shadow-sm w-[80%] mx-auto mt-2
            ${
              isFocused
                ? "border-(--focus-border) shadow-md"
                : "border-surface hover:border-surface"
            }
          `}
        >
          <div className='px-2 pt-2 pb-2'>
            <textarea
              ref={textareaRef}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              name='textarea'
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
              className='
                w-full resize-none border-none outline-none bg-transparent
                text-base leading-6 placeholder-gray-400 dark:placeholder-gray-500
                min-h-6
              '
              style={{
                fontSize: "16px",
                lineHeight: "1.5",
                fontFamily: "inherit",
                transition: "height 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            />

            <div className='flex items-center justify-end'>
              <Button
                type='primary'
                size='small'
                icon={<SendHorizonalIcon size={18} />}
                onClick={onSend}
                loading={loading}
                className='
                  flex items-center justify-center rounded-lg p-2
                  bg-blue-500 hover:bg-blue-600 border-blue-500 hover:border-blue-600
                  disabled:bg-gray-300 disabled:border-surface
                  transition-all duration-200
                '
                style={{
                  padding: '14px 8px',
                }}
              >{loading ? "发送中" : "发送"}</Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
