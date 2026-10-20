# Fitting one model with stats::lm, stats::glm or MASS::glm.nb. Calls go
# through do.call with the data in the call, so update() and stepAIC() refit
# on the same rows without looking anything up in the user's session.

response_for <- function(s, o, prep, event) {
  kind <- FAMILIES[[s$family]]$kind
  if (kind == "binary") {
    if (prep$grouped) return(quote(cbind(rs_y, rs_n - rs_y)))
    return(quote(rs_y01))
  }
  quote(rs_y)
}

family_object <- function(s) {
  switch(s$family,
    gaussian = stats::gaussian(link = s$link),
    binomial = stats::binomial(link = s$link),
    poisson = stats::poisson(link = s$link),
    gamma = stats::Gamma(link = s$link),
    quasibinomial = stats::quasibinomial(link = s$link),
    quasipoisson = stats::quasipoisson(link = s$link),
    NULL)
}

fit_model <- function(m, s, f, d, prep) {
  args <- list(formula = f, data = d)
  if (length(prep$contrasts)) {
    present <- intersect(names(prep$contrasts), all.vars(f))
    if (length(present)) args$contrasts <- prep$contrasts[present]
  }
  if (prep$weights) args$weights <- d$rs_w
  res <- if (s$family == "gaussian" && s$link == "identity") {
    quietly(do.call(stats::lm, args))
  } else if (s$family == "negative_binomial") {
    if (!has("MASS")) return(list(error = "음이항 모형에는 MASS 패키지가 필요합니다", backend = TRUE))
    quietly(do.call(MASS::glm.nb, args))
  } else {
    args$family <- family_object(s)
    quietly(do.call(stats::glm, args))
  }
  if (!is.null(res$error)) return(list(error = res$error))
  fit <- res$value
  status <- character()
  if (inherits(fit, "glm") && !isTRUE(fit$converged)) status <- c(status, "수렴하지 않음")
  if (any(is.na(stats::coef(fit)))) status <- c(status, "추정할 수 없는 계수 있음")
  if (stats::df.residual(fit) <= 0) status <- c(status, "잔차 자유도 없음")
  sep <- if (FAMILIES[[s$family]]$kind == "binary" && s$family == "binomial") separation(args, s, fit) else NULL
  if (isTRUE(sep$found)) status <- c(status, sep$label)
  list(fit = fit, warnings = res$warnings, status = status, separation = sep)
}

# Complete or quasi-complete separation: detectseparation's linear program when
# installed, otherwise fitted probabilities at 0 or 1.
separation <- function(args, s, fit) {
  if (has("detectseparation")) {
    args$family <- stats::binomial(link = s$link)
    args$method <- detectseparation::detect_separation
    r <- quietly(do.call(stats::glm, args))
    if (is.null(r$error)) {
      found <- isTRUE(r$value$outcome)
      return(list(found = found, method = "detectseparation", label = "분리 (detectseparation)",
                  terms = if (found) names(which(is.infinite(r$value$coefficients))) else character()))
    }
  }
  p <- stats::fitted(fit)
  found <- any(p < 1e-8 | p > 1 - 1e-8)
  list(found = found, method = "fitted", label = "분리 의심 (예측 확률 0 또는 1)", terms = character())
}

# Data for one model: its rows, with the binary outcome coded for its event.
model_data <- function(prep, keep, s, event) {
  d <- prep$md[keep, , drop = FALSE]
  if (FAMILIES[[s$family]]$kind == "binary" && !prep$grouped) d$rs_y01 <- as.integer(as.character(d$rs_y) == event)
  d
}
