# ARCHITECTURE.md

이 문서는 HWPX Viewer의 **코드 구조, 상태 모델, 데이터 흐름**을 정의합니다. 새 기능을 추가하거나 기존 동작을 수정하기 전 반드시 이 문서를 먼저 읽어 영향 범위를 파악하십시오.

---

## 1. High-level 구조

```
┌─────────────────────────────────────────────────────────────┐
│                      HwpxViewer (root)                       │
│  ┌──────────┬──────────────────────┬───────────┬─────────┐  │
│  │          │                      │           │         │  │
│  │ Sidebar  │      Canvas          │ History   │  Chat   │  │
│  │ (pages   │  (infinite scroll +  │ Panel     │  Panel  │  │
│  │  list +  │   blocks +           │ (timeline │  (multi │  │
│  │  mini    │   inline editing)    │  + undo/  │   turn  │  │
│  │  preview)│                      │  redo)    │   AI)   │  │
│  └──────────┴──────────────────────┴───────────┴─────────┘  │
│       Floating dock (page nav, zoom, AI trigger)             │
│       Status bar (current page, edit count, streaming)       │
└─────────────────────────────────────────────────────────────┘
```

단일 컴포넌트(`HwpxViewer`) 안에 모든 상태가 있습니다. 의도된 단순화입니다 — Artifacts 단일 파일 제약 + 프로토타입 단계.

실제 프로덕션으로 옮길 때는 다음과 같이 분리하십시오:
- `src/state/` — Zustand store 또는 Redux slices
- `src/components/` — 컴포넌트별 파일
- `src/api/` — Claude API 클라이언트
- `src/lib/diff/` — LCS, table diff
- `src/types/` — TypeScript 타입 정의

---

## 2. 데이터 모델

### 2.1 Page

```ts
type Page = CoverPage | ContentPage;

interface CoverPage {
  id: number;          // 0 (관례적으로 cover는 항상 id=0)
  title: 'Cover';
  section: '00';
  isCover: true;
}

interface ContentPage {
  id: number;          // 1, 2, 3, ...
  title: string;       // 'Overview' | 'Timeline' | 'Budget' | 'Conclusion' | ...
  section: string;     // '01', '02', ... (zero-padded 문자열)
  body: Block[];
  // isCover 없음
}
```

### 2.2 Block

```ts
type Block = TextBlock | TableBlock;

interface TextBlock {
  type: 'h1' | 'h2' | 'lead' | 'p';
  text: string;
}

interface TableBlock {
  type: 'table';
  headers: string[];   // 컬럼 헤더
  rows: string[][];    // 각 행은 헤더와 같은 길이. 첫 컬럼은 행 식별자(label) 역할.
}
```

**중요**: 표의 첫 컬럼은 **사실상 unique key**로 간주됩니다 (`diffTable()`이 첫 셀로 행을 매칭). 같은 label을 가진 행이 두 개 이상이면 diff가 부정확해집니다.

### 2.3 History Entry

```ts
interface HistoryEntry {
  id: number;          // historyIdCounter로 부여, 1부터 단조 증가
  ts: number;          // Date.now()
  pageId: number;
  pageTitle: string;   // UI 표시용 (페이지 제목 변경되어도 history는 당시 제목 유지)
  oldBody: Block[];    // 편집 전 페이지 body 전체 스냅샷
  newBody: Block[];    // 편집 후 페이지 body 전체 스냅샷
  action: string;      // "예산 표 정리 + 합계 행 추가" 등 사람이 읽을 설명
  undone: boolean;     // 토글 가능. 절대 삭제하지 않음.
}
```

**설계 의도**:
- 메모리 효율보다 **단순성과 안정성** 우선. 페이지 body 전체를 복사 저장.
- `undone` 토글로 redo 구현. 별도 redo 스택 없음.
- 각 엔트리는 **독립적으로 토글** 가능. 즉, "5번 편집 되돌리기"가 6, 7번 편집을 자동으로 되돌리지 않음.

### 2.4 Message (chat)

```ts
interface Message {
  role: 'user' | 'assistant';
  text: string;        // UI에 표시할 사람 친화적 텍스트
  content?: string;    // API에 전송할 raw 문자열 (없으면 text 사용)
  edits?: Edit[];      // assistant 메시지가 편집을 적용했을 때
  ui?: 'static' | 'inline';   // 'static': API 컨텍스트에서 제외 (시작 인사 등)
                              // 'inline': UI에서 인라인 편집 결과로 표시
  isError?: boolean;
}

interface Edit {
  historyId: number;
  pageId: number;
  pageTitle: string;
  oldBody: Block[];
  newBody: Block[];
}
```

