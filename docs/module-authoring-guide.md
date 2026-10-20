# 분석 모듈 작성 가이드

_2026-10-17, 2026-10-19 보강 · 새 분석 모듈을 만드는 사람(또는 AI 세션)이 처음부터 끝까지 따라 하는 문서_

R Sage의 분석 모듈은 JASP처럼 GUI로 통계 분석을 하게 해 준다. 이 문서는 모듈 하나를 만들 때 필요한 것을 모두 적는다. 무엇을 먼저 정해야 하는지(스펙), 화면을 어떻게 짜는지(GUI), 결과를 표와 그림으로 어떻게 내는지, 어떤 원칙을 지키는지, 그리고 어떻게 검증하는지다. 마지막에 결측 데이터 모듈과 데이터 점검 모듈을 실제 예로 든다.

함께 볼 문서:

- [analysis-modules-strategy.md](analysis-modules-strategy.md): 모듈 구조를 그렇게 정한 이유, 그림 크기 규칙, 데이터와 변수 선택 규칙
- [analysis-modules-catalog.md](analysis-modules-catalog.md): 만들 모듈 목록과 백엔드 패키지 선정 기준
- [package-recommendations.md](package-recommendations.md): 다른 AI가 추천한 패키지 목록 (검증 안 됨)

## 1. 원칙

1. **GUI는 편의이자 안내다.** 사용자는 백엔드 패키지가 무엇을 할 수 있는지 모르는 경우가 많다. 패키지 개발자는 홈페이지, README, vignette에 대표 활용법을 보여 준다. 모듈은 그 활용법을 옵션으로 하나하나 드러내고, 각 옵션에 무엇을 얻는지 한 줄로 적는다. 사용자는 옵션 목록을 훑기만 해도 "이런 분석도 되는구나"를 알게 된다.
2. **대표 활용법은 빠짐없이 옮긴다.** 모듈을 설계할 때 백엔드 패키지의 홈페이지와 vignette에 나온 예제를 목록으로 만들고, 각 예제가 어느 옵션과 어느 결과로 이어지는지 표로 정리한다(4장). 빼는 것이 있으면 이유를 스펙에 적는다.
3. **옵션은 통계 개념으로 이름 붙인다.** 백엔드 함수의 인자를 그대로 옮기지 않는다. `analyse()`가 옵션을 백엔드 호출로 번역한다. 그래야 백엔드가 바뀌어도 저장된 분석, GUI, AI 도구가 그대로 동작한다. 다만 옵션 옆에 백엔드 함수 이름을 태그로 보여 줘서, 사용자가 나중에 직접 코드를 쓸 때 무엇을 찾아야 하는지 알게 한다.
4. **못 쓰는 옵션도 보여 준다.** 조건이 안 맞아 쓸 수 없는 옵션(예: 그룹 변수가 없을 때의 그룹별 그림)은 숨기지 않고 흐리게 둔 채 무엇을 하면 켜지는지 적는다(`enabledWhen`, `disabledHint`). 하위 옵션(예: 그림의 세부 설정)은 상위 옵션이 꺼져 있으면 흐리게 보인다.
5. **결과에는 읽는 법을 붙인다.** 모든 표와 그림에 한두 문장의 `description`을 단다. 무엇을 보면 되는지, 어떤 모양이면 무엇을 뜻하는지를 쓴다. 해석을 대신하지 않고, 해석하는 방법을 알려 준다.
6. **숫자는 표로, 모양은 그림으로.** 보고서에 인용할 값(개수, 비율, 통계량, p값)은 반드시 표에 있다. 그림은 분포, 패턴, 관계처럼 숫자로 요약하기 어려운 것을 보여 준다. 그림에만 있는 숫자는 없게 한다.
7. **공통 중간 단계를 쓴다.** 데이터 준비는 tidyverse, 결과 정리는 easystats, 그림은 ggplot2다. 모듈은 실제로 쓰는 구성 패키지만 의존한다.
8. **멈추지 말고 알린다.** 백엔드가 없거나, 변수가 안 맞거나, 계산이 실패하면 분석 전체를 멈추지 않는다. 그 항목만 빼고 `rs_note()`로 이유와 해결 방법을 알린다. 사용자가 고른 것과 실제로 계산한 것이 다르면 반드시 알린다.
9. **재현할 수 있어야 한다.** 분석 탭, 콘솔, Quarto 문서가 같은 표와 그림을 낸다. "R 코드"로 나오는 코드 한 줄(`pkg::analyse(data, options)`)이 결과 전체를 다시 만든다. 원본 데이터는 바꾸지 않는다. 난수를 쓰면 seed를 옵션으로 받는다.
10. **AI 어시스턴트도 같은 옵션을 쓴다.** 어시스턴트는 `run_analysis`로 같은 옵션 스키마를 채운다. GUI에서 할 수 있는 것은 어시스턴트도 할 수 있어야 한다.
11. **사용자 세션을 건드리지 않는다.** 모듈은 백엔드를 `pkg::fn()`으로만 부르고 `library()`로 붙이지 않는다. 백엔드가 붙을 때(`.onAttach`) 세션 전체 설정을 바꾸거나 인터넷에 접속하면, 그 기능은 따로 띄운 R 프로세스에서 돌린다. 예: dlookr는 붙을 때 Google 폰트를 내려받고 `showtext_auto()`로 이후 모든 그림의 글꼴 처리를 바꾼다. 그래서 데이터 점검 모듈은 dlookr를 표 계산에만 쓰고, 그림은 ggplot2로 다시 그리고, 보고서는 별도 `Rscript`로 만든다.

