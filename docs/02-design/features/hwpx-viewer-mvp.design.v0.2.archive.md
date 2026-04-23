---
template: design
version: 1.2
---

# hwpx-viewer-mvp Design Document

> **Summary**: 프로토타입 단일 파일 `hwpx-viewer-v8.jsx`를 `apps/web`(Vite+React+TS) + `apps/backend`(FastAPI+pyhwpxlib) 두 서비스로 분리하고, mock 데이터 경로를 실제 HWPX round-trip + Claude 서버 프록시 경로로 치환한다. 시각·UX는 기존 정본(DESIGN_SPEC/INTERACTION_SPEC)을 재사용하고, 이 문서는 **구현 설계 + 델타**만 다룬다.
>
> **Project**: HWPX Viewer (`hwpx-viewer`)
> **Version**: 0.8 → 1.0.0 (MVP)
> **Author**: ratiertm@gmail.com / MindBuild
> **Date**: 2026-04-22
> **Status**: Draft
> **Planning Doc**: [hwpx-viewer-mvp.plan.md](../../01-plan/features/hwpx-viewer-mvp.plan.md)

### Pipeline / 정본 참조

| 목적 | 문서 | 역할 |
|---|---|---|
| 운영 매뉴얼 | `CLAUDE.md` | NEVER/ALWAYS 규칙. 이 Design의 모든 결정이 이 규칙을 위배하지 않음을 전제. |
| 코드 구조·상태 | `docs/ARCHITECTURE.md` | 블록 모델·history·messages·diff 엔진 구조 정본 |
| 컴포넌트·순수 함수 계약 | `docs/COMPONENT_INVENTORY.md` | Props 계약, 타입 정의(§15) 재사용 |
| 시각 디자인 | `docs/DESIGN_SPEC.md` | 색/타이포/간격/컴포넌트 시각 정본 — §8.1에 델타만 추가 |
| 인터랙션 | `docs/INTERACTION_SPEC.md` | 사용자 액션 ↔ 시스템 반응 정본 — §8.2에 델타만 추가 |
| 테스트 | `docs/TEST_SPEC.md` | UT/CT/E2E 시나리오. 이 Design은 신규 테스트 ID만 추가 |
| Plan | `docs/01-plan/features/hwpx-viewer-mvp.plan.md` | Scope, FR-01~12, NFR, 리스크 |
| Convention (신규) | `docs/01-plan/conventions.md` | Design 확정 후 초안 작성 |

> **층 구분**: 시각은 DESIGN_SPEC, UX는 INTERACTION_SPEC, 구현(코드·API·변환)은 이 문서. 중복 서술 금지 — 정본에 이미 있는 내용은 **참조만** 한다.

---

## 1. Overview

### 1.1 Design Goals

1. **프로토타입 UX 100% 보존** — 페이지 AI 편집·인라인 cherry-pick·history 토글·스트리밍 UI가 동일 동작. 회귀 0건.
2. **HWPX를 뷰어에서 추상화** — 프론트는 `Block[]` 모델만 안다. 파싱/직렬화는 전적으로 백엔드 pyhwpxlib 위임.
3. **Round-trip 시맨틱 보존** — 지원하지 않는 OWPML 요소는 passthrough 원본 XML로 저장되어, 편집되지 않은 블록은 저장 시 원본 바이트와 의미적으로 동등.
4. **Claude 키 클라이언트 제로 노출** — 번들 내 `ANTHROPIC_API_KEY` 문자열 0회 매치.
5. **온프레미스 지향** — 2개 컨테이너(`web` Nginx + `backend` FastAPI+`claude` CLI)로 `docker-compose up` 단일 기동, 외부 CDN/스크립트 의존 없음. 유일한 외부 호출은 backend 안의 `claude` CLI subprocess가 호스트 OAuth 세션으로 `api.anthropic.com`에 보내는 요청 한 경로.
6. **순수 함수는 프레임워크 독립** — diff 엔진/extractJson은 Vitest 단위 테스트로만 커버, 컴포넌트·스토어에 묶이지 않음.

### 1.2 Design Principles

- **뷰어는 HWPX를 모른다** — HWPX XML 파싱/생성 코드는 frontend에 존재하지 않음 (CLAUDE.md §2 NEVER 규칙의 연장).
- **Block 모델이 진실** — 모든 편집·diff·history는 Block 레벨. OWPML은 앞단(import)과 뒷단(export)에서만 존재.
- **Immutability over optimization** — history entry는 전체 body 스냅샷. 메모리 최적화는 v1.5 이후 prosaic.
- **델타만 정본에 PR** — 시각/UX 정본 재작성 금지. 신규 컴포넌트만 DESIGN_SPEC·INTERACTION_SPEC·COMPONENT_INVENTORY에 추가.
- **Fail loudly at boundaries** — 업로드·변환·API 실패는 반드시 사용자 UI로 노출. silent fallback 금지.

---

## 2. Architecture

### 2.1 Service Topology

```
┌──────────────────────────────────────────────────────────────────┐
│                       docker-compose network                     │
│  ┌──────────────────┐        ┌─────────────────────────────────┐ │
│  │  web (Nginx)     │        │  backend (FastAPI + uvicorn)    │ │
│  │  apps/web dist   │──────▶ │  /api/import  /api/export       │ │
│  │  Vite prod build │  HTTP  │  /api/claude/stream             │ │
│  │  port 8080       │        │  /api/claude/once  /healthz     │ │
│  └──────────────────┘        │  port 8000                      │ │
│         ▲                    │                                 │ │
│         │ browser            │  ┌────────────────────────────┐ │ │
│         │                    │  │ pyhwpxlib (in-process)     │ │ │
│         │                    │  └────────────────────────────┘ │ │
│         │                    │                                 │ │
│         │                    │  ┌────────────────────────────┐ │ │
│         │                    │  │ asyncio subprocess         │ │ │
│         │                    │  │   → spawn `claude -p`      │ │ │
│         │                    │  │      (stream-json)         │ │ │
│         │                    │  └─────────────┬──────────────┘ │ │
│         │                    └────────────────┼────────────────┘ │
│  ┌──────┴──────────┐                          │                  │
│  │   user Chrome   │            claude child uses host           │
│  └─────────────────┘            OAuth session (~/.claude)        │
│                                          │                       │
│                                          ▼                       │
│                         api.anthropic.com (only external call)   │
└──────────────────────────────────────────────────────────────────┘
```

**핵심**: 백엔드 FastAPI는 Anthropic과 직접 통신하지 않는다. `claude -p` subprocess를 기동해 그 child 프로세스가 호스트의 OAuth 세션(`~/.claude/`)으로 외부 호출을 한다. subprocess env에서 `ANTHROPIC_API_KEY`를 strip 하여 OAuth 경로를 강제.

### 2.2 Data Flow (핵심 3가지)

**A. Import (.hwpx → render)**

