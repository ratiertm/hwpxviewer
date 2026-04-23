---
template: plan
version: 1.2
---

# hwpx-viewer-mvp Planning Document

> **Summary**: 프로토타입 v8(Artifacts 단일 파일, mock 데이터)을 **실제 HWPX 파일 I/O + 검색 + Export가 동작하는 웹 앱**으로 승격시켜 v1.0 MVP를 출시한다.
>
> **Project**: HWPX Viewer (`hwpx-viewer`)
> **Version**: 0.8 → 1.0.0 (MVP)
> **Author**: ratiertm@gmail.com / MindBuild
> **Date**: 2026-04-22
> **Status**: Draft (Plan 단계)

---

## 1. Overview

### 1.1 Purpose

한국 공공·기업 사용자가 **브라우저에서 .hwpx 파일을 열고, Claude와 대화하며 편집한 뒤, 다시 .hwpx로 저장**할 수 있게 한다. 프로토타입에 이미 구현된 AI co-editing UX(페이지 편집·인라인 cherry-pick·히스토리 토글)를 그대로 유지하면서, 지금까지 mock 데이터로 돌던 레이어를 실제 HWPX ↔ 블록 모델 변환 파이프라인으로 교체하는 것이 이 사이클의 본질이다.

### 1.2 Background

- PRD §1~§3: 한국 공공/SI 시장에서 HWPX는 사실상 표준이지만 웹 기반 + AI 협업 도구가 부재.
- 현재 `hwpx-viewer-v8.jsx`는 Artifacts 단일 파일 프로토타입으로, UX·스트리밍·diff·cherry-pick·history 모두 동작하지만 **실 파일 입출력이 없어 실사용 불가**.
- PRD §6에서 MVP 포함 범위로 이미 명시된 3개 항목이 아직 🟡(미구현): 실 HWPX I/O, 검색, Export.
- `pyhwpxlib`(MindBuild 생태계)가 파싱·직렬화를 담당하도록 이미 CLAUDE.md §2에서 선언 — 뷰어는 블록 모델만 다루는 원칙을 재확인.
- PRD §10 비즈니스 모델이 "공공/의료/법무 타겟, 온프레미스 옵션 중요"를 명시 → 외부 의존·데이터 유출 최소화가 아키텍처 결정의 제약조건.
- **M2 결정(2026-04)**: API 키 대신 `claude -p` CLI subprocess + 사용자 Claude Pro/Max OAuth 세션을 채택. 서버는 `ANTHROPIC_API_KEY`를 저장·주입하지 않고 호스트의 Claude Code 인증(`~/.claude/`)을 상속한다. 키 관리 리스크 제거, 구독 기반 과금, 온프레미스 배포 시 OAuth 세션을 secure mount로 전달하는 방식을 M8에 설계.

### 1.3 Related Documents

**정본(Source of Truth) — 재작성 금지, 참조만**

- `CLAUDE.md` — 운영 매뉴얼, NEVER/ALWAYS 규칙
- `docs/ARCHITECTURE.md` — 코드 구조, 상태·데이터 흐름 (블록 모델·history·messages 정의의 정본)
- `docs/COMPONENT_INVENTORY.md` — 컴포넌트·순수 함수·상수 목록, Props 계약
- `docs/PRD.md` — 제품 요구사항 (v1.0 MVP 범위 정의 포함)
- `docs/TEST_SPEC.md` — 검증 시나리오 (UT/CT/E2E 이미 정의됨)
- `docs/DESIGN_SPEC.md` — **Design System 정본**: Color tokens, Typography, Spacing, Radius, Shadows, Animation, 컴포넌트 시각 명세, Z-index, Iconography, Layout, 접근성
- `docs/INTERACTION_SPEC.md` — **Interaction 정본**: 단축키, 네비, 채팅, 편집, History, 테마, UserMenu, 스트리밍, 에러 처리

**이번 사이클 산출물 / 참조**

- `docs/02-design/features/hwpx-viewer-mvp.design.md` — **PDCA Implementation Design(이번 사이클 생성 예정)**. DESIGN_SPEC/INTERACTION_SPEC과 **층이 다름**: 시각·UX가 아닌 **구현 설계**(FastAPI 엔드포인트 계약, OWPML↔Block 변환 매핑, Zustand store, 모듈 의존 그래프, 빌드·배포). 두 정본 문서는 재작성하지 않고 참조만 하며, 이번 사이클에 추가되는 신규 시각 요소/인터랙션은 **델타 PR**로 두 정본에 병합한다.
- `docs/01-plan/conventions.md` — Convention 문서(Phase 2 산출물, 이번 사이클에 신규 작성 예정)
- `hwpx-viewer-v8.jsx` — 현재 프로토타입 (1,712줄 단일 파일)
- 외부: `pyhwpxlib` (MindBuild) — HWPX OWPML 파서/직렬화 라이브러리

