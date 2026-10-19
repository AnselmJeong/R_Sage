# 데이터 점검 모듈 스펙 (`org.rsage.integrity`)

_2026-10-19 · [모듈 작성 가이드](../module-authoring-guide.md) 3장의 스펙 형식을 따른다_

## 1. 목적

스프레드시트로 받은 데이터를 분석하거나 DB에 올리기 전에, 무결성과 정제 상태를 점검한다. "이 데이터를 그대로 믿고 분석해도 되는가, 무엇을 먼저 고쳐야 하는가"에 답한다.

## 2. 백엔드

- **dlookr** (필수, CRAN 0.6.x). Anselm이 기본 패키지로 정했다. 변수 진단, 수치·범주·이상치 진단, 진단 보고서를 쓴다.
- 선정 기준 점검:
  - CRAN에 있고 macOS 바이너리가 있다.
  - 의존성이 많다(재귀 130개 안팎: shiny, pagedown, kableExtra, partykit, mice, hrbrthemes, showtext 등). 처음 설치에 시간이 걸린다.
  - `library(dlookr)` 하면 `.onAttach`가 Google 폰트를 내려받고 `showtext::showtext_auto()`를 켠다. 이후 그 세션의 모든 그림 글꼴 처리가 바뀐다.
  - 붙이지 않고 부르면 그림 함수가 `options("dlookr_offline")`이 없어 오류를 낸다.
- 대응: 모듈은 dlookr를 `dlookr::`로 표 계산에만 쓴다. 그림은 ggplot2로 다시 그린다. 보고서는 별도 `Rscript` 프로세스에서 만든다. 세션에 dlookr가 붙지 않는 것을 테스트로 확인한다.
- 나머지 점검(변수명, 형식, 규칙, 결측 코드, 중복, 텍스트)은 dlookr에 없어서 base R로 계산한다. 그림은 ggplot2, 표기 정규화에는 stringi(있으면)를 쓴다.

## 3. 대표 활용법 (dlookr)

출처: https://choonghyunryu.github.io/dlookr/, 진단 vignette(`vignette("diagonosis", "dlookr")`)

| 활용법 | 함수 | 옵션 | 결과 (section) |
| --- | --- | --- | --- |
| 데이터 개요 | `overview` | `overview` | 표 `overview` (요약) |
| 변수 진단 | `diagnose` | `diagnose` | 표 `diagnose` (요약) |
| 수치 변수 진단 | `diagnose_numeric` | `values.numeric` | 표 `numeric` (값의 범위와 규칙) |
| 이상치 진단 | `diagnose_outlier` | `values.outliers` | 표 `outliers` (값의 범위와 규칙) |
| 이상치 그림 | `plot_outlier` → ggplot2로 다시 그림 | `values.outlierPlot`, `values.outlierRows` | 그림 `outliers`, 표 `outlierRows` |
| 범주 변수 진단 | `diagnose_category` | `text.categories`, `text.topLevels` | 표 `categories` (텍스트) |
| 결측 파레토 그림 | `plot_na_pareto` → ggplot2로 다시 그림, 같은 결측 등급 | `missing.pareto` | 그림 `missingPareto` (결측과 중복) |
| 진단 보고서 | `diagnose_web_report`, `diagnose_paged_report` | `report.enabled`, `report.format`, `report.file` | HTML 파일, 알림 `report_saved` |

뺀 것:

- `plot_na_hclust`, `plot_na_intersect`: 결측 조합 그림은 결측 데이터 모듈이 맡는다.
- DBMS 테이블 진단: R Sage의 분석은 세션의 데이터 프레임을 받는다.
- `imputate_na`, `imputate_outlier`, `transform`, `binning`: 변환 단계라 이 모듈의 범위 밖이다. 정제는 "정리한 데이터 만들기"가 점검 결과에 맞춰 한다.

## 4. 점검 목록 → 옵션 → 결과

Anselm이 준 점검 목록(2026-10-19)을 그대로 옮겼다.

