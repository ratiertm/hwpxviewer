/**
 * HistoryList — minimal M6R history panel shown inside the sidebar footer.
 *
 * Each entry: compact "OLD → NEW" preview + toggle button that flips the edit
 * between applied and undone states (POST /api/undo). Full-featured history
 * pane (search, filter, timestamp groups) lands in M7R.
 */

import type { HistoryEntry } from '@/types';

interface Props {
  entries: readonly HistoryEntry[];
  busyId: number | null;
  onToggle: (editId: number) => void;
}

function preview(s: string, n = 18): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + '…';
}

export function HistoryList({ entries, busyId, onToggle }: Props) {
  if (entries.length === 0) {
    return (
      <div className="px-3 py-4 text-[11px] text-text-faint text-center">
        편집 기록이 없습니다
      </div>
    );
  }
  return (
    <ul className="space-y-1">
      {entries.map((e) => {
        const busy = busyId === e.id;
        return (
          <li
            key={e.id}
            className={`rounded border px-2 py-1.5 text-[11px] space-y-1 ${
              e.undone
                ? 'border-border-subtle bg-bg-subtle opacity-60'
                : 'border-border bg-bg-panel'
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="text-text-subtle tabular-nums">#{e.id}</span>
              <span className="text-text-muted truncate max-w-[120px]" title={e.action}>
                {e.action}
              </span>
            </div>
            <div className="font-mono text-text leading-snug">
              <span className="line-through text-text-faint">{preview(e.oldText)}</span>
              <span className="text-text-muted mx-1">→</span>
              <span className="text-accent">{preview(e.newText)}</span>
            </div>
            <button
              onClick={() => onToggle(e.id)}
              disabled={busy}
              className="w-full text-[10px] rounded border border-border-subtle px-2 py-0.5 text-text-muted hover:bg-bg-muted disabled:opacity-50"
            >
              {busy ? '…' : e.undone ? '다시 적용' : '되돌리기'}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
