# 회귀와 일반화선형모형 모듈 명세 (`org.rsage.regression`)

_2026-10-19 · 설계안 · 2026-10-20 1.0 구현_

**구현 상태 (2026-10-20).** 1.0을 `modules/regression`과 `r-packages/rsageRegression`으로 구현했다. 분석 메뉴의 "회귀" 아래 선형 회귀, 로지스틱 회귀, 개수 회귀, 일반화선형모형 네 명령이 같은 analysis를 모형 종류만 다르게 연다. 모형 편집은 공통 폼의 `models`(모형 카드·항 칩), `model`, `termChoice`, `level` 컨트롤로 했다. 1.1(정규화, 안정성, 편향 감소, 다항·스플라인 항, HC3·군집 강건 SE)은 showcase에 "예정"으로만 보인다. 모형마다 다른 family·link는 옵션과 R에서 받지만 화면에서는 공통 설정만 고른다. `comparison.pairs`를 비우면 앞 모형에 항을 더한 다음 모형을 앞 모형과 차례로 검정한다. 아래 본문은 설계 당시의 요구사항이다.

[모듈 작성 가이드](../module-authoring-guide.md)의 스펙 형식을 따른다. [모듈 목록](../analysis-modules-catalog.md), [공통 구조](../analysis-modules-strategy.md), 현재 공통 폼·결과 타입과 결측/데이터 점검 모듈을 확인했다. 이 문서는 구현 요구사항이며, 기능이 이미 제공된다는 뜻이 아니다.

## 1. 목적과 제품 방향

**하나의 결과변수에 대해, 어떤 설명변수가 얼마나 연관되는지, 그 연관성이 다른 변수에 따라 달라지는지, 변수를 추가한 모형이 무엇을 더 설명하는지 평가한다.** 기본 흐름은 `변수 지정 → 모형 구성 → 계수와 불확실성 → 모형 비교 → 진단 → 탐색적 변수 선택`이다.

선형회귀도 예측에 쓰이고 머신러닝도 설명에 쓰인다. 이 모듈은 그 구분 대신 **추정과 해석을 중심에 둔다**. 관측자료의 보정 회귀계수만으로 인과적 영향을 확정하지 않는다. 결과 문구는 기본적으로 “다른 모형 항을 고려했을 때의 연관성”을 사용한다. 인과효과를 목표로 한다면 연구 설계와 조정변수 선정 근거가 별도로 필요하다.

“중요한 변수”를 한 개의 점수로 판정하지 않는다. 효과의 크기·신뢰구간, 항 전체의 검정, 추가 설명력, 모형 변경에 대한 민감도, 재표집 시 선택 빈도를 서로 구분한다. p값이 작다는 이유만으로 중요하다고 정렬하거나, 크다는 이유만으로 교란변수를 자동 제거하지 않는다.

### 범위와 릴리스

| 단계 | 반드시 포함할 내용 |
| --- | --- |
| 1.0 기본 | 단순·다중 선형회귀, 이항 로지스틱, Poisson, 음이항, Gamma, quasi-binomial/quasi-Poisson; 변수·상호작용·모형 편집; 계수·CI·항 검정·적합도·모형 비교·진단·한계효과; stepwise AIC/BIC |
| 1.1 탐색 강화 | Gaussian/binomial/Poisson의 LASSO·elastic net·ridge, 전체 선택 절차의 bootstrap 안정성, 편향 감소 로지스틱, 제한된 비선형 항, HC3·군집 강건 추론 |
| 후속 별도 설계 | `projpred`, 그룹/계층 제약 정규화, 다중대체 통합 추론, 조사설계 가중치, 순서형·다항 회귀, 혼합모형·GEE·GAM, zero-inflated/hurdle |

1.0과 1.1을 합쳐 이 명세의 목표 기능으로 삼는다. 1.0만 제공할 때는 1.1 기능을 “예정”으로 표시하고 실행 가능한 것처럼 보이지 않는다. 상관분석은 기존 모듈 카탈로그의 별도 analysis로 남겨 두며 이 단일 결과변수 명세에는 포함하지 않는다. 다중 종속변수·MANOVA는 범위 밖이다.

## 2. 백엔드 구성과 선정 판단

**적합은 검증된 R 모델 함수, 정리·진단·해석은 easystats, 그림은 ggplot2**로 구성한다. easystats는 회귀 적합 엔진 전체를 대체하는 패키지가 아니다. `tidyverse`/`easystats` 메타 패키지를 설치하지 않고 실제 사용하는 구성 패키지만 선언한다.

| 역할 | 채택/검토 패키지 | 판단과 의존성 위치 |
| --- | --- | --- |
| 기본 적합 | `stats::lm`, `stats::glm` | R 기본 제공, 표준 기준값과 직접 대조 가능. 핵심 |
| 음이항·stepwise | `MASS::glm.nb`, `MASS::stepAIC` | 오래된 API라는 이유로 배제하지 않는다. 표준 비교 기준으로 유지. 선택 기능 백엔드 |
| 계수·CI·표준화 | `parameters::model_parameters`, `standardize_parameters` | 핵심. CI 방식·표준화 방법을 명시하며 기본값에 암묵적으로 의존하지 않음 [S1] |
| 정보·적합도·진단 | `insight`, `performance` | 핵심. 모델 정보·R²·AIC/BIC·공선성·잔차/분산 점검 [S2, S3] |
| 보정 평균·기울기·대조 | `modelbased` | 선택 기능. `estimate_means`, `estimate_slopes`, `estimate_contrasts`; 하위 추정 엔진과 버전을 기록 [S4] |
| 그림·데이터 준비 | `ggplot2`, `tibble`, 필요한 `dplyr`/`tidyr` | 숫자는 공통 표로, 그림은 정리된 데이터로 재작성. `see`의 일괄 진단 그림은 참고용이며 필수 의존성으로 두지 않음 |
| 항 검정·강건 추론 | `car`, `sandwich`, `lmtest` | Type II/III와 covariance 기반 검정에 한해 선택 의존성. 동일 vcov를 계수·대조·검정에 전달 |
| 정규화 | `glmnet` | 현대적 탐색의 우선 선택. 단일 패키지로 LASSO/elastic net/ridge, 여러 GLM family 지원 [S6] |
| 분리·편향 감소 | `detectseparation`, `brglm2` | 분리 진단과 편향 감소 적합은 서로 다른 역할. 사용자가 방법을 바꿀 때 새 모형으로 보존 [S8] |
| 회귀 전략 확장 | `rms` | 비선형성·검증·보정 등 연구용 회귀 워크플로에 유용. 전체 엔진 교체는 보류; 핵심 설치 부담을 키우지 않음 [S9] |
| 투영 예측 선택 | `projpred` | Bayesian reference model을 작은 모형으로 줄이는 후속 기능. 주로 예측 정보 보존이 목표이며 인과적 변수 선택 도구로 소개하지 않음 [S7] |

### 선정 기준 확인 상태

