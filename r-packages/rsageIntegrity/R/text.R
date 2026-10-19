# 5. Text standardisation: stray whitespace, values that differ only in case
# or spacing, similar spellings, synonyms, category frequencies.

G_TEXT <- "텍스트"

text_cols <- function(d) names(d)[vapply(d, is_text, TRUE)]

# Text columns that hold words: not numbers, dates or codes stored as text,
# which the format checks cover and whose values differ only in punctuation
# or one digit by nature.
word_cols <- function(d) {
  Filter(function(n) {
    t <- trim(as_text(d[[n]]))
    t <- t[!is.na(t) & nzchar(t)]
    length(t) && mean(grepl("^[0-9[:punct:]\\h]+$", t, perl = TRUE) | !is.na(date_layout(t))) < 0.5
  }, text_cols(d))
}

whitespace_checks <- function(d, max_ex) {
  rows <- list()
  kinds <- list(
    edge = list(label = "앞뒤 공백", test = function(t) t != trim(t)),
    double = list(label = "겹친 공백", test = function(t) grepl("\\h{2,}", trim(t), perl = TRUE)),
    hidden = list(label = "보이지 않는 공백 (NBSP, 전각, 폭 없는 공백, 탭·줄바꿈)",
                  test = function(t) grepl("[\u00A0\u3000\u200B\uFEFF\\t\\r\\n]", t, perl = TRUE))
  )
  for (n in text_cols(d)) {
    t <- as_text(d[[n]])
    t <- t[!is.na(t) & nzchar(trim(t))]
    for (k in kinds) {
      hit <- k$test(t)
      if (any(hit)) rows[[length(rows) + 1]] <- data.frame(variable = n, problem = k$label, n = sum(hit), examples = top_values(t[hit], max_ex))
    }
  }
  if (!length(rows)) return(NULL)
  do.call(rbind, rows)
}

# Case, width and spacing folded away: "Seoul", " seoul", "SEOUL" share a key.
fold <- function(t) {
  if (has("stringi")) t <- stringi::stri_trans_nfkc(t)
  tolower(gsub("[\\h\\v\u200B\uFEFF[:punct:]]", "", t, perl = TRUE))
}

variant_checks <- function(d, max_ex) {
  rows <- list()
  for (n in word_cols(d)) {
    t <- as_text(d[[n]])
    t <- t[!is.na(t) & nzchar(trim(t))]
    if (!length(t)) next
    key <- fold(t)
    groups <- tapply(t, key, function(v) unique(v))
    groups <- groups[lengths(groups) > 1]
    for (g in groups) {
      counts <- vapply(g, function(v) sum(t == v), 0L)
      rows[[length(rows) + 1]] <- data.frame(variable = n, variants = length(g), values = top_values(t[t %in% g], max_ex),
                                             suggestion = g[which.max(counts)])
    }
  }
  if (!length(rows)) return(NULL)
  out <- do.call(rbind, rows)
  out[order(out$variable, -out$variants), , drop = FALSE]
}

# Pairs of distinct values within max_dist edits of each other ("Busan",
# "Busna"), for columns with up to 300 distinct values. Short values are
# skipped: every pair of two-letter codes is one edit apart.
similar_checks <- function(d, max_dist, max_ex) {
  rows <- list()
  for (n in word_cols(d)) {
    t <- trim(as_text(d[[n]]))
    t <- t[!is.na(t) & nzchar(t)]
    u <- unique(t)
    keys <- fold(u)
    keep <- !duplicated(keys) & nchar(keys) >= 3 & !grepl("^[0-9]+$", keys)
    u <- u[keep]
    keys <- keys[keep]
    if (length(u) < 2 || length(u) > 300) next
    dist <- utils::adist(keys)
    # Two neighbouring letters swapped ("Busan", "Busna") is one typo, not two edits.
    two <- which(dist == 2 & upper.tri(dist), arr.ind = TRUE)
    for (k in seq_len(nrow(two))) if (swapped(keys[two[k, 1]], keys[two[k, 2]])) dist[two[k, 1], two[k, 2]] <- 1
    pairs <- which(dist <= max_dist & upper.tri(dist), arr.ind = TRUE)
    if (!nrow(pairs)) next
    cnt <- table(t)
    for (i in seq_len(min(nrow(pairs), max_ex * 3))) {
      a <- u[pairs[i, 1]]
      b <- u[pairs[i, 2]]
      rows[[length(rows) + 1]] <- data.frame(variable = n, a = a, n_a = as.integer(cnt[[a]]), b = b, n_b = as.integer(cnt[[b]]),
                                             distance = dist[pairs[i, 1], pairs[i, 2]])
    }
  }
  if (!length(rows)) return(NULL)
  do.call(rbind, rows)
}

swapped <- function(a, b) {
  a <- strsplit(a, "")[[1]]
  b <- strsplit(b, "")[[1]]
  if (length(a) != length(b)) return(FALSE)
  i <- which(a != b)
  length(i) == 2 && i[2] == i[1] + 1 && a[i[1]] == b[i[2]] && a[i[2]] == b[i[1]]
}

# Synonym rules: in a variable (or every text variable), these values mean
# the same thing and should read `to`. Values match ignoring case and
# spacing, so "KOREA" also catches "Korea" and " korea".
synonym_rules <- function(rules, d) {
  out <- list()
  for (r in rule_rows(rules)) {
    vals <- split_values(r$values)
    to <- trim(as.character(r$to %||% ""))
    if (!length(vals)) next
    if (!nzchar(to)) to <- vals[1]
    n <- one_name(r$variable)
    cols <- if (is.null(n)) text_cols(d) else intersect(n, names(d))
    out[[length(out) + 1]] <- list(cols = cols, values = vals, to = to)
  }
  out
}

