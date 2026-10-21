# Rewrites a captured ggplot as a tidyplots pipeline. The plot is read term
# by term (`ggplot(...) + geom_x() + labs() + ...`): each term is evaluated
# to see what it is (a layer, a scale, labels, a facet, a coord, a theme)
# and looked up in the rule table below. A term with no rule is kept as
# ggplot code through tidyplots::add() and reported; a figure tidyplots
# cannot draw at all (maps, ridgelines) is reported as unsupported. The rule
# table is the one in docs/modules/tidyplots.md; keep them in step.

UNSUPPORTED_GEOMS <- c("GeomSf", "GeomMap", "GeomPolygon", "GeomDensityRidges", "GeomDensityRidges2", "GeomDensityRidgesGradient", "GeomRidgeline", "GeomSpoke", "GeomContour", "GeomDensity2d", "GeomDensity2dFilled")

DEFAULTS <- list(colors = "auto", theme = "tidyplot", size = "fill", fontsize = 10, family = NULL)

#' Rewrite a captured ggplot as tidyplots code
#'
#' @param cap Result of [capture()] with `kind == "ggplot"`.
#' @param options `colors` ("auto" keeps manual colours, or a tidyplots scheme
#'   such as "friendly", "okabeito", "viridis"), `theme` ("tidyplot",
#'   "minimal_xy", "minimal_x", "minimal_y", "ggplot2"), `size` ("fill": fit
#'   the chunk's figure size; "fixed": tidyplots' own 50 mm panels),
#'   `fontsize` (points, with size "fill"), `family` (font family or NULL).
#' @return list(status, code, notes, kept, flip). `status` is "rule" (every
#'   term converted), "partial" (some kept as ggplot code or dropped; see
#'   notes), "ai" (needs the assistant) or "unsupported".
translate <- function(cap, options = list()) {
  opt <- utils::modifyList(DEFAULTS, options %||% list())
  out <- list(status = "rule", code = NULL, notes = character(), kept = character(), flip = FALSE)
  ai <- function(why) utils::modifyList(out, list(status = "ai", notes = c(out$notes, why)))

  terms <- plus_terms(cap$target$expr)
  data_expr <- ggplot_data(terms[[1]])
  if (is.null(data_expr)) return(ai("그림의 시작이 ggplot(데이터, aes(...))가 아니어서 규칙으로 읽을 수 없습니다."))

  objs <- lapply(terms[-1], function(t) tryCatch(eval(t, cap$env), error = function(e) NULL))
  plot <- cap$plot
  bad <- intersect(c(vapply(plot$layers, function(l) class(l$geom)[1], ""), class(plot$coordinates)[1]), c(UNSUPPORTED_GEOMS, "CoordSf", "CoordMap", "CoordQuickmap"))
  if (length(bad)) {
    return(utils::modifyList(out, list(status = "unsupported", notes = sprintf("%s에 해당하는 tidyplots 함수가 없습니다 (지도 등).", bad[1]))))
  }

  # Aesthetics: the plot's own, then any a layer adds without conflict.
  map <- lapply(plot$mapping, q_expr)
  for (o in objs) {
    if (!inherits(o, "Layer")) next
    for (a in names(o$mapping)) {
      e <- q_expr(o$mapping[[a]])
      if (is.null(map[[a]])) map[[a]] <- e
      else if (!identical(map[[a]], e)) return(ai(sprintf("레이어마다 %s 매핑이 달라 tidyplots 하나로 옮길 수 없습니다.", a)))
    }
  }
  if (!is.null(map$colour) && !is.null(map$fill) && !identical(map$colour, map$fill)) {
    return(ai("colour와 fill이 서로 다른 변수라 tidyplots의 color 하나로 합칠 수 없습니다."))
  }
  color <- map$colour %||% map$fill
  dropped_aes <- setdiff(names(map), c("x", "y", "colour", "fill", "group", "ymin", "ymax", "label", "yintercept", "xintercept"))
  if (length(dropped_aes)) {
    out$status <- "partial"
    out$notes <- c(out$notes, sprintf("%s 매핑은 tidyplots에 없어 빠집니다.", paste(dropped_aes, collapse = ", ")))
  }

  coords <- Filter(function(o) inherits(o, "Coord"), objs)
  polar <- any(vapply(coords, inherits, TRUE, "CoordPolar"))
  if (any(vapply(coords, inherits, TRUE, "CoordFlip"))) {
    out$flip <- TRUE
    tmp <- map$x; map$x <- map$y; map$y <- tmp
  }
  if (polar && !is_constant(map$x)) return(utils::modifyList(out, list(status = "unsupported", notes = "원그래프가 아닌 극좌표 그림은 tidyplots에 없습니다.")))
  if (polar) map$x <- NULL

  # Mapped expressions that are not plain columns become columns first.
  mutate <- character()
  vars <- list()
  for (a in c("x", "y", "color", "group")) {
    e <- if (a == "color") color else map[[a]]
    if (is.null(e) || is_constant(e)) next
    name <- col_name(e)
    if (!is.symbol(e)) mutate <- c(mutate, sprintf("%s = %s", bq(name), expr_text(e)))
    vars[[a]] <- name
  }
  mutate <- unique(mutate)

  head <- expr_text(data_expr)
  steps <- character()
  if (length(mutate)) steps <- c(steps, sprintf("dplyr::mutate(%s)", paste(mutate, collapse = ", ")))
  tp_args <- c(
    if (!is.null(vars$x)) paste("x =", bq(vars$x)),
    if (!is.null(vars$y)) paste("y =", bq(vars$y)),
    if (!is.null(vars$color)) paste("color =", bq(vars$color))
  )
  steps <- c(steps, sprintf("tidyplot(%s)", paste(tp_args, collapse = ", ")))

  late <- character() # axis titles, colours: after the layers
  split <- NULL
  for (i in seq_along(objs)) {
    o <- objs[[i]]
    term <- terms[[i + 1]]
    if (inherits(o, "Layer")) {
      geom <- class(o$geom)[1]
      if (geom %in% UNSUPPORTED_GEOMS) {
        return(utils::modifyList(out, list(status = "unsupported", notes = sprintf("%s(%s)에 해당하는 tidyplots 함수가 없습니다.", term_fn(term), geom))))
      }
      r <- layer_steps(o, vars, polar)
      if (is.null(r)) {
        steps <- c(steps, sprintf("add(%s)", expr_text(term)))
        out$kept <- c(out$kept, expr_text(term))
        out$status <- "partial"
      } else {
        steps <- c(steps, r$steps)
        out$notes <- c(out$notes, r$notes)
      }
    } else if (inherits(o, "ggplot2::labels") || inherits(o, "labels")) {
      late <- c(late, label_steps(o))
      if (!is.null(o$subtitle)) out$notes <- c(out$notes, "부제(subtitle)는 tidyplots에 없어 빠집니다.")
    } else if (inherits(o, "Scale")) {
      r <- scale_steps(o, term, out$flip, opt)
      late <- c(late, r$steps)
      out$notes <- c(out$notes, r$notes)
    } else if (inherits(o, "Facet")) {
      split <- facet_step(o)
      if (is.null(split) && !inherits(o, "FacetNull")) return(ai("이 패싯은 split_plot()으로 옮길 수 없습니다."))
    } else if (inherits(o, "Coord")) {
      if (inherits(o, "CoordFlip") || inherits(o, "CoordPolar")) next
      if (!inherits(o, "CoordCartesian")) {
        return(utils::modifyList(out, list(status = "unsupported", notes = sprintf("%s 좌표계는 tidyplots에 없습니다.", class(o)[1]))))
      }
      for (ax in c("x", "y")) {
        lim <- o$limits[[ax]]
        if (!is.null(lim)) late <- c(late, sprintf("adjust_%s_axis(limits = %s)", ax, expr_text(lim)))
      }
      if (class(o)[1] != "CoordCartesian") out$notes <- c(out$notes, sprintf("%s는 빠집니다.", term_fn(term)))
    } else if (inherits(o, "theme") || inherits(o, "Guides") || inherits(o, "ggplot2::theme")) {
      out$notes <- c(out$notes, sprintf("%s는 tidyplots 테마로 바뀝니다.", term_fn(term)))
    } else if (inherits(o, "ggplot2::mapping") || inherits(o, "uneval")) {
      next # already merged into the plot's mapping
    } else {
      steps <- c(steps, sprintf("add(%s)", expr_text(term)))
      out$kept <- c(out$kept, expr_text(term))
      out$status <- "partial"
    }
  }
  steps <- c(steps, late)

  # Document-wide look: colours, theme, size. The theme resets the font size, so it comes first.
  scheme <- opt$colors
  if (!is.null(vars$color) && !identical(scheme, "auto")) {
    discrete <- !is.numeric(tryCatch(rlang::eval_tidy(color, plot$data, cap$env), error = function(e) NULL))
    fn <- sprintf("colors_%s_%s", if (discrete) "discrete" else "continuous", scheme)
    if (exists(fn, envir = tidyplots_env(), inherits = FALSE)) {
      steps <- steps[!grepl("^adjust_colors\\(", steps)]
      steps <- c(steps, sprintf("adjust_colors(new_colors = %s)", fn))
    }
  }
  if (!identical(opt$theme, "tidyplot")) steps <- c(steps, sprintf("theme_%s()", opt$theme))
  if (identical(opt$size, "fill")) {
    steps <- c(steps, "adjust_size(width = NA, height = NA)")
    font <- c(sprintf("fontsize = %s", opt$fontsize), if (!is.null(opt$family)) sprintf("family = %s", expr_text(opt$family)))
    steps <- c(steps, sprintf("adjust_font(%s)", paste(font, collapse = ", ")))
  } else if (!is.null(opt$family)) {
    steps <- c(steps, sprintf("adjust_font(family = %s)", expr_text(opt$family)))
  }
  if (!is.null(split)) steps <- c(steps, split)

  out$code <- paste0(head, " |>\n", paste0("  ", steps, collapse = " |>\n"))
  if (!is.null(cap$target$assign)) out$code <- paste(cap$target$assign, "<-", out$code)
  out$notes <- unique(out$notes)
  out
}

