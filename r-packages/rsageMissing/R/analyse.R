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
    plots = list(variables = TRUE, cases = FALSE, matrix = TRUE, cluster = FALSE, byGroup = TRUE,
                 upset = FALSE, upsetSets = 5L, span = FALSE, spanVariable = NULL, spanSize = 10L),
    relations = list(scatter = FALSE, x = NULL, y = NULL, shadowDensity = FALSE, variable = NULL, by = NULL),
    impute = list(enabled = FALSE, method = "pmm", m = 5L, maxit = 5L, seed = 123L, saveAs = "",
                  convergence = TRUE, densities = TRUE),
    imputePreview = list(enabled = FALSE, method = "below", x = NULL, y = NULL)
  )
}

# Result sections, in the order the tab shows them.
SECTIONS <- c("개요", "변수와 행", "결측 조합", "결측과 다른 변수의 관계", "대체")

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
  group <- one_name(o$group)
  vars <- as.character(unlist(o$variables))
  if (!length(vars)) vars <- setdiff(names(data), group)
  unknown <- setdiff(c(vars, group), names(data))
  if (length(unknown)) stop("데이터에 없는 변수: ", paste(unknown, collapse = ", "))
  vars <- setdiff(vars, group)
  if (!length(vars)) stop("분석할 변수가 없습니다.")

  # Columns other options refer to (scatter axes etc.) come along even when not analysed.
  extra <- intersect(c(one_name(o$relations$x), one_name(o$relations$y), one_name(o$relations$variable),
                       one_name(o$relations$by), one_name(o$plots$spanVariable),
                       one_name(o$imputePreview$x), one_name(o$imputePreview$y)), names(data))
  d <- tibble::as_tibble(data[unique(c(vars, group, extra))])
  notes <- list()
  replaced <- 0L
  if (length(o$naValues)) {
    rep <- replace_codes(d, setdiff(names(d), group), as.character(unlist(o$naValues)))
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
      "naniar 패키지가 없어 기본 요약으로 계산했습니다. naniar를 설치하면 MCAR 검정, 결측 조합·산점도·그림자 행렬 그림을 쓸 수 있습니다.",
      "warning", "naniar_missing")))
  }

  dv <- d[vars]
  total_cells <- nrow(dv) * ncol(dv)
  n_missing <- sum(is.na(dv))
  complete <- sum(stats::complete.cases(dv))
  tables <- list()
  plots <- list()
  add <- function(x) {
    if (inherits(x, "rsage_table")) tables[[x$id]] <<- x
    else if (inherits(x, "rsage_plot")) plots[[x$id]] <<- x
    else if (inherits(x, "rsage_note")) notes[[length(notes) + 1]] <<- x
    else if (is.list(x)) for (i in x) add(i)
  }

  add(rsage::rs_table("overview", "결측 개요", data.frame(
    measure = c("행", "변수", "결측 셀", "결측 셀 비율(%)", "완전한 행", "완전한 행 비율(%)"),
    value = c(nrow(dv), ncol(dv), n_missing, pct(n_missing, total_cells), complete, pct(complete, nrow(dv)))
  ), labels = c(measure = "항목", value = "값"), section = "개요",
  description = "완전한 행 비율이 낮으면, 결측 행을 지우는 분석(목록별 삭제)은 표본을 많이 잃습니다."))

  if (isTRUE(o$plots$matrix)) add(matrix_plot(dv, backend, isTRUE(o$plots$cluster)))
  if (isTRUE(o$plots$variables) && n_missing > 0) add(variable_plot(dv, backend))

  if (isTRUE(o$variableSummary)) add(variable_table(d, vars, group, backend))
  if (isTRUE(o$caseSummary)) add(case_table(dv, backend))
  if (isTRUE(o$plots$cases) && n_missing > 0) add(case_plot(dv, backend))
  if (isTRUE(o$plots$byGroup) && !is.null(group)) add(group_plot(d, vars, group, backend))
  if (isTRUE(o$plots$span)) add(span_plot(d, one_name(o$plots$spanVariable), as.integer(o$plots$spanSize), backend))

  if (isTRUE(o$patterns)) add(pattern_table(dv, as.integer(o$maxPatterns)))
  if (isTRUE(o$plots$upset)) add(upset_plot(dv, backend, as.integer(o$plots$upsetSets)))
  if (isTRUE(o$mcarTest)) add(mcar_table(dv, backend))

  if (isTRUE(o$relations$scatter)) add(scatter_plot(d, one_name(o$relations$x), one_name(o$relations$y), backend))
  if (isTRUE(o$relations$shadowDensity)) add(shadow_density(d, one_name(o$relations$variable), one_name(o$relations$by), backend))

  exports <- list()
  packages <- c("rsageMissing", if (backend != "base") backend)
  mids <- NULL
  if (isTRUE(o$impute$enabled)) {
    imp <- impute(dv, o$impute)
    if (inherits(imp, "rsage_note")) {
      add(imp)
    } else {
      mids <- imp$mids
      add(imp$items)
      packages <- unique(c(packages, "mice"))
      save_as <- as.character(o$impute$saveAs)
      if (length(save_as) && nzchar(save_as)) {
        exports[[save_as]] <- imp$mids
        add(rsage::rs_note(
          sprintf("대체 결과(mids 객체)를 R 세션의 '%s'에 저장했습니다. mice::complete(%s, 1)로 첫 번째 대체 데이터를 꺼낼 수 있습니다.", save_as, save_as),
          code = "imputation_saved"))
      }
    }
  }
  if (isTRUE(o$imputePreview$enabled)) {
    add(impute_preview(d, one_name(o$imputePreview$x), one_name(o$imputePreview$y), o$imputePreview$method, mids, backend))
  }

  if (n_missing == 0) add(rsage::rs_note("선택한 변수에 결측값이 없습니다.", code = "no_missing"))

  rsage::rs_result(
    "missing", "결측 데이터 분석",
    tables = unname(tables), plots = unname(plots), notes = notes,
    options = o, packages = packages, exports = exports, sections = SECTIONS,
    data_info = list(backend = backend, variables = vars, group = group, naCodesReplaced = replaced)
  )
}

