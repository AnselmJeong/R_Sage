# Data integrity check: is a data frame received as a spreadsheet fit to
# analyse? Structure, types and formats, value ranges and rules, missing
# values and duplicates, text standardisation, and optionally a cleaned copy
# and dlookr's HTML diagnosis report. The options name the checks, not
# dlookr's arguments.

#' Default options
defaults <- function() {
  list(
    variables = character(),
    keys = character(),
    required = character(),
    overview = TRUE,
    diagnose = TRUE,
    maxExamples = 5L,
    structure = list(names = TRUE, nameStyle = "auto", emptyRows = TRUE, emptyColumns = TRUE, constant = TRUE),
    format = list(numberText = TRUE, dates = TRUE, leadingZeros = TRUE),
    values = list(numeric = TRUE, outliers = TRUE, outlierPlot = TRUE, outlierRows = FALSE,
                  rareLevels = TRUE, rareShare = 1, ranges = list(), allowed = list(), order = list()),
    missing = list(summary = TRUE, pareto = TRUE, hidden = TRUE, codes = DEFAULT_CODES),
    duplicates = list(rows = TRUE, keys = TRUE),
    text = list(whitespace = TRUE, variants = TRUE, similar = FALSE, maxDistance = 1L,
                categories = FALSE, topLevels = 10L, synonyms = list()),
    clean = list(enabled = FALSE, trim = TRUE, hiddenMissing = TRUE, synonyms = TRUE, variants = TRUE,
                 numbers = TRUE, dates = TRUE, padZeros = TRUE, ruleViolations = FALSE,
                 emptyRows = TRUE, duplicates = FALSE, emptyColumns = FALSE, names = TRUE, saveAs = "data_clean"),
    report = list(enabled = FALSE, format = "web", file = "data-diagnosis.html")
  )
}

# Result sections, in the order the tab shows them.
SECTIONS <- c("요약", "구조", "형식", "값의 범위와 규칙", "결측과 중복", "텍스트", "정리한 데이터")

#' Data integrity check
#'
#' @param data A data frame.
#' @param options A list of options; see defaults(). Missing entries take their default.
#' @return An rsage result.
#' @examples
#' analyse(airquality, list(values = list(ranges = list(list(variable = "Temp", min = "0", max = "110")))))
analyse <- function(data, options = list()) {
  stopifnot(is.data.frame(data))
  o <- rsage::rs_merge_options(options, defaults())
  vars <- as.character(unlist(o$variables))
  keys <- as.character(unlist(o$keys))
  required <- as.character(unlist(o$required))
  if (!length(vars)) vars <- names(data)
  rule_vars <- unlist(lapply(c(rule_rows(o$values$ranges), rule_rows(o$values$allowed), rule_rows(o$values$order),
                               rule_rows(o$text$synonyms)),
                             function(r) c(one_name(r$variable), one_name(r$first), one_name(r$second))))
  unknown <- setdiff(c(vars, keys, required, rule_vars), names(data))
  if (length(unknown)) stop("데이터에 없는 변수: ", paste(unique(unknown), collapse = ", "))
  vars <- unique(c(vars, keys, required, rule_vars))
  # By position, so duplicate column names survive to be reported.
  d <- as.data.frame(data, stringsAsFactors = FALSE, optional = TRUE)[which(names(data) %in% vars)]
  max_ex <- as.integer(o$maxExamples)

  findings <- list()
  tables <- list()
  plots <- list()
  notes <- list()
  add <- function(x) {
    if (is.null(x)) return(invisible())
    if (inherits(x, "rsage_finding")) findings[[length(findings) + 1]] <<- x
    else if (inherits(x, "rsage_table")) tables[[x$id]] <<- x
    else if (inherits(x, "rsage_plot")) plots[[x$id]] <<- x
    else if (inherits(x, "rsage_note")) notes[[length(notes) + 1]] <<- x
    else if (is.list(x)) for (i in x) add(i)
  }

  # dlookr works on data frames with unique names; duplicates get a suffix
  # for its tables only.
  du <- d
  names(du) <- unique_names(ifelse(is.na(names(d)) | !nzchar(names(d)), "(이름 없음)", names(d)))
  diag <- as.data.frame(dlookr::diagnose(du))

  if (isTRUE(o$overview)) add(overview_table(du))
  if (isTRUE(o$diagnose)) add(rsage::rs_table("diagnose", "변수 진단", diag,
    labels = c(variables = "변수", types = "형식", missing_count = "결측 N", missing_percent = "결측 비율(%)",
               unique_count = "서로 다른 값", unique_rate = "고유 비율"),
    section = "요약",
    description = "변수마다 R이 읽은 형식과 결측, 서로 다른 값의 수입니다. 숫자여야 할 변수가 character이면 '형식' 표를, 고유 비율이 1인데 ID가 아니면 자유 입력 텍스트인지 봅니다. 값이 하나뿐인 변수는 서로 다른 값이 1입니다."))

  add(structure_checks(d, o, max_ex))
  add(format_checks(du, o, keys, max_ex))
  add(value_checks(du, o, max_ex))
  add(missing_checks(du, o, required, max_ex, diag))
  add(duplicate_checks(du, o, keys, max_ex))
  add(text_checks(du, o, max_ex))

  add(summary_table(findings))

  exports <- list()
  if (isTRUE(o$clean$enabled)) {
    cl <- clean_items(du, o, keys, stats::setNames(names(d), names(du)))
    add(cl$items)
    exports <- cl$exports
  }
  if (isTRUE(o$report$enabled)) add(diagnosis_report(du, o$report))

  # The summary leads the tab.
  tables <- c(tables["summary"], tables[names(tables) != "summary"])
  rsage::rs_result(
    "integrity", "데이터 점검",
    tables = unname(tables), plots = unname(plots), notes = notes,
    options = o, packages = c("rsageIntegrity", "dlookr"), exports = exports, sections = SECTIONS,
    data_info = list(variables = names(d), keys = keys, required = required,
                     issues = sum(vapply(findings, function(f) !is.na(f$n) && f$n > 0, TRUE)))
  )
}

