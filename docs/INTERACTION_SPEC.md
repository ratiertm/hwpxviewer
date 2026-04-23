# INTERACTION_SPEC.md — Interaction Specification

이 문서는 HWPX Viewer에서 **모든 사용자 액션과 시스템 반응, 엣지 케이스**를 정의합니다. "버튼을 누르면 무슨 일이 일어나는가"에 대한 진실의 원천(source of truth). 구현 중 모호한 동작이 생기면 이 문서를 업데이트한 뒤 코드를 수정하십시오.

---

## 1. 표기 규칙

각 인터랙션은 다음 구조로 기술합니다:

```
### [ID] 액션 이름
Trigger: 어떤 사용자 입력이 이걸 발생시키는가
Preconditions: 이 동작이 가능하려면 어떤 상태여야 하는가
System Response: 시스템이 어떻게 반응하는가 (상태 변화 + UI 변화)
Edge Cases: 예외 처리
Related: 관련된 다른 인터랙션 ID
```

**상태 변화는 `→` 표기**, **UI 효과는 `●` 표기**.

---

## 2. 글로벌 단축키

| 키 | 동작 | 현재 구현 |
|---|---|---|
| `Esc` | 열린 드롭다운/메뉴 닫기 | ✅ (user menu) |
| `⌘K` / `Ctrl+K` | 검색 (UI만) | ⬜ 미구현 |
| `Enter` (채팅 입력) | 메시지 전송 | ✅ |
| `Shift+Enter` (채팅 입력) | 줄바꿈 | ✅ |
| `?` | 단축키 도움말 | ⬜ 미구현 |
| `⌘,` / `Ctrl+,` | 설정 | ⬜ 미구현 |

---

## 3. 네비게이션 인터랙션

### NAV-01 페이지 스크롤 감지 (scroll spy)
**Trigger**: 사용자가 canvas를 스크롤
**Preconditions**: `scrollContainerRef`와 `pageRefs`에 해당 페이지 DOM 등록됨
**System Response**:
- IntersectionObserver가 `threshold: [0.3, 0.6]`로 감시
- 화면에서 가장 많이 보이는 페이지(`intersectionRatio` 내림차순 1등)를 감지
- → `currentPage` = 감지된 페이지 id
- ● 사이드바: 해당 페이지 항목이 active 스타일로 변경
- ● Dock의 페이지 카운터 업데이트
- ● 상태바의 페이지 제목 업데이트

**Edge Cases**:
- 두 페이지가 동시에 똑같이 보일 때: 먼저 감지된 것 우선 (실제로는 거의 발생 안 함, threshold 만족 시점 차이로 결정됨)
- 빠른 스크롤 중: 마지막 관찰값만 적용 (React state 병합)
- 페이지 추가/삭제: `useEffect` 의존성 `[pages]`로 observer 재구성

**Related**: NAV-02, NAV-03

### NAV-02 사이드바에서 페이지 클릭
**Trigger**: 사이드바의 페이지 항목 클릭
**Preconditions**: 사이드바 열려 있음
**System Response**:
- `jumpToPage(id)` 호출 → `pageRefs.current[id].scrollIntoView({ behavior: 'smooth', block: 'start' })`
- 스크롤 완료되면 NAV-01이 자동 트리거되어 `currentPage` 업데이트
- ● 부드러운 스크롤 애니메이션

**Edge Cases**:
- 페이지 ref가 아직 마운트 안 됨 (이론상 불가능, 사이드바가 페이지 목록과 같은 state에서 렌더링됨)
- 이미 해당 페이지가 보이는 상태: scrollIntoView는 no-op에 가까움 (브라우저 기본 동작)

### NAV-03 Dock의 prev / next 버튼
**Trigger**: Dock의 `ChevronLeft` / `ChevronRight` 클릭
**Preconditions**: 각각 `currentIdx > 0`, `currentIdx < pages.length - 1`
**System Response**:
- `goPrev()` / `goNext()` → `jumpToPage(pages[currentIdx ± 1].id)` → NAV-02와 동일
- 버튼이 disabled 상태면 클릭 불가 (`disabled` + `opacity-30 cursor-not-allowed`)

**Edge Cases**:
- Cover 페이지(`id=0`)에서 prev: disabled
- 마지막 페이지에서 next: disabled

