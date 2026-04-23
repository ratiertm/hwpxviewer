# DESIGN_SPEC.md — Design System

이 문서는 HWPX Viewer의 **디자인 토큰과 컴포넌트 시각 명세**를 정확한 값으로 정의합니다. 코드의 `THEMES` 객체와 1:1 대응되며, 새 컴포넌트를 만들거나 기존 디자인을 수정할 때 이 문서를 기준으로 합니다.

---

## 1. 디자인 원칙

1. **Linear / Vercel 톤** — 모던 미니멀, 정밀한 타이포, 절제된 인터랙션. 화려함보다 정확함.
2. **그라데이션은 의미 있을 때만** — 인디고 → 핑크 그라데이션은 AI 관련 요소에만. 일반 UI에는 단색.
3. **다크 우선, 라이트 동등** — 두 모드는 단순한 색 반전이 아닌 각각 최적화된 토큰. 모든 컴포넌트는 양쪽에서 검증됨.
4. **계층 = 색의 강도** — 크기·굵기보다 색의 contrast로 위계 표현. `textStrong > text > textMuted > textSubtle > textFaint`.
5. **반응성은 즉각** — hover/active 트랜지션 150–200ms, 패널 슬라이드 300ms.

---

## 2. Color Tokens

### 2.1 Token 이름 체계

```
{role}{Variant}
  role:    bg | text | border | accent | diff
  variant: (없음) | Subtle | Muted | Strong | Faint | Dot | Inline | Pick | ...
```

모든 토큰은 `THEMES.dark`와 `THEMES.light` 양쪽에 존재해야 합니다.

### 2.2 Background

| Token | Dark | Light | 용도 |
|---|---|---|---|
| `bg` | `bg-zinc-950` | `bg-stone-50` | 최외곽 배경, canvas |
| `bgSubtle` | `bg-zinc-900` | `bg-white` | 카드 배경, input |
| `bgMuted` | `bg-zinc-900/50` | `bg-stone-100` | 약한 강조 영역, 표 헤더 |
| `bgDock` | `bg-zinc-900/95` | `bg-white/95` | floating dock, 메뉴 (반투명 + blur) |
| `bgPanel` | `bg-zinc-950/95` | `bg-white/95` | 사이드 패널 (chat/history) |
| `paperBg` | `bg-zinc-900` | `bg-white` | 사이드바 미니어처 종이 |
| `inputBg` | `bg-zinc-900` | `bg-stone-100` | textarea 배경 |
| `pageBg` | `bg-zinc-950` | `bg-stone-50` | main canvas 배경 |

### 2.3 Text

| Token | Dark | Light | 용도 |
|---|---|---|---|
| `textStrong` | `text-white` | `text-stone-900` | 제목, 강조 (가장 진함) |
| `text` | `text-zinc-200` | `text-stone-700` | 본문 기본 |
| `textMuted` | `text-zinc-400` | `text-stone-600` | 보조 텍스트, 라벨 |
| `textSubtle` | `text-zinc-500` | `text-stone-500` | 메타 정보 |
| `textFaint` | `text-zinc-600` | `text-stone-400` | 가장 약한 힌트, separator |

### 2.4 Border

| Token | Dark | Light | 용도 |
|---|---|---|---|
| `border` | `border-zinc-800` | `border-stone-200` | 표준 구분선 |
| `borderSubtle` | `border-zinc-800/60` | `border-stone-200/80` | 표 row 구분 등 약한 |
| `paperBorder` | `border-zinc-800` | `border-stone-200` | 사이드바 미니어처 |
| `inputBorder` | `border-zinc-700` | `border-stone-300` | textarea border |

### 2.5 Accent (인디고)

| Token | Dark | Light | 용도 |
|---|---|---|---|
| `accent` | `text-indigo-400` | `text-indigo-600` | 활성 페이지 번호, AI 마커 |
| `accentDot` | `bg-indigo-400` | `bg-indigo-500` | 활성 도트, h2 앞 작은 막대 |

### 2.6 Diff Colors

**Block-level (큰 카드, 강한 배경)**

