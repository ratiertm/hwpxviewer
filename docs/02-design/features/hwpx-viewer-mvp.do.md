---
template: do
version: 0.2
---

# hwpx-viewer-mvp Implementation Guide

> **Summary**: Design v0.3 구현 가이드. rhwp WASM SVG 렌더링 + Run 좌표 편집 중심 아키텍처로 전면 재설계 후의 체크리스트.
>
> **Project**: HWPX Viewer (`hwpx-viewer`)
> **Version**: 0.8 → 1.0.0 (MVP)
> **Status**: In Progress (M1, M2 완료 / M3 폐기 / M3R 착수 대기)
> **Date**: 2026-04-24
> **Plan Doc**: [hwpx-viewer-mvp.plan.md](../../01-plan/features/hwpx-viewer-mvp.plan.md)
> **Design Doc**: [hwpx-viewer-mvp.design.md](./hwpx-viewer-mvp.design.md) (v0.3)
> **Previous**: [hwpx-viewer-mvp.do.v0.1.archive.md](./hwpx-viewer-mvp.do.v0.1.archive.md)

---

## 0. 시작 전 체크리스트 (Gate)

### 0.1 v0.3 Open Questions 상태 (Design §14 단일 소스)

**확정 8건** (v0.3까지): pnpm workspace / Origin allowlist + slowapi / `claude -p` OAuth / in-memory LRU / `window.print()` / passthrough 실패 인라인 배너 / **rhwp WASM via wasmtime (backend)** / **Run 좌표 편집 단위** / **드래그 + 블록 클릭 병행 선택**.

