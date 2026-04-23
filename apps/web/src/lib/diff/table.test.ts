/**
 * Unit tests for TableBlock diff.
 * Covers TEST_SPEC.md UT-40 ~ UT-45.
 */

import { describe, expect, it } from 'vitest';
import type { TableBlock } from '@/types';
import { diffTable } from './table';

function table(headers: string[], rows: string[][]): TableBlock {
  return { type: 'table', headers, rows };
}

describe('diffTable', () => {
  it('UT-40: 동일 표 — 모두 eq', () => {
    const t = table(
      ['A', 'B'],
      [
        ['1', '2'],
        ['3', '4'],
      ],
    );
    const { headerOps, rowOps } = diffTable(t, t);
    expect(headerOps.every((op) => op.type === 'eq')).toBe(true);
    expect(rowOps.every((op) => op.type === 'eq')).toBe(true);
  });

  it('UT-41: 행 추가', () => {
    const oldT = table(
      ['A'],
      [['row1'], ['row2'], ['row3']],
    );
    const newT = table(
      ['A'],
      [['row1'], ['row2'], ['row3'], ['row4']],
    );
    const { rowOps } = diffTable(oldT, newT);
    expect(rowOps.filter((op) => op.type === 'eq')).toHaveLength(3);
    expect(rowOps.filter((op) => op.type === 'add')).toHaveLength(1);
  });

  it('UT-42: 행 삭제', () => {
    const oldT = table(
      ['A'],
      [['row1'], ['row2'], ['row3']],
    );
    const newT = table(['A'], [['row1'], ['row3']]);
    const { rowOps } = diffTable(oldT, newT);
    expect(rowOps.filter((op) => op.type === 'eq')).toHaveLength(2);
    expect(rowOps.filter((op) => op.type === 'del')).toHaveLength(1);
  });

  it('UT-43: 컬럼 추가', () => {
    const oldT = table(['A', 'B'], []);
    const newT = table(['A', 'B', 'C'], []);
    const { headerOps } = diffTable(oldT, newT);
    expect(headerOps).toEqual([
      { type: 'eq', header: 'A', oldIdx: 0, newIdx: 0 },
      { type: 'eq', header: 'B', oldIdx: 1, newIdx: 1 },
      { type: 'add', header: 'C', newIdx: 2 },
    ]);
  });

  it('UT-44: 셀 내용 변경', () => {
    const oldT = table(
      ['label', 'value'],
      [['총액', '100']],
    );
    const newT = table(
      ['label', 'value'],
      [['총액', '150']],
    );
    const { rowOps } = diffTable(oldT, newT);
    const change = rowOps.find((op) => op.type === 'change');
    expect(change).toBeDefined();
    if (change && change.type === 'change') {
      expect(change.oldRow).toEqual(['총액', '100']);
      expect(change.newRow).toEqual(['총액', '150']);
    }
  });

  it('UT-45: 행 순서 변경은 감지 안 됨(의도된 한계)', () => {
    const oldT = table(['k'], [['A'], ['B']]);
    const newT = table(['k'], [['B'], ['A']]);
    const { rowOps } = diffTable(oldT, newT);
    // 양쪽 다 같은 label이라 eq로 매칭됨 — 변경 감지 없음.
    expect(rowOps.every((op) => op.type === 'eq')).toBe(true);
  });
});
