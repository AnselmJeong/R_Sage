# Path diagrams (tidySEM when installed, ggplot2 otherwise), the link
# stability graph and the effect decomposition plot.

POS <- "#2c6fbb"

# Label without a border (label.size became linewidth in ggplot2 4.0).
borderless_label <- function(...) {
  args <- list(...)
  if (utils::packageVersion("ggplot2") >= "4.0.0") args$linewidth <- 0 else args$label.size <- 0
  do.call(ggplot2::geom_label, args)
}
NEG <- "#c0392b"
GREY <- "#9aa1a9"
CURVE <- 0.3

# Columns are tiers (left to right), rows the variables of a tier.
node_layout <- function(vars, tier) {
  cols <- sort(unique(tier[vars]))
  rows <- lapply(cols, function(t) vars[tier[vars] == t])
  height <- max(lengths(rows))
  out <- do.call(rbind, lapply(seq_along(cols), function(i) {
    v <- rows[[i]]
    data.frame(name = v, col = i, row = seq_along(v) + (height - length(v)) / 2, stringsAsFactors = FALSE)
  }))
  out$x <- (out$col - 1) * 3
  out$y <- -(out$row - 1) * 1.4
  attr(out, "ncol") <- length(cols)
  attr(out, "nrow") <- height
  out
}

diagram_size <- function(layout, label_chars) {
  w <- attr(layout, "ncol") * (1.6 + 0.09 * min(label_chars, 16)) + 1
  h <- attr(layout, "nrow") * 1.25 + 1.1
  list(width = round(min(max(w, 4.5), 12), 1), height = round(min(max(h, 2.8), 10), 1))
}

# Own diagram: boxes, straight arrows, curved covariances.
draw_graph <- function(layout, edges, title_legend = NULL) {
  pos <- layout[, c("name", "x", "y")]
  e <- merge(merge(edges, stats::setNames(pos, c("from", "x1", "y1"))), stats::setNames(pos, c("to", "x2", "y2")))
  bw <- 0.62 + 0.035 * max(nchar(layout$name))
  shrink <- function(x1, y1, x2, y2) {
    dx <- x2 - x1
    dy <- y2 - y1
    len <- sqrt(dx^2 + dy^2)
    # Stop at the box edge: horizontal half-width bw, vertical half-height 0.3.
    tx <- ifelse(abs(dx) > 1e-9, bw / abs(dx), Inf)
    ty <- ifelse(abs(dy) > 1e-9, 0.3 / abs(dy), Inf)
    t <- pmin(tx, ty, 0.45)
    list(x1 = x1 + dx * t, y1 = y1 + dy * t, x2 = x2 - dx * t, y2 = y2 - dy * t)
  }
  g <- ggplot2::ggplot()
  reg <- e[e$type == "regression", , drop = FALSE]
  cov <- e[e$type == "covariance", , drop = FALSE]
  if (nrow(reg)) {
    s <- shrink(reg$x1, reg$y1, reg$x2, reg$y2)
    reg[c("sx1", "sy1", "sx2", "sy2")] <- s
    # Arrows that skip a tier or stay in one column would cross the boxes in
    # between, so they bend; the label sits on the bend.
    reg$bend <- abs(reg$x2 - reg$x1) > 3.5 | abs(reg$x2 - reg$x1) < 1e-9
    # Bend away from the middle of the figure: upper arrows up, lower ones down.
    mid <- mean(range(layout$y))
    reg$curv <- ifelse((reg$y1 + reg$y2) / 2 >= mid, -CURVE, CURVE)
    k <- 0.37 * reg$curv
    reg$lx <- ifelse(reg$bend, (reg$sx1 + reg$sx2) / 2 + k * (reg$sy2 - reg$sy1), reg$sx1 + (reg$sx2 - reg$sx1) * 0.55)
    reg$ly <- ifelse(reg$bend, (reg$sy1 + reg$sy2) / 2 - k * (reg$sx2 - reg$sx1), reg$sy1 + (reg$sy2 - reg$sy1) * 0.55)
    aes_e <- ggplot2::aes(x = .data$sx1, y = .data$sy1, xend = .data$sx2, yend = .data$sy2,
                          colour = .data$colour, linetype = .data$linetype, linewidth = .data$width, alpha = .data$alpha)
    arr <- grid::arrow(length = grid::unit(0.09, "inches"), type = "closed")
    if (any(!reg$bend)) g <- g + ggplot2::geom_segment(data = reg[!reg$bend, ], aes_e, arrow = arr)
    for (cv in unique(reg$curv[reg$bend])) g <- g + ggplot2::geom_curve(data = reg[reg$bend & reg$curv == cv, ], aes_e, curvature = cv, arrow = arr)
    lab <- reg[nzchar(reg$label), , drop = FALSE]
    if (nrow(lab)) g <- g + borderless_label(data = lab, ggplot2::aes(x = .data$lx, y = .data$ly, label = .data$label, colour = .data$colour),
                                             size = 3, label.padding = grid::unit(0.08, "lines"), fill = "white")
  }
  if (nrow(cov)) {
    cov$sx1 <- cov$x1 + ifelse(cov$x1 == cov$x2, bw, 0)
    cov$sx2 <- cov$x2 + ifelse(cov$x1 == cov$x2, bw, 0)
    cov$sy1 <- cov$y1
    cov$sy2 <- cov$y2
    g <- g + ggplot2::geom_curve(data = cov, ggplot2::aes(x = .data$sx1, y = .data$sy1, xend = .data$sx2, yend = .data$sy2,
                                                          colour = .data$colour, linetype = .data$linetype, linewidth = .data$width, alpha = .data$alpha),
                                 curvature = -0.35, arrow = grid::arrow(length = grid::unit(0.07, "inches"), ends = "both", type = "closed"))
    lab <- cov[nzchar(cov$label), , drop = FALSE]
    if (nrow(lab)) g <- g + borderless_label(data = lab, ggplot2::aes(x = (.data$sx1 + .data$sx2) / 2 + ifelse(.data$sx1 == .data$sx2, 0.35, 0),
                                                                          y = (.data$sy1 + .data$sy2) / 2, label = .data$label, colour = .data$colour),
                                                size = 3, label.padding = grid::unit(0.08, "lines"), fill = "white")
  }
  g + ggplot2::geom_label(data = layout, ggplot2::aes(x = .data$x, y = .data$y, label = .data$name),
                          size = 3.6, label.r = grid::unit(0.12, "lines"), label.padding = grid::unit(0.35, "lines"),
                          fill = "#f4f6f8", colour = "#1f2328") +
    ggplot2::scale_colour_identity() + ggplot2::scale_linetype_identity() + ggplot2::scale_linewidth_identity() +
    ggplot2::scale_alpha_identity() +
    ggplot2::scale_x_continuous(expand = ggplot2::expansion(add = bw + 0.4)) +
    ggplot2::scale_y_continuous(expand = ggplot2::expansion(add = 0.6)) +
    ggplot2::theme_void()
}

