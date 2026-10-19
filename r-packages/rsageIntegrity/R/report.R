# dlookr's diagnosis report (an HTML file). It runs in a separate R process:
# rendering attaches dlookr, which downloads Google fonts and turns on
# showtext for every later plot, and neither should happen to the user's
# session.

find_pandoc <- function() {
  if (nzchar(Sys.getenv("RSTUDIO_PANDOC"))) return(Sys.getenv("RSTUDIO_PANDOC"))
  if (nzchar(Sys.which("pandoc"))) return(dirname(Sys.which("pandoc")))
  quarto <- Sys.which("quarto")
  dirs <- c(if (nzchar(quarto)) file.path(dirname(normalizePath(quarto)), "tools", c("aarch64", "x86_64", "")),
            file.path("/Applications/quarto/bin/tools", c("aarch64", "x86_64")),
            "/Applications/RStudio.app/Contents/Resources/app/quarto/bin/tools/aarch64",
            "/Applications/RStudio.app/Contents/Resources/app/quarto/bin/tools/x86_64",
            "/Applications/Positron.app/Contents/Resources/app/quarto/bin/tools/aarch64",
            "/opt/homebrew/bin", "/usr/local/bin")
  for (d in dirs) if (file.exists(file.path(d, "pandoc"))) return(d)
  ""
}

diagnosis_report <- function(d, r) {
  if (!has("rmarkdown")) {
    return(rsage::rs_note("진단 보고서를 만들려면 rmarkdown 패키지가 필요합니다.", "warning", "report_needs_rmarkdown"))
  }
  pandoc <- find_pandoc()
  if (!nzchar(pandoc)) {
    return(rsage::rs_note("pandoc을 찾지 못해 진단 보고서를 만들지 못했습니다. Quarto를 설치하면 함께 설치됩니다.", "warning", "report_needs_pandoc"))
  }
  file <- as.character(r$file %||% "")
  if (!nzchar(file)) file <- "data-diagnosis.html"
  if (!grepl("\\.html?$", file, ignore.case = TRUE)) file <- paste0(file, ".html")
  path <- file.path(normalizePath(dirname(file), mustWork = FALSE), basename(file))
  dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
  tmp <- tempfile("rsage-report-")
  dir.create(tmp)
  on.exit(unlink(tmp, recursive = TRUE), add = TRUE)
  saveRDS(as.data.frame(d), file.path(tmp, "data.rds"))
  fun <- if (identical(r$format, "paged")) "diagnose_paged_report" else "diagnose_web_report"
  extra <- if (identical(r$format, "paged")) ", output_format = \"html\"" else ""
  script <- sprintf(
    'Sys.setenv(RSTUDIO_PANDOC = %s)
     d <- readRDS(%s)
     dlookr::%s(d, output_dir = %s, output_file = %s, browse = FALSE, title = "데이터 진단 보고서", subtitle = %s, author = "R Sage"%s)',
    deparse(pandoc), deparse(file.path(tmp, "data.rds")), fun, deparse(tmp), deparse("report.html"),
    deparse(sub("\\.html?$", "", basename(file), ignore.case = TRUE)), extra)
  writeLines(script, file.path(tmp, "make.R"), useBytes = TRUE)
  log <- suppressWarnings(system2(file.path(R.home("bin"), "Rscript"), shQuote(file.path(tmp, "make.R")),
                                  stdout = TRUE, stderr = TRUE, timeout = 600))
  made <- file.path(tmp, "report.html")
  if (!file.exists(made)) {
    return(rsage::rs_note(sprintf("진단 보고서를 만들지 못했습니다: %s", paste(utils::tail(log, 3), collapse = " ")), "warning", "report_failed"))
  }
  file.copy(made, path, overwrite = TRUE)
  rsage::rs_note(sprintf("dlookr 진단 보고서를 %s에 저장했습니다.", path), code = "report_saved", file = path)
}
