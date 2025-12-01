import { useState, useEffect, useRef } from 'react';
import { trpc } from '../trpc';
import type { ElectionState, DisclosureLevel, VoteTally } from '@officer-election/shared';

interface TellerControlsProps {
  state: ElectionState;
  onAction: () => void;
}

interface CloseVotingResult {
  tallies: VoteTally[];
  totalVotes: number;
  majorityThreshold: number;
  hasMajority: boolean;
  bodySize: number | null;
}

export default function TellerControls({ state, onAction }: TellerControlsProps) {
  const [showStartModal, setShowStartModal] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const [endStep, setEndStep] = useState<'confirm' | 'disclose'>('confirm');
  const [votingResults, setVotingResults] = useState<CloseVotingResult | null>(null);
  const [closedRoundId, setClosedRoundId] = useState<string | null>(null);
  const [selectedDisclosure, setSelectedDisclosure] = useState<DisclosureLevel | null>(null);
  const [endError, setEndError] = useState<string | null>(null);
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

  const closeVotingMutation = trpc.round.closeVoting.useMutation({
    onSuccess: (data) => {
      setVotingResults(data);
      // Default selection based on Bahá'í voting principles:
      // - If majority achieved: show winner without counts (cleanest announcement)
      // - If no majority: show top with counts (shows the situation clearly)
      setSelectedDisclosure(data.hasMajority ? 'top_no_count' : 'top');
      setEndStep('disclose');
      onAction();
    },
    onError: (error) => {
      setEndError(error.message);
    },
  });

  const endMutation = trpc.round.end.useMutation({
    onSuccess: () => {
      setShowEndModal(false);
      setEndStep('confirm');
      setVotingResults(null);
      setClosedRoundId(null);
      setSelectedDisclosure(null);
      setEndError(null);
      onAction();
    },
    onError: (error) => {
      setEndError(error.message);
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

  // Escape key to close modals (only in confirm step, not after voting is closed)
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && endStep === 'confirm') {
        setShowStartModal(false);
        setShowEndModal(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [endStep]);

  const handleStart = () => {
    if (!office.trim()) return;
    startMutation.mutate({ office: office.trim(), description: description.trim() || undefined });
  };

  const handleCloseVoting = () => {
    if (!state.currentRound) return;
    const roundId = state.currentRound.id;
    setClosedRoundId(roundId);
    closeVotingMutation.mutate({ roundId });
  };

  const handleEnd = (disclosureLevel: DisclosureLevel) => {
    const roundId = closedRoundId || state.pendingRound?.id;
    if (!roundId) return;
    endMutation.mutate({ roundId, disclosureLevel });
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
                className="flex-1 py-3 px-4 bg-gray-200 text-gray-800 rounded-lg font-medium hover:bg-gray-300 transition disabled:opacity-50"
              >
                Cancel Round
              </button>
              <button
                type="button"
                onClick={() => {
                  setEndError(null);
                  setShowEndModal(true);
                }}
                className="flex-1 py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition"
              >
                End Round
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setShowStartModal(true)}
              className="flex-1 py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition"
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
                  className="flex-1 py-3 px-4 bg-gray-200 text-gray-800 rounded-lg font-medium hover:bg-gray-300 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={startMutation.isPending || !office.trim()}
                  className="flex-1 py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
                >
                  {startMutation.isPending ? 'Starting...' : 'Start Round'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* End Round Modal - Two Step Wizard */}
      {showEndModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="end-modal-title"
          onClick={(e) => e.target === e.currentTarget && endStep === 'confirm' && setShowEndModal(false)}
        >
          <div
            ref={endModalRef}
            tabIndex={-1}
            className="bg-white rounded-xl p-6 w-full max-w-md outline-none"
          >
            {endStep === 'confirm' ? (
              <>
                <h3 id="end-modal-title" className="text-lg font-semibold mb-2">
                  End Voting Round
                </h3>

                <p className="text-gray-600 mb-4">
                  This will close voting. No one will be able to vote after this point.
                </p>

                {notVotedNames.length > 0 && (
                  <div
                    role="alert"
                    className="bg-yellow-50 text-yellow-800 rounded-lg p-3 mb-4 text-sm"
                  >
                    <p className="font-medium">Not everyone has voted yet:</p>
                    <p>{notVotedNames.join(', ')}</p>
                  </div>
                )}

                {endError && (
                  <div
                    role="alert"
                    className="bg-red-50 text-red-800 rounded-lg p-3 mb-4 text-sm"
                  >
                    {endError}
                  </div>
                )}

                <div className="flex gap-3 mt-6">
                  <button
                    type="button"
                    onClick={() => setShowEndModal(false)}
                    className="flex-1 py-3 px-4 bg-gray-200 text-gray-800 rounded-lg font-medium hover:bg-gray-300 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleCloseVoting}
                    disabled={closeVotingMutation.isPending}
                    className="flex-1 py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
                  >
                    <span>{closeVotingMutation.isPending ? 'Closing...' : 'End Voting'}</span>
                    <span className="block text-xs font-normal opacity-80">Next: choose what to share</span>
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 id="end-modal-title" className="text-lg font-semibold mb-4">
                  Results
                </h3>

                {/* Teller-only results view */}
                {votingResults && (
                  <div className="bg-gray-50 rounded-lg p-4 mb-4">
                    <p className="text-xs text-gray-500 mb-2">
                      Teller view only · {votingResults.totalVotes} vote{votingResults.totalVotes !== 1 ? 's' : ''} cast
                      {votingResults.bodySize && ` · ${votingResults.bodySize}-member body`}
                    </p>
                    <div className="space-y-2">
                      {votingResults.tallies.map((t) => {
                        const isMajority = t.count >= votingResults.majorityThreshold;
                        return (
                          <div
                            key={t.candidateId || 'abstain'}
                            className="flex items-center justify-between"
                          >
                            <span className={isMajority ? 'font-medium' : ''}>
                              {t.candidateName || 'Abstain'}
                            </span>
                            <span className="flex items-center gap-2">
                              <span className="text-gray-600">
                                {t.count} vote{t.count !== 1 ? 's' : ''}
                              </span>
                              {isMajority && (
                                <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                                  Majority
                                </span>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {!votingResults.hasMajority && (
                      <p className="text-sm text-amber-600 mt-3">
                        No majority reached (needed {votingResults.majorityThreshold})
                      </p>
                    )}
                  </div>
                )}

                {endError && (
                  <div
                    role="alert"
                    className="bg-red-50 text-red-800 rounded-lg p-3 mb-4 text-sm"
                  >
                    {endError}
                  </div>
                )}

                <p className="text-gray-600 mb-4">How would you like to share the results?</p>

                <div className="space-y-2" role="radiogroup" aria-label="Disclosure options">
                  <button
                    type="button"
                    onClick={() => setSelectedDisclosure('top')}
                    className={`w-full p-3 text-left rounded-lg border-2 transition ${
                      selectedDisclosure === 'top'
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <span className="font-medium">Show top recipient(s) with count</span>
                    <p className="text-sm text-gray-500">Reveal who received the most votes and how many</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => votingResults?.hasMajority && setSelectedDisclosure('top_no_count')}
                    disabled={!votingResults?.hasMajority}
                    className={`w-full p-3 text-left rounded-lg border-2 transition ${
                      selectedDisclosure === 'top_no_count'
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:bg-gray-50'
                    } ${!votingResults?.hasMajority ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <span className="font-medium">Show top recipient(s) only</span>
                    <p className="text-sm text-gray-500">
                      {votingResults?.hasMajority
                        ? 'Reveal winner without vote counts'
                        : 'Requires majority (not available)'}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedDisclosure('all')}
                    className={`w-full p-3 text-left rounded-lg border-2 transition ${
                      selectedDisclosure === 'all'
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <span className="font-medium">Show all results</span>
                    <p className="text-sm text-gray-500">Reveal vote counts for everyone</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedDisclosure('none')}
                    className={`w-full p-3 text-left rounded-lg border-2 transition ${
                      selectedDisclosure === 'none'
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <span className="font-medium">Don't disclose</span>
                    <p className="text-sm text-gray-500">Complete without sharing results</p>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => selectedDisclosure && handleEnd(selectedDisclosure)}
                  disabled={!selectedDisclosure || endMutation.isPending}
                  className="w-full mt-4 py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {endMutation.isPending ? 'Sharing...' : 'Share Results'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
