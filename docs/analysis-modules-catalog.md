# R Sage 분석 모듈 목록과 R 패키지 선정

_2026-10-17 · [analysis-modules-strategy.md](analysis-modules-strategy.md)의 모듈 구조를 따르는 모듈 목록_

R Sage의 분석 기능은 16개 모듈로 나눈다. 각 모듈은 계산을 맡길 R 패키지(백엔드)를 하나 이상 고른다. 백엔드는 모듈을 설계할 때 아래 기준으로 확정하고, 그 전까지는 이 문서의 후보를 출발점으로 쓴다. 지금 확정된 것은 Descriptives와 결측 데이터다. 결측 데이터 모듈은 시범 구현되어 있다(`modules/missing`, `r-packages/rsageMissing`).

## 원칙: GUI는 통계 개념, 패키지는 백엔드

모듈의 폼과 옵션 스키마는 통계 개념으로 정의한다. 예를 들면 변수 역할(종속·독립·그룹), 결측 처리, 검정 종류, 사후 검정 방법이다. 특정 패키지의 함수 인자를 그대로 옮기지 않는다.

모듈 R 패키지의 `analyse(data, options, context)`가 이 옵션을 백엔드 함수 호출로 번역한다. 그래서 백엔드 패키지가 관리 중단되거나 API가 바뀌어도 GUI, 저장된 분석, AI 어시스턴트 도구는 바뀌지 않는다. 백엔드 교체는 모듈 R 패키지의 새 버전으로 처리하고, 결과 수치가 달라지면 `resultSchemaVersion`이나 결과 주석으로 알린다.

백엔드 패키지의 함수 구조는 폼 설계의 **참고 자료**로 쓴다. 그 패키지가 어떤 선택지를 제공하는지 보면, 사용자에게 보여 줄 옵션의 범위와 기본값을 정하기 쉽다.

## 선정 기준

| 기준 | 확인 방법 |
| --- | --- |
| 유지보수 | CRAN에 있고 최근 1~2년 안에 릴리스가 있음. 열린 이슈에 응답이 있음 |
| 입출력 | data.frame·tibble을 받고, 결과 객체를 easystats(`parameters::model_parameters()` 등)가 정리할 수 있음 |
| 설치 부담 | macOS arm64 CRAN 바이너리가 있음. 컴파일러나 시스템 라이브러리가 필요 없음. 의존성 수가 적음 |
| 라이선스 | GPL·LGPL·MIT·BSD 계열. 상용 제한 라이선스는 제외 |
| 분야 표준 | 해당 분야 논문에서 널리 인용됨. JASP·jamovi가 같은 기능에 쓰는 패키지를 우선 검토 |
| 수치 검증 | 문서화된 예제나 다른 구현(SPSS·JASP·base R)과 결과를 비교할 수 있음 |

후보가 여럿이면 설치 부담이 작은 쪽을 먼저 고르고, 고급 옵션은 후속 버전에서 다른 패키지로 확장한다.

## 공통 중간 단계: tidyverse와 easystats