```
user drag-drop .hwpx
  → <FileUploader> validates (size ≤ MAX_UPLOAD_MB, MIME, magic bytes)
  → POST /api/import  (multipart form-data)
      → backend:  pyhwpxlib.load(bytes)
                  converter.owpml_to_blocks(doc) → { pages: Page[], meta, passthrough_map }
      → 200 application/json { pages, meta, uploadId }
  → zustand useViewerStore.setPages(pages, meta, uploadId)
  → Canvas renders, currentPage=1
```

**B. Edit (Claude chat → pages)**  (프로토타입과 경로 유지, fetch 목적지만 교체)

```
user sends chat message
  → POST /api/claude/stream  (JSON: { system: 'doc_editor', messages })
      → backend spawns `claude -p --output-format stream-json ...`
        via asyncio.create_subprocess_exec. env strips ANTHROPIC_API_KEY
        so the child uses host OAuth session (~/.claude).
      → backend reads child stdout line-by-line, re-emits each
        `stream_event.event` as `data: <json>\n\n` SSE to client.
        (The inner event payload is Anthropic's native
        content_block_delta wire format — parser unchanged.)
  → frontend: existing streamClaude() consumes same SSE shape
  → extractJson(fullText) → { summary, edits } → existing recordEdit pipeline
```

**C. Export (.hwpx 저장)**

```
user clicks Download
  → POST /api/export  { pages: Page[], uploadId?: string }
      → backend: converter.blocks_to_owpml(pages, passthrough=uploadId) → bytes
      → 200 application/vnd.hancom.hwpx  (Content-Disposition: attachment; filename=...)
  → frontend: trigger browser download via Blob URL
```

### 2.3 Dependencies

| Layer | Depends On | Purpose |
|---|---|---|
| apps/web | apps/backend via HTTP | HWPX I/O, Claude proxy |
| apps/backend | pyhwpxlib, asyncio subprocess, `claude` CLI (OAuth) | OWPML parsing + LLM orchestration |
| apps/web | nothing at build except Vite devserver → backend dev proxy | — |
| 순수 함수(`lib/diff/*`, `lib/json.ts`) | nothing | 어느 레이어도 의존 가능 |
| `claude` CLI (host) | `~/.claude/` OAuth tokens, `api.anthropic.com` | 유일한 외부 호출 주체 |

---

## 3. Data Model

### 3.1 Shared Types

타입은 `COMPONENT_INVENTORY.md §15`의 정의를 **그대로** 채택하고, `apps/web/src/types/index.ts`에 이식. 백엔드는 동일 스키마를 Pydantic으로 미러.

**TypeScript** (요약 — 전문은 `COMPONENT_INVENTORY.md §15` 참조)

```typescript
// 재사용 — 변경 없음
export type Page = CoverPage | ContentPage;
export type Block = TextBlock | TableBlock | PageBreakBlock;  // PageBreakBlock 추가 (§5.1 참조)
export interface HistoryEntry { ... }
export interface Edit { ... }
export interface Message { ... }

// 신규 (이 사이클 추가)
export interface DocumentMeta {
  uploadId: string;           // UUID, 서버가 발급
  fileName: string;
  fileSize: number;
  ownerHash?: string;         // v1.5 사용자 분리
  hwpxVersion?: string;       // OWPML 메타에서 추출
  unsupportedBlockCount: number; // passthrough로 전환된 OWPML 요소 수
}

export interface SearchHit {
  pageId: number;
  blockIdx: number;
  text: string;
  range: { start: number; end: number };
}

export interface AppError {
  code: ErrorCode;            // §6 참조
  message: string;            // 사용자 노출 한국어 메시지
  detail?: string;            // 디버그용
  recoverable: boolean;
}
```

**Pydantic** (backend mirror — `hwpx_viewer_api/schemas.py`)

```python
class TextBlock(BaseModel):
    type: Literal["h1", "h2", "lead", "p"]
    text: str

class TableBlock(BaseModel):
    type: Literal["table"]
    headers: list[str]
    rows: list[list[str]]

class PageBreakBlock(BaseModel):
    type: Literal["pageBreak"]

Block = Annotated[Union[TextBlock, TableBlock, PageBreakBlock], Field(discriminator="type")]

class ContentPage(BaseModel):
    id: int
    title: str
    section: str               # "01", "02", ...
    body: list[Block]

class CoverPage(BaseModel):
    id: Literal[0] = 0
    title: Literal["Cover"] = "Cover"
    section: Literal["00"] = "00"
    isCover: Literal[True] = True

Page = Annotated[Union[CoverPage, ContentPage], Field(discriminator="isCover")]

class DocumentMeta(BaseModel):
    uploadId: str
    fileName: str
    fileSize: int
    hwpxVersion: str | None = None
    unsupportedBlockCount: int = 0

class ImportResponse(BaseModel):
    pages: list[Page]
    meta: DocumentMeta

class ExportRequest(BaseModel):
    pages: list[Page]
    uploadId: str | None = None  # passthrough 복원에 사용
```

### 3.2 Store Shape (Zustand, apps/web/src/state/store.ts)

> **구현 시점**: M4 UX wiring에서 도입. M1+M2 완료 기준에는 미구현 (기존 프로토타입의 17개 useState가 App.tsx 임시 구조에 없어 아직 상태 관리가 필요 없음).

단일 스토어에 7개 슬라이스. `immer` 미들웨어로 `draft.pages[i] = ...` 쓰기 허용, 외부에는 불변 타입 노출.

| Slice | 상태 필드 | 액션 |
|---|---|---|
| `document` | `pages`, `meta`, `currentPage`, `zoom`, `highlightedSections` | `loadDocument(pages, meta)`, `setCurrentPage`, `setZoom`, `flashSections(ids)` |
| `history` | `history`, `historyIdCounter` | `recordEdit(pageId, oldBody, newBody, action)`, `toggleEdit(id)` |
| `chat` | `messages`, `chatInput`, `isStreaming`, `streamingText`, `showDiff` | `sendMessage`, `appendStream`, `applyEdits`, `toggleDiff`, `clearConversation` |
| `inline` | `selectionMenu`, `inlineEditing` | `openSelectionMenu`, `closeSelectionMenu`, `startInlineEdit`, `setInlineReady`, `setInlineError`, `acceptInlineEdit`, `rejectInlineEdit` |
| `ui` | `sidebarOpen`, `chatOpen`, `historyOpen`, `userMenuOpen`, `theme` | 각 토글 |
| `search` | `query`, `hits`, `activeHitIdx` | `runSearch`, `jumpToHit`, `clearSearch` |
| `io` | `upload: { state, progress, error }`, `exportState` | `startUpload`, `setUploadProgress`, `finishUpload`, `startExport`, `finishExport` |

**불변성 규칙**: `document.pages` 변경은 반드시 `recordEdit` 또는 `loadDocument` 경유. 컴포넌트가 직접 `setPages` 호출 금지 — ESLint 룰로 강제(`no-restricted-imports` + wrapper).

### 3.3 Module Dependency Graph

