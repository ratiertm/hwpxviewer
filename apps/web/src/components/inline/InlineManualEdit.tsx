/**
 * InlineManualEdit — direct-typing editor for the current selection.
 *
 * Same slot as ``InlineCherryPickDiff`` but skips Claude entirely. The user
 * sees a textarea pre-filled with their selected text, edits it freely, and
 * the parent commits via the existing ``acceptInlineEdit`` path so the edit
 * lands in history alongside AI edits.
 *
 *   Enter  — apply (Shift+Enter inserts a newline)
 *   Esc    — cancel
 */

import { useEffect, useRef, useState } from 'react';
import { Pencil, X } from 'lucide-react';

interface Props {
  original: string;
  busy: boolean;
  onAccept: (finalText: string) => void;
  onCancel: () => void;
}

export function InlineManualEdit({ original, busy, onAccept, onCancel }: Props) {
  const [value, setValue] = useState(original);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setValue(original);
  }, [original]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    // Select all so the user can immediately type to replace.
    ta.select();
  }, []);

  // Escape cancels even when textarea has focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        onCancel();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  const trimmed = value;
  const changed = trimmed !== original;
  const canApply = changed && !busy;

  const handleEnter = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter without modifier → apply. Shift+Enter → newline (parity with chat).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canApply) onAccept(trimmed);
    }
  };

  return (
    <div
      className="rounded-xl border shadow-2xl backdrop-blur-xl overflow-hidden"
      style={{ backgroundColor: 'var(--bg-dock)', borderColor: 'var(--border)' }}
    >
      <div
        className="flex items-center justify-between px-4 py-2 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-1.5">
          <Pencil size={12} style={{ color: 'var(--accent)' }} />
          <span
            className="text-xs font-medium"
            style={{ color: 'var(--text-strong)' }}
          >
            직접 수정
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
            — 선택한 텍스트를 그대로 편집
          </span>
        </div>
        <button
          onClick={onCancel}
          disabled={busy}
          className="w-6 h-6 rounded hover:bg-bg-muted flex items-center justify-center disabled:opacity-30 appearance-none"
          style={{ color: 'var(--text-muted)' }}
          aria-label="취소"
        >
          <X size={12} />
        </button>
      </div>

      <div className="px-4 py-3 space-y-2">
        <div
          className="text-[10px] uppercase tracking-wider"
          style={{ color: 'var(--text-faint)' }}
        >
          원본
        </div>
        <div
          className="text-xs whitespace-pre-wrap break-words rounded border px-2 py-1.5"
          style={{
            backgroundColor: 'var(--bg-subtle)',
            borderColor: 'var(--border)',
            color: 'var(--text-muted)',
            maxHeight: 80,
            overflowY: 'auto',
          }}
        >
          {original || <span style={{ color: 'var(--text-faint)' }}>(빈 텍스트)</span>}
        </div>

        <div
          className="text-[10px] uppercase tracking-wider mt-2"
          style={{ color: 'var(--text-faint)' }}
        >
          새 내용
        </div>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleEnter}
          rows={Math.min(8, Math.max(2, value.split('\n').length))}
          disabled={busy}
          className="w-full rounded px-2 py-1.5 text-sm resize-y focus:outline-none focus:ring-2"
          style={{
            backgroundColor: 'var(--bg)',
            borderWidth: '1px',
            borderColor: 'var(--accent)',
            color: 'var(--text)',
          }}
        />
      </div>

      <div
        className="flex items-center justify-between gap-2 px-4 py-2 border-t"
        style={{ borderColor: 'var(--border)' }}
      >
        <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
          Enter: 적용 · Shift+Enter: 줄바꿈 · Esc: 취소
          {changed ? '' : ' · (변경 없음)'}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1 rounded-md text-xs hover:bg-bg-muted appearance-none disabled:opacity-50"
            style={{ color: 'var(--text-muted)' }}
          >
            취소
          </button>
          <button
            onClick={() => canApply && onAccept(trimmed)}
            disabled={!canApply}
            className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium appearance-none disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)', color: 'white' }}
          >
            {busy ? '적용 중…' : '적용'}
          </button>
        </div>
      </div>
    </div>
  );
}
