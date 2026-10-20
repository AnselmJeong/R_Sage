# Regression and generalised linear models for one outcome. The options
# name the outcome, predictors, structured terms and models; analyse() fits
# every model on one fixed sample and reports coefficients, term tests, fit
# and comparisons, adjusted effects, diagnostics and an optional stepwise
# search. See docs/modules/regression.md.

#' Default options
defaults <- function() {
  list(
    outcome = list(variable = NULL, event = NULL, trials = NULL, encoding = "individual"),
    predictors = list(continuous = character(), categorical = character()),
    model = list(family = "gaussian", link = "default", estimation = "maximum_likelihood"),
    coding = list(factors = list(), transforms = list()),
    terms = list(),
    models = list(list(id = "m1", label = "모형 1", termIds = character(), intercept = TRUE, family = NULL, link = NULL)),
    output = list(coefficients = TRUE, exponentiate = TRUE, standardized = FALSE, fit = TRUE, partialR2 = FALSE),
    plots = list(coefficients = TRUE),
    inference = list(ciLevel = 0.95, ciMethod = "wald", termTests = "hierarchical"),
    comparison = list(enabled = FALSE, pairs = list()),
    effects = list(enabled = FALSE, kind = "means", modelId = NULL, focal = NULL, moderator = NULL,
                   marginalization = "empirical", scale = "response", adjust = "holm", at = list()),
    diagnostics = list(modelId = NULL, residuals = TRUE, collinearity = TRUE, influence = FALSE, dispersion = FALSE,
                       zeros = FALSE, calibration = FALSE, rowLabel = NULL),
    selection = list(method = "none", sourceModelId = NULL, candidateTermIds = character(), forcedTermIds = character(),
                     direction = "both", criterion = "AIC", maxSteps = 100L),
    missing = list(sampleScope = "shared"),
    offset = list(mode = "none", variable = NULL, unit = "노출 1단위"),
    weights = list(mode = "none", variable = NULL),
    export = list(models = list(enabled = FALSE, saveAs = "regression_models"),
                  augmented = list(enabled = FALSE, saveAs = "regression_diagnostics"))
  )
}

SECTIONS <- c("분석 개요", "계수와 항 검정", "효과 해석", "모형 비교", "진단", "변수 선택", "재현 정보")

