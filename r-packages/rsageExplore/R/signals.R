# Signals: things in the data worth a closer look. Each is a list with the
# numbers behind it (measure, value, n), a size label, a score used to rank
# it, a rule-written hint, what to draw on its card and where to go next.

signal <- function(kind, variables, title, text, measure = NA_character_, value = NA_real_, n = NA_integer_,
                   size = NA_character_, score = 0, draw = NULL, suggestions = list(), display = NULL) {
  list(kind = kind, variables = as.character(variables), title = fix_josa(title), text = fix_josa(text), measure = measure,
       value = value, n = as.integer(n), size = size, score = score, draw = draw, suggestions = suggestions,
       display = display)
}

# Particles after a quoted name are written in their vowel form ('x'와, 'x'는,
# 'x'가, 'x'를) and fixed here: the consonant form after a Hangul syllable with
# a final consonant, both forms ("와(과)") after a name we cannot sound out.
JOSA <- list("와" = "과", "는" = "은", "가" = "이", "를" = "을")
fix_josa <- function(s) {
  m <- gregexpr("'([^']+)'(와|는|가|를)(?![가-힣])", s, perl = TRUE)[[1]]
  if (m[1] == -1) return(s)
  starts <- as.integer(m); lens <- attr(m, "match.length")
  for (i in rev(seq_along(starts))) {
    piece <- substr(s, starts[i], starts[i] + lens[i] - 1)
    name <- sub("^'(.*)'.$", "\\1", piece)
    vowel <- substring(piece, nchar(piece))
    last <- utf8ToInt(substring(name, nchar(name)))
    cons <- JOSA[[vowel]]
    form <- if (last >= 0xAC00 && last <= 0xD7A3) {
      if ((last - 0xAC00) %% 28 > 0) cons else vowel
    } else if (last >= 0x30 && last <= 0x39) {
      if (intToUtf8(last) %in% c("0", "1", "3", "6", "7", "8")) cons else vowel
    } else if (vowel %in% c("와", "가")) paste0(vowel, "(", cons, ")") else paste0(cons, "(", vowel, ")")
    s <- paste0(substr(s, 1, starts[i] - 1), "'", name, "'", form, substr(s, starts[i] + lens[i], nchar(s)))
  }
  s
}

# Size labels for correlation-like measures (r, ρ, V, η) and for η².
size_r <- function(s) if (is.na(s)) NA_character_ else if (s < 0.1) "아주 작음" else if (s < 0.3) "작음" else if (s < 0.5) "중간" else "큼"
size_eta2 <- function(e) if (is.na(e)) NA_character_ else if (e < 0.01) "아주 작음" else if (e < 0.06) "작음" else if (e < 0.14) "중간" else "큼"
at_least_medium <- function(size) !is.na(size) && size %in% c("중간", "큼")

# ---------- suggested next analyses ----------

KEY <- list(
  regression = "org.rsage.regression/regression",
  missing = "org.rsage.missing/missing",
  integrity = "org.rsage.integrity/integrity",
  descriptives = "org.rsage.descriptives/descriptives",
  ttests = "org.rsage.ttests/ttests",
  anova = "org.rsage.anova/anova",
  frequencies = "org.rsage.frequencies/frequencies",
  reliability = "org.rsage.reliability/reliability",
  factor = "org.rsage.factor/factor",
  mixed = "org.rsage.mixed/mixed"
)

FAMILY_LABEL <- c(gaussian = "선형 회귀", binomial = "로지스틱 회귀", poisson = "개수 회귀")

