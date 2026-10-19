# Result objects shared by every R Sage analysis module.
#
# A module's analyse() returns rs_result(). The same object prints in the
# console, renders in Quarto (knit_print), and is written by rs_write() as
# result.json plus plot files for the R Sage analysis tab.

#' A result table
#'
#' @param id Stable identifier, used by rs_value() and the app.
#' @param title Shown above the table.
#' @param data A data frame. Numbers are kept unrounded.
#' @param labels Named character vector: column id -> display label.
#' @param notes Character vector of footnotes.
#' @param description How to read the table, in a sentence or two; shown under the title.
#' @param section Result section the table belongs to (see rs_result()).
rs_table <- function(id, title, data, labels = NULL, notes = character(), description = NULL, section = NULL) {
  stopifnot(is.character(id), length(id) == 1, is.data.frame(data))
  data <- as.data.frame(data, stringsAsFactors = FALSE)
  structure(list(id = id, title = title, data = data, labels = labels, notes = as.character(notes),
                 description = description, section = section),
            class = "rsage_table")
}

#' A result plot
#'
#' @param plot A ggplot object, or a function that draws on the current device.
#' @param size Size from rs_figure_size() (preferred), or give width and height.
#' @param width,height Size in inches; override size.
#' @param alt Text description of the plot.
#' @param description How to read the plot, in a sentence or two; shown under the title.
#' @param section Result section the plot belongs to (see rs_result()).
rs_plot <- function(id, title, plot, size = NULL, width = NULL, height = NULL, alt = title,
                    description = NULL, section = NULL) {
  stopifnot(inherits(plot, "ggplot") || is.function(plot))
  width <- if (!is.null(width)) width else if (!is.null(size)) size$width else 7
  height <- if (!is.null(height)) height else if (!is.null(size)) size$height else 4.5
  # The size the module chose, kept so the app can offer "automatic" after a user resize.
  structure(list(id = id, title = title, plot = plot, width = width, height = height,
                 auto = c(width = width, height = height), alt = alt,
                 description = description, section = section),
            class = "rsage_plot")
}

#' A note or warning about the result
#'
#' @param level "info" for context, "warning" for something the reader must weigh.
#' @param code Stable machine-readable code, e.g. "insufficient_n".
#' @param file Absolute path of a file the analysis wrote; the app offers to open it.
rs_note <- function(text, level = c("info", "warning"), code = NULL, file = NULL) {
  structure(list(text = text, level = match.arg(level), code = code, file = file), class = "rsage_note")
}

#' Build a module result
#'
#' @param analysis Analysis id, e.g. "missing".
#' @param options The options the analysis ran with (after defaults).
#' @param packages Packages whose versions belong in the provenance.
#' @param exports Named list of R objects the app may assign in the session
#'   (only when the user asked for it, e.g. an imputed data set).
#' @param sections Order of the result sections. Tables and plots are shown
#'   grouped by their `section`, in this order; items without one come first.
rs_result <- function(analysis, title, tables = list(), plots = list(), notes = list(),
                      options = list(), data_info = list(), packages = character(), exports = list(),
                      sections = character()) {
  pkgs <- unique(c("rsage", packages))
  versions <- vapply(pkgs, function(p) {
    v <- tryCatch(as.character(utils::packageVersion(p)), error = function(e) NA_character_)
    v
  }, character(1))
  structure(
    list(
      analysis = analysis,
      title = title,
      tables = stats::setNames(tables, vapply(tables, `[[`, "", "id")),
      plots = stats::setNames(plots, vapply(plots, `[[`, "", "id")),
      notes = notes,
      options = options,
      data_info = data_info,
      exports = exports,
      sections = as.character(sections),
      provenance = list(
        r = R.version.string,
        packages = as.list(versions),
        created = format(Sys.time(), "%Y-%m-%dT%H:%M:%S%z")
      )
    ),
    class = "rsage_result"
  )
}

