/**
 * InlineErrorBlock — red-framed error card used when an inline AI call or
 * subsequent /api/edit fails.
 */

import { AlertCircle, X } from 'lucide-react';

interface Props {
  error: string;
  onClose: () => void;
}

export function InlineErrorBlock({ error, onClose }: Props) {
  return (
    <div
      className="rounded-lg border p-3 flex items-start gap-2 shadow-2xl"
      style={{
        backgroundColor: 'var(--bg-panel)',
        borderColor: 'rgb(244 63 94 / 0.5)',
        color: 'var(--text)',
      }}
    >
      <AlertCircle size={14} className="mt-0.5" style={{ color: '#fb7185' }} />
      <div className="flex-1">
        <div className="text-xs font-medium mb-1" style={{ color: '#fda4af' }}>
          편집 실패
        </div>
        <div className="text-xs break-words" style={{ color: 'var(--text)' }}>
          {error}
        </div>
      </div>
      <button
        onClick={onClose}
        className="w-6 h-6 rounded hover:bg-bg-muted flex items-center justify-center appearance-none"
        style={{ color: 'var(--text-muted)' }}
        aria-label="닫기"
      >
        <X size={12} />
      </button>
    </div>
  );
}
