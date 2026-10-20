`%||%` <- function(a, b) if (is.null(a) || length(a) == 0 || (length(a) == 1 && is.na(a))) b else a

has <- function(pkg) requireNamespace(pkg, quietly = TRUE)

one <- function(x) {
  x <- unlist(x)
  if (is.null(x) || !length(x) || is.na(x[1]) || !nzchar(x[1])) NULL else as.character(x[1])
}

# JSON arrays of objects arrive as lists of lists; NULL fields are dropped.
rows_of <- function(x) {
  if (is.null(x) || !length(x)) return(list())
  if (is.data.frame(x)) x <- lapply(seq_len(nrow(x)), function(i) as.list(x[i, , drop = FALSE]))
  lapply(x, function(r) r[!vapply(r, function(v) is.null(v) || (length(v) == 1 && is.na(v)), TRUE)])
}

chr <- function(x) as.character(unlist(x %||% character()))

theme_rs <- function() ggplot2::theme_minimal()

note <- function(text, code, level = "warning") rsage::rs_note(text, level, code)

# Runs f, keeping warnings as text instead of letting them reach the console.
quietly <- function(f) {
  warns <- character()
  value <- withCallingHandlers(tryCatch(f, error = function(e) e),
                               warning = function(w) {
                                 warns <<- c(warns, conditionMessage(w))
                                 invokeRestart("muffleWarning")
                               },
                               message = function(m) invokeRestart("muffleMessage"))
  list(value = value, warnings = unique(warns), error = if (inherits(value, "error")) conditionMessage(value) else NULL)
}

fmt_num <- function(x, digits = 3) formatC(x, digits = digits, format = "fg", flag = "#")
