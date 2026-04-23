# TEST_SPEC.md — Test Specification

이 문서는 HWPX Viewer의 **검증 가능한 테스트 시나리오**를 정의합니다. Given/When/Then 형식으로, 자동화 테스트(Vitest + Testing Library / Playwright)로 바로 변환 가능하게 작성되었습니다.

---

## 0. 테스트 전략

### 0.1 3단계 레이어

| 레이어 | 도구 | 범위 | 속도 |
|---|---|---|---|
| **Unit** | Vitest | 순수 함수 (diff, tokenize, extractJson) | <100ms |
| **Component** | Vitest + Testing Library | 개별 컴포넌트의 상태 변화 | <1s |
| **E2E** | Playwright | 전체 사용자 플로우 (mock API) | <30s |

### 0.2 Mock 전략

- **Unit/Component**: `fetch`를 전역 mock. 정해진 응답 반환.
- **E2E**: MSW (Mock Service Worker)로 `https://api.anthropic.com/v1/messages` 인터셉트. 시나리오별 고정 응답.
- **실제 API 호출 테스트**: 별도 smoke test 스위트, CI에서 선택적 실행 (비용 관리).

### 0.3 커버리지 목표

- 순수 함수 (diff 엔진, JSON 파싱): **95%+**
- 컴포넌트 상호작용: **80%+**
- E2E 핵심 플로우: **주요 경로 5개 이상**

### 0.4 Fixture 전략

재사용 가능한 테스트 데이터를 `tests/fixtures/`에 두기:

- `pages.fixture.ts` — 3~5 페이지 mock 문서
- `api-responses.fixture.ts` — JSON으로 저장된 Sonnet 4 응답 샘플 (성공/실패/멀티페이지/깨진JSON)
- `streams.fixture.ts` — SSE 청크 시퀀스 (정상/중단/에러)

---

## 1. Unit Tests — Diff 엔진

### 1.1 `tokenize()`

#### UT-01 영문 단어 분리
- **Given** 입력 `"Hello world"`
- **When** `tokenize(input)`
- **Then** 결과는 `["Hello", " ", "world"]`

#### UT-02 한글 단어 분리
- **Given** 입력 `"안녕하세요 반갑습니다"`
- **When** `tokenize(input)`
- **Then** 결과는 `["안녕하세요", " ", "반갑습니다"]`

#### UT-03 구두점 분리
- **Given** 입력 `"Hello, world!"`
- **When** `tokenize(input)`
- **Then** 결과는 `["Hello", ",", " ", "world", "!"]`

#### UT-04 혼합 (한/영/숫자/구두점)
- **Given** 입력 `"2026년 Q1 목표는 60%."`
- **When** `tokenize(input)`
- **Then** 결과에 `"2026"`, `"년"`, `" "`, `"Q1"`, `"60"`, `"%"`, `"."` 각각이 별개 토큰으로 포함됨

#### UT-05 공백 시퀀스
- **Given** 입력 `"a   b"` (공백 3개)
- **When** `tokenize(input)`
- **Then** 결과는 `["a", "   ", "b"]` (공백 시퀀스는 하나의 토큰)

#### UT-06 빈 문자열
- **Given** 입력 `""`
- **When** `tokenize(input)`
- **Then** 결과는 `[]`

---

### 1.2 `diffTokens()`

#### UT-10 동일 문자열
- **Given** `oldText = "안녕하세요"`, `newText = "안녕하세요"`
- **When** `diffTokens(oldText, newText)`
- **Then** 결과는 `[{type: 'eq', token: '안녕하세요'}]`

#### UT-11 단순 치환
- **Given** `oldText = "안녕하세요"`, `newText = "반갑습니다"`
- **When** `diffTokens(oldText, newText)`
- **Then** 결과에 `{type: 'del', token: '안녕하세요'}` + `{type: 'add', token: '반갑습니다'}` 포함

