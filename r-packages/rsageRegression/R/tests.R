# Term tests, fit indices and model comparisons. Nested models are compared
# on the same rows with the test that fits the family: F for linear models
# and families that estimate a dispersion, likelihood ratio for binomial,
# Poisson and negative binomial. Non-nested models get information criteria
# only, and quasi models get no likelihood at all.

test_kind <- function(s) {
  if (s$family == "gaussian" && s$link == "identity") "F"
  else if (s$family %in% c("binomial", "poisson", "negative_binomial")) "LRT"
  else "F"
}

# reduced vs full on the same data: test name, df, statistic, p.
compare_fits <- function(red, full, s) {
  kind <- test_kind(s)
  if (s$family == "negative_binomial") {
    lr <- 2 * (as.numeric(stats::logLik(full)) - as.numeric(stats::logLik(red)))
    df <- attr(stats::logLik(full), "df") - attr(stats::logLik(red), "df")
    return(list(test = "LR χ² (θ 재추정)", df = df, stat = lr, p = stats::pchisq(lr, df, lower.tail = FALSE)))
  }
  a <- if (inherits(full, "glm")) stats::anova(red, full, test = if (kind == "LRT") "LRT" else "F") else stats::anova(red, full)
  a <- as.data.frame(a)
  r <- a[2, ]
  if (kind == "LRT") list(test = "LR χ²", df = r$Df, stat = r$Deviance, p = r[["Pr(>Chi)"]])
  else list(test = "F", df = r$Df, stat = r$F, p = r[["Pr(>F)"]])
}

refit <- function(fit, terms_keep, f_info) {
  f <- model_formula(utils::modifyList(f_info$model, list(termIds = terms_keep)), f_info$terms, f_info$prep, f_info$response)
  stats::update(fit, formula. = f)
}

hierarchical_tests <- function(f, terms, prep) {
  ids <- chr(f$model$termIds)
  if (!length(ids)) return(NULL)
  vars <- lapply(terms[ids], term_vars, terms = terms)
  lm_like <- !inherits(f$fit, "glm")
  r2 <- if (lm_like) summary(f$fit)$r.squared else NA
  rss_full <- if (lm_like) sum(stats::residuals(f$fit)^2) else NA
  rows <- lapply(seq_along(ids), function(i) {
    above <- ids[vapply(vars, function(v) length(v) > length(vars[[i]]) && all(vars[[i]] %in% v), TRUE)]
    drop <- c(ids[i], above)
    red <- quietly(refit(f$fit, setdiff(ids, drop), f))
    if (!is.null(red$error)) return(NULL)
    t <- quietly(compare_fits(red$value, f$fit, f$setting))
    if (!is.null(t$error)) return(NULL)
    t <- t$value
    rss_red <- if (lm_like) sum(stats::residuals(red$value)^2) else NA
    data.frame(model = f$label, term = paste(vars[[i]], collapse = " × "),
               removed = paste(vapply(vars[drop], paste, "", collapse = " × "), collapse = ", "),
               test = t$test, df = t$df, statistic = t$stat, p = t$p,
               delta_r2 = if (lm_like) r2 - summary(red$value)$r.squared else NA_real_,
               partial_r2 = if (lm_like) (rss_red - rss_full) / rss_red else NA_real_)
  })
  do.call(rbind, rows)
}

anova_tests <- function(f, type) {
  fit <- f$fit
  kind <- test_kind(f$setting)
  if (type == "type1") {
    if (f$setting$family == "negative_binomial") return(NULL)
    a <- if (inherits(fit, "glm")) stats::anova(fit, test = if (kind == "LRT") "LRT" else "F") else stats::anova(fit)
  } else {
    if (!has("car")) return("car")
    a <- car::Anova(fit, type = if (type == "type2") 2 else 3, test.statistic = if (kind == "LRT") "LR" else "F")
  }
  a <- as.data.frame(a)
  a <- a[!rownames(a) %in% c("Residuals", "NULL", "(Intercept)"), , drop = FALSE]
  stat <- intersect(c("F value", "F", "LR Chisq", "Deviance", "Chisq"), names(a))[1]
  pcol <- grep("^Pr\\(", names(a), value = TRUE)[1]
  data.frame(model = f$label, term = vapply(rownames(a), label_term, "", prep = f$prep), removed = "",
             test = if (stat %in% c("LR Chisq", "Deviance", "Chisq")) "LR χ²" else "F",
             df = a$Df, statistic = a[[stat]], p = a[[pcol]], delta_r2 = NA_real_, partial_r2 = NA_real_)
}