# ---- layers -------------------------------------------------------------

# Steps for one layer, or NULL when the layer has no rule (it is then kept with add()).
layer_steps <- function(o, vars, polar) {
  geom <- class(o$geom)[1]
  stat <- class(o$stat)[1]
  pos <- class(o$position)[1]
  sp <- o$stat_params
  gp <- o$geom_params
  ap <- o$aes_params
  notes <- character()
  args <- function(...) {
    a <- c(...)
    if (!is.null(ap$alpha)) a <- c(a, sprintf("alpha = %s", ap$alpha))
    paste(a, collapse = ", ")
  }
  call <- function(fn, ...) sprintf("%s(%s)", fn, args(...))
  if (!is.null(ap$colour) || !is.null(ap$fill)) notes <- c(notes, "고정 색(colour·fill)은 tidyplots 색 구성으로 바뀝니다.")
  one <- function(s) list(steps = s, notes = notes)

  if (stat == "StatSummary") {
    f <- fun_name(sp$fun)
    fd <- fun_name(sp$fun.data)
    if (is.null(f) && is.null(fd)) fd <- "mean_se"
    if (!is.null(sp$fun) && is.null(f) || !is.null(sp$fun.data) && is.null(fd)) return(NULL)
    err <- switch(fd %||% "", mean_se = "sem", mean_sdl = "sd", mean_cl_normal = "ci95", mean_cl_boot = "ci95", NULL)
    if (identical(fd, "mean_cl_boot")) notes <- c(notes, "부트스트랩 신뢰구간(mean_cl_boot)은 정규분포 신뢰구간(add_ci95_*)으로 바뀝니다.")
    if (!is.null(fd) && is.null(err)) return(NULL)
    centre <- if (!is.null(f)) switch(f, mean = "mean", median = "median", NULL) else if (!is.null(fd)) "mean"
    if (is.null(centre)) return(NULL)
    return(switch(geom,
      GeomBar = , GeomCol = one(call(sprintf("add_%s_bar", centre))),
      GeomPoint = one(call(sprintf("add_%s_dot", centre))),
      GeomLine = , GeomPath = one(call(sprintf("add_%s_line", centre))),
      GeomArea = one(call(sprintf("add_%s_area", centre))),
      GeomText = , GeomLabel = one(call(sprintf("add_%s_value", centre))),
      GeomErrorbar = , GeomLinerange = if (!is.null(err)) one(call(sprintf("add_%s_errorbar", err), width_arg(gp$width))) else NULL,
      GeomRibbon = if (!is.null(err)) one(call(sprintf("add_%s_ribbon", err))) else NULL,
      GeomPointrange = if (!is.null(err)) one(c(call(sprintf("add_%s_dot", centre)), sprintf("add_%s_errorbar(width = 0)", err))) else NULL,
      NULL
    ))
  }

  stacked <- pos %in% c("PositionStack", "PositionFill") && !is.null(vars$color)
  rel <- pos == "PositionFill"
  switch(geom,
    GeomPoint = if (stat == "StatIdentity") {
      size <- if (!is.null(ap$size)) sprintf("size = %s", ap$size)
      if (pos == "PositionJitter") {
        w <- o$position$width
        one(call("add_data_points_jitter", size, if (!is.null(w)) sprintf("jitter_width = %s", w)))
      } else if (pos %in% c("PositionIdentity", "PositionDodge")) {
        one(call("add_data_points", size))
      } else if (grepl("Beeswarm|Quasirandom", pos)) {
        one(call("add_data_points_beeswarm", size))
      }
    },
    GeomBar = , GeomCol = {
      if (polar) {
        return(one(call("add_pie")))
      }
      if (stat == "StatBin") {
        a <- c(if (!is.null(sp$bins)) sprintf("bins = %s", sp$bins), if (!is.null(sp$binwidth)) sprintf("binwidth = %s", sp$binwidth))
        one(call("add_histogram", a))
      } else if (stat == "StatCount") {
        if (stacked) one(call(if (rel) "add_barstack_relative" else "add_barstack_absolute")) else one(call("add_count_bar"))
      } else if (stat == "StatIdentity") {
        if (stacked) {
          one(call(if (rel) "add_barstack_relative" else "add_barstack_absolute"))
        } else {
          notes <- c(notes, "geom_col은 add_sum_bar()가 됩니다. x마다 값이 한 행일 때 같은 막대입니다.")
          one(call("add_sum_bar"))
        }
      }
    },
    GeomBoxplot = if (stat == "StatBoxplot") {
      hide <- length(gp$outlier.shape) == 1 && is.na(gp$outlier.shape) || isFALSE(gp$outliers)
      one(call("add_boxplot", if (hide) "show_outliers = FALSE"))
    },
    GeomViolin = if (stat == "StatYdensity") one(call("add_violin")),
    GeomLine = , GeomPath = if (stat == "StatIdentity") one(call("add_line", if (!is.null(vars$group)) sprintf("group = %s", bq(vars$group)))),
    GeomArea = if (stat %in% c("StatIdentity", "StatAlign")) one(call("add_area", if (!is.null(vars$group)) sprintf("group = %s", bq(vars$group)))),
    GeomSmooth = {
      m <- sp$method
      m <- if (is.null(m) || identical(m, "auto")) "loess" else if (is.character(m)) m else NULL
      if (is.null(m)) return(NULL)
      a <- c(sprintf("method = %s", expr_text(m)), if (isFALSE(sp$se)) "se = FALSE")
      one(call("add_curve_fit", a))
    },
    GeomTile = , GeomRaster = if (stat == "StatIdentity") one(call("add_heatmap")),
    GeomHline = if (!is.null(o$data$yintercept)) one(sprintf("add_reference_lines(y = %s)", expr_text(o$data$yintercept))),
    GeomVline = if (!is.null(o$data$xintercept)) one(sprintf("add_reference_lines(x = %s)", expr_text(o$data$xintercept))),
    {
      if (stat == "StatEllipse") one(call("add_ellipse")) else NULL
    }
  )
}

