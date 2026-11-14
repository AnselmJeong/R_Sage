# Analysis of variance for one numeric outcome and one or two
# between-subjects factors: the classic F test (type III sums of squares for
# two factors), Welch's test and Kruskal-Wallis for one factor, effect sizes,
# post hoc comparisons and assumption checks. See docs/modules/compare.md.

#' Default options for analysis of variance
defaults_anova <- function() {
  list(
    dependent = NULL,
    factors = character(),
    tests = list(classic = TRUE, welch = FALSE, kruskal = FALSE),
    effectSize = list(eta2 = TRUE, partialEta2 = FALSE, omega2 = TRUE),
    posthoc = list(factor = NULL, tukey = FALSE, gamesHowell = FALSE, dunn = FALSE, adjust = "holm"),
    ciLevel = 0.95,
    descriptives = TRUE,
    assumptions = list(normality = TRUE, variance = TRUE),
    plots = list(means = TRUE, qq = FALSE)
  )
}

AN_SECTIONS <- c("분산분석", "사후 비교", "기술통계", "가정 점검")

#' Analysis of variance
#'
#' @param data A data frame.
#' @param options See defaults_anova().
#' @examples
#' analyse_anova(PlantGrowth, list(dependent = "weight", factors = "group", tests = list(welch = TRUE)))
analyse_anova <- function(data, options = list()) {
  stopifnot(is.data.frame(data))
  o <- rsage::rs_merge_options(options, defaults_anova())
  y_name <- one(o$dependent)
  factors <- unique(chr(o$factors))
  conf <- num1(o$ciLevel, 0.95)
  unknown <- setdiff(c(y_name, factors), names(data))
  if (length(unknown)) stop("데이터에 없는 변수: ", paste(unique(unknown), collapse = ", "))
  out <- collector()
  title <- if (length(factors) == 2) "이원 분산분석" else "일원 분산분석"
  done <- function() {
    rsage::rs_result("anova", title, tables = out$tables, plots = out$plots, notes = out$notes, options = o,
                     packages = c("rsageCompare", "effectsize", if (length(factors) == 2) "car"), sections = AN_SECTIONS,
                     hints = out$hints, hints_title = "확인할 것", data_info = list(variables = c(y_name, factors)))
  }
  if (is.null(y_name)) { out$add(note("종속변수(수치)를 넣으세요.", "anova_needs_dependent")); return(done()) }
  if (!is_numeric_var(data[[y_name]])) { out$add(note(sprintf("'%s'는 수치 변수가 아닙니다. 범주형 결과는 교차표를 쓰세요.", y_name), "anova_not_numeric")); return(done()) }
  if (!length(factors)) { out$add(note("요인(집단 변수)을 넣으세요.", "anova_needs_factor")); return(done()) }
  if (length(factors) > 2) {
    out$add(note("요인은 둘까지 넣을 수 있습니다. 앞의 둘만 썼습니다. 셋 이상은 회귀 모듈에서 범주 설명변수로 넣으세요.", "anova_too_many_factors"))
    factors <- factors[1:2]
  }
  d <- data[, c(y_name, factors), drop = FALSE]
  d <- d[stats::complete.cases(d) & is.finite(d[[y_name]]), , drop = FALSE]
  for (f in factors) d[[f]] <- as_group(d[[f]])
  dropped <- nrow(data) - nrow(d)
  if (dropped) out$add(note(sprintf("결측이 있는 %d행을 빼고 %d행으로 계산했습니다.", dropped, nrow(d)), "anova_missing_rows", "info"))
  for (f in factors) if (nlevels(d[[f]]) < 2) { out$add(note(sprintf("'%s'의 수준이 하나뿐입니다.", f), "anova_one_level")); return(done()) }
  cell <- if (length(factors) == 2) interaction(d[[factors[1]]], d[[factors[2]]], sep = " · ", drop = TRUE) else d[[factors[1]]]
  if (any(table(cell) < 2)) { out$add(note("값이 2개 미만인 집단(칸)이 있어 계산하지 못했습니다.", "anova_too_few")); return(done()) }

  y <- d[[y_name]]
  oneway <- length(factors) == 1
  g <- d[[factors[1]]]
  rows <- list()
  fit <- NULL
  if (isTRUE(o$tests$classic)) {
    form <- stats::as.formula(paste(rsage_name(y_name), "~", paste(vapply(factors, rsage_name, ""), collapse = " * ")))
    if (oneway) {
      fit <- stats::lm(form, data = d)
      a <- stats::anova(fit)
      rows <- c(rows, classic_rows(a, o, nrow(d)))
    } else {
      old <- options(contrasts = c("contr.sum", "contr.poly")); on.exit(options(old), add = TRUE)
      fit <- stats::lm(form, data = d)
      if (has("car")) {
        a <- car::Anova(fit, type = 3)
        a <- a[rownames(a) != "(Intercept)", , drop = FALSE]
        names(a) <- c("Sum Sq", "Df", "F value", "Pr(>F)")
        rows <- c(rows, classic_rows(a, o, nrow(d)))
      } else {
        a <- stats::anova(fit)
        rows <- c(rows, classic_rows(a, o, nrow(d)))
        out$add(note("car 패키지가 없어 순차(유형 I) 제곱합으로 계산했습니다. 칸 크기가 다르면 요인 순서에 따라 결과가 달라집니다.", "anova_needs_car"))
      }
    }
  }
  if (isTRUE(o$tests$welch)) {
    if (oneway) {
      w <- stats::oneway.test(y ~ g, var.equal = FALSE)
      rows[[length(rows) + 1]] <- data.frame(method = "Welch", term = factors[1], ss = NA_real_, df1 = unname(w$parameter[1]), df2 = unname(w$parameter[2]),
                                             statistic_name = "F", statistic = unname(w$statistic), p = w$p.value,
                                             eta2 = NA_real_, partial_eta2 = NA_real_, omega2 = NA_real_, stringsAsFactors = FALSE)
    } else out$add(note("Welch 분산분석은 요인이 하나일 때만 계산합니다.", "anova_welch_oneway", "info"))
  }
  if (isTRUE(o$tests$kruskal)) {
    if (oneway) {
      k <- stats::kruskal.test(y ~ g)
      n <- length(y)
      rows[[length(rows) + 1]] <- data.frame(method = "Kruskal–Wallis", term = factors[1], ss = NA_real_, df1 = unname(k$parameter), df2 = NA_real_,
                                             statistic_name = "H", statistic = unname(k$statistic), p = k$p.value,
                                             eta2 = NA_real_, partial_eta2 = NA_real_, omega2 = NA_real_,
                                             stringsAsFactors = FALSE)
      rows[[length(rows)]]$epsilon2 <- unname(k$statistic) / (n - 1)
    } else out$add(note("Kruskal–Wallis 검정은 요인이 하나일 때만 계산합니다.", "anova_kruskal_oneway", "info"))
  }
  if (!length(rows)) { out$add(note("검정을 하나 이상 고르세요.", "anova_no_test")); return(done()) }
  rows <- lapply(rows, function(r) { if (is.null(r$epsilon2)) r$epsilon2 <- NA_real_; r })
  at <- do.call(rbind, rows)
  keep <- c("method", "term", "ss", "df1", "df2", "statistic_name", "statistic", "p",
            if (isTRUE(o$effectSize$eta2)) "eta2", if (isTRUE(o$effectSize$partialEta2)) "partial_eta2",
            if (isTRUE(o$effectSize$omega2)) "omega2", if (isTRUE(o$tests$kruskal) && oneway) "epsilon2")
  out$add(rsage::rs_table("anova", title, at[, keep, drop = FALSE],
    labels = c(method = "검정", term = "항", ss = "제곱합", df1 = "자유도", df2 = "오차 자유도", statistic_name = "통계량", statistic = "값", p = "p",
               eta2 = "η²", partial_eta2 = "부분 η²", omega2 = if (oneway) "ω²" else "부분 ω²", epsilon2 = "순위 ε²"),
    notes = c(if (!oneway) "이원 분산분석은 합 대비(contr.sum)와 유형 III 제곱합(car::Anova)으로 계산합니다. 상호작용이 있으면 주효과는 다른 요인의 수준을 평균한 효과입니다.",
              if (isTRUE(o$tests$welch) && oneway) "Welch 분산분석은 집단의 분산이 같다고 가정하지 않습니다.",
              "η²는 표본에서 설명한 분산 비율, ω²는 모집단 값을 덜 부풀린 추정입니다. 0.01/0.06/0.14가 작음/중간/큼의 흔한 기준입니다."),
    description = "p값은 집단 평균이 모두 같다는 가설과 데이터가 얼마나 맞지 않는지, 효과크기는 집단이 결과의 분산을 얼마나 설명하는지 보여 줍니다. 어느 집단끼리 다른지는 사후 비교에서 봅니다.",
    section = "분산분석"))

  # Post hoc comparisons on one factor.
  pf <- one(o$posthoc$factor) %||% factors[1]
  if (!pf %in% factors) pf <- factors[1]
  pg <- d[[pf]]
  ph <- list()
  if (isTRUE(o$posthoc$tukey)) {
    aovfit <- stats::aov(stats::as.formula(paste(rsage_name(y_name), "~", paste(vapply(factors, rsage_name, ""), collapse = " * "))), data = d)
    tk <- stats::TukeyHSD(aovfit, which = pf, conf.level = conf)[[pf]]
    ph[[length(ph) + 1]] <- data.frame(method = "Tukey HSD", contrast = gsub("-", " − ", rownames(tk)), estimate = tk[, "diff"], se = NA_real_,
                                       statistic = NA_real_, df = NA_real_, ci_low = tk[, "lwr"], ci_high = tk[, "upr"], p = tk[, "p adj"], stringsAsFactors = FALSE)
  }
  if (isTRUE(o$posthoc$gamesHowell)) ph[[length(ph) + 1]] <- games_howell(y, pg, conf)
  if (isTRUE(o$posthoc$dunn)) ph[[length(ph) + 1]] <- dunn_test(y, pg, one(o$posthoc$adjust) %||% "holm")
  if (length(ph)) {
    pt <- do.call(rbind, ph); rownames(pt) <- NULL
    out$add(rsage::rs_table("posthoc", sprintf("사후 비교: %s", pf), pt,
      labels = c(method = "방법", contrast = "비교", estimate = "평균 차이", se = "SE", statistic = "통계량", df = "자유도",
                 ci_low = "CI 하한", ci_high = "CI 상한", p = "보정 p"),
      notes = c(if (isTRUE(o$posthoc$tukey)) "Tukey HSD는 분산이 같다고 가정합니다.",
                if (isTRUE(o$posthoc$gamesHowell)) "Games–Howell은 분산과 집단 크기가 달라도 씁니다.",
                if (isTRUE(o$posthoc$dunn)) sprintf("Dunn 검정의 통계량은 z, 평균 차이 칸은 평균 순위 차이입니다. p는 %s 보정.", one(o$posthoc$adjust) %||% "holm")),
      description = "집단 쌍마다 차이와 다중비교로 보정한 p값입니다. 신뢰구간이 0을 지나지 않으면 두 집단이 다르다고 봅니다.",
      section = "사후 비교"))
  }

  desc <- group_summary(y, cell, conf)
  if (isTRUE(o$descriptives)) {
    out$add(rsage::rs_table("descriptives", "기술통계", desc[, c("group", "n", "mean", "sd", "se", "ci_low", "ci_high", "median", "q1", "q3", "min", "max")],
      labels = DESC_LABELS, description = "집단(칸)마다 평균과 신뢰구간, 중앙값과 사분위수입니다.", section = "기술통계"))
  }
  res <- if (!is.null(fit)) stats::residuals(fit) else y - stats::ave(y, cell)
  norm <- NULL; vt <- NULL
  if (isTRUE(o$assumptions$normality)) {
    s <- shapiro_p(res)
    norm <- data.frame(part = "잔차", n = length(res), W = s[["W"]], p = s[["p"]])
    out$add(rsage::rs_table("normality", "정규성 (Shapiro–Wilk, 잔차)", norm, labels = c(part = "대상", n = "n", W = "W", p = "p"),
      notes = "집단이 크면(각 30 이상) 분산분석은 정규성에서 조금 벗어나도 괜찮습니다. Q-Q 그림과 함께 봅니다.",
      description = "p가 작으면 잔차가 정규분포에서 벗어난 것입니다.", section = "가정 점검"))
  }
  if (isTRUE(o$assumptions$variance)) {
    bf <- brown_forsythe(y, cell)
    vt <- data.frame(F = bf$F, df1 = bf$df1, df2 = bf$df2, p = bf$p, sd_ratio = max(desc$sd) / min(desc$sd))
    out$add(rsage::rs_table("variance", "분산의 동질성 (Brown–Forsythe)", vt,
      labels = c(F = "F", df1 = "자유도1", df2 = "자유도2", p = "p", sd_ratio = "SD 비 (최대/최소)"),
      description = "p가 작거나 SD 비가 2를 넘으면 집단의 퍼짐이 다릅니다. 요인이 하나면 Welch 분산분석과 Games–Howell을 씁니다.", section = "가정 점검"))
  }
  if (isTRUE(o$plots$means)) out$add(anova_plot(d, y_name, factors, conf))
  if (isTRUE(o$plots$qq)) {
    p <- ggplot2::ggplot(data.frame(r = res), ggplot2::aes(sample = .data$r)) + ggplot2::stat_qq(size = 1, alpha = 0.6) +
      ggplot2::stat_qq_line(colour = "#c0392b") + ggplot2::labs(x = "이론 분위수", y = "잔차 분위수") + theme_rs()
    out$add(rsage::rs_plot("qq", "잔차의 정규 Q-Q 그림", p, size = rsage::rs_figure_size(aspect = 1), alt = "잔차 정규 Q-Q 그림",
      description = "점이 빨간 선을 따라가면 잔차가 정규분포에 가깝습니다.", section = "가정 점검"))
  }
  for (h in anova_hints(o, oneway, norm, vt, desc, nlevels(pg))) out$add(h)
  done()
}

