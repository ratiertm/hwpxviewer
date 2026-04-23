import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  ChevronLeft, ChevronRight, Search, Download, MoreHorizontal,
  PanelLeft, Command, FileText, Sparkles, Sun, Moon,
  ZoomIn, ZoomOut, Maximize2, Printer, X, Wand2, ArrowUp, Check,
  Undo2, Redo2, Eye, EyeOff, Pencil, Languages, Minimize,
  History, Clock, GitBranch, AlertCircle, Layers, Trash2, MessageSquare,
  User, Settings, LogOut, CreditCard, HelpCircle, Keyboard,
} from 'lucide-react';

// ==========================================
//  LCS-based word diff (same as v7)
// ==========================================
function tokenize(text) {
  return text.match(/[\w가-힣]+|\s+|[^\w\s가-힣]/g) || [];
}
function lcsMatrix(a, b) {
  const m = a.length, n = b.length;
  const dp = Array(m + 1).fill(null).map(() => new Int32Array(n + 1));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
    else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
  }
  return dp;
}
function diffTokens(oldText, newText) {
  const a = tokenize(oldText), b = tokenize(newText);
  const dp = lcsMatrix(a, b);
  const ops = [];
  let i = a.length, j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { ops.push({ type: 'eq', token: a[i - 1] }); i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) { ops.push({ type: 'del', token: a[i - 1] }); i--; }
    else { ops.push({ type: 'add', token: b[j - 1] }); j--; }
  }
  while (i > 0) { ops.push({ type: 'del', token: a[i - 1] }); i--; }
  while (j > 0) { ops.push({ type: 'add', token: b[j - 1] }); j--; }
  ops.reverse();
  const merged = [];
  for (const op of ops) {
    const last = merged[merged.length - 1];
    if (last && last.type === op.type) last.token += op.token;
    else merged.push({ ...op });
  }
  return merged;
}
function groupHunks(ops) {
  const hunks = [];
  let i = 0, hunkId = 0;
  while (i < ops.length) {
    const op = ops[i];
    if (op.type === 'eq') { hunks.push({ kind: 'eq', token: op.token }); i++; }
    else {
      const dels = [], adds = [];
      while (i < ops.length && ops[i].type !== 'eq') {
        if (ops[i].type === 'del') dels.push(ops[i].token);
        else adds.push(ops[i].token);
        i++;
      }
      hunks.push({ kind: 'change', id: hunkId++, del: dels.join(''), add: adds.join('') });
    }
  }
  return hunks;
}
function reconstructText(hunks, acceptedIds) {
  let out = '';
  for (const h of hunks) {
    if (h.kind === 'eq') out += h.token;
    else if (acceptedIds.has(h.id)) out += h.add;
    else out += h.del;
  }
  return out;
}

// ==========================================
//  Table diff — row & column level
// ==========================================
function diffTable(oldTable, newTable) {
  const oldHeaders = oldTable.headers || [];
  const newHeaders = newTable.headers || [];
  const oldRows = oldTable.rows || [];
  const newRows = newTable.rows || [];

  // Header column diff: by content match
  const headerOps = [];
  const oldHIndices = new Map(oldHeaders.map((h, i) => [h, i]));
  const matchedOldH = new Set();
  for (let j = 0; j < newHeaders.length; j++) {
    const h = newHeaders[j];
    if (oldHIndices.has(h) && !matchedOldH.has(oldHIndices.get(h))) {
      headerOps.push({ type: 'eq', header: h, oldIdx: oldHIndices.get(h), newIdx: j });
      matchedOldH.add(oldHIndices.get(h));
    } else {
      headerOps.push({ type: 'add', header: h, newIdx: j });
    }
  }
  for (let i = 0; i < oldHeaders.length; i++) {
    if (!matchedOldH.has(i)) {
      headerOps.push({ type: 'del', header: oldHeaders[i], oldIdx: i });
    }
  }

  // Row diff: by first column (assumes first cell is unique label)
  const rowOps = [];
  const oldRowIndices = new Map(oldRows.map((r, i) => [r[0], i]));
  const matchedOldR = new Set();
  let opId = 0;

  for (let j = 0; j < newRows.length; j++) {
    const newRow = newRows[j];
    const key = newRow[0];
    if (oldRowIndices.has(key) && !matchedOldR.has(oldRowIndices.get(key))) {
      const oldIdx = oldRowIndices.get(key);
      const oldRow = oldRows[oldIdx];
      // Compare cells
      const same = JSON.stringify(oldRow) === JSON.stringify(newRow);
      rowOps.push({
        id: opId++,
        type: same ? 'eq' : 'change',
        oldRow, newRow, oldIdx, newIdx: j,
      });
      matchedOldR.add(oldIdx);
    } else {
      rowOps.push({ id: opId++, type: 'add', newRow, newIdx: j });
    }
  }
  for (let i = 0; i < oldRows.length; i++) {
    if (!matchedOldR.has(i)) {
      rowOps.push({ id: opId++, type: 'del', oldRow: oldRows[i], oldIdx: i });
    }
  }

  return { headerOps, rowOps };
}

// Reconstruct table from diff + accepted IDs
function reconstructTable(oldTable, newTable, headerOps, rowOps, acceptedRowIds, acceptedHeaderCols) {
  // Headers: keep all eq, add accepted "add" headers, remove accepted "del" headers
  const finalHeaders = [];
  // Build from newHeaders order, but filter
  for (const op of headerOps) {
    if (op.type === 'eq') finalHeaders.push(op.header);
    else if (op.type === 'add' && acceptedHeaderCols.has(op.header)) finalHeaders.push(op.header);
  }
  // Add back deleted headers if not accepted
  for (const op of headerOps) {
    if (op.type === 'del' && !acceptedHeaderCols.has(op.header)) finalHeaders.push(op.header);
  }

  // Rows
  const finalRows = [];
  for (const op of rowOps) {
    if (op.type === 'eq') {
      finalRows.push(reshapeCells(op.newRow, op.newRow, oldTable.headers, newTable.headers, finalHeaders));
    } else if (op.type === 'add') {
      if (acceptedRowIds.has(op.id)) {
        finalRows.push(reshapeCells(op.newRow, null, newTable.headers, newTable.headers, finalHeaders));
      }
    } else if (op.type === 'del') {
      if (!acceptedRowIds.has(op.id)) {
        finalRows.push(reshapeCells(op.oldRow, null, oldTable.headers, oldTable.headers, finalHeaders));
      }
    } else if (op.type === 'change') {
      const useRow = acceptedRowIds.has(op.id) ? op.newRow : op.oldRow;
      const sourceHeaders = acceptedRowIds.has(op.id) ? newTable.headers : oldTable.headers;
      finalRows.push(reshapeCells(useRow, null, sourceHeaders, sourceHeaders, finalHeaders));
    }
  }

  return { headers: finalHeaders, rows: finalRows };
}

function reshapeCells(row, _altRow, sourceHeaders, _newHeaders, finalHeaders) {
  return finalHeaders.map((h) => {
    const idx = sourceHeaders.indexOf(h);
    return idx >= 0 ? (row[idx] ?? '') : '';
  });
}

// ==========================================
//  Data
// ==========================================
const INITIAL_PAGES = [
  { id: 0, title: 'Cover', section: '00', isCover: true },
  {
    id: 1, title: 'Overview', section: '01',
    body: [
      { type: 'h1', text: '연구개발사업 추진 계획서' },
      { type: 'lead', text: '2026년도 정부 R&D 과제 신청 — 한컴 표준 양식, 나라장터 제출 규격 준수.' },
      { type: 'h2', text: '사업 목적' },
      { type: 'p', text: '공공기관 문서 자동화 인프라를 구축하여 HWPX 기반 서버 사이드 문서 생성 파이프라인을 표준화한다.' },
      { type: 'h2', text: '배경' },
      { type: 'p', text: '국내 공공·법무·의료 분야에서 HWPX는 사실상의 표준이나, 서버 환경에서 프로그래밍적으로 생성·편집할 수 있는 공식 SDK가 부재하다.' },
    ],
  },
  {
    id: 2, title: 'Timeline', section: '02',
    body: [
      { type: 'h1', text: '추진 체계 및 일정' },
      { type: 'h2', text: '분기별 일정' },
      { type: 'table', headers: ['단계', 'Q1', 'Q2', 'Q3', 'Q4'], rows: [
        ['요구분석', '●', '', '', ''],
        ['설계', '', '●', '', ''],
        ['개발', '', '●', '●', ''],
        ['테스트', '', '', '●', '●'],
        ['납품', '', '', '', '●'],
      ]},
      { type: 'p', text: '각 단계 산출물은 .hwpx로 작성되어 발주처에 제출된다.' },
    ],
  },
  {
    id: 3, title: 'Budget', section: '03',
    body: [
      { type: 'h1', text: '예산 계획' },
      { type: 'lead', text: '총 사업비 ₩150,000,000 — 인건비 중심 구조.' },
      { type: 'table', headers: ['항목', '금액 (KRW)', '비율'], rows: [
        ['인건비', '90,000,000', '60%'],
        ['직접경비', '37,500,000', '25%'],
        ['간접비', '22,500,000', '15%'],
      ]},
    ],
  },
  {
    id: 4, title: 'Conclusion', section: '04',
    body: [
      { type: 'h1', text: '결론' },
      { type: 'p', text: '본 사업의 성공적 수행을 통해 국내 공공기관의 문서 자동화 수준이 한 단계 도약할 것으로 기대된다.' },
    ],
  },
];

