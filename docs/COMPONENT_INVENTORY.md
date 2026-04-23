# COMPONENT_INVENTORY.md — Component Inventory

이 문서는 HWPX Viewer의 **모든 컴포넌트, 순수 함수, 상수**를 목록화합니다. 파일 분리·리팩토링·새 컴포넌트 추가 시 기준 문서입니다. 각 항목에 대해 **책임, Props 계약, 의존성, 권장 파일 위치**를 정의합니다.

---

## 1. 개요

현재 구현: 단일 파일 `hwpx-viewer-v8.jsx`에 24개 컴포넌트 + 5개 순수 함수 + 3개 상수 객체.

프로덕션 이전 시 권장 구조:

```
src/
├── App.tsx                        # HwpxViewer (root)
├── types/
│   └── index.ts                   # Page, Block, HistoryEntry, Message 타입
├── theme/
│   └── tokens.ts                  # THEMES
├── api/
│   ├── claude.ts                  # callClaudeOnce, streamClaude, extractJson
│   └── prompts.ts                 # SYSTEM_DOC_EDITOR, SYSTEM_INLINE_EDITOR
├── lib/
│   └── diff/
│       ├── text.ts                # tokenize, lcsMatrix, diffTokens, groupHunks, reconstructText
│       └── table.ts               # diffTable, reconstructTable, reshapeCells
├── data/
│   └── initial-pages.ts           # INITIAL_PAGES, SUGGESTIONS, INLINE_ACTIONS
├── state/
│   └── useViewerStore.ts          # Zustand store (pages, history, messages, ...)
├── hooks/
│   ├── useScrollSpy.ts            # IntersectionObserver 래핑
│   ├── useSelectionMenu.ts        # selectionchange listener
│   └── useStreamChat.ts           # 스트리밍 + 멀티턴 로직
└── components/
    ├── layout/
    │   ├── TopHeader.tsx
    │   ├── Sidebar.tsx
    │   ├── StatusBar.tsx
    │   ├── FloatingDock.tsx
    │   └── UserMenu.tsx
    ├── canvas/
    │   ├── Canvas.tsx             # main scroll container
    │   ├── CoverPage.tsx
    │   ├── Block.tsx              # h1/h2/lead/p/table 렌더 분기
    │   └── MiniPreview.tsx
    ├── chat/
    │   ├── ChatPanel.tsx
    │   ├── ChatMessage.tsx
    │   └── StreamingMessage.tsx
    ├── history/
    │   └── HistoryPanel.tsx
    ├── inline/
    │   ├── InlineSelectionMenu.tsx
    │   ├── InlineLoadingBlock.tsx
    │   ├── InlineErrorBlock.tsx
    │   └── InlineCherryPickDiff.tsx
    └── diff/
        ├── DiffView.tsx           # 블록 단위 diff
        ├── TableDiffBlock.tsx     # 표 전용
        ├── MiniTable.tsx          # 표 추가/삭제 썸네일
        └── primitives/
            ├── DockBtn.tsx
            ├── Stat.tsx
            └── Row.tsx
```

---

## 2. 최상위 컴포넌트

### 2.1 `HwpxViewer` (root)
- **책임**: 모든 전역 state 보유, 패널 레이아웃 조립, 최상위 이벤트 처리 (selectionchange, scroll spy).
- **Props**: 없음 (default export)
- **내부 state**: 17개 (상세는 `ARCHITECTURE.md` §3)
- **의존**: 거의 모든 컴포넌트와 함수
- **권장 위치**: `src/App.tsx`
- **분리 전략**: Zustand store로 state를 추출하면 이 컴포넌트는 레이아웃만 담당하는 얇은 shell이 됨

---

## 3. Layout 컴포넌트

### 3.1 `TopHeader` (현재 인라인)
- **책임**: 파일명 표시, 전역 토글 버튼들 (사이드바/History/AI/테마/Export), UserMenu 슬롯
- **Props 계약** (분리 시):
  ```ts
  interface TopHeaderProps {
    t: Theme;
    theme: 'dark' | 'light';
    sidebarOpen: boolean; onToggleSidebar: () => void;
    historyOpen: boolean; onToggleHistory: () => void;
    chatOpen: boolean; onToggleChat: () => void;
    onToggleTheme: () => void;
    historyActiveCount: number;
    userMenuOpen: boolean; setUserMenuOpen: (v: boolean) => void;
  }
  ```
