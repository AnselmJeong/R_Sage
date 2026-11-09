# The graph: a data frame of edges (from, to, type = "regression" | "covariance").
# Regression edges run from an earlier tier to a later one; links inside a
# tier are covariances unless the user asked the data to orient them.

empty_edges <- function() data.frame(from = character(), to = character(), type = character(), stringsAsFactors = FALSE)

edge_rows <- function(from, to, type) data.frame(from = from, to = to, type = type, stringsAsFactors = FALSE)

# Every forward arrow the tiers allow, and a covariance between variables of
# the same tier (apart from the first tier, whose variables covary anyway).
saturated_graph <- function(vars, tier, o = list()) {
  k <- knowledge(o, vars)
  banned <- function(a, b) any((k$forbidden$from == a & k$forbidden$to == b) | (k$forbidden$from == b & k$forbidden$to == a))
  e <- list()
  for (a in vars) for (b in vars) {
    if ((tier[[a]] < tier[[b]] && !banned(a, b)) || any(k$required$from == a & k$required$to == b))
      e[[length(e) + 1]] <- edge_rows(a, b, "regression")
  }
  first <- min(tier[vars])
  for (i in seq_along(vars)) for (j in seq_along(vars)) {
    a <- vars[i]
    b <- vars[j]
    if (i < j && tier[[a]] == tier[[b]] && tier[[a]] > first && !banned(a, b) &&
        !any((k$required$from == a & k$required$to == b) | (k$required$from == b & k$required$to == a))) e[[length(e) + 1]] <- edge_rows(a, b, "covariance")
  }
  if (length(e)) do.call(rbind, e) else empty_edges()
}

ALGORITHMS <- c(hc = "hc", tabu = "tabu", pc = "pc.stable")
SCORES <- c(bic = "bic-g", aic = "aic-g", bge = "bge")

# Structure learning with bnlearn under the tier order: bootstrap model
# averaging gives each link's strength (share of resamples that contain it)
# and direction.
learned_graph <- function(d, vars, tier, o) {
  groups <- lapply(sort(unique(tier[vars])), function(t) vars[tier[vars] == t])
  bl <- if (length(groups) > 1) bnlearn::tiers2blacklist(groups) else NULL
  k <- knowledge(o, vars)
  if (nrow(k$forbidden)) bl <- unique(rbind(bl, k$forbidden, stats::setNames(k$forbidden[, c("to", "from")], c("from", "to"))))
  algo <- ALGORITHMS[[o$structure$algorithm %||% "hc"]] %||% "hc"
  args <- list(blacklist = bl)
  if (nrow(k$required)) args$whitelist <- k$required
  if (algo == "pc.stable") {
    args$test <- "cor"
    args$alpha <- num(o$structure$alpha, 0.05)
  } else args$score <- SCORES[[o$structure$score %||% "bic"]] %||% "bic-g"
  R <- max(20L, as.integer(num(o$structure$bootstrap, 200)))
  dd <- d[stats::complete.cases(d[vars]), vars, drop = FALSE]
  str <- with_seed(as.integer(num(o$seed, 2026)),
                   bnlearn::boot.strength(dd, R = R, algorithm = algo, algorithm.args = args))
  auto <- attr(str, "threshold")
  threshold <- num(o$structure$threshold, NA)
  if (is.na(threshold)) threshold <- auto
  within <- o$structure$withinTier %||% "covary"

  rows <- list()
  edges <- list()
  for (i in seq_along(vars)) for (j in seq_along(vars)) {
    if (i >= j) next
    a <- vars[i]
    b <- vars[j]
    ab <- str[str$from == a & str$to == b, ]
    ba <- str[str$from == b & str$to == a, ]
    s <- ab$strength[1]
    if (is.na(s) || s <= 0) next
    d_ab <- ab$direction[1]
    d_ba <- ba$direction[1]
    if (tier[[a]] > tier[[b]] || (tier[[a]] == tier[[b]] && d_ba > d_ab)) {
      tmp <- a; a <- b; b <- tmp
      tmp <- d_ab; d_ab <- d_ba; d_ba <- tmp
    }
    adopted <- s >= threshold
    req <- any(k$required$from == a & k$required$to == b)
    if (req) adopted <- TRUE
    if (req) {
      type <- "regression"
      basis <- "꼭 넣을 경로 (지정)"
    } else if (tier[[a]] != tier[[b]]) {
      type <- "regression"
      basis <- "단계 순서"
    } else if (within == "learn" && d_ab >= 0.6) {
      type <- "regression"
      basis <- "데이터 (불안정)"
    } else {
      type <- "covariance"
      basis <- "같은 단계: 방향 정하지 않음"
    }
    rows[[length(rows) + 1]] <- data.frame(from = a, to = b, strength = s, direction = d_ab, type = type, basis = basis,
                                           adopted = adopted, stringsAsFactors = FALSE)
    if (adopted) edges[[length(edges) + 1]] <- edge_rows(a, b, type)
  }
  table <- if (length(rows)) do.call(rbind, rows) else
    data.frame(from = character(), to = character(), strength = numeric(), direction = numeric(), type = character(),
               basis = character(), adopted = logical())
  table <- table[order(-table$strength), , drop = FALSE]
  list(edges = if (length(edges)) do.call(rbind, edges) else empty_edges(), table = table, threshold = threshold,
       auto = isTRUE(is.na(num(o$structure$threshold, NA))), n = nrow(dd), R = R, algorithm = algo)
}

