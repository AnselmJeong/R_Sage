sim <- function(n = 300, seed = 11) {
  set.seed(seed)
  d <- data.frame(age = rnorm(n))
  d$x <- 0.5 * d$age + rnorm(n)
  d$m <- 0.6 * d$x + rnorm(n)
  d$y <- 0.5 * d$m + 0.3 * d$x + 0.4 * d$age + rnorm(n)
  d$z <- 0.5 * d$x + 0.5 * d$y + rnorm(n)
  d
}
TIERS <- list(background = "age", early = "x", middle = "m", outcome = "y")
codes <- function(r) vapply(r$notes, function(n) n$code %||% "", "")
`%||%` <- function(a, b) if (is.null(a)) b else a
tab <- function(r, id) r$tables[[which(vapply(r$tables, function(t) t$id, "") == id)]]$data
fast <- list(estimation = list(bootstrap = 200L), structure = list(bootstrap = 100L))

test_that("learning finds the planted links and never points backwards", {
  skip_if_not_installed("bnlearn")
  r <- analyse(sim(), modifyList(fast, list(variables = TIERS)))
  st <- tab(r, "stability")
  adopted <- st[st$adopted == "채택", ]
  keys <- paste(adopted$from, adopted$to)
  expect_true(all(c("age x", "x m", "m y", "x y", "age y") %in% keys))
  tiers <- c(age = 1, x = 2, m = 3, y = 4)
  expect_true(all(tiers[st$from] <= tiers[st$to]))
  expect_true("path_exploratory" %in% codes(r))
})

test_that("specified mediation: indirect = a*b and total = direct + indirect", {
  d <- sim()
  paths <- list(list(from = "x", to = "m", type = "regression"), list(from = "m", to = "y", type = "regression"),
                list(from = "x", to = "y", type = "regression"))
  r <- analyse(d, list(structure = list(source = "specified"), paths = paths, focus = list(exposure = "x", outcome = "y"),
                       estimation = list(bootstrap = 200L, scale = "raw")))
  e <- tab(r, "effects")
  fit <- lavaan::sem("m ~ x\ny ~ m + x", data = d)
  pe <- lavaan::parameterEstimates(fit)
  a <- pe$est[pe$lhs == "m" & pe$rhs == "x"]
  b <- pe$est[pe$lhs == "y" & pe$rhs == "m"]
  c1 <- pe$est[pe$lhs == "y" & pe$rhs == "x"]
  expect_equal(e$est[e$component == "x → m → y"], a * b, tolerance = 1e-6)
  expect_equal(e$est[e$component == "직접효과"], c1, tolerance = 1e-6)
  expect_equal(e$est[e$component == "총효과"], c1 + a * b, tolerance = 1e-6)
  ind <- e[e$component == "x → m → y", ]
  expect_true(ind$ci.lower > 0 && ind$ci.upper > ind$ci.lower)
  expect_false("path_exploratory" %in% codes(r))
})

test_that("covariate roles and adjustment sets follow the graph", {
  d <- sim()
  paths <- list(list(from = "age", to = "x"), list(from = "age", to = "y"), list(from = "x", to = "m"),
                list(from = "m", to = "y"), list(from = "x", to = "y"), list(from = "x", to = "z"), list(from = "y", to = "z"))
  r <- analyse(d, list(structure = list(source = "specified"), paths = paths, focus = list(exposure = "x", outcome = "y"),
                       estimation = list(inference = "standard")))
  roles <- tab(r, "roles")
  role <- setNames(roles$role, roles$variable)
  expect_equal(role[["age"]], "교란변수")
  expect_equal(role[["m"]], "매개변수")
  expect_match(role[["z"]], "충돌변수")
  adj <- tab(r, "adjustment")
  expect_equal(adj$set[adj$effect == "총효과"][1], "age")
  hint <- Filter(function(h) h$id == "covariates", r$hints)[[1]]
  s <- hint$suggestions[[1]]
  expect_equal(s$analysis, "org.rsage.regression/regression")
  expect_equal(s$options$outcome$variable, "y")
  expect_setequal(as.character(s$options$predictors$continuous), c("x", "age"))
})

