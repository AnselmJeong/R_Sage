# lavaan syntax from the graph, ML (lavaan) and Bayesian (blavaan) fits,
# and draws of the free parameters for intervals of derived effects.

# Variables that take part in the model: an end of an arrow, or a covariance
# with at least one variable that has parents (two exogenous variables covary
# in lavaan anyway, so that alone does not put them in the model).
model_parts <- function(edges) {
  reg <- edges[edges$type == "regression", , drop = FALSE]
  endo <- unique(reg$to)
  cov <- edges[edges$type == "covariance", , drop = FALSE]
  cov <- cov[cov$from %in% endo | cov$to %in% endo, , drop = FALSE]
  list(reg = reg, cov = cov, endo = endo, vars = unique(c(reg$from, reg$to, cov$from, cov$to)))
}

# lavaan names must be syntactic; other names are mapped to v1, v2, ...
safe_names <- function(vars) {
  ok <- make.names(vars) == vars & !grepl("\\.", vars)
  stats::setNames(ifelse(ok, vars, paste0("v", seq_along(vars))), vars)
}

build_syntax <- function(parts, map) {
  reg <- parts$reg
  cov <- parts$cov
  regression <- lapply(split(unname(map[reg$from]), factor(map[reg$to], levels = unique(map[reg$to]))), as.character)
  covariance <- if (nrow(cov)) lapply(split(unname(map[cov$to]), factor(map[cov$from], levels = unique(map[cov$from]))), as.character) else NULL
  own <- paste(c(vapply(names(regression), function(y) paste(y, "~", paste(regression[[y]], collapse = " + ")), ""),
                 if (length(covariance)) vapply(names(covariance), function(a) paste(a, "~~", paste(covariance[[a]], collapse = " + ")), "")),
               collapse = "\n")
  extra <- NULL
  if (has("lavaanExtra")) {
    r <- quietly(lavaanExtra::write_lavaan(regression = regression, covariance = covariance))
    if (is.null(r$error) && is.character(r$value) && nzchar(r$value)) extra <- r$value
  }
  list(model = extra %||% own, own = own, lavaanExtra = !is.null(extra))
}

fit_ml <- function(syntax, d, o) {
  inference <- o$estimation$inference %||% "bootstrap"
  fiml <- identical(o$estimation$missing, "fiml")
  R <- max(100L, as.integer(num(o$estimation$bootstrap, 1000)))
  args <- list(model = syntax, data = d, auto.cov.y = FALSE)
  if (fiml) {
    args$missing <- "fiml"
    args$fixed.x <- FALSE
  }
  if (inference == "bootstrap") {
    args$se <- "bootstrap"
    args$bootstrap <- R
  } else if (inference == "robust") {
    args$estimator <- "MLR"
  }
  if (isTRUE(o$fit$bollenStine)) {
    args$test <- "bollen.stine"
    if (is.null(args$bootstrap)) args$bootstrap <- R
  }
  seed <- as.integer(num(o$seed, 2026))
  r <- with_seed(seed, quietly(do.call(lavaan::sem, args)))
  if (!is.null(r$error)) return(list(error = r$error, warnings = r$warnings))
  fit <- r$value
  draws <- NULL
  if (inference == "bootstrap") {
    b <- tryCatch(lavaan::lavInspect(fit, "boot"), error = function(e) NULL)
    if (!is.null(b)) {
      b <- b[stats::complete.cases(b), , drop = FALSE]
      colnames(b) <- names(lavaan::coef(fit))
      draws <- b
    }
  } else {
    draws <- with_seed(seed, mc_draws(fit, R = max(R, 5000L)))
  }
  list(fit = fit, draws = draws, warnings = r$warnings, converged = isTRUE(lavaan::lavInspect(fit, "converged")),
       method = "ml", inference = inference, R = R)
}

# Monte Carlo draws of the free parameters from their estimated sampling
# distribution (Preacher & Selig, 2012).
mc_draws <- function(fit, R) {
  est <- lavaan::coef(fit)
  V <- lavaan::vcov(fit)
  e <- eigen((V + t(V)) / 2, symmetric = TRUE)
  L <- e$vectors %*% diag(sqrt(pmax(e$values, 0)), length(est))
  z <- matrix(stats::rnorm(R * length(est)), R)
  out <- sweep(z %*% t(L), 2, est, "+")
  colnames(out) <- names(est)
  out
}

PRIORS <- c(weak = "normal(0,10)", moderate = "normal(0,1)", strong = "normal(0,0.5)")

