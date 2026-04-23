# HWPX Viewer Changelog

모든 주요 변경사항이 이 파일에 기록됩니다.

---

## [M3.1 - 2026-04-23] PageBreakBlock Design Validation Cycle

### Added

- **PageBreakBlock 타입 신규 추가**: OWPML `<hp:p page_break="1">` 표현을 위한 새로운 Block 타입
  - TypeScript: `interface PageBreakBlock { type: 'pageBreak' }`
  - Pydantic: `class PageBreakBlock(BaseModel): type: Literal["pageBreak"]`
  
- **Gap Analysis 문서 신규 작성** (`docs/03-analysis/hwpx-viewer-mvp.analysis.md`)
  - Design-Implementation Match Rate: **98%**
  - 검증 항목 4/5 합격, 신규 Gap 1개(즉시 수정)

- **OWPML page_break 감지 로직** (import)
  - `apps/backend/src/hwpx_viewer_api/converter/overlay_to_blocks.py`
  - Para.page_break=True → PageBreakBlock 변환

- **PageBreakBlock 역변환 로직** (export)
  - `apps/backend/src/hwpx_viewer_api/converter/blocks_to_overlay.py`
  - PageBreakBlock → `<hp:p page_break="1">` 역변환
  - `apply_overlay` passthrough로 대칭성 확보

### Changed

- **COMPONENT_INVENTORY.md §15**: Block union 정의 갱신
  - `type Block = TextBlock | TableBlock | PageBreakBlock`

- **hwpx-viewer-mvp.design.md §3.1**: Shared Types 섹션
  - TypeScript/Pydantic 모델에 PageBreakBlock 추가

- **hwpx-viewer-mvp.design.md §5.1**: 매핑 테이블 갱신
  - `<hp:p page_break="1">` → `PageBreakBlock { type: 'pageBreak' }` 행 추가
  - 섹션 내 page_break 처리 설명 보강

- **apps/web/src/types/index.ts**: Frontend 타입 정의
  - Block union에 PageBreakBlock 추가

- **apps/backend/src/hwpx_viewer_api/schemas.py**
  - Pydantic discriminated union 확장
  - `Block = Annotated[Union[TextBlock, TableBlock, PageBreakBlock], Field(discriminator="type")]`

### Fixed

- **GAP-PB-01**: 매핑 테이블 내부 모순 해소
  - 위치: `docs/02-design/features/hwpx-viewer-mvp.design.md` §5.1 L436
  - 문제: `<hs:sec>` 행의 비고에 "page_break는 무시" vs L441 새로운 PageBreakBlock 행 충돌
  - 수정: 비고를 "…대신 본문에 `PageBreakBlock`으로 기록됨"으로 교체
  - 결과: Match Rate 96% → **98%**

### Design Decision

**Option B 선택 배경**: rhwp(Rust) + pyhwpxlib(Python) 생태계 호환성 검증

| 옵션 | 장점 | 단점 | 선택 |
|------|------|------|------|
| A: TextBlock.pageBreak? | 최소 변경 | 의미 모호, round-trip 복잡 | ❌ |
| **B: PageBreakBlock** | 의미 명확, 대칭 구조 | 타입 관리 | ✅ |
| C: 섹션 경계만 | 단순함 | 정보 손실, round-trip 불가 | ❌ |

### Known Issues / Next Steps

- [ ] Round-trip 회귀 테스트: page_break 포함 fixture 추가 (M3)
- [ ] Canvas 렌더링: Block.tsx에 pageBreak 분기 추가, 점선 + "쪽 나눔" 라벨 (M4)
- [ ] Diff 엔진 영향 검토: PageBreakBlock이 existing diff logic과 호환되는가 (M3)

### Match Rate Progression

```
M2 final:  94%
M3.1 init: 94% → 96% (6개 파일 구현)
M3.1 fix:  96% → 98% (GAP-PB-01 수정)
```

### External Reference

- rhwp (Rust HWPX library): `Document.sections[].paragraphs[].page_break: bool`
- pyhwpxlib (Python): `Para.page_break: Optional[bool]`

---

## [M2 - 2026-04-22] OAuth Integration & API Foundation

### Added

- FastAPI backend (`apps/backend`)
- Claude CLI OAuth subprocess integration
- CORS allowlist configuration
- Error handling catalog (13 error codes)

### Changed

- Frontend migration to Vite + React + TS (`apps/web`)
- API authentication from API key to OAuth session

### Status

✅ M2 Milestone Complete (98% Match Rate achieved in M3.1 validation cycle)

---

## Future Milestones (Planned)

- **M3**: Round-trip validation (pyhwpxlib integration)
- **M4**: Canvas PageBreakBlock rendering
- **M5-M7**: Feature expansion
- **M8**: Final integration & deployment
- **M9**: Project completion (full report)

---

*이 changelog는 PDCA 사이클 단계마다 업데이트됩니다. 버전은 마일스톤 기반 (M0-M9)으로 관리됩니다.*