width_arg <- function(w) if (!is.null(w)) sprintf("width = %s", w)

fun_name <- function(f) {
  if (is.null(f)) return(NULL)
  if (is.character(f)) return(f)
  if (identical(f, base::mean)) return("mean")
  if (identical(f, stats::median)) return("median")
  for (n in c("mean_se", "mean_sdl", "mean_cl_normal", "mean_cl_boot")) if (identical(f, getExportedValue("ggplot2", n))) return(n)
  NULL
}

# ---- labels, scales, facets ----------------------------------------------

label_steps <- function(o) {
  s <- character()
  if (!is.null(o$title)) s <- c(s, sprintf("add_title(%s)", expr_text(o$title)))
  if (!is.null(o$x)) s <- c(s, sprintf("adjust_x_axis_title(%s)", expr_text(o$x)))
  if (!is.null(o$y)) s <- c(s, sprintf("adjust_y_axis_title(%s)", expr_text(o$y)))
  leg <- o$colour %||% o$fill
  if (!is.null(leg)) s <- c(s, sprintf("adjust_legend_title(%s)", expr_text(leg)))
  if (!is.null(o$caption)) s <- c(s, sprintf("add_caption(%s)", expr_text(o$caption)))
  s
}

TRANSFORMS <- c("log-10" = "log10", "log-2" = "log2", "sqrt" = "sqrt", "reverse" = "reverse")

