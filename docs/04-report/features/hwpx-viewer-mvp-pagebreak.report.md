---
template: report
version: 1.0
---

# PageBreakBlock 타입 추가 완료 보고서

> **Status**: Complete
>
> **Project**: HWPX Viewer (`hwpx-viewer`)
> **Version**: MVP v1.0.0
> **Author**: ratiertm@gmail.com / MindBuild
> **Completion Date**: 2026-04-23
> **PDCA Cycle**: M3.1 (Mini-cycle: Page Break Design Validation)

---

## 1. 요약

### 1.1 사이클 개요

| 항목 | 내용 |
|------|------|
| 사이클 주제 | 페이지 분리(page_break) 설계 검증 및 Block 모델 확장 |
| 시작 | 2026-04-23 (설계 검증 착수) |
| 완료 | 2026-04-23 (분석 완료) |
| 기간 | 단일 세션 (설계 검증 → 구현 → 검증) |
| 최종 Match Rate | **98%** (시작 94% → 96% → 98%) |

### 1.2 결과 요약

```
┌────────────────────────────────────────────────────┐
│  Design-Implementation Match Rate: 98%             │
├────────────────────────────────────────────────────┤
│  ✅ 설계 문서 일관성:           6/6 파일 완성      │
│  ✅ 설계-구현 동기화:           4/4 섹션 검증      │
│  ✅ Round-trip 무결성:          대칭성 확인         │
│  ⏳ Canvas 렌더링:              M4 후속 작업        │
└────────────────────────────────────────────────────┘
```

---

## 2. 관련 문서

| Phase | 문서 | 상태 |
|-------|------|------|
| Plan | [hwpx-viewer-mvp.plan.md](../../01-plan/features/hwpx-viewer-mvp.plan.md) | ✅ Approved |
| Design | [hwpx-viewer-mvp.design.md](../../02-design/features/hwpx-viewer-mvp.design.md) (§3.1, §5.1) | ✅ Finalized |
| Check | [hwpx-viewer-mvp.analysis.md](../../03-analysis/hwpx-viewer-mvp.analysis.md) | ✅ Complete |
| Act | 현재 문서 | 🔄 작성 중 |

---

## 3. PDCA 사이클 상세

### 3.1 Plan (설계 검증 착수)

**주요 사건:**
- 사용자 요청: "페이지/섹션 매핑이 rhwp(Rust) + pyhwpxlib(Python) 생태계와 호환되는가?"
- 배경: 전체 프로젝트 M3(round-trip) 진행 전 외부 참조 프로젝트와의 호환성 검증 필요
- 결과: round-trip 실패 리스크 발견 → 설계 결정 필요

**설계 문서 상태:**
- `docs/02-design/features/hwpx-viewer-mvp.design.md`의 §3.1, §5.1 기존 정의 검토
- 기존 Block 모델에 `PageBreakBlock` 미정의 발견

### 3.2 Design (3가지 옵션 제시, Option B 채택)

**외부 소스 대조 분석:**

| 프로젝트 | 구현 | 시사점 |
|---------|------|--------|
| rhwp (Rust) | `Document.sections[].paragraphs[].page_break: bool` | 물리 쪽 나눔 유발 |
| pyhwpxlib (Python) | `Para.page_break: Optional[bool]` | 문단 속성, 선택적 |
| HwpxViewer (기존) | Block 모델에 `page_break` 없음 | **설계 gap 발견** |

**제시된 옵션과 선택:**

| 옵션 | 설명 | 장점 | 단점 | 채택? |
|------|------|------|------|-------|
| **Option A** | TextBlock에 `pageBreak?: boolean` 추가 | 최소 변경 | 의미 모호, round-trip 복잡 | ❌ |
| **Option B** | 신규 `PageBreakBlock { type: 'pageBreak' }` | 의미 명확, 대칭 구조 | 신규 타입 관리 | ✅ |
| **Option C** | 섹션 경계로만 처리 (page_break 무시) | 단순함 | 원본 정보 손실, round-trip 불가 | ❌ |

