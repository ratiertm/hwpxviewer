/**
 * Unit tests for the word-level diff engine.
 * Covers TEST_SPEC.md UT-01 ~ UT-33.
 *
 * Tests assert *invariants* (reconstruction correctness) rather than exact
 * op sequences where tokenizer granularity is implementation-defined.
 */

import { describe, expect, it } from 'vitest';
import type { Hunk, Op } from '@/types';
import { diffTokens, groupHunks, reconstructText, tokenize } from './text';

describe('tokenize', () => {
  it('UT-01: 영문 단어 분리', () => {
    expect(tokenize('Hello world')).toEqual(['Hello', ' ', 'world']);
  });

  it('UT-02: 한글 단어 분리', () => {
    expect(tokenize('안녕하세요 반갑습니다')).toEqual(['안녕하세요', ' ', '반갑습니다']);
  });

  it('UT-03: 구두점 분리', () => {
    expect(tokenize('Hello, world!')).toEqual(['Hello', ',', ' ', 'world', '!']);
  });

  it('UT-04: 혼합(한/영/숫자/구두점)', () => {
    const tokens = tokenize('2026년 Q1 목표는 60%.');
    expect(tokens).toContain('2026년');
    expect(tokens).toContain(' ');
    expect(tokens).toContain('Q1');
    expect(tokens).toContain('60');
    expect(tokens).toContain('%');
    expect(tokens).toContain('.');
    // Round-trip is lossless.
    expect(tokens.join('')).toBe('2026년 Q1 목표는 60%.');
  });

  it('UT-05: 공백 시퀀스 단일 토큰', () => {
    expect(tokenize('a   b')).toEqual(['a', '   ', 'b']);
  });

  it('UT-06: 빈 문자열', () => {
    expect(tokenize('')).toEqual([]);
  });
});

/**
 * Shared invariants for any diffTokens output.
 */
function reconstructOld(ops: readonly Op[]): string {
  return ops
    .filter((op) => op.type !== 'add')
    .map((op) => op.token)
    .join('');
}
function reconstructNew(ops: readonly Op[]): string {
  return ops
    .filter((op) => op.type !== 'del')
    .map((op) => op.token)
    .join('');
}

describe('diffTokens', () => {
  it('UT-10: 동일 문자열은 하나의 eq 토큰', () => {
    const ops = diffTokens('안녕하세요', '안녕하세요');
    expect(ops).toEqual([{ type: 'eq', token: '안녕하세요' }]);
  });

  it('UT-11: 단순 치환 — del + add 모두 존재', () => {
    const ops = diffTokens('안녕하세요', '반갑습니다');
    expect(ops.some((op) => op.type === 'del')).toBe(true);
    expect(ops.some((op) => op.type === 'add')).toBe(true);
    expect(reconstructOld(ops)).toBe('안녕하세요');
    expect(reconstructNew(ops)).toBe('반갑습니다');
  });

  it('UT-12: 중간 토큰 치환 — 재구성 무결', () => {
    const ops = diffTokens('나는 학생이다', '나는 선생이다');
    expect(reconstructOld(ops)).toBe('나는 학생이다');
    expect(reconstructNew(ops)).toBe('나는 선생이다');
    expect(ops.some((op) => op.type === 'eq')).toBe(true);
  });

  it('UT-13: 같은 타입 연속 병합', () => {
    const ops = diffTokens('ab', 'xy');
    // 분리되지 않고 하나의 del/add로 병합되어야 함.
    const dels = ops.filter((op) => op.type === 'del');
    const adds = ops.filter((op) => op.type === 'add');
    expect(dels).toHaveLength(1);
    expect(adds).toHaveLength(1);
    expect(dels[0]!.token).toBe('ab');
    expect(adds[0]!.token).toBe('xy');
  });

  it('UT-14: 완전 추가', () => {
    const ops = diffTokens('', '새로운 문장');
    expect(ops.every((op) => op.type === 'add')).toBe(true);
    expect(reconstructNew(ops)).toBe('새로운 문장');
    expect(reconstructOld(ops)).toBe('');
  });

  it('UT-15: 완전 삭제', () => {
    const ops = diffTokens('삭제될 문장', '');
    expect(ops.every((op) => op.type === 'del')).toBe(true);
    expect(reconstructOld(ops)).toBe('삭제될 문장');
    expect(reconstructNew(ops)).toBe('');
  });
});

