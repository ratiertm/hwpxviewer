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

  // rhwp returns rect heights that cover only the cap-height of text
  // (~13px on a ~23px line). Stretch each rect to the line spacing so the
  // highlight visually covers the whole line including descenders. Use the
  // smallest positive y-delta between consecutive rects (which represents
  // the line spacing for this paragraph).
  const ys = ours.map((r) => r.y).sort((a, b) => a - b);
  const deltas: number[] = [];
  for (let i = 1; i < ys.length; i++) {
    const ya = ys[i - 1];
    const yb = ys[i];
    if (ya !== undefined && yb !== undefined) {
      const d = yb - ya;
      if (d > 0) deltas.push(d);
    }
  }
  const lineHeight = deltas.length > 0 ? Math.min(...deltas) : 0;

  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {ours.map((r, i) => {
        const adjustedHeight = lineHeight > r.height ? lineHeight : r.height;
        return (
          <rect
            key={i}
            x={r.x}
            y={r.y}
            width={r.width}
            height={adjustedHeight}
            fill="rgb(99 102 241 / 0.25)"
            stroke="rgb(79 70 229 / 0.6)"
            strokeWidth={0.6}
          />
        );
      })}
    </svg>
  );
}