#' Regression and generalised linear models
#'
#' @param data A data frame.
#' @param options A list of options; see defaults(). Missing entries take their default.
#' @return An rsage result.
#' @examples
#' analyse(mtcars, list(outcome = list(variable = "mpg"), predictors = list(continuous = c("wt", "hp"))))
analyse <- function(data, options = list()) {
  stopifnot(is.data.frame(data))
  o <- rsage::rs_merge_options(options, defaults())
  y_name <- one(o$outcome$variable)
  continuous <- chr(o$predictors$continuous)
  categorical <- chr(o$predictors$categorical)
  predictors <- unique(c(continuous, categorical))
  aux <- c(one(o$outcome$trials), one(o$offset$variable), one(o$weights$variable), one(o$diagnostics$rowLabel),
           vapply(rows_of(o$coding$factors), function(r) one(r$variable) %||% "", ""),
           vapply(rows_of(o$coding$transforms), function(r) one(r$variable) %||% "", ""))
  unknown <- setdiff(c(y_name, predictors, aux[nzchar(aux)]), names(data))
  if (length(unknown)) stop("데이터에 없는 변수: ", paste(unique(unknown), collapse = ", "))

  notes <- list()
  tables <- list()
  plots <- list()
  add <- function(x) {
    if (is.null(x)) return(invisible())
    if (inherits(x, "rsage_table")) tables[[x$id]] <<- x
    else if (inherits(x, "rsage_plot")) plots[[x$id]] <<- x
    else if (inherits(x, "rsage_note")) notes[[length(notes) + 1]] <<- x
    else if (is.list(x)) for (i in x) add(i)
  }
  blocked <- function(text, code) {
    rsage::rs_result("regression", "회귀와 GLM", notes = c(notes, list(note(text, code))), options = o,
                     packages = c("rsageRegression"), sections = SECTIONS,
                     data_info = list(variables = c(y_name, predictors)))
  }
  if (is.null(y_name)) return(blocked("결과변수를 고르세요.", "regression_invalid_outcome"))
  if (y_name %in% predictors) return(blocked("결과변수는 설명변수로 함께 쓸 수 없습니다.", "regression_invalid_outcome"))
  if (length(intersect(continuous, categorical))) return(blocked("한 변수를 연속과 범주 설명변수에 함께 넣을 수 없습니다.", "regression_invalid_term"))

  # Terms and models: given, or main effects of every predictor (said so).
  terms <- rows_of(o$terms)
  models <- rows_of(o$models)
  if (!length(terms) && length(predictors)) {
    terms <- auto_terms(predictors)
    if (!length(models) || all(vapply(models, function(m) !length(chr(m$termIds)), TRUE))) {
      models <- list(list(id = (models[[1]]$id %||% "m1"), label = models[[1]]$label %||% "모형 1",
                          termIds = names(terms), intercept = TRUE))
      add(note("항을 정하지 않아 모든 설명변수의 주효과로 모형 1을 만들었습니다.", "regression_auto_terms", "info"))
    }
  }
  if (!length(models)) models <- defaults()$models
  ct <- check_terms(terms, predictors)
  terms <- ct$terms
  problems <- ct$problems
  mids <- vapply(models, function(m) one(m$id) %||% "", "")
  if (any(!nzchar(mids)) || anyDuplicated(mids)) problems <- c(problems, "모형 id가 비었거나 겹칩니다")
  for (m in models) {
    bad <- setdiff(chr(m$termIds), names(terms))
    if (length(bad)) problems <- c(problems, sprintf("%s: 없는 항 %s", m$label %||% m$id, paste(bad, collapse = ", ")))
    else problems <- c(problems, vapply(hierarchy_problems(chr(m$termIds), terms), function(p) sprintf("%s: %s", m$label %||% m$id, p), ""))
    s <- model_setting(m, o)
    if (is.null(FAMILIES[[s$family]])) problems <- c(problems, sprintf("알 수 없는 모형 종류 %s", s$family))
    else if (!s$link %in% FAMILIES[[s$family]]$links)
      problems <- c(problems, sprintf("%s: %s 모형에는 %s 링크를 쓸 수 없습니다 (가능: %s)", m$label %||% m$id, FAMILIES[[s$family]]$label, s$link,
                                      paste(FAMILIES[[s$family]]$links, collapse = ", ")))
    if (!identical(s$estimation, "maximum_likelihood")) problems <- c(problems, "편향 감소 추정은 다음 버전에서 지원합니다")
    if (identical(o$weights$mode, "precision") && s$family != "gaussian") problems <- c(problems, "가중치는 선형 모형에만 씁니다")
    if (!identical(o$offset$mode, "none") && !(s$link == "log" && FAMILIES[[s$family]]$kind == "count"))
      problems <- c(problems, "offset은 로그 링크의 개수 모형(Poisson·음이항)에만 씁니다")
  }
  if (length(problems)) return(blocked(paste(unique(problems), collapse = " / "), "regression_invalid_term"))

  # Outcome checks per family the models use.
  settings <- lapply(models, model_setting, o = o)
  y <- data[[y_name]]
  grouped <- identical(o$outcome$encoding, "grouped")
  event <- NULL
  for (s in settings) {
    kind <- FAMILIES[[s$family]]$kind
    p <- outcome_problem(y, kind, if (kind == "binary") o$outcome$encoding else "individual", one(o$outcome$trials))
    if (!is.null(p)) return(blocked(p, "regression_invalid_outcome"))
    if (kind == "binary" && !grouped && is.null(event)) {
      event <- one(o$outcome$event) %||% default_event(y)
      if (is.null(event)) return(blocked(sprintf("%s의 어느 값을 사건으로 볼지 정하세요 (값: %s).", y_name, paste(outcome_levels(y), collapse = ", ")), "regression_event_required"))
      if (!event %in% outcome_levels(y)) return(blocked(sprintf("사건 값 %s가 %s에 없습니다.", event, y_name), "regression_event_required"))
    }
  }

  prep <- prepare_data(data, o, terms, models, predictors)
  if (length(prep$problems)) return(blocked(paste(unique(prep$problems), collapse = " / "), "regression_invalid_term"))
  add(prep$notes)
  if (!sum(prep$shared)) return(blocked("결측을 빼고 나니 남는 행이 없습니다.", "regression_sample_changed"))

  # Fit every model.
  fits <- lapply(seq_along(models), function(i) {
    m <- models[[i]]
    s <- settings[[i]]
    label <- one(m$label) %||% one(m$id)
    response <- response_for(s, o, prep, event)
    f <- model_formula(m, terms, prep, response)
    d <- model_data(prep, prep$keep[[i]], s, event)
    r <- fit_model(m, s, f, d, prep)
    c(r, list(model = m, setting = s, label = label, formula = formula_text(m, terms, prep, y_name), keep = prep$keep[[i]],
              data = d, terms = terms, prep = prep, response = response))
  })
  for (f in fits) {
    if (!is.null(f$error)) add(note(sprintf("%s을(를) 적합하지 못했습니다: %s", f$label, f$error),
                                   if (isTRUE(f$backend)) "regression_backend_missing" else "regression_component_failed"))
    if (any(grepl("추정할 수 없는", f$status))) add(note(sprintf("%s: 다른 항과 완전히 겹쳐 추정할 수 없는 계수가 있습니다 (NA). 그 항을 빼거나 범주를 다시 보세요.", f$label), "regression_rank_deficient"))
    if (any(grepl("수렴", f$status))) add(note(sprintf("%s이(가) 수렴하지 않았습니다. 계수와 p값을 정상 결과로 읽지 않습니다.", f$label), "regression_not_converged"))
    if (isTRUE(f$separation$found)) add(note(sprintf("%s에 %s 분리가 있습니다: 어떤 설명변수 조합에서 사건이 모두 일어나거나 모두 일어나지 않습니다. 계수와 표준오차가 매우 커지고 Wald 검정을 믿을 수 없습니다. 범주를 합치거나, 다음 버전의 편향 감소 로지스틱을 씁니다.",
                                                 f$label, if (f$separation$method == "detectseparation") "완전 또는 준완전" else "(예측 확률 0·1로 보아) 의심되는"), "regression_separation"))
  }
  ok <- Filter(function(f) is.null(f$error), fits)

  add(overview_table(fits, o, y_name, event, prep))
  add(rsage::rs_table("sample", "분석 표본", prep$sample, labels = c(item = "항목", n = "행 수"), section = "분석 개요",
    description = "모형에 쓰는 열의 결측과, 그 때문에 뺀 행입니다. 모든 모형이 같은 행으로 적합되어야 서로 비교할 수 있습니다."))
  if (length(ok)) {
    if (isTRUE(o$output$coefficients)) {
      ct <- coef_table(ok, o, prep)
      add(ct$table)
      add(ct$notes)
      if (isTRUE(o$plots$coefficients)) add(coef_plot(ct$data))
    }
    if (isTRUE(o$output$standardized)) {
      st <- standardized_table(ok, o, prep)
      add(st$table)
      add(st$notes)
    }
    add(term_tests(ok, o, terms, prep))
    if (isTRUE(o$effects$enabled)) add(effects_items(ok, o, prep))
    if (isTRUE(o$output$fit)) add(fit_table(ok))
    if (isTRUE(o$comparison$enabled)) {
      if (prep$per_model) add(note("모형마다 다른 행으로 적합해 직접 비교하지 않습니다. 결측 처리를 '모든 모형에 같은 행'으로 바꾸세요.", "regression_not_comparable"))
      else add(comparison_tables(ok, o, terms))
    }
    add(diagnostics_items(ok, o, prep))
    if (identical(o$selection$method, "stepwise")) {
      if (prep$per_model) add(note("단계적 선택은 모든 모형이 같은 행을 쓸 때만 합니다.", "regression_not_comparable"))
      else add(selection_items(ok, o, terms, prep))
    }
  }
  add(provenance_table(fits, o, prep, event))

  exports <- list()
  if (isTRUE(o$export$models$enabled) && length(ok))
    exports[[o$export$models$saveAs]] <- stats::setNames(lapply(ok, function(f) f$fit), vapply(ok, function(f) f$label, ""))
  if (isTRUE(o$export$augmented$enabled) && length(ok)) exports[[o$export$augmented$saveAs]] <- augmented(ok, prep)

  pk <- c("rsageRegression", "parameters", "performance", "insight",
          if (any(vapply(settings, function(s) s$family == "negative_binomial", TRUE)) || identical(o$selection$method, "stepwise")) "MASS",
          if (o$inference$termTests %in% c("type2", "type3")) "car",
          if (isTRUE(o$effects$enabled)) c("modelbased", "marginaleffects"),
          if (any(vapply(fits, function(f) identical(f$separation$method, "detectseparation"), TRUE))) "detectseparation")
  rsage::rs_result("regression", "회귀와 GLM", tables = unname(tables), plots = unname(plots), notes = notes,
                   options = o, packages = unique(pk[vapply(pk, has, TRUE)]), exports = exports, sections = SECTIONS,
                   data_info = list(variables = c(y_name, predictors), outcome = y_name, n = sum(prep$shared),
                                    models = vapply(fits, function(f) f$label, "")))
}

