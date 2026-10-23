# A table with one planted signal of each kind, and a table of independent
# noise that should raise none.

planted <- function(n = 200) {
  set.seed(1)
  d <- data.frame(id = seq_len(n), sex = sample(c("M", "F"), n, TRUE), stringsAsFactors = FALSE)
  d$age <- round(stats::rnorm(n, 45, 12))
  for (i in 1:6) d[[paste0("phq", i)]] <- pmin(3, pmax(0, round(stats::rnorm(n, 1.2, 1) + (d$age - 45) / 30)))
  d$phq_total <- rowSums(d[paste0("phq", 1:6)])
  d$income <- stats::rexp(n, 1 / 3000)
  d$visits <- stats::rpois(n, 0.4)
  d$score <- 0.5 * d$age + ifelse(d$sex == "M", 6, 0) + stats::rnorm(n, 0, 4)
  d$score2 <- d$score * 2 + stats::rnorm(n, 0, 0.1)
  d$hamd_pre <- stats::rnorm(n, 20, 4)
  d$hamd_post <- d$hamd_pre - 5 + stats::rnorm(n, 0, 3)
  d$crp <- exp(stats::rnorm(n))
  d$crp[d$age > 55] <- NA
  d$weight <- stats::rnorm(n, 70, 10)
  d$weight[1:3] <- -99
  d
}

kinds_of <- function(res) vapply(res$hints, `[[`, "", "kind")
signals <- function(res) res$tables$signals$data

test_that("profile guesses the kind of each variable", {
  p <- profile_vars(planted())
  expect_equal(p$kind[["id"]], "id")
  expect_equal(p$kind[["sex"]], "binary")
  expect_equal(p$kind[["phq1"]], "ordinal")
  expect_equal(p$kind[["income"]], "continuous")
  expect_equal(p$kind[["visits"]], "ordinal")
  expect_equal(var_kind(c("a", NA), "x"), "constant")
  expect_equal(var_kind(as.Date("2020-01-01") + 0:9, "d"), "date")
  expect_equal(var_kind(rep(NA, 5), "x"), "empty")
})

test_that("planted signals are found", {
  res <- analyse(planted())
  s <- signals(res)
  kinds <- s$kind
  expect_true("척도 문항" %in% kinds)          # phq1..phq6 with phq_total
  expect_true("시점별 열" %in% kinds)          # hamd_pre, hamd_post
  expect_true("같은 정보" %in% kinds)          # score2 = 2 * score
  expect_true("집단 차이" %in% kinds)          # score by sex
  expect_true("치우친 분포" %in% kinds)        # income
  expect_true("결측과 다른 변수" %in% kinds)   # crp missing when age > 55
  expect_true("데이터 상태" %in% kinds)        # -99 in weight
  scale <- s[s$kind == "척도 문항", ]
  expect_match(scale$variables, "phq_total")
  # Items of one scale are not reported as related to each other.
  rel <- s[s$kind %in% c("관계", "같은 정보"), "variables"]
  expect_false(any(grepl("phq1, phq2", rel, fixed = TRUE)))
  miss <- s[s$kind == "결측과 다른 변수", ]
  expect_match(miss$variables[1], "crp, age")
})

test_that("hint cards carry numbers, plots and valid suggestions", {
  res <- analyse(planted(), list(maxHints = 6L))
  expect_lte(length(res$hints), 6)
  for (h in res$hints) {
    expect_true(nzchar(h$title))
    if (!is.null(h$plot)) expect_true(h$plot %in% names(res$plots))
    for (sg in h$suggestions) expect_match(sg$analysis, "^org\\.rsage\\.[a-z]+/[a-z]+$")
  }
  # Plots on cards are not repeated in the sections.
  on_cards <- unlist(lapply(res$hints, `[[`, "plot"))
  shown <- unlist(lapply(rsage:::result_sections(res), function(s) vapply(s$plots, `[[`, "", "id")))
  expect_length(intersect(on_cards, shown), 0)
})

