---
template: do
version: 1.0
---

# hwpx-viewer-mvp Implementation Guide

> **Summary**: 프로토타입 `hwpx-viewer-v8.jsx`를 `apps/web`(Vite+React+TS) + `apps/backend`(FastAPI+pyhwpxlib) 모노레포로 이관하고, M1~M8 단계로 점진 구축.
>
> **Project**: HWPX Viewer (`hwpx-viewer`)
> **Version**: 0.8 → 1.0.0 (MVP)
> **Author**: ratiertm@gmail.com / MindBuild
> **Date**: 2026-04-22
> **Status**: In Progress
> **Plan Doc**: [hwpx-viewer-mvp.plan.md](../../01-plan/features/hwpx-viewer-mvp.plan.md)
> **Design Doc**: [hwpx-viewer-mvp.design.md](./hwpx-viewer-mvp.design.md)

---

## 0. 시작 전 반드시 확인할 것 (Gate)

### 0.1 Open Questions 상태 (Design §14 단일 소스)

Design §14로 **확정 6건 + 남은 결정 4건**이 이관되었다. Do는 여기서 단순히 링크만 건다.

**확정** (M2까지): pnpm workspace / Origin allowlist + slowapi rate limit / `claude -p` + OAuth / in-memory LRU(v1.5에 Redis) / 브라우저 `window.print()` / passthrough 실패 시 인라인 배너.

