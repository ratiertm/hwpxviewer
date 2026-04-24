/**
 * ChatPatchCard — in-bubble "apply me" card for an attached-selection chat
 * turn. Renders a slim word-diff preview (reuses the ``diffTokens`` /
 * ``groupHunks`` engine from ``lib/diff/text``) and an [적용] button that
 * reaches ``/api/edit``.
 *
 * The cherry-pick precision (per-hunk toggle) from the floating
 * ``InlineCherryPickDiff`` is intentionally omitted here — chat-driven edits
 * are meant to be "click once and move on". Users who want per-hunk control
 * can still use the inline-menu route (selection → 다시 쓰기 → CherryPick).
 */

import { Check, Sparkles, Undo2 } from 'lucide-react';
import { useMemo } from 'react';

import { diffTokens, groupHunks } from '@/lib/diff/text';
import type { EditablePatch } from '@/types';

interface Props {
  patch: EditablePatch;
  busy: boolean;
  onApply: () => void;
  onUndo: () => void;
  onReject: () => void;
}

export function ChatPatchCard({ patch, busy, onApply, onUndo, onReject }: Props) {
  const ops = useMemo(() => diffTokens(patch.original, patch.suggestion), [patch.original, patch.suggestion]);
  const hunks = useMemo(() => groupHunks(ops), [ops]);
  const applied = patch.appliedEditId !== undefined;

  return (
    <div
      className="mt-2 rounded-lg border overflow-hidden"
      style={{
        backgroundColor: 'var(--bg-subtle)',
        borderColor: applied ? 'rgb(16 185 129 / 0.5)' : 'var(--accent)',
      }}
    >
      <div
        className="px-3 py-1.5 text-[11px] flex items-center gap-2 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        {applied ? (
          <>
            <Check size={11} style={{ color: '#34d399' }} />
            <span className="font-semibold" style={{ color: '#34d399' }}>적용됨</span>
          </>
        ) : (
          <>
            <Sparkles size={11} style={{ color: 'var(--accent)' }} />
            <span className="font-semibold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
              AI 편집 제안
            </span>
          </>
        )}
      </div>

      {/* Diff preview */}
      <div className="px-3 py-2" style={{ backgroundColor: 'var(--bg)' }}>
        <p className="text-[13px] leading-relaxed break-words" style={{ color: 'var(--text)' }}>
          {hunks.map((h, i) => {
            if (h.kind === 'eq') return <span key={i}>{h.token}</span>;
            return (
              <span key={i}>
                {h.del && (
                  <span
                    className="px-0.5 rounded"
                    style={{
                      color: '#fca5a5',
                      backgroundColor: 'rgb(244 63 94 / 0.18)',
                      textDecoration: 'line-through',
                    }}
                  >
                    {h.del}
                  </span>
                )}
                {h.add && (
                  <span
                    className="px-0.5 rounded"
                    style={{ color: '#6ee7b7', backgroundColor: 'rgb(16 185 129 / 0.22)' }}
                  >
                    {h.add}
                  </span>
                )}
              </span>
            );
          })}
        </p>
      </div>

      {patch.error && (
        <div
          className="px-3 py-1.5 text-[11px] border-t"
          style={{ borderColor: 'var(--border)', color: '#fda4af', backgroundColor: 'rgb(244 63 94 / 0.08)' }}
        >
          {patch.error}
        </div>
      )}

      {/* Action row */}
      <div
        className="flex items-center justify-end gap-1.5 px-3 py-2 border-t"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-muted)' }}
      >
        {applied ? (
          <button
            onClick={onUndo}
            disabled={busy}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs hover:bg-bg-muted appearance-none disabled:opacity-50"
            style={{ color: '#fda4af' }}
          >
            <Undo2 size={11} /> 되돌리기
          </button>
        ) : (
          <>
            <button
              onClick={onReject}
              disabled={busy}
              className="px-2.5 py-1 rounded-md text-xs hover:bg-bg-muted appearance-none disabled:opacity-50"
              style={{ color: 'var(--text-muted)' }}
            >
              닫기
            </button>
            <button
              onClick={onApply}
              disabled={busy}
              className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-gradient-to-r from-indigo-500 to-pink-500 text-white hover:opacity-90 disabled:opacity-50 appearance-none"
            >
              <Check size={11} /> {busy ? '적용 중…' : '적용'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
