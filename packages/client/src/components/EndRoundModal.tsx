import { useState, useEffect, useRef } from 'react';
import { trpc } from '../trpc';
import type { ElectionState, DisclosureLevel, CloseVotingResult } from '@officer-election/shared';

interface EndRoundModalProps {
  state: ElectionState;
  onClose: () => void;
  onSuccess: () => void;
}

export default function EndRoundModal({ state, onClose, onSuccess }: EndRoundModalProps) {
  const [step, setStep] = useState<'confirm' | 'disclose'>('confirm');
  const [votingResults, setVotingResults] = useState<CloseVotingResult | null>(null);
  const [closedRoundId, setClosedRoundId] = useState<string | null>(null);
  const [selectedDisclosure, setSelectedDisclosure] = useState<DisclosureLevel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const closeVotingMutation = trpc.round.closeVoting.useMutation({
    onSuccess: (data) => {
      setVotingResults(data);
      // Default selection based on Bahá'í voting principles:
      // - If majority achieved: show winner without counts (cleanest announcement)
      // - If no majority: show top with counts (shows the situation clearly)
      setSelectedDisclosure(data.hasMajority ? 'top_no_count' : 'top');
      setStep('disclose');
      onSuccess();
    },
    onError: (err) => setError(err.message),
  });

  const endMutation = trpc.round.end.useMutation({
    onSuccess: () => {
      onSuccess();
      onClose();
    },
    onError: (err) => setError(err.message),
  });

  useEffect(() => {
    modalRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && step === 'confirm') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [step, onClose]);

  const handleCloseVoting = () => {
    if (!state.currentRound) return;
    setClosedRoundId(state.currentRound.id);
    closeVotingMutation.mutate({ roundId: state.currentRound.id });
  };

  const handleShareResults = () => {
    const roundId = closedRoundId || state.pendingRound?.id;
    if (!roundId || !selectedDisclosure) return;
    endMutation.mutate({ roundId, disclosureLevel: selectedDisclosure });
  };

  const notVoted = state.voterStatus?.filter((v) => !v.hasVoted) || [];
  const notVotedNames = notVoted
    .map((v) => state.participants.find((p) => p.id === v.participantId)?.name)
    .filter(Boolean);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="end-modal-title"
      onClick={(e) => e.target === e.currentTarget && step === 'confirm' && onClose()}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className="bg-white rounded-xl p-6 w-full max-w-md outline-none"
      >
        {step === 'confirm' ? (
          <ConfirmStep
            notVotedNames={notVotedNames as string[]}
            error={error}
            isPending={closeVotingMutation.isPending}
            onCancel={onClose}
            onConfirm={handleCloseVoting}
          />
        ) : (
          <DisclosureStep
            votingResults={votingResults}
            selectedDisclosure={selectedDisclosure}
            error={error}
            isPending={endMutation.isPending}
            onSelect={setSelectedDisclosure}
            onShare={handleShareResults}
          />
        )}
      </div>
    </div>
  );
}

