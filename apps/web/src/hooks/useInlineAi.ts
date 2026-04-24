/**
 * useInlineAi — orchestrates the inline AI-rewrite pipeline.
 *
 * Flow (design v0.3 §2.2C):
 *   1. ``begin(action)`` — called when user clicks 다시 쓰기 / 간결하게 / 영어로.
 *      Immediately sets inline state to 'loading' and fires /api/claude/once
 *      with ``inline_editor`` system prompt.
 *   2. Response → extract ``newText`` from JSON → state flips to 'ready' with
 *      the suggestion. The parent renders InlineCherryPickDiff.
 *   3. On error → state flips to 'error' with a user-readable message.
 *
 * The hook is stateless at the React level; it writes into the Zustand store
 * so the menu / loading / cherry-pick components all read a single source.
 */

import { useCallback } from 'react';

import { callClaudeOnce } from '@/api/claude';
import { extractJson } from '@/lib/json';
import { useViewerStore } from '@/state/store';
import type { InlineActionId } from '@/types';

const ACTION_LABEL: Record<InlineActionId, string> = {
  rewrite: '다시 쓰기',
  shorten: '간결하게',
  translate: '영어로',
};

export interface InlineAiTarget {
  selection: import('@/types').Selection;
  text: string;
}

export function useInlineAi(target: InlineAiTarget | null) {
  const startInline = useViewerStore((s) => s.startInline);
  const setInlineError = useViewerStore((s) => s.setInlineError);
  const setInlineReady = useViewerStore((s) => s.setInlineReady);
  const closeMenu = useViewerStore((s) => s.closeMenu);

  const begin = useCallback(
    async (action: InlineActionId, guide?: string) => {
      if (!target) return;
      const { selection, text } = target;
      startInline({ selection, original: text, action });
      closeMenu();
      let raw: string | undefined;
      try {
        const trimmedGuide = guide?.trim();
        const guideLine = trimmedGuide
          ? `\n\n추가 가이드 (이 지시를 최우선으로 반영):\n${trimmedGuide}`
          : '';
        const userPrompt =
          `원본 문장:\n${text}\n\n` +
          `선택된 부분:\n${text}\n\n` +   // v0.3 selects a whole paragraph/range — the two coincide.
          `액션: ${action}` +
          guideLine;
        raw = await callClaudeOnce('inline_editor', userPrompt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setInlineError(`Claude 호출 실패: ${msg}`);
        return;
      }

      let parsed: { newText?: string };
      try {
        parsed = extractJson<{ newText?: string }>(raw);
      } catch {
        // eslint-disable-next-line no-console
        console.warn('[inline-ai] JSON parse failed; raw response:', raw);
        setInlineError(`응답 파싱 실패. 원문: ${raw.slice(0, 200)}`);
        return;
      }

      const suggestion = parsed?.newText?.trim();
      if (!suggestion) {
        setInlineError(
          `AI 응답에 newText 필드가 없습니다. 받은 키: ${Object.keys(parsed ?? {}).join(', ') || '(없음)'}`,
        );
        return;
      }
      if (suggestion === text) {
        setInlineError('AI가 변경 사항 없이 원본을 반환했습니다.');
        return;
      }
      setInlineReady(suggestion);
    },
    [target, startInline, closeMenu, setInlineError, setInlineReady],
  );

  return { begin, actionLabel: (id: InlineActionId) => ACTION_LABEL[id] };
}
