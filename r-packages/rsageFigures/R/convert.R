# One call for the app and the assistant: find the figure, convert it,
# draw the conversion and check it. Nothing here writes to the user's
# session or files; the app shows the result and applies it only when the
# user approves.

#' Convert the figure that some R code draws to tidyplots
#'
#' @param code R code as text, usually a whole chunk.
#' @param options See [translate()].
#' @param envir Environment the code reads its data from (not modified).
#' @return list(kind, status, code, target, notes, kept, checks, plot,
#'   message). `status` is one of "rule", "partial", "mismatch" (converted
#'   but the check found differences), "ai", "unsupported", "already",
#'   "none" or "error". `target` gives the lines of `code` to replace.
convert <- function(code, options = list(), envir = globalenv()) {
  cap <- capture(code, envir)
  res <- list(kind = cap$kind, status = NULL, code = NULL, target = NULL, notes = character(), kept = character(), checks = NULL, plot = NULL, message = cap$message)
  res$status <- switch(cap$kind,
    ggplot = NULL, tidyplot = "already", base = "ai", lattice = "unsupported", none = "none", "error"
  )
  if (cap$kind == "base") res$notes <- "base R 그림은 어시스턴트가 tidyplots로 옮깁니다. 바꾼 뒤 눈으로 확인해 주세요."
  if (cap$kind == "lattice") res$notes <- "lattice 그림은 tidyplots로 옮기지 않습니다."
  if (!is.null(res$status)) return(res)
  if (!requireNamespace("tidyplots", quietly = TRUE)) {
    return(utils::modifyList(res, list(status = "error", message = "tidyplots 패키지가 설치되어 있지 않습니다.")))
  }

  tr <- translate(cap, options)
  res$target <- cap$target[c("first_line", "last_line", "assign")]
  res$notes <- tr$notes
  res$kept <- tr$kept
  res$status <- tr$status
  if (!tr$status %in% c("rule", "partial")) return(res)
  res$code <- tr$code

  after <- tryCatch(eval(parse(text = tr$code)[[1]], tidyplots_env(cap$env)), error = function(e) e)
  if (inherits(after, "error")) {
    return(utils::modifyList(res, list(status = "ai", message = conditionMessage(after))))
  }
  res$plot <- after
  cmp <- tryCatch(compare(cap$plot, after, tr$flip), error = function(e) e)
  if (inherits(cmp, "error")) {
    res$message <- conditionMessage(cmp)
    res$status <- "mismatch"
  } else {
    res$checks <- cmp$checks
    if (!cmp$ok) res$status <- "mismatch"
  }
  res
}

#' Check code someone else (the assistant) converted
#'
#' Runs both pieces of code the way [convert()] does and compares the figures.
#'
#' @return list(ok, checks, message, kind_before, kind_after).
check <- function(before, after, envir = globalenv()) {
  b <- capture(before, envir)
  a <- capture(after, if (requireNamespace("tidyplots", quietly = TRUE)) tidyplots_env(envir) else envir)
  res <- list(ok = FALSE, checks = NULL, message = NULL, kind_before = b$kind, kind_after = a$kind)
  if (a$kind == "error") return(utils::modifyList(res, list(message = a$message)))
  if (!a$kind %in% c("ggplot", "tidyplot")) return(utils::modifyList(res, list(message = "바꾼 코드가 그림을 만들지 않습니다.")))
  if (!b$kind %in% c("ggplot", "tidyplot")) {
    return(utils::modifyList(res, list(ok = TRUE, message = "원본이 ggplot이 아니어서 숫자 비교는 하지 않았습니다. 그림을 눈으로 확인해 주세요.")))
  }
  cmp <- compare(b$plot, a$plot)
  utils::modifyList(res, list(ok = cmp$ok, checks = cmp$checks))
}

#' convert() as JSON for the app
#'
#' @param plot_file When given and the conversion drew a figure, the figure
#'   is saved there as an .rds (for the plot pane) .
convert_json <- function(code, options = list(), envir = globalenv(), plot_file = NULL) {
  r <- convert(code, options, envir)
  if (!is.null(plot_file) && !is.null(r$plot)) saveRDS(r$plot, plot_file)
  r$plot <- NULL
  jsonlite::toJSON(r, auto_unbox = TRUE, null = "null", dataframe = "rows")
}
