/**
 * SvgPage — renders one rhwp-generated SVG page and lays the selection
 * overlay on top.
 *
 * Layout:
 *   <figure>
 *     <figcaption/>
 *     <div class="flex justify-center">
 *       <div class="relative inline-block">
 *         <div dangerouslySetInnerHTML={svg}/>   <!-- sized by <svg width/height> -->
 *         <SelectionOverlay class="absolute inset-0"/>
 *       </div>
 *     </div>
 *   </figure>
 *
 * rhwp emits ``<svg width="..." height="..." viewBox="...">``, so the inline-block
 * wrapper naturally sizes itself to the page. The overlay svg re-uses the same
 * ``viewBox`` so drawn rects sit pixel-exact on top regardless of display scale.
 */

import { useEffect, useMemo, useRef } from 'react';

import { SelectionOverlay } from '@/components/viewer/SelectionOverlay';
import type { DragPreview } from '@/hooks/useSelection';
import type { SelectionRect } from '@/types';

interface Props {
  index: number;
  svg: string;
  pageCount: number;
  rects: SelectionRect[];
  /** Live drag box (shift+drag) for visual feedback. Only drawn when
   *  ``preview.page === index``. */
  preview: DragPreview | null;
  onBeginDrag: (page: number, svgEl: SVGSVGElement, evt: React.MouseEvent) => void;
  pageRef?: (el: HTMLElement | null) => void;
}

/** Pull ``viewBox="..."`` out of the raw SVG markup so the overlay can align. */
function extractViewBox(svg: string): string | null {
  const m = svg.match(/<svg[^>]*\sviewBox=(["'])([^"']+)\1/i);
  return m ? m[2] ?? null : null;
}

export function SvgPage({ index, svg, pageCount, rects, preview, onBeginDrag, pageRef }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const svgElRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    svgElRef.current = hostRef.current?.querySelector('svg') ?? null;
  }, [svg]);

  const viewBox = useMemo(() => extractViewBox(svg), [svg]);
  const sizeKb = Math.round(svg.length / 1024);

  const handleMouseDown = (evt: React.MouseEvent) => {
    const svgEl = svgElRef.current;
    if (!svgEl) return;
    onBeginDrag(index, svgEl, evt);
  };

  return (
    <figure
      ref={(el) => {
        if (pageRef) pageRef(el);
      }}
      className="bg-paper-bg border border-border rounded shadow-sm overflow-hidden"
    >
      <figcaption className="px-4 py-2 text-[11px] text-text-subtle bg-bg-subtle border-b border-border-subtle flex items-center justify-between">
        <span>Page {index + 1} / {pageCount}</span>
        <span className="tabular-nums">{sizeKb} KB</span>
      </figcaption>
      <div className="flex justify-center p-4 select-none">
        <div
          className="relative inline-block select-none"
          style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
        >
          <div
            ref={hostRef}
            className="cursor-text [&>svg]:block [&>svg]:max-w-full select-none"
            style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
            onMouseDown={handleMouseDown}
            // rhwp SVG is trusted server content.
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <SelectionOverlay rects={rects} page={index} viewBox={viewBox} />
          {preview && preview.page === index && viewBox && (
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox={viewBox}
              preserveAspectRatio="xMidYMid meet"
              aria-hidden
            >
              <rect
                x={preview.x}
                y={preview.y}
                width={preview.width}
                height={preview.height}
                fill="rgb(99 102 241 / 0.12)"
                stroke="rgb(79 70 229 / 0.85)"
                strokeWidth={1.2}
                strokeDasharray="4 3"
              />
            </svg>
          )}
        </div>
      </div>
    </figure>
  );
}
