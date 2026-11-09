# 경로 분석 모듈 계획과 스펙 (`org.rsage.path`)

_2026-11-09 · 계획서 겸 스펙 · [모듈 작성 가이드](../module-authoring-guide.md) 3장 형식을 따른다._

## 0. 왜 이 모듈인가

Anselm의 요청(2026-11-09): 작은 표본에서 변수를 여러 개 다루는 일이 많다. 대표 독립변수와 종속변수를 정해 분석하는 것이 정석이지만, 실제로는 무엇을 공변인으로 써야 할지, 어떤 변수가 다른 변수와 어떻게 이어지는지, 그 연결이 직접인지 간접인지 모른다. 그래서 부정확하더라도 경로(인과 그래프)를 그려 보는 모듈이 필요하다. lavaan(lavaanExtra, blavaan)으로 분석하고 tidySEM으로 그린다.

이 모듈은 세 질문에 답한다.

1. **어떤 변수가 어떤 변수와 이어지는가?** 데이터에서 연결 구조를 찾고, 그 연결이 재표집에서 얼마나 자주 나오는지(안정성)를 함께 보인다.
2. **X가 Y에 주는 영향은 직접인가, 다른 변수를 거치는가?** 경로 모형을 lavaan으로 추정해 직접효과, 경로별 간접효과, 총효과를 신뢰구간과 함께 나눈다.
3. **X와 Y의 관계를 볼 때 무엇을 공변인으로 넣어야 하는가?** 그래프에서 교란변수(넣는다), 매개변수(총효과에서는 넣지 않는다), 충돌변수(넣지 않는다)를 가려내고, dagitty로 최소 보정 집합을 구한다. 그 공변인으로 회귀 모듈을 바로 연다.

### 정직하게 알릴 것 (모든 결과에 붙는다)

- 관측 자료에서 데이터만으로 화살표 방향을 정할 수 없다. 방향은 사용자가 정한 **변수의 순서(단계)** 에서 온다. 같은 단계 안의 연결은 방향을 정하지 않고 상관(↔)으로 둔다.
- 측정하지 않은 교란변수가 있으면 그래프와 효과 추정 모두 틀릴 수 있다.
- 구조를 찾은 데이터로 계수와 적합도를 다시 추정하므로 p값과 적합도는 낙관적이다. 찾은 구조는 확인할 가설이지 결론이 아니다.
- 작은 표본에서는 연결 안정성이 낮고, χ² 검정과 RMSEA가 불안정하다. 표본 크기 대 자유 모수 비(N:q)를 늘 보여 주고, 10 미만이면 경고한다.

### 2026-11-09 보강: 받은 전략 제안 검토

Anselm이 받은 제안(사용자 지식으로 선을 확실/애매/금지로 나누기, PC 알고리즘과 엄격한 유의수준, PLS-SEM으로 최종 확인)을 검토해 다음처럼 반영했다.

- **확실한 선 / 애매한 선 / 금지한 선**: 단계(tier)에 더해 `structure.required`(꼭 넣을 경로)와 `structure.forbidden`(넣지 않을 경로)을 둔다. 애매한 선만 데이터가 정한다.
- **PC 알고리즘과 유의수준**: `structure.algorithm: "pc"`와 `structure.alpha`(0.05, 0.01, 0.001). 다만 작은 표본에서 α를 낮추면 진짜 연결을 많이 놓치므로, 한 번의 결과 대신 부트스트랩 연결 강도를 함께 본다.
- **PLS-SEM은 넣지 않는다**: 잠재변수 없이 관측 변수만 쓰는 경로 모형에서 PLS는 회귀를 이어 붙인 것과 같아 lavaan과 계수가 거의 같고, 작은 표본의 이점 주장도 반박되었다(Goodhue, Lewis & Thompson 2012; Rönkkö & Evermann 2013). 작은 표본에는 blavaan(약한 사전분포)을 쓴다.
- **같은 자료로 찾고 확인하는 순환**: 찾기·포화 결과에는 늘 "탐색적" 알림을 붙이고, 0.2에서 확인용 분할을 넣는다.

## 1. 흐름

```
변수를 단계에 넣는다 ─▶ 구조를 정한다 ─────────────▶ lavaan으로 추정 ─▶ 효과 분해 ─▶ 공변인 안내
 (배경 → 앞 → 중간 → 결과)   · 데이터에서 찾기 (bnlearn)      (ML+부트스트랩,     (직접/간접/총)   (dagitty, 회귀 열기)
                             · 가능한 경로 모두 (포화)          또는 blavaan)
                             · 직접 지정 (경로 목록)          tidySEM 경로 그림
```

