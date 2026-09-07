import { useEffect, useRef, useState } from 'react';
import { Button, notification } from 'antd';
import { ListClockIcon, LoaderCircleIcon, PlusIcon, SendHorizonalIcon } from 'lucide-react';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error
import useFetchSSE from '@/hooks/useSSE';

import './index.less';
import ReactMarkdown from 'react-markdown';

export default function Home () {
  let _messages = "";
  const textareRef = useRef<HTMLTextAreaElement>(null);
  const [currentBtn, setCurrentBtn] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [value, setValue] = useState('');
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);

  const { connect, disconnect } = useFetchSSE({
    url: '/api/sse/chat',
    method: 'POST',
    body: JSON.stringify({ messages: [ { role: 'user', content: value.trim() } ] }),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI3NTAyNjI4Njc1NTY2MDY4MDU3IiwidXNlcm5hbWUiOiJkYWl5aSIsImlhdCI6MTc4ODc2NjA2OCwiZXhwIjoxNzg4NzczMjY4fQ.Lcnec9UhhlDe76xd1eorq2ECCeRhW_RKH0qEJgskDqQ',
    }
  });

  const onSend = () => {
    if (!value.trim()) {
      textareRef.current?.focus();
      notification.warning({
        message: '请输入内容'
      });
      return;
    }
    const userMsg: { role: string; content: string } = { role: "user", content: value.trim() };
    const inputMessage = [...messages, userMsg];
    setMessages(inputMessage);

    setLoading(true);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    connect(
      (responses: string) => {
        _messages += responses;
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: _messages };
          return copy;
        });
        setLoading(false);
        setValue('');
      },
      (error: Error) => {
        setLoading(false);
        notification.error({
          message: '请求错误',
          description: error.message,
        });
      }
    );
  }

  useEffect(() => () => disconnect(), []);

  return (
    <div className='chat-container'>
      <section className='chat-catalog'>
        <h1>chat-ai</h1>
        <Button 
          className='chat-menu-item' 
          style={currentBtn === 'newChat'? {background: '#eff6ff'}: {}} 
          onClick={() => setCurrentBtn('newChat')}
        >
          <PlusIcon size='18' />新对话
        </Button>
        <Button 
          className='chat-menu-item' 
          style={currentBtn === 'historyChat'? {background: '#eff6ff'}: {}}
          onClick={() => setCurrentBtn('historyChat')}
        >
          <ListClockIcon size='18' />历史对话
        </Button>
        {/* 历史对话区域 TODO */}
        <section className='history-chats'></section>
      </section>
      <section className='h-full flex-1 flex flex-col bg-panel transition-colors pb-4'>
        <div className="relative flex-1 overflow-y-auto">
          <div className="w-[80%] mx-auto p-4 space-y-4">
            {messages.map((message, index) => (
              message.role === 'assistant' ? (
                <div key={index} className="flex items-start text-start">
                  <div className="shrink-0 w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold mr-3">
                    {message.role === 'assistant' ? 'AI' : 'You'}
                  </div>
                  <div className="flex-1">
                    <ReactMarkdown>{message.content}</ReactMarkdown>
                  </div>
                </div>
              ): (
                // 用户输入消息
                <div className="flex justify-end" key={index}>
                  <div className="bg-(--user-bubble-bg) text-(--user-bubble-text) px-4 py-2 rounded-l-2xl rounded-tr-2xl rounded-br-sm wrap-break-word whitespace-pre-wrap transition-colors">
                    {message.content}
                  </div>
                </div>
              )
            ))}
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
          <div className="px-2 pt-2 pb-2">
            <textarea 
              ref={textareRef}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              name='textarea'
              value={value}
              onChange={(e) => setValue(e.target.value)}
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

            <div className="flex items-center justify-end">
              <Button
                type="primary"
                size="small"
                icon={loading ? <LoaderCircleIcon size={18} /> : <SendHorizonalIcon size={18} />}
                onClick={onSend}
                disabled={
                  loading
                }
                loading={loading}
                className="
                  flex items-center justify-center rounded-lg p-2
                  bg-blue-500 hover:bg-blue-600 border-blue-500 hover:border-blue-600
                  disabled:bg-gray-300 disabled:border-surface
                  transition-all duration-200
                "
                style={{
                  padding: '14px 8px'
                }}
              >{loading ? "发送中" : "发送"}</Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}