import { useCallback, useRef } from "react";

type SSEOptions = {
  url: string;
  method?: 'POST' | 'GET';
  headers?: Record<string, string>;
}

type ConnectCallbacks = {
  /** 收到一个 data 事件（已解析的 JSON） */
  onChunk?: (data: unknown) => void;
  /** 流正常结束（收到 [DONE] 或读取完毕），只触发一次 */
  onDone?: () => void;
  /** 出错：HTTP 非 2xx、服务端 error 事件、网络异常 */
  onError?: (error: Error) => void;
}

const useFetchSSE = (options: SSEOptions) => {
  const { url, method = 'POST', headers } = options;
  const abortControllerRef = useRef<AbortController | null>(null);

  const connect = useCallback((body?: BodyInit, callbacks?: ConnectCallbacks) => {
    const { onChunk, onDone, onError } = callbacks ?? {};

    const controller = new AbortController();
    // 上一次连接若还在进行中，先断开
    abortControllerRef.current?.abort();
    abortControllerRef.current = controller;

    const run = async () => {
      try {
        const response = await fetch(url, {
          method,
          headers,
          body,
          signal: controller.signal,
        });

        if (!response.ok) {
          let message = `HTTP error! status: ${response.status}`;
          try {
            const data = await response.json();
            if (data?.message) message = data.message;
          } catch { /* 非 JSON 响应体则用默认错误信息 */ }
          throw new Error(message);
        }
        if (!response.body) throw new Error('response body empty');

        // 读取内容
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buff = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buff += decoder.decode(value, { stream: true });
          const chunks = buff.split('\n\n');
          buff = chunks.pop() ?? '';

          for (const chunk of chunks) {
            if (!chunk.trim()) continue;

            // 服务端 error 事件（event: error）
            const eventMatch = chunk.match(/^event:\s*(\S+)/m);
            if (eventMatch && eventMatch[1] === 'error') {
              const dataMatch = chunk.match(/^data:\s*(.*)$/ms);
              let message = 'SSE 服务端错误';
              if (dataMatch) {
                try { message = JSON.parse(dataMatch[1]).error ?? message; } catch { /* ignore */ }
              }
              throw new Error(message);
            }

            // 普通 data 事件
            const dataMatch = chunk.match(/^data:\s*(.*)$/ms);
            if (!dataMatch) continue;
            const payload = dataMatch[1];
            if (payload === '[DONE]') {
              onDone?.();
              return;
            }
            try {
              onChunk?.(JSON.parse(payload));
            } catch { /* 忽略无法解析的数据 */ }
          }
        }
        onDone?.();
      } catch (error: unknown) {
        // 主动 abort（disconnect / 发起新连接）不视为错误
        if (error instanceof Error && error.name === 'AbortError') return;
        onError?.(error instanceof Error ? error : new Error(String(error)));
      } finally {
        // 只清理属于本次连接的引用，避免误清掉后续新连接
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    };

    run();
  }, [url, method, headers]);

  const disconnect = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  return { connect, disconnect };
}

export default useFetchSSE;