rsage_name <- function(x) if (make.names(x) == x) x else paste0("`", gsub("`", "\\\\`", x), "`")

classic_rows <- function(a, o, n) {
  terms <- rownames(a)
  res_i <- which(terms == "Residuals")
  ss_res <- a$`Sum Sq`[res_i]; df_res <- a$Df[res_i]; ms_res <- ss_res / df_res
  eff <- setdiff(seq_along(terms), res_i)
  ss_total <- sum(a$`Sum Sq`)
  oneway <- length(eff) == 1
  lapply(eff, function(i) {
    ss <- a$`Sum Sq`[i]; df <- a$Df[i]
    data.frame(method = "고전 F", term = gsub("`", "", gsub(":", " × ", terms[i])), ss = ss, df1 = df, df2 = df_res,
               statistic_name = "F", statistic = a$`F value`[i], p = a$`Pr(>F)`[i],
               eta2 = ss / ss_total, partial_eta2 = ss / (ss + ss_res),
               omega2 = if (oneway) (ss - df * ms_res) / (ss_total + ms_res) else (ss - df * ms_res) / (ss + (n - df) * ms_res),
               stringsAsFactors = FALSE)
  })
}

games_howell <- function(y, g, conf) {
  g <- droplevels(as_group(g))
  lv <- levels(g); k <- length(lv)
  m <- tapply(y, g, mean); v <- tapply(y, g, stats::var); n <- tapply(y, g, length)
  out <- list()
  for (i in 1:(k - 1)) for (j in (i + 1):k) {
    a <- lv[i]; b <- lv[j]
    diff <- m[[a]] - m[[b]]
    se2 <- v[[a]] / n[[a]] + v[[b]] / n[[b]]
    se <- sqrt(se2)
    df <- se2^2 / ((v[[a]] / n[[a]])^2 / (n[[a]] - 1) + (v[[b]] / n[[b]])^2 / (n[[b]] - 1))
    t <- diff / se
    q <- stats::qtukey(conf, k, df) / sqrt(2)
    out[[length(out) + 1]] <- data.frame(method = "Games–Howell", contrast = paste(a, "−", b), estimate = diff, se = se, statistic = t, df = df,
                                         ci_low = diff - q * se, ci_high = diff + q * se,
                                         p = stats::ptukey(abs(t) * sqrt(2), k, df, lower.tail = FALSE), stringsAsFactors = FALSE)
  }
  do.call(rbind, out)
}

