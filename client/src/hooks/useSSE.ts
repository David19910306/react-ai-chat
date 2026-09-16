import { useCallback, useRef } from "react";

type SSEOptions = {
  url: string;
  method?: 'POST' | 'GET';
  headers?: Record<string, string>;
}

type ConnectCallbacks = {
  /** 收到一个无名 data 事件（已解析的 JSON） */
  onChunk?: (data: unknown) => void;
  /** 收到一个具名事件，如 `event: conversation` */
  onEvent?: (name: string, data: unknown) => void;
  /** 流正常结束（收到 [DONE] 或读取完毕），只触发一次 */
  onDone?: () => void;
  /** 出错：HTTP 非 2xx、服务端 error 事件、网络异常 */
  onError?: (error: Error) => void;
}

const useFetchSSE = (options: SSEOptions) => {
  const { url, method = 'GET', headers } = options;
  const abortControllerRef = useRef<AbortController | null>(null);

  const connect = useCallback((body?: BodyInit, callbacks?: ConnectCallbacks) => {
    const { onChunk, onEvent, onDone, onError } = callbacks ?? {};

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

            // 一个事件块形如 "event: xxx\ndata: {...}"，event 行可省略
            const eventMatch = chunk.match(/^event:\s*(\S+)/m);
            const eventName = eventMatch?.[1];

            const dataMatch = chunk.match(/^data:\s*(.*)$/ms);
            if (!dataMatch) continue;
            const payload = dataMatch[1];

            // 服务端 error 事件（event: error）统一走 onError
            if (eventName === 'error') {
              let message = 'SSE 服务端错误';
              try { message = JSON.parse(payload).error ?? message; } catch { /* ignore */ }
              throw new Error(message);
            }
            
            if (payload === '[DONE]') {
              onDone?.();
              return;
            }

            let parsed: unknown;
            try {
              parsed = JSON.parse(payload);
            } catch {
              continue; // 忽略无法解析的数据
            }

            // 具名事件交给 onEvent，无名事件保持原有的 onChunk 行为
            if (eventName) onEvent?.(eventName, parsed);
            else onChunk?.(parsed);
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