| 분류 | 점검 항목 | 옵션 | 결과 |
| --- | --- | --- | --- |
| 구조 | 변수명 중복·앞뒤 공백, 대소문자·공백만 다른 이름, 읽을 때 바뀐 중복 이름(`x...2`, `x.1`), 빈 머리글에 붙은 자동 이름 | `structure.names` | 표 `names` |
| 구조 | 특수문자·깨진 글자(인코딩), 숫자로 시작, 표기 방식(snake_case·camelCase) 불일치 | `structure.names`, `structure.nameStyle` | 표 `names` |
| 구조 | 완전히 빈 행 | `structure.emptyRows` | 표 `emptyRows` |
| 구조 | 빈 열, 값이 하나뿐인 열 | `structure.emptyColumns`, `structure.constant` | 표 `emptyColumns` |
| 형식 | 숫자 열에 섞인 글자('1,000원', 'N/A', '공란', 'O') | `format.numberText` | 표 `numberText` |
| 형식 | 날짜 형식 혼용, 없는 날짜, 월/일 순서 섞임, 1900년 이전·먼 미래, 엑셀 날짜 일련번호 | `format.dates` | 표 `dates` |
| 형식 | 앞자리 0 누락(사번, 고객ID, 우편번호) | `format.leadingZeros`, 키 변수 | 표 `leadingZeros` |
| 값의 범위 | 극단적인 이상치(IQR) | `values.outliers`, `outlierPlot`, `outlierRows` | 표 `outliers`, 그림 `outliers`, 표 `outlierRows` |
| 값의 범위 | 허용 범위(나이 0~120) | `values.ranges` (규칙) | 표 `rules` |
| 값의 범위 | 허용 값(성별 남·여, 동의 Y·N) | `values.allowed` (규칙), `values.rareLevels` | 표 `rules`, 표 `rareLevels` |
| 논리 | 선후 관계 모순(주문일 > 배송일, 시작일 > 종료일) | `values.order` (규칙) | 표 `rules` |
| 결측과 중복 | 결측치(NA), 결측 등급 | `missing.summary`, `missing.pareto` | 요약, 그림 `missingPareto` |
| 결측과 중복 | 결측을 뜻하는 값(빈 문자열, N/A, -99) | `missing.hidden`, `missing.codes` | 표 `hiddenMissing` |
| 결측과 중복 | 필수값 누락 | 필수 변수 | 표 `required` |
| 결측과 중복 | 중복 행, 키 중복과 빈 키 | `duplicates.rows`, `duplicates.keys`, 키 변수 | 표 `duplicateRows`, `duplicateKeys`, 알림 `key_missing` |
| 텍스트 | 공백 오류(앞뒤, 겹친, 보이지 않는 공백) | `text.whitespace` | 표 `whitespace` |
| 텍스트 | 대소문자·공백만 다른 값 | `text.variants` | 표 `variants` |
| 텍스트 | 오타(철자가 비슷한 값) | `text.similar`, `text.maxDistance` | 표 `similar` |
| 텍스트 | 동의어 불일치(한국, 대한민국, KOREA, 남한) | `text.synonyms` (규칙) | 표 `synonyms` |

모든 점검은 요약 표 `summary`에 한 줄씩 들어간다. 열은 결과(확인 필요, 문제 없음, 규칙 없음), 분류, 점검 항목, 건수, 해당 변수, 해결 방법이다.

"나이와 출생년도 불일치"처럼 계산이 필요한 규칙은 아직 GUI로 정할 수 없다. R 코드로 확인한다. 임의의 R 식을 규칙으로 받으면 어시스턴트가 승인 없이 코드를 실행하는 통로가 되어서 넣지 않았다.

## 5. 변수 역할

| 역할 | bind | 종류 | 받는 유형 |
| --- | --- | --- | --- |
| 점검할 변수 | `variables` | 여럿 (비우면 모두) | 모두 |
| 키 변수 | `keys` | 여럿 (조합이 키) | 모두 |
| 필수 변수 | `required` | 여럿 | 모두 |

## 6. 정리한 데이터 만들기

`clean.enabled`를 켜면 고친 사본을 `clean.saveAs`(기본 `data_clean`)로 세션에 저장하고, 표 `cleaning`에 단계별로 바꾼 값의 수를 남긴다. 단계는 순서대로 다음과 같다.

1. 공백 정리
2. 결측 코드를 NA로
3. 동의어 통일
4. 표기 통일
5. 숫자로 바꾸기
6. 날짜로 바꾸기
7. 앞자리 0 채우기
8. 규칙 위반 값을 NA로 (기본 꺼짐)
9. 빈 행 지우기
10. 중복 행 지우기 (기본 꺼짐)
11. 빈 열 지우기 (기본 꺼짐)
12. 변수명 정리

원본 데이터는 바꾸지 않는다.

## 7. 알림

| code | 언제 |
| --- | --- |
| `rules_none` | 규칙을 하나도 정하지 않았을 때 (안내) |
| `rules_unreadable` | 규칙의 값이나 두 열의 형식이 맞지 않아 확인하지 못했을 때 |
| `key_missing` | 키가 빈 행이 있을 때 |
| `cleaned_saved` | 정리한 데이터를 저장했을 때 |
| `report_saved`, `report_failed`, `report_needs_pandoc`, `report_needs_rmarkdown` | 진단 보고서 |

## 8. 검증

`r-packages/rsageIntegrity/tests/testthat/test-analyse.R`는 문제를 하나씩 심은 10행짜리 표로 각 점검의 건수와 행 번호를 확인한다. 이상치 개수는 dlookr와 `boxplot.stats()`가 같은 값을 내는지로 확인한다. 정리한 사본의 형식과 값, 원본이 그대로인지, 보고서가 세션에 dlookr를 붙이지 않는지도 확인한다.

앱 테스트(`packages/host/test/analysis.test.ts`)는 실제 R 세션에서 실행해 요약 표, 규칙, 키 중복, 저장된 사본을 확인한다.
