# Path analysis and exploratory causal graphs for several observed
# variables. Variables sit in ordered tiers; the structure is learned
# (bnlearn), saturated or given; lavaan or blavaan estimates it; effects are
# split into direct and indirect parts and the other variables are sorted
# into confounders, mediators and colliders. See docs/modules/path.md.

#' Default options
defaults <- function() {
  list(
    variables = list(background = character(), early = character(), middle = character(), outcome = character()),
    structure = list(source = "learned", algorithm = "hc", score = "bic", alpha = "0.05", bootstrap = 200L, threshold = "auto",
                     withinTier = "covary", required = list(), forbidden = list()),
    paths = list(),
    focus = list(exposure = NULL, outcome = NULL),
    estimation = list(method = "ml", scale = "standardized", missing = "listwise", inference = "bootstrap", bootstrap = 1000L,
                      bayes = list(prior = "moderate", chains = 3L, burnin = 1000L, draws = 1000L)),
    confirm = list(enabled = FALSE, fraction = "0.5"),
    seed = 2026L,
    output = list(coefficients = TRUE, r2 = TRUE, allEffects = TRUE),
    fit = list(indices = TRUE, bollenStine = FALSE, modindices = FALSE),
    covariates = list(guide = TRUE),
    plots = list(diagram = TRUE, stability = TRUE, effects = TRUE, labels = "std"),
    export = list(model = list(enabled = FALSE, saveAs = "path_model"))
  )
}

SECTIONS <- c("분석 개요", "구조 찾기", "경로 계수", "효과 분해", "공변인 안내", "모형 적합", "재현 정보")
SOURCE_LABEL <- c(learned = "데이터에서 찾기", saturated = "가능한 경로 모두 (포화)", specified = "직접 지정")
REGRESSION <- "org.rsage.regression/regression"