**문서 층 구분 요약**

| 층 | 문서 | 내용 | 이번 사이클에서 |
|---|---|---|---|
| 시각 | `DESIGN_SPEC.md` | UI 토큰·컴포넌트 시각 | 정본 참조 + 신규 요소(업로드 dropzone, 검색 패널, export 버튼) 델타 추가 |
| UX | `INTERACTION_SPEC.md` | 사용자 액션 ↔ 시스템 반응 | 정본 참조 + 신규 플로우(드래그앤드롭, `Cmd+K` 검색, 저장 확인, 복구) 델타 추가 |
| 구현 | `docs/02-design/features/hwpx-viewer-mvp.design.md` | **백엔드·변환·스토어·빌드** 중심 기술 설계 | 신규 작성 |

---

## 2. Scope

### 2.1 In Scope (MVP v1.0에 반드시 포함)

- [ ] **S-1. 프로젝트 기반 전환** — Artifacts 단일 파일 → Vite + React + TypeScript 프로젝트로 이관. 단일 파일 컴포넌트를 `docs/COMPONENT_INVENTORY.md`가 제시한 구조대로 분리.
- [ ] **S-2. 블록 모델 타입 확정** — `src/types/index.ts`로 Page/Block/HistoryEntry/Message/Theme 등 TS 타입 고정. 런타임 검증용 zod 스키마도 동반.
- [ ] **S-3. 순수 함수 모듈화** — `tokenize/diffTokens/groupHunks/reconstructText/diffTable/reconstructTable/extractJson`을 `src/lib/diff/`·`src/api/` 로 분리, Vitest 단위 테스트(UT-01~UT-54) 모두 통과.
- [ ] **S-4. HWPX I/O 백엔드** — pyhwpxlib를 감싸는 Python FastAPI 서비스. 엔드포인트: `POST /api/import` (.hwpx → Block[]), `POST /api/export` (Block[] → .hwpx). 로컬 실행 가능한 docker-compose 포함.
- [ ] **S-5. 변환 레이어(owpml ↔ blocks)** — Python 측에 `hwpx_viewer_bridge/converter.py`. 처음에는 h1/h2/lead/p/table만 지원, 그 외는 가장 가까운 블록 타입으로 degrade + 원본 XML을 passthrough로 보존.
- [ ] **S-6. 파일 업로드/다운로드 UX** — 헤더 좌측 "파일" 버튼으로 `.hwpx` 업로드, 헤더 우측 기존 Download 버튼을 실제 동작(.hwpx 저장)으로 연결. 진행률·에러 토스트.
- [ ] **S-7. 검색 기능** — 헤더 검색 버튼(현재 placeholder)을 활성화. 블록 텍스트 전체 스캔, 결과 리스트 + 해당 페이지/블록으로 스크롤 + in-block 하이라이트. 표 셀 포함.
- [ ] **S-8. Export to PDF** — 브라우저 `window.print()` 기반 CSS print stylesheet + 페이지 구분 고정. 서버 사이드(Headless Chromium) 옵션은 v1.5로 미룸.
- [ ] **S-9. History 타임라인 완성(US-10)** — HistoryPanel의 필터/페이지 점프/토글이 모두 실동작, 현재 미완 액션 제거.
- [ ] **S-10. Claude CLI 래퍼** — 서버(FastAPI)가 `claude -p` subprocess를 asyncio로 호출해 사용자 OAuth 세션(Claude Pro/Max)으로 Anthropic에 도달. 서버는 API 키를 저장·주입하지 않으며 subprocess env에서 `ANTHROPIC_API_KEY`를 명시적으로 strip. 프론트는 `/api/claude/stream`·`/api/claude/once`만 호출(SSE 포맷은 Anthropic 원형과 동일해 프로토타입 파서 재사용).
- [ ] **S-11. 테스트 파이프라인** — Vitest(Unit/Component) + Playwright(E2E) 설정. TEST_SPEC에 정의된 UT/CT/E2E 핵심 시나리오 자동화. 커버리지 게이트: 순수 함수 95%, 컴포넌트 80%, E2E 5개 이상 통과.
- [ ] **S-12. 로컬 배포 번들** — `docker-compose up`으로 2개 서비스(`web` Nginx + `backend` FastAPI + pyhwpxlib + `claude` CLI(호스트 `~/.claude` read-only bind mount))가 한 번에 기동되는 구성. Claude 프록시는 backend 이미지 안에 녹아있는 subprocess라 별도 서비스 아님.
- [ ] **S-13. 문서 정비** — 이 Plan → Design(`docs/02-design/features/hwpx-viewer-mvp.design.md`) 작성, ARCHITECTURE/COMPONENT_INVENTORY 파일 분리 후 업데이트, CLAUDE.md의 Artifacts 전용 제약(localStorage 금지 등)을 "프로토타입 조건"으로 명시하고 MVP 조건으로 갱신.