const THEMES = {
  dark: {
    bg: 'bg-zinc-950', bgSubtle: 'bg-zinc-900', bgMuted: 'bg-zinc-900/50',
    bgDock: 'bg-zinc-900/95', bgPanel: 'bg-zinc-950/95',
    text: 'text-zinc-200', textStrong: 'text-white',
    textMuted: 'text-zinc-400', textSubtle: 'text-zinc-500', textFaint: 'text-zinc-600',
    border: 'border-zinc-800', borderSubtle: 'border-zinc-800/60',
    hover: 'hover:bg-zinc-800', hoverSubtle: 'hover:bg-zinc-900',
    activeBg: 'bg-zinc-800',
    btnPrimary: 'bg-white text-zinc-900 hover:bg-zinc-200',
    accent: 'text-indigo-400', accentDot: 'bg-indigo-400',
    pageBg: 'bg-zinc-950',
    paperBg: 'bg-zinc-900', paperBorder: 'border-zinc-800',
    inputBg: 'bg-zinc-900', inputBorder: 'border-zinc-700',
    diffAddBg: 'bg-emerald-500/15', diffAddText: 'text-emerald-300', diffAddBorder: 'border-emerald-500/30',
    diffDelBg: 'bg-rose-500/15', diffDelText: 'text-rose-300', diffDelBorder: 'border-rose-500/30',
    diffAddInline: 'bg-emerald-500/25 text-emerald-200',
    diffDelInline: 'bg-rose-500/25 text-rose-200 line-through',
    diffAddPick: 'bg-emerald-500/30 text-emerald-100 ring-1 ring-emerald-400',
    diffDelPick: 'bg-rose-500/30 text-rose-100 ring-1 ring-rose-400 line-through',
    glow: 'radial-gradient(circle at 20% 0%, rgba(99, 102, 241, 0.10), transparent 50%), radial-gradient(circle at 80% 100%, rgba(236, 72, 153, 0.06), transparent 50%)',
  },
  light: {
    bg: 'bg-stone-50', bgSubtle: 'bg-white', bgMuted: 'bg-stone-100',
    bgDock: 'bg-white/95', bgPanel: 'bg-white/95',
    text: 'text-stone-700', textStrong: 'text-stone-900',
    textMuted: 'text-stone-600', textSubtle: 'text-stone-500', textFaint: 'text-stone-400',
    border: 'border-stone-200', borderSubtle: 'border-stone-200/80',
    hover: 'hover:bg-stone-200', hoverSubtle: 'hover:bg-stone-100',
    activeBg: 'bg-stone-200',
    btnPrimary: 'bg-stone-900 text-white hover:bg-stone-700',
    accent: 'text-indigo-600', accentDot: 'bg-indigo-500',
    pageBg: 'bg-stone-50',
    paperBg: 'bg-white', paperBorder: 'border-stone-200',
    inputBg: 'bg-stone-100', inputBorder: 'border-stone-300',
    diffAddBg: 'bg-emerald-50', diffAddText: 'text-emerald-700', diffAddBorder: 'border-emerald-200',
    diffDelBg: 'bg-rose-50', diffDelText: 'text-rose-700', diffDelBorder: 'border-rose-200',
    diffAddInline: 'bg-emerald-100 text-emerald-800',
    diffDelInline: 'bg-rose-100 text-rose-800 line-through',
    diffAddPick: 'bg-emerald-200 text-emerald-900 ring-1 ring-emerald-500',
    diffDelPick: 'bg-rose-200 text-rose-900 ring-1 ring-rose-500 line-through',
    glow: 'radial-gradient(circle at 20% 0%, rgba(99, 102, 241, 0.05), transparent 50%), radial-gradient(circle at 80% 100%, rgba(236, 72, 153, 0.03), transparent 50%)',
  },
};

const SUGGESTIONS = [
  '예산 표에 비고 컬럼과 합계 행을 추가해줘',
  'Timeline 표에 책임자 컬럼 추가',
  '전체 문서 톤을 더 격식 있게 통일해줘',
  '결론을 더 임팩트 있게 다시 써줘',
];

const INLINE_ACTIONS = [
  { id: 'rewrite', label: '다시 쓰기', icon: Pencil },
  { id: 'shorten', label: '간결하게', icon: Minimize },
  { id: 'translate', label: '영어로', icon: Languages },
];

// ==========================================
//  Anthropic API — streaming + multi-turn
// ==========================================
const SYSTEM_DOC_EDITOR = `너는 한국어 공공/기업 문서를 편집하는 전문 에디터다.
사용자와 멀티턴 대화로 문서를 다듬는다. 이전 대화 맥락을 기억하고 연속성 있게 응답한다.

문서 블록 타입:
- h1: 페이지 제목
- h2: 섹션 제목
- lead: 도입 문단
- p: 본문 문단
- table: { type: "table", headers: [...], rows: [[...], [...]] }

응답은 반드시 아래 JSON 형식만 (코드 펜스 없이, 다른 설명 없이):
{
  "summary": "사용자에게 보여줄 1~2문장 요약 (한국어)",
  "edits": [
    {
      "pageTitle": "페이지 제목 (정확히 일치: Overview, Timeline, Budget, Conclusion)",
      "newBody": [ /* 페이지 전체 블록 배열 */ ],
      "rationale": "이 페이지를 왜 이렇게 바꿨는지 짧게"
    }
  ]
}

규칙:
- 사용자가 여러 페이지를 명시하거나 "전체"를 말하면 edits에 여러 항목.
- newBody는 페이지 전체를 새로 구성. 기존 내용 보존하려면 그대로 포함하고 변경/추가만.
- 표를 수정할 때는 type:"table" 형식 정확히 준수, headers와 rows 길이 일치.
- 격식 있는 한국어, 명확한 위계.
- 단순 질문/대화면 edits는 빈 배열로 두고 summary에 답변.`;

const SYSTEM_INLINE_EDITOR = `너는 한국어 문장의 일부를 수정하는 에디터다.
원본 문장과 그 안에서 사용자가 선택한 부분, 요청 액션이 주어진다.
선택된 부분만 수정한 새 문장 전체를 한국어로 출력한다.

응답은 반드시 아래 JSON만 (코드 펜스 없이):
{ "newText": "수정된 전체 문장" }

액션:
- rewrite: 선택 부분을 같은 의미로 더 자연스럽게 다시 쓰기
- shorten: 선택 부분을 더 간결하게
- translate: 선택 부분만 영어로 번역해서 원본 위치에 삽입`;