```
apps/web/src
├── types/           (no deps — pure types)
├── lib/
│   ├── diff/text.ts     ── types
│   ├── diff/table.ts    ── types
│   └── json.ts          ── (none)
├── api/
│   ├── claude.ts        ── types, lib/json.ts
│   └── hwpx.ts          ── types
├── state/
│   └── store.ts         ── types, lib/diff/*, api/*
├── hooks/
│   ├── useScrollSpy.ts  ── state
│   ├── useSelectionMenu.ts ── state
│   └── useStreamChat.ts ── state, api/claude.ts
├── theme/tokens.ts      ── (CSS vars, no ts deps)
├── data/
│   ├── initial-pages.ts  (v1.0: only for storybook/tests; removed from prod bundle)
│   ├── suggestions.ts
│   └── inline-actions.ts
└── components/
    ├── layout/    ── state, theme, primitives
    ├── canvas/    ── state, theme, lib/diff, components/inline
    ├── chat/      ── state, theme, components/diff
    ├── history/   ── state, theme
    ├── inline/    ── state, theme, lib/diff
    ├── diff/      ── theme, lib/diff
    └── primitives/── theme (no state deps)
```

**Lint 강제**: `eslint-plugin-boundaries`로 `components → state`, `components → lib`는 허용. 역방향(lib → components) 0건. Domain(types, lib) 레이어는 외부 import 금지.

---

## 4. API Specification

### 4.1 Endpoint List

| Method | Path | Description | Auth (v1.0) | Auth (v1.5+) | Status |
|--------|------|-------------|:-----------:|:------------:|:------:|
| POST | `/api/import` | .hwpx 업로드 → Block[] + meta | None (Origin allowlist) | user session | ⏳ M3 |
| POST | `/api/export` | Block[] + uploadId → .hwpx 바이너리 | None | user session | ⏳ M3 |
| POST | `/api/claude/stream` | Claude 스트리밍 프록시 (SSE) | None | per-session rate limit | ✅ M2 |
| POST | `/api/claude/once` | Claude 단발 호출 (인라인 편집) | None | per-session rate limit | ✅ M2 |
| GET | `/healthz` | Liveness | Public | Public | ✅ M2 |
| GET | `/readyz` | Readiness(`claude` CLI 설치·실행 가능 확인) | Public | Public | ✅ M2 |

### 4.2 Detailed Specification

#### `POST /api/import`

**Request**: `multipart/form-data`
- `file`: 바이너리 .hwpx (Content-Type `application/vnd.hancom.hwpx` 또는 `application/octet-stream`)
- 크기 상한: `MAX_UPLOAD_MB` (기본 20)

**Response (200 OK)**
```json
{
  "pages": [ { "id": 0, "isCover": true, "title": "Cover", "section": "00" }, ... ],
  "meta": {
    "uploadId": "3f1c...-uuid",
    "fileName": "계획서.hwpx",
    "fileSize": 348221,
    "hwpxVersion": "2.0",
    "unsupportedBlockCount": 3
  }
}
```

**Errors**
- `400 INVALID_FILE` — 확장자/MIME/magic bytes 불일치
- `413 FILE_TOO_LARGE` — MAX_UPLOAD_MB 초과
- `415 UNSUPPORTED_FORMAT` — pyhwpxlib가 파싱 실패(암호화 HWP/손상된 XML 등)
- `500 CONVERTER_ERROR` — 변환 내부 예외

**서버 처리**
1. Multipart 파싱 → 첫 2KB 읽어 magic bytes(`PK\x03\x04` — ZIP 컨테이너) 검증
2. `pyhwpxlib.load(bytes)` 호출
3. `converter.owpml_to_blocks(doc)` 실행 — 지원하지 않는 요소는 `passthrough_store[uploadId]`에 원본 XML 노드로 저장
4. `uploadId`(UUID v4) 발급, in-memory LRU(max 100, TTL 30분)에 `{doc, passthrough_store}` 보관 — v1.5 이후 Redis로 교체 여지

#### `POST /api/export`

**Request**
```json
{
  "pages": [ /* Block 모델 */ ],
  "uploadId": "3f1c...-uuid"
}
```

**Response (200 OK)**
- `Content-Type: application/vnd.hancom.hwpx`
- `Content-Disposition: attachment; filename="계획서 (수정).hwpx"`
- Body: HWPX 바이너리

**Errors**
- `400 INVALID_BLOCKS` — Pydantic 검증 실패
- `404 UPLOAD_EXPIRED` — uploadId가 LRU에서 제거됨(30분 초과). 이 경우 passthrough 없이 export 가능 여부를 `X-HwpxViewer-Passthrough: missing` 헤더로 알림. 프론트는 사용자에게 "일부 서식이 단순화될 수 있음" 경고 후 재요청하거나, 재업로드 제안.
- `500 CONVERTER_ERROR`

**서버 처리**
1. Block 검증
2. `uploadId`로 passthrough store 조회 (없으면 passthrough 생략)
3. `converter.blocks_to_owpml(pages, passthrough_store.get(uploadId))` → OWPML ElementTree
4. `pyhwpxlib.dump()` → bytes
5. 파일명 생성: 원본 파일명 + " (수정)" 접미사

#### `POST /api/claude/stream`

**Request**
```json
{
  "system": "doc_editor",
  "messages": [ { "role": "user", "content": "..." } ]
}
```

`system`은 식별자(`doc_editor` | `inline_editor`)만 받고, 실제 시스템 프롬프트 문자열은 서버의 `prompts.py`에서 주입. 프론트는 프롬프트 내용을 모름 → CLAUDE.md §7 "API 시스템 프롬프트 의미 변경 금지" 준수 강제.

**Response**
- `Content-Type: text/event-stream`
- 서버 동작: `claude -p --output-format stream-json --include-partial-messages ...` subprocess를 기동. stdout의 각 JSON 라인에서 `stream_event.event` 필드만 추출해 `data: <json>\n\n` 형태로 re-emit. 이 내부 이벤트 shape은 Anthropic 네이티브 포맷(`message_start`/`content_block_delta`/`message_stop` …)이라 프로토타입의 `streamClaude` 파서가 변경 없이 동작.
- 종료: `data: [DONE]`

**Errors** (모두 StreamingResponse 커밋 전에 일반 HTTP 응답으로 반환 — SSE 절반 오픈 방지)
- `401 AUTH_ERROR` — `claude` CLI OAuth 세션 만료/미인증. 서버는 subprocess 첫 line에서 `is_error: true` + `api_error_status: 401`을 감지 후 HTTPException raise. 호스트에서 `claude auth` 재실행 필요.
- `429 RATE_LIMITED` — Claude 구독(Pro/Max) 세션 한도 초과
- `503 UPSTREAM_UNAVAILABLE` — CLI 미설치, 실행 실패, 첫 line 타임아웃 등
- 스트림 중간 실패 시: `event: error / data: { type: 'upstream_error', message, api_error_status }` 한 번 emit 후 `data: [DONE]`로 마감, 연결 종료.