function ConfirmStep({
  notVotedNames,
  error,
  isPending,
  onCancel,
  onConfirm,
}: {
  notVotedNames: string[];
  error: string | null;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <h3 id="end-modal-title" className="text-lg font-semibold mb-2">
        End Voting Round
      </h3>

      <p className="text-gray-600 mb-4">
        This will close voting. No one will be able to vote after this point.
      </p>

      {notVotedNames.length > 0 && (
        <div role="alert" className="bg-yellow-50 text-yellow-800 rounded-lg p-3 mb-4 text-sm">
          <p className="font-medium">Not everyone has voted yet:</p>
          <p>{notVotedNames.join(', ')}</p>
        </div>
      )}

      {error && (
        <div role="alert" className="bg-red-50 text-red-800 rounded-lg p-3 mb-4 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-3 mt-6">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-3 px-4 bg-gray-200 text-gray-800 rounded-lg font-medium hover:bg-gray-300 transition"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isPending}
          className="flex-1 py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
        >
          <span>{isPending ? 'Closing...' : 'End Voting'}</span>
          <span className="block text-xs font-normal opacity-80">Next: choose what to share</span>
        </button>
      </div>
    </>
  );
}

function DisclosureStep({
  votingResults,
  selectedDisclosure,
  error,
  isPending,
  onSelect,
  onShare,
}: {
  votingResults: CloseVotingResult | null;
  selectedDisclosure: DisclosureLevel | null;
  error: string | null;
  isPending: boolean;
  onSelect: (level: DisclosureLevel) => void;
  onShare: () => void;
}) {
  return (
    <>
      <h3 id="end-modal-title" className="text-lg font-semibold mb-4">
        Results
      </h3>

      {votingResults && <TellerResultsView results={votingResults} />}

      {error && (
        <div role="alert" className="bg-red-50 text-red-800 rounded-lg p-3 mb-4 text-sm">
          {error}
        </div>
      )}

      <p className="text-gray-600 mb-4">How would you like to share the results?</p>

      <DisclosureOptions
        selectedDisclosure={selectedDisclosure}
        hasMajority={votingResults?.hasMajority ?? false}
        onSelect={onSelect}
      />

      <button
        type="button"
        onClick={onShare}
        disabled={!selectedDisclosure || isPending}
        className="w-full mt-4 py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? 'Sharing...' : 'Share Results'}
      </button>
    </>
  );
}

function TellerResultsView({ results }: { results: CloseVotingResult }) {
  return (
    <div className="bg-gray-50 rounded-lg p-4 mb-4">
      <p className="text-xs text-gray-500 mb-2">
        Teller view only · {results.totalVotes} vote{results.totalVotes !== 1 ? 's' : ''} cast
        {results.bodySize && ` · ${results.bodySize}-member body`}
      </p>
      <div className="space-y-2">
        {results.tallies.map((t) => {
          // Only actual candidates (not abstentions) can have majority
          const isMajority = t.candidateId !== null && t.count >= results.majorityThreshold;
          return (
            <div key={t.candidateId || 'abstain'} className="flex items-center justify-between">
              <span className={isMajority ? 'font-medium' : ''}>{t.candidateName || 'Abstain'}</span>
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
      {!results.hasMajority && (
        <p className="text-sm text-amber-600 mt-3">
          No majority reached (needed {results.majorityThreshold})
        </p>
      )}
    </div>
  );
}

function DisclosureOptions({
  selectedDisclosure,
  hasMajority,
  onSelect,
}: {
  selectedDisclosure: DisclosureLevel | null;
  hasMajority: boolean;
  onSelect: (level: DisclosureLevel) => void;
}) {
  const options: { level: DisclosureLevel; label: string; description: string; disabled?: boolean }[] = [
    {
      level: 'top',
      label: 'Show top recipient(s) with count',
      description: 'Reveal who received the most votes and how many',
    },
    {
      level: 'top_no_count',
      label: 'Show top recipient(s) only',
      description: hasMajority ? 'Reveal winner without vote counts' : 'Requires majority (not available)',
      disabled: !hasMajority,
    },
    {
      level: 'all',
      label: 'Show all results',
      description: 'Reveal vote counts for everyone',
    },
    {
      level: 'none',
      label: "Don't disclose",
      description: 'Complete without sharing results',
    },
  ];

  return (
    <div className="space-y-2" role="radiogroup" aria-label="Disclosure options">
      {options.map(({ level, label, description, disabled }) => (
        <button
          key={level}
          type="button"
          onClick={() => !disabled && onSelect(level)}
          disabled={disabled}
          className={`w-full p-3 text-left rounded-lg border-2 transition ${
            selectedDisclosure === level
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-200 hover:bg-gray-50'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <span className="font-medium">{label}</span>
          <p className="text-sm text-gray-500">{description}</p>
        </button>
      ))}
    </div>
  );
}
