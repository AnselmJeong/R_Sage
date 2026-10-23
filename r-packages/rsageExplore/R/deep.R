# Deeper looks (0.3): a quick random forest for the target, a shallow tree
# for subgroups, interactions between the target's associates, clusters,
# rows that are unusual on several variables at once, and a comparison of
# groups with a Table 1 draft. Each returns signals like the rest, ranked by
# effect size; none of them tests anything.

# Predictors as a model frame: factors for groups, numbers kept, missing
# values filled with the median or the most common level (and counted).
model_frame <- function(d, kinds, vars) {
  out <- lapply(vars, function(v) {
    x <- d[[v]]
    if (is_num_kind(kinds[[v]], x)) {
      x <- as.numeric(x)
      x[!is.finite(x)] <- stats::median(x[is.finite(x)])
      x
    } else {
      x <- as.character(x)
      if (anyNA(x)) x[is.na(x)] <- names(which.max(table(x)))
      factor(x)
    }
  })
  names(out) <- vars
  as.data.frame(out, check.names = FALSE, stringsAsFactors = FALSE)
}

target_vector <- function(x, num) if (num) as.numeric(x) else factor(as.character(x))

# ---------- quick model ----------

#' Random forest importance for the target (ranger), with partial dependence of the top variables
quick_model <- function(d, kinds, target, preds, seed, marginal) {
  if (!requireNamespace("ranger", quietly = TRUE)) return(list(missing = "ranger"))
  num <- is_num_kind(kinds[[target]], d[[target]])
  ok <- !is.na(d[[target]]) & (!num | is.finite(suppressWarnings(as.numeric(d[[target]]))))
  if (sum(ok) < 30 || length(preds) < 2) return(NULL)
  preds <- utils::head(preds, 50)
  x <- model_frame(d[ok, , drop = FALSE], kinds, preds)
  y <- target_vector(d[[target]][ok], num)
  if (!num && nlevels(y) < 2) return(NULL)
  filled <- sum(vapply(preds, function(v) sum(is.na(d[[v]][ok])), 1))
  fit <- ranger::ranger(x = x, y = y, num.trees = 300, importance = "permutation", seed = seed,
                        probability = !num, min.node.size = if (num) 5 else 10, num.threads = 1)
  imp <- sort(fit$variable.importance, decreasing = TRUE)
  imp[imp < 0] <- 0
  perf <- if (num) list(measure = "OOB R²", value = max(0, 1 - fit$prediction.error / stats::var(y)))
          else list(measure = "OOB Brier", value = fit$prediction.error)
  tab <- data.frame(variable = names(imp), importance = unname(imp),
                    relative = if (max(imp) > 0) 100 * unname(imp) / max(imp) else 0,
                    marginal = unname(marginal[names(imp)]), stringsAsFactors = FALSE)
  # Partial dependence of the top numeric variables: the model's average prediction over a grid.
  event <- if (num) NULL else { t <- sort(table(y)); names(t)[1] }
  pd <- list()
  for (v in utils::head(names(imp)[vapply(names(imp), function(v) is.numeric(x[[v]]), TRUE)], 2)) {
    grid <- unique(stats::quantile(x[[v]], seq(0.05, 0.95, length.out = 15), names = FALSE))
    rows <- if (nrow(x) > 1000) x[sample.int(nrow(x), 1000), , drop = FALSE] else x
    yhat <- vapply(grid, function(g) {
      rows[[v]] <- g
      p <- stats::predict(fit, rows, num.threads = 1)$predictions
      if (num) mean(p) else mean(p[, event])
    }, 1)
    pd[[v]] <- data.frame(x = grid, y = yhat)
  }
  list(table = tab, perf = perf, n = sum(ok), filled = filled, numeric = num, event = event, pd = pd)
}