#' Path analysis and exploratory causal graph
#'
#' @param data A data frame.
#' @param options A list of options; see defaults(). Missing entries take their default.
#' @return An rsage result.
#' @examples
#' analyse(mtcars, list(variables = list(background = "cyl", early = "wt", middle = "hp", outcome = "mpg"),
#'                      structure = list(source = "saturated"), focus = list(exposure = "wt", outcome = "mpg")))
analyse <- function(data, options = list()) {
  stopifnot(is.data.frame(data))
  o <- rsage::rs_merge_options(options, defaults())
  src <- o$structure$source %||% "learned"
  if (!src %in% names(SOURCE_LABEL)) src <- "learned"
  tier <- tier_of(o)
  path_vars <- unique(unlist(lapply(rows_of(o$paths), function(r) c(one(r$from), one(r$to)))))
  vars <- unique(c(names(tier), if (src == "specified") path_vars))
  focus_x <- one(o$focus$exposure)
  focus_y <- one(o$focus$outcome)
  unknown <- setdiff(c(vars, focus_x, focus_y), names(data))
  if (length(unknown)) stop("데이터에 없는 변수: ", paste(unique(unknown), collapse = ", "))

  notes <- list()
  tables <- list()
  plots <- list()
  hints <- list()
  add <- function(x) {
    if (is.null(x)) return(invisible())
    if (inherits(x, "rsage_table")) tables[[x$id]] <<- x
    else if (inherits(x, "rsage_plot")) plots[[x$id]] <<- x
    else if (inherits(x, "rsage_note")) notes[[length(notes) + 1]] <<- x
    else if (inherits(x, "rsage_hint")) hints[[length(hints) + 1]] <<- x
    else if (is.list(x)) for (i in x) add(i)
  }
  used <- c("rsagePath", "lavaan")
  finish <- function(exports = list(), info = list()) {
    rsage::rs_result("path", "경로 분석", tables = unname(tables), plots = unname(plots), notes = notes, hints = hints,
                     options = o, packages = unique(used[vapply(used, has, TRUE)]), exports = exports, sections = SECTIONS,
                     data_info = c(list(variables = vars), info))
  }

  dup <- names(tier)[duplicated(names(tier))]
  if (length(dup)) {
    add(note(sprintf("한 변수를 두 단계에 넣었습니다: %s", paste(unique(dup), collapse = ", ")), "path_need_variables"))
    return(finish())
  }

  prep <- prepare_columns(data, vars)
  for (v in names(prep$recoded)) add(note(sprintf("%s: %s", v, prep$recoded[[v]]), "path_recoded", "info"))
  if (length(prep$dropped))
    add(note(sprintf("모형에서 뺀 변수: %s", paste(sprintf("%s (%s)", names(prep$dropped), unlist(prep$dropped)), collapse = ", ")), "path_dropped_variable"))
  vars <- prep$vars
  if (length(vars) < 2) {
    add(note(if (src == "specified") "경로 목록에 경로를 넣으세요 (보내는 변수 → 받는 변수)." else "단계 상자에 변수를 둘 이상 넣으세요. 먼저 정해지는 변수일수록 앞 단계에 넣습니다.", "path_need_variables"))
    return(finish())
  }

  # Rows: complete cases, or every row with something observed under FIML.
  fiml <- identical(o$estimation$missing, "fiml")
  raw <- prep$data[vars]
  complete <- stats::complete.cases(raw)
  keep <- if (fiml) rowSums(!is.na(raw)) > 0 else complete
  if (sum(complete) < 5) {
    add(note(sprintf("결측이 없는 행이 %d개뿐이라 분석할 수 없습니다.", sum(complete)), "path_need_variables"))
    return(finish())
  }
  standardized <- !identical(o$estimation$scale, "raw")
  # Split-sample confirmation: the structure is found on one part of the
  # complete rows and estimated on the rest, so the fit does not reuse the
  # rows that chose the structure.
  split <- if (isTRUE(o$confirm$enabled)) split_rows(complete, keep, o) else NULL
  if (!is.null(split$problem)) {
    add(note(split$problem, "path_split_too_small"))
    split <- NULL
  }
  find_rows <- if (is.null(split)) complete else split$find
  fit_rows <- if (is.null(split)) keep else split$fit
  d <- raw[fit_rows, , drop = FALSE]
  if (standardized) d <- standardize(d)
  add(rsage::rs_table("sample", "분석 표본", data.frame(
    item = c("데이터 행", "모든 변수가 관측된 행",
             if (!is.null(split)) c(sprintf("구조 찾기에 쓴 행 (찾기용 %.0f%%)", 100 * split$fraction), "추정에 쓴 행 (확인용)") else "추정에 쓴 행",
             if (fiml) "결측이 있는 행 (FIML로 사용)" else "결측으로 뺀 행"),
    n = c(nrow(data), sum(complete), if (!is.null(split)) c(sum(split$find), sum(split$fit)) else sum(keep),
          if (fiml) sum(fit_rows & !complete) else sum(!complete))),
    labels = c(item = "항목", n = "행 수"), section = "분석 개요",
    notes = c(if (standardized) "모든 변수를 평균 0, 표준편차 1로 바꿔 적합했습니다. 계수는 표준편차 단위입니다.",
              if (!is.null(split)) sprintf("결측 없는 행을 seed %d로 무작위로 나눴습니다. 두 부분은 겹치지 않습니다. 같은 seed와 비율이면 늘 같은 행으로 나뉩니다.", as.integer(num(o$seed, 2026)))),
    description = if (is.null(split)) "경로 모형에 쓴 행입니다. 구조 찾기는 늘 결측이 없는 행으로 합니다."
                  else "찾기용 행으로 구조를 정하고, 겹치지 않는 확인용 행으로 계수·구간·적합도를 추정했습니다."))

  # Structure.
  learned <- NULL
  if (src == "specified") {
    sp <- specified_graph(o$paths, vars)
    if (length(sp$problems)) {
      add(note(paste(sp$problems, collapse = " / "), "path_invalid_paths"))
      return(finish())
    }
    edges <- sp$edges
    reg0 <- edges[edges$type == "regression", , drop = FALSE]
    back <- reg0[reg0$from %in% names(tier) & reg0$to %in% names(tier), , drop = FALSE]
    back <- back[tier[back$from] > tier[back$to], , drop = FALSE]
    if (nrow(back)) add(note(sprintf("단계 순서를 거스르는 경로가 있습니다: %s. 그대로 추정하지만 순서를 다시 확인하세요.",
                                     paste(back$from, "→", back$to, collapse = ", ")), "path_against_tiers"))
    # Variables without a tier are placed by their depth along the arrows.
    tier <- if (all(vars %in% names(tier))) tier[vars] else depth_of(vars, reg0)
  } else {
    if (length(unique(tier[vars])) < 2)
      add(note("모든 변수가 한 단계에 있어 화살표 방향을 정할 수 없습니다. 연결은 상관(↔)으로만 둡니다. 먼저 정해지는 변수를 앞 단계로 옮기세요.", "path_one_tier"))
    kp <- knowledge_problems(o, vars, tier)
    if (length(kp)) {
      add(note(paste(kp, collapse = " / "), "path_invalid_paths"))
      return(finish())
    }
    if (src == "learned" && !has("bnlearn")) {
      add(note("bnlearn 패키지가 없어 구조를 찾지 못했습니다. 단계 순서상 가능한 경로를 모두 넣은 모형으로 대신합니다. install.packages(\"bnlearn\")", "path_backend_missing"))
      src <- "saturated"
    }
    if (src == "learned") {
      used <- c(used, "bnlearn")
      if (sum(find_rows) < 5 * length(vars))
        add(note(sprintf("변수 %d개에 구조 찾기에 쓴 행이 %d개입니다(변수당 5행 미만). 찾은 연결이 표본에 따라 크게 바뀔 수 있습니다. 연결 강도 표를 함께 보세요.",
                         length(vars), sum(find_rows)), "path_unstable_learning"))
      dl <- raw[find_rows, , drop = FALSE]
      if (standardized) dl <- standardize(dl)
      learned <- tryCatch(learned_graph(dl, vars, tier, o), error = function(e) e)
      if (inherits(learned, "error")) {
        add(note(sprintf("구조를 찾지 못했습니다: %s. 가능한 경로를 모두 넣은 모형으로 대신합니다.", conditionMessage(learned)), "path_component_failed"))
        learned <- NULL
        src <- "saturated"
      }
    }
    edges <- if (src == "learned") learned$edges else saturated_graph(vars, tier, o)
  }
  if (!is.null(learned)) {
    lt <- learned$table
    add(rsage::rs_table("stability", "연결 안정성", data.frame(
      from = lt$from, to = lt$to, link = ifelse(lt$type == "regression", "→", "↔"), strength = lt$strength,
      direction = ifelse(lt$basis == "데이터 (불안정)", lt$direction, NA_real_), basis = lt$basis,
      adopted = ifelse(lt$adopted, "채택", "")),
      labels = c(from = "변수 1", to = "변수 2", link = "연결", strength = "연결 강도", direction = "방향 비율", basis = "방향을 정한 근거", adopted = "모형에 넣음"),
      notes = c(sprintf("%s 알고리즘, 재표집 %d회, %s %d행. 채택 기준: 연결 강도 ≥ %.2f%s.", learned$algorithm, learned$R, if (is.null(split)) "결측 없는" else "찾기용", learned$n, learned$threshold,
                        if (learned$auto) " (자동, Scutari·Nagarajan)" else ""),
                "연결 강도 = 재표집한 자료에서 두 변수가 직접 이어진 비율. 방향 비율 = 이어졌을 때 표의 방향인 비율(같은 단계 안에서 데이터로 방향을 정할 때만)."),
      section = "구조 찾기",
      description = "강도가 1에 가까울수록 어떤 표본에서든 나오는 연결이고, 0.5 근처는 표본에 따라 있다 없다 하는 연결입니다. 방향은 단계 순서에서 왔고 데이터가 정한 것이 아닙니다."))
    if (isTRUE(o$plots$stability)) {
      lay <- node_layout(vars, tier)
      sp <- stability_plot(learned$table, lay, learned$threshold)
      if (!is.null(sp)) add(rsage::rs_plot("stability", "찾은 연결과 강도", sp, size = diagram_size(lay, max(nchar(vars))), section = "구조 찾기",
        alt = "단계별로 놓인 변수와 재표집 연결 강도를 선 굵기로 그린 그림",
        description = "선이 굵고 진할수록 자주 나온 연결입니다. 회색 점선은 기준에 못 미쳐 모형에 넣지 않은 연결입니다. 숫자는 연결 강도입니다."))
    }
  }
  if (src != "specified") add(note(paste("찾은(또는 가정한) 구조는 확인할 가설입니다. 화살표 방향은 정한 단계 순서에서 왔고, 측정하지 않은 교란변수가 있으면 틀릴 수 있습니다.",
    if (is.null(split)) "같은 자료로 구조를 정하고 추정했으므로 구간과 적합도는 낙관적입니다."
    else if (src == "learned") "구조는 찾기용 행에서 정하고 추정은 겹치지 않는 확인용 행에서 했으므로, 같은 자료를 두 번 써서 생기는 낙관은 없습니다. 대신 행이 줄어 구간이 넓습니다."
    else "구조를 데이터로 찾지 않았으므로 확인용 행만 쓴 것은 앞서 찾기용 행으로 구조를 정했을 때만 의미가 있습니다."), "path_exploratory", "info"))
  if (!is.null(split) && src == "specified") add(note(sprintf("확인용 %d행만으로 추정했습니다. 찾기용 %d행은 쓰지 않았습니다. 이 경로 목록을 찾기용 행에서 얻었다면 이 결과가 그 구조의 확인입니다.",
                                                      sum(split$fit), sum(split$find)), "path_split", "info"))

  parts <- model_parts(edges)
  isolated <- setdiff(vars, parts$vars)
  if (length(isolated)) add(note(sprintf("다른 변수와 경로로 이어지지 않아 모형에서 뺀 변수: %s", paste(isolated, collapse = ", ")), "path_isolated", "info"))
  if (!nrow(parts$reg)) {
    add(note("화살표(→)로 이어진 경로가 없어 경로 모형을 추정하지 않았습니다. 단계를 다시 나누거나 채택 기준을 낮춰 보세요.", "path_no_paths"))
    return(finish())
  }
  mvars <- parts$vars
  map <- safe_names(mvars)
  dm <- d[mvars]
  names(dm) <- unname(map[mvars])
  syn <- build_syntax(parts, map)
  if (syn$lavaanExtra) used <- c(used, "lavaanExtra")

  # Fit.
  bayes <- identical(o$estimation$method, "bayes")
  if (bayes && !has("blavaan")) {
    add(note("blavaan 패키지가 없어 최대우도(ML)로 추정했습니다. install.packages(\"blavaan\")", "path_backend_missing"))
    bayes <- FALSE
  }
  f <- if (bayes) fit_bayes(syn$model, dm, o) else fit_ml(syn$model, dm, o)
  if (!is.null(f$error) && syn$lavaanExtra) {
    syn$model <- syn$own
    f <- if (bayes) fit_bayes(syn$model, dm, o) else fit_ml(syn$model, dm, o)
  }
  inv <- stats::setNames(names(map), map)
  add(rsage::rs_table("syntax", "모형 문법 (lavaan)", data.frame(line = strsplit(gsub("\n+$", "", syn$model), "\n")[[1]]),
    labels = c(line = "문법"), section = "재현 정보",
    notes = c(if (any(map != names(map))) paste("이름 바꿈:", paste(sprintf("%s = %s", map[map != names(map)], names(map)[map != names(map)]), collapse = ", ")),
              if (syn$lavaanExtra) "lavaanExtra::write_lavaan()으로 만든 문법입니다."),
    description = "추정에 쓴 경로 모형입니다. `~`는 화살표(오른쪽 변수 → 왼쪽 변수), `~~`는 상관입니다. 이 문법을 고쳐 직접 지정 모드나 R 코드로 다시 볼 수 있습니다."))
  if (!is.null(f$error)) {
    add(note(sprintf("모형을 추정하지 못했습니다: %s", f$error), "path_fit_failed"))
    return(finish())
  }
  if (bayes) used <- c(used, "blavaan")
  fit <- f$fit
  N <- lavaan::lavInspect(fit, "nobs")
  q <- lavaan::lavInspect(fit, "npar")
  if (!f$converged) add(note(if (bayes) "일부 모수의 Rhat이 1.05를 넘어 사슬이 수렴하지 않았습니다. 반복(burn-in, 표본)을 늘리세요." else "모형 추정이 수렴하지 않았습니다. 결과를 정상 결과로 읽지 않습니다.", "path_not_converged"))
  if (N / q < 10) add(note(sprintf("표본 %d행에 추정할 모수가 %d개입니다 (N:q = %.1f). %s 변수나 경로를 줄이거나%s 결과를 매우 조심스럽게 읽으세요.",
                                   N, q, N / q, if (N / q < 5) "모수 하나당 5행도 안 되어 추정이 매우 불안정합니다." else "흔히 권하는 10:1보다 작습니다.",
                                   if (bayes) "" else " 베이지안 추정(사전분포)을 쓰거나"), "path_small_sample"))
  ignored <- f$warnings[!grepl("bootstrap|some bootstrap runs failed", f$warnings, ignore.case = TRUE)]
  if (length(ignored)) add(note(paste("lavaan 경고:", paste(utils::head(ignored, 3), collapse = " / ")), "path_backend_warning", "info"))

  ct <- coef_table(f, parts, map, o)
  attr(ct, "fit") <- fit
  if (!is.null(learned)) add(structure_hint(edges, ct, o, split))
  df <- tryCatch(as.numeric(lavaan::fitMeasures(fit, "df")), error = function(e) NA_real_)

  # Overview.
  ov <- data.frame(item = c("구조", "단계", "추정", "효과 구간", "N", "자유 모수 q", "N:q", "경로 · 상관"),
    value = c(paste0(SOURCE_LABEL[[src]], if (!is.null(split)) sprintf(" · 확인용 분할 (찾기 %d행 / 추정 %d행)", sum(split$find), sum(split$fit)) else ""),
              paste(vapply(sort(unique(tier[mvars])), function(t) sprintf("%s: %s", if (t <= 4 && src != "specified") TIERS[[t]] else paste0(t, "열"), paste(mvars[tier[mvars] == t], collapse = ", ")), ""), collapse = " / "),
              if (bayes) sprintf("베이지안 (blavaan), 경로 사전분포 %s", f$prior) else sprintf("최대우도%s%s", if (identical(o$estimation$inference, "robust")) " (MLR)" else "", if (fiml) ", FIML" else ""),
              if (bayes) "사후분포 95% 신용구간" else if (identical(f$inference, "bootstrap")) sprintf("부트스트랩 백분위 (%d회)", nrow(f$draws %||% matrix(0, 0, 0))) else sprintf("몬테카를로 (%d회)", nrow(f$draws %||% matrix(0, 0, 0))),
              N, q, sprintf("%.1f", N / q), sprintf("%d · %d", nrow(parts$reg), nrow(parts$cov))),
    stringsAsFactors = FALSE)
  add(rsage::rs_table("overview", "분석 개요", ov, labels = c(item = "항목", value = "내용"), section = "분석 개요",
    description = "무엇을 어떤 구조로 추정했는지 먼저 확인합니다. N:q가 10보다 작으면 작은 표본에서 모형이 큰 편입니다."))

  if (isTRUE(o$output$coefficients)) {
    lab <- c(path = "경로", kind = "종류", est = if (bayes) "사후 평균" else "추정값", se = if (bayes) "사후 SD" else "표준오차",
             ci.lower = "95% 하한", ci.upper = "95% 상한")
    tab <- ct[, intersect(c("path", "kind", "est", "se", "ci.lower", "ci.upper", "p", "std", "rhat"), names(ct)), drop = FALSE]
    if (!bayes) lab <- c(lab, p = "p", std = "표준화 계수")
    else lab <- c(lab, rhat = "Rhat")
    add(rsage::rs_table("coefficients", "경로 계수", tab, labels = lab, section = "경로 계수",
      notes = c(if (standardized) "표준화한 자료로 적합해 추정값이 표준편차 단위입니다." else "원래 단위의 계수입니다. 표준화 계수 열로 크기를 비교합니다.",
                if (!bayes && identical(f$inference, "bootstrap")) "구간은 부트스트랩 백분위 구간입니다."),
      description = "화살표(→) 계수는 다른 화살표를 고정했을 때 앞 변수 1단위(표준편차) 변화에 따른 뒤 변수의 변화입니다. 상관(↔)은 방향을 정하지 않은 연결의 잔차 공분산입니다. 구간이 0을 포함하면 이 자료로는 방향을 확신할 수 없습니다."))
  }
  if (isTRUE(o$output$r2)) {
    r2 <- tryCatch(lavaan::lavInspect(fit, "r2"), error = function(e) NULL)
    if (length(r2)) add(rsage::rs_table("r2", "설명된 분산 (R²)", data.frame(variable = unname(inv[names(r2)]), r2 = unname(r2)),
      labels = c(variable = "변수", r2 = "R²"), section = "경로 계수",
      description = "각 변수의 분산 중 들어오는 화살표로 설명되는 비율입니다."))
  }
  if (isTRUE(o$plots$diagram)) {
    lay <- node_layout(mvars, tier)
    dp <- diagram_plot(ct, lay, o$plots$labels %||% "std", map)
    if (dp$backend == "tidySEM") used <- c(used, "tidySEM")
    else if (has("tidySEM") && !is.null(dp$error)) add(note(paste("tidySEM으로 그리지 못해 ggplot2로 그렸습니다:", dp$error), "path_component_failed", "info"))
    add(rsage::rs_plot("diagram", "경로 그림", dp$plot, size = diagram_size(lay, max(nchar(mvars))), section = "경로 계수",
      alt = "단계별로 놓인 변수와 추정한 경로 계수를 그린 경로 그림",
      description = "왼쪽에서 오른쪽으로 단계 순서입니다. 파랑은 양, 빨강은 음의 관계이고, 실선은 95% 구간이 0을 포함하지 않는 경로, 점선은 포함하는 경로입니다. 숫자는 표준화 계수입니다."))
  }

  # Effects for the focus pair.
  reg <- parts$reg
  if (!is.null(focus_x) || !is.null(focus_y)) {
    if (is.null(focus_x) || is.null(focus_y) || focus_x == focus_y) {
      add(note("효과를 나누려면 노출(X)과 결과(Y)를 서로 다른 변수로 고르세요.", "path_focus_needed", "info"))
    } else if (!focus_x %in% mvars || !focus_y %in% mvars) {
      add(note(sprintf("%s 모형에 없어 효과를 나누지 못했습니다.", josa(paste(setdiff(c(focus_x, focus_y), mvars), collapse = ", "), c("이", "가"))), "path_no_route"))
    } else {
      fe <- focus_effects(f, focus_x, focus_y, reg, map, unname(map[mvars]))
      if (!fe$has_route) {
        add(note(sprintf("이 그래프에는 %s에서 %s로 가는 화살표 경로가 없습니다. %s",
                         focus_x, focus_y, if (tier[[focus_x]] >= tier[[focus_y]]) "X가 Y보다 앞 단계에 있는지 확인하세요." else "두 변수는 직접도 간접도 이어지지 않는 것으로 추정되었습니다."), "path_no_route"))
      } else {
        if (fe$many) add(note(sprintf("간접 경로가 %d개라 크기가 큰 20개만 보입니다. 간접효과 합은 모든 경로를 더한 값입니다.", fe$n_routes), "path_many_routes", "info"))
        et <- fe$table
        add(rsage::rs_table("effects", sprintf("%s → %s 효과 분해", focus_x, focus_y), et[, c("component", "est", "ci.lower", "ci.upper", "share")],
          labels = c(component = "효과", est = "추정값", ci.lower = "95% 하한", ci.upper = "95% 상한", share = "총효과 중 비율(%)"),
          section = "효과 분해",
          notes = c("총효과 = 직접효과 + 간접효과 합. 경로별 간접효과는 그 경로 위 계수의 곱입니다.",
                    "비율은 효과의 부호가 서로 다르면 100%를 넘거나 음수가 될 수 있습니다."),
          description = "직접효과는 다른 변수를 거치지 않는 부분, 간접효과는 중간 변수를 거쳐 가는 부분입니다. 구간이 0을 포함하지 않는 간접 경로가 그 연결이 다른 변수를 통한다는 근거입니다."))
        if (isTRUE(o$plots$effects)) add(rsage::rs_plot("effects", sprintf("%s → %s 효과", focus_x, focus_y), effects_plot(et, focus_x, focus_y),
          size = rsage::rs_figure_size(y_items = nrow(et), label_chars = max(nchar(et$component)), legend = FALSE), section = "효과 분해",
          alt = "직접효과, 경로별 간접효과, 간접효과 합, 총효과의 점과 95% 구간",
          description = "점은 추정값, 가로선은 95% 구간입니다. 세로선(0)을 넘지 않는 구간이 0과 구별되는 효과입니다."))
        tot <- et[et$kind == "total", ]
        ind <- et[et$kind == "indirect_total", ]
        dir <- et[et$kind == "direct", ]
        share <- if (abs(tot$est) > 1e-8) 100 * ind$est / tot$est else NA
        add(rsage::rs_hint("effect", if (is.finite(share)) sprintf("%s → %s: 총효과의 %.0f%%가 다른 변수를 거칩니다", focus_x, focus_y, share)
                           else sprintf("%s → %s 효과 분해", focus_x, focus_y),
          text = sprintf("직접효과 %s, 간접효과 합 %s입니다. 간접 경로 중 가장 큰 것은 %s입니다. 경로 모형이 맞다는 가정 아래의 분해입니다.",
                         fmt(dir$est), fmt(ind$est), if (fe$n_routes) et$component[et$kind == "indirect"][1] else "없음"),
          evidence = sprintf("총효과 %s [%s, %s], %s, 간접 %s [%s, %s]", fmt(tot$est), fmt(tot$ci.lower), fmt(tot$ci.upper),
                             if (is.na(dir$ci.lower)) "직접 화살표 없음" else sprintf("직접 %s [%s, %s]", fmt(dir$est), fmt(dir$ci.lower), fmt(dir$ci.upper)),
                             fmt(ind$est), fmt(ind$ci.lower), fmt(ind$ci.upper)),
          kind = "mediation", variables = c(focus_x, focus_y), plot = if (isTRUE(o$plots$effects)) "effects"))
      }
      if (isTRUE(o$covariates$guide)) {
        add(covariate_items(focus_x, focus_y, mvars, reg, parts$cov, data, prep))
        if (has("dagitty")) used <- c(used, "dagitty")
      }
    }
  } else {
    add(note("노출(X)과 결과(Y)를 고르면 직접·간접효과를 나누고 공변인을 안내합니다.", "path_focus_needed", "info"))
  }

  if (isTRUE(o$output$allEffects)) {
    ae <- tryCatch(all_effects(f, reg, map, unname(map[mvars]), mvars), error = function(e) NULL)
    if (!is.null(ae) && nrow(ae)) add(rsage::rs_table("all_effects", "모든 변수 쌍의 효과", ae,
      labels = c(from = "앞 변수", to = "뒤 변수", direct = "직접", indirect = "간접", total = "총효과", ci.lower = "총효과 95% 하한", ci.upper = "총효과 95% 상한"),
      section = "효과 분해",
      description = "화살표 경로로 이어진 모든 쌍입니다. 직접이 0이고 간접만 있으면 두 변수는 다른 변수를 거쳐서만 이어집니다. 총효과 크기 순입니다."))
  }

  if (isTRUE(o$fit$indices)) add(fit_items(f, df, bayes))
  if (isTRUE(o$fit$modindices)) {
    if (bayes) add(note("수정지수는 최대우도 추정에서만 계산합니다.", "path_modindices_ml", "info"))
    else add(modindices_table(fit, tier, inv, o))
  }

  pk <- c(sprintf("구조: %s", SOURCE_LABEL[[src]]),
          if (!is.null(learned)) sprintf("구조 찾기: bnlearn::boot.strength(algorithm = \"%s\", R = %d), 기준 %.3f, seed %d", learned$algorithm, learned$R, learned$threshold, as.integer(num(o$seed, 2026))),
          if (bayes) sprintf("blavaan::bsem, 사슬 %s, burn-in %s, 표본 %s, 사전분포 beta ~ %s, seed %d", o$estimation$bayes$chains, o$estimation$bayes$burnin, o$estimation$bayes$draws, f$prior, as.integer(num(o$seed, 2026)))
          else sprintf("lavaan::sem(%s%s), seed %d", switch(f$inference, bootstrap = sprintf("se = \"bootstrap\", bootstrap = %d", f$R), robust = "estimator = \"MLR\"", "se = \"standard\""),
                       if (fiml) ", missing = \"fiml\"" else "", as.integer(num(o$seed, 2026))),
          if (!is.null(split)) sprintf("확인용 분할: 결측 없는 행의 %.0f%%로 구조 찾기, 나머지로 추정 (seed %d)", 100 * split$fraction, as.integer(num(o$seed, 2026))),
          sprintf("자료: %s, N = %d", if (standardized) "표준화" else "원래 단위", N))
  add(rsage::rs_table("provenance", "재현 정보", data.frame(item = pk), labels = c(item = "항목"), section = "재현 정보",
    description = "같은 결과를 다시 얻는 데 필요한 조건입니다. 패키지 버전은 아래 줄에 있습니다."))

  exports <- list()
  if (isTRUE(o$export$model$enabled)) exports[[o$export$model$saveAs %||% "path_model"]] <- fit
  finish(exports, list(n = N, structure = src, model = syn$model))
}