### 2.2 Out of Scope (의도적으로 이번 사이클 제외)

- 실시간 협업(Yjs/presence/multi-cursor) — v2.0
- 모바일 편집 — v2.0 (읽기는 v1.5)
- 템플릿 라이브러리(정부 양식 10종) — v1.5
- 권한/감사 로그·SSO·온프레미스 배포 옵션 — Enterprise(v2.0+)
- 임베드 SDK(iframe/웹 컴포넌트) — v2.0+
- 표 셀 단위 cherry-pick(US-11) — 시각화는 유지, 실 토글은 v1.5 (복잡도 대비 효용 낮음, 시각화만으로 대부분 케이스 커버)
- 토큰 비용 자동 요약/압축 — 5 turn 넘어가면 안내만, v1.5
- 스트리밍 중단 버튼(AbortController 완성) — v1.1 소규모 릴리스
- Python 백엔드 없는 WASM/Pyodide 경로 — 평가만 진행, 구현은 v2.0
- 새 블록 타입(quote/code/image/footnote 등) — 현재 5개 타입 유지

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | 사용자는 `.hwpx` 파일을 업로드하면 3초 이내에 첫 페이지가 렌더되어야 한다 (5MB 이하 문서 기준). | High | Pending |
| FR-02 | pyhwpxlib로 파싱한 결과가 뷰어의 Block 모델로 변환되어 h1/h2/lead/p/table 블록이 올바르게 표시되어야 한다. | High | Pending |
| FR-03 | 지원하지 않는 OWPML 요소는 손실 없이 passthrough 저장되어, 저장 시 원본과 동일한 XML로 재생성되어야 한다(round-trip 무결성). **단, 편집된 섹션은 Design §5.3 제약에 따라 passthrough 재정렬이 불가능할 수 있어 해당 섹션에 한해 일부 서식이 단순화될 수 있음.** 수용 기준: 편집되지 않은 섹션 100% 무결, 편집된 섹션 평균 `unsupportedBlockCount` 손실 20% 이하. | High | Pending |
| FR-04 | 편집 후 Download 버튼으로 내려받은 `.hwpx` 파일이 한컴오피스에서 오류 없이 열려야 한다. | High | Pending |
| FR-05 | AI 편집·인라인 편집·cherry-pick·history 토글 동작이 프로토타입과 **동일하게** 유지되어야 한다 (회귀 금지). | High | Pending |
| FR-06 | 검색창에 단어 입력 시 전체 문서에서 일치 블록을 목록화하고, 클릭 시 해당 위치로 스크롤 + 하이라이트. | High | Pending |
| FR-07 | Export → PDF 시 페이지 구분과 표 테두리가 보존되고 AI 편집 하이라이트는 제외되어야 한다. | Medium | Pending |
| FR-08 | Claude API 키는 클라이언트 번들에 절대 포함되지 않아야 한다 (서버 프록시 경유). | High | Pending |
| FR-09 | HistoryPanel에서 엔트리 토글 → pages 반영, 페이지 점프가 모두 동작해야 한다(US-10 완성). | Medium | Pending |
| FR-10 | 업로드 실패/변환 실패/네트워크 끊김 시 사용자에게 원인·복구방법 표기 토스트를 보여주어야 한다. | Medium | Pending |
| FR-11 | 로컬에서 `docker-compose up` 한 번으로 전체 스택이 기동되어야 한다. | Medium | Pending |
| FR-12 | UI의 모든 기존 NEVER/ALWAYS 규칙(`CLAUDE.md §2`)은 그대로 유지된다 (immutable pages, history 비삭제, 등). | High | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| Performance — 초기 표시 | LCP 1.5s 이하(캐시 후), 업로드 → 렌더 3s 이하(5MB 문서) | Lighthouse, 수동 측정, CI smoke test |
| Performance — AI 첫 토큰 | TTFB 3s 이하 | `streamClaude` 진입점 타임스탬프 로그 |
| Performance — Diff 계산 | 5,000자 블록에서 `diffTokens` 100ms 이하 | Vitest bench (`bench.ts`) |
| Performance — 스크롤 | 50페이지 문서에서 60fps 유지(최소 55fps) | Chrome DevTools Performance, Playwright trace |
| Memory | 50번 편집 후 힙 증가량 < 50MB | Chrome DevTools Performance (수동) |
| Round-trip 무결성 | 10종 샘플 HWPX 로드 → 저장 → diff 결과 시맨틱 동등 (텍스트·표 구조 일치) | Python 회귀 스크립트 (`tests/roundtrip/`) |
| 접근성 | 키보드 내비게이션 모든 핵심 액션 가능, focus ring, aria-label | Playwright 접근성 smoke(E2E-20~22) + axe-core 보조 |
| 브라우저 지원 | 최신 Chrome/Edge/Safari/Firefox 2개 메이저 버전 | Playwright cross-browser |
| 보안 | Claude는 OAuth 세션만 사용(서버에 API 키 없음) + subprocess env에서 `ANTHROPIC_API_KEY` strip, OWASP Top 10 체크, 업로드 파일 MIME/확장자 화이트리스트, `~/.claude/` 권한 0600, slowapi rate limit 부착(M8) | `security-architect` 에이전트 점검, 보안 리뷰 체크리스트 |
| i18n | UI 한/영, 콘텐츠 한국어 우선 | lint check: 하드코딩 문자열 리뷰 |
| 번들 크기 | 초기 JS 번들 < 350KB gzip(Claude SDK 제외) | Vite bundle analyzer |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] FR-01~FR-12 모두 구현 완료, TEST_SPEC의 UT/CT/E2E 시나리오가 CI에서 통과
- [ ] Round-trip 무결성 테스트: `tests/roundtrip/fixtures/` 10종 샘플이 모두 시맨틱 동등으로 통과
- [ ] 프로토타입 `hwpx-viewer-v8.jsx`의 기능(페이지 편집·인라인·cherry-pick·history) 회귀 0건 (E2E-01~05 전부 녹색)
- [ ] 새 구조대로 파일 분리 완료 (`COMPONENT_INVENTORY.md §17` P0·P1 리팩토링 항목 종결)
- [ ] `docker-compose up` 한 번으로 2개 서비스(`web`, `backend`) 모두 health check 통과. backend 이미지 안에 `claude` CLI가 설치되고 호스트 OAuth 세션(`~/.claude`)이 read-only bind mount로 주입된다.
- [ ] Design(`docs/02-design/features/hwpx-viewer-mvp.design.md`) 작성, 리뷰 완료
- [ ] Gap Analysis Match Rate ≥ 90% (`/pdca analyze hwpx-viewer-mvp`)
- [ ] 완성 리포트(`/pdca report hwpx-viewer-mvp`) 발행
- [ ] CLAUDE.md의 Artifacts 제약 조항이 "프로토타입 시기 제약"으로 주석 갱신