| Token | Dark | Light | 용도 |
|---|---|---|---|
| `diffAddBg` | `bg-emerald-500/15` | `bg-emerald-50` | 추가된 블록 배경 |
| `diffAddText` | `text-emerald-300` | `text-emerald-700` | 추가 텍스트, `+` 마커 |
| `diffAddBorder` | `border-emerald-500/30` | `border-emerald-200` | 추가 카드 border |
| `diffDelBg` | `bg-rose-500/15` | `bg-rose-50` | 삭제된 블록 배경 |
| `diffDelText` | `text-rose-300` | `text-rose-700` | 삭제 텍스트, `−` 마커 |
| `diffDelBorder` | `border-rose-500/30` | `border-rose-200` | 삭제 카드 border |

**Inline (단어 단위, 작은 배경 + 텍스트)**

| Token | Dark | Light | 용도 |
|---|---|---|---|
| `diffAddInline` | `bg-emerald-500/25 text-emerald-200` | `bg-emerald-100 text-emerald-800` | 단어 단위 추가 (passive) |
| `diffDelInline` | `bg-rose-500/25 text-rose-200 line-through` | `bg-rose-100 text-rose-800 line-through` | 단어 단위 삭제 (passive) |

**Cherry-pick (활성·강조)**

| Token | Dark | Light | 용도 |
|---|---|---|---|
| `diffAddPick` | `bg-emerald-500/30 text-emerald-100 ring-1 ring-emerald-400` | `bg-emerald-200 text-emerald-900 ring-1 ring-emerald-500` | 사용자가 수락한 hunk |
| `diffDelPick` | `bg-rose-500/30 text-rose-100 ring-1 ring-rose-400 line-through` | `bg-rose-200 text-rose-900 ring-1 ring-rose-500 line-through` | 사용자가 거부한 변경 (원본 유지) |

### 2.7 Glow (atmospheric)

배경에 미세한 분위기를 더하는 라디얼 그라데이션. `pointer-events-none`로 인터랙션 방해 안 함.

```
dark:  radial-gradient(circle at 20% 0%, rgba(99, 102, 241, 0.10), transparent 50%),
       radial-gradient(circle at 80% 100%, rgba(236, 72, 153, 0.06), transparent 50%);
light: radial-gradient(circle at 20% 0%, rgba(99, 102, 241, 0.05), transparent 50%),
       radial-gradient(circle at 80% 100%, rgba(236, 72, 153, 0.03), transparent 50%);
```

### 2.8 의미 색 (Semantic)

| 의미 | Dark | Light |
|---|---|---|
| **AI / accent** | `from-indigo-400 via-purple-400 to-pink-400` (그라데이션) | 동일 |
| **Success / applied** | `text-emerald-400` `bg-emerald-500/15` | `text-emerald-700` `bg-emerald-100` |
| **Danger / undo / error** | `text-rose-400` `bg-rose-500/10` | `text-rose-600` `bg-rose-50` |
| **Multi-page badge** | `bg-purple-500/15 text-purple-300 border-purple-500/30` | `bg-purple-50 text-purple-700 border-purple-200` |
| **Connection: idle** | `bg-emerald-400` (with glow) | 동일 |
| **Connection: streaming** | `bg-indigo-400` (with glow + pulse) | 동일 |

### 2.9 Hover / Active 상태

| Token | Dark | Light |
|---|---|---|
| `hover` | `hover:bg-zinc-800` | `hover:bg-stone-200` |
| `hoverSubtle` | `hover:bg-zinc-900` | `hover:bg-stone-100` |
| `activeBg` | `bg-zinc-800` | `bg-stone-200` |

### 2.10 Primary Button

| Token | Dark | Light |
|---|---|---|
| `btnPrimary` | `bg-white text-zinc-900 hover:bg-zinc-200` | `bg-stone-900 text-white hover:bg-stone-700` |

---

## 3. Typography

폰트는 `font-sans`(Inter 또는 시스템 기본). 별도 웹폰트 로드 안 함 (Artifacts 제약).

### 3.1 Type Scale