**남은 결정** (M3~M8 진행 중 결정):
1. `CLAUDE_MODEL` 정본 형식 — alias(`sonnet`) vs full slug(`claude-sonnet-4-6`)
2. Opus/Haiku UI 선택기 노출(v1.5로 미룸 기준)
3. claude CLI 버전 정책 — pin vs floating + 회귀 smoke(M8 #34)
4. 컨테이너 OAuth 전달 — bind mount vs Docker secret(M8 #30)

진행 도중 결정이 나오면 즉시 Design §14 확정 영역으로 이동 후 Do는 자동으로 따라간다.

### 0.2 Pre-Implementation Checklist

- [x] Plan 문서: `docs/01-plan/features/hwpx-viewer-mvp.plan.md`
- [x] Design 문서: `docs/02-design/features/hwpx-viewer-mvp.design.md`
- [ ] Convention 문서: `docs/01-plan/conventions.md` **(미작성 — 선택, M1 병행 권장)**
- [ ] 호스트에 `claude` CLI (≥ 2.1) 설치 + `claude auth` 1회 실행 완료 (`~/.claude/` OAuth 세션 존재)
- [ ] 회귀용 HWPX 샘플 10종 수집 (M3 착수 전까지. 공공 양식 우선)
- [ ] Node 20+, Python 3.11+, pnpm 9+, uv 0.4+ 로컬 설치
- [ ] 한컴오피스 수동 검증 환경 (주 1회 round-trip 확인용. Windows 또는 macOS+한컴오피스)

---

## 1. Repository Bootstrap (M1 Day 1)

### 1.1 초기 디렉터리 구조 생성

```
hwpx-viewer/
├── apps/
│   ├── web/           (신규 — M1)
│   └── backend/       (신규 — M2)
├── packages/          (향후 확장 공간, 비워둠)
├── tests/
│   └── roundtrip/     (신규 — M3)
├── docs/              (기존 유지)
├── hwpx-viewer-v8.jsx (프로토타입, 이관 완료 전까지 reference로 보존)
├── pnpm-workspace.yaml
├── package.json
├── Makefile
├── docker-compose.yml (M2에서 채움)
├── .env.example
├── .gitignore
├── .editorconfig
└── README.md
```

### 1.2 의존성 설치 명령

**Frontend 신규 프로젝트**
```bash
# 루트에서
pnpm init
pnpm add -w -D typescript@5.5 @types/node
cat > pnpm-workspace.yaml <<'EOF'
packages:
  - apps/*
  - packages/*
EOF

# apps/web 생성
pnpm create vite apps/web --template react-ts
cd apps/web
pnpm add react@18 react-dom@18 zustand@4 immer@10 lucide-react@0.383
pnpm add -D tailwindcss@3 postcss autoprefixer @types/react @types/react-dom
pnpm add -D vitest@1 @vitest/ui @testing-library/react @testing-library/jest-dom jsdom
pnpm add -D @playwright/test msw@2
pnpm add -D eslint@8 @typescript-eslint/parser @typescript-eslint/eslint-plugin
pnpm add -D eslint-plugin-boundaries eslint-plugin-react-hooks eslint-plugin-react-refresh
pnpm add -D prettier prettier-plugin-tailwindcss
npx tailwindcss init -p
cd -
```

**Backend 신규 프로젝트**
```bash
mkdir -p apps/backend
cd apps/backend
uv init --name hwpx-viewer-api --package
uv add fastapi uvicorn[standard] pydantic-settings python-multipart structlog slowapi
uv add pyhwpxlib        # MindBuild 레지스트리 경로에 맞게 조정 (M3)
# httpx는 M2에서 claude -p subprocess 전환 후 런타임 미사용. pytest-httpx만 dev-group 유지.
uv add --dev pytest pytest-asyncio httpx pytest-httpx ruff mypy
cd -
```

**루트 Makefile**
```makefile
.PHONY: dev test build up down lint

dev:
	(cd apps/web && pnpm dev) & (cd apps/backend && uv run uvicorn hwpx_viewer_api.main:app --reload --port 8000)

test:
	cd apps/web && pnpm test && cd ../.. && cd apps/backend && uv run pytest

build:
	cd apps/web && pnpm build
	docker build -f Dockerfile.web -t hwpx-viewer/web:dev .
	docker build -f Dockerfile.backend -t hwpx-viewer/backend:dev .

up:
	docker compose up -d

down:
	docker compose down

lint:
	cd apps/web && pnpm lint
	cd apps/backend && uv run ruff check . && uv run mypy .
```

### 1.3 환경변수 초기 템플릿 (`.env.example`)

M2에서 `claude -p` CLI + OAuth 경로로 전환되어 API 키 변수가 없습니다.
전제: 백엔드 호스트에서 **`claude auth` 를 1회 실행**해 `~/.claude/` OAuth 세션을 생성해야 합니다.

```bash
# ---- Backend (apps/backend) — server-only, never expose to client ----
# Since v0.8: this backend invokes `claude -p` subprocess using your OAuth
# session (Claude Pro/Max). No ANTHROPIC_API_KEY is needed. Prereq: run
# `claude auth` once on the host so the CLI has a valid session.
CLAUDE_CLI_PATH=claude
CLAUDE_MODEL=sonnet
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:8080
MAX_UPLOAD_MB=20
LOG_LEVEL=info

# ---- Frontend (apps/web) — VITE_ prefix required for client access ----
# Non-secret only. Never put API keys here.
VITE_API_BASE_URL=http://localhost:8000
```

### 1.4 `.gitignore` 필수 항목

```
node_modules/
.venv/
dist/
build/
.env
.env.local
coverage/
playwright-report/
.vite/
.pytest_cache/
__pycache__/
*.pyc
.DS_Store
```

---

## 2. Implementation Order (Design §13 재인용 + 체크)

> Design §13의 32단계를 그대로 따르되, 여기서는 각 단계의 책임자·완료 기준만 추적.

### M1 Foundation (1~2주)

| # | 작업 | 파일/위치 | 완료 기준 | 상태 |
|:-:|---|---|---|:-:|
| 1 | Vite+TS 스캐폴딩, Tailwind, `@/` alias | `apps/web/` | `pnpm dev` 후 기본 페이지 표시 | ☐ |
| 2 | 타입 정의 포팅 | `apps/web/src/types/index.ts` | COMPONENT_INVENTORY §15 전체 이식, `tsc --noEmit` 통과 | ☐ |
| 3 | 순수 함수 이관 | `apps/web/src/lib/diff/text.ts`·`table.ts`·`apps/web/src/lib/json.ts` | Vitest **UT-01~UT-54** 전부 녹색 | ☐ |
| 4 | 테마 토큰 → CSS 변수 | `apps/web/src/theme/tokens.ts` + `index.css` | 다크/라이트 모두 렌더 확인 | ☐ |
| 5 | Vitest + Playwright 기본 설정 | `vitest.config.ts`, `playwright.config.ts`, `tests/setup.ts` | `pnpm test` 녹색, **CT-01** 통과 | ☐ |

**M1 완료 기준**: 순수 함수 테스트 커버리지 ≥ 95%. `hwpx-viewer-v8.jsx`의 diff/JSON 로직을 재작성 없이 이식(함수 시그니처·동작 동일).

### M2 Backend bootstrap (1주)

| # | 작업 | 파일/위치 | 완료 기준 | 상태 |
|:-:|---|---|---|:-:|
| 6 | FastAPI 스캐폴딩, `config.py`, CORS, structlog | `apps/backend/hwpx_viewer_api/` | `uvicorn` 기동, `/healthz` 200 | ☐ |
| 7 | `/healthz`, `/readyz` | `routes/health.py` | `/readyz`는 Anthropic 도달 확인 후 200 | ☐ |
| 8 | Claude 프록시 `/api/claude/stream`·`/once` + `prompts.py` (프로토타입 문자열 원본 이식) | `routes/claude.py`, `services/claude_proxy.py`, `prompts.py` | 프로토타입과 동일 SSE 페이로드 전달, **E2E-05 동일 동작** | ☐ |
| 9 | 프론트 `src/api/claude.ts` 교체 | `apps/web/src/api/claude.ts` | URL만 `/api/claude/stream`로 변경, 기존 파서 재사용 | ☐ |

**M2 완료 기준**: 프로토타입 기능(멀티턴 대화·diff·cherry-pick)이 새 백엔드 경유로도 동작. API 키 번들 검색 → 0건.

### M3 HWPX round-trip (2~3주)

| # | 작업 | 파일/위치 | 완료 기준 | 상태 |
|:-:|---|---|---|:-:|
| 10 | pyhwpxlib 래퍼 | `converter/__init__.py` | load/dump 원활 | ☐ |
| 11 | `owpml_to_blocks` + 스타일 매핑 | `converter/owpml_to_blocks.py` | h1/h2/lead/p/table 매핑 10종 fixture 통과 | ☐ |
| 12 | Passthrough 저장/복원 | `converter/passthrough.py` | UT-62 통과 | ☐ |
| 13 | `blocks_to_owpml` | `converter/blocks_to_owpml.py` | UT-61 통과 | ☐ |
| 14 | `/api/import`·`/api/export` + `upload_store.py` | `routes/import_.py`·`export.py`, `services/upload_store.py` | Pydantic 검증, LRU TTL 30분 | ☐ |
| 15 | Round-trip 자동 회귀 | `tests/roundtrip/` | 10종 샘플 시맨틱 동등 | ☐ |

**M3 완료 기준**: 공공 양식 10종 round-trip 통과 + 한컴오피스 수동 열람 5종 이상 정상. `unsupportedBlockCount`는 샘플당 평균 10 이하 목표.

### M4 UX wiring (1주)

| # | 작업 | 파일/위치 | 완료 기준 | 상태 |
|:-:|---|---|---|:-:|
| 16 | Zustand 7 슬라이스 | `apps/web/src/state/store.ts` | 슬라이스별 Vitest 단위 테스트 | ☐ |
| 17 | `App.tsx`의 기존 17개 useState → 스토어 호출 치환 | `apps/web/src/App.tsx` | 슬라이스 단위 PR 3~4회 분할, E2E-01~05 녹색 유지 | ☐ |
| 18 | `api/hwpx.ts` + FileUploader/UploadBanner/useDropzone/ExportMenu/useExport | `apps/web/src/api/hwpx.ts`, `components/io/*`, `components/layout/ExportMenu.tsx`, `hooks/useDropzone.ts`·`useExport.ts` | **E2E-30** 녹색 | ☐ |
| 19 | ToastHost + useToast | `apps/web/src/components/feedback/` | CT-54 녹색 | ☐ |

### M5 Search (1주)
| # | 작업 | 파일 | 완료 | 상태 |
|:-:|---|---|---|:-:|
| 20 | search 슬라이스 + useSearch | `state/store.ts`, `hooks/useSearch.ts` | UT-65,66 녹색 | ☐ |
| 21 | SearchPanel, SearchHitList, InlineHighlight | `components/search/*`, `components/canvas/InlineHighlight.tsx` | CT-52 녹색 | ☐ |
| 22 | Cmd+K 바인딩 | `App.tsx` 전역 keydown | E2E-32 녹색 | ☐ |

### M6 Export PDF (0.5주)
| # | 작업 | 파일 | 완료 | 상태 |
|:-:|---|---|---|:-:|
| 23 | `print.css` + 편집 하이라이트 제거 | `apps/web/src/index.css` `@media print` | 수동 인쇄 미리보기 검증 | ☐ |
| 24 | ExportMenu > PDF | `components/layout/ExportMenu.tsx` | CT-53 녹색 | ☐ |

### M7 History 완성 (0.5주)
| # | 작업 | 파일 | 완료 | 상태 |
|:-:|---|---|---|:-:|
| 25 | HistoryPanel 필터/점프 완성 | `components/history/HistoryPanel.tsx` | CT-21~24 녹색 | ☐ |
| 26 | 기존 회귀 확인 | E2E-01 | E2E-01 녹색 | ☐ |

### M8 Hardening (1주)
| # | 작업 | 완료 | 상태 |
|:-:|---|---|:-:|
| 27 | security-architect 리뷰 + slowapi rate limiter를 `/api/claude/*`에 실 부착 | 리뷰 문서 + P0 이슈 0건, `/api/claude/*` 429 확인 | ☐ |
| 28 | 접근성(axe-core) + 키보드 | E2E-20~22 녹색 | ☐ |
| 29 | 번들 사이즈 측정 | ≤ 350KB gz | ☐ |
| 30 | **docker-compose.yml + Dockerfile.web + Dockerfile.backend 실물 작성** — backend 이미지에 Node 20+ 및 `claude` CLI 설치, `~/.claude` read-only bind mount 설정 | `docker compose up -d` 후 `/healthz` 200, `/readyz` ready | ☐ |
| 31 | 정본 델타 PR (DESIGN_SPEC §8.1 / INTERACTION_SPEC §13~§17 / COMPONENT_INVENTORY 12개 엔트리 + CoverPage.id 리터럴 + 4개 신규 타입) | 3개 문서 merged | ☐ |
| 32 | **CLAUDE.md §2 Artifacts 제약 재분류** — "localStorage 금지"는 유지, "임의 Tailwind 클래스 금지"는 `bg-[var(--..)]` 허용 규칙으로 치환, "외부 CDN 금지"는 CSP로 대체 | 메인 운영 매뉴얼 모순 해소 | ☐ |
| 33 | `conventions.md` 초안 | `docs/01-plan/conventions.md` 작성 | ☐ |
| 34 | `claude --version` 허용 범위 가드를 `/readyz`에 추가 + stream_event.event 스키마 회귀 smoke | CLI 업그레이드 회귀 조기 감지 | ☐ |
| 35 | `/pdca analyze hwpx-viewer-mvp` | Match Rate ≥ 90% | ☐ |

---

## 3. Key Files Cheat Sheet (M1~M4 기준)

### 3.1 신규 생성

| File | 책임 | 상태 | 참조 |
|---|---|:-:|---|
| `apps/web/src/types/index.ts` | 공용 타입 정본 | ✅ M1 | COMPONENT_INVENTORY §15 + Design §3.1 |
| `apps/web/src/lib/diff/text.ts` | LCS·tokenize·groupHunks·reconstructText | ✅ M1 | 프로토타입 라인 ~78 |
| `apps/web/src/lib/diff/table.ts` | 표 diff + reconstructTable + reshapeCells | ✅ M1 | 프로토타입 ~178 |
| `apps/web/src/lib/json.ts` | extractJson (제네릭) | ✅ M1 | 프로토타입 395 |
| `apps/web/src/api/claude.ts` | 백엔드 프록시 호출 (stream + once) | ✅ M2 | Design §4.2 |
| `apps/web/src/api/hwpx.ts` | import/export 호출 | ⏳ M4 | Design §4.2 |
| `apps/web/src/state/store.ts` | Zustand 7 슬라이스 | ⏳ M4 | Design §3.2 |
| `apps/web/src/theme/tokens.ts` | CSS 변수 기반 테마 (full set) | ⏳ M4 | DESIGN_SPEC §2 (M1에 min 세트만 index.css에 존재) |
| `apps/backend/hwpx_viewer_api/main.py` | FastAPI 앱, structlog, CORS | ✅ M2 | Design §4.3 |
| `apps/backend/hwpx_viewer_api/config.py` | pydantic-settings (CLAUDE_CLI_PATH/MODEL 등) | ✅ M2 | Design §4.3 |
| `apps/backend/hwpx_viewer_api/prompts.py` | 시스템 프롬프트 (프로토타입 원본 이식) | ✅ M2 | 프로토타입 라인 293·322 |
| `apps/backend/hwpx_viewer_api/schemas.py` | Pydantic 요청/응답 (Block은 M3) | ✅ M2 | Design §3.1 |
| `apps/backend/hwpx_viewer_api/errors.py` | `_CATALOG` 11개 코드 + `app_error()` | ✅ M2 | Design §6 |
| `apps/backend/hwpx_viewer_api/routes/health.py` | `/healthz`, `/readyz`(claude --version 체크) | ✅ M2 | Design §4.2 |
| `apps/backend/hwpx_viewer_api/routes/claude.py` | `/api/claude/stream`, `/api/claude/once` | ✅ M2 | Design §4.2 |
| `apps/backend/hwpx_viewer_api/services/claude_cli.py` | **asyncio subprocess → `claude -p`, stream-json → Anthropic SSE relay, `_cli_env()` strips ANTHROPIC_API_KEY** | ✅ M2 | Design §4.3 |
| `apps/backend/hwpx_viewer_api/security/cors.py` | CORS allowlist 미들웨어 | ✅ M2 | Design §7 |
| `apps/backend/hwpx_viewer_api/routes/import_.py` | POST /api/import | ⏳ M3 | Design §4.2 |
| `apps/backend/hwpx_viewer_api/routes/export.py` | POST /api/export | ⏳ M3 | Design §4.2 |
| `apps/backend/hwpx_viewer_api/converter/owpml_to_blocks.py` | OWPML→Block 매핑 | ⏳ M3 | Design §5 |
| `apps/backend/hwpx_viewer_api/converter/blocks_to_owpml.py` | Block→OWPML 재생성 | ⏳ M3 | Design §5 |
| `apps/backend/hwpx_viewer_api/converter/passthrough.py` | unknown 노드 저장/복원 | ⏳ M3 | Design §5.3 |
| `apps/backend/hwpx_viewer_api/services/upload_store.py` | in-memory LRU(TTL 30분) | ⏳ M3 | Design §4.2 |
| `apps/backend/hwpx_viewer_api/security/upload_validate.py` | magic bytes/MIME/크기 | ⏳ M3 | Design §7 |
| `docker-compose.yml` + `Dockerfile.web` + `Dockerfile.backend` | 3-서비스 docker 번들 (claude CLI 포함) | ⏳ M8 #30 | Design §12.2 |

### 3.2 정본에 델타 PR (M8)

- `docs/DESIGN_SPEC.md` §8에 FileUploader/UploadBanner/SearchPanel/SearchHit/ExportMenu/ToastHost/InlineHighlight 시각 스펙 추가 (Design §8.1 목록대로)
- `docs/INTERACTION_SPEC.md` §13~§17 추가 (Design §8.2)
- `docs/COMPONENT_INVENTORY.md`에 12개 신규 엔트리 추가 (Design §8.3)

### 3.3 수정 예정

| File | 변경 | 시점 | 이유 |
|---|---|:-:|---|
| `CLAUDE.md` §2 NEVER 섹션 | "localStorage 금지"·"외부 CDN 금지"·"HWPX XML 직접 파싱 금지"는 **유지**. "임의 Tailwind 클래스 금지"는 `bg-[var(--..)]` 허용으로 치환. "API 키 하드코딩 금지"는 OAuth 전환 맥락 주석 추가. | M8 #32 | Artifacts → 실 배포 환경 전환 후 재분류 필요 |
| `docs/COMPONENT_INVENTORY.md` §15 | `CoverPage.id: number` → `id: 0` (리터럴), `DocumentMeta`/`SearchHit`/`AppError`/`ErrorCode` 4개 타입 추가 | M8 #31 | `apps/web/src/types/index.ts` 정본으로 동기화 |
| `apps/backend/pyproject.toml` | `httpx` 런타임 의존성 제거 여부 재검토(사용 0건). 단 `pytest-httpx`는 dev-group 유지. | M3 or M8 | 이미지 사이즈 소폭 절감 |
| `hwpx-viewer-v8.jsx` | M4 완료 후 `apps/web`로 완전 이관 확인. **이관 체크리스트**: (a) E2E-01~05 녹색, (b) 프로토타입의 기능 지문(페이지 편집·인라인 cherry-pick·history 토글·스트리밍) 100% 커버, (c) COMPONENT_INVENTORY §17 P0·P1 항목 종결. 충족 시 `legacy/` 디렉터리로 이동, M8 #35 `/pdca analyze` 녹색 이후 완전 삭제. | M7 말 → M8 #35 이후 | 중복 제거 + single source of truth |

---

## 4. Dependencies 요약

### 4.1 Frontend (apps/web)
- **prod**: `react`, `react-dom`, `zustand`, `immer`, `lucide-react`
- **build**: `vite`, `typescript`, `tailwindcss`, `postcss`, `autoprefixer`
- **test**: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `@playwright/test`, `msw`
- **lint**: `eslint`, `@typescript-eslint/*`, `eslint-plugin-boundaries`, `eslint-plugin-react-hooks`, `prettier`, `prettier-plugin-tailwindcss`

### 4.2 Backend (apps/backend)
- **runtime**: `fastapi`, `uvicorn[standard]`, `pydantic-settings`, `python-multipart`, `structlog`, `slowapi`, `pyhwpxlib` (M3). ~~`httpx`~~ — M2에서 직접 API 호출 경로를 버렸으므로 런타임에서는 실제 미사용(pyproject.toml은 아직 유지, M3에서 정리 예정).
- **dev**: `pytest`, `pytest-asyncio`, `pytest-httpx`, `ruff`, `mypy`
- **호스트 전제**: `claude` CLI (≥ 2.1) 설치 + `claude auth` 1회 실행 완료 (`~/.claude/` OAuth 세션 존재).

### 4.3 새로 추가된(프로토타입 대비) 런타임 deps
- `zustand`, `immer` — 상태 관리 도입 (M4)
- FastAPI 스택 전체 — 백엔드 자체가 신규 (M2)
- `claude` CLI — LLM bridge로 API 키 대신 사용 (M2 결정)

---

## 5. Implementation Notes

### 5.1 Design Decisions (프로토타입에서 달라지는 부분)

| Decision | Choice | Rationale |
|---|---|---|
| 상태 관리 | Zustand + immer | 17개 useState → 7 슬라이스. 불변성 보장. |
| API client | fetch (native) + 백엔드 프록시 경유 | 번들 경량, SSE 기존 파서 재사용. |
| LLM Bridge | `claude -p` subprocess + 호스트 OAuth 세션 | API 키 저장·주입 없음. 사용자 Claude Pro/Max 구독 활용. stream-json 출력이 Anthropic SSE와 동일해 프론트 파서 무수정. |
| 에러 처리 | `AppError` 통일 + 토스트 | Design §6 카탈로그 강제. |
| 테마 | CSS 변수로 승격 | DESIGN_SPEC 1:1 대응 + print에서 재사용. |
| 빌드 | Vite | Artifacts 제약 해제. 임의 Tailwind 클래스(`text-[13px]`)는 **허용**하되 색·간격은 여전히 토큰 경유(`bg-[var(--bg)]`). |
| 데이터 | mock INITIAL_PAGES → 업로드된 실제 pages | 프로덕션 번들에서 `INITIAL_PAGES` 제거(스토리북/테스트만 참조) |

### 5.2 Code Patterns to Follow

**컴포넌트 기본 시그니처 (프로토타입과 일관)**
```tsx
import type { Theme } from '@/types';

interface Props {
  t: Theme;
  theme: 'dark' | 'light';
  // 외부 상태 변경은 콜백으로만
  onSomething?: (x: string) => void;
}

export function Something({ t, theme, onSomething }: Props) {
  // 내부 상태만 useState, 외부는 스토어에서 selector로
}
```

**스토어 액션 호출**
```tsx
import { useViewerStore } from '@/state/store';

function Header() {
  const theme = useViewerStore(s => s.theme);
  const toggleTheme = useViewerStore(s => s.toggleTheme);
  // ...
}
```

**API 에러 매핑**
```ts
import { toAppError } from '@/api/errors';

try {
  const res = await fetch(...);
  if (!res.ok) throw toAppError(res);
} catch (e) {
  useViewerStore.getState().pushToast({ kind: 'error', ...toAppError(e) });
}
```

### 5.3 Things to Avoid (프로토타입 규칙 + 신규)

- [ ] `setPages` 외부 직접 호출 — 반드시 `recordEdit` / `loadDocument` 경유
- [ ] history entry 삭제 — undone 토글만
- [ ] 임의 색 해시(`bg-[#xxx]`) — `bg-[var(--...)]`도 토큰 변수만 사용
- [ ] 프론트에 HWPX XML 파싱/생성 코드 — 백엔드 위임
- [ ] Claude 시스템 프롬프트 의미 변경 — `prompts.py`에 원본 보존
- [ ] `localStorage`·외부 CDN 폰트 — 여전히 금지 (CSP와 상충)
- [ ] silent catch — 모든 에러는 토스트 또는 UI 반영

### 5.4 Architecture Checklist (Level: Dynamic - Custom Server)

- [ ] Layer Structure — Domain(`types`, `lib`) / Application(`state`, `hooks`) / Presentation(`components`, `theme`) / Infrastructure(`api`)
- [ ] Dependency Direction — Presentation → Application → Domain ← Infrastructure
- [ ] Import Rules — `components → api` 직접 허용(infra), `components → lib` 허용, 역방향 0건
- [ ] ESLint `boundaries` 플러그인으로 강제

### 5.5 Convention Checklist

- [ ] Naming — 컴포넌트/파일 PascalCase, 훅 `use*`, 상수 UPPER_SNAKE_CASE, 폴더 kebab-case
- [ ] Import 순서 — Design §10.2
- [ ] Props 표준 — `t: Theme`, `theme: 'dark' | 'light'`
- [ ] 커밋 메시지 — Conventional Commits

### 5.6 Security Checklist

- [x] **서버는 API 키 없음** (M2): `config.py`가 `ANTHROPIC_API_KEY`를 로드하지 않음. `services/claude_cli.py::_cli_env()`가 부모 env에서 해당 변수를 pop 하고 subprocess를 기동한다 — OAuth 경로 강제.
- [ ] 클라이언트 번들 `ANTHROPIC_API_KEY` grep 0건 (여전히 유효한 negative check, CI gate)
- [ ] 배포 호스트 `~/.claude/` 권한 0600 확인
- [ ] 컨테이너 배포 시 `~/.claude/`를 read-only secret mount로 전달 (M8 #30)
- [ ] 업로드 magic bytes 검증 (서버, M3)
- [x] CORS allowlist (`CORS_ALLOWED_ORIGINS`, M2에서 부착됨)
- [ ] CSP 헤더 설정 (Nginx conf, M8 #30)
- [ ] rate limit (`slowapi`) 적용된 엔드포인트: `/api/claude/*` (M8 #27에서 실 부착 — 지금은 import만 되고 데코레이터 미부착)
- [x] 서버 로그에서 API 키 마스킹 (M2 structlog processor) — 파일 내용 마스킹은 M3 업로드 경로에서 확장
- [ ] 검색은 문자열 `indexOf` 기반 (ReDoS 방지, M5)

### 5.7 API Checklist

- [ ] 응답 형식 — 성공 직접 body, 에러 `{ error: { code, message, detail?, recoverable } }` (Design §6)
- [ ] HTTP — POST로 일관 (RESTful strict GET은 health만)
- [ ] SSE — `event`/`data` 규약 준수, `[DONE]`로 종료

---

## 6. Testing Checklist (Do 중 지속)

### 6.1 Manual Testing (M4 이후 주기적)

- [ ] Happy path: 업로드 → AI 편집 → Download → 재업로드
- [ ] Error: 이상 파일/네트워크 단절/세션 만료
- [ ] Loading: 업로드 진행률·스트리밍 펄스
- [ ] Edge: 빈 문서·대형 문서(20MB)·표만 있는 문서

### 6.2 Code Quality (PR 단위)

- [ ] `tsc --noEmit` 통과
- [ ] `pnpm lint` 무경고
- [ ] `pytest` + `ruff check` 녹색
- [ ] 커버리지 대시보드: 순수 함수 95%, 컴포넌트 80%

---

## 7. Progress Tracking

### 7.1 Daily Log (작업 시 추가)

| Date | Task | Notes |
|---|---|---|
| 2026-04-22 | PDCA Do phase kickoff, Do 가이드 작성 | Open Questions 권장안으로 착수 |

### 7.2 Blockers

| Issue | Impact | Resolution |
|---|---|---|
| (없음) | — | — |

---

## 8. Post-Implementation

### 8.1 Self-Review Checklist (M8 끝)

- [ ] FR-01~FR-12 모두 구현
- [ ] Round-trip 10종 무결
- [ ] 프로토타입 회귀 0건 (E2E-01~05 녹색)
- [ ] 정본 델타 PR 3건 merged
- [ ] CLAUDE.md Artifacts 제약 주석 갱신
- [ ] 보안 체크리스트 모두 체크

### 8.2 Ready for Check Phase

M8 완료 후:
```bash
/pdca analyze hwpx-viewer-mvp
```
- 기대 Match Rate ≥ 90%
- 미만이면 `/pdca iterate hwpx-viewer-mvp` 자동 개선 루프

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-04-22 | 초안 — M1~M8 파일 단위 체크리스트, 의존성 설치 명령, Open Questions Gate | ratiertm@gmail.com |
