# 3. Values: numeric summaries, outliers, range / allowed-value / order rules
# and rare category values.

G_VALUES <- "값의 범위"
G_LOGIC <- "논리"

numeric_cols <- function(d) names(d)[vapply(d, function(x) is.numeric(x) && !all(is.na(x)), TRUE)]

numeric_table <- function(d) {
  num <- numeric_cols(d)
  if (!length(num)) return(NULL)
  t <- as.data.frame(dlookr::diagnose_numeric(as.data.frame(d[num])))
  rsage::rs_table("numeric", "수치 변수 진단", t,
    labels = c(variables = "변수", min = "최솟값", Q1 = "Q1", mean = "평균", median = "중앙값", Q3 = "Q3", max = "최댓값",
               zero = "0의 개수", minus = "음수 개수", outlier = "이상치 개수"),
    section = "값의 범위와 규칙",
    description = "최솟값·최댓값이 그 변수에서 가능한 범위인지(나이에 -5나 200) 먼저 봅니다. 0이나 음수가 나오면 안 되는 변수(금액, 수량)에서 그 개수가 0보다 크면 입력 오류나 결측 코드(-99)일 수 있습니다.")
}

# IQR fences, the same rule dlookr and boxplot() use (1.5 x IQR beyond Q1, Q3).
fences <- function(x) {
  s <- grDevices::boxplot.stats(x[!is.na(x)])$stats
  c(lower = s[1], upper = s[5])
}

outlier_checks <- function(d, v, max_ex) {
  num <- numeric_cols(d)
  out <- list()
  if (!length(num)) return(list(finding(G_VALUES, "극단적인 이상치 (IQR)", 0)))
  t <- as.data.frame(dlookr::diagnose_outlier(as.data.frame(d[num])))
  t <- t[order(-t$outliers_cnt), , drop = FALSE]
  flagged <- t$variables[t$outliers_cnt > 0]
  out <- c(out, list(
    finding(G_VALUES, "극단적인 이상치 (IQR)", sum(t$outliers_cnt), flagged,
            "입력 오류(나이 200)는 고치고, 실제 값이면 그대로 두거나 분석에서 따로 다룹니다(절단, 변환, 강건한 방법). '이상치'는 틀린 값이 아니라 확인할 값입니다."),
    if (isTRUE(v$outliers)) rsage::rs_table("outliers", "이상치 진단", t,
      labels = c(variables = "변수", outliers_cnt = "이상치 개수", outliers_ratio = "이상치 비율(%)", outliers_mean = "이상치 평균",
                 with_mean = "전체 평균", without_mean = "이상치 뺀 평균"),
      notes = "이상치: Q1 − 1.5×IQR보다 작거나 Q3 + 1.5×IQR보다 큰 값(상자그림 기준).", section = "값의 범위와 규칙",
      description = "'전체 평균'과 '이상치 뺀 평균'의 차이가 크면 몇 개의 값이 평균을 크게 움직이고 있습니다. 비율이 몇 %를 넘으면 이상치라기보다 분포가 한쪽으로 긴 것일 수 있습니다(로그 변환을 생각합니다).")))
  if (isTRUE(v$outlierPlot) && length(flagged)) out <- c(out, list(outlier_plot(d, utils::head(flagged, 12))))
  if (isTRUE(v$outlierRows) && length(flagged)) {
    rows <- do.call(rbind, lapply(flagged, function(n) {
      x <- d[[n]]
      f <- fences(x)
      i <- which(!is.na(x) & (x < f[["lower"]] | x > f[["upper"]]))
      i <- utils::head(i[order(-abs(x[i] - stats::median(x, na.rm = TRUE)))], max_ex)
      data.frame(variable = n, row = i, value = x[i], lower = f[["lower"]], upper = f[["upper"]])
    }))
    out <- c(out, list(rsage::rs_table("outlierRows", "이상치가 있는 행", rows,
      labels = c(variable = "변수", row = "행", value = "값", lower = "아래 울타리", upper = "위 울타리"),
      notes = sprintf("변수마다 중앙값에서 가장 먼 %d개까지 보여 줍니다.", max_ex), section = "값의 범위와 규칙",
      description = "행 번호로 원본 스프레드시트를 찾아 값이 맞게 들어갔는지 확인합니다. 단위 실수(cm 대신 m), 자리 밀림, 0 하나 더 붙은 값이 흔합니다.")))
  }
  out
}