**설계 결정:** Option B 채택 (사용자 확정)

### 3.3 Do (구현)

**변경 범위: 6개 파일**

**설계 문서 (3)**
1. `docs/COMPONENT_INVENTORY.md` §15
   - Block union 정의에 `PageBreakBlock` 추가
   - 타입: `interface PageBreakBlock { type: 'pageBreak' }`

2. `docs/02-design/features/hwpx-viewer-mvp.design.md`
   - §3.1: TypeScript/Pydantic 모델에 `PageBreakBlock` 추가
   - §5.1: 매핑 테이블에 `<hp:p page_break="1">` → `PageBreakBlock` 행 추가

3. `apps/web/src/types/index.ts`
   - Frontend 타입 정의: `type Block = ... | PageBreakBlock`

**구현 코드 (3)**
1. `apps/backend/src/hwpx_viewer_api/schemas.py`
   - Pydantic discriminated union 확장
   - `PageBreakBlock(BaseModel): type: Literal["pageBreak"]`

2. `apps/backend/src/hwpx_viewer_api/converter/overlay_to_blocks.py`
   - OWPML `<hp:p page_break="1">` 감지 로직 추가
   - 해당 문단을 본문 텍스트 없이 `PageBreakBlock`으로 생성

3. `apps/backend/src/hwpx_viewer_api/converter/blocks_to_overlay.py`
   - Export 경로: `PageBreakBlock` → `<hp:p page_break="1">` 역변환
   - `apply_overlay` passthrough로 활용

**구현 패턴: 대칭 설계**
```
Import:  <hp:p page_break="1"> ──[감지]──> PageBreakBlock
Export:  PageBreakBlock ──[역변환]──> <hp:p page_break="1">
```

### 3.4 Check (검증 및 Gap 분석)

**Gap-detector 재검증:**

**합격 항목 (4/5)**
| # | 항목 | 결과 | 근거 |
|---|------|------|------|
| 1 | 설계-구현 일관성 | ✅ PASS | 6개 파일 전반에 `PageBreakBlock` 일치 |
| 2 | Discriminator 정합성 | ✅ PASS | `schemas.py:86`에 `Annotated[Union[...], Field(discriminator="type")]` |
| 3 | Round-trip 무결성 | ✅ PASS | 대칭 로직 + `apply_overlay` passthrough |
| 4 | Frontend/Backend 미러링 | ✅ PASS | TS ↔ Pydantic 타입 동기화 |

**신규 발견 Gap: GAP-PB-01 (즉시 수정)**

| GAP | 위치 | 문제 | 수정 | 결과 |
|-----|------|------|------|------|
| **GAP-PB-01** | design.md §5.1 L436 | `<hs:sec>` 행의 비고에 *"page_break는 무시"* 문구 vs L441 새로운 `PageBreakBlock` 행 충돌 | 비고를 *"… 대신 본문에 `PageBreakBlock`으로 기록됨"*으로 교체 | 96% → **98%** |

**최종 Match Rate 산정**

| 영역 | 가중치 | 점수 | 비고 |
|------|--------|------|------|
| 타입 계약 (TS/Pydantic) | 25% | 100% | 완전 일치 |
| 매핑 테이블 (§5.1) | 20% | 100% | GAP-PB-01 수정 후 |
| Converter 대칭성 | 25% | 100% | import/export 로직 |
| Discriminator 무결성 | 10% | 100% | `type` 필드 명시 |
| Round-trip 테스트 커버리지 | 20% | 90% | 실제 fixture 테스트 미실행 |
| **합계** | **100%** | **98%** | |

---

## 4. 완료 항목

### 4.1 기능 요구사항

