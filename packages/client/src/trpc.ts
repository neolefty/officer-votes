import { createTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@officer-election/server';

export const trpc = createTRPCReact<AppRouter>();

export function getToken(): string | null {
  const code = window.location.pathname.match(/\/e\/([A-Za-z0-9]+)/)?.[1];
  if (!code) return null;
  const tokens = JSON.parse(localStorage.getItem('electionTokens') || '{}');
  return tokens[code.toUpperCase()] || null;
}

export function setToken(code: string, token: string) {
  const tokens = JSON.parse(localStorage.getItem('electionTokens') || '{}');
  tokens[code.toUpperCase()] = token;
  localStorage.setItem('electionTokens', JSON.stringify(tokens));
}

export function clearToken(code: string) {
  const tokens = JSON.parse(localStorage.getItem('electionTokens') || '{}');
  delete tokens[code.toUpperCase()];
  localStorage.setItem('electionTokens', JSON.stringify(tokens));
}

export function createTrpcClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: '/trpc',
        headers() {
          const token = getToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });
}
