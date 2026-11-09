# Direct, indirect and total effects, and covariate roles for one exposure
# and outcome.

interval <- function(x) {
  x <- x[is.finite(x)]
  if (length(x) < 10) return(c(NA_real_, NA_real_))
  unname(stats::quantile(x, c(0.025, 0.975)))
}

# One function of the free parameters, evaluated at the estimate and per draw.
with_draws <- function(f, est, draws, fun) {
  point <- fun(est)
  if (is.null(draws)) return(list(point = point, draws = NULL))
  list(point = point, draws = t(apply(draws, 1, fun)))
}

# Decomposition of x -> y. Values are on the fitted scale.
focus_effects <- function(f, x, y, reg, map, vars_mapped, cap = 20) {
  rp <- reg_params(f$fit)
  est <- if (f$method == "bayes" && !is.null(f$draws)) colMeans(f$draws) else lavaan::coef(f$fit)
  all <- routes(x, y, reg)
  ord <- if (length(all)) order(vapply(all, length, 0)) else integer()
  all <- all[ord]
  indirect <- Filter(function(p) length(p) > 2, all)
  many <- length(indirect) > cap
  fun <- function(values) {
    B <- beta_matrix(values, rp, vars_mapped)
    T <- total_effects(B)
    X <- map[[x]]
    Y <- map[[y]]
    spec <- vapply(indirect, function(p) {
      m <- unname(map[p])
      prod(vapply(seq_len(length(m) - 1), function(i) B[m[i + 1], m[i]], 0))
    }, 0)
    c(direct = B[Y, X], total = T[Y, X], spec)
  }
  w <- with_draws(f, est, f$draws, fun)
  labels <- c("직접효과", "총효과", vapply(indirect, function(p) paste(p, collapse = " → "), ""))
  kinds <- c("direct", "total", rep("indirect", length(indirect)))
  point <- unname(w$point)
  ci <- if (is.null(w$draws)) matrix(NA_real_, length(point), 2) else t(apply(w$draws, 2, interval))
  # Total indirect = total - direct, per draw.
  ind_point <- point[2] - point[1]
  ind_ci <- if (is.null(w$draws)) c(NA, NA) else interval(w$draws[, 2] - w$draws[, 1])
  tab <- data.frame(component = labels, kind = kinds, est = point, ci.lower = ci[, 1], ci.upper = ci[, 2], stringsAsFactors = FALSE)
  spec <- tab[tab$kind == "indirect", , drop = FALSE]
  spec <- spec[order(-abs(spec$est)), , drop = FALSE]
  if (nrow(spec) > cap) spec <- spec[seq_len(cap), , drop = FALSE]
  sum_row <- data.frame(component = "간접효과 합", kind = "indirect_total", est = ind_point, ci.lower = ind_ci[1], ci.upper = ind_ci[2])
  if (!any(reg$from == x & reg$to == y)) {
    tab$component[1] <- "직접효과 (화살표 없음)"
    tab[1, c("ci.lower", "ci.upper")] <- NA_real_
  }
  out <- rbind(tab[1, ], spec, sum_row, tab[2, ])
  tot <- point[2]
  out$share <- if (abs(tot) > 1e-8) 100 * out$est / tot else NA_real_
  out$share[out$kind == "total"] <- 100
  rownames(out) <- NULL
  list(table = out, many = many, n_routes = length(indirect), has_route = length(all) > 0)
}

# Total, direct and indirect effect for every ordered pair joined by a route.
all_effects <- function(f, reg, map, vars_mapped, vars) {
  rp <- reg_params(f$fit)
  est <- if (f$method == "bayes" && !is.null(f$draws)) colMeans(f$draws) else lavaan::coef(f$fit)
  pairs <- list()
  for (a in vars) for (b in descendants(a, reg)) pairs[[length(pairs) + 1]] <- c(a, b)
  if (!length(pairs)) return(NULL)
  fun <- function(values) {
    B <- beta_matrix(values, rp, vars_mapped)
    T <- total_effects(B)
    vapply(pairs, function(p) T[map[[p[2]]], map[[p[1]]]], 0)
  }
  w <- with_draws(f, est, f$draws, fun)
  B <- beta_matrix(est, rp, vars_mapped)
  direct <- vapply(pairs, function(p) B[map[[p[2]]], map[[p[1]]]], 0)
  ci <- if (is.null(w$draws)) matrix(NA_real_, length(pairs), 2) else t(apply(w$draws, 2, interval))
  out <- data.frame(from = vapply(pairs, `[`, "", 1), to = vapply(pairs, `[`, "", 2), direct = direct,
                    indirect = unname(w$point) - direct, total = unname(w$point), ci.lower = ci[, 1], ci.upper = ci[, 2],
                    stringsAsFactors = FALSE)
  out[order(-abs(out$total)), , drop = FALSE]
}