- **의존**: `UserMenu`, `lucide-react` (PanelLeft, Search, History, Sun/Moon, Sparkles, Download, MoreHorizontal, Command)
- **권장 위치**: `src/components/layout/TopHeader.tsx`

### 3.2 `Sidebar` (현재 인라인 `<aside>`)
- **책임**: 페이지 목록 + 미니어처, 페이지 점프 트리거
- **Props 계약**:
  ```ts
  interface SidebarProps {
    open: boolean;
    pages: Page[];
    currentPage: number;
    highlightedSections: Set<number>;
    onJumpToPage: (id: number) => void;
    t: Theme;
    theme: 'dark' | 'light';
  }
  ```
- **의존**: `MiniPreview`
- **권장 위치**: `src/components/layout/Sidebar.tsx`

### 3.3 `StatusBar` (현재 인라인 `<footer>`)
- **책임**: 현재 페이지명, OWPML 버전, edits/turns 카운터, connection 상태
- **Props 계약**:
  ```ts
  interface StatusBarProps {
    currentPageTitle: string;
    activeEditCount: number;
    turnCount: number;
    theme: 'dark' | 'light';
    isStreaming: boolean;
    t: Theme;
  }
  ```
- **권장 위치**: `src/components/layout/StatusBar.tsx`

### 3.4 `FloatingDock` (현재 canvas main 내부 인라인)
- **책임**: 페이지 네비, 줌, 인쇄/전체화면, AI 호출
- **Props 계약**:
  ```ts
  interface FloatingDockProps {
    currentIdx: number;
    totalPages: number;
    zoom: number;
    onPrev: () => void;
    onNext: () => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onOpenChat: () => void;
    t: Theme;
    theme: 'dark' | 'light';
  }
  ```
- **의존**: `DockBtn`
- **권장 위치**: `src/components/layout/FloatingDock.tsx`

### 3.5 `UserMenu` (이미 별도 함수)
- **책임**: 프로필 드롭다운 (닫기 Escape/외부클릭)
- **Props 계약**:
  ```ts
  interface UserMenuProps {
    open: boolean;
    setOpen: (v: boolean) => void;
    t: Theme;
    theme: 'dark' | 'light';
    // 미래: user: { name, email, avatarUrl, workspace, plan }
    // 미래: onSelect: (id: 'profile' | 'settings' | ...) => void
  }
  ```
- **의존**: `lucide-react` (User, Settings, LogOut, CreditCard, HelpCircle, Keyboard)
- **권장 위치**: `src/components/layout/UserMenu.tsx`

---

## 4. Canvas 컴포넌트

### 4.1 `Canvas` (현재 `<main>` 인라인)
- **책임**: 무한 스크롤 컨테이너, IntersectionObserver root, 페이지 섹션 렌더링
- **Props 계약**:
  ```ts
  interface CanvasProps {
    pages: Page[];
    currentPage: number;
    zoom: number;
    inlineEditing: InlineEditing | null;
    highlightedSections: Set<number>;
    onCurrentPageChange: (id: number) => void;
    onAcceptInlineEdit: (finalText?: string) => void;
    onRejectInlineEdit: () => void;
    pageRefs: React.MutableRefObject<Record<number, HTMLElement>>;
    scrollContainerRef: React.RefObject<HTMLElement>;
    t: Theme;
    theme: 'dark' | 'light';
  }
  ```
- **의존**: `CoverPage`, `Block`, `InlineLoadingBlock`, `InlineErrorBlock`, `InlineCherryPickDiff`
- **권장 위치**: `src/components/canvas/Canvas.tsx`

### 4.2 `CoverPage`
- **책임**: 표지 페이지 (그라데이션 로고, hero 타이틀, 3-stat grid)
- **Props 계약**:
  ```ts
  interface CoverPageProps {
    t: Theme;
    theme: 'dark' | 'light';
    // 미래: title, subtitle, stats 커스터마이징
  }
  ```
- **의존**: `Stat`
- **권장 위치**: `src/components/canvas/CoverPage.tsx`

### 4.3 `Block`
- **책임**: 블록 타입별 렌더링 분기 (h1/h2/lead/p/table)
- **Props 계약**:
  ```ts
  interface BlockProps {
    block: Block;  // discriminated union
    t: Theme;
    theme: 'dark' | 'light';
  }
  ```
