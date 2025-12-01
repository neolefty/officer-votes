import { useState } from 'react';
import { trpc } from '../trpc';
import type { ElectionState } from '@officer-election/shared';

interface LobbyProps {
  state: ElectionState;
  isTeller: boolean;
  onAction: () => void;
}

export default function Lobby({ state, isTeller, onAction }: LobbyProps) {
  const [showToast, setShowToast] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingBodySize, setEditingBodySize] = useState(false);
  const [bodySize, setBodySize] = useState('');
  const shareUrl = `${window.location.origin}/e/${state.election.code}`;

  const promoteMutation = trpc.election.promoteToTeller.useMutation({
    onSuccess: () => onAction(),
  });

  const stepDownMutation = trpc.election.stepDownAsTeller.useMutation({
    onSuccess: () => onAction(),
  });

  const updateNameMutation = trpc.election.updateName.useMutation({
    onSuccess: () => {
      setEditingName(false);
      setNewName('');
      onAction();
    },
  });

  const setBodySizeMutation = trpc.election.setBodySize.useMutation({
    onSuccess: () => {
      setEditingBodySize(false);
      setBodySize('');
      onAction();
    },
  });

  const tellerCount = state.participants.filter((p) => p.role === 'teller').length;
  const canStepDown = isTeller && tellerCount > 1;

  const copyLink = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2000);
  };

  return (
    <div>
      <div className="text-center mb-8">
        <h2 className="text-xl font-semibold mb-2">Waiting Room</h2>
        <p className="text-gray-600">
          {state.currentRound
            ? 'A voting round is in progress'
            : 'Waiting for the teller to start a voting round'}
        </p>
      </div>

      <div className="bg-gray-50 rounded-xl p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-medium">Invite Link</h3>
          <button
            onClick={copyLink}
            className="text-sm text-blue-600 hover:text-blue-800 py-2 px-3 sm:py-0 sm:px-0 bg-blue-50 sm:bg-transparent rounded-lg sm:rounded-none hover:bg-blue-100 sm:hover:bg-transparent"
          >
            Copy
          </button>
        </div>
        <p className="text-sm text-gray-600 break-all">{shareUrl}</p>
      </div>

      <div>
        <h3 className="font-medium mb-3">
          Participants ({state.participants.length})
        </h3>
        <div className="space-y-2">
          {state.participants.map((p) => {
            const isMe = p.id === state.currentParticipantId;
            const isTellerRole = p.role === 'teller';
            const hasActions = isMe || (isTeller && !isTellerRole);

            return (
              <div
                key={p.id}
                className={`p-3 bg-white rounded-lg border ${
                  hasActions ? 'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between' : 'flex items-center justify-between'
                }`}
              >
                <div className="flex items-center gap-2">
                  {isMe && editingName ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (newName.trim()) {
                          updateNameMutation.mutate({ name: newName.trim() });
                        }
                      }}
                      className="flex items-center gap-2 flex-wrap"
                    >
                      <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder={p.name}
                        autoFocus
                        className="px-2 py-1 border rounded text-sm w-32"
                      />
                      <button
                        type="submit"
                        disabled={updateNameMutation.isPending || !newName.trim()}
                        className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50 py-2 px-3 sm:py-0 sm:px-0 bg-blue-50 sm:bg-transparent rounded-lg sm:rounded-none hover:bg-blue-100 sm:hover:bg-transparent"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingName(false);
                          setNewName('');
                        }}
                        className="text-xs text-gray-500 hover:text-gray-700 py-2 px-3 sm:py-0 sm:px-0 bg-gray-100 sm:bg-transparent rounded-lg sm:rounded-none hover:bg-gray-200 sm:hover:bg-transparent"
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <>
                      <span>{p.name}</span>
                      {isMe && <span className="text-sm text-gray-500">(Me)</span>}
                      {isTellerRole && <span className="text-sm text-gray-500">(Teller)</span>}
                    </>
                  )}
                </div>

                {/* Actions row - stacks below name on mobile */}
                {hasActions && !editingName && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {isMe && (
                      <button
                        onClick={() => {
                          setEditingName(true);
                          setNewName(p.name);
                        }}
                        className="text-xs text-blue-600 hover:text-blue-800 py-2 px-3 sm:py-0 sm:px-0 bg-blue-50 sm:bg-transparent rounded-lg sm:rounded-none hover:bg-blue-100 sm:hover:bg-transparent"
                      >
                        Rename
                      </button>
                    )}
                    {isMe && isTellerRole && canStepDown && (
                      <button
                        onClick={() => stepDownMutation.mutate()}
                        disabled={stepDownMutation.isPending}
                        className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50 py-2 px-3 sm:py-0 sm:px-0 bg-gray-100 sm:bg-transparent rounded-lg sm:rounded-none hover:bg-gray-200 sm:hover:bg-transparent"
                      >
                        Step Down as Teller
                      </button>
                    )}
                    {!isTellerRole && isTeller && (
                      <button
                        onClick={() => promoteMutation.mutate({ participantId: p.id })}
                        disabled={promoteMutation.isPending}
                        className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50 py-2 px-3 sm:py-0 sm:px-0 bg-blue-50 sm:bg-transparent rounded-lg sm:rounded-none hover:bg-blue-100 sm:hover:bg-transparent"
                      >
                        Make Teller
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {isTeller && (
        <div className="bg-gray-50 rounded-xl p-4 mt-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-medium">Body Size</h3>
              <p className="text-sm text-gray-500">
                {state.election.bodySize
                  ? `${state.election.bodySize} members (majority = ${Math.floor(state.election.bodySize / 2) + 1})`
                  : 'Not set (majority based on votes cast)'}
              </p>
            </div>
            {editingBodySize ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const size = bodySize.trim() === '' ? null : parseInt(bodySize, 10);
                  if (size === null || (size >= 1 && size <= 100)) {
                    setBodySizeMutation.mutate({ bodySize: size });
                  }
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="number"
                  value={bodySize}
                  onChange={(e) => setBodySize(e.target.value)}
                  placeholder="e.g., 9"
                  min="1"
                  max="100"
                  autoFocus
                  className="px-2 py-1 border rounded text-sm w-20"
                />
                <button
                  type="submit"
                  disabled={setBodySizeMutation.isPending}
                  className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50 py-2 px-3 sm:py-0 sm:px-0 bg-blue-50 sm:bg-transparent rounded-lg sm:rounded-none hover:bg-blue-100 sm:hover:bg-transparent"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingBodySize(false);
                    setBodySize('');
                  }}
                  className="text-xs text-gray-500 hover:text-gray-700 py-2 px-3 sm:py-0 sm:px-0 bg-gray-100 sm:bg-transparent rounded-lg sm:rounded-none hover:bg-gray-200 sm:hover:bg-transparent"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <button
                onClick={() => {
                  setEditingBodySize(true);
                  setBodySize(state.election.bodySize?.toString() || '');
                }}
                className="text-sm text-blue-600 hover:text-blue-800 py-2 px-3 sm:py-0 sm:px-0 bg-blue-50 sm:bg-transparent rounded-lg sm:rounded-none hover:bg-blue-100 sm:hover:bg-transparent"
              >
                {state.election.bodySize ? 'Edit' : 'Set'}
              </button>
            )}
          </div>
        </div>
      )}

      {showToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg">
          Link copied!
        </div>
      )}
    </div>
  );
}