**남은 결정 4건** (M8~ 진행 중 결정):
1. 편집 세션 동시성: single-user + per-uploadId `asyncio.Lock` (v2.0 Yjs 전환 예약)
2. SVG 캐시 정책 (M8)
3. 컨테이너 OAuth 전달: bind mount vs secret (M8 #30)
4. rhwp WASM 버전 pin vs floating (M8 #34)

### 0.2 Pre-Implementation Checklist

- [x] Plan 문서: `docs/01-plan/features/hwpx-viewer-mvp.plan.md`
- [x] Design v0.3: `docs/02-design/features/hwpx-viewer-mvp.design.md`
- [x] v0.2 / v0.1 archive 보존
- [ ] Convention 문서: `docs/01-plan/conventions.md` (M1R 병행 권장, 미작성)
- [x] 호스트 `claude` CLI + OAuth 세션 (M2 완료)
- [x] pyhwpxlib[preview] 에 rhwp WASM 포함 확인 (2026-04-24 실테스트 완료)
- [ ] 회귀용 HWPX 샘플 10종 수집 (M9 전까지)
- [ ] Korean font 설치 환경 (macOS 기본 OK, Docker는 M8 #30)

---

## 1. Repository Bootstrap (M1 완료)

M1 범위는 변경 없음. 프로젝트 구조·스캐폴딩은 v0.1에서 완료.

현재 디렉터리 상태 (v0.3 기준):
```
hwpx-viewer/
├── apps/
│   ├── web/           (M1 완료)
│   └── backend/       (M2 완료, M3 converter 폐기)
├── docs/              (v0.3 업데이트)
├── reference/         (gitignore, 외부 참조)
├── hwpx-viewer-v8.jsx (프로토타입, M7R까지 reference)
├── pnpm-workspace.yaml
├── Makefile
└── .gitignore
```

---

## 2. Implementation Order (Design §13)

### M1 Foundation ✅ 완료
| # | 작업 | 상태 |
|:-:|---|:-:|
| 1 | Vite+TS 스캐폴딩, Tailwind, `@/` alias | ✅ |
| 2 | 타입 정의 — **v0.3에서 RunLocation 기반으로 교체됨** | ✅ (v0.3 교체) |
| 3 | `lib/diff/*`, `lib/json.ts` + UT-01~54 | ✅ |
| 4 | 테마 토큰 → CSS 변수 (min set in index.css, full set M7R로 이관) | ✅ min |
| 5 | Vitest + Playwright 기본 설정 | ✅ |

### M2 Backend bootstrap ✅ 완료
| # | 작업 | 상태 |
|:-:|---|:-:|
| 6 | FastAPI 스캐폴딩, config, CORS, structlog | ✅ |
| 7 | `/healthz`, `/readyz` | ✅ |
| 8 | `/api/claude/stream` + `/once` + `prompts.py` | ✅ |
| 9 | 프론트 `src/api/claude.ts` 연결 | ✅ |

### ~~M3 overlay converter~~ 🗑️ 폐기 (v0.3)
- `converter/overlay_to_blocks.py`, `blocks_to_overlay.py`, `style.py` 삭제
- `routes/import_.py`, `export.py` 삭제
- `tests/test_converter.py`, `test_import_export.py`, `test_upload_validate.py` 삭제
- 대체: M3R~M6R

### M3R rhwp WASM 통합 (1주) 🆕
| # | 작업 | 파일/위치 | 완료 기준 | 상태 |
|:-:|---|---|---|:-:|
| 10 | `pyhwpxlib[preview]` 의존 추가 | `apps/backend/pyproject.toml` | `uv sync` 성공 | ☐ |
| 11 | `services/rhwp_wasm.py` — wasmtime 래퍼 | backend/services | `load_document`, `render_page_svg`, `hit_test`, `insert_text`, `delete_text`, `get_text_range`, `get_selection_rects`, `save_bytes` 모두 동작 | ☐ |
| 12 | `routes/render.py` — `GET /api/render/{id}/{page}` | backend/routes | 브라우저에서 SVG 표시 확인 | ☐ |
| 13 | `tests/test_rhwp_wasm.py` — UT-B01~06 | backend/tests | 9페이지 샘플 smoke | ☐ |

**완료 기준**: 로컬 dev 서버에서 `/api/render/{sample}/0` 호출 시 한컴 수준 SVG 반환 확인.

### M4R File I/O (1주) 🆕
| # | 작업 | 파일/위치 | 완료 기준 | 상태 |
|:-:|---|---|---|:-:|
| 14 | `routes/upload.py`, `routes/download.py` | backend/routes | POST /upload → DocumentInfo, GET /download → 바이트 | ☐ |
| 15 | `security/upload_validate.py` 신규 | backend/security | 확장자·MIME·magic bytes·크기 | ☐ |
| 16 | `services/upload_store.py` — RhwpDocument 세션 저장 | backend/services | TTL 30분 | ☐ |
| 17 | 프론트 `api/hwpx.ts` — upload/download 클라이언트 | apps/web/src/api | 에러 매핑 | ☐ |
| 18 | 프론트 `components/io/FileUploader.tsx` + `hooks/useDropzone.ts` | apps/web | 드래그 시 테두리, drop 시 onFile | ☐ |
| 19 | `components/layout/DownloadMenu.tsx` | apps/web | HWPX 다운로드 | ☐ |

### M5R SvgViewer + Selection (1주) 🆕
| # | 작업 | 파일 | 완료 기준 | 상태 |
|:-:|---|---|---|:-:|
| 20 | `components/viewer/SvgViewer.tsx` | apps/web | `dangerouslySetInnerHTML={svg}`, 페이지 배열 렌더 | ☐ |
| 21 | `components/viewer/SelectionOverlay.tsx` | apps/web | SelectionRect 박스들 렌더 | ☐ |
| 22 | `hooks/useSelection.ts` — 드래그 → hit-test 2회 → Selection | apps/web | mouseup 시 Selection 확정 | ☐ |
| 23 | `routes/hit_test.py` — 3 엔드포인트 (hit-test, selection-rects, text-range) | backend | JSON 응답 | ☐ |
| 24 | zoom + 페이지 네비 (FloatingDock 일부) | apps/web | SvgViewer의 transform:scale() | ☐ |

### M6R Edit API + Cherry-pick (1주) 🆕
| # | 작업 | 파일 | 완료 기준 | 상태 |
|:-:|---|---|---|:-:|
| 25 | `routes/edit.py` — POST /api/edit | backend | rhwp delete + insert, affectedPages 반환 | ☐ |
| 26 | `hooks/useEditor.ts` — `apply(selection, newText)` | apps/web | history 기록 + SVG refresh | ☐ |
| 27 | 프로토타입 `InlineSelectionMenu`, `InlineLoadingBlock`, `InlineErrorBlock`, `InlineCherryPickDiff` 이식 | apps/web/src/components/inline | Run 좌표 기반 재작성 | ☐ |
| 28 | 수기 편집 테스트 (AI 없이 "수정" 버튼) | — | 한 run의 텍스트 치환 → SVG 갱신 | ☐ |

### M7R Chat/History/Sidebar 이식 (1주) 🆕
| # | 작업 | 파일 | 완료 기준 | 상태 |
|:-:|---|---|---|:-:|
| 29 | Zustand store 6 슬라이스 | `state/store.ts` | immer 적용, selector 타입 안전 | ☐ |
| 30 | 프로토타입 ChatPanel/ChatMessage/StreamingMessage 이식 | `components/chat/*` | E2E-01 (채팅→편집→되돌리기) 녹색 | ☐ |
| 31 | 프로토타입 HistoryPanel 이식 + undone 토글 | `components/history/*` | CT-21~24 녹색 | ☐ |
| 32 | 프로토타입 Sidebar + MiniPreview 이식 (SVG snapshot 기반) | `components/layout/*` | 페이지 썸네일 표시 | ☐ |
| 33 | FloatingDock 완성 | `components/layout/FloatingDock.tsx` | 페이지·줌·AI 버튼 | ☐ |
| 34 | StatusBar + TopHeader + UserMenu | `components/layout/*` | 프로토타입 시각 동일 | ☐ |
| 35 | 테마 토큰 full set (M1 min → full) | `theme/tokens.ts` + `index.css` | DESIGN_SPEC §2 일치 | ☐ |

**완료 기준**: E2E-01~05 (채팅·인라인·멀티페이지·멀티턴·스트리밍) 모두 녹색.

### M8 Hardening (1~2주)
| # | 작업 | 완료 | 상태 |
|:-:|---|---|:-:|
| 36 | security-architect 리뷰 + slowapi rate limiter 실 부착 | `/api/claude/*`, `/api/edit` 429 | ☐ |
| 37 | 접근성 (axe-core + 키보드 내비) | E2E-20~22 | ☐ |
| 38 | 번들 사이즈 ≤ 350KB gz | Vite bundle analyzer | ☐ |
| 39 | Dockerfile.web + Dockerfile.backend (Korean fonts + Node 20 + claude CLI) | `docker compose up -d` 후 `/healthz` 200 | ☐ |
| 40 | 정본 델타 PR (DESIGN_SPEC §8.1 / INTERACTION_SPEC / COMPONENT_INVENTORY) | merged | ☐ |
| 41 | CLAUDE.md §2 Artifacts 제약 재분류 | 메인 운영 매뉴얼 갱신 | ☐ |
| 42 | `conventions.md` 초안 | `docs/01-plan/` | ☐ |
| 43 | `claude --version` 가드 + rhwp WASM 버전 pin 체크 | `/readyz` | ☐ |

### M9 Regression (0.5주)
| # | 작업 | 완료 | 상태 |
|:-:|---|---|:-:|
| 44 | 공공 양식 10종 수집 + round-trip 자동화 | `tests/roundtrip/` 녹색 | ☐ |
| 45 | E2E-01~22, 30~32 모두 녹색 | Playwright CI | ☐ |
| 46 | PERF-01~04 측정 | 회귀 없음 | ☐ |

### M10 PDCA Analyze (0.5주)
| # | 작업 | 완료 | 상태 |
|:-:|---|---|:-:|
| 47 | `/pdca analyze hwpx-viewer-mvp` | Match Rate ≥ 90% | ☐ |

---

## 3. Key Files Cheat Sheet

### 3.1 신규 생성 (M3R~M7R)

| File | 책임 | Milestone | 참조 |
|---|---|:-:|---|
| `apps/backend/.../services/rhwp_wasm.py` | wasmtime 래퍼 | M3R | Design §5 |
| `apps/backend/.../routes/render.py` | SVG 렌더 엔드포인트 | M3R | §4.2 |
| `apps/backend/.../routes/upload.py` | 파일 업로드 | M4R | §4.2 |
| `apps/backend/.../routes/download.py` | 파일 다운로드 | M4R | §4.2 |
| `apps/backend/.../routes/hit_test.py` | hit-test/selection-rects/text-range | M5R | §4.2 |
| `apps/backend/.../routes/edit.py` | 편집 적용 | M6R | §4.2 |
| `apps/backend/.../security/upload_validate.py` | 업로드 검증 | M4R | §7 |
| `apps/web/src/components/viewer/SvgViewer.tsx` | SVG 페이지 렌더 | M5R | DESIGN_SPEC §8.1 (신규) |
| `apps/web/src/components/viewer/SelectionOverlay.tsx` | 선택 박스 표시 | M5R | DESIGN_SPEC §8.1 |
| `apps/web/src/components/io/FileUploader.tsx` | 드롭존 | M4R | DESIGN_SPEC §8.1 |
| `apps/web/src/components/io/UploadBanner.tsx` | 업로드 진행 | M4R | DESIGN_SPEC §8.1 |
| `apps/web/src/components/layout/DownloadMenu.tsx` | 다운로드 메뉴 | M4R | DESIGN_SPEC §8.1 |
| `apps/web/src/components/inline/Inline*.tsx` | 프로토타입 이식 | M6R | COMPONENT_INVENTORY §4.5 |
| `apps/web/src/components/chat/*` | ChatPanel 이식 | M7R | 프로토타입 ~859 |
| `apps/web/src/components/history/HistoryPanel.tsx` | 이력 패널 이식 | M7R | 프로토타입 ~980 |
| `apps/web/src/components/layout/*` | 헤더·사이드바·도크·상태바 | M7R | 프로토타입 ~748 |
| `apps/web/src/hooks/useDropzone.ts` | 드래그·드롭 | M4R | — |
| `apps/web/src/hooks/useSelection.ts` | 선택 좌표 추출 | M5R | §2.2-B |
| `apps/web/src/hooks/useEditor.ts` | 편집 적용·history | M6R | §2.2-C |
| `apps/web/src/hooks/useStreamChat.ts` | 스트리밍 채팅 (프로토타입 이식) | M7R | 프로토타입 ~575 |
| `apps/web/src/state/store.ts` | Zustand 6 슬라이스 | M7R | Design §3.2 |
| `apps/web/src/api/hwpx.ts` | upload/download/edit 클라이언트 | M4R~M6R | §4 |
| `apps/web/src/theme/tokens.ts` | 테마 토큰 full set | M7R | DESIGN_SPEC §2 |
| `Dockerfile.web` + `Dockerfile.backend` + `docker-compose.yml` | 배포 번들 | M8 | §12.2 |

### 3.2 유지 (M1, M2 완료분)

- `apps/web/src/lib/diff/text.ts`, `table.ts`, `lib/json.ts` (UT-01~54 녹색)
- `apps/web/src/api/claude.ts` (M2)
- `apps/web/src/index.css`, `tailwind.config.ts` (min 세트)
- `apps/backend/.../main.py`, `config.py`, `prompts.py`, `errors.py`
- `apps/backend/.../routes/claude.py`, `health.py`
- `apps/backend/.../services/claude_cli.py`, `upload_store.py`
- `apps/backend/.../security/cors.py`

### 3.3 수정·교체 대상

| File | 변경 | 시점 |
|---|---|:-:|
| `apps/web/src/types/index.ts` | Block → RunLocation 모델 (완료) | v0.3 |
| `apps/web/src/App.tsx` | placeholder (현재) → Layout (M7R) | M7R |
| `apps/backend/.../schemas.py` | Block 제거, Run 모델 추가 (완료) | v0.3 |
| `apps/backend/.../main.py` | import/export 라우터 제거 (완료), 신규 라우터 include | M3R~M6R |
| `docs/ARCHITECTURE.md`, `COMPONENT_INVENTORY.md`, `DESIGN_SPEC.md`, `INTERACTION_SPEC.md`, `TEST_SPEC.md` | v0.3 반영 델타 PR | M8 #40 |
| `CLAUDE.md` | Artifacts 제약 재분류 + Run 좌표 편집 언급 | M8 #41 |
| `hwpx-viewer-v8.jsx` | M7R 이관 체크리스트 충족 시 `legacy/` 이동, M10 이후 삭제 | M7R~M10 |

---

## 4. Dependencies

### 4.1 Backend 신규 (v0.3)
- `pyhwpxlib[preview]` — rhwp WASM (wasmtime + 번들 바이너리)
- `wasmtime` — Python WASM 런타임 (pyhwpxlib[preview] transitive)
- (선택) `Pillow` — 한글 폰트 측정 정확도 향상 (`pyhwpxlib[preview-fonts]`)

### 4.2 Backend 유지
- `fastapi`, `uvicorn[standard]`, `pydantic-settings`, `python-multipart`, `structlog`, `slowapi`
- dev: `pytest`, `pytest-asyncio`, `pytest-httpx`, `ruff`, `mypy`
- 런타임 제거 검토: `httpx` (M2 이후 미사용, pyproject 정리)

### 4.3 Frontend (변경 없음)
- prod: `react`, `react-dom`, `zustand`, `immer`, `lucide-react`
- build: `vite`, `typescript`, `tailwindcss`
- test: `vitest`, `@testing-library/react`, `msw`, `@playwright/test`

### 4.4 호스트 전제
- `claude` CLI ≥ 2.1 + OAuth 세션 (M2)
- **Korean fonts 필수** (Noto Sans/Serif KR, Malgun Gothic / Apple SD Gothic Neo)
- `wasmtime` 런타임 (pip로 자동 설치)

---

## 5. Implementation Notes

### 5.1 v0.3 핵심 변경

| Decision | Choice | Rationale |
|---|---|---|
| 문서 모델 | Run 좌표 `{sec, para, charOffset}` | 한컴 수준 시각 정확도 필요, rhwp 엔진 네이티브 단위 |
| 렌더링 | rhwp WASM → SVG (server-side) | 한컴 수준. `<text>` 기반이라 선택 가능. wasmtime으로 구동. |
| 선택 | 드래그 → hit-test 2회 → Selection | rhwp `hitTest`가 (x,y) → (sec, para, charOffset) 변환 |
| 편집 | rhwp `deleteText` + `insertText` | json_io.patch 불필요. 네이티브 API 직접 사용. |
| 이력 | text snapshot + Selection | undone 토글로 oldText 재삽입 |
| 상태 | Zustand 6 슬라이스 (document/selection/history/chat/inline/ui) | Block 폐기로 7 → 6 |

### 5.2 Code Patterns

**rhwp 서비스 호출 (backend route)**
```python
from ..services.rhwp_wasm import get_session

@router.post("/api/edit", response_model=EditResponse)
async def edit(req: EditRequest) -> EditResponse:
    session = get_session(req.uploadId)
    old_text = session.get_text_range(req.selection)
    session.delete_text(req.selection.start, req.selection.length)
    session.insert_text(req.selection.start, req.newText)
    session.version += 1
    edit_id = history.record(req.selection, old_text, req.newText)
    return EditResponse(
        editId=edit_id,
        document=session.info(),
        affectedPages=[req.selection.start.page_index],
    )
```

**선택 → AI → 편집 (frontend)**
```tsx
import { useSelection, useEditor, useStreamChat } from '@/hooks';

function InlineMenu() {
  const selection = useSelection();
  const editor = useEditor();
  const chat = useStreamChat();

  const onRewrite = async () => {
    const original = await api.getTextRange(selection);
    const suggestion = await api.claudeOnce('inline_editor', { original, action: 'rewrite' });
    // InlineCherryPickDiff 로 사용자 확정 후 editor.apply
    editor.apply(selection, finalText);
  };
}
```

### 5.3 Things to Avoid (v0.3 updated)

- [ ] `setPages` / Block[] 접근 (구 모델 폐기)
- [ ] 프론트에서 rhwp WASM 직접 호출 (backend 경유만 허용)
- [ ] history entry 삭제 (undone 토글만)
- [ ] 임의 색 해시 `bg-[#xxx]` (토큰 변수만)
- [ ] 클라이언트 `localStorage` 사용
- [ ] 외부 CDN 폰트/스크립트 (CSP 위반)
- [ ] silent catch — 모든 에러는 toast 또는 UI 반영
- [ ] rhwp 인스턴스 thread-safe 가정 (wasmtime 단일 스레드 경고)

### 5.4 Architecture Checklist (Dynamic - Custom Server)

- [ ] Layer — Domain / Application / Presentation / Infrastructure
- [ ] Dependency 방향 일방향 (Presentation → Application → Domain ← Infrastructure)
- [ ] ESLint `boundaries` 플러그인 강제

### 5.5 Security Checklist (v0.3 갱신)

- [x] 서버 API 키 없음 (M2)
- [x] 클라이언트 번들 `ANTHROPIC_API_KEY` grep 0건 (CI gate)
- [x] CORS allowlist (M2)
- [ ] 업로드 magic bytes 검증 (M4R)
- [ ] CSP 헤더 (M8 #39)
- [ ] rate limit (`slowapi`) `/api/claude/*`, `/api/edit` (M8 #36)
- [ ] WASM fuel 제한 (wasmtime metering, M8)
- [ ] 배포 호스트 `~/.claude/` 권한 0600 (M8 #39)
- [ ] 서버 로그 민감 정보 마스킹 (M2 structlog processor + M4R 파일 바이트)

### 5.6 API Checklist

- [ ] 에러 포맷 `{ error: { code, message, detail?, recoverable } }` (Design §6)
- [ ] SVG 응답 `Content-Type: image/svg+xml`
- [ ] HWPX 다운로드 `application/vnd.hancom.hwpx` + `Content-Disposition: attachment`
- [ ] SSE (Claude) `event`/`data` + `[DONE]` (M2 유지)

---

## 6. Testing Checklist

### 6.1 Manual (M5R~ 주기적)
- [ ] Happy: 업로드 → 렌더 → 드래그 선택 → AI 편집 → 적용 → 다운로드
- [ ] Error: 이상 파일 / 세션 만료 / 네트워크 단절
- [ ] Edge: 빈 문서 / 대형 문서 / 표 내부 편집

### 6.2 Code Quality (PR 단위)
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` 녹색
- [ ] `uv run pytest`, `uv run ruff check` 녹색
- [ ] 커버리지: pure func ≥ 95%, component ≥ 80%

---

## 7. Progress Tracking

### 7.1 Daily Log
| Date | Task | Notes |
|---|---|---|
| 2026-04-22 | Do v0.1 작성 | M1~M8 체크리스트 (Block 모델 기반) |
| 2026-04-23 | PageBreakBlock mini-cycle | M3 완료로 표시 (뒤에 v0.3로 폐기) |
| 2026-04-24 | v0.3 전면 재설계 | Block 폐기 → Run 좌표, rhwp WASM 채택 |

### 7.2 Blockers
| Issue | Impact | Resolution |
|---|---|---|
| (없음 — M3R 착수 대기) | — | — |

---

## 8. Post-Implementation

### 8.1 Self-Review Checklist (M10 시점)
- [ ] PRD P0 US-01~10 모두 구현
- [ ] Round-trip 10종 무결
- [ ] 프로토타입 회귀 0건 (E2E-01~05 녹색)
- [ ] 정본 델타 PR 3건 merged
- [ ] CLAUDE.md 갱신
- [ ] 보안 체크리스트 모두 체크

### 8.2 Ready for Check Phase
```bash
/pdca analyze hwpx-viewer-mvp
```
- Match Rate ≥ 90%
- 미만이면 `/pdca iterate`

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-04-22 | 초안 — M1~M8 체크리스트 (Block 모델 기반) | ratiertm |
| **0.2** | **2026-04-24** | **전면 재작성** — Design v0.3 반영. M3 폐기 / M3R~M7R 신규. Run 좌표 편집 + rhwp WASM. | ratiertm |