- **의존**: 없음 (순수 렌더)
- **권장 위치**: `src/components/canvas/Block.tsx`
- **확장 시 주의**: 새 블록 타입 추가하면 이 컴포넌트 + `MiniPreview` + `SYSTEM_DOC_EDITOR` + `DiffView` 4곳 업데이트 필요 (`CLAUDE.md` §8.1 참조)

### 4.4 `MiniPreview`
- **책임**: 사이드바의 페이지 미니어처 렌더 (추상 막대)
- **Props 계약**:
  ```ts
  interface MiniPreviewProps {
    page: Page;
    theme: 'dark' | 'light';
  }
  ```
- **의존**: 없음
- **권장 위치**: `src/components/canvas/MiniPreview.tsx`
- **알려진 한계**: 표 블록은 3x2 그리드로만 표현, 실제 셀 수 반영 안 함

---

## 5. Chat 컴포넌트

### 5.1 `ChatPanel` (현재 인라인 `<aside>`)
- **책임**: 채팅 패널 컨테이너, 메시지 스크롤, 입력창, 제안 버튼
- **Props 계약**:
  ```ts
  interface ChatPanelProps {
    open: boolean;
    onClose: () => void;
    messages: Message[];
    isStreaming: boolean;
    streamingText: string;
    chatInput: string;
    onChangeInput: (v: string) => void;
    onSendMessage: (text: string) => Promise<void>;
    onClearConversation: () => void;
    showDiff: Record<number, Record<number, boolean>>;
    onToggleDiff: (msgIdx: number, editIdx: number) => void;
    onToggleEdit: (historyId: number) => void;
    history: HistoryEntry[];
    t: Theme;
    theme: 'dark' | 'light';
  }
  ```
- **의존**: `ChatMessage`, `StreamingMessage`
- **권장 위치**: `src/components/chat/ChatPanel.tsx`
- **분리 후 개선**: 입력창은 `ChatInput`으로 한 번 더 분리하면 테스트 쉬워짐

### 5.2 `ChatMessage`
- **책임**: user 버블 또는 assistant 메시지 (edits 카드 포함) 렌더
- **Props 계약**:
  ```ts
  interface ChatMessageProps {
    msg: Message;
    msgIdx: number;
    history: HistoryEntry[];
    showDiff: Record<number, boolean> | undefined;  // per-edit
    onToggleDiff: (editIdx: number) => void;
    onToggleEdit: (historyId: number) => void;
    t: Theme;
    theme: 'dark' | 'light';
  }
  ```
- **의존**: `DiffView`, `lucide-react` (Sparkles, AlertCircle, Check, Undo2, Redo2, Eye, EyeOff, Layers)
- **권장 위치**: `src/components/chat/ChatMessage.tsx`

### 5.3 `StreamingMessage`
- **책임**: 스트리밍 진행 중 누적 텍스트 표시 (JSON이면 summary만 추출)
- **Props 계약**:
  ```ts
  interface StreamingMessageProps {
    text: string;  // 누적 raw
    t: Theme;
    theme: 'dark' | 'light';
  }
  ```
- **의존**: 없음 (내부에 간단한 regex 파싱)
- **권장 위치**: `src/components/chat/StreamingMessage.tsx`
- **알려진 한계**: JSON summary 추출에 정규식 사용, 이스케이프된 `"` 처리 못함 (개선 여지: 점진적 JSON parser 도입)

---

## 6. History 컴포넌트

### 6.1 `HistoryPanel`
- **책임**: 편집 이력 타임라인, 각 엔트리 토글/점프
- **Props 계약**:
  ```ts
  interface HistoryPanelProps {
    history: HistoryEntry[];
    onClose: () => void;
    onToggle: (historyId: number) => void;
    onJumpToPage: (pageId: number) => void;
    t: Theme;
    theme: 'dark' | 'light';
  }
  ```
- **의존**: `lucide-react` (GitBranch, Clock, FileText, Check, Undo2, Redo2, X)
- **권장 위치**: `src/components/history/HistoryPanel.tsx`
- **확장 시**: 필터/검색 기능 추가 시 내부 상태 추가 가능

---

## 7. Inline 편집 컴포넌트

