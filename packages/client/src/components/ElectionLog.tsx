import type { RoundLogEntry } from '@officer-election/shared';

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
        {roundLog.map((entry, i) => (
          <div key={entry.round.id} className="bg-white border rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium">{entry.round.office}</h3>
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
              <div className="space-y-1">
                {entry.round.disclosureLevel === 'all' ? (
                  entry.result.tallies.map((t) => (
                    <div
                      key={t.candidateId || 'abstain'}
                      className="flex items-center justify-between text-sm"
                    >
                      <span>{t.candidateName || 'Abstain'}</span>
                      <span className="text-gray-600">
                        {t.count} vote{t.count !== 1 ? 's' : ''}
                      </span>
                    </div>
                  ))
                ) : (
                  // top or top_no_count - show only top recipient(s)
                  (() => {
                    const topCount = entry.result.tallies[0]?.count || 0;
                    const topCandidates = entry.result.tallies.filter((t) => t.count === topCount);
                    return topCandidates.map((t) => (
                      <div
                        key={t.candidateId || 'abstain'}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="font-medium">{t.candidateName || 'Abstain'}</span>
                        {entry.round.disclosureLevel === 'top' && (
                          <span className="text-gray-600">
                            {t.count} vote{t.count !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    ));
                  })()
                )}
              </div>
            ) : entry.round.status === 'cancelled' ? (
              <p className="text-sm text-gray-500">Round was cancelled</p>
            ) : (
              <p className="text-sm text-gray-500">Results not disclosed</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