| 용도 | Tailwind | 크기 (rem) | 무게 | letter-spacing |
|---|---|---|---|---|
| **Cover hero** | `text-6xl` | 3.75 | `font-semibold` | `tracking-tight` |
| **Page title (h1)** | `text-4xl` | 2.25 | `font-semibold` | `tracking-tight` |
| **Section title (h2)** | `text-base` | 1 | `font-semibold` | `tracking-tight` |
| **Lead** | `text-lg` | 1.125 | `font-light` | 기본 |
| **Body (p)** | `text-base` | 1 | 기본 | 기본 |
| **Table cell** | `text-sm` | 0.875 | 기본 | 기본 |
| **Table header** | `text-xs` | 0.75 | `font-semibold` | `uppercase tracking-wider` |
| **UI label** | `text-sm` | 0.875 | `font-medium` | 기본 |
| **UI hint / meta** | `text-xs` | 0.75 | 기본 | 기본 |
| **Section marker** | `text-xs` | 0.75 | `font-mono` | `tracking-wider` |
| **Kbd** | inline `style={{ fontSize: '10px' }}` | — | 기본 | 기본 |

### 3.2 Line Height

본문 단락은 `leading-relaxed` (1.625). 표/UI는 기본 (1.5). 큰 타이틀은 `leading-tight` (1.25).

### 3.3 Numbers

수치는 항상 `tabular-nums` 적용. 표, 페이지 번호, 시간, 카운터 등.

### 3.4 Mono

섹션 번호 (`SECTION 01`), 시간 (`2m ago`), kbd 단축키, diff 마커 (`+`, `−`)에 `font-mono`.

---

## 4. Spacing

표준 스케일은 Tailwind 기본 (`px-1`, `px-2`, `px-3`, `px-4`, `px-6`, `px-8`, `px-12`, `px-16`).

### 4.1 컴포넌트별 패딩 가이드

| 컴포넌트 | Padding |
|---|---|
| Top header | `h-12 px-4` |
| Status footer | `h-7 px-4` |
| Sidebar item | `p-2 gap-3` |
| Page canvas (text content) | `px-12 py-20` |
| Cover page | `px-12 py-20` |
| Diff card | `px-3 py-2` (헤더), `px-3 py-3` (본문) |
| Chat message | `px-3 py-2` (user 버블), `px-4 py-4` (영역 패딩) |
| Floating dock | `px-2 py-1.5` (외곽), `w-8 h-8` (버튼) |
| User menu | `w-64`, 내부 `px-3 py-1.5` (item) |

### 4.2 Gap

- 인접 요소 그룹: `gap-1` ~ `gap-2`
- 카드 사이: `space-y-4`
- 본문 블록 사이: `space-y-5`
- 큰 섹션 사이: `space-y-12` 또는 `mt-12`

---

## 5. Radius

| 컴포넌트 | Radius |
|---|---|
| 버튼 (작은) | `rounded-md` (6px) |
| 버튼 (둥근) | `rounded-full` (dock 버튼) |
| 카드 / 패널 | `rounded-lg` ~ `rounded-xl` (8px ~ 12px) |
| 드롭다운 / 메뉴 | `rounded-xl` |
| 표 컨테이너 | `rounded-xl` |
| 사이드바 미니어처 | `rounded` (4px) |
| 큰 cover 로고 | `rounded-2xl` (16px) |
| 도트 / dot indicator | `rounded-full` |

---

## 6. Shadows

Tailwind 기본 그림자는 다크 모드에서 약함. **인라인 style로 직접 지정**:

### 6.1 Floating Dock / Menu

```js
boxShadow: theme === 'dark'
  ? '0 10px 40px -10px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)'
  : '0 10px 40px -10px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.04)',
```

### 6.2 Cover hero 로고

```js
boxShadow: '0 20px 60px -15px rgba(99, 102, 241, 0.5)'
```

### 6.3 Connection dot glow

```js
boxShadow: '0 0 6px rgba(52, 211, 153, 0.6)'   // emerald
boxShadow: '0 0 6px rgba(129, 140, 248, 0.6)'  // indigo (streaming)
```

### 6.4 User menu dropdown (더 큰)

```js
boxShadow: theme === 'dark'
  ? '0 16px 48px -12px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)'
  : '0 16px 48px -12px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.04)',
```

