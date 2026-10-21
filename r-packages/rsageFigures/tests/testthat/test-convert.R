# Every chunk of inst/examples/figures.qmd states the result it expects in
# its fig-cap: (rule), (partial), (ai) or (unsupported).

examples <- function() {
  path <- test_path("..", "..", "inst", "examples", "figures.qmd")
  if (!file.exists(path)) path <- system.file("examples", "figures.qmd", package = "rsageFigures")
  lines <- readLines(path, encoding = "UTF-8")
  starts <- grep("^```\\{r\\}", lines)
  ends <- grep("^```$", lines)
  out <- list()
  for (s in starts) {
    body <- lines[(s + 1):(min(ends[ends > s]) - 1)]
    label <- sub("^#\\| label: ", "", body[grepl("^#\\| label:", body)])
    cap <- body[grepl("^#\\| fig-cap:", body)]
    if (!length(cap)) next
    out[[label]] <- list(code = paste(body[!grepl("^#\\|", body)], collapse = "\n"), expect = sub(".*\\((\\w+)[^)]*\\)\\s*$", "\\1", cap))
  }
  out
}

test_that("each example converts as its caption says", {
  skip_if_not_installed("tidyplots")
  env <- new.env()
  library(ggplot2)
  for (label in names(ex <- examples())) {
    e <- ex[[label]]
    if (label == "fig-map") skip_if_not_installed("sf")
    # sf warns when its PROJ data is missing (some build machines); the map is skipped either way.
    r <- if (label == "fig-map") suppressWarnings(convert(e$code, envir = env)) else convert(e$code, envir = env)
    expect_equal(r$status, e$expect, label = label)
    if (r$status %in% c("rule", "partial")) {
      expect_true(all(r$checks$ok), label = paste(label, "checks"))
      expect_s3_class(r$plot, "tidyplot")
    }
  }
  expect_length(ls(env), 0) # nothing leaked into the caller's environment
})

test_that("the mean bar keeps its numbers and labels", {
  skip_if_not_installed("tidyplots")
  r <- convert(examples()[["fig-mean-bar"]]$code)
  expect_match(r$code, "add_mean_bar()", fixed = TRUE)
  expect_match(r$code, "add_sem_errorbar(width = 0.2)", fixed = TRUE)
  expect_match(r$code, "adjust_x_axis_title(\"보충제\")", fixed = TRUE)
  bars <- r$checks[r$checks$check == "막대 높이", ]
  expect_equal(bars$after, "16.96, 20.66")
})

test_that("an assigned plot keeps its name and the lines to replace", {
  skip_if_not_installed("tidyplots")
  r <- convert("x <- 1\np <- ggplot2::ggplot(mtcars, ggplot2::aes(factor(cyl), mpg)) +\n  ggplot2::geom_boxplot()\np")
  expect_equal(r$status, "rule")
  expect_equal(r$target$first_line, 2)
  expect_equal(r$target$last_line, 3)
  expect_match(r$code, "^p <- mtcars \\|>")
  expect_match(r$code, "dplyr::mutate(cyl = factor(cyl))", fixed = TRUE)
})

test_that("options set colours, theme and size", {
  skip_if_not_installed("tidyplots")
  code <- "ggplot2::ggplot(PlantGrowth, ggplot2::aes(group, weight, colour = group)) + ggplot2::geom_boxplot()"
  r <- convert(code, list(colors = "okabeito", theme = "minimal_y", size = "fixed"))
  expect_match(r$code, "adjust_colors(new_colors = colors_discrete_okabeito)", fixed = TRUE)
  expect_match(r$code, "theme_minimal_y()", fixed = TRUE)
  expect_no_match(r$code, "adjust_size")
  r <- convert(code)
  expect_match(r$code, "adjust_size(width = NA, height = NA) |>\n  adjust_font(fontsize = 10)", fixed = TRUE)
})

test_that("a summary that changes the meaning is reported, not passed", {
  skip_if_not_installed("tidyplots")
  before <- "ggplot2::ggplot(ToothGrowth, ggplot2::aes(supp, len)) + ggplot2::stat_summary(fun = mean, geom = 'bar')"
  same <- "ToothGrowth |> tidyplot(x = supp, y = len) |> add_mean_bar()"
  wrong <- "ToothGrowth |> tidyplot(x = supp, y = len) |> add_median_bar()"
  expect_true(check(before, same)$ok)
  r <- check(before, wrong)
  expect_false(r$ok)
  expect_false(r$checks$ok[r$checks$check == "막대 높이"])
})

test_that("facets keep shared axes", {
  skip_if_not_installed("tidyplots")
  r <- convert("ggplot2::ggplot(iris, ggplot2::aes(Sepal.Length, Sepal.Width)) + ggplot2::geom_point() + ggplot2::facet_wrap(~Species, scales = 'free_y')")
  expect_match(r$code, "split_plot(by = Species, scales = \"free_y\")", fixed = TRUE)
})

test_that("code that fails or draws nothing says so", {
  expect_equal(convert("stop('boom')")$status, "error")
  expect_equal(convert("x <- 1")$status, "none")
  expect_equal(convert("plot(1:3)")$status, "ai")
})

test_that("convert_json returns the result without the plot", {
  skip_if_not_installed("tidyplots")
  f <- tempfile(fileext = ".rds")
  j <- jsonlite::fromJSON(convert_json(examples()[["fig-violin"]]$code, plot_file = f))
  expect_equal(j$status, "rule")
  expect_null(j$plot)
  expect_s3_class(readRDS(f), "tidyplot")
})
