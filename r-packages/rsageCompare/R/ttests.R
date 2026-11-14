# T tests: independent groups, paired measurements and one sample, with
# Welch's correction, rank-based alternatives, effect sizes with confidence
# intervals and assumption checks. See docs/modules/compare.md.

#' Default options for t tests
defaults_ttests <- function() {
  list(
    test = "independent",
    variables = character(),
    group = NULL,
    pairs = list(),
    mu = 0,
    tests = list(student = FALSE, welch = TRUE, nonparametric = FALSE),
    alternative = "two.sided",
    ciLevel = 0.95,
    effectSize = list(enabled = TRUE, type = "d"),
    descriptives = TRUE,
    assumptions = list(normality = TRUE, variance = TRUE),
    plots = list(means = TRUE, qq = FALSE)
  )
}

TT_SECTIONS <- c("검정", "기술통계", "가정 점검")
TEST_LABEL <- c(independent = "독립표본 t 검정", paired = "대응표본 t 검정", one_sample = "일표본 t 검정")

#' T tests
#'
#' @param data A data frame.
#' @param options See defaults_ttests().
#' @examples
#' analyse_ttests(mtcars, list(variables = "mpg", group = "am"))
#' analyse_ttests(sleep_wide, list(test = "paired", pairs = list(list(first = "a", second = "b"))))
analyse_ttests <- function(data, options = list()) {
  stopifnot(is.data.frame(data))
  o <- rsage::rs_merge_options(options, defaults_ttests())
  test <- one(o$test) %||% "independent"
  if (!test %in% names(TEST_LABEL)) stop("알 수 없는 검정: ", test)
  alt <- one(o$alternative) %||% "two.sided"
  conf <- num1(o$ciLevel, 0.95)
  mu <- num1(o$mu, 0)
  group <- one(o$group)
  pairs <- lapply(rows_of(o$pairs), function(r) c(first = one(r$first) %||% "", second = one(r$second) %||% ""))
  pairs <- Filter(function(p) nzchar(p[["first"]]) && nzchar(p[["second"]]), pairs)
  variables <- chr(o$variables)
  used <- c(if (test == "paired") unlist(pairs) else variables, if (test == "independent") group)
  unknown <- setdiff(used, names(data))
  if (length(unknown)) stop("데이터에 없는 변수: ", paste(unique(unknown), collapse = ", "))

  out <- collector()
  title <- TEST_LABEL[[test]]
  done <- function() {
    rsage::rs_result("ttests", title, tables = out$tables, plots = out$plots, notes = out$notes, options = o,
                     packages = c("rsageCompare", "effectsize"), sections = TT_SECTIONS, hints = out$hints,
                     hints_title = "확인할 것", data_info = list(variables = unique(used)))
  }
  want <- o$tests
  methods <- c(student = isTRUE(want$student), welch = isTRUE(want$welch), nonparametric = isTRUE(want$nonparametric))
  if (test != "independent") methods[["student"]] <- methods[["student"]] || methods[["welch"]]
  if (test != "independent") methods[["welch"]] <- FALSE
  if (!any(methods)) {
    out$add(note("검정을 하나 이상 고르세요.", "ttests_no_test"))
    return(done())
  }

  # The comparisons: one per dependent variable (or pair).
  units <- list()
  if (test == "independent") {
    if (is.null(group)) { out$add(note("집단 변수를 넣으세요 (두 수준).", "ttests_needs_group")); return(done()) }
    g <- as_group(data[[group]])
    if (nlevels(g) != 2) {
      out$add(note(sprintf("집단 변수 '%s'의 수준이 %d개입니다. 독립표본 t 검정은 두 집단만 비교합니다. 셋 이상이면 분산분석을 쓰세요.", group, nlevels(g)), "ttests_group_levels"))
      return(done())
    }
    for (v in variables) {
      if (!is_numeric_var(data[[v]])) { out$add(note(sprintf("'%s'는 수치 변수가 아니어서 뺐습니다.", v), "ttests_not_numeric")); next }
      ok <- is.finite(data[[v]]) & !is.na(g)
      units[[v]] <- list(label = v, y = data[[v]][ok], g = droplevels(g[ok]))
    }
  } else if (test == "paired") {
    for (p in pairs) {
      a <- data[[p[["first"]]]]; b <- data[[p[["second"]]]]
      if (!is_numeric_var(a) || !is_numeric_var(b)) { out$add(note(sprintf("'%s'와 '%s'는 둘 다 수치 변수여야 합니다.", p[["first"]], p[["second"]]), "ttests_not_numeric")); next }
      ok <- is.finite(a) & is.finite(b)
      lab <- paste(p[["first"]], "-", p[["second"]])
      units[[lab]] <- list(label = lab, a = a[ok], b = b[ok], first = p[["first"]], second = p[["second"]])
    }
  } else {
    for (v in variables) {
      if (!is_numeric_var(data[[v]])) { out$add(note(sprintf("'%s'는 수치 변수가 아니어서 뺐습니다.", v), "ttests_not_numeric")); next }
      x <- data[[v]]
      units[[v]] <- list(label = v, y = x[is.finite(x)])
    }
  }
  if (!length(units)) {
    out$add(note(if (test == "paired") "비교할 두 변수(짝)를 넣으세요." else "검정할 수치 변수를 넣으세요.", "ttests_needs_variables"))
    return(done())
  }

  rows <- list(); desc <- list(); norm <- list(); vars <- list(); plot_data <- list(); diffs <- list()
  for (u in units) {
    if (test == "independent") {
      x <- u$y[u$g == levels(u$g)[1]]; y <- u$y[u$g == levels(u$g)[2]]
      if (length(x) < 2 || length(y) < 2) { out$add(note(sprintf("'%s': 한 집단의 값이 2개 미만이라 검정하지 못했습니다.", u$label), "ttests_too_few")); next }
      d <- group_summary(u$y, u$g, conf)
      desc[[u$label]] <- cbind(variable = u$label, d)
      contrast <- paste(levels(u$g), collapse = " − ")
      for (m in names(methods)[methods]) {
        r <- if (m == "nonparametric") quietly(stats::wilcox.test(x, y, alternative = alt, conf.int = TRUE, conf.level = conf, exact = NULL))
             else quietly(stats::t.test(x, y, alternative = alt, var.equal = m == "student", conf.level = conf))
        if (!is.null(r$error)) { out$add(note(sprintf("'%s' %s: %s", u$label, m, r$error), "ttests_failed")); next }
        t <- r$value
        es <- if (!isTRUE(o$effectSize$enabled)) NULL
              else if (m == "nonparametric") c(measure = "순위이연 r", es_value(effectsize::rank_biserial(x, y, ci = conf, alternative = "two.sided")))
              else if (identical(one(o$effectSize$type), "g")) c(measure = "Hedges g", es_value(effectsize::hedges_g(x, y, pooled_sd = m == "student", ci = conf, alternative = "two.sided")))
              else c(measure = "Cohen d", es_value(effectsize::cohens_d(x, y, pooled_sd = m == "student", ci = conf, alternative = "two.sided")))
        rows[[length(rows) + 1]] <- test_row(u$label, m, t, contrast, length(x) + length(y), es, m == "nonparametric")
      }
      if (isTRUE(o$assumptions$normality)) for (l in levels(u$g)) {
        s <- shapiro_p(u$y[u$g == l])
        norm[[length(norm) + 1]] <- data.frame(variable = u$label, part = l, n = sum(u$g == l), W = s[["W"]], p = s[["p"]])
      }
      if (isTRUE(o$assumptions$variance)) {
        bf <- brown_forsythe(u$y, u$g)
        sds <- d$sd
        if (!is.null(bf)) vars[[u$label]] <- data.frame(variable = u$label, F = bf$F, df1 = bf$df1, df2 = bf$df2, p = bf$p,
                                                       sd_ratio = max(sds) / min(sds))
      }
      plot_data[[u$label]] <- data.frame(variable = u$label, group = u$g, value = u$y)
    } else if (test == "paired") {
      dd <- u$a - u$b
      if (length(dd) < 2) { out$add(note(sprintf("'%s': 짝을 이룬 값이 2개 미만입니다.", u$label), "ttests_too_few")); next }
      d <- rbind(cbind(variable = u$label, group_summary(u$a, NULL, conf)), cbind(variable = u$label, group_summary(u$b, NULL, conf)),
                 cbind(variable = u$label, group_summary(dd, NULL, conf)))
      d$group <- c(u$first, u$second, "차이")
      desc[[u$label]] <- d
      for (m in names(methods)[methods]) {
        r <- if (m == "nonparametric") quietly(stats::wilcox.test(u$a, u$b, paired = TRUE, alternative = alt, conf.int = TRUE, conf.level = conf, exact = NULL))
             else quietly(stats::t.test(u$a, u$b, paired = TRUE, alternative = alt, conf.level = conf))
        if (!is.null(r$error)) { out$add(note(sprintf("'%s': %s", u$label, r$error), "ttests_failed")); next }
        es <- if (!isTRUE(o$effectSize$enabled)) NULL
              else if (m == "nonparametric") c(measure = "순위이연 r", es_value(effectsize::rank_biserial(dd, mu = 0, ci = conf, alternative = "two.sided")))
              else c(measure = "Cohen d_z", es_value(effectsize::cohens_d(dd, mu = 0, ci = conf, alternative = "two.sided")))
        rows[[length(rows) + 1]] <- test_row(u$label, if (m == "nonparametric") "wilcoxon" else "t", r$value, u$label, length(dd), es, m == "nonparametric")
      }
      if (isTRUE(o$assumptions$normality)) {
        s <- shapiro_p(dd)
        norm[[length(norm) + 1]] <- data.frame(variable = u$label, part = "차이", n = length(dd), W = s[["W"]], p = s[["p"]])
      }
      plot_data[[u$label]] <- data.frame(variable = u$label, group = factor(rep(c(u$first, u$second), each = length(dd)), levels = c(u$first, u$second)),
                                         value = c(u$a, u$b), id = rep(seq_along(dd), 2))
      diffs[[u$label]] <- dd
    } else {
      if (length(u$y) < 2) { out$add(note(sprintf("'%s': 값이 2개 미만입니다.", u$label), "ttests_too_few")); next }
      desc[[u$label]] <- cbind(variable = u$label, group_summary(u$y, NULL, conf))
      for (m in names(methods)[methods]) {
        r <- if (m == "nonparametric") quietly(stats::wilcox.test(u$y, mu = mu, alternative = alt, conf.int = TRUE, conf.level = conf, exact = NULL))
             else quietly(stats::t.test(u$y, mu = mu, alternative = alt, conf.level = conf))
        if (!is.null(r$error)) { out$add(note(sprintf("'%s': %s", u$label, r$error), "ttests_failed")); next }
        es <- if (!isTRUE(o$effectSize$enabled)) NULL
              else if (m == "nonparametric") c(measure = "순위이연 r", es_value(effectsize::rank_biserial(u$y, mu = mu, ci = conf, alternative = "two.sided")))
              else c(measure = "Cohen d", es_value(effectsize::cohens_d(u$y, mu = mu, ci = conf, alternative = "two.sided")))
        rows[[length(rows) + 1]] <- test_row(u$label, if (m == "nonparametric") "wilcoxon" else "t", r$value, paste(if (m == "nonparametric") "위치 −" else "평균 −", format(mu)), length(u$y), es, m == "nonparametric", shift = mu)
      }
      if (isTRUE(o$assumptions$normality)) {
        s <- shapiro_p(u$y)
        norm[[length(norm) + 1]] <- data.frame(variable = u$label, part = "전체", n = length(u$y), W = s[["W"]], p = s[["p"]])
      }
      plot_data[[u$label]] <- data.frame(variable = u$label, group = factor(u$label), value = u$y)
    }
  }
  if (!length(rows)) return(done())

  tests <- do.call(rbind, rows)
  out$add(rsage::rs_table("tests", title, tests,
    labels = c(variable = "변수", method = "검정", contrast = "비교", statistic_name = "통계량", statistic = "값", df = "자유도",
               p = "p", estimate = "차이 추정값", ci_low = "CI 하한", ci_high = "CI 상한", es_measure = "효과크기",
               es = "효과크기 값", es_low = "효과크기 CI 하한", es_high = "효과크기 CI 상한", n = "n"),
    notes = c(sprintf("대립가설: %s. 신뢰구간 %g%%.", ALTERNATIVE_LABEL[[alt]], conf * 100),
              if (methods[["nonparametric"]]) "순위 검정의 차이 추정값은 Hodges–Lehmann 위치 이동(중앙값 차이가 아님)입니다.",
              if (test == "independent" && methods[["welch"]]) "Welch 검정은 두 집단의 분산이 같다고 가정하지 않습니다. 등분산 검정 결과로 검정을 고르지 않아도 됩니다."),
    description = "p값은 차이가 0이라는 가설과 데이터가 얼마나 맞지 않는지, 효과크기와 그 신뢰구간은 차이가 얼마나 큰지를 보여 줍니다. 보고할 때는 둘 다 씁니다.",
    section = "검정"))

  if (isTRUE(o$descriptives) && length(desc)) {
    dt <- do.call(rbind, desc)
    rownames(dt) <- NULL
    out$add(rsage::rs_table("descriptives", "기술통계", dt[, c("variable", "group", "n", "mean", "sd", "se", "ci_low", "ci_high", "median", "q1", "q3", "min", "max")],
      labels = DESC_LABELS, description = "집단(또는 측정)마다 평균과 신뢰구간, 중앙값과 사분위수입니다. 평균과 중앙값이 크게 다르면 분포가 치우친 것입니다.", section = "기술통계"))
  }
  if (length(norm)) {
    nt <- do.call(rbind, norm)
    out$add(rsage::rs_table("normality", "정규성 (Shapiro–Wilk)", nt,
      labels = c(variable = "변수", part = if (test == "independent") "집단" else "대상", n = "n", W = "W", p = "p"),
      notes = "표본이 크면(집단마다 30 이상) t 검정은 정규성에서 조금 벗어나도 괜찮고, 이 검정은 작은 차이에도 p가 작아집니다. Q-Q 그림과 함께 봅니다.",
      description = "p가 작으면(< .05) 정규분포에서 벗어났다는 뜻입니다. 대응표본은 두 측정의 차이를, 독립표본은 집단마다 봅니다.", section = "가정 점검"))
  }
  if (length(vars)) {
    vt <- do.call(rbind, vars)
    out$add(rsage::rs_table("variance", "분산의 동질성 (Brown–Forsythe)", vt,
      labels = c(variable = "변수", F = "F", df1 = "자유도1", df2 = "자유도2", p = "p", sd_ratio = "SD 비 (큰/작은)"),
      description = "p가 작거나 SD 비가 2를 넘으면 두 집단의 퍼짐이 다릅니다. Welch 검정은 이때도 맞으므로 Student 검정보다 Welch를 씁니다.", section = "가정 점검"))
  }

  pd <- do.call(rbind, unname(plot_data))
  if (isTRUE(o$plots$means)) out$add(means_plot(pd, test, conf))
  if (isTRUE(o$plots$qq)) out$add(qq_plot(pd, diffs, test))

  # Assumption hints: what to switch on when a check fails.
  for (h in tt_hints(o, test, units, norm, vars, methods, desc)) out$add(h)
  done()
}

