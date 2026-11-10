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

# Display width of a name in characters (Korean and other wide characters
# count twice).
name_width <- function(x) nchar(x, type = "width")

diagram_size <- function(layout) {
  label_chars <- max(name_width(layout$name))
  w <- attr(layout, "ncol") * (1.6 + 0.09 * min(label_chars, 16)) + 1
  h <- attr(layout, "nrow") * 1.25 + 1.1
  list(width = round(min(max(w, 4.5), 12), 1), height = round(min(max(h, 2.8), 10), 1))
}

# Node boxes in data units. The figure is drawn at diagram_size(), so the
# inches-per-unit scale is known and each box gets its own half-width from
# its label (a single width for all boxes left arrows ending in empty space
# next to short names).
LABEL_SIZE <- 3.6
box_geometry <- function(layout) {
  size <- diagram_size(layout)
  pt <- LABEL_SIZE * ggplot2::.pt
  char_in <- 0.55 * pt / 72
  pad_in <- 0.35 * pt * 1.2 / 72
  hw_in <- name_width(layout$name) * char_in / 2 + pad_in
  hh_in <- pt * 1.2 / 72 / 2 + pad_in
  margin_in <- 2 * 5.5 / 72
  xr <- diff(range(layout$x))
  yr <- diff(range(layout$y))
  pad_x <- max(hw_in) + 0.3
  pad_y <- hh_in + 0.25
  sx <- if (xr > 0) max((size$width - margin_in - 2 * pad_x) / xr, 0.05) else 1
  sy <- if (yr > 0) max((size$height - margin_in - 2 * pad_y) / yr, 0.05) else sx
  list(hw = stats::setNames(hw_in / sx, layout$name), hh = hh_in / sy,
       expand_x = if (xr > 0) pad_x / sx else 1, expand_y = if (yr > 0) pad_y / sy else 1, size = size,
       sx = sx, sy = sy)
}

