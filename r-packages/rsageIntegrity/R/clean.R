# 6. A cleaned copy of the data: each step fixes what one check finds. The
# original data frame is never changed; the copy is returned as an export.

safe_names <- function(nms) {
  n <- trim(ifelse(is.na(nms), "", nms))
  n <- gsub("[\\h\\v]+", "_", n, perl = TRUE)
  n <- gsub("[^\\p{L}\\p{N}_.]", "", n, perl = TRUE)
  n <- gsub("_+", "_", n)
  n[!nzchar(n)] <- paste0("V", which(!nzchar(n)))
  n <- ifelse(grepl("^[0-9]", n), paste0("X", n), n)
  unique_names(n)
}

#' @param orig Original column names, named by the (unique) names of d.
clean_data <- function(d, o, keys, orig = stats::setNames(names(d), names(d))) {
  c <- o$clean
  log <- list()
  note <- function(step, var, n) if (n > 0) log[[length(log) + 1]] <<- data.frame(step = step, variable = var, n = as.integer(n))
  text <- text_cols(d)

  if (isTRUE(c$trim)) for (n in text) {
    x <- as_text(d[[n]])
    y <- trim(gsub("[\\h\u200B\uFEFF\\t\\r\\n]+", " ", x, perl = TRUE))
    note("공백 정리", n, sum(x != y, na.rm = TRUE))
    d[[n]] <- y
  }
  if (isTRUE(c$hiddenMissing)) {
    codes <- as.character(unlist(o$missing$codes %||% DEFAULT_CODES))
    h <- hidden_missing(d, codes)
    if (!is.null(h)) for (n in unique(h$variable)) {
      x <- d[[n]]
      if (is_text(x)) {
        t <- as_text(x)
        hit <- !is.na(t) & (!nzchar(trim(t)) | tolower(trim(t)) %in% tolower(codes))
      } else {
        vals <- suppressWarnings(as.numeric(h$value[h$variable == n]))
        hit <- !is.na(x) & x %in% vals
      }
      x[hit] <- NA
      d[[n]] <- x
      note("결측 코드를 NA로", n, sum(hit))
    }
  }
  if (length(rule_rows(o$text$synonyms)) && isTRUE(c$synonyms)) for (r in synonym_rules(o$text$synonyms, d)) for (n in r$cols) {
    t <- as_text(d[[n]])
    hit <- synonym_hit(trim(t), r)
    t[hit] <- r$to
    d[[n]] <- t
    note(sprintf("동의어 → %s", r$to), n, sum(hit))
  }
  if (isTRUE(c$variants)) {
    v <- variant_checks(d, 1)
    if (!is.null(v)) for (n in unique(v$variable)) {
      t <- as_text(d[[n]])
      key <- fold(ifelse(is.na(t), "", t))
      for (s in v$suggestion[v$variable == n]) {
        hit <- !is.na(t) & key == fold(s) & t != s
        t[hit] <- s
        note("표기 통일", n, sum(hit))
      }
      d[[n]] <- t
    }
  }
  if (isTRUE(c$numbers)) {
    nt <- number_text(d, 1)
    if (!is.null(nt)) for (n in nt$variable) {
      x <- as_text(d[[n]])
      y <- as_number(x)
      note("숫자로 바꿈", n, sum(!blank(x)))
      note("숫자가 아니어서 NA로", n, sum(!blank(x) & is.na(y)))
      d[[n]] <- y
    }
  }
  if (isTRUE(c$dates)) for (n in text_cols(d)) {
    x <- as_text(d[[n]])
    filled <- !blank(x)
    if (sum(filled) < 2 || mean(!is.na(date_layout(x[filled]))) < 0.5) next
    y <- parse_dates(x)
    y[!filled] <- NA
    note("날짜로 바꿈 (YYYY-MM-DD)", n, sum(filled & !is.na(y)))
    note("날짜가 아니어서 NA로", n, sum(filled & is.na(y)))
    d[[n]] <- y
  }
  if (isTRUE(c$padZeros)) {
    lz <- leading_zero_checks(d, keys, 1)
    if (!is.null(lz)) for (n in lz$variable) {
      x <- d[[n]]
      t <- if (is.numeric(x)) ifelse(is.na(x), NA, format(x, scientific = FALSE, trim = TRUE)) else trim(as_text(x))
      w <- max(nchar(t), na.rm = TRUE)
      short <- !is.na(t) & nchar(t) < w
      t[short] <- formatC(t[short], width = w, flag = "0")
      t[short] <- gsub(" ", "0", t[short], fixed = TRUE)
      note(sprintf("앞자리 0 채움 (%d자리)", w), n, sum(short))
      d[[n]] <- t
    }
  }
  if (isTRUE(c$ruleViolations)) for (kind in c("허용 범위", "허용 값")) {
    rules <- rule_rows(if (kind == "허용 범위") o$values$ranges else o$values$allowed)
    for (n in intersect(unique(unlist(lapply(rules, function(r) one_name(r$variable)))), names(d))) {
      hit <- rule_hits(d, o$values, n, kind)
      v <- d[[n]]
      v[hit] <- NA
      d[[n]] <- v
      note(sprintf("%s 위반을 NA로", kind), n, sum(hit))
    }
  }
  n_before <- nrow(d)
  if (isTRUE(c$emptyRows)) {
    keep <- rowSums(!as.data.frame(lapply(d, blank))) > 0
    d <- d[keep, , drop = FALSE]
    note("빈 행 지움", "(행)", sum(!keep))
  }
  if (isTRUE(c$duplicates)) {
    dup <- duplicated(d)
    d <- d[!dup, , drop = FALSE]
    note("중복 행 지움", "(행)", sum(dup))
  }
  if (isTRUE(c$emptyColumns)) {
    empty <- vapply(d, function(x) all(blank(x)), TRUE)
    for (n in names(d)[empty]) note("빈 열 지움", n, 1)
    d <- d[!empty]
  }
  old <- unname(orig[names(d)])
  if (isTRUE(c$names)) {
    new <- safe_names(old)
    for (i in which(is.na(old) | new != old)) note(sprintf("변수명 → %s", new[i]), old[i] %||% "", 1)
    names(d) <- new
  } else {
    names(d) <- old
  }
  rownames(d) <- NULL
  log <- if (length(log)) do.call(rbind, log) else data.frame(step = character(), variable = character(), n = integer())
  list(data = tibble::as_tibble(d, .name_repair = "minimal"), log = log, dropped = n_before - nrow(d))
}

