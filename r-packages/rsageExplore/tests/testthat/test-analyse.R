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
