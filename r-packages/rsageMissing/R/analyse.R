# Missing data analysis: how much is missing, where, in which combinations,
# whether it looks missing completely at random, and (optionally) a
# multiple imputation. The options describe the statistics, not naniar's or
# mice's arguments, so either backend can serve them.

#' Default options
defaults <- function() {
  list(
    variables = character(),
    group = NULL,
    naValues = character(),
    variableSummary = TRUE,
    caseSummary = TRUE,
    patterns = TRUE,
    maxPatterns = 15L,
    mcarTest = TRUE,
    plots = list(variables = TRUE, matrix = TRUE, upset = FALSE),
    impute = list(enabled = FALSE, method = "pmm", m = 5L, maxit = 5L, seed = 123L, saveAs = "")
  )
}

#' Missing data analysis
#'
#' @param data A data frame.
#' @param options A list of options; see defaults(). Missing entries take their default.
#' @return An rsage result.
#' @examples
#' analyse(airquality, list(mcarTest = TRUE))
analyse <- function(data, options = list()) {
  stopifnot(is.data.frame(data))
  o <- rsage::rs_merge_options(options, defaults())
  group <- if (length(o$group) && nzchar(o$group[[1]])) o$group[[1]] else NULL
  vars <- as.character(unlist(o$variables))
  if (!length(vars)) vars <- setdiff(names(data), group)
  unknown <- setdiff(c(vars, group), names(data))
  if (length(unknown)) stop("데이터에 없는 변수: ", paste(unknown, collapse = ", "))
  vars <- setdiff(vars, group)
  if (!length(vars)) stop("분석할 변수가 없습니다.")

  d <- tibble::as_tibble(data[unique(c(vars, group))])
  notes <- list()
  replaced <- 0L
  if (length(o$naValues)) {
    rep <- replace_codes(d, vars, as.character(unlist(o$naValues)))
    d <- rep$data
    replaced <- rep$count
    notes <- c(notes, list(rsage::rs_note(
      sprintf("결측 코드 %s 를 결측으로 바꿨습니다(%d개 값). 원본 데이터는 바뀌지 않습니다.",
              paste(shQuote(unlist(o$naValues), "cmd"), collapse = ", "), replaced),
      code = "na_codes_replaced")))
  }
  if (!is.null(group) && anyNA(d[[group]])) {
    notes <- c(notes, list(rsage::rs_note(
      sprintf("그룹 변수 '%s'에 결측이 %d개 있어 '(결측)' 그룹으로 표시했습니다.", group, sum(is.na(d[[group]]))),
      code = "group_missing")))
    d[[group]] <- forcats_na(d[[group]])
  }

  backend <- if (has("naniar")) "naniar" else if (has("mice")) "mice" else "base"
  if (backend != "naniar") {
    notes <- c(notes, list(rsage::rs_note(
      "naniar 패키지가 없어 기본 요약으로 계산했습니다. naniar를 설치하면 MCAR 검정과 결측 그림을 더 쓸 수 있습니다.",
      "warning", "naniar_missing")))
  }

  dv <- d[vars]
  total_cells <- nrow(dv) * ncol(dv)
  n_missing <- sum(is.na(dv))
  complete <- sum(stats::complete.cases(dv))
  tables <- list()
  plots <- list()

  tables$overview <- rsage::rs_table("overview", "결측 개요", data.frame(
    measure = c("행", "변수", "결측 셀", "결측 셀 비율(%)", "완전한 행", "완전한 행 비율(%)"),
    value = c(nrow(dv), ncol(dv), n_missing, pct(n_missing, total_cells), complete, pct(complete, nrow(dv)))
  ), labels = c(measure = "항목", value = "값"))

  if (isTRUE(o$variableSummary)) tables$variables <- variable_table(d, vars, group, backend)
  if (isTRUE(o$caseSummary)) tables$cases <- case_table(dv, backend)
  if (isTRUE(o$patterns)) tables$patterns <- pattern_table(dv, as.integer(o$maxPatterns))

  if (isTRUE(o$mcarTest)) {
    m <- mcar_table(dv, backend)
    if (inherits(m, "rsage_table")) tables$mcar <- m else notes <- c(notes, list(m))
  }

  if (isTRUE(o$plots$variables) && n_missing > 0) plots$variables <- variable_plot(d, vars, group, backend)
  if (isTRUE(o$plots$matrix)) plots$matrix <- matrix_plot(dv, backend)
  if (isTRUE(o$plots$upset)) {
    up <- upset_plot(dv, backend)
    if (inherits(up, "rsage_plot")) plots$upset <- up else notes <- c(notes, list(up))
  }

  exports <- list()
  packages <- c("rsageMissing", if (backend != "base") backend)
  if (isTRUE(o$impute$enabled)) {
    imp <- impute(dv, o$impute)
    if (inherits(imp, "rsage_note")) {
      notes <- c(notes, list(imp))
    } else {
      tables$imputation <- imp$table
      if (!is.null(imp$plot)) plots$imputation <- imp$plot
      notes <- c(notes, imp$notes)
      packages <- unique(c(packages, "mice"))
      save_as <- as.character(o$impute$saveAs)
      if (length(save_as) && nzchar(save_as)) {
        exports[[save_as]] <- imp$mids
        notes <- c(notes, list(rsage::rs_note(
          sprintf("대체 결과(mids 객체)를 R 세션의 '%s'에 저장했습니다. mice::complete(%s, 1)로 첫 번째 대체 데이터를 꺼낼 수 있습니다.", save_as, save_as),
          code = "imputation_saved")))
      }
    }
  }

  if (n_missing == 0) notes <- c(notes, list(rsage::rs_note("선택한 변수에 결측값이 없습니다.", code = "no_missing")))

  rsage::rs_result(
    "missing", "결측 데이터 분석",
    tables = unname(tables), plots = unname(plots), notes = notes,
    options = o, packages = packages, exports = exports,
    data_info = list(backend = backend, variables = vars, group = group, naCodesReplaced = replaced)
  )
}

