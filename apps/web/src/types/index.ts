/**
 * Shared types for HWPX Viewer web app.
 *
 * Source of truth: docs/02-design/features/hwpx-viewer-mvp.design.md v0.3
 * + docs/COMPONENT_INVENTORY.md §15.
 *
 * Design v0.3 switched the document model from semantic Blocks
 * (h1/h2/lead/p/table) to **Run coordinates**:
 *   - Rendering is done by rhwp → SVG (pixel-accurate, like Hancom preview).
 *   - Editing addresses runs by ``{sec, para, charOffset}``.
 *
 * The legacy ``Block`` family (TextBlock, TableBlock, PageBreakBlock) is
 * retained ONLY for the word/table diff engine in ``src/lib/diff/*`` — which
 * stays useful for inline cherry-pick visualisation. Do not introduce new
 * production code paths that depend on those types.
 */

// ============================================================
//  Theme
// ============================================================

export type ThemeName = 'dark' | 'light';

export interface Theme {
  bg: string;
  bgSubtle: string;
  bgMuted: string;
  bgDock: string;
  bgPanel: string;
  text: string;
  textStrong: string;
  textMuted: string;
  textSubtle: string;
  textFaint: string;
  border: string;
  borderSubtle: string;
  hover: string;
  hoverSubtle: string;
  activeBg: string;
  btnPrimary: string;
  accent: string;
  accentDot: string;
  pageBg: string;
  paperBg: string;
  paperBorder: string;
  inputBg: string;
  inputBorder: string;
  diffAddBg: string;
  diffAddText: string;
  diffAddBorder: string;
  diffDelBg: string;
  diffDelText: string;
  diffDelBorder: string;
  diffAddInline: string;
  diffDelInline: string;
  diffAddPick: string;
  diffDelPick: string;
  glow: string;
}

// ============================================================
//  Document session (M4R)
// ============================================================

export interface DocumentInfo {
  uploadId: string;
  fileName: string;
  fileSize: number;
  pageCount: number;
  /** Monotonically increasing version — incremented after every successful edit. */
  version: number;
}

// ============================================================
//  Run coordinates (M5R/M6R)
// ============================================================

/**
 * Pointer to a table cell. When a ``RunLocation`` has ``cell`` set, the
 * ``para`` field is interpreted as ``cellParaIndex`` (paragraph index
 * *inside the cell*), and edits are routed to rhwp's ``*InCell`` WASM
 * exports server-side.
 */
export interface CellRef {
  parentParaIndex: number;
  controlIndex: number;
  cellIndex: number;
}

/**
 * A single point inside the document. Matches the rhwp WASM edit-API
 * signature ``(section_idx, para_idx, char_offset)`` for body text, plus an
 * optional ``cell`` context for clicks that land inside a table cell.
 */
export interface RunLocation {
  sec: number;
  para: number;
  charOffset: number;
  cell?: CellRef | null;
}

/** A contiguous text range.
 *
 * Single-paragraph form: ``{ start, length }`` (legacy).
 * Cross-paragraph form: ``{ start, end }`` — ``length`` ignored server-side
 * when ``end`` is present. The section / cell context must match between
 * start and end (no jumping between body and cell, no nesting hops).
 */
export interface Selection {
  start: RunLocation;
  length: number;
  end?: RunLocation | null;
}

