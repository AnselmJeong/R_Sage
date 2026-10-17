# 구조와 진행 상황

## 프로세스 구성

```
┌──────────── Electrobun 앱 (Bun 프로세스) ────────────┐
│  apps/desktop/src/bun/index.ts                        │
│    └─ Host (packages/host) ── dispatch(method, params)│
│         ├─ KernelSession ── ZMTP(TCP) ──► Ark ── R    │
│         ├─ LspBridge ───── TCP ─────────► Ark LSP     │
│         ├─ CommManager (positron.* comm)              │
│         ├─ Project (.rsage/, 파일 감시, 백업)          │
│         └─ TerminalService (Bun PTY) ──► 로그인 셸     │
│                    ▲ RPC 메시지 "wire"                 │
│  BrowserWindow (WKWebView) ── packages/ui              │
└───────────────────────────────────────────────────────┘
```

- 모든 기능은 `Host.dispatch()` 뒤에 있습니다. 셸 어댑터는 메시지만 옮깁니다.
  - 데스크톱에서는 Electrobun RPC 메시지 `wire`가 메시지를 옮깁니다.
  - 개발용 브라우저 셸에서는 토큰이 붙은 WebSocket(`packages/host/src/dev-server.ts`)이 옮깁니다.
  - 그래서 창 없이도 UI와 호스트 전체를 테스트할 수 있습니다.
- 메서드와 이벤트 목록은 `packages/shared/src/index.ts` 한 곳에 있습니다. 나중에 플러그인 API와 MCP 도구를 만들 때 이 목록을 그대로 씁니다.

## 0단계 검증 결과 (Linux 컨테이너에서 확인)

| 위험 | 결과 |
| --- | --- |
| Bun에서 `zeromq` 네이티브 모듈 | Bun에서 N-API 애드온이 죽어서 쓸 수 없었습니다. 대신 ZMTP 3.0(NULL 보안, DEALER/SUB/REQ)을 `node:net` 위에 TypeScript로 직접 구현했습니다(`packages/zmtp`). 계획의 대안이었던 Rust 사이드카는 필요 없었습니다. |
| Ark 바이너리 | 릴리스 다운로드는 이 환경의 네트워크 정책에 막혀 소스(0.1.252)로 빌드했습니다. `scripts/fetch-ark.ts`는 두 방법을 모두 지원합니다. |
| Ark 실행 옵션 | `--connection_file`, `--session-mode console`을 사용하고, R_HOME과 UTF-8 로케일을 지정합니다. 로케일을 지정하지 않으면 한글이 `<U+C77C>`처럼 출력됩니다. |
| PTY | Bun 내장 터미널 API로 동작합니다. |
| Electrobun | 이 환경에서는 Electrobun과 Hutch를 내려받을 수 없어 SDK 소스에 대한 타입 검사까지만 했고, 실행은 하지 못했습니다. |
| DuckDB | 데이터 뷰어가 Ark의 data explorer comm을 쓰므로 2단계에서는 필요 없었습니다. |

## Positron comm (2단계)

- 프론트엔드가 여는 comm은 `positron.ui`, `positron.variables`, `positron.help`입니다. 세션이 시작될 때마다 엽니다.
- 커널이 여는 comm은 플롯마다 하나인 `positron.plot`과 `View()`마다 하나인 `positron.dataExplorer`입니다.
  - Ark는 이 comm을 parent 헤더 없이 보냅니다. 그래서 그 순간 실행 중인 실행 기록에 연결합니다(플롯을 만든 코드로 이동하는 기능이 이것을 씁니다).
- 요청은 `{jsonrpc, id, method, params}` 형식으로 보내고, 응답은 iopub의 `comm_msg`로 받아 parent `msg_id`로 짝을 맞춥니다.
  - 매개변수가 없는 요청(`list`, `get_state`)은 `params` 필드를 아예 빼야 합니다. 빈 객체를 보내면 Ark가 거부합니다.
- 커널이 프론트엔드에 묻는 요청(stdin의 `rpc_request`)은 다음처럼 처리합니다.
  - `workspace_folder`처럼 호스트가 답할 수 있는 것은 호스트가 바로 답합니다.
  - `show_question`과 `show_prompt`는 UI 대화상자로 보냅니다.
  - 모르는 요청에는 `null`로 답해서 R이 멈추지 않게 합니다.

## 테스트

- `packages/zmtp/test`: 프레이밍과 핸드셰이크 단위 테스트입니다.
- `packages/kernel/test`: 실제 Ark + R로 실행, 출력 연결, 오류, 입력, 중단, 재시작을 확인합니다.
- `packages/host/test`: 실제 Ark로 변수, 플롯 렌더링, 도움말, 데이터 뷰어 comm을 확인합니다.
- UI는 브라우저 셸과 Playwright(Chromium)로 직접 조작해 확인했습니다. 자동화된 UI 테스트는 아직 저장소에 없습니다.

## macOS에서 아직 확인하지 못한 것

이 저장소는 Linux 컨테이너에서 만들었습니다. 다음은 Mac에서 처음 실행할 때 확인해야 합니다.

- Electrobun 앱 실행 전체(창, 네이티브 메뉴, RPC, WKWebView에서의 Monaco·xterm·dockview 동작)
- macOS R 탐색 경로(`/Library/Frameworks/R.framework`, Homebrew, rig)
- WKWebView에서 한글 IME 입력(콘솔, 에디터, 터미널)
- Finder 휴지통 이동(osascript)
- 앱 번들에 Ark 포함, 코드 서명, 공증
- 플롯 클립보드 복사(WKWebView의 `ClipboardItem` 지원)

## 아직 하지 않은 것

- 1단계 남은 항목
  - Air 포매터 연결
  - `.Rproj` 가져오기
  - 디버거(DAP)
  - 패널 배치 저장과 복원(지금은 열린 파일만 복원합니다)
- 3단계 이후
  - 패키지 관리
  - Quarto 편집과 렌더링
  - Git
  - AI 조수
  - 플러그인과 MCP 서버
