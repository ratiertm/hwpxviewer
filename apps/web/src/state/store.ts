/**
 * HwpxViewer Zustand store — 6 slices.
 *
 * Design v0.3 §3.2. The store owns all cross-component state; components
 * subscribe to narrow selectors so re-renders stay tight. immer middleware
 * lets actions mutate drafts directly; the store is exported as a single
 * atomic object so useShallow selectors work across slices.
 *
 *   document : the currently-loaded HWPX + rendered SVGs + version
 *   selection: the live Selection + rects + original text + mode
 *   history  : recorded edits (undone flag) with replay
 *   chat     : multi-turn Claude conversation + streaming state
 *   inline   : inline-action state machine (AI rewrite/shorten/translate)
 *   ui       : toggles (sidebar/chat/history/theme/etc.)
 *
 * The existing ``useSelection`` hook remains for the imperative mouse-drag
 * pipeline — it now writes its ``active`` result into the ``selection`` slice
 * so every consumer (EditPanel, InlineMenu, HistoryPanel) reads from one
 * source of truth.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import type {
  CellRef,
  DocumentInfo,
  Edit,
  EditablePatch,
  HistoryEntry,
  InlineActionId,
  InlineEditing,
  Message,
  Selection,
  SelectionRect,
  ThemeName,
} from '@/types';

// ----- document slice ---------------------------------------------------

export interface ActiveSelection {
  page: number;
  selection: Selection;
  text: string;
  rects: SelectionRect[];
  /** "paragraph" for single-click, "range" for shift-drag. */
  mode: 'paragraph' | 'range';
}

export interface DocumentSlice {
  info: DocumentInfo | null;
  /** Full page SVGs keyed by page index. */
  svgs: string[];
  /** Page IDs that should flash (post-edit visual). */
  highlighted: Set<number>;

  setDocument: (info: DocumentInfo, svgs: string[]) => void;
  clearDocument: () => void;
  patchPages: (updates: ReadonlyArray<[number, string]>, version: number) => void;
  flashPages: (pages: number[]) => void;
  unflashPage: (page: number) => void;
}

// ----- selection slice --------------------------------------------------

export interface SelectionSlice {
  active: ActiveSelection | null;
  setActiveSelection: (s: ActiveSelection | null) => void;
}

// ----- history slice ----------------------------------------------------

export interface HistorySlice {
  entries: HistoryEntry[];
  recordEdit: (entry: HistoryEntry) => void;
  toggleUndone: (id: number) => void;
  /** nullable — UI shows "편집 중" badge on the corresponding history card. */
  busyId: number | null;
  setBusyId: (id: number | null) => void;
}

// ----- chat slice -------------------------------------------------------

export interface ChatSlice {
  messages: Message[];
  chatInput: string;
  isStreaming: boolean;
  streamingText: string;
  /** Per-message diff visibility. Keyed by ``msgIdx:editIdx``. */
  showDiff: Record<string, boolean>;
  /** Text attached from a document selection. When set alongside
   *  ``attachedSelection`` the next chat turn is routed through the inline
   *  editor prompt so Claude's reply carries an applyable edit. */
  attachedText: string | null;
  /** The Selection the attached text came from — needed so the "적용"
   *  button can reach ``/api/edit`` with the exact range. */
  attachedSelection: Selection | null;

  setChatInput: (v: string) => void;
  appendMessage: (msg: Message) => void;
  updateLastAssistant: (patch: Partial<Message>) => void;
  /** Update the ``editable`` patch on a specific message (apply/error). */
  patchMessageEditable: (msgIdx: number, patch: Partial<EditablePatch>) => void;
  setStreaming: (on: boolean) => void;
  appendStreamChunk: (chunk: string) => void;
  clearConversation: () => void;
  toggleDiff: (key: string) => void;
  setAttachment: (text: string, selection: Selection) => void;
  clearAttachment: () => void;
  /** Backwards-compat alias — kept so existing call sites compile; the real
   *  state now requires a selection to make apply actually possible. */
  setAttachedText: (s: string | null) => void;
}

// ----- inline slice -----------------------------------------------------

/** Pixel-space anchor for the InlineSelectionMenu (above the selection). */
export interface InlineMenuAnchor {
  x: number;  // client pixel X
  y: number;  // client pixel Y (usually top of the selection)
}

export interface InlineSlice {
  menu: InlineMenuAnchor | null;
  editing: InlineEditing | null;

  openMenu: (anchor: InlineMenuAnchor) => void;
  closeMenu: () => void;
  setEditing: (e: InlineEditing | null) => void;
  startInline: (opts: {
    selection: Selection;
    original: string;
    action: InlineActionId;
  }) => void;
  setInlineError: (message: string) => void;
  setInlineReady: (suggestion: string) => void;
}

// ----- ui slice ---------------------------------------------------------

export interface UiSlice {
  sidebarOpen: boolean;
  chatOpen: boolean;
  historyOpen: boolean;
  userMenuOpen: boolean;
  theme: ThemeName;

  toggleSidebar: () => void;
  toggleChat: () => void;
  toggleHistory: () => void;
  setUserMenuOpen: (v: boolean) => void;
  setTheme: (t: ThemeName) => void;
}

// ----- combined ---------------------------------------------------------

export type ViewerStore = DocumentSlice &
  SelectionSlice &
  HistorySlice &
  ChatSlice &
  InlineSlice &
  UiSlice;