sug_regression <- function(outcome, family, continuous = character(), categorical = character(), event = NULL) {
  preds <- c(as.character(continuous), as.character(categorical))
  # Main effects of every predictor in one model, as the regression form builds them.
  terms <- lapply(preds, function(v) list(id = paste0("m:", v), kind = "main", variable = v))
  o <- list(outcome = list(variable = outcome), model = list(family = family),
            predictors = list(continuous = I(as.character(continuous)), categorical = I(as.character(categorical))),
            terms = terms,
            models = list(list(id = "m1", label = "모형 1", termIds = I(paste0("m:", preds)), intercept = TRUE)))
  if (!is.null(event)) o$outcome$event <- event
  rsage::rs_suggest(paste(FAMILY_LABEL[[family]], "열기"), KEY$regression, o, title = paste0(FAMILY_LABEL[[family]], ": ", outcome))
}
sug_integrity <- function() rsage::rs_suggest("데이터 점검 열기", KEY$integrity)
sug_missing <- function(var = NULL, other = NULL, other_numeric = TRUE) {
  if (is.null(var)) return(rsage::rs_suggest("결측 데이터 분석 열기", KEY$missing))
  o <- if (other_numeric) {
    list(variables = I(c(var, other)), relations = list(shadowDensity = TRUE, variable = other, by = var))
  } else {
    list(variables = I(var), group = other)
  }
  rsage::rs_suggest("결측 데이터 분석 열기", KEY$missing, o, title = paste0("결측: ", var))
}
sug_planned <- function(label, key) rsage::rs_suggest(label, KEY[[key]])

# Family and event for a variable used as a regression outcome.
outcome_model <- function(x, kind) {
  v <- x[!is.na(x)]
  if (kind == "binary") {
    event <- NULL
    is01 <- is.logical(x) || (is.numeric(x) && all(v %in% c(0, 1)))
    if (!is01) {
      t <- sort(table(as.character(v)))
      event <- names(t)[1]
    }
    return(list(family = "binomial", event = event))
  }
  if (is.numeric(x) && kind %in% c("integer", "ordinal", "continuous")) {
    v <- v[is.finite(v)]
    int <- all(abs(v - round(v)) < 1e-8)
    if (int && min(v) >= 0 && (mean(v) < 10 || mean(v == 0) >= 0.1 || isTRUE(skewness(v) > 1))) return(list(family = "poisson", event = NULL))
    return(list(family = "gaussian", event = NULL))
  }
  NULL
}

# ---------- association between two variables ----------

#' Strength of association, on a correlation-like scale, for any pair
assoc <- function(x, y, num_x, num_y) {
  ok <- !is.na(x) & !is.na(y)
  if (num_x) ok <- ok & is.finite(x)
  if (num_y) ok <- ok & is.finite(y)
  n <- sum(ok)
  if (n < 10) return(NULL)
  x <- x[ok]; y <- y[ok]
  if (num_x && num_y) {
    if (stats::sd(x) == 0 || stats::sd(y) == 0) return(NULL)
    r <- stats::cor(x, y)
    rho <- stats::cor(x, y, method = "spearman")
    return(list(type = "num-num", measure = "Spearman ρ", value = rho, strength = abs(rho), pearson = r, n = n, size = size_r(abs(rho))))
  }
  if (num_x != num_y) {
    num <- if (num_x) x else y
    g <- factor(if (num_x) y else x)
    if (nlevels(g) < 2 || stats::sd(num) == 0) return(NULL)
    means <- tapply(num, g, mean)
    ssb <- sum(table(g) * (means - mean(num))^2)
    sst <- sum((num - mean(num))^2)
    eta2 <- ssb / sst
    return(list(type = "num-cat", measure = "η²", value = eta2, strength = sqrt(eta2), n = n, size = size_eta2(eta2),
                groups = nlevels(g)))
  }
  tab <- table(x, y)
  tab <- tab[rowSums(tab) > 0, colSums(tab) > 0, drop = FALSE]
  if (min(dim(tab)) < 2) return(NULL)
  e <- outer(rowSums(tab), colSums(tab)) / n
  chi2 <- sum((tab - e)^2 / e)
  v <- sqrt(chi2 / (n * (min(dim(tab)) - 1)))
  list(type = "cat-cat", measure = "Cramér V", value = v, strength = v, n = n, size = size_r(v))
}

evidence <- function(a) {
  sprintf("%s = %s, n = %d", a$measure, fmt_num(a$value), a$n)
}