overview_table <- function(d) {
  ov <- as.data.frame(dlookr::overview(d))
  ov <- ov[ov$metrics != "memory size", , drop = FALSE]
  group <- c(size = "크기", duplicated = "중복", missing = "결측", `data type` = "형식")
  metric <- c(observations = "행", variables = "변수", values = "값(셀)", `duplicate observation` = "중복 행",
              `complete observation` = "결측 없는 행", `missing observation` = "결측 있는 행",
              `missing variables` = "결측 있는 변수", `missing values` = "결측 값", numerics = "실수", integers = "정수",
              `factors/ordered` = "범주(factor)", characters = "문자", Dates = "날짜", POSIXcts = "날짜·시각", others = "기타")
  t <- data.frame(division = ifelse(is.na(group[ov$division]), ov$division, unname(group[ov$division])),
                  metrics = ifelse(is.na(metric[ov$metrics]), ov$metrics, unname(metric[ov$metrics])),
                  value = as.numeric(ov$value))
  rsage::rs_table("overview", "데이터 개요", t, labels = c(division = "구분", metrics = "항목", value = "값"), section = "요약",
                  description = "행·열 수가 원본 스프레드시트와 같은지 먼저 확인합니다. 숫자여야 할 변수가 많은데 '문자'가 많으면 아래 '형식' 점검을 봅니다.")
}

summary_table <- function(findings) {
  if (!length(findings)) return(NULL)
  t <- data.frame(
    status = vapply(findings, function(f) if (is.na(f$n)) "규칙 없음" else if (f$n > 0) "확인 필요" else "문제 없음", ""),
    group = vapply(findings, function(f) f$group, ""),
    check = vapply(findings, function(f) f$check, ""),
    n = vapply(findings, function(f) f$n, 0L),
    vars = vapply(findings, function(f) paste(utils::head(f$vars, 4), collapse = ", ") |>
                    paste0(if (length(f$vars) > 4) sprintf(" 외 %d개", length(f$vars) - 4) else ""), ""),
    fix = vapply(findings, function(f) if (!is.na(f$n) && f$n > 0) f$fix else "", "")
  )
  order <- c("확인 필요" = 1, "문제 없음" = 2, "규칙 없음" = 3)
  t <- t[order(order[t$status], match(t$group, unique(t$group))), , drop = FALSE]
  bad <- sum(t$status == "확인 필요")
  rsage::rs_table("summary", "점검 요약", t,
    labels = c(status = "결과", group = "분류", check = "점검 항목", n = "건수", vars = "해당 변수", fix = "해결 방법"),
    notes = sprintf("점검 %d개 중 %d개에서 확인할 것이 나왔습니다.", sum(t$status != "규칙 없음"), bad), section = "요약",
    description = "'확인 필요'인 항목부터 아래 자세한 표를 봅니다. 건수는 문제가 있는 값·행·이름의 수입니다. '규칙 없음'은 규칙을 정해야 점검할 수 있는 항목입니다.")
}
