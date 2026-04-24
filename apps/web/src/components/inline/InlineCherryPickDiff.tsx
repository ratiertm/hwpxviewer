/**
 * InlineCherryPickDiff — side-by-side diff of ``original`` vs. AI
 * ``suggestion`` where each change hunk is a checkbox-style toggle. The user
 * mixes-and-matches accepted hunks, final text is reconstructed live, and the
 * "적용" button commits it via ``/api/edit``.
 *
 * Ported from ``hwpx-viewer-v8.jsx`` §1130. Reuses the existing ``diffTokens``
 * / ``groupHunks`` / ``reconstructText`` engine from ``lib/diff/text``
 * (preserved in v0.3 intentionally — see ``types/index.ts``).
 */

import { Check, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';

import { diffTokens, groupHunks, reconstructText } from '@/lib/diff/text';

interface Props {
  original: string;
  suggestion: string;
  busy?: boolean;
  onAccept: (finalText: string) => void;
  onReject: () => void;
}

export function InlineCherryPickDiff({
  original,
  suggestion,
  busy = false,
  onAccept,
  onReject,
}: Props) {
  const ops = useMemo(() => diffTokens(original, suggestion), [original, suggestion]);
  const hunks = useMemo(() => groupHunks(ops), [ops]);
  const changeHunks = useMemo(() => hunks.filter((h) => h.kind === 'change'), [hunks]);
  const [acceptedIds, setAcceptedIds] = useState<Set<number>>(
    () => new Set(changeHunks.map((h) => (h.kind === 'change' ? h.id : -1)).filter((id) => id >= 0)),
  );

  const toggleHunk = (id: number) =>
    setAcceptedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const acceptAll = () =>
    setAcceptedIds(new Set(changeHunks.map((h) => (h.kind === 'change' ? h.id : -1)).filter((id) => id >= 0)));
  const rejectAll = () => setAcceptedIds(new Set());

  const finalText = useMemo(() => reconstructText(hunks, acceptedIds), [hunks, acceptedIds]);

  // Explicit text color on every visible element — Tailwind's `text-text`
  // token is custom and, while technically inheritable, some browsers
  // (notably Chromium-based with shadow DOM extensions) break inheritance
  // into nested <button>s. Inline style is the belt-and-suspenders fix.
  const baseTextStyle = { color: 'var(--text)' } as const;
  const mutedTextStyle = { color: 'var(--text-muted)' } as const;
  const faintTextStyle = { color: 'var(--text-faint)' } as const;
  const accentStyle = { color: 'var(--accent)' } as const;

  return (
    <div
      className="rounded-lg border overflow-hidden shadow-2xl"
      style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--accent)', ...baseTextStyle }}
    >
      <div
        className="px-3 py-2 border-b flex items-center justify-between"
        style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-1.5">
          <Sparkles size={11} style={accentStyle} />
          <span className="text-xs uppercase tracking-wider font-semibold" style={accentStyle}>
            AI 제안
          </span>
          <span className="text-xs ml-1" style={faintTextStyle}>
            · 클릭으로 부분 수락 ({acceptedIds.size}/{changeHunks.length})
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={rejectAll}
            className="px-2 py-0.5 rounded text-xs hover:bg-bg-muted appearance-none"
            style={mutedTextStyle}
          >
            모두 거부
          </button>
          <button
            onClick={acceptAll}
            className="px-2 py-0.5 rounded text-xs hover:bg-bg-muted appearance-none"
            style={mutedTextStyle}
          >
            모두 수락
          </button>
        </div>
      </div>

      <div className="px-3 py-3" style={{ backgroundColor: 'var(--bg-muted)' }}>
        <p className="text-sm leading-relaxed break-words" style={baseTextStyle}>
          {hunks.length === 0 && (
            <em style={faintTextStyle}>(변경 내용이 없습니다)</em>
          )}
          {hunks.map((h, i) => {
            if (h.kind === 'eq') return <span key={i} style={baseTextStyle}>{h.token}</span>;
            const accepted = acceptedIds.has(h.id);
            return (
              <span key={i} className="inline-flex items-baseline gap-px">
                {h.del && (
                  <button
                    onClick={() => toggleHunk(h.id)}
                    className="px-0.5 rounded transition-all cursor-pointer appearance-none"
                    style={
                      accepted
                        ? { color: 'var(--text-faint)', textDecoration: 'line-through', opacity: 0.5 }
                        : { color: '#fca5a5', backgroundColor: 'rgb(244 63 94 / 0.2)' }
                    }
                    title={accepted ? '제거됨 (클릭하여 되돌리기)' : '삭제 대상 (클릭하여 유지)'}
                  >
                    {h.del}
                  </button>
                )}
                {h.add && (
                  <button
                    onClick={() => toggleHunk(h.id)}
                    className="px-0.5 rounded transition-all cursor-pointer appearance-none"
                    style={
                      accepted
                        ? { color: '#6ee7b7', backgroundColor: 'rgb(16 185 129 / 0.25)' }
                        : { color: 'var(--text-faint)', opacity: 0.4 }
                    }
                    title={accepted ? '추가됨 (클릭하여 제외)' : '제외됨 (클릭하여 추가)'}
                  >
                    {h.add}
                  </button>
                )}
              </span>
            );
          })}
        </p>
      </div>

      <div
        className="px-3 py-2.5 border-t"
        style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
      >
        <div className="text-[10px] uppercase tracking-wider mb-1" style={faintTextStyle}>
          최종 결과
        </div>
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words" style={baseTextStyle}>
          {finalText || <em style={faintTextStyle}>(빈 결과)</em>}
        </p>
      </div>

      <div
        className="flex items-center justify-end gap-2 px-3 py-2 border-t"
        style={{ backgroundColor: 'var(--bg-muted)', borderColor: 'var(--border)' }}
      >
        <button
          onClick={onReject}
          disabled={busy}
          className="px-3 py-1 rounded-md text-xs hover:bg-bg-muted disabled:opacity-50 appearance-none"
          style={mutedTextStyle}
        >
          취소
        </button>
        <button
          onClick={() => onAccept(finalText)}
          disabled={busy || finalText === original}
          className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-gradient-to-r from-indigo-500 to-pink-500 text-white hover:opacity-90 disabled:opacity-50 appearance-none"
          style={{ color: 'white' }}
        >
          <Check size={11} /> {busy ? '적용 중…' : '적용'}
        </button>
      </div>
    </div>
  );
}