#' Fill in defaults for missing options, recursively
#'
#' @param options Options as given (may be partial).
#' @param defaults Complete default options.
rs_merge_options <- function(options, defaults) {
  if (is.null(options)) return(defaults)
  out <- defaults
  for (n in names(options)) {
    if (is.list(defaults[[n]]) && !is.null(names(defaults[[n]])) && is.list(options[[n]])) {
      out[[n]] <- rs_merge_options(options[[n]], defaults[[n]])
    } else if (!is.null(options[[n]])) {
      out[[n]] <- options[[n]]
    }
  }
  out
}

#' One number from a result table, for inline R in reports
#'
#' @param row A row index, or a value matched against the table's first column.
#' @param column Column id.
rs_value <- function(result, table, row, column) {
  t <- result$tables[[table]]
  if (is.null(t)) stop("No table '", table, "' in this result.")
  d <- t$data
  i <- if (is.numeric(row)) row else match(row, d[[1]])
  if (is.na(i) || i > nrow(d)) stop("No row '", row, "' in table '", table, "'.")
  if (!column %in% names(d)) stop("No column '", column, "' in table '", table, "'.")
  d[[column]][[i]]
}

# ---------- printing ----------

format_cell <- function(x, digits = 3) {
  if (is.numeric(x)) {
    out <- ifelse(is.na(x), "", formatC(x, digits = digits, format = "fg", flag = "#"))
    out <- ifelse(!is.na(x) & x == round(x), format(round(x), big.mark = ","), sub("\\.?0+$", "", out))
    return(out)
  }
  ifelse(is.na(x), "", as.character(x))
}

table_display <- function(t, digits = 3) {
  d <- t$data
  shown <- as.data.frame(lapply(d, format_cell, digits = digits), stringsAsFactors = FALSE, check.names = FALSE)
  if (!is.null(t$labels)) {
    lab <- t$labels[names(d)]
    names(shown) <- ifelse(is.na(lab), names(d), lab)
  }
  shown
}

format.rsage_table <- function(x, ...) {
  utils::capture.output(print(table_display(x), row.names = FALSE, right = FALSE))
}

print.rsage_table <- function(x, ...) {
  cat("## ", x$title, "\n", sep = "")
  cat(format(x), sep = "\n")
  if (length(x$notes)) cat(paste0("  ", x$notes), sep = "\n")
  invisible(x)
}

draw_plot <- function(p) {
  if (inherits(p$plot, "ggplot")) print(p$plot) else p$plot()
}

print.rsage_result <- function(x, ...) {
  cat("# ", x$title, "\n\n", sep = "")
  for (t in x$tables) {
    print(t)
    cat("\n")
  }
  for (n in x$notes) cat(if (n$level == "warning") "! " else "- ", n$text, "\n", sep = "")
  if (interactive()) for (p in x$plots) draw_plot(p)
  invisible(x)
}

knit_print.rsage_result <- function(x, options = list(), ...) {
  out <- character()
  label <- if (!is.null(options$label)) options$label else x$analysis
  fig_path <- if (!is.null(options$fig.path)) options$fig.path else "figure/"
  for (sec in result_sections(x)) {
    if (nzchar(sec$name) && length(x$sections) > 1) out <- c(out, paste("####", sec$name), "")
    for (t in sec$tables) {
      if (!is.null(t$description)) out <- c(out, paste0("*", t$description, "*"), "")
      out <- c(out, paste(knitr::kable(table_display(t), caption = t$title, format = "pipe"), collapse = "\n"), "")
      if (length(t$notes)) out <- c(out, paste0("*", t$notes, "*"), "")
    }
    for (p in sec$plots) {
      file <- paste0(fig_path, label, "-", p$id, ".png")
      dir.create(dirname(file), recursive = TRUE, showWarnings = FALSE)
      save_plot(p, file)
      out <- c(out, sprintf("![%s](%s){fig-alt=\"%s\"}", p$title, file, gsub("\"", "'", p$alt)), "")
      if (!is.null(p$description)) out <- c(out, paste0("*", p$description, "*"), "")
    }
  }
  for (n in x$notes) out <- c(out, paste0(if (n$level == "warning") "> **주의:** " else "> ", n$text), "")
  knitr::asis_output(paste(out, collapse = "\n"))
}

