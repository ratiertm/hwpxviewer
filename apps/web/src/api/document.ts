/**
 * Document API client — backend endpoints for upload, render, hit-test,
 * selection-rects, text-range, edit, undo, download.
 *
 * Source of truth: docs/02-design/features/hwpx-viewer-mvp.design.md v0.3 §4.
 *
 * Every call funnels through ``jsonFetch`` so error payloads
 * (``{ detail: { error: { code, message, ... } } }``) surface as
 * structured ``ApiError`` instances the UI can map to toasts.
 */

import type {
  CellRef,
  DocumentInfo,
  RunLocation,
  Selection,
  SelectionRect,
} from '@/types';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly recoverable: boolean;
  constructor(status: number, code: string, message: string, recoverable = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.recoverable = recoverable;
  }
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as
      | { detail?: { error?: { code?: string; message?: string; recoverable?: boolean } } }
      | null;
    const err = body?.detail?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'HTTP_ERROR',
      err?.message ?? `요청 실패 (${res.status})`,
      err?.recoverable ?? false,
    );
  }
  return (await res.json()) as T;
}

// --- Upload / download --------------------------------------------------

export async function uploadHwpx(file: File): Promise<DocumentInfo> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as
      | { detail?: { error?: { code?: string; message?: string } } }
      | null;
    const err = body?.detail?.error;
    throw new ApiError(res.status, err?.code ?? 'UPLOAD_FAILED', err?.message ?? '업로드에 실패했습니다.');
  }
  const body = (await res.json()) as { document: DocumentInfo };
  return body.document;
}

export function downloadUrl(uploadId: string, version?: number): string {
  // ``version`` is appended as a cache-buster so the browser can never serve
  // a stale pre-edit download. The backend ignores the param.
  const bust = version !== undefined ? `?v=${version}&t=${Date.now()}` : `?t=${Date.now()}`;
  return `${API_BASE}/api/download/${uploadId}${bust}`;
}

// --- Server-side save (preferred over downloadUrl on local installs) ----

export interface SaveResult {
  path: string;
  fileName: string;
  fileSize: number;
  version: number;
  edits: number;
}

export async function saveDocument(
  uploadId: string,
  overwrite = false,
): Promise<SaveResult> {
  return await jsonFetch<SaveResult>('/api/save', {
    method: 'POST',
    body: JSON.stringify({ uploadId, overwrite }),
  });
}

export async function revealInFinder(path: string): Promise<boolean> {
  const body = await jsonFetch<{ ok: boolean }>('/api/reveal', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
  return body.ok;
}

// --- Render -------------------------------------------------------------

export async function fetchPageSvg(uploadId: string, page: number, version?: number): Promise<string> {
  // `version` is appended as a query param purely to bust the browser cache
  // when the document has been edited.
  const bust = version !== undefined ? `?v=${version}` : '';
  const res = await fetch(`${API_BASE}/api/render/${uploadId}/${page}${bust}`);
  if (!res.ok) throw new ApiError(res.status, 'RENDER_ERROR', `page ${page} 렌더링 실패`);
  return await res.text();
}

// --- Hit-test / selection -----------------------------------------------

export async function hitTest(
  uploadId: string,
  page: number,
  x: number,
  y: number,
): Promise<RunLocation | null> {
  const body = await jsonFetch<{ location: RunLocation | null }>('/api/hit-test', {
    method: 'POST',
    body: JSON.stringify({ uploadId, page, x, y }),
  });
  return body.location;
}

export async function getSelectionRects(
  uploadId: string,
  selection: Selection,
): Promise<SelectionRect[]> {
  const body = await jsonFetch<{ rects: SelectionRect[] }>('/api/selection-rects', {
    method: 'POST',
    body: JSON.stringify({ uploadId, selection }),
  });
  return body.rects;
}

export async function getTextRange(
  uploadId: string,
  selection: Selection,
): Promise<string> {
  const body = await jsonFetch<{ text: string }>('/api/text-range', {
    method: 'POST',
    body: JSON.stringify({ uploadId, selection }),
  });
  return body.text;
}

export async function getParagraph(
  uploadId: string,
  sec: number,
  para: number,
  cell?: CellRef | null,
): Promise<{ length: number; text: string }> {
  return await jsonFetch<{ length: number; text: string }>('/api/paragraph', {
    method: 'POST',
    body: JSON.stringify({ uploadId, sec, para, cell: cell ?? null }),
  });
}

// --- Edit / undo --------------------------------------------------------

export interface EditResult {
  editId: number;
  document: DocumentInfo;
  affectedPages: number[];
}

export async function applyEdit(
  uploadId: string,
  selection: Selection,
  newText: string,
): Promise<EditResult> {
  return await jsonFetch<EditResult>('/api/edit', {
    method: 'POST',
    body: JSON.stringify({ uploadId, selection, newText }),
  });
}

export async function undoEdit(uploadId: string, editId: number): Promise<EditResult> {
  return await jsonFetch<EditResult>('/api/undo', {
    method: 'POST',
    body: JSON.stringify({ uploadId, editId }),
  });
}