term_tests <- function(fits, o, terms, prep) {
  type <- o$inference$termTests
  if (identical(type, "none")) return(list())
  notes <- list()
  rows <- list()
  for (f in fits) {
    if (is.null(f$fit)) next
    r <- quietly(if (type == "hierarchical") hierarchical_tests(f, terms, prep) else anova_tests(f, type))
    if (identical(r$value, "car")) {
      notes <- c(notes, list(note("Type II/III 검정에는 car 패키지가 필요합니다.", "regression_backend_missing")))
      next
    }
    if (!is.null(r$error)) notes <- c(notes, list(note(sprintf("%s 항 검정을 하지 못했습니다: %s", f$label, r$error), "regression_component_failed")))
    else if (!is.null(r$value)) rows[[length(rows) + 1]] <- r$value
  }
  if (!length(rows)) return(notes)
  t <- do.call(rbind, rows)
  lm_cols <- type == "hierarchical" && isTRUE(o$output$partialR2) && any(!is.na(t$delta_r2))
  rownames(t) <- NULL
  cols <- c("model", "term", if (type == "hierarchical") "removed", "test", "df", "statistic", "p", if (lm_cols) c("delta_r2", "partial_r2"))
  how <- switch(type,
    hierarchical = "항을 뺀 모형과 비교했습니다. 그 항을 포함한 상호작용도 함께 뺍니다 (계층성 유지).",
    type1 = "Type I: 항을 들어간 순서대로 하나씩 더하며 검정합니다. 결과가 항의 순서에 따라 달라집니다.",
    type2 = "Type II (car::Anova): 같은 차수의 다른 항을 고려한 검정입니다.",
    type3 = "Type III (car::Anova): 다른 모든 항을 고려한 검정입니다. 상호작용이 있으면 효과 코딩(합 코딩)에서만 의미가 분명합니다.")
  if (type == "type3" && any(vapply(terms, function(t) identical(one(t$kind), "interaction"), TRUE)) && length(prep$levels) > length(prep$contrasts))
    notes <- c(notes, list(note("Type III 검정은 상호작용이 있을 때 범주 변수를 효과 코딩으로 바꿔야 주효과 검정의 뜻이 분명합니다. 지금은 기준 범주 코딩이라 주효과 검정은 다른 변수가 기준 범주일 때의 검정입니다.", "regression_type3_coding")))
  c(notes, list(rsage::rs_table("termTests", "항 검정", t[cols],
    labels = c(model = "모형", term = "항", removed = "함께 뺀 항", test = "검정", df = "df", statistic = "통계량", p = "p",
               delta_r2 = "ΔR² (준부분)", partial_r2 = "부분 R²"),
    notes = how, section = "계수와 항 검정",
    description = "범주 변수처럼 계수가 여러 개인 항 전체가 결과를 설명하는 데 기여하는지 묻습니다. 개별 계수의 p값과는 다른 가설입니다. ΔR²는 그 항을 빼면 줄어드는 설명력, 부분 R²는 다른 항이 설명하지 못한 부분 중 그 항이 설명하는 비율입니다.")))
}

fit_metrics <- function(f) {
  fit <- f$fit
  s <- f$setting
  n <- stats::nobs(fit)
  quasi <- is_quasi(s$family)
  ll <- if (!quasi) stats::logLik(fit) else NULL
  k <- if (!quasi) attr(ll, "df") else NA
  out <- list(model = f$label, setting = setting_label(s), n = n, k = length(stats::coef(fit)), df_resid = stats::df.residual(fit))
  if (!inherits(fit, "glm")) {
    sm <- summary(fit)
    out <- c(out, r2 = sm$r.squared, adj_r2 = sm$adj.r.squared, sigma = sm$sigma, rmse = sqrt(mean(stats::residuals(fit)^2)))
  } else {
    out <- c(out, deviance = stats::deviance(fit), null_deviance = fit$null.deviance)
    if (FAMILIES[[s$family]]$kind == "binary" && !f$prep$grouped) {
      y <- fit$y
      out <- c(out, events = sum(y == 1), nonevents = sum(y == 0))
      if (!quasi) out <- c(out, tjur = tryCatch(unname(performance::r2_tjur(fit)), error = function(e) NA_real_),
                           mcfadden = tryCatch(unname(performance::r2_mcfadden(fit)$R2), error = function(e) NA_real_))
    }
    if (s$family == "negative_binomial") out <- c(out, theta = fit$theta, theta_se = fit$SE.theta)
    else if (s$family %in% c("gamma", "quasibinomial", "quasipoisson", "gaussian")) out <- c(out, dispersion = summary(fit)$dispersion)
    out <- c(out, deviance_explained = 1 - stats::deviance(fit) / fit$null.deviance)
  }
  if (!quasi) {
    aicc <- if (n - k - 1 > 0) stats::AIC(fit) + 2 * k * (k + 1) / (n - k - 1) else NA_real_
    out <- c(out, loglik = as.numeric(ll), aic = stats::AIC(fit), aicc = aicc, bic = stats::BIC(fit))
  }
  as.data.frame(out, stringsAsFactors = FALSE)
}