# A single column name from an option that may be NULL, "" or a list.
one_name <- function(x) {
  x <- unlist(x)
  if (length(x) && !is.na(x[[1]]) && nzchar(x[[1]])) as.character(x[[1]]) else NULL
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
    s <- if (is.null(group)) naniar::miss_var_summary(d[vars]) else naniar::miss_var_summary(dplyr::group_by(d[c(vars, group)], .data[[group]]))
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
  rsage::rs_table("variables", if (is.null(group)) "변수별 결측" else sprintf("변수별 결측 (%s별)", group), s[cols],
                  labels = c(group = group %||% "그룹", variable = "변수", type = "측정수준", n_obs = "관측 N", n_miss = "결측 N", pct_miss = "결측 비율(%)"),
                  notes = "결측 비율이 큰 변수부터 정렬했습니다.", section = "변수와 행",
                  description = "결측이 몇몇 변수에 몰려 있으면 그 변수를 빼거나 따로 다루는 방법을, 고르게 퍼져 있으면 대체를 생각합니다.")
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
                  labels = c(n_miss_in_case = "행의 결측 변수 수", n_cases = "행 수", pct_cases = "행 비율(%)"),
                  section = "변수와 행",
                  description = "결측이 많은 행이 소수라면 그 행만 빼는 것도 방법입니다. 응답을 중간에 그만둔 설문에서 흔합니다.")
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
                  notes = notes, section = "결측 조합",
                  description = "한 줄이 하나의 결측 조합입니다. 여러 변수가 늘 함께 빠지면 같은 원인(같은 설문 페이지, 같은 검사)을 의심합니다.")
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
  notes <- "귀무가설: 결측이 완전히 무작위(MCAR)이다."
  if (length(dropped)) notes <- c(notes, paste("문자형 변수는 검정에서 뺐습니다:", paste(dropped, collapse = ", ")))
  rsage::rs_table("mcar", "Little의 MCAR 검정", res[c("statistic", "df", "p.value", "missing.patterns")],
                  labels = c(statistic = "χ²", df = "자유도", p.value = "p", missing.patterns = "결측 패턴 수"),
                  notes = notes, section = "결측 조합",
                  description = "p값이 작으면 결측이 완전히 무작위가 아닐 근거입니다. 그 경우 MAR인지 MNAR인지는 이 검정으로 가릴 수 없으니, 아래 '결측과 다른 변수의 관계' 그림으로 단서를 찾습니다.")
}

