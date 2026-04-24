/**
 * useStreamChat — Claude conversation driver.
 *
 * Two routing modes, chosen per turn:
 *   1. **Attached-selection mode** (``attachedText`` + ``attachedSelection``):
 *      the user has pinned a paragraph from the document. We send the turn
 *      through the ``inline_editor`` prompt, non-streaming, and attach the
 *      returned ``newText`` to the assistant bubble as an ``EditablePatch``.
 *      The in-bubble [적용] button then pushes the patch through
 *      ``/api/edit`` — no manual select-and-paste.
 *
 *   2. **Free conversation** (no attachment): the streaming ``doc_editor``
 *      prompt is used, and the assistant bubble is pure text (summary is
 *      extracted from the JSON response when present).
 *
 * Rationale: the user complained that chat could only suggest, not apply.
 * Attached-selection mode closes that loop by making every chat turn with
 * an attachment a fully-automated inline edit.
 */

import { useCallback } from 'react';

import { callClaudeOnce, streamClaude, toWireMessages } from '@/api/claude';
import { extractJson } from '@/lib/json';
import { useViewerStore } from '@/state/store';
import type { DocumentInfo, Message } from '@/types';

function buildFirstTurnContent(text: string, info: DocumentInfo | null): string {
  if (!info) return text;
  return (
    `현재 문서 정보:\n` +
    `- 파일명: ${info.fileName}\n` +
    `- 페이지 수: ${info.pageCount}\n` +
    `- 버전: ${info.version}\n\n` +
    `사용자 요청:\n${text}\n\n` +
    `참고: 자유 대화 모드입니다. 특정 문단을 실제로 편집하려면 ` +
    `사용자가 문서에서 텍스트를 선택해 이 채팅에 첨부합니다. ` +
    `첨부가 있는 메시지는 자동으로 편집 제안 모드로 전환됩니다.`
  );
}

export interface UseStreamChat {
  send: (text: string) => Promise<void>;
}

export function useStreamChat(): UseStreamChat {
  const info = useViewerStore((s) => s.info);
  const messages = useViewerStore((s) => s.messages);
  const isStreaming = useViewerStore((s) => s.isStreaming);
  const appendMessage = useViewerStore((s) => s.appendMessage);
  const setStreaming = useViewerStore((s) => s.setStreaming);
  const appendStreamChunk = useViewerStore((s) => s.appendStreamChunk);
  const setChatInput = useViewerStore((s) => s.setChatInput);
  const attachedText = useViewerStore((s) => s.attachedText);
  const attachedSelection = useViewerStore((s) => s.attachedSelection);
  const clearAttachment = useViewerStore((s) => s.clearAttachment);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      const hasAttachment = attachedText !== null && attachedSelection !== null;
      if (!trimmed && !hasAttachment) return;
      if (isStreaming) return;

      // ---------------- Attached-selection → inline edit path ----------------
      if (hasAttachment) {
        const promptText =
          trimmed ||
          '위 문단을 더 자연스럽고 공공 문서 톤에 맞게 다시 써주세요.';
        const quote = `> ${attachedText.replace(/\n/g, '\n> ')}\n\n`;

        // User bubble: show quote + typed question (what the human wrote).
        appendMessage({ role: 'user', text: quote + promptText, ui: 'inline' });
        setChatInput('');
        clearAttachment();
        setStreaming(true);

        let raw: string;
        try {
          const userPrompt =
            `원본 문장:\n${attachedText}\n\n` +
            `선택된 부분:\n${attachedText}\n\n` +
            `액션: rewrite\n\n` +
            `추가 가이드 (이 지시를 최우선으로 반영):\n${promptText}`;
          raw = await callClaudeOnce('inline_editor', userPrompt);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          appendMessage({
            role: 'assistant',
            text: `편집 제안 생성에 실패했습니다: ${msg}`,
            isError: true,
            ui: 'inline',
          });
          setStreaming(false);
          return;
        }

        let parsed: { newText?: string };
        try {
          parsed = extractJson<{ newText?: string }>(raw);
        } catch {
          appendMessage({
            role: 'assistant',
            text: `AI 응답 파싱 실패 — 원문: ${raw.slice(0, 300)}`,
            isError: true,
            ui: 'inline',
          });
          setStreaming(false);
          return;
        }

        const suggestion = parsed?.newText?.trim();
        if (!suggestion) {
          appendMessage({
            role: 'assistant',
            text: 'AI가 newText를 돌려주지 않았습니다. 다시 시도해 보세요.',
            isError: true,
            ui: 'inline',
          });
          setStreaming(false);
          return;
        }
        if (suggestion === attachedText) {
          appendMessage({
            role: 'assistant',
            text: '변경할 부분이 없다고 판단했습니다. 다른 지시를 시도해 보세요.',
            ui: 'inline',
          });
          setStreaming(false);
          return;
        }

        const assistantMsg: Message = {
          role: 'assistant',
          text: '아래 제안대로 문서를 바꿀까요? [적용] 버튼을 누르면 실제 문서에 반영됩니다.',
          content: raw,
          editable: {
            selection: attachedSelection,
            original: attachedText,
            suggestion,
          },
          ui: 'inline',
        };
        appendMessage(assistantMsg);
        setStreaming(false);
        return;
      }

      // ---------------- Free conversation → doc_editor streaming ----------------
      const isFirstApiTurn = !messages.some((m) => m.role === 'user');
      const apiPrompt = isFirstApiTurn ? buildFirstTurnContent(trimmed, info) : trimmed;
      const newUserMsg: Message = { role: 'user', text: trimmed, content: apiPrompt };
      appendMessage(newUserMsg);
      setChatInput('');
      setStreaming(true);

      const apiMessages = toWireMessages([...messages, newUserMsg]);

      let fullText = '';
      try {
        for await (const chunk of streamClaude('doc_editor', apiMessages)) {
          fullText += chunk;
          appendStreamChunk(chunk);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        appendMessage({
          role: 'assistant',
          text: `오류가 발생했습니다: ${msg}`,
          isError: true,
          ui: 'inline',
        });
        setStreaming(false);
        return;
      }

      let display = fullText;
      try {
        const parsed = extractJson<{ summary?: string }>(fullText);
        if (parsed?.summary) display = parsed.summary;
      } catch {
        // Plain text response — keep as-is.
      }
      appendMessage({ role: 'assistant', text: display, content: fullText });
      setStreaming(false);
    },
    [
      info,
      messages,
      isStreaming,
      attachedText,
      attachedSelection,
      appendMessage,
      setChatInput,
      clearAttachment,
      setStreaming,
      appendStreamChunk,
    ],
  );

  return { send };
}