### 6.5 Inline cherry-pick selection menu

```js
boxShadow: theme === 'dark'
  ? '0 8px 32px -8px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)'
  : '0 8px 32px -8px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.04)',
```

---

## 7. Animation / Transition

| 대상 | Duration | Easing |
|---|---|---|
| Theme 전환 | `duration-300` | 기본 |
| 사이드바/패널 슬라이드 | `duration-300 ease-in-out` | |
| Hover 색상 변화 | `transition-colors` (150ms 기본) | |
| 버튼 scale | `hover:scale-105` ~ `hover:scale-110` | |
| Flash highlight | 2.5s 후 자동 제거 (setTimeout) | |
| Streaming cursor | `animate-pulse` | |
| Loading dots | `animate-pulse` with staggered `animationDelay` (0, 150ms, 300ms) | |

### 7.1 Flash 효과

페이지 편집 후 인디고 ring을 2.5초간 적용:

```jsx
className={`... ${highlightedSections.has(p.id) ? 'ring-2 ring-indigo-500/50 ring-inset' : ''}`}
// + setTimeout(() => setHighlightedSections(new Set()), 2500)
```

---

## 8. 컴포넌트 시각 명세

각 컴포넌트의 default / hover / active / disabled / focus 상태를 정의.

### 8.1 Top Header

| 영역 | 스타일 |
|---|---|
| 컨테이너 | `h-12 px-4` `border-b ${border}` `${theme === 'dark' ? 'bg-zinc-950/80' : 'bg-white/80'} backdrop-blur-xl` `z-20` |
| 로고 마크 | `w-5 h-5 rounded` `bg-gradient-to-br from-indigo-400 via-purple-400 to-pink-400` |
| 모델 배지 | `bg-indigo-500/15 text-indigo-300 border-indigo-500/30` (다크) / `bg-indigo-50 text-indigo-700 border-indigo-200` (라이트) |
| 일반 액션 버튼 | `w-7 h-7 rounded-md ${hover}` |
| Search 인풋 | `${bgSubtle}` `border ${border}` `rounded-md h-7 px-2.5` |
| Export 버튼 (primary) | `${btnPrimary}` `text-xs font-medium px-2.5 h-7 rounded-md` |
| AI 토글 (active) | `bg-gradient-to-r from-indigo-500 to-pink-500 text-white` |
| AI 토글 (idle) | 그라데이션 ghost: `from-indigo-500/15 to-pink-500/15 border border-indigo-500/30` |

### 8.2 Sidebar

| 영역 | 스타일 |
|---|---|
| 컨테이너 (열림) | `w-72 border-r ${border} ${bg}` |
| 컨테이너 (닫힘) | `w-0` (트랜지션) |
| Pages 헤더 | `text-xs font-semibold uppercase tracking-widest ${textSubtle}` |
| 페이지 항목 (default) | `flex gap-3 p-2 rounded-lg ${hoverSubtle}` |
| 페이지 항목 (active) | `${activeBg}` |
| 페이지 항목 (flashing) | `ring-2 ring-indigo-500/50` |
| 미니어처 박스 | `w-14 aspect-[1/1.414] rounded border ${paperBorder} ${paperBg}` |
| 미니어처 박스 (active) | `border-indigo-500/50` (다크) / `border-indigo-500` (라이트) |
| 섹션 번호 (active) | `${accent}` |
| 섹션 번호 (idle) | `${textFaint}` |
| 활성 도트 | `w-1 h-1 rounded-full ${accentDot}` |

### 8.3 Canvas Content

