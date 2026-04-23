import { Canvas } from '@/components/canvas/Canvas';
import { INITIAL_PAGES } from '@/data/initial-pages';

export default function App() {
  return (
    <main className="min-h-screen bg-bg text-text flex flex-col">
      <header className="border-b border-border-subtle bg-bg-subtle px-6 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold text-text-strong">HWPX Viewer</h1>
          <p className="text-[11px] text-text-subtle">
            v1.0 MVP — M4 Canvas seed (demo pages)
          </p>
        </div>
        <span className="text-[11px] text-text-subtle">
          {INITIAL_PAGES.length}개 페이지
        </span>
      </header>
      <Canvas pages={INITIAL_PAGES} />
    </main>
  );
}