# ---------- health ----------

MISSING_CODES <- c(-9, -99, -999, -9999, 99, 999, 9999, -8, -88, -888, -7, -77, -777, 88, 888, 77, 777)

health_signals <- function(d, kinds) {
  out <- list()
  issues <- character()
  vars <- character()
  dup <- sum(duplicated(d))
  if (dup > 0) issues <- c(issues, sprintf("중복 행 %d개", dup))
  empty <- names(kinds)[kinds %in% c("empty", "constant")]
  if (length(empty)) {
    issues <- c(issues, sprintf("빈 열이나 값이 하나뿐인 열 %d개(%s)", length(empty), paste(utils::head(empty, 3), collapse = ", ")))
    vars <- c(vars, empty)
  }
  for (n in names(d)) {
    x <- d[[n]]
    if (is.character(x)) {
      v <- trimws(x[!is.na(x) & nzchar(trimws(x))])
      if (length(v) >= 5) {
        num <- suppressWarnings(as.numeric(gsub(",", "", v)))
        share <- mean(!is.na(num))
        if (share >= 0.8 && share < 1) {
          issues <- c(issues, sprintf("'%s'는 숫자 열인데 글자가 섞였습니다(%d개 값)", n, sum(is.na(num))))
          vars <- c(vars, n)
        }
      }
    }
    if (is.numeric(x) && kinds[[n]] %in% c("integer", "continuous", "ordinal")) {
      v <- x[is.finite(x)]
      codes <- intersect(MISSING_CODES, v)
      rest <- v[!v %in% codes]
      found <- Filter(function(cd) sum(v == cd) >= 2 && length(rest) >= 5 &&
                        (cd < 0 && min(rest) >= 0 || abs(cd - stats::median(rest)) > 5 * max(stats::IQR(rest), 1)), codes)
      if (length(found)) {
        issues <- c(issues, sprintf("'%s'에 결측 코드로 보이는 값 %s", n, paste(found, collapse = ", ")))
        vars <- c(vars, n)
      }
    }
  }
  if (length(issues)) {
    out[[length(out) + 1]] <- signal(
      "health", unique(vars), "데이터를 먼저 점검해 보세요",
      paste0(paste(issues, collapse = "; "), ". 이런 문제는 뒤의 모든 분석 수치를 바꿉니다. 데이터 점검에서 고친 사본을 만들 수 있습니다."),
      score = 2, display = sprintf("확인할 문제 %d가지", length(issues)), suggestions = list(sug_integrity()))
  }
  # Missing values, overall.
  miss <- vapply(d, function(x) mean(is.na(x)), 1)
  if (any(miss >= 0.05)) {
    top <- sort(miss[miss >= 0.05], decreasing = TRUE)
    complete <- mean(stats::complete.cases(d))
    out[[length(out) + 1]] <- signal(
      "missing", names(top), sprintf("결측이 있는 변수가 %d개입니다", length(top)),
      sprintf("가장 많이 빠진 변수는 %s입니다. 모든 변수가 있는 행은 %s입니다. 완전한 행만 쓰는 분석은 표본이 줄고, 결측이 무작위가 아니면 결과가 치우칩니다.",
              paste(sprintf("%s(%s)", utils::head(names(top), 3), pct(utils::head(top, 3))), collapse = ", "), pct(complete)),
      measure = "완전한 행 비율", value = complete, n = nrow(d), score = 1.2,
      display = sprintf("완전한 행 %s, n = %d", pct(complete), nrow(d)),
      draw = list(type = "missing_bars", vars = names(top)), suggestions = list(sug_missing()))
  }
  out
}

# ---------- distributions ----------