// Streaming call — yields text chunks
async function* streamClaude(systemPrompt, conversation) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      stream: true,
      system: systemPrompt,
      messages: conversation,
    }),
  });
  if (!response.ok) throw new Error(`API error: ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Parse SSE: lines starting with "data: "
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // keep incomplete last line
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const evt = JSON.parse(data);
        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
          yield evt.delta.text;
        }
      } catch {
        // ignore parse errors
      }
    }
  }
}

// Non-streaming for inline edits (faster, simpler)
async function callClaudeOnce(systemPrompt, userPrompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  const data = await response.json();
  return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

function extractJson(text) {
  const cleaned = text.replace(/```json\s*|```/g, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch {}
  }
  throw new Error('JSON parse failed');
}

// ==========================================
//  Main component
// ==========================================
export default function HwpxViewer() {
  const [pages, setPages] = useState(INITIAL_PAGES);
  const [currentPage, setCurrentPage] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [theme, setTheme] = useState('dark');
  const [zoom, setZoom] = useState(100);
  const [chatInput, setChatInput] = useState('');

  // Multi-turn conversation: stored as Anthropic messages format
  // Each turn is also rendered in UI; UI extends with edit metadata
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: '안녕하세요. 이 문서를 함께 다듬어 드릴 수 있어요.\n\n• 멀티턴 대화 — 이전 맥락을 기억합니다\n• 스트리밍 응답 — 한 글자씩 들어옵니다\n• 표 셀 단위 cherry-pick\n\n실제 Claude Sonnet 4가 응답합니다.',
      ui: 'static', // not part of API conversation history
    },
  ]);

  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [highlightedSections, setHighlightedSections] = useState(new Set());

  const [history, setHistory] = useState([]);
  const [selectionMenu, setSelectionMenu] = useState(null);
  const [inlineEditing, setInlineEditing] = useState(null);
  const [showDiff, setShowDiff] = useState({});

  const t = THEMES[theme];

  const scrollContainerRef = useRef(null);
  const pageRefs = useRef({});
  const chatScrollRef = useRef(null);
  const historyIdCounter = useRef(0);
  const abortStreamRef = useRef(false);

  // ---- Scroll spy ----
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setCurrentPage(parseInt(visible[0].target.dataset.pageId, 10));
      },
      { root: container, threshold: [0.3, 0.6] }
    );
    Object.values(pageRefs.current).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [pages]);

  const jumpToPage = useCallback((id) => {
    const el = pageRefs.current[id];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const currentIdx = pages.findIndex((p) => p.id === currentPage);
  const goPrev = () => currentIdx > 0 && jumpToPage(pages[currentIdx - 1].id);
  const goNext = () => currentIdx < pages.length - 1 && jumpToPage(pages[currentIdx + 1].id);

  useEffect(() => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [messages, isStreaming, streamingText]);

  useEffect(() => {
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (!text || text.length < 3) { setSelectionMenu(null); return; }
      const range = sel.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const blockEl = container.nodeType === 1
        ? container.closest('[data-block-id]')
        : container.parentElement?.closest('[data-block-id]');
      if (!blockEl) { setSelectionMenu(null); return; }
      const rect = range.getBoundingClientRect();
      setSelectionMenu({
        x: rect.left + rect.width / 2, y: rect.top - 8, text,
        pageId: parseInt(blockEl.dataset.pageId, 10),
        blockIdx: parseInt(blockEl.dataset.blockIdx, 10),
      });
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, []);

  const flashSections = (pageIds) => {
    setHighlightedSections(new Set(pageIds));
    setTimeout(() => setHighlightedSections(new Set()), 2500);
  };

  const recordEdit = (pageId, oldBody, newBody, action) => {
    const oldPage = pages.find((p) => p.id === pageId);
    const id = ++historyIdCounter.current;
    const entry = { id, ts: Date.now(), pageId, pageTitle: oldPage?.title || 'Untitled', oldBody, newBody, action, undone: false };
    setHistory((h) => [...h, entry]);
    return id;
  };

  const toggleEdit = (historyId) => {
    const entry = history.find((h) => h.id === historyId);
    if (!entry) return;
    const targetBody = entry.undone ? entry.newBody : entry.oldBody;
    setPages((prev) => prev.map((p) => (p.id === entry.pageId ? { ...p, body: targetBody } : p)));
    setHistory((h) => h.map((x) => (x.id === historyId ? { ...x, undone: !x.undone } : x)));
    flashSections([entry.pageId]);
  };

  const clearConversation = () => {
    setMessages([{
      role: 'assistant',
      text: '대화를 초기화했습니다. 새로운 작업을 시작해 보세요.',
      ui: 'static',
    }]);
    setShowDiff({});
  };

  // ---- Inline selection edit ----
  const applyInlineEdit = async (action) => {
    if (!selectionMenu) return;
    const { pageId, blockIdx, text: selectedText } = selectionMenu;
    const page = pages.find((p) => p.id === pageId);
    if (!page) return;
    const block = page.body[blockIdx];
    if (!block || (block.type !== 'p' && block.type !== 'lead' && block.type !== 'h2')) return;

    setSelectionMenu(null);
    window.getSelection()?.removeAllRanges();
    setInlineEditing({ pageId, blockIdx, original: block.text, action: action.id, status: 'loading' });

    try {
      const userPrompt = `원본 문장:\n${block.text}\n\n선택된 부분:\n${selectedText}\n\n액션: ${action.id}`;
      const raw = await callClaudeOnce(SYSTEM_INLINE_EDITOR, userPrompt);
      const parsed = extractJson(raw);
      const suggestion = parsed.newText || block.text;
      setInlineEditing({ pageId, blockIdx, original: block.text, suggestion, selectedText, action: action.id, status: 'ready' });
    } catch (err) {
      setInlineEditing({ pageId, blockIdx, original: block.text, action: action.id, status: 'error', error: err.message });
    }
  };

  const acceptInlineEdit = (finalText) => {
    if (!inlineEditing) return;
    const { pageId, blockIdx, selectedText, action } = inlineEditing;
    const text = finalText ?? inlineEditing.suggestion;
    const oldPage = pages.find((p) => p.id === pageId);
    const oldBody = oldPage.body;
    const newBody = oldBody.map((b, i) => (i === blockIdx ? { ...b, text } : b));
    setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, body: newBody } : p)));

    const actionLabel = INLINE_ACTIONS.find((a) => a.id === action)?.label || action;
    const historyId = recordEdit(pageId, oldBody, newBody, `인라인: ${actionLabel}`);
    setMessages((m) => [
      ...m,
      { role: 'user', text: `"${selectedText}" — ${actionLabel}`, ui: 'inline' },
      { role: 'assistant', text: `선택한 부분을 ${actionLabel} 처리했습니다.`, edits: [{ historyId, pageId, oldBody, newBody, pageTitle: oldPage.title }], ui: 'inline' },
    ]);
    setInlineEditing(null);
    flashSections([pageId]);
  };

  const rejectInlineEdit = () => setInlineEditing(null);

  // ---- Chat send (streaming + multi-turn) ----
  const sendMessage = async (text) => {
    if (!text.trim() || isStreaming) return;

    // Build conversation for API: only first turn gets full doc context
    const isFirstApiTurn = !messages.some((m) => m.role === 'user');

    let userContent;
    if (isFirstApiTurn) {
      const docContext = pages.filter((p) => !p.isCover).map((p) =>
        `### ${p.title}\n${JSON.stringify(p.body, null, 2)}`
      ).join('\n\n');
      userContent = `현재 문서 (이 정보를 기억해 두고, 이후 대화에서 참조한다):\n\n${docContext}\n\n사용자 요청:\n${text}`;
    } else {
      // Subsequent turns: just the user's request. The model already has doc context from turn 1 + previous edits in the conversation.
      // We also append a brief "current state" hint so the model knows about applied edits.
      userContent = text;
    }

    const newUserMsg = { role: 'user', text, content: userContent };
    setMessages((m) => [...m, newUserMsg]);
    setChatInput('');
    setIsStreaming(true);
    setStreamingText('');
    abortStreamRef.current = false;

    // Build conversation for API
    const apiMessages = [];
    for (const m of [...messages, newUserMsg]) {
      if (m.ui === 'static') continue;
      // For API, use 'content' if present (full prompt), else 'text'
      const content = m.content || m.text;
      apiMessages.push({ role: m.role, content });
    }

    let fullText = '';
    try {
      for await (const chunk of streamClaude(SYSTEM_DOC_EDITOR, apiMessages)) {
        if (abortStreamRef.current) break;
        fullText += chunk;
        setStreamingText(fullText);
      }
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: `오류가 발생했습니다: ${err.message}`, isError: true, ui: 'inline' }]);
      setIsStreaming(false);
      setStreamingText('');
      return;
    }

    // Parse and apply edits
    let parsed = null;
    let assistantText = fullText;
    try {
      parsed = extractJson(fullText);
      assistantText = parsed.summary || '응답을 받았습니다.';
    } catch {
      // Not JSON — treat as plain text response
    }

    const appliedEdits = [];
    if (parsed?.edits?.length) {
      const updatedPages = [...pages];
      for (const edit of parsed.edits) {
        const target = updatedPages.find((p) => p.title === edit.pageTitle);
        if (!target || !edit.newBody) continue;
        const oldBody = target.body;
        const newBody = edit.newBody;
        target.body = newBody;
        const historyId = recordEdit(target.id, oldBody, newBody, edit.rationale || '편집');
        appliedEdits.push({ historyId, pageId: target.id, oldBody, newBody, pageTitle: target.title });
      }
      setPages(updatedPages);
      flashSections(appliedEdits.map((e) => e.pageId));
    }

    // Store the raw response in 'content' so subsequent API calls have it
    setMessages((m) => [
      ...m,
      {
        role: 'assistant',
        text: assistantText,
        content: fullText, // raw JSON for API context
        edits: appliedEdits,
      },
    ]);
    setIsStreaming(false);
    setStreamingText('');
  };

  return (
    <div className={`h-screen flex flex-col ${t.bg} ${t.text} overflow-hidden relative transition-colors duration-300`}>
      <div className="absolute inset-0 pointer-events-none" style={{ background: t.glow }} />

      {/* Top nav */}
      <header className={`relative z-20 h-12 px-4 flex items-center gap-3 border-b ${t.border} ${theme === 'dark' ? 'bg-zinc-950/80' : 'bg-white/80'} backdrop-blur-xl`}>
        <button onClick={() => setSidebarOpen((s) => !s)} className={`w-7 h-7 rounded-md ${t.hover} flex items-center justify-center ${t.textMuted}`}>
          <PanelLeft size={14} />
        </button>
        <div className={`w-px h-5 ${t.border} border-l`} />
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded bg-gradient-to-br from-indigo-400 via-purple-400 to-pink-400 flex items-center justify-center shadow-sm">
            <span className="text-xs font-bold text-white">H</span>
          </div>
          <span className={`text-sm font-medium ${t.textStrong}`}>hwpx</span>
          <span className={`${t.textFaint} text-xs`}>/</span>
          <span className={`text-sm ${t.textMuted}`}>연구개발사업_추진계획서_v2</span>
          <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${theme === 'dark' ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30' : 'bg-indigo-50 text-indigo-700 border border-indigo-200'}`}>
            Sonnet 4 · streaming
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button className={`flex items-center gap-2 px-2.5 h-7 rounded-md ${t.bgSubtle} ${t.hover} border ${t.border} text-xs ${t.textMuted}`}>
            <Search size={12} /> <span>Search</span>
            <kbd className={`ml-2 flex items-center gap-0.5 ${t.textFaint}`} style={{ fontSize: '10px' }}><Command size={9} /> K</kbd>
          </button>
          <button onClick={() => setHistoryOpen((h) => !h)} className={`relative flex items-center gap-1.5 px-2.5 h-7 rounded-md ${historyOpen ? t.activeBg : t.bgSubtle} ${t.hover} border ${t.border} text-xs ${t.textMuted}`}>
            <History size={12} /> <span>History</span>
            {history.length > 0 && (
              <span className={`ml-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums ${theme === 'dark' ? 'bg-zinc-800 text-zinc-300' : 'bg-stone-200 text-stone-700'}`}>
                {history.filter((h) => !h.undone).length}
              </span>
            )}
          </button>
          <button onClick={() => setTheme((th) => (th === 'dark' ? 'light' : 'dark'))} className={`w-7 h-7 rounded-md ${t.hover} flex items-center justify-center ${t.textMuted}`}>
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button onClick={() => setChatOpen((c) => !c)} className={`flex items-center gap-1.5 px-2.5 h-7 rounded-md transition-all ${
            chatOpen ? 'bg-gradient-to-r from-indigo-500 to-pink-500 text-white' : `bg-gradient-to-r from-indigo-500/15 to-pink-500/15 border border-indigo-500/30 ${theme === 'dark' ? 'text-indigo-300' : 'text-indigo-700'}`
          } text-xs font-medium`}>
            <Sparkles size={12} /> AI
          </button>
          <button className={`flex items-center gap-1.5 px-2.5 h-7 rounded-md ${t.btnPrimary} text-xs font-medium`}>
            <Download size={12} /> Export
          </button>
          <button className={`w-7 h-7 rounded-md ${t.hover} flex items-center justify-center ${t.textMuted}`}>
            <MoreHorizontal size={14} />
          </button>
          <div className={`w-px h-5 ${t.border} border-l mx-1`} />
          <UserMenu open={userMenuOpen} setOpen={setUserMenuOpen} t={t} theme={theme} />
        </div>
      </header>

      <div className="relative z-10 flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className={`${sidebarOpen ? 'w-72' : 'w-0'} transition-all duration-300 ease-in-out border-r ${t.border} ${t.bg} overflow-hidden flex-shrink-0`}>
          <div className="w-72 h-full overflow-y-auto px-3 py-4">
            <div className="flex items-center justify-between mb-3 px-2">
              <span className={`text-xs font-semibold uppercase tracking-widest ${t.textSubtle}`}>Pages</span>
              <span className={`text-xs ${t.textFaint} tabular-nums`}>{pages.length}</span>
            </div>
            <nav className="space-y-2">
              {pages.map((p) => {
                const active = p.id === currentPage;
                const flashing = highlightedSections.has(p.id);
                return (
                  <button key={p.id} onClick={() => jumpToPage(p.id)} className={`group w-full flex gap-3 p-2 rounded-lg text-left transition-all ${active ? t.activeBg : t.hoverSubtle} ${flashing ? 'ring-2 ring-indigo-500/50' : ''}`}>
                    <div className={`w-14 flex-shrink-0 rounded border overflow-hidden relative ${active ? (theme === 'dark' ? 'border-indigo-500/50' : 'border-indigo-500') : t.paperBorder} ${t.paperBg}`} style={{ aspectRatio: '1 / 1.414' }}>
                      <MiniPreview page={p} theme={theme} />
                    </div>
                    <div className="flex-1 min-w-0 py-0.5">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className={`text-xs font-mono tabular-nums ${active ? t.accent : t.textFaint}`}>{p.section}</span>
                        {active && <div className={`w-1 h-1 rounded-full ${t.accentDot}`} />}
                      </div>
                      <div className={`text-sm font-medium truncate ${active ? t.textStrong : t.textMuted}`}>{p.title}</div>
                      <div className={`text-xs ${t.textFaint} mt-0.5`}>{p.isCover ? 'Cover' : `${p.body?.length || 0} blocks`}</div>
                    </div>
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        {/* Canvas */}
        <main className={`flex-1 overflow-y-auto ${t.pageBg} relative`} ref={scrollContainerRef}>
          <div style={{ fontSize: `${zoom}%` }}>
            {pages.map((p, idx) => (
              <section key={p.id} ref={(el) => (pageRefs.current[p.id] = el)} data-page-id={p.id}
                className={`relative transition-all duration-500 ${highlightedSections.has(p.id) ? 'ring-2 ring-indigo-500/50 ring-inset' : ''}`}>
                {p.isCover ? <CoverPage theme={theme} t={t} /> : (
                  <div className="max-w-3xl mx-auto px-12 py-20">
                    <div className="flex items-center gap-3 mb-10">
                      <span className={`text-xs font-mono tabular-nums ${t.textFaint} tracking-wider`}>SECTION {p.section}</span>
                      <div className={`h-px flex-1 bg-gradient-to-r ${theme === 'dark' ? 'from-zinc-800' : 'from-stone-300'} to-transparent`} />
                      <span className={`text-xs font-mono ${t.textFaint} tabular-nums`}>
                        {String(idx + 1).padStart(2, '0')} / {String(pages.length).padStart(2, '0')}
                      </span>
                    </div>
                    <article className="space-y-5">
                      {p.body?.map((block, bidx) => {
                        const isInlineTarget = inlineEditing && inlineEditing.pageId === p.id && inlineEditing.blockIdx === bidx;
                        return (
                          <div key={bidx} data-block-id={`${p.id}-${bidx}`} data-page-id={p.id} data-block-idx={bidx}>
                            {isInlineTarget && inlineEditing.status === 'loading' ? (
                              <InlineLoadingBlock block={block} t={t} theme={theme} />
                            ) : isInlineTarget && inlineEditing.status === 'error' ? (
                              <InlineErrorBlock error={inlineEditing.error} onClose={rejectInlineEdit} t={t} theme={theme} />
                            ) : isInlineTarget && inlineEditing.status === 'ready' ? (
                              <InlineCherryPickDiff inlineEditing={inlineEditing} onAccept={acceptInlineEdit} onReject={rejectInlineEdit} t={t} theme={theme} />
                            ) : (
                              <Block block={block} t={t} theme={theme} />
                            )}
                          </div>
                        );
                      })}
                    </article>
                  </div>
                )}
                {idx < pages.length - 1 && (
                  <div className="flex items-center justify-center py-8">
                    <div className={`flex items-center gap-3 ${t.textFaint}`}>
                      <div className={`h-px w-16 ${theme === 'dark' ? 'bg-zinc-800' : 'bg-stone-300'}`} />
                      <span className="text-xs font-mono tabular-nums">— {String(idx + 1).padStart(2, '0')} —</span>
                      <div className={`h-px w-16 ${theme === 'dark' ? 'bg-zinc-800' : 'bg-stone-300'}`} />
                    </div>
                  </div>
                )}
              </section>
            ))}
            <div className="h-32" />
          </div>

          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30">
            <div className={`flex items-center gap-1 px-2 py-1.5 rounded-full ${t.bgDock} border ${t.border} backdrop-blur-xl`}
              style={{
                boxShadow: theme === 'dark'
                  ? '0 10px 40px -10px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)'
                  : '0 10px 40px -10px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.04)',
              }}>
              <DockBtn t={t} onClick={goPrev} disabled={currentIdx === 0}><ChevronLeft size={15} /></DockBtn>
              <div className={`px-3 py-1 text-xs font-medium ${t.textStrong} tabular-nums min-w-[60px] text-center`}>
                {currentIdx + 1} <span className={t.textFaint}>/</span> {pages.length}
              </div>
              <DockBtn t={t} onClick={goNext} disabled={currentIdx === pages.length - 1}><ChevronRight size={15} /></DockBtn>
              <div className={`w-px h-5 ${theme === 'dark' ? 'bg-zinc-700' : 'bg-stone-300'} mx-1`} />
              <DockBtn t={t} onClick={() => setZoom((z) => Math.max(50, z - 10))} disabled={zoom <= 50}><ZoomOut size={15} /></DockBtn>
              <div className={`px-2 text-xs font-medium ${t.textMuted} tabular-nums min-w-[42px] text-center`}>{zoom}%</div>
              <DockBtn t={t} onClick={() => setZoom((z) => Math.min(200, z + 10))} disabled={zoom >= 200}><ZoomIn size={15} /></DockBtn>
              <div className={`w-px h-5 ${theme === 'dark' ? 'bg-zinc-700' : 'bg-stone-300'} mx-1`} />
              <DockBtn t={t}><Printer size={15} /></DockBtn>
              <DockBtn t={t}><Maximize2 size={15} /></DockBtn>
              <div className={`w-px h-5 ${theme === 'dark' ? 'bg-zinc-700' : 'bg-stone-300'} mx-1`} />
              <button onClick={() => setChatOpen(true)} className="w-8 h-8 rounded-full flex items-center justify-center bg-gradient-to-br from-indigo-500 to-pink-500 text-white hover:scale-110 transition-transform">
                <Wand2 size={14} />
              </button>
            </div>
          </div>

          {selectionMenu && <InlineSelectionMenu menu={selectionMenu} onAction={applyInlineEdit} theme={theme} t={t} />}
        </main>

        {/* History panel */}
        <aside className={`${historyOpen ? 'w-80' : 'w-0'} transition-all duration-300 ease-in-out border-l ${t.border} ${t.bgPanel} backdrop-blur-xl overflow-hidden flex-shrink-0`}>
          <HistoryPanel history={history} onClose={() => setHistoryOpen(false)} onToggle={toggleEdit} onJumpToPage={jumpToPage} t={t} theme={theme} />
        </aside>

        {/* Chat panel */}
        <aside className={`${chatOpen ? 'w-[420px]' : 'w-0'} transition-all duration-300 ease-in-out border-l ${t.border} ${t.bgPanel} backdrop-blur-xl overflow-hidden flex-shrink-0`}>
          <div className="w-[420px] h-full flex flex-col">
            <div className={`h-12 px-4 flex items-center gap-2 border-b ${t.border}`}>
              <div className="w-6 h-6 rounded bg-gradient-to-br from-indigo-400 via-purple-400 to-pink-400 flex items-center justify-center">
                <Sparkles size={12} className="text-white" />
              </div>
              <div className="flex-1">
                <div className={`text-sm font-semibold ${t.textStrong} flex items-center gap-1.5`}>
                  Document AI
                  <MessageSquare size={10} className={t.textFaint} />
                  <span className={`text-xs font-normal ${t.textFaint} tabular-nums`}>{messages.filter((m) => m.role === 'user').length} turns</span>
                </div>
                <div className={`text-xs ${t.textFaint}`}>멀티턴 · 스트리밍 · Sonnet 4</div>
              </div>
              <button onClick={clearConversation} title="대화 초기화" className={`w-7 h-7 rounded-md ${t.hover} flex items-center justify-center ${t.textMuted}`}>
                <Trash2 size={13} />
              </button>
              <button
                onClick={() => setChatOpen(false)}
                title="패널 닫기"
                className={`flex items-center gap-1 px-2 h-7 rounded-md border ${t.border} ${t.bgSubtle} ${t.hover} ${t.textMuted} text-xs font-medium`}
              >
                <X size={13} />
                <span>닫기</span>
              </button>
            </div>

            <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {messages.map((msg, i) => (
                <ChatMessage key={i} msg={msg} msgIdx={i} history={history}
                  showDiff={showDiff[i]}
                  onToggleDiff={(ei) => setShowDiff((s) => ({ ...s, [i]: { ...(s[i] || {}), [ei]: !((s[i] || {})[ei]) } }))}
                  onToggleEdit={toggleEdit} t={t} theme={theme} />
              ))}
              {isStreaming && (
                <StreamingMessage text={streamingText} t={t} theme={theme} />
              )}
            </div>

            {messages.length <= 1 && !isStreaming && (
              <div className="px-4 pb-3 space-y-1.5">
                <div className={`text-xs ${t.textFaint} mb-2 px-1`}>제안</div>
                {SUGGESTIONS.map((s, i) => (
                  <button key={i} onClick={() => sendMessage(s)} className={`w-full text-left text-xs px-3 py-2 rounded-lg border ${t.border} ${t.hoverSubtle} ${t.textMuted} transition-colors`}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            <div className={`p-3 border-t ${t.border}`}>
              <div className={`relative rounded-xl border ${t.inputBorder} ${t.inputBg} focus-within:ring-2 focus-within:ring-indigo-500/40 transition-all`}>
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage(chatInput);
                    }
                  }}
                  placeholder={messages.length > 1 ? "이어서 대화하기..." : "문서를 어떻게 바꿀까요?"}
                  rows={2}
                  disabled={isStreaming}
                  className={`w-full px-3 py-2.5 pr-12 bg-transparent text-sm ${t.textStrong} resize-none focus:outline-none disabled:opacity-50`}
                  style={{ minHeight: '60px' }}
                />
                <button
                  onClick={() => sendMessage(chatInput)}
                  disabled={!chatInput.trim() || isStreaming}
                  className="absolute bottom-2 right-2 w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-pink-500 text-white flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed hover:scale-105 transition-transform"
                >
                  <ArrowUp size={14} />
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <footer className={`relative z-10 h-7 px-4 flex items-center gap-3 border-t ${t.border} ${theme === 'dark' ? 'bg-zinc-950/80' : 'bg-white/80'} backdrop-blur-xl text-xs ${t.textSubtle} tabular-nums`}>
        <FileText size={11} />
        <span>{pages.find((p) => p.id === currentPage)?.title}</span>
        <div className={`w-px h-3 ${theme === 'dark' ? 'bg-zinc-800' : 'bg-stone-200'}`} />
        <span>OWPML 1.2</span>
        <div className={`w-px h-3 ${theme === 'dark' ? 'bg-zinc-800' : 'bg-stone-200'}`} />
        <span>{history.filter((h) => !h.undone).length} edits</span>
        <div className={`w-px h-3 ${theme === 'dark' ? 'bg-zinc-800' : 'bg-stone-200'}`} />
        <span>{messages.filter((m) => m.role === 'user').length} turns</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="capitalize">{theme}</span>
          <div className={`w-px h-3 ${theme === 'dark' ? 'bg-zinc-800' : 'bg-stone-200'}`} />
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${isStreaming ? 'bg-indigo-400' : 'bg-emerald-400'} ${isStreaming ? 'animate-pulse' : ''}`} style={{ boxShadow: isStreaming ? '0 0 6px rgba(129,140,248,0.6)' : '0 0 6px rgba(52,211,153,0.6)' }} />
            <span>{isStreaming ? 'Streaming' : 'Sonnet 4'}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ==========================================
//  Streaming message bubble
// ==========================================
function StreamingMessage({ text, t, theme }) {
  // Try to extract summary from partial JSON
  let displayText = '';
  let isJson = false;
  const summaryMatch = text.match(/"summary"\s*:\s*"([^"]*)/);
  if (summaryMatch) {
    displayText = summaryMatch[1];
    isJson = true;
  } else if (text.trim().startsWith('{')) {
    displayText = '응답 작성 중...';
    isJson = true;
  } else {
    displayText = text;
  }

  return (
    <div className="flex gap-2.5">
      <div className="w-6 h-6 rounded flex-shrink-0 bg-gradient-to-br from-indigo-400 via-purple-400 to-pink-400 flex items-center justify-center mt-0.5">
        <Sparkles size={10} className="text-white" />
      </div>
      <div className={`flex-1 min-w-0 text-sm ${t.text} leading-relaxed`}>
        <div className="whitespace-pre-wrap">
          {displayText}
          <span className={`inline-block w-1.5 h-3.5 ml-0.5 ${t.accentDot} animate-pulse align-middle`} />
        </div>
        {isJson && (
          <div className={`mt-2 text-xs ${t.textFaint} flex items-center gap-1`}>
            <div className="flex gap-0.5">
              <div className={`w-1 h-1 rounded-full ${theme === 'dark' ? 'bg-zinc-600' : 'bg-stone-400'} animate-pulse`} />
              <div className={`w-1 h-1 rounded-full ${theme === 'dark' ? 'bg-zinc-600' : 'bg-stone-400'} animate-pulse`} style={{ animationDelay: '150ms' }} />
              <div className={`w-1 h-1 rounded-full ${theme === 'dark' ? 'bg-zinc-600' : 'bg-stone-400'} animate-pulse`} style={{ animationDelay: '300ms' }} />
            </div>
            편집 작성 중 · {text.length} chars
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================
//  History panel
// ==========================================
function HistoryPanel({ history, onClose, onToggle, onJumpToPage, t, theme }) {
  const sorted = [...history].reverse();
  const activeCount = history.filter((h) => !h.undone).length;
  const formatTime = (ts) => {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  };
  return (
    <div className="w-80 h-full flex flex-col">
      <div className={`h-12 px-4 flex items-center gap-2 border-b ${t.border}`}>
        <div className={`w-6 h-6 rounded ${theme === 'dark' ? 'bg-zinc-800' : 'bg-stone-200'} flex items-center justify-center`}>
          <GitBranch size={12} className={t.textMuted} />
        </div>
        <div className="flex-1">
          <div className={`text-sm font-semibold ${t.textStrong}`}>변경 이력</div>
          <div className={`text-xs ${t.textFaint}`}>{activeCount}개 활성 · 총 {history.length}개</div>
        </div>
        <button onClick={onClose} className={`w-7 h-7 rounded-md ${t.hover} flex items-center justify-center ${t.textMuted}`}>
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {history.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center px-8 text-center">
            <div className={`w-12 h-12 rounded-full ${theme === 'dark' ? 'bg-zinc-900' : 'bg-stone-100'} flex items-center justify-center mb-3`}>
              <Clock size={20} className={t.textFaint} />
            </div>
            <div className={`text-sm ${t.textMuted} mb-1`}>아직 편집 이력이 없습니다</div>
          </div>
        ) : (
          <div className="px-4 py-4 relative">
            <div className={`absolute left-[27px] top-6 bottom-6 w-px ${theme === 'dark' ? 'bg-zinc-800' : 'bg-stone-200'}`} />
            <div className="space-y-3">
              {sorted.map((entry) => (
                <div key={entry.id} className="relative pl-8">
                  <div className={`absolute left-0 top-1.5 w-4 h-4 rounded-full flex items-center justify-center ${
                    entry.undone ? `${theme === 'dark' ? 'bg-zinc-900 border-zinc-700' : 'bg-stone-100 border-stone-300'} border-2` : 'bg-gradient-to-br from-indigo-400 to-pink-400'
                  }`}>
                    {!entry.undone && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                  <div className={`rounded-lg border ${t.border} ${t.bgMuted} overflow-hidden ${entry.undone ? 'opacity-60' : ''}`}>
                    <div className={`px-3 py-2 border-b ${t.border} flex items-start justify-between gap-2`}>
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs font-medium ${t.textStrong} mb-0.5 line-clamp-2`}>{entry.action}</div>
                        <button onClick={() => onJumpToPage(entry.pageId)} className={`flex items-center gap-1 text-xs ${t.textMuted}`}>
                          <FileText size={10} /> {entry.pageTitle}
                        </button>
                      </div>
                      <span className={`text-xs ${t.textFaint} tabular-nums whitespace-nowrap`}>{formatTime(entry.ts)}</span>
                    </div>
                    <div className={`px-3 py-2 flex items-center justify-between ${theme === 'dark' ? 'bg-zinc-950/50' : 'bg-white'}`}>
                      {entry.undone ? (
                        <div className={`flex items-center gap-1 text-xs ${t.textFaint}`}><Undo2 size={10} /> 되돌려짐</div>
                      ) : (
                        <div className={`flex items-center gap-1 text-xs ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600'}`}><Check size={10} /> 적용됨</div>
                      )}
                      <button onClick={() => onToggle(entry.id)}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
                          entry.undone ? `${theme === 'dark' ? 'text-indigo-400 hover:bg-indigo-500/10' : 'text-indigo-600 hover:bg-indigo-50'}` : `${theme === 'dark' ? 'text-rose-400 hover:bg-rose-500/10' : 'text-rose-600 hover:bg-rose-50'}`
                        }`}>
                        {entry.undone ? (<><Redo2 size={10} /> 다시 적용</>) : (<><Undo2 size={10} /> 되돌리기</>)}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================
//  Inline menu / blocks
// ==========================================
function InlineSelectionMenu({ menu, onAction, theme, t }) {
  const menuRef = useRef(null);
  const [adjustedX, setAdjustedX] = useState(menu.x);
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const padding = 16;
      let x = menu.x;
      if (x + rect.width / 2 > window.innerWidth - padding) x = window.innerWidth - rect.width / 2 - padding;
      if (x - rect.width / 2 < padding) x = rect.width / 2 + padding;
      setAdjustedX(x);
    }
  }, [menu.x]);
  return (
    <div ref={menuRef} className="fixed z-40 -translate-x-1/2 -translate-y-full" style={{ left: adjustedX, top: menu.y }}>
      <div className={`flex items-center gap-0.5 px-1.5 py-1.5 rounded-xl ${t.bgDock} border ${t.border} backdrop-blur-xl`}
        style={{ boxShadow: theme === 'dark' ? '0 8px 32px -8px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)' : '0 8px 32px -8px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.04)' }}>
        <div className="flex items-center gap-1.5 px-2 py-1">
          <Sparkles size={11} style={{ color: theme === 'dark' ? '#a5b4fc' : '#6366f1' }} />
          <span className={`text-xs font-medium ${t.textMuted}`}>AI</span>
        </div>
        <div className={`w-px h-4 ${theme === 'dark' ? 'bg-zinc-700' : 'bg-stone-300'}`} />
        {INLINE_ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <button key={action.id} onMouseDown={(e) => { e.preventDefault(); onAction(action); }}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs ${t.textMuted} ${t.hover}`}>
              <Icon size={11} /> {action.label}
            </button>
          );
        })}
      </div>
      <div className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 rotate-45"
        style={{ backgroundColor: theme === 'dark' ? 'rgb(24 24 27 / 0.95)' : 'rgb(255 255 255 / 0.95)' }} />
    </div>
  );
}

