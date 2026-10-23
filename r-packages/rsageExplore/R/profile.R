# What each variable is (its kind) and how the data set is laid out:
# scale item groups, repeated measures in long or wide form, IDs.

KIND_LABEL <- c(empty = "빈 열", constant = "값이 하나", id = "ID", date = "날짜·시각", text = "자유 텍스트",
                binary = "이분", categorical = "범주", ordinal = "순서 척도", integer = "정수",
                continuous = "연속", other = "기타")

ID_NAME <- "(^|[_. ])(id|no|num|number|code|key|번호|코드|아이디)$|^(id|no)([_. ]|$)|^(subject|patient|participant|case|record|환자|대상자)([_. ]?(id|no|번호))?$"
# Names that say "one person or unit": enough to call repeated rows repeated measures.
SUBJECT_NAME <- "^(id|subject|subj|patient|participant|person|pid|sid|ptid|case|환자|대상자|참여자|피험자)([_. ]?(id|no|num|번호))?$|[_. ]id$"
TIME_NAME <- "(^|[_. ])(time|visit|wave|week|wk|day|month|year|session|occasion|period|phase|시점|회차|방문|주차|차수)([_. ]?[0-9]*)$"
WIDE_SUFFIX <- "^(.+?)[_. ]?(pre|post|bl|baseline|fu|followup|t[0-9]+|w[0-9]+|wk[0-9]+|week[0-9]+|v[0-9]+|visit[0-9]+|time[0-9]+|m[0-9]+|month[0-9]+)$"

is_id_name <- function(name) grepl(ID_NAME, tolower(name), perl = TRUE)

#' Kind of a column, from its type and values
var_kind <- function(x, name) {
  if (inherits(x, c("Date", "POSIXt", "difftime"))) return(if (all(is.na(x))) "empty" else "date")
  v <- x[!is.na(x)]
  n <- length(v)
  if (!n) return("empty")
  u <- length(unique(v))
  if (u == 1) return("constant")
  if (is.logical(x)) return("binary")
  if (is.factor(x)) {
    if (u <= 2) return("binary")
    return(if (is.ordered(x)) "ordinal" else "categorical")
  }
  if (is.character(x)) {
    if (u <= 2) return("binary")
    if (u == n && n >= 20) return("id")
    if (u <= 30) return("categorical")
    if (mean(nchar(v)) > 30) return("text")
    if (u / n > 0.8) return(if (is_id_name(name)) "id" else "text")
    return("categorical")
  }
  if (is.numeric(x)) {
    v <- v[is.finite(v)]
    if (!length(v)) return("empty")
    int <- all(abs(v - round(v)) < 1e-8)
    if (u <= 2) return("binary")
    if (int && u == n && n >= 20 && (is_id_name(name) || max(v) - min(v) + 1 == n)) return("id")
    if (int && u <= 11 && min(v) >= 0 && max(v) <= 10) return("ordinal")
    if (int) return("integer")
    return("continuous")
  }
  "other"
}

# Numeric for the purposes of correlation and distribution checks.
is_num_kind <- function(kind, x) kind %in% c("integer", "continuous") || (kind == "ordinal" && is.numeric(x))
# Grouping variable (few levels).
is_cat_kind <- function(kind, x) {
  if (kind == "binary") return(TRUE)
  if (kind %in% c("categorical", "ordinal") && !is.numeric(x)) return(length(unique(x[!is.na(x)])) <= 30)
  FALSE
}

skewness <- function(v) {
  out <- tryCatch(as.numeric(datawizard::skewness(v)$Skewness), error = function(e) NA_real_)
  if (length(out) != 1 || is.na(out)) {
    m <- mean(v); s <- stats::sd(v)
    out <- if (length(v) > 2 && s > 0) mean((v - m)^3) / s^3 else NA_real_
  }
  out
}

kurtosis <- function(v) {
  out <- tryCatch(as.numeric(datawizard::kurtosis(v)$Kurtosis), error = function(e) NA_real_)
  if (length(out) != 1 || is.na(out)) {
    m <- mean(v); s <- stats::sd(v)
    out <- if (length(v) > 3 && s > 0) mean((v - m)^4) / s^4 - 3 else NA_real_
  }
  out
}

fmt_num <- function(x, digits = 2) formatC(x, digits = digits, format = "f")
pct <- function(x) paste0(formatC(100 * x, digits = 1, format = "f"), "%")

top_level <- function(v) {
  if (!length(v)) return(NA_character_)
  t <- sort(table(as.character(v)), decreasing = TRUE)
  sprintf("%s (%s)", names(t)[1], pct(t[[1]] / length(v)))
}

# The most common level names (at most 10), so the assistant can tell what a
# group variable means. Never for IDs or free text: those can hold names.
level_names <- function(v, max = 10) {
  t <- sort(table(as.character(v)), decreasing = TRUE)
  out <- paste(utils::head(names(t), max), collapse = ", ")
  if (length(t) > max) paste0(out, sprintf(" 외 %d개", length(t) - max)) else out
}