## 2. 파일 구성

모듈 하나는 두 부분으로 이루어진다.

```
modules/<name>/                 앱이 읽는 선언
  manifest.json                 모듈 정보, R 패키지, 백엔드, 분석 목록
  options.schema.json           옵션의 JSON Schema (기본값 포함)
  form.json                     GUI 양식: 안내, 변수 역할, 옵션 묶음
  ai.md                         AI 어시스턴트용 사용 안내 (영어)
r-packages/<rsageName>/         R 패키지: 계산과 결과
  DESCRIPTION                   Imports(필수) / Suggests(백엔드)
  NAMESPACE                     export(analyse), export(defaults)
  R/analyse.R                   defaults()와 analyse()
  tests/testthat/test-analyse.R 기준값 테스트
```

공통 R 런타임은 `r-packages/rsage`다. 결과 객체(`rs_table`, `rs_plot`, `rs_note`, `rs_result`), 그림 크기(`rs_figure_size`), 실행(`rs_run`)을 제공한다. 모듈 패키지는 앱이 처음 실행할 때 사용자 R 라이브러리에 설치한다. 소스가 바뀌면 다시 설치한다.

### manifest.json

결측 모듈의 manifest를 복사해 고친다. 바꿀 곳은 다음과 같다.

| 필드 | 내용 |
| --- | --- |
| `id` | `org.rsage.<name>` |
| `version` | 모듈 버전. 옵션이나 결과가 바뀌면 올린다 |
| `title`, `description` | 분석 메뉴와 모듈 목록에 보이는 이름과 설명 (한국어) |
| `runtime.package`, `runtime.source` | R 패키지 이름과 `r-packages/` 아래 폴더 이름 |
| `runtime.backends` | 백엔드 패키지마다 `{ package, role, required }`. `role`은 사용자에게 보이는 한국어 설명 |
| `analyses[]` | 분석마다 `id`, `title`, `menu`(분석 메뉴 경로 `[분류, 명령]`), `entrypoint`(보통 `analyse`), `optionsSchema`, `ui`, `requiresDataset`, `assistant.summary`(영어 한 문단), `assistant.guide` |
| `analyses[].entries` | 선택. 한 분석을 메뉴의 여러 명령으로 보일 때 `[{ menu, title, preset }]`. `preset`은 그 명령으로 열 때 미리 정하는 옵션이다 (예: 회귀 › 로지스틱 회귀 = `model.family: "binomial"`). 없으면 `menu` 하나가 명령이 된다 |

분석 메뉴는 JASP처럼 분류(`menu`의 첫 칸) 아래에 명령을 모은다. 분류 순서는 데이터 준비 → 기술통계 → T 검정 → 분산분석 → 회귀 → 빈도 → 요인분석이고, 그 밖의 분류는 뒤에 붙는다. 데이터 점검과 결측 데이터는 "데이터 준비"에 있다. 같은 분석·데이터·옵션으로 다시 열면 새로 만들지 않고 이전 분석을 연다.

