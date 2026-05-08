import { useState } from 'react';
import { trpc } from '../trpc';
import type { ElectionState } from '@officer-election/shared';
import StartRoundModal from './StartRoundModal';
import EndRoundModal from './EndRoundModal';

interface TellerControlsProps {
  state: ElectionState;
  onAction: () => void;
}

interface RunoffPrefill {
  candidateNames: string[];
  candidateIds: string[];
}

export default function TellerControls({ state, onAction }: TellerControlsProps) {
  const [showStartModal, setShowStartModal] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const [runoffPrefill, setRunoffPrefill] = useState<RunoffPrefill | null>(null);

  const cancelMutation = trpc.round.cancel.useMutation({
    onSuccess: () => onAction(),
  });

  const handleCancel = () => {
    const roundId = state.currentRound?.id || state.pendingRound?.id;
    if (!roundId) return;
    if (!confirm('Cancel this round? All votes will be discarded.')) return;
    cancelMutation.mutate({ roundId });
  };

  const handleTieRunoff = (tied: { id: string; name: string }[]) => {
    setRunoffPrefill({
      candidateIds: tied.map((t) => t.id),
      candidateNames: tied.map((t) => t.name),
    });
    setShowStartModal(true);
  };

  const handleStartFresh = () => {
    setRunoffPrefill(null);
    setShowStartModal(true);
  };

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg"
        aria-label="Teller controls"
      >
        <div className="max-w-2xl mx-auto px-4 py-3 flex gap-3">
          {state.currentRound ? (
            <>
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelMutation.isPending}
                className="flex-1 py-3 px-4 bg-gray-200 text-gray-800 rounded-lg font-medium hover:bg-gray-300 transition disabled:opacity-50"
              >
                Cancel Round
              </button>
              <button
                type="button"
                onClick={() => setShowEndModal(true)}
                className="flex-1 py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition"
              >
                End Round
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleStartFresh}
              className="flex-1 py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition"
            >
              Start New Round
            </button>
          )}
        </div>
      </nav>

      {showStartModal && (
        <StartRoundModal
          electionType={state.election.electionType}
          runoff={runoffPrefill ?? undefined}
          onClose={() => {
            setShowStartModal(false);
            setRunoffPrefill(null);
          }}
          onSuccess={onAction}
        />
      )}

      {showEndModal && (
        <EndRoundModal
          state={state}
          onClose={() => setShowEndModal(false)}
          onSuccess={onAction}
          onTieRunoff={handleTieRunoff}
        />
      )}
    </>
  );
}
