/**
 * HwpxViewer — M3R/M4R/M5R/M6R/M7R.
 *
 * M7R status: inline AI pipeline landed (InlineSelectionMenu → Claude rewrite
 * → CherryPickDiff → /api/edit). ChatPanel / full HistoryPanel / layout
 * shell (UserMenu, FloatingDock, StatusBar) still pending — tracked in
 * do.md §M7R.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ApiError,
  applyEdit,
  downloadUrl,
  fetchPageSvg,
  getPageDef,
  type PageDef,
  revealInFinder,
  saveDocument,
  type SaveResult,
  undoEdit,
  uploadHwpx,
} from '@/api/document';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { GenerateModal } from '@/components/generate/GenerateModal';
import { PageSettingsPanel } from '@/components/page-settings/PageSettingsPanel';
import { HistoryPanel } from '@/components/history/HistoryPanel';
import { FloatingDock } from '@/components/layout/FloatingDock';
import { StatusBar } from '@/components/layout/StatusBar';
import { SvgPage } from '@/components/viewer/SvgPage';
import { InlineSelectionMenu } from '@/components/inline/InlineSelectionMenu';
import { InlineLoadingBlock } from '@/components/inline/InlineLoadingBlock';
import { InlineErrorBlock } from '@/components/inline/InlineErrorBlock';
import { InlineCherryPickDiff } from '@/components/inline/InlineCherryPickDiff';
import { InlineManualEdit } from '@/components/inline/InlineManualEdit';
import { useInlineAi } from '@/hooks/useInlineAi';
import { useSelection } from '@/hooks/useSelection';
import { useViewerStore } from '@/state/store';
import { Check, FolderOpen, GitBranch, MessageSquare, Save, Settings, Sparkles } from 'lucide-react';
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

/** Compute the client-space anchor (top-center) from the selection's first rect. */
function anchorFromRect(
  pageEl: HTMLElement | null,
  _viewBox: string | null,
  rect: { x: number; y: number; width: number } | undefined,
): { x: number; y: number } | null {
  if (!pageEl || !rect) return null;
  const svgEl = pageEl.querySelector('svg');
  if (!svgEl) return null;
  const ctm = (svgEl as SVGSVGElement).getScreenCTM();
  if (!ctm) return null;
  const pt = (svgEl as SVGSVGElement).createSVGPoint();
  pt.x = rect.x + rect.width / 2;
  pt.y = rect.y;
  const mapped = pt.matrixTransform(ctm);
  return { x: mapped.x, y: mapped.y };
}

