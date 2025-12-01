import { useEffect, useRef, useCallback } from 'react';
import { getToken } from '../trpc';

type SSEHandler = (event: string, data: unknown) => void;

export function useSSE(code: string | undefined, onEvent: SSEHandler) {
  const abortRef = useRef<AbortController | null>(null);
  const reconnectTimeoutRef = useRef<number>();
  const lastHeartbeatRef = useRef<number>(Date.now());
  const healthCheckIntervalRef = useRef<number>();

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
            // SSE comments (starting with :) are used for heartbeats
            if (line.startsWith(':')) {
              lastHeartbeatRef.current = Date.now();
            } else if (line.startsWith('event: ')) {
              currentEvent = line.slice(7);
            } else if (line.startsWith('data: ')) {
              currentData = line.slice(6);
            } else if (line === '' && currentData) {
              // Real events also count as heartbeat
              lastHeartbeatRef.current = Date.now();
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

        // Stream ended - reconnect unless intentionally aborted
        if (!abortController.signal.aborted) {
          reconnectTimeoutRef.current = window.setTimeout(connect, 1000);
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.error('SSE error:', err);
          reconnectTimeoutRef.current = window.setTimeout(connect, 3000);
        }
      });
  }, [code, onEvent]);

  // Initial connection
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

  // Visibility change handler - reconnect if stale when tab becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Check if connection is stale (no heartbeat in 45s)
        if (Date.now() - lastHeartbeatRef.current > 45000) {
          connect();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [connect]);

  // Health check interval - reconnect if heartbeat is stale
  useEffect(() => {
    if (!code) return;

    healthCheckIntervalRef.current = window.setInterval(() => {
      // 45s = 30s heartbeat + 15s grace period
      if (Date.now() - lastHeartbeatRef.current > 45000) {
        connect();
      }
    }, 15000);

    return () => {
      if (healthCheckIntervalRef.current) {
        clearInterval(healthCheckIntervalRef.current);
      }
    };
  }, [code, connect]);
}
