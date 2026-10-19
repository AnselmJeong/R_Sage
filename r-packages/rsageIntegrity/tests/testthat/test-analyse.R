# A small spreadsheet with one of each problem the module checks.

messy <- function() {
  d <- data.frame(
    `고객ID` = c("01234", "1234", "00012", "00012", NA, "00345", "00999", "01000"),
    나이 = c(20, 200, -5, 35, 40, 33, 28, 31),
    성별 = c("남", "여", "X", "남", " 남", "여", "여", "남"),
    주문일 = c("2026-10-19", "2026/10/19", "19-Oct-2026", "2026-10-01", "", "2026-02-30", "2026-09-01", "2026-09-03"),
    배송일 = c("2026-10-21", "2026-10-18", "2026-10-25", "2026-09-30", "", "2026-03-02", "2026-09-02", "2026-09-05"),
    금액 = c("1,000원", "2000", "N/A", "300", "0", "500", "공란", "700"),
    국가 = c("한국", "대한민국", "KOREA", "한국", "Korea", "korea", "한국", "남한"),
    `동의 여부` = c("Y", "N", "Y", "y", "N", "Y", "Y", "응"),
    check.names = FALSE, stringsAsFactors = FALSE)
  d <- rbind(d, d[2, ], NA)
  rownames(d) <- NULL
  d
}

table_of <- function(r, id) r$tables[[which(vapply(r$tables, function(t) t$id, "") == id)]]$data
ids <- function(r) unname(vapply(r$tables, function(t) t$id, ""))
status <- function(r, check) {
  s <- table_of(r, "summary")
  s$status[startsWith(s$check, check)]
}

test_that("the summary comes first and lists every check", {
  r <- analyse(messy())
  expect_equal(ids(r)[1], "summary")
  s <- table_of(r, "summary")
  expect_true(all(c("변수명 중복·공백·특수문자·표기 방식", "숫자 열에 섞인 글자", "앞자리 0 누락", "중복 행", "공백 오류") %in% s$check))
  expect_equal(status(r, "완전히 빈 열"), "문제 없음")
  expect_equal(status(r, "허용 범위"), "규칙 없음")
  expect_equal(r$sections[1], "요약")
})

test_that("structure: names, empty rows", {
  d <- messy()
  d$`  금액 ` <- c(1:9, NA)
  d$`Order Date` <- c(1:9, NA)
  names(d)[1] <- "나이"
  r <- analyse(d)
  n <- table_of(r, "names")
  expect_true("중복 이름" %in% n$problem)
  expect_true("앞뒤 공백" %in% n$problem)
  expect_equal(table_of(r, "emptyRows")$rows, "10")
})

test_that("name style follows the majority unless told", {
  t <- check_names(c("order_id", "ship_date", "customerName", "total"))
  expect_equal(t$name[t$problem == "표기 방식이 다름"], "customerName")
  t <- check_names(c("order_id", "customerName"), "camel")
  expect_equal(t$name, "order_id")
  expect_equal(nrow(check_names(c("order_id", "customerName"), "any")), 0)
})

test_that("formats: numbers as text, mixed dates, leading zeros", {
  r <- analyse(messy())
  nt <- table_of(r, "numberText")
  expect_equal(nt$variable, "금액")
  expect_equal(nt$with_marks, 1)
  expect_equal(nt$other, 2)
  dt <- table_of(r, "dates")
  expect_true(all(c("형식 섞임: YYYY/MM/DD", "형식 섞임: DD-Mon-YYYY", "없는 날짜 (예: 2월 30일)") %in% dt$problem))
  expect_false("배송일" %in% dt$variable[startsWith(dt$problem, "형식 섞임")])
  lz <- table_of(r, "leadingZeros")
  expect_equal(lz$variable, "고객ID")
  expect_equal(lz$short, 2)
})

test_that("Excel date serials and day/month order are flagged", {
  d <- data.frame(가입일 = c(45000, 45100, 45200), when = c("03/04/2026", "13/04/2026", "04/25/2026"))
  t <- date_checks(d, 5)
  expect_true("엑셀 날짜 일련번호로 보임" %in% t$problem)
  expect_true("월/일 순서가 섞임" %in% t$problem)
})

test_that("dlookr's outlier counts and our rules", {
  r <- analyse(messy(), list(values = list(outlierRows = TRUE,
    ranges = list(list(variable = "나이", min = "0", max = "120")),
    allowed = list(list(variable = "성별", values = "남, 여"), list(variable = "동의 여부", values = "Y|N")),
    order = list(list(first = "주문일", op = "<=", second = "배송일")))))
  o <- table_of(r, "outliers")
  expect_equal(o$outliers_cnt[o$variables == "나이"], 3)
  expect_equal(sort(table_of(r, "outlierRows")$row), c(2, 3, 9))
  ru <- table_of(r, "rules")
  expect_equal(ru$n, c(3, 1, 2, 3))
  expect_equal(ru$rows[ru$kind == "선후 관계"], "2, 4, 9")
  expect_equal(status(r, "선후 관계"), "확인 필요")
  expect_true("outliers" %in% vapply(r$plots, function(p) p$id, ""))
})

