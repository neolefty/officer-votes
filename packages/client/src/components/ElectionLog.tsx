import type { RoundLogEntry, RoundResult } from '@officer-election/shared';

interface ElectionLogProps {
  roundLog: RoundLogEntry[];
  onClose: () => void;
}

export default function ElectionLog({ roundLog, onClose }: ElectionLogProps) {
  if (roundLog.length === 0) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold mb-2">Voting Log</h2>
        <p className="text-gray-600 mb-6">No completed rounds yet</p>
        <button
          onClick={onClose}
          className="px-4 py-3 bg-gray-200 rounded-lg hover:bg-gray-300 transition"
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Voting Log</h2>
        <button
          onClick={onClose}
          className="px-4 py-3 sm:px-3 sm:py-1.5 text-sm bg-gray-100 rounded-lg hover:bg-gray-200 transition"
        >
          Back
        </button>
      </div>

      <div className="space-y-4">
        {roundLog.map((entry) => {
          const isRunoff =
            entry.round.electionType === 'by_election' &&
            entry.round.eligibleCandidateIds !== null &&
            entry.round.eligibleCandidateIds.length > 0;
          return (
            <div key={entry.round.id} className="bg-white border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-medium">
                  {entry.round.office}
                  {isRunoff && (
                    <span className="ml-2 text-xs text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                      Runoff
                    </span>
                  )}
                </h3>
                <span
                  className={`text-xs px-2 py-0.5 rounded ${
                    entry.round.status === 'revealed'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {entry.round.status === 'cancelled' ? 'Cancelled' : 'Completed'}
                </span>
              </div>

              {entry.round.description && (
                <p className="text-sm text-gray-600 mb-3">{entry.round.description}</p>
              )}

              {entry.result && entry.round.disclosureLevel !== 'none' ? (
                <LogResultBody entry={entry} />
              ) : entry.round.status === 'cancelled' ? (
                <p className="text-sm text-gray-500">Round was cancelled</p>
              ) : (
                <p className="text-sm text-gray-500">Results not disclosed</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LogResultBody({ entry }: { entry: RoundLogEntry }) {
  const result = entry.result!;
  const showCounts =
    entry.round.disclosureLevel === 'all' || entry.round.disclosureLevel === 'top';

  if (entry.round.disclosureLevel === 'all') {
    return (
      <div className="space-y-1">
        {result.tallies.map((t) => (
          <div
            key={t.candidateId || 'abstain'}
            className="flex items-center justify-between text-sm"
          >
            <span>{t.candidateName || 'Abstain'}</span>
            <span className="text-gray-600">
              {t.count} vote{t.count !== 1 ? 's' : ''}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // top or top_no_count
  if (result.electionType === 'by_election') {
    return <ByElectionTopLog result={result} showCounts={showCounts} />;
  }

  const actualVotes = result.tallies.filter((t) => t.candidateId !== null);
  const topCount = actualVotes[0]?.count || 0;
  const topCandidates = actualVotes.filter((t) => t.count === topCount);
  return (
    <div className="space-y-1">
      {topCandidates.map((t) => (
        <div
          key={t.candidateId || 'abstain'}
          className="flex items-center justify-between text-sm"
        >
          <span className="font-medium">{t.candidateName || 'Abstain'}</span>
          {showCounts && (
            <span className="text-gray-600">
              {t.count} vote{t.count !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function ByElectionTopLog({
  result,
  showCounts,
}: {
  result: Extract<RoundResult, { electionType: 'by_election' }>;
  showCounts: boolean;
}) {
  const selection = result.selection;
  if (selection.outcome === 'no_votes') {
    return <p className="text-sm text-gray-500">No votes cast</p>;
  }
  const elected = selection.outcome === 'decisive' ? selection.winners : selection.decisiveWinners;
  const tied = selection.outcome === 'tie' ? selection.tiedCandidates : [];
  return (
    <div className="space-y-2">
      {elected.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Elected</p>
          {elected.map((w) => (
            <div
              key={w.candidateId}
              className="flex items-center justify-between text-sm"
            >
              <span className="font-medium">{w.candidateName}</span>
              {showCounts && (
                <span className="text-gray-600">
                  {w.count} vote{w.count !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {tied.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wide text-amber-700 mb-1">
            Tied (runoff required)
          </p>
          {tied.map((t) => (
            <div
              key={t.candidateId}
              className="flex items-center justify-between text-sm"
            >
              <span className="font-medium">{t.candidateName}</span>
              {showCounts && (
                <span className="text-gray-600">
                  {t.count} vote{t.count !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
