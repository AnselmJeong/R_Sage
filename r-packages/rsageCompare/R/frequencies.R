# Contingency tables for two categorical variables: counts and percentages,
# chi-squared and Fisher's exact tests, Cramér's V and, for 2×2 tables, the
# odds ratio. See docs/modules/compare.md.

#' Default options for contingency tables
defaults_frequencies <- function() {
  list(
    rows = NULL,
    columns = NULL,
    cells = list(counts = TRUE, rowPct = TRUE, colPct = FALSE, totalPct = FALSE, expected = FALSE, residuals = FALSE),
    tests = list(chisq = TRUE, continuity = FALSE, fisher = "auto"),
    effectSize = list(cramersV = TRUE, oddsRatio = TRUE),
    ciLevel = 0.95,
    plots = list(bars = TRUE, position = "fill")
  )
}

FR_SECTIONS <- c("교차표", "검정과 효과크기")

#' Contingency table
#'
#' @param data A data frame.
#' @param options See defaults_frequencies().
#' @examples
#' analyse_frequencies(mtcars, list(rows = "am", columns = "cyl"))
analyse_frequencies <- function(data, options = list()) {
  stopifnot(is.data.frame(data))
  o <- rsage::rs_merge_options(options, defaults_frequencies())
  rv <- one(o$rows); cv <- one(o$columns)
  conf <- num1(o$ciLevel, 0.95)
  unknown <- setdiff(c(rv, cv), names(data))
  if (length(unknown)) stop("데이터에 없는 변수: ", paste(unique(unknown), collapse = ", "))
  out <- collector()
  done <- function() {
    rsage::rs_result("frequencies", "교차표", tables = out$tables, plots = out$plots, notes = out$notes, options = o,
                     packages = c("rsageCompare", "effectsize"), sections = FR_SECTIONS, hints = out$hints, hints_title = "확인할 것",
                     data_info = list(variables = c(rv, cv)))
  }
  if (is.null(rv) || is.null(cv)) { out$add(note("행 변수와 열 변수를 넣으세요.", "frequencies_needs_variables")); return(done()) }
  if (rv == cv) { out$add(note("행과 열에 다른 변수를 넣으세요.", "frequencies_same_variable")); return(done()) }
  a <- data[[rv]]; b <- data[[cv]]
  ok <- !is.na(a) & !is.na(b)
  for (v in c(rv, cv)) {
    k <- length(unique(data[[v]][ok]))
    if (k > 30) { out$add(note(sprintf("'%s'의 값이 %d가지입니다. 교차표는 범주 변수에 씁니다.", v, k), "frequencies_too_many_levels")); return(done()) }
  }
  if (sum(!ok)) out$add(note(sprintf("결측이 있는 %d행을 뺐습니다.", sum(!ok)), "frequencies_missing_rows", "info"))
  tab <- table(as_group(a[ok]), as_group(b[ok]))
  if (nrow(tab) < 2 || ncol(tab) < 2) { out$add(note("두 변수 모두 수준이 둘 이상이어야 합니다.", "frequencies_one_level")); return(done()) }
  n <- sum(tab)
  chi <- quietly(stats::chisq.test(tab, correct = isTRUE(o$tests$continuity)))
  expected <- if (is.null(chi$error)) chi$value$expected else outer(rowSums(tab), colSums(tab)) / n
  low_share <- mean(expected < 5)

  # The table: one block of rows per row level, one line per cell statistic.
  stats_on <- c(counts = "빈도", rowPct = "행 %", colPct = "열 %", totalPct = "전체 %", expected = "기대 빈도", residuals = "표준화 잔차")
  stats_on <- stats_on[vapply(names(stats_on), function(k) isTRUE(o$cells[[k]]), TRUE)]
  if (!length(stats_on)) stats_on <- c(counts = "빈도")
  rp <- prop.table(tab, 1) * 100; cp <- prop.table(tab, 2) * 100; tp <- tab / n * 100
  sres <- if (is.null(chi$error)) chi$value$stdres else tab * NA
  cell <- function(k, i) switch(k, counts = as.numeric(tab[i, ]), rowPct = as.numeric(rp[i, ]), colPct = as.numeric(cp[i, ]),
                                totalPct = as.numeric(tp[i, ]), expected = as.numeric(expected[i, ]), residuals = as.numeric(sres[i, ]))
  total <- function(k, i) switch(k, counts = sum(tab[i, ]), rowPct = 100, colPct = sum(tab[i, ]) / n * 100, totalPct = sum(tab[i, ]) / n * 100,
                                 expected = sum(tab[i, ]), residuals = NA_real_)
  lines <- list()
  for (i in seq_len(nrow(tab))) for (k in names(stats_on)) {
    v <- cell(k, i)
    lines[[length(lines) + 1]] <- c(list(row = rownames(tab)[i], stat = stats_on[[k]]), stats::setNames(as.list(v), paste0("c", seq_len(ncol(tab)))),
                                    list(total = total(k, i)))
  }
  for (k in intersect(names(stats_on), c("counts", "colPct", "totalPct", "expected"))) {
    v <- switch(k, counts = colSums(tab), colPct = rep(100, ncol(tab)), totalPct = colSums(tab) / n * 100, expected = colSums(tab))
    lines[[length(lines) + 1]] <- c(list(row = "합계", stat = stats_on[[k]]), stats::setNames(as.list(as.numeric(v)), paste0("c", seq_len(ncol(tab)))),
                                    list(total = if (k == "counts" || k == "expected") n else 100))
  }
  ct <- do.call(rbind, lapply(lines, as.data.frame, stringsAsFactors = FALSE))
  labels <- c(row = rv, stat = "", stats::setNames(colnames(tab), paste0("c", seq_len(ncol(tab)))), total = "합계")
  out$add(rsage::rs_table("crosstab", sprintf("%s × %s", rv, cv), ct, labels = labels,
    notes = c(sprintf("열: %s. n = %d.", cv, n), if (isTRUE(o$cells$residuals)) "표준화 잔차의 절댓값이 2를 넘는 칸이 기대보다 많거나 적은 칸입니다."),
    description = "행 %는 각 행(집단) 안에서 열 범주의 비율입니다. 집단 사이에 비율이 다른지 볼 때 행 %를 비교합니다.",
    section = "교차표"))

  # Tests
  tests <- list()
  if (isTRUE(o$tests$chisq) && is.null(chi$error)) {
    t <- chi$value
    tests[[length(tests) + 1]] <- data.frame(test = if (isTRUE(o$tests$continuity) && all(dim(tab) == 2)) "카이제곱 (연속성 보정)" else "Pearson 카이제곱",
                                             statistic = unname(t$statistic), df = unname(t$parameter), p = t$p.value, stringsAsFactors = FALSE)
  }
  fisher_mode <- one(o$tests$fisher) %||% "auto"
  run_fisher <- fisher_mode == "always" || (fisher_mode == "auto" && low_share > 0.2)
  fisher <- NULL
  if (run_fisher) {
    f <- quietly(if (all(dim(tab) == 2)) stats::fisher.test(tab, conf.level = conf)
                 else stats::fisher.test(tab, simulate.p.value = n > 300 || prod(dim(tab)) > 20, B = 1e4))
    if (is.null(f$error)) {
      fisher <- f$value
      tests[[length(tests) + 1]] <- data.frame(test = if (isTRUE(grepl("simulated", fisher$method))) "Fisher 정확 검정 (모의 p, 10,000회)" else "Fisher 정확 검정",
                                               statistic = NA_real_, df = NA_real_, p = fisher$p.value, stringsAsFactors = FALSE)
    } else out$add(note(paste("Fisher 검정을 계산하지 못했습니다:", f$error), "frequencies_fisher_failed"))
  }
  if (length(tests)) {
    out$add(rsage::rs_table("tests", "독립성 검정", do.call(rbind, tests), labels = c(test = "검정", statistic = "χ²", df = "자유도", p = "p"),
      notes = sprintf("기대 빈도 5 미만인 칸: %d / %d (%.0f%%). 20%%를 넘으면 카이제곱 근사가 부정확해 Fisher 정확 검정을 씁니다.",
                      sum(expected < 5), length(expected), low_share * 100),
      description = "p값은 두 변수가 서로 관련이 없다는 가설과 데이터가 얼마나 맞지 않는지 보여 줍니다.", section = "검정과 효과크기"))
  }
  es <- list()
  if (isTRUE(o$effectSize$cramersV) && is.null(chi$error)) {
    v <- es_value(effectsize::cramers_v(tab, adjust = FALSE, ci = conf, alternative = "two.sided"))
    if (is.na(v$value)) v$value <- sqrt(unname(chi$value$statistic) / (n * (min(dim(tab)) - 1)))
    es[[length(es) + 1]] <- data.frame(measure = if (all(dim(tab) == 2)) "Cramér V (= |φ|)" else "Cramér V", value = v$value, ci_low = v$low, ci_high = v$high)
  }
  if (isTRUE(o$effectSize$oddsRatio) && all(dim(tab) == 2)) {
    cc <- as.numeric(tab) + if (any(tab == 0)) 0.5 else 0
    or <- (cc[1] * cc[4]) / (cc[2] * cc[3])
    se <- sqrt(sum(1 / cc)); z <- stats::qnorm(1 - (1 - conf) / 2)
    es[[length(es) + 1]] <- data.frame(measure = sprintf("오즈비 (%s: %s 대 %s)", rv, rownames(tab)[1], rownames(tab)[2]),
                                       value = or, ci_low = exp(log(or) - z * se), ci_high = exp(log(or) + z * se))
  }
  if (length(es)) {
    out$add(rsage::rs_table("effect", "효과크기", do.call(rbind, es), labels = c(measure = "측도", value = "값", ci_low = "CI 하한", ci_high = "CI 상한"),
      notes = c(if (isTRUE(o$effectSize$oddsRatio) && all(dim(tab) == 2))
                  sprintf("오즈비는 '%s'에서 '%s'의 오즈를 '%s'와 비교합니다 (Woolf 구간%s).", rownames(tab)[1], colnames(tab)[1], rownames(tab)[2],
                          if (any(tab == 0)) ", 빈 칸이 있어 모든 칸에 0.5를 더함" else ""),
                "Cramér V는 0.1/0.3/0.5가 작음/중간/큼의 흔한 기준입니다 (자유도에 따라 다름)."),
      description = "관련의 크기입니다. 오즈비가 1이면 관련이 없고, 신뢰구간이 1을 지나지 않으면 관련이 있다고 봅니다.", section = "검정과 효과크기"))
  }
  if (isTRUE(o$plots$bars)) out$add(bars_plot(tab, rv, cv, one(o$plots$position) %||% "fill"))
  if (low_share > 0.2 && fisher_mode == "never") {
    opts <- o; opts$tests$fisher <- "always"
    out$add(rsage::rs_hint("expected", "기대 빈도가 작은 칸이 많습니다",
      "칸의 20% 넘게 기대 빈도가 5보다 작아 카이제곱 p값이 부정확합니다. Fisher 정확 검정을 쓰세요.",
      evidence = sprintf("기대 빈도 < 5: %d / %d칸", sum(expected < 5), length(expected)), kind = "expected",
      suggestions = list(rsage::rs_suggest("Fisher 정확 검정 켜기", "org.rsage.compare/frequencies", opts))))
  }
  if (any(rowSums(tab) < 5) || any(colSums(tab) < 5)) {
    out$add(rsage::rs_hint("sparse", "아주 작은 범주가 있습니다",
      "한 범주의 사례가 5개보다 적으면 그 범주의 비율은 몇 사례로 크게 흔들립니다. 의미가 비슷한 범주와 합칠지 생각해 보세요.",
      evidence = paste(c(sprintf("%s = %s: n = %d", rv, rownames(tab), rowSums(tab))[rowSums(tab) < 5],
                         sprintf("%s = %s: n = %d", cv, colnames(tab), colSums(tab))[colSums(tab) < 5]), collapse = "; "),
      kind = "sparse"))
  }
  done()
}