distribution_signals <- function(d, kinds) {
  out <- list()
  for (n in names(d)) {
    x <- d[[n]]
    k <- kinds[[n]]
    if (is_num_kind(k, x)) {
      v <- x[is.finite(x)]
      if (length(v) < 20 || stats::sd(v) == 0) next
      s <- skewness(v)
      zeros <- mean(v == 0)
      int <- all(abs(v - round(v)) < 1e-8)
      at_min <- mean(v == min(v)); at_max <- mean(v == max(v))
      if (int && min(v) >= 0 && zeros >= 0.3 && k != "ordinal") {
        out[[length(out) + 1]] <- signal(
          "zeros", n, sprintf("'%s'는 0이 %s입니다", n, pct(zeros)),
          "0이 많은 개수 자료입니다. 평균과 정규분포를 가정하는 분석보다 개수 회귀(포아송, 음이항)나 0과 양수를 나눠 보는 방법이 맞을 수 있습니다.",
          measure = "0의 비율", value = zeros, n = length(v), size = if (zeros >= 0.5) "큼" else "중간",
          display = sprintf("0의 비율 %s, n = %d", pct(zeros), length(v)),
          score = 0.55, draw = list(type = "hist", x = n))
      } else if (!is.na(s) && abs(s) >= 1) {
        side <- if (s > 0) "오른쪽" else "왼쪽"
        out[[length(out) + 1]] <- signal(
          "skew", n, sprintf("'%s'는 %s으로 꼬리가 깁니다", n, side),
          paste0("평균이 극단값에 끌려가므로 중앙값과 사분위수로 요약하는 편이 낫습니다.",
                 if (s > 0 && min(v) > 0) " 결과 변수라면 로그 변환이나 감마 회귀를 생각해 보세요." else ""),
          measure = "왜도", value = s, n = length(v), size = if (abs(s) >= 2) "큼" else "중간",
          score = 0.35 + 0.1 * min(abs(s), 4), draw = list(type = "hist", x = n))
      } else if (length(unique(v)) >= 5 && max(at_min, at_max) >= max(0.15, 2 / length(unique(v)))) {
        end <- if (at_min >= at_max) "가장 낮은 값" else "가장 높은 값"
        out[[length(out) + 1]] <- signal(
          "ceiling", n, sprintf("'%s'는 %s에 %s가 몰려 있습니다", n, end, pct(max(at_min, at_max))),
          "바닥·천장 효과입니다. 측정 범위가 좁아 차이가 덜 보일 수 있습니다. 선형 모형의 가정이 맞지 않을 수 있으니 분포를 확인하세요.",
          measure = "끝값 비율", value = max(at_min, at_max), n = length(v), size = "중간",
          score = 0.45, draw = list(type = "hist", x = n))
      } else if (k == "continuous" && length(v) >= 30 && length(unique(v)) >= 20) {
        g <- s; kx <- kurtosis(v); m <- length(v)
        bc <- (g^2 + 1) / (kx + 3 * (m - 1)^2 / ((m - 2) * (m - 3)))
        if (is.finite(bc) && bc > 0.6) {
          out[[length(out) + 1]] <- signal(
            "bimodal", n, sprintf("'%s'는 봉우리가 둘일 수 있습니다", n),
            "서로 다른 두 집단이 섞여 있을 수 있습니다. 성별·진단처럼 집단을 나누는 변수로 나눠 그려 보세요.",
            measure = "이봉 계수", value = bc, n = length(v), size = "중간", score = 0.5, draw = list(type = "hist", x = n))
        }
      }
    } else if (k %in% c("binary", "categorical") || (k == "ordinal" && !is.numeric(x))) {
      v <- as.character(x[!is.na(x)])
      if (length(v) < 20) next
      t <- sort(table(v), decreasing = TRUE) / length(v)
      if (t[[1]] >= 0.9) {
        out[[length(out) + 1]] <- signal(
          "imbalance", n, sprintf("'%s'는 '%s'가 %s입니다", n, names(t)[1], pct(t[[1]])),
          "한 범주가 거의 전부라 다른 범주의 수가 적습니다. 이 변수로 집단을 나누면 작은 집단의 추정이 불안정합니다.",
          measure = "가장 많은 범주 비율", value = t[[1]], n = length(v), size = "큼", score = 0.4, draw = list(type = "bars", x = n))
      } else if (length(t) >= 3 && length(t) <= 30 && any(t < 0.05) && sum(t < 0.05) <= length(t) / 2) {
        rare <- names(t)[t < 0.05]
        out[[length(out) + 1]] <- signal(
          "rare_levels", n, sprintf("'%s'에 드문 범주가 %d개 있습니다", n, length(rare)),
          sprintf("%s는 5%% 미만입니다. 분석 전에 합칠지, 오타나 다른 표기인지 확인하세요.", paste(utils::head(rare, 3), collapse = ", ")),
          measure = "드문 범주 수", value = length(rare), n = length(v), size = "작음", score = 0.3, draw = list(type = "bars", x = n))
      }
    }
  }
  out
}