test_that("without dagitty the parents of the exposure are the adjustment set", {
  local_mocked_bindings(has = function(pkg) pkg != "dagitty" && requireNamespace(pkg, quietly = TRUE))
  paths <- list(list(from = "age", to = "x"), list(from = "age", to = "y"), list(from = "x", to = "y"))
  r <- analyse(sim(), list(structure = list(source = "specified"), paths = paths, focus = list(exposure = "x", outcome = "y"),
                           estimation = list(inference = "standard")))
  adj <- tab(r, "adjustment")
  expect_equal(adj$set[adj$effect == "총효과"], "age")
})

test_that("without bnlearn the saturated model is used and said so", {
  local_mocked_bindings(has = function(pkg) pkg != "bnlearn" && requireNamespace(pkg, quietly = TRUE))
  r <- analyse(sim(), modifyList(fast, list(variables = TIERS)))
  expect_true("path_backend_missing" %in% codes(r))
  expect_equal(nrow(tab(r, "coefficients")[tab(r, "coefficients")$kind == "경로", ]), 6)
  expect_true("path_saturated" %in% codes(r))
})

test_that("bayes without blavaan falls back to ML with a note", {
  local_mocked_bindings(has = function(pkg) pkg != "blavaan" && requireNamespace(pkg, quietly = TRUE))
  r <- analyse(sim(), list(variables = TIERS, structure = list(source = "saturated"), estimation = list(method = "bayes", inference = "standard")))
  expect_true("path_backend_missing" %in% codes(r))
  expect_true(any(tab(r, "coefficients")$kind == "경로"))
})

test_that("required and forbidden links shape the learned graph", {
  skip_if_not_installed("bnlearn")
  o <- modifyList(fast, list(variables = TIERS))
  o$structure$required <- list(list(from = "age", to = "m"))
  o$structure$forbidden <- list(list(from = "x", to = "y"))
  r <- analyse(sim(), o)
  st <- tab(r, "stability")
  keys <- paste(st$from, st$to)[st$adopted == "채택"]
  expect_true("age m" %in% keys)
  expect_false("x y" %in% paste(st$from, st$to))
  bad <- modifyList(fast, list(variables = TIERS))
  bad$structure$required <- list(list(from = "y", to = "x"))
  expect_true("path_invalid_paths" %in% codes(analyse(sim(), bad)))
})

test_that("pc.stable with a strict alpha runs", {
  skip_if_not_installed("bnlearn")
  r <- analyse(sim(), modifyList(fast, list(variables = TIERS, structure = list(algorithm = "pc", alpha = 0.01))))
  expect_true(any(tab(r, "stability")$adopted == "채택"))
})

test_that("categories are recoded or dropped, small samples are flagged", {
  d <- sim(40)
  d$sex <- factor(sample(c("F", "M"), 40, TRUE))
  d$grp <- factor(sample(c("a", "b", "c"), 40, TRUE))
  r <- analyse(d, list(variables = list(background = c("age", "sex", "grp"), early = "x", middle = "m", outcome = "y"),
                       structure = list(source = "saturated"), estimation = list(inference = "standard")))
  expect_true(all(c("path_recoded", "path_dropped_variable", "path_small_sample") %in% codes(r)))
})

test_that("FIML keeps rows with missing values", {
  d <- sim()
  d$m[1:30] <- NA
  r <- analyse(d, list(variables = TIERS, structure = list(source = "saturated"),
                       estimation = list(missing = "fiml", inference = "standard")))
  s <- tab(r, "sample")
  expect_equal(s$n[s$item == "추정에 쓴 행"], 300)
})

test_that("no route and missing inputs are notes, not errors", {
  r <- analyse(sim(), list(structure = list(source = "specified"), paths = list(list(from = "x", to = "m")),
                           focus = list(exposure = "m", outcome = "x"), estimation = list(inference = "standard")))
  expect_true("path_no_route" %in% codes(r))
  expect_true("path_need_variables" %in% codes(analyse(sim(), list())))
  expect_error(analyse(sim(), list(variables = list(early = "nope"))), "데이터에 없는 변수")
})