edge_label <- function(est, p, sig, how) {
  if (how == "none") return(rep("", length(est)))
  s <- formatC(est, digits = 2, format = "f")
  if (how == "stars") {
    stars <- ifelse(is.na(p), ifelse(sig, "*", ""), ifelse(p < .001, "***", ifelse(p < .01, "**", ifelse(p < .05, "*", ""))))
    s <- paste0(s, stars)
  }
  s
}

# Fitted model: coefficient table rows with from/to/type, est, CI.
diagram_plot <- function(ct, layout, how, map) {
  ct$sig <- !is.na(ct$ci.lower) & (ct$ci.lower > 0 | ct$ci.upper < 0)
  e <- data.frame(from = ct$from, to = ct$to, type = ct$type, stringsAsFactors = FALSE)
  shown <- if (!is.null(ct$std) && !all(is.na(ct$std))) ct$std else ct$est
  e$label <- edge_label(shown, ct$p %||% rep(NA_real_, nrow(ct)), ct$sig, how)
  e$colour <- ifelse(shown >= 0, POS, NEG)
  e$linetype <- ifelse(ct$sig, "solid", "dashed")
  e$width <- 0.35 + 1.6 * pmin(abs(shown), 1)
  e$alpha <- ifelse(ct$sig, 1, 0.75)
  tidy <- tidysem_plot(ct, layout, how, map)
  list(plot = tidy$plot %||% draw_graph(layout, e), backend = if (!is.null(tidy$plot)) "tidySEM" else "ggplot2", error = tidy$error)
}

# tidySEM reads a layout as a grid of node names (NA = empty cell), not
# coordinates. Half-row steps keep short tiers centred, so the grid has
# 2 * rows - 1 rows.
layout_grid <- function(layout, map) {
  m <- matrix(NA_character_, 2 * attr(layout, "nrow") - 1, attr(layout, "ncol"))
  m[cbind(as.integer(round(2 * layout$row - 1)), layout$col)] <- unname(map[layout$name])
  m
}

