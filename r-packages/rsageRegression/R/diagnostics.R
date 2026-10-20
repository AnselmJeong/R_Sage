# Diagnostics, each a separate table or plot so one failure leaves the rest.
# Thresholds are starting points for a look, never rules for removing rows.

SEC_DIAG <- "진단"

diag_target <- function(fits, o) {
  ok <- Filter(function(f) !is.null(f$fit), fits)
  if (!length(ok)) return(NULL)
  id <- one(o$diagnostics$modelId)
  hit <- Filter(function(f) identical(f$model$id, id), ok)
  if (length(hit)) hit[[1]] else ok[[length(ok)]]
}

diagnostics_items <- function(fits, o, prep) {
  out <- list()
  ok <- Filter(function(f) !is.null(f$fit), fits)
  # One row per model: what to check before reading its numbers.
  rows <- lapply(ok, function(f) {
    fit <- f$fit
    s <- f$setting
    vif <- NA_real_
    if (isTRUE(o$diagnostics$collinearity) && length(chr(f$model$termIds)) >= 2) {
      cc <- quietly(as.data.frame(performance::check_collinearity(fit, verbose = FALSE)))
      if (is.null(cc$error) && nrow(cc$value)) vif <- max(cc$value$VIF, na.rm = TRUE)
    }
    epp <- if (FAMILIES[[s$family]]$kind == "binary" && !prep$grouped) min(sum(fit$y == 1), sum(fit$y == 0)) / length(stats::coef(fit)) else NA_real_
    data.frame(model = f$label, n = stats::nobs(fit), params = length(stats::coef(fit)),
               rank = fit$rank, converged = if (inherits(fit, "glm")) isTRUE(fit$converged) else TRUE,
               max_vif = vif, events_per_param = epp,
               status = if (length(f$status)) paste(f$status, collapse = "; ") else "문제 없음")
  })
  if (length(rows)) {
    t <- do.call(rbind, rows)
    t <- t[, vapply(t, function(c) !all(is.na(c)), TRUE), drop = FALSE]
    out <- c(out, list(rsage::rs_table("diagnostics", "모형 점검", t,
      labels = c(model = "모형", n = "N", params = "계수 수", rank = "rank", converged = "수렴", max_vif = "최대 VIF",
                 events_per_param = "계수당 사건 수", status = "상태"),
      notes = c(if ("events_per_param" %in% names(t)) "계수당 사건 수는 적은 쪽 범주(사건 또는 비사건)의 수를 계수 수로 나눈 값입니다. 10보다 작으면 계수가 불안정할 수 있습니다.",
                if ("max_vif" %in% names(t)) "VIF는 공선성 표를 봅니다. 상호작용이나 다항 항이 있으면 VIF가 커지는 것이 자연스럽습니다."),
      section = SEC_DIAG,
      description = "계수를 읽기 전에 모형이 제대로 적합되었는지 봅니다. 수렴하지 않았거나 분리가 있으면 계수와 p값을 그대로 믿지 않습니다.")))
  }
  f <- diag_target(fits, o)
  if (is.null(f)) return(out)
  fit <- f$fit
  s <- f$setting
  lm_like <- !inherits(fit, "glm")
  which_model <- sprintf("대상 모형: %s", f$label)
  d <- data.frame(fitted = stats::fitted(fit), linpred = stats::predict(fit),
                  resid = if (lm_like) stats::residuals(fit) else stats::residuals(fit, type = "deviance"),
                  row = f$data$rs_label)
  if (isTRUE(o$diagnostics$residuals)) {
    g <- ggplot2::ggplot(d, ggplot2::aes(x = if (lm_like) fitted else linpred, y = resid)) +
      ggplot2::geom_hline(yintercept = 0, linetype = 2, colour = "grey50") +
      ggplot2::geom_point(alpha = 0.6) +
      ggplot2::geom_smooth(method = "loess", formula = y ~ x, se = FALSE, colour = "#d1495b", linewidth = 0.7) +
      ggplot2::labs(x = if (lm_like) "적합값" else "선형 예측값 (링크 척도)", y = if (lm_like) "잔차" else "이탈도 잔차", subtitle = which_model) +
      theme_rs()
    out <- c(out, list(rsage::rs_plot("residuals", "잔차 대 적합값", g, size = rsage::rs_figure_size(), section = SEC_DIAG,
      description = if (lm_like) "점이 0 주위에 고르게 흩어지면 선형성과 등분산 가정에 맞습니다. 빨간 선이 휘면 빠진 비선형 관계를, 깔때기 모양이면 분산이 달라짐을 의심합니다."
                    else "GLM의 잔차는 정규분포를 따를 필요가 없습니다. 빨간 선이 크게 휘면 링크나 빠진 항을, 따로 떨어진 점은 영향점을 봅니다.")))
    if (lm_like) {
      d$std <- stats::rstandard(fit)
      g2 <- ggplot2::ggplot(d, ggplot2::aes(sample = std)) + ggplot2::stat_qq(alpha = 0.6) + ggplot2::stat_qq_line(colour = "#d1495b") +
        ggplot2::labs(x = "이론 분위수", y = "표준화 잔차", subtitle = which_model) + theme_rs()
      out <- c(out, list(rsage::rs_plot("qq", "잔차 Q–Q 그림", g2, size = rsage::rs_figure_size(aspect = 0.8), section = SEC_DIAG,
        description = "잔차가 정규분포를 따르면 점이 직선 위에 놓입니다. 원변수의 정규성을 보는 그림이 아닙니다. 표본이 크면 꼬리의 약한 이탈은 추론에 큰 영향이 없습니다.")))
      d$sl <- sqrt(abs(d$std))
      g3 <- ggplot2::ggplot(d, ggplot2::aes(fitted, sl)) + ggplot2::geom_point(alpha = 0.6) +
        ggplot2::geom_smooth(method = "loess", formula = y ~ x, se = FALSE, colour = "#d1495b", linewidth = 0.7) +
        ggplot2::labs(x = "적합값", y = "√|표준화 잔차|", subtitle = which_model) + theme_rs()
      out <- c(out, list(rsage::rs_plot("scaleLocation", "척도-위치 그림", g3, size = rsage::rs_figure_size(), section = SEC_DIAG,
        description = "선이 수평에 가까우면 잔차의 퍼짐이 적합값과 관계없이 일정합니다 (등분산). 올라가면 큰 값에서 오차가 커집니다.")))
    }
  }
  if (isTRUE(o$diagnostics$collinearity) && length(chr(f$model$termIds)) >= 2) {
    cc <- quietly(as.data.frame(performance::check_collinearity(fit, verbose = FALSE)))
    if (is.null(cc$error) && nrow(cc$value)) {
      v <- cc$value
      t <- data.frame(term = vapply(v$Term, label_term, "", prep = prep), vif = v$VIF,
                      adj_vif = if ("VIF_adj" %in% names(v)) v$VIF_adj else NA_real_, tolerance = v$Tolerance)
      if (all(is.na(t$adj_vif))) t$adj_vif <- NULL
      out <- c(out, list(rsage::rs_table("collinearity", "공선성 (VIF)", t,
        labels = c(term = "항", vif = "VIF", adj_vif = "df 보정 VIF", tolerance = "공차"), notes = which_model, section = SEC_DIAG,
        description = "VIF는 다른 설명변수로 그 변수가 얼마나 설명되는지입니다. 5~10을 넘으면 계수의 표준오차가 커집니다. 변수를 기계적으로 빼기보다 연구 질문에 필요한 변수인지 먼저 봅니다. 범주 변수는 df 보정 VIF(GVIF^(1/(2df)))를 봅니다.")))
    }
  }
  if (isTRUE(o$diagnostics$influence)) out <- c(out, influence_items(f, d, which_model))
  kind <- FAMILIES[[s$family]]$kind
  if (isTRUE(o$diagnostics$dispersion) && (kind == "count" || (kind == "binary" && prep$grouped)) && !is_quasi(s$family)) {
    od <- quietly(performance::check_overdispersion(fit))
    if (!is.null(od$error)) out <- c(out, list(note(sprintf("%s의 과산포를 점검하지 못했습니다: %s", f$label, od$error), "regression_component_failed", "info")))
    else {
      r <- od$value
      t <- data.frame(model = f$label, ratio = r$dispersion_ratio, chisq = r$chisq_statistic, df = r$residual_df, p = r$p_value)
      out <- c(out, list(rsage::rs_table("dispersion", "과산포 점검", t,
        labels = c(model = "모형", ratio = "산포 비 (Pearson χ²/df)", chisq = "Pearson χ²", df = "잔차 df", p = "p"),
        section = SEC_DIAG,
        description = "산포 비가 1보다 크게 크면 자료가 모형이 가정한 것보다 더 퍼져 있어 표준오차가 작게 나옵니다 (과산포). 음이항이나 quasi-Poisson 모형을 비교 모형으로 더해 봅니다.")))
      if (s$family == "poisson" && isTRUE(r$p_value < 0.05))
        out <- c(out, list(note(sprintf("%s에 과산포가 있습니다 (산포 비 %.2f). 같은 항으로 음이항 모형을 더해 비교해 보세요. 모형 종류는 자동으로 바꾸지 않습니다.", f$label, r$dispersion_ratio), "regression_overdispersion")))
    }
  }
  if (isTRUE(o$diagnostics$zeros) && kind == "count") {
    zi <- quietly(performance::check_zeroinflation(fit))
    if (is.null(zi$error) && !is.null(zi$value)) {
      r <- zi$value
      t <- data.frame(model = f$label, observed = r$observed.zeros, predicted = r$predicted.zeros, ratio = r$ratio)
      out <- c(out, list(rsage::rs_table("zeros", "0의 개수", t,
        labels = c(model = "모형", observed = "관측된 0", predicted = "모형이 예측한 0", ratio = "비 (예측/관측)"), section = SEC_DIAG,
        description = "모형이 예측한 0의 수가 관측보다 많이 적으면 (비가 1보다 작으면) 0이 넘친다는 신호입니다. 0이 많다는 사실만으로 zero-inflated 모형이 맞다고 정하지는 않습니다.")))
      if (isTRUE(r$ratio < 0.95)) out <- c(out, list(note(sprintf("%s: 관측된 0(%d개)이 모형이 예측한 0(%d개)보다 많습니다.", f$label, r$observed.zeros, r$predicted.zeros), "regression_excess_zeros")))
    }
  }
  if (isTRUE(o$diagnostics$calibration) && kind == "binary" && !prep$grouped) out <- c(out, calibration_items(f, which_model))
  out
}

