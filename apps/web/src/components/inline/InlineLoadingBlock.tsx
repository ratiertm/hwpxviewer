/**
 * InlineLoadingBlock — "Claude가 작성 중…" placeholder shown while an inline
 * AI edit call is in flight. Renders below the selection overlay in the edit
 * panel slot.
 */

import { Sparkles } from 'lucide-react';

interface Props {
  originalText: string;
}

export function InlineLoadingBlock({ originalText }: Props) {
  return (
    <div
      className="rounded-lg border p-3 shadow-2xl"
      style={{
        backgroundColor: 'var(--bg-panel)',
        borderColor: 'var(--accent)',
        color: 'var(--text)',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={12} style={{ color: 'var(--accent)' }} />
        <span className="text-xs font-medium" style={{ color: 'var(--accent)' }}>
          Claude가 작성 중…
        </span>
        <div className="flex gap-1 ml-1">
          <div className="w-1 h-1 rounded-full animate-pulse" style={{ backgroundColor: 'var(--accent)' }} />
          <div className="w-1 h-1 rounded-full animate-pulse" style={{ backgroundColor: 'var(--accent)', animationDelay: '150ms' }} />
          <div className="w-1 h-1 rounded-full animate-pulse" style={{ backgroundColor: 'var(--accent)', animationDelay: '300ms' }} />
        </div>
      </div>
      <p className="text-sm whitespace-pre-wrap opacity-60" style={{ color: 'var(--text)' }}>
        {originalText}
      </p>
    </div>
  );
}