### NAV-04 사이드바 토글
**Trigger**: 헤더의 `PanelLeft` 버튼 클릭
**System Response**:
- `setSidebarOpen(s => !s)`
- ● 사이드바 너비 `w-72 ↔ w-0` 트랜지션 (300ms ease-in-out)
- ● 본문 영역이 자연스럽게 확장/축소

**Edge Cases**:
- 토글 중 다른 인터랙션: 레이아웃 트랜지션은 레이아웃 흐름에 영향을 주지 않으므로 문제 없음

### NAV-05 줌 조정
**Trigger**: Dock의 `ZoomIn` / `ZoomOut` 클릭
**Preconditions**: `zoom`이 각각 `< 200`, `> 50`
**System Response**:
- `setZoom(z => Math.min/max(..., z ± 10))` — 10% 단위 스텝
- ● Canvas 콘텐츠의 `fontSize`가 `${zoom}%`로 변경
- ● Dock의 줌 카운터 업데이트

**Edge Cases**:
- 50%, 200%에서 해당 방향 버튼 disabled
- 줌은 fontSize만 조정 (블록 레이아웃은 그대로 — 표/div는 상대 크기 유지)

---

## 4. 채팅 (AI) 인터랙션

### CHAT-01 메시지 전송
**Trigger**: 입력창에서 Enter 누름 (Shift 없이) 또는 전송 버튼 클릭
**Preconditions**:
- `chatInput.trim() !== ''`
- `isStreaming === false`
- `chatOpen === true` (패널 열림)

**System Response**:
1. 입력 텍스트를 `text`로 저장
2. 첫 API turn인지 확인 (`!messages.some(m => m.role === 'user')`)
3. `userContent` 생성:
   - 첫 turn: `"현재 문서 (...): {docContext}\n\n사용자 요청:\n{text}"`
   - 이후 turn: `text` 그대로
4. → `messages.push({ role: 'user', text, content: userContent })`
5. → `setChatInput('')`, `setIsStreaming(true)`, `setStreamingText('')`
6. API conversation 구성:
   - `messages` + 신규 user msg에서 `ui === 'static'` 제외
   - 각 msg의 `content || text`를 API의 `content`로 사용
7. `streamClaude(SYSTEM_DOC_EDITOR, apiMessages)` 호출
8. async iterator로 청크 수신:
   - → `fullText += chunk`
   - → `setStreamingText(fullText)`
   - ● `<StreamingMessage />` 가 실시간 누적 텍스트 표시 (JSON이면 "summary" 필드만 파싱해 보여줌)
   - ● 상태바 connection dot: emerald → indigo + pulse
9. 스트림 종료:
   - `extractJson(fullText)` 시도
   - 성공 시: summary와 edits 추출, edits 각각 `recordEdit()`로 history에 저장, pages에 반영
   - 실패 시: `assistantText = fullText` (plain text로 처리)
10. → `messages.push({ role: 'assistant', text: assistantText, content: fullText, edits: appliedEdits })`
11. → `setIsStreaming(false)`, `setStreamingText('')`
12. ● `flashSections(appliedEdits.map(e => e.pageId))` — 영향받은 페이지에 2.5초 인디고 ring
13. ● Chat 영역 자동 스크롤 (최하단)

**Edge Cases**:
- API 에러 발생: catch block → `messages.push({ isError: true, text: "오류..." })` + `setIsStreaming(false)`
- JSON 파싱 실패: raw text를 assistant text로 사용, edits는 빈 배열
- `edit.pageTitle`이 실제 페이지에 매칭 안 됨: 해당 edit 건너뜀 (계속 진행)
- 스트리밍 중 네트워크 끊김: 다음 reader.read()에서 예외 → catch에서 에러 메시지
- 빈 응답: `assistantText = '응답을 받았습니다.'` (fallback)

**Related**: CHAT-02, CHAT-03, EDIT-01

### CHAT-02 추천 프롬프트 클릭
**Trigger**: 채팅 영역의 SUGGESTIONS 버튼 클릭 (첫 메시지일 때만 노출)
**Preconditions**:
- `messages.length <= 1` (환영 메시지만 존재)
- `isStreaming === false`