# Paths the user listed. Returns edges and problems (text).
specified_graph <- function(paths, names_ok) {
  rows <- rows_of(paths)
  problems <- character()
  e <- list()
  for (r in rows) {
    a <- one(r$from)
    b <- one(r$to)
    type <- one(r$type) %||% "regression"
    if (is.null(a) || is.null(b)) next
    if (!a %in% names_ok || !b %in% names_ok) {
      problems <- c(problems, sprintf("데이터에 없는 변수: %s", paste(setdiff(c(a, b), names_ok), collapse = ", ")))
      next
    }
    if (a == b) {
      problems <- c(problems, sprintf("%s에서 자기 자신으로 가는 경로", a))
      next
    }
    if (!type %in% c("regression", "covariance")) type <- "regression"
    e[[length(e) + 1]] <- edge_rows(a, b, type)
  }
  edges <- if (length(e)) do.call(rbind, e) else empty_edges()
  key <- ifelse(edges$type == "covariance", paste(pmin(edges$from, edges$to), pmax(edges$from, edges$to)), paste(edges$from, edges$to))
  edges <- edges[!duplicated(paste(edges$type, key)), , drop = FALSE]
  reg <- edges[edges$type == "regression", , drop = FALSE]
  if (nrow(reg) && has_cycle(reg)) problems <- c(problems, "화살표가 순환합니다 (예: A → B → A). 이 버전은 순환 없는 경로 모형만 추정합니다")
  list(edges = edges, problems = unique(problems))
}

has_cycle <- function(reg) {
  nodes <- unique(c(reg$from, reg$to))
  indeg <- stats::setNames(vapply(nodes, function(v) sum(reg$to == v), 0), nodes)
  queue <- names(indeg)[indeg == 0]
  seen <- 0
  while (length(queue)) {
    v <- queue[1]
    queue <- queue[-1]
    seen <- seen + 1
    for (w in reg$to[reg$from == v]) {
      indeg[[w]] <- indeg[[w]] - 1
      if (indeg[[w]] == 0) queue <- c(queue, w)
    }
  }
  seen < length(nodes)
}

# Depth along the arrows, used to place variables without a tier.
depth_of <- function(vars, reg) {
  depth <- stats::setNames(rep(1L, length(vars)), vars)
  for (k in seq_along(vars)) {
    changed <- FALSE
    for (i in seq_len(nrow(reg))) {
      a <- reg$from[i]
      b <- reg$to[i]
      if (depth[[b]] < depth[[a]] + 1L) {
        depth[[b]] <- depth[[a]] + 1L
        changed <- TRUE
      }
    }
    if (!changed) break
  }
  depth
}

parents <- function(v, reg) unique(reg$from[reg$to == v])
children <- function(v, reg) unique(reg$to[reg$from == v])

ancestors <- function(v, reg) {
  out <- character()
  frontier <- v
  while (length(frontier)) {
    p <- setdiff(unlist(lapply(frontier, parents, reg = reg)), out)
    out <- c(out, p)
    frontier <- p
  }
  out
}

descendants <- function(v, reg) {
  out <- character()
  frontier <- v
  while (length(frontier)) {
    p <- setdiff(unlist(lapply(frontier, children, reg = reg)), out)
    out <- c(out, p)
    frontier <- p
  }
  out
}

# Every directed route from x to y (capped).
routes <- function(x, y, reg, cap = 200) {
  out <- list()
  walk <- function(path) {
    if (length(out) >= cap) return()
    v <- path[length(path)]
    if (v == y) {
      out[[length(out) + 1]] <<- path
      return()
    }
    for (w in children(v, reg)) if (!w %in% path) walk(c(path, w))
  }
  walk(x)
  out
}

# Background knowledge besides the tiers: links that must be in the graph
# (from -> to) and pairs that are never directly linked.
knowledge <- function(o, vars) {
  pick <- function(x) {
    r <- rows_of(x)
    m <- do.call(rbind, lapply(r, function(z) {
      a <- one(z$from)
      b <- one(z$to)
      if (is.null(a) || is.null(b) || a == b || !a %in% vars || !b %in% vars) NULL else data.frame(from = a, to = b, stringsAsFactors = FALSE)
    }))
    if (is.null(m)) data.frame(from = character(), to = character(), stringsAsFactors = FALSE) else unique(m)
  }
  list(required = pick(o$structure$required), forbidden = pick(o$structure$forbidden))
}

# Problems with the user's required and forbidden links.
knowledge_problems <- function(o, vars, tier) {
  k <- knowledge(o, vars)
  out <- character()
  r <- k$required
  if (nrow(r)) {
    back <- r[tier[r$from] > tier[r$to], , drop = FALSE]
    if (nrow(back)) out <- c(out, sprintf("꼭 넣을 경로가 단계 순서를 거스릅니다: %s. 단계를 바꾸거나 경로를 지우세요", paste(back$from, "→", back$to, collapse = ", ")))
    f <- k$forbidden
    both <- r[paste(r$from, r$to) %in% c(paste(f$from, f$to), paste(f$to, f$from)), , drop = FALSE]
    if (nrow(both)) out <- c(out, sprintf("같은 쌍을 넣을 경로와 넣지 않을 경로에 함께 적었습니다: %s", paste(both$from, "→", both$to, collapse = ", ")))
    if (has_cycle(r)) out <- c(out, "꼭 넣을 경로가 순환합니다")
  }
  out
}
