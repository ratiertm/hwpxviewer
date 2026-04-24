/**
 * EditPanel — the M5R/M6R edit trigger shown when a selection is active.
 *
 * Design intent: a fixed bottom docked panel (out of the way of the overlay)
 * that displays the selected text, lets the user type a replacement, and
 * applies via ``POST /api/edit``. M7R will replace this with the full
 * InlineSelectionMenu + InlineCherryPickDiff port from the prototype; for
 * now this is the smallest UI that exercises the edit pipeline end-to-end.
 */

import { useEffect, useState } from 'react';

interface Props {
  text: string;             // currently selected original text
  mode: 'paragraph' | 'range';
  busy: boolean;            // true while /api/edit is in flight
  error: string | null;     // last edit error, if any
  onApply: (newText: string) => void;
  onCancel: () => void;
}

export function EditPanel({ text, mode, busy, error, onApply, onCancel }: Props) {
  const [draft, setDraft] = useState(text);

  // Reset draft when a new selection lands.
  useEffect(() => {
    setDraft(text);
  }, [text]);

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[min(680px,90vw)] z-20 rounded-lg border border-border bg-bg-panel shadow-xl p-4 space-y-3">
      <div className="flex items-center justify-between text-xs text-text-subtle">
        <span className="uppercase tracking-wider text-[10px]">
          {mode === 'paragraph' ? '문단 편집' : '범위 편집'}
        </span>
        <button
          onClick={onCancel}
          className="text-text-muted hover:text-text-strong text-xs"
          aria-label="취소"
        >
          ✕
        </button>
      </div>
      <div className="text-[11px] text-text-muted">
        원문
        <div className="mt-1 rounded border border-border-subtle bg-bg-subtle px-2 py-1.5 text-text whitespace-pre-wrap break-words max-h-20 overflow-auto">
          {text || <em className="text-text-faint">(빈 문자열)</em>}
        </div>
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={busy}
        rows={2}
        className="w-full rounded border border-input-border bg-input-bg px-2 py-1.5 text-sm font-mono disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-accent/40"
        placeholder="바꿀 텍스트를 입력하세요"
        autoFocus
      />
      {error && (
        <div className="text-xs text-rose-500 bg-rose-500/10 border border-rose-500/30 rounded px-2 py-1">
          {error}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-1.5 text-xs rounded border border-border hover:bg-bg-muted disabled:opacity-50"
        >
          취소
        </button>
        <button
          onClick={() => onApply(draft)}
          disabled={busy || draft === text}
          className="px-3 py-1.5 text-xs rounded bg-accent text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? '적용 중…' : '적용'}
        </button>
      </div>
    </div>
  );
}
