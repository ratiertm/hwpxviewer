/**
 * LCS-based word-level text diff.
 *
 * Ported verbatim from hwpx-viewer-v8.jsx (prototype). Do NOT change algorithmic
 * behavior without updating TEST_SPEC.md §1.
 *
 * Tokenization is Korean-aware: consecutive hangul/word chars form one token,
 * runs of whitespace form one token, individual punctuation characters are
 * separate tokens.
 */

import type { Hunk, Op } from '@/types';

/** Split text into tokens preserving Korean word boundaries. */
export function tokenize(text: string): string[] {
  return text.match(/[\w가-힣]+|\s+|[^\w\s가-힣]/g) ?? [];
}

/**
 * LCS length matrix. Uses Int32Array rows for O(mn) memory locality.
 * Do not replace with `number[]` — Int32Array is intentional.
 */
export function lcsMatrix(a: readonly string[], b: readonly string[]): Int32Array[] {
  const m = a.length;
  const n = b.length;
  const dp: Int32Array[] = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = 1; i <= m; i++) {
    const row = dp[i]!;
    const prev = dp[i - 1]!;
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) row[j] = prev[j - 1]! + 1;
      else row[j] = Math.max(prev[j]!, row[j - 1]!);
    }
  }
  return dp;
}

/**
 * Word-level diff between two strings.
 * Returns a merged op sequence where same-type adjacent ops are coalesced.
 */
export function diffTokens(oldText: string, newText: string): Op[] {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const dp = lcsMatrix(a, b);

  const ops: Op[] = [];
  let i = a.length;
  let j = b.length;

  while (i > 0 && j > 0) {
    const av = a[i - 1]!;
    const bv = b[j - 1]!;
    if (av === bv) {
      ops.push({ type: 'eq', token: av });
      i--;
      j--;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      ops.push({ type: 'del', token: av });
      i--;
    } else {
      ops.push({ type: 'add', token: bv });
      j--;
    }
  }
  while (i > 0) {
    ops.push({ type: 'del', token: a[i - 1]! });
    i--;
  }
  while (j > 0) {
    ops.push({ type: 'add', token: b[j - 1]! });
    j--;
  }
  ops.reverse();

  // Coalesce consecutive same-type ops.
  const merged: Op[] = [];
  for (const op of ops) {
    const last = merged[merged.length - 1];
    if (last && last.type === op.type) last.token += op.token;
    else merged.push({ ...op });
  }
  return merged;
}

/**
 * Group op sequence into cherry-pickable hunks.
 * `eq` ops become standalone eq hunks. Consecutive del/add runs become one
 * `change` hunk with monotonically increasing ids starting at 0.
 */
export function groupHunks(ops: readonly Op[]): Hunk[] {
  const hunks: Hunk[] = [];
  let i = 0;
  let hunkId = 0;
  while (i < ops.length) {
    const op = ops[i]!;
    if (op.type === 'eq') {
      hunks.push({ kind: 'eq', token: op.token });
      i++;
    } else {
      const dels: string[] = [];
      const adds: string[] = [];
      while (i < ops.length && ops[i]!.type !== 'eq') {
        const cur = ops[i]!;
        if (cur.type === 'del') dels.push(cur.token);
        else if (cur.type === 'add') adds.push(cur.token);
        i++;
      }
      hunks.push({ kind: 'change', id: hunkId++, del: dels.join(''), add: adds.join('') });
    }
  }
  return hunks;
}

/**
 * Rebuild the final text by walking hunks and applying the accepted ids.
 * Accepted change hunks contribute `add`; rejected contribute `del`.
 */
export function reconstructText(
  hunks: readonly Hunk[],
  acceptedIds: ReadonlySet<number>,
): string {
  let out = '';
  for (const h of hunks) {
    if (h.kind === 'eq') out += h.token;
    else if (acceptedIds.has(h.id)) out += h.add;
    else out += h.del;
  }
  return out;
}