covariate_items <- function(x, y, vars, reg, cov, data, prep) {
  out <- list()
  roles <- covariate_roles(x, y, vars, reg, cov)
  if (nrow(roles)) out[[length(out) + 1]] <- rsage::rs_table("roles", sprintf("%s → %s에서 다른 변수의 역할", x, y), roles,
    labels = c(variable = "변수", role = "역할", advice = "총효과를 볼 때", why = "이유"), section = "공변인 안내",
    notes = "이 그래프가 맞다는 가정 아래의 분류입니다. 그래프에 없는 변수(측정하지 않은 교란변수)는 고려하지 못합니다.",
    description = "X가 Y에 주는 총효과를 회귀로 볼 때, 교란변수는 넣고 매개변수·충돌변수는 넣지 않습니다. 결과의 다른 원인은 넣으면 추정이 더 정밀해집니다.")
  sets <- adjustment_sets(x, y, vars, reg, cov)
  set_text <- function(s) if (is.null(s)) "구할 수 없음" else if (!length(s)) "없음" else vapply(s, function(z) if (length(z)) paste(z, collapse = ", ") else "(보정할 변수 없음)", "")
  tot <- set_text(sets$total)
  dir <- set_text(sets$direct)
  out[[length(out) + 1]] <- rsage::rs_table("adjustment", "최소 보정 집합", data.frame(
    effect = c(rep("총효과", length(tot)), rep("직접효과", length(dir))), set = c(tot, dir), stringsAsFactors = FALSE),
    labels = c(effect = "추정할 효과", set = "함께 넣을 공변인"), section = "공변인 안내",
    notes = if (sets$method == "dagitty") "dagitty::adjustmentSets(type = \"minimal\")로 구했습니다. 같은 효과에 집합이 여럿이면 어느 것을 써도 됩니다."
            else "dagitty가 없어 노출의 부모(총효과)와 결과의 다른 부모(직접효과)를 보정 집합으로 적었습니다. 관측 변수만 있는 그래프에서 유효합니다. install.packages(\"dagitty\")",
    description = "이 집합을 공변인으로 넣은 회귀에서 X의 계수가 그래프가 뜻하는 X → Y 효과입니다. 집합이 '구할 수 없음'이면 상관(↔) 연결 때문에 관측 변수만으로는 보정할 수 없습니다.")

  adjust <- if (length(sets$total)) sets$total[[1]] else NULL
  if (!is.null(adjust)) {
    out[[length(out) + 1]] <- rsage::rs_hint("covariates",
      if (length(adjust)) sprintf("%s → %s를 볼 때 넣을 공변인: %s", x, y, paste(adjust, collapse = ", ")) else sprintf("%s → %s: 보정할 공변인이 없습니다", x, y),
      text = paste0(if (length(adjust)) "이 변수들은 X와 Y 모두에 앞서는 교란 경로를 막습니다. " else "그래프상 X와 Y를 함께 움직이는 앞선 변수가 없습니다. ",
                    if (any(roles$role == "매개변수")) sprintf("매개변수(%s)는 총효과를 볼 때 넣지 않습니다. ", paste(roles$variable[roles$role == "매개변수"], collapse = ", ")) else "",
                    "그래프가 맞다는 가정 아래의 제안입니다."),
      evidence = paste("보정 집합:", tot[1]), kind = "covariates", variables = c(x, y, adjust),
      suggestions = list(regression_suggestion(y, c(x, adjust), data, prep)))
  }
  out
}