fit_bayes <- function(syntax, d, o) {
  b <- o$estimation$bayes %||% list()
  prior <- PRIORS[[b$prior %||% "moderate"]] %||% "normal(0,1)"
  seed <- as.integer(num(o$seed, 2026))
  args <- list(model = syntax, data = d, auto.cov.y = FALSE,
               n.chains = as.integer(num(b$chains, 3)), burnin = as.integer(num(b$burnin, 1000)),
               sample = as.integer(num(b$draws, 1000)), seed = seed,
               dp = blavaan::dpriors(beta = prior), bcontrol = list(cores = 1L))
  # blavaan reads the name of the function it was called as, so it must be
  # called by name ("bsem"), not as a function object or blavaan::bsem.
  r <- with_seed(seed, quietly(do.call("bsem", args, envir = asNamespace("blavaan"))))
  if (!is.null(r$error)) return(list(error = r$error, warnings = r$warnings))
  fit <- r$value
  est <- lavaan::coef(fit)
  draws <- tryCatch({
    m <- blavaan::blavInspect(fit, "mcmc")
    m <- do.call(rbind, lapply(m, as.matrix))
    if (!all(names(est) %in% colnames(m))) {
      if (ncol(m) < length(est)) stop("columns")
      m <- m[, seq_along(est), drop = FALSE]
      colnames(m) <- names(est)
    }
    m[, names(est), drop = FALSE]
  }, error = function(e) NULL)
  rhat <- tryCatch(blavaan::blavInspect(fit, "rhat"), error = function(e) NULL)
  list(fit = fit, draws = draws, warnings = r$warnings, converged = is.null(rhat) || all(rhat < 1.05, na.rm = TRUE),
       rhat = rhat, method = "bayes", prior = prior, inference = "posterior")
}

# Free regression parameters: their row in the parameter table and their
# column among the free parameters (coef order).
reg_params <- function(fit) {
  pt <- lavaan::parTable(fit)
  r <- pt[pt$op == "~", , drop = FALSE]
  data.frame(lhs = r$lhs, rhs = r$rhs, free = r$free, est = r$est, stringsAsFactors = FALSE)
}

# B[y, x] = coefficient of x in the equation for y, from a vector of free parameters.
beta_matrix <- function(values, rp, vars) {
  B <- matrix(0, length(vars), length(vars), dimnames = list(vars, vars))
  for (i in seq_len(nrow(rp))) {
    v <- if (rp$free[i] > 0) values[rp$free[i]] else rp$est[i]
    B[rp$lhs[i], rp$rhs[i]] <- v
  }
  B
}

total_effects <- function(B) solve(diag(nrow(B)) - B) - diag(nrow(B))

# Coefficient table: arrows and covariances of the graph.
coef_table <- function(f, parts, map, o) {
  inv <- stats::setNames(names(map), map)
  fit <- f$fit
  if (f$method == "ml") {
    pe <- lavaan::parameterEstimates(fit, standardized = TRUE,
                                     boot.ci.type = if (identical(f$inference, "bootstrap")) "perc" else "norm")
    pe <- pe[(pe$op == "~") | (pe$op == "~~" & pe$lhs != pe$rhs), , drop = FALSE]
    key <- paste(pe$lhs, pe$op, pe$rhs)
    keep <- key %in% c(paste(map[parts$reg$to], "~", map[parts$reg$from]), paste(map[parts$cov$from], "~~", map[parts$cov$to]),
                       paste(map[parts$cov$to], "~~", map[parts$cov$from]))
    pe <- pe[keep, , drop = FALSE]
    data.frame(
      path = ifelse(pe$op == "~", paste(inv[pe$rhs], "→", inv[pe$lhs]), paste(inv[pe$lhs], "↔", inv[pe$rhs])),
      kind = ifelse(pe$op == "~", "경로", "상관"),
      from = unname(ifelse(pe$op == "~", inv[pe$rhs], inv[pe$lhs])), to = unname(ifelse(pe$op == "~", inv[pe$lhs], inv[pe$rhs])),
      type = ifelse(pe$op == "~", "regression", "covariance"),
      est = pe$est, se = pe$se, ci.lower = pe$ci.lower, ci.upper = pe$ci.upper, p = pe$pvalue, std = pe$std.all,
      stringsAsFactors = FALSE)
  } else {
    pt <- lavaan::parTable(fit)
    pt <- pt[pt$free > 0 & ((pt$op == "~") | (pt$op == "~~" & pt$lhs != pt$rhs)), , drop = FALSE]
    D <- f$draws
    q <- function(i, p) if (is.null(D)) NA_real_ else unname(stats::quantile(D[, pt$free[i]], p, na.rm = TRUE))
    rh <- f$rhat
    data.frame(
      path = ifelse(pt$op == "~", paste(inv[pt$rhs], "→", inv[pt$lhs]), paste(inv[pt$lhs], "↔", inv[pt$rhs])),
      kind = ifelse(pt$op == "~", "경로", "상관"),
      from = unname(ifelse(pt$op == "~", inv[pt$rhs], inv[pt$lhs])), to = unname(ifelse(pt$op == "~", inv[pt$lhs], inv[pt$rhs])),
      type = ifelse(pt$op == "~", "regression", "covariance"),
      est = if (is.null(D)) pt$est else colMeans(D)[pt$free],
      se = if (is.null(D)) pt$se else apply(D[, pt$free, drop = FALSE], 2, stats::sd),
      ci.lower = vapply(seq_len(nrow(pt)), q, 0, p = 0.025), ci.upper = vapply(seq_len(nrow(pt)), q, 0, p = 0.975),
      rhat = if (!is.null(rh) && length(rh) >= max(pt$free)) unname(rh[pt$free]) else NA_real_,
      stringsAsFactors = FALSE)
  }
}
