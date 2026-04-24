/**
 * useSelection — select text on a rendered rhwp SVG page.
 *
 * Two interaction modes (design decision 2026-04-25):
 *   - **Plain click** → select the whole paragraph the click landed in.
 *   - **Shift + drag** → partial selection inside a single paragraph, using
 *     two hit-tests to bound the character range.
 *
 * Rationale: the EditPanel UX reads the whole selection as a single textarea,
 * so sub-paragraph precision is rarely useful. Paragraph-as-default matches
 * the typical AI-rewrite flow ("이 문단 다시 써줘") while Shift+drag preserves
 * the precise-edit capability for M7R's InlineCherryPickDiff.
 *
 * Coordinate mapping uses ``SVGGraphicsElement.getScreenCTM().inverse()`` to
 * convert client (screen) coordinates into the SVG user space that rhwp's
 * ``hit_test`` WASM export expects.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ApiError,
  getParagraph,
  getSelectionRects,
  getTextRange,
  hitTest,
} from '@/api/document';
import type { RunLocation, Selection, SelectionRect } from '@/types';

interface ActiveSelection {
  page: number;
  selection: Selection;
  text: string;
  rects: SelectionRect[];
  /** "paragraph" for single-click, "range" for shift-drag. Helps the UI hint
   *  the user about which mode produced the current highlight. */
  mode: 'paragraph' | 'range';
}

interface PendingDrag {
  page: number;
  svgEl: SVGSVGElement;
  startSvg: { x: number; y: number };
  clientStart: { x: number; y: number };
  /** Shift key held at mousedown. mouseup is also consulted — users often
   *  press shift *after* starting the drag. */
  shift: boolean;
}

/** Live drag preview box in SVG user-space. Re-rendered on every mousemove
 *  while a shift-drag is in flight so the user sees immediate feedback. */