#### UT-12 중간 단어만 교체
- **Given** `oldText = "나는 학생이다"`, `newText = "나는 선생이다"`
- **When** `diffTokens(oldText, newText)`
- **Then** 결과는 `eq("나는 ")`, `del("학생")`, `add("선생")`, `eq("이다")` 형태 (세부 병합은 구현 의존)

#### UT-13 같은 타입 연속 병합
- **Given** `oldText = "ab"`, `newText = "xy"`
- **When** `diffTokens(oldText, newText)`
- **Then** del과 add가 각각 하나씩 (`del: "ab"`, `add: "xy"`), 개별 문자로 쪼개지지 않음

#### UT-14 완전 추가
- **Given** `oldText = ""`, `newText = "새로운 문장"`
- **When** `diffTokens(oldText, newText)`
- **Then** 결과는 `[{type: 'add', token: '새로운 문장'}]` (또는 토큰화 후 add들로 이루어진 시퀀스)

#### UT-15 완전 삭제
- **Given** `oldText = "삭제될 문장"`, `newText = ""`
- **When** `diffTokens(oldText, newText)`
- **Then** 결과는 del 토큰들로만 구성

---

### 1.3 `groupHunks()`

#### UT-20 변경 없는 텍스트
- **Given** `ops = [{type: 'eq', token: 'hello'}]`
- **When** `groupHunks(ops)`
- **Then** 결과는 `[{kind: 'eq', token: 'hello'}]`, change hunk 없음

#### UT-21 한 번의 변경
- **Given** `ops = [eq('a '), del('b'), add('c'), eq(' d')]`
- **When** `groupHunks(ops)`
- **Then** 결과는 `[eq('a '), {kind: 'change', id: 0, del: 'b', add: 'c'}, eq(' d')]`

#### UT-22 연속된 del+add를 하나의 change로
- **Given** `ops = [del('a'), del('b'), add('x'), add('y')]`
- **When** `groupHunks(ops)`
- **Then** 결과는 `[{kind: 'change', id: 0, del: 'ab', add: 'xy'}]`

#### UT-23 ID 단조 증가
- **Given** change가 3개인 ops
- **When** `groupHunks(ops)`
- **Then** change hunks의 id는 `0, 1, 2` 순서

---

### 1.4 `reconstructText()`

#### UT-30 모두 수락
- **Given** hunks = `[eq('a '), change(id=0, del='b', add='c'), eq(' d')]`, acceptedIds = `new Set([0])`
- **When** `reconstructText(hunks, acceptedIds)`
- **Then** 결과는 `"a c d"`

#### UT-31 모두 거부
- **Given** 위와 동일, acceptedIds = `new Set()`
- **When** `reconstructText(hunks, acceptedIds)`
- **Then** 결과는 `"a b d"`

#### UT-32 부분 수락
- **Given** change가 2개 (id=0, 1), acceptedIds = `new Set([0])` (첫 번째만 수락)
- **When** `reconstructText(hunks, acceptedIds)`
- **Then** 결과에 change 0은 `add`, change 1은 `del`이 반영됨

#### UT-33 eq 토큰 보존
- **Given** 여러 eq 토큰이 섞인 hunks
- **When** 어떤 acceptedIds 조합이든
- **Then** eq 토큰들은 항상 결과에 그대로 포함

---

### 1.5 `diffTable()`

#### UT-40 동일 표
- **Given** 같은 headers, 같은 rows인 두 표
- **When** `diffTable(old, new)`
- **Then** headerOps는 모두 `eq`, rowOps는 모두 `eq`

#### UT-41 행 추가
- **Given** old = 3 rows, new = 4 rows (마지막 행이 새로움)
- **When** `diffTable(old, new)`
- **Then** rowOps에 1개의 `add`, 3개의 `eq`

#### UT-42 행 삭제
- **Given** old = 3 rows, new = 2 rows (중간 행이 사라짐)
- **When** `diffTable(old, new)`
- **Then** rowOps에 1개의 `del`, 2개의 `eq`

