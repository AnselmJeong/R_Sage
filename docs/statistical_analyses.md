일반적인 연구(Research)에서 자주 사용하는 통계 작업을 체계적으로 모듈화하기 위해, 데이터의 특성과 분석 목적에 따라 총 7개의 핵심 카테고리로 분류할 수 있습니다.
JASP의 기본 모듈 구조에 질문자님이 말씀하신 고급 분석 요소를 포함하여 구성한 세부 모듈 목록입니다.

1. 기술 및 탐색적 분석 (Descriptives & Exploratory)

• Descriptives: 연속형 변수의 평균, 표준편차, 왜도, 데이터 분포 확인
• Frequencies: 범주형 변수의 빈도 분석, 교차분석, 카이제곱 검정
• EDA: 시각화 중심의 탐색적 데이터 분석 및 이상치 검출

2. 집단 비교 및 가설 검정 (Group Comparison)

• T-Tests: 두 집단 간의 평균 비교 (독립표본, 대응표본, 단일표본)
• ANOVA: 세 집단 이상의 평균 비교 (일원, 이원, 반복측정 분산분석)
• Non-Parametric: 정규성을 만족하지 못하는 경우의 비모수 검정

3. 관계 및 회귀 분석 (Relationship & Regression)

• Correlation: 변수 간의 선형적 연관성을 파악하는 상관관계 분석
• Regression: 독립변수가 종속변수에 미치는 영향을 규명하는 선형/로지스틱 회귀분석
• Mixed Models: 고정 효과와 변량 효과를 모두 고려하는 혼합 모형 분석

4. 다변량 및 고급 구조 분석 (Multivariate & Structural)

• Factor: 요인분석 (EFA/CFA) 및 주성분분석(PCA)을 통한 변수 축소
• SEM: 변수 간의 복잡한 인과관계를 구조적으로 검정하는 구조방정식 모델링
• Network: 변수 또는 개체 간의 연결 패턴을 시각화하고 분석하는 네트워크 분석
• Cluster: 유사한 특성을 가진 개체들을 그룹화하는 군집분석

5. 특수 목적 및 데이터 분석 (Specialized Analysis)

• Time Series: 시간에 따라 변하는 데이터의 패턴을 분석하고 예측 (ARIMA 등)
• Meta-Analysis: 기존 여러 연구의 정량적 결과를 종합하여 결론을 도출하는 메타분석
• Survival: 특정 사건이 발생하기까지 걸리는 시간을 분석하는 생존분석 (Cox 비례위험 모형)

6. 예측 분석 및 머신러닝 (Predictive Analytics & ML)

• Machine Learning: 지도/비지도 학습 기반의 분류(Classification) 및 회귀(Regression) 예측 모형
• Text Mining: 텍스트 데이터 기반의 감성 분석, 토픽 모델링

7. 연구 설계 및 데이터 품질 (Research Design & Quality)

• Power Analysis: 연구 시작 전 적정 표본 크기를 산출하거나 사후 검정력을 계산
• Reliability: 설문 문항 등의 내적 일관성을 평가하는 신뢰도 분석 (Cronbach's \(\alpha \))

---

## R Sage 모듈 단위로 묶기

[analysis-modules-strategy.md](analysis-modules-strategy.md)의 구조에서는 위의 각 항목이 **분석**이고, 비슷한 입력·결과를 쓰는 분석을 하나의 **모듈**(manifest + R 패키지)로 묶는다. 위 7개 범주를 그대로 모듈 경계로 쓰지 않고, 의존성과 유지보수 책임이 같이 움직이는 단위로 나눈다.

| 모듈 (제안 ID) | 포함 분석 | 주요 R 의존성 |
| --- | --- | --- |
| `org.rsage.descriptives` | Descriptives, Frequencies, EDA | base, stats, graphics |
| `org.rsage.ttests` | T-Tests (독립·대응·단일), 비모수 대응 검정 | stats |
| `org.rsage.anova` | ANOVA (일원·이원·반복측정), 비모수 집단 비교 | stats, car, afex |
| `org.rsage.regression` | Correlation, 선형·로지스틱 회귀 | stats |
| `org.rsage.mixed` | Mixed Models | lme4 |
| `org.rsage.factor` | EFA, CFA, PCA, Reliability | psych, lavaan |
| `org.rsage.sem` | SEM | lavaan |
| `org.rsage.network` | Network | qgraph, bootnet |
| `org.rsage.cluster` | Cluster | stats, cluster |
| `org.rsage.timeseries` | Time Series | stats, forecast |
| `org.rsage.meta` | Meta-Analysis | metafor |
| `org.rsage.survival` | Survival (Kaplan–Meier, Cox) | survival |
| `org.rsage.ml` | Machine Learning | tidymodels 계열 |
| `org.rsage.text` | Text Mining | 후속 결정 |
| `org.rsage.power` | Power Analysis | pwr |

첫 구현은 Descriptives이고, 두 번째는 입력·결과 요구가 다른 T-Tests 또는 Regression이다. 의존성 목록은 제안이며 각 모듈을 구현할 때 확정한다.
