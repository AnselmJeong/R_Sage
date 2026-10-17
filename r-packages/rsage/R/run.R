# The entry point the R Sage app calls in the user's live session. It reads a
# request written by the app, runs one module analysis on a global data
# frame, and writes result.json (or error.json). It never changes the data
# frame it reads.

rs_run <- function(path) {
  req <- jsonlite::read_json(path, simplifyVector = FALSE)
  out <- req$outDir
  dir.create(out, recursive = TRUE, showWarnings = FALSE)
  # A module that sets a seed must not change the user's random stream.
  seed <- if (exists(".Random.seed", envir = globalenv(), inherits = FALSE)) get(".Random.seed", envir = globalenv())
  on.exit({
    if (is.null(seed)) suppressWarnings(rm(".Random.seed", envir = globalenv()))
    else assign(".Random.seed", seed, envir = globalenv())
  }, add = TRUE)
  write_error <- function(msg, code = "error") {
    jsonlite::write_json(list(runId = req$runId, code = code, message = msg), file.path(out, "error.json"),
                         auto_unbox = TRUE)
  }
  tryCatch({
    if (!exists(req$dataset, envir = globalenv(), inherits = FALSE)) {
      return(invisible(write_error(sprintf("'%s' 객체가 R 세션에 없습니다.", req$dataset), "dataset_missing")))
    }
    data <- get(req$dataset, envir = globalenv(), inherits = FALSE)
    if (!is.data.frame(data)) {
      return(invisible(write_error(sprintf("'%s'는 데이터 프레임이 아닙니다.", req$dataset), "not_data_frame")))
    }
    fun <- getExportedValue(req$package, req$entrypoint)
    options <- normalize_json(req$options)
    used <- unique(c(unlist(options$variables), unlist(options$group)))
    used <- used[used %in% names(data)]
    snapshot <- file.path(out, "input.rds")
    saveRDS(if (length(used)) data[used] else data, snapshot)
    result <- withCallingHandlers(
      fun(data, options),
      warning = function(w) invokeRestart("muffleWarning")
    )
    result$data_info <- c(result$data_info, list(
      dataset = req$dataset,
      rows = nrow(data),
      columns = ncol(data),
      snapshotMd5 = unname(tools::md5sum(snapshot))
    ))
    for (n in names(result$exports)) assign(n, result$exports[[n]], envir = globalenv())
    rs_write(result, out, req$runId)
  }, error = function(e) write_error(conditionMessage(e)))
  invisible(NULL)
}

# JSON arrays of length 1 arrive as lists; turn arrays of scalars into vectors
# so modules can treat options like ordinary R arguments.
normalize_json <- function(x) {
  if (is.list(x)) {
    if (is.null(names(x)) && length(x) && all(vapply(x, function(v) is.atomic(v) && length(v) == 1, TRUE))) {
      return(unlist(x))
    }
    if (is.null(names(x)) && !length(x)) return(character())
    return(lapply(x, normalize_json))
  }
  x
}
