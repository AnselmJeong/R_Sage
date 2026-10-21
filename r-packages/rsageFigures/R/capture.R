# Runs the code behind a figure and finds the figure. The code runs in a
# child of the caller's environment, so objects it makes (and any it
# overwrites) never reach the user's session, and on an off-screen device,
# so nothing is drawn in the plot pane. What comes back says which kind of
# figure it is and which top-level expression made it, so a converter can
# replace exactly those lines and keep the rest of the chunk.

BASE_GRAPHICS <- c(
  "plot", "hist", "barplot", "boxplot", "pie", "matplot", "pairs", "stripchart",
  "dotchart", "mosaicplot", "image", "contour", "persp", "curve", "coplot", "sunflowerplot",
  "plot.default", "plot.new", "symbols", "smoothScatter"
)
LATTICE <- c("xyplot", "bwplot", "histogram", "densityplot", "dotplot", "barchart", "levelplot", "splom", "stripplot", "qqmath")

#' Run figure code and find the figure it draws
#'
#' @param code R code as text, usually a whole chunk.
#' @param envir Environment the code reads its data from (not modified).
#' @return list(kind, plot, env, target, message). `kind` is "ggplot",
#'   "tidyplot" (already converted), "base", "lattice", "none" or "error".
#'   `target` names the top-level expression that made the figure:
#'   `index`, `first_line`, `last_line` (lines within `code`), `assign` (the
#'   variable it was assigned to, if any) and `expr` (the ggplot expression
#'   itself, without the assignment).
capture <- function(code, envir = globalenv()) {
  exprs <- tryCatch(parse(text = code, keep.source = TRUE), error = function(e) e)
  if (inherits(exprs, "error")) return(list(kind = "error", message = conditionMessage(exprs)))
  refs <- attr(exprs, "srcref")
  env <- new.env(parent = envir)

  dev <- grDevices::dev.cur()
  grDevices::pdf(NULL)
  on.exit({
    grDevices::dev.off()
    if (dev > 1) grDevices::dev.set(dev)
  }, add = TRUE)

  assigned <- list() # variable name -> index of the expression that assigned a ggplot to it
  found <- NULL
  other <- NULL
  for (i in seq_along(exprs)) {
    e <- exprs[[i]]
    names_used <- all.names(e)
    if (is.null(other) && any(names_used %in% LATTICE)) other <- "lattice"
    else if (is.null(other) && any(names_used %in% BASE_GRAPHICS) && !any(names_used %in% c("ggplot", "tidyplot"))) other <- "base"
    v <- tryCatch(suppressMessages(withVisible(eval(e, env))), error = function(err) err)
    if (inherits(v, "error")) {
      return(list(kind = "error", message = conditionMessage(v), env = env, index = i))
    }
    val <- v$value
    if (is_assign(e) && is_gg(get0(as.character(e[[2]]), envir = env, inherits = FALSE))) {
      assigned[[as.character(e[[2]])]] <- i
    }
    if (!is_gg(val)) next
    shown <- v$visible || (is.call(e) && identical(e[[1]], quote(print)))
    if (!shown) next
    # `p` (or print(p)) after `p <- ggplot(...)`: the figure is the assignment.
    sym <- if (is.symbol(e)) as.character(e) else if (is.call(e) && length(e) == 2 && is.symbol(e[[2]])) as.character(e[[2]]) else NULL
    at <- if (!is.null(sym) && !is.null(assigned[[sym]])) assigned[[sym]] else i
    src <- exprs[[at]]
    expr <- if (is_assign(src)) src[[3]] else if (is.call(src) && identical(src[[1]], quote(print))) src[[2]] else src
    found <- list(
      plot = val, index = at,
      first_line = refs[[at]][[1]], last_line = refs[[at]][[3]],
      assign = if (is_assign(src)) as.character(src[[2]]) else NULL,
      expr = expr
    )
  }

  if (!is.null(found)) {
    kind <- if (inherits(found$plot, "tidyplot")) "tidyplot" else "ggplot"
    target <- found[c("index", "first_line", "last_line", "assign", "expr")]
    return(list(kind = kind, plot = found$plot, env = env, target = target))
  }
  list(kind = other %||% "none", env = env)
}

is_gg <- function(x) inherits(x, "ggplot")

is_assign <- function(e) {
  is.call(e) && length(e) == 3 && (identical(e[[1]], quote(`<-`)) || identical(e[[1]], quote(`=`))) && is.symbol(e[[2]])
}

`%||%` <- function(a, b) if (is.null(a)) b else a