scale_steps <- function(o, term, flip, opt) {
  aes <- o$aesthetics
  named <- !inherits(o$name, "waiver") && !is.null(o$name)
  if (any(c("x", "y") %in% aes)) {
    ax <- if ("x" %in% aes) "x" else "y"
    if (flip) ax <- setdiff(c("x", "y"), ax)
    if (inherits(o, "ScaleContinuous")) {
      a <- character()
      if (named) a <- c(a, sprintf("title = %s", expr_text(o$name)))
      tr <- o$trans$name %||% o$transformation$name %||% "identity"
      if (tr != "identity") {
        if (is.na(TRANSFORMS[tr])) return(list(steps = character(), notes = sprintf("%s 축 변환(%s)은 빠집니다.", ax, tr)))
        a <- c(a, sprintf("transform = %s", expr_text(unname(TRANSFORMS[tr]))))
      }
      if (!is.null(o$limits) && !is.function(o$limits)) {
        lim <- o$limits
        if (tr != "identity") lim <- o$trans$inverse(lim)
        a <- c(a, sprintf("limits = %s", expr_text(lim)))
      }
      if (!length(a)) return(list(steps = character(), notes = character()))
      return(list(steps = sprintf("adjust_%s_axis(%s)", ax, paste(a, collapse = ", ")), notes = character()))
    }
    s <- character()
    if (named) s <- c(s, sprintf("adjust_%s_axis_title(%s)", ax, expr_text(o$name)))
    if (is.character(o$limits)) s <- c(s, sprintf("reorder_%s_axis_levels(%s)", ax, paste(vapply(o$limits, expr_text, ""), collapse = ", ")))
    return(list(steps = s, notes = character()))
  }
  if (any(c("colour", "fill") %in% aes)) {
    s <- character()
    notes <- character()
    if (named) s <- c(s, sprintf("adjust_legend_title(%s)", expr_text(o$name)))
    fn <- term_fn(term)
    if (grepl("_manual\\(\\)$", fn) && is.call(term) && !is.null(as.list(term)$values)) {
      s <- c(s, sprintf("adjust_colors(new_colors = %s)", expr_text(as.list(term)$values)))
    } else if (identical(opt$colors, "auto")) {
      notes <- c(notes, sprintf("%s의 색은 tidyplots 기본 색 구성으로 바뀝니다.", fn))
    }
    return(list(steps = s, notes = notes))
  }
  list(steps = character(), notes = sprintf("%s는 빠집니다.", term_fn(term)))
}