#### UT-43 컬럼 추가
- **Given** old.headers = `['A', 'B']`, new.headers = `['A', 'B', 'C']`
- **When** `diffTable(old, new)`
- **Then** headerOps에 `eq('A'), eq('B'), add('C')`

#### UT-44 셀 내용 변경
- **Given** 같은 headers, 첫 컬럼(label)은 같고 두 번째 컬럼 값이 다른 한 행
- **When** `diffTable(old, new)`
- **Then** 해당 행의 rowOp.type === `'change'`, oldRow ≠ newRow

#### UT-45 행 순서 변경은 감지 안 됨 (알려진 한계)
- **Given** old = `[A, B]`, new = `[B, A]` (첫 컬럼 기준)
- **When** `diffTable(old, new)`
- **Then** 양쪽 행 모두 `eq`로 매칭됨 (순서만 바뀐 건 diff에 반영 안 됨). **이것이 의도된 동작임을 검증**.

---

### 1.6 `extractJson()`

#### UT-50 순수 JSON
- **Given** `text = '{"a":1}'`
- **When** `extractJson(text)`
- **Then** 결과는 `{a: 1}`

#### UT-51 코드 펜스 포함
- **Given** `text = '\`\`\`json\n{"a":1}\n\`\`\`'`
- **When** `extractJson(text)`
- **Then** 결과는 `{a: 1}`

#### UT-52 앞뒤 설명 텍스트 포함
- **Given** `text = '여기 결과입니다:\n{"a":1}\n끝.'`
- **When** `extractJson(text)`
- **Then** 결과는 `{a: 1}` (첫 `{` ~ 마지막 `}` 추출)

#### UT-53 잘못된 JSON
- **Given** `text = 'not json at all'`
- **When** `extractJson(text)`
- **Then** `Error('JSON parse failed')` 발생

#### UT-54 부분 JSON (스트리밍 끊김)
- **Given** `text = '{"a":1,'`
- **When** `extractJson(text)`
- **Then** `Error` 발생 (부분 파싱 지원 안 함)

---

## 2. Component Tests

Testing Library를 기준으로, 각 컴포넌트의 상태 변화를 검증.

### 2.1 `<HwpxViewer />` — 최상위 통합

#### CT-01 초기 렌더
- **Given** 앱 실행
- **When** `render(<HwpxViewer />)`
- **Then**
  - 다크 모드가 기본으로 적용됨 (`bg-zinc-950` 클래스 존재)
  - Cover 페이지(id=0)가 `currentPage`
  - 채팅 패널이 기본적으로 열려 있음 (`chatOpen=true`)
  - 사이드바가 기본적으로 열려 있음
  - 상태바에 "Cover" 표시, "0 edits", "0 turns"

#### CT-02 테마 전환
- **Given** 다크 모드
- **When** 헤더의 `Sun`/`Moon` 버튼 클릭
- **Then**
  - 최상위 컨테이너 배경이 `bg-stone-50`으로 변경
  - 상태바 하단 텍스트가 "light"로 변경

#### CT-03 사이드바 토글
- **Given** 사이드바 열림
- **When** 헤더 `PanelLeft` 버튼 클릭
- **Then** 사이드바 너비가 `w-0`으로 변경 (시각적으로 닫힘)

#### CT-04 페이지 점프
- **Given** Cover(id=0)가 currentPage
- **When** 사이드바에서 "Overview" 클릭
- **Then** `scrollIntoView`가 호출됨 (mock으로 검증)

---

### 2.2 `<InlineCherryPickDiff />`

#### CT-10 초기 상태 — 모두 수락
- **Given** `inlineEditing = { original: 'old', suggestion: 'new', ... status: 'ready' }`
- **When** 컴포넌트 렌더
- **Then**
  - 모든 change hunk가 `acceptedIds`에 포함됨 (초기 기본값)
  - 최종 결과 미리보기에 `'new'` 표시
  - 카운터 `(N/N)`