### 7.1 `InlineSelectionMenu`
- **책임**: 드래그 선택 위에 뜨는 AI 액션 메뉴, 자동 위치 보정
- **Props 계약**:
  ```ts
  interface InlineSelectionMenuProps {
    menu: { x: number; y: number; text: string; pageId: number; blockIdx: number };
    onAction: (action: InlineAction) => void;
    t: Theme;
    theme: 'dark' | 'light';
  }
  ```
- **의존**: `INLINE_ACTIONS` 상수, `lucide-react` (Sparkles, Pencil, Minimize, Languages)
- **권장 위치**: `src/components/inline/InlineSelectionMenu.tsx`
- **주의**: 버튼 mousedown에 `preventDefault` 필수 (선택 해제 방지)

### 7.2 `InlineLoadingBlock`
- **책임**: 인라인 편집 API 응답 대기 중 표시 (원본 블록을 회색으로)
- **Props 계약**:
  ```ts
  interface InlineLoadingBlockProps {
    block: Block;  // 원본 (회색으로 표시)
    t: Theme;
    theme: 'dark' | 'light';
  }
  ```
- **의존**: `Block`
- **권장 위치**: `src/components/inline/InlineLoadingBlock.tsx`

### 7.3 `InlineErrorBlock`
- **책임**: 인라인 편집 실패 시 에러 메시지 + 닫기
- **Props 계약**:
  ```ts
  interface InlineErrorBlockProps {
    error: string;
    onClose: () => void;
    t: Theme;
    theme: 'dark' | 'light';
  }
  ```
- **의존**: `lucide-react` (AlertCircle, X)
- **권장 위치**: `src/components/inline/InlineErrorBlock.tsx`

### 7.4 `InlineCherryPickDiff`
- **책임**: 단어 단위 cherry-pick UI, 최종 결과 미리보기, 적용/취소
- **Props 계약**:
  ```ts
  interface InlineCherryPickDiffProps {
    inlineEditing: {
      pageId: number;
      blockIdx: number;
      original: string;
      suggestion: string;
      selectedText: string;
      action: InlineActionId;
      status: 'ready';
    };
    onAccept: (finalText: string) => void;
    onReject: () => void;
    t: Theme;
    theme: 'dark' | 'light';
  }
  ```
- **의존**: `diffTokens`, `groupHunks`, `reconstructText`, `lucide-react` (Sparkles, Check)
- **내부 state**: `acceptedIds: Set<number>`
- **권장 위치**: `src/components/inline/InlineCherryPickDiff.tsx`

---

## 8. Diff 렌더링 컴포넌트

### 8.1 `DiffView`
- **책임**: 블록 단위 diff 렌더 (블록 타입별 분기)
- **Props 계약**:
  ```ts
  interface DiffViewProps {
    edit: Edit;  // { oldBody, newBody, ... }
    t: Theme;
    theme: 'dark' | 'light';
  }
  ```
- **의존**: `TableDiffBlock`, `MiniTable`, `diffTokens`
- **권장 위치**: `src/components/diff/DiffView.tsx`
- **확장 시**: 새 블록 타입의 diff 처리 로직을 여기에 추가

### 8.2 `TableDiffBlock`
- **책임**: 표 단위 변경 시각화 (행/컬럼 추가/삭제/변경)
- **Props 계약**:
  ```ts
  interface TableDiffBlockProps {
    oldTable: TableBlock;
    newTable: TableBlock;
    t: Theme;
    theme: 'dark' | 'light';
  }
  ```
- **의존**: `diffTable`
- **권장 위치**: `src/components/diff/TableDiffBlock.tsx`
- **알려진 한계**: 시각화 전용, cell 단위 토글 미구현 (P1 작업)

### 8.3 `MiniTable`
- **책임**: 표가 통째로 추가/삭제될 때 표 썸네일 렌더
- **Props 계약**:
  ```ts
  interface MiniTableProps {
    table: TableBlock;
    stripe: 'add' | 'del';
    t: Theme;
    theme: 'dark' | 'light';
  }
  ```
- **의존**: 없음
- **권장 위치**: `src/components/diff/MiniTable.tsx`

---

## 9. 공통 Primitive

### 9.1 `DockBtn`
- **책임**: Dock의 원형 버튼 (표준 크기, hover scale)
- **Props 계약**:
  ```ts
  interface DockBtnProps {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    title?: string;
    t: Theme;
  }
  ```
