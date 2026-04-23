# CLAUDE.md

이 파일은 Claude Code, Cursor, Gemini 등 AI 코딩 에이전트가 이 저장소에서 작업할 때 **가장 먼저 읽어야 하는 운영 매뉴얼**입니다. 작업 시작 전 반드시 이 문서와 `docs/ARCHITECTURE.md`를 먼저 확인하십시오.

---

## 1. 프로젝트 정체성

**이름**: HWPX Viewer (codename: `hwpx-viewer`)
**소속**: MindBuild / pyhwpxlib 생태계
**목적**: HWPX(한컴 한글 OWPML) 문서를 웹에서 보고, AI(Claude Sonnet 4)와 대화하며 편집하는 뷰어/에디터.
**현재 단계**: MVP 전환 중 (2026-04). 프로토타입(`hwpx-viewer-v8.jsx`, Artifacts mock)은 reference로 보존 중. MVP 스택은 `apps/web`(Vite+React+TS, M1 완료) + `apps/backend`(FastAPI + `claude -p` CLI OAuth, M2 완료). M3(pyhwpxlib round-trip) 착수 대기. 진척 상세는 `docs/02-design/features/hwpx-viewer-mvp.do.md` §2 M-milestone 테이블 참조.

이 프로젝트는 단순한 "문서 뷰어"가 아닙니다. 핵심 차별점은 다음 세 가지이며, 모든 의사결정은 이 우선순위를 따릅니다.

1. **AI co-editing이 일급 시민** — 채팅, 인라인 메뉴, diff, cherry-pick은 부가 기능이 아니라 핵심.
2. **변경의 가시성과 가역성** — 모든 편집은 history에 기록되고, 언제든 되돌리거나 다시 적용할 수 있어야 함.
3. **격식 있는 한국어 공공/기업 문서 톤** — UI는 모던하되, 콘텐츠는 한국 공공 문서 양식을 존중.

---

## 2. 절대 규칙 (NEVER / ALWAYS)

> **주의 — 전환기 상태 (2026-04, M2 완료 시점)**: 이 프로젝트는 프로토타입(`claude.ai/artifacts`, 단일 파일) → MVP(`apps/web` + `apps/backend`) 이전 중입니다. 아래 NEVER 항목의 일부는 Artifacts 시기의 샌드박스 제약에서 유래했고 MVP 환경에서는 재분류가 필요합니다. **M8 #32에서 최종 분류 확정 예정.** 그 전까지는 다음을 기준으로 판단하십시오.
>
> - 핵심 데이터 규칙(상태 mutate 금지, history 삭제 금지, HWPX XML 직접 파싱 금지, API 키 하드코딩 금지, 테마 토큰 우회 금지)은 **모두 유지**.
> - Artifacts 샌드박스 제약(임의 Tailwind 클래스, localStorage, 외부 CDN)은 **문서화된 대체 규칙**으로 MVP에서도 사실상 유지되나, 근거가 바뀜(`Vite JIT` · `CSP` · `bg-[var(--..)]` CSS 변수). 자세한 대체 규칙은 `docs/02-design/features/hwpx-viewer-mvp.do.md` §5.3 참조.
> - API 키 규칙은 **강화**됨: M2에서 API 키 자체를 사용하지 않고 `claude -p` CLI OAuth로 전환. 서버는 키를 저장·로드·주입하지 않는다.

### NEVER

- **상태(state)에서 페이지를 직접 mutate하지 마십시오.** 항상 immutable 업데이트 (`setPages(prev => prev.map(...))`, Zustand는 `immer` 경유).
- **history 엔트리를 삭제하지 마십시오.** 되돌리기는 `undone: true` 플래그로 처리하며, 엔트리 자체는 영구 보존.
- **API 키나 secret을 코드·환경변수에 하드코딩하지 마십시오.** M2 이후 이 프로젝트는 `ANTHROPIC_API_KEY`를 아예 사용하지 않는다(`claude -p` subprocess + 호스트 OAuth 세션). 서버 subprocess env에서 `ANTHROPIC_API_KEY`를 오히려 strip 한다. 외부 호스팅 배포 시에도 `~/.claude/`는 read-only bind mount로 런타임에만 주입.
- **HWPX XML을 직접 생성하거나 파싱하는 코드를 작성하지 마십시오.** 이는 별도 라이브러리 `pyhwpxlib`의 책임(`apps/backend/.../converter/*`). 뷰어(프론트)는 정규화된 JSON 블록 모델만 다룬다.
- **임의 Tailwind 클래스 중 색·여백 해시값(`bg-[#0a0a0a]`, `text-[#666]`)을 쓰지 마십시오.** 색·간격은 반드시 테마 토큰 경유(`bg-bg`, `bg-[var(--..)]`). 수치만 지정하는 `text-[13px]` 같은 arbitrary value는 MVP의 Vite JIT에서 허용되지만, 신규 색 토큰은 `docs/DESIGN_SPEC.md` §2 + `apps/web/src/index.css` CSS 변수에 먼저 추가.
- **`localStorage`, `sessionStorage`, 다른 브라우저 storage API를 사용하지 마십시오.** MVP에서도 금지 유지(CSP 및 온프레미스/공공 데이터 흔적 최소화 원칙). 필요한 영속 상태는 서버 endpoint로 보내 저장.
- **fetch 외부 CDN, 외부 폰트, 외부 스크립트를 사용하지 마십시오.** CSP `connect-src 'self'` 유지. 폰트는 OS 시스템 폰트(Apple SD Gothic Neo·Noto Sans KR·맑은 고딕) 스택만 사용.
- **`text-zinc-300` 같은 raw Tailwind 색을 무지성으로 쓰지 마십시오.** 항상 의미 토큰을 통해 접근 — 프로토타입은 `THEMES[theme]` 객체, MVP는 `bg-bg`·`text-text-strong` 등의 semantic utility(`tailwind.config.ts`에서 CSS 변수로 매핑). 다크/라이트 모두에서 작동해야 함.

