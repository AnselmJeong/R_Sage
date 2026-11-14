cards <- function(r) vapply(r$hints, `[[`, "", "title")
main <- function(r) {
  h <- Filter(function(h) identical(h$kind, "main"), r$hints)
  if (length(h)) h[[1]]$suggestions[[1]] else NULL
}

test_that("two groups get a Welch t test, three a Welch ANOVA", {
  r <- analyse(mtcars, list(outcomes = "mpg", groups = "am"))
  s <- main(r)
  expect_equal(s$analysis, "org.rsage.compare/ttests")
  expect_equal(s$options$group, "am")
  expect_true(s$options$tests$welch)
  expect_false(s$options$tests$nonparametric)
  a <- main(analyse(PlantGrowth, list(outcomes = "weight", groups = "group")))
  expect_equal(a$analysis, "org.rsage.compare/anova")
  expect_true(a$options$posthoc$gamesHowell)
  expect_true(all(c("question", "variables", "groups", "rules", "plan") %in% names(analyse(PlantGrowth, list(outcomes = "weight", groups = "group"))$tables)))
})

test_that("skewed small groups add the rank test", {
  set.seed(2)
  d <- data.frame(g = rep(c("a", "b", "c"), c(8, 8, 9)), y = c(rexp(8), rexp(8) * 3, rexp(9) * 2))
  s <- main(analyse(d, list(outcomes = "y", groups = "g")))
  expect_true(s$options$tests$kruskal)
  expect_true(s$options$posthoc$dunn)
})

test_that("pre/post columns are paired; an ID that repeats is repeated measures", {
  set.seed(1)
  w <- data.frame(score_pre = rnorm(20, 10), score_post = rnorm(20, 11))
  s <- main(analyse(w, list(outcomes = c("score_pre", "score_post"))))
  expect_equal(s$options$test, "paired")
  expect_equal(s$options$pairs[[1]], list(first = "score_pre", second = "score_post"))
  d <- data.frame(id = rep(1:15, each = 2), time = rep(c("pre", "post"), 15), y = rnorm(30))
  r <- analyse(d, list(outcomes = "y", groups = "time", id = "id"))
  expect_null(main(r))
  expect_true(any(vapply(r$hints, function(h) identical(h$kind, "planned"), TRUE)))
  expect_true("check-independence" %in% vapply(r$hints, `[[`, "", "id"))
})

test_that("categorical outcomes get a crosstab; predictors a regression with the right family", {
  s <- main(analyse(mtcars, list(outcomes = "am", groups = "cyl")))
  expect_equal(s$analysis, "org.rsage.compare/frequencies")
  expect_equal(c(s$options$rows, s$options$columns), c("cyl", "am"))
  r <- analyse(mtcars, list(outcomes = "vs", groups = c("wt", "hp", "disp", "drat"), goal = "predict"))
  s <- main(r)
  expect_equal(s$options$model$family, "binomial")
  expect_true("check-epv" %in% vapply(r$hints, `[[`, "", "id"))
  s2 <- main(analyse(mtcars, list(outcomes = "mpg", groups = c("wt", "hp"))))
  expect_equal(s2$options$model$family, "gaussian")
  expect_equal(as.character(s2$options$predictors$continuous), c("wt", "hp"))
})

test_that("two factors give a two-way ANOVA; doses with few values count as levels", {
  s <- main(analyse(ToothGrowth, list(outcomes = "len", groups = c("supp", "dose"))))
  expect_equal(s$analysis, "org.rsage.compare/anova")
  expect_equal(as.character(s$options$factors), c("supp", "dose"))
})

test_that("missing rows and empty roles give cards, and the plan is the same twice", {
  r <- analyse(airquality, list(outcomes = "Ozone", groups = "Month"))
  expect_true("check-missing" %in% vapply(r$hints, `[[`, "", "id"))
  expect_equal(analyse(mtcars, list())$hints[[1]]$id, "ask")
  a <- analyse(airquality, list(outcomes = "Ozone", groups = "Month"))
  expect_identical(cards(a), cards(r))
  expect_error(analyse(mtcars, list(outcomes = "nope")), "nope")
})

test_that("every main suggestion runs in the compare module", {
  skip_if_not_installed("rsageCompare")
  for (case in list(list(mtcars, list(outcomes = "mpg", groups = "am")), list(PlantGrowth, list(outcomes = "weight", groups = "group")),
                    list(mtcars, list(outcomes = "am", groups = "cyl")))) {
    s <- main(analyse(case[[1]], case[[2]]))
    fn <- getExportedValue("rsageCompare", paste0("analyse_", sub(".*/", "", s$analysis)))
    res <- fn(case[[1]], s$options)
    expect_true(length(res$tables) > 0)
  }
})
