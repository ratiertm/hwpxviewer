/**
 * HwpxViewer — M3R/M4R/M5R/M6R smoke viewer.
 *
 * Still a single-file smoke harness; the proper layout (Sidebar, ChatPanel,
 * HistoryPanel, FloatingDock) lands in M7R when we port the prototype. What
 * this file covers today:
 *   - upload .hwpx → page count (M4R)
 *   - render every page as rhwp SVG with fonts embedded (M3R)
 *   - drag-to-select text → indigo overlay via /api/hit-test + /api/selection-rects (M5R)
 *   - edit panel: replace selected text → /api/edit → re-render affected pages (M6R)
 *   - undo toggle per history entry → /api/undo (M6R)
 *   - download current HWPX bytes (M4R)
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import {
  ApiError,
  applyEdit,
  downloadUrl,
  fetchPageSvg,
  undoEdit,
  uploadHwpx,
} from '@/api/document';
import { EditPanel } from '@/components/viewer/EditPanel';
import { HistoryList } from '@/components/viewer/HistoryList';
import { SvgPage } from '@/components/viewer/SvgPage';
import { useSelection } from '@/hooks/useSelection';
import type { DocumentInfo, HistoryEntry } from '@/types';

interface LoadedDoc {
  info: DocumentInfo;
  svgs: string[];
}

/** Strip fixed width/height so SVG scales to the thumbnail container. */
function miniFrom(svg: string): string {
  return svg
    .replace(/<svg([^>]*?)\swidth="[^"]*"/, '<svg$1')
    .replace(/<svg([^>]*?)\sheight="[^"]*"/, '<svg$1')
    .replace(/<svg\b/, '<svg preserveAspectRatio="xMidYMid meet" ');
}