# Regression module options: y on x and the adjustment set.
regression_suggestion <- function(y, preds, data, prep) {
  is_cat <- vapply(preds, function(v) is.factor(data[[v]]) || is.character(data[[v]]), TRUE)
  continuous <- preds[!is_cat]
  categorical <- preds[is_cat]
  yk <- prep$info[[y]]$kind %||% "numeric"
  family <- if (yk %in% c("binary", "binary01")) "binomial" else "gaussian"
  terms <- lapply(preds, function(v) list(id = paste0("m:", v), kind = "main", variable = v))
  o <- list(outcome = list(variable = y), model = list(family = family),
            predictors = list(continuous = I(as.character(continuous)), categorical = I(as.character(categorical))),
            terms = terms, models = list(list(id = "m1", label = "모형 1", termIds = I(paste0("m:", preds)), intercept = TRUE)))
  if (family == "binomial" && (is.factor(data[[y]]) || is.character(data[[y]]))) o$outcome$event <- prep$info[[y]]$levels[2]
  model <- if (family == "binomial") "로지스틱 회귀" else "선형 회귀"
  rsage::rs_suggest(if (length(preds) > 1) sprintf("이 공변인으로 %s 열기", model) else sprintf("%s 열기 (공변인 없이)", model), REGRESSION, o,
                    title = sprintf("%s ← %s (보정)", y, preds[1]))
}

