# The design profile: what each chosen variable is and how the groups look.
# Numbers only; the rules (rules.R) decide.

`%||%` <- function(a, b) if (is.null(a) || length(a) == 0 || (length(a) == 1 && is.na(a))) b else a

one <- function(x) {
  x <- unlist(x)
  if (is.null(x) || !length(x) || is.na(x[1]) || !nzchar(x[1])) NULL else as.character(x[1])
}
chr <- function(x) as.character(unlist(x %||% character()))

KIND_LABEL <- c(empty = "빈 열", constant = "값이 하나", id = "ID", date = "날짜·시각", text = "자유 텍스트",
                binary = "이분", categorical = "범주", ordinal = "순서·점수 (값이 적음)", count = "개수",
                continuous = "연속", other = "기타")

ID_NAME <- "(^|[_. ])(id|no|num|number|code|key|번호|코드|아이디)$|^(id|no)([_. ]|$)|^(subject|patient|participant|case|record|환자|대상자)([_. ]?(id|no|번호))?$"
# Two columns that look like the same measurement at two times.
PAIR_SUFFIX <- "^(.+?)[_. ]?(pre|post|before|after|bl|baseline|fu|followup|t[0-9]+|w[0-9]+|wk[0-9]+|week[0-9]+|v[0-9]+|visit[0-9]+|time[0-9]+|m[0-9]+|month[0-9]+|[0-9]+|전|후|사전|사후)$"

#' Kind of a column, from its type and values
var_kind <- function(x, name) {
  if (inherits(x, c("Date", "POSIXt", "difftime"))) return(if (all(is.na(x))) "empty" else "date")
  v <- x[!is.na(x)]
  n <- length(v)
  if (!n) return("empty")
  u <- length(unique(v))
  if (u == 1) return("constant")
  if (is.logical(x)) return("binary")
  if (is.factor(x)) return(if (u <= 2) "binary" else if (is.ordered(x)) "ordinal" else "categorical")
  if (is.character(x)) {
    if (u <= 2) return("binary")
    if (u == n && n >= 20) return("id")
    if (u <= 30) return("categorical")
    if (mean(nchar(v)) > 30) return("text")
    return(if (grepl(ID_NAME, tolower(name), perl = TRUE)) "id" else "text")
  }
  if (is.numeric(x)) {
    v <- v[is.finite(v)]
    if (!length(v)) return("empty")
    int <- all(abs(v - round(v)) < 1e-8)
    if (u <= 2) return("binary")
    # A few distinct values (doses 0.5/1/2, codes 1/2/3): levels as much as numbers.
    if (u <= 5 && n >= 2 * u) return("ordinal")
    if (int && u == n && n >= 20 && grepl(ID_NAME, tolower(name), perl = TRUE)) return("id")
    if (int && u <= 7 && min(v) >= 0 && max(v) <= 10) return("ordinal")
    if (int && min(v) >= 0 && (mean(v) < 10 || mean(v == 0) >= 0.1) && isTRUE(skewness(v) > 1)) return("count")
    return("continuous")
  }
  "other"
}

numeric_kind <- function(kind) kind %in% c("continuous", "count", "ordinal")
# Can split rows into groups.
group_kind <- function(kind, x) kind %in% c("binary", "categorical") || (kind == "ordinal")

skewness <- function(x) {
  x <- x[is.finite(x)]
  n <- length(x)
  if (n < 3) return(NA_real_)
  s <- stats::sd(x)
  if (!is.finite(s) || s == 0) return(NA_real_)
  m <- mean(x)
  g1 <- mean((x - m)^3) / mean((x - m)^2)^1.5
  g1 * sqrt(n * (n - 1)) / (n - 2)
}

shapiro_p <- function(x) {
  x <- x[is.finite(x)]
  if (length(x) < 3 || length(x) > 5000 || stats::sd(x) == 0) return(NA_real_)
  stats::shapiro.test(x)$p.value
}

#' One row per chosen variable: role, kind and a short summary
variable_profile <- function(data, roles) {
  rows <- lapply(names(roles), function(v) {
    x <- data[[v]]
    k <- var_kind(x, v)
    num <- is.numeric(x) && numeric_kind(k)
    lv <- if (!num) length(unique(x[!is.na(x)])) else NA_integer_
    data.frame(variable = v, role = roles[[v]], kind = k, kind_label = KIND_LABEL[[k]],
               n = sum(!is.na(x)), missing = sum(is.na(x)), levels = lv,
               mean = if (num) mean(x, na.rm = TRUE) else NA_real_, sd = if (num) stats::sd(x, na.rm = TRUE) else NA_real_,
               skew = if (num) skewness(x) else NA_real_, stringsAsFactors = FALSE)
  })
  do.call(rbind, rows)
}

#' One row per group: size and shape of the outcome in it
group_profile <- function(y, g) {
  ok <- !is.na(g) & is.finite(y)
  y <- y[ok]; g <- droplevels(factor(g[ok]))
  do.call(rbind, lapply(levels(g), function(l) {
    v <- y[g == l]
    data.frame(group = l, n = length(v), mean = mean(v), sd = if (length(v) > 1) stats::sd(v) else NA_real_,
               median = stats::median(v), skew = skewness(v), shapiro_p = shapiro_p(v), stringsAsFactors = FALSE)
  }))
}

# Whether two column names look like one measurement taken twice.
looks_paired <- function(a, b) {
  sa <- sub(PAIR_SUFFIX, "\\1", tolower(a), perl = TRUE); sb <- sub(PAIR_SUFFIX, "\\1", tolower(b), perl = TRUE)
  (sa != tolower(a) || sb != tolower(b)) && nzchar(sa) && sa == sb
}

fmt <- function(x, digits = 2) ifelse(is.na(x), "NA", formatC(x, digits = digits, format = "f"))
fmt_p <- function(p) ifelse(is.na(p), "NA", ifelse(p < 0.001, "< .001", sub("^0", "", formatC(p, digits = 3, format = "f"))))

# Korean particles after a quoted name: written in the vowel form, fixed here.
JOSA <- list("와" = "과", "는" = "은", "가" = "이", "를" = "을", "로" = "으로")
fix_josa <- function(s) {
  m <- gregexpr("'([^']+)'(와|는|가|를|로)(?![가-힣])", s, perl = TRUE)[[1]]
  if (m[1] == -1) return(s)
  starts <- as.integer(m); lens <- attr(m, "match.length")
  for (i in rev(seq_along(starts))) {
    piece <- substr(s, starts[i], starts[i] + lens[i] - 1)
    name <- sub("^'(.*)'.+$", "\\1", piece)
    vowel <- sub("^'.*'", "", piece)
    last <- utf8ToInt(substring(name, nchar(name)))
    cons <- JOSA[[vowel]]
    form <- if (last >= 0xAC00 && last <= 0xD7A3) {
      jong <- (last - 0xAC00) %% 28
      if (vowel == "로") { if (jong > 0 && jong != 8) cons else vowel } else if (jong > 0) cons else vowel
    } else if (vowel %in% c("와", "가")) paste0(vowel, "(", cons, ")") else paste0(cons, "(", vowel, ")")
    s <- paste0(substr(s, 1, starts[i] - 1), "'", name, "'", form, substr(s, starts[i] + lens[i], nchar(s)))
  }
  s
}