export default function App() {
  const [doc, setDoc] = useState<LoadedDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activePage, setActivePage] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [undoBusyId, setUndoBusyId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pageRefs = useRef<Record<number, HTMLElement | null>>({});

  const selection = useSelection(doc?.info.uploadId ?? null);

  const miniSvgs = useMemo(() => doc?.svgs.map(miniFrom) ?? [], [doc]);

  const jumpToPage = useCallback((idx: number) => {
    const el = pageRefs.current[idx];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActivePage(idx);
  }, []);

  const loadAllPages = useCallback(
    async (info: DocumentInfo, version?: number): Promise<string[]> => {
      return await Promise.all(
        Array.from({ length: info.pageCount }, (_, i) => fetchPageSvg(info.uploadId, i, version)),
      );
    },
    [],
  );

  const handleFile = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    setDoc(null);
    setHistory([]);
    selection.clear();
    try {
      const info = await uploadHwpx(file);
      const svgs = await loadAllPages(info);
      setDoc({ info, svgs });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [loadAllPages, selection]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) handleFile(f);
    },
    [handleFile],
  );

  const onDownload = useCallback(() => {
    if (!doc) return;
    window.location.href = downloadUrl(doc.info.uploadId);
  }, [doc]);

  // --- edit/undo pipeline -------------------------------------------------

  const refreshAffectedPages = useCallback(
    async (info: DocumentInfo, pages: number[]) => {
      const next = [...(doc?.svgs ?? [])];
      // De-duplicate; fetch each affected page in parallel.
      const unique = Array.from(new Set(pages)).filter((p) => p >= 0 && p < info.pageCount);
      const results = await Promise.all(
        unique.map(async (p) => [p, await fetchPageSvg(info.uploadId, p, info.version)] as const),
      );
      for (const [p, svg] of results) next[p] = svg;
      setDoc({ info, svgs: next });
    },
    [doc],
  );

  const onApplyEdit = useCallback(
    async (newText: string) => {
      if (!doc || !selection.active) return;
      setEditBusy(true);
      setEditError(null);
      try {
        const result = await applyEdit(doc.info.uploadId, selection.active.selection, newText);
        setHistory((prev) => [
          {
            id: result.editId,
            ts: Date.now(),
            selection: selection.active!.selection,
            oldText: selection.active!.text,
            newText,
            action: '수기 편집',
            undone: false,
          },
          ...prev,
        ]);
        await refreshAffectedPages(result.document, result.affectedPages);
        selection.clear();
      } catch (e) {
        setEditError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
      } finally {
        setEditBusy(false);
      }
    },
    [doc, selection, refreshAffectedPages],
  );

  const onToggleHistory = useCallback(
    async (editId: number) => {
      if (!doc) return;
      setUndoBusyId(editId);
      try {
        const result = await undoEdit(doc.info.uploadId, editId);
        setHistory((prev) =>
          prev.map((e) => (e.id === editId ? { ...e, undone: !e.undone } : e)),
        );
        await refreshAffectedPages(result.document, result.affectedPages);
        // The selection range may no longer match original text; refresh it.
        await selection.refresh();
      } catch (e) {
        setEditError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
      } finally {
        setUndoBusyId(null);
      }
    },
    [doc, refreshAffectedPages, selection],
  );

  // ----------------------------------------------------------------------

  return (
    <main className="h-screen bg-bg text-text flex flex-col overflow-hidden">
      <header className="border-b border-border-subtle bg-bg-subtle px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {doc && (
            <button
              onClick={() => setSidebarOpen((s) => !s)}
              title="사이드바"
              className="w-7 h-7 rounded border border-border hover:bg-bg-muted text-xs tabular-nums"
            >
              {sidebarOpen ? '◀' : '▶'}
            </button>
          )}
          <div>
            <h1 className="text-sm font-semibold text-text-strong">HWPX Viewer</h1>
            <p className="text-[11px] text-text-subtle">
              클릭 = 문단 선택 · Shift+드래그 = 범위 선택 · 편집 · 되돌리기
            </p>
          </div>
        </div>
        {doc && (
          <div className="flex items-center gap-3 text-xs text-text-muted">
            <span className="truncate max-w-[200px]">{doc.info.fileName}</span>
            <span>
              {doc.info.pageCount}페이지 · v{doc.info.version}
            </span>
            <button
              onClick={onDownload}
              className="px-3 py-1 rounded-md bg-accent text-white hover:opacity-90"
            >
              다운로드
            </button>
            <button
              onClick={() => {
                setDoc(null);
                setError(null);
                setHistory([]);
                selection.clear();
              }}
              className="px-3 py-1 rounded-md border border-border hover:bg-bg-muted"
            >
              새 파일
            </button>
          </div>
        )}
      </header>

      {!doc && (
        <section
          className={`flex-1 flex items-center justify-center p-8 transition-colors ${
            dragOver ? 'bg-bg-muted' : ''
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <div
            className={`max-w-xl w-full border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
              dragOver ? 'border-accent' : 'border-border'
            }`}
          >
            <div className="text-base font-medium text-text-strong mb-2">
              .hwpx 파일을 여기에 놓거나 클릭하세요
            </div>
            <div className="text-xs text-text-muted mb-6">
              rhwp WASM이 서버에서 SVG로 렌더링하고, 드래그로 텍스트를 선택해 편집할 수 있습니다.
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="px-4 py-2 rounded-md bg-accent text-white font-medium disabled:opacity-50"
            >
              {busy ? '업로드 중…' : '파일 선택'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".hwpx,.hwp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            {error && (
              <div className="mt-6 text-sm text-rose-500 bg-rose-500/10 border border-rose-500/30 rounded px-3 py-2">
                {error}
              </div>
            )}
          </div>
        </section>
      )}

      {doc && (
        <div className="flex-1 flex overflow-hidden">
          <aside
            className={`${sidebarOpen ? 'w-64' : 'w-0'} flex-shrink-0 border-r border-border-subtle bg-bg-subtle overflow-hidden transition-[width] duration-200 flex flex-col`}
          >
            <div className="w-64 flex-1 overflow-y-auto p-2 space-y-2">
              <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-text-subtle">
                Pages · {doc.info.pageCount}
              </div>
              {miniSvgs.map((mini, i) => (
                <button
                  key={i}
                  onClick={() => jumpToPage(i)}
                  className={`w-full group flex flex-col items-stretch rounded border overflow-hidden transition-colors ${
                    activePage === i
                      ? 'border-accent ring-2 ring-accent/30'
                      : 'border-border hover:border-text-muted'
                  }`}
                >
                  <div className="bg-white aspect-[1/1.414] overflow-hidden flex items-center justify-center">
                    <div
                      className="w-full h-full [&>svg]:w-full [&>svg]:h-full pointer-events-none"
                      dangerouslySetInnerHTML={{ __html: mini }}
                    />
                  </div>
                  <div
                    className={`px-2 py-1 text-[10px] tabular-nums text-left flex justify-between ${
                      activePage === i ? 'text-accent' : 'text-text-subtle'
                    }`}
                  >
                    <span>Page {i + 1}</span>
                    <span>{Math.round((doc.svgs[i]?.length ?? 0) / 1024)}KB</span>
                  </div>
                </button>
              ))}
              <div className="px-2 pt-3 pb-1 text-[10px] uppercase tracking-wider text-text-subtle border-t border-border-subtle mt-3">
                편집 기록 · {history.length}
              </div>
              <HistoryList
                entries={history}
                busyId={undoBusyId}
                onToggle={onToggleHistory}
              />
            </div>
          </aside>

          <section className="flex-1 overflow-y-auto bg-page-bg p-6 relative">
            <div className="max-w-5xl mx-auto space-y-6">
              {doc.svgs.map((svg, i) => (
                <SvgPage
                  key={`${i}:${doc.info.version}`}
                  index={i}
                  svg={svg}
                  pageCount={doc.info.pageCount}
                  rects={selection.active?.rects ?? []}
                  preview={selection.preview}
                  onBeginDrag={selection.beginDrag}
                  pageRef={(el) => {
                    pageRefs.current[i] = el;
                  }}
                />
              ))}
            </div>

            {selection.busy && (
              <div className="fixed bottom-4 right-4 text-xs text-text-muted bg-bg-panel border border-border rounded px-3 py-1.5 shadow">
                선택 영역 계산 중…
              </div>
            )}
            {selection.error && !selection.active && (
              <div className="fixed bottom-4 left-1/2 -translate-x-1/2 text-xs text-rose-500 bg-rose-500/10 border border-rose-500/30 rounded px-3 py-1.5 shadow">
                {selection.error}
              </div>
            )}
            {selection.active && (
              <EditPanel
                text={selection.active.text}
                mode={selection.active.mode}
                busy={editBusy}
                error={editError}
                onApply={onApplyEdit}
                onCancel={() => {
                  selection.clear();
                  setEditError(null);
                }}
              />
            )}
          </section>
        </div>
      )}
    </main>
  );
}