**System Response**: CHAT-01과 동일 (`sendMessage(suggestion)` 호출)

**Edge Cases**:
- 첫 메시지 송신 후: 제안 목록 자동 숨김

### CHAT-03 채팅 패널 토글
**Trigger**: 헤더 AI 버튼 / Dock 마법봉 / 채팅 패널 닫기 버튼
**System Response**:
- `setChatOpen(!chatOpen)`
- ● 패널 너비 `w-[420px] ↔ w-0` (300ms 트랜지션)
- ● AI 버튼 시각 변경 (active 그라데이션 ↔ ghost)

**Edge Cases**:
- 스트리밍 중 패널 닫힘: 스트리밍은 계속 진행됨. 다시 열면 결과 보임.

### CHAT-04 대화 초기화
**Trigger**: 채팅 헤더의 휴지통 버튼 클릭
**System Response**:
- → `messages = [{ role: 'assistant', text: '대화를 초기화했습니다...', ui: 'static' }]`
- → `setShowDiff({})`
- ● 채팅 영역 비워지고 제안 목록 다시 노출됨

**Edge Cases**:
- 스트리밍 중 초기화: 현재 코드는 스트리밍을 중단시키지 않음 — 스트리밍 종료 시 새 초기화된 messages에 append되어 UI가 어색해짐. **개선 여지**: `isStreaming` 체크 후 disabled 또는 abortStreamRef 발동.
- history는 초기화되지 않음 (의도적) — 대화만 초기화, 편집 이력은 영구.

### CHAT-05 메시지 내 Diff 토글
**Trigger**: assistant 메시지의 edit 카드 "Diff" 버튼 클릭
**System Response**:
- `setShowDiff(s => ({ ...s, [msgIdx]: { ...(s[msgIdx] || {}), [ei]: !((s[msgIdx] || {})[ei]) } }))`
- ● 해당 edit의 DiffView 펼침/접힘

**Edge Cases**:
- 한 메시지에 edits가 여러 개 (멀티 페이지 편집): 각각 독립적으로 토글됨
- 되돌려진 edit의 diff도 계속 볼 수 있음 (diff 토글은 undo 상태와 무관)

### CHAT-06 메시지 내 되돌리기 / 다시 적용
**Trigger**: assistant 메시지의 edit 카드 "되돌리기" 또는 "다시 적용" 버튼
**System Response**: 상세는 HIST-02 참조

**Related**: HIST-02

---

## 5. 편집 인터랙션

### EDIT-01 페이지 단위 편집 적용 (AI 채팅 경유)
**Trigger**: CHAT-01의 결과로 발생
**System Response**:
- `parsed.edits` 배열의 각 항목에 대해:
  - `updatedPages.find(p => p.title === edit.pageTitle)` 매칭
  - `oldBody = target.body` 보관
  - `target.body = edit.newBody`
  - `recordEdit(target.id, oldBody, newBody, edit.rationale || '편집')` → historyId 반환
  - `appliedEdits.push({ historyId, pageId, oldBody, newBody, pageTitle })`
- → `setPages(updatedPages)`
- ● `flashSections(pageIds)` — 2.5초 ring

**Edge Cases**:
- `edit.newBody`가 undefined/null: 해당 edit 건너뜀
- `pageTitle` 매칭 실패: 건너뜀 (사용자에게 명시적 에러 없음 — 개선 여지)
- 멀티 페이지 업데이트의 원자성: 하나의 `setPages` 호출로 모두 반영 (React batching)

### EDIT-02 인라인 편집 트리거 (텍스트 드래그)
**Trigger**: 본문 블록에서 3글자 이상 텍스트 선택
**Preconditions**:
- 선택 영역이 `[data-block-id]` 속성을 가진 요소 내부
- 해당 블록의 type이 `p`, `lead`, `h2` 중 하나

**System Response**:
- selectionchange 이벤트 리스너가 감지
- 선택 영역의 bounding rect로 메뉴 위치 계산
- → `setSelectionMenu({ x, y, text, pageId, blockIdx })`
- ● `<InlineSelectionMenu />` 가 선택 영역 위에 floating으로 나타남
- 메뉴 위치 자동 보정: 화면 좌우 여백 16px 확보

