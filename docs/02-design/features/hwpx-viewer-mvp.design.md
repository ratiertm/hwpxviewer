---
template: design
version: 0.3
---

# hwpx-viewer-mvp Design Document

> **Summary**: 프로토타입 단일 파일 `hwpx-viewer-v8.jsx`를 `apps/web`(Vite+React+TS) + `apps/backend`(FastAPI + rhwp WASM + claude CLI) 모노레포로 이관. **v0.3에서 문서 모델을 시맨틱 Block(h1/h2/lead/p/table)에서 Run 좌표(sec, para, charOffset)로 전환**. 렌더링은 rhwp WASM이 생성하는 한컴 수준 SVG를 사용하고, 편집은 rhwp의 `hitTest` / `insertText` / `deleteText` API로 run 단위 정밀 치환.
>
> **Project**: HWPX Viewer (`hwpx-viewer`)
> **Version**: 0.8 → 1.0.0 (MVP)
> **Author**: ratiertm@gmail.com / MindBuild
> **Date**: 2026-04-24
> **Status**: Draft v0.3
> **Planning Doc**: [hwpx-viewer-mvp.plan.md](../../01-plan/features/hwpx-viewer-mvp.plan.md)
> **Previous**: [hwpx-viewer-mvp.design.v0.2.archive.md](./hwpx-viewer-mvp.design.v0.2.archive.md)

### 정본 참조

