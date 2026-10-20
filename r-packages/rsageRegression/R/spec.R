# From options to models: families, structured terms, the fixed analysis
# sample and formulas. Terms and models are data (ids and column names),
# never formula text, so a column name can't run code. Columns get
# internal names (rsv001, ...) in the model data; labels map them back.

FAMILIES <- list(
  gaussian = list(links = "identity", kind = "continuous", label = "선형"),
  binomial = list(links = c("logit", "probit", "cloglog"), kind = "binary", label = "이항"),
  poisson = list(links = "log", kind = "count", label = "Poisson"),
  negative_binomial = list(links = "log", kind = "count", label = "음이항"),
  gamma = list(links = c("log", "inverse", "identity"), kind = "positive", label = "Gamma"),
  quasibinomial = list(links = "logit", kind = "binary", label = "quasi-binomial"),
  quasipoisson = list(links = "log", kind = "count", label = "quasi-Poisson")
)

is_quasi <- function(family) family %in% c("quasibinomial", "quasipoisson")

# The family, link and estimation one model uses (its own, else the common setting).
model_setting <- function(m, o) {
  family <- one(m$family) %||% o$model$family
  link <- one(m$link) %||% if (is.null(one(m$family))) o$model$link else "default"
  if (identical(link, "default")) link <- FAMILIES[[family]]$links[1]
  list(family = family, link = link, estimation = one(m$estimation) %||% o$model$estimation)
}

setting_label <- function(s) {
  if (s$family == "gaussian") return("선형 (최소제곱)")
  paste0(FAMILIES[[s$family]]$label, " · ", s$link)
}

# Terms as given, checked: ids unique, kinds known, variables are predictors,
# interaction components are main terms.
check_terms <- function(terms, predictors) {
  ids <- vapply(terms, function(t) one(t$id) %||% "", "")
  problems <- character()
  if (any(!nzchar(ids)) || anyDuplicated(ids)) problems <- c(problems, "항 id가 비었거나 겹칩니다")
  names(terms) <- ids
  for (t in terms) {
    kind <- one(t$kind) %||% ""
    if (kind == "main") {
      v <- one(t$variable)
      if (is.null(v) || !v %in% predictors) problems <- c(problems, sprintf("항 %s: 설명변수가 아닌 열 %s", t$id, v %||% "(없음)"))
    } else if (kind == "interaction") {
      comp <- chr(t$components)
      ok <- length(comp) %in% 2:3 && all(comp %in% ids) &&
        all(vapply(terms[comp[comp %in% ids]], function(c) identical(one(c$kind), "main"), TRUE))
      if (!ok) problems <- c(problems, sprintf("항 %s: 상호작용은 주효과 항 2~3개로 만듭니다", t$id))
    } else if (kind %in% c("power", "spline")) {
      problems <- c(problems, sprintf("항 %s: 다항·스플라인 항은 다음 버전에서 지원합니다", t$id))
    } else problems <- c(problems, sprintf("항 %s: 알 수 없는 종류 %s", t$id, kind))
  }
  list(terms = terms, problems = problems)
}

# Variables a term uses, in the order the user built it.
term_vars <- function(t, terms) {
  if (identical(one(t$kind), "main")) return(one(t$variable))
  unname(vapply(chr(t$components), function(c) one(terms[[c]]$variable), ""))
}

# The same for x:z and z:x.
term_key <- function(t, terms) paste(sort(term_vars(t, terms)), collapse = ":")

# Strong hierarchy: every lower-order part of an interaction is in the model.
hierarchy_problems <- function(term_ids, terms) {
  have <- lapply(terms[term_ids], term_vars, terms = terms)
  key <- vapply(have, function(v) paste(sort(v), collapse = ":"), "")
  out <- character()
  for (v in have) {
    if (length(v) < 2) next
    subsets <- unlist(lapply(seq_len(length(v) - 1), function(k) utils::combn(sort(v), k, paste, collapse = ":")))
    miss <- setdiff(subsets, key)
    if (length(miss)) out <- c(out, sprintf("%s에는 %s도 있어야 합니다", paste(v, collapse = " × "), paste(gsub(":", " × ", miss), collapse = ", ")))
  }
  out
}

# Main-effect terms and one model of them, for options that name predictors
# but no terms (the assistant or a console call). The GUI writes terms itself.
auto_terms <- function(predictors) {
  terms <- lapply(seq_along(predictors), function(i) list(id = sprintf("t%d", i), kind = "main", variable = predictors[i]))
  names(terms) <- vapply(terms, function(t) t$id, "")
  terms
}

# Default event for a two-valued outcome: 1, TRUE, or nothing (must be chosen).
default_event <- function(y) {
  if (is.logical(y)) return("TRUE")
  u <- sort(unique(stats::na.omit(y)))
  if (is.numeric(y) && length(u) <= 2 && all(u %in% c(0, 1))) return("1")
  NULL
}

outcome_levels <- function(y) {
  if (is.factor(y)) return(levels(droplevels(y)))
  as.character(sort(unique(stats::na.omit(y))))
}

# Checks the outcome for a family; returns a problem (Korean) or NULL.
outcome_problem <- function(y, kind, encoding, trials) {
  y_ok <- y[!is.na(y)]
  switch(kind,
    continuous = if (!is.numeric(y_ok) || any(!is.finite(y_ok))) "선형 모형의 결과변수는 유한한 숫자여야 합니다",
    binary = if (encoding == "grouped") {
      if (is.null(trials)) "집계 이항 모형에는 시행 수 열이 필요합니다"
      else if (!is.numeric(y_ok) || any(y_ok < 0 | y_ok != round(y_ok))) "성공 수는 0 이상의 정수여야 합니다"
    } else if (length(unique(y_ok)) != 2) sprintf("이항 결과변수는 값이 정확히 두 가지여야 합니다 (지금 %d가지)", length(unique(y_ok))),
    count = if (!is.numeric(y_ok) || any(y_ok < 0 | y_ok != round(y_ok))) "개수 모형의 결과변수는 0 이상의 정수여야 합니다 (반올림하지 않습니다)"
            else if (all(y_ok == 0)) "결과변수가 모두 0이라 추론할 수 없습니다",
    positive = if (!is.numeric(y_ok) || any(y_ok <= 0)) "Gamma 모형의 결과변수는 0보다 커야 합니다 (0에 값을 더하지 않습니다)"
  )
}
