# HwpxViewer — Session State (2026-04-29 갱신)

다음 세션 시작 시 먼저 이 파일을 읽으세요.

## 최근 커밋 (origin/main 기준)

```
d88138e feat: Phase 2.6 (E) — placeholder 단락 삽입
0607bc9 chore: SESSION_STATE.md — pre-compact snapshot
fa28800 fix(web): page-settings gear — visible overlay
fa11618 feat(web): Phase 2.5 (D) — page settings panel
7c1a7d1 feat(web): Phase 2.2 (C) — page-level multi-select via Shift+click
```

`d88138e` 미푸시 가능성 — 다음 세션 시작시 `git push origin main` 한 번 확인.

## 완료된 작업 (Phase 2 진행률)

| Task | 내용 | 상태 |
|---|---|---|
| #21 | Phase 2.1 — Page boundaries (services/page_boundaries.py, GET /api/pages) | ✅ |
| #22 | Phase 2.2 (C) — 사이드바 Shift+클릭 → useSelection.selectPage | ✅ (단, BUG #28 보고됨) |
| #23 | Phase 2.5 (D) — 페이지 설정 패널 (PageSettingsPanel + ⚙ 버튼) | ✅ |
| #26 | Rule 8 — hwpx_patcher 가 lineseg textpos 자동 clamp (한컴 보안경고 회피) | ✅ |
| #29 | Phase 2.6 (E) — placeholder 단락 삽입 backend (POST /api/paragraphs/insert, rhwp split+insert+merge, hwpx_patcher kind="insert_paragraph") | ✅ |
| #30 | Phase 2.6 (E) — placeholder 단락 삽입 frontend (InlineSelectionMenu "단락 추가" 버튼 + App.tsx 핸들러) | ✅ |

## 대기 중인 Task (다음 세션 우선순위)

### #28 [HIGH] BUG: Shift+클릭 페이지 다중선택 동작 안함
- 사용자 보고: thumbnail Shift+클릭 시 selectPage 호출이 트리거 안 되거나 시각적 피드백 없음
- 진단 후보 4가지 (task description 참조):
  1. React 합성이벤트의 e.shiftKey 미수신 → onMouseDown 으로 전환
  2. useSelection.ts 의 dynamic import('@/api/document') 가 HMR 환경에서 깨짐 → 정적 import
  3. 백엔드 호출 에러가 silent (toast 미노출)
  4. cross-paragraph rect 빈 응답
- 진단 시작: 브라우저 DevTools → `__lastSelection` 객체 + Network 탭 `/api/pages/...` 호출 여부

### #27 [MEDIUM] 한컴오피스 2022 보안경고 미발생 검증
- 사용자(Lee Eun Mi) 환경에서만 가능한 검증
- 시나리오: 업로드 → 편집 → 저장 → 한컴 2022 에서 열기 → 보안경고 모달 발생 여부
- Rule 8 fix 코드 audit 은 PASS, 실환경 검증만 남음

### #24 [MEDIUM] Phase 2.3 (A) — Page AI rewrite
- POST /api/page-rewrite { uploadId, pageIndex, prompt }
- 페이지 모든 paragraph 텍스트 수집 → Claude 한 번 호출 (구조 보존 system prompt) → 다중 apply_edit 적용
- 프론트: 페이지 thumbnail 우클릭 또는 ⚙ 메뉴 확장 → "AI 다시 쓰기" → modal → 진행 → cherry-pick diff
- 의존: 기존 generate_worker 패턴 재사용

### #25 [LARGE] Phase 2.4 (B) — Page CRUD (insert/delete/duplicate/reorder)
- 가장 큰 작업
- 백엔드: services/page_ops.py — lxml 으로 `<hp:p>` array 슬라이스 + pageBreak 삽입
- 라우트: POST /api/pages/{uploadId}/{action} — insert/delete/duplicate/reorder
- 프론트: 사이드바 thumbnail context menu (우클릭) + drag-drop reorder
- 주의: HWPX 에 페이지 단위 구조 없음. paragraph 범위 + pageBreak 마커로 다룸

## 빠른 시작 (다음 세션)

