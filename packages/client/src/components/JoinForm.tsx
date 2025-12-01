import { useState } from 'react';
import { trpc } from '../trpc';

interface JoinFormProps {
  code: string;
  onJoined: (token: string) => void;
}

export default function JoinForm({ code, onJoined }: JoinFormProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const joinMutation = trpc.election.join.useMutation({
    onSuccess: (data) => onJoined(data.token),
    onError: (err) => setError(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    joinMutation.mutate({ code: code.toUpperCase(), name: name.trim() });
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold text-center mb-2">Join Meeting</h1>
        <p className="text-center text-gray-500 mb-8">Code: {code.toUpperCase()}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Your Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              autoFocus
            />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={joinMutation.isPending || !name.trim()}
            className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
          >
            {joinMutation.isPending ? 'Joining...' : 'Join'}
          </button>
        </form>
      </div>
    </div>
  );
}
