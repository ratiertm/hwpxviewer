/**
 * ChatPanel — 420px right-side drawer with multi-turn Claude conversation.
 *
 * Structure (ported from ``hwpx-viewer-v8.jsx`` §832):
 *   - Header: title + turn counter + 초기화 + 닫기
 *   - Scroll area: rendered ChatMessage list, plus StreamingMessage while
 *     the assistant is mid-response
 *   - Suggestions (shown only when empty): one-click starter prompts
 *   - Input: textarea + send button. Enter sends, Shift+Enter inserts newline.
 *
 * State is owned by the Zustand store; this component only renders + dispatches.
 */

import { ArrowUp, MessageSquare, Paperclip, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { ChatMessage } from '@/components/chat/ChatMessage';
import { StreamingMessage } from '@/components/chat/StreamingMessage';
import { useStreamChat } from '@/hooks/useStreamChat';
import { useViewerStore } from '@/state/store';

const SUGGESTIONS: ReadonlyArray<string> = [
  '문서 톤을 더 격식 있게 통일하려면 어디를 고쳐야 할까요?',
  '문장이 길어 보이는 문단을 짚어주세요.',
  '오탈자 / 맞춤법이 의심스러운 부분을 찾아주세요.',
  '결론을 더 임팩트 있게 다시 쓰려면 어떻게 해야 할까요?',
];

interface Props {
  busyPatchMsgIdx: number | null;
  onApplyPatch: (msgIdx: number) => void;
  onUndoPatch: (msgIdx: number) => void;
  onRejectPatch: (msgIdx: number) => void;
}

export function ChatPanel({ busyPatchMsgIdx, onApplyPatch, onUndoPatch, onRejectPatch }: Props) {
  const messages = useViewerStore((s) => s.messages);
  const chatInput = useViewerStore((s) => s.chatInput);
  const isStreaming = useViewerStore((s) => s.isStreaming);
  const streamingText = useViewerStore((s) => s.streamingText);
  const attachedText = useViewerStore((s) => s.attachedText);
  const setAttachedText = useViewerStore((s) => s.setAttachedText);
  const setChatInput = useViewerStore((s) => s.setChatInput);
  const clearConversation = useViewerStore((s) => s.clearConversation);
  const toggleChat = useViewerStore((s) => s.toggleChat);

  const { send } = useStreamChat();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom on every render that actually changed the content
  // (new message, streaming chunk).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isStreaming, streamingText]);

  const turnCount = messages.filter((m) => m.role === 'user').length;
  const showSuggestions = messages.length === 0 && !isStreaming;

  return (
    <div
      className="w-[420px] h-full flex flex-col border-l backdrop-blur-xl"
      style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border)' }}
    >
      {/* Header */}
      <div
        className="h-12 px-4 flex items-center gap-2 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #818cf8, #c084fc, #f472b6)' }}
        >
          <Sparkles size={12} style={{ color: 'white' }} />
        </div>
        <div className="flex-1">
          <div
            className="text-sm font-semibold flex items-center gap-1.5"
            style={{ color: 'var(--text-strong)' }}
          >
            Document AI
            <MessageSquare size={10} style={{ color: 'var(--text-faint)' }} />
            <span
              className="text-xs font-normal tabular-nums"
              style={{ color: 'var(--text-faint)' }}
            >
              {turnCount} turns
            </span>
          </div>
          <div className="text-xs" style={{ color: 'var(--text-faint)' }}>
            멀티턴 · 스트리밍 · Sonnet 4
          </div>
        </div>
        <button
          onClick={clearConversation}
          title="대화 초기화"
          className="w-7 h-7 rounded-md hover:bg-bg-muted flex items-center justify-center appearance-none"
          style={{ color: 'var(--text-muted)' }}
        >
          <Trash2 size={13} />
        </button>
        <button
          onClick={toggleChat}
          title="패널 닫기"
          className="flex items-center gap-1 px-2 h-7 rounded-md border hover:bg-bg-muted text-xs font-medium appearance-none"
          style={{
            borderColor: 'var(--border)',
            backgroundColor: 'var(--bg-subtle)',
            color: 'var(--text-muted)',
          }}
        >
          <X size={13} />
          <span>닫기</span>
        </button>
      </div>

      {/* Scroll area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !isStreaming && (
          <div className="text-xs text-center py-8" style={{ color: 'var(--text-faint)' }}>
            Claude와 대화를 시작해보세요.
            <br />
            문서에 대한 조언이나 편집 방향을 물어볼 수 있습니다.
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessage
            key={i}
            msg={msg}
            msgIdx={i}
            busyPatch={busyPatchMsgIdx === i}
            onApplyPatch={onApplyPatch}
            onUndoPatch={onUndoPatch}
            onRejectPatch={onRejectPatch}
          />
        ))}
        {isStreaming && <StreamingMessage text={streamingText} />}
      </div>

      {/* Suggestions (only on empty conversation) */}
      {showSuggestions && (
        <div className="px-4 pb-3 space-y-1.5">
          <div className="text-xs mb-2 px-1" style={{ color: 'var(--text-faint)' }}>
            제안
          </div>
          {SUGGESTIONS.map((s, i) => (
            <button
              key={i}
              onClick={() => void send(s)}
              className="w-full text-left text-xs px-3 py-2 rounded-lg border hover:bg-bg-muted transition-colors appearance-none"
              style={{
                borderColor: 'var(--border)',
                color: 'var(--text-muted)',
                backgroundColor: 'var(--bg-subtle)',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t space-y-2" style={{ borderColor: 'var(--border)' }}>
        {attachedText && (
          <div
            className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg border text-xs"
            style={{
              backgroundColor: 'var(--bg-subtle)',
              borderColor: 'var(--accent)',
              color: 'var(--text)',
            }}
          >
            <Paperclip size={11} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--accent)' }} />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--accent)' }}>
                선택 영역 첨부
              </div>
              <div
                className="text-[11px] whitespace-pre-wrap break-words max-h-16 overflow-auto leading-snug"
                style={{ color: 'var(--text-muted)' }}
              >
                {attachedText}
              </div>
            </div>
            <button
              onClick={() => setAttachedText(null)}
              className="w-5 h-5 rounded hover:bg-bg-muted flex items-center justify-center appearance-none flex-shrink-0"
              style={{ color: 'var(--text-muted)' }}
              aria-label="첨부 제거"
              title="첨부 제거"
            >
              <X size={11} />
            </button>
          </div>
        )}
        <div
          className="relative rounded-xl border focus-within:ring-2 focus-within:ring-accent/40 transition-all"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--input-bg)' }}
        >
          <textarea
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(chatInput);
              }
            }}
            placeholder={
              attachedText
                ? '첨부된 영역으로 무엇을 할까요? (예: "서술형으로 바꿔줘")'
                : messages.length > 0
                  ? '이어서 대화하기…'
                  : '문서에 대해 무엇이든 물어보세요.'
            }
            rows={2}
            disabled={isStreaming}
            className="w-full px-3 py-2.5 pr-12 bg-transparent text-sm resize-none focus:outline-none disabled:opacity-50 appearance-none"
            style={{ color: 'var(--text-strong)', minHeight: '60px' }}
          />
          <button
            onClick={() => void send(chatInput)}
            disabled={(!chatInput.trim() && !attachedText) || isStreaming}
            className="absolute bottom-2 right-2 w-7 h-7 rounded-lg text-white flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed hover:scale-105 transition-transform appearance-none"
            style={{ background: 'linear-gradient(135deg, #6366f1, #ec4899)' }}
            aria-label="전송"
          >
            <ArrowUp size={14} />
          </button>
        </div>
        <div className="text-[10px] px-1" style={{ color: 'var(--text-faint)' }}>
          Enter: 전송 · Shift+Enter: 줄바꿈 · 선택 영역은 자동으로 인용 첨부됩니다.
        </div>
      </div>
    </div>
  );
}
