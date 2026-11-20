test_that("rs_value reads a cell by first-column value or index", {
  r <- rs_result("t", "Test", tables = list(rs_table("v", "V", data.frame(variable = c("a", "b"), n = c(3, 5)))))
  expect_equal(rs_value(r, "v", "b", "n"), 5)
  expect_equal(rs_value(r, "v", 1, "n"), 3)
  expect_error(rs_value(r, "v", "z", "n"), "No row")
})

test_that("rs_merge_options fills nested defaults", {
  d <- list(a = TRUE, b = list(x = 1, y = 2), v = character())
  m <- rs_merge_options(list(b = list(y = 5), v = c("p", "q")), d)
  expect_equal(m, list(a = TRUE, b = list(x = 1, y = 5), v = c("p", "q")))
})

test_that("rs_write writes JSON without NaN or Inf and a plot file", {
  dir <- tempfile()
  p <- ggplot2::ggplot(data.frame(x = 1:3), ggplot2::aes(x, x)) + ggplot2::geom_point()
  r <- rs_result("t", "Test",
                 tables = list(rs_table("v", "V", data.frame(a = c(1, NaN, Inf), b = c("x", NA, "z")), labels = c(a = "값"))),
                 plots = list(rs_plot("p", "P", p, width = 3, height = 2)),
                 notes = list(rs_note("주의", "warning", "w")))
  rs_write(r, dir, "run1")
  j <- jsonlite::read_json(file.path(dir, "result.json"))
  expect_equal(j$runId, "run1")
  expect_equal(j$tables[[1]]$columns[[1]]$label, "값")
  expect_null(j$tables[[1]]$rows[[2]][[1]])
  expect_null(j$tables[[1]]$rows[[3]][[1]])
  expect_null(j$tables[[1]]$rows[[2]][[2]])
  expect_true(file.exists(file.path(dir, j$plots[[1]]$file)))
  expect_equal(j$notes[[1]]$code, "w")
  expect_false(file.exists(file.path(dir, "result.json.tmp")))
})

test_that("knit_print renders tables as pipe tables and plots as image links", {
  dir <- tempfile()
  p <- ggplot2::ggplot(data.frame(x = 1:3), ggplot2::aes(x, x)) + ggplot2::geom_point()
  r <- rs_result("t", "Test", tables = list(rs_table("v", "변수", data.frame(a = 1.23456))),
                 plots = list(rs_plot("p", "그림", p, width = 3, height = 2)))
  out <- knitr::knit_print(r, options = list(label = "miss", fig.path = paste0(dir, "/")))
  expect_s3_class(out, "knit_asis")
  expect_match(out, ': 변수 {tbl-colwidths="false"}', fixed = TRUE)
  expect_match(out, "| 1.235 |", fixed = TRUE)
  expect_match(out, "|--:|", fixed = TRUE)
  expect_match(out, "![그림](", fixed = TRUE)
  expect_true(file.exists(file.path(dir, "miss-p.png")))
})

test_that("rs_run runs a module function on a global data frame", {
  out <- tempfile()
  assign(".rsage_test_df", data.frame(x = c(1, NA, 3)), envir = globalenv())
  on.exit(rm(".rsage_test_df", envir = globalenv()))
  fake <- function(data, options) rs_result("fake", "Fake", tables = list(rs_table("n", "N", data.frame(n = sum(is.na(data$x))))),
                                            options = options, exports = if (isTRUE(options$export)) list(.rsage_exported = 42))
  ns <- asNamespace("rsage")
  req <- tempfile(fileext = ".json")
  jsonlite::write_json(list(runId = "r1", package = "rsage", entrypoint = "rs_test_fake", dataset = ".rsage_test_df",
                            options = list(variables = list("x"), export = TRUE), outDir = out), req, auto_unbox = TRUE)
  # Temporarily expose the fake entry point.
  local_mocked_bindings(getExportedValue = function(pkg, name) fake, .package = "base")
  rsage:::rs_run(req)
  j <- jsonlite::read_json(file.path(out, "result.json"))
  expect_equal(j$tables[[1]]$rows[[1]][[1]], 1)
  expect_equal(j$dataInfo$dataset, ".rsage_test_df")
  expect_true(file.exists(file.path(out, "input.rds")))
  expect_equal(get(".rsage_exported", envir = globalenv()), 42)
  rm(".rsage_exported", envir = globalenv())
})

test_that("rs_run reports a missing data set", {
  out <- tempfile()
  req <- tempfile(fileext = ".json")
  jsonlite::write_json(list(runId = "r2", package = "rsage", entrypoint = "x", dataset = "no_such_df", options = list(), outDir = out), req, auto_unbox = TRUE)
  rsage:::rs_run(req)
  j <- jsonlite::read_json(file.path(out, "error.json"))
  expect_equal(j$code, "dataset_missing")
})

