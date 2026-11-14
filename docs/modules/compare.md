# 집단 비교 모듈 스펙 (`org.rsage.compare`)

_2026-11-14 · [모듈 작성 가이드](../module-authoring-guide.md) 3장의 형식_

## 1. 목적

집단이나 측정 사이의 차이를 검정하고, 얼마나 큰지(효과크기와 신뢰구간) 보여 준다. 가정 점검이 실패하면 무엇을 켤지 "확인할 것" 카드로 알리고, 카드의 버튼이 그 옵션으로 다시 연다. 어떤 분석을 고를지는 [분석 계획](plan.md)이 정한다.

R 패키지 `rsageCompare` 하나에 분석 세 개가 있다.

| 분석 | 메뉴 | 함수 |
| --- | --- | --- |
| `ttests` | T 검정 › 독립표본·대응표본·일표본 t 검정 (`test` 프리셋) | `analyse_ttests` |
| `anova` | 분산분석 › 일원·이원 분산분석, Kruskal–Wallis | `analyse_anova` |
| `frequencies` | 빈도 › 교차표 | `analyse_frequencies` |

## 2. 백엔드

- **stats**: `t.test`, `wilcox.test`, `lm`/`anova`, `oneway.test`, `kruskal.test`, `TukeyHSD`, `chisq.test`, `fisher.test`, `shapiro.test`.
- **effectsize** (필수): Cohen d, Hedges g, 순위이연 r, Cramér V와 신뢰구간.
- **car** (선택): 이원 분산분석의 유형 III 제곱합. 없으면 유형 I로 계산하고 알린다.
- 직접 계산: Games–Howell, Dunn(동순위 보정, `p.adjust`), Brown–Forsythe(중앙값 편차의 분산분석), η²·부분 η²·ω², 순위 ε²(H/(n−1)), 2×2 오즈비(Woolf 구간, 빈 칸이 있으면 0.5 더함).

## 3. 결과

| 분석 | 표 | 그림 | 확인할 것 카드 |
| --- | --- | --- | --- |
| t 검정 | `tests`(통계량, 자유도, p, 차이와 CI, 효과크기와 CI), `descriptives`, `normality`, `variance` | `means`(개별 값, 평균, CI; 대응은 선으로 이음), `qq` | 작은 표본(n < 30)의 정규성 → 순위 검정 켜기; Student만 켰는데 분산이 다름 → Welch 켜기; n < 10 |
| 분산분석 | `anova`(고전 F, Welch, Kruskal–Wallis와 효과크기), `posthoc`, `descriptives`, `normality`(잔차), `variance` | `means`(이원이면 상호작용 그림), `qq` | 분산이 다름 → Welch + Games–Howell; 작은 표본의 정규성 → Kruskal–Wallis + Dunn; 셋 이상인데 사후 비교 없음 |
| 교차표 | `crosstab`(행마다 빈도, 행·열·전체 %, 기대 빈도, 표준화 잔차), `tests`, `effect`(Cramér V, 오즈비) | `bars`(100% 누적 또는 나란히) | Fisher를 끈 채 기대 빈도 < 5가 20% 초과; 사례 5개 미만 범주 |

Fisher 검정은 기본이 `auto`(기대 빈도 < 5인 칸이 20%를 넘을 때)다. 2×2가 아니고 표본이나 칸이 크면 모의 p(10,000회)로 계산한다.

## 4. 원칙

- 독립 두 집단의 기본은 Welch다. 등분산 검정으로 Student와 Welch를 고르지 않는다(두 단계 검정은 오류율을 틀어지게 한다).
- 사전 정규성 검정으로 검정을 바꾸지 않는다. 작은 표본에서 정규성이 의심될 때 순위 검정을 "함께" 보도록 권한다.
- 반복측정 분산분석, Friedman, 혼합모형은 이 모듈에 없다(예정). 긴 형식 자료는 분석 계획이 혼합모형(예정)과 넓은 형식 변환을 안내한다.

## 5. 검증

`r-packages/rsageCompare/tests/testthat`: `t.test`, `oneway.test`, `kruskal.test`, `TukeyHSD`, `chisq.test`와 같은 값; Games–Howell(PlantGrowth trt1–trt2 p = .0237), Dunn(z = −2.807, FSA와 같음); ToothGrowth 이원 분산분석 유형 III F = 15.57, 92.00, 4.11; 2×2 오즈비; 가정 실패 카드와 그 옵션. 앱 테스트(`analysis.test.ts`): form·스키마·프리셋 검사, 분석 계획 카드로 연 분산분석이 실제 R 세션에서 실행됨.
