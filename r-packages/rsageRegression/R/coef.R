# Coefficients with confidence intervals (parameters), standardised
# coefficients and the coefficient plot.

exp_kind <- function(s) {
  if (s$link == "logit") "OR"
  else if (s$link == "log") if (FAMILIES[[s$family]]$kind == "count") "개수비" else "평균비"
  else NA_character_
}

# Which term each column of the design matrix belongs to.
coef_terms <- function(fit, prep) {
  mm <- stats::model.matrix(fit)
  asg <- attr(mm, "assign")
  labs <- attr(stats::terms(fit), "term.labels")
  stats::setNames(ifelse(asg == 0, "절편", vapply(labs[pmax(asg, 1)], label_term, "", prep = prep)), colnames(mm))
}

coef_table <- function(fits, o, prep) {
  level <- o$inference$ciLevel
  method <- if (identical(o$inference$ciMethod, "profile")) "profile" else "wald"
  rows <- list()
  notes <- list()
  for (f in fits) {
    if (is.null(f$fit)) next
    fit <- f$fit
    m <- if (inherits(fit, "lm") && !inherits(fit, "glm")) "wald" else method
    mp <- quietly(as.data.frame(parameters::model_parameters(fit, ci = level, ci_method = m, verbose = FALSE)))
    if (!is.null(mp$error)) {
      notes <- c(notes, list(note(sprintf("%s 계수표를 만들지 못했습니다: %s", f$label, mp$error), "regression_component_failed")))
      next
    }
    p <- mp$value
    stat <- intersect(c("t", "z", "Chi2"), names(p))[1]
    tl <- coef_terms(fit, prep)
    ek <- exp_kind(f$setting)
    show_exp <- !is.na(ek) && isTRUE(o$output$exponentiate)
    rows[[length(rows) + 1]] <- data.frame(
      model = f$label,
      term = unname(ifelse(p$Parameter %in% names(tl), tl[p$Parameter], p$Parameter)),
      parameter = vapply(p$Parameter, label_coef, "", prep = prep),
      estimate = p$Coefficient, se = p$SE, ci_low = p$CI_low, ci_high = p$CI_high,
      statistic = if (!is.na(stat)) p[[stat]] else NA_real_,
      stat = if (!is.na(stat)) stat else "",
      df = if ("df_error" %in% names(p)) p$df_error else NA_real_,
      p = p$p,
      exp_kind = if (show_exp) ek else "",
      exp_estimate = if (show_exp) exp(p$Coefficient) else NA_real_,
      exp_ci_low = if (show_exp) exp(p$CI_low) else NA_real_,
      exp_ci_high = if (show_exp) exp(p$CI_high) else NA_real_,
      stringsAsFactors = FALSE)
  }
  if (!length(rows)) return(list(table = NULL, notes = notes, data = NULL))
  t <- do.call(rbind, rows)
  rownames(t) <- NULL
  t$df[!is.finite(t$df)] <- NA
  refs <- vapply(names(prep$levels), function(k) {
    lv <- prep$levels[[k]]
    if (!is.null(prep$contrasts[[k]])) sprintf("%s: 효과 코딩 (마지막 범주 %s는 다른 계수들로 정해짐)", prep$map[k], lv[length(lv)])
    else sprintf("%s: 기준 범주 %s", prep$map[k], lv[1])
  }, "")
  footer <- c(sprintf("%g%% 신뢰구간, %s.", level * 100, if (method == "profile") "GLM은 프로파일 가능도 (선형 모형은 t 분포), p값은 Wald" else "Wald (선형 모형은 t 분포)"),
              if (length(refs)) paste("범주 변수의", paste(refs, collapse = "; ")))
  if (any(nzchar(t$exp_kind))) footer <- c(footer, "exp(b)는 계수를 지수화한 값입니다: 로짓 링크는 오즈비(OR), 로그 링크는 기대 개수·평균의 비. 표준오차와 검정은 원래 계수 척도입니다.")
  keep_exp <- any(nzchar(t$exp_kind))
  cols <- c("model", "term", "parameter", "estimate", "se", "ci_low", "ci_high", "stat", "statistic", "df", "p",
            if (keep_exp) c("exp_kind", "exp_estimate", "exp_ci_low", "exp_ci_high"))
  if (all(is.na(t$df))) cols <- setdiff(cols, "df")
  tab <- rsage::rs_table("coefficients", "회귀계수", t[cols],
    labels = c(model = "모형", term = "항", parameter = "계수", estimate = "b", se = "SE", ci_low = "CI 하한", ci_high = "CI 상한",
               stat = "검정", statistic = "통계량", df = "df", p = "p", exp_kind = "척도", exp_estimate = "exp(b)",
               exp_ci_low = "exp CI 하한", exp_ci_high = "exp CI 상한"),
    notes = footer, section = "계수와 항 검정",
    description = "b는 다른 항을 그대로 둘 때 설명변수가 한 단위 늘면 결과(선형 모형) 또는 링크 척도가 얼마나 달라지는지입니다. 방향과 크기를 신뢰구간과 함께 읽습니다. 상호작용이 있으면 주효과 계수는 상대 변수가 0(또는 기준 범주)일 때의 효과입니다. 범주 변수 전체의 기여는 항 검정 표를 봅니다.")
  list(table = tab, notes = notes, data = t)
}

