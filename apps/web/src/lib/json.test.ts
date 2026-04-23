/**
 * Unit tests for extractJson.
 * Covers TEST_SPEC.md UT-50 ~ UT-54.
 */

import { describe, expect, it } from 'vitest';
import { extractJson } from './json';

describe('extractJson', () => {
  it('UT-50: 순수 JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('UT-51: 코드 펜스 포함', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('UT-52: 앞뒤 설명 텍스트 포함', () => {
    expect(extractJson('여기 결과입니다:\n{"a":1}\n끝.')).toEqual({ a: 1 });
  });

  it('UT-53: 잘못된 JSON은 에러', () => {
    expect(() => extractJson('not json at all')).toThrow('JSON parse failed');
  });

  it('UT-54: 부분 JSON(스트리밍 끊김)은 에러', () => {
    expect(() => extractJson('{"a":1,')).toThrow('JSON parse failed');
  });

  it('추가: 중첩 JSON도 slice 전략으로 복구', () => {
    const text = 'Summary: {"summary":"ok","edits":[{"id":1}]} (end)';
    expect(extractJson(text)).toEqual({ summary: 'ok', edits: [{ id: 1 }] });
  });
});
