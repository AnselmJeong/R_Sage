# 2. Types and formats: numbers stored as text, mixed date formats, lost
# leading zeros.

G_FORMAT <- "형식"

# Text that reads as a number once thousands separators, currency and unit
# marks are removed ("1,000원", "$ 20", "15%").
UNIT_MARKS <- "[,\\h₩$€£¥%]|원$|개$|명$|건$"

as_number <- function(x) suppressWarnings(as.numeric(gsub(UNIT_MARKS, "", trim(x), perl = TRUE)))

plain_number <- function(x) suppressWarnings(!is.na(as.numeric(trim(x))))

# Text columns where at least half the filled values are numbers: the
# column was meant to be numeric and a few entries keep it as text.
number_text <- function(d, max_ex) {
  rows <- list()
  for (v in names(d)) {
    x <- d[[v]]
    if (!is_text(x)) next
    x <- as_text(x)[!blank(x)]
    if (length(x) < 3) next
    plain <- plain_number(x)
    num <- !is.na(as_number(x))
    if (mean(num) < 0.5 || all(plain)) next
    rows[[length(rows) + 1]] <- data.frame(
      variable = v, n = length(x), numbers = sum(plain), with_marks = sum(num & !plain),
      marked = top_values(x[num & !plain], max_ex), other = sum(!num), others = top_values(x[!num], max_ex))
  }
  if (!length(rows)) return(NULL)
  do.call(rbind, rows)
}

# Date layouts seen in spreadsheets. Each is a regular expression on the
# trimmed text and the format that parses it.
DATE_FORMATS <- list(
  list(label = "YYYY-MM-DD", re = "^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}$", fmt = "%Y-%m-%d"),
  list(label = "YYYY/MM/DD", re = "^[0-9]{4}/[0-9]{1,2}/[0-9]{1,2}$", fmt = "%Y/%m/%d"),
  list(label = "YYYY.MM.DD", re = "^[0-9]{4}\\.[0-9]{1,2}\\.[0-9]{1,2}\\.?$", fmt = "%Y.%m.%d"),
  list(label = "YYYYMMDD", re = "^(19|20)[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])$", fmt = "%Y%m%d"),
  list(label = "YYYY년 M월 D일", re = "^[0-9]{4}년\\h*[0-9]{1,2}월\\h*[0-9]{1,2}일$", fmt = "%Y년%m월%d일", sep = ""),
  list(label = "DD-Mon-YYYY", re = "^[0-9]{1,2}[- ][A-Za-z]{3}[- ][0-9]{4}$", fmt = "%d-%b-%Y", sep = "-"),
  list(label = "MM/DD/YYYY 또는 DD/MM/YYYY", re = "^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$", fmt = "%m/%d/%Y"),
  list(label = "YY-MM-DD", re = "^[0-9]{2}-[0-9]{1,2}-[0-9]{1,2}$", fmt = "%y-%m-%d")
)

# Strip a trailing clock time ("2026-10-19 13:05") before matching the date.
date_part <- function(x) sub("[ T][0-9]{1,2}:[0-9]{2}(:[0-9]{2})?$", "", trim(x))

date_layout <- function(x) {
  x <- date_part(x)
  out <- rep(NA_character_, length(x))
  for (f in DATE_FORMATS) out[is.na(out) & grepl(f$re, x, perl = TRUE)] <- f$label
  out
}

parse_dates <- function(x) {
  x <- date_part(x)
  out <- as.Date(rep(NA_character_, length(x)))
  old <- Sys.getlocale("LC_TIME")
  on.exit(Sys.setlocale("LC_TIME", old), add = TRUE)
  suppressWarnings(Sys.setlocale("LC_TIME", "C"))
  for (f in DATE_FORMATS) {
    hit <- is.na(out) & grepl(f$re, x, perl = TRUE)
    # Spaces inside the value become the format's separator ("19 Oct 2026").
    if (any(hit)) out[hit] <- as.Date(if (is.null(f$sep)) x[hit] else gsub("\\h+", f$sep, x[hit], perl = TRUE), format = f$fmt)
  }
  out
}