standardized_table <- function(fits, o, prep) {
  rows <- list()
  notes <- list()
  for (f in fits) {
    if (is.null(f$fit)) next
    r <- quietly(as.data.frame(parameters::standardize_parameters(f$fit, method = "refit", ci = o$inference$ciLevel, verbose = FALSE)))
    if (!is.null(r$error)) {
      notes <- c(notes, list(note(sprintf("%s의 표준화 계수를 계산하지 못했습니다: %s", f$label, r$error), "regression_component_failed")))
      next
    }
    p <- r$value
    p <- p[p$Parameter != "(Intercept)", , drop = FALSE]
    if (!nrow(p)) next
    rows[[length(rows) + 1]] <- data.frame(model = f$label, parameter = vapply(p$Parameter, label_coef, "", prep = prep),
                                           std = p$Std_Coefficient, ci_low = p$CI_low, ci_high = p$CI_high)
  }
  if (!length(rows)) return(list(table = NULL, notes = notes))
  lm_only <- all(vapply(fits, function(f) is.null(f$fit) || f$setting$family == "gaussian", TRUE))
  list(table = rsage::rs_table("standardized", "표준화 계수", do.call(rbind, rows),
    labels = c(model = "모형", parameter = "계수", std = "표준화 계수", ci_low = "CI 하한", ci_high = "CI 상한"),
    notes = c("연속 설명변수를 평균 0, 표준편차 1로 바꿔 다시 적합했습니다 (parameters::standardize_parameters, refit). 범주 변수의 더미는 표준화하지 않습니다.",
              if (!lm_only) "GLM은 결과를 표준화하지 않으므로, 값은 설명변수 1 SD 변화에 따른 링크 척도의 변화입니다."),
    section = "계수와 항 검정",
    description = "단위가 다른 연속 설명변수의 효과를 같은 잣대(1 표준편차 변화)로 나란히 봅니다. 크기 비교는 표본의 분포에 따라 달라지므로 원 단위 계수와 함께 읽습니다."),
    notes = notes)
}

coef_plot <- function(t) {
  if (is.null(t)) return(NULL)
  d <- t[t$term != "절편", , drop = FALSE]
  if (!nrow(d)) return(NULL)
  use_exp <- all(nzchar(d$exp_kind))
  d$x <- if (use_exp) d$exp_estimate else d$estimate
  d$lo <- if (use_exp) d$exp_ci_low else d$ci_low
  d$hi <- if (use_exp) d$exp_ci_high else d$ci_high
  d$parameter <- factor(d$parameter, levels = rev(unique(d$parameter)))
  models <- unique(d$model)
  g <- ggplot2::ggplot(d, ggplot2::aes(x = x, y = parameter)) +
    ggplot2::geom_vline(xintercept = if (use_exp) 1 else 0, linetype = 2, colour = "grey50") +
    ggplot2::geom_errorbar(ggplot2::aes(xmin = lo, xmax = hi), width = 0.2, orientation = "y") +
    ggplot2::geom_point(size = 2) +
    ggplot2::labs(x = if (use_exp) "exp(b)와 신뢰구간 (로그 축)" else "b와 신뢰구간", y = NULL) +
    theme_rs()
  if (use_exp) g <- g + ggplot2::scale_x_log10()
  if (length(models) > 1) g <- g + ggplot2::facet_wrap(~model, nrow = 1)
  size <- rsage::rs_figure_size(panels = length(models), y_items = length(levels(d$parameter)),
                                label_chars = max(nchar(as.character(d$parameter))), ncol = length(models))
  rsage::rs_plot("coefficients", "계수 그림", g, size = size, section = "계수와 항 검정",
    alt = "모형별 계수와 신뢰구간",
    description = if (use_exp) "점은 exp(b), 선은 신뢰구간입니다. 1(점선)을 지나지 않으면 그 계수는 0과 구별됩니다. 축이 로그 척도라 2배와 0.5배가 같은 거리입니다."
                  else "점은 계수, 선은 신뢰구간입니다. 0(점선)을 지나지 않으면 그 계수는 0과 구별됩니다. 단위가 다른 변수의 막대 길이를 직접 비교하지 않습니다.")
}