has <- function(pkg) requireNamespace(pkg, quietly = TRUE)

pct <- function(x, n) if (n == 0) NA_real_ else 100 * x / n

forcats_na <- function(x) {
  x <- as.character(x)
  x[is.na(x)] <- "(결측)"
  x
}

# Values such as -99 or "" that stand for "missing" in the source data.
replace_codes <- function(d, vars, codes) {
  count <- 0L
  num_codes <- suppressWarnings(as.numeric(codes))
  num_codes <- num_codes[!is.na(num_codes)]
  for (v in vars) {
    x <- d[[v]]
    hit <- if (is.numeric(x)) x %in% num_codes else if (is.factor(x) || is.character(x)) as.character(x) %in% codes else rep(FALSE, length(x))
    hit[is.na(hit)] <- FALSE
    if (any(hit)) {
      count <- count + sum(hit)
      if (is.factor(x)) {
        x[hit] <- NA
        x <- droplevels(x)
      } else {
        x[hit] <- NA
      }
      d[[v]] <- x
    }
  }
  list(data = d, count = count)
}

var_type <- function(x) {
  if (is.ordered(x)) "서열형" else if (is.factor(x) || is.character(x) || is.logical(x)) "명목형" else if (is.numeric(x)) "연속형" else class(x)[1]
}

variable_table <- function(d, vars, group, backend) {
  types <- vapply(d[vars], var_type, "")
  if (backend == "naniar") {
    s <- if (is.null(group)) naniar::miss_var_summary(d[vars]) else naniar::miss_var_summary(dplyr::group_by(d, .data[[group]]))
    s <- as.data.frame(s)
    names(s)[names(s) == group] <- "group"
  } else {
    one <- function(x) data.frame(variable = vars, n_miss = vapply(x[vars], function(c) sum(is.na(c)), 0L),
                                  pct_miss = vapply(x[vars], function(c) pct(sum(is.na(c)), length(c)), 0))
    s <- if (is.null(group)) one(d) else do.call(rbind, lapply(split(d, d[[group]]), function(x) cbind(group = x[[group]][1], one(x))))
    s <- s[order(-s$n_miss), , drop = FALSE]
  }
  s$n_miss <- as.integer(s$n_miss)
  s$pct_miss <- as.numeric(s$pct_miss)
  s$type <- unname(types[s$variable])
  n_rows <- if (is.null(group)) nrow(d) else as.integer(table(d[[group]])[as.character(s$group)])
  s$n_obs <- n_rows - s$n_miss
  cols <- c(if (!is.null(group)) "group", "variable", "type", "n_obs", "n_miss", "pct_miss")
  rsage::rs_table("variables", "변수별 결측", s[cols],
                  labels = c(group = group %||% "그룹", variable = "변수", type = "측정수준", n_obs = "관측 N", n_miss = "결측 N", pct_miss = "결측 비율(%)"),
                  notes = "결측 비율이 큰 변수부터 정렬했습니다.")
}

