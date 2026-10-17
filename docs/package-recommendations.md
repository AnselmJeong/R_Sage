# 통계 모듈별 R 패키지 추천 (외부 의견)

> 다른 AI가 2026-10-17에 Anselm에게 준 추천을 받은 그대로 저장했다. 이 문서는 확정된 결정이 아니다. 각 모듈을 설계할 때 [analysis-modules-catalog.md](analysis-modules-catalog.md)의 선정 기준과 함께 참고한다. 패키지 이름, 링크, 출처, "최신" 같은 주장은 검증하지 않았다.

---

구현하고자 하시는 통계 모듈 구조에 맞추어, R 생태계에서 표준(디팩토)으로 자리 잡았으면서도 최신 튜닝과 유지가 가장 활발한 핵심 R 패키지들을 매칭하여 문서를 보완했습니다.
통계 모듈을 자바스크립트나 웹 프레임워크 기반의 앱(예: Node.js, Electron, Positron 등)으로 확장하거나 내부 엔진을 API화하기 좋은 현대적인 패키지(Tidymodels 구조 및 C++ 백엔드 중심)로 엄선했습니다.

## 1. 기술 및 탐색적 분석 (Descriptives & Exploratory)

* Descriptives & Frequencies
   * 추천 패키지: [easystats (특별히 ](https://github.com/easystats/easystats)`report`[ 및 ](https://github.com/easystats/easystats)`parameters`[)](https://github.com/easystats/easystats) / [vtable](https://cran.r-project.org/package=vtable)
   * 선정 이유: 기존 `base` 기능이나 `Hmisc`보다 출력 양식이 매우 현대적입니다. 특히 `easystats` 패키지군은 분석 결과를 휴먼 리더블한 줄글 문장이나 깔끔한 HTML/Markdown 테이블로 즉시 반환해 주므로 모듈화 및 화면 표시(HTML 렌더링)에 큰 강점이 있습니다.
* EDA & Visualization
   * 추천 패키지: [DataExplorer](https://cran.r-project.org/package=DataExplorer) / [naniar](https://cran.r-project.org/package=naniar)
   * 선정 이유: 데이터셋을 넣으면 결측치 분포, 데이터 타입별 빈도, 변수 간 상관관계를 한눈에 보여주는 HTML 리포트를 원클릭으로 자동 생성해 줍니다. 결측 데이터 시각화에는 `naniar`가 표준입니다.

## 2. 집단 비교 및 가설 검정 (Group Comparison)

* T-Tests & ANOVA & Non-Parametric
   * 추천 패키지: [rstatix](https://cran.r-project.org/package=rstatix)
   * 선정 이유: R의 기본 함수들(`t.test`, `aov`)은 파이프라인(`%>%`) 연산과 친숙하지 않고 결과 가독성이 떨어집니다. `rstatix`는 `tidyverse` 스타일을 완벽히 지원하며, 사후분석(Post-hoc)까지 일관된 텍스트/데이터 프레임 구조로 반환하여 백엔드 모듈화에 최적입니다.

## 3. 관계 및 회귀 분석 (Relationship & Regression)

* Correlation & Regression
   * 추천 패키지: [performance](https://easystats.github.io/performance/) / [broom](https://broom.tidymodels.org/)
   * 선정 이유: 회귀분석 자체는 기본 함수(`lm`, `glm`)를 쓰더라도, 그 결과를 다루기가 어렵습니다. `broom`은 회귀분석 결과(계수, p-value, R-square 등)를 정형화된 데이터 프레임(`tidy`, `glance`)으로 변환해 주며, `performance` 패키지는 다중공선성(VIF)이나 잔차 정규성 등 다중 회귀분석의 가정을 한 번에 검증해 줍니다.
* Mixed Models (혼합 모형)
   * 추천 패키지: [lme4](https://cran.r-project.org/package=lme4) (전통적 표준) / brms (최신 베이지안 확장)
   * 선정 이유: 일반적인 선형 혼합 모형은 `lme4`가 표준이지만, 복잡한 비선형이나 베이지안 접근이 필요할 때는 내부적으로 Stan(C++)을 활용해 가장 강력하고 활발하게 업데이트되는 `brms`를 장착하는 것이 최신 트렌드입니다.

## 4. 다변량 및 고급 구조 분석 (Multivariate & Structural)

* Factor (요인분석)
   * 추천 패키지: [psych](https://cran.r-project.org/package=psych)
   * 선정 이유: 탐색적 요인분석(EFA)과 신뢰도 분석에서 수십 년간 신뢰를 받아온 패키지이며, 지속적으로 버그 수정과 최적화가 이루어지고 있습니다.
* SEM (구조방정식)
   * 추천 패키지: [lavaan](https://lavaan.ugent.be/)
   * 선정 이유: R에서 구조방정식 하면 예외 없이 상용 소프트웨어(AMOS, Mplus)를 완벽히 대체하는 `lavaan`을 사용합니다. 오픈소스 생태계에서 가장 관리가 잘 되는 패키지 중 하나입니다.
* Network (네트워크 분석)
   * 추천 패키지: [psychonetrics](https://psychonetrics.org/)
   * 선정 이유: 심리계측 및 가우스 그래픽 모델(GGM) 기반 네트워크 분석의 대세 패키지입니다. 기존 `qgraph` 개발진이 구조방정식(SEM)과 네트워크 분석을 통합하여 다집단 분석, 모델 적합도 테스트 등을 수행할 수 있도록 C++ 기반 핵심 연산으로 새롭게 빌드하여 유지가 매우 잘 되고 있습니다. [[1](https://psychonetrics.org/), [2](https://github.com/SachaEpskamp/psychonetrics)]

## 5. 특수 목적 및 데이터 분석 (Specialized Analysis)

* Time Series (시계열 분석)
   * 추천 패키지: [fable](https://fable.tidyverts.org/) / [CausalImpact](https://google.github.io/CausalImpact/)
   * 선정 이유: 전통적인 `forecast` 패키지의 개발자(Rob Hyndman)가 tidy data 형식에 맞춰 완전히 새로 리뉴얼한 패키지가 `fable`입니다 (ARIMA, ETS 등 지원). 만약 시계열을 활용한 인과추론 및 정책 효과 분석 모듈을 넣는다면 베이지안 구조 시계열을 쓰는 Google의 `CausalImpact`가 훌륭한 선택지입니다. [[1](https://google.github.io/CausalImpact/CausalImpact.html), [2](https://cran.r-project.org/web/packages/CausalImpact/CausalImpact.pdf)]
* Meta-Analysis (메타분석)
   * 추천 패키지: [metafor](https://www.metafor-project.org/)
   * 선정 이유: 메타분석 분야에서 독보적이며 전 세계 연구자들이 가장 신뢰하는 패키지입니다. 활발한 업데이트는 물론 부트스트래핑, 다층 메타분석 등 최신 기법들이 지속적으로 추가되고 있습니다.
* Missing Data Analysis (결측치 처리)
   * 추천 패키지: [mice](https://cran.r-project.org/package=mice) (체인 방정식 다중대체) / [missForest](https://cran.r-project.org/package=missForest) (머신러닝 기반)
   * 선정 이유: 설문 및 임상 연구 데이터의 결측치 다중 대체를 처리할 때 여전히 전 세계적인 골드 스탠다드는 `mice`입니다. 혼합형 데이터(연속형+범주형)가 복잡하게 얽혀있을 때는 랜덤 포레스트 기반의 비모수 대체를 지원하는 `missForest`가 최근 임상 연구 데이터 처리에서 각광받고 있습니다. [[1](https://medium.com/@diptim_99684/missing-data-in-r-complete-2025-guide-to-imputation-techniques-727173f24555)]

## 6. 예측 분석 및 머신러닝 (Predictive Analytics & ML)

* Machine Learning
   * 추천 패키지: [tidymodels](https://www.tidymodels.org/)
   * 선정 이유: 과거 R의 머신러닝은 `caret`이 지배했으나, 현재는 유지보수가 끝난 구형 패키지가 되었습니다. RStudio(Positron 개발사) 팀이 정통 `tidyverse` 생태계와 결합하여 만든 전처리·학습·검증 표준 프레임워크가 바로 `tidymodels`입니다. 모듈화를 설계하실 때 데이터 전처리 파이프라인(`recipes`), 모델 명세(`parsnip`), 검증(`rsample`) 단위를 쪼개기에 가장 이상적인 구조를 갖고 있습니다. [[1](https://medium.com/@diptim_99684/missing-data-in-r-complete-2025-guide-to-imputation-techniques-727173f24555)]

## 7. 연구 설계 및 데이터 품질 (Research Design & Quality)

* Power Analysis (검정력 분석)
   * 추천 패키지: [pwr](https://cran.r-project.org/package=pwr)
   * 선정 이유: G*Power 프로그램의 R 버전 표준 패키지입니다. 함수 구조가 정형화되어 있어(예: `pwr.t.test`, `pwr.anova.test`) 유저 입력값(효과 크기, 유의수준 등)에 따른 표본 수 계산 모듈을 만들기 매우 직관적입니다.
* Causal Inference / Discovery (인과 발견)
   * 추천 패키지: [causalDisco](https://cran.r-project.org/package=causalDisco)
   * 선정 이유: 최근 관측 데이터로부터 변수 간 DAG(유향 비순환 그래프) 구조와 인과 방향성을 찾아내는 'Causal Discovery' 기법이 각광받고 있습니다. `causalDisco`는 기존의 핵심 엔진들(`pcalg`, `bnlearn` 등)을 일관된 문법으로 바인딩하여 배경 지식(Background Knowledge)을 주입할 수 있게 해주는 최신(2025~2026년 집중 개발) 패키지입니다. [[1](https://link.springer.com/article/10.3758/s13428-025-02841-w), [2](https://cran.r-project.org/web/packages/causalDisco/causalDisco.pdf), [3](https://disco-coders.r-universe.dev/causalDisco)]

## 💡 모듈 아키텍처 설계를 위한 팁

앱의 백엔드 통계 엔진을 빌드할 때, `rstatix`, `broom`, `easystats`, `tidymodels` 구조를 핵심 뼈대로 삼으시는 것을 강력히 권장합니다. 이 패키지들은 연산 결과물로 정형화된 JSON 변환이 쉬운 `tibble(Data Frame)` 형식을 반환하기 때문에, R 엔진에서 연산된 값을 프론트엔드(UI/HTML 디스플레이) 영역으로 매끄럽게 전달하는 모듈형 아키텍처를 짜기에 가장 유리합니다.
이 중에서 현재 개발 중이신 앱 환경(예: 어떤 프론트엔드/백엔드 언어 연동 구조인지)에 맞춰, 특정 패키지의 결과 데이터를 JSON이나 깔끔한 HTML 테이블 데이터로 추출하는 코드 예시가 필요하신 모듈이 있다면 말씀해 주세요.
