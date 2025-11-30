import { useEffect, useRef, useCallback } from 'react';
import { getToken } from '../trpc';

type SSEHandler = (event: string, data: unknown) => void;

export function useSSE(code: string | undefined, onEvent: SSEHandler) {
  const abortRef = useRef<AbortController | null>(null);
  const reconnectTimeoutRef = useRef<number>();

  const connect = useCallback(() => {
    if (!code) return;

    const token = getToken();
    if (!token) return;

    // Abort existing connection
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const abortController = new AbortController();
    abortRef.current = abortController;

    const url = `/events/${code}`;

    fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: abortController.signal,
    })
      .then(async (response) => {
        if (!response.ok || !response.body) {
          throw new Error('SSE connection failed');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let currentEvent = 'message';
          let currentData = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7);
            } else if (line.startsWith('data: ')) {
              currentData = line.slice(6);
            } else if (line === '' && currentData) {
              try {
                onEvent(currentEvent, JSON.parse(currentData));
              } catch (e) {
                console.error('SSE parse error:', e);
              }
              currentEvent = 'message';
              currentData = '';
            }
          }
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.error('SSE error:', err);
          reconnectTimeoutRef.current = window.setTimeout(connect, 3000);
        }
      });
  }, [code, onEvent]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [connect]);
}