export default function App() {
  const [doc, setDoc] = useState<LoadedDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState<SaveResult | null>(null);
  const [pageSettingsFor, setPageSettingsFor] = useState<{ pageIndex: number; defn: PageDef } | null>(null);
  const [activePage, setActivePage] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [editBusy, setEditBusy] = useState(false);
  const [undoBusyId, setUndoBusyId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pageRefs = useRef<Record<number, HTMLElement | null>>({});

  const selection = useSelection(doc?.info.uploadId ?? null);

  // ----- store bindings (inline AI pipeline + chat) -----
  const inlineEditing = useViewerStore((s) => s.editing);
  const inlineMenu = useViewerStore((s) => s.menu);
  const openMenu = useViewerStore((s) => s.openMenu);
  const closeMenu = useViewerStore((s) => s.closeMenu);
  const setEditing = useViewerStore((s) => s.setEditing);
  const chatOpen = useViewerStore((s) => s.chatOpen);
  const toggleChat = useViewerStore((s) => s.toggleChat);
  const historyOpen = useViewerStore((s) => s.historyOpen);
  const toggleHistory = useViewerStore((s) => s.toggleHistory);
  const isStreaming = useViewerStore((s) => s.isStreaming);
  const messages = useViewerStore((s) => s.messages);
  const setDocumentInStore = useViewerStore((s) => s.setDocument);
  const clearDocumentInStore = useViewerStore((s) => s.clearDocument);

  // Bridge useSelection -> inline menu anchor. When a selection becomes
  // active (paragraph or range), pop the AI menu above the first rect.
  useEffect(() => {
    if (!selection.active || inlineEditing) {
      closeMenu();
      return;
    }
    const rect = selection.active.rects[0];
    const anchor = anchorFromRect(pageRefs.current[selection.active.page] ?? null, null, rect);
    if (anchor) openMenu(anchor);
    else closeMenu();
  }, [selection.active, inlineEditing, openMenu, closeMenu]);

  const inlineTarget = selection.active
    ? { selection: selection.active.selection, text: selection.active.text }
    : null;
  const inlineAi = useInlineAi(inlineTarget);

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

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      setDoc(null);
      setHistory([]);
      selection.clear();
      setEditing(null);
      closeMenu();
      try {
        const info = await uploadHwpx(file);
        const svgs = await loadAllPages(info);
        setDoc({ info, svgs });
        // Bridge to store so ChatPanel (and future layout pieces) can read
        // the same DocumentInfo without prop drilling.
        setDocumentInStore(info, svgs);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [loadAllPages, selection, setEditing, closeMenu, setDocumentInStore],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) handleFile(f);
    },
    [handleFile],
  );

  /** Called by GenerateModal when SSE emits step="done". The uploadId is
   *  already registered server-side, so we just fetch SVGs and reuse the
   *  same store path as drag-drop upload. */
  const handleGenerated = useCallback(
    async (uploadId: string, fileName: string, pageCount: number) => {
      setBusy(true);
      setError(null);
      setHistory([]);
      selection.clear();
      setEditing(null);
      closeMenu();
      try {
        const info: DocumentInfo = {
          uploadId,
          fileName,
          fileSize: 0,
          pageCount,
          version: 0,
        };
        const svgs = await loadAllPages(info);
        setDoc({ info, svgs });
        setDocumentInStore(info, svgs);
        setGenerateOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [loadAllPages, selection, setEditing, closeMenu, setDocumentInStore],
  );

  const onDownload = useCallback(() => {
    if (!doc) return;
    // Pass version so the URL changes after every edit — guarantees a fresh
    // server fetch even if the browser cached an earlier download.
    window.location.href = downloadUrl(doc.info.uploadId, doc.info.version);
  }, [doc]);

  /**
   * Server-side save. Bypasses every browser-download caching trap because
   * the server writes the file directly to ``~/Documents/HwpxViewer/`` with
   * a deterministic, version-suffixed name. Toast surfaces the absolute
   * path + a "Finder 에서 보기" action.
   */
  const onSave = useCallback(async () => {
    if (!doc) return;
    setSaving(true);
    setError(null);
    try {
      const result = await saveDocument(doc.info.uploadId);
      setSavedToast(result);
      window.setTimeout(() => setSavedToast((cur) => (cur === result ? null : cur)), 8000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [doc]);

  const onRevealSaved = useCallback(async () => {
    if (!savedToast) return;
    try {
      await revealInFinder(savedToast.path);
    } catch (e) {
      // Non-fatal — the path is already in the toast for manual access.
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [savedToast]);

  // ----- edit/undo pipeline ------------------------------------------------

  const refreshAffectedPages = useCallback(
    async (info: DocumentInfo, pages: number[]) => {
      const next = [...(doc?.svgs ?? [])];
      const unique = Array.from(new Set(pages)).filter((p) => p >= 0 && p < info.pageCount);
      const results = await Promise.all(
        unique.map(async (p) => [p, await fetchPageSvg(info.uploadId, p, info.version)] as const),
      );
      for (const [p, svg] of results) next[p] = svg;
      setDoc({ info, svgs: next });
    },
    [doc],
  );

  const acceptInlineEdit = useCallback(
    async (finalText: string) => {
      if (!doc || !selection.active || !inlineEditing) return;
      setEditBusy(true);
      try {
        const result = await applyEdit(doc.info.uploadId, selection.active.selection, finalText);
        const actionLabel =
          inlineEditing.action === 'rewrite'
            ? '다시 쓰기'
            : inlineEditing.action === 'shorten'
              ? '간결하게'
              : inlineEditing.action === 'translate'
                ? '영어로'
                : '직접 수정';
        // Manual edits don't get the "AI:" prefix — they're user-typed.
        const historyAction =
          inlineEditing.action === 'manual' ? actionLabel : `AI: ${actionLabel}`;
        setHistory((prev) => [
          {
            id: result.editId,
            ts: Date.now(),
            selection: selection.active!.selection,
            oldText: selection.active!.text,
            newText: finalText,
            action: historyAction,
            undone: false,
          },
          ...prev,
        ]);
        await refreshAffectedPages(result.document, result.affectedPages);
        setEditing(null);
        selection.clear();
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
        // Stay in the cherry-pick; surface the error via inline editor state.
        useViewerStore.getState().setInlineError(msg);
      } finally {
        setEditBusy(false);
      }
    },
    [doc, selection, inlineEditing, refreshAffectedPages, setEditing],
  );

  const rejectInlineEdit = useCallback(() => {
    setEditing(null);
  }, [setEditing]);

  // ----- chat-embedded patch apply/undo --------------------------------------
  const [busyPatchMsgIdx, setBusyPatchMsgIdx] = useState<number | null>(null);

  const applyChatPatch = useCallback(
    async (msgIdx: number) => {
      if (!doc) return;
      const msg = useViewerStore.getState().messages[msgIdx];
      if (!msg?.editable) return;
      const { selection: sel, original, suggestion } = msg.editable;
      setBusyPatchMsgIdx(msgIdx);
      try {
        const result = await applyEdit(doc.info.uploadId, sel, suggestion);
        setHistory((prev) => [
          {
            id: result.editId,
            ts: Date.now(),
            selection: sel,
            oldText: original,
            newText: suggestion,
            action: 'AI: 채팅 제안',
            undone: false,
          },
          ...prev,
        ]);
        await refreshAffectedPages(result.document, result.affectedPages);
        useViewerStore.getState().patchMessageEditable(msgIdx, {
          appliedEditId: result.editId,
          error: undefined,
        });
      } catch (e) {
        const em = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
        useViewerStore.getState().patchMessageEditable(msgIdx, { error: em });
      } finally {
        setBusyPatchMsgIdx(null);
      }
    },
    [doc, refreshAffectedPages],
  );

  const undoChatPatch = useCallback(
    async (msgIdx: number) => {
      if (!doc) return;
      const msg = useViewerStore.getState().messages[msgIdx];
      const editId = msg?.editable?.appliedEditId;
      if (!editId) return;
      setBusyPatchMsgIdx(msgIdx);
      try {
        const result = await undoEdit(doc.info.uploadId, editId);
        setHistory((prev) =>
          prev.map((e) => (e.id === editId ? { ...e, undone: !e.undone } : e)),
        );
        await refreshAffectedPages(result.document, result.affectedPages);
        useViewerStore
          .getState()
          .patchMessageEditable(msgIdx, { appliedEditId: undefined, error: undefined });
      } catch (e) {
        const em = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
        useViewerStore.getState().patchMessageEditable(msgIdx, { error: em });
      } finally {
        setBusyPatchMsgIdx(null);
      }
    },
    [doc, refreshAffectedPages],
  );

  const rejectChatPatch = useCallback(
    (msgIdx: number) => {
      // Drop the patch attachment from the message — bubble becomes pure text.
      useViewerStore.getState().patchMessageEditable(msgIdx, { error: undefined });
      // Also drop the editable field altogether; there's no dedicated setter,
      // so we overwrite the message via updateLastAssistant (if last) or
      // directly via the store in a small local helper.
      const state = useViewerStore.getState();
      const msg = state.messages[msgIdx];
      if (msg) {
        // Rewrite the message in-place: copy out editable, reassemble.
        useViewerStore.setState((prev) => {
          const next = { ...prev, messages: prev.messages.slice() };
          const m = next.messages[msgIdx];
          if (m) {
            const { editable: _drop, ...rest } = m;
            next.messages[msgIdx] = rest;
          }
          return next;
        });
      }
    },
    [],
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
        await selection.refresh();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
      } finally {
        setUndoBusyId(null);
      }
    },
    [doc, refreshAffectedPages, selection],
  );

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
              클릭 = 문단 · Shift+드래그 = 범위 · AI 메뉴로 재작성 · undo
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
              onClick={() => void onSave()}
              disabled={saving}
              title="~/Documents/HwpxViewer/ 에 직접 저장"
              className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-accent text-white hover:opacity-90 disabled:opacity-50"
            >
              <Save size={12} />
              {saving ? '저장 중…' : '저장'}
            </button>
            <button
              onClick={onDownload}
              title="브라우저 다운로드"
              className="px-3 py-1 rounded-md border border-border text-text-muted hover:bg-bg-muted text-xs"
            >
              다운로드
            </button>
            <button
              onClick={toggleHistory}
              title="변경 이력"
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md border text-xs ${
                historyOpen ? 'border-accent text-accent' : 'border-border text-text-muted hover:bg-bg-muted'
              }`}
            >
              <GitBranch size={12} />
              History · {history.filter((h) => !h.undone).length}
            </button>
            <button
              onClick={toggleChat}
              title="AI 대화"
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md border text-xs ${
                chatOpen ? 'border-accent text-accent' : 'border-border text-text-muted hover:bg-bg-muted'
              }`}
            >
              <MessageSquare size={12} />
              AI
            </button>
            <button
              onClick={() => setGenerateOpen(true)}
              title="AI로 새 한글 문서 생성"
              className="flex items-center gap-1.5 px-3 py-1 rounded-md border border-border text-text-muted hover:bg-bg-muted text-xs"
            >
              <Sparkles size={12} />
              AI 새 문서
            </button>
            <button
              onClick={() => {
                setDoc(null);
                setError(null);
                setHistory([]);
                selection.clear();
                setEditing(null);
                closeMenu();
                clearDocumentInStore();
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
              rhwp WASM이 서버에서 SVG로 렌더링하고, 드래그로 텍스트를 선택해 AI와 편집할 수 있습니다.
            </div>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                className="px-4 py-2 rounded-md bg-accent text-white font-medium disabled:opacity-50"
              >
                {busy ? '업로드 중…' : '파일 선택'}
              </button>
              <button
                onClick={() => setGenerateOpen(true)}
                disabled={busy}
                className="px-4 py-2 rounded-md border border-border text-text-strong font-medium hover:bg-bg-muted disabled:opacity-50 flex items-center gap-1.5"
              >
                <Sparkles size={14} />
                AI로 새 문서
              </button>
            </div>
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
                  onClick={(e) => {
                    if (e.shiftKey) {
                      // Shift+click → select all paragraphs on this page
                      // (Phase 2.2 page-level multi-select).
                      void selection.selectPage(i);
                    } else {
                      jumpToPage(i);
                    }
                  }}
                  title="클릭: 페이지 이동 · Shift+클릭: 페이지 전체 선택"
                  style={{ position: 'relative' }}
                  className={`w-full group flex flex-col items-stretch rounded border overflow-hidden transition-colors ${
                    activePage === i
                      ? 'border-accent ring-2 ring-accent/30'
                      : 'border-border hover:border-text-muted'
                  }`}
                >
                  <div className="bg-white aspect-[1/1.414] overflow-hidden flex items-center justify-center relative group">
                    <div
                      className="w-full h-full [&>svg]:w-full [&>svg]:h-full pointer-events-none"
                      dangerouslySetInnerHTML={{ __html: mini }}
                    />
                    {/* Page-settings button — overlays the thumbnail's top-right
                        corner. Hover reveals it; always visible when this page
                        is active so it's easier to discover. */}
                    <span
                      role="button"
                      tabIndex={0}
                      title="페이지 설정 (가로방향 / 여백 등)"
                      onClick={async (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (!doc) return;
                        try {
                          const defn = await getPageDef(doc.info.uploadId, i);
                          setPageSettingsFor({ pageIndex: i, defn });
                        } catch (err) {
                          setError(err instanceof Error ? err.message : String(err));
                        }
                      }}
                      className={`absolute top-1 right-1 w-7 h-7 rounded-md flex items-center justify-center cursor-pointer transition-opacity shadow-md ${
                        activePage === i ? 'opacity-90' : 'opacity-0 group-hover:opacity-90'
                      }`}
                      style={{
                        backgroundColor: 'var(--bg-panel)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-strong)',
                      }}
                    >
                      <Settings size={14} />
                    </span>
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
              {/* Editing history moved to the right-side HistoryPanel
                  (toggle via the header button). Sidebar stays focused on
                  page navigation. */}
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
            {selection.active && !selection.busy && (
              <div
                className="fixed top-16 right-4 z-20 text-[11px] px-2.5 py-1 rounded-md border shadow backdrop-blur-xl flex items-center gap-2"
                style={{
                  backgroundColor: 'var(--bg-panel)',
                  borderColor: 'var(--accent)',
                  color: 'var(--text-muted)',
                }}
                title="선택 영역 상태 (rects 수 · 선택 글자수). 보라색 박스와 텍스트 길이 불일치 시 신고."
              >
                <span style={{ color: 'var(--accent)' }}>●</span>
                <span className="tabular-nums">
                  {selection.active.rects.length}줄 · {selection.active.text.length}자
                </span>
                <span style={{ color: 'var(--text-faint)' }}>
                  ({selection.active.mode === 'paragraph' ? '문단' : '범위'})
                </span>
              </div>
            )}
            {selection.error && !selection.active && (
              <div className="fixed bottom-4 left-1/2 -translate-x-1/2 text-xs text-rose-500 bg-rose-500/10 border border-rose-500/30 rounded px-3 py-1.5 shadow">
                {selection.error}
              </div>
            )}

            {/* Inline AI menu — shown only while a selection exists AND no
                inline editing is in progress. */}
            {inlineMenu && !inlineEditing && (
              <InlineSelectionMenu
                anchor={inlineMenu}
                onAction={(id, guide) => {
                  // "직접 수정" — skip Claude. Drop straight into a ready
                  // state pre-filled with the original text; the user types
                  // their replacement and clicks 적용. The same
                  // ``acceptInlineEdit`` path commits the edit + history.
                  if (id === 'manual') {
                    if (!selection.active) return;
                    useViewerStore.getState().setEditing({
                      selection: selection.active.selection,
                      original: selection.active.text,
                      suggestion: selection.active.text,
                      action: 'manual',
                      status: 'ready',
                    });
                    closeMenu();
                    return;
                  }
                  void inlineAi.begin(id, guide);
                }}
                onAttachToChat={() => {
                  if (selection.active) {
                    useViewerStore
                      .getState()
                      .setAttachment(selection.active.text, selection.active.selection);
                    if (!useViewerStore.getState().chatOpen) {
                      useViewerStore.getState().toggleChat();
                    }
                  }
                  closeMenu();
                  selection.clear();
                }}
                onClose={() => {
                  closeMenu();
                  selection.clear();
                }}
              />
            )}

            {/* Inline editing overlay (loading / error / cherry-pick). */}
            {inlineEditing && (
              <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[min(720px,92vw)] z-20">
                {inlineEditing.status === 'loading' && (
                  <InlineLoadingBlock originalText={inlineEditing.original} />
                )}
                {inlineEditing.status === 'error' && (
                  <InlineErrorBlock
                    error={inlineEditing.error}
                    onClose={() => setEditing(null)}
                  />
                )}
                {inlineEditing.status === 'ready' && inlineEditing.action === 'manual' && (
                  <InlineManualEdit
                    original={inlineEditing.original}
                    busy={editBusy}
                    onAccept={(finalText) => void acceptInlineEdit(finalText)}
                    onCancel={rejectInlineEdit}
                  />
                )}
                {inlineEditing.status === 'ready' && inlineEditing.action !== 'manual' && (
                  <InlineCherryPickDiff
                    original={inlineEditing.original}
                    suggestion={inlineEditing.suggestion}
                    busy={editBusy}
                    onAccept={(finalText) => void acceptInlineEdit(finalText)}
                    onReject={rejectInlineEdit}
                  />
                )}
              </div>
            )}
          </section>

          {/* AI conversation panel — slides in from the right. */}
          <aside
            className={`${historyOpen ? 'w-80' : 'w-0'} flex-shrink-0 overflow-hidden transition-[width] duration-200`}
          >
            {historyOpen && (
              <HistoryPanel
                entries={history}
                busyId={undoBusyId}
                onClose={toggleHistory}
                onToggle={onToggleHistory}
              />
            )}
          </aside>

          <aside
            className={`${chatOpen ? 'w-[420px]' : 'w-0'} flex-shrink-0 overflow-hidden transition-[width] duration-200`}
          >
            {chatOpen && (
              <ChatPanel
                busyPatchMsgIdx={busyPatchMsgIdx}
                onApplyPatch={(i) => void applyChatPatch(i)}
                onUndoPatch={(i) => void undoChatPatch(i)}
                onRejectPatch={rejectChatPatch}
              />
            )}
          </aside>
        </div>
      )}

      {/* Bottom floating page nav + status bar (only when a doc is loaded). */}
      {doc && (
        <>
          <FloatingDock
            currentPage={activePage}
            pageCount={doc.info.pageCount}
            onJumpToPage={jumpToPage}
          />
          <StatusBar
            fileName={doc.info.fileName}
            pageCount={doc.info.pageCount}
            currentPage={activePage}
            edits={history.filter((h) => !h.undone).length}
            turns={messages.filter((m) => m.role === 'user').length}
            isStreaming={isStreaming}
            version={doc.info.version}
          />
        </>
      )}

      {pageSettingsFor && doc && (
        <PageSettingsPanel
          uploadId={doc.info.uploadId}
          pageIndex={pageSettingsFor.pageIndex}
          initial={pageSettingsFor.defn}
          onClose={() => setPageSettingsFor(null)}
          onApplied={async ({ pageCount, version }) => {
            // pageCount may have changed (landscape flip can add/remove pages).
            // Refetch all pages.
            const newInfo: DocumentInfo = {
              ...doc.info,
              pageCount,
              version,
            };
            try {
              const svgs = await loadAllPages(newInfo, version);
              setDoc({ info: newInfo, svgs });
              setDocumentInStore(newInfo, svgs);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      )}

      {generateOpen && (
        <GenerateModal
          onClose={() => setGenerateOpen(false)}
          onDone={(uploadId, fileName, pageCount) =>
            void handleGenerated(uploadId, fileName, pageCount)
          }
        />
      )}

      {savedToast && (
        <div
          className="fixed top-16 right-4 z-30 max-w-md rounded-lg border shadow-xl backdrop-blur-xl"
          style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--accent)' }}
          role="status"
        >
          <div className="px-4 py-3 flex items-start gap-3">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: 'rgba(52,211,153,0.15)' }}
            >
              <Check size={14} style={{ color: '#34d399' }} />
            </div>
            <div className="flex-1 min-w-0">
              <div
                className="text-sm font-medium"
                style={{ color: 'var(--text-strong)' }}
              >
                저장 완료 (v{savedToast.version} · {savedToast.edits}편집 · {Math.round(savedToast.fileSize / 1024)}KB)
              </div>
              <div
                className="text-[11px] mt-1 break-all font-mono"
                style={{ color: 'var(--text-muted)' }}
              >
                {savedToast.path}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={() => void onRevealSaved()}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-bg-muted appearance-none"
                  style={{
                    color: 'var(--accent)',
                    border: '1px solid var(--accent)',
                  }}
                >
                  <FolderOpen size={11} />
                  Finder 에서 보기
                </button>
                <button
                  onClick={() => setSavedToast(null)}
                  className="text-xs px-2 py-1 hover:bg-bg-muted rounded appearance-none"
                  style={{ color: 'var(--text-muted)' }}
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