export interface DragPreview {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

const DRAG_MIN_PIXELS = 3;

function toSvgSpace(svgEl: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const pt = svgEl.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svgEl.getScreenCTM();
  if (!ctm) return { x: clientX, y: clientY };
  const mapped = pt.matrixTransform(ctm.inverse());
  return { x: mapped.x, y: mapped.y };
}

/** Order two RunLocations so the earlier one is returned first.
 *  Cross-cell ranges are rejected upstream — ordering only matters within
 *  the same paragraph. */
export function orderLocations(a: RunLocation, b: RunLocation): [RunLocation, RunLocation] {
  if (a.sec !== b.sec) return a.sec < b.sec ? [a, b] : [b, a];
  if (a.para !== b.para) return a.para < b.para ? [a, b] : [b, a];
  return a.charOffset <= b.charOffset ? [a, b] : [b, a];
}

/** Two RunLocations refer to the same underlying paragraph (body or cell). */
export function sameParagraph(a: RunLocation, b: RunLocation): boolean {
  if (a.sec !== b.sec || a.para !== b.para) return false;
  const ac = a.cell ?? null;
  const bc = b.cell ?? null;
  if (!ac && !bc) return true;
  if (!ac || !bc) return false;
  return (
    ac.parentParaIndex === bc.parentParaIndex &&
    ac.controlIndex === bc.controlIndex &&
    ac.cellIndex === bc.cellIndex
  );
}

export function lengthBetween(a: RunLocation, b: RunLocation): number | null {
  if (!sameParagraph(a, b)) return null;  // cross-paragraph / cross-cell unsupported
  return Math.max(0, b.charOffset - a.charOffset);
}

export interface UseSelectionApi {
  active: ActiveSelection | null;
  busy: boolean;
  error: string | null;
  /** Live drag rectangle (shift+drag only) for visual feedback. */
  preview: DragPreview | null;
  /** Record the mousedown. Selection finalizes on mouseup. */
  beginDrag: (page: number, svgEl: SVGSVGElement, evt: React.MouseEvent) => void;
  clear: () => void;
  /** Re-run rects + text-range for the current selection (after an edit
   *  shifts content). */
  refresh: () => Promise<void>;
}

export function useSelection(uploadId: string | null): UseSelectionApi {
  const [active, setActive] = useState<ActiveSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const dragRef = useRef<PendingDrag | null>(null);

  const clear = useCallback(() => {
    setActive(null);
    setError(null);
  }, []);

  const selectParagraph = useCallback(
    async (page: number, svgEl: SVGSVGElement, clientX: number, clientY: number) => {
      if (!uploadId) return;
      const svgPt = toSvgSpace(svgEl, clientX, clientY);
      setBusy(true);
      setError(null);
      try {
        const loc = await hitTest(uploadId, page, svgPt.x, svgPt.y);
        if (!loc) {
          // Clicked on blank area — clear any existing highlight.
          setActive(null);
          return;
        }
        const { length } = await getParagraph(uploadId, loc.sec, loc.para, loc.cell ?? null);
        if (length === 0) {
          setActive(null);
          return;
        }
        const selection: Selection = {
          start: { sec: loc.sec, para: loc.para, charOffset: 0, cell: loc.cell ?? null },
          length,
        };
        const [rects, text] = await Promise.all([
          getSelectionRects(uploadId, selection),
          getTextRange(uploadId, selection),
        ]);
        setActive({ page, selection, rects, text, mode: 'paragraph' });
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
        setError(msg);
      } finally {
        setBusy(false);
      }
    },
    [uploadId],
  );

  const selectRange = useCallback(
    async (
      page: number,
      svgEl: SVGSVGElement,
      start: { x: number; y: number },
      end: { x: number; y: number },
    ) => {
      if (!uploadId) return;
      const startSvg = start;
      const endSvg = toSvgSpace(svgEl, end.x, end.y);
      setBusy(true);
      setError(null);
      try {
        const [startLoc, endLoc] = await Promise.all([
          hitTest(uploadId, page, startSvg.x, startSvg.y),
          hitTest(uploadId, page, endSvg.x, endSvg.y),
        ]);
        if (!startLoc || !endLoc) {
          setError('선택 범위가 유효한 텍스트 영역이 아닙니다.');
          return;
        }
        const [aLoc, bLoc] = orderLocations(startLoc, endLoc);
        const length = lengthBetween(aLoc, bLoc);
        if (length === null) {
          setError('여러 단락에 걸친 선택은 아직 지원하지 않습니다.');
          return;
        }
        if (length === 0) {
          return;
        }
        const selection: Selection = { start: aLoc, length };
        const [rects, text] = await Promise.all([
          getSelectionRects(uploadId, selection),
          getTextRange(uploadId, selection),
        ]);
        setActive({ page, selection, rects, text, mode: 'range' });
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
        setError(msg);
      } finally {
        setBusy(false);
      }
    },
    [uploadId],
  );

  // Global mousemove (live preview) + mouseup (finalize) — attached to the
  // window so the drag completes even if the pointer leaves the SVG.
  useEffect(() => {
    function onMove(evt: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const shiftNow = drag.shift || evt.shiftKey;
      if (!shiftNow) {
        // Plain drag produces no preview — either it'll be a click on release,
        // or the user is reading/scrolling. Don't clutter the overlay.
        if (preview !== null) setPreview(null);
        return;
      }
      const cur = toSvgSpace(drag.svgEl, evt.clientX, evt.clientY);
      setPreview({
        page: drag.page,
        x: Math.min(drag.startSvg.x, cur.x),
        y: Math.min(drag.startSvg.y, cur.y),
        width: Math.abs(cur.x - drag.startSvg.x),
        height: Math.abs(cur.y - drag.startSvg.y),
      });
    }

    function onUp(evt: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      setPreview(null);
      const dx = evt.clientX - drag.clientStart.x;
      const dy = evt.clientY - drag.clientStart.y;
      const moved = Math.hypot(dx, dy) >= DRAG_MIN_PIXELS;
      // Shift state at EITHER end triggers range selection — users often
      // press shift after beginning the drag, which is natural muscle memory.
      const shiftEffective = drag.shift || evt.shiftKey;
      if (shiftEffective && moved) {
        void selectRange(drag.page, drag.svgEl, drag.startSvg, { x: evt.clientX, y: evt.clientY });
      } else if (!moved) {
        // Plain click (shift or not) → paragraph selection.
        void selectParagraph(drag.page, drag.svgEl, evt.clientX, evt.clientY);
      }
      // Drag without shift is intentionally a no-op.
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [selectParagraph, selectRange, preview]);

  const beginDrag = useCallback(
    (page: number, svgEl: SVGSVGElement, evt: React.MouseEvent) => {
      if (!uploadId) return;
      if (evt.button !== 0) return;
      // ALWAYS preventDefault: the rhwp SVG contains real ``<text>`` nodes,
      // so the browser's native text-selection handler will otherwise fight
      // our mouse capture and produce ghost highlights that swallow the
      // shift-drag gesture. Pair this with ``user-select: none`` on the
      // wrapper (see SvgPage) for belt-and-suspenders.
      evt.preventDefault();
      const startSvg = toSvgSpace(svgEl, evt.clientX, evt.clientY);
      dragRef.current = {
        page,
        svgEl,
        startSvg,
        clientStart: { x: evt.clientX, y: evt.clientY },
        shift: evt.shiftKey,
      };
      setError(null);
    },
    [uploadId],
  );

  const refresh = useCallback(async () => {
    if (!uploadId || !active) return;
    try {
      const [rects, text] = await Promise.all([
        getSelectionRects(uploadId, active.selection),
        getTextRange(uploadId, active.selection),
      ]);
      setActive({ ...active, rects, text });
    } catch {
      setActive(null);
    }
  }, [uploadId, active]);

  return { active, busy, error, preview, beginDrag, clear, refresh };
}
