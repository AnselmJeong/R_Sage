# 분석 계획: a research question (goal, outcome, groups or predictors,
# design) becomes a plan: the analysis to run with its options, what to run
# alongside, alternatives and what to check first. The design profile is
# computed here; the choice follows the fixed rules in rules.R. Nothing is
# fitted or tested for the answer itself. See docs/modules/plan.md.

#' Default options
defaults <- function() {
  list(goal = "auto", outcomes = character(), groups = character(), id = NULL, design = "auto", question = "")
}

SECTIONS <- c("질문과 변수", "판단 근거")
GOAL_LABEL <- c(auto = "자동", compare = "집단 비교", relate = "관련 보기", predict = "예측", unknown = "정하지 못함")
DESIGN_LABEL <- c(auto = "자동", independent = "독립 (서로 다른 대상)", paired = "대응 (같은 대상을 두 번 이상)", repeated = "반복 측정 (긴 형식)")
ROLE_LABEL <- c(main = "주 분석", also = "함께", alt = "대안", planned = "예정")

#' Analysis plan
#'
#' @param data A data frame.
#' @param options See defaults().
#' @examples
#' analyse(PlantGrowth, list(outcomes = "weight", groups = "group"))
analyse <- function(data, options = list()) {
  stopifnot(is.data.frame(data))
  o <- rsage::rs_merge_options(options, defaults())
  outcomes <- unique(chr(o$outcomes)); groups <- setdiff(unique(chr(o$groups)), outcomes); id <- one(o$id)
  o$outcomes <- outcomes; o$groups <- groups
  unknown <- setdiff(c(outcomes, groups, id), names(data))
  if (length(unknown)) stop("데이터에 없는 변수: ", paste(unique(unknown), collapse = ", "))
  question <- one(o$question)
  hints <- list(); tables <- list(); plots <- list(); notes <- list()
  done <- function() {
    rsage::rs_result("plan", "분석 계획", tables = tables, plots = plots, notes = notes, options = o,
                     packages = "rsagePlan", sections = SECTIONS, hints = hints, hints_title = "분석 계획",
                     data_info = list(variables = c(outcomes, groups, id)))
  }
  if (!length(outcomes)) {
    hints[[1]] <- rsage::rs_hint("ask", "무엇을 알고 싶은지 정해 주세요",
      "'결과 변수'에 비교하거나 설명하려는 변수를, '집단·설명 변수'에 나누거나 설명할 변수를 넣으세요. 어시스턴트에게 질문을 적으면 대신 채워 줍니다.", kind = "ask")
    return(done())
  }
  roles <- c(stats::setNames(rep("결과", length(outcomes)), outcomes), stats::setNames(rep("집단·설명", length(groups)), groups),
             if (!is.null(id)) stats::setNames("ID", id))
  prof <- variable_profile(data, as.list(roles))
  plan <- make_plan(data, o, prof)

  # Missing values in the variables the plan uses.
  used <- c(outcomes, groups)
  cc <- stats::complete.cases(data[, used, drop = FALSE])
  miss_share <- 1 - mean(cc)
  if (miss_share >= 0.05) {
    worst <- prof$variable[which.max(prof$missing)]
    plan$checks[[length(plan$checks) + 1]] <- check("missing", "결측이 있는 행이 분석에서 빠집니다",
      sprintf("쓰는 변수 가운데 하나라도 빈 행 %d개(%.0f%%)가 빠집니다. 빠진 행이 다른 행과 다르면 결과가 치우칠 수 있으니 결측 분석으로 먼저 보세요.", sum(!cc), miss_share * 100),
      evidence = sprintf("완전한 행 %d / %d, 가장 많이 빈 변수 '%s' (%d)", sum(cc), length(cc), worst, max(prof$missing)),
      suggestions = list(rsage::rs_suggest("결측 데이터 분석 열기", KEY$missing, list(variables = I(used)), title = "결측: 분석 계획의 변수")))
  }

  # Cards: the main analysis first, then alternatives and planned ones, then checks.
  recs <- plan$recs
  order <- order(match(vapply(recs, `[[`, "", "role"), c("main", "also", "alt", "planned")))
  recs <- recs[order]
  plot_id <- NULL
  if (!is.null(plan$plot)) {
    plots[["groups"]] <- groups_plot(data, plan$plot[1], plan$plot[2])
    plot_id <- "groups"
  }
  for (i in seq_along(recs)) {
    r <- recs[[i]]
    title <- switch(r$role, main = paste("추천:", r$title), alt = paste("대안:", r$title), planned = paste("예정:", r$title), r$title)
    sug <- list(rsage::rs_suggest(r$label, r$analysis, r$options, title = r$tab))
    hints[[length(hints) + 1]] <- rsage::rs_hint(paste0("plan-", i), title, r$why, evidence = r$evidence, kind = r$role,
                                                 variables = c(outcomes, groups), plot = if (r$role == "main") plot_id,
                                                 suggestions = sug)
  }
  for (c in plan$checks) hints[[length(hints) + 1]] <- rsage::rs_hint(paste0("check-", c$id), c$title, c$text, evidence = c$evidence,
                                                                       kind = "check", suggestions = c$suggestions)
  if (!is.null(plan$ask)) hints[[length(hints) + 1]] <- rsage::rs_hint("ask", "확인할 질문", plan$ask, kind = "ask")
  if (!length(recs) && !length(plan$checks) && is.null(plan$ask))
    hints[[length(hints) + 1]] <- rsage::rs_hint("none", "맞는 분석을 정하지 못했습니다", "변수의 유형이나 역할을 바꿔 보세요.", kind = "check")

  # Tables
  qrows <- data.frame(item = c("질문", "목적", "결과 변수", "집단·설명 변수", "설계", "ID"),
                      value = c(question %||% "(적지 않음)", GOAL_LABEL[[plan$goal %||% "unknown"]],
                                paste(outcomes, collapse = ", "), if (length(groups)) paste(groups, collapse = ", ") else "(없음)",
                                DESIGN_LABEL[[plan$design %||% "auto"]], id %||% "(없음)"), stringsAsFactors = FALSE)
  tables$question <- rsage::rs_table("question", "이렇게 이해했습니다", qrows, labels = c(item = "항목", value = "내용"),
    description = "질문을 이렇게 해석해 계획을 세웠습니다. 다르면 왼쪽 옵션에서 목적이나 설계를 바꾸세요.", section = "질문과 변수")
  tables$variables <- rsage::rs_table("variables", "변수 프로필", prof[, c("variable", "role", "kind_label", "n", "missing", "levels", "mean", "sd", "skew")],
    labels = c(variable = "변수", role = "역할", kind_label = "유형 (추정)", n = "n", missing = "결측", levels = "범주 수", mean = "평균", sd = "SD", skew = "왜도"),
    description = "유형은 값으로 추정한 것입니다. 숫자 코드로 된 범주(1/2/3)는 범주로, 값이 적은 점수는 '순서·점수'로 봅니다.", section = "질문과 변수")
  if (!is.null(plan$groups_table)) {
    tables$groups <- rsage::rs_table("groups", "집단별 요약", plan$groups_table,
      labels = c(group = "집단", n = "n", mean = "평균", sd = "SD", median = "중앙값", skew = "왜도", shapiro_p = "Shapiro p"),
      description = "규칙이 본 숫자입니다. 작은 집단(n < 30)에서 왜도의 절댓값이 1 이상이거나 Shapiro p < .05이면 순위 검정을 함께 권합니다.", section = "질문과 변수")
  }
  if (length(plan$trace)) {
    tr <- do.call(rbind, plan$trace)
    tr <- cbind(step = seq_len(nrow(tr)), tr)
    tables$rules <- rsage::rs_table("rules", "판단 근거", tr, labels = c(step = "순서", what = "확인한 것", value = "값", decision = "판단"),
      description = "계획은 이 순서로 정해졌습니다. 같은 질문과 데이터면 언제나 같은 계획이 나옵니다.", section = "판단 근거")
  }
  if (length(recs)) {
    pl <- data.frame(step = seq_along(recs), role = ROLE_LABEL[vapply(recs, `[[`, "", "role")], analysis = vapply(recs, `[[`, "", "title"),
                     key = vapply(recs, `[[`, "", "analysis"), stringsAsFactors = FALSE)
    tables$plan <- rsage::rs_table("plan", "분석 계획", pl, labels = c(step = "순서", role = "역할", analysis = "분석", key = "모듈"),
      notes = "'예정'은 아직 R Sage에 없는 분석입니다.", description = "카드의 버튼으로 각 분석을 열면 계획의 옵션이 채워진 탭이 열립니다.", section = "판단 근거")
  }
  notes[[1]] <- rsage::rs_note(sprintf("계획을 세운 시각: %s. 결과를 본 뒤 계획을 바꾸면 보고서에 그 사실을 적으세요.", format(Sys.time(), "%Y-%m-%d %H:%M")),
                               "info", "plan_time")
  done()
}

groups_plot <- function(data, y, g) {
  d <- data.frame(y = data[[y]], g = factor(data[[g]]))
  d <- d[is.finite(d$y) & !is.na(d$g), , drop = FALSE]
  p <- ggplot2::ggplot(d, ggplot2::aes(.data$g, .data$y)) +
    ggplot2::geom_boxplot(outlier.shape = NA, width = 0.5, colour = "grey45") +
    ggplot2::geom_jitter(width = 0.12, height = 0, alpha = 0.4, size = 1.1, colour = "#1f5aa6") +
    ggplot2::labs(x = g, y = y) + ggplot2::theme_minimal()
  rsage::rs_plot("groups", sprintf("%s의 집단별 분포", y), p,
                 size = rsage::rs_figure_size(x_items = nlevels(d$g), label_chars = max(nchar(levels(d$g))) / 3, aspect = 0.55),
                 alt = sprintf("%s별 %s 상자그림", g, y),
                 description = "상자는 사분위 범위, 가운데 선은 중앙값, 점은 개별 값입니다. 집단의 퍼짐과 치우침을 비교합니다.",
                 section = "질문과 변수")
}
