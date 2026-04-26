/**
 * AI document generation client.
 *
 * Two-phase: POST /api/generate/start → { jobId }, then EventSource
 * /api/generate/stream/{jobId} replays step events. The caller wires
 * a callback per step; on "done" we receive a fully-registered uploadId
 * that the App can hand straight to fetchPageSvg.
 */

import type { Intent } from '@/types';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export interface GenerateRequestPayload {
  intent: Intent;
  theme?: string;
  prompt: string;
}

export interface GenerateStepEvent {
  step:
    | 'plan'
    | 'plan_ready'
    | 'build'
    | 'validate'
    | 'register'
    | 'done'
    | 'error';
  message?: string;
  // step=plan_ready
  theme?: string;
  blockCount?: number;
  title?: string;
  // step=done
  uploadId?: string;
  fileName?: string;
  pageCount?: number;
  warnings?: { errors: string[]; warnings: string[]; info: string[] };
  // step=error
  code?: string;
}

export async function startGenerateJob(
  payload: GenerateRequestPayload,
): Promise<string> {
  const res = await fetch(`${API_BASE}/api/generate/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { detail?: { error?: { message?: string } } }
      | null;
    throw new Error(body?.detail?.error?.message ?? `생성 시작 실패 (${res.status})`);
  }
  const body = (await res.json()) as { jobId: string };
  return body.jobId;
}

/**
 * Open an EventSource against the job stream. Returns a disposer that
 * closes the connection. The handler is called for every parsed event;
 * the caller is responsible for closing on terminal steps.
 */
export function openGenerateStream(
  jobId: string,
  onEvent: (evt: GenerateStepEvent) => void,
): () => void {
  const url = `${API_BASE}/api/generate/stream/${encodeURIComponent(jobId)}`;
  const es = new EventSource(url);
  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data) as GenerateStepEvent;
      onEvent(data);
      if (data.step === 'done' || data.step === 'error') {
        es.close();
      }
    } catch {
      // Ignore parse errors; the worker should only emit JSON.
    }
  };
  es.onerror = () => {
    onEvent({ step: 'error', code: 'SSE_DISCONNECT', message: '서버 스트림 연결이 끊겼어요.' });
    es.close();
  };
  return () => es.close();
}