`%||%` <- function(a, b) if (is.null(a)) b else a

case_table <- function(dv, backend) {
  if (backend == "naniar") {
    s <- as.data.frame(naniar::miss_case_table(dv))
  } else {
    k <- rowSums(is.na(dv))
    tab <- table(k)
    s <- data.frame(n_miss_in_case = as.integer(names(tab)), n_cases = as.integer(tab))
    s$pct_cases <- 100 * s$n_cases / nrow(dv)
  }
  rsage::rs_table("cases", "행별 결측 개수", s,
                  labels = c(n_miss_in_case = "행의 결측 변수 수", n_cases = "행 수", pct_cases = "행 비율(%)"))
}

pattern_table <- function(dv, max_patterns) {
  miss <- is.na(dv)
  key <- apply(miss, 1, function(r) paste(as.integer(!r), collapse = ""))
  counts <- sort(table(key), decreasing = TRUE)
  shown <- utils::head(counts, max_patterns)
  rows <- lapply(names(shown), function(k) as.integer(strsplit(k, "")[[1]]))
  m <- as.data.frame(do.call(rbind, rows))
  names(m) <- names(dv)
  out <- cbind(data.frame(n_cases = as.integer(shown)), m, data.frame(n_missing_vars = ncol(dv) - rowSums(m)))
  notes <- "1 = 관측, 0 = 결측. 행 수가 많은 패턴부터 정렬했습니다."
  if (length(counts) > max_patterns) notes <- c(notes, sprintf("패턴 %d개 중 상위 %d개만 보여 줍니다.", length(counts), max_patterns))
  rsage::rs_table("patterns", "결측 패턴", out,
                  labels = c(n_cases = "행 수", n_missing_vars = "결측 변수 수", stats::setNames(names(dv), names(dv))),
                  notes = notes)
}

mcar_table <- function(dv, backend) {
  if (backend != "naniar") {
    return(rsage::rs_note("Little의 MCAR 검정은 naniar 패키지가 있어야 계산합니다.", "warning", "mcar_needs_naniar"))
  }
  usable <- dv[vapply(dv, function(x) is.numeric(x) || is.factor(x) || is.logical(x), TRUE)]
  if (ncol(usable) < 2 || !anyNA(usable)) {
    return(rsage::rs_note("MCAR 검정에는 결측이 있는 수치형·범주형 변수가 2개 이상 필요합니다.", code = "mcar_not_applicable"))
  }
  res <- tryCatch(as.data.frame(naniar::mcar_test(as.data.frame(lapply(usable, as.numeric)))), error = function(e) e)
  if (inherits(res, "error")) {
    return(rsage::rs_note(paste("MCAR 검정을 계산하지 못했습니다:", conditionMessage(res)), "warning", "mcar_failed"))
  }
  dropped <- setdiff(names(dv), names(usable))
  notes <- "귀무가설: 결측이 완전히 무작위(MCAR)이다. p값이 작으면 MCAR이 아닐 근거가 됩니다. MCAR이 아니라는 것이 MAR인지 MNAR인지는 이 검정으로 구분할 수 없습니다."
  if (length(dropped)) notes <- c(notes, paste("문자형 변수는 검정에서 뺐습니다:", paste(dropped, collapse = ", ")))
  rsage::rs_table("mcar", "Little의 MCAR 검정", res[c("statistic", "df", "p.value", "missing.patterns")],
                  labels = c(statistic = "χ²", df = "자유도", p.value = "p", missing.patterns = "결측 패턴 수"),
                  notes = notes)
}

label_chars <- function(x) max(c(0, nchar(as.character(x), type = "width")))