| 영역 | 스타일 |
|---|---|
| 페이지 wrapper | `max-w-3xl mx-auto px-12 py-20` |
| 섹션 마커 | `text-xs font-mono ${textFaint} tracking-wider` + `gradient line` |
| h1 | `text-4xl font-semibold ${textStrong} tracking-tight leading-tight` |
| lead | `text-lg leading-relaxed ${textMuted} font-light` |
| h2 | `text-base font-semibold ${text} mt-12 mb-2 tracking-tight` + `accentDot bar` |
| p | `text-base leading-relaxed ${text}` |
| 표 컨테이너 | `rounded-xl border ${border} ${bgMuted}` |
| 표 헤더 row | `${theme === 'dark' ? 'bg-zinc-900' : 'bg-stone-100/60'}` |
| 표 헤더 셀 | `px-4 py-3 text-xs uppercase tracking-wider font-semibold ${textMuted}` |
| 표 본문 row | `border-b ${borderSubtle}` + hover |
| 표 첫 컬럼 | `${textStrong} font-medium` |
| 표 일반 셀 | `${textMuted} tabular-nums` |
| `●` 마커 셀 | `${accent}` |
| 페이지 디바이더 | `— 01 —` `font-mono ${textFaint}` + 양쪽 1px 라인 |

### 8.4 Floating Dock

| 영역 | 스타일 |
|---|---|
| 컨테이너 | `fixed bottom-6 left-1/2 -translate-x-1/2 z-30` |
| 외곽 | `flex items-center gap-1 px-2 py-1.5 rounded-full ${bgDock} border ${border} backdrop-blur-xl` + custom shadow |
| 일반 버튼 | `w-8 h-8 rounded-full ${textMuted} ${hover} hover:scale-110` |
| 페이지 카운터 | `px-3 py-1 text-xs font-medium ${textStrong} tabular-nums min-w-[60px] text-center` |
| 줌 카운터 | `px-2 text-xs font-medium ${textMuted} tabular-nums min-w-[42px] text-center` |
| Divider | `w-px h-5 ${theme === 'dark' ? 'bg-zinc-700' : 'bg-stone-300'} mx-1` |
| AI 마법봉 (active) | `bg-gradient-to-br from-indigo-500 to-pink-500 text-white hover:scale-110` |
| 비활성 버튼 | `disabled:opacity-30 disabled:cursor-not-allowed` |

### 8.5 Status Bar

| 영역 | 스타일 |
|---|---|
| 컨테이너 | `h-7 px-4 border-t ${border}` `${theme === 'dark' ? 'bg-zinc-950/80' : 'bg-white/80'} backdrop-blur-xl` `text-xs ${textSubtle} tabular-nums` |
| Divider | `w-px h-3 ${theme === 'dark' ? 'bg-zinc-800' : 'bg-stone-200'}` |
| Connection 도트 (idle) | `w-1.5 h-1.5 rounded-full bg-emerald-400` + emerald glow |
| Connection 도트 (streaming) | `bg-indigo-400 animate-pulse` + indigo glow |

### 8.6 Chat Panel

| 영역 | 스타일 |
|---|---|
| 컨테이너 | `w-[420px] border-l ${border} ${bgPanel} backdrop-blur-xl` |
| 헤더 | `h-12 px-4 border-b ${border}` |
| 헤더 아바타 | `w-6 h-6 rounded bg-gradient-to-br from-indigo-400 via-purple-400 to-pink-400` |
| 메시지 영역 | `flex-1 overflow-y-auto px-4 py-4 space-y-4` |
| User 버블 | `max-w-[85%] px-3 py-2 rounded-2xl rounded-br-sm ${theme === 'dark' ? 'bg-zinc-800 text-zinc-100' : 'bg-stone-200 text-stone-900'}` |
| Assistant 메시지 | `flex gap-2.5` + 작은 그라데이션 아바타 |
| 적용됨 배지 | `bg-emerald-500/15 text-emerald-400` (다크) / `bg-emerald-100 text-emerald-700` (라이트) |
| 되돌려짐 배지 | `bg-zinc-800 text-zinc-400` (다크) / `bg-stone-200 text-stone-600` (라이트) |
| 멀티 페이지 배지 | purple semantic color (위 표 참조) |
| 입력창 | `rounded-xl border ${inputBorder} ${inputBg}` + `focus-within:ring-2 focus-within:ring-indigo-500/40` |
| 전송 버튼 | `bg-gradient-to-br from-indigo-500 to-pink-500` `w-7 h-7 rounded-lg` |

### 8.7 History Panel