| 요구사항 | 설명 | 상태 |
|---------|------|------|
| FR-PB-01 | PageBreakBlock 타입 정의 및 구현 | ✅ Complete |
| FR-PB-02 | OWPML page_break 감지 (import) | ✅ Complete |
| FR-PB-03 | PageBreakBlock 역변환 (export) | ✅ Complete |
| FR-PB-04 | Design-Implementation 일관성 (Match Rate ≥90%) | ✅ Complete (98%) |

### 4.2 설계 문서

| 문서 | 섹션 | 상태 |
|------|------|------|
| COMPONENT_INVENTORY.md | §15 Block union | ✅ Updated |
| hwpx-viewer-mvp.design.md | §3.1 Shared Types | ✅ Updated |
| hwpx-viewer-mvp.design.md | §5.1 매핑 테이블 | ✅ Updated (내부 모순 해소) |
| hwpx-viewer-mvp.analysis.md | §2.1 검증 결과 | ✅ Complete |

### 4.3 구현 코드

| 파일 | 변경 내용 | 상태 |
|------|---------|------|
| schemas.py | Block union + PageBreakBlock | ✅ Merged |
| overlay_to_blocks.py | page_break 감지 로직 | ✅ Merged |
| blocks_to_overlay.py | 역변환 로직 | ✅ Merged |
| types/index.ts | Frontend 타입 | ✅ Merged |

### 4.4 산출물

| 산출물 | 경로 | 상태 |
|--------|------|------|
| Analysis 문서 | docs/03-analysis/hwpx-viewer-mvp.analysis.md | ✅ Created (신규) |
| Completion Report | docs/04-report/features/hwpx-viewer-mvp-pagebreak.report.md | ✅ Writing |

---

## 5. 미완료 항목 (후속 마일스톤)

### 5.1 M4 후속 작업

| 항목 | 설명 | Priority | 추정 공수 | Target |
|------|------|----------|----------|--------|
| **Canvas 렌더링** | Block.tsx에 pageBreak 분기 추가 (점선 + 라벨) | High | S | M4 |
| **Round-trip 회귀 테스트** | page_break 포함 fixture 추가 | High | S | M3 |
| **Diff 엔진 영향 점검** | PageBreakBlock이 diff에 미치는 영향 | Medium | S | M3 |

### 5.2 전체 프로젝트 완료 시점

- M3: pyhwpxlib round-trip (설계 완료, 구현 진행 중)
- M4: Canvas PageBreakBlock 렌더링
- M8 이후: 전체 프로젝트 완료 보고서 작성 (이번 사이클은 mini-cycle 보고)

---

## 6. 학습 포인트 (Lessons Learned)

### 6.1 잘 진행된 것 (Keep)

1. **외부 참조 프로젝트 대조의 가치**
   - rhwp + pyhwpxlib 소스를 읽지 않았다면 round-trip 실패 리스크를 발견하지 못했을 것
   - 초기 설계 문서의 "Block 모델이 진실" 원칙을 재확인
   - 결론: 장기 프로젝트에서는 의존 생태계(upstream)의 설계 검토 필수

2. **설계 문서 내 자동 일관성 검증**
   - gap-detector가 GAP-PB-01(매핑 테이블 내부 모순)을 즉시 감지
   - 같은 테이블 안에서 상충하는 문구도 catch 가능
   - 결론: 매뉴얼 QA 대신 정형화된 검증 도구의 신뢰도 높음

3. **설계 결정 프로세스의 투명성**
   - 3가지 옵션 제시 → 사용자 선택 → 구현 → 검증의 명확한 flow
   - Option B가 "의미 명확성"과 "대칭 구조"를 동시에 만족
   - 결론: early 선택지 제시가 나중에 rework 비용을 절감

### 6.2 개선이 필요한 부분 (Problem)