**Edge Cases**:
- 3글자 미만 선택: 메뉴 숨김 (`setSelectionMenu(null)`)
- 여러 블록에 걸친 선택: `commonAncestorContainer`가 어느 블록에도 속하지 않아 메뉴 숨김
- 화면 바깥에서 드래그 시작: 좌표 보정으로 보이는 영역에 렌더링
- 빠른 선택 변경: 이벤트 리스너는 최신 선택만 반영

**Related**: EDIT-03

### EDIT-03 인라인 편집 액션 선택
**Trigger**: `<InlineSelectionMenu />`의 액션 버튼 (다시 쓰기/간결하게/영어로) `mousedown`
**Preconditions**: `selectionMenu`가 유효
**System Response**:
1. `e.preventDefault()` — mousedown에 preventDefault 꼭 호출 (포커스/선택 해제 방지)
2. → `setSelectionMenu(null)`, `window.getSelection()?.removeAllRanges()`
3. → `setInlineEditing({ status: 'loading', ... })`
4. ● 해당 블록이 `<InlineLoadingBlock />`으로 swap (원본 내용 회색으로 + sparkles 메시지)
5. `callClaudeOnce(SYSTEM_INLINE_EDITOR, userPrompt)` 호출 (non-streaming)
6. 응답 파싱: `extractJson(raw).newText`
7. → `setInlineEditing({ status: 'ready', suggestion, ... })`
8. ● 블록이 `<InlineCherryPickDiff />`로 swap

**Edge Cases**:
- API 에러: `setInlineEditing({ status: 'error', error })` → `<InlineErrorBlock />` 표시
- `newText`가 undefined: 원본 그대로 사용 (변경 없음으로 표시됨)
- 응답 중 사용자가 다른 블록 선택: 현재 inlineEditing은 하나뿐이므로 덮어씌움 (진행 중이던 거 취소)

**Related**: EDIT-04

### EDIT-04 Cherry-pick hunk 토글
**Trigger**: `<InlineCherryPickDiff />` 내의 del/add 버튼 클릭
**Preconditions**: `inlineEditing.status === 'ready'`
**System Response**:
- `toggleHunk(id)`: `acceptedIds` Set에서 해당 id 추가/제거
- ● 해당 hunk의 시각 상태 변경:
  - 수락: add 부분 `diffAddPick` (강조), del 부분 `diffDelInline opacity-50` (흐림)
  - 거부: add 부분 `diffAddInline opacity-40` (흐림), del 부분 `diffDelPick` (강조)
- ● "최종 결과" 미리보기 실시간 재계산 (`reconstructText(hunks, acceptedIds)`)
- ● 카운터 `(N/총M)` 업데이트

**Edge Cases**:
- "모두 거부" 클릭: `setAcceptedIds(new Set())` — 최종 결과 = 원본
- "모두 수락" 클릭: `setAcceptedIds(new Set(모든 change hunks))` — 최종 결과 = AI 제안 그대로
- 변경 hunk가 0개 (원본 == 제안): cherry-pick UI는 의미 없지만 렌더링은 됨 ("적용" 버튼 disabled)

### EDIT-05 Cherry-pick 적용
**Trigger**: `<InlineCherryPickDiff />`의 "적용" 버튼 클릭
**System Response**:
1. `finalText = reconstructText(hunks, acceptedIds)`
2. → `newBody = oldBody.map((b, i) => i === blockIdx ? { ...b, text: finalText } : b)`
3. → `setPages(prev => prev.map(p => p.id === pageId ? { ...p, body: newBody } : p))`
4. → `recordEdit(pageId, oldBody, newBody, "인라인: 다시 쓰기")` → historyId
5. → `messages.push({ role: 'user', text: '"{selectedText}" — 다시 쓰기', ui: 'inline' })`
6. → `messages.push({ role: 'assistant', text: '선택한 부분을 다시 쓰기 처리했습니다.', edits: [...], ui: 'inline' })`
7. → `setInlineEditing(null)` — 원래 Block 렌더링으로 복귀
8. ● `flashSections([pageId])`