bars_plot <- function(tab, rv, cv, position) {
  df <- as.data.frame(tab, stringsAsFactors = FALSE)
  names(df) <- c("row", "col", "n")
  df$row <- factor(df$row, levels = rownames(tab)); df$col <- factor(df$col, levels = colnames(tab))
  p <- ggplot2::ggplot(df, ggplot2::aes(.data$row, .data$n, fill = .data$col)) +
    ggplot2::geom_col(position = if (position == "dodge") ggplot2::position_dodge() else "fill", width = 0.7) +
    ggplot2::labs(x = rv, y = if (position == "dodge") "빈도" else "비율", fill = cv) + theme_rs() +
    ggplot2::scale_fill_brewer(palette = "Set2")
  if (position != "dodge") p <- p + ggplot2::scale_y_continuous(labels = function(x) paste0(round(x * 100), "%"))
  rsage::rs_plot("bars", "집단별 비율", p, size = rsage::rs_figure_size(x_items = nrow(tab), label_chars = max(nchar(rownames(tab))) / 3, legend = TRUE),
                 alt = sprintf("%s별 %s 비율 막대그림", rv, cv),
                 description = "막대마다 행 변수의 한 수준 안에서 열 범주의 구성입니다. 막대 사이 구성이 비슷하면 두 변수는 관련이 약합니다.",
                 section = "교차표")
}
