/**
 * PageSettingsPanel — page-level metadata editor (Phase 2.5 D).
 *
 * Modal with width/height/margins/landscape inputs. On apply, posts to
 * /api/pages/{uploadId}/{pageIdx}/page-def. Page-def is per-section in
 * HWPX so the change propagates across all pages in that section.
 *
 * HwpUnit refresher: A4 portrait = 59528 × 84188 HU. 1 HU ≈ 0.0166 mm.
 * To keep the UI approachable we display values in millimeters but POST
 * them back in HwpUnit (×60.038 conversion).
 */

import { useEffect, useState } from 'react';
import { Settings, X } from 'lucide-react';

import { type PageDef, updatePageDef } from '@/api/document';

const HU_PER_MM = 60.038;

const huToMm = (hu: number): number => Math.round((hu / HU_PER_MM) * 10) / 10;
const mmToHu = (mm: number): number => Math.round(mm * HU_PER_MM);

interface Props {
  uploadId: string;
  pageIndex: number;
  initial: PageDef;
  onClose: () => void;
  onApplied: (result: { pageCount: number; version: number }) => void;
}

export function PageSettingsPanel({
  uploadId,
  pageIndex,
  initial,
  onClose,
  onApplied,
}: Props) {
  const [width, setWidth] = useState(huToMm(initial.width));
  const [height, setHeight] = useState(huToMm(initial.height));
  const [mL, setML] = useState(huToMm(initial.marginLeft));
  const [mR, setMR] = useState(huToMm(initial.marginRight));
  const [mT, setMT] = useState(huToMm(initial.marginTop));
  const [mB, setMB] = useState(huToMm(initial.marginBottom));
  const [landscape, setLandscape] = useState(initial.landscape);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await updatePageDef(uploadId, pageIndex, {
        width: mmToHu(width),
        height: mmToHu(height),
        marginLeft: mmToHu(mL),
        marginRight: mmToHu(mR),
        marginTop: mmToHu(mT),
        marginBottom: mmToHu(mB),
        landscape,
      });
      onApplied({ pageCount: result.pageCount, version: result.version });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const numInput = (val: number, set: (n: number) => void, label: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
        {label}
      </span>
      <input
        type="number"
        step="0.1"
        value={val}
        disabled={busy}
        onChange={(e) => set(Number(e.target.value))}
        className="rounded border px-2 py-1 text-xs tabular-nums focus:outline-none focus:ring-2"
        style={{
          backgroundColor: 'var(--bg)',
          borderColor: 'var(--border)',
          color: 'var(--text)',
        }}
      />
    </label>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="w-[min(480px,92vw)] rounded-xl border shadow-2xl"
        style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border)' }}
      >
        <div
          className="px-5 py-3 border-b flex items-center justify-between"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <Settings size={14} style={{ color: 'var(--accent)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>
              페이지 {pageIndex + 1} 설정
            </span>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="닫기"
            className="w-7 h-7 rounded hover:bg-bg-muted flex items-center justify-center disabled:opacity-30 appearance-none"
            style={{ color: 'var(--text-muted)' }}
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={landscape}
              disabled={busy}
              onChange={(e) => setLandscape(e.target.checked)}
            />
            <span className="text-sm" style={{ color: 'var(--text)' }}>
              가로 방향 (Landscape)
            </span>
          </label>

          <div>
            <div
              className="text-[11px] uppercase tracking-wider mb-2"
              style={{ color: 'var(--text-faint)' }}
            >
              크기 (mm)
            </div>
            <div className="grid grid-cols-2 gap-2">
              {numInput(width, setWidth, '너비')}
              {numInput(height, setHeight, '높이')}
            </div>
          </div>

          <div>
            <div
              className="text-[11px] uppercase tracking-wider mb-2"
              style={{ color: 'var(--text-faint)' }}
            >
              여백 (mm)
            </div>
            <div className="grid grid-cols-2 gap-2">
              {numInput(mL, setML, '좌')}
              {numInput(mR, setMR, '우')}
              {numInput(mT, setMT, '상')}
              {numInput(mB, setMB, '하')}
            </div>
          </div>

          {error && (
            <div
              className="rounded border px-3 py-2 text-xs"
              style={{
                borderColor: '#fda4af',
                backgroundColor: 'rgba(244,63,94,0.1)',
                color: '#fda4af',
              }}
            >
              {error}
            </div>
          )}

          <div
            className="text-[10px]"
            style={{ color: 'var(--text-faint)' }}
          >
            ⓘ HWPX 는 페이지 설정을 섹션 단위로 저장합니다. 같은 섹션 안 모든 페이지에 동시 적용됩니다.
          </div>
        </div>

        <div
          className="px-5 py-3 border-t flex items-center justify-end gap-2"
          style={{ borderColor: 'var(--border)' }}
        >
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 rounded border text-sm appearance-none disabled:opacity-50"
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
          >
            취소
          </button>
          <button
            onClick={() => void apply()}
            disabled={busy}
            className="px-3 py-1.5 rounded text-sm font-medium appearance-none disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)', color: 'white' }}
          >
            {busy ? '적용 중…' : '적용'}
          </button>
        </div>
      </div>
    </div>
  );
}
