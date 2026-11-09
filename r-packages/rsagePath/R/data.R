# Variables, tiers and the numeric data the path model is fitted to.

TIERS <- c(background = "배경", early = "앞선 변수", middle = "중간 변수", outcome = "결과")

# Tier of each variable from the four role boxes; 1 = background ... 4 = outcome.
tier_of <- function(o) {
  out <- integer()
  for (i in seq_along(TIERS)) {
    v <- chr(o$variables[[names(TIERS)[i]]])
    out <- c(out, stats::setNames(rep(i, length(v)), v))
  }
  out
}

# Converts the chosen columns to numbers a Gaussian path model can use.
# Two-level categories become 0/1, ordered factors their level number;
# other categories, dates and constants are dropped with a note.
prepare_columns <- function(data, vars) {
  out <- list()
  kept <- character()
  recoded <- list()
  dropped <- list()
  info <- list()
  for (v in vars) {
    x <- data[[v]]
    if (inherits(x, c("Date", "POSIXt", "difftime"))) {
      dropped[[v]] <- "날짜·시각 변수"
      next
    }
    if (is.logical(x)) {
      x <- as.numeric(x)
      recoded[[v]] <- "TRUE = 1, FALSE = 0"
      info[[v]] <- list(kind = "binary", levels = c("FALSE", "TRUE"))
    } else if (is.ordered(x)) {
      lv <- levels(droplevels(x))
      x <- as.numeric(droplevels(x))
      recoded[[v]] <- sprintf("순서 범주를 번호로: %s", paste(sprintf("%s = %d", lv, seq_along(lv)), collapse = ", "))
      info[[v]] <- list(kind = "ordered", levels = lv)
    } else if (is.factor(x) || is.character(x)) {
      lv <- if (is.factor(x)) levels(droplevels(x)) else sort(unique(x[!is.na(x)]))
      if (length(lv) == 2) {
        x <- as.numeric(as.character(x) == lv[2])
        recoded[[v]] <- sprintf("'%s' = 1, '%s' = 0", lv[2], lv[1])
        info[[v]] <- list(kind = "binary", levels = lv)
      } else {
        dropped[[v]] <- if (length(lv) < 2) "값이 하나뿐" else sprintf("범주가 %d개 (두 개인 범주만 0/1로 넣습니다. 더미 변수로 나눠 넣으세요)", length(lv))
        next
      }
    } else if (is.numeric(x)) {
      x <- as.numeric(x)
      info[[v]] <- list(kind = if (all(x[!is.na(x)] %in% c(0, 1))) "binary01" else "numeric")
    } else {
      dropped[[v]] <- "숫자로 바꿀 수 없는 형식"
      next
    }
    ok <- x[is.finite(x)]
    if (length(unique(ok)) < 2) {
      dropped[[v]] <- "값이 하나뿐"
      next
    }
    out[[v]] <- x
    kept <- c(kept, v)
  }
  list(data = as.data.frame(out, optional = TRUE, check.names = FALSE), vars = kept, recoded = recoded, dropped = dropped, info = info)
}

standardize <- function(d) {
  for (v in names(d)) {
    s <- stats::sd(d[[v]], na.rm = TRUE)
    d[[v]] <- (d[[v]] - mean(d[[v]], na.rm = TRUE)) / s
  }
  d
}
