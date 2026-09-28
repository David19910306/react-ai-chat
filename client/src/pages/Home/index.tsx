import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Popconfirm, App as AntdApp, Upload } from 'antd';
import {
  ListClockIcon,
  LoaderCircleIcon,
  LogOutIcon,
  MessageSquareIcon,
  Plus,
  PlusIcon,
  SendHorizonalIcon,
  SparklesIcon,
  TrashIcon,
} from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import AttachmentCard from '@/components/AttachmentCard';
import ThemeToggle from '@/components/ThemeToggle';
import useFetchSSE from '@/hooks/useSSE';
import { clearToken, getCurrentUser, getToken } from '@/utils/auth';
import { calcFileMd5 } from '@/utils/file';
import {
  checkInstantUploadApi,
  deleteFileApi,
  uploadFileApi,
  type UploadFile,
} from '@/api/file';
import {
  deleteConversationApi,
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
  /** 随消息发出的附件，仅用户消息会有 */
  attachments?: UploadFile[];
};

// 与后端 config.ts 的 UPLOAD_MAX_FILES 保持一致：超了后端会直接 400，这里先拦一道给出更快的反馈
const MAX_ATTACHMENTS = 10;

const createId = () =>
  typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : String(Date.now());

/**
 * 这两个常量提到模块作用域，不是随手放的位置：
 * react-markdown 内部用 useMemo 缓存解析结果，依赖数组里就有 options.remarkPlugins
 * （见其源码 lib/index.js）。写成内联字面量的话数组每次渲染都是新引用，
 * 缓存必然失效，而流式输出时每个 chunk 都会触发一次渲染 —— 等于把整段 markdown 重头解析一遍。
 */
// 表格语法（| a | b |）属于 GFM 扩展，react-markdown 默认只解析 CommonMark，不加这个插件表格会原样当文本输出
const REMARK_PLUGINS = [remarkGfm];

