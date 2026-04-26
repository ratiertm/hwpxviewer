# Graph Report - .  (2026-04-26)

## Corpus Check
- 93 files · ~82,437 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 583 nodes · 927 edges · 73 communities detected
- Extraction: 74% EXTRACTED · 26% INFERRED · 0% AMBIGUOUS · INFERRED: 237 edges (avg confidence: 0.62)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_rhwp WASM Bridge|rhwp WASM Bridge]]
- [[_COMMUNITY_Cluster 1|Cluster 1]]
- [[_COMMUNITY_App Bootstrap + Claude CLI|App Bootstrap + Claude CLI]]
- [[_COMMUNITY_Save Route + Reveal|Save Route + Reveal]]
- [[_COMMUNITY_Save + Test Fixtures|Save + Test Fixtures]]
- [[_COMMUNITY_API Schemas + Health|API Schemas + Health]]
- [[_COMMUNITY_Frontend Components (legacy)|Frontend Components (legacy)]]
- [[_COMMUNITY_Cluster 7|Cluster 7]]
- [[_COMMUNITY_HWPX XML Patcher|HWPX XML Patcher]]
- [[_COMMUNITY_Document IO Routes|Document I/O Routes]]
- [[_COMMUNITY_Cluster 10|Cluster 10]]
- [[_COMMUNITY_Cluster 11|Cluster 11]]
- [[_COMMUNITY_Frontend API Client|Frontend API Client]]
- [[_COMMUNITY_Lineseg Post-Process|Lineseg Post-Process]]
- [[_COMMUNITY_Claude System Prompts|Claude System Prompts]]
- [[_COMMUNITY_Cluster 15|Cluster 15]]
- [[_COMMUNITY_Claude Routes Tests|Claude Routes Tests]]
- [[_COMMUNITY_Selection Hook|Selection Hook]]
- [[_COMMUNITY_Text Diff Engine|Text Diff Engine]]
- [[_COMMUNITY_Cluster 19|Cluster 19]]
- [[_COMMUNITY_Inline Cherry-Pick Diff|Inline Cherry-Pick Diff]]
- [[_COMMUNITY_Table Diff + Tests|Table Diff + Tests]]
- [[_COMMUNITY_Claude API Wrapper|Claude API Wrapper]]
- [[_COMMUNITY_App Root|App Root]]
- [[_COMMUNITY_Floating Dock|Floating Dock]]
- [[_COMMUNITY_Status Bar|Status Bar]]
- [[_COMMUNITY_Inline Selection Menu|Inline Selection Menu]]
- [[_COMMUNITY_Inline Manual Edit|Inline Manual Edit]]
- [[_COMMUNITY_SVG Page Renderer|SVG Page Renderer]]
- [[_COMMUNITY_Cluster 29|Cluster 29]]
- [[_COMMUNITY_History Panel (drawer)|History Panel (drawer)]]
- [[_COMMUNITY_Cluster 31|Cluster 31]]
- [[_COMMUNITY_Cluster 32|Cluster 32]]
- [[_COMMUNITY_Cluster 33|Cluster 33]]
- [[_COMMUNITY_Cluster 34|Cluster 34]]
- [[_COMMUNITY_Cluster 35|Cluster 35]]
- [[_COMMUNITY_Cluster 36|Cluster 36]]
- [[_COMMUNITY_Generate Modal + API|Generate Modal + API]]
- [[_COMMUNITY_Cluster 38|Cluster 38]]
- [[_COMMUNITY_Cluster 39|Cluster 39]]
- [[_COMMUNITY_Cluster 40|Cluster 40]]
- [[_COMMUNITY_Cluster 41|Cluster 41]]
- [[_COMMUNITY_Cluster 42|Cluster 42]]
- [[_COMMUNITY_Cluster 43|Cluster 43]]
- [[_COMMUNITY_Cluster 44|Cluster 44]]
- [[_COMMUNITY_Cluster 45|Cluster 45]]
- [[_COMMUNITY_Cluster 46|Cluster 46]]
- [[_COMMUNITY_Cluster 47|Cluster 47]]
- [[_COMMUNITY_Cluster 48|Cluster 48]]
- [[_COMMUNITY_Cluster 49|Cluster 49]]
- [[_COMMUNITY_Cluster 50|Cluster 50]]
- [[_COMMUNITY_Cluster 51|Cluster 51]]
- [[_COMMUNITY_Cluster 52|Cluster 52]]
- [[_COMMUNITY_Cluster 53|Cluster 53]]
- [[_COMMUNITY_Cluster 54|Cluster 54]]
- [[_COMMUNITY_Cluster 55|Cluster 55]]
- [[_COMMUNITY_Cluster 56|Cluster 56]]
- [[_COMMUNITY_Cluster 57|Cluster 57]]
- [[_COMMUNITY_Cluster 58|Cluster 58]]
- [[_COMMUNITY_Cluster 59|Cluster 59]]
- [[_COMMUNITY_Cluster 60|Cluster 60]]
- [[_COMMUNITY_Cluster 61|Cluster 61]]
- [[_COMMUNITY_Cluster 62|Cluster 62]]
- [[_COMMUNITY_Cluster 63|Cluster 63]]
- [[_COMMUNITY_Cluster 64|Cluster 64]]
- [[_COMMUNITY_Cluster 65|Cluster 65]]
- [[_COMMUNITY_Cluster 66|Cluster 66]]
- [[_COMMUNITY_Cluster 67|Cluster 67]]
- [[_COMMUNITY_Cluster 68|Cluster 68]]
- [[_COMMUNITY_Cluster 69|Cluster 69]]
- [[_COMMUNITY_Cluster 70|Cluster 70]]
- [[_COMMUNITY_Cluster 71|Cluster 71]]
- [[_COMMUNITY_Cluster 72|Cluster 72]]

