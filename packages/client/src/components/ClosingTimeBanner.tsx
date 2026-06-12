import { trpc } from '../trpc';
import type { Round } from '@officer-election/shared';
import type { ClosingTime } from '../hooks/useClosingTime';
import { formatRemaining } from '../hooks/useClosingTime';

interface ClosingTimeBannerProps {
  round: Round;
  closing: ClosingTime;
  isTeller: boolean;
  onAction: () => void;
}

const HOUR = 60 * 60 * 1000;
const EXTEND_OPTIONS = [
  { label: '+1 hour', ms: HOUR },
  { label: '+1 day', ms: 24 * HOUR },
  { label: '+1 week', ms: 7 * 24 * HOUR },
];

/**
 * Countdown to the round's soft closing time, plus teller controls to set,
 * extend, clear, or trigger ("Lock now") it. Once the time passes, vote
 * changes lock but first-time votes are still accepted until the teller
 * closes voting — the copy reflects that.
 */
export default function ClosingTimeBanner({
  round,
  closing,
  isTeller,
  onAction,
}: ClosingTimeBannerProps) {
  const setClosesAtMutation = trpc.round.setClosesAt.useMutation({
    onSuccess: () => onAction(),
  });

  const { closesAt, serverNow, isLocked, remainingMs } = closing;

  if (closesAt === null && !isTeller) {
    return null;
  }

  // Extend from the later of "now" and the current deadline, so repeated
  // taps stack and a passed deadline extends from the present.
  const extendFrom = Math.max(serverNow, closesAt ?? 0);

  return (
    <div
      className={`rounded-xl p-4 mb-6 ${isLocked ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50'}`}
    >
      {closesAt !== null && (
        <p className={`text-sm ${isLocked ? 'text-amber-800' : 'text-gray-700'}`}>
          {isLocked ? (
            <>
              <span className="font-medium">Voting is closing soon.</span> Vote changes are
              locked; votes not yet cast are still accepted until the teller closes the round.
            </>
          ) : (
            <>
              Voting closes in <span className="font-medium">{formatRemaining(remainingMs!)}</span>
              {' '}({new Date(closesAt).toLocaleString()}). You can change or withdraw your vote
              until then.
            </>
          )}
        </p>
      )}

      {isTeller && (
        <div className={`flex flex-wrap gap-2 ${closesAt !== null ? 'mt-3' : ''}`}>
          {closesAt === null && (
            <span className="text-sm text-gray-600 self-center">Closing time:</span>
          )}
          {EXTEND_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() =>
                setClosesAtMutation.mutate({ roundId: round.id, closesAt: extendFrom + opt.ms })
              }
              disabled={setClosesAtMutation.isPending}
              className="text-xs text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-2 rounded-lg transition disabled:opacity-50"
            >
              {opt.label}
            </button>
          ))}
          {!isLocked && (
            <button
              type="button"
              onClick={() =>
                setClosesAtMutation.mutate({ roundId: round.id, closesAt: serverNow })
              }
              disabled={setClosesAtMutation.isPending}
              className="text-xs text-amber-700 bg-amber-50 hover:bg-amber-100 px-3 py-2 rounded-lg transition disabled:opacity-50"
            >
              Lock changes now
            </button>
          )}
          {closesAt !== null && (
            <button
              type="button"
              onClick={() => setClosesAtMutation.mutate({ roundId: round.id, closesAt: null })}
              disabled={setClosesAtMutation.isPending}
              className="text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-lg transition disabled:opacity-50"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {setClosesAtMutation.error && (
        <p role="alert" className="text-red-600 text-sm mt-2">
          {setClosesAtMutation.error.message}
        </p>
      )}
    </div>
  );
}