export interface SelectionRect {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

// ============================================================
//  Editing & history (M6R)
// ============================================================

/**
 * A single recorded edit. Text-level snapshot enables undone toggle without
 * re-running Claude or re-parsing HWPX.
 */
export interface HistoryEntry {
  id: number;
  ts: number;
  selection: Selection;
  oldText: string;
  newText: string;
  action: string;
  undone: boolean;
}

/** Edit metadata attached to an assistant chat message. */
export interface Edit {
  historyId: number;
  selection: Selection;
  oldText: string;
  newText: string;
}

// ============================================================
//  Chat messages (M7R)
// ============================================================

/**
 * A Claude-proposed inline edit embedded inside a chat message. Populated
 * when the user chats **with an attached selection** — ``useStreamChat``
 * routes the turn through the inline-editor prompt and the assistant bubble
 * renders a diff + [적용] button. See ``components/chat/ChatMessage.tsx``.
 */
export interface EditablePatch {
  selection: Selection;
  original: string;
  suggestion: string;
  /** Once applied, the assigned ``editId`` from /api/edit — used so undo
   *  toggles the patch card and the sidebar history entry in sync. */
  appliedEditId?: number;
  /** Server-reported error from the apply step. */
  error?: string;
}

export interface Message {
  role: 'user' | 'assistant';
  text: string;
  content?: string;
  edits?: Edit[];
  /** When the message originated from an attached-selection chat turn,
   *  this carries the AI's suggestion and the target selection so the
   *  in-bubble [적용] button can reach ``/api/edit``. */
  editable?: EditablePatch;
  ui?: 'static' | 'inline';
  isError?: boolean;
}

// ============================================================
//  Inline editing state machine (M6R/M7R)
// ============================================================

export type InlineActionId = 'rewrite' | 'shorten' | 'translate';

export interface InlineAction {
  id: InlineActionId;
  label: string;
  icon: unknown; // lucide-react component
}

export type InlineEditing =
  | {
      selection: Selection;
      original: string;
      action: InlineActionId;
      status: 'loading';
    }
  | {
      selection: Selection;
      original: string;
      action: InlineActionId;
      status: 'error';
      error: string;
    }
  | {
      selection: Selection;
      original: string;
      suggestion: string;
      action: InlineActionId;
      status: 'ready';
    };

// ============================================================
//  Diff engine (word-level text diff) — prototype preserved
// ============================================================

export type Op =
  | { type: 'eq'; token: string }
  | { type: 'add'; token: string }
  | { type: 'del'; token: string };

export type Hunk =
  | { kind: 'eq'; token: string }
  | { kind: 'change'; id: number; del: string; add: string };

// ============================================================
//  Legacy Block model (kept for table diff engine only)
// ============================================================

/**
 * @deprecated Block-level types are retained solely so ``src/lib/diff/table.ts``
 * can still be re-used for cherry-pick visualisation. New code should address
 * the document via ``RunLocation`` / ``Selection``.
 */
export interface TextBlock {
  type: 'h1' | 'h2' | 'lead' | 'p';
  text: string;
}

/** @deprecated see TextBlock. */
export interface TableBlock {
  type: 'table';
  headers: string[];
  rows: string[][];
}

/** @deprecated see TextBlock. */
export interface PageBreakBlock {
  type: 'pageBreak';
}

/** @deprecated see TextBlock. */
export type Block = TextBlock | TableBlock | PageBreakBlock;

// ============================================================
//  Table diff (used by cherry-pick)
// ============================================================

export type HeaderOp =
  | { type: 'eq'; header: string; oldIdx: number; newIdx: number }
  | { type: 'add'; header: string; newIdx: number }
  | { type: 'del'; header: string; oldIdx: number };

export type RowOp =
  | {
      id: number;
      type: 'eq';
      oldRow: string[];
      newRow: string[];
      oldIdx: number;
      newIdx: number;
    }
  | {
      id: number;
      type: 'change';
      oldRow: string[];
      newRow: string[];
      oldIdx: number;
      newIdx: number;
    }
  | { id: number; type: 'add'; newRow: string[]; newIdx: number }
  | { id: number; type: 'del'; oldRow: string[]; oldIdx: number };

export interface TableDiff {
  headerOps: HeaderOp[];
  rowOps: RowOp[];
}

// ============================================================
//  Errors (unchanged mirror of backend errors.py)
// ============================================================

export type ErrorCode =
  | 'INVALID_FILE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FORMAT'
  | 'CONVERTER_ERROR'
  | 'INVALID_BLOCKS'
  | 'UPLOAD_EXPIRED'
  | 'AUTH_ERROR'
  | 'RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'NETWORK_ERROR'
  | 'JSON_PARSE_FAILED';

export interface AppError {
  code: ErrorCode;
  message: string;
  detail?: string;
  recoverable: boolean;
}
