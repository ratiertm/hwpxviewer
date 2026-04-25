/**
 * StatusBar — thin bottom bar with file/edit counters + Claude streaming
 * indicator. Cosmetic; metrics come straight from the Zustand store.
 */

import { FileText } from 'lucide-react';

interface Props {
  fileName: string;
  pageCount: number;
  currentPage: number;
  edits: number;       // non-undone edit count
  turns: number;       // user-message count
  isStreaming: boolean;
  version: number;
}

export function StatusBar({
  fileName,
  pageCount,
  currentPage,
  edits,
  turns,
  isStreaming,
  version,
}: Props) {
  return (
    <footer
      className="h-7 px-4 flex items-center gap-3 border-t text-xs tabular-nums shrink-0"
      style={{
        backgroundColor: 'var(--bg-subtle)',
        borderColor: 'var(--border)',
        color: 'var(--text-subtle)',
      }}
    >
      <FileText size={11} />
      <span className="truncate max-w-[260px]">{fileName}</span>
      <Sep />
      <span>
        Page {currentPage + 1} / {pageCount}
      </span>
      <Sep />
      <span>v{version}</span>
      <Sep />
      <span>{edits} edits</span>
      <Sep />
      <span>{turns} turns</span>
      <div className="ml-auto flex items-center gap-1.5">
        <div
          className={`w-1.5 h-1.5 rounded-full ${isStreaming ? 'animate-pulse' : ''}`}
          style={{
            backgroundColor: isStreaming ? '#818cf8' : '#34d399',
            boxShadow: isStreaming
              ? '0 0 6px rgba(129,140,248,0.6)'
              : '0 0 6px rgba(52,211,153,0.6)',
          }}
        />
        <span>{isStreaming ? 'Streaming' : 'Sonnet 4'}</span>
      </div>
    </footer>
  );
}

function Sep() {
  return (
    <div
      className="w-px h-3"
      style={{ backgroundColor: 'var(--border)' }}
      aria-hidden
    />
  );
}
