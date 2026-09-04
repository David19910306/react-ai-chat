import { Button } from 'antd';
import { ListClockIcon, LoaderCircleIcon, PlusIcon, SendHorizonalIcon } from 'lucide-react';

import './index.less';
import { useRef, useState } from 'react';

export default function Home () {
  const textareRef = useRef<HTMLTextAreaElement>(null);
  const [currentBtn, setCurrentBtn] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [value, setValue] = useState('');

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
            展示区域
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
                // onClick={onSend}
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