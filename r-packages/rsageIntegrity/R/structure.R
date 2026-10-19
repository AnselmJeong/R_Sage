# 1. Structure: column names, empty rows and columns, constant columns.

G_STRUCTURE <- "구조"

name_style <- function(n) {
  if (!grepl("^[A-Za-z][A-Za-z0-9_.]*$", n)) return(NA_character_)
  if (grepl("^[a-z][a-z0-9]*$", n)) return("lower")
  if (grepl("^[a-z][a-z0-9]*(_[a-z0-9]+)+$", n)) return("snake_case")
  if (grepl("^[a-z][a-z0-9]*([A-Z][a-z0-9]*)+$", n)) return("camelCase")
  if (grepl("^([A-Z][a-z0-9]+)+$", n)) return("PascalCase")
  if (grepl("^[A-Z][A-Z0-9_]*$", n)) return("UPPER_CASE")
  if (grepl("^[A-Za-z][A-Za-z0-9]*(\\.[A-Za-z0-9]+)+$", n)) return("dot.case")
  "섞임"
}

STYLE_OK <- list(snake = c("lower", "snake_case"), camel = c("lower", "camelCase"))

#' Problems with column names, one row per name and problem.
check_names <- function(nms, style = "auto") {
  rows <- list()
  add <- function(i, problem, detail) rows[[length(rows) + 1]] <<- data.frame(position = i, name = show_value(nms[i]), problem = problem, detail = detail)
  key <- tolower(trim(nms))
  for (i in seq_along(nms)) {
    n <- nms[i]
    if (is.na(n) || !nzchar(trim(n))) {
      add(i, "이름 없음", "머리글 칸이 비어 있습니다.")
      next
    }
    if (!validUTF8(n) || grepl("�", n, fixed = TRUE) || grepl("[À-ÿ][\u0080-¿]", n)) {
      add(i, "깨진 글자", "인코딩이 맞지 않게 읽혔습니다(예: CP949 파일을 UTF-8로). 파일을 읽을 때 encoding을 지정하세요.")
      next
    }
    if (sum(nms == n, na.rm = TRUE) > 1) add(i, "중복 이름", sprintf("'%s'가 %d번 있습니다.", n, sum(nms == n, na.rm = TRUE)))
    else if (sum(key == key[i]) > 1) add(i, "대소문자·공백만 다른 이름", paste(show_value(nms[key == key[i]]), collapse = ", "))
    m <- regmatches(n, regexec("^(.+?)(\\.\\.\\.[0-9]+|\\.[0-9]+)$", n))[[1]]
    if (length(m) && m[2] %in% nms) add(i, "읽을 때 바뀐 중복 이름", sprintf("원래 '%s'가 여러 번 있어 R이 이름을 바꾼 것으로 보입니다.", m[2]))
    if (grepl("^(\\.\\.\\.[0-9]+|V[0-9]+|X[0-9]*|X\\.[0-9]+|Unnamed: ?[0-9]+)$", n)) add(i, "자동으로 붙은 이름", "머리글이 비어 있던 열에 R이 붙인 이름일 수 있습니다.")
    if (n != trim(n)) add(i, "앞뒤 공백", "이름 앞이나 뒤에 공백이 있어 코드에서 찾기 어렵습니다.")
    else if (grepl(WS, n, perl = TRUE)) add(i, "공백 포함", "이름 안의 공백은 코드에서 `백틱`으로 감싸야 합니다.")
    sp <- unique(regmatches(n, gregexpr("[^\\p{L}\\p{N}_.\\h]", n, perl = TRUE))[[1]])
    if (length(sp)) add(i, "특수문자", paste(sp, collapse = " "))
    if (grepl("^[0-9]", n)) add(i, "숫자로 시작", "R에서는 `백틱` 없이 쓸 수 없는 이름입니다.")
  }
  styles <- vapply(nms, function(n) if (is.na(n)) NA_character_ else name_style(n), "")
  named <- styles[!is.na(styles) & styles != "lower"]
  if (style != "any" && length(named)) {
    allowed <- if (style %in% names(STYLE_OK)) STYLE_OK[[style]] else c("lower", names(sort(table(named), decreasing = TRUE))[1])
    want <- if (style == "auto") allowed[2] else c(snake = "snake_case", camel = "camelCase")[[style]]
    off <- which(!is.na(styles) & !styles %in% allowed)
    if (style != "auto" || length(unique(named)) > 1) {
      for (i in off) add(i, "표기 방식이 다름", sprintf("%s (기준: %s)", styles[i], want))
    }
  }
  if (!length(rows)) return(data.frame(position = integer(), name = character(), problem = character(), detail = character()))
  out <- do.call(rbind, rows)
  out[order(out$position), , drop = FALSE]
}