# tidySEM graph with the tier layout; edges limited to the graph's paths.
tidysem_plot <- function(ct, layout, how, map) {
  if (!has("tidySEM")) return(list(plot = NULL))
  r <- quietly({
    fit <- attr(ct, "fit")
    m <- layout_grid(layout, map)
    lay <- do.call(tidySEM::get_layout, c(as.list(as.vector(t(m))), list(rows = nrow(m))))
    g <- tidySEM::prepare_graph(model = fit, layout = lay, label = "est_sig_std",
                                rect_width = 1.6, rect_height = 0.7, spacing_x = 2.4, spacing_y = 0.75, text_size = 3.6)
    g <- tidySEM::hide_var(g)
    ed <- tidySEM::edges(g)
    inv <- stats::setNames(names(map), map)
    keep <- paste(ed$from, ed$to) %in% c(paste(map[ct$from], map[ct$to]), paste(map[ct$to[ct$type == "covariance"]], map[ct$from[ct$type == "covariance"]]))
    ed <- ed[keep, , drop = FALSE]
    est <- suppressWarnings(as.numeric(ed$est_std %||% ed$est))
    ci_ok <- vapply(seq_len(nrow(ed)), function(i) {
      row <- ct[map[ct$from] == ed$from[i] & map[ct$to] == ed$to[i] | (ct$type == "covariance" & map[ct$to] == ed$from[i] & map[ct$from] == ed$to[i]), ]
      nrow(row) > 0 && !is.na(row$ci.lower[1]) && (row$ci.lower[1] > 0 | row$ci.upper[1] < 0)
    }, TRUE)
    ed$colour <- ifelse(!is.na(est) & est < 0, NEG, POS)
    ed$linetype <- ifelse(ci_ok, 1, 2)
    if (how == "std") ed$label <- formatC(est, digits = 2, format = "f")
    if (how == "none") ed$label <- ""
    # Arrows that skip a tier would run straight behind the boxes in
    # between; bend them (tidySEM curvature is in degrees).
    col <- stats::setNames(layout$col, unname(map[layout$name]))
    skip <- !is.na(col[ed$from]) & !is.na(col[ed$to]) & abs(col[ed$to] - col[ed$from]) > 1 & ed$from != ed$to
    if (any(skip)) {
      if (is.null(ed$curvature)) ed$curvature <- NA_real_
      ed$curvature[skip] <- 50
      row <- stats::setNames(layout$row, unname(map[layout$name]))
      level <- skip & row[ed$from] == row[ed$to]
      if (!is.null(ed$connect_from)) ed$connect_from[level] <- "top"
      if (!is.null(ed$connect_to)) ed$connect_to[level] <- "top"
    }
    tidySEM::edges(g) <- ed
    nd <- tidySEM::nodes(g)
    nd$label <- unname(inv[nd$name] %||% nd$name)
    tidySEM::nodes(g) <- nd
    plot(g)
  })
  if (!is.null(r$error) || !inherits(r$value, "ggplot")) return(list(plot = NULL, error = r$error %||% "no plot"))
  list(plot = r$value)
}

stability_plot <- function(table, layout, threshold) {
  e <- table[table$strength >= min(0.2, threshold) | table$adopted, , drop = FALSE]
  if (!nrow(e)) return(NULL)
  e$label <- formatC(e$strength, digits = 2, format = "f")
  e$colour <- ifelse(e$adopted, "#1f2328", GREY)
  e$linetype <- ifelse(e$adopted, "solid", "dashed")
  e$width <- 0.3 + 1.8 * e$strength
  e$alpha <- 0.35 + 0.65 * e$strength
  draw_graph(layout, e[, c("from", "to", "type", "label", "colour", "linetype", "width", "alpha")])
}

effects_plot <- function(tab, x, y) {
  d <- tab
  d$component <- factor(d$component, levels = rev(d$component))
  d$what <- c(direct = "직접", indirect = "간접 (경로)", indirect_total = "간접 합", total = "총효과")[d$kind]
  ggplot2::ggplot(d, ggplot2::aes(x = .data$est, y = .data$component, colour = .data$what)) +
    ggplot2::geom_vline(xintercept = 0, colour = GREY) +
    ggplot2::geom_errorbar(ggplot2::aes(xmin = .data$ci.lower, xmax = .data$ci.upper), width = 0.2, orientation = "y", na.rm = TRUE) +
    ggplot2::geom_point(size = 2.4) +
    ggplot2::scale_colour_manual(values = c("직접" = "#1f2328", "간접 (경로)" = "#7f8c8d", "간접 합" = POS, "총효과" = "#8e44ad"), name = NULL) +
    ggplot2::labs(x = sprintf("%s → %s 효과 (95%% 구간)", x, y), y = NULL) +
    theme_rs() + ggplot2::theme(legend.position = "bottom")
}
