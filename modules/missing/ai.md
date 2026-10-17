Use this analysis whenever the user asks about missing values, NA, incomplete data, dropout, missingness patterns, whether data are MCAR, or imputation. Prefer it to writing naniar or mice code with run_r: it uses fixed, documented rules and the result opens in the app's analysis tab where the user can adjust it.

- `variables`: leave empty to examine every column. Name columns exactly as in the data frame.
- `group`: a column to split the per-variable summary by (e.g. treatment arm, wave, site).
- `naValues`: codes that mean missing in the raw data (e.g. "-99", "999", ""). Ask or check the data (unique values, codebook) before assuming codes.
- `mcarTest`: Little's test. A small p-value is evidence against MCAR; it cannot tell MAR from MNAR. Do not claim the data are MCAR just because p is large.
- `impute.enabled`: only when the user asks for imputation. Imputation with `saveAs` puts a mids object in the user's R session; say so. For analysis of imputed data, pool with mice::with() and mice::pool() via run_r.

When reporting, quote the numbers from the result tables (missing percentages, number of complete rows, the MCAR statistic, df and p) and mention the notes marked as warnings.