**핵심 패턴**:
- `content`는 API 호출용, `text`는 UI 표시용. 첫 user turn은 `content`에 문서 컨텍스트 포함된 긴 prompt, `text`에 사용자 원문.
- 두 번째 turn부터는 `content === text`.
- assistant의 `content`에는 raw JSON 응답을 저장해 다음 turn 호출 시 모델이 자기 응답을 볼 수 있게 함.

### 2.5 Inline Editing State

```ts
type InlineEditing =
  | { pageId, blockIdx, original, action, status: 'loading' }
  | { pageId, blockIdx, original, action, status: 'error', error }
  | { pageId, blockIdx, original, suggestion, selectedText, action, status: 'ready' };
```

상태 머신: `loading` → (`error` | `ready`) → (accept → null | reject → null)

---

## 3. 상태 (State) 인벤토리

`HwpxViewer` 내부의 모든 useState 목록과 책임:

| State | 타입 | 책임 | 변경 트리거 |
|---|---|---|---|
| `pages` | `Page[]` | 문서의 진실(source of truth) | 사용자 편집, AI 편집, undo/redo 토글 |
| `currentPage` | `number` | 현재 보이는 페이지 id | 스크롤(IntersectionObserver), 사이드바 클릭, 페이지 dock 버튼 |
| `sidebarOpen` | `boolean` | 좌측 사이드바 펼침 | 헤더 PanelLeft 버튼 |
| `chatOpen` | `boolean` | 우측 AI 패널 펼침 | 헤더 AI 버튼, dock 마법봉, 헤더 닫기 버튼 |
| `historyOpen` | `boolean` | 우측 history 패널 펼침 | 헤더 History 버튼 |
| `userMenuOpen` | `boolean` | 사용자 드롭다운 | 아바타 클릭 |
| `theme` | `'dark' \| 'light'` | 색 테마 | 헤더 해/달 버튼 |
| `zoom` | `number` (50–200) | 본문 글자 크기 % | dock zoom 버튼 |
| `chatInput` | `string` | 채팅 입력창 controlled value | onChange |
| `messages` | `Message[]` | 채팅 히스토리 (UI + API context) | sendMessage, acceptInlineEdit, clearConversation |
| `isStreaming` | `boolean` | API 호출 진행 중 | sendMessage 시작/종료 |
| `streamingText` | `string` | SSE로 누적되는 raw 텍스트 | 스트리밍 청크마다 |
| `highlightedSections` | `Set<number>` | flash 효과 대상 페이지 id | flashSections() |
| `history` | `HistoryEntry[]` | 영구 편집 이력 | recordEdit, toggleEdit |
| `selectionMenu` | `null \| {x, y, text, pageId, blockIdx}` | 텍스트 선택 시 floating menu 위치 | selectionchange listener |
| `inlineEditing` | `InlineEditing \| null` | 인라인 편집 진행 상태 | applyInlineEdit, accept/reject |
| `showDiff` | `Record<number, Record<number, boolean>>` | 메시지별·편집별 diff 펼침 상태 | "Diff" 버튼 클릭 |

**Refs** (DOM 또는 mutable 값):
- `scrollContainerRef` — main canvas, IntersectionObserver root
- `pageRefs` (Record<number, HTMLElement>) — 각 페이지의 DOM 노드, scrollIntoView 용
- `chatScrollRef` — 채팅 메시지 컨테이너, 자동 스크롤 용
- `historyIdCounter` — 단조 증가 카운터 (재렌더 안 함)
- `abortStreamRef` — 스트리밍 중단 플래그 (현재 사용 미완성)

---

## 4. 데이터 흐름

### 4.1 채팅 → 페이지 편집 (스트리밍 + 멀티턴)

```
User types in chat input
  → sendMessage(text)
    → messages.push({ role: 'user', text, content: ... })
       // 첫 turn: content에 문서 전체 포함
       // 이후 turn: content === text
    → setIsStreaming(true)
    → streamClaude(SYSTEM_DOC_EDITOR, apiMessages)
       → for await (chunk of generator)
            → streamingText += chunk
            → re-render <StreamingMessage />
              → JSON에서 "summary" 필드 추출해 미리 표시
    → 스트림 종료 후 fullText
    → extractJson(fullText) → { summary, edits }
    → for each edit: recordEdit() → applied to pages
    → flashSections(affected page ids)
    → messages.push({ role: 'assistant', text: summary, content: fullText, edits })
    → setIsStreaming(false), setStreamingText('')
```

**API 메시지 구성 규칙**:
- `messages` 배열에서 `ui === 'static'`인 항목 제외 (시작 인사 등)
- 각 메시지의 `content || text`를 API의 `content` 필드로 전송
- assistant 메시지의 `content`에는 raw JSON 저장 → 모델이 자기가 뭘 했는지 알 수 있음

### 4.2 인라인 편집 (drag → menu → cherry-pick)