outlier_plot <- function(d, vars) {
  long <- do.call(rbind, lapply(vars, function(n) {
    x <- d[[n]]
    x <- x[!is.na(x)]
    f <- fences(x)
    data.frame(variable = n, value = x, outlier = x < f[["lower"]] | x > f[["upper"]])
  }))
  long$variable <- factor(long$variable, levels = vars)
  size <- rsage::rs_figure_size(panels = length(vars), aspect = 0.45)
  p <- ggplot2::ggplot(long, ggplot2::aes(.data$value, 0)) +
    ggplot2::geom_boxplot(outlier.shape = NA, width = 0.5, fill = "#eef3f8", colour = "grey45") +
    ggplot2::geom_jitter(ggplot2::aes(colour = .data$outlier), height = 0.12, width = 0, size = 1.1, alpha = 0.7) +
    ggplot2::scale_colour_manual(values = c(`FALSE` = "grey60", `TRUE` = "#c0392b"), labels = c("보통 값", "이상치"), name = NULL) +
    ggplot2::facet_wrap(ggplot2::vars(.data$variable), scales = "free_x", ncol = size$ncol) +
    ggplot2::labs(x = NULL, y = NULL) + theme_rs() +
    ggplot2::theme(axis.text.y = ggplot2::element_blank(), panel.grid.major.y = ggplot2::element_blank(),
                   panel.grid.minor.y = ggplot2::element_blank(), legend.position = "bottom")
  rsage::rs_plot("outliers", "이상치가 있는 변수", p, size = size, section = "값의 범위와 규칙",
                 alt = "이상치가 있는 수치 변수마다 상자그림과 값을 점으로 보여 주는 그림",
                 description = "빨간 점이 상자그림 기준 이상치입니다. 빨간 점이 나머지와 멀리 떨어져 홀로 있으면 입력 오류를, 꼬리를 따라 이어지면 한쪽으로 긴 분포를 의심합니다.")
}

# Values a rule compares: dates for date columns or date-like text, numbers
# for numeric columns or numbers stored as text.
rule_values <- function(x) {
  if (is_dateish(x)) return(as.Date(x))
  if (is.numeric(x)) return(x)
  t <- as_text(x)
  if (is_text(x) && mean(!is.na(date_layout(t[!blank(x)]))) >= 0.5) return(parse_dates(t))
  if (is_text(x)) return(as_number(t))
  x
}

rule_bound <- function(b, like) {
  if (is.null(b) || !nzchar(trim(as.character(b)))) return(NULL)
  b <- trim(as.character(b))
  if (inherits(like, "Date")) parse_dates(b) else suppressWarnings(as.numeric(b))
}

split_values <- function(s) {
  v <- trim(unlist(strsplit(as.character(s %||% ""), "[,|]")))
  v[nzchar(v)]
}

OPS <- c("<" = "<", "<=" = "≤", "==" = "=", "!=" = "≠", ">=" = "≥", ">" = ">")

rule_checks <- function(d, v, max_ex) {
  rows <- list()
  bad_rules <- character()
  row <- function(kind, rule, vars, checked, hit, values) {
    rows[[length(rows) + 1]] <<- data.frame(kind = kind, rule = rule, checked = checked, n = length(hit),
                                            rows = row_list(hit, max_ex), examples = top_values(values, max_ex))
    attr(rows[[length(rows)]], "vars") <<- vars
  }
  for (r in rule_rows(v$ranges)) {
    n <- one_name(r$variable)
    if (is.null(n) || !n %in% names(d)) next
    x <- rule_values(d[[n]])
    lo <- rule_bound(r$min, x)
    hi <- rule_bound(r$max, x)
    lo_ok <- !is.null(lo) && !is.na(lo)
    hi_ok <- !is.null(hi) && !is.na(hi)
    if (!lo_ok && !hi_ok) {
      bad_rules <- c(bad_rules, sprintf("%s의 범위", n))
      next
    }
    out <- rep(FALSE, length(x))
    if (lo_ok) out <- out | (!is.na(x) & x < lo)
    if (hi_ok) out <- out | (!is.na(x) & x > hi)
    rule <- sprintf("%s %s ~ %s", n, if (lo_ok) format(lo) else "", if (hi_ok) format(hi) else "")
    row("허용 범위", trim(rule), n, sum(!is.na(x)), which(out), as_text(d[[n]])[out])
  }
  for (r in rule_rows(v$allowed)) {
    n <- one_name(r$variable)
    vals <- split_values(r$values)
    if (is.null(n) || !n %in% names(d) || !length(vals)) next
    x <- d[[n]]
    t <- trim(as.character(as_text(x)))
    out <- !blank(x) & !t %in% vals
    row("허용 값", sprintf("%s ∈ {%s}", n, paste(vals, collapse = ", ")), n, sum(!blank(x)), which(out), t[out])
  }
  for (r in rule_rows(v$order)) {
    a <- one_name(r$first)
    b <- one_name(r$second)
    op <- r$op %||% "<="
    if (is.null(a) || is.null(b) || !all(c(a, b) %in% names(d)) || !op %in% names(OPS)) next
    x <- rule_values(d[[a]])
    y <- rule_values(d[[b]])
    if (inherits(x, "Date") != inherits(y, "Date")) {
      bad_rules <- c(bad_rules, sprintf("%s %s %s", a, OPS[[op]], b))
      next
    }
    ok <- get(op, baseenv())(as.numeric(x), as.numeric(y))
    both <- !is.na(ok)
    out <- both & !ok
    row("선후 관계", sprintf("%s %s %s", a, OPS[[op]], b), c(a, b), sum(both), which(out),
        sprintf("%s / %s", as_text(d[[a]])[out], as_text(d[[b]])[out]))
  }
  list(rows = rows, bad = bad_rules)
}