describe('groupHunks', () => {
  it('UT-20: 변경 없는 텍스트 — eq hunk만', () => {
    const hunks = groupHunks([{ type: 'eq', token: 'hello' }]);
    expect(hunks).toEqual<Hunk[]>([{ kind: 'eq', token: 'hello' }]);
  });

  it('UT-21: 한 번의 변경', () => {
    const hunks = groupHunks([
      { type: 'eq', token: 'a ' },
      { type: 'del', token: 'b' },
      { type: 'add', token: 'c' },
      { type: 'eq', token: ' d' },
    ]);
    expect(hunks).toEqual<Hunk[]>([
      { kind: 'eq', token: 'a ' },
      { kind: 'change', id: 0, del: 'b', add: 'c' },
      { kind: 'eq', token: ' d' },
    ]);
  });

  it('UT-22: 연속 del+add는 단일 change로 병합', () => {
    const hunks = groupHunks([
      { type: 'del', token: 'a' },
      { type: 'del', token: 'b' },
      { type: 'add', token: 'x' },
      { type: 'add', token: 'y' },
    ]);
    expect(hunks).toEqual<Hunk[]>([{ kind: 'change', id: 0, del: 'ab', add: 'xy' }]);
  });

  it('UT-23: change hunk id는 0부터 단조 증가', () => {
    const hunks = groupHunks([
      { type: 'del', token: 'a' }, // change 0
      { type: 'eq', token: ' ' },
      { type: 'add', token: 'b' }, // change 1
      { type: 'eq', token: ' ' },
      { type: 'del', token: 'c' }, // change 2
    ]);
    const changeIds = hunks.filter((h) => h.kind === 'change').map((h) => h.id);
    expect(changeIds).toEqual([0, 1, 2]);
  });
});

describe('reconstructText', () => {
  const hunks: Hunk[] = [
    { kind: 'eq', token: 'a ' },
    { kind: 'change', id: 0, del: 'b', add: 'c' },
    { kind: 'eq', token: ' d' },
  ];

  it('UT-30: 모두 수락 — add 반영', () => {
    expect(reconstructText(hunks, new Set([0]))).toBe('a c d');
  });

  it('UT-31: 모두 거부 — del 반영(원본)', () => {
    expect(reconstructText(hunks, new Set())).toBe('a b d');
  });

  it('UT-32: 부분 수락', () => {
    const twoChanges: Hunk[] = [
      { kind: 'change', id: 0, del: 'a', add: 'x' },
      { kind: 'eq', token: '-' },
      { kind: 'change', id: 1, del: 'b', add: 'y' },
    ];
    expect(reconstructText(twoChanges, new Set([0]))).toBe('x-b');
    expect(reconstructText(twoChanges, new Set([1]))).toBe('a-y');
  });

  it('UT-33: eq 토큰은 acceptedIds와 무관하게 보존', () => {
    const eqHunks: Hunk[] = [
      { kind: 'eq', token: 'preserve ' },
      { kind: 'change', id: 0, del: 'x', add: 'y' },
      { kind: 'eq', token: ' end' },
    ];
    expect(reconstructText(eqHunks, new Set()).includes('preserve ')).toBe(true);
    expect(reconstructText(eqHunks, new Set()).includes(' end')).toBe(true);
    expect(reconstructText(eqHunks, new Set([0])).includes('preserve ')).toBe(true);
  });
});