#' One row per variable: kind, missing, spread or top level, shape
profile_vars <- function(d) {
  kinds <- vapply(names(d), function(n) var_kind(d[[n]], n), "")
  rows <- lapply(names(d), function(n) {
    x <- d[[n]]
    k <- kinds[[n]]
    v <- x[!is.na(x)]
    num <- is.numeric(x) && k %in% c("integer", "continuous", "ordinal", "binary")
    vn <- if (num) v[is.finite(v)] else numeric()
    data.frame(
      variable = n,
      class = class(x)[1],
      kind = KIND_LABEL[[k]],
      missing_pct = 100 * mean(is.na(x)),
      unique = length(unique(v)),
      mean = if (length(vn)) mean(vn) else NA_real_,
      sd = if (length(vn) > 1) stats::sd(vn) else NA_real_,
      median = if (length(vn)) stats::median(vn) else NA_real_,
      min = if (length(vn)) min(vn) else NA_real_,
      max = if (length(vn)) max(vn) else NA_real_,
      skew = if (length(vn) > 2 && k %in% c("integer", "continuous", "ordinal")) skewness(vn) else NA_real_,
      top = if (!num && k %in% c("binary", "categorical", "ordinal")) top_level(v) else NA_character_,
      levels = if (!num && k %in% c("binary", "categorical", "ordinal")) level_names(v) else NA_character_,
      stringsAsFactors = FALSE
    )
  })
  list(kind = kinds, table = do.call(rbind, rows))
}

# ---------- structure ----------

#' Groups of items that look like one questionnaire scale (phq1..phq9)
scale_groups <- function(d, kinds) {
  cand <- names(d)[kinds %in% c("ordinal", "integer", "binary") & vapply(d, is.numeric, TRUE)]
  if (length(cand) < 3) return(list())
  m <- regmatches(cand, regexec("^(.*?[A-Za-z가-힣])[_. ]?([0-9]+)$", cand))
  stem <- vapply(m, function(z) if (length(z) == 3) z[2] else NA_character_, "")
  keep <- !is.na(stem)
  if (!any(keep)) return(list())
  groups <- split(cand[keep], stem[keep])
  out <- list()
  for (s in names(groups)) {
    items <- groups[[s]]
    if (length(items) < 3) next
    ranges <- vapply(d[items], function(x) diff(range(x, na.rm = TRUE)), 1)
    if (any(ranges > 10) || max(ranges) - min(ranges) > 2) next
    cc <- stats::complete.cases(d[items])
    alpha <- NA_real_
    if (sum(cc) >= 10) {
      x <- as.matrix(d[cc, items])
      tv <- stats::var(rowSums(x))
      k <- length(items)
      if (tv > 0) alpha <- k / (k - 1) * (1 - sum(apply(x, 2, stats::var)) / tv)
    }
    total <- names(d)[tolower(names(d)) %in% tolower(paste0(s, c("", "_total", "total", "_sum", "sum", "_tot", "tot", "_score", "score", ".total", "_t")))]
    total <- setdiff(total, items)
    total <- Filter(function(t) is.numeric(d[[t]]) && sum(cc & !is.na(d[[t]])) >= 10 &&
                      abs(stats::cor(rowSums(as.matrix(d[cc & !is.na(d[[t]]), items])), d[[t]][cc & !is.na(d[[t]])])) > 0.9, total)
    out[[s]] <- list(stem = s, items = items, alpha = alpha, total = if (length(total)) total[[1]] else NULL, n = sum(cc))
  }
  out
}

#' An ID column that repeats: data in long form (several rows per person)
repeated_measures <- function(d, kinds) {
  cand <- names(d)[vapply(names(d), function(n) is_id_name(n) && !kinds[[n]] %in% c("empty", "constant", "continuous"), TRUE)]
  for (n in cand) {
    v <- d[[n]][!is.na(d[[n]])]
    if (length(v) < 6) next
    counts <- table(v)
    if (length(counts) < 3 || mean(counts) < 1.5 || mean(counts >= 2) < 0.5) next
    time <- names(d)[grepl(TIME_NAME, tolower(names(d)), perl = TRUE) | kinds == "date"]
    time <- setdiff(time, n)
    if (!length(time) && !grepl(SUBJECT_NAME, tolower(n), perl = TRUE)) next
    return(list(id = n, ids = length(counts), mean = mean(counts), max = max(counts), time = time))
  }
  # A grouping column with many levels, each repeated, next to a time column (ChickWeight's Chick and Time).
  time <- names(d)[grepl(TIME_NAME, tolower(names(d)), perl = TRUE) | kinds == "date"]
  if (length(time)) {
    for (n in names(d)[kinds %in% c("categorical", "ordinal", "integer")]) {
      if (n %in% time || is.numeric(d[[n]]) && !is_id_name(n)) next
      counts <- table(d[[n]][!is.na(d[[n]])])
      if (length(counts) >= 10 && mean(counts) >= 2 && mean(counts >= 2) >= 0.8) {
        return(list(id = n, ids = length(counts), mean = mean(counts), max = max(counts), time = time))
      }
    }
  }
  NULL
}

#' The same measure in several columns, one per time point (wide form)
wide_groups <- function(d, kinds) {
  cand <- names(d)[vapply(names(d), function(n) is_num_kind(kinds[[n]], d[[n]]), TRUE)]
  m <- regmatches(cand, regexec(WIDE_SUFFIX, cand, ignore.case = TRUE, perl = TRUE))
  stem <- vapply(m, function(z) if (length(z) == 3) z[2] else NA_character_, "")
  keep <- !is.na(stem)
  groups <- split(cand[keep], stem[keep])
  Filter(function(g) length(g) >= 2, groups)
}
