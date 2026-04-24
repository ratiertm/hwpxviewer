/**
 * InlineSelectionMenu — floating AI-action bar that pops above a live
 * selection, offering 다시 쓰기 / 간결하게 / 영어로.
 *
 * Ported from ``hwpx-viewer-v8.jsx`` §1060, adapted for v0.3 Run-coord
 * selection. The parent is responsible for positioning via ``anchor``
 * (client pixel coords of the selection's top-center).
 */

import { Languages, MessageSquarePlus, Minimize, Pencil, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { InlineAction, InlineActionId } from '@/types';

const INLINE_ACTIONS: InlineAction[] = [
  { id: 'rewrite', label: '다시 쓰기', icon: Pencil },
  { id: 'shorten', label: '간결하게', icon: Minimize },
  { id: 'translate', label: '영어로', icon: Languages },
];

/** Quick presets the user can one-click instead of typing a free-form guide. */
const REWRITE_PRESETS: ReadonlyArray<{ label: string; guide: string }> = [
  { label: '더 격식있게', guide: '문체를 더 격식 있고 공공 문서 톤으로' },
  { label: '더 자연스럽게', guide: '문법·어휘를 더 자연스럽게' },
  { label: '더 임팩트있게', guide: '핵심을 더 명확하고 임팩트 있게' },
  { label: '더 쉽게', guide: '더 쉽고 간결한 말로' },
];

interface Props {
  /** Pixel coords (client) for the menu anchor — usually top of the selection. */
  anchor: { x: number; y: number };
  onAction: (id: InlineActionId, guide?: string) => void;
  /** Invoked when the user clicks "대화로" — the selected text should be
   *  attached to the chat input as a quoted block (parent decides how). */
  onAttachToChat: () => void;
  onClose: () => void;
}

export function InlineSelectionMenu({ anchor, onAction, onAttachToChat, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [adjustedX, setAdjustedX] = useState(anchor.x);
  const [mode, setMode] = useState<'actions' | 'rewrite-guide'>('actions');
  const [guide, setGuide] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Keep the menu inside the viewport.
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const padding = 16;
    let x = anchor.x;
    if (x + rect.width / 2 > window.innerWidth - padding) {
      x = window.innerWidth - rect.width / 2 - padding;
    }
    if (x - rect.width / 2 < padding) {
      x = rect.width / 2 + padding;
    }
    setAdjustedX(x);
  }, [anchor.x, mode]);

  // Close on Escape (or step back from guide mode to action mode).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (mode === 'rewrite-guide') setMode('actions');
        else onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, mode]);

  // Autofocus the guide textarea when entering rewrite-guide mode.
  useEffect(() => {
    if (mode === 'rewrite-guide') inputRef.current?.focus();
  }, [mode]);

  const actions = useMemo(() => INLINE_ACTIONS, []);

  const submitGuide = () => {
    // Empty guide is OK — the default prompt ("선택 부분을 같은 의미로 더 자연스럽게")
    // takes over server-side. We just run rewrite with whatever the user typed.
    onAction('rewrite', guide.trim() || undefined);
  };

  if (mode === 'rewrite-guide') {
    return (
      <div
        ref={menuRef}
        className="fixed z-40 -translate-x-1/2 -translate-y-full"
        style={{ left: adjustedX, top: anchor.y }}
      >
        <div
          className="w-[min(460px,92vw)] rounded-xl border shadow-2xl backdrop-blur-xl"
          style={{
            backgroundColor: 'var(--bg-dock)',
            borderColor: 'var(--border)',
            color: 'var(--text)',
          }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-1.5">
              <Sparkles size={12} style={{ color: 'var(--accent)' }} />
              <span className="text-xs font-medium" style={{ color: 'var(--accent)' }}>AI 다시 쓰기</span>
              <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                — 원하는 방향을 알려주세요 (선택)
              </span>
            </div>
            <button
              onClick={() => setMode('actions')}
              className="w-5 h-5 rounded hover:bg-bg-muted flex items-center justify-center appearance-none"
              style={{ color: 'var(--text-muted)' }}
              aria-label="뒤로"
            >
              <X size={12} />
            </button>
          </div>
          <div className="px-3 pt-2.5 pb-1.5">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {REWRITE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onAction('rewrite', p.guide);
                  }}
                  className="px-2 py-1 rounded-md text-[11px] border hover:bg-bg-muted appearance-none"
                  style={{
                    borderColor: 'var(--border)',
                    color: 'var(--text-muted)',
                    backgroundColor: 'var(--bg-subtle)',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <textarea
              ref={inputRef}
              value={guide}
              onChange={(e) => setGuide(e.target.value)}
              onKeyDown={(e) => {
                // Enter without Shift → submit. Shift+Enter → newline (consistent
                // with the ChatPanel convention in CLAUDE.md §2 ALWAYS).
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submitGuide();
                }
              }}
              rows={2}
              placeholder={'예: "이 문단을 더 격식 있게" / "관공서 양식 어투로" / "수동태를 능동태로"\n비워두면 기본 다시 쓰기가 실행됩니다.'}
              className="w-full rounded-md px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 appearance-none"
              style={{
                backgroundColor: 'var(--input-bg)',
                borderWidth: '1px',
                borderColor: 'var(--border)',
                color: 'var(--text)',
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-t" style={{ borderColor: 'var(--border)' }}>
            <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
              Enter: 실행 · Shift+Enter: 줄바꿈 · Esc: 취소
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setMode('actions')}
                className="px-2.5 py-1 rounded-md text-xs hover:bg-bg-muted appearance-none"
                style={{ color: 'var(--text-muted)' }}
              >
                뒤로
              </button>
              <button
                onClick={submitGuide}
                className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-gradient-to-r from-indigo-500 to-pink-500 appearance-none"
                style={{ color: 'white' }}
              >
                <Sparkles size={11} /> 실행
              </button>
            </div>
          </div>
        </div>
        <div
          className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 rotate-45"
          style={{ backgroundColor: 'var(--bg-dock)' }}
          aria-hidden
        />
      </div>
    );
  }

  // mode === 'actions' — the compact pill.
  return (
    <div
      ref={menuRef}
      className="fixed z-40 -translate-x-1/2 -translate-y-full"
      style={{ left: adjustedX, top: anchor.y }}
    >
      <div
        className="flex items-center gap-0.5 px-1.5 py-1.5 rounded-xl border backdrop-blur-xl shadow-xl"
        style={{ backgroundColor: 'var(--bg-dock)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-1.5 px-2 py-1">
          <Sparkles size={11} style={{ color: 'var(--accent)' }} />
          <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>AI</span>
        </div>
        <div className="w-px h-4" style={{ backgroundColor: 'var(--border-subtle)' }} />
        {actions.map((a) => {
          const Icon = a.icon as typeof Pencil;
          const isRewrite = a.id === 'rewrite';
          return (
            <button
              key={a.id}
              onMouseDown={(e) => {
                // Use mousedown (not click) so the click doesn't re-trigger the
                // drag-selection pipeline underneath.
                e.preventDefault();
                e.stopPropagation();
                // "다시 쓰기" opens the guide panel first; the other two are
                // self-explanatory one-shots.
                if (isRewrite) setMode('rewrite-guide');
                else onAction(a.id);
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs hover:bg-bg-muted appearance-none"
              style={{ color: 'var(--text-muted)' }}
            >
              <Icon size={11} />
              {a.label}
              {isRewrite && <span className="text-[9px] opacity-60 ml-0.5">▾</span>}
            </button>
          );
        })}
        <div className="w-px h-4" style={{ backgroundColor: 'var(--border-subtle)' }} />
        {/* "대화로" — attach selection to chat instead of running an auto-rewrite. */}
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAttachToChat();
          }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs hover:bg-bg-muted appearance-none"
          style={{ color: 'var(--text-muted)' }}
          title="선택 영역을 채팅에 첨부"
        >
          <MessageSquarePlus size={11} />
          대화로
        </button>
      </div>
      <div
        className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 rotate-45"
        style={{ backgroundColor: 'var(--bg-dock)' }}
        aria-hidden
      />
    </div>
  );
}