overview_table <- function(fits, o, y_name, event, prep) {
  t <- data.frame(
    model = vapply(fits, function(f) f$label, ""),
    setting = vapply(fits, function(f) setting_label(f$setting), ""),
    formula = vapply(fits, function(f) f$formula, ""),
    n = vapply(fits, function(f) if (!is.null(f$fit)) stats::nobs(f$fit) else sum(f$keep), 0),
    params = vapply(fits, function(f) if (!is.null(f$fit)) length(stats::coef(f$fit)) else NA_real_, 0),
    status = vapply(fits, function(f) if (!is.null(f$error)) paste("적합 실패:", f$error) else if (length(f$status)) paste(f$status, collapse = "; ") else "정상", ""))
  outcome <- if (!is.null(event)) sprintf("결과변수 %s, 사건 = %s", y_name, event)
             else if (prep$grouped) sprintf("결과변수 %s (성공 수) / %s (시행 수)", y_name, one(o$outcome$trials))
             else sprintf("결과변수 %s", y_name)
  rsage::rs_table("overview", "모형 개요", t,
    labels = c(model = "모형", setting = "종류 · 링크", formula = "식", n = "N", params = "계수 수", status = "상태"),
    notes = c(outcome, if (length(prep$constants)) paste("중심화:", paste(sprintf("%s − %.4g", names(prep$constants), unlist(prep$constants)), collapse = ", "))),
    section = "분석 개요",
    description = "무엇을 어떤 모형으로 추정했는지 먼저 확인합니다. 계수는 다른 항을 고려한 연관성이며, 관측자료에서 그 자체로 인과효과를 뜻하지 않습니다.")
}