### ALWAYS

- **모든 편집은 `recordEdit()`을 통해 history에 기록**하고, 반환된 `historyId`를 메시지에 첨부.
- **API 응답은 `extractJson()`을 통해 파싱.** 직접 `JSON.parse`하지 말 것 (코드 펜스 처리 누락).
- **테마 토큰은 `THEMES[theme]` 객체에서만 가져옴.** 새 토큰 추가 시 `dark`와 `light` 양쪽에 동시에 추가.
- **새 컴포넌트는 `t`(theme tokens)와 `theme` ('dark' | 'light')를 props로 받음.**
- **사용자 입력 텍스트는 `whitespace-pre-wrap`으로 렌더.** 줄바꿈 보존.
- **편집이 적용되면 `flashSections()`을 호출**해 영향받은 페이지를 시각적으로 하이라이트.
- **모든 외부 클릭으로 닫히는 UI(드롭다운, 메뉴)는 `mousedown` + `Escape` 키 두 개를 모두 listen.**
- **textarea의 Enter는 전송, Shift+Enter는 줄바꿈.** 일관성 유지.

---

## 3. 작업 시작 전 체크리스트

새 기능을 추가하거나 기존 동작을 수정하기 전, 다음을 확인하십시오:

- [ ] `docs/ARCHITECTURE.md`에서 영향받는 모듈/상태/데이터 흐름을 파악했는가?
- [ ] 변경이 데이터 모델(블록 타입, 페이지 구조)에 영향을 미치는가? 미친다면 마이그레이션 영향 검토.
- [ ] 변경이 history/undo/redo와 호환되는가?
- [ ] 변경이 멀티턴 대화 컨텍스트와 호환되는가? (assistant message의 `content` 필드 형식 변경 시 주의)
- [ ] 다크/라이트 모드 양쪽에서 작동하는가?
- [ ] 새 의존성을 추가하지 않았는가? (Artifacts에서 사용 가능한 라이브러리: `react`, `lucide-react`, `recharts`, `lodash`, `d3` 등 — 상세는 Artifacts 문서 참조. 외부 CDN 추가 금지.)

---

## 4. 작업 흐름 (이 순서로 진행)

1. **읽기**: `CLAUDE.md` (이 파일) → `docs/ARCHITECTURE.md` → 작업과 관련된 컴포넌트 코드.
2. **계획**: 사용자에게 **무엇을 어떻게 바꿀지** 짧게 요약하고, 영향받는 파일/함수 목록 제시.
3. **구현**: 한 번에 한 가지 책임만. 거대한 단일 변경보다 작은 변경 여러 개 선호.
4. **검증**: `docs/TEST_SPEC.md`(존재 시)의 관련 시나리오를 머릿속으로 통과시킨 후, 코드에서 실제로 작동할지 검토.
5. **보고**: 변경 사항 요약 + 알려진 트레이드오프 + 다음 후보 작업 제시.

---

## 5. 도메인 어휘 사전

이 프로젝트에서 자주 쓰이는 용어는 **반드시 이 정의를 따릅니다**. 다른 의미로 쓰지 말 것.