function InlineLoadingBlock({ block, t, theme }) {
  return (
    <div className={`relative rounded-lg border ${theme === 'dark' ? 'border-indigo-500/30 bg-indigo-500/5' : 'border-indigo-300 bg-indigo-50/50'} p-3`}>
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={12} className={t.accent} />
        <span className={`text-xs font-medium ${t.accent}`}>Claude가 작성 중...</span>
        <div className="flex gap-1 ml-1">
          <div className={`w-1 h-1 rounded-full ${t.accentDot} animate-pulse`} />
          <div className={`w-1 h-1 rounded-full ${t.accentDot} animate-pulse`} style={{ animationDelay: '150ms' }} />
          <div className={`w-1 h-1 rounded-full ${t.accentDot} animate-pulse`} style={{ animationDelay: '300ms' }} />
        </div>
      </div>
      <div className="opacity-50"><Block block={block} t={t} theme={theme} /></div>
    </div>
  );
}

function InlineErrorBlock({ error, onClose, t, theme }) {
  return (
    <div className={`rounded-lg border ${theme === 'dark' ? 'border-rose-500/30 bg-rose-500/5' : 'border-rose-300 bg-rose-50'} p-3 flex items-start gap-2`}>
      <AlertCircle size={14} className={theme === 'dark' ? 'text-rose-400 mt-0.5' : 'text-rose-600 mt-0.5'} />
      <div className="flex-1">
        <div className={`text-xs font-medium ${theme === 'dark' ? 'text-rose-300' : 'text-rose-700'} mb-1`}>편집 실패</div>
        <div className={`text-xs ${t.textMuted}`}>{error}</div>
      </div>
      <button onClick={onClose} className={`w-6 h-6 rounded ${t.hover} flex items-center justify-center ${t.textMuted}`}>
        <X size={12} />
      </button>
    </div>
  );
}