facet_step <- function(o) {
  q <- function(x) vapply(x, function(v) expr_text(q_expr(v)), "")
  # ggplot shares axes across panels unless told otherwise; split_plot() frees them unless told.
  free <- o$params$free %||% list(x = FALSE, y = FALSE)
  scales <- if (isTRUE(free$x) && isTRUE(free$y)) "free" else if (isTRUE(free$x)) "free_x" else if (isTRUE(free$y)) "free_y" else "fixed"
  scales <- sprintf("scales = %s", expr_text(scales))
  if (inherits(o, "FacetWrap")) {
    f <- q(o$params$facets)
    if (length(f) != 1) return(NULL)
    a <- c(sprintf("by = %s", f), if (!is.null(o$params$ncol)) sprintf("ncol = %s", o$params$ncol), if (!is.null(o$params$nrow)) sprintf("nrow = %s", o$params$nrow), scales)
    return(sprintf("split_plot(%s)", paste(a, collapse = ", ")))
  }
  if (inherits(o, "FacetGrid")) {
    r <- q(o$params$rows)
    k <- q(o$params$cols)
    if (length(r) > 1 || length(k) > 1) return(NULL)
    a <- c(if (length(r)) sprintf("rows = %s", r), if (length(k)) sprintf("cols = %s", k), scales)
    return(sprintf("split_plot(%s)", paste(a, collapse = ", ")))
  }
  NULL
}