# ---------- structure ----------

structure_signals <- function(d, kinds, scales, rep, wide) {
  out <- list()
  for (s in scales) {
    ev <- sprintf("문항 %d개%s", length(s$items), if (!is.na(s$alpha)) sprintf(", α = %s", fmt_num(s$alpha)) else "")
    out[[length(out) + 1]] <- signal(
      "scale", c(s$items, s$total), sprintf("'%s' 문항 %d개는 한 척도로 보입니다", s$stem, length(s$items)),
      paste0(sprintf("%s부터 %s까지 값의 범위가 같습니다", s$items[1], s$items[length(s$items)]),
             if (!is.null(s$total)) sprintf(" '%s'는 이 문항들의 합계로 보입니다.", s$total) else ".",
             " 문항끼리의 높은 상관은 당연하므로 관계 신호에서 뺐습니다. 신뢰도와 요인 구조를 확인해 보세요."),
      measure = "Cronbach α", value = s$alpha, n = s$n, size = NA_character_, score = 0.9,
      draw = list(type = "item_cor", vars = s$items),
      suggestions = list(sug_planned("신뢰도 분석", "reliability"), sug_planned("요인분석", "factor")))
  }
  if (!is.null(rep)) {
    out[[length(out) + 1]] <- signal(
      "repeated", c(rep$id, rep$time), sprintf("한 '%s'에 여러 행이 있습니다", rep$id),
      paste0(sprintf("ID %d개, ID마다 평균 %s행(최대 %d행)입니다. 반복 측정 자료로 보입니다", rep$ids, fmt_num(rep$mean, 1), rep$max),
             if (length(rep$time)) sprintf("('%s'가 시점으로 보임)", rep$time[1]) else "",
             ". 같은 사람의 행은 서로 독립이 아니므로, 행을 독립으로 보는 분석은 표준오차를 과소추정합니다. 혼합모형이 맞습니다."),
      measure = "ID당 평균 행 수", value = rep$mean, n = rep$ids, score = 1.5,
      draw = list(type = "per_id", x = rep$id), suggestions = list(sug_planned("혼합모형", "mixed")))
  }
  for (stem in names(wide)) {
    cols <- wide[[stem]]
    out[[length(out) + 1]] <- signal(
      "wide", cols, sprintf("'%s'를 여러 시점에 잰 열로 보입니다", stem),
      sprintf("%s는 같은 측정의 시점별 열로 보입니다(넓은 형식). 시점 간 변화는 대응 비교나 혼합모형으로 봅니다. 혼합모형에는 긴 형식(pivot_longer)이 필요합니다.",
              paste(cols, collapse = ", ")),
      measure = "열 수", value = length(cols), n = sum(stats::complete.cases(d[cols])), score = 1.1,
      draw = list(type = "wide_means", vars = cols),
      suggestions = list(sug_planned("대응 t 검정", "ttests"), sug_planned("혼합모형", "mixed")))
  }
  out
}

# ---------- relations ----------

