# Reference values from docs/modules/regression.md §13 (base R fits).

table_of <- function(r, id) r$tables[[which(vapply(r$tables, function(t) t$id, "") == id)]]$data
ids <- function(r) unname(vapply(r$tables, function(t) t$id, ""))
codes <- function(r) vapply(r$notes, function(n) n$code, "")

test_that("a linear model matches lm", {
  r <- analyse(mtcars, list(outcome = list(variable = "mpg"), predictors = list(continuous = c("wt", "hp"))))
  co <- table_of(r, "coefficients")
  expect_equal(co$estimate[co$parameter == "절편"], 37.227270, tolerance = 1e-6)
  fit <- table_of(r, "modelFit")
  expect_equal(fit$r2, 0.8267855, tolerance = 1e-6)
  expect_true("regression_auto_terms" %in% codes(r))
})

test_that("nested linear models are compared with an F test", {
  r <- analyse(mtcars, list(outcome = list(variable = "mpg"), predictors = list(continuous = c("wt", "hp")),
    terms = list(list(id = "a", kind = "main", variable = "wt"), list(id = "b", kind = "main", variable = "hp")),
    models = list(list(id = "m1", label = "M1", termIds = list("a")), list(id = "m2", label = "M2", termIds = list("a", "b"))),
    comparison = list(enabled = TRUE)))
  fit <- table_of(r, "modelFit")
  expect_equal(fit$r2[1], 0.752833, tolerance = 1e-6)
  expect_equal(fit$aic[1], 166.0294, tolerance = 1e-4)
  tt <- table_of(r, "modelTests")
  expect_equal(tt$test, "F")
  expect_equal(tt$statistic, 12.38133, tolerance = 1e-5)
  expect_equal(tt$p, 0.0014512, tolerance = 1e-4)
})

test_that("a logistic model matches glm and gives odds ratios", {
  r <- analyse(mtcars, list(outcome = list(variable = "am"), predictors = list(continuous = c("wt", "hp")),
                            model = list(family = "binomial")))
  co <- table_of(r, "coefficients")
  expect_equal(co$estimate[co$parameter == "절편"], 18.8663, tolerance = 1e-4)
  expect_equal(co$estimate[co$parameter == "wt"], -8.0835, tolerance = 1e-4)
  expect_equal(co$exp_kind[1], "OR")
  expect_equal(table_of(r, "modelFit")$deviance, 10.0591, tolerance = 1e-4)
})

test_that("a Poisson model matches glm", {
  r <- analyse(warpbreaks, list(outcome = list(variable = "breaks"), predictors = list(categorical = c("wool", "tension")),
                                model = list(family = "poisson")))
  co <- table_of(r, "coefficients")
  expect_equal(co$estimate[co$parameter == "절편"], 3.69196, tolerance = 1e-5)
  expect_equal(co$estimate[co$parameter == "wool[B]"], -0.20599, tolerance = 1e-4)
  expect_equal(table_of(r, "modelFit")$aic, 493.056, tolerance = 1e-3)
})

test_that("stepwise selection matches MASS::stepAIC", {
  r <- analyse(mtcars, list(outcome = list(variable = "mpg"), predictors = list(continuous = c("wt", "hp", "disp", "qsec")),
                            selection = list(method = "stepwise")))
  expect_setequal(table_of(r, "selectedTerms")$term, c("wt", "hp"))
  expect_true("regression_post_selection" %in% codes(r))
})

test_that("a two-valued outcome without 0/1 needs an event", {
  d <- data.frame(y = rep(c("예", "아니오"), 10), x = 1:20)
  r <- analyse(d, list(outcome = list(variable = "y"), predictors = list(continuous = "x"), model = list(family = "binomial")))
  expect_true("regression_event_required" %in% codes(r))
  expect_length(r$tables, 0)
})

test_that("an interaction without its main effects is refused", {
  r <- analyse(mtcars, list(outcome = list(variable = "mpg"), predictors = list(continuous = c("wt", "hp")),
    terms = list(list(id = "a", kind = "main", variable = "wt"), list(id = "b", kind = "main", variable = "hp"),
                 list(id = "ab", kind = "interaction", components = list("a", "b"))),
    models = list(list(id = "m1", label = "M", termIds = list("a", "ab")))))
  expect_true("regression_invalid_term" %in% codes(r))
})

test_that("column names with spaces and Korean are used as data, not code", {
  d <- data.frame(`결과 값` = mtcars$mpg, `무게 (t)` = mtcars$wt, `system("x")` = mtcars$hp, check.names = FALSE)
  r <- analyse(d, list(outcome = list(variable = "결과 값"), predictors = list(continuous = c("무게 (t)", "system(\"x\")"))))
  co <- table_of(r, "coefficients")
  expect_true(all(c("무게 (t)", "system(\"x\")") %in% co$parameter))
  expect_equal(co$estimate[co$parameter == "절편"], 37.227270, tolerance = 1e-6)
})

test_that("an exposure enters as log offset", {
  set.seed(1)
  d <- data.frame(n = rpois(50, 3), x = rnorm(50), t = runif(50, 1, 5))
  r <- analyse(d, list(outcome = list(variable = "n"), predictors = list(continuous = "x"), model = list(family = "poisson"),
                       offset = list(mode = "exposure", variable = "t")))
  ref <- stats::glm(n ~ x + offset(log(t)), poisson, d)
  co <- table_of(r, "coefficients")
  expect_equal(co$estimate, unname(stats::coef(ref)), tolerance = 1e-6)
})

test_that("separation is reported", {
  d <- data.frame(y = c(0, 0, 0, 0, 1, 1, 1, 1), x = 1:8)
  r <- analyse(d, list(outcome = list(variable = "y"), predictors = list(continuous = "x"), model = list(family = "binomial")))
  expect_true("regression_separation" %in% codes(r))
})