test_row <- function(variable, method, t, contrast, n, es, rank, shift = 0) {
  data.frame(
    variable = variable,
    method = c(student = "Student t", welch = "Welch t", t = "t", nonparametric = "Mann–Whitney U", wilcoxon = "Wilcoxon 부호순위")[[method]],
    contrast = contrast,
    statistic_name = if (rank) (if (method == "nonparametric") "U" else "V") else "t",
    statistic = unname(t$statistic),
    df = if (!is.null(t$parameter)) unname(t$parameter) else NA_real_,
    p = t$p.value,
    estimate = if (!is.null(t$estimate)) { e <- unname(t$estimate); if (length(e) == 2) e[1] - e[2] else e[1] - shift } else NA_real_,
    ci_low = if (!is.null(t$conf.int)) t$conf.int[1] - shift else NA_real_,
    ci_high = if (!is.null(t$conf.int)) t$conf.int[2] - shift else NA_real_,
    es_measure = if (is.null(es)) NA_character_ else es$measure,
    es = if (is.null(es)) NA_real_ else es$value,
    es_low = if (is.null(es)) NA_real_ else es$low,
    es_high = if (is.null(es)) NA_real_ else es$high,
    n = as.integer(n),
    stringsAsFactors = FALSE
  )
}

means_plot <- function(pd, test, conf) {
  vars <- unique(pd$variable)
  s <- do.call(rbind, lapply(split(pd, list(pd$variable, pd$group), drop = TRUE), function(d) {
    gs <- group_summary(d$value, NULL, conf)
    data.frame(variable = d$variable[1], group = d$group[1], mean = gs$mean, low = gs$ci_low, high = gs$ci_high)
  }))
  s$group <- factor(s$group, levels = levels(pd$group))
  p <- ggplot2::ggplot(pd, ggplot2::aes(.data$group, .data$value))
  if (test == "paired") p <- p + ggplot2::geom_line(ggplot2::aes(group = .data$id), colour = "grey75", linewidth = 0.3)
  p <- p +
    ggplot2::geom_jitter(width = if (test == "paired") 0 else 0.12, height = 0, alpha = 0.35, size = 1.2, colour = "grey40") +
    ggplot2::geom_errorbar(data = s, ggplot2::aes(x = .data$group, ymin = .data$low, ymax = .data$high), inherit.aes = FALSE,
                           width = 0.12, linewidth = 0.6, colour = "#1f5aa6") +
    ggplot2::geom_point(data = s, ggplot2::aes(x = .data$group, y = .data$mean), inherit.aes = FALSE, size = 2.6, colour = "#1f5aa6") +
    ggplot2::labs(x = NULL, y = if (length(vars) == 1) vars else "값") + theme_rs()
  if (length(vars) > 1) p <- p + ggplot2::facet_wrap(~variable, scales = "free")
  rsage::rs_plot("means", "평균과 신뢰구간", p, size = rsage::rs_figure_size(panels = length(vars), x_items = 2, aspect = 0.8),
                 alt = "집단별 개별 값과 평균, 평균의 신뢰구간",
                 description = sprintf("점은 개별 값, 파란 점과 막대는 평균과 %g%% 신뢰구간입니다. 대응표본은 같은 대상의 두 값을 선으로 잇습니다.", conf * 100),
                 section = "기술통계")
}

