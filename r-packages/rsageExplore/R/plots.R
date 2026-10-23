# Figures: a small one per hint card, and the overview figures (relation
# map, distributions, target ranking).

CARD_SIZE <- list(width = 4.4, height = 2.9)

# Card figures stay small; a few kinds size themselves to their content.
card_size <- function(draw) {
  n <- length(draw$vars)
  switch(draw$type,
    missing_bars = list(width = 4.4, height = min(4.5, 1.1 + 0.26 * min(n, 15))),
    item_cor = list(width = 4.4, height = 3.8),
    subgroups = list(width = 4.4, height = 3.3),
    smd = list(width = 4.4, height = 3.4),
    importance = list(width = 4.4, height = 3.2),
    stack = list(width = 4.4, height = 3.3),
    CARD_SIZE)
}

card_theme <- function() ggplot2::theme_minimal(base_size = 10) + ggplot2::theme(plot.title = ggplot2::element_blank())

# Long category labels make a figure unreadable; keep the first characters.
short <- function(x, n = 14) {
  x <- as.character(x)
  ifelse(nchar(x) > n, paste0(substr(x, 1, n - 1), "…"), x)
}

as_group <- function(x, max_levels = 12) {
  x <- as.character(x)
  t <- sort(table(x), decreasing = TRUE)
  if (length(t) > max_levels) x[!x %in% names(t)[seq_len(max_levels - 1)] & !is.na(x)] <- "(기타)"
  factor(short(x))
}

