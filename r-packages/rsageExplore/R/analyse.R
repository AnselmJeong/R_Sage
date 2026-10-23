# Exploration guide: profile a data frame, find what is worth a closer look
# (signals) and turn the strongest into hint cards, each with its numbers,
# a small figure and a suggested next analysis. Every number comes from
# here; the module ranks by effect size, never by p-value, because it looks
# at many pairs at once.

#' Default options
defaults <- function() {
  list(
    variables = character(),
    target = NULL,
    exclude = character(),
    scope = list(structure = TRUE, distributions = TRUE, relations = TRUE, groups = TRUE, missing = TRUE),
    maxHints = 8L,
    maxRows = 50000L,
    seed = 123L,
    plots = list(relationMap = TRUE, distributions = TRUE)
  )
}

# Result sections, in the order the tab shows them.
SECTIONS <- c("개요", "목표 변수", "발견한 신호", "변수", "관계", "분포")

SIGNAL_LABEL <- c(health = "데이터 상태", missing = "결측", missing_related = "결측과 다른 변수", skew = "치우친 분포",
                  zeros = "0이 많음", ceiling = "바닥·천장 효과", bimodal = "봉우리 둘", imbalance = "한 범주에 몰림",
                  rare_levels = "드문 범주", scale = "척도 문항", repeated = "반복 측정", wide = "시점별 열",
                  association = "관계", nonlinear = "곡선 관계", outlier_driven = "극단값이 만든 상관",
                  redundant = "같은 정보", group_diff = "집단 차이", target = "목표 변수와의 관계",
                  target_model = "목표 변수 모형")

MAX_PAIRS <- 5000L

fmt_value <- function(x) if (abs(x - round(x)) < 1e-9 && abs(x) >= 1) format(round(x)) else fmt_num(x)

one_name <- function(x) {
  x <- unlist(x)
  if (is.null(x) || !length(x) || is.na(x[1]) || !nzchar(x[1])) NULL else as.character(x[1])
}