model_signals <- function(target, qm, ta) {
  if (is.null(qm) || !is.null(qm$missing)) return(list())
  tab <- qm$table
  top <- utils::head(tab[tab$relative >= 10, , drop = FALSE], 5)
  if (!nrow(top)) return(list())
  out <- list(signal(
    "model_importance", c(target, top$variable),
    sprintf("빠른 모형에서 '%s' 예측에 도움이 큰 변수는 %s입니다", target, paste(sprintf("'%s'", utils::head(top$variable, 3)), collapse = ", ")),
    sprintf("랜덤포레스트를 한 번 적합해 변수를 하나씩 섞었을 때 예측이 얼마나 나빠지는지 봤습니다(%s = %s). 예측에 도움이 된다는 뜻일 뿐, 효과의 크기나 원인을 말하지 않습니다.",
            qm$perf$measure, fmt_num(qm$perf$value)),
    measure = qm$perf$measure, value = qm$perf$value, n = qm$n, score = 2.8,
    draw = list(type = "importance"), display = sprintf("%s = %s, n = %d", qm$perf$measure, fmt_num(qm$perf$value), qm$n),
    suggestions = if (!is.null(ta$model)) list(sug_regression(target, ta$model$family,
                                                               top$variable[top$variable %in% ta$table$variable[ta$table$numeric]],
                                                               top$variable[top$variable %in% ta$table$variable[!ta$table$numeric]],
                                                               ta$model$event)) else list()))
  # Important in the model but weak on its own: a curve or an interaction to look for.
  hidden <- top[!is.na(top$marginal) & top$marginal < 0.1 & seq_len(nrow(top)) <= 3, , drop = FALSE]
  for (i in seq_len(nrow(hidden))) {
    v <- hidden$variable[i]
    out[[length(out) + 1]] <- signal(
      "model_hidden", c(target, v), sprintf("'%s'는 따로 볼 때는 관련이 작지만 모형에서는 중요합니다", v),
      "다른 변수와 함께일 때(상호작용)나 일부 구간에서만(곡선) 목표 변수와 관련될 수 있습니다. 부분 의존 그림과 상호작용 그림을 보세요.",
      measure = "상대 중요도(%)", value = hidden$relative[i], n = qm$n, score = 1.9,
      draw = if (v %in% names(qm$pd)) list(type = "pd", x = v) else NULL)
  }
  out
}

# ---------- subgroups ----------

#' A shallow regression or classification tree (rpart) for the target
subgroup_tree <- function(d, kinds, target, preds) {
  if (!requireNamespace("rpart", quietly = TRUE)) return(NULL)
  num <- is_num_kind(kinds[[target]], d[[target]])
  ok <- !is.na(d[[target]])
  if (sum(ok) < 60 || !length(preds)) return(NULL)
  x <- model_frame(d[ok, , drop = FALSE], kinds, utils::head(preds, 50))
  y <- target_vector(d[[target]][ok], num)
  if (!num && nlevels(y) != 2) return(NULL)
  event <- if (num) NULL else { t <- sort(table(y)); names(t)[1] }
  df <- cbind(x, .y = if (num) y else as.numeric(y == event))
  minb <- max(20, ceiling(0.05 * nrow(df)))
  fit <- rpart::rpart(.y ~ ., data = df, method = "anova",
                      control = rpart::rpart.control(maxdepth = 3, minbucket = minb, cp = 0.01, xval = 0))
  if (nrow(fit$frame) < 3) return(NULL)
  leaves <- which(fit$frame$var == "<leaf>")
  paths <- rpart::path.rpart(fit, nodes = as.integer(rownames(fit$frame)[leaves]), print.it = FALSE)
  rules <- vapply(paths, function(p) paste(tidy_rule(p[-1]), collapse = " 그리고 "), "")
  overall <- mean(df$.y)
  sdv <- stats::sd(df$.y)
  tab <- data.frame(rule = unname(rules), n = fit$frame$n[leaves], value = fit$frame$yval[leaves], stringsAsFactors = FALSE)
  tab$diff <- if (num) (tab$value - overall) / sdv else 100 * (tab$value - overall)
  if (!num) tab$value <- 100 * tab$value
  tab <- tab[order(-tab$value), , drop = FALSE]
  split_vars <- unique(as.character(fit$frame$var[fit$frame$var != "<leaf>"]))
  list(table = tab, overall = if (num) overall else 100 * overall, numeric = num, event = event, n = nrow(df),
       vars = split_vars, first = as.character(fit$frame$var[1]))
}

# "age>=45.5" → "age ≥ 45.5", "sex=F,M" → "sex: F, M"
tidy_rule <- function(p) {
  p <- sub("^([^<>=]+)>=", "\\1 ≥ ", p)
  p <- sub("^([^<>=]+)< ", "\\1 < ", p)
  p <- sub("^([^<>=]+)<([^ ])", "\\1 < \\2", p)
  p <- sub("^([^<>=]+)=(.*)$", "\\1: \\2", p)
  gsub(",", ", ", p, fixed = TRUE)
}