#### CT-11 hunk 토글
- **Given** 수락 상태의 hunk
- **When** 사용자가 해당 hunk 클릭
- **Then**
  - `acceptedIds`에서 제거됨
  - 최종 결과가 재계산되어 해당 부분은 원본(`old`)로
  - 카운터 `(N-1/N)`

#### CT-12 "모두 거부" 버튼
- **Given** 모두 수락 상태
- **When** "모두 거부" 클릭
- **Then**
  - `acceptedIds`가 빈 Set
  - 최종 결과 = 원본 텍스트

#### CT-13 "모두 수락" 버튼
- **Given** 모두 거부 상태
- **When** "모두 수락" 클릭
- **Then**
  - `acceptedIds`에 모든 change hunk id 포함
  - 최종 결과 = suggestion

#### CT-14 적용 버튼
- **Given** 일부만 수락된 상태
- **When** "적용" 클릭
- **Then**
  - `onAccept(finalText)` 콜백 호출, 인자는 재구성된 텍스트
  - 적용된 텍스트는 원본도 아니고 suggestion도 아닌, 중간 형태

#### CT-15 취소 버튼
- **Given** 임의 상태
- **When** "취소" 클릭
- **Then** `onReject()` 호출, pages/history는 변경 없음

---

### 2.3 `<HistoryPanel />`

#### CT-20 빈 상태
- **Given** `history = []`
- **When** 렌더
- **Then** "아직 편집 이력이 없습니다" 메시지 표시

#### CT-21 엔트리 렌더
- **Given** `history = [{id: 1, pageTitle: 'Budget', action: '...', undone: false, ts: Date.now() }]`
- **When** 렌더
- **Then**
  - "적용됨" 배지 + 그라데이션 노드
  - "되돌리기" 버튼 (rose 컬러)
  - "just now" 시간 표시

#### CT-22 되돌려진 엔트리
- **Given** `history = [{..., undone: true}]`
- **When** 렌더
- **Then**
  - "되돌려짐" 텍스트
  - opacity 60% (카드에 `opacity-60` 클래스)
  - "다시 적용" 버튼 (indigo 컬러)
  - 빈 원 노드

#### CT-23 엔트리 토글
- **Given** `undone: false`
- **When** "되돌리기" 버튼 클릭
- **Then** `onToggle(id)` 콜백 호출

#### CT-24 페이지 점프
- **Given** 엔트리 렌더됨
- **When** 엔트리 내 페이지명 버튼 클릭
- **Then** `onJumpToPage(pageId)` 콜백 호출

---

### 2.4 `<UserMenu />`

#### CT-30 닫힌 상태
- **Given** `userMenuOpen = false`
- **When** 렌더
- **Then**
  - 아바타만 보임
  - 드롭다운 메뉴 DOM에 없음

#### CT-31 열기
- **Given** 닫힌 상태
- **When** 아바타 클릭
- **Then** `setOpen(true)` 호출, 드롭다운 렌더

#### CT-32 외부 클릭으로 닫기
- **Given** 메뉴 열림
- **When** 메뉴 외부 임의 지점 mousedown
- **Then** `setOpen(false)` 호출

#### CT-33 Escape 키
- **Given** 메뉴 열림
- **When** `keydown` 이벤트 (key='Escape')
- **Then** `setOpen(false)`

#### CT-34 메뉴 항목 선택
- **Given** 메뉴 열림
- **When** "설정" 항목 클릭
- **Then**
  - `handleSelect('settings')` 호출 (현재 `console.log`)
  - 메뉴 닫힘

---

### 2.5 `<InlineSelectionMenu />`

#### CT-40 위치 자동 보정 (우측 초과)
- **Given** selection rect가 화면 오른쪽 끝에 가까움 (`x + rect.width/2 > window.innerWidth - 16`)
- **When** 렌더
- **Then** `adjustedX`가 화면 내부로 당겨짐