export const useViewerStore = create<ViewerStore>()(
  immer((set) => ({
    // --- document ---
    info: null,
    svgs: [],
    highlighted: new Set<number>(),
    setDocument: (info, svgs) =>
      set((s) => {
        s.info = info;
        s.svgs = svgs;
        s.highlighted = new Set();
      }),
    clearDocument: () =>
      set((s) => {
        s.info = null;
        s.svgs = [];
        s.highlighted = new Set();
        s.active = null;
        s.entries = [];
        s.messages = [];
        s.streamingText = '';
        s.isStreaming = false;
        s.editing = null;
        s.menu = null;
        s.attachedText = null;
        s.attachedSelection = null;
      }),
    patchPages: (updates, version) =>
      set((s) => {
        if (!s.info) return;
        s.info = { ...s.info, version };
        for (const [idx, svg] of updates) {
          if (idx >= 0 && idx < s.svgs.length) s.svgs[idx] = svg;
        }
      }),
    flashPages: (pages) =>
      set((s) => {
        for (const p of pages) s.highlighted.add(p);
      }),
    unflashPage: (page) =>
      set((s) => {
        s.highlighted.delete(page);
      }),

    // --- selection ---
    active: null,
    setActiveSelection: (a) =>
      set((s) => {
        s.active = a;
      }),

    // --- history ---
    entries: [],
    busyId: null,
    recordEdit: (entry) =>
      set((s) => {
        s.entries.unshift(entry);
      }),
    toggleUndone: (id) =>
      set((s) => {
        const e = s.entries.find((x) => x.id === id);
        if (e) e.undone = !e.undone;
      }),
    setBusyId: (id) =>
      set((s) => {
        s.busyId = id;
      }),

    // --- chat ---
    messages: [],
    chatInput: '',
    isStreaming: false,
    streamingText: '',
    showDiff: {},
    attachedText: null,
    attachedSelection: null,
    setChatInput: (v) =>
      set((s) => {
        s.chatInput = v;
      }),
    appendMessage: (msg) =>
      set((s) => {
        s.messages.push(msg);
      }),
    updateLastAssistant: (patch) =>
      set((s) => {
        for (let i = s.messages.length - 1; i >= 0; i--) {
          if (s.messages[i]!.role === 'assistant') {
            s.messages[i] = { ...s.messages[i]!, ...patch };
            return;
          }
        }
      }),
    patchMessageEditable: (msgIdx, patch) =>
      set((s) => {
        const msg = s.messages[msgIdx];
        if (!msg || !msg.editable) return;
        s.messages[msgIdx] = {
          ...msg,
          editable: { ...msg.editable, ...patch },
        };
      }),
    setStreaming: (on) =>
      set((s) => {
        s.isStreaming = on;
        if (!on) s.streamingText = '';
      }),
    appendStreamChunk: (chunk) =>
      set((s) => {
        s.streamingText += chunk;
      }),
    clearConversation: () =>
      set((s) => {
        s.messages = [];
        s.streamingText = '';
        s.isStreaming = false;
        s.showDiff = {};
        s.attachedText = null;
        s.attachedSelection = null;
      }),
    toggleDiff: (key) =>
      set((s) => {
        s.showDiff[key] = !s.showDiff[key];
      }),
    setAttachment: (text, selection) =>
      set((s) => {
        s.attachedText = text;
        s.attachedSelection = selection;
      }),
    clearAttachment: () =>
      set((s) => {
        s.attachedText = null;
        s.attachedSelection = null;
      }),
    setAttachedText: (txt) =>
      // Kept only because App.tsx called this in the chat-handoff flow
      // before we split text/selection. New code should use setAttachment /
      // clearAttachment.
      set((s) => {
        s.attachedText = txt;
        if (txt === null) s.attachedSelection = null;
      }),

    // --- inline ---
    menu: null,
    editing: null,
    openMenu: (anchor) =>
      set((s) => {
        s.menu = anchor;
      }),
    closeMenu: () =>
      set((s) => {
        s.menu = null;
      }),
    setEditing: (e) =>
      set((s) => {
        s.editing = e;
      }),
    startInline: ({ selection, original, action }) =>
      set((s) => {
        s.editing = { selection, original, action, status: 'loading' };
        s.menu = null;
      }),
    setInlineError: (message) =>
      set((s) => {
        if (!s.editing) return;
        s.editing = {
          selection: s.editing.selection,
          original: s.editing.original,
          action: s.editing.action,
          status: 'error',
          error: message,
        };
      }),
    setInlineReady: (suggestion) =>
      set((s) => {
        if (!s.editing) return;
        s.editing = {
          selection: s.editing.selection,
          original: s.editing.original,
          action: s.editing.action,
          suggestion,
          status: 'ready',
        };
      }),

    // --- ui ---
    sidebarOpen: true,
    chatOpen: false,
    historyOpen: false,
    userMenuOpen: false,
    theme: 'dark',
    toggleSidebar: () =>
      set((s) => {
        s.sidebarOpen = !s.sidebarOpen;
      }),
    toggleChat: () =>
      set((s) => {
        s.chatOpen = !s.chatOpen;
      }),
    toggleHistory: () =>
      set((s) => {
        s.historyOpen = !s.historyOpen;
      }),
    setUserMenuOpen: (v) =>
      set((s) => {
        s.userMenuOpen = v;
      }),
    setTheme: (t) =>
      set((s) => {
        s.theme = t;
      }),
  })),
);

// Re-export commonly used types for consumers of the store.
export type { CellRef, Edit };