# ---- expression helpers --------------------------------------------------

# a + b + c -> list(a, b, c)
plus_terms <- function(e) {
  if (is.call(e) && identical(e[[1]], quote(`+`)) && length(e) == 3) c(plus_terms(e[[2]]), list(e[[3]])) else list(e)
}

# The data expression of the first term: ggplot(d, ...), ggplot(data = d), d %>% ggplot(...).
ggplot_data <- function(e) {
  if (!is.call(e)) return(NULL)
  if (identical(e[[1]], quote(`%>%`)) && is_ggplot_call(e[[3]])) return(e[[2]])
  if (!is_ggplot_call(e)) return(NULL)
  args <- as.list(e)[-1]
  if (!is.null(args$data)) return(args$data)
  pos <- args[(names(args) %||% rep("", length(args))) == ""]
  if (!length(pos)) return(NULL)
  first <- pos[[1]]
  if (is.call(first) && identical(first[[1]], quote(aes))) return(NULL)
  first
}

is_ggplot_call <- function(e) {
  is.call(e) && (identical(e[[1]], quote(ggplot)) || identical(e[[1]], quote(ggplot2::ggplot)))
}

q_expr <- function(q) if (rlang::is_quosure(q)) rlang::quo_get_expr(q) else q

is_constant <- function(e) is.character(e) || is.numeric(e) || is.logical(e)

# The column name a mapped expression gets: the variable itself for
# factor(cyl) and the like, otherwise the expression's text.
col_name <- function(e) {
  if (is.symbol(e)) return(as.character(e))
  if (is.call(e) && length(e) == 2 && is.symbol(e[[2]]) && as.character(e[[1]]) %in% c("factor", "as.factor", "as.character", "ordered", "as.numeric")) {
    return(as.character(e[[2]]))
  }
  expr_text(e)
}

bq <- function(name) if (make.names(name) == name) name else paste0("`", name, "`")

expr_text <- function(e) paste(deparse(e, width.cutoff = 500L), collapse = " ")

term_fn <- function(term) {
  if (is.call(term)) {
    f <- term[[1]]
    if (is.call(f) && identical(f[[1]], quote(`::`))) f <- f[[3]]
    return(paste0(as.character(f), "()"))
  }
  expr_text(term)
}

# tidyplots' exported functions in an environment whose parent is `parent`,
# so generated code runs as it would after library(tidyplots) without
# attaching anything to the user's session.
tidyplots_env <- function(parent = emptyenv()) {
  ns <- asNamespace("tidyplots")
  list2env(mget(getNamespaceExports(ns), envir = ns, inherits = TRUE), parent = parent)
}