## God Nodes (most connected - your core abstractions)
1. `DocumentSession` - 26 edges
2. `UploadStore` - 17 edges
3. `ClaudeOnceRequest` - 16 edges
4. `DocumentPlan` - 14 edges
5. `Settings` - 13 edges
6. `run_generate_job()` - 13 edges
7. `M5R — document coordinate API backed by rhwp WASM.  Endpoints --------- POST /ap` - 12 edges
8. `Extract CellRef as plain dict for rhwp_wasm (which takes optional dict).` - 12 edges
9. `Whole-paragraph info for click-to-select.      Returns ``length`` (character cou` - 12 edges
10. `ClaudeStreamRequest` - 10 edges

## Surprising Connections (you probably didn't know these)
- `flash (domain term)` --semantically_similar_to--> `NAV-01 scroll spy (IntersectionObserver)`  [INFERRED] [semantically similar]
  CLAUDE.md → docs/INTERACTION_SPEC.md
- `Undone toggle (independent toggle, not linear undo) design intent` --rationale_for--> `HistoryEntry data model`  [EXTRACTED]
  CLAUDE.md → docs/ARCHITECTURE.md
- `Backend routes (/api/import, /api/export, /api/claude/stream, /api/claude/once, /healthz, /readyz)` --shares_data_with--> `API client (callClaudeOnce/streamClaude/extractJson)`  [INFERRED]
  apps/backend/README.md → docs/ARCHITECTURE.md
- `In-memory LRU upload session store (Design v0.3 §4.2).  Keyed by a UUID ``upload` --uses--> `DocumentSession`  [INFERRED]
  apps/backend/src/hwpx_viewer_api/services/upload_store.py → apps/backend/src/hwpx_viewer_api/services/rhwp_wasm.py
- `One-sentence product summary (Korean public/enterprise HWPX viewer with Claude co-editing)` --references--> `HWPX Viewer (project)`  [EXTRACTED]
  docs/PRD.md → CLAUDE.md

## Hyperedges (group relationships)
- **PDCA cycle for PageBreakBlock (M3.1)** —  [EXTRACTED 1.00]
- **AI co-edit chat flow (multi-turn streaming + edit application)** —  [EXTRACTED 1.00]
- **Inline cherry-pick editing pipeline** —  [EXTRACTED 1.00]

## Communities

### Community 0 - "rhwp WASM Bridge"
Cohesion: 0.05
Nodes (43): _cell_dict(), paragraph(), selection_rects(), _session_or_404(), text_range(), _BackedEngine, _consume_bytes(), _decode_result_string() (+35 more)

