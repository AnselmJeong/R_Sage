# Reference values from airquality: Ozone has 37 NA, Solar.R 7, 153 rows, 111 complete.

table_of <- function(r, id) r$tables[[id]]$data

test_that("variable and case summaries match airquality", {
  r <- analyse(airquality, list(mcarTest = FALSE, plots = list(variables = FALSE, matrix = FALSE)))
  v <- table_of(r, "variables")
  expect_equal(v$n_miss[v$variable == "Ozone"], 37)
  expect_equal(v$n_miss[v$variable == "Solar.R"], 7)
  expect_equal(v$n_obs[v$variable == "Ozone"], 116)
  expect_equal(round(v$pct_miss[v$variable == "Ozone"], 2), 24.18)
  o <- table_of(r, "overview")
  expect_equal(o$value[o$measure == "완전한 행"], 111)
  expect_equal(o$value[o$measure == "결측 셀"], 44)
  cs <- table_of(r, "cases")
  expect_equal(cs$n_cases[cs$n_miss_in_case == 2], 2)
})

test_that("patterns count rows by missingness combination", {
  r <- analyse(airquality[c("Ozone", "Solar.R", "Wind")], list(mcarTest = FALSE, plots = list(variables = FALSE, matrix = FALSE)))
  p <- table_of(r, "patterns")
  expect_equal(sum(p$n_cases), 153)
  expect_equal(p$n_cases[1], 111)
  expect_equal(p$n_cases[p$Ozone == 0 & p$Solar.R == 0], 2)
})

test_that("Little's MCAR test uses naniar", {
  skip_if_not_installed("naniar")
  r <- analyse(airquality, list(plots = list(variables = FALSE, matrix = FALSE)))
  m <- table_of(r, "mcar")
  expect_equal(round(m$statistic, 1), 35.1)
  expect_equal(m$df, 14)
  expect_equal(r$data_info$backend, "naniar")
})

test_that("missing-value codes are replaced without touching the data", {
  d <- data.frame(a = c(1, -99, 3, NA), b = c("x", "", "y", "z"))
  r <- analyse(d, list(naValues = c("-99", ""), mcarTest = FALSE, plots = list(variables = FALSE, matrix = FALSE)))
  v <- table_of(r, "variables")
  expect_equal(v$n_miss[v$variable == "a"], 2)
  expect_equal(v$n_miss[v$variable == "b"], 1)
  expect_equal(r$data_info$naCodesReplaced, 2)
  expect_equal(d$a[2], -99)
})

test_that("a group variable splits the summary", {
  d <- airquality
  d$Month <- factor(d$Month)
  r <- analyse(d, list(variables = c("Ozone", "Solar.R"), group = "Month", mcarTest = FALSE, plots = list(variables = FALSE, matrix = FALSE)))
  v <- table_of(r, "variables")
  expect_equal(sum(v$n_miss[v$variable == "Ozone"]), 37)
  expect_true(all(c("group", "variable") %in% names(v)))
  expect_equal(nrow(v), 10)
})

test_that("unknown variables are an error", {
  expect_error(analyse(airquality, list(variables = "nope")), "nope")
})

test_that("mice imputation fills every missing value and can export the mids object", {
  skip_if_not_installed("mice")
  r <- analyse(airquality[1:4], list(impute = list(enabled = TRUE, m = 2, maxit = 2, saveAs = "imp_aq"),
                                     mcarTest = FALSE, plots = list(variables = FALSE, matrix = FALSE)))
  t <- table_of(r, "imputation")
  expect_equal(t$n_imputed[t$variable == "Ozone"], 37)
  expect_equal(t$method[t$variable == "Ozone"], "pmm")
  expect_s3_class(r$exports$imp_aq, "mids")
  expect_false(anyNA(mice::complete(r$exports$imp_aq, 1)))
})

test_that("plots are produced and the result writes to disk", {
  r <- analyse(airquality, list(plots = list(variables = TRUE, matrix = TRUE, upset = TRUE)))
  expect_true(all(c("variables", "matrix") %in% names(r$plots)))
  dir <- tempfile()
  rsage::rs_write(r, dir, "t1")
  j <- jsonlite::read_json(file.path(dir, "result.json"))
  for (p in j$plots) expect_true(file.exists(file.path(dir, p$file)))
})

test_that("without naniar the module falls back to its own summaries", {
  local_mocked_bindings(has = function(pkg) pkg != "naniar")
  r <- analyse(airquality, list(plots = list(variables = TRUE, matrix = TRUE)))
  expect_equal(r$data_info$backend, "mice")
  v <- table_of(r, "variables")
  expect_equal(v$n_miss[v$variable == "Ozone"], 37)
  expect_null(r$tables$mcar)
  codes <- vapply(r$notes, function(n) n$code %||% "", "")
  expect_true("naniar_missing" %in% codes)
  expect_true("mcar_needs_naniar" %in% codes)
  dir <- tempfile()
  rsage::rs_write(r, dir, "t2")
  expect_true(file.exists(file.path(dir, "result.json")))
})

test_that("plots by very many groups become a heat map sized to the groups", {
  d <- airquality
  d$site <- rep(sprintf("s%02d", 1:70), length.out = nrow(d))
  res <- analyse(d, list(group = "site", plots = list(matrix = FALSE)))
  p <- res$plots[[1]]
  expect_equal(p$id, "variables")
  expect_true(any(vapply(p$plot$layers, function(l) inherits(l$geom, "GeomTile"), TRUE)))
  expect_gt(p$width, 10)
  expect_lt(p$height, 5)
})

test_that("plots by groups stay small multiples on a grid sized to them", {
  skip_if_not_installed("naniar")
  res <- analyse(airquality, list(group = "Month", plots = list(matrix = FALSE)))
  p <- res$plots[[1]]
  expect_false(any(vapply(p$plot$layers, function(l) inherits(l$geom, "GeomTile"), TRUE)))
  expect_equal(p$plot$facet$params$ncol, 3)
  days <- analyse(airquality, list(group = "Day", plots = list(matrix = FALSE)))$plots[[1]]
  expect_equal(days$plot$facet$params$ncol, 6)
  expect_gte(days$width, 11)
  expect_gte(days$height, 9)
})

test_that("a user size from the app overrides the automatic one", {
  auto <- analyse(airquality, list())
  res <- rsage::rs_resize(auto, list(variables = list(width = 9, height = 3)))
  expect_equal(c(res$plots[[1]]$width, res$plots[[1]]$height), c(9, 3))
  expect_equal(res$plots[[1]]$auto, auto$plots[[1]]$auto)
  expect_equal(res$plots[[2]]$width, auto$plots[[2]]$width)
})