DATE_NAME <- "(date|day|time|일자|날짜|일시|생년|입사|가입|주문|배송|시작|종료)"

# Text columns that are mostly dates in more than one layout, dates that
# don't exist (2026-02-30), dates outside a believable span, and numbers
# that look like Excel date serials.
date_checks <- function(d, max_ex) {
  rows <- list()
  row <- function(v, problem, n, examples) rows[[length(rows) + 1]] <<- data.frame(variable = v, problem = problem, n = n, examples = examples)
  today <- Sys.Date()
  for (v in names(d)) {
    x <- d[[v]]
    if (is_text(x)) {
      x <- as_text(x)[!blank(x)]
      if (length(x) < 2) next
      lay <- date_layout(x)
      if (mean(!is.na(lay)) < 0.5) next
      tab <- sort(table(lay), decreasing = TRUE)
      if (length(tab) > 1) {
        for (k in names(tab)) row(v, sprintf("형식 섞임: %s", k), as.integer(tab[[k]]), top_values(x[lay %in% k], max_ex))
      }
      if (any(is.na(lay))) row(v, "날짜로 읽히지 않는 값", sum(is.na(lay)), top_values(x[is.na(lay)], max_ex))
      parsed <- parse_dates(x)
      bad <- !is.na(lay) & is.na(parsed)
      if (any(bad)) row(v, "없는 날짜 (예: 2월 30일)", sum(bad), top_values(x[bad], max_ex))
      odd <- !is.na(parsed) & (parsed < as.Date("1900-01-01") | parsed > today + 365)
      if (any(odd)) row(v, "1900년 이전이나 1년 넘게 미래인 날짜", sum(odd), top_values(x[odd], max_ex))
      if ("MM/DD/YYYY 또는 DD/MM/YYYY" %in% lay) {
        parts <- do.call(rbind, strsplit(date_part(x[lay %in% "MM/DD/YYYY 또는 DD/MM/YYYY"]), "/"))
        if (any(as.integer(parts[, 1]) > 12) && any(as.integer(parts[, 2]) > 12)) {
          row(v, "월/일 순서가 섞임", nrow(parts), "앞자리가 12를 넘는 값과 가운데가 12를 넘는 값이 함께 있습니다.")
        }
      }
    } else if (is_dateish(x)) {
      x <- as.Date(x[!is.na(x)])
      odd <- x < as.Date("1900-01-01") | x > today + 365
      if (any(odd)) row(v, "1900년 이전이나 1년 넘게 미래인 날짜", sum(odd), top_values(format(x[odd]), max_ex))
    } else if (is.numeric(x) && grepl(DATE_NAME, v, ignore.case = TRUE, perl = TRUE)) {
      x <- x[!is.na(x)]
      if (length(x) && all(x == round(x)) && all(x >= 20000 & x <= 60000)) {
        row(v, "엑셀 날짜 일련번호로 보임", length(x),
            sprintf("%s → %s", top_values(x, 2), format(as.Date(utils::head(x, 1), origin = "1899-12-30"))))
      }
    }
  }
  if (!length(rows)) return(NULL)
  do.call(rbind, rows)
}

ID_NAME <- "(^id$|_id$|^id_|code|zip|no$|번호|코드|우편|사번|학번|아이디)"