subgroup_signals <- function(target, tr, ta) {
  if (is.null(tr)) return(list())
  tab <- tr$table
  best <- tab[which.max(abs(tab$diff)), ]
  big <- if (tr$numeric) abs(best$diff) >= 0.5 else abs(best$diff) >= 10
  if (!big) return(list())
  unit <- if (tr$numeric) "평균" else sprintf("'%s' 비율(%%)", tr$event)
  dir <- if (best$diff > 0) "높습니다" else "낮습니다"
  sugs <- list()
  if (!is.null(ta$model) && length(tr$vars) >= 2) {
    nums <- tr$vars[tr$vars %in% ta$table$variable[ta$table$numeric]]
    cats <- tr$vars[tr$vars %in% ta$table$variable[!ta$table$numeric]]
    sugs <- list(sug_regression(target, ta$model$family, nums, cats, ta$model$event, interaction = tr$vars[1:2]))
  }
  list(signal(
    "subgroup", c(target, tr$vars), sprintf("'%s'인 집단에서 '%s'가 가장 %s", best$rule, target, dir),
    sprintf("얕은 결정나무(깊이 3 이하)로 나눈 하위집단입니다. 이 집단의 %s은 %s로 전체 %s와 다릅니다. 나무는 데이터에 맞춰 경계를 고르므로, 경계값보다 '어떤 변수의 조합에서 다른가'를 가설로 보고 상호작용 회귀로 확인하세요.",
            unit, fmt_num(best$value, 1), fmt_num(tr$overall, 1)),
    measure = if (tr$numeric) "표준화 차이" else "비율 차이(%p)", value = best$diff, n = best$n,
    size = if (tr$numeric) size_d(abs(best$diff)) else NA_character_, score = 2.1 + min(abs(if (tr$numeric) best$diff else best$diff / 20), 1) / 5,
    draw = list(type = "subgroups"), suggestions = sugs))
}

size_d <- function(x) if (x < 0.2) "아주 작음" else if (x < 0.5) "작음" else if (x < 0.8) "중간" else "큼"

# ---------- interactions ----------

#' Does the target's relation with one associate change with another? Delta R² of a*b over a+b.
interaction_scan <- function(d, kinds, target, ta, skip = character(), extra = character()) {
  if (is.null(ta) || is.null(ta$model)) return(list())
  # The target's top associates, plus variables the model or the tree leaned on (they may matter only together).
  cand <- unique(c(utils::head(setdiff(ta$table$variable[ta$table$strength >= 0.1], skip), 6), setdiff(extra, skip)))
  cand <- intersect(cand, ta$table$variable)
  if (length(cand) < 2) return(list())
  fam <- ta$model$family
  y <- d[[target]]
  if (fam == "binomial") y <- if (is.null(ta$model$event)) as.numeric(y) else as.numeric(as.character(y) == ta$model$event)
  fit_r2 <- function(f, df) {
    m <- tryCatch(suppressWarnings(if (fam == "gaussian") stats::lm(f, df) else stats::glm(f, df, family = if (fam == "binomial") stats::binomial() else stats::poisson())),
                  error = function(e) NULL)
    if (is.null(m)) return(NA_real_)
    if (fam == "gaussian") summary(m)$r.squared else 1 - m$deviance / m$null.deviance
  }
  out <- list()
  pairs <- utils::combn(cand, 2, simplify = FALSE)
  for (p in pairs) {
    df <- data.frame(.y = y, a = d[[p[1]]], b = d[[p[2]]])
    for (k in 1:2) if (!is_num_kind(kinds[[p[k]]], d[[p[k]]])) df[[k + 1]] <- factor(df[[k + 1]])
    df <- df[stats::complete.cases(df), , drop = FALSE]
    if (nrow(df) < 40) next
    add <- fit_r2(.y ~ a + b, df)
    int <- fit_r2(.y ~ a * b, df)
    if (is.na(add) || is.na(int)) next
    out[[length(out) + 1]] <- list(a = p[1], b = p[2], delta = int - add, add = add, n = nrow(df))
  }
  out
}