2026-10-19 조회한 CRAN 정보에서 `glmnet 5.1`(2026-09-24, GPL-2), `brglm2 1.1.1`(2026-10-07, GPL-3), `projpred 2.11.0`(2026-09-30, GPL-3 및 LICENSE), `rms 8.1-1`(2026-02-18, GPL ≥2)은 최근 릴리스와 macOS arm64 바이너리 링크가 확인된다. `rms`는 R ≥4.4가 필요하고 Hmisc 등 의존성이 크다. `projpred` 자체의 설치와 reference model 적합 환경 준비는 별도다. [glmnet][S10], [brglm2][S8], [rms][S9], [projpred CRAN](https://cran.r-project.org/package=projpred).

이것은 CRAN 메타데이터 확인이며 설치·호환성 시험 결과가 아니다. 현재 로컬 R 4.6.1에는 MASS 7.3.66, glmnet 5.1, car 3.1.5가 있고, 확인한 easystats 구성 패키지·modelbased·brglm2·sandwich는 설치되지 않았다. 첫 구현에서 실제 의존성 수, CRAN 버전 조합, macOS 설치, easystats 어댑터 수치 일치, 오류 보고 경로를 검증하고 버전을 고정한다. 열린 이슈의 응답성과 JASP/jamovi의 동일 패키지 사용 여부는 이번 조사에서 검증하지 않았으며 채택 근거로 주장하지 않는다.

## 3. 결과변수와 모형 종류

화면 이름은 **회귀와 GLM**으로 한다. 단순회귀와 다중회귀는 동일한 선형회귀 화면에서 설명변수 수로 결정된다. `분석 → 회귀 → 선형 / 로지스틱 / 개수 / 일반 GLM` 진입은 같은 analysis에 preset을 적용한다. 데이터만 보고 family를 확정하지 않으며, 추천 이유를 보여 준 뒤 사용자가 선택한다.

| 종류 | 결과변수 검증 | 기본 link / 추가 선택 | 적합·계수 해석 |
| --- | --- | --- | --- |
| 선형 | 수치형, 유한값 | Gaussian identity | `lm`; b와 95% CI, 결과 단위의 변화 |
| 이항 로지스틱 | 0/1 또는 정확히 두 범주; 사건 범주 명시 | logit / probit, cloglog | `glm`; logit에서만 exp(b)를 OR로 표시 |
| 집계 이항 | 성공 수와 전체 시행 수, 정수·0 ≤ 성공 ≤ 전체, 전체 > 0 | logit / probit, cloglog | `cbind(success, trials-success)`; 하나의 개념적 결과에 두 입력 열 사용 |
| Poisson | 0 이상 정수 | log | `glm`; exp(b)는 기대 개수의 비. exposure가 있으면 발생률비(IRR) |
| 음이항 | 0 이상 정수 | log | `glm.nb`; 과산포 대안. theta와 불확실성/수렴 상태 표시 |
| Gamma | 엄격히 양수인 연속값 | log / inverse, identity | `glm`; log link에서는 평균의 비. 0은 자동 보정하지 않음 |
| quasi-binomial / quasi-Poisson | 해당 binomial/Poisson과 동일 | logit / log | 분산 보정용; 통상 likelihood AIC·BIC·LRT를 제공하지 않음 |

Poisson 자료에 음수·소수, Gamma에 0, 이항 자료에 세 범주가 있으면 적합 전에 수정 방법을 알린다. 임의 반올림·범주 병합·상수 더하기를 하지 않는다. 한 범주만 남거나 모든 개수가 0인 데이터는 유효한 추론 모형으로 표시하지 않는다. 위 표 밖 family/link 조합은 초기 버전에서 비활성화한다. [S11]

## 4. 사용자 흐름과 변수 역할

현재 가이드의 기본 380px 옵션 창, 왼쪽 변수 목록 → 오른쪽 역할 칸을 유지한다. 숫자로 코딩된 범주형 변수는 “범주로 사용”으로 넣을 수 있고 실제 처리 유형을 칩에 표시한다. 날짜는 단위가 정해지기 전에는 설명변수로 받지 않는다.

| 역할 | bind | 수/허용 유형 | 규칙 |
| --- | --- | --- | --- |
| 결과변수 | `outcome.variable` | 하나; numeric/factor/ordered/character/logical | family별 재검증; 이항의 두 수준 외 ordered 결과는 후속 |
| 연속 설명변수 | `predictors.continuous` | 여럿; numeric | 변수당 변환·중심화 선택 가능 |
| 범주 설명변수 | `predictors.categorical` | 여럿; numeric/factor/ordered/character/logical | 숫자를 넣으면 범주 처리 명시. ordered도 초기 기본은 명시적 treatment contrast |

추가 입력은 역할 칸을 늘리지 않고 해당 옵션 안의 `column` 선택기로 둔다: `outcome.trials`, `offset.variable`, `weights.variable`, `inference.cluster`, `diagnostics.rowLabel`. 이 방식은 “한 변수는 한 역할” 규칙을 유지하면서 보조 열을 재사용할 수 있게 한다. 결과변수는 설명변수나 offset으로 재사용할 수 없다. 군집 ID를 모형의 고정효과로도 쓸 경우 그 사실을 표시한다.

```text
데이터 [선택]              이 분석으로 할 수 있는 것 ▸
[사용 가능한 변수]  →  [결과변수     ]
                    →  [연속 설명변수]
                    →  [범주 설명변수]
▾ 모형 종류·코딩       [사건: 있음] [참조 범주]
▾ 모형 구성           [M1 기본] [M2 보정] [+ 모형]
  포함 항 [나이] [성별] [노출] [노출 × 성별]
  [주효과 추가] [상호작용] [변환/비선형]
  수식 미리보기: outcome ~ age + sex + exposure + sex:exposure
▸ 계수와 항 검정       b/OR/IRR, CI, 표준화, 검정 방식
▸ 보정 평균과 상호작용 그래프
▸ 모형 비교            M1 → M2, AIC/BIC, ΔR²
▸ 진단                 잔차·공선성·영향점·과산포
▸ 변수 선택과 안정성   없음 / 단계적 / 정규화
▸ 고급                 결측·offset·가중치·추론·저장
```

빠른 적합과 옵션 변경은 기존 실행 흐름을 사용한다. bootstrap/CV/프로파일 CI 같은 장기 계산은 명시적 실행, 진행률, 취소, 이전 결과의 “설정 변경됨” 표시를 갖춘다. 취소된 계산을 완료 결과로 표시하지 않는다.

## 5. 모형 항 편집과 저장 규칙

### 항과 모형

- 변수 역할은 사용 가능한 설명변수 집합이다. 각 모형이 그중 무엇을 포함하는지 별도로 정한다. 첫 모형에는 선택한 설명변수의 주효과를 넣는다.
- `models[]`는 안정적인 `id`, 사용자 이름 `label`, 순서, `termIds`, `intercept`를 갖는다. 기본은 M1 하나와 절편 포함이다. 모형 복제·이름 변경·삭제·순서 변경을 지원하며 ID는 재사용하지 않는다.
- 기본 family/link/추정법은 공통 설정을 따르되 모형 카드에서 `family`, `link`, `estimation`을 명시적으로 덮어쓸 수 있다(각 기본값 null=상속). 따라서 같은 count 결과의 Poisson·음이항 대안이나 일반/편향 감소 logistic을 원 모형 옆에 보존할 수 있다. 각 카드와 결과에 최종 적용된 설정을 표시·저장하며, 서로 다른 추정법의 비교는 7절 제한을 따른다.
- 공통 `terms[]`는 `id`, `kind`(`main`, `interaction`, `power`, `spline`), 실제 열 참조 또는 선행 term ID, 변환 설정을 갖는 구조화 데이터다. 임의 R 코드를 저장하는 문자열로 쓰지 않는다.
- 두 항 선택 → “상호작용 추가”가 기본. 1.0은 2원·3원 상호작용을 지원한다. 모든 2원 상호작용 일괄 추가는 생성 개수·추가 자유도를 먼저 표시한다. 가능한 조합을 자동 전수 탐색하지 않는다.
- 강한 계층성(strong hierarchy)을 기본이자 1.x 제약으로 둔다. `x:z`는 `x`, `z`를, `x:z:w`는 모든 하위 상호작용과 주효과를 포함한다. 하위 항 삭제 시 함께 제거될 상위 항을 보여 주며 변경을 한 번에 실행한다.
- 범주형 변수는 더미 계수 하나가 아니라 하나의 항이다. 선택·삭제·joint test도 항 단위다. 수식상의 항 수와 추정 계수 수를 따로 표시한다.
- 1.1의 비선형 항: 중심화 후 2차 다항식, `splines::ns` 자연 cubic spline(기본 df=3, knots 저장). spline은 기저 열 전체를 하나의 항으로 묶는다. 변환된 항의 상호작용은 초기 범위에서 제외한다.
- 절편 제거는 고급 옵션. 무절편 R²를 일반 R²처럼 표시하지 않는다. 절편 설정이 다른 모형의 비교 가능성도 검사한다.

### 코딩과 변환

범주 기준값과 순서를 저장하고, 계수표에 참조 범주를 표시한다. 기본은 treatment coding이며 sum coding은 고급 옵션이다. 전역 `options(contrasts=...)`를 바꾸지 않는다. Type III 검정을 요청했을 때 필요한 코딩 조건을 점검하고 현재 코딩에서 무엇을 검정하는지 표시한다.

연속변수의 중심화는 기본 꺼짐, 상호작용을 넣으면 평균 중심화와 의미 있는 기준값 선택을 제안한다. 로그 변환은 정의역을 검사하고 원자료를 바꾸지 않는다. 표준화 계수는 별도 출력으로 제공한다. 변환·중심화 상수는 비교 모형 전체에서 동일하고 저장 후 재실행에도 고정한다. 수식 미리보기는 생성된 읽기 전용 표시이며 자유식 입력은 후속 기능이다.

### 현재 공통 UI에 필요한 확장

현재 `AnalysisFormControl`은 `variables/variable/column/list/text/checkbox/number/select/rows/group`를 지원하며 `rows`의 필드는 column/text/select뿐이다. 중첩 모형 목록·항 칩·동적 참조 수준 선택·복합 활성 조건은 이 구조만으로 표현하기 어렵다.

1. 공통 `modelTerms`와 `modelSet` 컨트롤을 추가해 모형/항 스키마를 편집한다. 모듈 ID 하드코딩 UI 대신 선언형 컨트롤로 제공한다.
2. 열의 관측 수준에서 선택지를 만드는 level picker와, family/link/추정법/패키지 유무를 함께 평가하는 capability 조건을 추가한다. 계산 불가 옵션은 이유와 함께 흐리게 둔다.
3. `columnsUsed()`와 R 입력 스냅샷이 nested term·trials·offset·weights·cluster·행 라벨 열을 모두 수집하도록 한다. `formProblems()`도 중첩 bind·동적 참조를 검사한다.
4. GUI·AI·복원 분석 모두 동일한 스키마 및 의미 검증을 통과한다. 클라이언트의 활성 상태만 믿지 않는다.

이 확장을 1.0의 선행 작업으로 잡는다. 쉼표 문자열이나 자유 수식 칸으로 상호작용·모형 비교 UX를 대신하지 않는다.

## 6. 계수·항 검정·효과 해석

기본 계수표: 모형, 항, 수준/대조, b, SE, 95% CI, t 또는 z, 자유도(해당 시), p. LM은 t 기반, 표준 binomial/Poisson ML은 Wald z 기반, 분산을 추정하는 GLM은 해당 t/분산 규칙을 따른다. logistic/Poisson/Gamma log의 지수화 계수와 CI를 함께 제공하되 SE는 원 계수 척도임을 표시한다. CI 계산 방식은 매 실행 기록에 남긴다. 프로파일 CI는 지원되는 ML 적합에서만 별도 선택하며 Wald p값과 방법이 다를 수 있음을 각주에 적는다. [S1]

| 질문 | 출력·기본 정책 |
| --- | --- |
| 어느 방향으로 얼마나 연관되는가? | 원 단위 b·OR·개수비/IRR·평균비와 CI. 단위 변화량을 명시 |
| 범주형 변수 전체가 기여하는가? | 여러 계수를 묶은 항 검정. 개별 수준의 p값으로 대체하지 않음 |
| 어떤 변수가 추가 정보를 주는가? | 사전 지정 block 추가 검정·ΔR²; LM에서 조건부 partial R²와 semipartial ΔR²를 구분 |
| 변수 간 효과 크기를 비교할 수 있는가? | LM 표준화 계수는 선택 출력. GLM에서는 결과를 표준화하지 않고 “설명변수 1 SD 변화”로 표시. 범주 더미를 자동 z 변환하지 않음 |
| 상호작용이 어떻게 나타나는가? | 예측 평균/확률·기울기·대조의 표와 CI 그림, 실제 데이터 범위 표시 |

기본 항 검정은 **계층성을 지키는 항 제거/추가 검정**이다. 상호작용이 남아 있는 주효과를 독립적으로 제거하지 않는다. “x의 전체 기여”는 x와 x가 포함된 상위 항을 함께 제거한 joint comparison으로 정의하고, 단일 계수 검정과 구분한다. Type I은 순서 의존성을 명시하고 기본으로 사용하지 않는다. Type II/III는 고급 선택이며 각 null hypothesis·contrast·검정 통계량을 기록한다. [S12]

보정 평균과 한계효과는 계산 대상 집단을 먼저 정한다. 기본은 분석 표본의 관측 공변량 분포에 대한 평균, 대안은 사용자가 정한 reference grid이다. 두 방법을 같은 “평균 효과”로 섞지 않는다. 이항의 확률 차이와 OR는 별도 척도다. 연속 변수는 미분 기울기, 범주 변수는 지정 수준 간 차이를 사용한다. 여러 대조에는 기본 Holm 보정을 적용하고 보정한 대조 집합을 기록한다. GLM 상호작용의 link 척도 검정과 response 척도의 효과 차이는 같은 가설이 아니다. [S4]

## 7. 적합도와 모형 비교

### 지표

| 모형 | 기본 적합도 | 선택/제약 |
| --- | --- | --- |
| LM | N, 계수 rank, 잔차 df, R², 수정 R², 잔차 표준편차, RMSE, logLik, AIC, BIC | R² 차이·partial R²·AICc. RMSE의 분모는 N, 잔차 표준편차의 분모는 잔차 df로 명시 |
| binomial logit/probit/cloglog | N·사건/비사건, residual/null deviance, logLik, AIC, BIC | Bernoulli에서 Tjur R², McFadden R². 집계 binomial의 Tjur는 초기 제외. Brier/calibration은 선택 진단 |
| Poisson/음이항/Gamma | N, deviance, dispersion 또는 theta, logLik, AIC, BIC | deviance explained 등은 정확한 이름·정의로 제공. 일반 선형 R²로 부르지 않음 |
| quasi 계열 | N, deviance, 추정 dispersion, 잔차 요약 | 일반 AIC/BIC/AICc/logLik/LRT는 “해당 없음: 준우도 모형” |
| 정규화 | alpha, lambda, nonzero 계수 수, CV 손실·불확실성 | 일반 ML 모형의 p값·수정 R²·AIC 순위표에 자동 합류시키지 않음 |

`performance::r2()`가 모델별로 다른 통계량을 반환하므로 반환 열 이름과 정의를 보존한다. pseudo-R²에 LM의 수정 R² 공식을 적용하지 않는다. AICc는 유효 파라미터 수 K(분산·theta 포함 여부)와 적용 조건을 기록하고 N−K−1 ≤ 0이면 제공하지 않는다. 지원하지 않는 모델 클래스에서는 임의 계산으로 채우지 않는다. [S2, S3, S13]

### 비교의 유효성

- 비교 그룹은 동일 결과값·코딩·척도, 동일한 실제 행 ID, 동일 가중치·offset·시행 수, 호환되는 likelihood 정의를 가져야 한다. 단순히 N이 같다는 것으로 통과시키지 않는다.
- 비교에 쓸 모든 모형 및 선택의 upper scope에 필요한 열의 합집합으로 완전 사례 표본을 먼저 고정한다. 각 모형의 사용 가능 N과 공통 분석 N·추가 제외 N을 함께 표시한다. 모형별 다른 표본 적합을 택하면 직접 비교 기능은 비활성화한다.
- LM의 중첩 모형에는 partial F test, 동일 family/link의 표준 ML binomial/Poisson에는 likelihood-ratio χ² test, 분산 추정이 필요한 지원 GLM에는 적절한 F/분산 보정 검정을 쓴다. quasi에 χ² LRT를 적용하지 않는다. Gamma의 기본 중첩 비교는 F 방식으로 명시한다. [S5]
- 음이항끼리의 비교는 각 모형의 theta를 재추정하고 표준 ML LRT 조건을 확인한다. Poisson 대 음이항은 경계 파라미터 문제 때문에 일반 χ² 차이 검정을 자동 적용하지 않는다. 동일 반응·표본의 호환되는 AIC/BIC 비교는 별도로 허용한다.
- 비중첩 모형은 AIC/BIC 비교는 가능할 수 있으나 일반 ANOVA 차이 p값은 제공하지 않는다. link가 다른 모형도 중첩으로 간주하지 않는다. 중첩 여부는 항 문자열뿐 아니라 같은 표본에서의 설계행렬 열공간으로 검사한다.
- HC3/군집 강건 추론에서는 고전적 F/LRT를 “강건 검정”으로 제시하지 않는다. 같은 covariance를 이용한 joint Wald 검정으로 전환하고 참조 분포·df를 명시한다. 작은 군집 수는 별도 경고와 검증된 작은 표본 방법이 필요하다.
- 편향 감소/penalized 적합과 일반 ML 적합을 일반 LRT 또는 같은 AIC 순위에 섞지 않는다. 1.1의 편향 감소 모형은 계수·CI·효과·진단을 제공하고, 전용 비교 검증이 끝나기 전에는 일반 IC/차이 검정을 비활성화한다.
- `compare_performance(rank=FALSE)`로 지표를 정리한다. 여러 지표를 합친 자동 종합 점수와 “최고 모형” 배지는 기본 제공하지 않는다. ΔAIC/ΔBIC는 비교 가능한 그룹 내부 최소값 기준이며 낮을수록 좋다. 가중치를 보여 주면 후보 집합 의존적임을 설명한다. [S2]
- `stepAIC`의 경로 기준(`extractAIC`)은 LM에서 `AIC()`와 상수 차이가 생길 수 있다. 경로 표에는 기준 이름을 보존하고 최종 비교 표에는 같은 `logLik` 기반 AIC/BIC를 다시 계산한다. 서로 다른 정의의 절댓값을 한 열에서 섞지 않는다. [S14]

## 8. 변수 선택: 기능과 한계

기본값은 **선택 안 함: 지정한 모형 유지**다. 연구 질문상 반드시 필요한 설명변수는 `selection.forcedTermIds`로 고정한다. 교란변수는 단변량 p값·AIC 개선 여부로 자동 걸러내지 않는다. 선택한 결과는 원 모형을 덮어쓰지 않고 “탐색에서 제안된 모형”으로 추가할 수 있다.

| 방법 | 목표/사용 조건 | 반드시 보여 줄 결과 |
| --- | --- | --- |
| 사전 지정 모형·block 비교 | 설명/추정의 기본. 연구자가 조정변수와 비교를 정함 | 전체 계수, 추가 block 검정, CI 변화, ΔR²/IC |
| 전진·후진·양방향 stepwise | AIC 또는 BIC로 제한된 candidate scope 탐색. LM, ML binomial/Poisson/음이항부터 지원 | 시작/하한/상한 모형, 강제 항, 매 단계 추가·제거 항과 df·기준값, 종료 이유 |
| LASSO | 희소한 계수 집합 탐색; 상관된 설명변수 중 선택이 불안정할 수 있음 | 선택 계수, lambda 경로, CV 손실, 선택 규칙 |
| Elastic net | L1+L2 축소; 상관된 변수의 정보를 함께 유지하는 대안 | alpha/lambda, 선택 계수, 경로·CV 표/그림 |
| Ridge | 계수 안정화·축소; 보통 계수를 정확히 0으로 만들지 않음 | 축소 계수와 CV. “변수 제거” 방법으로 표기하지 않음 |
| Bootstrap 선택 안정성 | 표본이 바뀌어도 같은 항이 선택되는지 평가 | 항별 선택 빈도·부호 빈도·모형 크기, 성공/실패 반복 수 |
| Projection predictive | 큰 reference model의 예측 정보를 작은 모형에 유지 | 후속: reference 대비 ELPD 손실·선택 크기·CV와 투영 결과 [S7] |

### Stepwise 상세

`MASS::stepAIC`의 `scope`, `direction`, `k`를 사용한다. AIC는 k=2, BIC는 고정 분석 N에 대해 k=log(N). 전진은 강제 항을 포함한 lower에서, 후진/양방향은 선택한 source model에서 시작한다. upper 후보와 lower 강제 항의 계층적 폐쇄를 검증한다. 다수준 범주와 spline은 항 전체로 이동한다. 최대 단계 기본 100, 계산 제한/취소 시 “불완전 탐색”으로 표시한다. quasi, 편향 감소, rank-deficient 모형과 미검증 family에서는 비활성화한다. 유의확률 기반 진입/제거 규칙과 exhaustive best-subsets는 초기 범위에서 제외한다. [S14]

### 정규화 상세

`glmnet::cv.glmnet`을 사용하며 Gaussian identity, binomial logit, Poisson log부터 지원한다. alpha 기본 0.5(사용자가 고정), LASSO=1, ridge=0. alpha 탐색은 `[0, .25, .5, .75, 1]`의 명시적 선택 기능으로 하고 같은 fold ID를 공유한다. `cv.glmnet` 한 번으로 alpha가 자동 최적화된다고 안내하지 않는다. 기본 10-fold, seed=20261019, lambda.1se; lambda.min도 선택 가능하다. 드문 사건·너무 작은 표본으로 fold를 구성할 수 없으면 이유를 알리고 재설정한다. [S6]

전처리의 학습 의존 부분은 fold 안에서 추정한다. fold ID·family·loss·표준화·실제 lambda를 저장한다. CV 오차는 lambda/alpha 선택용이며 최종 일반화 성능의 불편 추정치라고 쓰지 않는다. 별도 성능 평가를 제공하려면 nested CV/독립 검증이 필요하다.

일반 glmnet은 계수 열 단위 penalty라 다수준 범주 항 전체 선택이나 상호작용 계층성을 자동 보장하지 않는다. **1.1 정규화 선택은 연속·이진 주효과 후보로 한정**한다. 다수준 범주는 전체를 강제 포함하는 경우만 허용하고 각 열에 penalty=0을 적용한다. 상호작용·다항·spline 후보가 있으면 “항 단위 정규화는 후속 지원”으로 비활성화한다. 선택 후 주효과를 몰래 추가하거나 일부 더미만 남긴 결과를 온전한 변수 선택으로 표시하지 않는다.

### 안정성과 선택 후 추론

Bootstrap은 기본 꺼짐, 켜면 B=200을 탐색 기본으로 하고 보고 목적은 1,000 이상을 권고한다. 재표집마다 전체 선택 절차와 필요한 tuning을 반복한다. 계수값만 재적합한 bootstrap을 “선택 안정성”으로 부르지 않는다. 성공 반복 수를 분모로 쓴 빈도와 실패율을 함께 표시하며 실패 반복을 0% 선택으로 처리하지 않는다. 이는 정식 stability selection/FDR 제어가 아니다. Ridge는 선택 빈도 대상에서 제외하고, 군집 강건 분석과의 bootstrap 조합은 군집 단위 재표집을 구현하기 전까지 비활성화한다.

선택된 모형의 일반 p값·CI는 선택 과정의 불확실성을 반영하지 않는다. stepwise 결과에는 이 설명을 항상 붙이고, regularized 계수에는 일반 Wald p값을 생성하지 않는다. 선택 항을 비정규화 모형으로 다시 적합하는 것은 명시적 별도 동작이며 “선택 후 탐색적 재적합” 표시를 유지한다. 부트스트랩 선택 빈도도 인과성·재현성 확률로 표현하지 않는다.

## 9. 진단과 데이터 정책

| 점검 | 제공할 표·그림과 동작 |
| --- | --- |
| 모든 모형 | 설계행렬 rank, 중복/상수 항, 수렴, 추정 가능 계수, VIF/GVIF와 df 보정, 잔차 대 적합값, 영향점 |
| LM | Q–Q, 잔차 대 적합값, scale-location, Cook 거리·leverage·DFBETAS. 정규성은 원변수의 정규성을 뜻하지 않음 |
| Logistic | 사건/비사건 수와 추정 파라미터 수, 완전/준완전 분리, 극단 확률, 영향점, 선택적 calibration/Brier. Q–Q 정규성 통과를 요구하지 않음 |
| Count | Pearson dispersion·과산포 점검, 관측/예측 0 개수, deviance/Pearson 잔차. 0이 많다는 사실만으로 zero-inflated 모형을 확정하지 않음 |
| Gamma/quasi | family에 맞는 잔차·분산 진단. Poisson 전용 진단을 그대로 적용하지 않음 |
| 영향점 | 원자료 행 ID/사용자 라벨을 표에 유지. 탐색 기준은 표시하되 자동 삭제하지 않음. 제외 분석은 별도 민감도 분석으로 생성 |

`performance::check_model`의 진단 종류를 참고하되 개별 결과를 표·그림으로 분리한다. `check_collinearity`, `check_overdispersion`, `check_zeroinflation`은 해당 모형 지원 여부를 확인해 호출한다. 진단 하나의 실패는 나머지 결과를 없애지 않는다. 공선성은 기계적 삭제 지시가 아니며, 상호작용에서는 높아진 VIF의 맥락을 설명한다. [S3]

결측 기본은 실제 적합·추론에 필요한 열의 complete cases. 행 라벨 등 표시 전용 열의 결측 때문에 분석 행을 제외하지 않는다. 각 열 결측 수, 중복을 제거한 제외 행 수, 변환 정의역 오류, 최종 N을 표로 남긴다. 정의역 오류는 일반 결측 제외와 구분해 수정 전 해당 적합을 차단한다. 결측을 0으로 바꾸거나 단일 대체를 자동 시행하지 않는다. 다중대체 모듈 결과를 단순히 한 완성 데이터로 취급해 통합 추론했다고 표시하지 않는다. MI pooling 및 pooled model tests는 후속 명세가 필요하다.

Offset은 `none/exposure/log_offset` 중 선택한다. exposure는 양수여야 하며 log link 모형에서 log(exposure)를 계수 1로 넣는다. 이미 로그인 offset은 다시 로그를 취하지 않는다. 노출량 단위와 결과가 개수인지 비율인지 표에 쓴다. offset은 변수 선택에서 제거할 수 없다.

가중치는 기본 없음. 1.x는 Gaussian LM의 양수 precision weights만 지원하고 “분산의 역수에 비례하는 가중치”로 설명한다. 집계 이항 시행 수는 별도 입력이다. frequency/survey/propensity weights를 일반 weights 칸으로 받지 않는다. 군집 강건 SE는 독립 단위 식별이 필요하며 반복측정의 평균 구조를 자동 해결하는 기능은 아니다.

## 10. 대표 활용법 → 옵션 → 결과

공식 예제의 모든 모델 클래스를 옮기는 대신 이 명세의 단일 결과변수 GLM 범위에 해당하는 대표 흐름을 매핑한다. 아래 각 행은 `form.about.showcase`의 한 항목이며 `enable`, `needs`, `needsFilled`를 갖는다. family preset은 모형 종류만 설정하고 결과변수·사건 수준의 실제 선택을 안내한다.

| 대표 활용법/출처 | 백엔드 | 옵션(bind) | 결과 id · section |
| --- | --- | --- | --- |
| 회귀계수와 불확실성 [S1] | `parameters::model_parameters` | `output.coefficients`, `inference.ciLevel` | 표 `coefficients` · 계수와 항 검정 |
| 효과 크기를 나란히 보기 [S1] | `parameters::standardize_parameters` | `output.standardized`, `plots.coefficients` | 표 `standardized`, 그림 `coefficients` · 계수와 항 검정 |
| 후보 모형의 적합도 비교 [S2] | `performance::compare_performance` | `comparison.enabled`, `output.fit` | 표 `modelFit`, `modelComparison` · 모형 비교 |
| 추가 항/block의 기여 [S5, S12] | `stats::anova`, `drop1`; 필요 시 `car` | `inference.termTests`, `comparison.pairs` | 표 `termTests`, `modelTests` · 검정/비교 |
| 잔차와 공선성 확인 [S3] | `performance::check_model`, `check_collinearity` | `diagnostics.residuals`, `diagnostics.collinearity` | 표 `diagnostics`, `collinearity`, 그림 `residuals`, `qq` · 진단 |
| 개수 자료의 과산포와 0 [S3] | `check_overdispersion`, `check_zeroinflation` | `diagnostics.dispersion`, `diagnostics.zeros` | 표 `dispersion`, `zeros`, 그림 `zeros` · 진단 |
| 조절변수에 따라 다른 기울기 [S4] | `modelbased::estimate_slopes` | `effects.enabled`, `effects.kind=slopes` | 표·그림 `slopes` · 효과 해석 |
| 보정 평균/확률·범주 차이 [S4] | `estimate_means`, `estimate_contrasts` | `effects.kind=means/contrasts` | 표·그림 `effects`, 표 `contrasts` · 효과 해석 |
| 단계적으로 항 줄이기 [S14] | `MASS::stepAIC` | `selection.method=stepwise` | 표 `selectionPath`, `selectedTerms`, 그림 `selectionPath` · 변수 선택 |
| 계수 축소와 희소 모형 [S6] | `glmnet::cv.glmnet` | `selection.method=elastic_net/lasso/ridge` | 표 `regularization`, `cv`, 그림 `coefficientPath`, `cv` · 변수 선택 |
| 선택 결과의 민감도 보기 | 모듈의 재표집 실행 + 선택 백엔드 | `selection.stability.enabled` | 표 `selectionStability`, `resampling`, 그림 `selectionStability` · 안정성 |
| 분리된 이항 자료 분석 [S8] | `brglm2::brglmFit` | `model.estimation=mean_bias_reduced` | 표 `coefficients`, `estimation` · 개요/계수 |

제외/연기: easystats의 mixed/Bayesian/생존 모형 예제는 해당 모듈로, modelbased의 Johnson–Neyman 구간은 다중 검정·척도별 정의를 추가 설계한 뒤 제공한다. 자동 `report` 문장 생성, 종합 성능 점수, glmnet Cox/multinomial/multiresponse/relaxed lasso, projpred 전체 흐름은 초기 범위에서 제외한다. 기본 계수·비교 기능을 늘리는 것과 별도의 해석·검증 요구가 있기 때문이다.

## 11. 옵션 계약

제안 패키지 `rsageRegression`, analysis ID `regression`, 진입점 `analyse(data, options)`. 초기 `optionsSchemaVersion=1`, `resultSchemaVersion=1`. 모든 객체는 `additionalProperties:false`, 모든 속성은 기본값과 영어 description을 갖는다. 아래는 구현용 계약이며 실제 스키마는 이 문서 이후 작성한다. 배열 요소의 실제 열 참조와 term/model ID는 타입과 의미를 모두 검증한다.

| bind | 유형 / 기본값 | 기능·활성 조건 / 백엔드 |
| --- | --- | --- |
| `outcome.variable`, `outcome.event`, `outcome.trials` | string/null / null | 결과·사건·시행 수. 이항 event는 미지정 시 실행 전 선택; 0/1은 1, logical은 TRUE 제안을 표시 |
| `outcome.encoding` | enum / `individual` | `individual/grouped`; grouped는 시행 수 필요 |
| `predictors.continuous`, `predictors.categorical` | string[] / [] | 역할 지정; stats |
| `model.family`, `model.link` | enum / `gaussian`, `identity` | 허용 조합은 3절. preset 변경은 기존 family 전용 옵션의 무효화를 표시 |
| `model.estimation` | enum / `maximum_likelihood` | LM은 OLS 적합임을 별도 기록. `mean_bias_reduced`는 1.1 binomial logit·brglm2 필요 |
| `coding.factors` | object[] / [] | `{variable, reference:null, contrast:treatment, levels:[]}`; 실제 선택 수준 저장 |
| `coding.transforms` | object[] / [] | `{variable, transform:none, center:none, centerValue:null}`; log/mean/custom 등 허용 enum만 사용 |
| `terms` | object[] / [] | tagged union: main={id,kind,variable}; interaction={id,kind,components}; power={id,kind,variable,degree:2}; spline={id,kind,variable,df:3,knots:[]} |
| `models` | object[] / `[{id:m1,label:모형 1,termIds:[],intercept:true,family:null,link:null,estimation:null}]` | null model도 명시적으로 실행 가능. family/link/estimation은 null이면 공통 설정 상속. role 추가의 GUI 동작과 analyse의 숨은 자동 추가를 구분 |
| `output.coefficients`, `output.fit`, `plots.coefficients` | boolean / true | 계수·적합도 표, forest plot; parameters/performance/ggplot2 |
| `output.standardized` | boolean / false | 정의를 명시한 표준화 출력; parameters |
| `output.partialR2` | boolean / false | LM의 지정 term/block 제거 비교와 공통 표본 필요 |
| `inference.ciLevel`, `inference.ciMethod` | number/enum / .95, `wald` | LM에서 wald는 t CI 의미. `profile`은 검증된 ML class만 |
| `inference.termTests` | enum / `hierarchical` | `none/hierarchical/type1/type2/type3`; 지원 검정·코딩 조건 적용 |
| `inference.se`, `inference.cluster` | enum, string/null / `model`, null | `model/HC3/cluster`; 1.1 robust, 추가 패키지와 cluster 필요 |
| `comparison.enabled`, `comparison.pairs` | boolean, object[] / false, [] | pair={reduced,full}; 두 모형 이상, 유효 비교 조건 필요. 빈 pairs는 적합도만 비교 |
| `comparison.metrics` | enum[] / `[AIC,BIC,R2,adjusted_R2]` | family별 capability로 해당 없음 표시; 선택 지표 AICc·pseudo-R² 이름을 분리 |
| `effects.enabled`, `effects.kind` | boolean/enum / false, `means` | `means/slopes/contrasts`; modelbased 필요 |
| `effects.modelId`, `effects.focal`, `effects.moderator` | string/null / null | 선택 모형·변수 필요. moderator는 없을 수 있음 |
| `effects.marginalization`, `effects.scale` | enum / `empirical`, `response` | `empirical/reference_grid`, `response/link`; averaging 규칙 기록 |
| `effects.at`, `effects.adjust` | object[], enum / [], `holm` | at={variable,values:[]}; 지정 값/범위·다중 대조 보정 |
| `diagnostics.residuals`, `diagnostics.collinearity` | boolean / true | 적합 가능한 모형; performance/기본 잔차 함수 |
| `diagnostics.influence`, `diagnostics.dispersion`, `diagnostics.zeros` | boolean / false | 영향점/분산/0 진단; family별 활성 |
| `diagnostics.calibration` | boolean / false | 개별 Bernoulli 자료의 Brier 점수·관측/예측 확률 표·calibration 그림. 학습 표본 내 진단임을 표시 |
| `diagnostics.rowLabel` | string/null / null | 원 행 ID는 항상 보존, 별도 라벨은 선택 |
| `selection.method` | enum / `none` | `none/stepwise/lasso/elastic_net/ridge` |
| `selection.sourceModelId`, `selection.candidateTermIds`, `selection.forcedTermIds` | string/null, string[], string[] / null, [], [] | source 명시 필요; 빈 후보는 source의 항을 사용한다고 UI/기록에 표시 |
| `selection.direction`, `selection.criterion`, `selection.maxSteps` | enum, enum, integer / `both`, `AIC`, 100 | stepwise에만 활성; criterion=AIC/BIC |
| `selection.alpha`, `selection.tuneAlpha` | number, boolean / .5, false | elastic net만; tune 시 8절 grid를 기록 |
| `selection.folds`, `selection.lambdaRule` | integer, enum / 10, `1se` | 정규화에만 활성; `1se/min` |
| `selection.stability.enabled`, `selection.stability.repetitions` | boolean, integer / false, 200 | 지원 선택법을 선택한 뒤 활성; 전체 절차 재실행 |
| `random.seed` | integer / 20261019 | CV/bootstrap/시뮬레이션 재현, 사용자 RNG 복원 |
| `missing.policy`, `missing.sampleScope` | enum / `complete_cases`, `shared` | `shared/per_model`; 후자는 직접 비교·통합 선택 비교 비활성 |
| `offset.mode`, `offset.variable`, `offset.unit` | enum, string/null, string / `none`, null, `노출 1단위` | `none/exposure/log_offset`; 로그 link의 count 모형 |
| `weights.mode`, `weights.variable` | enum, string/null / `none`, null | `none/precision`; Gaussian LM만 |
| `export.models.enabled`, `export.models.saveAs` | boolean, string / false, `regression_models` | 적합 객체 묶음을 exports로 반환; 앱 공통 저장 흐름 |
| `export.augmented.enabled`, `export.augmented.saveAs` | boolean, string / false, `regression_diagnostics` | 행 ID·모형별 fitted/residual/influence가 담긴 사본 |

수치 한계: CI 0~1의 열린 구간, alpha 0~1, folds 정수 ≥3이며 실제 표본/사건 수로 추가 제한, maxSteps ≥1, 반복 ≥20. 규모가 큰 계산은 예상 모형 수·반복 수를 표시하고 중단 가능해야 한다. 누락 옵션은 defaults로 병합하되, 잘못된 ID·순환 term 참조·존재하지 않는 열은 실행하지 않는다.

## 12. 결과 구조와 읽는 법

section 순서: **분석 개요 → 계수와 항 검정 → 효과 해석 → 모형 비교 → 진단 → 변수 선택 → 안정성 → 재현 정보**. 표에 `model_id`를 넣어 여러 모형을 구분하고 행 ID와 term ID는 표시 라벨과 별개로 보존한다. 모든 표와 그림은 고정 id·description을 가진다. 선택 옵션이 꺼지면 해당 결과를 만들지 않는다.

| id / 종류 | 포함할 내용 | description의 핵심 |
| --- | --- | --- |
| `overview`, `sample`, `estimation` / 표 | outcome·사건·family/link·수식·N·제외·rank·추정법·상태 | 어떤 표본과 코딩으로 무엇을 추정했는지 먼저 확인 |
| `coefficients`, `standardized` / 표·계수 그림 | 추정치·CI·SE·검정; 참조 범주 | 방향·크기·불확실성을 함께 읽고 상호작용 주효과의 기준값을 확인 |
| `termTests`, `partialR2` / 표 | 항 전체/블록 검정·df·통계량·p·기여 | 개별 더미 계수 검정과 다른 가설임을 표시 |
| `effects`, `slopes`, `contrasts` / 표·그림 | 추정 평균/확률·기울기·차이, CI·대조 보정, at/평균화 | 관측 공변량 분포와 지정 기준값 중 어느 조건인지 표시 |
| `modelFit`, `modelComparison`, `modelTests` / 표 | 적합도·ΔIC·ΔR²·비교 pair·방법·df·p·가능 여부 | 지표와 가설검정이 답하는 질문을 구분 |
| `diagnostics`, `collinearity`, `dispersion`, `zeros`, `influence`, `calibration` / 표 | 진단 수치·기준·행 ID·실패 이유; calibration 표·그림 | 표시된 기준은 검토 출발점이며 자동 제외 규칙이 아님 |
| `residuals`, `qq`, `scaleLocation`, `influence`, `zeros` / 그림 | 해당 family의 잔차·패턴·영향 | 패턴을 볼 위치를 설명; 지원 안 되는 Q–Q는 만들지 않음 |
| `selectionPath`, `selectedTerms`, `regularization`, `cv` / 표·그림 | 선택 경로·조건·계수 경로·CV 손실 | 선택 기준·후보 범위 내 결과임을 표시 |
| `selectionStability`, `resampling` / 표·그림 | 선택/부호 빈도·실패 수·모형 크기 | 선택 빈도는 참인 변수일 확률이 아님 |
| `provenance` / 표 | 옵션·버전·입력/행 fingerprint·seed·수식·코딩·대조/CI 방식 | 재실행에 필요한 조건 |

숫자는 반올림하지 않은 data.frame으로 `rs_table`에 넘긴다. 그림만 있는 보고 수치가 없도록 원 그래프 데이터/요약 표를 제공한다. coefficient plot은 0, OR/IRR plot은 1을 기준선으로 하고 비율 축은 로그 척도를 명시한다. 한국어 축·범례, `theme_minimal`, `rs_figure_size()`와 공통 크기/비율/저장 형식을 따른다. 결과가 많은 경우 모형별 그림으로 나누거나 스크롤하며 글자를 축소해 한 장에 강제로 넣지 않는다.

## 13. 예외와 알림

유효한 핵심 모형을 적합하지 못하면 그 모형은 실패로 표시한다. 기존 성공 결과를 새 결과처럼 남기지 않는다. 다른 유효한 모형과 독립적인 표·그림은 계속 만든다. 비교 표에는 제외된 모형과 이유를 남긴다. 요청한 방법을 다른 방법으로 조용히 바꾸지 않는다.

| note code | 조건과 대응 |
| --- | --- |
| `regression_invalid_outcome`, `regression_event_required` | 결과 유형/사건 코딩이 맞지 않음. 해당 모형 실행 전 해결 안내 |
| `regression_invalid_term`, `regression_missing_column` | 잘못된 term/model/열 참조. 잘못된 설정은 실행 차단 |
| `regression_invalid_exposure`, `regression_invalid_weight` | exposure/weight 정의역·의미 부적합. 임의 제외·보정 금지 |
| `regression_sample_changed` | 고정 표본 구성으로 제외된 행/N 표시 |
| `regression_rank_deficient`, `regression_no_residual_df` | alias·과도한 파라미터. 추정 불가 계수/검정 표시, 선택·부적절 비교 차단 |
| `regression_separation`, `regression_not_converged` | ML 결과를 정상 추론으로 표시하지 않음. 분리 진단/편향 감소 대안 안내 |
| `regression_backend_missing`, `regression_component_failed` | 해당 기능과 패키지/복구 방법, 다른 기능은 계속 |
| `regression_not_comparable`, `regression_not_nested` | 표본/우도/척도 또는 중첩 조건 실패. 차이 검정/IC 비교를 필요한 범위에서 제한 |
| `regression_metric_unavailable` | quasi의 AIC 등. NA와 이유로 표시 |
| `regression_overdispersion`, `regression_excess_zeros` | 진단 결과와 가능한 다음 분석. family 자동 변경 금지 |
| `regression_post_selection`, `regression_selection_incomplete` | 선택 후 추론 한계/탐색 중단 상태 |
| `regression_selection_unsupported_terms`, `regression_cv_invalid` | 항 단위 제약/CV 구성 불가. 지원 조건과 수정 방법 |
| `regression_resampling_failures`, `regression_few_clusters` | 실패율·군집 수와 추론 한계 표시 |

## 14. 재현성·AI·보안 계약

`modules/regression/{manifest.json,options.schema.json,form.json,ai.md}`와 `r-packages/rsageRegression`을 작성한다. `analyse(data, options)`는 원본·사용자 contrasts·RNG·작업 디렉터리를 바꾸지 않는다. 백엔드는 `pkg::fn()`으로 부른다. 실제 사용한 패키지 버전을 `rs_result(packages=...)`에 넣고 필요 이상의 패키지를 붙이지 않는다.

모형 적합용 formula는 검증된 term 구조로 만든 R language object를 사용한다. 열 이름에 공백·한글·백틱·수식 기호가 있어도 데이터 열로만 해석한다. 임의 `eval(parse())`, 사용자 함수 호출, 환경 객체 참조를 허용하지 않는다. formula 환경도 통제하고 필요한 데이터는 명시적으로 전달한다. `run_analysis`의 옵션 검증으로 같은 제한을 적용한다.

GUI·AI·콘솔·Quarto는 같은 `rsageRegression::analyse(data, options)`로 같은 표를 만든다. 데이터 fingerprint·행 ID·수식·factor levels·reference·변환 상수·fold ID·seed·VCOV·CI 방식·선택 scope·버전 정보를 저장한다. UI에만 존재하는 숨은 선택 상태를 두지 않는다. 저장 결과를 열 때 이전 실행의 데이터/옵션과 현재 상태가 다른지 표시한다.

`ai.md`는 영어로 쓰고 다음을 요구한다: 연구 질문/결과 유형에 맞는 family 선택, 사건/참조 범주 명시, 필요 조정변수 고정, 계수·CI·표본 수 함께 인용, 상호작용의 조건부 해석, 선택 결과의 탐색성, 동일 표본 비교 확인. “p>.05이므로 영향 없음”, “OR가 위험비”, “AIC가 작으므로 인과적으로 맞음” 같은 해석을 하지 않는다. 분석 결과 객체/CSV 저장은 공통 `enabled+saveAs`/`enabled+file` 계약과 기존 앱의 저장·승인 흐름을 따른다.

## 15. 검증 기준과 완료 조건

### 실제 계산한 기준값

아래 값은 **명세 작성 중 로컬 R 4.6.1 / MASS 7.3.66의 base R 기준 함수를 실행해 확인**했다. 모듈 검증 통과를 뜻하지 않는다. 테스트에서는 표 반올림 전 값과 비교한다. LM 계수/지표는 절대오차 1e−7, GLM은 1e−5를 시작 허용치로 하고 버전 차이가 있으면 원인을 확인한다.

| 데이터·모형 | 기준값 |
| --- | --- |
| `mtcars`, `lm(mpg ~ wt)` | intercept 37.285126167342; wt −5.344471572723; R² .752832793658; adj R² .744593886780; AIC 166.029428991876; BIC 170.426636700275 |
| `mtcars`, `lm(mpg ~ wt + hp)` | intercept 37.227270116447; wt −3.877830742405; hp −.031772946982; R² .826785451883; adj R² .814839620978; AIC 156.652338825641; BIC 162.515282436840 |
| 위 두 LM의 `anova(m1,m2)` | 추가 df=1; 잔차 df=29; F≈12.38133; p≈.0014512. 검정값은 테스트에서 직접 full precision으로 생성 |
| `mtcars`, `glm(am ~ wt + hp, family=binomial())` | 사건 am=1; intercept 18.866298717204; wt −8.083475182445; hp .036255596082; deviance 10.059110472267; AIC 16.059110472267 |
| `warpbreaks`, `glm(breaks ~ wool + tension, family=poisson())` | 참조 wool=A, tension=L; intercept 3.691963144954; woolB −.205988442649; tensionM −.321320431600; tensionH −.518488496517; deviance 210.391888762454; AIC 493.055966417958 |
| `stepAIC(lm(mpg ~ wt + hp + disp + qsec, mtcars), direction="both")` | 선택 `mpg ~ wt + hp`; 최종 AIC() 156.652338825641; extractAIC 경로 기준 63.8402727005. 두 숫자의 차이는 오류가 아님 |

기준 재생성의 출처는 R 공식 `lm`/`glm`/`anova`/`AIC` 함수와 [MASS 공식 stepAIC 문서][S14]다. JASP/SPSS와 일치한다고는 아직 주장하지 않는다. easystats 표에서 모델별 CI·df·R² 이름이 원 적합과 맞는지 별도 대조한다.

### 기능별 검증 행렬

| 영역 | 검증해야 할 사례 |
| --- | --- |
| family | 위 수치 + 집계 binomial과 펼친 자료의 계수 일치(서로 다른 응답 표현의 AIC는 직접 비교하지 않음), Gamma 양수 자료, 음이항 theta, quasi 지표 비활성 |
| term | 2/3원 상호작용과 하위 항 보존, 범주 전체 검정, 기준수준 변경 후 예측 불변, 중심화 후 예측 불변, spline knot 저장·복원 |
| comparison | LM F/GLM LRT 기준값, 비중첩·다른 link·같은 N 다른 행·변환된 outcome 비교 차단, 결측 후보 열 추가 후 공통 표본 고정, Poisson/NB 경계 검정 제한 |
| inference | LM t CI, GLM Wald/profile 표기, 동일 vcov의 계수/대조/joint test, Type III contrast·alias 조건, 선택 후 표시 보존 |
| selection | lower 강제 항 유지, 시작점/방향/기준 기록, categorical 항 전체 이동, quasi 차단, glmnet 고정 fold 재현, 계층성 불가능 조합 차단, alpha 비교에 같은 folds |
| resampling | 전체 선택 반복, 동일 seed 재현과 사용자 RNG 복원, 분리·수준 소실 반복의 실패 집계, 취소 상태·진행률 |
| failure | 분리 자료, 상수 결과, 전부 0인 count, rank deficiency, N≤rank, non-finite, 잘못된 weights/exposure, 선택 패키지 부재, 여러 모형 중 하나만 실패 |
| reproducibility | 저장·재시작 후 options/표/모형/행 ID 동일, 한국어·공백·백틱 열명, formula 문자열을 통한 코드 실행 차단, 원 데이터·전역 contrasts 불변 |
| interface | 실제 Mac에서 변수 이동·모형 복제·상호작용·비활성 사유·선택 결과 추가·취소·결과 표·그림을 확인 |
| outputs | GUI/AI/콘솔/깨끗한 Quarto 렌더의 표 값 일치, 그림 pane 표시, 크기·비율·해상도/형식 저장, fit 객체·진단 데이터 사본 exports |

실행 검증은 R testthat, 공통 `formProblems()`/host 분석 테스트, 실제 R 세션 왕복, macOS UI, 별도 세션 Quarto 렌더를 구분해 기록한다. 1.0의 완료는 1.0 행렬과 공통 계약을 모두 충족했을 때이며, 버튼이 보이거나 패키지가 설치된 것만으로 완료 처리하지 않는다.

## 16. 공식 자료와 조사 범위

Context7에서 `easystats/performance`, `easystats/modelbased`를 조회했고, glmnet/projpred는 일치하는 문서가 반환되지 않아 공식 홈페이지와 CRAN으로 보완했다. pkgdown 개발 버전과 CRAN 안정 버전은 다를 수 있으므로 구현 시 안정 버전 API를 재확인한다. 아래 자료의 기능 설명을 바탕으로 본 문서의 UX·기본값·지원 제한을 설계했다. 설계 결정은 해당 패키지의 기본 동작과 동일하다는 뜻이 아니다.

[S1]: https://easystats.github.io/parameters/reference/model_parameters.default.html
[S2]: https://easystats.github.io/performance/reference/compare_performance.html
[S3]: https://github.com/easystats/performance
[S4]: https://easystats.github.io/modelbased/reference/estimate_slopes.html
[S5]: https://stat.ethz.ch/R-manual/R-devel/library/stats/html/anova.glm.html
[S6]: https://glmnet.stanford.edu/reference/cv.glmnet.html
[S7]: https://mc-stan.org/projpred/
[S8]: https://cran.r-project.org/package=brglm2
[S9]: https://cran.r-project.org/package=rms
[S10]: https://cran.r-project.org/package=glmnet
[S11]: https://stat.ethz.ch/R-manual/R-devel/library/stats/html/family.html
[S12]: https://stat.ethz.ch/R-manual/R-devel/library/stats/html/add1.html
[S13]: https://easystats.github.io/performance/reference/r2_mcfadden.html
[S14]: https://stat.ethz.ch/R-manual/R-devel/library/MASS/html/stepAIC.html

- [parameters: 모델 계수와 CI][S1]
- [performance: 지표 비교][S2], [진단 대표 예제][S3], [McFadden R²][S13]
- [modelbased: 한계효과·평균화·기울기][S4], [상호작용 vignette](https://easystats.github.io/modelbased/articles/introduction_comparisons_3.html)
- [R: GLM 모형 비교][S5], [family 정의][S11], [계층적 항 추가/제거][S12]
- [MASS: stepAIC][S14]
- [glmnet: CV·alpha·lambda][S6], [소개 vignette](https://glmnet.stanford.edu/articles/glmnet.html), [CRAN 배포][S10]
- [projpred: 목적과 reference model][S7], [CRAN 배포](https://cran.r-project.org/package=projpred)
- [brglm2: 편향 감소와 분리][S8], [rms: 회귀 모델링 전략][S9]
