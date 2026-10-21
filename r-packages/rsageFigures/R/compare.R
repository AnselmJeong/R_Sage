# Checks that a converted figure shows what the original showed. Both plots
# are built with ggplot_build() and compared on what a reader takes from
# them: the rows of data, which variables sit on x, y and colour, and the
# numbers each layer draws (bar heights, error bar ends, box quartiles,
# point and line positions). Colours, fonts and themes are expected to
# change and are not compared.

FAMILIES <- list(
  GeomBar = "bar", GeomCol = "bar", GeomErrorbar = "errorbar", GeomLinerange = "errorbar", GeomCrossbar = "errorbar",
  GeomPointrange = c("point", "errorbar"), GeomPoint = "point", GeomBoxplot = "box", GeomViolin = "violin",
  GeomLine = "line", GeomPath = "line", GeomArea = "area", GeomRibbon = "errorbar", GeomSmooth = "smooth",
  GeomTile = "tile", GeomRaster = "tile", GeomHline = "hline", GeomVline = "vline", GeomText = "text", GeomLabel = "text"
)

CHECK_LABELS <- c(
  bar = "막대 높이", errorbar = "오차막대 끝값", point = "점 위치", box = "상자 (사분위수·수염)", violin = "바이올린 수",
  line = "선 위치", area = "영역 위치", smooth = "추세선", tile = "타일 수", hline = "가로 기준선", vline = "세로 기준선", text = "글자 수"
)

#' Compare an original figure with its conversion
#'
#' @param before,after ggplot objects (a tidyplot is one).
#' @param flip TRUE when the conversion swapped x and y (coord_flip()).
#' @return list(ok, checks): `checks` is a data frame with one row per
#'   comparison (`check`, `before`, `after`, `ok`).
compare <- function(before, after, flip = FALSE) {
  b <- suppressMessages(ggplot2::ggplot_build(before))
  a <- suppressMessages(ggplot2::ggplot_build(after))
  rows <- list()
  add <- function(check, x, y, ok = identical(x, y)) {
    rows[[length(rows) + 1]] <<- data.frame(check = check, before = as.character(x), after = as.character(y), ok = isTRUE(ok))
  }

  n <- function(p) if (is.data.frame(p$data)) nrow(p$data) else NA_integer_
  add("데이터 행 수", n(before), n(after))

  bv <- mapped_vars(before)
  av <- mapped_vars(after)
  if (flip) bv[c("x", "y")] <- bv[c("y", "x")]
  for (k in c("x", "y", "color")) {
    if (is.na(bv[[k]]) && is.na(av[[k]])) next
    add(sprintf("%s 변수", if (k == "color") "색" else k), bv[[k]] %|NA|% "없음", av[[k]] %|NA|% "없음")
  }

  bs <- signatures(before, b, FALSE)
  as <- signatures(after, a, flip)
  for (f in unique(names(bs))) {
    x <- bs[names(bs) == f]
    y <- as[names(as) == f]
    for (s in x) {
      hit <- any(vapply(y, function(t) isTRUE(all.equal(s, t, tolerance = 1e-6)), TRUE))
      add(CHECK_LABELS[[f]] %||% f, summary_text(s), if (hit) summary_text(s) else if (length(y)) summary_text(y[[1]]) else "없음", hit)
    }
  }
  checks <- do.call(rbind, rows)
  list(ok = all(checks$ok), checks = checks)
}

# Variable names on x, y and colour, with factor(v) and the like read as v.
mapped_vars <- function(p) {
  m <- p$mapping
  for (l in p$layers) for (k in names(l$mapping)) if (is.null(m[[k]])) m[[k]] <- l$mapping[[k]]
  get <- function(k) {
    q <- m[[k]]
    if (is.null(q)) return(NA_character_)
    e <- q_expr(q)
    # tidyplots maps a constant when there is no colour variable.
    if (is_constant(e) || identical(e, quote(.single_color))) NA_character_ else col_name(e)
  }
  col <- get("colour")
  if (is.na(col)) col <- get("fill")
  list(x = get("x"), y = get("y"), color = col)
}

# One numeric signature per layer and family, named by family.
signatures <- function(p, built, flip) {
  out <- list()
  for (i in seq_along(p$layers)) {
    geom <- class(p$layers[[i]]$geom)[1]
    d <- built$data[[i]]
    fams <- FAMILIES[[geom]] %||% geom
    flipped <- flip || isTRUE(d$flipped_aes[1])
    col <- function(y) {
      if (flipped) y <- sub("^y", "x", y)
      if (y %in% names(d)) d[[y]] else NULL
    }
    for (f in fams) {
      v <- switch(f,
        bar = {
          h <- col("ymax") - col("ymin")
          # A pie shows shares: ggplot stacks counts, tidyplots proportions.
          if (inherits(p$coordinates, "CoordPolar")) h / sum(h) else h
        },
        errorbar = c(col("ymin"), col("ymax")),
        point = , line = , area = col("y"),
        smooth = round(col("y"), 4),
        box = c(col("lower"), col("middle"), col("upper"), col("ymin"), col("ymax")),
        violin = length(unique(d$group)),
        hline = d$yintercept,
        vline = d$xintercept,
        nrow(d)
      )
      v <- if (is.numeric(v)) sort(round(v, 6)) else v
      out[[length(out) + 1]] <- v
      names(out)[length(out)] <- f
    }
  }
  out
}

summary_text <- function(v) {
  if (!length(v)) return("없음")
  if (length(v) <= 4) return(paste(format(v, digits = 4), collapse = ", "))
  sprintf("%d개 (%s … %s)", length(v), format(min(v), digits = 4), format(max(v), digits = 4))
}

`%|NA|%` <- function(a, b) if (is.na(a)) b else a