function InlineCherryPickDiff({ inlineEditing, onAccept, onReject, t, theme }) {
  const { original, suggestion } = inlineEditing;
  const ops = useMemo(() => diffTokens(original, suggestion), [original, suggestion]);
  const hunks = useMemo(() => groupHunks(ops), [ops]);
  const changeHunks = hunks.filter((h) => h.kind === 'change');
  const [acceptedIds, setAcceptedIds] = useState(() => new Set(changeHunks.map((h) => h.id)));
  const toggleHunk = (id) => setAcceptedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const acceptAll = () => setAcceptedIds(new Set(changeHunks.map((h) => h.id)));
  const rejectAll = () => setAcceptedIds(new Set());
  const finalText = useMemo(() => reconstructText(hunks, acceptedIds), [hunks, acceptedIds]);

  return (
    <div className={`rounded-lg border ${theme === 'dark' ? 'border-indigo-500/40' : 'border-indigo-400'} overflow-hidden`}>
      <div className={`px-3 py-2 ${theme === 'dark' ? 'bg-zinc-900' : 'bg-stone-50'} border-b ${t.border} flex items-center justify-between`}>
        <div className="flex items-center gap-1.5">
          <Sparkles size={11} className={t.accent} />
          <span className={`text-xs uppercase tracking-wider font-semibold ${t.accent}`}>AI 제안</span>
          <span className={`text-xs ${t.textFaint} ml-1`}>· 클릭으로 부분 수락 ({acceptedIds.size}/{changeHunks.length})</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={rejectAll} className={`px-2 py-0.5 rounded text-xs ${t.textMuted} ${t.hover}`}>모두 거부</button>
          <button onClick={acceptAll} className={`px-2 py-0.5 rounded text-xs ${t.textMuted} ${t.hover}`}>모두 수락</button>
        </div>
      </div>
      <div className={`px-3 py-3 ${t.bgMuted}`}>
        <p className={`text-base leading-relaxed ${t.text}`}>
          {hunks.map((h, i) => {
            if (h.kind === 'eq') return <span key={i}>{h.token}</span>;
            const accepted = acceptedIds.has(h.id);
            return (
              <span key={i} className="inline-flex items-baseline gap-px">
                {h.del && <button onClick={() => toggleHunk(h.id)} className={`px-0.5 rounded transition-all cursor-pointer ${accepted ? `${t.diffDelInline} opacity-50` : t.diffDelPick}`}>{h.del}</button>}
                {h.add && <button onClick={() => toggleHunk(h.id)} className={`px-0.5 rounded transition-all cursor-pointer ${accepted ? t.diffAddPick : `${t.diffAddInline} opacity-40`}`}>{h.add}</button>}
              </span>
            );
          })}
        </p>
      </div>
      <div className={`px-3 py-2.5 border-t ${t.border} ${theme === 'dark' ? 'bg-zinc-950' : 'bg-white'}`}>
        <div className={`text-[10px] uppercase tracking-wider ${t.textFaint} mb-1`}>최종 결과</div>
        <p className={`text-sm leading-relaxed ${t.text}`}>{finalText}</p>
      </div>
      <div className={`flex items-center justify-end gap-2 px-3 py-2 ${t.bgMuted} border-t ${t.border}`}>
        <button onClick={onReject} className={`px-3 py-1 rounded-md text-xs ${t.textMuted} ${t.hover}`}>취소</button>
        <button onClick={() => onAccept(finalText)} className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-gradient-to-r from-indigo-500 to-pink-500 text-white hover:opacity-90">
          <Check size={11} /> 적용
        </button>
      </div>
    </div>
  );
}