#### CT-41 액션 클릭
- **Given** 메뉴 렌더됨
- **When** "다시 쓰기" 버튼 mousedown
- **Then**
  - `e.preventDefault()` 호출됨 (선택 해제 방지)
  - `onAction({id: 'rewrite', ...})` 호출

---

## 3. E2E Tests (Playwright + MSW)

### 3.1 핵심 플로우

#### E2E-01 채팅 → 편집 → 되돌리기
1. **Given** 앱 로드, 채팅 패널 열림
2. **When** 사용자가 입력창에 "결론을 더 임팩트 있게 다시 써줘" 입력 후 Enter
3. **Then** API 호출이 `POST https://api.anthropic.com/v1/messages`로 발생, mock이 `edits: [{pageTitle: 'Conclusion', newBody: [...]}]` 응답
4. **Then** 스트리밍 UI가 표시됨 (pulse 커서)
5. **When** 스트리밍 종료
6. **Then**
   - assistant 메시지 카드가 렌더됨, 적용됨 배지 보임
   - Conclusion 페이지가 2.5초간 인디고 ring 하이라이트
   - Conclusion 본문 텍스트가 변경됨
   - History 패널 열면 새 엔트리 1개
7. **When** 메시지 카드의 "되돌리기" 클릭
8. **Then**
   - Conclusion 본문이 원래대로
   - 메시지 카드가 "되돌려짐" 배지로 변경, 60% opacity
   - 버튼이 "다시 적용"으로 변경
9. **When** "다시 적용" 클릭
10. **Then** Conclusion이 다시 변경된 상태로

#### E2E-02 인라인 편집 + cherry-pick
1. **Given** Overview 페이지 본문이 보이는 상태
2. **When** 사용자가 특정 문장의 중간 부분 단어를 드래그 선택
3. **Then** InlineSelectionMenu가 선택 영역 위에 floating으로 표시됨
4. **When** "다시 쓰기" 클릭
5. **Then**
   - 메뉴 사라짐
   - 해당 블록이 InlineLoadingBlock으로 변경 (sparkles + "Claude가 작성 중...")
6. **When** mock API 응답 도착
7. **Then** 블록이 InlineCherryPickDiff로 변경, 모든 change hunk가 초기에 수락 상태
8. **When** 사용자가 한 hunk를 클릭해 거부
9. **Then**
   - 해당 hunk의 del 부분이 강조되고 add 부분이 흐려짐
   - 최종 결과 미리보기가 부분적으로 원본 반영하여 업데이트
10. **When** "적용" 클릭
11. **Then**
    - 블록이 일반 Block 렌더링으로 복귀, 새 텍스트 반영
    - 채팅 패널에 user 메시지 `"선택된 부분" — 다시 쓰기` + assistant 메시지 쌍 추가
    - History 패널에 인라인 엔트리 1개

#### E2E-03 멀티 페이지 편집
1. **Given** 앱 로드
2. **When** "전체 문서 톤을 더 격식 있게 통일해줘" 전송
3. **Then** mock이 `edits: [...]`에 3개 페이지 대상 응답
4. **Then**
   - 채팅 메시지에 "멀티 페이지 편집 · 3개" 보라 배지
   - 3개의 페이지 카드가 메시지 아래 나란히 표시
   - 3개 페이지가 동시에 인디고 ring 하이라이트
   - 사이드바 미니어처 3개도 동시 하이라이트
5. **When** 첫 번째 페이지 카드의 "되돌리기" 클릭
6. **Then** 해당 페이지만 원래대로, 나머지 2개는 적용 상태 유지

