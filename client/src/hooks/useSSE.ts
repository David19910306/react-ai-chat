import { useCallback, useRef, useState } from "react";

type SSEOptions = {
  url: string;
  method?: 'POST' | 'GET';
  body?: BodyInit;
  headers?: Record<string, string>;
}

const useFetchSSE = (options: SSEOptions) => {
  const { url, method = 'GET', body, headers } = options;

  const [messages, setMessages] = useState<string[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  const connect = useCallback(() => {
    const run = async () => {
      const abortColler = new AbortController();
      abortControllerRef.current = abortColler;
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(url, {
          method,
          headers,
          body,
          signal: abortColler.signal,
        });

        if (!response.body) throw new Error('response body empty');
        // 读取内容
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buff = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buff += decoder.decode(value, {stream: true});
          const chunks = buff.split('\n\n');
          buff = chunks.pop() ?? '';

          for (const chunk of chunks) {
            if (!chunk.startsWith('data:')) continue;
            const payload = chunk.replace(/^data:\s*/, '');
            try {
              setMessages(prev => [...prev, JSON.parse(payload)]);
            } catch {
              setMessages(prev => [...prev, payload as unknown as string]);
            }
          }
        }
      } catch (error: unknown) {
        if (error instanceof Error && error.name !== 'AbortError') setError(error);
      } finally {
        setLoading(false);
      }
    }

    run();
  }, [url, method, body, headers]);

  const disconnect = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, [abortControllerRef]);

  return { messages, error, loading, connect, disconnect };
}

export default useFetchSSE;