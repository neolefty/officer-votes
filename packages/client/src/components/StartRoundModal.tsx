import { useState, useEffect, useRef } from 'react';
import { trpc } from '../trpc';

interface StartRoundModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default function StartRoundModal({ onClose, onSuccess }: StartRoundModalProps) {
  const [office, setOffice] = useState('');
  const [description, setDescription] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startMutation = trpc.round.start.useMutation({
    onSuccess: () => {
      onSuccess();
      onClose();
    },
  });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!office.trim()) return;
    startMutation.mutate({ office: office.trim(), description: description.trim() || undefined });
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="start-modal-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-xl p-6 w-full max-w-md">
        <h3 id="start-modal-title" className="text-lg font-semibold mb-4">
          Start Voting Round
        </h3>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label htmlFor="office-input" className="block text-sm font-medium mb-1">
                Office / Position
              </label>
              <input
                ref={inputRef}
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
              onClick={onClose}
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
  );
}
