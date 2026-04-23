/**
 * Shared types for HWPX Viewer web app.
 *
 * Source of truth: docs/COMPONENT_INVENTORY.md §15 (existing model)
 *                + docs/02-design/features/hwpx-viewer-mvp.design.md §3.1 (MVP additions).
 *
 * Do NOT change types here without updating COMPONENT_INVENTORY §15 first.
 */

// ============================================================
//  Theme
// ============================================================

export type ThemeName = 'dark' | 'light';

/**
 * Theme token bag. Values are Tailwind utility class fragments used by
 * components as `className={t.bg}`. Mirrors DESIGN_SPEC.md §2.
 */
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
//  Pages & Blocks
// ============================================================

export interface CoverPage {
  id: 0;
  title: 'Cover';
  section: '00';
  isCover: true;
}

export interface ContentPage {
  id: number;
  title: string;
  section: string;
  body: Block[];
}

export type Page = CoverPage | ContentPage;

export type Block = TextBlock | TableBlock | PageBreakBlock;

export interface TextBlock {
  type: 'h1' | 'h2' | 'lead' | 'p';
  text: string;
}

export interface TableBlock {
  type: 'table';
  headers: string[];
  rows: string[][];
}

export interface PageBreakBlock {
  type: 'pageBreak';
}

// ============================================================
//  History & Edits
// ============================================================

export interface HistoryEntry {
  id: number;
  ts: number;
  pageId: number;
  pageTitle: string;
  oldBody: Block[];
  newBody: Block[];
  action: string;
  undone: boolean;
}

export interface Edit {
  historyId: number;
  pageId: number;
  pageTitle: string;
  oldBody: Block[];
  newBody: Block[];
}

// ============================================================
//  Chat messages
// ============================================================

export interface Message {
  role: 'user' | 'assistant';
  text: string;
  content?: string;
  edits?: Edit[];
  ui?: 'static' | 'inline';
  isError?: boolean;
}

// ============================================================
//  Inline editing
// ============================================================

export type InlineActionId = 'rewrite' | 'shorten' | 'translate';

export interface InlineAction {
  id: InlineActionId;
  label: string;
  // Icon is a lucide-react component. Typed loosely to avoid pulling
  // the dep into this pure-types module.
  icon: unknown;
}

export type InlineEditing =
  | {
      pageId: number;
      blockIdx: number;
      original: string;
      action: InlineActionId;
      status: 'loading';
    }
  | {
      pageId: number;
      blockIdx: number;
      original: string;
      action: InlineActionId;
      status: 'error';
      error: string;
    }
  | {
      pageId: number;
      blockIdx: number;
      original: string;
      suggestion: string;
      selectedText: string;
      action: InlineActionId;
      status: 'ready';
    };

// ============================================================
//  Diff engine (word-level text diff)
// ============================================================

export type Op =
  | { type: 'eq'; token: string }
  | { type: 'add'; token: string }
  | { type: 'del'; token: string };

export type Hunk =
  | { kind: 'eq'; token: string }
  | { kind: 'change'; id: number; del: string; add: string };

// ============================================================
//  Diff engine (table-level)
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
//  MVP additions (Design §3.1)
// ============================================================

export interface DocumentMeta {
  uploadId: string;
  fileName: string;
  fileSize: number;
  ownerHash?: string;
  hwpxVersion?: string;
  /** Count of OWPML nodes that were stashed as passthrough (unsupported). */
  unsupportedBlockCount: number;
}

export interface SearchHit {
  pageId: number;
  blockIdx: number;
  /** Defined only for TableBlock matches. */
  cell?: { rowIdx: number; colIdx: number };
  /** Surrounding snippet actually displayed in the result list. */
  text: string;
  /** Offsets within the full block text (or cell text). */
  range: { start: number; end: number };
}

/**
 * Error catalog — mirrors design §6.1. Keep in sync with backend errors.py.
 */
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
  /** User-facing message, Korean. */
  message: string;
  /** Debug-only detail, not shown to end users. */
  detail?: string;
  /** Whether the UI should offer a retry affordance. */
  recoverable: boolean;
}