variable_plot <- function(d, vars, group, backend) {
  if (!is.null(group)) return(group_plot(d, vars, group, backend))
  if (backend == "naniar") {
    p <- naniar::gg_miss_var(d[vars], show_pct = TRUE)
  } else {
    s <- data.frame(variable = vars, pct = vapply(d[vars], function(x) pct(sum(is.na(x)), length(x)), 0))
    p <- ggplot2::ggplot(s, ggplot2::aes(stats::reorder(.data$variable, .data$pct), .data$pct)) +
      ggplot2::geom_col(fill = "#4aa5f0") + ggplot2::coord_flip() +
      ggplot2::labs(x = NULL, y = "결측 비율(%)") + ggplot2::theme_minimal()
  }
  size <- rsage::rs_figure_size(y_items = length(vars), label_chars = label_chars(vars))
  rsage::rs_plot("variables", "변수별 결측 비율", p, size = size, alt = "변수마다 결측 비율을 막대로 보여 주는 그림")
}

# By group: one small chart per group while they fit; past that (e.g. 31
# days) a heat map of variable × group, which stays legible with dozens.
group_plot <- function(d, vars, group, backend) {
  g <- d[[group]]
  levels_g <- if (is.factor(g)) levels(droplevels(g)) else sort(unique(g))
  size <- rsage::rs_figure_size(panels = length(levels_g), y_items = length(vars), label_chars = label_chars(vars))
  if (!size$compact && backend == "naniar") {
    p <- rlang::inject(naniar::gg_miss_var(d[c(vars, group)], facet = !!rlang::sym(group), show_pct = TRUE)) +
      ggplot2::facet_wrap(ggplot2::vars(.data[[group]]), ncol = size$ncol)
    return(rsage::rs_plot("variables", sprintf("변수별 결측 비율 (%s별)", group), p, size = size,
                          alt = sprintf("%s의 값마다 변수별 결측 비율을 보여 주는 그림", group)))
  }
  cells <- expand.grid(variable = vars, group = levels_g, stringsAsFactors = FALSE)
  cells$pct <- mapply(function(v, l) {
    x <- d[[v]][!is.na(g) & g == l]
    pct(sum(is.na(x)), length(x))
  }, cells$variable, cells$group)
  cells$variable <- factor(cells$variable, levels = names(sort(vapply(vars, function(v) mean(is.na(d[[v]])), 0))))
  cells$group <- factor(as.character(cells$group), levels = as.character(levels_g))
  p <- ggplot2::ggplot(cells, ggplot2::aes(.data$group, .data$variable, fill = .data$pct)) +
    ggplot2::geom_tile(colour = "white", linewidth = 0.4) +
    ggplot2::scale_fill_gradient(low = "#f1f4f8", high = "#b2182b", limits = c(0, 100), name = "결측(%)") +
    ggplot2::labs(x = group, y = NULL) + ggplot2::theme_minimal() +
    ggplot2::theme(panel.grid = ggplot2::element_blank())
  if (length(levels_g) * length(vars) <= 120) p <- p + ggplot2::geom_text(ggplot2::aes(label = round(.data$pct)), size = 2.8)
  if (length(levels_g) > 12) p <- p + ggplot2::theme(axis.text.x = ggplot2::element_text(angle = 90, vjust = 0.5, hjust = 1))
  hsize <- rsage::rs_figure_size(x_items = length(levels_g), y_items = length(vars), label_chars = label_chars(vars), legend = TRUE)
  rsage::rs_plot("variables", sprintf("변수별 결측 비율 (%s별)", group), p, size = hsize,
                 alt = sprintf("%s의 값마다 변수별 결측 비율을 색으로 보여 주는 그림", group))
}

matrix_plot <- function(dv, backend) {
  if (backend == "naniar") {
    p <- naniar::vis_miss(dv)
  } else {
    long <- data.frame(row = rep(seq_len(nrow(dv)), ncol(dv)), variable = rep(names(dv), each = nrow(dv)),
                       missing = as.vector(is.na(as.matrix(dv))))
    long$variable <- factor(long$variable, levels = names(dv))
    p <- ggplot2::ggplot(long, ggplot2::aes(.data$variable, .data$row, fill = .data$missing)) +
      ggplot2::geom_raster() + ggplot2::scale_y_reverse() +
      ggplot2::scale_fill_manual(values = c(`FALSE` = "grey80", `TRUE` = "grey20"), labels = c("관측", "결측"), name = NULL) +
      ggplot2::labs(x = NULL, y = "행") + ggplot2::theme_minimal()
  }
  size <- rsage::rs_figure_size(x_items = ncol(dv), aspect = 0.7, legend = backend != "naniar")
  rsage::rs_plot("matrix", "결측 위치", p, size = size, alt = "행과 변수마다 값이 결측인지 보여 주는 그림")
}