# Where each other variable sits relative to x -> y, and whether to adjust
# for it when estimating the total effect.
covariate_roles <- function(x, y, vars, reg, cov) {
  anc_x <- ancestors(x, reg)
  desc_x <- descendants(x, reg)
  anc_y <- ancestors(y, reg)
  desc_y <- descendants(y, reg)
  # Ancestors of y along routes that avoid x.
  anc_y_wo_x <- ancestors(y, reg[reg$from != x & reg$to != x, , drop = FALSE])
  linked <- function(v, w) any((cov$from == v & cov$to == w) | (cov$from == w & cov$to == v))
  rows <- lapply(setdiff(vars, c(x, y)), function(v) {
    if (v %in% desc_x && v %in% anc_y) return(c(v, "매개변수", "넣지 않기", sprintf("%s의 영향이 %s 거쳐 %s 갑니다. 넣으면 총효과가 아니라 직접효과에 가까운 값이 됩니다.", x, josa(v, c("을", "를")), josa(y, c("으로", "로")))))
    if (v %in% desc_x && v %in% desc_y) return(c(v, "충돌변수 (두 변수의 결과)", "넣지 않기", sprintf("%s %s 모두의 결과입니다. 넣으면 없던 연관이 생깁니다.", josa(x, c("과", "와")), y)))
    if (v %in% desc_y) return(c(v, "결과의 결과", "넣지 않기", sprintf("%s의 뒤에 오는 변수입니다.", y)))
    if (v %in% desc_x) return(c(v, "노출의 결과", "넣지 않기", sprintf("%s의 뒤에 오지만 %s 이어지지 않습니다. 넣을 이유가 없고, 숨은 경로가 있으면 편향을 만듭니다.", x, josa(y, c("으로", "로")))))
    if (v %in% anc_x && v %in% anc_y_wo_x) return(c(v, "교란변수", "넣기", sprintf("%s %s 모두에 앞서 영향을 줍니다. 빼면 두 변수의 관계가 부풀거나 줄어듭니다.", josa(x, c("과", "와")), y)))
    if (linked(v, x) && v %in% anc_y_wo_x) return(c(v, "교란 가능 (노출과 상관)", "넣기", sprintf("%s 상관이 있고 %s에 영향을 줍니다. 방향을 정하지 않은 연결이라 교란변수로 다룹니다.", josa(x, c("과", "와")), y)))
    if (v %in% anc_y_wo_x) return(c(v, "결과의 다른 원인", "넣어도 됨", sprintf("%s에만 영향을 줍니다. 넣으면 추정이 더 정밀해질 수 있습니다.", y)))
    if (v %in% anc_x) return(c(v, "노출의 다른 원인", "넣지 않아도 됨", sprintf("%s 거쳐서만 %s 이어집니다. 넣으면 정밀도가 떨어질 수 있습니다.", josa(x, c("을", "를")), josa(y, c("과", "와")))))
    if (linked(v, x) || linked(v, y)) return(c(v, "상관만 있음", "판단 보류", "방향을 정하지 않은 연결만 있습니다. 순서를 정하면 역할이 정해집니다."))
    c(v, "관련 경로 없음", "필요 없음", "그래프에서 두 변수와 이어지지 않습니다.")
  })
  if (!length(rows)) return(data.frame(variable = character(), role = character(), advice = character(), why = character()))
  m <- do.call(rbind, rows)
  out <- data.frame(variable = m[, 1], role = m[, 2], advice = m[, 3], why = m[, 4], stringsAsFactors = FALSE)
  order_role <- c("교란변수", "교란 가능 (노출과 상관)", "결과의 다른 원인", "매개변수", "충돌변수 (두 변수의 결과)", "노출의 결과", "결과의 결과", "노출의 다른 원인", "상관만 있음", "관련 경로 없음")
  out[order(match(out$role, order_role)), , drop = FALSE]
}

# Minimal adjustment sets: dagitty when installed, else the parents of x
# (total) and of y apart from x (direct).
adjustment_sets <- function(x, y, vars, reg, cov) {
  if (has("dagitty")) {
    ids <- stats::setNames(paste0("v", seq_along(vars)), vars)
    inv <- stats::setNames(vars, ids)
    lines <- c(if (nrow(reg)) paste(ids[reg$from], "->", ids[reg$to]), if (nrow(cov)) paste(ids[cov$from], "<->", ids[cov$to]))
    g <- tryCatch(dagitty::dagitty(paste0("dag { ", paste(c(unname(ids), lines), collapse = "; "), " }")), error = function(e) NULL)
    if (!is.null(g)) {
      get <- function(effect) {
        s <- tryCatch(dagitty::adjustmentSets(g, exposure = ids[[x]], outcome = ids[[y]], type = "minimal", effect = effect),
                      error = function(e) NULL)
        if (is.null(s)) return(NULL)
        lapply(s, function(z) unname(inv[as.character(z)]))
      }
      return(list(total = get("total"), direct = get("direct"), method = "dagitty"))
    }
  }
  list(total = list(sort(parents(x, reg))), direct = list(sort(setdiff(parents(y, reg), x))), method = "parents")
}