### Community 1 - "Cluster 1"
Cohesion: 0.05
Nodes (51): GAP-PB-01 (mapping table internal contradiction), Gap analysis Match Rate 98% (PageBreakBlock), Data flow: undo/redo (history toggle), Block data model (TextBlock | TableBlock), HistoryEntry data model, Message data model (chat), Page data model (CoverPage | ContentPage), HWPX integration pipeline (file ↔ pyhwpxlib ↔ converter ↔ Block[]) (+43 more)

### Community 2 - "App Bootstrap + Claude CLI"
Cohesion: 0.09
Nodes (40): __init__::__init__.py, __init__::__init__.py, BaseSettings, _classify_error(), _cli_env(), once_completion(), open_upstream_stream(), Claude Code CLI subprocess adapter.  Replaces the httpx-based direct Anthropic A (+32 more)

### Community 3 - "Save Route + Reveal"
Cohesion: 0.07
Nodes (35): client(), Shared pytest fixtures., Generate a small .hwpx on the fly using pyhwpxlib so tests don't     depend on e, sample_hwpx_path(), download(), GET /api/download/{uploadId} — return the edited document bytes.  Design v0.3 §4, _doc_info(), edit() (+27 more)

### Community 4 - "Save + Test Fixtures"
Cohesion: 0.15
Nodes (34): _call_planner(), _claude_planner_call(), _extract_json(), Worker that turns a ``GenerateStartRequest`` into a registered uploadId.  Pipeli, Spawn ``claude -p`` with isolated flags and our system prompt., Run the full pipeline. Emits SSE events into the job registry.      NEVER raises, Strip code fences / leading prose, return the first JSON object found.      Mirr, Call Claude in isolated mode with the hwpx skill guide as system prompt.      We (+26 more)