### 4.2 Quality Criteria

- [ ] 순수 함수 테스트 커버리지 ≥ 95%
- [ ] 컴포넌트 테스트 커버리지 ≥ 80%
- [ ] ESLint 0 error, TypeScript `--strict` 통과
- [ ] Playwright 핵심 플로우 5개 이상 녹색 (E2E-01, 02, 03, 04, 05)
- [ ] 보안 체크리스트(업로드 검증, CSP, API 키 프록시) 모두 통과
- [ ] 빌드 성공 + 프로덕션 번들 실제 열람 동작 확인

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| pyhwpxlib가 실사용 HWPX의 일부 요소를 파싱하지 못함 | High | Medium | 변환 레이어에 passthrough 원본 XML 슬롯 설계(FR-03). 실패 시 해당 블록을 읽기 전용으로 표시하되 편집·저장은 가능. 상용 양식 10종을 early fixture로 확보해 주 단위로 회귀. |
| Round-trip에서 공백/속성 차이로 한컴오피스가 파일을 거부 | High | Medium | 샘플 10종을 한컴오피스에서 수동 열람으로 매주 검증. 차이 발생 시 변환 레이어 수정, pyhwpxlib 쪽 이슈면 upstream. |
| Artifacts → Vite 이전 중 state 관리 실수로 `pages` 불변성 깨짐 | High | Low | TypeScript `readonly` + Zustand의 immer 미들웨어 또는 구조적 복사만 사용하는 얇은 store. PR별 `docs/ARCHITECTURE.md §3` 상태 체크리스트 실행. |
| ~~Claude API 키 프록시 설계 실수로 키 유출~~ (M2에서 OAuth 전환으로 소멸) | — | — | v1.0 적용 안 됨. 서버가 API 키를 저장하지 않음. 번들 grep은 여전히 negative check로 유지. |
| OAuth 세션 파일(`~/.claude/`) 권한/공유 실수 — 멀티 인스턴스 배포 시 세션 격리 실패 | Medium | Low | `~/.claude/` 권한 0600, 컨테이너에서는 secret-mount(read-only), 멀티 인스턴스 배포는 v1.5+에 sticky-session 또는 per-user OAuth 전략으로 설계. |
| `claude` CLI 업그레이드로 stream-json 출력 포맷 회귀 | Medium | Low | `claude --version` 허용 범위를 백엔드 readyz에서 체크하고, stream_event.event 스키마가 Anthropic SSE와 어긋나는 순간 감지하도록 smoke 테스트 추가(M8). |
| 단일 파일 → 다중 파일 분리 중 diff/history 동작 회귀 | High | Medium | 분리 작업은 S-3(순수 함수) → S-2(타입) → 컴포넌트 순으로 **각 단계마다** TEST_SPEC 회귀 녹색 유지. Playwright E2E-01을 smoke로 모든 PR에서 실행. |
| 대용량 문서(>50 페이지)에서 Block 모델 메모리/렌더 성능 저하 | Medium | Medium | 가상화(`@tanstack/react-virtual`) 도입을 Design 단계 결정으로 미룸(일단 50페이지까지만 공식 지원). 프로파일링 후 필요 시 v1.1에 추가. |
| 백엔드 도입으로 "로컬 전용·온프레 지향" 원칙과 충돌 | Medium | Low | 모든 백엔드 서비스는 localhost docker-compose로 기동 가능. 외부 호스팅 버전도 동일 아티팩트. 문서 외부 전송은 Claude 프록시 경유만, 문서 원본 HWPX는 Claude로 보내지 않고 블록 JSON만 전송(기존 설계 유지). |
| 검색 결과 하이라이트가 표 셀 내부에서 깨짐 | Low | Medium | 블록 타입별 하이라이트 핸들러 분리, 표는 헤더/셀 레벨로 별도 처리. TEST_SPEC에 표 검색 케이스 추가. |
| Playwright + SSE mock 난이도 | Medium | Medium | MSW가 fetch SSE 지원. 이미 TEST_SPEC §6.2에 handler 샘플 있음. 필요 시 Node 쪽 라우트 스터브로 대체. |
| 토큰 비용 — 대화 길어지면 API 비용 폭증 | Medium | High(시간 경과) | 우선 경고 배너만(5 turn 초과 시 "오래된 turn은 요약 권장"). 자동 요약은 v1.5. |

