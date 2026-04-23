---
template: analysis
version: 1.0
---

# hwpx-viewer-mvp Gap Analysis

> **Summary**: PageBreakBlock 타입 추가 이후 Design-Implementation 일관성 재검증. Match Rate **98%** (96% 초기 검증 + GAP-PB-01 즉시 수정).
>
> **Project**: HWPX Viewer (`hwpx-viewer`)
> **Phase**: Check (PDCA)
> **Date**: 2026-04-23
> **Reviewer**: bkit:gap-detector
> **Previous Match Rate**: 94% (M2 doc_sync_round_2)
> **Current Match Rate**: 98%

---

## 1. 재검증 배경

설계 검증 중 발견된 이슈로 `PageBreakBlock` 타입을 설계 및 구현에 동시 추가했다. 이 변경이 기존 Match Rate 94%를 유지/개선하는지, 새로운 gap을 유발하지 않는지 확인이 필요했다.

### 1.1 변경 범위 (6개 파일)

**설계 문서 (3)**
- `docs/COMPONENT_INVENTORY.md` §15 — Block union + PageBreakBlock 정의
- `docs/02-design/features/hwpx-viewer-mvp.design.md` §3.1 (TS+Pydantic), §5.1 (매핑 테이블)
- `apps/web/src/types/index.ts` — Frontend 타입

**구현 코드 (3)**
- `apps/backend/src/hwpx_viewer_api/schemas.py` — Pydantic discriminated union 확장
- `apps/backend/src/hwpx_viewer_api/converter/overlay_to_blocks.py` — import 경로 감지
- `apps/backend/src/hwpx_viewer_api/converter/blocks_to_overlay.py` — export 경로 역변환

---

## 2. 검증 결과

### 2.1 합격 항목 (4/5)

| # | 검증 항목 | 결과 | 근거 |
|---|---|---|---|
| 1 | 설계-구현 일관성 | ✅ PASS | 6개 파일 전반에 `PageBreakBlock { type: 'pageBreak' }` 일치 |
| 2 | Discriminator 정합성 | ✅ PASS | `schemas.py:86`에 `Annotated[Union[...], Field(discriminator="type")]` |
| 3 | Round-trip 무결성 | ✅ PASS | overlay_to_blocks → blocks_to_overlay 대칭 로직 + `apply_overlay` passthrough |
| 4 | Frontend/Backend 미러링 | ✅ PASS | TS `{ type: 'pageBreak' }` ↔ Pydantic `Literal["pageBreak"]` |
| 5 | 기존 Match Rate 유지 | ✅ PASS | 94% → 96% (개선) |

### 2.2 신규 발견 Gap

#### 🟡 GAP-PB-01 (MEDIUM) — 즉시 수정됨

- **위치**: `docs/02-design/features/hwpx-viewer-mvp.design.md` §5.1 매핑 테이블 L436
- **문제**: `<hs:sec>` 행 비고에 *"섹션 내부의 `page_break`는 … Block 모델에서는 무시"* 문구가 잔존. 같은 테이블 L441에 새로 추가된 `PageBreakBlock` 매핑 행과 내부 모순.
- **영향**: 문서 독자가 matrix 내 상충 정보로 혼란 가능. 코드 동작에는 영향 없음.
- **수정**: L436 비고를 *"Page 경계가 되지 않고, 대신 본문에 `PageBreakBlock`으로 기록됨 (아래 행 참조)"*으로 교체.
- **수정 결과**: Match Rate 96% → **98%**

---

## 3. Match Rate 산정

| 영역 | 가중치 | 점수 | 비고 |
|---|---|---|---|
| 타입 계약 (TS/Pydantic) | 25% | 100% | 완전 일치 |
| 매핑 테이블 (§5.1) | 20% | 100% | GAP-PB-01 수정 후 내부 모순 해소 |
| Converter 대칭성 | 25% | 100% | import/export 로직 대칭 |
| Discriminator 무결성 | 10% | 100% | `type` 필드 전 Block에 명시 |
| Round-trip 테스트 커버리지 | 20% | 90% | 실제 page_break 포함 fixture 테스트 미실행 (추천 #2) |
| **합계** | **100%** | **98%** | |

---

## 4. 추천 후속 작업

1. **Round-trip 회귀 테스트 추가** (Effort: S)
   - `page_break` 포함 `.hwpx` 샘플 fixture 추가
   - import → export → import 왕복 시 `PageBreakBlock` 카운트 동일성 검증
   - 위치: `apps/backend/tests/` 또는 M3 `tests/roundtrip/fixtures/`

2. **Canvas 렌더링 구현** (M4 UX wiring, Effort: S)
   - `apps/web/src/components/canvas/Block.tsx`에 `pageBreak` 분기 추가
   - 점선 수평선 + "쪽 나눔" 라벨 렌더 (계획 파일의 M4 가이드 참조)

3. **Diff 엔진 영향 점검** (Effort: S)
   - `lib/diff/text.ts`, `lib/diff/table.ts`가 `PageBreakBlock`을 어떻게 diff 처리할지 확인
   - PageBreakBlock은 text가 없으므로 기존 `diffTokens` 경로에서 노출되지 않음 — 무시 OK

---

## 5. 판정

✅ **합격 (Match Rate 98%)** — Gap 90% 임계값 초과. `/pdca report` 또는 계속 M3 진행 가능.

---

## Version History

| Version | Date | Changes | Reviewer |
|---------|------|---------|----------|
| 1.0 | 2026-04-23 | PageBreakBlock 추가 후 재검증. 96% → 98% (GAP-PB-01 즉시 수정). | bkit:gap-detector |