# Own diagram: boxes, straight arrows, curved covariances.
draw_graph <- function(layout, edges, title_legend = NULL) {
  pos <- layout[, c("name", "x", "y")]
  e <- merge(merge(edges, stats::setNames(pos, c("from", "x1", "y1"))), stats::setNames(pos, c("to", "x2", "y2")))
  geo <- box_geometry(layout)
  hh <- geo$hh
  # Stop each end at its own box edge.
  shrink <- function(from, to, x1, y1, x2, y2) {
    dx <- x2 - x1
    dy <- y2 - y1
    t_at <- function(hw) pmin(ifelse(abs(dx) > 1e-9, hw / abs(dx), Inf), ifelse(abs(dy) > 1e-9, hh / abs(dy), Inf), 0.45)
    t1 <- t_at(unname(geo$hw[from]))
    t2 <- t_at(unname(geo$hw[to]))
    list(x1 = x1 + dx * t1, y1 = y1 + dy * t1, x2 = x2 - dx * t2, y2 = y2 - dy * t2)
  }
  g <- ggplot2::ggplot()
  reg <- e[e$type == "regression", , drop = FALSE]
  cov <- e[e$type == "covariance", , drop = FALSE]
  if (nrow(reg)) {
    s <- shrink(reg$from, reg$to, reg$x1, reg$y1, reg$x2, reg$y2)
    reg[c("sx1", "sy1", "sx2", "sy2")] <- s
    # Arrows that skip a tier or stay in one column would cross the boxes in
    # between, so they bend; the label sits on the bend.
    reg$bend <- abs(reg$x2 - reg$x1) > 3.5 | abs(reg$x2 - reg$x1) < 1e-9
    # Bend away from the middle of the figure: upper arrows up, lower ones down.
    mid <- mean(range(layout$y))
    reg$curv <- ifelse((reg$y1 + reg$y2) / 2 >= mid, -CURVE, CURVE)
    k <- 0.37 * reg$curv
    # Labels of slanted arrows sit nearer their start so arrows crossing in
    # an X keep their labels apart.
    at <- ifelse(abs(reg$y2 - reg$y1) > 1e-9, 0.33, 0.55)
    reg$lx <- ifelse(reg$bend, (reg$sx1 + reg$sx2) / 2 + k * (reg$sy2 - reg$sy1), reg$sx1 + (reg$sx2 - reg$sx1) * at)
    reg$ly <- ifelse(reg$bend, (reg$sy1 + reg$sy2) / 2 - k * (reg$sx2 - reg$sx1), reg$sy1 + (reg$sy2 - reg$sy1) * at)
    aes_e <- ggplot2::aes(x = .data$sx1, y = .data$sy1, xend = .data$sx2, yend = .data$sy2,
                          colour = .data$colour, linetype = .data$linetype, linewidth = .data$width, alpha = .data$alpha)
    arr <- grid::arrow(length = grid::unit(0.09, "inches"), type = "closed")
    if (any(!reg$bend)) g <- g + ggplot2::geom_segment(data = reg[!reg$bend, ], aes_e, arrow = arr)
    for (cv in unique(reg$curv[reg$bend])) g <- g + ggplot2::geom_curve(data = reg[reg$bend & reg$curv == cv, ], aes_e, curvature = cv, arrow = arr)
    # The midpoints of the bends join the scales, so a bend without a label
    # is not clipped at the edge of the figure.
    g <- g + ggplot2::geom_blank(data = reg, ggplot2::aes(x = .data$lx, y = .data$ly))
    lab <- reg[nzchar(reg$label), , drop = FALSE]
    if (nrow(lab)) g <- g + borderless_label(data = lab, ggplot2::aes(x = .data$lx, y = .data$ly, label = .data$label, colour = .data$colour),
                                             size = 3, label.padding = grid::unit(0.08, "lines"), fill = "white")
  }
  if (nrow(cov)) {
    # Same column: from the right edge of one box to the right edge of the
    # other, bowing outwards. Otherwise between the facing box edges.
    same <- abs(cov$x1 - cov$x2) < 1e-9
    # Same column: start at the upper box so one curvature sign bows right.
    up <- same & cov$y2 > cov$y1
    if (any(up)) {
      sw <- cov[up, ]
      cov[up, c("from", "to", "x1", "y1", "x2", "y2")] <- sw[, c("to", "from", "x2", "y2", "x1", "y1")]
    }
    s <- shrink(cov$from, cov$to, cov$x1, cov$y1, cov$x2, cov$y2)
    cov$sx1 <- ifelse(same, cov$x1 + unname(geo$hw[cov$from]), s$x1)
    cov$sx2 <- ifelse(same, cov$x2 + unname(geo$hw[cov$to]), s$x2)
    cov$sy1 <- ifelse(same, cov$y1, s$y1)
    cov$sy2 <- ifelse(same, cov$y2, s$y2)
    # Curvature sign so that same-column links bow to the right (away from the box).
    cov$curv <- ifelse(same, -0.35, -0.35)
    for (cv in unique(cov$curv)) g <- g + ggplot2::geom_curve(data = cov[cov$curv == cv, ], ggplot2::aes(x = .data$sx1, y = .data$sy1, xend = .data$sx2, yend = .data$sy2,
                                                          colour = .data$colour, linetype = .data$linetype, linewidth = .data$width, alpha = .data$alpha),
                                 curvature = cv, arrow = grid::arrow(length = grid::unit(0.07, "inches"), ends = "both", type = "closed"))
    # Labels sit on the middle of the arc. The bow is drawn in inches, so
    # the offset is converted between the x and y scales (they differ, and
    # a same-column arc is vertical).
    k <- 0.5 * cov$curv
    cov$lx <- (cov$sx1 + cov$sx2) / 2 + k * (cov$sy2 - cov$sy1) * geo$sy / geo$sx
    cov$ly <- (cov$sy1 + cov$sy2) / 2 - k * (cov$sx2 - cov$sx1) * geo$sx / geo$sy
    g <- g + ggplot2::geom_blank(data = cov, ggplot2::aes(x = .data$lx, y = .data$ly))
    lab <- cov[nzchar(cov$label), , drop = FALSE]
    if (nrow(lab)) {
      g <- g + borderless_label(data = lab, ggplot2::aes(x = .data$lx, y = .data$ly, label = .data$label, colour = .data$colour),
                                size = 3, label.padding = grid::unit(0.08, "lines"), fill = "white")
    }
  }
  g + ggplot2::geom_label(data = layout, ggplot2::aes(x = .data$x, y = .data$y, label = .data$name),
                          size = LABEL_SIZE, label.r = grid::unit(0.12, "lines"), label.padding = grid::unit(0.35, "lines"),
                          fill = "#f4f6f8", colour = "#1f2328") +
    ggplot2::scale_colour_identity() + ggplot2::scale_linetype_identity() + ggplot2::scale_linewidth_identity() +
    ggplot2::scale_alpha_identity() +
    ggplot2::scale_x_continuous(expand = ggplot2::expansion(add = geo$expand_x)) +
    ggplot2::scale_y_continuous(expand = ggplot2::expansion(add = geo$expand_y)) +
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
diagram_plot <- function(ct, layout, how, map, exo = NULL) {
  ct$sig <- !is.na(ct$ci.lower) & (ct$ci.lower > 0 | ct$ci.upper < 0)
  e <- data.frame(from = ct$from, to = ct$to, type = ct$type, stringsAsFactors = FALSE)
  shown <- if (!is.null(ct$std) && !all(is.na(ct$std))) ct$std else ct$est
  e$label <- edge_label(shown, ct$p %||% rep(NA_real_, nrow(ct)), ct$sig, how)
  e$colour <- ifelse(shown >= 0, POS, NEG)
  e$linetype <- ifelse(ct$sig, "solid", "dashed")
  e$width <- 0.35 + 1.6 * pmin(abs(shown), 1)
  e$alpha <- ifelse(ct$sig, 1, 0.75)
  if (NROW(exo)) e <- rbind(e, data.frame(from = exo$from, to = exo$to, type = "covariance",
                                          label = if (how == "none") "" else formatC(exo$r, digits = 2, format = "f"),
                                          colour = GREY, linetype = "solid", width = 0.35 + 1.6 * pmin(abs(exo$r), 1), alpha = 1,
                                          stringsAsFactors = FALSE))
  tidy <- tidysem_plot(ct, layout, how, map, exo)
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
tidysem_plot <- function(ct, layout, how, map, exo = NULL) {
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
    # Covariances between variables without parents (fixed at the sample
    # value by lavaan): kept if tidySEM lists them, added otherwise.
    exo_key <- if (NROW(exo)) paste(map[exo$from], map[exo$to]) else character()
    is_exo <- paste(ed$from, ed$to) %in% exo_key | paste(ed$to, ed$from) %in% exo_key
    ed <- ed[keep | is_exo, , drop = FALSE]
    is_exo <- is_exo[keep | is_exo]
    missing_exo <- setdiff(seq_len(NROW(exo)), which(exo_key %in% c(paste(ed$from, ed$to), paste(ed$to, ed$from))))
    if (length(missing_exo) && nrow(ed)) {
      cov_row <- which(ed$arrow %in% c("both", "none"))
      tmpl <- ed[if (length(cov_row)) cov_row[1] else 1, , drop = FALSE]
      add <- tmpl[rep(1, length(missing_exo)), , drop = FALSE]
      add$from <- unname(map[exo$from[missing_exo]])
      add$to <- unname(map[exo$to[missing_exo]])
      if (!is.null(add$arrow)) add$arrow <- "both"
      if (!is.null(add$curvature)) add$curvature <- 60
      # Real anchors (NA breaks tidySEM's plot): same column joins the right
      # sides, otherwise the facing sides.
      cf <- stats::setNames(layout$col, unname(map[layout$name]))
      c1 <- cf[add$from]
      c2 <- cf[add$to]
      add$connect_from <- ifelse(c1 == c2 | c1 < c2, "right", "left")
      add$connect_to <- ifelse(c1 == c2 | c1 > c2, "right", "left")
      if (!is.null(add$est_std)) add$est_std <- formatC(exo$r[missing_exo], digits = 2, format = "f")
      if (!is.null(add$est)) add$est <- formatC(exo$r[missing_exo], digits = 2, format = "f")
      add$label <- formatC(exo$r[missing_exo], digits = 2, format = "f")
      ed <- rbind(ed, add)
      is_exo <- c(is_exo, rep(TRUE, length(missing_exo)))
    }
    est <- suppressWarnings(as.numeric(ed$est_std %||% ed$est))
    ci_ok <- vapply(seq_len(nrow(ed)), function(i) {
      row <- ct[map[ct$from] == ed$from[i] & map[ct$to] == ed$to[i] | (ct$type == "covariance" & map[ct$to] == ed$from[i] & map[ct$from] == ed$to[i]), ]
      nrow(row) > 0 && !is.na(row$ci.lower[1]) && (row$ci.lower[1] > 0 | row$ci.upper[1] < 0)
    }, TRUE)
    ed$colour <- ifelse(!is.na(est) & est < 0, NEG, POS)
    ed$linetype <- ifelse(ci_ok, 1, 2)
    if (how == "std") ed$label <- formatC(est, digits = 2, format = "f")
    if (any(is_exo)) {
      # tidySEM lists fixed exogenous covariances but hides them (show = FALSE).
      if (!is.null(ed$show)) ed$show[is_exo] <- TRUE
      if (!is.null(ed$arrow)) ed$arrow[is_exo] <- "both"
      ed$colour[is_exo] <- GREY
      ed$linetype[is_exo] <- 1
      if (how != "none") ed$label[is_exo] <- formatC(est[is_exo], digits = 2, format = "f")
    }
    if (how == "none") ed$label <- ""
    # Labels of slanted arrows sit nearer their start, so two arrows that
    # cross in an X (a -> d, c -> b between two columns) do not put their
    # labels on the same crossing point.
    rowpos <- stats::setNames(layout$row, unname(map[layout$name]))
    slanted <- !is_exo & !is.na(rowpos[ed$from]) & !is.na(rowpos[ed$to]) & rowpos[ed$from] != rowpos[ed$to] & ed$from != ed$to
    ed$label_location <- ifelse(slanted, 0.33, 0.5)
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
  # Adopted links carry the picture; links below the threshold are drawn
  # faint, without numbers, and only from strength 0.3 (their numbers are
  # in the table), so they do not tangle the graph.
  e <- table[table$adopted | table$strength >= 0.3, , drop = FALSE]
  if (!nrow(e)) return(NULL)
  e$label <- ifelse(e$adopted, formatC(e$strength, digits = 2, format = "f"), "")
  e$colour <- ifelse(e$adopted, "#1f2328", "#8b929b")
  e$linetype <- ifelse(e$adopted, "solid", "dashed")
  e$width <- ifelse(e$adopted, 0.4 + 1.6 * e$strength, 0.45 + 0.5 * e$strength)
  e$alpha <- ifelse(e$adopted, 0.45 + 0.55 * e$strength, 0.85)
  # Faint links first, so adopted ones are drawn on top.
  e <- e[order(e$adopted), , drop = FALSE]
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
