# 4. Missing values and duplication: missing values per variable, values
# that stand for "missing" without being NA, empty required fields,
# duplicate rows and duplicate keys.

G_QUALITY <- "결측과 중복"

DEFAULT_CODES <- c("NA", "N/A", "n/a", "NaN", "NULL", "null", "-", ".", "?", "없음", "미상", "모름", "공란", "해당없음", "-99", "-999", "999", "9999")

# Values in a column that look like stand-ins for missing: text codes, empty
# strings, and numeric codes when they are the column's extreme (so a real
# 999 in a column that goes to 5000 is not flagged).
hidden_missing <- function(d, codes) {
  rows <- list()
  low <- tolower(codes)
  num_codes <- suppressWarnings(as.numeric(codes))
  num_codes <- num_codes[!is.na(num_codes)]
  for (n in names(d)) {
    x <- d[[n]]
    if (is_text(x)) {
      t <- as_text(x)
      empty <- !is.na(t) & !nzchar(trim(t))
      if (any(empty)) rows[[length(rows) + 1]] <- data.frame(variable = n, value = "\"\"", kind = "빈 문자열", n = sum(empty))
      hit <- !is.na(t) & nzchar(trim(t)) & tolower(trim(t)) %in% low
      for (v in unique(trim(t[hit]))) rows[[length(rows) + 1]] <- data.frame(variable = n, value = v, kind = "결측 코드", n = sum(trim(t[hit]) == v))
    } else if (is.numeric(x) && length(num_codes) && any(!is.na(x))) {
      ext <- range(x, na.rm = TRUE)
      for (v in intersect(num_codes, ext)) {
        k <- sum(x == v, na.rm = TRUE)
        if (k) rows[[length(rows) + 1]] <- data.frame(variable = n, value = format(v), kind = if (v == ext[2]) "최댓값인 결측 코드" else "최솟값인 결측 코드", n = k)
      }
    }
  }
  if (!length(rows)) return(NULL)
  do.call(rbind, rows)
}

# dlookr's missing grades (plot_na_pareto).
GRADES <- c(Good = 5, OK = 10, NotBad = 20, Bad = 50, Remove = 100)
GRADE_LABELS <- c(Good = "좋음 (≤5%)", OK = "괜찮음 (≤10%)", NotBad = "주의 (≤20%)", Bad = "나쁨 (≤50%)", Remove = "제거 고려 (>50%)")
GRADE_COLOURS <- c(Good = "#2c7fb8", OK = "#7fcdbb", NotBad = "#fdae61", Bad = "#f46d43", Remove = "#a50026")

grade_of <- function(p) names(GRADES)[findInterval(p, c(-Inf, GRADES[-length(GRADES)]), left.open = TRUE)]

missing_pareto <- function(t) {
  t <- t[t$missing_count > 0, , drop = FALSE]
  if (!nrow(t)) return(NULL)
  t <- t[order(-t$missing_count), , drop = FALSE]
  t$variables <- factor(t$variables, levels = t$variables)
  t$grade <- factor(grade_of(t$missing_percent), levels = names(GRADES))
  t$cum <- 100 * cumsum(t$missing_count) / sum(t$missing_count)
  top <- max(t$missing_percent)
  size <- rsage::rs_figure_size(x_items = nrow(t), legend = TRUE, aspect = 0.55)
  p <- ggplot2::ggplot(t, ggplot2::aes(.data$variables)) +
    ggplot2::geom_col(ggplot2::aes(y = .data$missing_percent, fill = .data$grade), colour = "grey40", linewidth = 0.2) +
    ggplot2::geom_line(ggplot2::aes(y = .data$cum * top / 100, group = 1), colour = "grey30") +
    ggplot2::geom_point(ggplot2::aes(y = .data$cum * top / 100), colour = "grey30", size = 1.2) +
    ggplot2::scale_fill_manual(values = GRADE_COLOURS, labels = GRADE_LABELS, name = "결측 등급") +
    ggplot2::scale_y_continuous(name = "결측 비율(%)", sec.axis = ggplot2::sec_axis(~ . * 100 / top, name = "누적 결측 비율(%)")) +
    ggplot2::labs(x = NULL) + theme_rs() +
    ggplot2::theme(axis.text.x = ggplot2::element_text(angle = if (nrow(t) > 6) 45 else 0, hjust = if (nrow(t) > 6) 1 else 0.5))
  rsage::rs_plot("missingPareto", "결측 파레토 그림", p, size = size, section = "결측과 중복",
                 alt = "결측이 있는 변수의 결측 비율을 큰 순서로 막대로, 누적 비율을 선으로 보여 주는 그림",
                 description = "막대 색이 dlookr의 결측 등급입니다. 누적선이 앞쪽 몇 변수에서 빨리 올라가면 결측이 그 변수들에 몰려 있습니다. '제거 고려' 변수는 대체보다 빼는 것을 먼저 생각합니다.")
}