#### E2E-04 멀티턴 대화
1. **Given** 앱 로드
2. **When** "예산 표에 비고 컬럼 추가" 전송 + 응답 수신
3. **Then** Budget 페이지에 비고 컬럼 추가됨, messages에 2개 (user + assistant)
4. **When** "비고 내용을 더 구체적으로 써줘" 전송 (이전 맥락 활용)
5. **Then**
   - API 호출 시 messages 배열에 이전 turn들이 모두 포함되어 전송됨
   - **assertion**: request body의 `messages.length === 3` (system prompt 외 3개: 이전 user, 이전 assistant, 신규 user)
   - 응답이 "비고"라는 단어를 인식하고 Budget 표의 비고 셀을 더 구체적으로 변경

#### E2E-05 스트리밍 중 UI 상태
1. **Given** 느린 mock 스트림 (청크마다 300ms 지연)
2. **When** 메시지 전송
3. **Then**
   - 즉시: 입력창 disabled, 전송 버튼 disabled
   - 상태바 connection dot이 indigo로 변경 + pulse
   - StreamingMessage 렌더됨, 누적 텍스트 실시간 업데이트
4. **When** 스트림 완료
5. **Then**
   - 입력창 다시 활성화
   - dot이 emerald로 복귀
   - StreamingMessage가 정식 ChatMessage로 교체됨

---

### 3.2 에러 시나리오

#### E2E-10 API 500 에러
1. **Given** mock이 모든 `/v1/messages` 요청에 500 응답
2. **When** 메시지 전송
3. **Then**
   - 에러 메시지가 assistant 버블에 표시 (rose 컬러, AlertCircle)
   - 스트리밍 상태 해제됨
   - 페이지는 변경 없음
   - history 추가 없음

#### E2E-11 JSON 파싱 실패
1. **Given** mock이 plain text 응답 `"죄송합니다 이해 못했어요"` 반환
2. **When** 메시지 전송
3. **Then**
   - 일반 assistant 메시지로 표시 (edits 카드 없음)
   - 에러 스타일 아님 (정상 응답으로 취급)
   - 페이지 변경 없음

#### E2E-12 잘못된 페이지 이름
1. **Given** mock이 `edits: [{pageTitle: 'NonExistent', newBody: [...]}]` 응답
2. **When** 메시지 전송
3. **Then**
   - 해당 edit는 건너뜀
   - assistant 메시지는 summary만 표시, edits 카드 없음
   - 페이지 변경 없음

---

### 3.3 접근성

#### E2E-20 키보드 내비게이션
1. **Given** 앱 로드
2. **When** Tab 키를 연속해서 누름
3. **Then** 포커스가 헤더 버튼 → 사이드바 → 본문 → dock → 채팅 입력창 순서로 이동 (의미 있는 순서)

#### E2E-21 Escape로 메뉴 닫기
1. **Given** User 메뉴 열림
2. **When** Escape 키 누름
3. **Then** 메뉴 닫힘

#### E2E-22 아이콘 버튼의 title 속성
1. **Given** 앱 로드
2. **When** 모든 아이콘 전용 버튼에 대해 DOM 검사
3. **Then** 각각 `title` 또는 `aria-label` 속성 있음

---

## 4. 성능 테스트

### 4.1 렌더 성능

#### PERF-01 50페이지 무한 스크롤
- **Given** 50개 content page가 있는 mock 문서
- **When** 사용자가 canvas를 빠르게 스크롤
- **Then** 초당 프레임 수(FPS) 55 이상 유지 (60fps 목표, 약간 여유)

#### PERF-02 대형 diff 계산
- **Given** 5,000자 텍스트 블록 2개 (old, new, ~30% 다름)
- **When** `diffTokens(old, new)` 호출
- **Then** 실행 시간 100ms 이하

### 4.2 메모리

#### PERF-10 50번 편집 후 메모리
- **Given** 앱 로드
- **When** 같은 페이지를 50번 연속 AI 편집 (각각 history entry 생성)
- **Then** 메모리 증가량 50MB 이하 (Chrome DevTools Performance로 측정)

---

## 5. 회귀 테스트 체크리스트

새 릴리스 전 수동 검증 항목. CI에 자동화되지 않는 것.

