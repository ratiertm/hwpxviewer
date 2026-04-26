/**
 * GenerateModal — "+ AI 새 문서" entrypoint.
 *
 * Collects intent + theme + free-text prompt, kicks off
 * /api/generate/start, and replays SSE step events as a progress timeline.
 * On `done`, returns the new uploadId so App.tsx can load it through the
 * existing fetchPageSvg path (zero divergence from drag-drop upload).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, X } from 'lucide-react';

import {
  type GenerateStepEvent,
  openGenerateStream,
  startGenerateJob,
} from '@/api/generate';
import type { HwpxTheme, Intent } from '@/types';

const THEMES: { id: HwpxTheme; label: string; primary: string; use: string }[] = [
  { id: 'default', label: 'Default', primary: '#395da2', use: '일반 공문서' },
  { id: 'forest', label: 'Forest', primary: '#2C5F2D', use: '환경 · ESG' },
  { id: 'warm_executive', label: 'Warm Executive', primary: '#B85042', use: '제안서' },
  { id: 'ocean_analytics', label: 'Ocean Analytics', primary: '#065A82', use: '데이터 보고' },
  { id: 'coral_energy', label: 'Coral Energy', primary: '#F96167', use: '마케팅' },
  { id: 'charcoal_minimal', label: 'Charcoal', primary: '#36454F', use: '기술 문서' },
  { id: 'teal_trust', label: 'Teal Trust', primary: '#028090', use: '의료 · 금융' },
  { id: 'berry_cream', label: 'Berry Cream', primary: '#6D2E46', use: '교육' },
  { id: 'sage_calm', label: 'Sage Calm', primary: '#84B59F', use: '웰빙' },
  { id: 'cherry_bold', label: 'Cherry Bold', primary: '#990011', use: '경고' },
];

const INTENTS: { id: Intent; label: string; hint: string }[] = [
  { id: 'new_doc', label: '일반 문서', hint: '보고서·안내문·계획서 등' },
  { id: 'gongmun', label: '공문(기안문)', hint: '행정안전부 편람 자동 준수' },
];

interface Props {
  onClose: () => void;
  onDone: (uploadId: string, fileName: string, pageCount: number) => void;
}

interface TimelineItem {
  step: GenerateStepEvent['step'];
  label: string;
  detail?: string;
  ts: number;
}

const STEP_LABELS: Record<GenerateStepEvent['step'], string> = {
  plan: 'Claude 가 문서 구조를 짜는 중',
  plan_ready: '플랜 완성',
  build: 'HwpxBuilder 실행',
  validate: '문서 검증',
  register: '뷰어에 로드',
  done: '완료',
  error: '오류',
};

export function GenerateModal({ onClose, onDone }: Props) {
  const [intent, setIntent] = useState<Intent>('new_doc');
  const [theme, setTheme] = useState<HwpxTheme>('default');
  const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const closerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    promptRef.current?.focus();
    return () => {
      closerRef.current?.();
    };
  }, []);

  const canRun = prompt.trim().length >= 4 && !running;
  const filledPrompt = useMemo(() => prompt.trim(), [prompt]);

  const start = async () => {
    if (!canRun) return;
    setRunning(true);
    setErrorMsg(null);
    setTimeline([]);
    try {
      const jobId = await startGenerateJob({ intent, theme, prompt: filledPrompt });
      const dispose = openGenerateStream(jobId, (evt) => {
        setTimeline((prev) => {
          const detail =
            evt.step === 'plan_ready'
              ? `${evt.title || ''} · ${evt.blockCount ?? 0} blocks · theme=${evt.theme ?? '?'}`
              : evt.step === 'done'
                ? `${evt.fileName ?? ''} · ${evt.pageCount ?? 0}p`
                : evt.message;
          return [
            ...prev,
            { step: evt.step, label: STEP_LABELS[evt.step] ?? evt.step, detail, ts: Date.now() },
          ];
        });
        if (evt.step === 'done' && evt.uploadId) {
          onDone(evt.uploadId, evt.fileName ?? 'AI 생성 문서.hwpx', evt.pageCount ?? 1);
        } else if (evt.step === 'error') {
          setErrorMsg(evt.message ?? '문서 생성 실패');
          setRunning(false);
        }
      });
      closerRef.current = dispose;
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setRunning(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !running) onClose();
      }}
    >
      <div
        className="w-[min(640px,92vw)] max-h-[90vh] overflow-y-auto rounded-xl border shadow-2xl"
        style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border)' }}
      >
        <div
          className="px-5 py-3 border-b flex items-center justify-between"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <Sparkles size={14} style={{ color: 'var(--accent)' }} />
            <span
              className="text-sm font-semibold"
              style={{ color: 'var(--text-strong)' }}
            >
              AI 새 한글 문서 생성
            </span>
          </div>
          <button
            onClick={onClose}
            disabled={running}
            aria-label="닫기"
            className="w-7 h-7 rounded hover:bg-bg-muted flex items-center justify-center disabled:opacity-30 appearance-none"
            style={{ color: 'var(--text-muted)' }}
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* intent */}
          <div>
            <div
              className="text-[11px] uppercase tracking-wider mb-1.5"
              style={{ color: 'var(--text-faint)' }}
            >
              종류
            </div>
            <div className="grid grid-cols-2 gap-2">
              {INTENTS.map((it) => {
                const active = intent === it.id;
                return (
                  <button
                    key={it.id}
                    onClick={() => setIntent(it.id)}
                    disabled={running}
                    className="text-left px-3 py-2 rounded border appearance-none disabled:opacity-50"
                    style={{
                      backgroundColor: active ? 'var(--bg-muted)' : 'transparent',
                      borderColor: active ? 'var(--accent)' : 'var(--border)',
                      color: 'var(--text)',
                    }}
                  >
                    <div className="text-sm" style={{ color: 'var(--text-strong)' }}>
                      {it.label}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {it.hint}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* theme */}
          <div>
            <div
              className="text-[11px] uppercase tracking-wider mb-1.5"
              style={{ color: 'var(--text-faint)' }}
            >
              테마
            </div>
            <div className="grid grid-cols-5 gap-2">
              {THEMES.map((t) => {
                const active = theme === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    disabled={running}
                    title={t.use}
                    className="text-left px-2 py-1.5 rounded border appearance-none disabled:opacity-50"
                    style={{
                      borderColor: active ? 'var(--accent)' : 'var(--border)',
                      backgroundColor: active ? 'var(--bg-muted)' : 'transparent',
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: t.primary }}
                      />
                      <span
                        className="text-[11px] truncate"
                        style={{ color: 'var(--text)' }}
                      >
                        {t.label}
                      </span>
                    </div>
                    <div
                      className="text-[10px] truncate mt-0.5"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {t.use}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* prompt */}
          <div>
            <div
              className="text-[11px] uppercase tracking-wider mb-1.5"
              style={{ color: 'var(--text-faint)' }}
            >
              요청 내용
            </div>
            <textarea
              ref={promptRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={running}
              rows={5}
              placeholder={
                intent === 'gongmun'
                  ? '예: 정보공개 종합평가 안내 공문. 발신: 행정안전부 정보공개과. 수신: 각 부처. 시행일 2026-04-30.'
                  : '예: 환경경영 보고서. 2025년 대비 전력 사용량 12% 감축, 재생에너지 비중 24%. 표 1개 + 결론.'
              }
              className="w-full rounded border px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2"
              style={{
                backgroundColor: 'var(--bg)',
                borderColor: 'var(--border)',
                color: 'var(--text)',
              }}
            />
            <div
              className="text-[10px] mt-1"
              style={{ color: 'var(--text-faint)' }}
            >
              구조·헤딩·표·결론은 Claude 가 자동으로 짭니다. 핵심 사실만 넣어 주세요.
            </div>
          </div>

          {/* timeline */}
          {timeline.length > 0 && (
            <div
              className="rounded border px-3 py-2 space-y-1"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-muted)' }}
            >
              {timeline.map((t, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span
                    className="mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor:
                        t.step === 'error' ? '#fda4af' : t.step === 'done' ? '#34d399' : 'var(--accent)',
                    }}
                  />
                  <div>
                    <div style={{ color: 'var(--text-strong)' }}>{t.label}</div>
                    {t.detail && (
                      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {t.detail}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {errorMsg && (
            <div
              className="rounded border px-3 py-2 text-xs"
              style={{
                borderColor: '#fda4af',
                backgroundColor: 'rgba(244,63,94,0.1)',
                color: '#fda4af',
              }}
            >
              {errorMsg}
            </div>
          )}
        </div>

        <div
          className="px-5 py-3 border-t flex items-center justify-end gap-2"
          style={{ borderColor: 'var(--border)' }}
        >
          <button
            onClick={onClose}
            disabled={running}
            className="px-3 py-1.5 rounded border text-sm appearance-none disabled:opacity-50"
            style={{
              borderColor: 'var(--border)',
              color: 'var(--text-muted)',
            }}
          >
            취소
          </button>
          <button
            onClick={start}
            disabled={!canRun}
            className="px-3 py-1.5 rounded text-sm font-medium appearance-none disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)', color: 'white' }}
          >
            {running ? '생성 중…' : '생성'}
          </button>
        </div>
      </div>
    </div>
  );
}