**단계(tier)가 핵심이다.** 사용자는 "무엇이 먼저 정해지는가"만 안다: 나이·성별은 배경, 치료나 노출은 앞, 증상이나 생체지표는 중간, 최종 결과는 끝. 화살표는 앞 단계에서 뒤 단계로만 간다. 이 순서 지식이 없으면 어떤 알고리즘도 방향을 정할 수 없다. 단계 상자는 JASP식 변수 상자 네 개다.

## 2. 백엔드

| 역할 | 패키지 | 필수 | 이유 |
| --- | --- | --- | --- |
| 경로 모형 추정 | lavaan | 필수 | 표준 SEM 엔진. ML, MLR, FIML, 부트스트랩, Bollen-Stine, 수정지수 |
| 모형 문법 생성 | lavaanExtra (`write_lavaan`) | 선택 | 회귀·공분산 목록에서 읽기 쉬운 lavaan 문법을 만든다. 없으면 같은 문법을 직접 만든다 |
| 작은 표본 베이지안 추정 | blavaan (`bsem`) | 선택 | 약한 정보 사전분포로 작은 표본에서 추정을 안정시키고, 사후분포로 간접효과 구간을 얻는다. rstan 필요, 수십 초 걸림 |
| 경로 그림 | tidySEM (`prepare_graph`) | 선택 | lavaan 결과를 ggplot 경로 그림으로. 단계별 배치를 넘긴다. 없으면 ggplot2로 직접 그린다 |
| 구조 찾기 | bnlearn (`boot.strength`, `tiers2blacklist`) | 선택 | 단계 순서를 금지 목록으로 넣고 부트스트랩으로 연결 안정성을 센다. 순수 R, 의존성 적음 |
| 공변인 집합 | dagitty (`adjustmentSets`) | 선택 | 그래프에서 최소 보정 집합. 없으면 노출의 부모(관측 변수만 있는 DAG에서 늘 유효)를 쓴다 |
| 그림 공통 | ggplot2 | 필수 | |

검토하고 뺀 것: pcalg(Bioconductor 의존성 graph·RBGL가 무겁다, bnlearn의 `pc.stable`로 대신), qgraph·bootnet 편상관 네트워크(방향이 없어 이 질문에 덜 맞다, 예정으로 표시), semPlot(tidySEM이 ggplot이라 앱 그림 규칙과 맞다).

## 3. 대표 활용법 (백엔드 문서에서)