- **권장 위치**: `src/components/primitives/DockBtn.tsx`

### 9.2 `Stat`
- **책임**: Cover 페이지의 label/value 통계 블록
- **Props 계약**:
  ```ts
  interface StatProps {
    label: string;
    value: string;
    t: Theme;
  }
  ```
- **권장 위치**: `src/components/primitives/Stat.tsx`

### 9.3 `Row`
- **책임**: key-value 작은 한 줄 (Document 메타 정보용)
- **Props 계약**:
  ```ts
  interface RowProps {
    label: string;
    value: string;
    t: Theme;
  }
  ```
- **권장 위치**: `src/components/primitives/Row.tsx`
- **참고**: 현재 코드에서 사용처가 제한적. 다른 곳에서 재사용 가능.

---

## 10. 순수 함수 (Diff 엔진)

### 10.1 `tokenize(text: string): string[]`
- **위치 권장**: `src/lib/diff/text.ts`
- **의존**: 없음
- **테스트 커버리지**: 필수 (UT-01 ~ UT-06)

### 10.2 `lcsMatrix(a: string[], b: string[]): Int32Array[]`
- **위치 권장**: `src/lib/diff/text.ts`
- **의존**: 없음
- **주의**: 메모리 최적화를 위해 `Int32Array` 사용. `number[]`로 바꾸지 말 것.

### 10.3 `diffTokens(oldText: string, newText: string): Op[]`
- **위치 권장**: `src/lib/diff/text.ts`
- **의존**: `tokenize`, `lcsMatrix`
- **반환**: `{ type: 'eq' | 'add' | 'del', token: string }[]`

### 10.4 `groupHunks(ops: Op[]): Hunk[]`
- **위치 권장**: `src/lib/diff/text.ts`
- **의존**: 없음
- **반환**: `({ kind: 'eq', token } | { kind: 'change', id, del, add })[]`

### 10.5 `reconstructText(hunks: Hunk[], acceptedIds: Set<number>): string`
- **위치 권장**: `src/lib/diff/text.ts`
- **의존**: 없음
- **역할**: cherry-pick 결과로 최종 텍스트 재구성

### 10.6 `diffTable(oldTable: TableBlock, newTable: TableBlock): { headerOps, rowOps }`
- **위치 권장**: `src/lib/diff/table.ts`
- **의존**: 없음
- **주의**: 첫 컬럼을 행 key로 사용. `ARCHITECTURE.md` §5.2 참조.

### 10.7 `reconstructTable(...)` / `reshapeCells(...)`
- **위치 권장**: `src/lib/diff/table.ts`
- **현재 UI에서 사용 여부**: 준비만 되어 있고 미사용. 셀 단위 cherry-pick 구현 시 활성화.

---

## 11. API 클라이언트 함수

### 11.1 `callClaudeOnce(systemPrompt: string, userPrompt: string): Promise<string>`
- **위치 권장**: `src/api/claude.ts`
- **의존**: `fetch` (전역)
- **용도**: 인라인 편집 (non-streaming)
- **에러**: `Error('API error: {status}')`

### 11.2 `streamClaude(systemPrompt: string, conversation: Message[]): AsyncGenerator<string>`
- **위치 권장**: `src/api/claude.ts`
- **의존**: `fetch`, `ReadableStream`, `TextDecoder`
- **용도**: 채팅 (streaming)
- **파싱**: SSE `data:` 라인, `content_block_delta.delta.text`만 yield
- **주의**: `buffer.split('\n').pop()`으로 불완전 라인 보존

### 11.3 `extractJson(text: string): any`
- **위치 권장**: `src/api/claude.ts` 또는 별도 `src/lib/json.ts`
- **의존**: 없음
- **전략**: 코드 펜스 제거 → 직접 parse → 첫 `{` ~ 마지막 `}` 추출 후 parse
- **에러**: `Error('JSON parse failed')`

---

## 12. 상수 및 데이터

### 12.1 `INITIAL_PAGES`
- **타입**: `Page[]`
- **위치 권장**: `src/data/initial-pages.ts`
- **현재**: 5 페이지의 mock 데이터 (Cover + 4 content)
- **프로덕션**: HWPX 파일 import 결과로 교체

### 12.2 `THEMES`
- **타입**: `Record<'dark' | 'light', Theme>`
- **위치 권장**: `src/theme/tokens.ts`
- **확장 가이드**: `DESIGN_SPEC.md` §13 참조