fit_items <- function(f, df, bayes) {
  fit <- f$fit
  if (bayes) {
    fm <- bayes_fit_measures(fit)
    if (is.character(fm)) return(note(paste("베이지안 적합도(PPP)를 계산하지 못했습니다:", fm), "path_component_failed"))
    pick <- intersect(c("ppp", "bic", "dic", "waic", "looic"), names(fm))
    guide <- c(ppp = "0.05~0.95면 자료와 크게 어긋나지 않음 (0.5에 가까울수록 좋음)", bic = "작을수록 좋음 (모형끼리 비교)",
               dic = "작을수록 좋음 (모형끼리 비교)", waic = "작을수록 좋음 (모형끼리 비교)", looic = "작을수록 좋음 (모형끼리 비교)")
    return(rsage::rs_table("fit", "모형 적합 (베이지안)", data.frame(measure = toupper(pick), value = unname(fm[pick]), guide = unname(guide[pick])),
      labels = c(measure = "지표", value = "값", guide = "읽는 법"), section = "모형 적합",
      description = "PPP(사후 예측 p)는 모형이 만든 자료와 실제 자료의 χ² 차이입니다. 0.5 근처면 잘 맞고, 0.05보다 작으면 자료와 어긋납니다."))
  }
  fm <- lavaan::fitMeasures(fit)
  test <- lavaan::lavInspect(fit, "test")
  std <- test$standard %||% test[[1]]
  get <- function(k) if (k %in% names(fm)) unname(fm[[k]]) else NA_real_
  robust <- !is.na(get("chisq.scaled"))
  rows <- data.frame(
    measure = c("χ²", "df", "p (χ²)", "CFI", "TLI", "RMSEA", "RMSEA 90% 하한", "RMSEA 90% 상한", "SRMR", "AIC", "BIC"),
    value = c(if (robust) get("chisq.scaled") else std$stat, std$df, if (robust) get("pvalue.scaled") else std$pvalue,
              get(if (robust) "cfi.robust" else "cfi"), get(if (robust) "tli.robust" else "tli"), get(if (robust) "rmsea.robust" else "rmsea"),
              get(if (robust) "rmsea.ci.lower.robust" else "rmsea.ci.lower"), get(if (robust) "rmsea.ci.upper.robust" else "rmsea.ci.upper"),
              get("srmr"), get("aic"), get("bic")),
    guide = c("", "0이면 포화 모형", "> 0.05면 자료와 어긋난다는 근거 없음", "≥ 0.95 좋음", "≥ 0.95 좋음", "≤ 0.06 좋음, > 0.10 나쁨",
              "", "", "≤ 0.08 좋음", "작을수록 좋음 (같은 자료의 모형끼리)", "작을수록 좋음 (같은 자료의 모형끼리)"),
    stringsAsFactors = FALSE)
  if (!is.null(test$bollen.stine)) rows <- rbind(rows, data.frame(measure = "Bollen-Stine p", value = test$bollen.stine$pvalue,
                                                                 guide = "부트스트랩으로 구한 χ² p. 작은 표본·비정규 자료에서 χ² p 대신 봄"))
  out <- list(rsage::rs_table("fit", "모형 적합", rows, labels = c(measure = "지표", value = "값", guide = "기준"), section = "모형 적합",
    notes = c(if (robust) "MLR: 강건(척도 보정) 지표입니다.", "기준은 Hu & Bentler (1999)의 관례입니다. 표본이 작으면(대략 200 미만) χ²와 RMSEA가 불안정하고 RMSEA 구간이 넓습니다. SRMR과 함께 봅니다."),
    description = "모형이 가정한 연결만으로 자료의 상관을 재현하는지 봅니다. 빠진 경로가 있으면 나빠집니다. 적합이 좋아도 방향이 맞다는 뜻은 아닙니다(같은 적합을 주는 다른 방향의 모형이 있습니다)."))
  if (is.finite(df) && df == 0) out[[2]] <- note("자유도가 0인 포화 모형이라 적합도는 늘 완벽하고 아무것도 말해 주지 않습니다. 경로 계수와 효과를 봅니다.", "path_saturated", "info")
  out
}