# Rows of one variable that break its range or allowed-value rules.
rule_hits <- function(d, v, n, kind) {
  x <- d[[n]]
  hit <- rep(FALSE, length(x))
  if (kind == "허용 범위") for (r in rule_rows(v$ranges)) if (identical(one_name(r$variable), n)) {
    y <- rule_values(x)
    lo <- rule_bound(r$min, y)
    hi <- rule_bound(r$max, y)
    if (!is.null(lo) && !is.na(lo)) hit <- hit | (!is.na(y) & y < lo)
    if (!is.null(hi) && !is.na(hi)) hit <- hit | (!is.na(y) & y > hi)
  }
  if (kind == "허용 값") for (r in rule_rows(v$allowed)) if (identical(one_name(r$variable), n)) {
    hit <- hit | (!blank(x) & !trim(as.character(as_text(x))) %in% split_values(r$values))
  }
  hit
}

clean_items <- function(d, o, keys, orig) {
  res <- clean_data(d, o, keys, orig)
  save_as <- as.character(o$clean$saveAs %||% "")
  items <- list(rsage::rs_table("cleaning", "정리한 내용", res$log,
    labels = c(step = "정리", variable = "변수", n = "바뀐 값"), section = "정리한 데이터",
    notes = sprintf("정리한 데이터: %d행 × %d열. 원본 데이터는 바뀌지 않습니다.", nrow(res$data), ncol(res$data)),
    description = "정리 단계마다 몇 개의 값이 바뀌었는지입니다. 'NA로' 단계가 많으면 원본에서 그 값을 확인한 뒤 정리하는 것이 안전합니다."))
  exports <- list()
  if (length(save_as) && nzchar(save_as)) {
    exports[[save_as]] <- res$data
    items <- c(items, list(rsage::rs_note(sprintf("정리한 데이터를 R 세션의 '%s'에 저장했습니다. 다시 점검하려면 이 분석의 데이터를 '%s'로 바꿉니다.", save_as, save_as),
                                          code = "cleaned_saved")))
  }
  list(items = items, exports = exports)
}