#### `POST /api/claude/once`

**Request/Response**: `{ system, prompt }` → `{ "text": "..." }`. 인라인 편집 전용. 내부적으로 `claude -p --output-format json --no-session-persistence ...` 를 실행하고 결과 JSON의 `result` 필드를 text로 반환.

### 4.3 백엔드 레이어 구조

```
apps/backend/hwpx_viewer_api/
├── main.py                 # FastAPI 앱, 라우터 포함, CORS, structlog
├── config.py               # pydantic-settings: CLAUDE_CLI_PATH, CLAUDE_MODEL, CORS_*, MAX_UPLOAD_MB, LOG_LEVEL, STREAM/ONCE_MAX_TOKENS
├── routes/
│   ├── import_.py          # POST /api/import                         (⏳ M3)
│   ├── export.py           # POST /api/export                         (⏳ M3)
│   ├── claude.py           # /api/claude/stream, /once                (✅ M2)
│   └── health.py           # /healthz, /readyz                        (✅ M2)
├── services/
│   ├── upload_store.py     # LRU + TTL (v1.0 in-memory, v1.5+ Redis)  (⏳ M3)
│   └── claude_cli.py       # asyncio subprocess → `claude -p`,         (✅ M2)
│                           #   stream-json → Anthropic SSE relay.
│                           #   _cli_env() strips ANTHROPIC_API_KEY
│                           #   so OAuth is forced.
├── converter/              # (⏳ M3)
│   ├── __init__.py
│   ├── owpml_to_blocks.py  # §5
│   ├── blocks_to_owpml.py  # §5
│   └── passthrough.py      # unknown 노드 저장/복원
├── security/
│   ├── upload_validate.py  # magic bytes, MIME, size                  (⏳ M3)
│   └── cors.py             # allowlist                                (✅ M2)
├── prompts.py              # SYSTEM_DOC_EDITOR, SYSTEM_INLINE_EDITOR
│                           #   (프로토타입 문자열 그대로 이식)        (✅ M2)
├── errors.py               # AppError 매핑                            (✅ M2)
└── schemas.py              # Pydantic 모델 (§3.1)                     (✅ M2, M3에 Block 추가)
```

**`claude -p` 호출 플래그 고정셋** (services/claude_cli.py `_COMMON_FLAGS`):
```
-p --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
   --setting-sources "" --disable-slash-commands \
   --tools "" --dangerously-skip-permissions \
   --no-session-persistence
```
— MCP·사용자 훅·slash skill·도구·세션 저장을 전부 차단해 순수 텍스트 응답만 받는다. 스트리밍은 추가로 `--output-format stream-json --verbose --include-partial-messages`, once는 `--output-format json`.

---

## 5. OWPML ↔ Block Converter

### 5.1 매핑 테이블 (v1.0 지원 범위)

| OWPML 요소 | → Block | 비고 |
|---|---|---|
| `<hh:head>` / 문서 메타 | `DocumentMeta` | title, version 추출 |
| `<hs:sec>` (섹션) | `Page` (ContentPage) | **각 섹션이 정확히 하나의 Page**. `id = section_idx + 1`, `section = zero-pad(id, 2)`. 섹션 내부의 `page_break`는 Page 경계가 되지 않고, 대신 본문에 `PageBreakBlock`으로 기록됨 (아래 행 참조). v1.0 multi-section 지원. |
| `<hp:p>` style="heading1" | `TextBlock { type: 'h1', text }` | 스타일 이름 매칭 테이블 참조 (§5.2) |
| `<hp:p>` style="heading2" | `TextBlock { type: 'h2' }` | |
| `<hp:p>` style="lead"/"subtitle" | `TextBlock { type: 'lead' }` | 스타일 없으면 첫 문단이면서 길이 150자 미만이면 휴리스틱으로 lead 승격 |
| `<hp:p>` 나머지 | `TextBlock { type: 'p' }` | |
| `<hp:p page_break="1">` (또는 `column_break="1"`) | `PageBreakBlock { type: 'pageBreak' }` | Para.page_break=True인 문단. 본문 텍스트 없이 논리적 쪽 나눔만 수행. 섹션 경계(Page)와 구분됨. |
| `<hp:tbl>` | `TableBlock { headers, rows }` | 첫 행이 `th`이거나 굵은 스타일이면 headers, 나머지 rows. 병합 셀은 **v1.0 미지원**, passthrough로 회피. |
| 표지(첫 섹션에 큰 제목 + 여백 많음) | `CoverPage` | 섹션 0을 CoverPage로 승격하는 휴리스틱. 실패 시 일반 ContentPage. |
| 이미지 `<hp:pic>`, 각주 `<hp:footnote>`, 수식, 차트, 필드, 헤더/푸터 | **passthrough** | 원본 XML 노드를 `passthrough_store[uploadId]`에 보관, Block 모델에는 나타나지 않음. 저장 시 원위치 복원. |
| 주석·변경추적·머리글/바닥글 | passthrough | 동일 |

### 5.2 스타일 이름 매칭

한/영 스타일 이름이 문서마다 다르므로 매칭 테이블을 분리:

```python
STYLE_MAP = {
    ("heading 1", "제목 1", "Heading1", "h1"): "h1",
    ("heading 2", "제목 2", "Heading2", "h2"): "h2",
    ("lead", "부제", "Subtitle", "subtitle"): "lead",
}
# 이외는 모두 "p"
```

매칭 실패 시: 글자 크기(`hh:sz` ≥ 24 → h1, ≥ 18 → h2) 휴리스틱. 그래도 없으면 `"p"`.

### 5.3 Passthrough 전략

- `passthrough_store[uploadId]`는 `{ node_id → xml.etree.Element }` 매핑
- `owpml_to_blocks` 중 unknown 노드 만나면 UUID 할당, Element를 저장, **Block 모델에는 아무 것도 추가하지 않음**
- `blocks_to_owpml` 시 원본 섹션 순회하며 unknown 노드 자리에 저장된 Element를 그대로 삽입
- 편집된 블록과 passthrough 노드의 순서 보존은 "섹션 내 블록 인덱스" 기준 트리 재구성 알고리즘으로 처리 — 상세 알고리즘은 `converter/passthrough.py` 모듈 docstring에 기술

**제약**: 사용자가 새 블록을 중간에 삽입하면 passthrough 노드 순서가 어긋날 수 있음. 이 경우 편집된 페이지는 passthrough 없이 재생성(일부 장식 손실) + 토스트로 "이 페이지의 일부 서식이 단순화됩니다" 경고. 구체 판정: `passthrough가 속한 섹션의 블록 배열이 Block 모델에서 삭제/재정렬되면 그 섹션은 non-passthrough 재생성`.

### 5.4 Round-trip 테스트