---

## 6. Architecture Considerations

### 6.1 Project Level Selection

| Level | Characteristics | Recommended For | Selected |
|-------|-----------------|-----------------|:--------:|
| Starter | 단순 구조 (`components/`, `lib/`) | 정적 사이트 | ☐ |
| **Dynamic** | **feature-based 모듈, 백엔드 통합** | **프론트+백엔드가 공존하는 웹앱** | **☑** |
| Enterprise | Strict layer separation, DI, 마이크로서비스 | 대규모 트래픽, 복잡 아키텍처 | ☐ |

**선정 이유**: MVP는 Python FastAPI 백엔드 1개 + React 프론트 1개로 구성되는 전형적인 fullstack 웹앱. 공공/의료/법무 온프레미스 요건이 있으므로 BaaS(bkend.ai)가 아닌 **Custom Server(FastAPI)**를 쓴다 — 이는 Dynamic 레벨의 변형. 마이크로서비스·DDD 분리까지는 불필요(Enterprise 과도).

### 6.2 Key Architectural Decisions

| Decision | Options | Selected | Rationale |
|----------|---------|----------|-----------|
| Frontend Framework | Next.js / Vite+React / Remix | **Vite + React + TS** | Next.js의 SSR/라우팅 장점 < 무거움·Artifacts→Vite 마이그레이션이 더 단순. API 프록시는 FastAPI에 합치면 됨. |
| State Management | Context / **Zustand** / Redux / Jotai | **Zustand + immer** | ARCHITECTURE.md §3 상태 17개를 하나의 store로 묶기 적합, immer로 immutability 보장. |
| API Client | **fetch** / axios / react-query | **fetch (native) + SWR 선택** | 프로토타입과 일관, SSE 스트리밍을 이미 fetch로 처리 중. SWR은 검색·history 정적 데이터에 한해 고려. |
| Form / Input | react-hook-form / native | **native** | textarea 1개, 복잡 폼 없음. |
| Styling | **Tailwind** / CSS Modules | **Tailwind (JIT 활성)** | 프로토타입과 일관. Artifacts 시기 제약(임의 클래스 금지)은 **해제**되어 `text-[13px]` 등 사용 가능해지지만, 토큰 일관성을 위해 `THEMES`를 CSS 변수로 승격해 `bg-[var(--bg)]`는 사용하되 `bg-[#xxx]`는 여전히 금지. |
| Testing | Jest / **Vitest** + Playwright | **Vitest + Playwright** | TEST_SPEC §6이 이미 Vitest 기준으로 작성됨. |
| Backend | BaaS (bkend.ai) / **Custom Server** / Serverless | **Custom Server: FastAPI + Python 3.11** | pyhwpxlib가 Python. 온프레미스 가능해야 함. |
| Backend Arch | 단일 서비스 / 프록시 분리 | **단일 FastAPI (HWPX 변환 + `claude` CLI subprocess 오케스트레이션 한 프로세스)** | MVP 단계 단순성. v1.5에 필요 시 분리. |
| LLM Bridge | httpx 직접 호출 / **CLI subprocess** / SDK | **`claude -p` CLI subprocess (OAuth)** | API 키 저장 회피. 사용자 Claude Pro/Max 구독 활용. stream-json → Anthropic SSE relay. |
| Package Manager | npm / **pnpm** / yarn | **pnpm** | 빠르고 디스크 효율, 최근 관행. |
| Bundler | **Vite** | Vite | 빠른 HMR, TS 기본 지원. |
| Deployment | Vercel / Netlify / **self-host (docker-compose)** | **docker-compose** | 온프레미스 제약. 외부 호스팅도 같은 이미지로 가능. |
| Python dep mgmt | pip+requirements.txt / **uv** / poetry | **uv** | 빠르고 pyproject.toml 기본. |

