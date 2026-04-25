/**
 * FloatingDock — bottom-center floating page navigator. Shows current
 * page index + prev/next arrows. Lives above the canvas, below modal
 * UI (z=10), pointer events bypass-aware.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  currentPage: number;       // 0-based
  pageCount: number;
  onJumpToPage: (idx: number) => void;
}

export function FloatingDock({ currentPage, pageCount, onJumpToPage }: Props) {
  if (pageCount === 0) return null;
  const goPrev = () => currentPage > 0 && onJumpToPage(currentPage - 1);
  const goNext = () => currentPage < pageCount - 1 && onJumpToPage(currentPage + 1);
  return (
    <div
      className="fixed bottom-10 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 px-2 py-1 rounded-full border shadow-xl backdrop-blur-xl"
      style={{ backgroundColor: 'var(--bg-dock)', borderColor: 'var(--border)' }}
    >
      <DockBtn onClick={goPrev} disabled={currentPage <= 0} ariaLabel="이전 페이지">
        <ChevronLeft size={14} />
      </DockBtn>
      <div
        className="px-2 text-[11px] tabular-nums select-none"
        style={{ color: 'var(--text-muted)' }}
      >
        {currentPage + 1} / {pageCount}
      </div>
      <DockBtn onClick={goNext} disabled={currentPage >= pageCount - 1} ariaLabel="다음 페이지">
        <ChevronRight size={14} />
      </DockBtn>
    </div>
  );
}

function DockBtn({
  children,
  onClick,
  disabled,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-bg-muted disabled:opacity-30 disabled:cursor-not-allowed appearance-none"
      style={{ color: 'var(--text-muted)' }}
    >
      {children}
    </button>
  );
}