synonym_hit <- function(t, r) !is.na(t) & fold(t) %in% fold(r$values) & t != r$to

synonym_checks <- function(d, rules) {
  rows <- list()
  for (r in synonym_rules(rules, d)) {
    for (n in r$cols) {
      t <- trim(as.character(as_text(d[[n]])))
      hit <- synonym_hit(t, r)
      if (!any(hit)) next
      rows[[length(rows) + 1]] <- data.frame(variable = n, to = r$to, values = top_values(t[hit], 10), n = sum(hit))
    }
  }
  if (!length(rows)) return(NULL)
  do.call(rbind, rows)
}

text_checks <- function(d, o, max_ex) {
  s <- o$text
  out <- list()
  if (isTRUE(s$whitespace)) {
    t <- whitespace_checks(d, max_ex)
    out <- c(out, list(
      finding(G_TEXT, "공백 오류", if (is.null(t)) 0 else sum(t$n), t$variable,
              "앞뒤 공백을 지우고(trimws) 겹친 공백과 보이지 않는 공백을 보통 공백 하나로 바꿉니다."),
      if (!is.null(t)) rsage::rs_table("whitespace", "공백 오류", t,
        labels = c(variable = "변수", problem = "문제", n = "값 수", examples = "예"), section = "텍스트",
        description = "\" Seoul\"과 \"Seoul\"은 눈으로는 같지만 R은 다른 값으로 셉니다. 웹이나 한글 문서에서 복사한 값에는 보이지 않는 공백이 섞이기 쉽습니다.")))
  }
  if (isTRUE(s$variants)) {
    t <- variant_checks(d, max_ex)
    out <- c(out, list(
      finding(G_TEXT, "대소문자·공백만 다른 값", if (is.null(t)) 0 else nrow(t), t$variable, "가장 많이 쓴 표기로 통일합니다."),
      if (!is.null(t)) rsage::rs_table("variants", "대소문자·공백·문장부호만 다른 값", t,
        labels = c(variable = "변수", variants = "표기 수", values = "표기 (행 수)", suggestion = "제안 (가장 흔한 표기)"),
        section = "텍스트",
        description = "한 줄이 같은 값으로 보이는 표기 묶음입니다. 집계할 때 따로 세어져 범주가 쪼개집니다.")))
  }
  if (isTRUE(s$similar)) {
    t <- similar_checks(d, as.integer(s$maxDistance %||% 1L), max_ex)
    out <- c(out, list(
      finding(G_TEXT, "철자가 비슷한 값", if (is.null(t)) 0 else nrow(t), t$variable, "오타라면 바른 표기로 고칩니다. 동의어 규칙에 넣으면 정리할 때 함께 바뀝니다."),
      if (!is.null(t)) rsage::rs_table("similar", "철자가 비슷한 값", t,
        labels = c(variable = "변수", a = "값 A", n_a = "A 행 수", b = "값 B", n_b = "B 행 수", distance = "편집 거리"),
        notes = "편집 거리: 한 값을 다른 값으로 바꾸는 데 필요한 글자 추가·삭제·교체 횟수(대소문자·공백 무시).",
        section = "텍스트",
        description = "한쪽이 훨씬 드물면 그쪽이 오타일 가능성이 큽니다. 'Kim'과 'Kin'처럼 둘 다 맞는 값일 수도 있으니 확인 후 고칩니다.")))
  }
  if (length(rule_rows(s$synonyms))) {
    t <- synonym_checks(d, s$synonyms)
    out <- c(out, list(
      finding(G_TEXT, "동의어 불일치", if (is.null(t)) 0 else sum(t$n), t$variable, "동의어 규칙의 대표 표기로 바꿉니다. '정리한 데이터 만들기'가 해 줍니다."),
      if (!is.null(t)) rsage::rs_table("synonyms", "동의어", t,
        labels = c(variable = "변수", to = "대표 표기", values = "다른 표기 (행 수)", n = "바꿀 행"), section = "텍스트",
        description = "같은 대상을 다르게 쓴 값(한국, 대한민국, KOREA)입니다. 대표 표기로 통일하지 않으면 집계가 여러 범주로 흩어집니다.")))
  } else {
    out <- c(out, list(finding(G_TEXT, "동의어 불일치", NA, fix = "동의어 규칙(예: 한국, 대한민국, KOREA → 대한민국)을 정하면 확인합니다.")))
  }
  if (isTRUE(s$categories)) {
    cols <- names(d)[vapply(d, function(x) is_text(x) || is.logical(x), TRUE)]
    if (length(cols)) {
      t <- as.data.frame(dlookr::diagnose_category(as.data.frame(d[cols]), top = as.integer(s$topLevels %||% 10L)))
      t$levels <- show_value(t$levels)
      out <- c(out, list(rsage::rs_table("categories", "범주 변수 진단", t,
        labels = c(variables = "변수", levels = "값", N = "전체 N", freq = "행 수", ratio = "비율(%)", rank = "순위"),
        notes = sprintf("변수마다 많이 나온 값 %d개까지 보여 줍니다.", as.integer(s$topLevels %||% 10L)), section = "텍스트",
        description = "값마다 몇 행인지 봅니다. 같은 뜻의 값이 따로 줄을 차지하거나, 예상하지 못한 값(X, 기타, 오타)이 있는지 찾습니다.")))
    }
  }
  out
}