influence_items <- function(f, d, which_model) {
  fit <- f$fit
  n <- stats::nobs(fit)
  p <- length(stats::coef(fit))
  d$cook <- stats::cooks.distance(fit)
  d$lev <- stats::hatvalues(fit)
  d$std <- if (inherits(fit, "glm")) stats::rstandard(fit, type = "deviance") else stats::rstandard(fit)
  d$id <- f$data$rs_row
  d$index <- seq_len(nrow(d))
  cut_c <- 4 / n
  cut_h <- 2 * p / n
  flag <- d[d$cook > cut_c | d$lev > cut_h, , drop = FALSE]
  flag <- flag[order(-flag$cook), , drop = FALSE]
  t <- data.frame(row_id = flag$id, label = flag$row, cook = flag$cook, leverage = flag$lev, std_resid = flag$std)
  if (identical(t$row_id, t$label)) t$label <- NULL
  g <- ggplot2::ggplot(d, ggplot2::aes(index, cook)) + ggplot2::geom_segment(ggplot2::aes(xend = index, yend = 0), colour = "grey40") +
    ggplot2::geom_hline(yintercept = cut_c, linetype = 2, colour = "#d1495b") +
    ggplot2::geom_text(data = utils::head(flag, 5), ggplot2::aes(label = row), vjust = -0.5, size = 3) +
    ggplot2::labs(x = "행 순서 (분석 표본)", y = "Cook 거리", subtitle = which_model) + theme_rs()
  list(rsage::rs_table("influence", "영향점", t,
         labels = c(row_id = "행", label = "라벨", cook = "Cook 거리", leverage = "지렛값", std_resid = "표준화 잔차"),
         notes = sprintf("Cook 거리 > 4/N = %.3f 또는 지렛값 > 2p/N = %.3f인 행입니다. %s.", cut_c, cut_h, which_model),
         section = SEC_DIAG,
         description = "한 행이 계수를 얼마나 움직이는지입니다. 표시된 행은 확인할 출발점이지 지울 대상이 아닙니다. 입력 오류가 아니라면 빼고 다시 적합한 민감도 분석을 따로 만들어 비교합니다."),
       rsage::rs_plot("influence", "Cook 거리", g, size = rsage::rs_figure_size(), section = SEC_DIAG,
         description = "막대가 점선(4/N)을 넘는 행이 계수에 큰 영향을 줍니다. 가장 큰 다섯 행에 라벨을 붙였습니다."))
}