#' Pairs of variables that go together, and groups that differ
relation_signals <- function(d, kinds, rel, skip_pair, groups = TRUE) {
  out <- list()
  pairs <- list()
  if (length(rel) < 2) return(list(signals = out, pairs = pairs))
  num <- vapply(rel, function(n) is_num_kind(kinds[[n]], d[[n]]), TRUE)
  for (i in seq_along(rel)[-length(rel)]) for (j in (i + 1):length(rel)) {
    a <- rel[i]; b <- rel[j]
    if (skip_pair(a, b)) next
    if (!groups && num[[a]] != num[[b]]) next
    s <- assoc(d[[a]], d[[b]], num[[a]], num[[b]])
    if (is.null(s)) next
    pairs[[length(pairs) + 1]] <- c(list(a = a, b = b), s)
  }
  for (p in pairs) {
    a <- p$a; b <- p$b
    if (p$type == "num-num") {
      if (abs(p$pearson) >= 0.95) {
        out[[length(out) + 1]] <- signal(
          "redundant", c(a, b), sprintf("'%s'와 '%s'는 거의 같은 정보입니다", a, b),
          "둘을 함께 예측 변수로 넣으면 다중공선성으로 계수가 불안정해집니다. 하나만 쓰거나 합치세요.",
          measure = "Pearson r", value = p$pearson, n = p$n, size = "큼", score = 0.75, draw = list(type = "scatter", x = a, y = b))
      } else if (at_least_medium(p$size) && abs(p$value) - abs(p$pearson) >= 0.15) {
        out[[length(out) + 1]] <- signal(
          "nonlinear", c(a, b), sprintf("'%s'와 '%s'는 곡선 관계일 수 있습니다", a, b),
          sprintf("순위 상관(ρ = %s)이 직선 상관(r = %s)보다 큽니다. 관계가 직선이 아니거나, 몇몇 극단값이 직선 상관을 낮췄을 수 있습니다. 산점도를 보고 변환이나 스플라인을 생각해 보세요.",
                  fmt_num(p$value), fmt_num(p$pearson)),
          measure = p$measure, value = p$value, n = p$n, size = p$size, score = p$strength + 0.1, draw = list(type = "scatter", x = a, y = b),
          suggestions = list(sug_regression(b, "gaussian", a)))
      } else if (abs(p$pearson) >= 0.3 && abs(p$pearson) - abs(p$value) >= 0.2) {
        out[[length(out) + 1]] <- signal(
          "outlier_driven", c(a, b), sprintf("'%s'와 '%s'의 상관은 몇몇 극단값 때문일 수 있습니다", a, b),
          sprintf("직선 상관(r = %s)이 순위 상관(ρ = %s)보다 훨씬 큽니다. 극단값 몇 개가 상관을 만들었을 수 있습니다. 산점도에서 그 점들을 확인하세요.",
                  fmt_num(p$pearson), fmt_num(p$value)),
          measure = "Pearson r", value = p$pearson, n = p$n, size = size_r(abs(p$pearson)), score = 0.6, draw = list(type = "scatter", x = a, y = b),
          suggestions = list(sug_integrity()))
      } else if (at_least_medium(p$size)) {
        dir <- if (p$value > 0) "함께 커집니다" else "한쪽이 커지면 다른 쪽은 작아집니다"
        out[[length(out) + 1]] <- signal(
          "association", c(a, b), sprintf("'%s'와 '%s'는 %s", a, b, dir),
          "관계의 크기가 중간 이상입니다. 다른 변수를 통제해도 남는지 회귀로 확인해 보세요. 함께 움직인다는 것이 원인이라는 뜻은 아닙니다.",
          measure = p$measure, value = p$value, n = p$n, size = p$size, score = p$strength, draw = list(type = "scatter", x = a, y = b),
          suggestions = list(sug_regression(b, "gaussian", a)))
      }
    } else if (p$type == "num-cat") {
      if (!at_least_medium(p$size)) next
      y <- if (is_num_kind(kinds[[a]], d[[a]])) a else b
      g <- setdiff(c(a, b), y)
      planned <- if (p$groups == 2) sug_planned("독립 t 검정", "ttests") else sug_planned("일원분산분석", "anova")
      out[[length(out) + 1]] <- signal(
        "group_diff", c(y, g), sprintf("'%s'는 '%s'에 따라 다릅니다", y, g),
        sprintf("'%s'의 차이 가운데 %s를 '%s' 집단이 설명합니다. 집단별 평균과 분포를 비교해 보세요.", y, pct(p$value), g),
        measure = p$measure, value = p$value, n = p$n, size = p$size, score = p$strength, draw = list(type = "box", x = g, y = y),
        suggestions = list(planned, sug_regression(y, "gaussian", categorical = g)))
    } else {
      if (p$value >= 0.95) {
        out[[length(out) + 1]] <- signal(
          "redundant", c(a, b), sprintf("'%s'와 '%s'는 같은 구분입니다", a, b),
          "한 변수의 범주가 다른 변수의 범주와 거의 일대일로 맞습니다. 같은 정보를 두 번 넣지 않도록 하나만 쓰세요.",
          measure = p$measure, value = p$value, n = p$n, size = "큼", score = 0.7, draw = list(type = "stack", x = a, y = b))
      } else if (at_least_medium(p$size)) {
        bin <- c(a, b)[vapply(c(a, b), function(v) kinds[[v]] == "binary", TRUE)]
        sug <- list(sug_planned("교차표와 카이제곱 검정", "frequencies"))
        if (length(bin)) {
          om <- outcome_model(d[[bin[1]]], "binary")
          sug <- c(sug, list(sug_regression(bin[1], "binomial", categorical = setdiff(c(a, b), bin[1]), event = om$event)))
        }
        out[[length(out) + 1]] <- signal(
          "association", c(a, b), sprintf("'%s'와 '%s'는 관련이 있습니다", a, b),
          "한 변수의 범주에 따라 다른 변수의 비율이 다릅니다. 교차표에서 어느 칸이 기대보다 많은지 보세요.",
          measure = p$measure, value = p$value, n = p$n, size = p$size, score = p$strength, draw = list(type = "stack", x = a, y = b),
          suggestions = sug)
      }
    }
  }
  list(signals = out, pairs = pairs)
}