dunn_test <- function(y, g, adjust = "holm") {
  g <- droplevels(as_group(g))
  lv <- levels(g); k <- length(lv); N <- length(y)
  r <- rank(y)
  ties <- table(y); tie <- sum(ties^3 - ties) / (12 * (N - 1))
  mr <- tapply(r, g, mean); n <- tapply(r, g, length)
  out <- list()
  for (i in 1:(k - 1)) for (j in (i + 1):k) {
    a <- lv[i]; b <- lv[j]
    se <- sqrt((N * (N + 1) / 12 - tie) * (1 / n[[a]] + 1 / n[[b]]))
    z <- (mr[[a]] - mr[[b]]) / se
    out[[length(out) + 1]] <- data.frame(method = "Dunn", contrast = paste(a, "−", b), estimate = mr[[a]] - mr[[b]], se = se, statistic = z, df = NA_real_,
                                         ci_low = NA_real_, ci_high = NA_real_, p = 2 * stats::pnorm(-abs(z)), stringsAsFactors = FALSE)
  }
  res <- do.call(rbind, out)
  res$p <- stats::p.adjust(res$p, method = adjust)
  res
}

anova_plot <- function(d, y_name, factors, conf) {
  f1 <- factors[1]; f2 <- if (length(factors) == 2) factors[2] else NULL
  key <- if (is.null(f2)) d[[f1]] else interaction(d[[f1]], d[[f2]], sep = "\r", drop = TRUE)
  s <- do.call(rbind, lapply(split(seq_len(nrow(d)), key, drop = TRUE), function(i) {
    gs <- group_summary(d[[y_name]][i], NULL, conf)
    data.frame(x = d[[f1]][i[1]], col = if (is.null(f2)) "a" else as.character(d[[f2]][i[1]]), mean = gs$mean, low = gs$ci_low, high = gs$ci_high)
  }))
  pd <- data.frame(x = d[[f1]], col = if (is.null(f2)) "a" else as.character(d[[f2]]), value = d[[y_name]])
  dodge <- ggplot2::position_dodge(width = if (is.null(f2)) 0 else 0.5)
  p <- ggplot2::ggplot(pd, ggplot2::aes(.data$x, .data$value, colour = .data$col)) +
    ggplot2::geom_point(position = ggplot2::position_jitterdodge(jitter.width = 0.15, dodge.width = if (is.null(f2)) 0.1 else 0.5, jitter.height = 0),
                        alpha = 0.3, size = 1.1) +
    ggplot2::geom_errorbar(data = s, ggplot2::aes(x = .data$x, ymin = .data$low, ymax = .data$high, colour = .data$col), inherit.aes = FALSE,
                           width = 0.15, linewidth = 0.6, position = dodge) +
    ggplot2::geom_point(data = s, ggplot2::aes(x = .data$x, y = .data$mean, colour = .data$col), inherit.aes = FALSE, size = 2.6, position = dodge) +
    ggplot2::labs(x = f1, y = y_name, colour = f2) + theme_rs()
  if (is.null(f2)) p <- p + ggplot2::scale_colour_manual(values = c(a = "#1f5aa6"), guide = "none")
  else p <- p + ggplot2::geom_line(data = s, ggplot2::aes(x = .data$x, y = .data$mean, colour = .data$col, group = .data$col), inherit.aes = FALSE, position = dodge)
  rsage::rs_plot("means", "평균과 신뢰구간", p,
                 size = rsage::rs_figure_size(x_items = nlevels(d[[f1]]), label_chars = max(nchar(levels(d[[f1]]))) / 3, legend = !is.null(f2)),
                 alt = "집단별 개별 값과 평균, 평균의 신뢰구간",
                 description = if (is.null(f2)) sprintf("점은 개별 값, 큰 점과 막대는 평균과 %g%% 신뢰구간입니다.", conf * 100)
                               else "선이 평행하지 않으면 두 요인의 상호작용을 뜻합니다. 큰 점과 막대는 칸별 평균과 신뢰구간입니다.",
                 section = "기술통계")
}