| 목적 | 문서 | 역할 |
|---|---|---|
| 운영 매뉴얼 | `CLAUDE.md` | NEVER/ALWAYS 규칙 |
| 제품 요구사항 | `docs/PRD.md` | 4가지 목적·P0 user stories (v0.3 편집 단위만 Block → Run) |
| 코드 구조·상태 | `docs/ARCHITECTURE.md` | §2.2 Block → RunLocation 교체 예정 (M8 #31) |
| 컴포넌트 목록 | `docs/COMPONENT_INVENTORY.md` | §15 타입 정의 재작성 예정 (M8 #31) |
| 시각 디자인 | `docs/DESIGN_SPEC.md` | §8에 SvgViewer/SelectionOverlay 신규 스펙 추가 |
| 인터랙션 | `docs/INTERACTION_SPEC.md` | EDIT-02~05, NAV-04 재작성 |
| 테스트 | `docs/TEST_SPEC.md` | CT-10~15, E2E-30 재작성 |
| Do 가이드 | `docs/02-design/features/hwpx-viewer-mvp.do.md` v0.2 | M3R~M7R 체크리스트 |

---

## 1. Overview

### 1.1 Goals (사용자 확정)

1. **한컴 미리보기 수준 렌더링** — 이미지·도형·폰트·여백·표 레이아웃을 한컴오피스와 동일하게 표시.
2. **텍스트 선택/드래그 편집** — 그림이 아닌 실제 텍스트로 부분 선택해 편집 트리거.
3. **편집 이력 기록/복원** — 모든 변경은 이력에 남고 undone 토글로 복원.
4. **AI 자동 편집** — 선택 영역 → Claude → cherry-pick 부분 수락 → 적용.

### 1.2 Principles

- **rhwp가 렌더링의 진실** — SVG 생성은 rhwp WASM에 위임. 우리가 별도로 문자·표·이미지 레이아웃 하지 않는다.
- **Run 좌표가 편집의 진실** — 모든 편집은 `{sec, para, charOffset}` 기준. Block 시맨틱은 폐기.
- **rhwp가 편집 엔진** — `hitTest` / `insertText` / `deleteText`를 backend에서 프록시. 프론트는 UI/좌표 전달만 담당.
- **History는 text snapshot + location** — undone 토글로 복원 가능.
- **Claude 키 클라이언트 제로 노출** — M2에서 확정한 `claude -p` OAuth 경로 유지.

---

## 2. Architecture

### 2.1 Service Topology

```
┌────────────────────────────────────────────────────────────────────┐
│                       docker-compose network                         │
│  ┌──────────────────┐        ┌─────────────────────────────────┐   │
│  │  web (Nginx)     │        │  backend (FastAPI + uvicorn)     │   │
│  │  apps/web dist   │──────▶ │  /api/upload   /api/download     │   │
│  │  Vite prod build │  HTTP  │  /api/render/{id}/{page}         │   │
│  │  port 8080       │        │  /api/hit-test  /api/selection   │   │
│  │                  │        │  /api/edit      /api/text-range  │   │
│  └──────────────────┘        │  /api/claude/stream  /once       │   │
│         ▲                    │  /healthz  /readyz               │   │
│         │ browser            │  port 8000                       │   │
│         │                    │                                   │   │
│         │                    │  ┌────────────────────────────┐  │   │
│         │                    │  │ rhwp WASM (wasmtime)       │  │   │
│         │                    │  │   engine: singleton        │  │   │
│         │                    │  │   documents: per upload    │  │   │
│         │                    │  │   API: render/hit/edit     │  │   │
│         │                    │  └────────────────────────────┘  │   │
│         │                    │                                   │   │
│         │                    │  ┌────────────────────────────┐  │   │
│         │                    │  │ asyncio subprocess         │  │   │
│         │                    │  │   → spawn `claude -p`      │  │   │
│         │                    │  │      (stream-json)          │  │   │
│         │                    │  └─────────────┬──────────────┘  │   │
│         │                    └────────────────┼─────────────────┘   │
│  ┌──────┴──────────┐                          │                     │
│  │   user Chrome   │            claude child uses host              │
│  └─────────────────┘            OAuth session (~/.claude)           │
│                                          │                           │
│                                          ▼                           │
│                         api.anthropic.com (only external call)       │
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow (핵심 4가지)

**A. Upload & 첫 렌더링**
```
user drop .hwpx
  → POST /api/upload   (multipart/form-data)
      → upload_store.put(uploadId, bytes, ttl=30min)
      → rhwp.load(bytes) → RhwpDocument, keep in session
      → { document: { uploadId, fileName, fileSize, pageCount, version:0 } }
  → Frontend: 모든 페이지 GET /api/render/{uploadId}/{0..N-1}
      → Backend: rhwp.render_page_svg(page, substitute_fonts=True)
      → image/svg+xml text response
  → Frontend: <SvgViewer svg={text} />
```

**B. Selection**
```
사용자가 SVG 텍스트 드래그
  → Frontend: window.getSelection().getBoundingClientRect() — 시작/끝 (x,y)
  → POST /api/hit-test { uploadId, page, x, y } × 2
      → rhwp.hit_test(page, x, y) → { sec, para, charOffset }
  → 두 포인트로 Selection { start: RunLocation, length }
  → POST /api/selection-rects { uploadId, selection }
      → rhwp.get_selection_rects(...) → [{page,x,y,w,h}, ...]
  → Frontend: SelectionOverlay로 하이라이트 박스 그림
  → InlineSelectionMenu (AI 메뉴) 표시
```

**C. Edit (AI 경유)**
```
사용자 "다시 쓰기" 클릭
  → GET /api/text-range → {text} (선택된 원문)
  → POST /api/claude/once { system:'inline_editor', prompt }
      → { text: '<new>' }
  → Frontend: InlineCherryPickDiff UI (프로토타입 재사용, diff 엔진 M1)
  → "적용" 클릭
  → POST /api/edit { uploadId, selection, newText: finalText }
      → rhwp.delete_text + rhwp.insert_text
      → document.version +1
      → affectedPages = [selection.page]
      → { editId, document, affectedPages }
  → Frontend: GET /api/render/{uploadId}/{page}  (v=document.version)
  → SVG 재표시 + history entry 추가 + flashSections
```

**D. Undo/Redo & Download**
```
사용자 history "되돌리기"
  → POST /api/edit { uploadId, selection: entry.selectionAfter, newText: entry.oldText }
      (undone 토글 = 같은 range에 oldText 재삽입)
  → entry.undone = true, version +1
사용자 "Export"
  → GET /api/download/{uploadId} → HWPX bytes (Content-Disposition attachment)
```

### 2.3 Dependencies

| Layer | Depends On | Purpose |
|---|---|---|
| apps/web | apps/backend via HTTP | upload, render, hit-test, edit, claude proxy |
| apps/backend | **rhwp WASM** (wasmtime) + `claude` CLI (OAuth) | 렌더링·편집 엔진 + LLM |
| apps/web 순수 함수 | — | diff/json (M1 완료, 재사용) |
| 외부 | `api.anthropic.com` via claude CLI | 유일한 외부 호출 |

---

## 3. Data Model

### 3.1 Shared Types

**TypeScript** (전문 `apps/web/src/types/index.ts`)

```typescript
// 문서 세션
export interface DocumentInfo {
  uploadId: string;
  fileName: string;
  fileSize: number;
  pageCount: number;
  version: number;  // 편집마다 +1
}

// Run 좌표 = 편집 주소의 기본 단위
export interface RunLocation { sec: number; para: number; charOffset: number; }
export interface Selection { start: RunLocation; length: number; }
export interface SelectionRect { page: number; x: number; y: number; width: number; height: number; }

// 편집 이력
export interface HistoryEntry {
  id: number; ts: number;
  selection: Selection;
  oldText: string; newText: string;
  action: string; undone: boolean;
}

export interface Edit {
  historyId: number;
  selection: Selection;
  oldText: string; newText: string;
}

// 인라인 편집 상태 머신
export type InlineEditing =
  | { selection: Selection; original: string; action: InlineActionId; status: 'loading' }
  | { selection: Selection; original: string; action: InlineActionId; status: 'error'; error: string }
  | { selection: Selection; original: string; suggestion: string; action: InlineActionId; status: 'ready' };

// Chat message (프로토타입 유지)
export interface Message { role; text; content?; edits?; ui?; isError?; }
```

**Pydantic** (backend mirror — `schemas.py`)

```python
class RunLocation(BaseModel):
    sec: int; para: int; charOffset: int

class Selection(BaseModel):
    start: RunLocation
    length: int

class DocumentInfo(BaseModel):
    uploadId: str; fileName: str; fileSize: int
    pageCount: int; version: int = 0

class HitTestRequest(BaseModel):
    uploadId: str; page: int; x: float; y: float

class HitTestResponse(BaseModel):
    location: RunLocation | None

class EditRequest(BaseModel):
    uploadId: str
    selection: Selection
    newText: str

class EditResponse(BaseModel):
    editId: int
    document: DocumentInfo
    affectedPages: list[int]
```

### 3.2 Store (Zustand, M7R)

`apps/web/src/state/store.ts` — 6 슬라이스 (Block 폐기로 기존 7 → 6):

| Slice | 상태 | 액션 |
|---|---|---|
| `document` | `info: DocumentInfo`, `pageSvgs: Map<number,string>`, `currentPage`, `zoom`, `highlightedPages` | `loadDocument`, `setPage`, `setZoom`, `refreshPage`, `flashPages` |
| `selection` | `current: Selection \| null`, `rects: SelectionRect[]` | `setSelection`, `clearSelection` |
| `history` | `entries: HistoryEntry[]` | `recordEdit`, `toggleEdit` |
| `chat` | `messages`, `chatInput`, `isStreaming`, `streamingText`, `showDiff` | `sendMessage`, `clearConversation`, `toggleDiff` |
| `inline` | `editing: InlineEditing \| null` | `startInlineEdit`, `acceptInlineEdit`, `rejectInlineEdit` |
| `ui` | `sidebarOpen`, `chatOpen`, `historyOpen`, `userMenuOpen`, `theme` | 각 토글 |

---

## 4. API Specification

### 4.1 Endpoint List

| Method | Path | Purpose | Milestone |
|--------|------|---------|:--------:|
| POST | `/api/upload` | .hwpx 업로드 → DocumentInfo | M4R |
| GET | `/api/download/{uploadId}` | 현재 버전 .hwpx 반환 | M4R |
| GET | `/api/render/{uploadId}/{page}` | rhwp SVG 문자열 | M3R |
| POST | `/api/hit-test` | (x,y) → RunLocation | M5R |
| POST | `/api/selection-rects` | Selection → pixel rects | M5R |
| POST | `/api/text-range` | Selection → text | M5R |
| POST | `/api/edit` | Selection + newText → 편집 적용 | M6R |
| POST | `/api/claude/stream` | Claude 스트리밍 (M2 유지) | ✅ M2 |
| POST | `/api/claude/once` | Claude 단발 (M2 유지) | ✅ M2 |
| GET | `/healthz`, `/readyz` | 헬스체크 (M2 유지) | ✅ M2 |

### 4.2 Detailed Specification

#### `POST /api/upload`
- Req: `multipart/form-data`, field `file` (≤ `MAX_UPLOAD_MB` 기본 20MB)
- 검증: 확장자 `.hwpx` + magic bytes (`PK\x03\x04` — ZIP)
- 서버: `upload_store.put()`, `rhwp_wasm.load_document(bytes)` → 세션에 저장
- Res: `{ document: DocumentInfo }`
- 에러: `400 INVALID_FILE`, `413 FILE_TOO_LARGE`, `415 UNSUPPORTED_FORMAT`, `500 CONVERTER_ERROR`

#### `GET /api/render/{uploadId}/{page}`
- Query: 없음. `If-None-Match: {version}` (미래 캐시용)
- 서버: `rhwp_wasm.render_page_svg(page, substitute_fonts=True)` — TTC 폰트 대체 적용(cairosvg 호환 불필요, 브라우저 렌더링)
- Res: `Content-Type: image/svg+xml`, body = SVG 문자열 (~100KB)
- 에러: `404 UPLOAD_EXPIRED`, `416 PAGE_OUT_OF_RANGE`, `500 RENDER_ERROR`

#### `POST /api/hit-test`
- Req: `{ uploadId, page, x, y }`
- 서버: `rhwp_wasm.hit_test(page, x, y)` → `{sec, para, charOffset}` 또는 `null`
- Res: `{ location: RunLocation | null }`
- 사용: 드래그 시작/끝 두 점을 각각 hit-test 하여 Selection 범위 확정

#### `POST /api/selection-rects`
- Req: `{ uploadId, selection: Selection }`
- 서버: `rhwp_wasm.get_selection_rects(sec, startPara, startOff, endPara, endOff)` → `[{page,x,y,width,height}, ...]`
- Res: `{ rects: SelectionRect[] }`
- 사용: 오버레이 하이라이트 박스 그리기

#### `POST /api/text-range`
- Req: `{ uploadId, selection }`
- 서버: `rhwp_wasm.get_text_range(...)` → `str`
- Res: `{ text: string }`
- 사용: AI 편집 전 원문 획득

#### `POST /api/edit`
- Req: `{ uploadId, selection, newText }`
- 서버:
  1. `oldText = rhwp.get_text_range(selection)` (undo용)
  2. `rhwp.delete_text(selection.start.sec, start.para, start.charOffset, selection.length)`
  3. `rhwp.insert_text(selection.start.sec, start.para, start.charOffset, newText)`
  4. `document.version += 1`
  5. upload_store에 rhwp 세션 갱신
- Res: `{ editId, document, affectedPages }`
- 에러: `404 UPLOAD_EXPIRED`, `409 VERSION_CONFLICT`, `500 EDIT_ERROR`

#### `GET /api/download/{uploadId}`
- 서버: `rhwp_wasm.save_bytes()` (편집된 HWPX 바이트 반환)
- Res: `Content-Type: application/vnd.hancom.hwpx`, `Content-Disposition: attachment; filename="편집본.hwpx"`

### 4.3 Backend Layer Structure

```
apps/backend/src/hwpx_viewer_api/
├── main.py                 # FastAPI 앱 (M2 유지 + 신규 라우터 추가)
├── config.py               # settings (CLAUDE_CLI_PATH, RHWP_WASM_PATH 등)
├── schemas.py              # Pydantic 모델 (§3.1)
├── errors.py               # AppError 카탈로그 (§6)
├── prompts.py              # SYSTEM_DOC_EDITOR, SYSTEM_INLINE_EDITOR (M2)
├── routes/
│   ├── health.py           # /healthz, /readyz (M2)
│   ├── claude.py           # /api/claude/stream, /once (M2)
│   ├── upload.py           # POST /api/upload                    (M4R 신규)
│   ├── download.py         # GET /api/download/{id}              (M4R 신규)
│   ├── render.py           # GET /api/render/{id}/{page}         (M3R 신규)
│   ├── hit_test.py         # POST /api/hit-test, /selection-rects, /text-range (M5R 신규)
│   └── edit.py             # POST /api/edit                      (M6R 신규)
├── services/
│   ├── claude_cli.py       # asyncio subprocess → claude -p (M2)
│   ├── upload_store.py     # in-memory LRU (M2 유지)
│   └── rhwp_wasm.py        # wasmtime 래퍼 — 핵심             (M3R 신규)
└── security/
    ├── cors.py             # allowlist (M2)
    └── upload_validate.py  # magic bytes / MIME / size         (M4R 신규)
```

---

## 5. rhwp WASM Integration

### 5.1 rhwp_wasm.py (신규)

`pyhwpxlib.rhwp_bridge` 패턴을 복사해 HwpxViewer backend에 내장. 필요한 WASM export 함수들을 모두 노출.

**제공 메서드**:
- `RhwpWasmService.load_document(bytes) → DocumentSession` — 문서 로드 (pageCount 포함)
- `session.render_page_svg(page, substitute_fonts=True) → str` — 페이지 SVG
- `session.hit_test(page, x, y) → Optional[RunLocation]` — 히트 테스트
- `session.get_selection_rects(sec, startPara, startOff, endPara, endOff) → list[Rect]`
- `session.get_text_range(...) → str`
- `session.insert_text(sec, para, offset, text) → dict` — 실제 편집
- `session.delete_text(sec, para, offset, count) → dict`
- `session.save_bytes() → bytes` — 편집된 HWPX 직렬화
- `session.close()`

**WASM 바이너리 획득**:
- `pyhwpxlib/vendor/rhwp_bg.wasm` 파일 (pyhwpxlib 패키지에 번들)
- 또는 env `RHWP_WASM_PATH` 로 지정
- backend pyproject.toml에 `pyhwpxlib[preview]` 의존성 추가 → WASM만 참조

**단일 Engine·다중 Session**:
- `RhwpEngine`은 앱 시작 시 1회 로드 (wasmtime instantiate)
- 업로드마다 Document 핸들 생성, `upload_store`가 보관
- TTL 만료 시 `document.close()` + 메모리 해제

### 5.2 HWPX Fonts

- backend Docker 이미지에 **Korean fonts 포함 필수**: Noto Sans KR, Noto Serif KR, Apple SD Gothic Neo (macOS), Malgun Gothic (Windows)
- `substitute_fonts=True` 옵션으로 SVG의 `font-family`를 설치된 폰트로 대체 → 브라우저 일관 렌더

### 5.3 Edit Concurrency

v1.0 single-user. 동시 편집 요청은 `asyncio.Lock` per uploadId로 직렬화. 멀티유저는 v2.0 (Yjs 기반).

---

## 6. Error Handling

### 6.1 Error Code Catalog

| Code | HTTP | 사용자 메시지 |
|---|---|---|
| `INVALID_FILE` | 400 | .hwpx 파일만 업로드할 수 있습니다. |
| `FILE_TOO_LARGE` | 413 | 파일이 너무 큽니다(최대 {MAX}MB). |
| `UNSUPPORTED_FORMAT` | 415 | 이 파일은 열 수 없습니다. |
| `CONVERTER_ERROR` | 500 | 문서 변환 중 문제가 생겼습니다. |
| `UPLOAD_EXPIRED` | 404 | 업로드 세션이 만료되었습니다. 다시 업로드해 주세요. |
| `PAGE_OUT_OF_RANGE` | 416 | 페이지 범위를 벗어났습니다. |
| `RENDER_ERROR` | 500 | 페이지 렌더링에 실패했습니다. |
| `EDIT_ERROR` | 500 | 편집 적용에 실패했습니다. |
| `VERSION_CONFLICT` | 409 | 다른 편집이 먼저 적용되었습니다. 새로고침 후 재시도. |
| `AUTH_ERROR` | 401 | AI 서비스 인증에 실패했습니다. |
| `RATE_LIMITED` | 429 | 요청이 너무 많습니다. 잠시 후 다시 시도. |
| `UPSTREAM_UNAVAILABLE` | 503 | AI 서비스가 응답하지 않습니다. |

### 6.2 Error Response

```json
{ "error": { "code": "UPLOAD_EXPIRED", "message": "업로드 세션이 만료되었습니다.", "recoverable": true } }
```

---

## 7. Security Considerations

- [x] **API 키 대신 OAuth** (M2): claude CLI 의 `~/.claude/` 세션만 사용. `ANTHROPIC_API_KEY` 미사용.
- [x] **시스템 프롬프트 서버측 보관** (M2): `prompts.py`.
- [ ] **업로드 검증**: 확장자·MIME·magic bytes(`PK\x03\x04`)·크기 (M4R `upload_validate.py`).
- [x] **CORS allowlist** (M2).
- [ ] **CSP**: `default-src 'self'; connect-src 'self'`, 인라인 스크립트 금지.
- [ ] **Rate limit**: per-IP `/api/claude/*`, `/api/edit` (slowapi, M8).
- [ ] **Secret 로깅 금지**: structlog processor에서 CLI 환경변수·요청 본문 토큰 마스킹.
- [ ] **WASM sandbox**: wasmtime fuel 제한으로 무한 루프 방지 (M8).

---

## 8. Delta PRs to Source-of-Truth Docs

M8 #31에서 정본 문서들을 v0.3과 동기화.

### 8.1 DESIGN_SPEC.md §8에 추가
| 컴포넌트 | 시각 요약 |
|---|---|
| `SvgViewer` | `flex-1 overflow-auto`, 페이지별 `<div class="page">` + `<svg>` 내장, zoom은 `transform: scale()` |
| `SelectionOverlay` | `absolute inset-0 pointer-events-none`, `<div>` 박스 per `SelectionRect`, 인디고 20% 배경 |
| `FileUploader` | 64px dashed border, drag-over 시 `accent` ring |
| `UploadBanner` | 상단 고정 40px, progress bar |
| `EditBadge` | run 좌표 near inline edits, indigo dot + mini badge |
| `DownloadMenu` | 헤더 primary button "저장" |

### 8.2 INTERACTION_SPEC.md 개정
- **NAV-04 파일 업로드 / Export** 신설
- **EDIT-02~05** 재작성: Block/pageId/blockIdx → Selection/RunLocation
- **HIST-02** undo 흐름에 `/api/edit` reverse path 명시

### 8.3 COMPONENT_INVENTORY.md 개정
- §1 파일 트리: `components/canvas/Block.tsx` 제거, `components/viewer/SvgViewer.tsx`, `SelectionOverlay.tsx`, `components/io/FileUploader.tsx`, `components/io/DownloadMenu.tsx` 추가
- §15 타입 정의: 전면 교체 (Block family → Run 좌표 모델)
- §17 우선순위: P0 (SvgViewer + 선택·편집 파이프라인) → P1 (UploadBanner, DownloadMenu) → P2 (검색)

---

## 9. Clean Architecture

| Layer | 책임 | 위치 |
|---|---|---|
| Domain | 순수 타입·함수 (diff, extractJson, RunLocation) | `apps/web/src/types/`, `apps/web/src/lib/` |
| Application | 스토어·훅 (useDocument, useSelection, useStreamChat) | `apps/web/src/state/`, `apps/web/src/hooks/` |
| Presentation | 컴포넌트·테마 | `apps/web/src/components/`, `apps/web/src/theme/` |
| Infrastructure | HTTP 클라이언트, SSE 파서 | `apps/web/src/api/` |
| Backend Routes | FastAPI 라우터, 요청 검증 | `apps/backend/.../routes/` |
| Backend Services | 비즈니스 로직·외부 엔진 호출 | `apps/backend/.../services/` (`rhwp_wasm.py`, `claude_cli.py`) |
| Backend Infra | config, security | `apps/backend/.../security/`, `config.py` |

---

## 10. Coding Convention Reference

§10.1~10.3은 v0.2와 동일. §10.4만 재작성:

### 10.4 Feature Convention
| Item | 규칙 |
|---|---|
| 컴포넌트 Props | `t: Theme`, `theme: ThemeName` 필수 |
| 상태 변경 | Zustand 액션만 |
| 편집 트리거 | `useEditor().apply(selection, newText)` (내부가 `/api/edit` 호출 + history 기록) |
| 에러 처리 | `AppError` + toast |
| rhwp 호출 | 프론트에서 직접 금지. 반드시 `/api/*` 경유 |

---

## 11. Test Plan

### 11.1 신규 Unit (backend)
| ID | 대상 | 시나리오 |
|---|---|---|
| UT-B01 | `rhwp_wasm.load_document` | 9페이지 HWPX → pageCount=9 |
| UT-B02 | `rhwp_wasm.render_page_svg` | 각 페이지별 SVG 문자열 ≥ 1KB |
| UT-B03 | `rhwp_wasm.hit_test` | 본문 중앙 좌표 → 유효 RunLocation |
| UT-B04 | `rhwp_wasm.hit_test` 경계 | 마진 밖 좌표 → None |
| UT-B05 | `rhwp_wasm.edit` | insert+delete → `get_text_range`로 반영 확인 |
| UT-B06 | `rhwp_wasm.save_bytes` | 편집 후 save → 재로드 → 동일 텍스트 |

### 11.2 신규 Component (frontend)
| ID | 대상 | 시나리오 |
|---|---|---|
| CT-60 | `SvgViewer` | SVG 문자열 prop → `dangerouslySetInnerHTML` 렌더 |
| CT-61 | `SelectionOverlay` | rects prop → 박스 N개 렌더 |
| CT-62 | `FileUploader` | drop 이벤트 → `onFile(File)` 호출 |
| CT-63 | `useSelection` | 드래그 → `/api/hit-test` 2회 → Selection 확정 |

### 11.3 신규 E2E
| ID | 시나리오 |
|---|---|
| E2E-30 | 업로드 → 렌더 → 선택 → AI 편집 → 적용 → 다운로드 → 재업로드 → 편집된 텍스트 확인 |
| E2E-31 | 업로드 → 선택 → "되돌리기" → 원문 복원 |
| E2E-32 | 페이지 네비게이션: 1 → N → 1 스크롤 시 currentPage 추적 |

### 11.4 Performance
- PERF-01: 20페이지 문서 렌더 완료 ≤ 2s (병렬 요청)
- PERF-02: hit-test 단건 ≤ 50ms
- PERF-03: edit 후 단일 페이지 재렌더 ≤ 300ms
- PERF-04: 50번 연속 편집 후 메모리 증가 ≤ 100MB

---

## 12. Build & Deployment

### 12.1 Monorepo
- pnpm workspace + uv (변경 없음)
- 루트 Makefile: `make dev / test / build / up / down / lint` (변경 없음)

### 12.2 Dockerfile.backend 필수 항목 (M8 #30)
```dockerfile
FROM python:3.11-slim
# 1) 한글 폰트 (rhwp SVG substitute_fonts 타깃)
RUN apt-get update && apt-get install -y fonts-noto-cjk fonts-noto-cjk-extra
# 2) uv + 의존성
COPY apps/backend/pyproject.toml apps/backend/uv.lock .
RUN uv sync --frozen
# 3) rhwp WASM (pyhwpxlib[preview] 에 번들)
# 4) claude CLI (Node 20+)
RUN apt-get install -y nodejs npm && npm install -g @anthropic-ai/claude-code
# 5) ~/.claude는 런타임 bind mount
```

### 12.3 CI
- `ci.yml` — lint + typecheck + unit + component
- `e2e.yml` — Playwright (Chromium)
- `wasm-smoke.yml` — `rhwp_wasm.py` 기본 smoke (10종 샘플)
- `security.yml` — `pip-audit` + `npm audit` + gitleaks

---

## 13. Implementation Order

Do §13 체크리스트 참고. 요약:

| M | 이름 | 상태 |
|---|------|:----:|
| M1 | Foundation (Vite+TS, diff/json/types) | ✅ |
| M2 | Claude CLI proxy | ✅ |
| ~~M3~~ | overlay converter | 🗑️ 폐기 |
| **M3R** | rhwp_wasm + render endpoint | ⏳ |
| **M4R** | upload/download/FileUploader | ⏳ |
| **M5R** | SvgViewer + Selection | ⏳ |
| **M6R** | Edit API + InlineCherryPickDiff | ⏳ |
| **M7R** | Chat/History/Sidebar 이식 (Zustand 포함) | ⏳ |
| M8 | Hardening (security, Docker, 접근성) | ⏳ |
| M9 | 회귀 (10종 샘플 round-trip) | ⏳ |
| M10 | `/pdca analyze` → Match Rate ≥ 90% | ⏳ |

**예상 기간**: 4-6주 (M3R~M7R 각 1주 + M8~M10 2주)

---

## 14. Open Questions

### 확정 (v0.3)
- ✅ Monorepo: pnpm workspace
- ✅ Auth: Origin allowlist + slowapi rate limit (M8)
- ✅ LLM Bridge: `claude -p` OAuth 서브프로세스
- ✅ 업로드 세션: in-memory LRU (v1.5에 Redis 옵션)
- ✅ PDF Export: `window.print()` (v1.5+ 서버 Chromium)
- ✅ 렌더링 엔진: rhwp WASM via wasmtime (backend)
- ✅ 편집 단위: Run 좌표 (sec, para, charOffset)
- ✅ 선택 UX: 드래그 + 블록 클릭 병행

### 남은 결정
1. **편집 세션 동시성**: single-user + per-uploadId asyncio.Lock (v2.0 Yjs로 교체)
2. **SVG 캐시**: 페이지 SVG를 upload_store에 캐시할지 (용량 vs 재렌더 비용) — M8 결정
3. **컨테이너 OAuth 전달**: bind mount (기본) vs Docker secret (enterprise) — M8 #30
4. **rhwp 버전 고정**: pyhwpxlib[preview] 의 WASM 바이너리 pin 여부 — M8 #34

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-04-22 | Initial Design — Block 모델, overlay chain | ratiertm |
| 0.2 | 2026-04-23 | M2 LLM Bridge 전환 (`claude -p` + OAuth) + PageBreakBlock 추가 | ratiertm |
| **0.3** | **2026-04-24** | **전면 재설계**: Block 폐기 → Run 좌표, rhwp WASM SVG 렌더링, M3R~M7R 신규 | ratiertm |
