import { useState } from 'react';
import { trpc } from '../trpc';
import type { Candidate } from '@officer-election/shared';

interface CandidateRosterProps {
  candidates: Candidate[];
  isTeller: boolean;
  votingActive: boolean;
  onAction: () => void;
}

export default function CandidateRoster({
  candidates,
  isTeller,
  votingActive,
  onAction,
}: CandidateRosterProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const addMutation = trpc.candidate.add.useMutation({
    onSuccess: () => {
      setNewName('');
      setError(null);
      onAction();
    },
    onError: (err) => setError(err.message),
  });

  const updateMutation = trpc.candidate.update.useMutation({
    onSuccess: () => {
      setEditingId(null);
      setEditValue('');
      setError(null);
      onAction();
    },
    onError: (err) => setError(err.message),
  });

  const removeMutation = trpc.candidate.remove.useMutation({
    onSuccess: () => {
      setError(null);
      onAction();
    },
    onError: (err) => setError(err.message),
  });

  const byName = (a: Candidate, b: Candidate) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const activeCandidates = candidates.filter((c) => c.removedAt === null).sort(byName);
  const removedCandidates = candidates.filter((c) => c.removedAt !== null).sort(byName);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    if (votingActive && !confirm(`Add "${name}" while voting is open? Voters will see the new candidate immediately.`)) return;
    addMutation.mutate({ name });
  };

  const handleSaveEdit = (id: string) => {
    const name = editValue.trim();
    if (!name) return;
    updateMutation.mutate({ id, name });
  };

  const handleRemove = (c: Candidate) => {
    const msg = votingActive
      ? `Remove "${c.name}" while voting is open? Voters will not be able to select them.`
      : `Remove "${c.name}" from the roster?`;
    if (!confirm(msg)) return;
    removeMutation.mutate({ id: c.id });
  };

  return (
    <div className="mt-6">
      <h3 className="font-medium mb-3">
        Candidate Roster ({activeCandidates.length})
      </h3>

      {votingActive && isTeller && (
        <div className="bg-amber-50 text-amber-800 rounded-lg p-3 mb-3 text-sm">
          Voting is open — changes will appear to voters live.
        </div>
      )}

      {error && (
        <div role="alert" className="bg-red-50 text-red-800 rounded-lg p-3 mb-3 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {activeCandidates.length === 0 && (
          <p className="text-sm text-gray-500 italic">
            {isTeller ? 'No candidates yet — add the first one below.' : 'No candidates yet.'}
          </p>
        )}
        {activeCandidates.map((c) => (
          <div
            key={c.id}
            className="p-3 bg-white rounded-lg border flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
          >
            {editingId === c.id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSaveEdit(c.id);
                }}
                className="flex items-center gap-2 flex-wrap flex-1"
              >
                <input
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  autoFocus
                  className="px-2 py-1 border rounded text-sm flex-1 min-w-[12rem]"
                />
                <button
                  type="submit"
                  disabled={updateMutation.isPending || !editValue.trim()}
                  className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50 py-2 px-3 sm:py-0 sm:px-0 bg-blue-50 sm:bg-transparent rounded-lg sm:rounded-none"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setEditValue('');
                  }}
                  className="text-xs text-gray-500 hover:text-gray-700 py-2 px-3 sm:py-0 sm:px-0 bg-gray-100 sm:bg-transparent rounded-lg sm:rounded-none"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <span>{c.name}</span>
                {isTeller && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setEditingId(c.id);
                        setEditValue(c.name);
                      }}
                      className="text-xs text-blue-600 hover:text-blue-800 py-2 px-3 sm:py-0 sm:px-0 bg-blue-50 sm:bg-transparent rounded-lg sm:rounded-none"
                    >
                      Rename
                    </button>
                    <button
                      onClick={() => handleRemove(c)}
                      disabled={removeMutation.isPending}
                      className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50 py-2 px-3 sm:py-0 sm:px-0 bg-red-50 sm:bg-transparent rounded-lg sm:rounded-none"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {isTeller && (
        <form onSubmit={handleAdd} className="mt-3 flex items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Add candidate name"
            className="flex-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            type="submit"
            disabled={addMutation.isPending || !newName.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            Add
          </button>
        </form>
      )}

      {isTeller && removedCandidates.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
            Removed candidates ({removedCandidates.length})
          </summary>
          <div className="mt-2 space-y-1">
            {removedCandidates.map((c) => (
              <div key={c.id} className="text-gray-500 italic text-sm py-1">
                {c.name}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
