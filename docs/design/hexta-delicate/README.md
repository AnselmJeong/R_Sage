# R Sage · HextaUI 참고 시안

2026-10-23. Built-in imagegen 사용. 실제 HextaUI 버튼 예제 화면을 스타일 참고 이미지로 사용했다. 이전 두 디자인 방향을 대체하는 검토용 시안이며 사용자 승인이나 실제 적용을 의미하지 않는다.

[시안](concept-v3.png) · [전체 생성 프롬프트](prompt.md)

## 참고한 요소

- 작은 크기의 버튼, 균일한 모서리와 얇은 경계선.
- 선택된 항목만 살짝 올라오는 분할 탭.
- 작은 아이콘과 글자의 기준선 정렬.
- 검정과 회색 사이의 미세한 면 차이. 강한 색면·명조체·큰 제목은 배제.
- 첨부 문서, 모델 선택, 전송 버튼이 들어가는 하나의 AI 입력 영역.
- 파일·편집기·콘솔·AI·플롯의 기존 위치는 유지. 각 주요 작업 면 사이에 좁은 간격을 둬 경계를 읽기 쉽게 한다.

## 실제 컴포넌트 적용 후보

| R Sage 영역 | HextaUI 후보 | 적용 시 보존할 기능 |
| --- | --- | --- |
| 실행·렌더·저장 | Button / Button group | 중복 실행 방지, 실패 이유, 실행 중단 |
| 소스·비주얼, AI 내부 보기 | Tabs / Toggle group | 키보드 이동과 기존 상태 유지 |
| AI 입력 | Input group / Attachment | 한국어 IME, 첨부, 모델·맥락 선택, 스트리밍 중단 |
| AI 대화 | Message / Collapsible | 완료 내역 접기, 진행·실패·승인 요청 노출 |
| 탐색기 | Sidebar / Tree | 프로젝트 파일 작업과 저장된 펼침 상태 |
| 명령 검색·메뉴 | Command / Dropdown menu / Tooltip / Kbd | 기존 단축키와 명령 등록 |
| 상태 표시 | Badge / Spinner / Toast | 색 이외의 상태 구분, 읽을 수 있는 오류 |

Dockview는 패널 도킹·리사이즈·저장 레이아웃을 계속 담당하는 것이 적합하다. 시안과 비슷해 보인다는 이유로 HextaUI Tabs 또는 Resizable로 전체 도킹 동작을 대체하지 않는다. Monaco, Quarto, 콘솔, 터미널의 테마도 함께 맞춰야 한다.

## 호환성 확인

현재 packages/ui/package.json: React / React DOM 18.3.1, Vite 6, 자체 CSS. Tailwind와 shadcn 설정은 현재 프로젝트에서 찾지 못했다.

2026-10-23 공식 설치 문서: React 19, Tailwind CSS v4, components.json 요구. Base UI 기반이고 Tabler 아이콘을 사용한다. 공식 컴포넌트는 MIT 라이선스로 소스를 프로젝트에 복사해 수정하는 방식이다. 유료 Pro 블록은 별도 조건이므로 이 시안에서는 설치·복사하지 않았다.

따라서 즉시 설치만으로 호환된다고 단정할 수 없다. 실제 도입 시 React 및 편집기 통합 검증, Tailwind 전역 스타일과 기존 CSS의 충돌 확인, 공식 소스 라이선스 보존이 필요하다. UI 디자인만을 위해 전체 기능을 한 번에 교체할 필요는 없다.

## 이미지 검수 및 구현 시 보정

이미지의 데이터·플롯·AI 메시지는 설명용이며 실제 연구 결과가 아니다. 예시 문서 개요와 본문 제목은 구현 시 일치시킨다. 그림에 일부 중복된 main/R 상태는 한 위치로 정리한다. 폴더 아이콘의 높은 채도는 실제 적용 시 낮춘다. 모델 선택과 첨부 버튼은 더 가볍게 만들 수 있다. 배경의 생성된 미세한 질감은 구현하지 않고 단색으로 처리한다. 작은 글자와 비활성 상태도 실제 화면에서 대비와 가독성을 확인한다. 통계 그림 자체의 색과 출력 배경은 앱 테마 변경에 따라 임의로 바꾸지 않는다.

## 출처

- [Components](https://hextaui.com/components)
- [Button](https://hextaui.com/docs/button)
- [Button variants — 실제 이미지 참고](https://hextaui.com/docs/button/examples/variants)
- [Tabs](https://hextaui.com/docs/tabs)
- [Message](https://hextaui.com/docs/message)
- [Sidebar](https://hextaui.com/docs/sidebar)
- [Introduction — 기반 기술과 라이선스](https://hextaui.com/docs)
- [Installation — 현재 도입 조건](https://hextaui.com/docs/installation)

Context7도 조회했으나 가져온 README 안내보다 현재 공식 설치 문서가 구체적이어서 호환성 판단에는 현재 공식 문서를 우선했다.