모든 모듈은 백엔드 앞뒤에 같은 중간 단계를 둔다. 데이터 준비는 tidyverse, 결과 정리는 easystats, 그림은 ggplot2다. 자세한 단계 구분은 [전략 문서](analysis-modules-strategy.md#공통-중간-단계-tidyverse와-easystats)에 있다.

- 입력 정리: `dplyr`, `tidyr`, `tibble`
- 결과 정리: `parameters`(계수·신뢰구간·p값), `effectsize`(효과크기와 해석 기준), `performance`(적합도·가정 진단), `datawizard`(기술통계·변환), `insight`(모델 정보)
- 그림: `ggplot2`

그래서 아래 표의 "백엔드 후보"는 이 중간 단계 위에 더하는 계산 패키지만 적는다. 백엔드 후보는 easystats가 지원하는 모델 객체를 돌려주는 패키지를 우선한다. 지원하지 않으면 그 모듈이 `parameters` 형식에 맞는 정리 함수를 직접 제공한다. 모듈 R 패키지는 `tidyverse`·`easystats` 메타 패키지가 아니라 실제로 쓰는 구성 패키지만 `Imports`에 적는다.

## 모듈 목록

상태는 **확정**(백엔드 결정), **후보**(이 문서의 제안, 모듈 설계 때 확정), **후속**(첫 릴리스 범위 밖)이다. 순서는 구현 우선순위다.

| 순서 | 모듈 ID | 포함 분석 | 백엔드 후보 | 상태 |
| --- | --- | --- | --- | --- |
| 1 | `org.rsage.descriptives` | 기술통계, 빈도표, 기본 그래프 | stats (공통 중간 단계만으로 충분) | 확정 |
| 2 | `org.rsage.ttests` | 독립·대응·단일표본 t 검정, Mann–Whitney, Wilcoxon | stats | 후보 |
| 3 | `org.rsage.regression` | 상관, 선형·로지스틱 회귀 | stats, car(VIF) | 후보 |
| 4 | `org.rsage.anova` | 일원·이원·반복측정 분산분석, Kruskal–Wallis, Friedman, 사후검정 | stats, afex, emmeans, car | 후보 |
| 5 | `org.rsage.frequencies` | 교차표, 카이제곱, Fisher 정확검정 | stats | 후보 |
| 6 | `org.rsage.missing` | 결측 패턴 요약·시각화, MCAR 검정, 다중대체 | naniar(탐색·MCAR), mice(대체), UpSetR(조합 그림) | 확정 (시범 구현) |
| 7 | `org.rsage.reliability` | Cronbach's α, McDonald's ω, 문항 분석 | psych | 후보 |
| 8 | `org.rsage.factor` | EFA, PCA, CFA | psych, GPArotation, lavaan(CFA) | 후보 |
| 9 | `org.rsage.mixed` | 선형 혼합모형, 일반화 혼합모형 | lme4, lmerTest, emmeans | 후보 |
| 10 | `org.rsage.sem` | 경로분석, 구조방정식 | lavaan | 후보 |
| 11 | `org.rsage.network` | 심리측정 네트워크 추정, 중심성, 안정성 | bootnet, qgraph | 후보 |
| 12 | `org.rsage.survival` | Kaplan–Meier, 로그순위 검정, Cox 회귀 | survival | 후보 |
| 13 | `org.rsage.meta` | 고정·무선효과 메타분석, 숲 그림, 출판 편향 | metafor | 후보 |
| 14 | `org.rsage.power` | t 검정·ANOVA·상관·회귀의 표본 크기와 검정력 | pwr | 후보 |
| 15 | `org.rsage.cluster` | k-means, 계층적 군집, 실루엣 | stats, cluster | 후보 |
| 16 | `org.rsage.timeseries` | ARIMA, 분해, 예측 | stats, forecast 또는 fable | 후속 |

머신러닝(tidymodels 계열)과 텍스트 마이닝(tidytext, topicmodels)은 의존성이 크고 GUI 형태가 달라서 첫 릴리스 범위에서 뺀다. EDA의 이상치 검출은 Descriptives의 후속 분석으로 둔다.

2번과 3번 중 하나가 두 번째 모듈이 된다. 둘 다 Descriptives와 입력·결과 요구가 달라서, 모듈 규격이 범용적인지 검증하는 데 맞다.

## 백엔드 확정 절차

모듈 설계를 시작할 때 다음을 한다.

1. 후보 패키지를 위 선정 기준으로 점검하고, 현재 CRAN 버전과 macOS 바이너리 여부를 기록한다.
2. 주요 함수의 인자와 반환값을 보고 폼 옵션의 범위와 기본값을 정한다. 옵션 이름은 통계 개념으로 붙인다.
3. 같은 예제 데이터로 JASP나 다른 구현과 결과를 비교해 수치 검증 기준값을 만든다.
4. 확정한 백엔드와 최소 버전을 모듈 R 패키지의 `DESCRIPTION`에 적고, 이 표의 상태를 **확정**으로 바꾼다.