### 6.3 Clean Architecture Approach

```
Selected Level: Dynamic (Custom Server variant)

Repository Layout:
┌─────────────────────────────────────────────────────────┐
│ hwpx-viewer/                                            │
│ ├─ apps/                                                │
│ │  ├─ web/                   # Vite + React + TS        │
│ │  │  └─ src/                                           │
│ │  │     ├─ App.tsx          # HwpxViewer root          │
│ │  │     ├─ components/      # layout, canvas, chat,    │
│ │  │     │                   #   history, inline, diff  │
│ │  │     ├─ features/        # hwpx-io, search, export  │
│ │  │     ├─ hooks/           # useScrollSpy, …          │
│ │  │     ├─ lib/             # diff/text, diff/table    │
│ │  │     ├─ api/             # claude.ts, hwpx.ts       │
│ │  │     ├─ state/           # zustand store            │
│ │  │     ├─ theme/           # tokens.ts (from THEMES)  │
│ │  │     ├─ types/           # index.ts + zod schemas   │
│ │  │     └─ data/            # INLINE_ACTIONS, …        │
│ │  └─ backend/               # FastAPI + pyhwpxlib      │
│ │     └─ hwpx_viewer_api/                               │
│ │        ├─ main.py          # FastAPI app              │
│ │        ├─ routes/          # import, export, claude   │
│ │        ├─ converter/       # owpml ↔ blocks           │
│ │        ├─ services/        # claude_cli, upload_store │
│ │        └─ security/        # upload validation, CORS  │
│ ├─ tests/                                               │
│ │  ├─ web/                   # vitest + playwright      │
│ │  └─ roundtrip/             # fixtures + py scripts    │
│ ├─ docker-compose.yml                                   │
│ ├─ Dockerfile.web · Dockerfile.backend                  │
│ ├─ pnpm-workspace.yaml                                  │
│ └─ docs/ (기존 구조 유지)                               │
└─────────────────────────────────────────────────────────┘
```

### 6.4 모듈 의존 원칙

- **뷰어는 HWPX를 모른다** — `src/api/hwpx.ts`가 유일한 접점, 백엔드의 `/api/import` · `/api/export`만 호출. 이 원칙은 `CLAUDE.md §2`의 "HWPX XML을 직접 생성/파싱 금지"를 이관 후에도 강제.
- **Claude API 키는 어디에도 없음** — `src/api/claude.ts`는 `/api/claude/stream`·`/api/claude/once`만 호출. 서버는 `claude -p` subprocess를 기동하며 자체 OAuth 세션을 쓰고, subprocess env에서 `ANTHROPIC_API_KEY`를 제거하여 OAuth 경로를 강제한다.
- **순수 함수는 어디서든 import 가능** — diff 엔진, extractJson. 컴포넌트·스토어·훅 방향으로만 의존 흐름.

