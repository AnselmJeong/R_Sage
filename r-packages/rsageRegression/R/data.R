# The model data: outcome, predictors with their coding and transforms,
# offset and weights, on one fixed sample. Complete cases are taken over the
# columns the models actually use, so models compared with each other are
# fitted to the same rows. Nothing is rounded, merged or imputed.

prepare_data <- function(data, o, terms, models, predictors) {
  problems <- character()
  notes <- list()
  y_name <- one(o$outcome$variable)
  categorical <- intersect(chr(o$predictors$categorical), predictors)
  used <- unique(unlist(lapply(terms[unique(unlist(lapply(models, function(m) chr(m$termIds))))], term_vars, terms = terms)))
  used <- predictors[predictors %in% used]
  grouped <- identical(o$outcome$encoding, "grouped")
  trials <- if (grouped) one(o$outcome$trials) else NULL
  off_mode <- o$offset$mode %||% "none"
  off_var <- if (off_mode != "none") one(o$offset$variable) else NULL
  w_var <- if (identical(o$weights$mode, "precision")) one(o$weights$variable) else NULL
  if (off_mode != "none" && is.null(off_var)) problems <- c(problems, "offset 열을 고르세요")
  if (identical(o$weights$mode, "precision") && is.null(w_var)) problems <- c(problems, "가중치 열을 고르세요")
  if (!is.null(off_var) && off_var %in% c(y_name, used)) problems <- c(problems, "offset 열은 결과변수나 설명변수로 쓸 수 없습니다")

  n <- nrow(data)
  row_id <- if (.row_names_info(data) > 0) rownames(data) else as.character(seq_len(n))
  needed <- unique(c(y_name, trials, off_var, w_var, used))
  miss <- vapply(needed, function(v) sum(is.na(data[[v]])), 0L)

  # Rows with every needed value; per-model samples drop only that model's columns.
  per_model <- identical(o$missing$sampleScope, "per_model")
  base_ok <- stats::complete.cases(data[c(y_name, trials, off_var, w_var)])
  model_vars <- lapply(models, function(m) unique(unlist(lapply(terms[chr(m$termIds)], term_vars, terms = terms))))
  keep <- lapply(model_vars, function(v) base_ok & stats::complete.cases(data[c(y_name, v)]))
  shared <- base_ok & stats::complete.cases(data[needed])
  if (!per_model) keep <- lapply(keep, function(k) shared)
  any_row <- Reduce(`|`, keep, shared)

  md <- data.frame(row.names = seq_len(n))
  map <- stats::setNames(character(), character())
  levels_of <- list()
  contrasts <- list()
  constants <- list()
  factors <- rows_of(o$coding$factors)
  transforms <- rows_of(o$coding$transforms)
  for (i in seq_along(used)) {
    v <- used[i]
    key <- sprintf("rsv%03d", i)
    map[key] <- v
    x <- data[[v]]
    if (v %in% categorical) {
      f <- if (is.factor(x)) droplevels(factor(x, ordered = FALSE)) else factor(x)
      f <- droplevels(f[any_row])
      spec <- Filter(function(r) identical(one(r$variable), v), factors)
      ref <- if (length(spec)) one(spec[[1]]$reference) else NULL
      if (!is.null(ref)) {
        if (ref %in% levels(f)) f <- stats::relevel(f, ref)
        else problems <- c(problems, sprintf("%s의 참조 범주 %s가 분석 표본에 없습니다", v, ref))
      }
      if (nlevels(f) < 2) problems <- c(problems, sprintf("범주 설명변수 %s의 값이 한 가지뿐입니다", v))
      full <- factor(rep(NA, n), levels = levels(f))
      full[any_row] <- f
      md[[key]] <- full
      levels_of[[key]] <- levels(f)
      if (length(spec) && identical(one(spec[[1]]$contrast), "sum")) contrasts[[key]] <- "contr.sum"
    } else {
      if (!is.numeric(x) && !is.logical(x)) {
        problems <- c(problems, sprintf("연속 설명변수 %s가 숫자가 아닙니다. 범주 설명변수로 넣으세요", v))
        next
      }
      x <- as.numeric(x)
      spec <- Filter(function(r) identical(one(r$variable), v), transforms)
      tr <- if (length(spec)) spec[[1]] else list()
      if (identical(one(tr$transform), "log")) {
        if (any(x[any_row] <= 0)) {
          problems <- c(problems, sprintf("%s에 0 이하 값이 있어 로그를 취할 수 없습니다 (값을 더하지 않습니다)", v))
        } else x <- log(x)
      }
      center <- one(tr$center) %||% "none"
      cval <- if (center == "mean") mean(x[shared]) else if (center == "value") as.numeric(tr$centerValue %||% NA) else 0
      if (is.na(cval)) {
        problems <- c(problems, sprintf("%s의 중심화 기준값을 정하세요", v))
        cval <- 0
      }
      if (cval != 0) {
        x <- x - cval
        constants[[v]] <- cval
      }
      md[[key]] <- x
    }
  }
  y <- data[[y_name]]
  md$rs_y <- if (is.factor(y)) as.character(y) else y
  if (!is.null(trials)) {
    tr <- data[[trials]]
    if (!is.numeric(tr) || any(tr[any_row] <= 0 | tr[any_row] != round(tr[any_row])) || any(y[any_row] > tr[any_row]))
      problems <- c(problems, "시행 수는 양의 정수이고 성공 수 이상이어야 합니다")
    md$rs_n <- tr
  }
  if (!is.null(off_var)) {
    ov <- as.numeric(data[[off_var]])
    if (off_mode == "exposure") {
      if (any(ov[any_row] <= 0)) problems <- c(problems, sprintf("노출량 %s에 0 이하 값이 있습니다 (제외하거나 보정하지 않습니다)", off_var))
      else ov <- log(ov)
    }
    md$rs_off <- ov
  }
  if (!is.null(w_var)) {
    wv <- as.numeric(data[[w_var]])
    if (any(wv[any_row] <= 0)) problems <- c(problems, sprintf("가중치 %s에 0 이하 값이 있습니다", w_var))
    md$rs_w <- wv
  }
  label_col <- one(o$diagnostics$rowLabel)
  md$rs_row <- row_id
  md$rs_label <- if (!is.null(label_col)) as.character(data[[label_col]]) else row_id

  dropped <- sum(!shared)
  sample <- data.frame(
    item = c(paste0("결측: ", needed), "결측 때문에 뺀 행", "분석 표본 (N)"),
    n = c(unname(miss), dropped, sum(shared)))
  if (dropped > 0) notes <- c(notes, list(rsage::rs_note(
    sprintf("모형에 쓰는 열에 결측이 있는 %d행을 빼고 %s %d행으로 적합했습니다.", dropped,
            if (per_model) "모형마다 따로" else "모든 모형이 같은", sum(shared)),
    "info", "regression_sample_changed")))
  list(md = md, keep = keep, shared = shared, map = map, levels = levels_of, contrasts = contrasts,
       constants = constants, sample = sample, problems = problems, notes = notes,
       grouped = grouped, offset = !is.null(off_var),
       offset_label = if (!is.null(off_var)) if (off_mode == "exposure") sprintf("offset(log(%s))", off_var) else sprintf("offset(%s)", off_var),
       weights = !is.null(w_var), used = used,
       per_model = per_model)
}