interaction_signals <- function(target, ints, ta) {
  if (!length(ints)) return(list())
  ints <- ints[order(-vapply(ints, `[[`, 1, "delta"))]
  out <- list()
  r2 <- if (ta$model$family == "gaussian") "R²" else "의사 R²"
  for (it in utils::head(Filter(function(x) x$delta >= 0.02, ints), 2)) {
    nums <- c(it$a, it$b)[c(it$a, it$b) %in% ta$table$variable[ta$table$numeric]]
    cats <- c(it$a, it$b)[c(it$a, it$b) %in% ta$table$variable[!ta$table$numeric]]
    out[[length(out) + 1]] <- signal(
      "interaction", c(target, it$a, it$b), sprintf("'%s'와 '%s'의 관계가 '%s'에 따라 달라 보입니다", target, it$a, it$b),
      sprintf("두 변수를 더하기만 한 모형보다 곱한 항(상호작용)을 넣은 모형의 %s가 %s 높습니다. 그림에서 선의 기울기가 집단마다 다른지 보세요.",
              r2, fmt_num(it$delta, 3)),
      measure = paste0("Δ", r2), value = it$delta, n = it$n, score = 1.7 + min(it$delta, 0.2) * 3,
      draw = list(type = "interaction", x = it$a, by = it$b, y = target),
      suggestions = list(sug_regression(target, ta$model$family, nums, cats, ta$model$event, interaction = c(it$a, it$b))))
  }
  out
}

# ---------- clusters ----------

#' Groups of rows: k-means on principal components, kept only with a clear silhouette
cluster_scan <- function(d, kinds, vars, seed) {
  nums <- vars[vapply(vars, function(v) is_num_kind(kinds[[v]], d[[v]]), TRUE)]
  if (length(nums) < 3) return(NULL)
  x <- d[nums]
  ok <- stats::complete.cases(x) & apply(x, 1, function(r) all(is.finite(r)))
  x <- x[ok, , drop = FALSE]
  x <- x[, vapply(x, stats::sd, 1) > 0, drop = FALSE]
  if (nrow(x) < 50 || ncol(x) < 3) return(NULL)
  set.seed(seed)
  if (nrow(x) > 3000) x <- x[sort(sample.int(nrow(x), 3000)), , drop = FALSE]
  pc <- stats::prcomp(x, scale. = TRUE)
  ve <- pc$sdev^2 / sum(pc$sdev^2)
  k_pc <- max(2, which(cumsum(ve) >= 0.8)[1])
  sc <- pc$x[, seq_len(k_pc), drop = FALSE]
  dd <- stats::dist(sc)
  best <- NULL
  for (k in 2:5) {
    km <- stats::kmeans(sc, k, nstart = 10)
    if (min(table(km$cluster)) < max(10, 0.05 * nrow(sc))) next
    sil <- mean(cluster::silhouette(km$cluster, dd)[, 3])
    if (is.null(best) || sil > best$sil) best <- list(k = k, sil = sil, cluster = km$cluster)
  }
  z <- scale(x)
  prof <- if (!is.null(best)) {
    m <- sapply(split(as.data.frame(z), best$cluster), colMeans)
    data.frame(variable = rownames(m), spread = apply(m, 1, function(r) diff(range(r))), m, check.names = FALSE, stringsAsFactors = FALSE)
  }
  list(best = best, pc = sc[, 1:2], ve = ve, n = nrow(sc), vars = colnames(x),
       profile = if (!is.null(prof)) prof[order(-prof$spread), , drop = FALSE])
}

cluster_signals <- function(cl) {
  if (is.null(cl) || is.null(cl$best) || cl$best$sil < 0.5) return(list())
  top <- utils::head(cl$profile$variable, 3)
  list(signal(
    "clusters", top, sprintf("행들이 뚜렷한 무리 %d개로 나뉩니다", cl$best$k),
    sprintf("수치 변수의 주성분으로 k-평균 군집을 만들었을 때 실루엣이 %s입니다(0.5 이상이면 무리가 분명한 편). 무리를 가장 크게 가르는 변수는 %s입니다. 측정 장소나 시기처럼 숨은 집단이 있는지 확인하세요.",
            fmt_num(cl$best$sil), paste(sprintf("'%s'", top), collapse = ", ")),
    measure = "평균 실루엣", value = cl$best$sil, n = cl$n, size = if (cl$best$sil >= 0.7) "큼" else "중간", score = 1.6,
    draw = list(type = "clusters")))
}

# ---------- unusual rows ----------