### 12.3 `SUGGESTIONS`
- **타입**: `string[]`
- **위치 권장**: `src/data/suggestions.ts`
- **미래**: 사용자의 문서 타입/이력 기반 동적 제안

### 12.4 `INLINE_ACTIONS`
- **타입**: `{ id: string; label: string; icon: Icon }[]`
- **위치 권장**: `src/data/inline-actions.ts`
- **확장**: 새 액션 추가 시 `SYSTEM_INLINE_EDITOR` 프롬프트도 동시에 업데이트

### 12.5 `SYSTEM_DOC_EDITOR` / `SYSTEM_INLINE_EDITOR`
- **타입**: `string`
- **위치 권장**: `src/api/prompts.ts`
- **버전 관리**: 프롬프트 변경 시 git log 남기고 영향 범위 (JSON 스키마) 체크

---

## 13. 훅 (분리 시 권장)

현재는 `HwpxViewer` 내부에 인라인 `useEffect`로 들어가 있음. 분리하면 테스트 가능·재사용 가능.

### 13.1 `useScrollSpy`
- **목적**: 현재 보이는 페이지 추적
- **시그니처**:
  ```ts
  function useScrollSpy(
    containerRef: RefObject<HTMLElement>,
    pageRefs: MutableRefObject<Record<number, HTMLElement>>,
    pages: Page[],
  ): number  // current visible page id
  ```
- **권장 위치**: `src/hooks/useScrollSpy.ts`

### 13.2 `useSelectionMenu`
- **목적**: 텍스트 드래그 감지 → 메뉴 좌표 계산
- **시그니처**:
  ```ts
  function useSelectionMenu(): {
    menu: SelectionMenu | null;
    clear: () => void;
  }
  ```
- **권장 위치**: `src/hooks/useSelectionMenu.ts`
- **주의**: 글로벌 `selectionchange` 이벤트 사용, 언마운트 시 정리 필수

### 13.3 `useStreamChat`
- **목적**: 스트리밍 + 멀티턴 + edits 적용 로직
- **시그니처**:
  ```ts
  function useStreamChat(opts: {
    pages: Page[];
    onApplyEdits: (edits: Edit[]) => void;
    onRecordEdit: (pageId, oldBody, newBody, action) => number;
  }): {
    messages: Message[];
    isStreaming: boolean;
    streamingText: string;
    send: (text: string) => Promise<void>;
    clear: () => void;
  }
  ```
- **권장 위치**: `src/hooks/useStreamChat.ts`
- **이득**: 이 훅만 별도로 테스트 가능, 다른 화면(예: 양식 템플릿 편집기)에서 재사용 가능

---

## 14. 의존성 그래프

```
App (HwpxViewer)
├─ TopHeader ─────────────────── UserMenu
├─ Sidebar ──────────────────── MiniPreview
├─ Canvas
│   ├─ CoverPage ──────────────── Stat
│   ├─ Block
│   ├─ InlineLoadingBlock ────── Block
│   ├─ InlineErrorBlock
│   └─ InlineCherryPickDiff ──── diff/text (lib)
├─ FloatingDock ──────────────── DockBtn
├─ InlineSelectionMenu
├─ HistoryPanel
├─ ChatPanel
│   ├─ ChatMessage
│   │   └─ DiffView
│   │       ├─ TableDiffBlock ── diff/table (lib)
│   │       └─ MiniTable
│   └─ StreamingMessage
└─ StatusBar
```

**순수 함수/상수**는 어느 컴포넌트에서도 import 가능. 컴포넌트 간 직접 의존은 위 그래프에 나오는 것만.

**주의**: `Block`은 여러 곳에서 재사용됨 (Canvas, InlineLoadingBlock). 의존성 사이클 없음.

---

## 15. 타입 정의 (권장 `src/types/index.ts`)