**Edge Cases**:
- 최종 텍스트가 원본과 동일 (모두 거부): 여전히 history entry 생성됨 (old === new, 사용자에게는 어색할 수 있음 — 개선 여지)
- `inlineEditing.suggestion`만 쓰고 `finalText` 무시하는 호출: 현재 `acceptInlineEdit(finalText)` 또는 `acceptInlineEdit()`(undefined → suggestion 사용) 둘 다 허용

### EDIT-06 Cherry-pick 취소
**Trigger**: `<InlineCherryPickDiff />` 또는 `<InlineErrorBlock />`의 "취소" / X 버튼
**System Response**:
- → `setInlineEditing(null)`
- ● 원래 Block 렌더링으로 복귀, pages 변경 없음, history 변경 없음

---

## 6. History 인터랙션

### HIST-01 History 패널 토글
**Trigger**: 헤더의 "History" 버튼 클릭
**System Response**:
- `setHistoryOpen(!historyOpen)`
- ● 패널 너비 `w-80 ↔ w-0`
- ● 버튼 자체도 active 스타일로 변경

**Edge Cases**:
- 채팅 패널과 History 패널 둘 다 열면: 화면이 좁으면 겹쳐질 수 있음. 현재는 독립적으로 토글 (둘 다 열어둘 수 있음). 화면이 좁을 때 자동 정렬은 미구현.

### HIST-02 편집 엔트리 토글 (되돌리기 / 다시 적용)
**Trigger**: History 패널의 엔트리 버튼 또는 채팅 메시지 내 edit 카드 버튼
**Preconditions**: 해당 `historyId`가 history 배열에 존재
**System Response**:
1. `toggleEdit(historyId)`:
   - `entry = history.find(h => h.id === historyId)`
   - `targetBody = entry.undone ? entry.newBody : entry.oldBody`
   - → `setPages(prev => prev.map(p => p.id === entry.pageId ? { ...p, body: targetBody } : p))`
   - → `setHistory(h => h.map(x => x.id === historyId ? { ...x, undone: !x.undone } : x))`
2. ● `flashSections([entry.pageId])`
3. ● 채팅 edit 카드의 배지 "적용됨 ↔ 되돌려짐" 토글, 버튼 "되돌리기 ↔ 다시 적용" 토글
4. ● 카드 opacity 100% ↔ 60%
5. ● History 패널 노드도 동시 갱신 (그라데이션 ↔ 빈 원)

**Edge Cases**:
- 같은 페이지에 여러 연속 편집: 각 history 엔트리는 그 시점의 old/new만 기억하므로, 중간 엔트리만 되돌리면 "불일치" 상태가 될 수 있음.
  - 예: edit1 (A→B), edit2 (B→C) 순서로 적용 후 edit1 되돌리기 → 페이지는 A로 돌아감. 그런데 edit2 엔트리는 `oldBody=B, newBody=C`를 여전히 가짐. edit2의 "되돌리기"를 누르면 페이지가 `B`가 됨 (사용자 예상과 다를 수 있음).
  - **이는 의도된 동작**: "각 편집은 독립적으로 토글 가능"이라는 모델. 사용자가 이 모델을 이해한다고 가정. 향후 UI로 이 관계를 시각화하거나 경고 추가 고려.
- 되돌려진 엔트리의 Diff 토글: 여전히 가능 (diff는 old/new의 비교, undo 상태와 무관)

**Related**: HIST-03

### HIST-03 History 엔트리에서 페이지 점프
**Trigger**: History 패널 엔트리의 페이지명 클릭
**System Response**: `jumpToPage(entry.pageId)` → NAV-02와 동일

---

## 7. 외관 / 테마 인터랙션

### THEME-01 테마 전환
**Trigger**: 헤더의 `Sun` / `Moon` 버튼 클릭
**System Response**:
- `setTheme(th => th === 'dark' ? 'light' : 'dark')`
- ● 모든 컴포넌트가 `t = THEMES[theme]` 토큰을 재평가하여 300ms duration으로 색 전환
- ● 상태바 하단 `{theme}` 텍스트도 업데이트

**Edge Cases**:
- 전환 중 사용자 인터랙션: 레이아웃 변화 없음, 색만 변해 문제 없음
- 다크↔라이트 외 테마 (추후): 현재 토글은 두 테마만 순환

### THEME-02 Hover / Active 상태
모든 버튼은 `transition-colors` 기본 150ms. 스케일 애니메이션은 `hover:scale-110` 또는 `hover:scale-105` (주로 dock).