FIT_LABELS <- c(model = "모형", setting = "종류", n = "N", k = "계수 수", df_resid = "잔차 df", r2 = "R²", adj_r2 = "수정 R²",
                sigma = "잔차 표준편차", rmse = "RMSE", deviance = "이탈도", null_deviance = "영모형 이탈도", events = "사건",
                nonevents = "비사건", tjur = "Tjur R²", mcfadden = "McFadden R²", theta = "θ", theta_se = "θ SE",
                dispersion = "산포 모수", deviance_explained = "설명된 이탈도 비율", loglik = "logLik", aic = "AIC", aicc = "AICc", bic = "BIC")

fit_table <- function(fits) {
  rows <- lapply(Filter(function(f) !is.null(f$fit), fits), fit_metrics)
  if (!length(rows)) return(list())
  cols <- unique(unlist(lapply(rows, names)))
  t <- do.call(rbind, lapply(rows, function(r) { r[setdiff(cols, names(r))] <- NA; r[cols] }))
  t <- t[, vapply(t, function(c) !all(is.na(c)), TRUE), drop = FALSE]
  notes <- character()
  if ("rmse" %in% names(t)) notes <- c(notes, "RMSE는 N으로, 잔차 표준편차는 잔차 df로 나눕니다.")
  if (any(vapply(fits, function(f) is_quasi(f$setting$family), TRUE)))
    notes <- c(notes, "준우도(quasi) 모형에는 가능도가 없어 logLik·AIC·BIC를 계산하지 않습니다.")
  out <- list(rsage::rs_table("modelFit", "적합도", t, labels = FIT_LABELS[names(t)], notes = notes, section = "모형 비교",
    description = "모형이 자료를 얼마나 설명하는지입니다. R²는 선형 모형에만, Tjur·McFadden R²는 이항 모형에 쓰는 다른 지표라 서로 비교하지 않습니다. AIC·BIC는 같은 결과와 같은 행으로 적합한 모형끼리만 비교합니다."))
  if (any(vapply(fits, function(f) is_quasi(f$setting$family), TRUE)))
    out <- c(out, list(note("quasi 모형의 AIC·BIC·가능도비 검정은 해당 없음으로 두었습니다.", "regression_metric_unavailable", "info")))
  out
}

# Models whose likelihoods can be compared: same response coding, same rows, no quasi.
likelihood_group <- function(f) {
  if (is_quasi(f$setting$family)) return(NA_character_)
  paste(FAMILIES[[f$setting$family]]$kind == "binary", paste(which(f$keep), collapse = ","))
}

nested <- function(red, full, terms) {
  key <- function(f) vapply(terms[chr(f$model$termIds)], term_key, "", terms = terms)
  identical(red$setting[c("family", "link", "estimation")], full$setting[c("family", "link", "estimation")]) &&
    identical(isTRUE(red$model$intercept %||% TRUE), isTRUE(full$model$intercept %||% TRUE)) &&
    all(key(red) %in% key(full)) && length(key(red)) < length(key(full))
}

