tab <- function(r, id) r$tables[[id]]$data

test_that("one-way ANOVA matches aov, oneway.test and kruskal.test", {
  r <- analyse_anova(PlantGrowth, list(dependent = "weight", factors = "group", tests = list(welch = TRUE, kruskal = TRUE),
                                       posthoc = list(tukey = TRUE, gamesHowell = TRUE, dunn = TRUE)))
  a <- tab(r, "anova")
  ref <- summary(aov(weight ~ group, PlantGrowth))[[1]]
  expect_equal(a$statistic[1], ref$`F value`[1])
  expect_equal(a$eta2[1], ref$`Sum Sq`[1] / sum(ref$`Sum Sq`))
  expect_equal(a$statistic[2], unname(oneway.test(weight ~ group, PlantGrowth)$statistic))
  expect_equal(a$statistic[3], unname(kruskal.test(weight ~ group, PlantGrowth)$statistic))
  ph <- tab(r, "posthoc")
  expect_equal(sum(ph$method == "Tukey HSD"), 3)
  tk <- TukeyHSD(aov(weight ~ group, PlantGrowth))$group
  expect_equal(ph$p[ph$method == "Tukey HSD"], unname(tk[, "p adj"]))
  # Games-Howell trt1 vs trt2 (reference: rstatix/userfriendlyscience give p = .0237)
  gh <- ph[ph$method == "Games–Howell" & ph$contrast == "trt1 − trt2", ]
  expect_equal(gh$p, 0.0237, tolerance = 0.002)
  # Dunn trt1 vs trt2 (FSA::dunnTest, holm: z = -2.807)
  dn <- ph[ph$method == "Dunn" & ph$contrast == "trt1 − trt2", ]
  expect_equal(dn$statistic, -2.807, tolerance = 0.001)
})

test_that("two-way ANOVA uses type III sums of squares", {
  skip_if_not_installed("car")
  r <- analyse_anova(ToothGrowth, list(dependent = "len", factors = c("supp", "dose")))
  a <- tab(r, "anova")
  expect_equal(a$term, c("supp", "dose", "supp × dose"))
  expect_equal(a$statistic, c(15.572, 92.000, 4.107), tolerance = 1e-3)
  expect_equal(r$title, "이원 분산분석")
})

test_that("unequal spreads suggest Welch and Games-Howell", {
  set.seed(1)
  d <- data.frame(g = rep(c("a", "b", "c"), each = 15), y = c(rnorm(15, 0, 1), rnorm(15, 0, 4), rnorm(15, 1, 1)))
  r <- analyse_anova(d, list(dependent = "y", factors = "g"))
  ids <- vapply(r$hints, `[[`, "", "id")
  expect_true(all(c("variance", "posthoc") %in% ids))
  o <- r$hints[[which(ids == "variance")]]$suggestions[[1]]$options
  expect_true(o$tests$welch)
  expect_true(o$posthoc$gamesHowell)
})
