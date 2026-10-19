# Small helpers shared by the checks.

`%||%` <- function(a, b) if (is.null(a)) b else a

has <- function(pkg) requireNamespace(pkg, quietly = TRUE)

# A single column name from an option that may be NULL, "" or a list.
one_name <- function(x) {
  x <- unlist(x)
  if (length(x) && !is.na(x[[1]]) && nzchar(x[[1]])) as.character(x[[1]]) else NULL
}

# Rule rows arrive from JSON as a list of named lists; from R they may be a
# data frame. Either way: a list of named lists with empty fields dropped.
rule_rows <- function(x) {
  if (is.null(x) || !length(x)) return(list())
  if (is.data.frame(x)) x <- lapply(seq_len(nrow(x)), function(i) as.list(x[i, , drop = FALSE]))
  lapply(x, function(r) {
    r <- lapply(r, function(v) if (is.null(v) || (length(v) == 1 && is.na(v))) NULL else v)
    r[!vapply(r, is.null, TRUE)]
  })
}

# Whitespace includes no-break, ideographic and zero-width spaces, which
# spreadsheets and web copies bring in and trimws() alone misses.
WS <- "[\\h\\v\u200B\uFEFF]"

trim <- function(x) trimws(x, whitespace = WS)

is_text <- function(x) is.character(x) || is.factor(x)

as_text <- function(x) if (is.factor(x)) as.character(x) else x

is_dateish <- function(x) inherits(x, c("Date", "POSIXt"))

# Empty cells: NA, or text that is empty after trimming.
blank <- function(x) {
  b <- is.na(x)
  if (is_text(x)) b <- b | !nzchar(trim(as_text(x)))
  b
}

pct <- function(x, n) if (n == 0) NA_real_ else 100 * x / n

# "N/A (3), O (1)": the most frequent values with their counts.
top_values <- function(x, n = 5) {
  x <- x[!is.na(x)]
  if (!length(x)) return("")
  tab <- sort(table(x), decreasing = TRUE)
  shown <- utils::head(tab, n)
  out <- paste(sprintf("%s (%d)", show_value(names(shown)), as.integer(shown)), collapse = ", ")
  if (length(tab) > n) out <- sprintf("%s 외 %d가지", out, length(tab) - n)
  out
}

# Quote values whose edges are spaces so they stay visible in a table.
show_value <- function(v) {
  v <- as.character(v)
  edge <- !is.na(v) & (grepl(paste0("^", WS), v, perl = TRUE) | grepl(paste0(WS, "$"), v, perl = TRUE) | !nzchar(v))
  v[edge] <- sprintf("\"%s\"", v[edge])
  v
}

# "3, 7, 12 외 5행": row numbers for a table cell.
row_list <- function(idx, n = 5) {
  if (!length(idx)) return("")
  out <- paste(utils::head(idx, n), collapse = ", ")
  if (length(idx) > n) out <- sprintf("%s 외 %d행", out, length(idx) - n)
  out
}

label_chars <- function(x) max(c(0, nchar(as.character(x), type = "width")))

theme_rs <- function() ggplot2::theme_minimal()

# One row of the summary table. n = NA means the check was not run.
finding <- function(group, check, n, vars = character(), fix = "") {
  structure(list(group = group, check = check, n = as.integer(n), vars = unique(vars), fix = fix),
            class = "rsage_finding")
}

# Names made unique with ".1", ".2" suffixes. Unlike make.unique() this
# compares as == does, so the same name in two encodings counts as a duplicate.
unique_names <- function(n) {
  out <- n
  for (i in seq_along(n)[-1]) {
    j <- 0
    while (out[i] %in% out[seq_len(i - 1)]) {
      j <- j + 1
      out[i] <- paste0(n[i], ".", j)
    }
  }
  out
}