---

## 7. Convention Prerequisites

### 7.1 Existing Project Conventions

- [x] `CLAUDE.md` — 운영 매뉴얼, NEVER/ALWAYS 규칙 (존재, §2)
- [ ] `docs/01-plan/conventions.md` (Phase 2) — **없음, Design 단계에서 작성 권장**
- [ ] `CONVENTIONS.md` at project root — 없음
- [ ] ESLint/Prettier/TypeScript config — 없음 (Artifacts라 불필요했음). **MVP에서 모두 신규 추가**
- [x] 도메인 어휘 사전 — `CLAUDE.md §5`에 존재
- [x] 테스트 명세 — `docs/TEST_SPEC.md`

### 7.2 Conventions to Define/Verify (MVP에서 신규 작성)

| Category | Current State | To Define | Priority |
|----------|---------------|-----------|:--------:|
| 파일/폴더 네이밍 | 없음 | `COMPONENT_INVENTORY.md §1` 레포 구조 채택, 컴포넌트 PascalCase, 훅 camelCase(`use*`), 라이브러리 함수 camelCase, 타입 PascalCase | High |
| Import 순서 | 없음 | react → 외부 → `@/types` → `@/lib` → `@/api` → `@/state` → `@/components` → 상대경로 | Medium |
| 컴포넌트 Props | 없음 | `t: Theme` + `theme: 'dark' \| 'light'` props 필수 (COMPONENT_INVENTORY §16 규칙 유지) | High |
| Error handling | 프로토타입에선 console.error + UI 토스트 혼재 | `AppError` 베이스 + `toast()` 훅, API 에러는 status code → UI 문구 테이블 | High |
| 커밋 메시지 | 없음 | Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`) | Medium |
| Branch 전략 | 없음 | `main` 보호, `feat/*` feature 브랜치, Squash merge | Medium |
| 테마 토큰 사용 | 프로토타입에서 일관 (`THEMES[theme]`) | CSS 변수 + Tailwind 플러그인 기반으로 승격, 임의 헥스 금지 재확인 | High |
| 환경 변수 | 없음 | 아래 §7.3 | High |
| 로깅 | 없음 | 백엔드 JSON 로그(structlog), 프론트는 개발환경 console, 프로덕션은 Sentry 선택 | Medium |

### 7.3 Environment Variables Needed

| Variable | Purpose | Scope | Status |
|----------|---------|-------|:------:|
| `CLAUDE_CLI_PATH` | `claude` CLI 바이너리 경로 (기본 `claude`) | Server | ☑ (M2) |
| `CLAUDE_MODEL` | `claude -p --model` 인자: alias(`sonnet`/`opus`) 또는 full slug | Server | ☑ (M2) |
| `STREAM_MAX_TOKENS` | (선택) 스트리밍 응답 최대 토큰 (기본 4000) | Server | ☐ |
| `ONCE_MAX_TOKENS` | (선택) once 응답 최대 토큰 (기본 1500) | Server | ☐ |
| `VITE_API_BASE_URL` | 프론트가 호출할 백엔드 URL (dev는 Vite proxy 경유) | Client build-time | ☑ (M1) |
| `CORS_ALLOWED_ORIGINS` | 프로덕션 Origin 화이트리스트 (콤마 구분) | Server | ☑ (M2) |
| `MAX_UPLOAD_MB` | 업로드 파일 크기 제한 (기본 20) | Server | ☑ (M3) |
| `LOG_LEVEL` | 서버 로그 레벨 | Server | ☑ (M2) |
| `SENTRY_DSN` | (선택) 에러 추적 | Server/Client | ☐ (v1.1) |

**전제**: 백엔드 호스트에 `claude` CLI 설치 + `claude auth` 로 OAuth 세션 생성 완료되어 있어야 한다(`~/.claude/`에 토큰 보관). 컨테이너 배포 시 이 디렉터리를 read-only secret mount로 전달.

~~`ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL`~~ — M2에서 제거됨. 서버는 Anthropic API 키를 받지도 저장하지도 않으며, subprocess env에서 `ANTHROPIC_API_KEY`가 있으면 strip 한다.

### 7.4 Pipeline Integration

이 프로젝트는 bkit 9-phase Development Pipeline을 전면 채택하지 않지만, 일부 단계를 참조해 문서를 채운다.

| Phase | Status | Document Location | Command |
|-------|:------:|-------------------|---------|
| Phase 1 (Schema) | 부분 — ARCHITECTURE.md §2 데이터 모델 | `docs/ARCHITECTURE.md` | 참조만 |
| Phase 2 (Convention) | **이 MVP 사이클 산출물로 생성** | `docs/01-plan/conventions.md` | Design 단계에서 초안 |
| Phase 4 (API) | FastAPI 엔드포인트 계약 | Design 단계에 작성 | — |
| Phase 6 (UI Integration) | 이미 프로토타입에 존재, 재연결 | — | — |
| Phase 9 (Deployment) | docker-compose 구성 | Design 단계 상세 | — |

---

## 8. Work Breakdown Preview (Design 단계에서 세분화)

상위 순서만 제시 — Design 문서에서 모듈·파일 단위 태스크와 의존 그래프로 확정한다.

1. **M1 Foundation (1~2주)** — Vite+TS 프로젝트 부트스트랩, 타입/순수함수/테스트 이관 (S-1, S-2, S-3, S-11)
2. **M2 Backend bootstrap (1주)** — FastAPI 뼈대, Claude 프록시, 업로드 검증 (S-4 뼈대, S-10, S-12)
3. **M3 HWPX round-trip (2~3주)** — pyhwpxlib 연결, converter h1/h2/lead/p/table 지원, passthrough, 10종 샘플 회귀 (S-4, S-5, FR-02/03/04)
4. **M4 UX wiring (1주)** — 업로드/다운로드 UI, 진행률·에러 토스트 (S-6, FR-10)
5. **M5 Search (1주)** — 검색 UI·스크롤·하이라이트 (S-7, FR-06)
6. **M6 Export PDF (0.5주)** — print stylesheet, 편집 하이라이트 제거 모드 (S-8, FR-07)
7. **M7 History 완성 (0.5주)** — US-10 미완 액션 정리 (S-9, FR-09)
8. **M8 Hardening (1주)** — 보안·접근성·회귀 테스트·문서 정비 (S-13, 보안 체크리스트, Gap analysis 반영)

총 예상: 8~10주 (1인 기준). 병렬화·리뷰 포함 시 조정.

---

## 9. Next Steps

1. [ ] 본 Plan 리뷰 및 합의 (사용자 확인 후 확정)
2. [ ] **Design 문서 작성 — `/pdca design hwpx-viewer-mvp`** (범위: *구현 설계 + 정본 델타만*. 시각·UX 재작성 금지)
   - (a) 신규 작성 — 이번 사이클에서 처음 나오는 영역:
     - FastAPI 엔드포인트 스펙 (request/response/error 코드, 보안 검증)
     - converter(OWPML ↔ Block) 매핑 테이블 + passthrough 규칙
     - Zustand store 슬라이스 구조 (pages/history/messages/ui/inline)
     - 모듈 의존 그래프와 파일 이관 순서 (COMPONENT_INVENTORY §15 타입 적용)
     - Vite 빌드 설정, docker-compose, CI 파이프라인
   - (b) 정본 참조만 — 재작성 금지:
     - 기존 컴포넌트의 시각 규격 → `DESIGN_SPEC.md §2~§8` 참조
     - 기존 인터랙션 → `INTERACTION_SPEC.md §2~§11` 참조
     - 기존 컴포넌트 Props 계약 → `COMPONENT_INVENTORY.md` 참조
   - (c) 델타 PR — 정본에 새 항목 추가:
     - `DESIGN_SPEC.md §8` 컴포넌트 시각 명세에 추가: 파일 업로드 dropzone, 업로드 진행 배너, 검색 결과 패널, export 버튼 상태, round-trip 에러 토스트
     - `INTERACTION_SPEC.md`에 추가: 파일 드래그앤드롭, `Cmd+K` 검색, 검색 결과 점프, 저장 확인 다이얼로그, round-trip 실패 복구 플로우
     - `COMPONENT_INVENTORY.md`에 추가: 새 컴포넌트(`FileUploader`, `SearchPanel`, `ExportMenu`, `ToastHost`) 엔트리
3. [ ] Convention 문서 초안 `docs/01-plan/conventions.md` (Phase 2)
4. [ ] 구현 시작 — `/pdca do hwpx-viewer-mvp`
5. [ ] 단계별 Gap 분석 (M3 round-trip 완료·M7 History 완성 시점에 중간 `/pdca analyze` 권장)

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-04-22 | Initial draft — 프로토타입 → MVP v1.0 스코프 정의, S-1~S-13 / FR-01~FR-12 / M1~M8 정리 | ratiertm@gmail.com |
