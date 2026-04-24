/**
 * Claude API client — calls the backend proxy (NEVER api.anthropic.com directly).
 *
 * Ported from hwpx-viewer-v8.jsx. Changes vs. prototype:
 *   - Fetch URL moved from https://api.anthropic.com/v1/messages to
 *     /api/claude/stream and /api/claude/once (backend proxy).
 *   - Request body: { system: 'doc_editor' | 'inline_editor', messages | prompt }.
 *     Server expands `system` to the actual prompt string.
 *   - SSE wire format is Anthropic's original — parser is unchanged.
 */

import type { Message } from '@/types';

export type SystemPromptId = 'doc_editor' | 'inline_editor';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';
const STREAM_PATH = '/api/claude/stream';
const ONCE_PATH = '/api/claude/once';

/** Subset of {@link Message} that the backend accepts as a chat turn. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Streaming chat call. Yields text deltas as they arrive.
 *
 * Consumes Anthropic's SSE format verbatim — the backend is a pure relay:
 *   event: content_block_delta
 *   data: { "type": "content_block_delta", "delta": { "type": "text_delta", "text": "..." } }
 */
export async function* streamClaude(
  system: SystemPromptId,
  conversation: ChatTurn[],
): AsyncGenerator<string> {
  const response = await fetch(`${API_BASE}${STREAM_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ system, messages: conversation }),
  });
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  if (!response.body) throw new Error('API error: no response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          const evt: unknown = JSON.parse(data);
          if (isTextDelta(evt)) yield evt.delta.text;
        } catch {
          // Ignore partial JSON lines — buffer handles it next read.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Non-streaming single-shot call for inline edits.
 * Returns the text content from the response (may be JSON — caller parses).
 */
export async function callClaudeOnce(
  system: SystemPromptId,
  userPrompt: string,
): Promise<string> {
  const response = await fetch(`${API_BASE}${ONCE_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system, prompt: userPrompt }),
  });
  if (!response.ok) {
    // Surface the backend's error.detail.error.message when available so the
    // inline error block shows the real cause (Claude CLI missing, OAuth
    // expired, rate limit, etc.) instead of a bare HTTP status.
    let detail = '';
    try {
      const body = (await response.json()) as {
        detail?: { error?: { code?: string; message?: string } };
      };
      const err = body?.detail?.error;
      if (err?.message) detail = `${err.code ?? 'ERROR'}: ${err.message}`;
    } catch {
      detail = await response.text().catch(() => '');
    }
    throw new Error(detail || `API error: ${response.status}`);
  }
  const data = (await response.json()) as { text: string };
  return data.text;
}

/** Convert a chat history to the wire format, filtering static system messages. */
export function toWireMessages(messages: readonly Message[]): ChatTurn[] {
  return messages
    .filter((m) => m.ui !== 'static')
    .map((m) => ({ role: m.role, content: m.content ?? m.text }));
}

// ---- internal type guards ----

interface TextDeltaEvent {
  type: 'content_block_delta';
  delta: { type: 'text_delta'; text: string };
}

function isTextDelta(evt: unknown): evt is TextDeltaEvent {
  if (typeof evt !== 'object' || evt === null) return false;
  const e = evt as { type?: unknown; delta?: { type?: unknown; text?: unknown } };
  return (
    e.type === 'content_block_delta' &&
    typeof e.delta === 'object' &&
    e.delta !== null &&
    e.delta.type === 'text_delta' &&
    typeof e.delta.text === 'string'
  );
}