test_that("range rules work on dates", {
  d <- data.frame(day = c("2026-01-05", "2025-12-31", "2026-02-01"))
  r <- analyse(d, list(values = list(ranges = list(list(variable = "day", min = "2026-01-01", max = "")))))
  expect_equal(table_of(r, "rules")$rows, "2")
})

test_that("hidden missing codes, required fields, duplicate rows and keys", {
  r <- analyse(messy(), list(keys = "고객ID", required = "고객ID"))
  h <- table_of(r, "hiddenMissing")
  expect_setequal(h$value[h$variable == "금액"], c("N/A", "공란"))
  expect_equal(table_of(r, "required")$n, 2)
  expect_equal(table_of(r, "duplicateRows")$rows, "2, 9")
  k <- table_of(r, "duplicateKeys")
  expect_setequal(k$key, c("00012", "1234"))
  expect_true("key_missing" %in% vapply(r$notes, function(n) n$code %||% "", ""))
})

test_that("numeric missing codes count only at the column's extreme", {
  d <- data.frame(a = c(1, 2, -99, 3), b = c(999, 5000, 20, 30))
  h <- hidden_missing(d, c("-99", "999"))
  expect_equal(h$variable, "a")
})

test_that("text: whitespace, variants, synonyms, similar spellings", {
  d <- messy()
  d$도시 <- c("Seoul", "Busan", "Busna", "Seoul", "Busan", "Seoul", "Seoul ", "Busan", "Busan", NA)
  r <- analyse(d, list(text = list(similar = TRUE, synonyms = list(list(variable = "국가", values = "한국, 대한민국, KOREA, 남한", to = "대한민국")))))
  w <- table_of(r, "whitespace")
  expect_true(any(w$variable == "성별" & w$problem == "앞뒤 공백"))
  expect_true(any(w$variable == "도시" & startsWith(w$problem, "보이지 않는")))
  v <- table_of(r, "variants")
  expect_false("주문일" %in% v$variable)
  expect_equal(v$suggestion[v$variable == "동의 여부"], "Y")
  s <- table_of(r, "synonyms")
  expect_equal(s$n, 7)
  sim <- table_of(r, "similar")
  expect_true(any(sim$a == "Busan" & sim$b == "Busna"))
  expect_false("고객ID" %in% sim$variable)
})

test_that("the cleaned copy fixes what the checks found and leaves the data alone", {
  d <- messy()
  r <- analyse(d, list(keys = "고객ID",
    values = list(ranges = list(list(variable = "나이", min = "0", max = "120"))),
    text = list(synonyms = list(list(variable = "국가", values = "한국, 대한민국, KOREA, 남한", to = "대한민국"))),
    clean = list(enabled = TRUE, ruleViolations = TRUE, duplicates = TRUE, saveAs = "clean")))
  cl <- r$exports$clean
  expect_equal(nrow(cl), 8)
  expect_type(cl$금액, "double")
  expect_s3_class(cl$주문일, "Date")
  expect_equal(unique(cl$국가), "대한민국")
  expect_true(all(nchar(stats::na.omit(cl$고객ID)) == 5))
  expect_true(all(is.na(cl$나이) | cl$나이 <= 120))
  expect_equal(names(cl)[8], "동의_여부")
  expect_equal(d$금액[1], "1,000원")
  expect_true("cleaning" %in% ids(r))
})

test_that("a clean data set passes", {
  r <- analyse(mtcars, list(values = list(outliers = FALSE, outlierPlot = FALSE)))
  s <- table_of(r, "summary")
  expect_true(all(s$status[s$group != "값의 범위"] != "확인 필요"))
})

test_that("unknown variables are an error", {
  expect_error(analyse(airquality, list(keys = "nope")), "nope")
})

test_that("the report runs outside the session when pandoc is there", {
  skip_on_cran()
  skip_if_not(nzchar(find_pandoc()))
  skip_if_not_installed("rmarkdown")
  f <- tempfile(fileext = ".html")
  r <- analyse(airquality, list(report = list(enabled = TRUE, file = f)))
  expect_true(file.exists(f))
  expect_false("package:dlookr" %in% search())
})

test_that("codings that mean the same thing are found without rules", {
  d <- data.frame(성별 = rep(c("남", "남자", "M", "여", "여자"), 12), 동의 = rep(c("Y", "예", "N"), 20),
                  지역 = rep(c("서울", "서울시", "부산"), 20), 이름 = rep(c("Kim", "Lee", "Park"), 20))
  r <- analyse(d)
  t <- table_of(r, "suspectSynonyms")
  expect_equal(sort(t$meaning[t$variable == "성별"]), c("남성", "여성"))
  expect_equal(t$meaning[t$variable == "동의"], "예")
  expect_equal(t$reason[t$variable == "지역"], "앞부분이 같은 말")
  expect_false("이름" %in% t$variable)
  expect_equal(status(r, "같은 뜻으로"), "확인 필요")
})
