/**
 * HistoryPanel — right-side floating panel listing every recorded edit
 * with timestamp, action label, and undo toggle. Symmetric layout to
 * ChatPanel (320px).
 *
 * Ported from ``hwpx-viewer-v8.jsx`` §980. v0.3 adaptation: HistoryEntry
 * uses Run-coord ``selection`` instead of pageId/pageTitle, so the
 * "jump-to-page" target is computed from the entry's recorded selection.
 */

import { Check, Clock, GitBranch, Redo2, Undo2, X } from 'lucide-react';

import type { HistoryEntry } from '@/types';

interface Props {
  entries: readonly HistoryEntry[];
  busyId: number | null;
  onClose: () => void;
  onToggle: (id: number) => void;
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '방금';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}분 전`;
  return `${Math.floor(mins / 60)}시간 전`;
}

function preview(s: string, n = 28): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}

export function HistoryPanel({ entries, busyId, onClose, onToggle }: Props) {
  const sorted = entries; // already prepended-newest in App.tsx
  const activeCount = entries.filter((e) => !e.undone).length;

  return (
    <div
      className="w-80 h-full flex flex-col border-l backdrop-blur-xl"
      style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border)' }}
    >
      <div
        className="h-12 px-4 flex items-center gap-2 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ backgroundColor: 'var(--bg-subtle)' }}
        >
          <GitBranch size={12} style={{ color: 'var(--text-muted)' }} />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>
            변경 이력
          </div>
          <div className="text-xs" style={{ color: 'var(--text-faint)' }}>
            {activeCount}개 활성 · 총 {entries.length}개
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-md hover:bg-bg-muted flex items-center justify-center appearance-none"
          style={{ color: 'var(--text-muted)' }}
          aria-label="닫기"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center px-8 text-center">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
              style={{ backgroundColor: 'var(--bg-subtle)' }}
            >
              <Clock size={20} style={{ color: 'var(--text-faint)' }} />
            </div>
            <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
              아직 편집 이력이 없습니다
            </div>
          </div>
        ) : (
          <div className="px-4 py-4 relative">
            <div
              className="absolute left-[27px] top-6 bottom-6 w-px"
              style={{ backgroundColor: 'var(--border-subtle)' }}
            />
            <div className="space-y-3">
              {sorted.map((entry) => {
                const busy = busyId === entry.id;
                return (
                  <div key={entry.id} className="relative pl-8">
                    <div
                      className="absolute left-0 top-1.5 w-4 h-4 rounded-full flex items-center justify-center"
                      style={{
                        background: entry.undone
                          ? 'var(--bg-subtle)'
                          : 'linear-gradient(135deg, #818cf8, #f472b6)',
                        border: entry.undone ? '2px solid var(--border)' : 'none',
                      }}
                    >
                      {!entry.undone && (
                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'white' }} />
                      )}
                    </div>
                    <div
                      className="rounded-lg border overflow-hidden"
                      style={{
                        borderColor: 'var(--border)',
                        backgroundColor: 'var(--bg-muted)',
                        opacity: entry.undone ? 0.6 : 1,
                      }}
                    >
                      <div
                        className="px-3 py-2 border-b flex items-start justify-between gap-2"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        <div className="flex-1 min-w-0">
                          <div
                            className="text-xs font-medium mb-0.5"
                            style={{ color: 'var(--text-strong)' }}
                          >
                            {entry.action}
                          </div>
                          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                            sec {entry.selection.start.sec} · para {entry.selection.start.para}
                            {entry.selection.start.cell ? ` · cell ${entry.selection.start.cell.cellIndex}` : ''}
                          </div>
                        </div>
                        <span
                          className="text-xs tabular-nums whitespace-nowrap"
                          style={{ color: 'var(--text-faint)' }}
                        >
                          {formatTime(entry.ts)}
                        </span>
                      </div>
                      <div
                        className="px-3 py-1.5 text-[11px] font-mono break-words"
                        style={{ backgroundColor: 'var(--bg)', color: 'var(--text)' }}
                      >
                        <span style={{ color: 'var(--text-faint)', textDecoration: 'line-through' }}>
                          {preview(entry.oldText)}
                        </span>
                        <span style={{ color: 'var(--text-muted)' }}> → </span>
                        <span style={{ color: 'var(--accent)' }}>{preview(entry.newText)}</span>
                      </div>
                      <div
                        className="px-3 py-2 flex items-center justify-between"
                        style={{ backgroundColor: 'var(--bg-subtle)' }}
                      >
                        {entry.undone ? (
                          <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-faint)' }}>
                            <Undo2 size={10} /> 되돌려짐
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-xs" style={{ color: '#34d399' }}>
                            <Check size={10} /> 적용됨
                          </div>
                        )}
                        <button
                          onClick={() => onToggle(entry.id)}
                          disabled={busy}
                          className="flex items-center gap-1 px-2 py-0.5 rounded text-xs hover:bg-bg-muted appearance-none disabled:opacity-50"
                          style={{ color: entry.undone ? 'var(--accent)' : '#fda4af' }}
                        >
                          {busy ? (
                            '…'
                          ) : entry.undone ? (
                            <>
                              <Redo2 size={10} /> 다시 적용
                            </>
                          ) : (
                            <>
                              <Undo2 size={10} /> 되돌리기
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
