# HwpxViewer — 서비스 기동 가이드

## 사전 요구사항

- Python 3.11–3.13
- Node 18+ / pnpm
- macOS / Linux (rhwp WASM 은 wasmtime 으로 양 플랫폼 모두 지원)

처음 받는 환경이면 다음을 한 번 실행:

```bash
# 1) Web deps
make install   # = pnpm install (apps/web)

# 2) Backend venv + 의존성
cd apps/backend
python3 -m venv .venv
.venv/bin/pip install -e .
cd ../..
```

`pyhwpxlib[preview]` 가 `~70MB` rhwp WASM 바이너리를 받아오므로 첫 설치는 1–2분 소요.

---

## 백엔드 (FastAPI + uvicorn, port 8000)

### 가장 빠른 실행

```bash
cd apps/backend
.venv/bin/uvicorn hwpx_viewer_api.main:app --reload --host 127.0.0.1 --port 8000
```

옵션:

- `--reload` 코드 변경 시 자동 재기동 (개발 시 권장)
- `--port 8000` 프론트가 기대하는 기본 포트
- `--host 127.0.0.1` 로컬 전용 (외부 노출 시 `0.0.0.0`)

### 백그라운드로 띄울 때

```bash
cd apps/backend
nohup .venv/bin/uvicorn hwpx_viewer_api.main:app --host 127.0.0.1 --port 8000 \
  > /tmp/hwpx-backend.log 2>&1 &
echo "pid=$!"
```

종료:

```bash
lsof -ti:8000 | xargs kill
```

### 헬스체크

```bash
curl -s http://127.0.0.1:8000/healthz
# {"status":"ok","version":"0.8.0"}

curl -s http://127.0.0.1:8000/openapi.json | python3 -m json.tool | head -40
```

(엔드포인트는 `/healthz`, `/api/health` 가 아님)

---

## 프론트엔드 (Vite, 기본 port 5173)

```bash
make dev
# 또는
pnpm -C apps/web dev
# 포트를 명시하고 싶을 때:
pnpm -C apps/web dev --host 127.0.0.1 --port 5173
```

기본 포트 `5173` 이 점유 중이면 Vite 가 자동으로 다음 포트(`5174`, `5175`…) 로 잡으니 콘솔 출력 URL (`Local: http://localhost:XXXX/`) 을 확인.

빌드 / 검증:

```bash
make build       # tsc --noEmit + vite build
make typecheck   # tsc --noEmit
make lint        # eslint --max-warnings 0
make test        # vitest run
```

종료:

```bash
lsof -ti:5173 | xargs kill
# 다른 포트로 잡힌 경우 함께 정리:
lsof -ti:5173 5174 5175 | xargs kill 2>/dev/null
# 현재 떠 있는 Vite 인스턴스 확인:
lsof -nP -iTCP -sTCP:LISTEN | grep -E "vite|517"
```

---

## 두 서버를 동시에 띄우는 1 커맨드 (개발 표준 흐름)

별도 터미널 두 개를 권장:

```bash
# 터미널 A — 백엔드 (반드시 8000)
cd apps/backend && .venv/bin/uvicorn hwpx_viewer_api.main:app --reload --port 8000

# 터미널 B — 프론트
make dev
```

브라우저: `http://localhost:5173` (Vite 출력 URL 그대로 — 점유 시 5174/5175)

프론트의 `VITE_API_BASE_URL` 미지정 시 `''` (상대경로) 로 동작 → 같은 호스트의 `/api/*` 가 백엔드를 가리키므로 dev proxy 또는 동일 호스트 가정.

---

## 환경변수

대부분의 경우 기본값으로 충분. 커스텀이 필요하면:

| 변수 | 위치 | 의미 | 기본값 |
|---|---|---|---|
| `VITE_API_BASE_URL` | apps/web `.env.local` | 백엔드 base URL | `''` (상대경로) |
| `LOG_LEVEL` | backend env | 로깅 레벨 | `info` |
| `CORS_ORIGINS` | backend env | 쉼표 구분 허용 origin | dev 시 자동 |

**주의**: `ANTHROPIC_API_KEY` 는 사용하지 않습니다 (CLAUDE.md NEVER 규칙). Claude 호출은 호스트의 `claude -p` CLI OAuth 세션을 통해 이뤄지므로 `~/.claude/` 에 로그인되어 있어야 합니다.

---

## 자주 만나는 문제

### "rhwp WASM error: ..." / 8000 포트 응답 없음

WASM 락이 걸린 좀비 uvicorn 가능성. 강제 종료 후 재기동:

```bash
lsof -ti:8000 | xargs kill -9
sleep 2
cd apps/backend && .venv/bin/uvicorn hwpx_viewer_api.main:app --reload --port 8000
```

### Vite 가 5173 이 아닌 포트로 뜸

기본 포트 `5173` 이 점유 중이면 Vite 가 자동으로 다음 빈 포트로 잡힙니다. 콘솔의 `Local: http://localhost:XXXX/` 를 그대로 사용.

특정 포트를 강제하려면:

```bash
pnpm -C apps/web dev --host 127.0.0.1 --port 5173
```

이 명령은 포트가 비어있지 않으면 fail-fast 하므로, 점유 중인 프로세스를 먼저 종료해야 합니다.

### 한글 글자가 두부(tofu)로 보임

`/api/render` 가 `embed_fonts=True` 로 호출돼야 함. 코드에서 이 옵션은 항상 켜져 있으니 발생하지 않아야 정상. 발생 시 `services/rhwp_wasm.py` `render_page_svg` 의 `embed_fonts` 인자 확인.

### "편집한 파일을 다운로드해도 변경이 반영 안 됨"

브라우저 캐시. 에디터에서 **저장 (Save)** 버튼을 사용하면 `~/Documents/HwpxViewer/{filename} v{N}-{edits}편집.hwpx` 로 직접 저장돼 캐시를 우회합니다. 다운로드 URL 도 `?v={version}&t={timestamp}` 로 캐시버스터가 붙으므로 재시도 시 강제 새로고침 (Cmd+Shift+R).

### Shift+클릭 페이지 다중선택이 동작 안 함

`6841c6a` 에서 4중 픽스 적용. 그래도 동작 안 하면:

1. Cmd+Shift+R 하드 리로드
2. DevTools Console 의 `[selection.page]` 로그 확인
3. Network 탭에서 `/api/selection-rects` 응답 확인

---

## 샘플 파일

```
/Users/leeeunmi/Projects/active/HwpxViewer/전문가활용내역서_채움.hwpx
```

업로드 또는 드래그 앤 드롭으로 테스트.

## Deep-link 세션 복원 (`?upload=<id>`)

업로드 후 브라우저 주소에 `?upload=<uploadId>` 를 붙여 다시 열면 같은 세션을 다른 탭/창에서 그대로 사용할 수 있습니다 (TTL 30분 한정).

```
http://localhost:5173/?upload=16420b81-6307-4284-a9cb-718f4d1bcead
```

서버 재기동/만료 시 404 + 빈 상태로 fallback (URL param 자동 정리).

---

## 종료 / 정리

```bash
# 두 서버 모두 종료
lsof -ti:8000 | xargs kill 2>/dev/null
lsof -ti:5173 5174 5175 | xargs kill 2>/dev/null

# 빌드 결과물 / 캐시 제거
make clean
```
