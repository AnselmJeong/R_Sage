# Stepwise search with MASS::stepAIC inside a scope the user fixes: forced
# terms stay, candidates are the only terms that move, interactions move
# with their hierarchy. The selected model is a suggestion; its p-values
# don't account for the search.

SEC_SEL <- "변수 선택"

hierarchy_closure <- function(ids, terms) {
  repeat {
    vars <- lapply(terms[ids], term_vars, terms = terms)
    need <- unlist(lapply(vars, function(v) {
      if (length(v) < 2) return(character())
      sub <- unlist(lapply(seq_len(length(v) - 1), function(k) utils::combn(v, k, simplify = FALSE)), recursive = FALSE)
      vapply(sub, function(s) {
        hit <- names(terms)[vapply(terms, function(t) identical(term_key(t, terms), paste(sort(s), collapse = ":")), TRUE)]
        if (length(hit)) hit[1] else NA_character_
      }, "")
    }))
    need <- setdiff(stats::na.omit(need), ids)
    if (!length(need)) return(ids)
    ids <- c(ids, need)
  }
}

selection_items <- function(fits, o, terms, prep) {
  sel <- o$selection
  if (!has("MASS")) return(list(note("단계적 선택에는 MASS 패키지가 필요합니다.", "regression_backend_missing")))
  ok <- Filter(function(f) !is.null(f$fit), fits)
  id <- one(sel$sourceModelId)
  src <- Filter(function(f) identical(f$model$id, id), ok)
  src <- if (length(src)) src[[1]] else ok[[length(ok)]]
  s <- src$setting
  if (is_quasi(s$family)) return(list(note("quasi 모형은 가능도가 없어 단계적 선택을 하지 않습니다.", "regression_selection_unsupported_terms")))
  if (any(is.na(stats::coef(src$fit)))) return(list(note("추정할 수 없는 계수가 있는 모형에서는 단계적 선택을 하지 않습니다.", "regression_rank_deficient")))
  src_ids <- chr(src$model$termIds)
  cand <- chr(sel$candidateTermIds)
  if (!length(cand)) cand <- src_ids
  forced <- hierarchy_closure(intersect(chr(sel$forcedTermIds), names(terms)), terms)
  upper <- hierarchy_closure(unique(c(cand, forced)), terms)
  lower_f <- model_formula(utils::modifyList(src$model, list(termIds = forced)), terms, prep, src$response)
  upper_f <- model_formula(utils::modifyList(src$model, list(termIds = upper)), terms, prep, src$response)
  dir <- sel$direction %||% "both"
  start <- if (dir == "forward") stats::update(src$fit, formula. = lower_f) else src$fit
  if (dir != "forward" && !all(forced %in% src_ids))
    return(list(note("강제로 넣을 항이 시작 모형에 없습니다. 시작 모형에 넣거나 전진 선택을 고르세요.", "regression_invalid_term")))
  k <- if (identical(sel$criterion, "BIC")) log(stats::nobs(src$fit)) else 2
  r <- quietly(MASS::stepAIC(start, scope = list(lower = lower_f, upper = upper_f), direction = dir, k = k,
                             steps = as.integer(sel$maxSteps %||% 100), trace = 0))
  if (!is.null(r$error)) return(list(note(sprintf("단계적 선택을 하지 못했습니다: %s", r$error), "regression_component_failed")))
  fit <- r$value
  a <- as.data.frame(fit$anova)
  crit <- if (k == 2) "AIC" else "BIC"
  path <- data.frame(step = seq_len(nrow(a)) - 1,
                     change = vapply(trimws(as.character(a$Step)), function(x) {
                       if (!nzchar(x)) return("시작 모형")
                       sign <- substr(x, 1, 1)
                       paste(if (sign == "+") "추가:" else "제거:", label_term(trimws(substring(x, 2)), prep))
                     }, ""),
                     df = a$Df, deviance = a$Deviance, resid_df = a[["Resid. Df"]], criterion = a$AIC)
  labs <- attr(stats::terms(fit), "term.labels")
  final <- vapply(labs, label_term, "", prep = prep)
  steps_used <- nrow(a) - 1
  out <- list(
    rsage::rs_table("selectionPath", "선택 경로", path,
      labels = c(step = "단계", change = "변경", df = "df", deviance = "이탈도 변화", resid_df = "잔차 df", criterion = paste0(crit, " (extractAIC)")),
      notes = c(sprintf("시작: %s (%s), 방향: %s, 기준: %s (k = %.3g), 강제 항: %s.", src$label,
                        if (dir == "forward") "강제 항만 있는 모형" else "그 모형 그대로",
                        c(both = "양방향", forward = "전진", backward = "후진")[[dir]], crit, k,
                        if (length(forced)) paste(vapply(terms[forced], function(t) paste(term_vars(t, terms), collapse = " × "), ""), collapse = ", ") else "없음"),
                "경로의 기준값은 MASS::extractAIC 정의라 적합도 표의 AIC와 상수만큼 다를 수 있습니다. 비교에는 적합도 표의 값을 씁니다."),
      section = SEC_SEL,
      description = "각 단계에서 기준값을 가장 많이 줄이는 항을 더하거나 뺐습니다. 기준값이 더 줄지 않으면 멈춥니다. 후보 범위 안에서 찾은 결과입니다."),
    rsage::rs_table("selectedTerms", "선택된 항", data.frame(term = if (length(final)) unname(final) else "(절편만)",
                                                       forced = if (length(final)) unname(final) %in% vapply(terms[forced], function(t) paste(term_vars(t, terms), collapse = " × "), "") else FALSE),
      labels = c(term = "항", forced = "강제 포함"),
      notes = sprintf("최종 %s: AIC %.3f, BIC %.3f (logLik 기준).", "모형", stats::AIC(fit), stats::BIC(fit)),
      section = SEC_SEL,
      description = "탐색이 제안한 모형의 항입니다. 원래 모형을 바꾸지 않았습니다. 이 항으로 모형을 새로 만들어 비교해 볼 수 있습니다."),
    note("단계적 선택으로 고른 모형의 p값과 신뢰구간은 선택 과정의 불확실성을 반영하지 않아 실제보다 낙관적입니다. 탐색 결과로 읽고, 확인은 새 자료나 사전에 정한 모형으로 합니다.", "regression_post_selection"))
  if (steps_used >= as.integer(sel$maxSteps %||% 100))
    out <- c(out, list(note("최대 단계에 도달해 탐색이 끝나지 않았을 수 있습니다.", "regression_selection_incomplete")))
  out
}