- `tests/roundtrip/fixtures/` 에 실제 공공 양식 10종 `.hwpx` 샘플
- `roundtrip_test.py`: load → dump → load → 시맨틱 동등성(텍스트·표·스타일 이름) 비교
- 한컴오피스 수동 열람 체크리스트 (주 1회, `docs/qa/roundtrip-checklist.md` 신규)

### 5.5 Multi-section Export — apply_overlay chain

pyhwpxlib의 `apply_overlay(source, overlay, output)`는 overlay 한 개 = 섹션 한 개를 타깃한다. 다중 섹션 문서는 체인 적용:

```
intermediate_0 ← apply_overlay(source_hwpx, edited_overlay[0], tmp_0)
intermediate_1 ← apply_overlay(intermediate_0, edited_overlay[1], tmp_1)
...
output         ← apply_overlay(intermediate_N-1, edited_overlay[N-1], tmp_N-1)
```

각 단계에서 overlay가 타깃하지 않는 섹션은 그대로 passthrough된다. 바이트 수준 무결성은 pyhwpxlib 내부가 보장. 중간 tempfile은 try/finally로 항상 정리.

업로드 세션은 `overlays: list[dict]`를 보관(각 인덱스 = section_idx)해서 export 시 체인에 그대로 투입한다.

---

## 6. Error Handling

### 6.1 Error Code 카탈로그

프론트 `AppError.code` ↔ 백엔드 `errors.py` ↔ 사용자 문구 1:1 매핑.

| Code | HTTP | 사용자 메시지(한국어) | 복구 |
|---|---|---|---|
| `INVALID_FILE` | 400 | .hwpx 파일만 업로드할 수 있습니다. | 재선택 |
| `FILE_TOO_LARGE` | 413 | 파일이 너무 큽니다(최대 {MAX_UPLOAD_MB}MB). | 재선택 |
| `UNSUPPORTED_FORMAT` | 415 | 이 파일은 열 수 없습니다 (암호화되었거나 손상되었을 수 있음). | 재선택 |
| `CONVERTER_ERROR` | 500 | 문서 변환 중 문제가 생겼습니다. 새로고침 후 다시 시도하거나, 담당자에게 파일을 공유해 주세요. | 새로고침 |
| `INVALID_BLOCKS` | 400 | 저장 형식이 올바르지 않습니다. 페이지를 다시 로드해 주세요. | 새로고침 |
| `UPLOAD_EXPIRED` | 404 | 원본 업로드 세션이 만료되었습니다. 파일을 다시 업로드하거나 단순화 저장을 계속 진행하세요. | 재업로드 또는 진행 |
| `AUTH_ERROR` | 401 | AI 서비스 인증에 실패했습니다. 관리자에게 문의하세요. | 관리자 |
| `RATE_LIMITED` | 429 | 요청이 너무 많습니다. 잠시 후 다시 시도하세요. | 60s 후 재시도 |
| `UPSTREAM_UNAVAILABLE` | 503 | AI 서비스가 응답하지 않습니다. 잠시 후 다시 시도하세요. | 60s 후 재시도 |
| `NETWORK_ERROR` | 502 | 인터넷 연결을 확인해 주세요. | 자동 재시도 (3회) |
| `JSON_PARSE_FAILED` | 502 | AI 응답을 이해하지 못했습니다. 다시 시도하거나 요청을 단순화해 주세요. | 재전송 |

### 6.2 Error Response Shape

```json
{
  "error": {
    "code": "INVALID_FILE",
    "message": ".hwpx 파일만 업로드할 수 있습니다.",
    "detail": "extension=.docx",
    "recoverable": true
  }
}
```

### 6.3 Frontend Error Surfacing

- **업로드/저장 오류**: `<ToastHost>` 우측 상단 토스트 (INTERACTION_SPEC §10 연장)
- **Claude 오류**: 기존 프로토타입의 assistant 에러 버블(rose 색상) 재사용
- **네트워크**: 토스트 + 자동 재시도 카운터

---

## 7. Security Considerations

- [x] **API 키 대신 OAuth 세션 격리** (M2): 서버는 `ANTHROPIC_API_KEY`를 저장·로드·주입하지 않는다. 대신 호스트의 `claude` CLI OAuth 세션(`~/.claude/`)을 상속하며, subprocess env에서 `ANTHROPIC_API_KEY`가 존재하면 명시적으로 strip. 번들 grep 체크는 여전히 negative check로 유지.
- [x] **OAuth 세션 파일 보호**: `~/.claude/` 권한 0600, 컨테이너에서는 secret-mount(read-only)로 전달. 멀티 인스턴스 배포는 v1.5+에 sticky-session 또는 per-user OAuth 전략으로 확장.
- [x] **시스템 프롬프트 유출 방지**: 클라이언트는 `system: 'doc_editor' | 'inline_editor'` 식별자만 보냄. 실제 프롬프트 문자열은 `prompts.py`에만 존재.
- [x] **업로드 검증**: 확장자 화이트리스트(`.hwpx`), MIME 화이트리스트, magic bytes(ZIP `PK\x03\x04`), 크기 제한. 서버는 클라이언트 신뢰 안 함 → 서버측 모든 검증 재실행.
- [x] **CORS allowlist**: `CORS_ALLOWED_ORIGINS` env. 와일드카드(`*`) 금지.
- [x] **CSP**: `default-src 'self'; connect-src 'self'` + dev 모드 Vite HMR 예외. 인라인 스크립트 금지.
- [x] **Rate limit**: 백엔드 per-IP `/api/claude/*` 초당 2회, 분당 30회 (slowapi). v1.5+ per-session.
- [x] **파일 경로 traversal 방지**: 저장 파일명은 서버에서 재생성(`uuid + .hwpx`), 사용자 입력 사용 금지.
- [x] **HTTPS enforcement**: docker-compose는 HTTP로 내부 통신, 외부 노출은 reverse proxy(Traefik/Nginx) + Let's Encrypt 권장(문서에 예시). 로컬 개발은 예외.
- [x] **민감 로그 마스킹**: Anthropic API 키, 업로드 파일 내용 바이트는 로그에 절대 포함 금지. structlog processor로 강제.
- [x] **ReDoS**: 검색 입력은 정규식이 아닌 문자열 `indexOf` 기반. 정규식 옵션은 v1.5+.
- [ ] **OWASP Top 10 점검**: v1.0 출시 전 `security-architect` 에이전트로 리뷰.

---

## 8. Delta PRs to Source-of-Truth Docs

이 사이클에서 정본 3개 문서에 **추가**될 항목. 실제 PR은 구현 단계에서 한 번에 작성.

### 8.1 `docs/DESIGN_SPEC.md` §8 컴포넌트 시각 명세 추가

