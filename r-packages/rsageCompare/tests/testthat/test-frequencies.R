tab <- function(r, id) r$tables[[id]]$data

test_that("crosstab counts, tests and effect sizes", {
  r <- analyse_frequencies(mtcars, list(rows = "am", columns = "cyl", cells = list(expected = TRUE)))
  ct <- tab(r, "crosstab")
  counts <- ct[ct$stat == "빈도" & ct$row != "합계", c("c1", "c2", "c3")]
  expect_equal(unname(as.matrix(counts)), unname(matrix(as.numeric(table(mtcars$am, mtcars$cyl)), 2)))
  t <- tab(r, "tests")
  expect_equal(t$statistic[1], unname(suppressWarnings(chisq.test(table(mtcars$am, mtcars$cyl)))$statistic))
  # Half the cells expect fewer than 5: Fisher is added automatically.
  expect_true(any(grepl("Fisher", t$test)))
  v <- tab(r, "effect")
  expect_equal(v$value[1], sqrt(t$statistic[1] / (32 * 1)), tolerance = 1e-8)
})

test_that("2x2 tables give the odds ratio", {
  r <- analyse_frequencies(mtcars, list(rows = "am", columns = "vs"))
  e <- tab(r, "effect")
  m <- table(mtcars$am, mtcars$vs)
  expect_equal(e$value[2], (m[1, 1] * m[2, 2]) / (m[1, 2] * m[2, 1]))
  expect_match(e$measure[2], "오즈비")
})

test_that("missing variables give a note", {
  r <- analyse_frequencies(mtcars, list(rows = "am"))
  expect_equal(r$notes[[1]]$code, "frequencies_needs_variables")
})
