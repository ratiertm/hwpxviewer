/**
 * Robust JSON extraction from LLM responses.
 *
 * Strategy (in order):
 *   1. Strip ```json / ``` fences.
 *   2. Try direct JSON.parse.
 *   3. Slice from first `{` to last `}` and parse again.
 *
 * Ported from hwpx-viewer-v8.jsx. Do NOT add partial-JSON parsing here;
 * streaming callers wait for the full response before parsing.
 */

export function extractJson<T = unknown>(text: string): T {
  const cleaned = text.replace(/```json\s*|```/g, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    /* fall through to slice strategy */
  }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    } catch {
      /* fall through to error */
    }
  }
  throw new Error('JSON parse failed');
}