#' Exploration guide
#'
#' @param data A data frame.
#' @param options A list of options; see defaults(). Missing entries take their default.
#' @return An rsage result whose hints are the cards the app shows first.
#' @examples
#' analyse(airquality, list(target = "Ozone"))
analyse <- function(data, options = list()) {
  stopifnot(is.data.frame(data))
  o <- rsage::rs_merge_options(options, defaults())
  target <- one_name(o$target)
  vars <- as.character(unlist(o$variables))
  if (!length(vars)) vars <- names(data)
  vars <- setdiff(unique(c(vars, target)), as.character(unlist(o$exclude)))
  unknown <- setdiff(c(vars, target), names(data))
  if (length(unknown)) stop("데이터에 없는 변수: ", paste(unknown, collapse = ", "))
  if (!length(vars)) stop("살펴볼 변수가 없습니다.")
  if (!nrow(data)) stop("데이터에 행이 없습니다.")

  d <- as.data.frame(data[vars], stringsAsFactors = FALSE, check.names = FALSE)
  notes <- list()
  n_all <- nrow(d)
  if (n_all > o$maxRows) {
    set.seed(o$seed)
    d <- d[sort(sample.int(n_all, o$maxRows)), , drop = FALSE]
    notes <- c(notes, list(rsage::rs_note(
      sprintf("행이 %s개라 %s행을 무작위로 뽑아 살폈습니다(seed %d). 숫자는 표본 기준입니다.",
              format(n_all, big.mark = ","), format(o$maxRows, big.mark = ","), o$seed), code = "sampled")))
  }

  prof <- profile_vars(d)
  kinds <- prof$kind
  scales <- if (isTRUE(o$scope$structure)) scale_groups(d, kinds) else list()
  rep <- if (isTRUE(o$scope$structure)) repeated_measures(d, kinds) else NULL
  wide <- if (isTRUE(o$scope$structure)) wide_groups(d, kinds) else list()

  # Variables that take part in relations: numeric, or groups with few levels.
  rel <- names(d)[vapply(names(d), function(n) is_num_kind(kinds[[n]], d[[n]]) || is_cat_kind(kinds[[n]], d[[n]]), TRUE)]
  rel <- setdiff(rel, rep$id)
  if (length(rel) * (length(rel) - 1) / 2 > MAX_PAIRS) {
    keep <- rel[seq_len(floor((1 + sqrt(1 + 8 * MAX_PAIRS)) / 2))]
    keep <- unique(c(target, keep))[seq_along(keep)]
    notes <- c(notes, list(rsage::rs_note(
      sprintf("변수가 %d개라 앞의 %d개끼리의 관계만 살폈습니다. 살펴볼 변수를 고르면 그 안에서 봅니다.", length(rel), length(keep)),
      code = "pairs_limited")))
    rel <- keep
  }
  # Items of one scale correlate by design, and so do a scale's items and its total.
  same_block <- c(lapply(scales, function(s) c(s$items, s$total)), unname(wide))
  skip_pair <- function(a, b) {
    if (!is.null(target) && (a == target || b == target)) return(TRUE)
    any(vapply(same_block, function(g) a %in% g && b %in% g, TRUE))
  }

  sig <- list()
  sig <- c(sig, health_signals(d, kinds))
  if (isTRUE(o$scope$structure)) sig <- c(sig, structure_signals(d, kinds, scales, rep, wide))
  if (isTRUE(o$scope$distributions)) sig <- c(sig, distribution_signals(d[setdiff(names(d), rep$id)], kinds))
  rs <- list(signals = list(), pairs = list())
  if (isTRUE(o$scope$relations) || isTRUE(o$scope$groups)) {
    rs <- relation_signals(d, kinds, rel, skip_pair, groups = isTRUE(o$scope$groups))
    sig_rel <- rs$signals
    if (!isTRUE(o$scope$relations)) sig_rel <- Filter(function(s) s$kind == "group_diff", sig_rel)
    if (!isTRUE(o$scope$groups)) sig_rel <- Filter(function(s) s$kind != "group_diff", sig_rel)
    sig <- c(sig, sig_rel)
  }
  if (isTRUE(o$scope$missing)) sig <- c(sig, missing_signals(d, kinds, rel))
  ta <- NULL
  if (!is.null(target)) {
    if (!target %in% rel) {
      notes <- c(notes, list(rsage::rs_note(
        sprintf("목표 변수 '%s'는 %s 유형이라 다른 변수와의 관계를 잴 수 없습니다. 수치나 범주(30개 이하) 변수를 고르세요.",
                target, KIND_LABEL[[kinds[[target]]]]), "warning", "target_unusable")))
    } else {
      # A scale with a total enters through its total, not item by item.
      items <- unlist(lapply(Filter(function(s) !is.null(s$total), scales), `[[`, "items"))
      ta <- target_analysis(d, kinds, target, setdiff(rel, items))
      sig <- c(sig, target_signals(d, kinds, target, ta))
    }
  }

  # Rank: score, then n. One signal per kind and variable set.
  sig <- sig[order(-vapply(sig, `[[`, 1, "score"), -vapply(sig, function(s) if (is.na(s$n)) 0L else s$n, 1L))]
  for (i in seq_along(sig)) sig[[i]]$id <- sprintf("s%02d", i)

  # Cards: the strongest signals, no variable on more than two relation cards (besides the target).
  cards <- list()
  used <- character()
  pairwise <- c("association", "nonlinear", "outlier_driven", "redundant", "group_diff", "target", "missing_related")
  for (s in sig) {
    if (length(cards) >= o$maxHints) break
    v <- if (s$kind %in% pairwise) setdiff(s$variables, target) else character()
    if (length(v) && any(table(c(used, v))[v] > 2)) next
    cards[[length(cards) + 1]] <- s
    used <- c(used, v)
  }

  tables <- list()
  plots <- list()
  hints <- list()
  for (s in cards) {
    p <- tryCatch(card_plot(d, s$draw, ta), error = function(e) NULL)
    pid <- NULL
    if (!is.null(p)) {
      pid <- paste0("hint-", s$id)
      plots[[length(plots) + 1]] <- rsage::rs_plot(pid, s$title, p, width = card_size(s$draw)$width, height = card_size(s$draw)$height,
                                                   alt = s$title, section = "발견한 신호")
    }
    ev <- if (!is.null(s$display)) s$display else if (!is.na(s$measure) && !is.na(s$value)) {
      paste0(s$measure, " = ", fmt_value(s$value), if (!is.na(s$n)) sprintf(", n = %d", s$n),
             if (!is.na(s$size)) paste0(" (", s$size, ")"))
    } else if (!is.na(s$n)) sprintf("n = %d", s$n)
    hints[[length(hints) + 1]] <- rsage::rs_hint(s$id, s$title, s$text, evidence = ev, kind = s$kind, variables = s$variables,
                                                 plot = pid, signal = s$id, suggestions = s$suggestions)
  }

  # ---------- tables ----------
  n_kinds <- table(factor(KIND_LABEL[kinds], levels = unique(KIND_LABEL)))
  n_kinds <- n_kinds[n_kinds > 0]
  overview <- data.frame(
    item = c("행", "열", "변수 유형", "결측 셀 비율(%)", "완전한 행 비율(%)", "중복 행", "살펴본 변수 쌍", "찾은 신호"),
    value = c(format(n_all, big.mark = ","), ncol(d), paste(sprintf("%s %d", names(n_kinds), as.integer(n_kinds)), collapse = ", "),
              fmt_num(100 * mean(is.na(d)), 1), fmt_num(100 * mean(stats::complete.cases(d)), 1), sum(duplicated(d)),
              length(rs$pairs), length(sig)),
    stringsAsFactors = FALSE)
  if (!is.null(rep)) overview <- rbind(overview, data.frame(item = "자료 구조", value = sprintf("반복 측정: %s %d개, ID당 평균 %s행", rep$id, rep$ids, fmt_num(rep$mean, 1))))
  tables[[length(tables) + 1]] <- rsage::rs_table(
    "overview", "한눈에 보기", overview, labels = c(item = "항목", value = "값"), section = "개요",
    description = "데이터의 크기와 구성입니다. 살펴본 변수 쌍이 많을수록 우연히 큰 관계도 나오므로, 아래 신호는 확인할 가설로 읽으세요.")

  sig_tab <- data.frame(
    id = vapply(sig, `[[`, "", "id"),
    kind = unname(SIGNAL_LABEL[vapply(sig, `[[`, "", "kind")]),
    title = vapply(sig, `[[`, "", "title"),
    variables = vapply(sig, function(s) paste(s$variables, collapse = ", "), ""),
    measure = vapply(sig, function(s) as.character(s$measure), ""),
    value = vapply(sig, function(s) as.numeric(s$value), 1),
    n = vapply(sig, function(s) as.integer(s$n), 1L),
    size = vapply(sig, function(s) as.character(s$size), ""),
    on_card = vapply(sig, function(s) s$id %in% vapply(cards, `[[`, "", "id"), TRUE),
    stringsAsFactors = FALSE)
  tables[[length(tables) + 1]] <- rsage::rs_table(
    "signals", "찾은 신호 전체", sig_tab,
    labels = c(id = "ID", kind = "종류", title = "내용", variables = "변수", measure = "측도", value = "값", n = "n",
               size = "크기", on_card = "카드"),
    section = "발견한 신호",
    notes = "순서는 관련 크기와 종류로 매긴 점수 순입니다. p값은 쓰지 않았습니다.",
    description = "위 카드에 오른 것과 오르지 않은 것을 모두 담았습니다. 크기는 r·ρ·V 0.1/0.3/0.5, η² 0.01/0.06/0.14 기준(작음/중간/큼)입니다.")

  if (!is.null(ta)) {
    tt <- ta$table
    tables[[length(tables) + 1]] <- rsage::rs_table(
      "target", sprintf("'%s'와 관련이 큰 변수", target), tt[c("variable", "kind", "measure", "value", "strength", "size", "n")],
      labels = c(variable = "변수", kind = "유형", measure = "측도", value = "값", strength = "관련 크기", size = "크기", n = "n"),
      section = "목표 변수",
      notes = "관련 크기는 서로 다른 측도를 상관계수 척도로 맞춘 값입니다: |ρ|, η(=√η²), Cramér V.",
      description = "변수 하나씩 따로 잰 관계입니다. 다른 변수를 통제한 효과가 아니며, 함께 넣으면 순위가 바뀔 수 있습니다.")
    pr <- card_plot(d, list(type = "target_rank"), ta)
    if (!is.null(pr)) {
      plots[[length(plots) + 1]] <- rsage::rs_plot(
        "target-rank", sprintf("'%s'와의 관련 크기", target), pr,
        size = rsage::rs_figure_size(1, y_items = min(12, nrow(tt)), label_chars = 14, legend = FALSE),
        section = "목표 변수", description = "막대가 길수록 목표 변수와 함께 움직이거나 집단에 따라 크게 다릅니다. 색은 측도의 종류입니다.")
    }
  }

  prof_tab <- prof$table
  prof_tab$memo <- vapply(names(d), function(n) {
    m <- character()
    if (identical(n, target)) m <- c(m, "목표 변수")
    if (!is.null(rep) && n == rep$id) m <- c(m, "반복 측정 ID")
    for (s in scales) {
      if (n %in% s$items) m <- c(m, paste0("척도 ", s$stem, " 문항"))
      if (identical(n, s$total)) m <- c(m, paste0("척도 ", s$stem, " 합계"))
    }
    for (st in names(wide)) if (n %in% wide[[st]]) m <- c(m, paste0(st, " 시점별 열"))
    paste(m, collapse = ", ")
  }, "")
  tables[[length(tables) + 1]] <- rsage::rs_table(
    "variables", "변수 프로필", prof_tab,
    labels = c(variable = "변수", class = "R 클래스", kind = "추정 유형", missing_pct = "결측(%)", unique = "고유값",
               mean = "평균", sd = "표준편차", median = "중앙값", min = "최솟값", max = "최댓값", skew = "왜도",
               top = "가장 많은 값", memo = "메모"),
    section = "변수",
    description = "추정 유형은 값의 모양으로 정했습니다(예: 0~10 정수는 순서 척도, 행마다 다른 값은 ID). 틀리면 R에서 factor()나 as.numeric()으로 바꾼 뒤 다시 실행하세요.")

  if (isTRUE(o$plots$relationMap)) {
    hm <- tryCatch(heatmap_plot(rs$pairs, rel), error = function(e) NULL)
    if (!is.null(hm)) {
      plots[[length(plots) + 1]] <- rsage::rs_plot(
        "relation-map", "변수 사이 관련 크기", hm$plot, size = hm$size, section = "관계",
        description = "칸이 진할수록 두 변수의 관련이 큽니다. 수치끼리는 |ρ|, 수치와 범주는 η, 범주끼리는 Cramér V입니다. 같은 척도의 문항끼리는 비워 두었습니다.")
    }
  }
  if (isTRUE(o$plots$distributions)) {
    nums <- rel[vapply(rel, function(n) is_num_kind(kinds[[n]], d[[n]]), TRUE)]
    dp <- tryCatch(distributions_plot(d, nums), error = function(e) NULL)
    if (!is.null(dp)) {
      plots[[length(plots) + 1]] <- rsage::rs_plot(
        "distributions", "수치 변수의 분포", dp$plot, size = dp$size, section = "분포",
        description = "한쪽으로 긴 꼬리, 봉우리 둘, 끝값에 몰림, 동떨어진 값을 찾아보세요. 축은 변수마다 다릅니다.")
      if (length(nums) > 36) notes <- c(notes, list(rsage::rs_note(sprintf("수치 변수 %d개 중 앞의 36개만 분포를 그렸습니다.", length(nums)), code = "distributions_limited")))
    }
  }

  if (!length(cards)) {
    notes <- c(notes, list(rsage::rs_note("눈에 띄는 신호가 없습니다. 변수 사이 관련이 모두 작고 분포에도 큰 문제가 없습니다.", code = "no_signals")))
  }
  notes <- c(notes, list(rsage::rs_note(
    "카드는 탐색 결과입니다. 여러 조합을 한꺼번에 살폈으므로 우연히 큰 관계도 섞여 있을 수 있습니다. 확인은 제안한 분석이나 새 데이터로 하세요.",
    code = "exploratory")))

  rsage::rs_result(
    analysis = "explore",
    title = if (is.null(target)) "탐색 안내" else sprintf("탐색 안내: %s", target),
    tables = tables, plots = plots, notes = notes, options = o,
    packages = c("rsageExplore", "datawizard", "ggplot2"),
    sections = SECTIONS, hints = hints
  )
}