```ts
// Theme
export interface Theme {
  bg: string; bgSubtle: string; bgMuted: string;
  bgDock: string; bgPanel: string;
  text: string; textStrong: string;
  textMuted: string; textSubtle: string; textFaint: string;
  border: string; borderSubtle: string;
  hover: string; hoverSubtle: string;
  activeBg: string;
  btnPrimary: string;
  accent: string; accentDot: string;
  pageBg: string;
  paperBg: string; paperBorder: string;
  inputBg: string; inputBorder: string;
  diffAddBg: string; diffAddText: string; diffAddBorder: string;
  diffDelBg: string; diffDelText: string; diffDelBorder: string;
  diffAddInline: string; diffDelInline: string;
  diffAddPick: string; diffDelPick: string;
  glow: string;
}

export type ThemeName = 'dark' | 'light';

// Pages & Blocks
export interface CoverPage {
  id: 0;                  // literal — cover is always id=0 by convention
  title: 'Cover';
  section: '00';
  isCover: true;
}

export interface ContentPage {
  id: number;
  title: string;
  section: string;
  body: Block[];
}

export type Page = CoverPage | ContentPage;

export type Block = TextBlock | TableBlock | PageBreakBlock;

export interface TextBlock {
  type: 'h1' | 'h2' | 'lead' | 'p';
  text: string;
}

export interface TableBlock {
  type: 'table';
  headers: string[];
  rows: string[][];
}

export interface PageBreakBlock {
  type: 'pageBreak';
  // Para.page_break=True인 OWPML 문단에서 변환. 본문 텍스트 없음.
  // 섹션 내부의 논리적 쪽 나눔. 섹션 경계(Page 경계)와 구분됨.
}

// History
export interface HistoryEntry {
  id: number;
  ts: number;
  pageId: number;
  pageTitle: string;
  oldBody: Block[];
  newBody: Block[];
  action: string;
  undone: boolean;
}

export interface Edit {
  historyId: number;
  pageId: number;
  pageTitle: string;
  oldBody: Block[];
  newBody: Block[];
}

// Messages
export interface Message {
  role: 'user' | 'assistant';
  text: string;
  content?: string;
  edits?: Edit[];
  ui?: 'static' | 'inline';
  isError?: boolean;
}

// Inline editing
export type InlineActionId = 'rewrite' | 'shorten' | 'translate';

export interface InlineAction {
  id: InlineActionId;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}

export type InlineEditing =
  | { pageId: number; blockIdx: number; original: string; action: InlineActionId; status: 'loading' }
  | { pageId: number; blockIdx: number; original: string; action: InlineActionId; status: 'error'; error: string }
  | {
      pageId: number; blockIdx: number;
      original: string; suggestion: string; selectedText: string;
      action: InlineActionId; status: 'ready';
    };

// Diff
export type Op =
  | { type: 'eq'; token: string }
  | { type: 'add'; token: string }
  | { type: 'del'; token: string };

export type Hunk =
  | { kind: 'eq'; token: string }
  | { kind: 'change'; id: number; del: string; add: string };
```

---

## 16. 새 컴포넌트 추가 가이드

새 컴포넌트를 추가할 때:

1. **책임 한 가지** — 두 가지 이상이면 분리
2. **Props는 인터페이스로 명시** — TypeScript 사용 시 (현재 JSX는 prop types 주석이라도)
3. **`t: Theme` + `theme: 'dark' | 'light'` props** — 테마 지원 컴포넌트의 표준
4. **`lucide-react` 아이콘 import는 명시적으로** — tree-shaking 위해
5. **외부 state 변경은 콜백으로만** — 자신의 내부 state는 OK, 외부 state 직접 수정 금지
6. **이 문서에 엔트리 추가** — 섹션, 책임, Props 계약, 의존, 권장 위치

---

## 17. 리팩토링 우선순위 (프로덕션 이전 시)

1. **P0** — 타입 정의 (§15) 분리 → `src/types/index.ts`
2. **P0** — diff 엔진 분리 → `src/lib/diff/` (순수 함수, 테스트 쉬움)
3. **P0** — API 클라이언트 분리 → `src/api/`
4. **P1** — Zustand store 도입 → `src/state/`
5. **P1** — 3개 훅 분리 (§13)
6. **P1** — 레이아웃 컴포넌트 분리 (TopHeader, Sidebar, Canvas 등)
7. **P2** — Diff/Inline 컴포넌트 분리 (상대적으로 잘 묶여있음)
8. **P2** — shadcn/ui 등 기존 컴포넌트 라이브러리로 primitive 교체 (DockBtn, Button 등)

단일 파일 → 분리된 구조로 옮길 때 한 번에 모두 하지 말고 위 순서대로 작은 PR로 진행. 각 단계마다 테스트 통과 확인.