comparison_tables <- function(fits, o, terms) {
  ok <- Filter(function(f) !is.null(f$fit), fits)
  if (length(ok) < 2) return(list(note("모형 비교에는 적합된 모형이 두 개 이상 필요합니다.", "regression_not_comparable", "info")))
  out <- list()
  groups <- vapply(ok, likelihood_group, "")
  m <- lapply(ok, fit_metrics)
  t <- data.frame(model = vapply(ok, function(f) f$label, ""), setting = vapply(ok, function(f) setting_label(f$setting), ""),
                  n = vapply(m, function(r) r$n, 0), aic = vapply(m, function(r) r$aic %||% NA_real_, 0),
                  bic = vapply(m, function(r) r$bic %||% NA_real_, 0))
  t$delta_aic <- ave(t$aic, groups, FUN = function(x) x - min(x))
  t$delta_bic <- ave(t$bic, groups, FUN = function(x) x - min(x))
  t$delta_aic[is.na(groups)] <- NA
  t$delta_bic[is.na(groups)] <- NA
  t$group <- match(groups, unique(stats::na.omit(groups)))
  out <- c(out, list(rsage::rs_table("modelComparison", "정보 기준 비교", t[c("model", "setting", "n", "group", "aic", "delta_aic", "bic", "delta_bic")],
    labels = c(model = "모형", setting = "종류", n = "N", group = "비교 묶음", aic = "AIC", delta_aic = "ΔAIC", bic = "BIC", delta_bic = "ΔBIC"),
    notes = "ΔAIC·ΔBIC는 같은 비교 묶음(같은 결과 코딩과 같은 행) 안에서 가장 작은 값과의 차이입니다. 작을수록 자료를 더 잘 설명하면서 간결합니다. 종합 점수나 '최고 모형' 판정은 하지 않습니다.",
    section = "모형 비교",
    description = "후보 모형들의 적합과 복잡도의 균형을 비교합니다. 차이가 2 이하면 거의 같은 지지, 10 이상이면 뚜렷한 차이로 흔히 읽습니다. 묶음이 다른 모형끼리는 비교하지 않습니다.")))
  if (any(is.na(groups))) out <- c(out, list(note("quasi 모형은 가능도가 없어 정보 기준 비교에서 뺐습니다.", "regression_metric_unavailable", "info")))
  pairs <- rows_of(o$comparison$pairs)
  by_id <- stats::setNames(ok, vapply(ok, function(f) f$model$id, ""))
  # No pairs given: test each model against the one before it when it adds
  # terms to it (hierarchical regression in model order).
  if (!length(pairs)) {
    for (i in seq_along(ok)[-1]) {
      r <- ok[[i - 1]]
      f <- ok[[i]]
      if (identical(r$keep, f$keep) && nested(r, f, terms)) pairs[[length(pairs) + 1]] <- list(reduced = r$model$id, full = f$model$id)
    }
    if (length(pairs)) out <- c(out, list(note("비교할 쌍을 정하지 않아, 앞 모형에 항을 더한 다음 모형마다 앞 모형과 차이를 검정했습니다.", "regression_auto_pairs", "info")))
  }
  rows <- list()
  for (p in pairs) {
    r <- by_id[[one(p$reduced) %||% ""]]
    f <- by_id[[one(p$full) %||% ""]]
    if (is.null(r) || is.null(f)) next
    why <- if (!identical(r$keep, f$keep)) "두 모형의 행이 다릅니다"
           else if (!identical(r$setting[c("family", "link")], f$setting[c("family", "link")])) "모형 종류나 링크가 달라 중첩 모형이 아닙니다 (Poisson과 음이항처럼). 정보 기준 표로 비교합니다"
           else if (!nested(r, f, terms)) "축소 모형의 항이 전체 모형에 모두 들어 있지 않습니다"
           else NULL
    if (!is.null(why)) {
      out <- c(out, list(note(sprintf("%s → %s: %s. 차이 검정을 하지 않았습니다.", r$label, f$label, why), "regression_not_nested")))
      next
    }
    tt <- quietly(compare_fits(r$fit, f$fit, f$setting))
    if (!is.null(tt$error)) next
    tt <- tt$value
    dr2 <- if (!inherits(f$fit, "glm")) summary(f$fit)$r.squared - summary(r$fit)$r.squared else NA_real_
    rows[[length(rows) + 1]] <- data.frame(reduced = r$label, full = f$label, test = tt$test, df = tt$df, statistic = tt$stat, p = tt$p, delta_r2 = dr2)
  }
  if (length(rows)) {
    t2 <- do.call(rbind, rows)
    if (all(is.na(t2$delta_r2))) t2$delta_r2 <- NULL
    out <- c(out, list(rsage::rs_table("modelTests", "중첩 모형 검정", t2,
      labels = c(reduced = "축소 모형", full = "전체 모형", test = "검정", df = "추가 df", statistic = "통계량", p = "p", delta_r2 = "ΔR²"),
      notes = "선형 모형은 F 검정, 이항·Poisson·음이항은 가능도비 χ² 검정, 산포를 추정하는 GLM은 F 검정입니다.",
      section = "모형 비교",
      description = "더한 항들이 함께 설명력을 의미 있게 늘리는지 검정합니다. p가 작으면 축소 모형보다 전체 모형이 자료를 더 잘 설명합니다. 효과의 크기는 ΔR²와 계수로 따로 봅니다.")))
  }
  out
}