| 영역 | 스타일 |
|---|---|
| 컨테이너 | `w-80 border-l ${border} ${bgPanel}` |
| 타임라인 라인 | `absolute left-[27px] top-6 bottom-6 w-px ${theme === 'dark' ? 'bg-zinc-800' : 'bg-stone-200'}` |
| 노드 (active) | `w-4 h-4 rounded-full bg-gradient-to-br from-indigo-400 to-pink-400` + 안에 흰 도트 |
| 노드 (undone) | `w-4 h-4 rounded-full ${theme === 'dark' ? 'bg-zinc-900 border-zinc-700' : 'bg-stone-100 border-stone-300'} border-2` |
| 엔트리 카드 | `rounded-lg border ${border} ${bgMuted}` (undone 시 `opacity-60`) |
| 되돌리기 버튼 | rose semantic |
| 다시 적용 버튼 | indigo accent |

### 8.8 User Dropdown Menu

| 영역 | 스타일 |
|---|---|
| 트리거 (avatar) | `w-7 h-7 rounded-full ring-2 ring-transparent` (open 시 `ring-zinc-600` 다크 / `ring-stone-300` 라이트) |
| 메뉴 컨테이너 | `absolute right-0 top-full mt-2 w-64 rounded-xl border ${border} ${bgDock}` + custom shadow |
| 프로필 헤더 | `w-10 h-10 rounded-full` 큰 아바타 + 이름/이메일 |
| 워크스페이스 박지 | 작은 아이콘 + 이름 + plan |
| 메뉴 아이템 | `px-3 py-1.5 text-sm ${text} ${hover} flex items-center gap-2.5` |
| 단축키 hint | `text-[10px] ${textFaint} font-mono tabular-nums` |
| 로그아웃 항목 | rose semantic, 별도 구분선 위에 |

### 8.9 Inline Selection Menu (drag 시)

| 영역 | 스타일 |
|---|---|
| 컨테이너 | `fixed z-40 -translate-x-1/2 -translate-y-full` |
| 외곽 | `flex items-center gap-0.5 px-1.5 py-1.5 rounded-xl ${bgDock} border ${border} backdrop-blur-xl` |
| AI 라벨 | sparkles 아이콘 + `${textMuted}` |
| Divider | `w-px h-4` |
| 액션 버튼 | `flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs ${textMuted} ${hover}` |
| 꼬리 (tail) | `w-2 h-2 rotate-45` 같은 색 배경 |

### 8.10 Inline Cherry-pick Diff

| 영역 | 스타일 |
|---|---|
| 컨테이너 | `rounded-lg border` (다크: `border-indigo-500/40`, 라이트: `border-indigo-400`) |
| 헤더 | `px-3 py-2 ${theme === 'dark' ? 'bg-zinc-900' : 'bg-stone-50'} border-b ${border}` + AI sparkles + 카운터 |
| Diff 본문 | `px-3 py-3 ${bgMuted}` `text-base leading-relaxed ${text}` |
| Hunk (수락 상태) | `${diffAddPick}` (인접 del은 `${diffDelInline} opacity-50`) |
| Hunk (거부 상태) | `${diffDelPick}` (인접 add는 `${diffAddInline} opacity-40`) |
| 최종 결과 미리보기 | `px-3 py-2.5 border-t ${border} ${theme === 'dark' ? 'bg-zinc-950' : 'bg-white'}` |
| 적용 버튼 | `bg-gradient-to-r from-indigo-500 to-pink-500 text-white` |

---

## 9. Z-index Scale

| Z | 용도 |
|---|---|
| `z-10` | 일반 콘텐츠 영역 (canvas content) |
| `z-20` | top header (sticky 효과) |
| `z-30` | floating dock |
| `z-40` | floating menus (selection, etc.) |
| `z-50` | dropdown / modal (user menu) |

새 컴포넌트 추가 시 이 스케일을 따르되, 50 이상은 모달/오버레이용으로 보존.

---

## 10. Iconography

라이브러리: **lucide-react@0.383.0**

### 10.1 표준 아이콘 크기

| 컨텍스트 | 크기 |
|---|---|
| 헤더 / 상태바 | `size={11}` ~ `size={14}` |
| dock 버튼 | `size={15}` |
| 메시지 / inline 액션 | `size={10}` ~ `size={12}` |
| 큰 빈 상태 일러스트 | `size={20}` |

