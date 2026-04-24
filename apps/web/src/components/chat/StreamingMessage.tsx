/**
 * StreamingMessage — assistant bubble shown while Claude is streaming.
 *
 * Attempts to peek inside partial JSON for a ``summary`` field so the user
 * sees human-readable progress rather than raw braces. Falls back to the
 * full streaming text for non-JSON responses.
 *
 * Ported from ``hwpx-viewer-v8.jsx`` §937.
 */

import { Sparkles } from 'lucide-react';

interface Props {
  text: string;
}

function extractDisplay(text: string): string {
  const summaryMatch = text.match(/"summary"\s*:\s*"([^"]*)/);
  if (summaryMatch?.[1]) return summaryMatch[1];
  if (text.trim().startsWith('{')) return '응답 작성 중…';
  return text;
}

export function StreamingMessage({ text }: Props) {
  const displayText = extractDisplay(text);
  return (
    <div className="flex gap-2.5">
      <div
        className="w-6 h-6 rounded flex-shrink-0 flex items-center justify-center mt-0.5"
        style={{ background: 'linear-gradient(135deg, #818cf8, #c084fc, #f472b6)' }}
      >
        <Sparkles size={10} style={{ color: 'white' }} />
      </div>
      <div className="flex-1 min-w-0 text-sm leading-relaxed" style={{ color: 'var(--text)' }}>
        <div className="whitespace-pre-wrap break-words">
          {displayText}
          <span
            className="inline-block w-1.5 h-3 ml-0.5 align-middle animate-pulse"
            style={{ backgroundColor: 'var(--accent)' }}
          />
        </div>
      </div>
    </div>
  );
}