```
User drags text in a block
  → selectionchange event
    → selectionMenu state update with {x, y, text, pageId, blockIdx}
    → <InlineSelectionMenu /> renders above selection

User clicks action (e.g., "다시 쓰기")
  → applyInlineEdit(action)
    → setInlineEditing({ status: 'loading', ... })
       → 해당 block이 <InlineLoadingBlock /> 으로 swap
    → callClaudeOnce(SYSTEM_INLINE_EDITOR, ...)
    → setInlineEditing({ status: 'ready', original, suggestion, ... })
       → <InlineCherryPickDiff /> 로 swap

User toggles hunks
  → 로컬 state(acceptedIds) 변경, finalText 재계산
  → "최종 결과" 미리보기 실시간 업데이트

User clicks "적용"
  → acceptInlineEdit(finalText)
    → pages 업데이트, recordEdit, messages에 user/assistant 쌍 추가
    → setInlineEditing(null), flashSections([pageId])
```

### 4.3 Undo / Redo (history toggle)

```
User clicks "되돌리기" (in chat OR history panel)
  → toggleEdit(historyId)
    → history entry의 undone 토글
    → pages 해당 페이지의 body를 oldBody (또는 newBody) 로 교체
    → flashSections([pageId])

UI 효과:
  - 채팅 메시지 카드의 적용됨 ↔ 되돌려짐 배지 토글
  - 카드 opacity 60%로 변경
  - 버튼이 "되돌리기" ↔ "다시 적용"으로 변경
  - History 타임라인 노드도 동시에 갱신
```

---

## 5. 모듈 (현재 단일 파일이지만 논리적으로)

### 5.1 Diff 엔진 (`tokenize`, `lcsMatrix`, `diffTokens`, `groupHunks`, `reconstructText`)

순수 함수. 외부 의존 없음. 다른 곳에 옮겨도 그대로 작동.

- `tokenize(text)` — 한글 단어/공백/구두점을 별개 토큰으로 분리
- `lcsMatrix(a, b)` — O(mn) DP. `Int32Array` 사용해 메모리 절약
- `diffTokens(old, new)` — `[{type: 'eq'|'add'|'del', token}]` 반환, 같은 타입 인접하면 병합
- `groupHunks(ops)` — `eq` 토큰과 `change` 덩어리로 그룹화. cherry-pick의 단위
- `reconstructText(hunks, acceptedIds)` — 어떤 hunk를 수락했는지에 따라 최종 문자열 재구성

### 5.2 표 Diff (`diffTable`, `reconstructTable`, `reshapeCells`)

- `diffTable(old, new)` — 헤더는 내용 매칭, 행은 첫 컬럼 매칭 → `headerOps`, `rowOps`
- `reconstructTable()` — 부분 수락 지원 (현재 UI는 시각화까지만)
- 한계: 행 순서 변경, 같은 label의 중복 행을 잘 처리 못함

### 5.3 API 클라이언트 (`callClaudeOnce`, `streamClaude`, `extractJson`)

- `callClaudeOnce(system, user)` — 동기 호출, 인라인 편집용
- `streamClaude(system, conversation)` — async generator, SSE 파싱
- `extractJson(text)` — 코드 펜스 제거, 첫 `{` ~ 마지막 `}` 추출, 두 번 시도

**SSE 파싱 핵심**:
```js
buffer += decoder.decode(value, { stream: true });
const lines = buffer.split('\n');
buffer = lines.pop() || '';   // 마지막 줄은 미완성 가능, 버퍼에 보관
for (const line of lines) {
  if (line.startsWith('data:')) {
    const evt = JSON.parse(line.slice(5).trim());
    if (evt.type === 'content_block_delta') yield evt.delta.text;
  }
}
```

### 5.4 시스템 프롬프트 (`SYSTEM_DOC_EDITOR`, `SYSTEM_INLINE_EDITOR`)

JSON 형식 강제. 의미 변경 시 응답 파싱 깨짐.

---

## 6. 의존성

- **react** (built-in)
- **lucide-react@0.383.0** — 아이콘
- **Tailwind CSS** — 스타일 (Artifacts 환경의 사전 컴파일된 클래스만 사용 가능)

추가 라이브러리 없음. **새 의존성 추가는 사용자 확인 후에만**.

---

## 7. 알려진 제약 / 트레이드오프

### 7.1 단일 파일

모든 게 `HwpxViewer` 안에 있어 props drilling이 심함. 프로덕션 이전 시 Zustand 또는 Context로 분리 권장.

### 7.2 페이지 body 전체 스냅샷

각 history entry가 페이지 body 전체를 복사 저장. 100번 편집하면 메모리 사용량 100배. 현재는 프로토타입이라 무시. 프로덕션 시 immer + structural sharing 또는 patch 기반(jsondiffpatch) 저장 고려.

### 7.3 표 diff 한계