# Tables and plots grouped by section, in the result's section order.
result_sections <- function(x) {
  sec_of <- function(i) if (is.null(i$section)) "" else i$section
  names_all <- unique(c("", x$sections, vapply(x$tables, sec_of, ""), vapply(x$plots, sec_of, "")))
  out <- lapply(names_all, function(n) list(
    name = n,
    tables = Filter(function(t) sec_of(t) == n, x$tables),
    plots = Filter(function(p) sec_of(p) == n, x$plots)
  ))
  Filter(function(s) length(s$tables) || length(s$plots), out)
}

# ---------- writing for the app ----------

# ragg like the plot pane: it finds a system font for Korean (and other) text,
# where png() can draw boxes on macOS.
png_device <- function() {
  if (requireNamespace("ragg", quietly = TRUE)) ragg::agg_png else grDevices::png
}

save_plot <- function(p, file, dpi = 144) {
  dev <- png_device()
  if (inherits(p$plot, "ggplot")) {
    ggplot2::ggsave(file, p$plot, width = p$width, height = p$height, dpi = dpi, device = dev)
  } else {
    dev(file, width = p$width, height = p$height, units = "in", res = dpi)
    on.exit(grDevices::dev.off())
    p$plot()
  }
  invisible(file)
}

column_type <- function(x) {
  if (is.logical(x)) "boolean" else if (is.numeric(x)) "number" else "string"
}

# NaN and Inf are not JSON: they become null, with the table's notes saying why.
json_column <- function(x) {
  if (is.factor(x)) x <- as.character(x)
  if (is.numeric(x)) x[!is.finite(x)] <- NA
  x
}

table_json <- function(t) {
  d <- t$data
  cols <- lapply(names(d), function(n) {
    lab <- if (!is.null(t$labels) && !is.na(t$labels[n])) unname(t$labels[n]) else n
    list(id = n, label = lab, type = column_type(d[[n]]))
  })
  rows <- if (nrow(d)) lapply(seq_len(nrow(d)), function(i) lapply(d, function(col) json_column(col)[[i]])) else list()
  list(id = t$id, title = t$title, columns = cols, rows = lapply(rows, unname), notes = as.list(t$notes),
       description = t$description, section = t$section)
}

#' Write a result for the R Sage app
#'
#' Plots go to `dir` as PNG files; everything else to `dir/result.json`,
#' written to a temporary name first so the app never reads half a file.
rs_write <- function(result, dir, run_id = NULL) {
  dir.create(dir, recursive = TRUE, showWarnings = FALSE)
  plots <- lapply(result$plots, function(p) {
    file <- paste0("plot-", p$id, ".png")
    save_plot(p, file.path(dir, file))
    # The plot itself, so the app can redraw it in the Plots pane (fit, aspect, Save Plot).
    saveRDS(p$plot, file.path(dir, paste0("plot-", p$id, ".rds")))
    auto <- if (is.null(p$auto)) c(width = p$width, height = p$height) else p$auto
    list(id = p$id, title = p$title, file = file, width = p$width, height = p$height,
         autoWidth = unname(auto[["width"]]), autoHeight = unname(auto[["height"]]), alt = p$alt,
         description = p$description, section = p$section)
  })
  json <- list(
    schemaVersion = 1L,
    runId = run_id,
    analysis = result$analysis,
    title = result$title,
    tables = unname(lapply(result$tables, table_json)),
    plots = unname(plots),
    notes = lapply(result$notes, function(n) list(level = n$level, code = n$code, text = n$text, file = n$file)),
    options = result$options,
    dataInfo = result$data_info,
    exports = as.list(names(result$exports)),
    sections = as.list(result$sections),
    provenance = result$provenance
  )
  tmp <- file.path(dir, "result.json.tmp")
  jsonlite::write_json(json, tmp, auto_unbox = TRUE, null = "null", na = "null", digits = NA, pretty = FALSE)
  file.rename(tmp, file.path(dir, "result.json"))
  invisible(file.path(dir, "result.json"))
}
