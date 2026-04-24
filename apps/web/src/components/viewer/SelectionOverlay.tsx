/**
 * SelectionOverlay — paints semi-transparent indigo rectangles over a page's
 * SVG to highlight the currently selected text run.
 *
 * Rects come from the backend in SVG user-space (same space the page SVG
 * itself uses) — we wrap them in an overlay ``<svg>`` that shares the same
 * ``viewBox`` so alignment is exact regardless of display zoom.
 *
 * Positioning: the overlay is absolute within the page container; the parent
 * is expected to position this sibling after the SVG with ``relative``.
 */

import type { SelectionRect } from '@/types';

interface Props {
  rects: SelectionRect[];
  /** The page index this overlay belongs to; rects from other pages are skipped. */
  page: number;
  /** The SVG viewBox the overlay should share with the underlying page. */
  viewBox: string | null;
}

export function SelectionOverlay({ rects, page, viewBox }: Props) {
  const ours = rects.filter((r) => r.page === page);
  if (ours.length === 0 || !viewBox) return null;
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {ours.map((r, i) => (
        <rect
          key={i}
          x={r.x}
          y={r.y}
          width={r.width}
          height={r.height}
          fill="rgb(99 102 241 / 0.28)"
          stroke="rgb(79 70 229 / 0.7)"
          strokeWidth={1}
        />
      ))}
    </svg>
  );
}