| 컴포넌트 | 시각 요약 | 토큰 |
|---|---|---|
| `FileUploader (dropzone)` | 64px padding, `border-dashed` 2px, 활성 drag-over 시 `accent` 색 테두리 + 내부 `bgMuted`. 플레이스홀더: 아이콘 `Upload` 32px + "hwpx 파일을 여기에 놓거나 클릭" | `border`, `accent`, `bgMuted`, `text`, `textSubtle` |
| `UploadBanner` (진행중) | 상단 고정 40px, 프로그래스바 + 파일명, 완료 시 1s 후 fade | `bgSubtle`, `accent`, `textStrong` |
| `SearchPanel` | 좌측 또는 우측 floating 360px, 입력창 + 결과 리스트 | `bgPanel`, `border`, `text` |
| `SearchHit` 아이템 | 매치 문자열은 `bg-amber-400/30` 하이라이트(다크)/`bg-amber-200`(라이트), 페이지·섹션 메타 라벨 | `textMuted`, `textSubtle` |
| `ExportMenu` | Dock 또는 헤더 드롭다운: HWPX / PDF 항목 | dock bg + `hover` |
| `ToastHost` | 우측 상단, 360px wide, 슬라이드-인 200ms. 에러: `rose`, 정보: `accent`, 성공: `emerald` | 추가 토큰 `toastError`, `toastSuccess`, `toastInfo` |
| `InlineHighlight` (검색) | 본문 내 매치 부분: `<mark>` 대체 span, 배경 amber | — |

### 8.2 `docs/INTERACTION_SPEC.md` 추가 인터랙션

새 §13~§17 추가:

- **§13 파일 업로드/다운로드**
  - 헤더 좌측 "파일" 또는 Command+O: 파일 피커 오픈
  - Canvas 전체에 드래그 시 `FileUploader` 오버레이 활성, drop 시 업로드 시작
  - 업로드 중 편집 잠금, 완료 시 currentPage=1 + flashSections(전체)
  - `Command+S`(mac) / `Ctrl+S`(win): `/api/export` → 브라우저 다운로드
- **§14 검색**
  - `Command+K`: SearchPanel 토글
  - 입력창에 실시간 쿼리(debounce 150ms), 최소 2자
  - 결과 클릭 → 해당 페이지로 `scrollIntoView` + 블록 flash 1s + 매치 하이라이트 유지
  - `Esc`: 패널 닫기 + 하이라이트 제거
  - 결과 이동 키보드: `↓`/`↑`, `Enter`로 점프
- **§15 Export**
  - ExportMenu: HWPX(기본), PDF(print stylesheet로 `window.print()`)
  - PDF 모드에서는 편집 하이라이트 제거, 사이드바·dock·채팅 숨김 (print CSS)
- **§16 에러 복구**
  - `UPLOAD_EXPIRED`: 모달 "원본 업로드 세션이 만료되었습니다. 1) 재업로드 2) 단순화 저장 진행 3) 취소"
  - 네트워크 오류: 자동 재시도 3회, 실패 시 토스트 + 수동 재시도 버튼
- **§17 PDCA 안전장치 (프로토타입 유지 재확인)**
  - 편집 후 history에 기록되기 전에는 다운로드 버튼 비활성 (저장 가능한 일관된 state 보장)
  - 스트리밍 중 업로드/저장 시도하면 "AI 응답 완료 후 시도" 토스트

### 8.3 `docs/COMPONENT_INVENTORY.md` 추가 컴포넌트/모듈

| 신규 | 레이어 | 위치 | 주요 Props | 의존 |
|---|---|---|---|---|
| `FileUploader` | Presentation | `components/io/FileUploader.tsx` | `onFile(file)`, `accept`, `t`, `theme` | — |
| `UploadBanner` | Presentation | `components/io/UploadBanner.tsx` | `state`, `progress`, `fileName`, `t`, `theme` | store.io |
| `SearchPanel` | Presentation | `components/search/SearchPanel.tsx` | `open`, `onClose`, `t`, `theme` | store.search |
| `SearchHitList` | Presentation | `components/search/SearchHitList.tsx` | `hits`, `activeIdx`, `onJump` | — |
| `InlineHighlight` | Presentation | `components/canvas/InlineHighlight.tsx` | `text`, `ranges`, `t` | — |
| `ExportMenu` | Presentation | `components/layout/ExportMenu.tsx` | `onExportHwpx`, `onExportPdf`, `t`, `theme` | — |
| `ToastHost` + `Toast` | Presentation | `components/feedback/Toast*.tsx` | `toasts`, 내부 timer | store.ui |
| `useDropzone` | Hook | `hooks/useDropzone.ts` | — | — |
| `useSearch` | Hook | `hooks/useSearch.ts` | — | store |
| `useExport` | Hook | `hooks/useExport.ts` | — | api/hwpx.ts |
| `api/hwpx.ts` | Infrastructure | `api/hwpx.ts` | — | types |
| `state/store.ts` | Application | `state/store.ts` | — | types, lib, api |

---

## 9. Clean Architecture

### 9.1 Layer Structure

| Layer | 책임 | 위치 |
|---|---|---|
| **Domain** | 순수 타입, 순수 함수 (diff, extractJson) | `apps/web/src/types/`, `apps/web/src/lib/` |
| **Application** | 스토어·훅·유스케이스 (useStreamChat 등) | `apps/web/src/state/`, `apps/web/src/hooks/` |
| **Presentation** | 컴포넌트, 뷰, 테마 | `apps/web/src/components/`, `apps/web/src/theme/` |
| **Infrastructure** | HTTP 클라이언트, SSE 파서 | `apps/web/src/api/` |
| **Backend — Routes** | FastAPI 라우터, 요청 검증 | `apps/backend/.../routes/` |
| **Backend — Services** | 비즈니스 로직, 외부 API 호출 | `apps/backend/.../services/`, `converter/` |
| **Backend — Infrastructure** | pyhwpxlib, httpx, config | `apps/backend/.../security/`, `config.py` |

### 9.2 Dependency Rule

```
Presentation → Application → Domain ← Infrastructure
                     ↓
              Infrastructure (http only)
```

### 9.3 Import 화이트리스트 (ESLint boundaries)

| From | Can import | Cannot import |
|---|---|---|
| Presentation | Application, Domain, Infrastructure(api) | 다른 Presentation 모듈의 내부 |
| Application | Domain, Infrastructure | Presentation |
| Domain | — | 모두 |
| Infrastructure | Domain | Presentation, Application |

---

## 10. Coding Convention Reference

> 정식 정본은 `docs/01-plan/conventions.md`(신규 작성 예정). 여기서는 이 Design이 전제하는 핵심 규칙만.

### 10.1 Naming

- React 컴포넌트/파일: `PascalCase.tsx`
- Hook: `useCamelCase.ts`
- 라이브러리 함수: `camelCase.ts`
- 타입/인터페이스: `PascalCase`
- 상수: `UPPER_SNAKE_CASE`
- CSS 변수(테마 토큰): `--bg`, `--text-strong`, …

### 10.2 Import 순서

```ts
// 1) React/외부
// 2) @/types
// 3) @/lib
// 4) @/api
// 5) @/state, @/hooks
// 6) @/components
// 7) 상대 경로
// 8) 타입 전용 import (`import type`)
// 9) 스타일
```