calibration_items <- function(f, which_model) {
  fit <- f$fit
  p <- stats::fitted(fit)
  y <- fit$y
  brier <- mean((y - p)^2)
  bins <- cut(p, unique(stats::quantile(p, seq(0, 1, 0.1))), include.lowest = TRUE)
  t <- stats::aggregate(data.frame(predicted = p, observed = y), list(bin = bins), mean)
  t$n <- as.vector(table(bins))
  t$bin <- as.character(t$bin)
  g <- ggplot2::ggplot(t, ggplot2::aes(predicted, observed)) + ggplot2::geom_abline(linetype = 2, colour = "grey50") +
    ggplot2::geom_line(colour = "#30638e") + ggplot2::geom_point(ggplot2::aes(size = n), colour = "#30638e") +
    ggplot2::coord_equal(xlim = c(0, 1), ylim = c(0, 1)) +
    ggplot2::labs(x = "예측 확률 (구간 평균)", y = "관측 비율", size = "N", subtitle = which_model) + theme_rs()
  list(rsage::rs_table("calibration", "보정 (calibration)", t[c("bin", "n", "predicted", "observed")],
         labels = c(bin = "예측 확률 구간", n = "N", predicted = "평균 예측 확률", observed = "관측 비율"),
         notes = sprintf("Brier 점수 %.4f (0에 가까울수록 좋음). 적합에 쓴 표본 안의 진단이라 새 자료에서의 성능보다 좋게 나옵니다. %s.", brier, which_model),
         section = SEC_DIAG,
         description = "예측 확률을 10개 구간으로 나눠 실제 사건 비율과 비교합니다. 점이 대각선 위에 있으면 예측 확률이 실제와 맞습니다."),
       rsage::rs_plot("calibration", "보정 그림", g, size = rsage::rs_figure_size(aspect = 1, legend = TRUE), section = SEC_DIAG,
         description = "대각선(점선)에 가까울수록 예측 확률이 실제 비율과 맞습니다. 점의 크기는 구간의 행 수입니다."))
}