# ---------- missingness that depends on other variables ----------

missing_signals <- function(d, kinds, rel) {
  out <- list()
  for (v in names(d)) {
    m <- is.na(d[[v]])
    if (mean(m) < 0.05 || mean(m) > 0.95 || sum(m) < 5) next
    best <- NULL
    for (w in setdiff(rel, v)) {
      x <- d[[w]]
      num <- is_num_kind(kinds[[w]], x)
      s <- assoc(as.numeric(m), x, TRUE, num)
      if (is.null(s)) next
      st <- if (num) abs(s$pearson %||% s$value) else s$strength
      if (num && s$type == "num-num") { s$measure <- "점이연 r"; s$value <- s$pearson; st <- abs(s$pearson) }
      if (st >= 0.2 && (is.null(best) || st > best$st)) best <- c(s, list(w = w, num = num, st = st))
    }
    if (is.null(best)) next
    text <- if (best$num) {
      sprintf("'%s'가 빠진 행과 있는 행에서 '%s'의 평균이 다릅니다. 결측이 무작위가 아닐(MAR) 단서입니다. 완전한 행만 쓰면 결과가 치우칠 수 있습니다.", v, best$w)
    } else {
      sprintf("'%s'의 범주에 따라 '%s'의 결측 비율이 다릅니다. 결측이 무작위가 아닐(MAR) 단서입니다.", best$w, v)
    }
    out[[length(out) + 1]] <- signal(
      "missing_related", c(v, best$w), sprintf("'%s'의 결측은 '%s'와 관련이 있습니다", v, best$w), text,
      measure = best$measure, value = best$value, n = best$n, size = size_r(best$st), score = 0.5 + best$st / 2,
      draw = list(type = "missing_by", x = v, y = best$w, num = best$num),
      suggestions = list(sug_missing(v, best$w, best$num)))
  }
  out
}

