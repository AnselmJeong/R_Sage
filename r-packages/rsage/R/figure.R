# Figure sizes for every module. A module describes what a figure shows
# (how many panels, categories on each axis, how long the labels are) and
# rs_figure_size() turns that into inches; past what fits on a page it says
# so (compact = TRUE) and the module switches to a denser layout (a heat
# map instead of small multiples, flipped axes, fewer labels). The user can
# override any figure's size in the analysis tab; rs_resize() applies that.

#' Figure size from its content
#'
#' @param panels Number of facets (small multiples).
#' @param x_items,y_items Categories along each axis of one panel (0 for a continuous axis).
#' @param label_chars Longest category label on the y axis, in characters.
#' @param aspect Panel height / width for a panel with no categorical y axis.
#' @param legend TRUE when the figure has a legend at the side.
#' @param ncol Facet columns; by default about 1.6 times as many columns as rows.
#' @return list(width, height, ncol, nrow, compact): inches, the facet grid, and
#'   whether the content is too dense for this layout at a readable size.
rs_figure_size <- function(panels = 1, x_items = 0, y_items = 0, label_chars = 0, aspect = 0.62,
                           legend = FALSE, ncol = NULL, max_width = 12, max_height = 10) {
  panels <- max(1, panels)
  margin_w <- 0.6 + 0.075 * label_chars + if (legend) 1.2 else 0
  margin_h <- 0.9 + if (x_items > 12) 0.4 else 0
  # As many columns as fit at 1.6 in per panel, aiming for a grid wider than tall.
  fit_cols <- max(1, floor((max_width - margin_w) / 1.6))
  ncol <- if (is.null(ncol)) min(panels, ceiling(sqrt(panels * 1.6)), fit_cols) else ncol
  nrow <- ceiling(panels / ncol)
  pw <- max(if (panels == 1) 5.2 else 2.4, 0.28 * x_items)
  if (panels > 1) pw <- max(1.6, min(pw, (max_width - margin_w) / ncol))
  ph <- if (y_items) max(0.22 * y_items + 0.3, 1.2) else pw * aspect
  width <- ncol * pw + margin_w
  height <- nrow * (ph + if (panels > 1) 0.3 else 0) + margin_h
  # Too dense: panels would shrink below a readable size to fit the page.
  compact <- panels > 48 || width > max_width * 1.15 || height > max_height * 1.15
  list(width = round(min(max(width, 4), max_width), 1), height = round(min(max(height, 2.5), max_height), 1),
       ncol = ncol, nrow = nrow, compact = compact)
}

#' Set figure sizes chosen by the user
#'
#' @param sizes Named list, plot id -> c(width, height) or list(width =, height =) in inches.
rs_resize <- function(result, sizes) {
  if (!length(sizes)) return(result)
  result$plots <- lapply(result$plots, function(p) {
    s <- sizes[[p$id]]
    if (is.null(s)) return(p)
    w <- suppressWarnings(as.numeric(if (is.list(s)) s$width else s[1]))
    h <- suppressWarnings(as.numeric(if (is.list(s)) s$height else s[2]))
    if (length(w) == 1 && is.finite(w) && w > 0) p$width <- min(w, 30)
    if (length(h) == 1 && is.finite(h) && h > 0) p$height <- min(h, 30)
    p
  })
  result
}