# Codes with a fixed width (IDs, zip codes) whose leading zeros a spreadsheet
# dropped: digit-only values of mixed width where some start with 0, or
# whole numbers in a code column whose widths differ.
leading_zero_checks <- function(d, keys, max_ex) {
  rows <- list()
  for (v in names(d)) {
    x <- d[[v]]
    filled <- !blank(x)
    if (is_text(x)) {
      t <- trim(as_text(x)[filled])
      if (length(t) < 2 || !all(grepl("^[0-9]+$", t))) next
      zero <- startsWith(t, "0")
      w <- nchar(t)
      if (!any(zero) || length(unique(w)) < 2) next
      short <- t[w < max(w)]
      kind <- "문자로 저장된 코드"
    } else if (is.numeric(x) && (v %in% keys || grepl(ID_NAME, v, ignore.case = TRUE, perl = TRUE))) {
      t <- x[filled]
      if (length(t) < 2 || any(t != round(t)) || any(t < 0)) next
      w <- nchar(format(t, scientific = FALSE, trim = TRUE))
      if (length(unique(w)) < 2) next
      short <- format(t[w < max(w)], scientific = FALSE, trim = TRUE)
      kind <- "숫자로 저장된 코드"
    } else next
    widths <- sort(table(w), decreasing = TRUE)
    rows[[length(rows) + 1]] <- data.frame(
      variable = v, kind = kind,
      widths = paste(sprintf("%s자리 %d", names(widths), as.integer(widths)), collapse = ", "),
      short = length(short), examples = top_values(short, max_ex))
  }
  if (!length(rows)) return(NULL)
  do.call(rbind, rows)
}

format_checks <- function(d, o, keys, max_ex) {
  out <- list()
  f <- o$format
  if (isTRUE(f$numberText)) {
    t <- number_text(d, max_ex)
    out <- c(out, list(
      finding(G_FORMAT, "숫자 열에 섞인 글자", if (is.null(t)) 0 else sum(t$with_marks + t$other), t$variable,
              "쉼표·단위(원, %)를 지우고 숫자로 바꿉니다(CAST). 'N/A', '공란' 같은 글자는 결측으로 바꿉니다."),
      if (!is.null(t)) rsage::rs_table("numberText", "숫자 열에 섞인 글자", t,
        labels = c(variable = "변수", n = "값", numbers = "숫자", with_marks = "단위·쉼표가 붙은 숫자", marked = "예",
                   other = "숫자 아닌 값", others = "숫자 아닌 값 예"),
        notes = "값의 절반 이상이 숫자인 문자 열입니다.", section = "형식",
        description = "숫자여야 할 열에 글자가 하나라도 있으면 R은 열 전체를 문자로 읽어 평균·합계를 낼 수 없습니다. '단위·쉼표가 붙은 숫자'는 지우면 숫자가 되고, '숫자 아닌 값'은 결측 코드인지 오타인지 확인합니다.")))
  }
  if (isTRUE(f$dates)) {
    t <- date_checks(d, max_ex)
    out <- c(out, list(
      finding(G_FORMAT, "날짜 형식 불일치", if (is.null(t)) 0 else length(unique(t$variable)), t$variable,
              "한 가지 형식(YYYY-MM-DD)으로 통일하고 Date 형식으로 바꿉니다."),
      if (!is.null(t)) rsage::rs_table("dates", "날짜 형식", t,
        labels = c(variable = "변수", problem = "문제", n = "값 수", examples = "예"), section = "형식",
        description = "한 열에 2026-10-19와 2026/10/19, 19-Oct-2026이 섞여 있으면 정렬과 기간 계산이 틀립니다. 'MM/DD와 DD/MM 섞임'은 사람이 확인해야 합니다. 03/04/2026이 3월 4일인지 4월 3일인지는 데이터만으로 알 수 없습니다.")))
  }
  if (isTRUE(f$leadingZeros)) {
    t <- leading_zero_checks(d, keys, max_ex)
    out <- c(out, list(
      finding(G_FORMAT, "앞자리 0 누락", if (is.null(t)) 0 else sum(t$short), t$variable,
              "코드 열은 문자로 읽고, 정해진 자릿수에 맞춰 앞에 0을 채웁니다(예: formatC(x, width = 5, flag = \"0\"))."),
      if (!is.null(t)) rsage::rs_table("leadingZeros", "자릿수가 섞인 코드", t,
        labels = c(variable = "변수", kind = "저장 형식", widths = "자릿수 분포", short = "짧은 값", examples = "짧은 값 예"),
        section = "형식",
        description = "사번·고객ID·우편번호처럼 자릿수가 정해진 코드가 숫자로 읽히면 01234가 1234가 됩니다. 자릿수가 짧은 값이 원래 0으로 시작했는지 원본과 비교합니다.")))
  }
  out
}
