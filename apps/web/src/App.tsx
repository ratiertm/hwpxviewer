/**
 * M3R smoke viewer — upload an .hwpx, see every page rendered as rhwp SVG.
 *
 * Minimal UI intended only for visual verification of the backend render
 * pipeline. Proper SvgViewer + Sidebar + ChatPanel land in M5R~M7R.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import type { DocumentInfo } from '@/types';

interface LoadedDoc {
  info: DocumentInfo;
  svgs: string[];
}

/** Build a tiny "thumbnail" by stripping `width`/`height` attrs so the SVG
 *  just scales to the container. Keeps rendering cheap (no re-fetch). */
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pageRefs = useRef<Record<number, HTMLElement | null>>({});

  const miniSvgs = useMemo(() => doc?.svgs.map(miniFrom) ?? [], [doc]);

  const jumpToPage = useCallback((idx: number) => {
    const el = pageRefs.current[idx];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActivePage(idx);
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    setDoc(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const up = await fetch('/api/upload', { method: 'POST', body: form });
      if (!up.ok) {
        const body = await up.json().catch(() => ({}));
        throw new Error(body?.detail?.error?.message ?? `업로드 실패 (${up.status})`);
      }
      const { document: info } = (await up.json()) as { document: DocumentInfo };

      // Fetch all pages in parallel.
      const svgs = await Promise.all(
        Array.from({ length: info.pageCount }, (_, i) =>
          fetch(`/api/render/${info.uploadId}/${i}`).then((r) => {
            if (!r.ok) throw new Error(`render page ${i} 실패`);
            return r.text();
          })
        )
      );
      setDoc({ info, svgs });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const onDownload = useCallback(() => {
    if (!doc) return;
    window.location.href = `/api/download/${doc.info.uploadId}`;
  }, [doc]);

  return (
    <main className="min-h-screen bg-bg text-text flex flex-col">
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
              M3R smoke — rhwp WASM → SVG (fonts embedded)
            </p>
          </div>
        </div>
        {doc && (
          <div className="flex items-center gap-3 text-xs text-text-muted">
            <span className="truncate max-w-[200px]">{doc.info.fileName}</span>
            <span>{doc.info.pageCount}페이지</span>
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
              rhwp WASM이 서버에서 SVG로 렌더링합니다. 한글 폰트 포함.
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
          {/* Sidebar — page thumbnails */}
          <aside
            className={`${sidebarOpen ? 'w-56' : 'w-0'} flex-shrink-0 border-r border-border-subtle bg-bg-subtle overflow-hidden transition-[width] duration-200`}
          >
            <div className="w-56 h-full overflow-y-auto p-2 space-y-2">
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
            </div>
          </aside>

          {/* Canvas */}
          <section className="flex-1 overflow-y-auto bg-page-bg p-6">
            <div className="max-w-5xl mx-auto space-y-6">
              {doc.svgs.map((svg, i) => (
                <figure
                  key={i}
                  ref={(el) => {
                    pageRefs.current[i] = el;
                  }}
                  className="bg-paper-bg border border-border rounded shadow-sm overflow-hidden"
                >
                  <figcaption className="px-4 py-2 text-[11px] text-text-subtle bg-bg-subtle border-b border-border-subtle flex items-center justify-between">
                    <span>Page {i + 1} / {doc.info.pageCount}</span>
                    <span className="tabular-nums">{Math.round(svg.length / 1024)} KB</span>
                  </figcaption>
                  <div
                    className="svg-page overflow-auto flex justify-center p-4"
                    // rhwp SVG is trusted server content.
                    dangerouslySetInnerHTML={{ __html: svg }}
                  />
                </figure>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