structure_checks <- function(d, o, max_ex) {
  out <- list()
  s <- o$structure
  if (isTRUE(s$names)) {
    t <- check_names(names(d), s$nameStyle %||% "auto")
    out <- c(out, list(
      finding(G_STRUCTURE, "변수명 중복·공백·특수문자·표기 방식", length(unique(t$position)), t$name,
              "고유한 이름을 붙이고 공백과 특수문자를 빼고, 표기 방식(snake_case 등)을 하나로 맞춥니다. '정리한 데이터 만들기'의 변수명 정리가 해 줍니다."),
      if (nrow(t)) rsage::rs_table("names", "변수명 문제", t,
        labels = c(position = "열 번호", name = "변수명", problem = "문제", detail = "자세히"),
        section = "구조",
        description = "같은 이름이 둘이면 한쪽 열을 잃거나 잘못 합칠 수 있고, 공백·특수문자가 든 이름은 코드와 다른 프로그램에서 오류를 냅니다. '표기 방식이 다름'은 다수 방식과 다른 이름입니다.")))
  }
  blanks <- as.data.frame(lapply(d, blank))
  if (isTRUE(s$emptyRows)) {
    empty <- which(rowSums(!blanks) == 0)
    out <- c(out, list(
      finding(G_STRUCTURE, "완전히 빈 행", length(empty), fix = "빈 행을 지웁니다. 표 아래 합계·메모 행이 섞여 있지 않은지도 봅니다."),
      if (length(empty)) rsage::rs_table("emptyRows", "완전히 빈 행", data.frame(n = length(empty), rows = row_list(empty, 20)),
        labels = c(n = "행 수", rows = "행 번호"), section = "구조",
        description = "모든 칸이 빈 행은 행 수를 부풀리고, 시트 중간에 있으면 위아래가 다른 표라는 표시일 수 있습니다.")))
  }
  if (isTRUE(s$emptyColumns)) {
    empty <- names(d)[colSums(!blanks) == 0]
    out <- c(out, list(finding(G_STRUCTURE, "완전히 빈 열", length(empty), empty, "빈 열을 지웁니다. 머리글만 있고 값이 없는 열입니다.")))
  }
  if (isTRUE(s$constant)) {
    const <- names(d)[vapply(d, function(x) length(unique(x[!blank(x)])) == 1, TRUE)]
    out <- c(out, list(finding(G_STRUCTURE, "값이 하나뿐인 열", length(const), const, "분석에 쓸 정보가 없는 열입니다. 필요 없으면 빼고, 값이 덜 들어온 것은 아닌지 확인합니다.")))
  }
  if (isTRUE(s$emptyColumns) || isTRUE(s$constant)) {
    info <- data.frame(variable = names(d), filled = colSums(!blanks),
                       distinct = vapply(d, function(x) length(unique(x[!blank(x)])), 0L))
    info <- info[info$filled == 0 | info$distinct == 1, , drop = FALSE]
    if (nrow(info)) {
      info$problem <- ifelse(info$filled == 0, "빈 열", "값이 하나뿐")
      out <- c(out, list(rsage::rs_table("emptyColumns", "빈 열과 값이 하나뿐인 열", info[c("variable", "problem", "filled", "distinct")],
        labels = c(variable = "변수", problem = "문제", filled = "값이 있는 행", distinct = "서로 다른 값"),
        section = "구조", description = "빈 열은 지우고, 값이 하나뿐인 열은 정말 한 값만 있어야 하는지(예: 한 병원 자료) 확인합니다.")))
    }
  }
  out
}