test_that("a target variable gets a ranking and a regression to start from", {
  res <- analyse(planted(), list(target = "score"))
  expect_equal(kinds_of(res)[1], "target_model")
  tt <- res$tables$target$data
  expect_equal(tt$variable[1:2], c("score2", "age"))
  # Scale items enter through their total.
  expect_false(any(grepl("^phq[0-9]$", tt$variable)))
  sg <- res$hints[[1]]$suggestions[[1]]
  expect_equal(sg$analysis, "org.rsage.regression/regression")
  expect_equal(sg$options$outcome$variable, "score")
  expect_equal(sg$options$model$family, "gaussian")
  expect_true("age" %in% sg$options$predictors$continuous)
  expect_true("sex" %in% sg$options$predictors$categorical)
})

test_that("binary and count targets choose logistic and count regression", {
  d <- planted()
  d$event <- ifelse(d$score > stats::median(d$score), "yes", "no")
  res <- analyse(d, list(target = "event"))
  sg <- res$hints[[1]]$suggestions[[1]]
  expect_equal(sg$options$model$family, "binomial")
  expect_true(sg$options$outcome$event %in% c("yes", "no"))
  d$count <- stats::rpois(nrow(d), exp(d$age / 40))
  res <- analyse(d, list(target = "count"))
  expect_equal(res$hints[[1]]$suggestions[[1]]$options$model$family, "poisson")
})

test_that("independent noise raises no relation signals", {
  set.seed(2)
  d <- as.data.frame(matrix(stats::rnorm(300 * 8), 300, 8))
  d$g <- sample(letters[1:3], 300, TRUE)
  res <- analyse(d)
  s <- signals(res)
  expect_false(any(s$kind %in% c("관계", "집단 차이", "곡선 관계", "같은 정보")))
  expect_true(any(vapply(res$notes, function(n) identical(n$code, "no_signals"), TRUE)))
})

test_that("repeated measures are recognised in long data", {
  res <- analyse(datasets::ChickWeight)
  expect_true("반복 측정" %in% signals(res)$kind)
  expect_equal(kinds_of(res)[1], "repeated")
})

test_that("large data are sampled with a note", {
  d <- planted(400)
  res <- analyse(d, list(maxRows = 100L))
  expect_true(any(vapply(res$notes, function(n) identical(n$code, "sampled"), TRUE)))
})

test_that("particles follow the name", {
  expect_equal(fix_josa("'점수'와 '나이'는"), "'점수'와 '나이'는")
  expect_equal(fix_josa("'성별'와 '키'는"), "'성별'과 '키'는")
  expect_equal(fix_josa("'score'를"), "'score'을(를)")
  expect_equal(fix_josa("'x1'가"), "'x1'이")
})

test_that("unknown variables stop with a clear message", {
  expect_error(analyse(planted(), list(target = "nope")), "nope")
})

test_that("the result is written for the app with hints", {
  res <- analyse(planted(), list(target = "score"))
  dir <- tempfile()
  rsage::rs_write(res, dir)
  j <- jsonlite::read_json(file.path(dir, "result.json"))
  expect_gt(length(j$hints), 0)
  h <- j$hints[[1]]
  expect_true(file.exists(file.path(dir, paste0("plot-", h$plot, ".png"))))
  expect_type(h$suggestions[[1]]$options, "list")
  expect_type(h$suggestions[[1]]$options$predictors$continuous, "list")
})

test_that("group variables list their level names, IDs do not", {
  res <- analyse(planted())
  v <- res$tables$variables$data
  expect_setequal(strsplit(v$levels[v$variable == "sex"], ", ")[[1]], c("F", "M"))
  expect_true(is.na(v$levels[v$variable == "id"]))
})

test_that("held-out rows are kept apart and the suggestions open on them", {
  d <- planted()
  res <- analyse(d, list(target = "score", holdout = list(enabled = TRUE, fraction = 0.25, saveAs = "check_set")))
  h <- res$exports$check_set
  expect_equal(nrow(h), 50)
  expect_equal(names(h), names(d))
  expect_true(any(vapply(res$notes, function(n) identical(n$code, "holdout"), TRUE)))
  expect_equal(res$hints[[1]]$suggestions[[1]]$dataset, "check_set")
  expect_match(res$tables$overview$data$value[res$tables$overview$data$item == "행"], "150")
  # Repeated measures: whole chicks go to one side.
  cw <- as.data.frame(datasets::ChickWeight)
  r2 <- analyse(cw, list(holdout = list(enabled = TRUE)))
  held <- unique(as.character(r2$exports$explore_holdout$Chick))
  expect_false(any(as.character(cw$Chick[!cw$Chick %in% held]) %in% held))
  expect_equal(length(held), round(0.3 * nlevels(cw$Chick)))
})