`%||%` <- function(a, b) if (is.null(a)) b else a

# ---------- target ----------

#' What goes with the target variable, ranked, and a regression to start from
target_analysis <- function(d, kinds, target, rel) {
  x <- d[[target]]
  k <- kinds[[target]]
  num_t <- is_num_kind(k, x)
  rows <- list()
  for (w in setdiff(rel, target)) {
    num_w <- is_num_kind(kinds[[w]], d[[w]])
    s <- assoc(x, d[[w]], num_t, num_w)
    if (is.null(s)) next
    rows[[length(rows) + 1]] <- data.frame(variable = w, kind = KIND_LABEL[[kinds[[w]]]], measure = s$measure, value = s$value,
                                            strength = s$strength, size = s$size, n = s$n, numeric = num_w, stringsAsFactors = FALSE)
  }
  tab <- if (length(rows)) do.call(rbind, rows) else
    data.frame(variable = character(), kind = character(), measure = character(), value = numeric(), strength = numeric(),
               size = character(), n = integer(), numeric = logical())
  tab <- tab[order(-tab$strength), , drop = FALSE]
  model <- outcome_model(x, k)
  list(table = tab, model = model, kind = k, numeric = num_t)
}

target_signals <- function(d, kinds, target, ta) {
  out <- list()
  tab <- ta$table
  top <- tab[tab$strength >= 0.1, , drop = FALSE]
  if (!is.null(ta$model) && nrow(top)) {
    use <- utils::head(top, 5)
    fam <- ta$model$family
    out[[length(out) + 1]] <- signal(
      "target_model", c(target, use$variable), sprintf("'%s'와 관련이 큰 변수 %d개로 회귀를 시작해 보세요", target, nrow(use)),
      sprintf("관련 크기 순으로 %s입니다. 하나씩 따로 본 관계이므로, 회귀에서 함께 넣었을 때 남는지 확인하세요. 결과 변수의 유형에 맞춰 %s를 골랐습니다.",
              paste(sprintf("%s(%s)", use$variable, use$size), collapse = ", "), FAMILY_LABEL[[fam]]),
      measure = "관련 변수 수", value = nrow(top), n = sum(!is.na(d[[target]])), score = 3,
      draw = list(type = "target_rank", y = target),
      suggestions = list(sug_regression(target, fam, use$variable[use$numeric], use$variable[!use$numeric], ta$model$event)))
  } else if (is.null(ta$model)) {
    out[[length(out) + 1]] <- signal(
      "target_model", target, sprintf("'%s'는 범주가 셋 이상인 결과 변수입니다", target),
      "다항 로지스틱 회귀가 맞습니다. 이 앱의 회귀 모듈에는 아직 없으니 어시스턴트에게 맡기거나, 두 범주로 묶어 로지스틱 회귀로 보세요.",
      n = sum(!is.na(d[[target]])), score = 3, draw = list(type = "target_rank", y = target))
  }
  strong <- top[vapply(top$size, at_least_medium, TRUE), , drop = FALSE]
  for (i in seq_len(min(3, nrow(strong)))) {
    r <- strong[i, ]
    w <- r$variable
    draw <- if (ta$numeric && r$numeric) list(type = "scatter", x = w, y = target)
            else if (ta$numeric) list(type = "box", x = w, y = target)
            else if (r$numeric) list(type = "box", x = target, y = w)
            else list(type = "stack", x = w, y = target)
    out[[length(out) + 1]] <- signal(
      "target", c(target, w), sprintf("'%s'는 '%s'와 관련이 %s", target, w, if (r$size == "큼") "큽니다" else "있습니다"),
      sprintf("목표 변수와의 관련 크기 %d위(%s)입니다. 그림에서 관계의 모양(직선, 곡선, 몇몇 극단값)을 확인하세요.", i, r$size),
      measure = r$measure, value = r$value, n = r$n, size = r$size, score = 2.5 - i * 0.1 + r$strength / 10, draw = draw)
  }
  out
}