modindices_table <- function(fit, tier, inv, o) {
  mi <- tryCatch(lavaan::modindices(fit, sort. = TRUE), error = function(e) NULL)
  if (is.null(mi) || !nrow(mi)) return(note("더할 만한 경로가 없습니다(수정지수 없음).", "path_modindices_none", "info"))
  mi$lhs_o <- unname(inv[mi$lhs])
  mi$rhs_o <- unname(inv[mi$rhs])
  mi <- mi[!is.na(mi$lhs_o) & !is.na(mi$rhs_o), , drop = FALSE]
  t <- function(v) if (v %in% names(tier)) tier[[v]] else NA
  ok <- vapply(seq_len(nrow(mi)), function(i) {
    a <- t(mi$rhs_o[i])
    b <- t(mi$lhs_o[i])
    if (mi$op[i] == "~") return(is.na(a) || is.na(b) || a < b || (a == b && identical(o$structure$withinTier, "learn")))
    mi$op[i] == "~~" && mi$lhs[i] != mi$rhs[i]
  }, TRUE)
  mi <- utils::head(mi[ok, , drop = FALSE], 10)
  if (!nrow(mi)) return(note("단계 순서에 맞는 추가 경로 제안이 없습니다.", "path_modindices_none", "info"))
  rsage::rs_table("modindices", "더할 만한 경로 (수정지수)", data.frame(
    path = ifelse(mi$op == "~", paste(mi$rhs_o, "→", mi$lhs_o), paste(mi$lhs_o, "↔", mi$rhs_o)), mi = mi$mi, epc = mi$epc, sepc = mi$sepc.all),
    labels = c(path = "경로", mi = "수정지수 (χ² 감소)", epc = "예상 계수", sepc = "예상 표준화 계수"), section = "모형 적합",
    notes = "단계 순서를 거스르는 화살표는 뺐습니다.",
    description = "이 경로를 더하면 χ²가 대략 수정지수만큼 줄어듭니다. 3.84를 넘으면 p < .05 수준입니다. 자료에 맞춰 경로를 더하면 과적합이 되므로, 이론적으로 말이 되는 것만 직접 지정 모드에서 더해 보세요.")
}

