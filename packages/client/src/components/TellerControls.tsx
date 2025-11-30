import { useState, useEffect, useRef } from 'react';
import { trpc } from '../trpc';
import type { ElectionState, DisclosureLevel } from '@officer-election/shared';

interface TellerControlsProps {
  state: ElectionState;
  onAction: () => void;
}

export default function TellerControls({ state, onAction }: TellerControlsProps) {
  const [showStartModal, setShowStartModal] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const [office, setOffice] = useState('');
  const [description, setDescription] = useState('');
  const startInputRef = useRef<HTMLInputElement>(null);
  const endModalRef = useRef<HTMLDivElement>(null);

  const startMutation = trpc.round.start.useMutation({
    onSuccess: () => {
      setShowStartModal(false);
      setOffice('');
      setDescription('');
      onAction();
    },
  });

  const endMutation = trpc.round.end.useMutation({
    onSuccess: () => {
      setShowEndModal(false);
      onAction();
    },
  });

  const cancelMutation = trpc.round.cancel.useMutation({
    onSuccess: () => onAction(),
  });

  // Focus management for modals
  useEffect(() => {
    if (showStartModal && startInputRef.current) {
      startInputRef.current.focus();
    }
  }, [showStartModal]);

  useEffect(() => {
    if (showEndModal && endModalRef.current) {
      endModalRef.current.focus();
    }
  }, [showEndModal]);

  // Escape key to close modals
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowStartModal(false);
        setShowEndModal(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  const handleStart = () => {
    if (!office.trim()) return;
    startMutation.mutate({ office: office.trim(), description: description.trim() || undefined });
  };

  const handleEnd = (disclosureLevel: DisclosureLevel) => {
    if (!state.currentRound) return;
    endMutation.mutate({ roundId: state.currentRound.id, disclosureLevel });
  };

  const handleCancel = () => {
    if (!state.currentRound) return;
    if (!confirm('Cancel this round? All votes will be discarded.')) return;
    cancelMutation.mutate({ roundId: state.currentRound.id });
  };

  const notVoted = state.voterStatus?.filter((v) => !v.hasVoted) || [];
  const notVotedNames = notVoted
    .map((v) => state.participants.find((p) => p.id === v.participantId)?.name)
    .filter(Boolean);

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
                className="flex-1 py-2.5 px-4 bg-gray-200 text-gray-800 rounded-lg font-medium hover:bg-gray-300 transition disabled:opacity-50"
              >
                Cancel Round
              </button>
              <button
                type="button"
                onClick={() => setShowEndModal(true)}
                className="flex-1 py-2.5 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition"
              >
                End Round
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setShowStartModal(true)}
              className="flex-1 py-2.5 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition"
            >
              Start New Round
            </button>
          )}
        </div>
      </nav>

      {/* Start Round Modal */}
      {showStartModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="start-modal-title"
          onClick={(e) => e.target === e.currentTarget && setShowStartModal(false)}
        >
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h3 id="start-modal-title" className="text-lg font-semibold mb-4">
              Start Voting Round
            </h3>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleStart();
              }}
            >
              <div className="space-y-4">
                <div>
                  <label htmlFor="office-input" className="block text-sm font-medium mb-1">
                    Office / Position
                  </label>
                  <input
                    ref={startInputRef}
                    id="office-input"
                    type="text"
                    value={office}
                    onChange={(e) => setOffice(e.target.value)}
                    placeholder="e.g., Chair, Secretary, Treasurer"
                    className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="description-input" className="block text-sm font-medium mb-1">
                    Description (optional)
                  </label>
                  <input
                    id="description-input"
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g., Executive officer of the Assembly"
                    className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowStartModal(false)}
                  className="flex-1 py-2.5 px-4 bg-gray-200 text-gray-800 rounded-lg font-medium hover:bg-gray-300 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={startMutation.isPending || !office.trim()}
                  className="flex-1 py-2.5 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
                >
                  {startMutation.isPending ? 'Starting...' : 'Start Round'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* End Round Modal */}
      {showEndModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="end-modal-title"
          onClick={(e) => e.target === e.currentTarget && setShowEndModal(false)}
        >
          <div
            ref={endModalRef}
            tabIndex={-1}
            className="bg-white rounded-xl p-6 w-full max-w-md outline-none"
          >
            <h3 id="end-modal-title" className="text-lg font-semibold mb-2">
              End Voting Round
            </h3>

            {notVotedNames.length > 0 && (
              <div
                role="alert"
                className="bg-yellow-50 text-yellow-800 rounded-lg p-3 mb-4 text-sm"
              >
                <p className="font-medium">Not everyone has voted yet:</p>
                <p>{notVotedNames.join(', ')}</p>
              </div>
            )}

            <p className="text-gray-600 mb-4">How would you like to share the results?</p>

            <div className="space-y-2" role="group" aria-label="Disclosure options">
              <button
                type="button"
                onClick={() => handleEnd('top')}
                disabled={endMutation.isPending}
                className="w-full p-3 text-left rounded-lg border hover:bg-gray-50 transition disabled:opacity-50"
              >
                <span className="font-medium">Show top recipient(s)</span>
                <p className="text-sm text-gray-500">Only reveal who received the most votes</p>
              </button>
              <button
                type="button"
                onClick={() => handleEnd('all')}
                disabled={endMutation.isPending}
                className="w-full p-3 text-left rounded-lg border hover:bg-gray-50 transition disabled:opacity-50"
              >
                <span className="font-medium">Show all results</span>
                <p className="text-sm text-gray-500">Reveal vote counts for everyone</p>
              </button>
              <button
                type="button"
                onClick={() => handleEnd('none')}
                disabled={endMutation.isPending}
                className="w-full p-3 text-left rounded-lg border hover:bg-gray-50 transition disabled:opacity-50"
              >
                <span className="font-medium">Don't disclose</span>
                <p className="text-sm text-gray-500">End the round without sharing results</p>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowEndModal(false)}
              className="w-full mt-4 py-2.5 px-4 bg-gray-200 text-gray-800 rounded-lg font-medium hover:bg-gray-300 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