label_chars <- function(x) max(c(0, nchar(as.character(x), type = "width")))

theme_rs <- function() ggplot2::theme_minimal()

needs_naniar <- function(what, code) {
  rsage::rs_note(sprintf("%s은(는) naniar 패키지가 있어야 그립니다.", what), "warning", code)
}

matrix_plot <- function(dv, backend, cluster = FALSE) {
  if (backend == "naniar") {
    p <- naniar::vis_miss(as.data.frame(dv), cluster = cluster, warn_large_data = FALSE)
  } else {
    long <- data.frame(row = rep(seq_len(nrow(dv)), ncol(dv)), variable = rep(names(dv), each = nrow(dv)),
                       missing = as.vector(is.na(as.matrix(dv))))
    long$variable <- factor(long$variable, levels = names(dv))
    p <- ggplot2::ggplot(long, ggplot2::aes(.data$variable, .data$row, fill = .data$missing)) +
      ggplot2::geom_raster() + ggplot2::scale_y_reverse() +
      ggplot2::scale_fill_manual(values = c(`FALSE` = "grey80", `TRUE` = "grey20"), labels = c("관측", "결측"), name = NULL) +
      ggplot2::labs(x = NULL, y = "행") + theme_rs()
  }
  size <- rsage::rs_figure_size(x_items = ncol(dv), aspect = 0.7, legend = backend != "naniar")
  rsage::rs_plot("matrix", if (cluster) "결측 위치 (비슷한 행끼리 모음)" else "결측 위치", p, size = size,
                 alt = "행과 변수마다 값이 결측인지 보여 주는 그림", section = "개요",
                 description = if (cluster) "결측 모양이 비슷한 행끼리 모아 그렸습니다. 큰 덩어리는 여러 변수가 함께 빠지는 행 집단입니다."
                               else "검은 칸이 결측입니다. 세로 띠는 결측이 많은 변수, 가로 띠는 여러 변수가 함께 빠진 행, 특정 구간에 몰린 결측은 수집 시기나 절차의 문제를 뜻할 수 있습니다.")
}

variable_plot <- function(dv, backend) {
  vars <- names(dv)
  if (backend == "naniar") {
    p <- naniar::gg_miss_var(dv, show_pct = TRUE)
  } else {
    s <- data.frame(variable = vars, pct = vapply(dv, function(x) pct(sum(is.na(x)), length(x)), 0))
    p <- ggplot2::ggplot(s, ggplot2::aes(stats::reorder(.data$variable, .data$pct), .data$pct)) +
      ggplot2::geom_col(fill = "#4aa5f0") + ggplot2::coord_flip() +
      ggplot2::labs(x = NULL, y = "결측 비율(%)") + theme_rs()
  }
  size <- rsage::rs_figure_size(y_items = length(vars), label_chars = label_chars(vars))
  rsage::rs_plot("variables", "변수별 결측 비율", p, size = size, alt = "변수마다 결측 비율을 막대로 보여 주는 그림",
                 section = "개요", description = "어느 변수가 가장 많이 빠졌는지 봅니다.")
}

case_plot <- function(dv, backend) {
  k <- rowSums(is.na(dv))
  if (backend == "naniar") {
    p <- naniar::gg_miss_case(dv, show_pct = TRUE)
  } else {
    s <- data.frame(row = seq_along(k), pct = 100 * k / ncol(dv))
    p <- ggplot2::ggplot(s, ggplot2::aes(.data$row, .data$pct)) + ggplot2::geom_col(fill = "#4aa5f0") +
      ggplot2::coord_flip() + ggplot2::labs(x = "행", y = "결측 비율(%)") + theme_rs()
  }
  rsage::rs_plot("cases", "행별 결측 비율", p, size = rsage::rs_figure_size(aspect = 0.8),
                 alt = "행마다 결측 비율을 보여 주는 그림", section = "변수와 행",
                 description = "행마다 몇 퍼센트가 빠졌는지 봅니다. 거의 비어 있는 행이 많으면 응답 탈락을 의심합니다.")
}