| 용어 | 정의 |
|---|---|
| **page** | 문서의 한 섹션. `id`, `title`, `section`(번호 문자열), 그리고 `body`(블록 배열) 또는 `isCover: true` 플래그를 가짐. |
| **block** | 페이지를 구성하는 최소 콘텐츠 단위. `type`은 `'h1' | 'h2' | 'lead' | 'p' | 'table'` 중 하나. |
| **table block** | `{ type: 'table', headers: string[], rows: string[][] }` 형태. 첫 컬럼은 행 키(label) 역할. |
| **edit** | 한 페이지에 적용된 한 번의 변경. `{ historyId, pageId, oldBody, newBody, pageTitle }`. |
| **history entry** | history에 저장된 영구 레코드. 되돌려져도 삭제되지 않고 `undone: true`로 유지. |
| **hunk** | LCS diff에서 연속된 변경 덩어리. cherry-pick의 단위. `{ kind: 'change', id, del, add }` 또는 `{ kind: 'eq', token }`. |
| **inline editing** | 본문에서 텍스트를 드래그 → AI 메뉴 → 부분 수정. 페이지 단위 편집과 구별됨. |
| **streaming text** | API 응답이 SSE로 들어오는 동안 누적되는 raw 텍스트. JSON 파싱은 완료 후. |
| **multi-turn** | 같은 채팅 세션 내 여러 user/assistant 교환. API 호출 시 모든 turn을 messages 배열로 전송. |
| **flash** | 편집된 페이지에 2.5초간 인디고 ring 표시. `flashSections([pageIds])`로 트리거. |

---

## 6. 사용자 의도와 자주 헷갈리는 것

**"편집해줘"** 는 페이지 전체 재작성이 아닐 수 있습니다. 사용자가 일부 추가만 원했다면, 기존 블록을 보존하고 끝에 새 블록만 추가하는 것이 맞습니다. 시스템 프롬프트(`SYSTEM_DOC_EDITOR`)는 이 점을 강조하고 있으나, 모델이 종종 페이지 전체를 새로 씁니다 — 이때 diff가 과도하게 커지므로, 가능하면 명시적으로 "추가만" / "재작성" 의도를 prompt에 반영하도록 유도하십시오.

**"멀티 페이지"** 는 사용자가 그렇게 말했거나 "전체"를 명시했을 때만. 한 페이지 요청에 두 페이지를 건드리지 마십시오.

**"되돌리기"** 는 그 시점의 변경 하나만 되돌립니다. 그 이후 변경들은 그대로 유지됩니다 (선형 undo가 아닌, 각 편집의 독립적 토글). 이는 의도된 설계입니다.

---

## 7. 금지된 변경 (사용자 명시 요청 없이는 절대 하지 말 것)

- 데이터 모델 마이그레이션 (블록 타입 추가/삭제)
- history 데이터 구조 변경
- THEMES 객체에서 키 이름 변경 (값 추가는 OK)
- API 시스템 프롬프트 (`SYSTEM_DOC_EDITOR`, `SYSTEM_INLINE_EDITOR`) 의미 변경
- localStorage 등 차단된 API 도입
- 다크모드 제거 / 라이트모드 제거

---

## 8. 자주 받는 요청 vs 권장 응답

| 사용자 요청 | 적절한 접근 |
|---|---|
| "더 예쁘게" | 색/타이포 변경 전에 어떤 톤(미니멀/매거진/브루탈 등)을 원하는지 확인. |
| "버그 고쳐줘" | 재현 시나리오 먼저 확인. 그 후 어떤 컴포넌트의 어느 함수가 원인인지 명시. |
| "기능 추가" | `docs/ARCHITECTURE.md`에서 비슷한 기존 패턴 확인 → 그 패턴에 맞춰 구현. 새 패턴 도입은 트레이드오프 명시. |
| "리팩토링" | 무엇을, 왜, 어떤 위험이 있는지 먼저 사용자와 합의. |
| "테스트 추가" | `docs/TEST_SPEC.md`의 시나리오를 자동화 형식으로 변환 (Vitest/Playwright). |

---

## 9. 응답 스타일

- **한국어**가 기본. 사용자가 영어로 물으면 영어로.
- 답변은 **짧게**. 코드 변경 후에는 무엇을 바꿨는지 bullet으로 3–5개.
- **추측하지 말 것.** 모르는 것은 사용자에게 묻거나, 코드를 직접 읽어보고 답변.
- 큰 변경 전에는 **트레이드오프**를 명시. (예: "표 셀별 토글은 가능하나 reconstructTable에 머지 로직 추가 필요. 시각화만 우선 할까요?")

---

## 10. 참조 문서

- `docs/ARCHITECTURE.md` — 코드 구조, 상태, 데이터 흐름
- `docs/PRD.md` — 제품 요구사항 (작성 예정)
- `docs/DESIGN_SPEC.md` — 디자인 토큰, 컴포넌트 시각 명세 (작성 예정)
- `docs/INTERACTION_SPEC.md` — 사용자 액션과 시스템 반응 (작성 예정)
- `docs/TEST_SPEC.md` — 검증 가능한 시나리오 (작성 예정)
- `docs/COMPONENT_INVENTORY.md` — 파일/컴포넌트 목록 (작성 예정)

작업 시작 전 위 문서 중 작업과 관련된 것을 먼저 읽으십시오.