provenance_table <- function(fits, o, prep, event) {
  coding <- vapply(names(prep$levels), function(k) sprintf("%s: %s (%s)", prep$map[k], paste(prep$levels[[k]], collapse = " / "),
                                                          if (!is.null(prep$contrasts[[k]])) "효과 코딩" else "기준 범주 코딩"), "")
  items <- c(
    vapply(fits, function(f) sprintf("%s: %s, %s", f$label, f$formula, setting_label(f$setting)), ""),
    if (length(coding)) paste("범주:", coding),
    if (!is.null(event)) paste("사건:", event),
    sprintf("신뢰구간: %g%%, %s", o$inference$ciLevel * 100, o$inference$ciMethod),
    sprintf("항 검정: %s", o$inference$termTests),
    sprintf("표본: %s, N = %d", if (prep$per_model) "모형마다" else "모든 모형 공통", sum(prep$shared)))
  rsage::rs_table("provenance", "재현 정보", data.frame(item = items), labels = c(item = "항목"), section = "재현 정보",
    description = "같은 결과를 다시 얻는 데 필요한 조건입니다. 패키지 버전은 아래 줄에 있습니다.")
}

augmented <- function(fits, prep) {
  out <- data.frame(row_id = prep$md$rs_row)
  for (f in fits) {
    key <- make.names(f$label)
    v <- rep(NA_real_, nrow(out))
    v[f$keep] <- stats::fitted(f$fit)
    out[[paste0(key, "_fitted")]] <- v
    v[f$keep] <- stats::residuals(f$fit)
    out[[paste0(key, "_resid")]] <- v
    v[f$keep] <- stats::cooks.distance(f$fit)
    out[[paste0(key, "_cook")]] <- v
  }
  out
}