1. **문서 작성 시 내부 모순 검수 체크리스트 부재**
   - 매핑 테이블(§5.1) 작성 중 같은 행(섹션)에서 상충 문구가 남음
   - 리뷰 과정에서 "하위 항목과 상위 항목의 일관성" 체크가 부족했음
   - 교훈: 신규 행 추가 시 관련 행의 기존 내용도 함께 재검토 필요

2. **Round-trip 회귀 테스트의 시점 지연**
   - Canvas 렌더링이 M4이므로 실제 page_break 포함 fixture 테스트가 미실행 상태
   - 이론적 일관성은 확인했으나 실제 바이트 수준 테스트 없음
   - 교훈: 설계 검증(Check) 단계에서 "실제 fixture를 만들 수 있는가"를 사전 검토

### 6.3 다음 사이클에 적용할 것 (Try)

1. **nested 설계 문서의 cross-reference 자동화**
   - 매핑 테이블의 "새 행 추가 시 관련 행 목록" 주석 추가
   - 예: `<!-- 관련 행: §3.1 Block 정의, §5.2 converter 경로 -->`

2. **Mini-cycle 끝나면 바로 fixture 작성**
   - M3.1(설계 완료) 후 바로 `tests/fixtures/page_break_sample.hwpx` 생성
   - 설계-구현이 바뀌기 전 "실제 동작하는가" 검증
   - 더 early하게 예상 밖의 버그를 잡을 가능성

3. **3개월 프로젝트의 "매 마일스톤 문서 내부 검사" 루틴화**
   - 이번 round처럼 gap-detector를 각 마일스톤 끝에 자동 실행
   - Match Rate 추이를 시각화 (94% → 96% → 98% → ...)
   - 대시보드로 "설계 품질 저하" 조기 경보

---

## 7. 품질 지표

### 7.1 최종 분석 결과

| 지표 | 목표 | 달성 | 변화 |
|------|------|------|------|
| Design Match Rate | 90% | 98% | +8% |
| 설계 문서 일관성 | 100% | 100% | ✅ (GAP-PB-01 수정) |
| Type 커버리지 | 100% | 100% | ✅ TS/Pydantic 동기화 |
| 외부 참조 호환성 | 추정 80% | 검증됨 | ✅ rhwp + pyhwpxlib 대조 |

### 7.2 해결된 이슈

| 이슈 | 해결 | 결과 |
|------|------|------|
| Round-trip 리스크 발견 | Option B 설계 선택 + 구현 | ✅ 근본 해결 |
| 매핑 테이블 내부 모순 | GAP-PB-01 수정 | ✅ Match Rate 96% → 98% |
| page_break의 의미 모호성 | 신규 Block 타입으로 명확화 | ✅ 타입 안정성 확보 |

---

## 8. 프로세스 개선 제안

### 8.1 PDCA 프로세스

| Phase | 개선점 |
|-------|--------|
| **Plan** | 외부 참조 프로젝트(rhwp, pyhwpxlib)의 호환성 체크리스트 추가 |
| **Design** | 매핑 테이블 작성 시 "관련 섹션 교차 검증" 의무화 |
| **Do** | 작은 타입 변경도 구현 후 바로 `gap-detector` 실행 |
| **Check** | 매뉴얼 리뷰 + 자동 도구 조합 (이번처럼 GAP-PB-01 catch 가능) |
| **Act** | 개선 사항은 체크리스트로 문서화 (다음 사이클 재사용) |

### 8.2 도구/환경

| 영역 | 개선 제안 | 기대 효과 |
|------|----------|----------|
| 자동 검증 | gap-detector를 마일스톤마다 실행 | Match Rate 저하 조기 감지 |
| 테스트 | page_break fixture를 설계 완료 직후 생성 | 실제 동작 검증 시기 단축 |
| 문서 | 매핑 테이블에 "관련 섹션" 주석 | cross-reference 오류 방지 |

---

## 9. 다음 단계

### 9.1 즉시 (다음 세션)