# By group: one small chart per group while they fit; past that (e.g. 31
# days) a heat map of variable x group, which stays legible with dozens.
group_plot <- function(d, vars, group, backend) {
  g <- d[[group]]
  levels_g <- if (is.factor(g)) levels(droplevels(g)) else sort(unique(g))
  title <- sprintf("변수별 결측 비율 (%s별)", group)
  desc <- sprintf("%s의 값마다 결측 비율이 다르면 결측이 %s와 관련 있다는 뜻입니다(MAR의 단서).", group, group)
  size <- rsage::rs_figure_size(panels = length(levels_g), y_items = length(vars), label_chars = label_chars(vars))
  if (!size$compact && backend == "naniar") {
    p <- rlang::inject(naniar::gg_miss_var(d[c(vars, group)], facet = !!rlang::sym(group), show_pct = TRUE)) +
      ggplot2::facet_wrap(ggplot2::vars(.data[[group]]), ncol = size$ncol)
    return(rsage::rs_plot("byGroup", title, p, size = size, section = "변수와 행", description = desc,
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
    ggplot2::labs(x = group, y = NULL) + theme_rs() +
    ggplot2::theme(panel.grid = ggplot2::element_blank())
  if (length(levels_g) * length(vars) <= 120) p <- p + ggplot2::geom_text(ggplot2::aes(label = round(.data$pct)), size = 2.8)
  if (length(levels_g) > 12) p <- p + ggplot2::theme(axis.text.x = ggplot2::element_text(angle = 90, vjust = 0.5, hjust = 1))
  hsize <- rsage::rs_figure_size(x_items = length(levels_g), y_items = length(vars), label_chars = label_chars(vars), legend = TRUE)
  rsage::rs_plot("byGroup", title, p, size = hsize, section = "변수와 행", description = desc,
                 alt = sprintf("%s의 값마다 변수별 결측 비율을 색으로 보여 주는 그림", group))
}

span_plot <- function(d, var, span, backend) {
  if (is.null(var)) return(rsage::rs_note("시계열 결측 구간 그림은 변수를 골라야 그립니다.", code = "span_needs_variable"))
  if (backend != "naniar") return(needs_naniar("시계열 결측 구간 그림", "span_needs_naniar"))
  span <- max(1L, span)
  n_spans <- ceiling(nrow(d) / span)
  p <- rlang::inject(naniar::gg_miss_span(as.data.frame(d), !!rlang::sym(var), span_every = span))
  rsage::rs_plot("span", sprintf("%s의 결측 구간 (%d행씩)", var, span), p,
                 size = rsage::rs_figure_size(x_items = min(n_spans, 60)), section = "변수와 행",
                 alt = sprintf("%s를 %d행씩 나눈 구간마다 결측 비율을 보여 주는 그림", var, span),
                 description = "데이터가 시간 순서로 정렬돼 있을 때 씁니다. 결측이 특정 시기에 몰리면 장비 고장이나 수집 중단 같은 원인을 찾아봅니다.")
}

upset_plot <- function(dv, backend, nsets = 5L) {
  miss_vars <- names(dv)[vapply(dv, anyNA, TRUE)]
  if (backend != "naniar" || !has("UpSetR")) {
    return(rsage::rs_note("결측 조합 그림(UpSet)은 naniar와 UpSetR 패키지가 있어야 그립니다.", "warning", "upset_needs_naniar"))
  }
  if (length(miss_vars) < 2) {
    return(rsage::rs_note("결측 조합 그림에는 결측이 있는 변수가 2개 이상 필요합니다.", code = "upset_not_applicable"))
  }
  k <- min(max(2L, nsets), length(miss_vars))
  rsage::rs_plot("upset", "결측 조합 (UpSet)", function() print(naniar::gg_miss_upset(as.data.frame(dv), nsets = k)),
                 size = rsage::rs_figure_size(x_items = min(40, 2^k)), section = "결측 조합",
                 alt = "어떤 변수들이 함께 결측인지 조합별 행 수를 보여 주는 그림",
                 description = sprintf("아래 점이 이어진 변수들이 함께 빠진 조합이고, 위 막대는 그 조합의 행 수입니다. 결측이 많은 변수 %d개까지 봅니다.", k))
}

numeric_col <- function(d, v) !is.null(v) && v %in% names(d) && is.numeric(d[[v]])

scatter_plot <- function(d, x, y, backend) {
  if (!numeric_col(d, x) || !numeric_col(d, y)) {
    return(rsage::rs_note("결측 산점도는 수치형 변수 두 개(X, Y)를 골라야 그립니다.", code = "scatter_needs_variables"))
  }
  if (backend != "naniar") return(needs_naniar("결측 산점도", "scatter_needs_naniar"))
  p <- ggplot2::ggplot(d, ggplot2::aes(.data[[x]], .data[[y]])) + naniar::geom_miss_point(alpha = 0.8) +
    ggplot2::scale_colour_manual(values = c(Missing = "#e66101", `Not Missing` = "#4aa5f0"),
                                 labels = c(Missing = "한쪽 이상 결측", `Not Missing` = "둘 다 관측"), name = NULL) +
    theme_rs()
  rsage::rs_plot("scatter", sprintf("%s와 %s의 결측 산점도", x, y), p, size = rsage::rs_figure_size(aspect = 0.75, legend = TRUE),
                 section = "결측과 다른 변수의 관계",
                 alt = sprintf("%s와 %s의 산점도. 한쪽이 결측인 점은 축 아래쪽에 따로 표시", x, y),
                 description = "한 변수가 결측인 점은 그 축의 최솟값보다 조금 아래에 따로 찍습니다. 결측 점이 다른 변수의 특정 범위에 몰려 있으면 결측이 그 값과 관련 있다는 뜻입니다.")
}

shadow_density <- function(d, v, by, backend) {
  if (!numeric_col(d, v) || is.null(by) || !by %in% names(d)) {
    return(rsage::rs_note("그림자 행렬 비교는 수치형 변수와, 결측 여부로 나눌 변수를 골라야 합니다.", code = "shadow_needs_variables"))
  }
  if (!anyNA(d[[by]])) return(rsage::rs_note(sprintf("'%s'에 결측이 없어 결측 여부로 나눌 수 없습니다.", by), code = "shadow_no_missing"))
  grp <- factor(ifelse(is.na(d[[by]]), sprintf("%s 결측", by), sprintf("%s 관측", by)),
                levels = c(sprintf("%s 관측", by), sprintf("%s 결측", by)))
  pd <- data.frame(value = d[[v]], grp = grp)
  pd <- pd[!is.na(pd$value), , drop = FALSE]
  p <- ggplot2::ggplot(pd, ggplot2::aes(.data$value, fill = .data$grp)) +
    ggplot2::geom_density(alpha = 0.5, colour = NA) +
    ggplot2::scale_fill_manual(values = c("#4aa5f0", "#e66101"), name = NULL) +
    ggplot2::labs(x = v, y = "밀도") + theme_rs()
  s <- do.call(rbind, lapply(levels(grp), function(l) {
    x <- pd$value[pd$grp == l]
    data.frame(group = l, n = length(x), mean = if (length(x)) mean(x) else NA_real_,
               sd = if (length(x) > 1) stats::sd(x) else NA_real_, median = if (length(x)) stats::median(x) else NA_real_)
  }))
  fn <- if (backend == "naniar") "naniar::bind_shadow()" else "결측 여부"
  list(
    rsage::rs_plot("shadow", sprintf("%s의 분포: %s가 결측인 행과 아닌 행", v, by), p,
                   size = rsage::rs_figure_size(aspect = 0.6, legend = TRUE), section = "결측과 다른 변수의 관계",
                   alt = sprintf("%s가 결측인 행과 관측된 행에서 %s의 밀도를 겹쳐 그린 그림", by, v),
                   description = sprintf("%s로 만든 그림자 열(%s_NA)로 행을 나눴습니다. 두 분포가 다르면 %s의 결측은 %s와 관련 있습니다(MAR의 단서).", fn, by, by, v)),
    rsage::rs_table("shadow", sprintf("%s 요약: %s 결측 여부별", v, by), s,
                    labels = c(group = "행", n = "N", mean = "평균", sd = "표준편차", median = "중앙값"),
                    section = "결측과 다른 변수의 관계")
  )
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
  items <- list(
    rsage::rs_table("imputation", "다중대체 (mice)", tab,
                    labels = c(variable = "변수", method = "방법", n_imputed = "대체한 값 수"), section = "대체",
                    description = sprintf("mice로 대체 데이터 %d개를 만들었습니다(반복 %d회, seed %d). 분석은 각 대체 데이터에서 따로 하고 결과를 합칩니다(mice::pool).",
                                          as.integer(o$m), as.integer(o$maxit), as.integer(o$seed))))
  if (!is.null(mids$loggedEvents) && nrow(mids$loggedEvents)) {
    items <- c(items, list(rsage::rs_note(
      paste0("mice가 일부 변수를 예측변수에서 뺐습니다: ", paste(unique(mids$loggedEvents$out), collapse = ", ")),
      "warning", "imputation_logged_events")))
  }
  num <- names(d)[vapply(d, is.numeric, TRUE) & n_imp > 0]
  if (isTRUE(o$convergence) && length(num)) items <- c(items, list(convergence_plot(mids, num)))
  if (isTRUE(o$densities) && length(num)) items <- c(items, list(density_plot(mids, d, num)))
  list(items = items, mids = mids)
}

convergence_plot <- function(mids, num) {
  if (mids$iteration < 2) {
    return(rsage::rs_note("수렴 그림에는 반복이 2회 이상 필요합니다.", code = "convergence_needs_iterations"))
  }
  long <- do.call(rbind, lapply(num, function(v) {
    mean_m <- mids$chainMean[v, , , drop = TRUE]
    sd_m <- sqrt(mids$chainVar[v, , , drop = TRUE])
    mean_m <- as.matrix(mean_m)
    sd_m <- as.matrix(sd_m)
    it <- seq_len(nrow(mean_m))
    rbind(
      data.frame(variable = v, stat = "평균", iteration = rep(it, ncol(mean_m)), chain = factor(rep(seq_len(ncol(mean_m)), each = length(it))), value = as.vector(mean_m)),
      data.frame(variable = v, stat = "표준편차", iteration = rep(it, ncol(sd_m)), chain = factor(rep(seq_len(ncol(sd_m)), each = length(it))), value = as.vector(sd_m))
    )
  }))
  size <- rsage::rs_figure_size(panels = 2 * length(num), legend = TRUE, ncol = 2)
  p <- ggplot2::ggplot(long, ggplot2::aes(.data$iteration, .data$value, colour = .data$chain)) +
    ggplot2::geom_line() + ggplot2::facet_wrap(ggplot2::vars(.data$variable, .data$stat), scales = "free_y", ncol = 2) +
    ggplot2::labs(x = "반복", y = NULL, colour = "대체") + theme_rs()
  rsage::rs_plot("convergence", "대체 수렴 (mice)", p, size = size, section = "대체",
                 alt = "반복마다 대체값의 평균과 표준편차를 대체 데이터별 선으로 그린 그림",
                 description = "선들이 서로 뒤섞이고 뚜렷한 추세가 없으면 수렴한 것입니다. 한쪽으로 계속 오르거나 내리면 반복 횟수를 늘립니다.")
}

density_plot <- function(mids, d, num) {
  long <- mice::complete(mids, "long", include = TRUE)
  rows <- lapply(num, function(v) {
    obs <- long[long$.imp == 0 & !is.na(long[[v]]), v]
    miss_rows <- which(is.na(d[[v]]))
    imp <- long[long$.imp > 0 & long$.id %in% miss_rows, v]
    rbind(data.frame(variable = v, value = obs, source = "관측값"), data.frame(variable = v, value = imp, source = "대체값"))
  })
  pd <- do.call(rbind, rows)
  isize <- rsage::rs_figure_size(panels = length(num), legend = TRUE)
  rsage::rs_plot("imputation", "관측값과 대체값 분포", 
    ggplot2::ggplot(pd, ggplot2::aes(.data$value, colour = .data$source)) +
      ggplot2::geom_density() + ggplot2::facet_wrap(~variable, scales = "free", ncol = isize$ncol) +
      ggplot2::labs(x = NULL, y = "밀도", colour = NULL) + theme_rs(),
    size = isize, section = "대체",
    alt = "대체된 수치형 변수마다 관측값과 대체값의 밀도를 겹쳐 그린 그림",
    description = "대체값 분포가 관측값과 크게 다르면 대체 모형을 의심합니다. 다만 MAR에서는 어느 정도 다른 것이 자연스럽습니다.")
}

PREVIEW_LABELS <- c(below = "최솟값 아래로 밀기", mean = "평균 대체", median = "중앙값 대체", mice = "mice 첫 번째 대체")

impute_preview <- function(d, x, y, method, mids, backend) {
  if (!numeric_col(d, x) || !numeric_col(d, y)) {
    return(rsage::rs_note("대체값 함께 보기는 수치형 변수 두 개(X, Y)를 골라야 그립니다.", code = "preview_needs_variables"))
  }
  method <- as.character(method)
  miss_x <- is.na(d[[x]])
  miss_y <- is.na(d[[y]])
  fill <- function(v) {
    val <- d[[v]]
    switch(method,
      mean = replace(val, is.na(val), mean(val, na.rm = TRUE)),
      median = replace(val, is.na(val), stats::median(val, na.rm = TRUE)),
      below = if (backend == "naniar") naniar::impute_below(val) else {
        r <- range(val, na.rm = TRUE)
        replace(val, is.na(val), r[1] - 0.1 * diff(r))
      },
      mice = {
        done <- mice::complete(mids, 1)
        if (v %in% names(done)) done[[v]] else val
      })
  }
  if (method == "mice" && is.null(mids)) {
    return(rsage::rs_note("mice 대체값을 보려면 '다중대체 실행'을 켜세요.", code = "preview_needs_mice"))
  }
  if (method == "mice" && !all(c(x, y) %in% names(mice::complete(mids, 1)))) {
    return(rsage::rs_note("mice 대체값 보기는 X와 Y를 분석할 변수에 넣어야 합니다.", code = "preview_mice_vars"))
  }
  status <- ifelse(miss_x & miss_y, "둘 다 대체", ifelse(miss_x, sprintf("%s 대체", x), ifelse(miss_y, sprintf("%s 대체", y), "관측")))
  pd <- data.frame(x = fill(x), y = fill(y), status = factor(status, levels = c("관측", sprintf("%s 대체", x), sprintf("%s 대체", y), "둘 다 대체")))
  cols <- c("#9aa4b2", "#e66101", "#5e3c99", "#b2182b")
  names(cols) <- levels(pd$status)
  p <- ggplot2::ggplot(pd, ggplot2::aes(.data$x, .data$y, colour = .data$status)) +
    ggplot2::geom_point(alpha = 0.8) + ggplot2::scale_colour_manual(values = cols, drop = TRUE, name = NULL) +
    ggplot2::labs(x = x, y = y) + theme_rs()
  desc <- switch(method,
    below = "naniar가 결측 산점도에서 쓰는 방식입니다. 대체가 아니라, 결측 점을 축 바깥에 모아 보이게 하는 표시입니다.",
    mean = "평균 대체는 대체값이 한 줄로 늘어서 분산과 상관을 줄입니다. 그래서 분석용으로는 권하지 않습니다.",
    median = "중앙값 대체도 대체값이 한 줄로 늘어서 분산과 상관을 줄입니다.",
    mice = "mice의 첫 번째 대체 데이터입니다. 대체값이 관측값 사이에 자연스럽게 섞이면 그럴듯한 대체입니다.")
  rsage::rs_plot("preview", sprintf("대체값 함께 보기: %s", PREVIEW_LABELS[[method]]), p,
                 size = rsage::rs_figure_size(aspect = 0.75, legend = TRUE), section = "대체",
                 alt = sprintf("%s와 %s의 산점도에서 대체한 값을 색으로 구분한 그림", x, y), description = desc)
}