upset_plot <- function(dv, backend) {
  miss_vars <- names(dv)[vapply(dv, anyNA, TRUE)]
  if (backend != "naniar" || !has("UpSetR")) {
    return(rsage::rs_note("결측 조합 그림(UpSet)은 naniar와 UpSetR 패키지가 있어야 그립니다.", "warning", "upset_needs_naniar"))
  }
  if (length(miss_vars) < 2) {
    return(rsage::rs_note("결측 조합 그림에는 결측이 있는 변수가 2개 이상 필요합니다.", code = "upset_not_applicable"))
  }
  rsage::rs_plot("upset", "결측 조합", function() print(naniar::gg_miss_upset(as.data.frame(dv), nsets = length(miss_vars))),
                 size = rsage::rs_figure_size(x_items = min(40, 2^length(miss_vars))), alt = "어떤 변수들이 함께 결측인지 조합별 행 수를 보여 주는 그림")
}

impute <- function(dv, o) {
  if (!has("mice")) return(rsage::rs_note("다중대체에는 mice 패키지가 필요합니다.", "warning", "impute_needs_mice"))
  if (!anyNA(dv)) return(rsage::rs_note("결측값이 없어 대체하지 않았습니다.", code = "impute_nothing"))
  d <- as.data.frame(dv)
  for (v in names(d)) if (is.character(d[[v]])) d[[v]] <- factor(d[[v]])
  mids <- mice::mice(d, m = as.integer(o$m), maxit = as.integer(o$maxit), method = o$method,
                     seed = as.integer(o$seed), printFlag = FALSE)
  methods <- mids$method
  n_imp <- vapply(d, function(x) sum(is.na(x)), 0L)
  tab <- data.frame(variable = names(d), method = unname(methods[names(d)]), n_imputed = unname(n_imp))
  tab$method[tab$method == ""] <- "(대체 안 함)"
  notes <- list(rsage::rs_note(sprintf("mice로 %d번 대체했습니다(반복 %d회, seed %d).", as.integer(o$m), as.integer(o$maxit), as.integer(o$seed)),
                               code = "imputation_done"))
  if (!is.null(mids$loggedEvents) && nrow(mids$loggedEvents)) {
    notes <- c(notes, list(rsage::rs_note(
      paste0("mice가 일부 변수를 예측변수에서 뺐습니다: ", paste(unique(mids$loggedEvents$out), collapse = ", ")),
      "warning", "imputation_logged_events")))
  }
  plot <- NULL
  num <- names(d)[vapply(d, is.numeric, TRUE) & n_imp > 0]
  if (length(num)) {
    long <- mice::complete(mids, "long", include = TRUE)
    rows <- lapply(num, function(v) {
      obs <- long[long$.imp == 0 & !is.na(long[[v]]), v]
      miss_rows <- which(is.na(d[[v]]))
      imp <- long[long$.imp > 0 & long$.id %in% miss_rows, v]
      rbind(data.frame(variable = v, value = obs, source = "관측값"), data.frame(variable = v, value = imp, source = "대체값"))
    })
    pd <- do.call(rbind, rows)
    isize <- rsage::rs_figure_size(panels = length(num), legend = TRUE)
    plot <- rsage::rs_plot("imputation", "관측값과 대체값 분포",
      ggplot2::ggplot(pd, ggplot2::aes(.data$value, colour = .data$source)) +
        ggplot2::geom_density() + ggplot2::facet_wrap(~variable, scales = "free", ncol = isize$ncol) +
        ggplot2::labs(x = NULL, y = "밀도", colour = NULL) + ggplot2::theme_minimal(),
      size = isize,
      alt = "대체된 수치형 변수마다 관측값과 대체값의 밀도를 겹쳐 그린 그림")
  }
  list(table = rsage::rs_table("imputation", "다중대체(mice)", tab,
                               labels = c(variable = "변수", method = "방법", n_imputed = "대체한 값 수")),
       plot = plot, notes = notes, mids = mids)
}