# Internal name of an original column.
key_of <- function(v, prep) names(prep$map)[match(v, prep$map)]

# Formula for one model: built from names, never parsed from user text.
model_formula <- function(m, terms, prep, response) {
  labels <- vapply(terms[chr(m$termIds)], function(t) paste(key_of(term_vars(t, terms), prep), collapse = ":"), "")
  rhs <- if (length(labels)) Reduce(function(a, b) call("+", a, b), lapply(labels, str2lang)) else 1
  if (!isTRUE(m$intercept %||% TRUE)) rhs <- call("+", rhs, 0)
  if (prep$offset) rhs <- call("+", rhs, quote(offset(rs_off)))
  f <- call("~", response, rhs)
  stats::as.formula(f, env = asNamespace("stats"))
}

# Formula as the user reads it, with column names.
formula_text <- function(m, terms, prep, y_label) {
  labels <- vapply(terms[chr(m$termIds)], function(t) paste(term_vars(t, terms), collapse = ":"), "")
  rhs <- if (length(labels)) paste(labels, collapse = " + ") else "1"
  if (!isTRUE(m$intercept %||% TRUE)) rhs <- paste(rhs, "- 1")
  if (prep$offset) rhs <- paste(rhs, "+", prep$offset_label)
  paste(y_label, "~", rhs)
}

# Coefficient name (rsv002B:rsv001) as the user reads it (성별[B] × 나이).
label_coef <- function(name, prep) {
  if (name == "(Intercept)") return("절편")
  parts <- strsplit(name, ":", fixed = TRUE)[[1]]
  vapply(parts, function(p) {
    key <- substr(p, 1, 6)
    v <- prep$map[key]
    if (is.na(v)) return(p)
    rest <- substring(p, 7)
    if (!nzchar(rest)) return(unname(v))
    lv <- prep$levels[[key]]
    # Sum coding names columns 1, 2, ...: each is a level against the grand mean.
    if (!is.null(prep$contrasts[[key]]) && grepl("^[0-9]+$", rest)) rest <- lv[as.integer(rest)]
    sprintf("%s[%s]", v, rest)
  }, "") |> paste(collapse = " × ")
}

# Term label (rsv001:rsv002) as the user reads it (나이 × 성별).
label_term <- function(label, prep) {
  parts <- strsplit(label, ":", fixed = TRUE)[[1]]
  paste(ifelse(parts %in% names(prep$map), prep$map[parts], parts), collapse = " × ")
}
