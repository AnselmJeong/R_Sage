# R Sage

R 전용 macOS 데스크톱 IDE. Positron의 R 경험(콘솔, 에디터, 환경, 플롯, 도움말, 데이터 뷰어)을 Code OSS 포크 없이 가볍게 다시 만들고, 그 위에 Quarto 보고서 작성과 폴더 맥락을 아는 AI 조수를 올리는 것이 목표입니다.

- 셸: [Electrobun](https://electrobun.dev) (Bun 메인 프로세스 + 시스템 WebView)
- UI와 플러그인: TypeScript, React, dockview, Monaco, xterm.js
- R 커널: [Ark](https://github.com/posit-dev/ark) (MIT, Positron의 R 커널)를 그대로 사용
- 설계 배경: [전략 개요](https://claude.ai/code/artifact/72e93c44-c8ab-441d-98db-4f4a820921e0), [구현 계획](https://claude.ai/code/artifact/193415de-215a-4b42-80e8-f332092dbdf9)

## 지금 되는 것 (구현 계획 0~2단계)

| 영역 | 내용 |
| --- | --- |
| R 세션 | 시스템 R 탐색(CRAN 프레임워크, Homebrew, rig, PATH), Ark 실행, 재시작, 중단, 비정상 종료 감지, 메모리 표시 |
| 콘솔 | 여러 줄 입력, 완성 여부 판단, 명령 이력과 Ctrl+R 검색, `readline()` 입력, 오류에서 소스 줄로 이동, 한글 출력 |
| 에디터 | Monaco + Ark LSP(자동 완성, 호버, 시그니처, 정의 이동, 진단), ⌘↵ 문장 단위 실행(Ark statementRange), 함수 전체 실행, `source()` |
| 파일 | 프로젝트 폴더 트리, 생성·이름 바꾸기·휴지통, 외부 변경 감지와 충돌 대화상자, 비정상 종료 후 복구 백업, 프로젝트 검색·바꾸기(ripgrep) |
| 터미널 | Bun 내장 PTY 기반 별도 셸 |
| 실행 이력 | 모든 실행에 id, 세션 세대, 출처(파일:줄)를 붙여 `.rsage/history.jsonl`에 저장 |
| 환경 | 전역 변수 목록, 펼쳐 보기, 데이터 뷰어 열기, 비우기 |
| 플롯 | 창 크기에 맞춘 재렌더링, 이력, PNG/SVG/PDF/JPEG 내보내기, 클립보드 복사, 플롯을 만든 코드로 이동 |
| 도움말 | `?lm`, `help()` 결과를 패널에 표시, 앞/뒤 이동 |
| 데이터 뷰어 | `View(df)` 또는 환경 패널에서 열기, 큰 표를 구간 단위로 읽는 가상 스크롤, 열 정렬 |

프로젝트 메타데이터는 프로젝트 폴더의 `.rsage/` 안에만 저장됩니다(설정, 열린 파일, 실행 이력, 백업).

## 실행

필요한 것: [Bun](https://bun.sh) 1.3.5 이상, R 4.2 이상, Ark 바이너리.

```sh
bun install
bun scripts/fetch-ark.ts            # Ark 릴리스를 vendor/ark/ark에 내려받기
# 또는: ARK_SRC=~/src/ark bun scripts/fetch-ark.ts --source   (cargo로 직접 빌드)
```

브라우저 셸(개발용, UI와 호스트를 창 없이 확인):

```sh
bun run dev                         # http://127.0.0.1:7878/?token=... 를 엽니다
```

데스크톱 앱(macOS):

```sh
cd apps/desktop
hutch run dev                       # UI 빌드 후 Electrobun 창 실행
hutch run build                     # 서명·공증된 릴리스 (Apple 자격 증명 필요)
```

검사:

```sh
bun run typecheck
bun test                            # R과 Ark가 있으면 실제 커널 통합 테스트까지 실행
```

## 구조

```
packages/zmtp     순수 TypeScript ZeroMQ(ZMTP 3.0) — Bun에서 zeromq 네이티브 모듈 없이 Ark와 통신
packages/kernel   Jupyter 메시징, Ark 실행, R 탐색, KernelSession(실행 기록, 출력 연결)
packages/host     앱의 모든 기능(세션, 프로젝트, 파일, 검색, 터미널, LSP, comm)을 dispatch() 하나로 노출
packages/shared   호스트와 UI가 공유하는 메서드·이벤트 타입
packages/ui       React 워크벤치 (Electrobun WebView와 브라우저 셸에서 같은 번들)
apps/desktop      Electrobun 메인 프로세스, 네이티브 메뉴, 패키징 설정
scripts           Ark 바이너리 준비
```

자세한 내용과 0단계 검증 결과, macOS에서 아직 확인하지 못한 항목은 [docs/architecture.md](docs/architecture.md)에 있습니다.

## 라이선스

R Sage 코드의 라이선스는 아직 정하지 않았습니다. 번들되는 Ark는 MIT입니다.