- 첫 컬럼이 unique key라고 가정. 중복 시 매칭 실패.
- 행 순서 변경은 감지 못함 (의미적으로는 같지만 diff에서는 다름).
- 셀 단위 cherry-pick은 시각화만 구현. 실제 토글은 추가 작업 필요.

### 7.4 토큰 비용

멀티턴이 길어지면 모든 turn이 매번 전송됨. 대화 5–10 turn 후에는 자동 요약 / 압축 고려 필요.

### 7.5 스트리밍 중 부분 JSON 파싱 안 함

응답 완료 후에만 파싱. 따라서 페이지가 글자별로 업데이트되는 효과는 없음. JSON streaming parser (예: `partial-json`) 도입 시 가능.

### 7.6 abortStreamRef 미완성

스트리밍 중단 플래그는 있으나 UI 버튼은 없음. 추가 시 fetch AbortController도 같이 도입 필요.

---

## 8. 확장 시 가이드

### 8.1 새 블록 타입 추가 (예: `quote`, `code`)

영향 범위:
1. `Block` 컴포넌트 — 렌더링 추가
2. `MiniPreview` 컴포넌트 — 미니어처 막대 렌더링 추가
3. `SYSTEM_DOC_EDITOR` 프롬프트 — 새 타입 설명 추가
4. `DiffView` — `renderText`/렌더 분기 추가
5. `applyInlineEdit` — 새 타입에서 인라인 편집 허용할지 결정

### 8.2 새 인라인 액션 추가 (예: "전문가 톤으로")

`INLINE_ACTIONS` 배열에 추가, `SYSTEM_INLINE_EDITOR`의 액션 목록 갱신. 메뉴에 자동 노출됨.

### 8.3 실제 HWPX 연결

이 뷰어는 **블록 모델이 진실**입니다. HWPX 파일 ↔ 블록 모델 사이 변환 레이어를 별도로 만드십시오:

```
.hwpx file
  ↓ pyhwpxlib (parse)
HWPX OWPML XML
  ↓ converter (별도 모듈)
Block[] (이 뷰어의 모델)
  ↓ HwpxViewer (편집)
Block[] (수정됨)
  ↓ converter
HWPX OWPML XML
  ↓ pyhwpxlib (serialize)
.hwpx file (수정됨)
```

뷰어는 HWPX 자체를 모릅니다. 블록 모델만 다룹니다.

### 8.4 협업 (멀티 유저)

지금은 single-user. 추가하려면:
- `pages` state를 CRDT 또는 OT 기반 sync 엔진으로 교체 (Yjs 권장)
- `messages`, `history`도 공유 또는 user별 분리
- WebSocket 연결 + presence
- UI: 다른 사용자 커서, 선택 영역, 아바타 — 헤더 우측에 자리 마련 됨

---

## 9. 테스트 전략 (미구현, 권장)

### Unit
- `tokenize`, `diffTokens`, `groupHunks`, `reconstructText` — 한국어/영어/혼합 케이스
- `diffTable` — 추가/삭제/변경 행, 헤더 변경
- `extractJson` — 코드 펜스, 부분 JSON, 오염된 응답

### Component
- `<InlineCherryPickDiff />` — hunk 토글이 finalText에 반영되는지
- `<HistoryPanel />` — 토글 시 entry 상태 변경

### Integration
- `sendMessage` → mock API → pages 업데이트, history 추가 확인
- 멀티턴: 첫 turn에 doc context, 두 번째 turn에 사용자 입력만 전송되는지

### E2E (Playwright)
- 시나리오: AI에게 표 편집 요청 → diff 확인 → 일부 hunk 거부 → 적용 → history에서 되돌리기

---

## 10. 파일 위치 (현재 / 권장)

| 현재 (단일 파일) | 권장 분리 |
|---|---|
| `hwpx-viewer-v8.jsx` | `src/App.tsx` |
| 동일 | `src/components/Sidebar.tsx`, `Canvas.tsx`, `ChatPanel.tsx`, `HistoryPanel.tsx`, `Dock.tsx`, `UserMenu.tsx` |
| 동일 | `src/components/blocks/Block.tsx`, `InlineSelectionMenu.tsx`, `InlineCherryPickDiff.tsx`, `DiffView.tsx`, `TableDiffBlock.tsx`, `MiniPreview.tsx`, `CoverPage.tsx` |
| `tokenize`, `diffTokens`, `groupHunks` | `src/lib/diff/text.ts` |
| `diffTable`, `reconstructTable` | `src/lib/diff/table.ts` |
| `callClaudeOnce`, `streamClaude` | `src/api/claude.ts` |
| `THEMES` | `src/theme/tokens.ts` |
| `SYSTEM_*` | `src/api/prompts.ts` |
| 타입 정의 (현재 없음) | `src/types/index.ts` |