---

## 8. User Menu 인터랙션

### USER-01 메뉴 열기
**Trigger**: 헤더 우측 아바타 클릭
**System Response**:
- `setUserMenuOpen(o => !o)`
- ● 아바타에 `ring-zinc-600` (다크) / `ring-stone-300` (라이트) 추가
- ● 드롭다운 메뉴 페이드인 (absolute positioning, `right-0 top-full mt-2`)

### USER-02 메뉴 닫기 (외부 클릭)
**Trigger**: 메뉴 외부 임의 영역 mousedown
**Preconditions**: `userMenuOpen === true`
**System Response**:
- `menuRef.current.contains(e.target)` 체크 → false면 `setUserMenuOpen(false)`
- ● 메뉴 숨김, 아바타 ring 제거

**Edge Cases**:
- 메뉴 내부 클릭 (항목 선택 외): `contains()` true이므로 열린 상태 유지
- 메뉴 아이콘 자체 다시 클릭: useState 토글로 닫힘

### USER-03 메뉴 닫기 (Escape)
**Trigger**: `Escape` 키
**Preconditions**: `userMenuOpen === true`
**System Response**: `setUserMenuOpen(false)`

### USER-04 메뉴 항목 선택
**Trigger**: 메뉴 내 항목 클릭 (프로필/설정/단축키/플랜/도움말/로그아웃)
**System Response**:
- `handleSelect(id)` → 현재는 `console.log('user menu:', id)` + `setUserMenuOpen(false)`
- **추후**: 각 항목별 실제 라우팅/모달/액션 연결

---

## 9. 스트리밍 인터랙션

### STREAM-01 스트리밍 진행 중 표시
**Trigger**: `isStreaming === true`
**System Response**:
- ● `<StreamingMessage />` 표시:
  - 누적 `streamingText`에서 JSON이면 `"summary"` 필드만 파싱해 표시
  - 아직 summary 없으면 "응답 작성 중..."
  - 끝에 깜빡이는 커서 (`animate-pulse` 1.5 x 3.5 인디고)
  - 하단에 `N chars` 카운터
- ● 상태바 connection dot: emerald → indigo + `animate-pulse` + indigo glow
- ● 입력창 disabled, placeholder만 보임
- ● 전송 버튼 disabled

**Edge Cases**:
- 응답이 JSON 아닌 plain text: summary 추출 안 되어 raw text 그대로 스트리밍으로 표시됨
- 토큰이 띄엄띄엄 들어옴: 사용자 눈에는 자연스러운 타이핑처럼 보임 (단, 속도는 네트워크/서버 의존)

### STREAM-02 스트리밍 종료
**Trigger**: async iterator 완료 (`[DONE]` 또는 reader.done === true)
**System Response**:
- fullText 파싱 → edits 적용 (EDIT-01)
- → `setIsStreaming(false)`, `setStreamingText('')`
- ● `<StreamingMessage />` 제거
- ● 실제 `<ChatMessage />` (edits 카드 포함) 추가
- ● 상태바 connection dot: indigo → emerald

### STREAM-03 스트리밍 중단 (미구현)
**계획된 Trigger**: 사용자가 "중단" 버튼 클릭 또는 새 메시지 전송
**계획된 System Response**:
- `abortStreamRef.current = true`
- async generator의 `if (abortStreamRef.current) break`
- 현재까지 받은 텍스트로 메시지 생성 또는 완전 폐기
- **현재 UI에 중단 버튼 없음**. 추가 필요.

---

## 10. 에러 처리 인터랙션

### ERR-01 API 호출 실패
**발생 시점**: CHAT-01 또는 EDIT-03 중
**System Response**:
- catch block에서 → `messages.push({ role: 'assistant', text: '오류가 발생했습니다: ${err.message}', isError: true, ui: 'inline' })`
- 또는 (인라인 편집): `setInlineEditing({ status: 'error', error: err.message })`
- ● 메시지 아바타가 rose 배경 + AlertCircle 아이콘
- ● 메시지 텍스트도 rose 컬러
- ● 또는 `<InlineErrorBlock />`: 빨강 카드 + 닫기 X 버튼

