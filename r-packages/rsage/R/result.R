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
rs_table <- function(id, title, data, labels = NULL, notes = character()) {
  stopifnot(is.character(id), length(id) == 1, is.data.frame(data))
  data <- as.data.frame(data, stringsAsFactors = FALSE)
  structure(list(id = id, title = title, data = data, labels = labels, notes = as.character(notes)),
            class = "rsage_table")
}

#' A result plot
#'
#' @param plot A ggplot object, or a function that draws on the current device.
#' @param width,height Size in inches.
#' @param alt Text description of the plot.
rs_plot <- function(id, title, plot, width = 7, height = 4.5, alt = title) {
  stopifnot(inherits(plot, "ggplot") || is.function(plot))
  structure(list(id = id, title = title, plot = plot, width = width, height = height, alt = alt),
            class = "rsage_plot")
}

#' A note or warning about the result
#'
#' @param level "info" for context, "warning" for something the reader must weigh.
#' @param code Stable machine-readable code, e.g. "insufficient_n".
rs_note <- function(text, level = c("info", "warning"), code = NULL) {
  structure(list(text = text, level = match.arg(level), code = code), class = "rsage_note")
}

#' Build a module result
#'
#' @param analysis Analysis id, e.g. "missing".
#' @param options The options the analysis ran with (after defaults).
#' @param packages Packages whose versions belong in the provenance.
#' @param exports Named list of R objects the app may assign in the session
#'   (only when the user asked for it, e.g. an imputed data set).
rs_result <- function(analysis, title, tables = list(), plots = list(), notes = list(),
                      options = list(), data_info = list(), packages = character(), exports = list()) {
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
  for (t in x$tables) {
    out <- c(out, paste(knitr::kable(table_display(t), caption = t$title, format = "pipe"), collapse = "\n"), "")
    if (length(t$notes)) out <- c(out, paste0("*", t$notes, "*"), "")
  }
  for (p in x$plots) {
    file <- paste0(fig_path, label, "-", p$id, ".png")
    dir.create(dirname(file), recursive = TRUE, showWarnings = FALSE)
    save_plot(p, file)
    out <- c(out, sprintf("![%s](%s){fig-alt=\"%s\"}", p$title, file, gsub("\"", "'", p$alt)), "")
  }
  for (n in x$notes) out <- c(out, paste0(if (n$level == "warning") "> **주의:** " else "> ", n$text), "")
  knitr::asis_output(paste(out, collapse = "\n"))
}

# ---------- writing for the app ----------

save_plot <- function(p, file, dpi = 144) {
  if (inherits(p$plot, "ggplot")) {
    ggplot2::ggsave(file, p$plot, width = p$width, height = p$height, dpi = dpi, device = grDevices::png)
  } else {
    grDevices::png(file, width = p$width, height = p$height, units = "in", res = dpi)
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
  list(id = t$id, title = t$title, columns = cols, rows = lapply(rows, unname), notes = as.list(t$notes))
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
    list(id = p$id, title = p$title, file = file, width = p$width, height = p$height, alt = p$alt)
  })
  json <- list(
    schemaVersion = 1L,
    runId = run_id,
    analysis = result$analysis,
    title = result$title,
    tables = unname(lapply(result$tables, table_json)),
    plots = unname(plots),
    notes = lapply(result$notes, function(n) list(level = n$level, code = n$code, text = n$text)),
    options = result$options,
    dataInfo = result$data_info,
    exports = as.list(names(result$exports)),
    provenance = result$provenance
  )
  tmp <- file.path(dir, "result.json.tmp")
  jsonlite::write_json(json, tmp, auto_unbox = TRUE, null = "null", na = "null", digits = NA, pretty = FALSE)
  file.rename(tmp, file.path(dir, "result.json"))
  invisible(file.path(dir, "result.json"))
}