# blavaan's fit measures. lavaan::fitMeasures() can fail when the lavaan and
# blavaan versions do not match, so blavaan's own function and the PPP kept
# in the fit are tried next. Returns a named vector or the error text.
bayes_fit_measures <- function(fit) {
  errors <- character()
  try_fm <- function(f) {
    r <- tryCatch(f(fit), error = function(e) {
      errors <<- c(errors, conditionMessage(e))
      NULL
    })
    if (is.null(r)) return(NULL)
    r <- unlist(r)
    if (is.numeric(r) && length(r) && !is.null(names(r))) r else NULL
  }
  fm <- try_fm(lavaan::fitMeasures)
  if (is.null(fm)) {
    own <- get0("blav_fit_measures", envir = asNamespace("blavaan"), inherits = FALSE)
    if (is.function(own)) fm <- try_fm(own)
  }
  if (is.null(fm) || !"ppp" %in% names(fm)) {
    ppp <- tryCatch({
      t <- Filter(function(x) identical(x$test, "ppp"), fit@test)
      if (length(t)) as.numeric(t[[1]]$stat) else NA_real_
    }, error = function(e) NA_real_)
    if (is.finite(ppp)) fm <- c(fm, ppp = ppp)
  }
  if (is.null(fm) || !length(fm)) return(paste(unique(errors), collapse = " / ") %||% "알 수 없는 오류")
  fm
}

