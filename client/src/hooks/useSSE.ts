import { useCallback, useRef, } from "react";

type SSEOptions = {
  url: string;
  method?: 'POST' | 'GET';
  body?: BodyInit;
  headers?: Record<string, string>;
}

const useFetchSSE = (options: SSEOptions) => {
  const { url, method = 'GET', body, headers } = options;
  const abortControllerRef = useRef<AbortController | null>(null);

  const connect = useCallback((onDone: (messages: string) => void, onError: (error: Error) => void) => {
    const run = async () => {
      const abortColler = new AbortController();
      abortControllerRef.current = abortColler;

      try {
        const response = await fetch(url, {
          method,
          headers,
          body,
          signal: abortColler.signal,
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        if (!response.body) throw new Error('response body empty');
        // 读取内容
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buff = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buff += decoder.decode(value, {stream: true});
          const chunks = buff.split('\n\n');
          buff = chunks.pop() ?? '';

          for (const chunk of chunks) {
            if (!chunk.trim()) continue;
            if (!chunk.startsWith('data:')) continue;
            const match = chunk.match(/^data:\s*(.*)$/ms);
            if (!match) continue;
            const payload = match[1];
            if (payload === '[DONE]') {
              return;
            }
            try {
              const _message = JSON.parse(payload);
              const response = _message?.choices?.[0]?.delta?.content;
              onDone(response);
            } catch {
              // nothing
            }
          }
        }
      } catch (error: unknown) {
        if (error instanceof Error && error.name !== 'AbortError') onError(error);
      }
    }

    run();
  }, [url, method, headers, body]);

  const disconnect = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, [abortControllerRef]);
  return { connect, disconnect };
}

export default useFetchSSE;