**재시도**: 사용자가 다시 메시지 전송하면 됨. 자동 재시도 없음.

### ERR-02 JSON 파싱 실패
**발생 시점**: CHAT-01 응답 완료 후
**System Response**:
- `extractJson()` 2단계 시도 모두 실패
- `assistantText = fullText` (raw text 그대로)
- `edits = []`
- → 일반 assistant 메시지로 추가 (edits 카드 없음)

**Edge Cases**:
- 부분 JSON (스트리밍 중단된 응답): raw text로 폴백
- 마크다운으로 설명이 섞인 응답: JSON 부분만 추출 시도

### ERR-03 잘못된 페이지 이름 매칭
**발생 시점**: EDIT-01에서 `edit.pageTitle`이 실제 페이지에 매칭 안 됨
**System Response**: 해당 edit 건너뛰고 계속 진행. 사용자에게 명시적 알림 없음.

**개선 제안**: "매칭 실패: {pageTitle}" 토스트 또는 메시지 끝에 경고 추가.

---

## 11. 조합 시나리오 (복합 인터랙션)

### COMBO-01 멀티턴 편집 후 일부 되돌리기
1. CHAT-01: "예산 표에 비고 컬럼 추가" → edit1 적용
2. CHAT-01: "결론을 임팩트 있게" → edit2 적용 (멀티턴이므로 이전 맥락 유지)
3. CHAT-06: edit1 되돌리기 클릭
   - pages[Budget].body ← oldBody (비고 컬럼 제거됨)
   - edit1 엔트리 `undone: true`
   - edit2는 그대로 (Conclusion 강화된 상태 유지)
4. 결과: Budget은 원래대로, Conclusion은 새 버전

### COMBO-02 인라인 편집 후 전체 페이지 편집
1. EDIT-02~05: "사업 목적" 블록 일부 다시 쓰기 → 인라인 편집 적용 (history entry 1)
2. CHAT-01: "Overview 전체를 격식 있게" → edit으로 페이지 전체 재작성 (history entry 2)
3. COMBO-01의 모델에 따라, entry 1과 2는 독립적으로 토글 가능
4. entry 2 되돌리기: entry 1의 인라인 편집도 같이 사라짐 (entry 2의 `oldBody`는 entry 1 적용 후의 상태)

**주의**: 이는 예상과 다를 수 있음. 사용자는 "인라인 편집"과 "전체 편집"을 독립적인 것으로 생각할 수 있으나, 실제로는 시간순 레이어. 문서화 필요.

### COMBO-03 스트리밍 중 다른 편집 시도
1. CHAT-01 전송 → 스트리밍 진행 중
2. 사용자가 다른 블록 텍스트 드래그 → EDIT-02 메뉴 뜸
3. EDIT-03 액션 클릭 → `callClaudeOnce()` 병렬 호출
4. 현재 구현: 문제 없음. 두 API 호출이 독립적.
5. 인라인 편집이 먼저 완료되면 블록이 cherry-pick UI로 변함
6. 이후 스트리밍 완료되면 채팅 메시지에 edit 적용

**Edge Case**: 스트리밍 edit가 같은 블록을 건드리면 사용자 인라인 편집과 충돌. 현재는 나중 것이 덮어씀. 향후 "편집 중인 블록은 AI가 건드리지 않게" 가드 추가 가능.

---

## 12. 미구현 인터랙션 (향후)

| ID | 설명 | 우선도 |
|---|---|---|
| FILE-01 | .hwpx 파일 업로드 | P0 (MVP) |
| FILE-02 | Export to .hwpx / .pdf | P0 (MVP) |
| SEARCH-01 | ⌘K 검색 창 열기 | P1 |
| SEARCH-02 | 검색 결과로 하이라이트 + 점프 | P1 |
| KBD-01 | ? 키로 단축키 도움말 모달 | P2 |
| COLLAB-01 | 다른 사용자 커서 표시 | P2 (v2) |
| STREAM-03 | 스트리밍 중단 버튼 | P1 |
| TABLE-CHERRY | 표 셀 단위 cherry-pick 토글 | P1 |
| TOAST-01 | 에러/성공 토스트 알림 | P1 |

각 항목은 구현 시 이 문서에 정식 엔트리로 추가.