#' Rows far from the rest on several numeric variables at once (Mahalanobis distance)
anomaly_scan <- function(d, kinds, vars) {
  nums <- vars[vapply(vars, function(v) is_num_kind(kinds[[v]], d[[v]]), TRUE)]
  if (length(nums) < 2) return(NULL)
  x <- d[nums]
  ok <- which(stats::complete.cases(x) & apply(x, 1, function(r) all(is.finite(r))))
  x <- x[ok, vapply(x[ok, , drop = FALSE], stats::sd, 1) > 0, drop = FALSE]
  if (length(ok) < 30 || ncol(x) < 2) return(NULL)
  s <- tryCatch(solve(stats::cov(x)), error = function(e) NULL)
  if (is.null(s)) return(NULL)
  md <- stats::mahalanobis(x, colMeans(x), s, inverted = TRUE)
  # Bonferroni over rows: in data with no odd rows, about one data set in 20 shows one.
  cut <- stats::qchisq(1 - 0.05 / length(ok), ncol(x))
  far <- which(md > cut)
  z <- scale(x)
  rows <- lapply(far[order(-md[far])], function(i) {
    zi <- z[i, ]
    o <- order(-abs(zi))[1:min(3, length(zi))]
    data.frame(row = rownames(d)[ok[i]], distance = md[i],
               unusual = paste(sprintf("%s (z = %s)", colnames(x)[o], fmt_num(zi[o], 1)), collapse = ", "), stringsAsFactors = FALSE)
  })
  list(table = if (length(rows)) do.call(rbind, rows) else NULL, md = md, cut = cut, n = length(ok), p = ncol(x))
}

anomaly_signals <- function(an) {
  if (is.null(an) || is.null(an$table)) return(list())
  k <- nrow(an$table)
  # Many far rows mean skewed variables, not a few odd rows.
  if (k > max(3, 0.05 * an$n)) return(list())
  list(signal(
    "anomaly", character(), sprintf("여러 변수를 함께 보면 동떨어진 행이 %d개 있습니다", k),
    sprintf("수치 변수 %d개를 함께 본 Mahalanobis 거리가 기준(χ², 행 수로 보정한 5%%, %s)을 넘는 행입니다. 변수 하나씩 볼 때는 평범해도 조합이 드문 행일 수 있습니다. 입력 오류인지 '찾은 이상 사례' 표의 행 번호로 확인하세요.",
            an$p, fmt_num(an$cut, 1)),
    measure = "동떨어진 행 수", value = k, n = an$n, score = 1.4, draw = list(type = "anomaly"),
    suggestions = list(sug_integrity())))
}

# ---------- groups and Table 1 ----------

smd_num <- function(a, b) {
  s <- sqrt((stats::var(a) + stats::var(b)) / 2)
  if (!is.finite(s) || s == 0) return(0)
  (mean(a) - mean(b)) / s
}

# SMD of a categorical variable between two groups (Yang & Dalton 2012), via the
# proportions of its levels.
smd_cat <- function(a, b, levels) {
  p1 <- as.numeric(table(factor(a, levels)) / length(a))[-1]
  p2 <- as.numeric(table(factor(b, levels)) / length(b))[-1]
  if (!length(p1)) return(0)
  if (length(p1) == 1) {
    s <- sqrt((p1 * (1 - p1) + p2 * (1 - p2)) / 2)
    return(if (s == 0) 0 else (p1 - p2) / s)
  }
  S <- (diag(p1) - outer(p1, p1) + diag(p2) - outer(p2, p2)) / 2
  diff <- p1 - p2
  v <- tryCatch(as.numeric(t(diff) %*% solve(S) %*% diff), error = function(e) NA_real_)
  if (is.na(v)) 0 else sqrt(max(0, v))
}

