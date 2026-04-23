/**
 * App shell.
 *
 * Current state: placeholder between M2 (backend Claude proxy done) and M5R
 * (SVG viewer). The real layout — Sidebar + SvgViewer + HistoryPanel +
 * ChatPanel + FloatingDock + StatusBar — lands in M5R~M7R per Design v0.3.
 */

export default function App() {
  return (
    <main className="min-h-screen bg-bg text-text flex items-center justify-center p-8">
      <div className="max-w-xl w-full space-y-4">
        <h1 className="text-2xl font-semibold text-text-strong">HWPX Viewer</h1>
        <p className="text-sm text-text-muted">
          v1.0 MVP — M3R pending: rhwp SVG rendering + Run-level editing.
        </p>
        <ul className="text-xs text-text-subtle space-y-1">
          <li>Plan: <code>docs/01-plan/features/hwpx-viewer-mvp.plan.md</code></li>
          <li>Design v0.3: <code>docs/02-design/features/hwpx-viewer-mvp.design.md</code></li>
          <li>Do v0.2: <code>docs/02-design/features/hwpx-viewer-mvp.do.md</code></li>
        </ul>
      </div>
    </main>
  );
}