### 10.3 Env 변수 prefix

| Prefix | Scope |
|---|---|
| `VITE_` | 클라이언트 빌드타임 노출(non-secret만) |
| `CLAUDE_`, `CORS_`, `MAX_`, `LOG_`, `STREAM_`, `ONCE_` | 백엔드 전용 (클라이언트 접근 불가). M2 전환으로 `ANTHROPIC_` prefix는 사용하지 않는다. |

### 10.4 이 Feature의 컨벤션 적용

| Item | 규칙 |
|---|---|
| 컴포넌트 Props | `t: Theme`, `theme: 'dark' \| 'light'` 필수. 콜백으로만 상태 변경. |
| 상태 변경 | Zustand 액션 경유. `setPages` 직접 수정 금지. |
| 에러 처리 | `AppError` 사용, 토스트 표시 강제. silent catch 금지. |
| 테스트 ID | UT/CT/E2E는 `TEST_SPEC.md` 넘버링 연장. 새 시나리오는 §11 참조. |

---

## 11. Test Plan

> 기존 `docs/TEST_SPEC.md` 연장. 신규 ID만 여기 명시.

### 11.1 신규 Unit

| ID | 대상 | 시나리오 |
|---|---|---|
| UT-60 | `owpml_to_blocks` (py) | 10종 fixture round-trip 시맨틱 동등 |
| UT-61 | `blocks_to_owpml` (py) | 편집되지 않은 블록은 passthrough 경유, 편집된 블록은 재생성 |
| UT-62 | `passthrough.py` | 섹션 내 블록 배열이 동일하면 passthrough 순서 완벽 복원 |
| UT-63 | `upload_validate.py` | 확장자/MIME/magic bytes 매트릭스 (정상 1, 이상 7 케이스) |
| UT-64 | `api/hwpx.ts` | `importHwpx`/`exportHwpx` fetch error → AppError 매핑 |
| UT-65 | `search` | 부분 일치, 대소문자, 표 셀 포함 검색 |
| UT-66 | `runSearch` | 결과 정렬(페이지·블록 순), debounce |

### 11.2 신규 Component

| ID | 대상 | 시나리오 |
|---|---|---|
| CT-50 | `FileUploader` | 드래그오버 시 테두리 변경, drop 시 onFile 호출 |
| CT-51 | `UploadBanner` | state 전환(`idle → uploading → success/error`) 렌더 |
| CT-52 | `SearchPanel` | 입력 → `runSearch` 디스패치, `Enter`로 점프 |
| CT-53 | `ExportMenu` | HWPX 클릭 → `useExport('hwpx')`, PDF 클릭 → print 모드 |
| CT-54 | `ToastHost` | 중첩 토스트 스택, 자동 fade |

### 11.3 신규 E2E

| ID | 시나리오 |
|---|---|
| E2E-30 | 업로드 → 렌더 → 편집 → Download → 재업로드 → 텍스트 일치 |
| E2E-31 | Passthrough: 이미지 포함 문서 로드 → 본문만 편집 → 저장 → 재로드 시 이미지 보존 |
| E2E-32 | `Command+K` 검색 → 결과 클릭 → 점프 + 하이라이트 |
| E2E-33 | 큰 파일(MAX_UPLOAD_MB+1) 업로드 → `FILE_TOO_LARGE` 토스트 |
| E2E-34 | 네트워크 실패(스트리밍 중) → assistant 에러 버블 + 재시도 버튼 |

### 11.4 Round-trip 자동 회귀

- `tests/roundtrip/run.py`: 10종 샘플 load-dump-load → 정규화(공백·주석 제거) 후 시맨틱 비교
- CI에서 매 PR 실행, 한컴오피스 수동 검증은 주 1회 체크리스트

### 11.5 성능 회귀

- Vitest bench: UT-10~15의 `diffTokens` 벤치, 5000자 케이스 100ms 이하 어서션
- Playwright trace: PERF-01, 50페이지 fixture로 스크롤 FPS 55 이상

---

## 12. Build & Deployment

### 12.1 Monorepo Tooling

- pnpm workspace (`pnpm-workspace.yaml`) — `apps/web`, `apps/backend`(참조용 README), `packages/` 확장 여지
- Backend는 `uv` + `pyproject.toml` (workspace와 별개)
- 루트 `Makefile`:
  - `make dev` — concurrently frontend dev + backend uvicorn --reload
  - `make test` — pnpm test + uv run pytest
  - `make build` — Vite build + docker 이미지 빌드
  - `make up` — docker-compose up -d

### 12.2 `docker-compose.yml` 개요

```yaml
services:
  web:
    build: { context: ., dockerfile: Dockerfile.web }
    ports: ["8080:80"]
    depends_on: [backend]
  backend:
    build: { context: ., dockerfile: Dockerfile.backend }
    environment:
      - CLAUDE_CLI_PATH=claude
      - CLAUDE_MODEL=sonnet
      - CORS_ALLOWED_ORIGINS=http://localhost:8080
      - MAX_UPLOAD_MB=20
      - LOG_LEVEL=info
    volumes:
      # OAuth 세션을 호스트에서 read-only로 마운트 (이미지에 포함하지 않음).
      - type: bind
        source: ${CLAUDE_SESSION_DIR:-~/.claude}
        target: /root/.claude
        read_only: true
    healthcheck: { test: ["CMD", "curl", "-f", "http://localhost:8000/healthz"] }
```

**Dockerfile.backend 요건** (M8에서 실체화):
- 베이스 이미지에 Node 20+ 설치 (claude CLI는 Node 기반).
- `claude` CLI 설치: `RUN npm install -g @anthropic-ai/claude-code` (또는 공식 install 스크립트).
- pyhwpxlib 설치.
- OAuth 세션 자체는 이미지에 포함하지 않으며, 위 bind mount로 런타임 주입.

- 외부 Redis는 v1.0에서 옵션(disabled). In-memory LRU로 충분.
- `.env.example`로 필수 변수 노출. `ANTHROPIC_API_KEY`는 정의 안 함.

### 12.3 CI (GitHub Actions)

- `ci.yml`: lint + typecheck + unit + component (Node 20, Python 3.11)
- `e2e.yml`: Playwright cross-browser (Chromium, Firefox, Webkit), matrix
- `roundtrip.yml`: Python roundtrip 회귀
- `security.yml`: `npm audit` + `pip-audit` + secret scan (gitleaks)

---

## 13. Implementation Order

Plan §8의 마일스톤을 **파일 단위 작업**으로 분해. 각 단계는 TEST_SPEC 회귀 녹색을 유지하며 진행.

### M1 Foundation (1~2주)
1. `apps/web` Vite+TS 스캐폴딩, Tailwind, 경로 alias(`@/`)
2. `src/types/index.ts` — COMPONENT_INVENTORY §15 포팅
3. `src/lib/diff/text.ts`, `table.ts`, `src/lib/json.ts` + Vitest UT-01~54
4. `src/theme/tokens.ts` — `THEMES`를 CSS 변수로 승격(다크/라이트 둘 다)
5. Vitest + Playwright 기본 설정, CT-01(초기 렌더)까지 녹색

