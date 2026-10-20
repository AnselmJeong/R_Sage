# Adjusted means or probabilities, slopes and contrasts (modelbased). The
# population the effect averages over is explicit: the observed covariate
# distribution ("average") or a reference grid ("typical").

SEC_EFF <- "효과 해석"

at_spec <- function(key, var, at, prep) {
  r <- Filter(function(x) identical(one(x$variable), var), at)
  if (!length(r)) return(key)
  vals <- trimws(strsplit(one(r[[1]]$values) %||% "", "[,|]")[[1]])
  vals <- vals[nzchar(vals)]
  if (!length(vals)) return(key)
  if (!is.null(prep$levels[[key]])) {
    vals <- intersect(vals, prep$levels[[key]])
    if (!length(vals)) return(key)
    return(sprintf("%s=c(%s)", key, paste(vapply(vals, deparse, ""), collapse = ",")))
  }
  num <- suppressWarnings(as.numeric(vals))
  num <- num[is.finite(num)]
  if (!length(num)) return(key)
  # Values are on the original scale; centred variables shift by the same constant.
  shift <- prep$constants[[var]] %||% 0
  sprintf("%s=c(%s)", key, paste(format(num - shift, digits = 15), collapse = ","))
}

effects_items <- function(fits, o, prep) {
  e <- o$effects
  if (!has("modelbased") || !has("marginaleffects"))
    return(list(note("보정 평균·기울기·대조에는 modelbased와 marginaleffects 패키지가 필요합니다.", "regression_backend_missing")))
  ok <- Filter(function(f) !is.null(f$fit), fits)
  id <- one(e$modelId)
  f <- Filter(function(x) identical(x$model$id, id), ok)
  f <- if (length(f)) f[[1]] else ok[[length(ok)]]
  focal <- one(e$focal)
  if (is.null(focal)) return(list(note("효과를 볼 설명변수(초점 변수)를 고르세요.", "regression_effects_focal", "info")))
  mod <- one(e$moderator)
  fk <- key_of(focal, prep)
  mk <- if (!is.null(mod)) key_of(mod, prep) else NULL
  in_model <- all.vars(stats::formula(f$fit))
  if (is.na(fk) || !fk %in% in_model || (!is.null(mk) && (is.na(mk) || !mk %in% in_model)))
    return(list(note(sprintf("%s에 없는 변수입니다. 효과는 모형에 들어 있는 설명변수로만 봅니다.", f$label), "regression_invalid_term")))
  kind <- e$kind
  categorical <- !is.null(prep$levels[[fk]])
  if (kind == "slopes" && categorical) return(list(note("기울기는 연속 설명변수에 대해 봅니다. 범주 변수는 '범주 차이'를 고르세요.", "regression_invalid_term")))
  if (kind == "contrasts" && !categorical) return(list(note("범주 차이는 범주 설명변수에 대해 봅니다. 연속 변수는 '기울기'를 고르세요.", "regression_invalid_term")))
  at <- rows_of(e$at)
  by_focal <- at_spec(fk, focal, at, prep)
  by_mod <- if (!is.null(mk)) at_spec(mk, mod, at, prep) else NULL
  est <- if (identical(e$marginalization, "reference_grid")) "typical" else "average"
  scale <- if (identical(e$scale, "link")) "link" else "response"
  r <- quietly(switch(kind,
    means = modelbased::estimate_means(f$fit, by = c(by_focal, by_mod), estimate = est, predict = scale, ci = o$inference$ciLevel),
    slopes = modelbased::estimate_slopes(f$fit, trend = fk, by = by_mod, estimate = est, predict = scale, ci = o$inference$ciLevel),
    contrasts = modelbased::estimate_contrasts(f$fit, contrast = by_focal, by = by_mod, estimate = est, predict = scale,
                                               p_adjust = e$adjust %||% "holm", ci = o$inference$ciLevel)))
  if (!is.null(r$error)) return(list(note(sprintf("효과를 계산하지 못했습니다: %s", r$error), "regression_component_failed")))
  d <- as.data.frame(r$value)
  rename <- stats::setNames(prep$map[names(d)], names(d))
  names(d)[!is.na(rename)] <- rename[!is.na(rename)]
  for (k in names(prep$constants)) if (k %in% names(d) && is.numeric(d[[k]])) d[[k]] <- d[[k]] + prep$constants[[k]]
  for (k in intersect(c("Level1", "Level2", "Parameter"), names(d))) d[[k]] <- as.character(d[[k]])
  value <- intersect(c("Mean", "Probability", "Predicted", "Slope", "Difference", "Ratio"), names(d))[1]
  keep <- setdiff(names(d), c("CI", "df", "df_error"))
  pop <- if (est == "average") "관측 표본의 공변량 분포에 대해 평균했습니다" else "다른 설명변수를 대표값(평균·기준 범주)에 고정했습니다"
  labels <- c(Mean = "평균", Probability = "확률", Predicted = "예측값", Slope = "기울기", Difference = "차이", Ratio = "비",
              SE = "SE", CI_low = "CI 하한", CI_high = "CI 상한", t = "t", z = "z", p = "p", Level1 = "수준 1", Level2 = "수준 2")
  title <- switch(kind, means = "보정 평균", slopes = "기울기", contrasts = "범주 차이")
  id <- switch(kind, means = "effects", slopes = "slopes", contrasts = "contrasts")
  why <- switch(kind,
    means = "설명변수 값마다 결과의 예상값입니다. 다른 변수의 영향을 고려한 뒤의 값이라 원자료의 단순 평균과 다를 수 있습니다.",
    slopes = "초점 변수가 한 단위 늘 때 결과가 얼마나 달라지는지를 조절변수 값마다 봅니다. 기울기가 조절변수에 따라 다르면 상호작용입니다.",
    contrasts = "초점 변수의 범주 쌍마다 결과의 차이입니다. 여러 쌍을 함께 검정하므로 p값을 보정했습니다.")
  items <- list(rsage::rs_table(id, title, d[keep], labels = labels[intersect(names(labels), keep)],
    notes = c(sprintf("%s. 대상 모형: %s. 척도: %s.", pop, f$label, if (scale == "response") "결과 (확률·개수·평균)" else "링크"),
              if (kind == "contrasts") sprintf("다중 비교 보정: %s.", e$adjust %||% "holm"),
              "modelbased로 계산했습니다."),
    section = SEC_EFF, description = why))
  if (!is.na(value) && kind != "contrasts") {
    xvar <- if (kind == "slopes") mod else focal
    if (!is.null(xvar) && xvar %in% names(d)) {
      col <- if (kind == "means" && !is.null(mod) && mod %in% names(d)) mod else NULL
      g <- ggplot2::ggplot(d, ggplot2::aes(x = .data[[xvar]], y = .data[[value]]))
      if (!is.null(col)) g <- g + ggplot2::aes(colour = factor(.data[[col]]), group = factor(.data[[col]]))
      if (is.numeric(d[[xvar]])) {
        g <- g + ggplot2::geom_ribbon(ggplot2::aes(ymin = CI_low, ymax = CI_high, fill = if (!is.null(col)) factor(.data[[col]]) else NULL), alpha = 0.15, colour = NA) +
          ggplot2::geom_line()
      } else {
        g <- g + ggplot2::geom_pointrange(ggplot2::aes(ymin = CI_low, ymax = CI_high), position = ggplot2::position_dodge(width = 0.3))
      }
      if (kind == "slopes") g <- g + ggplot2::geom_hline(yintercept = 0, linetype = 2, colour = "grey50")
      g <- g + ggplot2::labs(x = xvar, y = labels[[value]], colour = col, fill = col) + theme_rs()
      items <- c(items, list(rsage::rs_plot(id, title, g, size = rsage::rs_figure_size(legend = !is.null(col)), section = SEC_EFF,
        description = "선(또는 점)은 추정값, 띠(또는 막대)는 신뢰구간입니다. 회색 점선 0을 지나지 않는 기울기는 0과 구별됩니다. 자료가 없는 범위로 선을 늘려 읽지 않습니다.")))
    }
  }
  items
}