| # | 활용법 | 출처 | 함수 |
| --- | --- | --- | --- |
| 1 | 단순 매개 X→M→Y, 간접효과를 정의(`:=`)하고 부트스트랩 구간 | lavaan 튜토리얼 "Mediation" (https://lavaan.ugent.be/tutorial/mediation.html) | `sem(se = "bootstrap")`, `parameterEstimates(boot.ci.type = "perc")` |
| 2 | 경로 분석 다중 회귀식과 적합도 | lavaan 튜토리얼 "SEM", "fit measures" | `sem`, `fitMeasures` |
| 3 | 결측에 FIML | lavaan 튜토리얼 "Missing data" | `sem(missing = "fiml")` |
| 4 | 작은 표본·비정규 χ² 대신 Bollen-Stine 부트스트랩 | lavaan 문서 `test = "bollen.stine"` | `sem(test = "bollen.stine")` |
| 5 | 빠졌을 수 있는 경로 찾기 | lavaan `modindices` | `modindices(sort = TRUE)` |
| 6 | 목록으로 문법 쓰기(매개, 회귀, 공분산, 간접효과) | lavaanExtra README (https://lavaanextra.remi-theriault.com/) | `write_lavaan` |
| 7 | 베이지안 SEM, 사전분포, PPP, Rhat | blavaan 홈페이지 (https://ecmerkle.github.io/blavaan/) | `bsem(dp = dpriors(...))`, `blavInspect(fit, "rhat")`, `fitMeasures(fit, "ppp")` |
| 8 | 배치를 정한 경로 그림, 유의 경로 강조 | tidySEM vignette "Plotting graphs for structural equation models" (https://cjvanlissa.github.io/tidySEM/articles/Plotting_graphs.html) | `get_layout`, `prepare_graph`, `edges()`, `hide_var` |
| 9 | 배경 지식(순서)을 넣은 구조 학습 | bnlearn 예제 "tiers2blacklist" (https://www.bnlearn.com/examples/) | `tiers2blacklist`, `hc`, `pc.stable` |
| 10 | 부트스트랩 모형 평균, 연결 강도와 방향 | bnlearn "model averaging" 예제, Scutari & Nagarajan (2013) | `boot.strength`, `averaged.network` |
| 11 | 보정 집합, 직접효과용 집합 | dagitty 문서 (https://www.dagitty.net/manual-3.x.pdf) | `adjustmentSets(effect = "total" / "direct")` |

## 4. 활용법 → 옵션 → 결과

| # | 옵션 | 결과 (section) |
| --- | --- | --- |
| 1 | `structure.source: "specified"`, `paths`, `focus.*`, `estimation.inference: "bootstrap"` | 표 `effects` (효과 분해), 그림 `effects` |
| 2 | 어떤 구조든 | 표 `coefficients`, `r2` (경로 계수), `fit` (모형 적합) |
| 3 | `estimation.missing: "fiml"` | 표 `sample`, `overview` |
| 4 | `fit.bollenStine` | 표 `fit`의 Bollen-Stine p |
| 5 | `fit.modindices` (단계를 거스르는 제안은 뺌) | 표 `modindices` (모형 적합) |
| 6 | 늘 (lavaanExtra 있으면) | 표 `syntax` (재현 정보) |
| 7 | `estimation.method: "bayes"`, `estimation.bayes.*` | 표 `coefficients`(사후 평균, 95% 신용구간, Rhat), `fit`(PPP), 효과 구간은 사후 표본으로 |
| 8 | `plots.diagram`, `plots.labels` | 그림 `diagram` (경로 계수) |
| 9 | `structure.source: "learned"`, `structure.algorithm`, `structure.score`, `variables.*`(단계) | 표 `stability`, 그림 `stability` (구조 찾기) |
| 10 | `structure.bootstrap`, `structure.threshold` | 표 `stability`의 강도·방향·채택 |
| 11 | `focus.exposure`, `focus.outcome`, `covariates.guide` | 표 `roles`, `adjustment` (공변인 안내), 카드와 회귀 열기 버튼 |

뺀 것: lavaan의 잠재변수(측정 모형)는 이 모듈 범위 밖이다(요인분석·SEM 모듈 예정). 다집단 경로 분석, 조절된 매개도 다음 버전("예정"으로 표시).

## 5. 변수 역할

| 역할 | bind | 종류 |
| --- | --- | --- |
| 1단계: 배경 (먼저 정해진 것: 나이, 성별) | `variables.background` | 여럿 |
| 2단계: 앞선 변수 (원인·노출 후보) | `variables.early` | 여럿 |
| 3단계: 중간 변수 (매개 후보) | `variables.middle` | 여럿 |
| 4단계: 결과 | `variables.outcome` | 여럿 |

받는 유형: 수치, 논리, 범주(두 수준이면 0/1로 바꾸고 알림, 순서 범주는 순서 번호로, 세 수준 이상의 범주는 빼고 알림). 직접 지정 모드에서는 단계가 비어도 되며, 경로 목록에 나온 변수를 쓴다(그림 배치는 경로 깊이로).

## 6. 옵션

| bind | 유형 · 기본값 | 설명 | 백엔드 |
| --- | --- | --- | --- |
| `structure.source` | `learned` / `saturated` / `specified` · `learned` | 구조를 데이터에서 찾기 / 단계 순서상 가능한 경로 모두 / 직접 지정 | |
| `structure.algorithm` | `hc` / `tabu` / `pc` · `hc` | 점수 기반 언덕 오르기, 타부 탐색, 제약 기반 PC-stable | `bnlearn::hc`, `tabu`, `pc.stable` |
| `structure.score` | `bic` / `aic` / `bge` · `bic` | BIC는 보수적(작은 표본 권장), AIC는 연결을 더 많이, BGe는 베이지안 | `score = "bic-g"` 등 |
| `structure.bootstrap` | 정수 · 200 | 재표집 횟수 | `boot.strength(R =)` |
| `structure.threshold` | `"auto"`, `"0.5"`~`"0.9"` · `"auto"` | 채택할 연결 강도. auto면 Scutari·Nagarajan 추정 | `averaged.network` |
| `structure.withinTier` | `covary` / `learn` · `covary` | 같은 단계 안 연결: 상관으로 둠 / 데이터로 방향 추정(불안정) | |
| `structure.alpha` | `"0.05"` / `"0.01"` / `"0.001"` · `"0.05"` | PC-stable 독립성 검정의 유의수준. 낮추면 확실한 연결만 남지만 진짜 연결도 놓친다 | `pc.stable(alpha =)` |
| `structure.required` | 줄 목록 `{from, to}` · [] | 꼭 넣을 경로(확실한 선). 찾기에서 whitelist, 포화에서도 추가. 단계 순서를 거스르면 거부 | `whitelist` |
| `structure.forbidden` | 줄 목록 `{from, to}` · [] | 넣지 않을 경로(아닐 것이 분명한 선). 어느 방향으로도 잇지 않음 | `blacklist` |
| `paths` | 줄 목록 `{from, to, type}` · [] | 직접 지정: `regression`(→) 또는 `covariance`(↔) | lavaan 문법 |
| `focus.exposure`, `focus.outcome` | 열 · null | 효과를 나누고 공변인을 안내할 X와 Y | |
| `estimation.method` | `ml` / `bayes` · `ml` | 최대우도 / 베이지안(blavaan) | `lavaan::sem`, `blavaan::bsem` |
| `estimation.scale` | `standardized` / `raw` · `standardized` | 표준화한 자료로 적합(계수가 SD 단위) / 원래 단위 | |
| `estimation.missing` | `listwise` / `fiml` · `listwise` | 결측 행 빼기 / FIML(구조 찾기는 늘 완전한 행) | `missing = "fiml"` |
| `estimation.inference` | `bootstrap` / `standard` / `robust` · `bootstrap` | 효과 구간: 부트스트랩 백분위 / ML 표준오차로 몬테카를로 / MLR 강건 표준오차로 몬테카를로 | `se = "bootstrap"`, `estimator = "MLR"` |
| `estimation.bootstrap` | 정수 · 1000 | 부트스트랩·몬테카를로 횟수 | |
| `estimation.bayes.prior` | `weak` / `moderate` / `strong` · `moderate` | 경로 계수 사전분포 normal(0,10) / normal(0,1) / normal(0,0.5) (표준화 자료 기준) | `dpriors(beta =)` |
| `estimation.bayes.chains`, `burnin`, `draws` | 3, 1000, 1000 | MCMC 설정 | `bsem(n.chains, burnin, sample)` |
| `seed` | 정수 · 2026 | 재표집과 MCMC의 난수 | |
| `output.coefficients`, `output.r2`, `output.allEffects` | true, true, true | 경로 계수, 설명된 분산, 모든 변수 쌍의 총·직접·간접효과 | `parameterEstimates`, `lavInspect(fit, "r2")` |
| `fit.indices`, `fit.bollenStine`, `fit.modindices` | true, false, false | 적합도, Bollen-Stine 부트스트랩 p, 수정지수 상위 10개 | `fitMeasures`, `modindices` |
| `covariates.guide` | true | X·Y 기준 변수 분류와 보정 집합 | `dagitty::adjustmentSets` |
| `plots.diagram`, `plots.stability`, `plots.effects` | true, true, true | 경로 그림, 연결 안정성 그림, 효과 분해 그림 | `tidySEM::prepare_graph` |
| `plots.labels` | `std` / `stars` / `none` · `std` | 경로 그림의 숫자: 계수 / 계수+별표 / 없음 | |
| `export.model` | `{enabled, saveAs}` · 꺼짐, `path_model` | 적합한 lavaan(blavaan) 객체를 세션에 저장 | |

## 7. 결과

section 순서: `분석 개요` → `구조 찾기` → `경로 계수` → `효과 분해` → `공변인 안내` → `모형 적합` → `재현 정보`.

| id | 종류 | section | 읽는 법 |
| --- | --- | --- | --- |
| `overview` | 표 | 분석 개요 | 구조를 정한 방식, 변수와 단계, N, 자유 모수 q, N:q, 추정 방법 |
| `sample` | 표 | 분석 개요 | 결측으로 뺀 행, 변환한 변수 |
| `stability` | 표 | 구조 찾기 | 변수 쌍마다 연결 강도(재표집에서 나온 비율), 방향, 방향을 정한 근거(단계/데이터/없음), 채택 |
| `stability` | 그림 | 구조 찾기 | 선 굵기와 진하기 = 연결 강도, 채택 안 된 연결은 점선 회색 |
| `coefficients` | 표 | 경로 계수 | 경로(→)와 상관(↔)의 추정값, 표준오차, 95% 구간, p (베이지안: 사후 평균, 사후 SD, 95% 신용구간, Rhat) |
| `r2` | 표 | 경로 계수 | 각 내생 변수의 설명된 분산 |
| `diagram` | 그림 | 경로 계수 | 왼쪽에서 오른쪽으로 단계. 파랑은 양, 빨강은 음, 점선은 구간이 0을 포함 |
| `effects` | 표 | 효과 분해 | X→Y 직접효과, 경로별 간접효과, 간접 합, 총효과와 구간, 총효과 중 비율 |
| `effects` | 그림 | 효과 분해 | 위 표의 점과 구간 |
| `all_effects` | 표 | 효과 분해 | 경로가 있는 모든 쌍의 직접·간접·총효과(총효과 구간 포함), 총효과 크기 순 |
| `roles` | 표 | 공변인 안내 | X·Y를 기준으로 다른 변수가 교란·매개·충돌·결과의 다른 원인·노출의 다른 원인·노출의 결과·무관 중 무엇인지, 총효과를 볼 때 넣을지 |
| `adjustment` | 표 | 공변인 안내 | 총효과와 직접효과의 최소 보정 집합 |
| `fit` | 표 | 모형 적합 | χ², df, p, CFI, TLI, RMSEA(90% 구간), SRMR, AIC, BIC, 기준값과 작은 표본 주의. 포화 모형(df = 0)은 적합도가 의미 없다고 적는다. 베이지안은 PPP |
| `modindices` | 표 | 모형 적합 | 더하면 χ²가 가장 많이 줄 경로 10개와 예상 변화. 단계를 거스르는 경로는 뺀다 |
| `syntax` | 표 | 재현 정보 | 추정에 쓴 lavaan 문법 한 줄씩 |
| `provenance` | 표 | 재현 정보 | 방법, 난수, 패키지 |

카드(`hints`): X·Y를 고르면 "X → Y: 총효과 중 간접효과 비율"과 "공변인 제안" 카드가 결과 맨 위에 나온다. 공변인 카드에는 **이 공변인으로 회귀 열기** 버튼(`rs_suggest`, 회귀 모듈, Y = 결과, X + 보정 집합 = 설명변수)이 붙는다.

## 8. 알림과 예외

| code | 상황 | 동작 |
| --- | --- | --- |
| `path_need_variables` | 변수가 둘 미만 | 결과 없이 안내 |
| `path_one_tier` | 찾기·포화에서 모든 변수가 한 단계 | 방향을 정할 수 없다고 알림, 상관만 남김 |
| `path_dropped_variable` | 세 수준 이상 범주, 값이 하나뿐인 변수 | 빼고 알림 |
| `path_recoded` | 두 수준 범주 → 0/1, 순서 범주 → 번호 | 정보 알림 |
| `path_small_sample` | N:q < 10 (N < 5q면 강한 경고) | 경고 |
| `path_unstable_learning` | 찾기에서 N < 5 × 변수 수 | 경고 |
| `path_backend_missing` | bnlearn, blavaan, tidySEM, dagitty, lavaanExtra 없음 | 대안(포화 구조, ML, ggplot2 그림, 노출의 부모, 직접 만든 문법)으로 계속하고 알림 |
| `path_isolated` | 연결이 없는 변수 | 모형에서 빼고 알림 |
| `path_saturated` | df = 0 | 적합도는 의미 없다고 알림 |
| `path_not_converged` | lavaan·blavaan 수렴 실패, Rhat > 1.05 | 경고 |
| `path_no_route` | X에서 Y로 가는 경로가 없음 | 효과 0으로 두지 않고 알림 |
| `path_many_routes` | 간접 경로가 20개 초과 | 상위 20개와 합만 |
| `path_exploratory` | 찾기·포화 모드 | 늘: 구조는 확인할 가설이다 |

## 9. 앱과 이어지기

- 분석 메뉴: 새 분류 **구조방정식** 아래 "경로 탐색"(찾기), "경로 분석"(직접 지정) 두 명령. 같은 분석을 `structure.source` 미리 정해 연다.
- 탐색 안내: 목표 변수가 있고 수치 변수가 넷 이상이면 목표 카드에 "경로 탐색 열기" 제안(목표 = 결과 단계, 관련 큰 변수 = 앞 단계)을 더한다. 단계는 사용자가 고친다.
- 어시스턴트: `ai.md`에 사용 시점, 단계를 사용자에게 묻는 법(시간 순서, 바꿀 수 없는 것), 결과를 말할 때 "인과"라고 단정하지 않는 법을 적는다. 찾은 구조를 바꿔 다시 볼 때는 `structure.source: "specified"`와 `paths`로 실행한다.

## 10. 단계

| 버전 | 내용 |
| --- | --- |
| 0.1 (#53) | 위 전부: 찾기·포화·지정, ML·부트스트랩·몬테카를로, blavaan, tidySEM 그림, 효과 분해, 공변인 안내, 수정지수, 탐색 안내 제안 |
| 0.2 | 확인용 분할(찾기는 한쪽, 추정은 다른 쪽), 찾은 구조를 경로 목록으로 옮겨 편집하는 버튼 (아래 12절) |
| 0.3 | 다집단 비교 |
| 이후 | 잠재변수 SEM, 조절된 매개, 순서형 내생 변수(WLSMV), 편상관 네트워크 |

## 11. 검증

- R 테스트: 알려진 구조(age → x → m → y, x → y)로 만든 자료(n = 300)에서 찾기가 주요 연결을 찾고 단계를 거스르는 화살표가 없는지; 지정 모드의 간접효과가 lavaan `:=` 결과와 같은지(a×b); 총효과 = 직접 + 간접; 공변인 분류(교란 age, 매개 m, 충돌 변수); 보정 집합이 dagitty와 같은지; 백엔드가 없을 때 대안과 알림; 범주 변환; 결측 FIML; 작은 표본 경고.
- 앱 테스트: form 검사, 실제 R 세션 실행, 탐색 안내 제안이 이 모듈 스키마를 통과하는지.
- Mac 확인: blavaan·tidySEM·lavaanExtra는 클라우드 컨테이너에 설치할 수 없어(CRAN 차단) Mac에서 확인한다. 한글 변수 이름 그림(ragg).

## 12. 0.2: 확인용 분할과 찾은 구조 고치기 (2026-11-09)

**확인용 분할** (`confirm.enabled`, `confirm.fraction` "0.5" / "0.6" / "0.7", 구조 정하기 절의 "나눠서 찾고 확인하기")

- 결측 없는 행을 `seed`로 무작위로 나눈다. 찾기용(비율만큼)에서 bnlearn이 구조를 찾고, 겹치지 않는 확인용 행에서 lavaan/blavaan이 계수·구간·적합도를 추정한다. FIML이면 결측이 있는 행도 확인용 쪽에 들어간다(구조 찾기는 늘 결측 없는 행).
- 같은 seed, 비율, 변수면 늘 같은 행으로 나뉜다. 그래서 포화·직접 지정 모드에서 이 옵션을 켜면 확인용 행만으로 추정하고(`path_split` 알림), 찾기용 행에서 얻은 경로 목록을 그대로 확인할 수 있다.
- 한쪽이 10행보다 작아지면 나누지 않고 알린다(`path_split_too_small`). 분석 표본 표, 개요, 재현 정보에 두 부분의 행 수를 적고, 탐색적 알림 문구를 "같은 자료를 두 번 쓴 낙관은 없고 대신 구간이 넓다"로 바꾼다.
- 표본이 반으로 주는 대가가 크므로 기본은 꺼 둔다. 작은 표본에서는 연결 강도 표가 주된 안정성 근거이고, 분할은 표본이 충분할 때(대략 변수당 20행 이상) 쓴다.

**찾은 구조를 경로 목록으로 열기**

- 찾기 모드 결과에 "찾은 구조" 카드(화살표·상관 수, 주요 화살표)를 더하고, 버튼 "이 구조를 경로 목록으로 열기"는 `structure.source: "specified"`, 채택한 연결을 담은 `paths`, 같은 단계·노출/결과·추정·seed·분할 옵션으로 새 탭을 연다. 사용자는 경로 목록에서 화살표를 더하거나 빼고 방향을 바꿔 다시 추정한다.
- 분할을 켰다면 카드에 "확인용 행에서 화살표 k개 중 j개의 95% 구간이 0을 포함하지 않음"을 적는다.
