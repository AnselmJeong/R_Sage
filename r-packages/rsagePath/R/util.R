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

num <- function(x, default) {
  x <- suppressWarnings(as.numeric(unlist(x)))
  if (!length(x) || is.na(x[1])) default else x[1]
}

note <- function(text, code, level = "warning") rsage::rs_note(text, level, code)

# Runs an expression, keeping warnings as text instead of letting them reach the console.
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

# Runs expr with a fixed seed and puts the caller's random state back.
with_seed <- function(seed, expr) {
  env <- globalenv()
  old <- if (exists(".Random.seed", envir = env, inherits = FALSE)) get(".Random.seed", envir = env) else NULL
  on.exit(if (is.null(old)) {
    if (exists(".Random.seed", envir = env, inherits = FALSE)) rm(".Random.seed", envir = env)
  } else assign(".Random.seed", old, envir = env))
  set.seed(seed)
  expr
}

fmt <- function(x, digits = 2) ifelse(is.na(x), "NA", formatC(x, digits = digits, format = "f"))

arrow_label <- function(from, to, type) ifelse(type == "regression", paste(from, "→", to), paste(from, "↔", to))

theme_rs <- function() ggplot2::theme_minimal()

# Korean particle after a word: 이/가, 을/를, 와/과 depending on a final consonant.
josa <- function(word, pair) {
  ch <- utf8ToInt(substring(word, nchar(word)))
  batchim <- if (ch >= 0xAC00 && ch <= 0xD7A3) (ch - 0xAC00) %% 28 != 0 else grepl("[0-9lmnLMN]$", word)
  paste0(word, if (batchim) pair[1] else pair[2])
}
