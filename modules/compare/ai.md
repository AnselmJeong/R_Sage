Use these analyses for group comparisons instead of writing t.test/aov/chisq.test code with run_r. If the user has not decided which test fits their question, run 분석 계획 (org.rsage.plan/plan) first: it profiles the variables and picks the analysis and options by fixed rules.

t tests (org.rsage.compare/ttests)

- `test: "independent"`: `variables` (numeric, one test each) and `group` (exactly two levels). Keep the default `tests.welch: true`; Welch is valid with equal or unequal variances, so do not choose between Student and Welch from a variance test.
- `test: "paired"`: two columns measured on the same cases go in `pairs` as `[{first, second}]`; the difference is first - second. Long data (one row per measurement with an ID) cannot be used directly; say so and suggest reshaping, or a mixed model (planned).
- `test: "one_sample"`: `variables` and `mu`.
- `tests.nonparametric` adds Mann-Whitney U (independent) or Wilcoxon signed-rank (paired, one sample). Its estimate is the Hodges-Lehmann location shift, not a difference of medians.
- `effectSize.type`: "d" (default) or "g" for small samples. Paired tests report d_z.
- `alternative`: one-sided only when the user fixed the direction before seeing the data.

Analysis of variance (org.rsage.compare/anova)

- `dependent` (numeric) and `factors` (one or two categorical variables). Between-subjects only; repeated measures are not supported (say so).
- One factor: `tests.classic` (F), `tests.welch` (unequal variances; recommended when group SDs differ by more than 2x), `tests.kruskal` (ranks). Post hoc: `posthoc.tukey` (equal variances), `posthoc.gamesHowell` (with Welch), `posthoc.dunn` (with Kruskal-Wallis).
- Two factors: classic F with type III sums of squares (needs car); the main effects are averaged over the other factor's levels, so with a clear interaction describe the cell means instead.
- Effect sizes: eta squared, partial eta squared, omega squared (partial with two factors), rank epsilon squared for Kruskal-Wallis.

Contingency table (org.rsage.compare/frequencies)

- `rows` (usually the group) and `columns` (usually the outcome). `tests.fisher: "auto"` adds Fisher's exact test when more than 20% of the expected counts are below 5; report Fisher then.
- Cramer's V with CI; for 2x2 tables the odds ratio compares the first row level with the second, for the first column level.

Reporting

Quote numbers from the result tables: the test statistic with its df and p, the estimate with its CI, and the effect size with its CI. Mention the hint cards ("확인할 것"): they say which assumption failed and what was switched on. Do not say "no difference" from a large p-value; say the data are compatible with a range of differences given by the CI. Do not claim causation from group differences in observational data.