test_that("rs_figure_size grows with content and flags what will not fit", {
  one <- rs_figure_size()
  many_rows <- rs_figure_size(y_items = 30, label_chars = 12)
  expect_gt(many_rows$height, one$height)
  expect_gt(many_rows$width, one$width)
  grid <- rs_figure_size(panels = 5)
  expect_equal(c(grid$ncol, grid$nrow), c(3, 2))
  expect_false(grid$compact)
  days <- rs_figure_size(panels = 31, y_items = 4, label_chars = 7)
  expect_false(days$compact)
  expect_equal(days$ncol, 6)
  expect_true(rs_figure_size(panels = 80, y_items = 4)$compact)
  big <- rs_figure_size(x_items = 200)
  expect_lte(big$width, 12)
  expect_true(big$compact)
})

test_that("hints with suggestions are written, printed and keep their plot off the sections", {
  p <- rs_plot("card", "카드 그림", ggplot2::ggplot(mtcars, ggplot2::aes(wt, mpg)) + ggplot2::geom_point())
  q <- rs_plot("other", "다른 그림", ggplot2::ggplot(mtcars, ggplot2::aes(hp)) + ggplot2::geom_histogram(bins = 10))
  h <- rs_hint("h1", "무게와 연비", "함께 움직입니다.", evidence = "ρ = -0.89", kind = "association",
               variables = c("wt", "mpg"), plot = "card",
               suggestions = list(rs_suggest("선형 회귀 열기", "org.rsage.regression/regression",
                                             list(predictors = list(continuous = I("wt")))),
                                  rs_suggest("예정", "org.rsage.anova/anova")))
  res <- rs_result("x", "X", plots = list(p, q), hints = list(h))
  expect_equal(unname(vapply(result_sections(res)[[1]]$plots, `[[`, "", "id")), "other")
  expect_output(print(res), "무게와 연비")
  dir <- tempfile()
  rs_write(res, dir)
  j <- jsonlite::read_json(file.path(dir, "result.json"))
  expect_equal(j$hints[[1]]$plot, "card")
  expect_equal(j$hints[[1]]$variables, list("wt", "mpg"))
  # A one-element array stays an array; empty options stay an object.
  expect_equal(j$hints[[1]]$suggestions[[1]]$options$predictors$continuous, list("wt"))
  expect_match(paste(readLines(file.path(dir, "result.json"), warn = FALSE), collapse = ""), '"options":\\{\\}')
})

test_that("numbers are formatted like the analysis tab", {
  expect_equal(format_cell(c(8.23e-26, 9.05e-8, -0.00014, 0.004213, 13.1449, 123.456, 133, 0, NA, Inf)),
               c("8.23e-26", "9.05e-8", "-1.40e-4", "0.004", "13.145", "123.5", "133", "0", "", ""))
  expect_equal(format_cell(c(TRUE, FALSE, NA)), c("예", "아니오", ""))
  expect_equal(format_cell(factor(c("a", NA))), c("a", ""))
})

test_that("a split table is shown as one table per value, without the split column", {
  d <- data.frame(model = c("주 모형", "주 모형", "보조 모형"), term = c("a", "b", "a"), p = c(1e-10, 0.5, 0.02))
  t <- rs_table("coef", "회귀계수", d, labels = c(model = "모형", term = "항"), split = "model")
  parts <- table_parts(t)
  expect_equal(vapply(parts, `[[`, "", "title"), c("회귀계수 · 주 모형", "회귀계수 · 보조 모형"))
  expect_equal(names(parts[[1]]$data), c("항", "p"))
  expect_equal(parts[[1]]$data$p, c("1.00e-10", "0.500"))
  r <- rs_result("t", "Test", tables = list(t))
  out <- knitr::knit_print(r)
  expect_match(out, ": 회귀계수 · 보조 모형", fixed = TRUE)
  expect_false(grepl("모형 |", out, fixed = TRUE))
  # One value: the plain title.
  one <- table_parts(rs_table("coef", "회귀계수", d[1:2, ], split = "model"))
  expect_equal(length(one), 1)
  expect_equal(one[[1]]$title, "회귀계수")
  # The data keep the column for rs_value() and the app.
  expect_equal(rs_value(r, "coef", 3, "model"), "보조 모형")
  dir <- tempfile()
  rs_write(r, dir)
  expect_equal(jsonlite::read_json(file.path(dir, "result.json"))$tables[[1]]$split, "model")
})
