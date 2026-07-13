import { useEffect, useMemo, useState } from 'react';
import type { ElectionState, Round } from '@officer-election/shared';

export interface ClosingTime {
  closesAt: number | null;
  /** Estimated current server time (unix ms), anchored to the last fetch. */
  serverNow: number;
  /** True once the closing time has passed: changes/withdrawals are locked. */
  isLocked: boolean;
  /** ms until the lock; 0 once locked; null when no closing time is set. */
  remainingMs: number | null;
}

/**
 * Closing-time countdown anchored to the server clock. `state.serverNow` is
 * the server's clock at the last fetch; we add locally-elapsed time since
 * then, so an off-by-minutes device clock can't show a wrong countdown (the
 * server independently enforces the lock either way).
 */
export function useClosingTime(
  state: ElectionState | undefined,
  round: Round | null | undefined
): ClosingTime {
  const closesAt = round?.closesAt ?? null;

  // Re-anchor whenever a fetch delivers a new serverNow. Before the first
  // fetch lands there is no round either, so the local-clock fallback is moot.
  const stateServerNow = state?.serverNow;
  const anchor = useMemo(
    () => ({ serverNow: stateServerNow ?? Date.now(), localAt: Date.now() }),
    [stateServerNow]
  );

  const [, setTick] = useState(0);
  useEffect(() => {
    if (closesAt === null) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [closesAt]);

  const serverNow = anchor.serverNow + (Date.now() - anchor.localAt);
  const isLocked = closesAt !== null && serverNow >= closesAt;
  const remainingMs = closesAt === null ? null : Math.max(0, closesAt - serverNow);

  return { closesAt, serverNow, isLocked, remainingMs };
}

export function formatRemaining(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