### Community 5 - "API Schemas + Health"
Cohesion: 0.16
Nodes (32): BaseModel, healthz(), Liveness and readiness endpoints.  - /healthz  always-200 while the process is a, readyz(), hit_test(), M5R — document coordinate API backed by rhwp WASM.  Endpoints --------- POST /ap, Whole-paragraph info for click-to-select.      Returns ``length`` (character cou, Extract CellRef as plain dict for rhwp_wasm (which takes optional dict). (+24 more)

### Community 6 - "Frontend Components (legacy)"
Cohesion: 0.08
Nodes (5): hwpx-viewer-v8.jsx::diffTokens(), hwpx-viewer-v8.jsx::lcsMatrix(), hwpx-viewer-v8.jsx::reconstructTable(), hwpx-viewer-v8.jsx::reshapeCells(), hwpx-viewer-v8.jsx::tokenize()

### Community 7 - "Cluster 7"
Cohesion: 0.07
Nodes (28): API client (callClaudeOnce/streamClaude/extractJson), Data flow: chat → page edit (streaming + multi-turn), HwpxViewer root component, State inventory (17 useState entries), System prompts (SYSTEM_DOC_EDITOR, SYSTEM_INLINE_EDITOR), Backend routes (/api/import, /api/export, /api/claude/stream, /api/claude/once, /healthz, /readyz), API client functions (callClaudeOnce/streamClaude/extractJson), ChatMessage component (+20 more)

### Community 8 - "HWPX XML Patcher"
Cohesion: 0.17
Nodes (19): _apply_cross_para_body_edit(), _apply_cross_para_cell_edit(), apply_edits_to_hwpx(), _apply_single_edit(), _concat_para_text(), _empty_paragraph_text(), _patch_section_xml(), Surgical HWPX-XML text patcher.  Design: rhwp holds authoritative in-memory edit (+11 more)

### Community 9 - "Document I/O Routes"
Cohesion: 0.24
Nodes (12): _FakeSession, Upload LRU + TTL store tests (v0.3 — DocumentSession payload)., Stand-in for ``DocumentSession`` — records close() calls., test_capacity_evicts_oldest_and_closes_session(), test_clear_closes_all_sessions(), test_delete_removes_entry_and_closes_session(), test_put_and_get_round_trip(), test_ttl_expires_entry_and_closes_session() (+4 more)

### Community 10 - "Cluster 10"
Cohesion: 0.13
Nodes (18): Known constraints/tradeoffs (single file, full snapshots, table diff limits), Data flow: inline editing (drag → menu → cherry-pick), InlineEditing state machine, Diff engine (tokenize/lcsMatrix/diffTokens/groupHunks/reconstructText), Recommended file layout (src/state, components, api, lib/diff, types), Table diff (diffTable/reconstructTable/reshapeCells), Block component (h1/h2/lead/p/table renderer), Canvas component (+10 more)

### Community 11 - "Cluster 11"
Cohesion: 0.17
Nodes (11): get_job_registry(), Job, JobEvent, JobRegistry, JobRegistry._evict_locked(), JobRegistry.get(), In-memory job registry for ``/api/generate/*``.  Each ``POST /api/generate/start, SSE-formatted byte stream. Closes when ``finished`` event drained. (+3 more)

### Community 12 - "Frontend API Client"
Cohesion: 0.13
Nodes (1): ApiError

### Community 13 - "Lineseg Post-Process"
Cohesion: 0.2
Nodes (13): _ensure_lineseg(), _expected_lineseg_count(), _make_lineseg_attrs(), _paragraph_text(), _process_section_xml(), Synthesize <hp:linesegarray> entries on every paragraph that lacks them.  HwpxBu, Build attribute dict for the Nth synthesized lineseg.      rhwp recomputes layou, Add or fix ``<hp:linesegarray>`` on a single paragraph. Idempotent.      Returns (+5 more)

### Community 14 - "Claude System Prompts"
Cohesion: 0.2
Nodes (8): get_prompt(), Claude system prompts, ported VERBATIM from hwpx-viewer-v8.jsx.  CLAUDE.md §7 fo, Return the full system prompt for a given identifier.      Unknown identifiers r, valid_prompt_ids(), Smoke tests for prompts module — ensures the verbatim port stays verbatim., test_get_prompt_known_ids(), test_get_prompt_unknown_raises(), test_valid_prompt_ids()

### Community 15 - "Cluster 15"
Cohesion: 0.25
Nodes (10): compose_system_prompt(), healthcheck(), load_reference(), load_skill_md(), hwpx skill loader + intent-aware system prompt composer.  Reads ``~/.claude/skil, Compose the system prompt for ``/api/generate``.      Always includes ``HWPX_COR, Used by /healthz/ready to verify the skill is installed., Resolve skill install dir. Override with ``HWPX_SKILL_DIR`` for tests. (+2 more)

### Community 16 - "Claude Routes Tests"
Cohesion: 0.22
Nodes (5): Tests for Claude proxy routes.  Covers request validation and the "CLI not insta, When `claude` is not on PATH, /once raises UPSTREAM_UNAVAILABLE., When `claude` is not on PATH, /stream fails BEFORE StreamingResponse     commits, test_claude_once_when_cli_missing(), test_claude_stream_when_cli_missing()

### Community 17 - "Selection Hook"
Cohesion: 0.33
Nodes (2): lengthBetween(), sameParagraph()

### Community 18 - "Text Diff Engine"
Cohesion: 0.47
Nodes (3): text.ts::diffTokens(), text.ts::lcsMatrix(), text.ts::tokenize()

### Community 19 - "Cluster 19"
Cohesion: 0.33
Nodes (1): Liveness / readiness smoke tests.

### Community 20 - "Inline Cherry-Pick Diff"
Cohesion: 0.5
Nodes (0): 

### Community 21 - "Table Diff + Tests"
Cohesion: 0.67
Nodes (2): table.ts::reconstructTable(), table.ts::reshapeCells()

### Community 22 - "Claude API Wrapper"
Cohesion: 0.5
Nodes (0): 

### Community 23 - "App Root"
Cohesion: 0.67
Nodes (0): 

### Community 24 - "Floating Dock"
Cohesion: 0.67
Nodes (0): 

### Community 25 - "Status Bar"
Cohesion: 0.67
Nodes (0): 

### Community 26 - "Inline Selection Menu"
Cohesion: 0.67
Nodes (0): 

### Community 27 - "Inline Manual Edit"
Cohesion: 0.67
Nodes (0): 

### Community 28 - "SVG Page Renderer"
Cohesion: 0.67
Nodes (0): 

### Community 29 - "Cluster 29"
Cohesion: 0.67
Nodes (0): 

### Community 30 - "History Panel (drawer)"
Cohesion: 0.67
Nodes (0): 

### Community 31 - "Cluster 31"
Cohesion: 0.67
Nodes (0): 

### Community 32 - "Cluster 32"
Cohesion: 0.67
Nodes (0): 

### Community 33 - "Cluster 33"
Cohesion: 0.67
Nodes (0): 

### Community 34 - "Cluster 34"
Cohesion: 1.0
Nodes (0): 

### Community 35 - "Cluster 35"
Cohesion: 1.0
Nodes (0): 

### Community 36 - "Cluster 36"
Cohesion: 1.0
Nodes (0): 

### Community 37 - "Generate Modal + API"
Cohesion: 1.0
Nodes (0): 

### Community 38 - "Cluster 38"
Cohesion: 1.0
Nodes (0): 

### Community 39 - "Cluster 39"
Cohesion: 1.0
Nodes (0): 

### Community 40 - "Cluster 40"
Cohesion: 1.0
Nodes (0): 

### Community 41 - "Cluster 41"
Cohesion: 1.0
Nodes (2): Problem definition (Korean public/legal/medical HWPX dependency on Hancom desktop), Target users (public agency PMs, SI vendors, legal staff, SaaS adopters)

### Community 42 - "Cluster 42"
Cohesion: 1.0
Nodes (2): MiniPreview component, Sidebar component

### Community 43 - "Cluster 43"
Cohesion: 1.0
Nodes (2): Mock strategy (fetch mock + MSW), Test layers (Unit/Component/E2E)

### Community 44 - "Cluster 44"
Cohesion: 1.0
Nodes (0): 

### Community 45 - "Cluster 45"
Cohesion: 1.0
Nodes (0): 

### Community 46 - "Cluster 46"
Cohesion: 1.0
Nodes (0): 

### Community 47 - "Cluster 47"
Cohesion: 1.0
Nodes (0): 

### Community 48 - "Cluster 48"
Cohesion: 1.0
Nodes (0): 

### Community 49 - "Cluster 49"
Cohesion: 1.0
Nodes (0): 

### Community 50 - "Cluster 50"
Cohesion: 1.0
Nodes (0): 

### Community 51 - "Cluster 51"
Cohesion: 1.0
Nodes (0): 

### Community 52 - "Cluster 52"
Cohesion: 1.0
Nodes (0): 

### Community 53 - "Cluster 53"
Cohesion: 1.0
Nodes (0): 

### Community 54 - "Cluster 54"
Cohesion: 1.0
Nodes (0): 

### Community 55 - "Cluster 55"
Cohesion: 1.0
Nodes (0): 

### Community 56 - "Cluster 56"
Cohesion: 1.0
Nodes (0): 

### Community 57 - "Cluster 57"
Cohesion: 1.0
Nodes (0): 

### Community 58 - "Cluster 58"
Cohesion: 1.0
Nodes (0): 

### Community 59 - "Cluster 59"
Cohesion: 1.0
Nodes (0): 

### Community 60 - "Cluster 60"
Cohesion: 1.0
Nodes (1): __init__::__init__.py

### Community 61 - "Cluster 61"
Cohesion: 1.0
Nodes (1): __init__::__init__.py

### Community 62 - "Cluster 62"
Cohesion: 1.0
Nodes (1): __init__::__init__.py

### Community 63 - "Cluster 63"
Cohesion: 1.0
Nodes (1): __init__::__init__.py

### Community 64 - "Cluster 64"
Cohesion: 1.0
Nodes (1): table block (domain term)

### Community 65 - "Cluster 65"
Cohesion: 1.0
Nodes (1): edit (domain term)

### Community 66 - "Cluster 66"
Cohesion: 1.0
Nodes (1): Non-functional requirements (LCP, TTFB, diff perf, accessibility)

### Community 67 - "Cluster 67"
Cohesion: 1.0
Nodes (1): Competitive positioning (HWPX Cursor / Notion AI)

### Community 68 - "Cluster 68"
Cohesion: 1.0
Nodes (1): Milestones (Q2 MVP, Q3 stabilize, Q4 collab, 2027 enterprise/embed)

### Community 69 - "Cluster 69"
Cohesion: 1.0
Nodes (1): StatusBar component

### Community 70 - "Cluster 70"
Cohesion: 1.0
Nodes (1): FloatingDock component

### Community 71 - "Cluster 71"
Cohesion: 1.0
Nodes (1): HistoryPanel component

### Community 72 - "Cluster 72"
Cohesion: 1.0
Nodes (1): InlineSelectionMenu component

## Knowledge Gaps
- **138 isolated node(s):** `Shared pytest fixtures.`, `Generate a small .hwpx on the fly using pyhwpxlib so tests don't     depend on e`, `Smoke tests for prompts module — ensures the verbatim port stays verbatim.`, `Tests for Claude proxy routes.  Covers request validation and the "CLI not insta`, `When `claude` is not on PATH, /once raises UPSTREAM_UNAVAILABLE.` (+133 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Cluster 34`** (2 nodes): `StreamingMessage.tsx`, `extractDisplay()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 35`** (2 nodes): `ChatMessage.tsx`, `ChatMessage.tsx::ChatMessage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 36`** (2 nodes): `InlineLoadingBlock.tsx`, `InlineLoadingBlock.tsx::InlineLoadingBlock()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Generate Modal + API`** (2 nodes): `GenerateModal.tsx`, `GenerateModal.tsx::start()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 38`** (2 nodes): `useInlineAi.ts`, `useInlineAi()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 39`** (2 nodes): `json.ts`, `json.ts::extractJson()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 40`** (2 nodes): `table.test.ts`, `table()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 41`** (2 nodes): `Problem definition (Korean public/legal/medical HWPX dependency on Hancom desktop)`, `Target users (public agency PMs, SI vendors, legal staff, SaaS adopters)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 42`** (2 nodes): `MiniPreview component`, `Sidebar component`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 43`** (2 nodes): `Mock strategy (fetch mock + MSW)`, `Test layers (Unit/Component/E2E)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 44`** (1 nodes): `tailwind.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 45`** (1 nodes): `vite.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 46`** (1 nodes): `vitest.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 47`** (1 nodes): `postcss.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 48`** (1 nodes): `setup.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 49`** (1 nodes): `main.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 50`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 51`** (1 nodes): `store.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 52`** (1 nodes): `ChatPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 53`** (1 nodes): `ChatPatchCard.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 54`** (1 nodes): `InlineErrorBlock.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 55`** (1 nodes): `SelectionOverlay.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 56`** (1 nodes): `EditPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 57`** (1 nodes): `SelectionOverlay.test.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 58`** (1 nodes): `useSelection.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 59`** (1 nodes): `json.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 60`** (1 nodes): `__init__::__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 61`** (1 nodes): `__init__::__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 62`** (1 nodes): `__init__::__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 63`** (1 nodes): `__init__::__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 64`** (1 nodes): `table block (domain term)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 65`** (1 nodes): `edit (domain term)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 66`** (1 nodes): `Non-functional requirements (LCP, TTFB, diff perf, accessibility)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 67`** (1 nodes): `Competitive positioning (HWPX Cursor / Notion AI)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 68`** (1 nodes): `Milestones (Q2 MVP, Q3 stabilize, Q4 collab, 2027 enterprise/embed)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 69`** (1 nodes): `StatusBar component`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 70`** (1 nodes): `FloatingDock component`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 71`** (1 nodes): `HistoryPanel component`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cluster 72`** (1 nodes): `InlineSelectionMenu component`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `DocumentSession` connect `rhwp WASM Bridge` to `Document I/O Routes`, `Save Route + Reveal`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Why does `apply_edits_to_hwpx()` connect `HWPX XML Patcher` to `Save Route + Reveal`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `UploadStore` connect `Document I/O Routes` to `rhwp WASM Bridge`, `Save Route + Reveal`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `DocumentSession` (e.g. with `UploadEntry` and `UploadStore`) actually correct?**
  _`DocumentSession` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `UploadStore` (e.g. with `_FakeSession` and `test_put_and_get_round_trip()`) actually correct?**
  _`UploadStore` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 13 inferred relationships involving `ClaudeOnceRequest` (e.g. with `Claude proxy routes.  - POST /api/claude/stream  → SSE passthrough (for chat pan` and `Claude Code CLI subprocess adapter.  Replaces the httpx-based direct Anthropic A`) actually correct?**
  _`ClaudeOnceRequest` has 13 INFERRED edges - model-reasoned connections that need verification._
- **Are the 11 inferred relationships involving `DocumentPlan` (e.g. with `Worker that turns a ``GenerateStartRequest`` into a registered uploadId.  Pipeli` and `Strip code fences / leading prose, return the first JSON object found.      Mirr`) actually correct?**
  _`DocumentPlan` has 11 INFERRED edges - model-reasoned connections that need verification._