### M2 Backend bootstrap (1주) — ✅ 완료
6. `apps/backend` 스캐폴딩 (uv, FastAPI, pydantic-settings, structlog)
7. `/healthz`, `/readyz` (readyz는 `claude --version` 실행 가능 체크)
8. `/api/claude/stream` + `/once` — 프로토타입 system prompt 이식 + **`claude -p` subprocess + OAuth** (M2 결정). stream-json → Anthropic SSE relay.
9. 프론트 `src/api/claude.ts` 교체 — URL만 `/api/claude/stream`·`/once`로 변경, 기존 파서 유지
9.1. `config.py` / `.env.example`: `ANTHROPIC_API_KEY` 계열 제거, `CLAUDE_CLI_PATH`·`CLAUDE_MODEL` 신설

### M3 HWPX round-trip (2~3주)
10. pyhwpxlib 기본 load/dump 감싸는 `converter/__init__.py`
11. `converter/owpml_to_blocks.py` — h1/h2/lead/p/table 매핑
12. `converter/passthrough.py` — unknown 노드 저장/복원
13. `converter/blocks_to_owpml.py`
14. `/api/import`, `/api/export`, `upload_store.py`
15. `tests/roundtrip/` 10종 샘플 수집 + 자동 회귀 스크립트

### M4 UX wiring (1주)
16. `src/state/store.ts` 7 슬라이스 구성 + immer
17. `App.tsx`에서 기존 17개 useState를 스토어 호출로 교체 (점진적 — 슬라이스별 PR)
18. `src/api/hwpx.ts` + `FileUploader`, `UploadBanner`, `useDropzone`, `ExportMenu`, `useExport`
19. `ToastHost` + `useToast`

### M5 Search (1주)
20. `search` 슬라이스 + `useSearch` 훅
21. `SearchPanel`, `SearchHitList`, `InlineHighlight`
22. `Command+K` 바인딩, E2E-32

### M6 Export PDF (0.5주)
23. `print.css` — 사이드바·dock·채팅 숨김, 편집 하이라이트 제거
24. `ExportMenu > PDF` → `window.print()`

### M7 History 완성 (0.5주)
25. HistoryPanel 미완 액션(페이지 점프, 필터) 마무리
26. CT-21~24 녹색화

### M8 Hardening (1주)
27. `security-architect` 리뷰 체크리스트 + slowapi rate limiter를 `/api/claude/*`에 실 부착
28. 접근성 점검(axe-core) + 키보드 내비 검증
29. 번들 사이즈 측정, 350KB gz 이하 확인
30. **`docker-compose.yml` + `Dockerfile.web` + `Dockerfile.backend` 실물 작성** — backend 이미지에 Node 20+ 및 `claude` CLI 설치, `~/.claude` read-only bind mount 설정, `docker compose up -d` 후 `/healthz` 200 확인
31. 정본 3문서 델타 PR(§8) — DESIGN_SPEC §8.1 / INTERACTION_SPEC §13~§17 / COMPONENT_INVENTORY 12개 엔트리 + `CoverPage.id` 리터럴 + `DocumentMeta`·`SearchHit`·`AppError`·`ErrorCode` 4 타입 추가
32. **CLAUDE.md §2 Artifacts 제약 재분류** — "localStorage 금지"·"외부 CDN 금지"·"HWPX XML 직접 파싱 금지"는 유지. "임의 Tailwind 클래스 금지"는 `bg-[var(--..)]` 허용으로 치환. "API 키 하드코딩 금지"는 OAuth 전환 맥락 주석 추가. CLAUDE.md §1 "현재 단계" 문구도 MVP 상태로 갱신.
33. `docs/01-plan/conventions.md` 초안
34. `claude --version` 허용 범위 체크를 `/readyz`에 추가하고, `stream_event.event`가 Anthropic SSE와 어긋나면 감지하는 smoke 테스트 1건 추가
35. `/pdca analyze hwpx-viewer-mvp`

---

## 14. Open Questions

### 확정 (M2까지 합의 완료)

- ✅ **Monorepo 도구**: pnpm workspace only
- ✅ **v1.0 Auth**: Origin allowlist + slowapi rate limit (M8에 부착)
- ✅ **LLM Bridge**: `claude -p` subprocess + 호스트 OAuth 세션 (API 키 저장 안 함)
- ✅ **업로드 세션 저장소**: v1.0 in-memory LRU, v1.5에 Redis 옵션
- ✅ **PDF Export**: 브라우저 `window.print()` (v1.5에 서버 Chromium 옵션)
- ✅ **Passthrough 실패 UX**: 인라인 배너 + "자세히" 링크

### 남은 결정

1. **`CLAUDE_MODEL` 식별자 형식** — claude CLI는 alias(`sonnet`/`opus`/`haiku`)와 full slug(`claude-sonnet-4-6`) 양쪽 수용. 문서·env에 어느 쪽을 정본으로 둘지. (현 기본값: `sonnet` alias. 운영팀이 특정 버전 고정 필요하면 full slug로 override 가능)
2. **Opus/Haiku UI 선택기** — 여전히 v1.5로 미룸. 단, 환경변수로 팀 기본값 운영은 M2에서 가능.
3. **Claude CLI 업그레이드 정책** — `claude --version` pin vs floating. floating이면 stream-json 포맷 회귀 감지 smoke가 필수(M8 #34에 배정).
4. **컨테이너 OAuth 전달** — read-only bind mount vs Docker secret vs per-container `claude auth`. (현 제안: bind mount — 가장 단순. 엔터프라이즈 배포는 secret 선호)

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-04-22 | Initial Design — 서비스 토폴로지, 데이터 플로우, FastAPI 엔드포인트 4종, OWPML↔Block converter v1.0 매핑, Zustand 7 슬라이스, 에러 카탈로그, 정본 델타(3문서), M1~M8 파일 단위 구현 순서, Open Questions 6건 | ratiertm@gmail.com |
| 0.2 | 2026-04-23 | **M2 LLM Bridge 전환 반영** — Anthropic API 직접 호출 → `claude -p` subprocess + OAuth. §2.1 토폴로지 다이어그램·§2.2 B flow·§2.3 dependencies·§4.1 엔드포인트 Status 컬럼·§4.2 stream 서버처리·§4.3 레이어트리·§7 보안 체크리스트·§12.2 compose env + Dockerfile 요건 전체 갱신. Open Questions 재정리(6→4). §6.1 NETWORK_ERROR/JSON_PARSE_FAILED HTTP 502 명시. §13 M8에 docker-compose 실물 작성 스텝(#30) + CLI 업그레이드 smoke(#33) 추가. §3.2 Zustand 헤더에 M4 도입 태그. | ratiertm@gmail.com |