#' The ggplot for one hint, or NULL
card_plot <- function(d, draw, ta = NULL, deep = list()) {
  if (is.null(draw)) return(NULL)
  aes <- ggplot2::aes
  switch(draw$type,
    importance = {
      tab <- utils::head(deep$model$table, 10)
      df <- data.frame(v = factor(short(tab$variable), levels = rev(short(tab$variable))), r = tab$relative)
      ggplot2::ggplot(df, aes(x = .data$r, y = .data$v)) + ggplot2::geom_col(fill = "#4C78A8") +
        ggplot2::labs(x = "상대 중요도 (%)", y = NULL) + card_theme()
    },
    pd = {
      df <- deep$model$pd[[draw$x]]
      ggplot2::ggplot(df, aes(x = .data$x, y = .data$y)) + ggplot2::geom_line(colour = "#4C78A8", linewidth = 0.9) +
        ggplot2::geom_rug(data = data.frame(x = d[[draw$x]][is.finite(d[[draw$x]])]), aes(x = .data$x), inherit.aes = FALSE, alpha = 0.2) +
        ggplot2::labs(x = draw$x, y = if (deep$model$numeric) "모형의 평균 예측" else sprintf("'%s' 예측 확률", deep$model$event)) + card_theme()
    },
    subgroups = {
      tab <- deep$tree$table
      lab <- sprintf("%s (n=%d)", vapply(strwrap_n(tab$rule, 34), identity, ""), tab$n)
      df <- data.frame(r = factor(lab, levels = rev(lab)), v = tab$value)
      ggplot2::ggplot(df, aes(x = .data$v, y = .data$r)) + ggplot2::geom_col(fill = "#4C78A8") +
        ggplot2::geom_vline(xintercept = deep$tree$overall, linetype = 2, colour = "#E45756") +
        ggplot2::labs(x = if (deep$tree$numeric) "평균 (점선: 전체)" else "비율(%) (점선: 전체)", y = NULL) + card_theme() +
        ggplot2::theme(axis.text.y = ggplot2::element_text(size = 7))
    },
    interaction = {
      df <- data.frame(x = d[[draw$x]], b = d[[draw$by]], y = d[[draw$y]])
      df <- df[stats::complete.cases(df), , drop = FALSE]
      df$b <- if (is.numeric(df$b) && length(unique(df$b)) > 5) {
        q <- unique(stats::quantile(df$b, c(0, 1 / 3, 2 / 3, 1)))
        cut(df$b, q, include.lowest = TRUE, labels = c("낮음", "중간", "높음")[seq_len(length(q) - 1)])
      } else as_group(df$b, 5)
      if (!is.numeric(df$y)) df$y <- as.numeric(as.character(df$y) == (ta$model$event %||% max(as.character(df$y))))
      p <- ggplot2::ggplot(df, aes(x = .data$x, y = .data$y, colour = .data$b))
      p <- if (is.numeric(df$x)) {
        p + ggplot2::geom_point(alpha = 0.25, size = 0.9) + ggplot2::geom_smooth(method = "lm", formula = y ~ x, se = FALSE, linewidth = 0.9)
      } else {
        p + ggplot2::stat_summary(aes(group = .data$b), fun = mean, geom = "line") + ggplot2::stat_summary(fun = mean, geom = "point")
      }
      p + ggplot2::labs(x = draw$x, y = draw$y, colour = draw$by) + card_theme() + ggplot2::theme(legend.position = "bottom")
    },
    clusters = {
      cl <- deep$clusters
      df <- data.frame(a = cl$pc[, 1], b = cl$pc[, 2], k = factor(cl$best$cluster))
      ggplot2::ggplot(df, aes(x = .data$a, y = .data$b, colour = .data$k)) + ggplot2::geom_point(alpha = 0.5, size = 1) +
        ggplot2::labs(x = sprintf("주성분 1 (%s%%)", fmt_num(100 * cl$ve[1], 0)), y = sprintf("주성분 2 (%s%%)", fmt_num(100 * cl$ve[2], 0)), colour = "무리") +
        card_theme()
    },
    anomaly = {
      an <- deep$anomaly
      df <- data.frame(i = seq_along(an$md), m = an$md, far = an$md > an$cut)
      ggplot2::ggplot(df, aes(x = .data$i, y = .data$m, colour = .data$far)) + ggplot2::geom_point(size = 1) +
        ggplot2::geom_hline(yintercept = an$cut, linetype = 2, colour = "#E45756") +
        ggplot2::scale_colour_manual(values = c("FALSE" = "#BAB0AC", "TRUE" = "#E45756"), guide = "none") +
        ggplot2::labs(x = "행 (결측 없는 행 순서)", y = "Mahalanobis 거리") + card_theme()
    },
    smd = {
      s <- utils::head(sort(deep$compare$smd, decreasing = TRUE), 15)
      df <- data.frame(v = factor(short(names(s)), levels = rev(short(names(s)))), s = unname(s))
      ggplot2::ggplot(df, aes(x = .data$s, y = .data$v)) + ggplot2::geom_point(colour = "#4C78A8", size = 2) +
        ggplot2::geom_vline(xintercept = c(0.1, 0.2), linetype = c(3, 2), colour = "#E45756") +
        ggplot2::labs(x = "표준화 평균 차이 (SMD)", y = NULL) + card_theme()
    },
    hist = {
      df <- data.frame(x = d[[draw$x]][is.finite(d[[draw$x]])])
      bins <- min(30, max(10, length(unique(df$x))))
      ggplot2::ggplot(df, aes(x = .data$x)) + ggplot2::geom_histogram(bins = bins, fill = "#4C78A8", colour = "white") +
        ggplot2::labs(x = draw$x, y = "행 수") + card_theme()
    },
    bars = {
      df <- data.frame(x = as_group(d[[draw$x]][!is.na(d[[draw$x]])]))
      ggplot2::ggplot(df, aes(y = forcats_rev(.data$x))) + ggplot2::geom_bar(fill = "#4C78A8") +
        ggplot2::labs(y = draw$x, x = "행 수") + card_theme()
    },
    scatter = {
      ok <- is.finite(d[[draw$x]]) & is.finite(d[[draw$y]])
      df <- data.frame(x = d[[draw$x]][ok], y = d[[draw$y]][ok])
      alpha <- if (nrow(df) > 2000) 0.15 else if (nrow(df) > 300) 0.35 else 0.7
      p <- ggplot2::ggplot(df, aes(x = .data$x, y = .data$y)) + ggplot2::geom_point(alpha = alpha, colour = "#4C78A8", size = 1.2)
      if (nrow(df) >= 20 && length(unique(df$x)) >= 5) {
        p <- p + ggplot2::geom_smooth(method = "loess", formula = y ~ x, se = FALSE, colour = "#E45756", linewidth = 0.8)
      }
      p + ggplot2::labs(x = draw$x, y = draw$y) + card_theme()
    },
    box = {
      ok <- !is.na(d[[draw$x]]) & is.finite(d[[draw$y]])
      df <- data.frame(g = as_group(d[[draw$x]][ok]), y = d[[draw$y]][ok])
      ggplot2::ggplot(df, aes(x = .data$y, y = forcats_rev(.data$g))) +
        ggplot2::geom_boxplot(fill = "#4C78A8", alpha = 0.25, outlier.size = 0.8) +
        ggplot2::stat_summary(fun = mean, geom = "point", colour = "#E45756", size = 2) +
        ggplot2::labs(x = draw$y, y = draw$x) + card_theme()
    },
    stack = {
      ok <- !is.na(d[[draw$x]]) & !is.na(d[[draw$y]])
      df <- data.frame(x = as_group(d[[draw$x]][ok]), y = as_group(d[[draw$y]][ok], 8))
      ggplot2::ggplot(df, aes(y = forcats_rev(.data$x), fill = .data$y)) + ggplot2::geom_bar(position = "fill") +
        ggplot2::scale_x_continuous(labels = function(v) paste0(round(100 * v), "%")) +
        ggplot2::labs(y = draw$x, x = "비율", fill = draw$y) + card_theme() + ggplot2::theme(legend.position = "bottom")
    },
    missing_bars = {
      vars <- utils::head(draw$vars, 15)
      df <- data.frame(v = factor(short(vars), levels = rev(short(vars))), p = 100 * vapply(d[vars], function(x) mean(is.na(x)), 1))
      ggplot2::ggplot(df, aes(x = .data$p, y = .data$v)) + ggplot2::geom_col(fill = "#E45756") +
        ggplot2::labs(x = "결측 비율(%)", y = NULL) + card_theme()
    },
    missing_by = {
      m <- ifelse(is.na(d[[draw$x]]), "빠짐", "있음")
      if (draw$num) {
        ok <- is.finite(d[[draw$y]])
        df <- data.frame(g = factor(m[ok], levels = c("있음", "빠짐")), y = d[[draw$y]][ok])
        ggplot2::ggplot(df, aes(x = .data$y, y = .data$g)) + ggplot2::geom_boxplot(fill = "#E45756", alpha = 0.25) +
          ggplot2::labs(x = draw$y, y = paste0(draw$x, " 값")) + card_theme()
      } else {
        ok <- !is.na(d[[draw$y]])
        df <- data.frame(g = as_group(d[[draw$y]][ok]), m = factor(m[ok], levels = c("빠짐", "있음")))
        ggplot2::ggplot(df, aes(y = forcats_rev(.data$g), fill = .data$m)) + ggplot2::geom_bar(position = "fill") +
          ggplot2::scale_fill_manual(values = c("빠짐" = "#E45756", "있음" = "#BAB0AC")) +
          ggplot2::scale_x_continuous(labels = function(v) paste0(round(100 * v), "%")) +
          ggplot2::labs(y = draw$y, x = "비율", fill = paste0(draw$x, " 값")) + card_theme() + ggplot2::theme(legend.position = "bottom")
      }
    },
    item_cor = {
      vars <- draw$vars
      cm <- stats::cor(d[vars], use = "pairwise.complete.obs")
      df <- data.frame(a = factor(rep(vars, each = length(vars)), levels = vars), b = factor(rep(vars, length(vars)), levels = rev(vars)),
                       r = as.vector(cm))
      ggplot2::ggplot(df, aes(x = .data$a, y = .data$b, fill = .data$r)) + ggplot2::geom_tile(colour = "white") +
        ggplot2::scale_fill_gradient2(low = "#4C78A8", mid = "white", high = "#E45756", limits = c(-1, 1)) +
        ggplot2::labs(x = NULL, y = NULL, fill = "r") + card_theme() +
        ggplot2::theme(axis.text.x = ggplot2::element_text(angle = 45, hjust = 1))
    },
    per_id = {
      t <- as.integer(table(d[[draw$x]]))
      df <- data.frame(k = factor(t, levels = sort(unique(t))))
      ggplot2::ggplot(df, aes(x = .data$k)) + ggplot2::geom_bar(fill = "#4C78A8") +
        ggplot2::labs(x = paste0(draw$x, "당 행 수"), y = "ID 수") + card_theme()
    },
    wide_means = {
      vars <- draw$vars
      df <- data.frame(v = factor(vars, levels = vars),
                       m = vapply(d[vars], function(x) mean(x, na.rm = TRUE), 1),
                       se = vapply(d[vars], function(x) stats::sd(x, na.rm = TRUE) / sqrt(sum(!is.na(x))), 1))
      ggplot2::ggplot(df, aes(x = .data$v, y = .data$m, group = 1)) + ggplot2::geom_line(colour = "#4C78A8") +
        ggplot2::geom_pointrange(aes(ymin = .data$m - 1.96 * .data$se, ymax = .data$m + 1.96 * .data$se), colour = "#4C78A8") +
        ggplot2::labs(x = NULL, y = "평균 (95% 신뢰구간)") + card_theme()
    },
    target_rank = {
      if (is.null(ta) || !nrow(ta$table)) return(NULL)
      tab <- utils::head(ta$table, 12)
      df <- data.frame(v = factor(short(tab$variable), levels = rev(short(tab$variable))), s = tab$strength, m = tab$measure)
      ggplot2::ggplot(df, aes(x = .data$s, y = .data$v, fill = .data$m)) + ggplot2::geom_col() +
        ggplot2::scale_fill_manual(values = c("Spearman ρ" = "#4C78A8", "η²" = "#F58518", "Cramér V" = "#54A24B")) +
        ggplot2::labs(x = "관련 크기 (|ρ|, η, V)", y = NULL, fill = NULL) + card_theme() + ggplot2::theme(legend.position = "bottom")
    },
    NULL
  )
}