// ==========================================
//  Chat message
// ==========================================
function ChatMessage({ msg, msgIdx, history, showDiff, onToggleDiff, onToggleEdit, t, theme }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className={`max-w-[85%] px-3 py-2 rounded-2xl rounded-br-sm text-sm whitespace-pre-wrap ${theme === 'dark' ? 'bg-zinc-800 text-zinc-100' : 'bg-stone-200 text-stone-900'}`}>
          {msg.text}
        </div>
      </div>
    );
  }
  const edits = msg.edits || [];
  const showDiffMap = showDiff || {};
  return (
    <div className="flex gap-2.5">
      <div className={`w-6 h-6 rounded flex-shrink-0 flex items-center justify-center mt-0.5 ${msg.isError ? (theme === 'dark' ? 'bg-rose-500/20' : 'bg-rose-100') : 'bg-gradient-to-br from-indigo-400 via-purple-400 to-pink-400'}`}>
        {msg.isError ? <AlertCircle size={10} className={theme === 'dark' ? 'text-rose-400' : 'text-rose-600'} /> : <Sparkles size={10} className="text-white" />}
      </div>
      <div className={`flex-1 min-w-0 text-sm leading-relaxed ${msg.isError ? (theme === 'dark' ? 'text-rose-300' : 'text-rose-700') : t.text}`}>
        <div className="whitespace-pre-wrap">
          {msg.text.split('**').map((part, i) => i % 2 === 1 ? <strong key={i} className={t.textStrong}>{part}</strong> : <span key={i}>{part}</span>)}
        </div>
        {edits.length > 1 && (
          <div className={`mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${theme === 'dark' ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30' : 'bg-purple-50 text-purple-700 border border-purple-200'}`}>
            <Layers size={10} /> 멀티 페이지 · {edits.length}개
          </div>
        )}
        {edits.map((edit, ei) => {
          const historyEntry = history.find((h) => h.id === edit.historyId);
          const isUndone = historyEntry?.undone ?? false;
          const showThis = showDiffMap[ei];
          return (
            <div key={ei} className={`mt-3 rounded-lg border ${t.border} ${t.bgMuted} overflow-hidden ${isUndone ? 'opacity-60' : ''}`}>
              <div className={`px-3 py-2 flex items-center justify-between border-b ${t.border}`}>
                <div className="flex items-center gap-2">
                  {isUndone ? (
                    <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${theme === 'dark' ? 'bg-zinc-800 text-zinc-400' : 'bg-stone-200 text-stone-600'}`}>
                      <Undo2 size={10} /><span className="text-xs font-medium">되돌려짐</span>
                    </div>
                  ) : (
                    <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${theme === 'dark' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-emerald-100 text-emerald-700'}`}>
                      <Check size={10} /><span className="text-xs font-medium">적용됨</span>
                    </div>
                  )}
                  <span className={`text-xs ${t.textMuted}`}>{edit.pageTitle}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => onToggleDiff(ei)} className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs ${t.textMuted} ${t.hover}`}>
                    {showThis ? <EyeOff size={11} /> : <Eye size={11} />} Diff
                  </button>
                  <button onClick={() => onToggleEdit(edit.historyId)}
                    className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs ${
                      isUndone ? `${theme === 'dark' ? 'text-indigo-400 hover:bg-indigo-500/10' : 'text-indigo-600 hover:bg-indigo-50'}` : `${theme === 'dark' ? 'text-rose-400 hover:bg-rose-500/10' : 'text-rose-600 hover:bg-rose-50'}`
                    }`}>
                    {isUndone ? (<><Redo2 size={11} /> 다시 적용</>) : (<><Undo2 size={11} /> 되돌리기</>)}
                  </button>
                </div>
              </div>
              {showThis && <DiffView edit={edit} t={t} theme={theme} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ==========================================
//  Block-level diff with table cherry-pick
// ==========================================
function DiffView({ edit, t, theme }) {
  const { oldBody, newBody } = edit;
  const maxLen = Math.max(oldBody.length, newBody.length);
  const diffRows = [];
  for (let i = 0; i < maxLen; i++) {
    const oldB = oldBody[i];
    const newB = newBody[i];
    if (!oldB) diffRows.push({ type: 'add', block: newB });
    else if (!newB) diffRows.push({ type: 'del', block: oldB });
    else if (JSON.stringify(oldB) === JSON.stringify(newB)) diffRows.push({ type: 'same', block: oldB });
    else diffRows.push({ type: 'change', oldBlock: oldB, newBlock: newB });
  }

  return (
    <div className={`px-3 py-2 space-y-1 max-h-[500px] overflow-y-auto ${theme === 'dark' ? 'bg-zinc-950/50' : 'bg-stone-50'}`}>
      {diffRows.map((row, i) => {
        if (row.type === 'same') {
          return (
            <div key={i} className={`flex gap-2 px-2 py-1 text-xs ${t.textFaint}`}>
              <span className="font-mono w-3"> </span>
              <span className="truncate flex-1">{row.block?.text || (row.block?.type === 'table' ? `[표] ${row.block.headers.join(' / ')}` : '')}</span>
            </div>
          );
        }
        if (row.type === 'add' || row.type === 'del') {
          const block = row.block;
          const isAdd = row.type === 'add';
          const cls = isAdd ? t.diffAddBg : t.diffDelBg;
          const txtCls = isAdd ? t.diffAddText : t.diffDelText;
          if (block?.type === 'table') {
            return (
              <div key={i} className={`px-2 py-1.5 rounded ${cls} border ${isAdd ? t.diffAddBorder : t.diffDelBorder}`}>
                <div className={`text-[10px] font-mono uppercase tracking-wider ${txtCls} mb-1`}>{isAdd ? '+ 표 추가' : '− 표 삭제'}</div>
                <MiniTable table={block} t={t} theme={theme} stripe={isAdd ? 'add' : 'del'} />
              </div>
            );
          }
          return (
            <div key={i} className={`flex gap-2 px-2 py-1 text-xs rounded ${cls}`}>
              <span className={`font-mono w-3 font-bold ${txtCls}`}>{isAdd ? '+' : '−'}</span>
              <span className={`flex-1 ${txtCls} ${isAdd ? '' : 'line-through'}`}>{block?.text || ''}</span>
            </div>
          );
        }
        // change
        if (row.oldBlock?.type === 'table' && row.newBlock?.type === 'table') {
          return <TableDiffBlock key={i} oldTable={row.oldBlock} newTable={row.newBlock} t={t} theme={theme} />;
        }
        const oldText = row.oldBlock?.text || '';
        const newText = row.newBlock?.text || '';
        const ops = diffTokens(oldText, newText);
        return (
          <div key={i} className={`px-2 py-1.5 text-xs rounded ${theme === 'dark' ? 'bg-zinc-900' : 'bg-white'} border ${t.border}`}>
            <div className={`text-[10px] font-mono uppercase tracking-wider ${t.textFaint} mb-1`}>~ 단어 단위 변경</div>
            <div className="leading-relaxed">
              {ops.map((op, oi) => {
                if (op.type === 'eq') return <span key={oi} className={t.text}>{op.token}</span>;
                if (op.type === 'add') return <span key={oi} className={`${t.diffAddInline} px-0.5 rounded`}>{op.token}</span>;
                return <span key={oi} className={`${t.diffDelInline} px-0.5 rounded`}>{op.token}</span>;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Mini table view (for add/del wholesale)
function MiniTable({ table, t, theme, stripe }) {
  return (
    <div className={`rounded overflow-hidden border ${t.border} mt-1`}>
      <table className="w-full text-[11px]">
        <thead className={theme === 'dark' ? 'bg-zinc-900' : 'bg-stone-100'}>
          <tr>{table.headers.map((h, i) => <th key={i} className={`px-2 py-1 text-left ${t.textMuted} font-medium`}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.map((r, ri) => (
            <tr key={ri} className={`border-t ${t.border}`}>
              {r.map((c, ci) => <td key={ci} className={`px-2 py-1 ${t.text} ${stripe === 'del' ? 'line-through' : ''}`}>{c || <span className={t.textFaint}>—</span>}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Interactive table diff with cell/row cherry-pick
function TableDiffBlock({ oldTable, newTable, t, theme }) {
  const { headerOps, rowOps } = useMemo(() => diffTable(oldTable, newTable), [oldTable, newTable]);
  // For demo: show structural changes with toggleable rows/columns
  const changedRows = rowOps.filter((op) => op.type !== 'eq');
  const addedHeaders = headerOps.filter((op) => op.type === 'add').map((op) => op.header);
  const deletedHeaders = headerOps.filter((op) => op.type === 'del').map((op) => op.header);

  // Display unified table with row/column highlights
  return (
    <div className={`rounded-lg border ${t.border} overflow-hidden`}>
      <div className={`px-3 py-2 ${theme === 'dark' ? 'bg-zinc-900' : 'bg-stone-100'} border-b ${t.border} flex items-center justify-between`}>
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] font-mono uppercase tracking-wider ${t.textFaint}`}>~ 표 변경</span>
        </div>
        <div className={`text-[10px] ${t.textFaint} flex items-center gap-2`}>
          {changedRows.length > 0 && <span>{changedRows.length}개 행 변경</span>}
          {addedHeaders.length > 0 && <span className={t.diffAddText}>+{addedHeaders.length} 컬럼</span>}
          {deletedHeaders.length > 0 && <span className={t.diffDelText}>−{deletedHeaders.length} 컬럼</span>}
        </div>
      </div>
      <div className={`overflow-x-auto ${theme === 'dark' ? 'bg-zinc-950' : 'bg-white'}`}>
        <table className="w-full text-[11px]">
          <thead className={theme === 'dark' ? 'bg-zinc-900/50' : 'bg-stone-50'}>
            <tr>
              {/* Render all headers from both old and new in order */}
              {newTable.headers.map((h, i) => {
                const isNew = addedHeaders.includes(h);
                return (
                  <th key={`n${i}`} className={`px-2 py-1.5 text-left font-semibold ${
                    isNew ? `${t.diffAddBg} ${t.diffAddText}` : t.textMuted
                  }`}>
                    {isNew && <span className="font-mono mr-0.5">+</span>}
                    {h}
                  </th>
                );
              })}
              {deletedHeaders.map((h, i) => (
                <th key={`d${i}`} className={`px-2 py-1.5 text-left font-semibold ${t.diffDelBg} ${t.diffDelText} line-through`}>
                  <span className="font-mono mr-0.5 no-underline">−</span>{h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowOps.map((op, i) => {
              if (op.type === 'eq') {
                return (
                  <tr key={i} className={`border-t ${t.border}`}>
                    {newTable.headers.map((h, ci) => {
                      const idx = newTable.headers.indexOf(h);
                      return <td key={`n${ci}`} className={`px-2 py-1 ${t.textMuted}`}>{op.newRow[idx] || <span className={t.textFaint}>—</span>}</td>;
                    })}
                    {deletedHeaders.map((h, ci) => (
                      <td key={`d${ci}`} className={`px-2 py-1 ${t.textFaint}`}>—</td>
                    ))}
                  </tr>
                );
              }
              if (op.type === 'add') {
                return (
                  <tr key={i} className={`border-t ${t.border} ${t.diffAddBg}`}>
                    {newTable.headers.map((h, ci) => {
                      const idx = newTable.headers.indexOf(h);
                      return <td key={`n${ci}`} className={`px-2 py-1 ${t.diffAddText} font-medium`}>
                        {ci === 0 && <span className="font-mono mr-0.5">+</span>}
                        {op.newRow[idx] || ''}
                      </td>;
                    })}
                    {deletedHeaders.map((h, ci) => (
                      <td key={`d${ci}`} className="px-2 py-1"></td>
                    ))}
                  </tr>
                );
              }
              if (op.type === 'del') {
                return (
                  <tr key={i} className={`border-t ${t.border} ${t.diffDelBg}`}>
                    {newTable.headers.map((h, ci) => {
                      const idx = oldTable.headers.indexOf(h);
                      const cell = idx >= 0 ? op.oldRow[idx] : '';
                      return <td key={`n${ci}`} className={`px-2 py-1 ${t.diffDelText} line-through`}>
                        {ci === 0 && <span className="font-mono mr-0.5 no-underline">−</span>}
                        {cell || ''}
                      </td>;
                    })}
                    {deletedHeaders.map((h, ci) => {
                      const idx = oldTable.headers.indexOf(h);
                      return <td key={`d${ci}`} className={`px-2 py-1 ${t.diffDelText} line-through`}>{op.oldRow[idx] || ''}</td>;
                    })}
                  </tr>
                );
              }
              // change row — show cell-level highlights
              return (
                <tr key={i} className={`border-t ${t.border}`}>
                  {newTable.headers.map((h, ci) => {
                    const oldIdx = oldTable.headers.indexOf(h);
                    const newIdx = newTable.headers.indexOf(h);
                    const oldCell = oldIdx >= 0 ? op.oldRow[oldIdx] : '';
                    const newCell = op.newRow[newIdx] || '';
                    const changed = oldCell !== newCell;
                    if (!changed) {
                      return <td key={`n${ci}`} className={`px-2 py-1 ${t.textMuted}`}>{newCell || <span className={t.textFaint}>—</span>}</td>;
                    }
                    return (
                      <td key={`n${ci}`} className="px-2 py-1">
                        <div className="flex flex-col gap-0.5">
                          {oldCell && <span className={`px-1 rounded ${t.diffDelInline}`}>{oldCell}</span>}
                          {newCell && <span className={`px-1 rounded ${t.diffAddInline}`}>{newCell}</span>}
                        </div>
                      </td>
                    );
                  })}
                  {deletedHeaders.map((h, ci) => {
                    const idx = oldTable.headers.indexOf(h);
                    return <td key={`d${ci}`} className={`px-2 py-1 ${t.diffDelText} line-through`}>{op.oldRow[idx] || ''}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ==========================================
//  Block / Cover / MiniPreview / DockBtn
// ==========================================
function Block({ block, t, theme }) {
  if (block.type === 'h1') return <h1 className={`text-4xl leading-tight font-semibold ${t.textStrong} tracking-tight`}>{block.text}</h1>;
  if (block.type === 'lead') return <p className={`text-lg leading-relaxed ${t.textMuted} font-light`}>{block.text}</p>;
  if (block.type === 'h2') {
    return (
      <h2 className={`text-base font-semibold ${t.text} mt-12 mb-2 tracking-tight flex items-center gap-2`}>
        <span className={`w-1 h-4 rounded-full ${t.accentDot}`} />{block.text}
      </h2>
    );
  }
  if (block.type === 'table') {
    return (
      <div className={`my-6 rounded-xl border ${t.border} overflow-hidden ${t.bgMuted}`}>
        <table className="w-full text-sm">
          <thead>
            <tr className={`border-b ${t.border} ${theme === 'dark' ? 'bg-zinc-900' : 'bg-stone-100/60'}`}>
              {block.headers.map((h, i) => (
                <th key={i} className={`px-4 py-3 text-left font-semibold ${t.textMuted} text-xs uppercase tracking-wider`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, ri) => (
              <tr key={ri} className={`border-b ${t.borderSubtle} last:border-0 ${theme === 'dark' ? 'hover:bg-zinc-900' : 'hover:bg-stone-50'}`}>
                {row.map((cell, ci) => (
                  <td key={ci} className={`px-4 py-3 ${ci === 0 ? `${t.textStrong} font-medium` : cell === '●' ? t.accent : `${t.textMuted} tabular-nums`}`}>
                    {cell || <span className={t.textFaint}>—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return <p className={`text-base leading-relaxed ${t.text}`}>{block.text}</p>;
}

function CoverPage({ theme, t }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-12 py-20 relative overflow-hidden">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full blur-3xl pointer-events-none"
        style={{ background: theme === 'dark' ? 'radial-gradient(circle, rgba(99,102,241,0.15), transparent 70%)' : 'radial-gradient(circle, rgba(99,102,241,0.08), transparent 70%)' }} />
      <div className="relative max-w-2xl w-full text-center">
        <div className={`text-xs font-mono uppercase tracking-widest ${t.textFaint} mb-8`}>MindBuild · 2026</div>
        <div className="flex justify-center mb-10">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-400 via-purple-400 to-pink-400 flex items-center justify-center shadow-2xl"
            style={{ boxShadow: '0 20px 60px -15px rgba(99, 102, 241, 0.5)' }}>
            <span className="text-2xl font-bold text-white">H</span>
          </div>
        </div>
        <h1 className={`text-6xl leading-tight font-semibold ${t.textStrong} tracking-tight mb-6`}>
          연구개발사업<br />
          <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">추진 계획서</span>
        </h1>
        <p className={`text-lg ${t.textMuted} font-light mb-12 max-w-lg mx-auto leading-relaxed`}>
          2026년도 정부 R&D 과제 신청을 위한 추진 계획. 한컴 표준 양식 및 나라장터 제출 규격 준수.
        </p>
        <div className={`grid grid-cols-3 gap-8 pt-8 border-t ${t.border} max-w-md mx-auto`}>
          <Stat label="Pages" value="5" t={t} />
          <Stat label="Powered by" value="Sonnet 4" t={t} />
          <Stat label="Quarter" value="Q1–Q4" t={t} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, t }) {
  return (
    <div>
      <div className={`text-xs uppercase tracking-wider ${t.textFaint} mb-1`}>{label}</div>
      <div className={`text-base font-semibold ${t.textStrong} tabular-nums`}>{value}</div>
    </div>
  );
}

function MiniPreview({ page, theme }) {
  if (page.isCover) {
    return (
      <div className="w-full h-full relative flex items-center justify-center">
        <div className="absolute inset-0" style={{ background: theme === 'dark' ? 'radial-gradient(circle, rgba(99,102,241,0.3), transparent 70%)' : 'radial-gradient(circle, rgba(99,102,241,0.15), transparent 70%)' }} />
        <div className="w-3 h-3 rounded bg-gradient-to-br from-indigo-400 to-pink-400 relative" />
      </div>
    );
  }
  const bars = page.body?.slice(0, 6) || [];
  return (
    <div className="w-full h-full p-1.5 flex flex-col gap-1">
      {bars.map((b, i) => {
        if (b.type === 'h1') return <div key={i} className={`h-1 rounded-sm ${theme === 'dark' ? 'bg-zinc-300' : 'bg-stone-700'}`} style={{ width: '70%' }} />;
        if (b.type === 'h2') return <div key={i} className={`h-0.5 rounded-sm ${theme === 'dark' ? 'bg-zinc-400' : 'bg-stone-500'} mt-0.5`} style={{ width: '40%' }} />;
        if (b.type === 'table') return (
          <div key={i} className="grid grid-cols-3 gap-px mt-0.5">
            {Array.from({ length: 6 }).map((_, j) => <div key={j} className={`h-1 ${theme === 'dark' ? 'bg-zinc-700' : 'bg-stone-300'}`} />)}
          </div>
        );
        if (b.type === 'lead') return <div key={i} className={`h-0.5 rounded-sm ${theme === 'dark' ? 'bg-zinc-500' : 'bg-stone-400'}`} style={{ width: '85%' }} />;
        return (
          <div key={i} className="space-y-0.5">
            <div className={`h-0.5 rounded-sm ${theme === 'dark' ? 'bg-zinc-600' : 'bg-stone-300'}`} style={{ width: '95%' }} />
            <div className={`h-0.5 rounded-sm ${theme === 'dark' ? 'bg-zinc-600' : 'bg-stone-300'}`} style={{ width: '78%' }} />
          </div>
        );
      })}
    </div>
  );
}

function DockBtn({ children, onClick, disabled, t }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`w-8 h-8 rounded-full flex items-center justify-center ${t.textMuted} ${t.hover} disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:scale-110`}>
      {children}
    </button>
  );
}

// ==========================================
//  User dropdown menu
// ==========================================
function UserMenu({ open, setOpen, t, theme }) {
  const menuRef = useRef(null);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, setOpen]);

  const items = [
    { id: 'profile', label: '프로필', icon: User, hint: null },
    { id: 'settings', label: '설정', icon: Settings, hint: '⌘,' },
    { id: 'shortcuts', label: '단축키', icon: Keyboard, hint: '?' },
    { id: 'billing', label: '플랜 및 결제', icon: CreditCard, hint: null },
    { id: 'help', label: '도움말', icon: HelpCircle, hint: null },
  ];

  const handleSelect = (id) => {
    setOpen(false);
    // Hook up real handlers here
    console.log('user menu:', id);
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`w-7 h-7 rounded-full overflow-hidden ring-2 ring-transparent ${open ? (theme === 'dark' ? 'ring-zinc-600' : 'ring-stone-300') : ''} hover:ring-zinc-500 transition-all`}
        title="계정"
      >
        <div className="w-full h-full bg-gradient-to-br from-indigo-400 to-pink-400 flex items-center justify-center">
          <span className="text-xs font-bold text-white">E</span>
        </div>
      </button>

      {open && (
        <div
          className={`absolute right-0 top-full mt-2 w-64 rounded-xl border ${t.border} ${t.bgDock} backdrop-blur-xl overflow-hidden z-50`}
          style={{
            boxShadow: theme === 'dark'
              ? '0 16px 48px -12px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)'
              : '0 16px 48px -12px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.04)',
          }}
        >
          {/* Profile header */}
          <div className={`px-3 py-3 border-b ${t.border} flex items-center gap-3`}>
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-400 via-purple-400 to-pink-400 flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-bold text-white">E</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className={`text-sm font-semibold ${t.textStrong} truncate`}>Eunmi Lee</div>
              <div className={`text-xs ${t.textFaint} truncate`}>eunmi@mindbuild.io</div>
            </div>
          </div>

          {/* Workspace badge */}
          <div className={`px-3 py-2 border-b ${t.border} flex items-center justify-between`}>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center">
                <span className="text-[9px] font-bold text-white">M</span>
              </div>
              <div>
                <div className={`text-xs font-medium ${t.textStrong}`}>MindBuild</div>
                <div className={`text-[10px] ${t.textFaint}`}>Pro plan</div>
              </div>
            </div>
            <button className={`text-xs ${t.textFaint} ${t.hover} px-1.5 py-0.5 rounded`}>전환</button>
          </div>

          {/* Menu items */}
          <div className="py-1">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => handleSelect(item.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm ${t.text} ${t.hover} transition-colors`}
                >
                  <Icon size={14} className={t.textMuted} />
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.hint && (
                    <kbd className={`text-[10px] ${t.textFaint} font-mono tabular-nums`}>{item.hint}</kbd>
                  )}
                </button>
              );
            })}
          </div>

          <div className={`border-t ${t.border} py-1`}>
            <button
              onClick={() => handleSelect('logout')}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm ${theme === 'dark' ? 'text-rose-400 hover:bg-rose-500/10' : 'text-rose-600 hover:bg-rose-50'} transition-colors`}
            >
              <LogOut size={14} />
              <span>로그아웃</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