```bash
# 1. 백엔드 (이미 떠있다면 PID 확인)
lsof -ti:8000 | xargs kill 2>/dev/null
cd /Users/leeeunmi/Projects/active/HwpxViewer/apps/backend
.venv/bin/uvicorn hwpx_viewer_api.main:app --reload --host 127.0.0.1 --port 8000

# 2. 프론트엔드 (이미 5174 에서 떠있을 가능성 큼)
lsof -nP -iTCP:5174 -sTCP:LISTEN  # 떠있으면 그대로 사용
cd /Users/leeeunmi/Projects/active/HwpxViewer && make dev

# 3. 사용자 샘플 파일
ls /Users/leeeunmi/Projects/active/HwpxViewer/전문가활용내역서_채움.hwpx
```

## 핵심 파일 위치

| 영역 | 경로 |
|---|---|
| 페이지 경계 + 메타 | `apps/backend/src/hwpx_viewer_api/services/page_boundaries.py` |
| 페이지 라우트 | `apps/backend/src/hwpx_viewer_api/routes/pages.py` |
| Rule 8 textpos clamp | `apps/backend/src/hwpx_viewer_api/services/hwpx_patcher.py` (`_clamp_paragraph_linesegs`) |
| useSelection.selectPage | `apps/web/src/hooks/useSelection.ts` (line 358 부근) |
| 페이지 설정 패널 | `apps/web/src/components/page-settings/PageSettingsPanel.tsx` |
| Page-settings ⚙ 버튼 | `apps/web/src/App.tsx` (sidebar thumbnail overlay) |
| API 클라이언트 | `apps/web/src/api/document.ts` (getPageBoundary, getPageDef, updatePageDef, insertParagraph) |
| 단락 삽입 (rhwp) | `apps/backend/.../services/rhwp_wasm.py` (split_paragraph, merge_paragraph, insert_paragraph) |
| 단락 삽입 (XML) | `apps/backend/.../services/hwpx_patcher.py` (`_apply_insert_paragraph`, `_build_empty_paragraph_clone`) |
| 단락 삽입 라우트 | `apps/backend/.../routes/edit.py` (POST /api/paragraphs/insert) |
| "단락 추가" 버튼 | `apps/web/src/components/inline/InlineSelectionMenu.tsx` (onInsertParagraph prop) |

## 알려진 디자인 결정

1. **HWPX 에 "페이지" 구조 단위 없음** — 페이지는 rhwp WASM 의 `getPositionOfPage` 로 (sec, paraStart) 추출, paraEnd 는 다음 페이지 start - 1
2. **page-def 는 per-section** — 한 페이지만 landscape 토글 불가, 같은 섹션 모든 페이지 동시 변경
3. **Rule 8 (한컴 보안경고)** — `<hp:lineseg textpos="N">` where N > UTF-16(text) 가 트리거. 편집 후 자동 clamp 로 해결
4. **rhwp WASM lock 비-재진입성** — `_call_json` 내부에서 이미 락 잡으니 외부 wrapper 에서 또 잡으면 deadlock (이전에 한 번 hit)
5. **graphify 통합** — `graphify-out/GRAPH_REPORT.md` 항상 최신. 코드 수정 후 `graphify update .` 로 incremental 갱신 (AST-only, 무료)

## 미해결 이슈 / 향후 고려

- pyhwpxlib `api.save` (HwpxDocument vs HWPXFile 인터페이스 불일치) — 현재 사용 안 함, lxml 기반 hwpx_patcher 로 대체
- rhwp WASM 업그레이드 — pyhwpxlib bundled 는 older. newer 빌드는 reflowLinesegs 등 자동 보정 보유. 큰 작업이라 보류 중

## 다음 세션 추천 순서

1. **#28 BUG fix** (1-2시간) — Shift+클릭 동작 확인 및 수정
2. **Phase 2.6 (E) 사용자 검증** — "단락 추가" 버튼 실사용해보고 placeholder UX
   리파인 (e.g. 자동 InlineManualEdit 진입, 시각적 hint)
3. **#27 한컴 2022 검증** (사용자 측, 5분) — 모달 미발생 확인
4. **#24 Phase 2.3 (A) AI rewrite** (반나절)
5. **#25 Phase 2.4 (B) CRUD** (1일+) — 이미 backend의 split/merge/insert가
   있어 delete/duplicate/reorder는 이를 재활용하면 빠름