anova_hints <- function(o, oneway, norm, vt, desc, k) {
  hints <- list()
  if (oneway && !is.null(vt) && ((!is.na(vt$p) && vt$p < 0.05) || vt$sd_ratio > 2) && !isTRUE(o$tests$welch)) {
    opts <- o; opts$tests$welch <- TRUE; opts$posthoc$gamesHowell <- TRUE; opts$posthoc$tukey <- FALSE
    hints[[length(hints) + 1]] <- rsage::rs_hint("variance", "집단의 퍼짐이 다릅니다",
      "고전 F 검정과 Tukey 비교는 분산이 같다고 가정합니다. Welch 분산분석과 Games–Howell 사후 비교로 바꾸세요.",
      evidence = sprintf("SD 비 = %s, Brown–Forsythe p = %s", fmt(vt$sd_ratio), fmt_p(vt$p)), kind = "variance",
      suggestions = list(rsage::rs_suggest("Welch와 Games–Howell 켜기", "org.rsage.compare/anova", anova_json(opts))))
  }
  if (oneway && !is.null(norm) && !is.na(norm$p) && norm$p < 0.05 && min(desc$n) < 30 && !isTRUE(o$tests$kruskal)) {
    opts <- o; opts$tests$kruskal <- TRUE; opts$posthoc$dunn <- TRUE
    hints[[length(hints) + 1]] <- rsage::rs_hint("normality", "작은 표본에서 잔차의 정규성이 의심됩니다",
      "집단이 30명보다 작고 잔차가 정규분포에서 벗어났습니다. Kruskal–Wallis와 Dunn 비교를 함께 보고, 결론이 같은지 확인하세요.",
      evidence = sprintf("W = %s, p = %s, 가장 작은 집단 n = %d", fmt(norm$W, 3), fmt_p(norm$p), min(desc$n)), kind = "normality",
      suggestions = list(rsage::rs_suggest("Kruskal–Wallis 함께 보기", "org.rsage.compare/anova", anova_json(opts))))
  }
  any_posthoc <- isTRUE(o$posthoc$tukey) || isTRUE(o$posthoc$gamesHowell) || isTRUE(o$posthoc$dunn)
  if (!any_posthoc && k > 2) {
    opts <- o; opts$posthoc$gamesHowell <- TRUE
    hints[[length(hints) + 1]] <- rsage::rs_hint("posthoc", "어느 집단끼리 다른지는 아직 보지 않았습니다",
      "분산분석은 집단 평균이 모두 같은지만 봅니다. 집단 쌍마다 비교하려면 사후 비교를 켜세요.", kind = "posthoc",
      suggestions = list(rsage::rs_suggest("Games–Howell 사후 비교 켜기", "org.rsage.compare/anova", anova_json(opts))))
  }
  hints
}

anova_json <- function(o) { o$factors <- I(as.character(unlist(o$factors))); o }
