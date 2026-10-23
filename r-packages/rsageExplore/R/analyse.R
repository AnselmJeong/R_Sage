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
    holdout = list(enabled = FALSE, fraction = 0.3, saveAs = "explore_holdout"),
    compare = NULL,
    deep = list(model = TRUE, subgroups = TRUE, interactions = TRUE, clusters = TRUE, anomalies = TRUE),
    plots = list(relationMap = TRUE, distributions = TRUE)
  )
}

# Result sections, in the order the tab shows them.
SECTIONS <- c("개요", "목표 변수", "집단 비교", "더 깊은 탐색", "발견한 신호", "변수", "관계", "분포")

SIGNAL_LABEL <- c(health = "데이터 상태", missing = "결측", missing_related = "결측과 다른 변수", skew = "치우친 분포",
                  zeros = "0이 많음", ceiling = "바닥·천장 효과", bimodal = "봉우리 둘", imbalance = "한 범주에 몰림",
                  rare_levels = "드문 범주", scale = "척도 문항", repeated = "반복 측정", wide = "시점별 열",
                  association = "관계", nonlinear = "곡선 관계", outlier_driven = "극단값이 만든 상관",
                  redundant = "같은 정보", group_diff = "집단 차이", target = "목표 변수와의 관계",
                  target_model = "목표 변수 모형", model_importance = "빠른 모형", model_hidden = "모형에서만 중요",
                  subgroup = "하위집단", interaction = "상호작용", clusters = "무리", anomaly = "동떨어진 행",
                  compare = "집단 비교", group_shift = "집단마다 다름")

MAX_PAIRS <- 5000L

fmt_value <- function(x) if (abs(x - round(x)) < 1e-9 && abs(x) >= 1) format(round(x)) else fmt_num(x)

one_name <- function(x) {
  x <- unlist(x)
  if (is.null(x) || !length(x) || is.na(x[1]) || !nzchar(x[1])) NULL else as.character(x[1])
}

holdout_name <- function(x) {
  x <- one_name(x)
  if (is.null(x) || !nzchar(x)) "explore_holdout" else make.names(x)
}

