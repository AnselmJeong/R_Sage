# Shared helpers for the comparison analyses.

`%||%` <- function(a, b) if (is.null(a) || length(a) == 0 || (length(a) == 1 && is.na(a))) b else a

has <- function(pkg) requireNamespace(pkg, quietly = TRUE)

one <- function(x) {
  x <- unlist(x)
  if (is.null(x) || !length(x) || is.na(x[1]) || !nzchar(x[1])) NULL else as.character(x[1])
}

# JSON arrays of objects arrive as lists of lists; NULL fields are dropped.
rows_of <- function(x) {
  if (is.null(x) || !length(x)) return(list())
  if (is.data.frame(x)) x <- lapply(seq_len(nrow(x)), function(i) as.list(x[i, , drop = FALSE]))
  lapply(x, function(r) r[!vapply(r, function(v) is.null(v) || (length(v) == 1 && is.na(v)), TRUE)])
}

chr <- function(x) as.character(unlist(x %||% character()))

num1 <- function(x, default) {
  v <- suppressWarnings(as.numeric(unlist(x)))
  if (!length(v) || is.na(v[1])) default else v[1]
}

theme_rs <- function() ggplot2::theme_minimal()

note <- function(text, code, level = "warning") rsage::rs_note(text, level, code)

# Runs an expression, keeping warnings as text instead of letting them reach the console.
quietly <- function(f) {
  warns <- character()
  value <- withCallingHandlers(tryCatch(f, error = function(e) e),
                               warning = function(w) {
                                 warns <<- c(warns, conditionMessage(w))
                                 invokeRestart("muffleWarning")
                               },
                               message = function(m) invokeRestart("muffleMessage"))
  list(value = value, warnings = unique(warns), error = if (inherits(value, "error")) conditionMessage(value) else NULL)
}

# Collects tables, plots and notes in the order they are made.
collector <- function() {
  env <- new.env()
  env$tables <- list(); env$plots <- list(); env$notes <- list(); env$hints <- list()
  env$add <- function(x) {
    if (is.null(x)) return(invisible())
    if (inherits(x, "rsage_table")) env$tables[[x$id]] <- x
    else if (inherits(x, "rsage_plot")) env$plots[[x$id]] <- x
    else if (inherits(x, "rsage_note")) env$notes[[length(env$notes) + 1]] <- x
    else if (inherits(x, "rsage_hint")) env$hints[[length(env$hints) + 1]] <- x
    else if (is.list(x)) for (i in x) env$add(i)
    invisible()
  }
  env
}

is_numeric_var <- function(x) is.numeric(x) && !is.logical(x)

# A grouping variable as a factor, dropping unused levels and NA.
as_group <- function(x) {
  if (is.factor(x)) droplevels(x) else factor(x)
}

skewness <- function(x) {
  x <- x[is.finite(x)]
  n <- length(x)
  if (n < 3) return(NA_real_)
  s <- stats::sd(x)
  if (!is.finite(s) || s == 0) return(NA_real_)
  m <- mean(x)
  # Type 2 (sample) skewness, as SPSS and datawizard report.
  g1 <- mean((x - m)^3) / mean((x - m)^2)^1.5
  g1 * sqrt(n * (n - 1)) / (n - 2)
}

shapiro_p <- function(x) {
  x <- x[is.finite(x)]
  if (length(x) < 3 || length(x) > 5000 || stats::sd(x) == 0) return(c(W = NA_real_, p = NA_real_))
  t <- stats::shapiro.test(x)
  c(W = unname(t$statistic), p = t$p.value)
}

# Brown-Forsythe test: one-way ANOVA on absolute deviations from each group's median.
brown_forsythe <- function(y, g) {
  ok <- is.finite(y) & !is.na(g)
  y <- y[ok]; g <- droplevels(as_group(g[ok]))
  if (nlevels(g) < 2) return(NULL)
  dev <- abs(y - stats::ave(y, g, FUN = stats::median))
  a <- stats::anova(stats::lm(dev ~ g))
  data.frame(F = a$`F value`[1], df1 = a$Df[1], df2 = a$Df[2], p = a$`Pr(>F)`[1])
}

group_summary <- function(y, g = NULL, conf = 0.95) {
  if (is.null(g)) g <- factor(rep("전체", length(y)))
  ok <- is.finite(y) & !is.na(g)
  y <- y[ok]; g <- droplevels(as_group(g[ok]))
  do.call(rbind, lapply(levels(g), function(l) {
    v <- y[g == l]
    n <- length(v)
    m <- if (n) mean(v) else NA_real_
    s <- if (n > 1) stats::sd(v) else NA_real_
    se <- s / sqrt(n)
    tq <- if (n > 1) stats::qt(1 - (1 - conf) / 2, n - 1) else NA_real_
    q <- if (n) stats::quantile(v, c(0.25, 0.5, 0.75), names = FALSE) else rep(NA_real_, 3)
    data.frame(group = l, n = n, mean = m, sd = s, se = se, ci_low = m - tq * se, ci_high = m + tq * se,
               median = q[2], q1 = q[1], q3 = q[3], min = if (n) min(v) else NA_real_, max = if (n) max(v) else NA_real_,
               skew = skewness(v), stringsAsFactors = FALSE)
  }))
}

DESC_LABELS <- c(variable = "변수", group = "집단", n = "n", mean = "평균", sd = "SD", se = "SE",
                 ci_low = "평균 CI 하한", ci_high = "평균 CI 상한", median = "중앙값", q1 = "Q1", q3 = "Q3",
                 min = "최솟값", max = "최댓값", skew = "왜도")

ALTERNATIVE_LABEL <- c(two.sided = "양측", less = "작다 (한쪽)", greater = "크다 (한쪽)")

# Effect size from effectsize, as estimate and CI; NULL fields on failure.
es_value <- function(expr) {
  r <- quietly(expr)
  v <- r$value
  if (!is.null(r$error) || !is.data.frame(v)) return(list(value = NA_real_, low = NA_real_, high = NA_real_))
  list(value = v[[1]][1], low = v$CI_low[1] %||% NA_real_, high = v$CI_high[1] %||% NA_real_)
}

size_d <- function(d) {
  d <- abs(d)
  if (is.na(d)) NA_character_ else if (d < 0.2) "아주 작음" else if (d < 0.5) "작음" else if (d < 0.8) "중간" else "큼"
}

fmt <- function(x, digits = 2) ifelse(is.na(x), "NA", formatC(x, digits = digits, format = "f"))
fmt_p <- function(p) ifelse(is.na(p), "NA", ifelse(p < 0.001, "< .001", sub("^0", "", formatC(p, digits = 3, format = "f"))))