#' Every variable by the groups of one variable: summaries per group and the largest SMD
compare_groups <- function(d, kinds, group, vars) {
  g <- as.character(d[[group]])
  lv <- names(sort(table(g), decreasing = TRUE))
  if (length(lv) < 2 || length(lv) > 6) return(list(error = sprintf("'%s'는 범주가 %d개입니다. 2~6개인 변수로 비교하세요.", group, length(lv))))
  lv <- sort(lv)
  rows <- list()
  smds <- list()
  for (v in setdiff(vars, group)) {
    x <- d[[v]]
    k <- kinds[[v]]
    if (is_num_kind(k, x)) {
      x <- as.numeric(x)
      skewed <- isTRUE(abs(skewness(x[is.finite(x)])) >= 1)
      cells <- vapply(lv, function(l) {
        xi <- x[g %in% l & is.finite(x)]
        if (!length(xi)) "" else if (skewed) sprintf("%s [%s, %s]", fmt_num(stats::median(xi), 1), fmt_num(stats::quantile(xi, 0.25), 1), fmt_num(stats::quantile(xi, 0.75), 1))
        else sprintf("%s (%s)", fmt_num(mean(xi), 1), fmt_num(stats::sd(xi), 1))
      }, "")
      pairs <- utils::combn(lv, 2, simplify = FALSE)
      smd <- max(vapply(pairs, function(p) {
        a <- x[g %in% p[1] & is.finite(x)]; b <- x[g %in% p[2] & is.finite(x)]
        if (length(a) < 2 || length(b) < 2) 0 else abs(smd_num(a, b))
      }, 1))
      rows[[length(rows) + 1]] <- data.frame(variable = v, level = if (skewed) "중앙값 [IQR]" else "평균 (SD)", t(cells), smd = smd,
                                              check.names = FALSE, stringsAsFactors = FALSE)
      smds[[v]] <- smd
    } else if (is_cat_kind(k, x)) {
      x <- as.character(x)
      xl <- names(sort(table(x), decreasing = TRUE))
      pairs <- utils::combn(lv, 2, simplify = FALSE)
      smd <- max(vapply(pairs, function(p) {
        a <- x[g %in% p[1] & !is.na(x)]; b <- x[g %in% p[2] & !is.na(x)]
        if (!length(a) || !length(b)) 0 else abs(smd_cat(a, b, xl))
      }, 1))
      shown <- utils::head(xl, 8)
      for (j in seq_along(shown)) {
        cells <- vapply(lv, function(l) {
          xi <- x[g %in% l & !is.na(x)]
          sprintf("%d (%s%%)", sum(xi == shown[j]), fmt_num(100 * mean(xi == shown[j]), 1))
        }, "")
        rows[[length(rows) + 1]] <- data.frame(variable = if (j == 1) v else "", level = shown[j], t(cells), smd = if (j == 1) smd else NA_real_,
                                                check.names = FALSE, stringsAsFactors = FALSE)
      }
      smds[[v]] <- smd
    }
  }
  if (!length(rows)) return(NULL)
  tab <- do.call(rbind, rows)
  names(tab)[3:(2 + length(lv))] <- paste0("g", seq_along(lv))
  n <- vapply(lv, function(l) sum(g %in% l), 1L)
  list(table = tab, levels = lv, n = n, smd = unlist(smds), group = group)
}

compare_signals <- function(cg, kinds, d) {
  if (is.null(cg) || !is.null(cg$error)) return(list())
  s <- sort(cg$smd, decreasing = TRUE)
  big <- s[s >= 0.2]
  out <- list(signal(
    "compare", c(cg$group, names(utils::head(big, 5))),
    if (length(big)) sprintf("'%s' 집단 사이에 분포가 다른 변수가 %d개입니다", cg$group, length(big))
    else sprintf("'%s' 집단 사이에 크게 다른 변수가 없습니다", cg$group),
    sprintf("집단마다 요약한 표 1 초안을 만들었습니다(%s). 표준화 평균 차이(SMD)가 0.1을 넘으면 집단의 구성이 다르다고 보는 편이고, 0.2 이상인 변수는 %s입니다. 비교 분석에서 이 변수들을 보정할지 생각해 보세요.",
            paste(sprintf("%s %d명", cg$levels, cg$n), collapse = ", "),
            if (length(big)) paste(sprintf("'%s'", names(utils::head(big, 5))), collapse = ", ") else "없습니다"),
    measure = "SMD 0.2 이상 변수 수", value = length(big), n = sum(cg$n), score = 2.7, draw = list(type = "smd")))
  for (v in utils::head(names(big), 2)) {
    num <- is_num_kind(kinds[[v]], d[[v]])
    out[[length(out) + 1]] <- signal(
      "group_shift", c(cg$group, v), sprintf("'%s' 집단마다 '%s'가 다릅니다", cg$group, v),
      "표 1에서 차이가 가장 큰 변수 가운데 하나입니다. 집단을 비교하는 분석에서 이 변수를 함께 보정하거나 나눠서 보세요.",
      measure = "SMD", value = cg$smd[[v]], n = sum(cg$n), size = size_d(cg$smd[[v]]), score = 2.3,
      draw = if (num) list(type = "box", x = cg$group, y = v) else list(type = "stack", x = cg$group, y = v),
      suggestions = list(if (num) sug_planned(if (length(cg$levels) == 2) "t 검정 열기" else "분산분석 열기", if (length(cg$levels) == 2) "ttests" else "anova")
                         else sug_planned("교차표 열기", "frequencies")))
  }
  out
}