`%||%` <- function(a, b) if (is.null(a)) b else a

# Long rules cut to a width, so tree labels stay readable.
strwrap_n <- function(x, n) ifelse(nchar(x) > n, paste0(substr(x, 1, n - 1), "…"), x)

forcats_rev <- function(f) factor(f, levels = rev(levels(f)))

#' Relation map: strength of every pair on one correlation-like scale
heatmap_plot <- function(pairs, vars) {
  if (length(pairs) < 1 || length(vars) < 2) return(NULL)
  strength <- matrix(NA_real_, length(vars), length(vars), dimnames = list(vars, vars))
  for (p in pairs) if (p$a %in% vars && p$b %in% vars) strength[p$a, p$b] <- strength[p$b, p$a] <- p$strength
  # Keep the most connected variables when there are many.
  if (length(vars) > 30) {
    keep <- names(sort(apply(strength, 1, max, na.rm = TRUE), decreasing = TRUE))[1:30]
    strength <- strength[keep, keep]
    vars <- keep
  }
  df <- data.frame(a = factor(short(rep(vars, each = length(vars)), 18), levels = unique(short(vars, 18))),
                   b = factor(short(rep(vars, length(vars)), 18), levels = rev(unique(short(vars, 18)))),
                   s = as.vector(strength))
  size <- rsage::rs_figure_size(1, x_items = length(vars), y_items = length(vars), label_chars = max(nchar(short(vars, 18))), legend = TRUE)
  p <- ggplot2::ggplot(df, ggplot2::aes(x = .data$a, y = .data$b, fill = .data$s)) + ggplot2::geom_tile(colour = "white") +
    ggplot2::scale_fill_gradient(low = "#F2F2F2", high = "#E45756", limits = c(0, 1), na.value = "white") +
    ggplot2::labs(x = NULL, y = NULL, fill = "관련 크기") + ggplot2::theme_minimal(base_size = 10) +
    ggplot2::theme(axis.text.x = ggplot2::element_text(angle = 45, hjust = 1), panel.grid = ggplot2::element_blank())
  if (length(vars) <= 15) p <- p + ggplot2::geom_text(ggplot2::aes(label = ifelse(is.na(.data$s), "", sprintf("%.2f", .data$s))), size = 2.8)
  list(plot = p, size = size)
}

#' Small multiples of every numeric variable's distribution
distributions_plot <- function(d, vars) {
  vars <- utils::head(vars, 36)
  if (!length(vars)) return(NULL)
  df <- do.call(rbind, lapply(vars, function(v) data.frame(v = v, x = d[[v]][is.finite(d[[v]])])))
  df$v <- factor(short(df$v, 18), levels = unique(short(vars, 18)))
  size <- rsage::rs_figure_size(length(vars), aspect = 0.7)
  p <- ggplot2::ggplot(df, ggplot2::aes(x = .data$x)) + ggplot2::geom_histogram(bins = 20, fill = "#4C78A8", colour = "white") +
    ggplot2::facet_wrap(~v, scales = "free", ncol = size$ncol) + ggplot2::labs(x = NULL, y = "행 수") + ggplot2::theme_minimal(base_size = 9)
  list(plot = p, size = size)
}