# Rows kept back for checking what the exploration finds. Repeated
# measures are split by their ID so one subject is never on both sides.
split_holdout <- function(data, d, fraction, seed) {
  fraction <- min(0.9, max(0.05, as.numeric(fraction)))
  rep <- repeated_measures(d, profile_vars(d)$kind)
  set.seed(seed)
  if (!is.null(rep)) {
    ids <- unique(d[[rep$id]])
    out <- d[[rep$id]] %in% ids[sample.int(length(ids), max(1, round(fraction * length(ids))))]
  } else {
    out <- seq_len(nrow(d)) %in% sample.int(nrow(d), max(1, round(fraction * nrow(d))))
  }
  if (all(out) || !any(out)) stop("확인용 데이터를 떼어 두기에는 행이 너무 적습니다.")
  list(keep = !out, holdout = data[out, , drop = FALSE], by = rep$id)
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
  compare <- one_name(o$compare)
  vars <- as.character(unlist(o$variables))
  if (!length(vars)) vars <- names(data)
  vars <- setdiff(unique(c(vars, target, compare)), as.character(unlist(o$exclude)))
  unknown <- setdiff(c(vars, target, compare), names(data))
  if (length(unknown)) stop("데이터에 없는 변수: ", paste(unknown, collapse = ", "))
  if (!length(vars)) stop("살펴볼 변수가 없습니다.")
  if (!nrow(data)) stop("데이터에 행이 없습니다.")

  d <- as.data.frame(data[vars], stringsAsFactors = FALSE, check.names = FALSE)
  notes <- list()
  exports <- list()
  held <- NULL
  if (isTRUE(o$holdout$enabled)) {
    h <- split_holdout(data, d, o$holdout$fraction, o$seed)
    held <- list(name = holdout_name(o$holdout$saveAs), rows = nrow(h$holdout), by = h$by)
    exports[[held$name]] <- h$holdout
    d <- d[h$keep, , drop = FALSE]
    notes <- c(notes, list(rsage::rs_note(
      sprintf("확인용으로 %s행(%s%%)을 떼어 '%s'에 저장하고 나머지 %s행으로 살폈습니다%s. 카드의 제안 분석은 떼어 둔 데이터로 엽니다.",
              format(held$rows, big.mark = ","), fmt_num(100 * held$rows / nrow(data), 0), held$name,
              format(nrow(d), big.mark = ","), if (is.null(h$by)) "" else sprintf("(%s 단위로 나눔)", h$by)),
      code = "holdout")))
  }
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
  # A scale with a total enters through its total, not item by item.
  items <- unlist(lapply(Filter(function(s) !is.null(s$total), scales), `[[`, "items"))
  ta <- NULL
  if (!is.null(target)) {
    if (!target %in% rel) {
      notes <- c(notes, list(rsage::rs_note(
        sprintf("목표 변수 '%s'는 %s 유형이라 다른 변수와의 관계를 잴 수 없습니다. 수치나 범주(30개 이하) 변수를 고르세요.",
                target, KIND_LABEL[[kinds[[target]]]]), "warning", "target_unusable")))
    } else {
      ta <- target_analysis(d, kinds, target, setdiff(rel, items))
      sig <- c(sig, target_signals(d, kinds, target, ta))
    }
  }

  # Deeper looks: each one is optional and a failure in one never stops the rest.
  deep <- list()
  attempt <- function(expr, what) tryCatch(expr, error = function(e) {
    notes <<- c(notes, list(rsage::rs_note(sprintf("%s을(를) 계산하지 못했습니다: %s", what, conditionMessage(e)), "warning", "deep_failed")))
    NULL
  })
  if (!is.null(ta) && nrow(ta$table)) {
    # A near copy of the target (|ρ|, η or V ≥ 0.95) would explain everything and hide the rest.
    copies <- ta$table$variable[ta$table$strength >= 0.95]
    preds <- setdiff(ta$table$variable, copies)
    if (length(copies) && (isTRUE(o$deep$model) || isTRUE(o$deep$subgroups))) {
      notes <- c(notes, list(rsage::rs_note(sprintf("목표 변수와 거의 같은 %s은(는) 빠른 모형과 하위집단에서 뺐습니다.",
                                                    paste(sprintf("'%s'", copies), collapse = ", ")), code = "target_copies")))
    }
    if (isTRUE(o$deep$model)) {
      deep$model <- attempt(quick_model(d, kinds, target, preds, o$seed, stats::setNames(ta$table$strength, ta$table$variable)), "빠른 모형")
      if (!is.null(deep$model$missing)) {
        notes <- c(notes, list(rsage::rs_note("빠른 모형에는 ranger 패키지가 필요합니다. install.packages(\"ranger\")로 설치하면 다음 실행부터 보입니다.", code = "ranger_missing")))
        deep$model <- NULL
      }
      sig <- c(sig, model_signals(target, deep$model, ta))
    }
    if (isTRUE(o$deep$subgroups)) {
      deep$tree <- attempt(subgroup_tree(d, kinds, target, preds), "하위집단 나무")
      sig <- c(sig, subgroup_signals(target, deep$tree, ta))
    }
    if (isTRUE(o$deep$interactions)) {
      extra <- c(utils::head(deep$model$table$variable[deep$model$table$relative >= 10], 3), deep$tree$vars)
      deep$ints <- attempt(interaction_scan(d, kinds, target, ta, skip = copies, extra = extra), "상호작용")
      sig <- c(sig, interaction_signals(target, deep$ints, ta))
    }
  }
  if (isTRUE(o$deep$clusters)) {
    deep$clusters <- attempt(cluster_scan(d, kinds, setdiff(rel, target), o$seed), "군집")
    sig <- c(sig, cluster_signals(deep$clusters))
  }
  if (isTRUE(o$deep$anomalies)) {
    deep$anomaly <- attempt(anomaly_scan(d, kinds, setdiff(rel, target)), "동떨어진 행")
    sig <- c(sig, anomaly_signals(deep$anomaly))
  }
  if (!is.null(compare)) {
    deep$compare <- attempt(compare_groups(d, kinds, compare, setdiff(rel, items)), "집단 비교")
    if (!is.null(deep$compare$error)) {
      notes <- c(notes, list(rsage::rs_note(deep$compare$error, "warning", "compare_unusable")))
      deep$compare <- NULL
    }
    sig <- c(sig, compare_signals(deep$compare, kinds, d))
  }

  # Rank: score, then n. One signal per kind and variable set.
  sig <- sig[order(-vapply(sig, `[[`, 1, "score"), -vapply(sig, function(s) if (is.na(s$n)) 0L else s$n, 1L))]
  for (i in seq_along(sig)) sig[[i]]$id <- sprintf("s%02d", i)

  # Cards: the strongest signals, no variable on more than two relation cards (besides the target).
  cards <- list()
  used <- character()
  pairwise <- c("association", "nonlinear", "outlier_driven", "redundant", "group_diff", "target", "missing_related",
                "interaction", "group_shift")
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
    p <- tryCatch(card_plot(d, s$draw, ta, deep), error = function(e) NULL)
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
    sugg <- s$suggestions
    # Findings come from the exploration rows; their check belongs on the held-out rows.
    if (!is.null(held)) sugg <- lapply(sugg, function(g) { g$dataset <- held$name; g })
    hints[[length(hints) + 1]] <- rsage::rs_hint(s$id, s$title, s$text, evidence = ev, kind = s$kind, variables = s$variables,
                                                 plot = pid, signal = s$id, suggestions = sugg)
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
  if (!is.null(held)) overview <- rbind(overview, data.frame(item = "확인용 데이터", value = sprintf("%s (%s행, 탐색에 쓰지 않음)", held$name, format(held$rows, big.mark = ","))))
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

  if (!is.null(deep$compare)) {
    cg <- deep$compare
    tab1 <- cg$table
    labs <- c(variable = "변수", level = "", stats::setNames(sprintf("%s (n=%d)", cg$levels, cg$n), paste0("g", seq_along(cg$levels))), smd = "SMD")
    tables[[length(tables) + 1]] <- rsage::rs_table(
      "table1", sprintf("'%s'에 따른 표 1 (초안)", compare), tab1, labels = labs, section = "집단 비교",
      notes = "수치는 평균 (SD), 치우친 변수(|왜도| ≥ 1)는 중앙값 [IQR], 범주는 n (%)입니다. SMD는 집단 쌍 가운데 가장 큰 값입니다.",
      description = "집단의 구성을 비교하는 초안입니다. 검정 p값은 넣지 않았습니다. 논문용 표는 변수와 표기를 고른 뒤 다시 만드세요.")
    pl <- card_plot(d, list(type = "smd"), ta, deep)
    if (!is.null(pl)) plots[[length(plots) + 1]] <- rsage::rs_plot(
      "smd", "집단 사이 표준화 평균 차이", pl, size = rsage::rs_figure_size(1, y_items = min(15, length(cg$smd)), label_chars = 14),
      section = "집단 비교", description = "점선은 0.1과 0.2입니다. 오른쪽으로 갈수록 집단 사이 차이가 큽니다.")
  }
  if (!is.null(deep$model)) {
    mt <- deep$model$table
    tables[[length(tables) + 1]] <- rsage::rs_table(
      "model", sprintf("빠른 모형: '%s' 예측에 도움이 되는 변수", target), mt,
      labels = c(variable = "변수", importance = "순열 중요도", relative = "상대 중요도(%)", marginal = "따로 본 관련 크기"),
      section = "더 깊은 탐색",
      notes = c(sprintf("ranger 랜덤포레스트, 나무 300그루, seed %d. %s = %s, n = %d.", o$seed, deep$model$perf$measure, fmt_num(deep$model$perf$value), deep$model$n),
                if (deep$model$filled > 0) sprintf("설명변수의 결측 %d칸은 중앙값이나 가장 많은 범주로 채워 적합했습니다.", deep$model$filled)),
      description = "변수 하나를 섞었을 때 예측이 얼마나 나빠지는지입니다. 효과의 크기나 방향, 원인을 뜻하지 않습니다. 따로 본 관련은 작은데 중요도가 크면 상호작용이나 곡선 관계를 의심해 보세요.")
    for (v in names(deep$model$pd)) {
      pl <- card_plot(d, list(type = "pd", x = v), ta, deep)
      plots[[length(plots) + 1]] <- rsage::rs_plot(paste0("pd-", make.names(v)), sprintf("부분 의존: %s", v), pl, width = 4.4, height = 2.9,
                                                   section = "더 깊은 탐색", description = "다른 변수는 그대로 두고 이 변수만 바꿨을 때 모형의 평균 예측입니다.")
    }
  }
  if (!is.null(deep$tree)) {
    tt <- deep$tree$table
    tables[[length(tables) + 1]] <- rsage::rs_table(
      "subgroups", sprintf("하위집단: '%s'가 다른 집단", target), tt,
      labels = c(rule = "집단", n = "n", value = if (deep$tree$numeric) "평균" else sprintf("'%s' 비율(%%)", deep$tree$event),
                 diff = if (deep$tree$numeric) "전체와의 차이(SD 단위)" else "전체와의 차이(%p)"),
      section = "더 깊은 탐색",
      notes = sprintf("rpart 회귀나무(깊이 3 이하, 집단마다 %s명 이상). 전체 %s = %s.", "최소 5% 또는 20",
                      if (deep$tree$numeric) "평균" else "비율(%)", fmt_num(deep$tree$overall, 1)),
      description = "데이터에 맞춰 고른 경계라 다른 데이터에서는 달라질 수 있습니다. 어떤 변수의 조합에서 다른지를 가설로 보세요.")
  }
  if (length(deep$ints)) {
    it <- do.call(rbind, lapply(deep$ints, function(x) data.frame(a = x$a, b = x$b, add = x$add, delta = x$delta, n = x$n)))
    it <- it[order(-it$delta), , drop = FALSE]
    tables[[length(tables) + 1]] <- rsage::rs_table(
      "interactions", sprintf("상호작용: '%s'와의 관계가 다른 변수에 따라 달라지는가", target), it,
      labels = c(a = "변수 1", b = "변수 2", add = "더한 모형 R²", delta = "곱한 항을 넣었을 때 ΔR²", n = "n"),
      section = "더 깊은 탐색", notes = "목표 변수와 관련이 있는 상위 6개 변수와, 빠른 모형·하위집단 나무가 쓴 변수의 모든 쌍입니다. 이분·개수 결과는 의사 R²(McFadden)입니다.",
      description = "ΔR²가 0.02 이상이면 카드로 올렸습니다. 많은 쌍을 봤으므로 회귀에서 확인하세요.")
  }
  if (!is.null(deep$clusters$best) && deep$clusters$best$sil >= 0.5) {
    cp <- deep$clusters$profile
    k <- deep$clusters$best$k
    names(cp)[3:(2 + k)] <- paste0("c", seq_len(k))
    tables[[length(tables) + 1]] <- rsage::rs_table(
      "clusters", "무리마다 다른 변수 (표준화 평균)", utils::head(cp, 15),
      labels = c(variable = "변수", spread = "무리 사이 차이", stats::setNames(sprintf("무리 %d (n=%d)", seq_len(k), as.integer(table(deep$clusters$best$cluster))), paste0("c", seq_len(k)))),
      section = "더 깊은 탐색", notes = sprintf("주성분 %d개(분산 80%% 이상)로 k-평균(k = 2~5), 평균 실루엣이 가장 큰 k를 골랐습니다.", ncol(deep$clusters$pc)),
      description = "값은 변수마다 표준화한 평균(0 = 전체 평균, 1 = 1 SD)입니다.")
  }
  if (!is.null(deep$anomaly$table) && length(Filter(function(s) s$kind == "anomaly", sig))) {
    tables[[length(tables) + 1]] <- rsage::rs_table(
      "anomalies", "찾은 이상 사례", deep$anomaly$table,
      labels = c(row = "행 번호", distance = "Mahalanobis 거리", unusual = "가장 동떨어진 변수"),
      section = "더 깊은 탐색", description = "행 번호는 원래 데이터의 행입니다. z는 그 변수의 표준화 값입니다.")
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
               top = "가장 많은 값", levels = "범주 (많은 순)", memo = "메모"),
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
    tables = tables, plots = plots, notes = notes, options = o, exports = exports,
    packages = c("rsageExplore", "datawizard", "ggplot2"),
    sections = SECTIONS, hints = hints
  )
}
