Use this analysis when the user has just read in a spreadsheet or CSV, asks whether data are clean, valid or consistent, mentions data integrity, data cleaning, data quality, wrong types, numbers read as text, date formats, IDs losing leading zeros, outliers or impossible values, duplicates, typos or inconsistent spellings. Run it before other analyses on freshly imported data. Prefer it to writing checks with run_r: its rules are fixed and documented, and the result opens in the app's analysis tab.

- `variables`: leave empty to check every column. `keys`: columns that together identify a row (customer ID, order number); enables the duplicate-key check and treats numeric keys as codes for the leading-zero check. `required`: columns that must never be blank.
- Rules need facts you may not know. Ask the user or read the codebook before inventing them:
  - `values.ranges`: `[{variable, min, max}]`; min/max are text, numbers or YYYY-MM-DD; either may be "".
  - `values.allowed`: `[{variable, values}]`; values separated by commas or |, e.g. "남, 여".
  - `values.order`: `[{first, op, second}]` with op one of < <= == != >= >, e.g. order date <= delivery date.
  - `text.synonyms`: `[{variable, values, to}]`; variable null applies to every text column; matching ignores case and spacing.
- `missing.codes`: text codes match ignoring case; numeric codes (-99, 999) are only flagged when they are the column's minimum or maximum. Adjust the list when the codebook names other codes.
- `text.suspectSynonyms` (on by default) lists values that probably mean the same thing without any rule (남/남자/M, Y/예/O, 한국/KOREA, 서울/서울시). They are candidates: confirm with the user before turning them into `text.synonyms` rules.
- `text.similar` (edit-distance typo search) is off by default because it can flag real, different names; turn it on when the user asks about typos.
- `clean.enabled` saves a cleaned copy as `clean.saveAs` (default `data_clean`) in the user's R session; say so. The original data frame never changes. Leave `clean.ruleViolations` off unless the user agrees that rule-breaking values should become NA. `clean.duplicates` drops exact duplicate rows only.
- `report.enabled` writes dlookr's HTML diagnosis report to `report.file` (relative to the working directory) in a separate R process; it takes tens of seconds and needs rmarkdown and pandoc.
- For missing-data patterns, MCAR tests or imputation, use the missing-data analysis instead; this one only counts and flags missing values.

When reporting, start from the `summary` table (rows with status 확인 필요, their counts, variables and suggested fixes), then quote the detail tables. An outlier is a value to verify, not an error; don't call it wrong unless a rule or the user says so. Ambiguous day/month order cannot be resolved from the data; ask the user. Each table and plot carries a `description` saying how to read it.