missing_checks <- function(d, o, required, max_ex, diag) {
  m <- o$missing
  out <- list()
  if (isTRUE(m$summary) || isTRUE(m$pareto)) {
    n_missing <- if (is.null(diag)) sum(is.na(as.matrix(d))) else sum(diag$missing_count)
    out <- c(out, list(finding(G_QUALITY, "결측치 (NA)", n_missing, if (is.null(diag)) character() else diag$variables[diag$missing_count > 0],
      "결측이 몰린 변수와 행을 확인합니다. 패턴과 대체는 '결측 데이터' 분석에서 자세히 봅니다.")))
    if (isTRUE(m$pareto) && !is.null(diag)) out <- c(out, list(missing_pareto(diag)))
  }
  if (isTRUE(m$hidden)) {
    t <- hidden_missing(d, as.character(unlist(m$codes %||% DEFAULT_CODES)))
    out <- c(out, list(
      finding(G_QUALITY, "결측을 뜻하는 값 (N/A, -99, 빈 문자열)", if (is.null(t)) 0 else sum(t$n), t$variable,
              "결측 코드를 NA로 바꿉니다. 같은 뜻의 코드가 여러 가지면 하나로 정합니다."),
      if (!is.null(t)) rsage::rs_table("hiddenMissing", "결측을 뜻하는 값", t,
        labels = c(variable = "변수", value = "값", kind = "종류", n = "개수"), section = "결측과 중복",
        notes = "숫자 결측 코드(-99, 999 등)는 그 열의 최솟값이나 최댓값일 때만 보여 줍니다.",
        description = "NA가 아니라서 R이 결측으로 세지 않는 값입니다. 그대로 두면 -99가 평균에 들어가고, 'N/A'가 범주 하나로 집계됩니다.")))
  }
  if (length(required)) {
    rows <- lapply(required, function(n) {
      b <- blank(d[[n]])
      data.frame(variable = n, n = sum(b), rows = row_list(which(b), max_ex))
    })
    t <- do.call(rbind, rows)
    out <- c(out, list(
      finding(G_QUALITY, "필수값 누락", sum(t$n), t$variable[t$n > 0], "필수값이 빈 행은 원본에서 채우거나, 채울 수 없으면 그 이유(수집 불가 등)를 기록합니다."),
      rsage::rs_table("required", "필수 변수의 빈 값", t, labels = c(variable = "변수", n = "빈 값", rows = "행"),
        section = "결측과 중복",
        description = "ID·이메일·주문번호처럼 모든 행에 있어야 하는 값입니다. 빈 칸이 단순 누락인지, 원래 수집할 수 없는 값인지 나눠서 기록합니다.")))
  }
  out
}

duplicate_checks <- function(d, o, keys, max_ex) {
  s <- o$duplicates
  out <- list()
  if (isTRUE(s$rows)) {
    dup <- duplicated(d) | duplicated(d, fromLast = TRUE)
    extra <- sum(duplicated(d))
    out <- c(out, list(finding(G_QUALITY, "중복 행", extra, fix = "완전히 같은 행은 하나만 남깁니다(dplyr::distinct). 두 번 입력된 것인지 실제로 같은 관측인지 먼저 확인합니다.")))
    if (extra) {
      key <- do.call(paste, c(lapply(d, function(x) ifelse(is.na(x), "\001", as.character(x))), sep = "\002"))
      groups <- split(which(dup), key[dup])
      groups <- groups[order(-lengths(groups))]
      t <- data.frame(copies = lengths(groups), rows = vapply(groups, row_list, "", n = 8), row.names = NULL)
      out <- c(out, list(rsage::rs_table("duplicateRows", "중복 행", utils::head(t, max_ex * 2),
        labels = c(copies = "같은 행 수", rows = "행"),
        notes = sprintf("모든 열의 값이 같은 행 묶음 %d개, 남는 사본 %d행.", length(groups), extra), section = "결측과 중복",
        description = "같은 행 묶음 하나가 한 줄입니다. 복사해 붙이다 두 번 들어간 행이 흔합니다.")))
    }
  }
  if (isTRUE(s$keys) && length(keys)) {
    k <- d[keys]
    missing_key <- which(rowSums(as.data.frame(lapply(k, blank))) > 0)
    dup <- duplicated(k) | duplicated(k, fromLast = TRUE)
    dup[missing_key] <- FALSE
    label <- paste(keys, collapse = " + ")
    out <- c(out, list(finding(G_QUALITY, sprintf("키 중복 (%s)", label), sum(dup), if (any(dup)) keys,
      "같은 키를 가진 행이 같은 대상의 중복 입력이면 하나로 합치고, 다른 대상이면 키를 바로잡습니다.")))
    if (any(dup)) {
      key <- do.call(paste, c(lapply(k, as.character), sep = " / "))
      groups <- split(which(dup), key[dup])
      groups <- groups[order(-lengths(groups))]
      t <- data.frame(key = names(groups), copies = lengths(groups), rows = vapply(groups, row_list, "", n = 8), row.names = NULL)
      out <- c(out, list(rsage::rs_table("duplicateKeys", sprintf("키가 같은 행 (%s)", label), utils::head(t, max_ex * 2),
        labels = c(key = label, copies = "행 수", rows = "행"),
        notes = sprintf("키 값 %d개가 두 번 이상 나옵니다.", length(groups)), section = "결측과 중복",
        description = "회원번호·거래번호처럼 하나뿐이어야 할 값이 여러 행에 있습니다. 행 전체가 같으면 중복 입력이고, 나머지 값이 다르면 서로 다른 대상에 같은 번호가 붙은 것입니다.")))
    }
    if (length(missing_key)) {
      out <- c(out, list(rsage::rs_note(sprintf("키(%s)가 빈 행이 %d개 있습니다: %s행.", label, length(missing_key), row_list(missing_key, max_ex)),
                                       "warning", "key_missing")))
    }
  }
  out
}