### 10.2 의미 → 아이콘 매핑

| 의미 | 아이콘 |
|---|---|
| AI / accent | `Sparkles`, `Wand2` |
| 페이지 | `FileText` |
| 사이드바 토글 | `PanelLeft` |
| Undo | `Undo2` |
| Redo | `Redo2` |
| Diff 보기 | `Eye` / `EyeOff` |
| 적용됨 | `Check` |
| 에러 | `AlertCircle` |
| History | `History`, `GitBranch`, `Clock` |
| 멀티페이지 | `Layers` |
| 닫기 | `X` |
| 검색 | `Search` |
| 인쇄 | `Printer` |
| 줌 | `ZoomIn`, `ZoomOut` |
| 전체화면 | `Maximize2` |
| 페이지 이동 | `ChevronLeft`, `ChevronRight` |
| 인라인 액션 | `Pencil` (다시 쓰기), `Minimize` (간결하게), `Languages` (영어로) |
| User 메뉴 | `User`, `Settings`, `LogOut`, `CreditCard`, `HelpCircle`, `Keyboard` |
| 대화 초기화 | `Trash2` |
| 채팅 | `MessageSquare` |

같은 의미는 항상 같은 아이콘. 새 의미가 등장하면 이 표에 추가.

---

## 11. Layout 및 Breakpoints

현재 v1: **데스크톱 우선** (1280px+).

- min-width: 1280px 권장 (사이드바 + 본문 + 채팅 패널)
- 사이드바: 288px (`w-72`)
- 본문 max-width: 768px (`max-w-3xl`)
- 채팅 패널: 420px
- History 패널: 320px (`w-80`)

모바일·태블릿 대응은 v2. 현재 미디어 쿼리 거의 없음.

---

## 12. 접근성 가이드

- 모든 인터랙티브 요소는 `<button>` 또는 `<a>` 사용 (div + onClick 금지)
- 아이콘 전용 버튼은 `title` 속성 필수 (툴팁 + 스크린리더)
- focus 상태: 입력창은 `focus-within:ring-2 focus-within:ring-indigo-500/40`
- 색만으로 의미 전달 금지: diff에 `+` `−` 문자 마커 함께 사용
- 색 대비: 다크의 `textFaint`(zinc-600) on `bg`(zinc-950) 조합도 텍스트 본문에는 사용 안 함 (메타용으로 한정)

---

## 13. Theme 추가 가이드

새 테마(예: `'sepia'`, `'high-contrast'`)를 추가하려면:

1. `THEMES` 객체에 새 키 추가, **기존 다크/라이트의 모든 토큰 키를 동일하게** 채울 것
2. theme switcher 컴포넌트의 토글 로직 확장 (현재는 dark↔light 단순 토글)
3. `theme === 'dark'`로 분기하는 인라인 style·conditional 클래스를 모두 점검 (이런 곳이 많음 — 향후 token으로 추출 권장)

**알려진 이슈**: 일부 컴포넌트가 `theme === 'dark'` 직접 비교를 인라인 style에 사용하고 있어 새 테마 추가 시 깨질 수 있음. 리팩토링 시 이 부분을 토큰 함수로 추출 (`getShadow(theme)`, `getDividerColor(theme)` 등).

---

## 14. 디자인 결정 기록

- **그라데이션은 AI 전용** — 일반 UI에 그라데이션 남발하지 않음. AI = 그라데이션, 일반 액션 = 단색.
- **둥근 dock pill** — 사각 툴바 대신 floating pill. Linear 영향. 콘텐츠 영역과의 분리감.
- **사이드바 미니어처는 추상 막대로** — 실제 페이지 thumbnail 대신 블록 종류별 막대. 가벼움 + 모던함.
- **diff 색은 emerald/rose** — green/red는 채도가 너무 높음. emerald/rose가 차분.
- **ring으로 활성 강조** — border 대신 ring 사용 시 레이아웃 안 흔들림.
- **`/95` 반투명 + backdrop-blur** — Apple 스타일의 깊이감. 하지만 너무 남용하지 않음 (top header, dock, panel 정도).
