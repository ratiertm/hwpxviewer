/**
 * ChatMessage — single conversation bubble. User messages right-aligned,
 * assistant messages left-aligned with a sparkle avatar.
 *
 * Ported from ``hwpx-viewer-v8.jsx`` §1189. v0.3 simplification: the Block-
 * model ``edit`` attachments from the prototype aren't applicable yet
 * (SYSTEM_DOC_EDITOR's auto-edit pipeline targets Block pages, not Run
 * coordinates), so this renders conversation text only. Auto-edit batches
 * return in a later iteration when Claude is taught the Run coord schema.
 */

import { AlertCircle, Sparkles } from 'lucide-react';

import { ChatPatchCard } from '@/components/chat/ChatPatchCard';
import type { Message } from '@/types';

interface Props {
  msg: Message;
  msgIdx: number;
  busyPatch: boolean;
  onApplyPatch: (msgIdx: number) => void;
  onUndoPatch: (msgIdx: number) => void;
  onRejectPatch: (msgIdx: number) => void;
}

export function ChatMessage({ msg, msgIdx, busyPatch, onApplyPatch, onUndoPatch, onRejectPatch }: Props) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] px-3 py-2 rounded-2xl rounded-br-sm text-sm whitespace-pre-wrap break-words"
          style={{ backgroundColor: 'var(--bg-muted)', color: 'var(--text)' }}
        >
          {msg.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2.5">
      <div
        className="w-6 h-6 rounded flex-shrink-0 flex items-center justify-center mt-0.5"
        style={{
          background: msg.isError
            ? 'rgb(244 63 94 / 0.2)'
            : 'linear-gradient(135deg, #818cf8, #c084fc, #f472b6)',
        }}
      >
        {msg.isError ? (
          <AlertCircle size={10} style={{ color: '#fb7185' }} />
        ) : (
          <Sparkles size={10} style={{ color: 'white' }} />
        )}
      </div>
      <div
        className="flex-1 min-w-0 text-sm leading-relaxed break-words"
        style={{ color: msg.isError ? '#fda4af' : 'var(--text)' }}
      >
        <div className="whitespace-pre-wrap">
          {msg.text.split('**').map((part, i) =>
            i % 2 === 1 ? (
              <strong key={i} style={{ color: 'var(--text-strong)' }}>
                {part}
              </strong>
            ) : (
              <span key={i}>{part}</span>
            ),
          )}
        </div>
        {msg.editable && (
          <ChatPatchCard
            patch={msg.editable}
            busy={busyPatch}
            onApply={() => onApplyPatch(msgIdx)}
            onUndo={() => onUndoPatch(msgIdx)}
            onReject={() => onRejectPatch(msgIdx)}
          />
        )}
      </div>
    </div>
  );
}