# Values that appear in under share% of rows of a column with few distinct
# values: often typos of a common value ("남" and "남 ", "Y" and "y").
rare_levels <- function(d, share, max_ex) {
  rows <- list()
  for (n in names(d)) {
    x <- d[[n]]
    if (!(is_text(x) || is.logical(x))) next
    x <- as.character(as_text(x))[!blank(x)]
    tab <- table(x)
    if (length(x) < 20 || length(tab) < 2 || length(tab) > 30) next
    rare <- tab[100 * tab / length(x) < share]
    if (!length(rare) || length(rare) == length(tab)) next
    common <- names(sort(tab, decreasing = TRUE))[1]
    rows[[length(rows) + 1]] <- data.frame(variable = n, levels = length(tab), rare = length(rare),
                                           values = top_values(x[x %in% names(rare)], max_ex), common = common)
  }
  if (!length(rows)) return(NULL)
  do.call(rbind, rows)
}

value_checks <- function(d, o, max_ex) {
  v <- o$values
  out <- list()
  if (isTRUE(v$numeric)) out <- c(out, list(numeric_table(d)))
  if (isTRUE(v$outliers) || isTRUE(v$outlierPlot) || isTRUE(v$outlierRows)) out <- c(out, outlier_checks(d, v, max_ex))
  rc <- rule_checks(d, v, max_ex)
  kinds <- vapply(rc$rows, function(r) r$kind, "")
  n_of <- function(k) sum(vapply(rc$rows[kinds == k], function(r) r$n, 0L))
  vars_of <- function(k) unlist(lapply(rc$rows[kinds == k], attr, "vars"))
  any_rule <- length(rule_rows(v$ranges)) + length(rule_rows(v$allowed)) + length(rule_rows(v$order))
  out <- c(out, list(
    finding(G_VALUES, "허용 범위 위반", if (any(kinds == "허용 범위")) n_of("허용 범위") else NA, vars_of("허용 범위"),
            "상하한을 벗어난 값을 원본과 대조해 고치거나 결측으로 바꿉니다."),
    finding(G_VALUES, "허용 값(도메인) 위반", if (any(kinds == "허용 값")) n_of("허용 값") else NA, vars_of("허용 값"),
            "허용 값 목록에 없는 값(성별의 X 등)을 바르게 고치거나 결측으로 바꿉니다."),
    finding(G_LOGIC, "선후 관계 모순", if (any(kinds == "선후 관계")) n_of("선후 관계") else NA, vars_of("선후 관계"),
            "두 날짜(시작·종료, 주문·배송)가 뒤바뀐 행을 원본에서 확인해 고칩니다.")))
  if (length(rc$rows)) {
    t <- do.call(rbind, rc$rows)
    out <- c(out, list(rsage::rs_table("rules", "규칙 점검", t,
      labels = c(kind = "종류", rule = "규칙", checked = "확인한 값", n = "위반", rows = "위반 행", examples = "위반 값 예"),
      section = "값의 범위와 규칙",
      description = "직접 정한 규칙을 어긴 행입니다. 허용 범위는 상식적인 한계(나이 0~120), 허용 값은 정해진 보기(남·여), 선후 관계는 두 열의 순서(시작일 ≤ 종료일)를 봅니다.")))
  } else if (!any_rule) {
    out <- c(out, list(rsage::rs_note("허용 범위·허용 값·선후 관계 규칙을 정하면 그 규칙을 어긴 행을 찾아 줍니다. '값의 범위와 규칙' 옵션에서 규칙을 추가하세요.", code = "rules_none")))
  }
  if (length(rc$bad)) out <- c(out, list(rsage::rs_note(sprintf("값의 형식이 맞지 않아 확인하지 못한 규칙: %s", paste(rc$bad, collapse = ", ")), "warning", "rules_unreadable")))
  if (isTRUE(v$rareLevels)) {
    t <- rare_levels(d, v$rareShare %||% 1, max_ex)
    out <- c(out, list(
      finding(G_VALUES, "드문 범주 값 (오타 의심)", if (is.null(t)) 0 else sum(t$rare), t$variable,
              "드문 값이 흔한 값의 오타라면 고치고(허용 값 규칙에도 넣어 둡니다), 실제 범주라면 그대로 둡니다."),
      if (!is.null(t)) rsage::rs_table("rareLevels", "드문 범주 값", t,
        labels = c(variable = "변수", levels = "범주 수", rare = "드문 값 수", values = "드문 값 (행 수)", common = "가장 흔한 값"),
        notes = sprintf("범주가 30개 이하인 변수에서 %s%% 미만으로 나오는 값입니다.", format(v$rareShare %||% 1)),
        section = "값의 범위와 규칙",
        description = "범주가 몇 개뿐인 변수에서 한두 번만 나오는 값은 오타이거나 허용되지 않은 값일 때가 많습니다.")))
  }
  out
}
