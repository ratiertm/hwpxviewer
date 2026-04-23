/**
 * Row/column level diff for TableBlock values.
 *
 * Ported verbatim from hwpx-viewer-v8.jsx (prototype). Do NOT change semantics
 * without updating TEST_SPEC.md §1.5.
 *
 * Known limitations (intentional, documented in ARCHITECTURE.md §7.3):
 * - First column is treated as a unique row key.
 * - Duplicate first-column values break row matching.
 * - Row reorder (same content, different order) is NOT detected.
 */

import type { HeaderOp, RowOp, TableBlock, TableDiff } from '@/types';

export function diffTable(oldTable: TableBlock, newTable: TableBlock): TableDiff {
  const oldHeaders = oldTable.headers ?? [];
  const newHeaders = newTable.headers ?? [];
  const oldRows = oldTable.rows ?? [];
  const newRows = newTable.rows ?? [];

  // ---- Header column diff: match by content. ----
  const headerOps: HeaderOp[] = [];
  const oldHIndices = new Map<string, number>(oldHeaders.map((h, i) => [h, i]));
  const matchedOldH = new Set<number>();

  for (let j = 0; j < newHeaders.length; j++) {
    const h = newHeaders[j]!;
    const oldIdx = oldHIndices.get(h);
    if (oldIdx !== undefined && !matchedOldH.has(oldIdx)) {
      headerOps.push({ type: 'eq', header: h, oldIdx, newIdx: j });
      matchedOldH.add(oldIdx);
    } else {
      headerOps.push({ type: 'add', header: h, newIdx: j });
    }
  }
  for (let i = 0; i < oldHeaders.length; i++) {
    if (!matchedOldH.has(i)) {
      headerOps.push({ type: 'del', header: oldHeaders[i]!, oldIdx: i });
    }
  }

  // ---- Row diff: match by first column (assumed unique). ----
  const rowOps: RowOp[] = [];
  const oldRowIndices = new Map<string, number>(
    oldRows.map((r, i) => [r[0] ?? '', i]),
  );
  const matchedOldR = new Set<number>();
  let opId = 0;

  for (let j = 0; j < newRows.length; j++) {
    const newRow = newRows[j]!;
    const key = newRow[0] ?? '';
    const oldIdx = oldRowIndices.get(key);
    if (oldIdx !== undefined && !matchedOldR.has(oldIdx)) {
      const oldRow = oldRows[oldIdx]!;
      const same = JSON.stringify(oldRow) === JSON.stringify(newRow);
      rowOps.push({
        id: opId++,
        type: same ? 'eq' : 'change',
        oldRow,
        newRow,
        oldIdx,
        newIdx: j,
      });
      matchedOldR.add(oldIdx);
    } else {
      rowOps.push({ id: opId++, type: 'add', newRow, newIdx: j });
    }
  }
  for (let i = 0; i < oldRows.length; i++) {
    if (!matchedOldR.has(i)) {
      rowOps.push({ id: opId++, type: 'del', oldRow: oldRows[i]!, oldIdx: i });
    }
  }

  return { headerOps, rowOps };
}

/**
 * Reshape a row to fit a new header order, filling missing columns with ''.
 */
export function reshapeCells(
  row: readonly string[],
  sourceHeaders: readonly string[],
  finalHeaders: readonly string[],
): string[] {
  return finalHeaders.map((h) => {
    const idx = sourceHeaders.indexOf(h);
    return idx >= 0 ? (row[idx] ?? '') : '';
  });
}

/**
 * Rebuild a final TableBlock from the diff given which rows/header cols are accepted.
 * Kept for future cell-level cherry-pick (Design §2.2 says P1 feature, visualization-only in v1.0).
 */
export function reconstructTable(
  oldTable: TableBlock,
  newTable: TableBlock,
  headerOps: readonly HeaderOp[],
  rowOps: readonly RowOp[],
  acceptedRowIds: ReadonlySet<number>,
  acceptedHeaderCols: ReadonlySet<string>,
): TableBlock {
  const finalHeaders: string[] = [];
  for (const op of headerOps) {
    if (op.type === 'eq') finalHeaders.push(op.header);
    else if (op.type === 'add' && acceptedHeaderCols.has(op.header)) finalHeaders.push(op.header);
  }
  for (const op of headerOps) {
    if (op.type === 'del' && !acceptedHeaderCols.has(op.header)) finalHeaders.push(op.header);
  }

  const finalRows: string[][] = [];
  for (const op of rowOps) {
    if (op.type === 'eq') {
      finalRows.push(reshapeCells(op.newRow, newTable.headers, finalHeaders));
    } else if (op.type === 'add') {
      if (acceptedRowIds.has(op.id)) {
        finalRows.push(reshapeCells(op.newRow, newTable.headers, finalHeaders));
      }
    } else if (op.type === 'del') {
      if (!acceptedRowIds.has(op.id)) {
        finalRows.push(reshapeCells(op.oldRow, oldTable.headers, finalHeaders));
      }
    } else {
      const accepted = acceptedRowIds.has(op.id);
      const useRow = accepted ? op.newRow : op.oldRow;
      const sourceHeaders = accepted ? newTable.headers : oldTable.headers;
      finalRows.push(reshapeCells(useRow, sourceHeaders, finalHeaders));
    }
  }

  return { type: 'table', headers: finalHeaders, rows: finalRows };
}
