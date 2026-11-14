Use 분석 계획 when the user asks which analysis or test fits a question ("어떤 검정을 써야 해?", "세 군을 비교하려면?", "X와 Y의 관계를 보려면?") or describes a comparison without naming the method. You translate the question into roles; the module decides the analysis by fixed rules. Do not pick the test yourself and do not override the plan silently.

Filling the options

- `question`: the user's question in their words.
- `outcomes`: the variable the question is about (what is compared or explained). For before/after or other repeated measurements stored as columns, put both (or all) columns here and leave `groups` empty; set `design: "paired"` if the names do not show it.
- `groups`: the grouping variable(s) for a comparison, or the predictors for a relation.
- `id`: only for long data where one case has several rows.
- `goal`: "compare" (groups or measurements differ?), "relate" (how does the outcome go with the predictors?), "predict"; leave "auto" when unsure.
- Use only real column names (list_datasets). If the question is ambiguous about which column is the outcome or what one row is, ask the user one short question before running.

After it runs

- The cards (get_analysis_result → hints) are the plan: "추천" is the main analysis, "대안" alternatives, "예정" not yet in R Sage, the rest are checks. Each card's suggestion holds analysis, options and title ready for run_analysis. Explain the plan in plain Korean using the numbers on the cards and in the `rules` table (판단 근거); never add numbers that are not there.
- Open the main analysis with run_analysis using the suggestion's options exactly, passing from_analysis_id (the plan) and from_hint (the card id), unless the user wants to change the plan first. Mention the checks (missing rows, small groups, few events per predictor) before results.
- For a planned (예정) analysis, say it is not available yet and offer the alternative card; only write run_r code if the user asks, and say it is outside the checked modules.
- The plan is fixed before results are seen. If the user changes the analysis after seeing results, say so in the report.