qq_plot <- function(pd, diffs, test) {
  qd <- if (test == "paired") do.call(rbind, lapply(names(diffs), function(n) data.frame(panel = paste(n, "(차이)"), value = diffs[[n]])))
        else data.frame(panel = if (test == "independent") paste(pd$variable, pd$group, sep = " · ") else pd$variable, value = pd$value)
  panels <- length(unique(qd$panel))
  p <- ggplot2::ggplot(qd, ggplot2::aes(sample = .data$value)) + ggplot2::stat_qq(size = 1, alpha = 0.6) +
    ggplot2::stat_qq_line(colour = "#c0392b") + ggplot2::facet_wrap(~panel, scales = "free") +
    ggplot2::labs(x = "이론 분위수", y = "표본 분위수") + theme_rs()
  rsage::rs_plot("qq", "정규 Q-Q 그림", p, size = rsage::rs_figure_size(panels = panels, aspect = 1),
                 alt = "정규 Q-Q 그림", description = "점이 빨간 선을 따라가면 정규분포에 가깝습니다. 양 끝이 휘면 꼬리가 두껍거나 치우친 것입니다.",
                 section = "가정 점검")
}

tt_hints <- function(o, test, units, norm, vars, methods, desc) {
  hints <- list()
  base <- o
  # Small groups that look non-normal: add the rank test alongside.
  if (length(norm) && !methods[["nonparametric"]]) {
    nt <- do.call(rbind, norm)
    bad <- nt[!is.na(nt$p) & nt$p < 0.05 & nt$n < 30, , drop = FALSE]
    if (nrow(bad)) {
      opts <- base; opts$tests$nonparametric <- TRUE
      label <- if (test == "independent") "Mann–Whitney 함께 보기" else "Wilcoxon 함께 보기"
      hints[[length(hints) + 1]] <- rsage::rs_hint("normality", "작은 표본에서 정규성이 의심됩니다",
        sprintf("%s에서 Shapiro–Wilk p < .05이고 n이 30보다 작습니다. 순위 검정을 함께 보고, 결론이 같으면 t 검정 결과를 그대로 보고해도 됩니다.",
                paste(unique(sprintf("'%s'(%s)", bad$variable, bad$part)), collapse = ", ")),
        evidence = paste(sprintf("%s: W = %s, p = %s, n = %d", bad$part, fmt(bad$W, 3), fmt_p(bad$p), bad$n), collapse = "; "),
        kind = "normality", variables = unique(bad$variable),
        suggestions = list(rsage::rs_suggest(label, "org.rsage.compare/ttests", opts_json(opts))))
    }
  }
  if (test == "independent" && length(vars) && methods[["student"]] && !methods[["welch"]]) {
    vt <- do.call(rbind, vars)
    bad <- vt[(!is.na(vt$p) & vt$p < 0.05) | vt$sd_ratio > 2, , drop = FALSE]
    if (nrow(bad)) {
      opts <- base; opts$tests$welch <- TRUE
      hints[[length(hints) + 1]] <- rsage::rs_hint("variance", "두 집단의 퍼짐이 다릅니다",
        "Student t 검정은 두 집단의 분산이 같다고 가정합니다. 분산이 다를 때도 맞는 Welch t 검정을 쓰세요.",
        evidence = paste(sprintf("%s: SD 비 = %s, Brown–Forsythe p = %s", bad$variable, fmt(bad$sd_ratio), fmt_p(bad$p)), collapse = "; "),
        kind = "variance", variables = bad$variable,
        suggestions = list(rsage::rs_suggest("Welch t 검정 켜기", "org.rsage.compare/ttests", opts_json(opts))))
    }
  }
  if (test == "independent" && length(desc)) {
    small <- do.call(rbind, desc)
    small <- small[small$n < 10, , drop = FALSE]
    if (nrow(small)) hints[[length(hints) + 1]] <- rsage::rs_hint("small_n", "집단의 크기가 작습니다",
      "집단이 10명보다 작으면 가정 점검의 검정력이 낮아 문제를 놓치기 쉽고, 효과크기의 신뢰구간이 넓습니다. 효과크기 구간을 함께 보고하세요.",
      evidence = paste(sprintf("%s: n = %d", small$group, small$n), collapse = "; "), kind = "small_n")
  }
  hints
}

# Options as they travel in rs_suggest: vectors stay JSON arrays.
opts_json <- function(o) {
  for (k in c("variables", "factors")) if (!is.null(o[[k]])) o[[k]] <- I(as.character(unlist(o[[k]])))
  o
}