# Split the complete rows at random into a part that finds the structure and
# a part that estimates it. Under FIML the incomplete rows join the
# estimation part (structure learning never uses them).
split_rows <- function(complete, keep, o) {
  fraction <- min(max(num(o$confirm$fraction, 0.5), 0.2), 0.8)
  idx <- which(complete)
  n_find <- round(length(idx) * fraction)
  pick <- if (n_find > 0) with_seed(as.integer(num(o$seed, 2026)), idx[sample.int(length(idx), n_find)]) else integer()
  find <- seq_along(complete) %in% pick
  fit <- keep & !find
  if (sum(find) < 10 || sum(fit & complete) < 10)
    return(list(problem = sprintf("결측 없는 행이 %d개라 나누면 한쪽이 10행보다 작습니다. 나누지 않고 모든 행으로 찾고 추정했습니다.", length(idx))))
  list(find = find, fit = fit, fraction = fraction)
}

# The learned graph as a card, with a button that opens it as an editable
# path list (specified mode) in a new tab: same tiers, focus, estimation and
# split, so a confirmation run uses the same held-out rows.
structure_hint <- function(edges, ct, o, split) {
  if (!nrow(edges)) return(NULL)
  arrows <- edges[edges$type == "regression", , drop = FALSE]
  paths <- lapply(seq_len(nrow(edges)), function(i) list(from = edges$from[i], type = edges$type[i], to = edges$to[i]))
  opts <- list(variables = lapply(o$variables, function(v) I(as.character(unlist(v)))),
               structure = list(source = "specified"), paths = paths,
               estimation = o$estimation, seed = as.integer(num(o$seed, 2026)))
  fx <- one(o$focus$exposure)
  fy <- one(o$focus$outcome)
  if (!is.null(fx) || !is.null(fy)) opts$focus <- Filter(Negate(is.null), list(exposure = fx, outcome = fy))
  if (!is.null(split)) opts$confirm <- list(enabled = TRUE, fraction = format(split$fraction))
  shown <- utils::head(paste(arrows$from, "→", arrows$to), 6)
  sure <- NA_integer_
  if (!is.null(split)) {
    reg <- ct[ct$type == "regression", , drop = FALSE]
    sure <- sum(!is.na(reg$ci.lower) & (reg$ci.lower > 0 | reg$ci.upper < 0))
  }
  rsage::rs_hint("structure", sprintf("찾은 구조: 화살표 %d개, 상관 %d개", nrow(arrows), nrow(edges) - nrow(arrows)),
    text = paste0(if (!is.null(split)) sprintf("확인용 행에서 화살표 %d개 중 %d개의 95%% 구간이 0을 포함하지 않았습니다. ", nrow(arrows), sure) else "",
                  "경로 목록으로 열면 화살표를 더하거나 빼고 방향을 바꿔 가설 모형으로 다시 추정할 수 있습니다.",
                  if (!is.null(split)) " 같은 분할을 유지하므로 확인용 행으로만 추정합니다." else ""),
    evidence = paste0(paste(shown, collapse = ", "), if (nrow(arrows) > length(shown)) sprintf(" 외 %d개", nrow(arrows) - length(shown)) else ""),
    kind = "structure", variables = unique(c(edges$from, edges$to)), plot = if (isTRUE(o$plots$diagram)) "diagram",
    suggestions = list(rsage::rs_suggest("이 구조를 경로 목록으로 열기", "org.rsage.path/path", opts, title = "경로 분석: 찾은 구조 고치기")))
}