`optionsSchemaVersion`은 옵션의 의미가 바뀌면 올린다. 옵션을 **추가**만 하면 저장된 분석이 그대로 동작하므로, 기존 옵션 이름은 바꾸지 않는다.

## 3. 스펙 먼저 쓰기

코드를 쓰기 전에 아래 항목을 채운 스펙을 만든다. 스펙은 PR 설명이나 `docs/modules/<name>.md`에 둔다. AI 세션에게 모듈을 맡길 때도 이 스펙을 먼저 쓰게 한다.

1. **목적**: 이 분석이 답하는 질문 (한두 문장)
2. **백엔드 조사**: 후보 패키지와 [선정 기준](analysis-modules-catalog.md#선정-기준) 점검 결과
3. **대표 활용법 목록**: 백엔드 홈페이지·README·vignette의 예제를 하나씩 적는다. 출처 URL, 함수 이름, 무엇을 보여 주는지.
4. **활용법 → 옵션 → 결과 표**: 3의 각 항목이 어느 옵션(bind)으로 켜지고 어느 결과(id, 표인지 그림인지, section)로 나오는지. 빼는 항목은 이유와 함께.
5. **변수 역할**: 역할 이름, 하나인지 여럿인지, 받는 유형(`types`)
6. **옵션 목록**: bind, 유형, 기본값, 한 줄 설명, 백엔드 함수, 필요한 추가 패키지, 활성 조건
7. **결과 목록**: 결과 section 순서, 각 표와 그림의 id, 제목, 읽는 법(description)
8. **알림과 예외**: 백엔드가 없을 때, 변수가 부족할 때, 계산이 실패할 때의 동작과 note code
9. **검증 기준값**: 예제 데이터(R 내장 데이터 권장)로 계산한 기준값과 그 출처(JASP, 논문, 패키지 문서)

## 4. GUI 구조

분석 탭은 왼쪽에 옵션 창, 오른쪽에 결과가 있다. 옵션 창 너비는 사용자가 끌어서 바꿀 수 있다(기본 380px). 옵션 창은 위에서 아래로 다음 순서다. 앱이 공통으로 그리므로 모듈은 `form.json`만 쓴다.

```
┌ 분석 제목 · 모듈 이름 버전 ───────────────┐
│ 데이터  [ aq (153×6)              ▾ ]     │  ← 앱 공통: 데이터 선택과 자동 선택 이유
│ 자동 선택: report.qmd의 … 데이터           │
│ ▸ 이 분석으로 할 수 있는 것 (8)            │  ← form.about: 대표 활용법, 한 번에 켜기
│ ┌──────────┐      변수                    │
│ │ Ozone    │  ▶  ┌──────────┐            │  ← form.roles: 왼쪽 목록 → 오른쪽 역할 칸
│ │ Solar.R  │     │          │            │
│ │ Month    │      그룹 (Split)            │
│ │ …        │  ▶  ┌──────────┐            │
│ └──────────┘                              │
│ ▾ 요약 표                                  │  ← form.sections: 접는 옵션 묶음
│   ☑ 변수별 결측  naniar::miss_var_summary  │     옵션, 한 줄 설명, 함수 태그
│     변수마다 결측 개수와 비율…              │
│   ☑ 결측 패턴                              │
│     │ 보여 줄 패턴 수   [15]               │     하위 옵션 (상위가 꺼지면 흐림)
│ ▸ 결측 한눈에 보기                          │
│ ▸ 결측과 다른 변수의 관계                   │
└───────────────────────────────────────────┘
```

### 변수 전달 블록 (`roles`)

JASP·SPSS와 같다. 왼쪽에 데이터의 변수 목록, 오른쪽에 역할 칸이 있고, 칸마다 ▶ 버튼이 있다.

- 왼쪽에서 변수를 고르고(클릭, Shift·⌘ 클릭으로 여럿) ▶를 누르면 그 칸에 들어간다. 칸 안의 변수를 고르면 버튼이 ◀로 바뀌고, 누르면 목록으로 돌아간다.
- 두 번 클릭하면 받을 수 있는 첫 칸으로 들어가거나 목록으로 돌아간다. 끌어 놓기도 된다.
- 한 변수는 한 역할에만 있다. 칸에 넣은 변수는 목록에서 사라진다.
- 변수 아이콘은 유형을 보여 준다: 수치, 범주, 순서 범주, 문자, 논리, 날짜·시각. 변수가 8개를 넘으면 검색 칸이 생긴다.
- 역할은 `{ "type": "variables" | "variable", "bind", "label", "hint"?, "types"? }`다. `variables`는 여러 개, `variable`은 하나다. `types`를 주면 그 유형만 받는다(`numeric`, `factor`, `ordered`, `character`, `logical`, `date`; `numeric`은 정수·실수, `factor`는 순서 범주도 받는다).

### 대표 활용법 (`about`)

```json
"about": {
  "summary": "이 분석이 무엇을 하는지 두세 문장",
  "links": [{ "label": "naniar 홈페이지", "url": "https://naniar.njtierney.com/" }],
  "showcase": [
    {
      "title": "어떤 변수들이 함께 빠지는지 보기",
      "description": "한 줄 설명",
      "fn": ["naniar::gg_miss_upset"],
      "enable": { "plots.upset": true, "patterns": true },
      "needs": "X·Y 변수를 고르세요.",
      "needsFilled": ["relations.x", "relations.y"]
    }
  ]
}
```

- `showcase` 항목 하나가 3장의 대표 활용법 하나다. "켜기"를 누르면 `enable`의 옵션이 설정되고 그 옵션이 있는 묶음이 펼쳐진다.
- 아직 없는 기능은 `"planned": true`, `"enable": {}`로 넣는다. "켜기" 대신 "예정"으로 보여, 사용자가 다음에 무엇이 오는지 알되 실행할 수 있다고 오해하지 않는다.
- 사용자가 더 골라야 하는 것이 있으면 `needs`에 적고, 그 옵션들을 `needsFilled`에 넣는다. 비어 있는 동안 안내가 보인다.
- `links`에는 백엔드 홈페이지와 갤러리를 넣는다. 사용자가 원래 문서로 바로 갈 수 있게 한다.

### 옵션 묶음 (`sections`)

`{ "title", "description"?, "open"?, "controls": [...] }`. JASP의 Statistics, Plots, Tables처럼 결과의 종류별로 묶는다. 자주 쓰는 한두 묶음만 `open: true`로 펼쳐 둔다.

컨트롤 종류:

| type | 화면 | 주 용도 |
| --- | --- | --- |
| `checkbox` | 체크 상자. `controls`에 하위 옵션을 넣으면 들여 쓰고, 꺼져 있으면 흐리게 | 표나 그림 하나를 켜고 끄기 |
| `number` | 숫자 칸. 스키마의 `minimum`·`maximum`·`integer`를 따른다. `unit` | 개수, 크기, 반복 횟수 |
| `select` | 드롭다운. 스키마의 `enum`, 보이는 이름은 `labels`. `choicesBy: {bind, values}`면 다른 옵션 값마다 보기를 줄이고, 지금 값이 보기에 없으면 첫 보기로 바꾼다 | 방법 고르기, 모형 종류별 링크 |
| `column` | 데이터의 열을 고르는 작은 드롭다운. `types`로 거름. `from`(옵션 경로 목록)이면 그 옵션에 든 열만, `emptyLabel`은 "고르지 않음"의 이름 | 그림의 X·Y 같은 옵션 안의 변수, 설명변수 중 초점 변수 |
| `level` | `column` 옵션이 가리키는 열의 값(범주 수준) 중 하나. 값이 200개를 넘거나 읽지 못하면 글 칸 | 로지스틱의 사건 값, 기준 범주 |
| `models` | 모형 카드. 항을 칩으로 넣고 빼고, "+ 항"으로 주효과·상호작용(주효과도 함께)을 더하고, 모형을 복사·이름 바꾸기·지우기. `terms`(항 목록 옵션), `predictors`(항을 만들 설명변수 옵션들), `outcome`(공식 미리보기) | 회귀의 후보 모형 |
| `model` | `models` 옵션의 모형 하나를 id로. 비우면 `emptyLabel`(예: 마지막 모형) | 진단·효과 해석할 모형 |
| `termChoice` | `terms` 옵션의 항 여러 개를 칩으로 켜고 끄기 | 단계적 선택의 후보·강제 항 |
| `text` | 글 칸. 스키마의 `pattern`으로 검사 | 저장할 객체 이름 |
| `list` | 쉼표로 구분한 값 목록 | 결측 코드 |
| `rows` | 한 줄에 규칙 하나. `fields`의 열마다 변수 선택(`column`), 글 칸(`text`), 드롭다운(`select`), 값 선택(`level`, `column`에 같은 줄의 열 필드 key)이 있고 ✕로 지우고 "+ 추가"로 늘린다 | 허용 범위(나이 0~120), 선후 관계(주문일 ≤ 배송일), 동의어 |
| `group` | 소제목 아래 컨트롤 모음 (bind 없음) | JASP의 "Central tendency" 같은 묶음 |

모든 컨트롤(group 제외)에 공통으로 쓰는 필드:

| 필드 | 쓰임 |
| --- | --- |
| `bind` | 옵션 경로 (`plots.upset`처럼 점으로 구분) |
| `label` | 짧은 이름 |
| `description` | 이 옵션으로 무엇을 얻는지 한 줄. 표·그림을 켜는 옵션에는 꼭 쓴다 |
| `fn` | 백엔드 함수 (`naniar::gg_miss_upset`). 태그로 보인다 |
| `requires` | 필수가 아닌 추가 패키지 (`["UpSetR"]`). 태그로 보인다 |
| `enabledWhen` | `{ "bind", "equals" }`, `{ "bind", "in": [...] }` 또는 `{ "bind", "filled": true }`. 안 맞으면 흐리게 |
| `disabledHint` | 흐릴 때 무엇을 하면 켜지는지 |
| `visibleWhen` | 안 맞으면 숨김. 정말 무관할 때만 쓴다 (원칙 4) |
| `hint` | 입력 방법 안내 |

`rows`의 옵션은 객체 배열이다. 스키마는 `{"type": "array", "items": {"type": "object", "properties": {...}}, "default": []}`이고, `fields[].key`가 `items.properties`의 키와 같아야 한다. `select` 필드의 보기는 그 속성의 `enum`에서 오고 `labels`로 이름을 바꾼다. `column` 필드에서 "고르지 않음"이 뜻을 가질 때(예: 모든 텍스트 변수)는 `emptyLabel`에 적는다. `column` 필드가 가리키는 열도 실행 기록(`columns`)에 들어간다.

```json
{ "type": "rows", "bind": "values.ranges", "label": "허용 범위", "addLabel": "범위 추가",
  "fields": [{ "key": "variable", "label": "변수", "type": "column", "types": ["numeric", "date"] },
             { "key": "min", "label": "최소", "type": "text", "placeholder": "0" },
             { "key": "max", "label": "최대", "type": "text", "placeholder": "120" }] }
```

`bun test packages/host/test/analysis.test.ts`의 `formProblems()` 검사가 form의 모든 bind, 조건, showcase 옵션이 스키마에 있는지 확인한다. 앱도 모듈을 읽을 때 같은 검사를 하고 문제를 경고로 남긴다.

### 데이터 선택

데이터 선택과 자동 선택(커서가 있는 청크의 데이터 → 위쪽 청크 → 가장 최근에 바뀐 데이터)은 앱이 한다. 모듈은 관여하지 않는다. 규칙은 [전략 문서의 "데이터와 변수 선택 규칙"](analysis-modules-strategy.md#데이터와-변수-선택-규칙-모든-모듈)에 있다.

## 5. 옵션 스키마 (`options.schema.json`)

- JSON Schema 2020-12. 최상위와 모든 객체에 `"additionalProperties": false`.
- 모든 속성에 `default`와 영어 `description`을 쓴다. AI 어시스턴트가 이 설명을 읽는다. 백엔드 함수 이름도 넣는다.
- 변수 하나를 받는 옵션은 `{"type": ["string", "null"], "default": null}`, 여럿은 `{"type": "array", "items": {"type": "string"}, "default": []}`.
- 옵션 묶음은 중첩 객체로 표현한다(`plots.upset`, `impute.m`). 묶음 객체에는 `"default": {}`.
- R의 `defaults()`와 스키마 기본값은 같아야 한다.

## 6. R 패키지

### analyse()

```r
defaults <- function() list(variables = character(), group = NULL, plots = list(upset = FALSE), ...)

SECTIONS <- c("개요", "변수와 행", ...)

analyse <- function(data, options = list()) {
  stopifnot(is.data.frame(data))
  o <- rsage::rs_merge_options(options, defaults())   # 빠진 옵션은 기본값
  # 1. 변수 확인: 없는 변수는 stop()으로 알린다 (이건 사용자가 고칠 오류)
  # 2. 데이터 준비 (tidyverse). 원본은 바꾸지 않는다
  # 3. 켜진 옵션마다 표·그림·알림을 만든다. 실패하면 그 항목만 rs_note()
  # 4. rsage::rs_result(..., sections = SECTIONS)
}
```

- 시그니처는 `analyse(data, options)`다. 전역 변수에 기대지 않는다.
- 백엔드 사용 가능 여부는 `requireNamespace(pkg, quietly = TRUE)`로 확인하고, 없으면 대안으로 계산하거나 알린다. 백엔드는 DESCRIPTION의 `Suggests`, 늘 필요한 것만 `Imports`.
- 표·그림·알림을 하나씩 모으는 작은 `add()` 도우미를 두면 "켜진 옵션 → 항목" 흐름이 한눈에 보인다(결측 모듈 참고).
- 사용자 세션에 객체를 남기는 옵션(예: 대체 결과 저장)은 `exports`로 돌려준다. 앱이 저장한다. 이런 옵션은 `{ "enabled": true, "saveAs": "이름" }` 모양의 묶음으로 만든다. 파일을 쓰는 옵션은 `{ "enabled": true, "file": "경로" }`다. AI가 이 모양의 옵션을 켜고 실행하면 앱이 사용자 승인을 받는다(`leavesOutput()`).
- 점검형 모듈(데이터 점검처럼 여러 검사를 하는 모듈)은 검사마다 "발견"(분류, 항목, 건수, 해당 변수, 해결 방법)을 모아 맨 앞에 요약 표를 둔다. 사용자는 요약 표에서 "확인 필요"만 보고 아래 자세한 표로 내려간다.

### 결과 객체

| 함수 | 쓰임 | 주요 인자 |
| --- | --- | --- |
| `rs_table(id, title, data, labels, notes, description, section)` | 표 | `data`는 반올림하지 않은 data.frame. `labels`는 열 id → 보이는 이름 |
| `rs_plot(id, title, plot, size, alt, description, section)` | 그림 | `plot`은 ggplot 또는 그리는 함수. `size`는 `rs_figure_size()`, `alt`는 대체 텍스트 |
| `rs_note(text, level, code, file)` | 알림 | `level`은 `"info"` 또는 `"warning"`. `code`는 고정된 영어 식별자. 파일을 만들었으면 `file`에 절대 경로를 주면 앱이 "열기" 버튼을 단다 (HTML·PDF는 미리보기 창) |
| `rs_result(analysis, title, tables, plots, notes, options, data_info, packages, exports, sections)` | 결과 전체 | `packages`는 버전을 기록할 백엔드 |

`id`는 바뀌지 않는 영어 식별자다. 보고서의 인라인 R(`rsage::rs_value(res, "mcar", 1, "p.value")`)과 사용자가 정한 그림 크기가 id에 묶인다.

### 표와 그림 나누기

| 결과 | 표로 | 그림으로 |
| --- | --- | --- |
| 개수, 비율, 통계량, p값, 신뢰구간 | 반드시 | 보조로만 |
| 분포, 패턴, 관계, 시간에 따른 변화 | 요약값만 | 반드시 |
| 모형 진단 (수렴, 잔차) | 판정 기준이 있으면 | 반드시 |

- 표의 숫자는 반올림하지 않고 넘긴다. 앱과 Quarto 출력이 자리수를 정한다.
- 비율 열은 이름에 단위를 쓴다(`결측 비율(%)`).
- 그림 크기는 직접 정하지 않고 내용으로 정한다: `rsage::rs_figure_size(panels, x_items, y_items, label_chars, aspect, legend)`. 상한을 넘으면 `compact = TRUE`가 오므로 더 조밀한 그림(예: 소형 다중 그림 대신 색 지도)으로 바꾼다. [그림 크기 규칙](analysis-modules-strategy.md#그림-크기-규칙-모든-모듈) 참고.
- 그림의 범례와 축 이름은 한국어로 바꾼다(백엔드 그림이 영어 범례를 쓰면 `scale_*_manual(labels = ...)`).
- `theme_minimal()`을 기본으로 쓴다.

### 결과 section과 읽는 법

- 결과 탭은 `sections` 순서대로 소제목을 달고, 각 section 안에서 표 다음 그림을 보여 준다. 옵션 묶음과 비슷한 순서로 둔다.
- `description`은 "무엇을 보면 되는지"와 "어떤 모양이면 무엇을 뜻하는지"를 쓴다. 예: "선들이 서로 뒤섞이고 뚜렷한 추세가 없으면 수렴한 것입니다. 한쪽으로 계속 오르거나 내리면 반복 횟수를 늘립니다."
- 표의 `notes`는 계산 방식에 관한 각주(정렬 기준, 뺀 변수)에 쓴다.

## 7. AI 안내 (`ai.md`)

영어로 쓴다. 언제 이 분석을 쓰는지, 옵션마다 언제 켜는지, 결과를 보고할 때 무엇을 인용하는지, 하지 말아야 할 해석(예: p값이 크다고 MCAR이라고 하지 않기)을 적는다. 어시스턴트는 `describe_analysis`로 스키마와 이 안내를 함께 받는다. 결과를 받을 때는 표·그림의 `description`도 함께 받는다.

## 8. 검증

1. **R 테스트** (`r-packages/<pkg>/tests/testthat`): 내장 데이터의 기준값을 확인한다. 옵션마다 결과가 나오는지, 백엔드가 없을 때 대안과 알림이 나오는지(`local_mocked_bindings(has = ...)`), 변수가 부족할 때 멈추지 않고 알림이 나오는지.
   ```sh
   L=$(mktemp -d); R CMD INSTALL -l $L r-packages/rsage; R CMD INSTALL -l $L r-packages/<pkg>
   cd r-packages/<pkg> && R_LIBS=$L Rscript -e 'testthat::test_local(".")'
   ```
2. **앱 테스트**: `bun test packages/host/test/analysis.test.ts`. form 검사, 옵션 검증, 실제 R 세션에서의 실행, AI 도구 실행을 확인한다. 클라우드 컨테이너에서는 `RSAGE_TEST_IRKERNEL=1`로 IRkernel이 Ark를 대신한다.
3. **화면 확인**: 개발 서버(`bun packages/host/src/dev-server.ts`)를 띄우고 브라우저에서 분석을 열어, 옵션을 켜고 끄며 결과와 그림 크기를 본다. 실제 Mac 창은 Mac 세션이 확인한다.

## 9. 실제 예: 결측 데이터 모듈

파일: [`modules/missing`](../modules/missing), [`r-packages/rsageMissing`](../r-packages/rsageMissing).

### 대표 활용법 → 옵션 → 결과

naniar 홈페이지(https://naniar.njtierney.com/)와 그림 vignette, mice 문서에서 뽑았다.

| 대표 활용법 | 백엔드 | 옵션 | 결과 (section) |
| --- | --- | --- | --- |
| 결측 위치 지도 | `naniar::vis_miss` | `plots.matrix`, `plots.cluster` | 그림 `matrix` (개요) |
| 변수별 결측 수·비율 | `naniar::gg_miss_var`, `miss_var_summary` | `plots.variables`, `variableSummary` | 그림 `variables` (개요), 표 `variables` (변수와 행) |
| 행별 결측 | `naniar::gg_miss_case`, `miss_case_table` | `plots.cases`, `caseSummary` | 그림·표 `cases` (변수와 행) |
| 그룹별 결측 | `naniar::gg_miss_fct`, `gg_miss_var(facet =)` | `plots.byGroup` (그룹이 있을 때) | 그림 `byGroup` (변수와 행) |
| 시계열 결측 구간 | `naniar::gg_miss_span` | `plots.span`, `spanVariable`, `spanSize` | 그림 `span` (변수와 행) |
| 결측 조합 | `naniar::gg_miss_upset` (UpSetR) | `plots.upset`, `upsetSets`, `patterns` | 그림 `upset`, 표 `patterns` (결측 조합) |
| MCAR 검정 | `naniar::mcar_test` | `mcarTest` | 표 `mcar` (결측 조합) |
| 결측 산점도 | `naniar::geom_miss_point` | `relations.scatter`, `x`, `y` | 그림 `scatter` (관계) |
| 그림자 행렬 비교 | `naniar::bind_shadow` | `relations.shadowDensity`, `variable`, `by` | 그림·표 `shadow` (관계) |
| 다중대체와 진단 | `mice::mice`, `chainMean`, `complete` | `impute.*` | 표 `imputation`, 그림 `convergence`, `imputation` (대체) |
| 대체값 함께 보기 | `naniar::impute_below`, 평균·중앙값, mice | `imputePreview.*` | 그림 `preview` (대체) |

뺀 것: `naniar::replace_with_na`(결측 코드 바꾸기)는 `naValues` 옵션 하나로 줄였다. `simputation` 기반 대체 예제는 패키지가 더 필요해서, 대체는 mice 한 가지로 했다.

### 결과 section

`개요` → `변수와 행` → `결측 조합` → `결측과 다른 변수의 관계` → `대체`. 사용자가 결측을 처음 볼 때의 순서(얼마나 → 어디에 → 어떤 조합으로 → 왜 → 어떻게 채울까)를 따른다.

### 예외 처리 예

- naniar가 없으면 표와 기본 그림은 직접 계산하고, naniar 전용 그림은 `*_needs_naniar` 알림으로 대신한다.
- 산점도에서 X·Y를 안 고르면 `scatter_needs_variables` 알림을 낸다. 분석은 멈추지 않는다.
- mice 대체값 보기를 골랐는데 다중대체가 꺼져 있으면 `preview_needs_mice` 알림을 낸다.

## 10. 실제 예: 데이터 점검 모듈

파일: [`modules/integrity`](../modules/integrity), [`r-packages/rsageIntegrity`](../r-packages/rsageIntegrity), 스펙 [`docs/modules/integrity.md`](modules/integrity.md).

스프레드시트로 받은 데이터를 분석 전에 점검한다. 백엔드는 dlookr(필수)다. dlookr의 대표 활용법은 진단 함수와 보고서이고, 사용자가 받은 점검 목록(구조, 형식, 값의 범위, 논리, 결측과 중복, 텍스트)의 절반은 dlookr에 없어서 모듈이 직접 계산한다(원칙 7: base R과 ggplot2).

결측 모듈과 다른 점:

- **규칙을 사용자가 정한다.** 허용 범위, 허용 값, 선후 관계, 동의어는 데이터만으로 알 수 없다. `rows` 컨트롤로 한 줄씩 추가한다. 규칙이 없으면 요약 표에 "규칙 없음"으로 남겨, 그런 점검이 있다는 것을 알린다(원칙 1, 4).
- **요약 표가 먼저 나온다.** 검사가 20개 가까이 되므로 "확인 필요"인 것만 먼저 보이게 한다. 각 줄에 해결 방법을 적는다.
- **고친 사본을 만든다.** "정리한 데이터 만들기"는 찾은 문제를 고친 사본을 `exports`로 돌려주고, 단계마다 몇 개를 바꿨는지 표로 남긴다. 원본은 바꾸지 않는다(원칙 9).
- **백엔드의 부작용을 피한다.** 원칙 11 참고. dlookr 그림 함수 대신 같은 내용을 ggplot2로 그린다(`plot_outlier` → 이상치 그림, `plot_na_pareto` → 결측 파레토 그림).

## 11. 점검표

- [ ] 스펙의 대표 활용법이 모두 showcase 또는 옵션에 있다 (빠진 것은 이유가 있다)
- [ ] 표·그림을 켜는 옵션마다 `description`과 `fn`이 있다
- [ ] 조건부 옵션은 숨기지 않고 `enabledWhen`과 `disabledHint`로 흐리게 한다
- [ ] 스키마의 모든 속성에 기본값과 영어 설명이 있고, `defaults()`와 같다
- [ ] 모든 표와 그림에 `section`과 `description`이 있다
- [ ] 보고서에 쓸 숫자는 모두 표에 있다
- [ ] 그림 크기는 `rs_figure_size()`로 정했고, 범례·축은 한국어다
- [ ] 백엔드가 없거나 변수가 부족할 때 알림이 나오고 분석은 계속된다
- [ ] `formProblems()`가 빈 목록이다
- [ ] R 테스트에 기준값이 있다
- [ ] `ai.md`가 새 옵션을 설명한다
- [ ] 백엔드를 `library()`로 붙이지 않고, 세션 전역 상태를 바꾸는 기능은 별도 프로세스에서 돌린다
- [ ] 세션에 객체를 남기거나 파일을 쓰는 옵션은 `enabled` + `saveAs`/`file` 모양이다