# ---------- deeper looks (0.3) ----------

test_that("the quick model, subgroups and interactions find a planted interaction", {
  set.seed(3)
  n <- 400
  d <- data.frame(x = stats::rnorm(n), g = sample(c("A", "B"), n, TRUE), z = stats::rnorm(n), w = stats::runif(n))
  d$y <- ifelse(d$g == "B", 2 * d$x, -2 * d$x) + 0.5 * d$z + stats::rnorm(n, 0, 0.5)
  d$y_copy <- d$y + stats::rnorm(n, 0, 0.01)
  res <- analyse(d, list(target = "y"))
  k <- kinds_of(res)
  s <- signals(res)
  # x has almost no relation with y on its own, but the model needs it.
  expect_true("모형에서만 중요" %in% s$kind)
  expect_true(any(grepl("'x'", s$title[s$kind == "모형에서만 중요"])))
  expect_true("상호작용" %in% s$kind)
  it <- res$tables$interactions$data
  expect_true(any((it$a == "x" & it$b == "g" | it$a == "g" & it$b == "x") & it$delta > 0.5))
  expect_true("하위집단" %in% s$kind)
  expect_false(any(grepl("y_copy", res$tables$model$data$variable)))
  expect_true(any(vapply(res$notes, function(n) identical(n$code, "target_copies"), TRUE)))
  # The interaction card suggests a regression with the interaction term.
  ic <- Filter(function(h) h$kind == "interaction", res$hints)[[1]]
  terms <- ic$suggestions[[1]]$options$terms
  expect_true(any(vapply(terms, function(t) identical(t$kind, "interaction"), TRUE)))
  expect_true("i1" %in% ic$suggestions[[1]]$options$models[[1]]$termIds)
  expect_true(all(c("pd-x", "hint-s01") %in% names(res$plots)) || "pd-x" %in% names(res$plots))
})

test_that("clear clusters and a row off the pattern are found, noise has neither", {
  set.seed(4)
  centers <- rbind(c(0, 0, 0, 0), c(6, 6, 0, 0), c(0, 6, 6, 6))
  d <- as.data.frame(do.call(rbind, lapply(1:3, function(i) sweep(matrix(stats::rnorm(80 * 4), 80), 2, centers[i, ], "+"))))
  res <- analyse(d)
  expect_true("무리" %in% signals(res)$kind)
  expect_equal(ncol(res$tables$clusters$data), 2 + 3)

  set.seed(5)
  a <- stats::rnorm(300)
  e <- data.frame(a = a, b = a + stats::rnorm(300, 0, 0.2), c = stats::rnorm(300))
  e$b[17] <- -e$a[17] * 1.5 + 0.1
  e$a[17] <- 2
  res <- analyse(e)
  expect_true("동떨어진 행" %in% signals(res)$kind)
  expect_equal(res$tables$anomalies$data$row[1], "17")

  set.seed(6)
  noise <- as.data.frame(matrix(stats::rnorm(300 * 5), 300))
  s <- signals(analyse(noise))
  expect_false(any(s$kind %in% c("무리", "동떨어진 행")))
})

test_that("groups are compared with a Table 1 draft and SMDs", {
  d <- planted()
  set.seed(7)
  d$arm <- sample(c("A", "B"), nrow(d), TRUE)
  d$age[d$arm == "B"] <- d$age[d$arm == "B"] + 10
  res <- analyse(d, list(compare = "arm"))
  t1 <- res$tables$table1$data
  expect_equal(names(t1), c("variable", "level", "g1", "g2", "smd"))
  expect_gt(t1$smd[t1$variable == "age"], 0.6)
  # Scale items with a total are summarised by the total only.
  expect_false("phq1" %in% t1$variable)
  expect_equal(kinds_of(res)[1], "compare")
  expect_true(any(vapply(res$hints, function(h) h$kind == "group_shift" && "age" %in% h$variables, TRUE)))
  expect_error(analyse(d, list(compare = "nope")), "nope")
  many <- analyse(d, list(compare = "id"))
  expect_true(any(vapply(many$notes, function(n) identical(n$code, "compare_unusable"), TRUE)))
})