const MARKDOWN_COMPONENTS: Components = {
  // 模型输出的表格列数不可控，直接放在气泡里会把它顶变形；
  // 外面包一层可横向滚动的容器（样式见 index.less 的 .chat-table-wrap）。
  // 只取 children 是刻意的：react-markdown 会额外注入一个 node（AST 节点，见其源码里的 passNode: true），
  // 整包 payload 摊到 <table> 上会变成非法的 DOM 属性并触发 React 告警
  table: ({ children }) => (
    <div className='chat-table-wrap'>
      <table>{children}</table>
    </div>
  ),
  img: ({ children }) => (
    <div className='chat-img-wrap'>
      <img>{children}</img>
    </div>
  ),
};

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
  // 正在删除的会话ID，用于在对应列表项上显示加载态并防止重复点击
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // 待发送的附件。
  //
  // 这里刻意**不**在挂载时去拉 /file/lists 预填：那个接口返回的是当前用户的全部文件，
  // 预填的结果是每次打开页面都把历史附件倒进输入框，用户随手一按发送就把旧文件又发了一遍，
  // 想删掉其中一张卡片还会连带删掉服务端上那份文件。
  // 待发送区只能由「本次会话新上传或秒传命中的文件」构成，所以初值就是空数组
  const [fileList, setFileList] = useState<UploadFile[]>([]);

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
      duration: 2000,
    });
    if (error instanceof Error && error.message === '令牌已过期，请重新登录'){
      navigate('/login', { replace: true, });
    }
  }, [notification, navigate]);

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

  /**
   * 往待发送区追加附件，按 fileId 去重。
   *
   * 去重是必要的：秒传让「同一份文件」反复命中同一个 fileId，
   * 直接 append 会在待发送区堆出多张一模一样的卡片；发出去时 fileIds 里也会带重复值
   */
  const appendFiles = useCallback((incoming: UploadFile[]) => {
    if (incoming.length === 0) return;
    setFileList((prev) => {
      const seen = new Set(prev.map((item) => item.id));
      return [...prev, ...incoming.filter((item) => !seen.has(item.id))];
    });
  }, []);

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
        // 服务端一并返回了每条消息的附件，直接挂上即可。
        // 附件已被删除的消息这里会拿到空数组，气泡按「纯文字」渲染
        attachments: item.attachments,
      })));
    } catch (error) {
      notifyError('消息加载失败', error);
    } finally {
      setLoadingHistory(false);
    }
  };

  // 删除历史会话：确认后请求服务端，成功则本地移除
  const onDeleteConversation = async (id: string) => {
    if (deletingId) return;

    setDeletingId(id);
    try {
      await deleteConversationApi(id);
      setConversations((prev) => prev.filter((item) => item.conversationId !== id));
      // 删掉的正是当前会话：回到空白态，否则消息区还留着一条服务端已经不存在的会话，
      // 继续发送时带上这个 conversationId 会被服务端拒绝
      if (id === conversationId) onNewChat();
      notification.success({ message: '已删除', duration: 2000 });
    } catch (error) {
      notifyError('删除失败', error);
    } finally {
      setDeletingId(null);
    }
  };

  const onSend = () => {
    const content = value.trim();
    if (!content && fileList.length === 0) {
      textareaRef.current?.focus();
      notification.warning({ message: '请输入内容' });
      return;
    }
    if (loading) return;
    if (fileList.length > MAX_ATTACHMENTS) {
      notification.warning({ message: `一次最多携带 ${MAX_ATTACHMENTS} 个附件` });
      return;
    }

    // 本次要发出去的附件。先存一份再清空 state：下面的回调里读到的 fileList 已经是空的了
    const attachments = fileList;

    /**
     * 追加用户消息 + 空的助手消息（等待流式填充）
     * 用户消息：userMsg，空助手消息：{ id: createId(), role: 'assistant', content: '' }
     * 附件挂到用户消息上，这样气泡里能立刻看到发了什么
     */
    const userMsg: ChatMessage = { id: createId(), role: 'user', content, attachments };
    setMessages((prev) => [...prev, userMsg, { id: createId(), role: 'assistant', content: '' }]);
    setValue('');
    // 附件已随本次消息发出，清空待发送区；不清的话下一轮会重复带一遍
    setFileList([]);
    assistantReplyRef.current = '';
    setLoading(true);

    // 上下文由服务端从数据库读取拼接，这里只发本次内容、会话ID和附件ID。
    // 附件内容（图片转 base64、文档提取文本）全在服务端处理，不经前端中转
    connect(
      JSON.stringify({
        conversationId: conversationId ?? undefined,
        content,
        fileIds: attachments.map((file) => file.id),
      }),
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
              {/* 删除确认。外面包一层 span 拦截冒泡：点删除按钮不应该顺带切换会话。
                  气泡本身挂在 body 上，不会冒泡到这里 */}
              <span onClick={(e) => e.stopPropagation()}>
                <Popconfirm
                  title='删除该对话？'
                  description='删除后无法恢复'
                  okText='删除'
                  cancelText='取消'
                  okButtonProps={{ danger: true }}
                  onConfirm={() => onDeleteConversation(item.conversationId)}
                >
                  <button
                    type='button'
                    className='history-delete'
                    title='删除对话'
                    aria-label='删除对话'
                    disabled={deletingId !== null}
                  >
                    {deletingId === item.conversationId
                      ? <LoaderCircleIcon size={14} className='animate-spin' />
                      : <TrashIcon size={14} />}
                  </button>
                </Popconfirm>
              </span>
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
                      <ReactMarkdown
                        remarkPlugins={REMARK_PLUGINS}
                        components={MARKDOWN_COMPONENTS}
                      >
                        {message.content}
                      </ReactMarkdown>
                    ) : (
                      loading && <span className='text-(--text-muted)'>思考中…</span>
                    )}
                  </div>
                </div>
              ) : (
                <div key={message.id} className='chat-row chat-row-user'>
                  {/* 附件排在文字上方：图片是主体内容，先看到更符合预期 */}
                  {message.attachments && message.attachments.length > 0 && (
                    <div className='chat-bubble-attachments'>
                      {message.attachments.map((file) => (
                        <AttachmentCard key={file.id} file={file} />
                      ))}
                    </div>
                  )}
                  {/* 只带附件没打字时服务端会补一句默认提问，这里就不重复显示那句话 */}
                  {message.content && <div className='chat-bubble-user'>{message.content}</div>}
                </div>
              )
            )}
            <div ref={scrollRef} />
          </div>
        </div>
        <div className='chat-composer'>
          <div className={`chat-input-box${isFocused ? ' chat-input-box-focused' : ''}`}>
            {
              fileList.length > 0? (
                <div className='flex rounded-tl-[14px] rounded-tr-[14px] pt-2 pl-2'>
                  {
                    fileList.map((file: UploadFile) => (
                      <AttachmentCard
                        key={file.id}
                        file={file}
                        onRemove={async (fileId) => {
                          try {
                            await deleteFileApi(fileId);
                            // 直接本地摘掉这一项，不再重新拉全量列表：删的就是刚点的那个，
                            // 再请求一次既慢，又会把其它历史文件一并灌进待发送区
                            setFileList((prev) => prev.filter((item) => item.id !== fileId));
                          } catch (error) {
                            notifyError('删除失败', error);
                          }
                        }}
                      />
                    ))
                  }
                </div>
              ): null
            }
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
              {/* 文件上传 */}
              <Upload
                className='upload-icon'
                showUploadList={false}
                multiple
                accept='.jpg,.png,.xls,.xlsx,.pdf,.txt,.doc,.docx'
                customRequest={async (options) => {
                  const { file, onSuccess, onError } = options;
                  // antd 把 file 的类型放宽成 string | Blob | RcFile（历史兼容，允许传 URL），
                  // 从选择器来的永远是 RcFile。这里显式收窄而不是 as 强转：
                  // 真出现非 File 的情况，宁可在这一步报错，也不要让一个 string 混进 FormData
                  if (!(file instanceof File)) {
                    onError?.(new Error('无法读取所选文件'));
                    return;
                  }
                  try {
                    /**
                     * 秒传：先在本地算出文件指纹，问服务端「这份内容我是不是已经传过」。
                     * 命中就只发了一个 32 字节的 md5，文件本身一个字节都不用传。
                     *
                     * 探测失败（网络抖动、服务端异常）不该挡着上传，服务端侧对
                     * /file/check 的错误也已经收敛成 exists:false，这里再兜一层 try：
                     * 客户端连 md5 都算不出来（比如读文件被拒）时直接走完整上传
                     */
                    const md5 = await calcFileMd5(file).catch(() => '');
                    if (md5) {
                      const hit = await checkInstantUploadApi(md5, file.size);
                      if (hit) {
                        appendFiles([hit]);
                        // 必须回调，否则 antd 内部这条上传记录会一直停在 uploading 状态不释放
                        onSuccess?.(hit);
                        return;
                      }
                    }

                    appendFiles(await uploadFileApi(file));
                    onSuccess?.(null);
                  } catch (error) {
                    notifyError('上传失败', error)
                    onError?.(error as Error);
                  }
                }}
              >
                <Plus size='18' />
              </Upload>
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