### 5.1 시각적 회귀
- [ ] 다크/라이트 모드에서 모든 패널이 의도된 색으로 렌더링
- [ ] 텍스트가 배경과 대비 충분
- [ ] Floating dock의 그림자가 두 모드 모두에서 보임
- [ ] 사이드바 미니어처 막대 색이 모드별 적절
- [ ] Diff 하이라이트 색이 구분 가능

### 5.2 인터랙션 회귀
- [ ] 채팅 패널 닫고 다시 열어도 메시지 보존됨
- [ ] 스크롤 spy가 정확한 페이지를 잡음 (끝 페이지 포함)
- [ ] 줌 변경이 캔버스에만 영향, 패널에는 영향 없음
- [ ] 사이드바 접은 상태에서 채팅 열기 가능
- [ ] Cover 페이지에서도 AI 편집 가능 (단, Cover는 편집 대상이 아님)

### 5.3 데이터 무결성
- [ ] 되돌리기 후 다시 적용해도 텍스트가 정확히 동일
- [ ] history 엔트리는 삭제되지 않음
- [ ] 멀티턴 대화에서 messages 순서 유지됨
- [ ] 인라인 편집이 다른 블록의 텍스트를 오염시키지 않음

### 5.4 엣지 케이스
- [ ] 빈 문자열 포함된 표 셀 렌더링
- [ ] 매우 긴 제목 (h1) 줄바꿈 처리
- [ ] 여러 줄 lead 문단
- [ ] 한 페이지에 표 여러 개
- [ ] 빈 body (h1만 있는 페이지)

---

## 6. 테스트 실행 매뉴얼 (구현 전 예시)

### 6.1 Vitest 설정

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
  },
});
```

### 6.2 MSW 핸들러 예시

```ts
// tests/mocks/handlers.ts
import { http, HttpResponse } from 'msw';

export const handlers = [
  http.post('https://api.anthropic.com/v1/messages', async ({ request }) => {
    const body = await request.json();
    // 시나리오별 분기
    if (body.messages[0].content.includes('결론')) {
      return HttpResponse.json({
        content: [{
          type: 'text',
          text: JSON.stringify({
            summary: '결론을 다시 썼습니다.',
            edits: [/* ... */],
          }),
        }],
      });
    }
    // 기본
    return HttpResponse.json({ content: [{ type: 'text', text: '{}' }] });
  }),
];
```

### 6.3 Playwright 설정

```ts
// playwright.config.ts
export default {
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
  },
  webServer: { command: 'npm run dev', port: 5173 },
};
```

---

## 7. 테스트되지 않는 것 (의도적)

- **실제 HWPX 파일 I/O** — 뷰어 범위 밖, pyhwpxlib 테스트 스위트의 책임
- **LLM 응답 품질** — "제안이 좋은가"는 prompt engineering의 영역, 별도 평가
- **실제 API 지연/토큰 비용** — 별도 smoke test / 관찰성 대시보드
- **브라우저 Back/Forward 동작** — 현재 라우팅이 없는 SPA
- **모바일 터치** — v1 범위 밖

---

## 8. 테스트 추가 가이드

새 기능을 추가할 때 **반드시** 다음 중 하나 이상의 테스트를 함께 작성:

1. 순수 함수면 → Unit test (UT-* 패턴)
2. 컴포넌트 상태 변화면 → Component test (CT-* 패턴)
3. 여러 컴포넌트에 걸친 플로우면 → E2E test (E2E-* 패턴)

테스트 ID는 순차 증가. 이 문서의 섹션별 번호 범위를 유지:

- `UT-01 ~ UT-99` — Unit
- `CT-01 ~ CT-99` — Component
- `E2E-01 ~ E2E-99` — End-to-end
- `PERF-01 ~` — Performance

각 테스트는 **Given / When / Then** 형식을 유지하고, 한 테스트는 한 가지만 검증.