test_that("diagram and stability plots are drawn, with Korean names", {
  skip_if_not_installed("bnlearn")
  d <- sim(120)
  names(d) <- c("나이", "운동", "체중", "혈압", "기타")
  r <- analyse(d, modifyList(fast, list(variables = list(background = "나이", early = "운동", middle = "체중", outcome = "혈압"),
                                        focus = list(exposure = "운동", outcome = "혈압"))))
  ids <- vapply(r$plots, function(p) p$id, "")
  expect_true(all(c("diagram", "stability", "effects") %in% ids))
  f <- tempfile(fileext = ".png")
  for (p in r$plots) {
    ggplot2::ggsave(f, p$plot, width = p$width, height = p$height, device = if (requireNamespace("ragg", quietly = TRUE)) ragg::agg_png else "png")
    expect_true(file.size(f) > 1000)
  }
})

test_that("the tidySEM layout is a grid of names with short tiers centred", {
  lay <- node_layout(c("a", "b", "c", "d"), c(a = 1, b = 2, c = 2, d = 3))
  m <- layout_grid(lay, c(a = "a", b = "b", c = "v3", d = "d"))
  expect_equal(dim(m), c(3, 3))
  expect_equal(m[, 1], c(NA, "a", NA))
  expect_equal(m[, 2], c("b", NA, "v3"))
  skip_if_not_installed("tidySEM")
  expect_no_error(do.call(tidySEM::get_layout, c(as.list(as.vector(t(m))), list(rows = 3))))
})

test_that("split-sample: structure from one part, estimates from the other", {
  skip_if_not_installed("bnlearn")
  r <- analyse(sim(), modifyList(fast, list(variables = TIERS, confirm = list(enabled = TRUE, fraction = "0.5"))))
  s <- tab(r, "sample")
  expect_equal(s$n[grepl("^구조 찾기", s$item)], 150)
  expect_equal(s$n[s$item == "추정에 쓴 행 (확인용)"], 150)
  expect_match(r$notes[[which(codes(r) == "path_exploratory")]]$text, "확인용 행")
  expect_equal(r$data_info$n, 150)
  # The rows are the same on every run with the same seed.
  r2 <- analyse(sim(), modifyList(fast, list(variables = TIERS, confirm = list(enabled = TRUE))))
  expect_equal(tab(r, "coefficients")$est, tab(r2, "coefficients")$est)
  # Too few rows to split: a note, and no split.
  small <- analyse(sim(15), modifyList(fast, list(variables = TIERS, confirm = list(enabled = TRUE))))
  expect_true("path_split_too_small" %in% codes(small))
})

test_that("the found structure opens as an editable path list with the same split", {
  skip_if_not_installed("bnlearn")
  o <- modifyList(fast, list(variables = TIERS, focus = list(exposure = "x", outcome = "y"), confirm = list(enabled = TRUE)))
  r <- analyse(sim(), o)
  h <- Filter(function(h) h$id == "structure", r$hints)[[1]]
  s <- h$suggestions[[1]]
  expect_equal(s$analysis, "org.rsage.path/path")
  expect_equal(s$options$structure$source, "specified")
  expect_true(s$options$confirm$enabled)
  keys <- vapply(s$options$paths, function(p) paste(p$from, p$to), "")
  st <- tab(r, "stability")
  expect_setequal(keys, paste(st$from, st$to)[st$adopted == "채택"])
  # Running the suggestion re-estimates the same graph on the same held-out rows.
  r2 <- analyse(sim(), s$options)
  expect_equal(sort(tab(r2, "coefficients")$est), sort(tab(r, "coefficients")$est), tolerance = 1e-8)
  expect_true("path_split" %in% codes(r2))
  expect_equal(jsonlite::fromJSON(jsonlite::toJSON(s$options$variables, auto_unbox = TRUE), simplifyVector = FALSE)$outcome, list("y"))
})