- [x] PageBreakBlock 설계 및 구현 완료
- [ ] Round-trip 회귀 테스트 추가 (page_break fixture)
- [ ] Diff 엔진 영향 검토 (PathBlock이 existing diff logic과 호환되는가)

### 9.2 M3 (round-trip validation)

| 항목 | Priority | Expected | Owner |
|------|----------|----------|-------|
| Round-trip 테스트 자동화 | High | 2026-04-25 | backend |
| 실제 `.hwpx` 샘플 10종 회귀 | High | 2026-04-26 | qa |
| pyhwpxlib 호환성 문서 작성 | Medium | 2026-04-27 | design |

### 9.3 M4 (Canvas 렌더링)

| 항목 | Description |
|------|-------------|
| Block.tsx 업데이트 | PageBreakBlock render 분기 추가 (점선 + "쪽 나눔" 라벨) |
| CSS/Theme 확인 | pageBreak 시각 토큰 (색, 선 스타일) DESIGN_SPEC에서 정의 |
| UX 테스트 | 사용자 문서 편집 시 page_break 시각화가 명확한지 검증 |

### 9.4 전체 프로젝트 완료 보고서

- **시점**: M8 이후 (전체 9개 마일스톤 완료)
- **범위**: 이번 mini-cycle report와 다름. 전체 M1-M8 통합 보고
- **위치**: `docs/04-report/status/hwpx-viewer-mvp-final.report.md` (신규)

---

## 10. 변경 로그

### v1.0.0 (2026-04-23)

**Added:**
- PageBreakBlock 타입 신규 추가 (Block union 확장)
- OWPML page_break 감지 로직 (import)
- PageBreakBlock 역변환 로직 (export)
- Gap Analysis 문서 신규 작성 (docs/03-analysis/)

**Changed:**
- COMPONENT_INVENTORY.md §15 Block 정의 갱신
- hwpx-viewer-mvp.design.md §3.1, §5.1 문서 갱신
- design.md §5.1 L436 매핑 테이블 내부 모순 해소

**Fixed:**
- GAP-PB-01: 매핑 테이블 비고의 상충 문구 수정 (Match Rate 96% → 98%)

---

## 11. 버전 이력

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-04-23 | PageBreakBlock 추가 완료 보고서. Design Match Rate 98%. | ratiertm@gmail.com |

---

## 부록: 설계 옵션 비교표

### 기각된 옵션 상세 분석

#### Option A: TextBlock에 pageBreak 속성 추가

```typescript
interface TextBlock {
  type: 'h1' | 'h2' | 'lead' | 'p';
  text: string;
  pageBreak?: boolean;  // 추가
}
```

**문제점:**
- 의미 혼동: `TextBlock { type: 'p', text: '', pageBreak: true }`는 "텍스트 없는 문단"?
- converter 복잡화: overlay_to_blocks에서 "text 있는 문단 + page_break" vs "text 없는 문단 + page_break" 구분 필요
- round-trip 불확실: export 시 해당 문단의 스타일(h1/h2/p) 복원 난제

#### Option C: 섹션 경계로만 처리

```typescript
// PageBreakBlock을 완전히 무시
interface Page {
  id: number;
  title: string;
  // section 경계 = 자동 쪽 나눔
}
```

**문제점:**
- 설계 원칙 위배: "Round-trip 시맨틱 보존" (CLAUDE.md §1.3 디자인 목표)
- 원본 정보 손실: hwpx 문서의 `page_break="1"` 속성이 저장 후 사라짐
- pyhwpxlib/rhwp 비호환: 원본 문서에 page_break 있었으나 export 후 사라지면 "다른 문서"

**채택 불가 사유:** 1번 설계 원칙 위배 + 3번 round-trip 목표 위배

---

*이 보고서는 M3 round-trip 검증이 완료될 때까지 "mini-cycle" 문서로 보존됩니다. 전체 프로젝트 완료 보고서는 M8 완료 후 별도 작성 예정입니다.*
