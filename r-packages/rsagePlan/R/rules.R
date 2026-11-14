# The rules: from the question (goal, roles, design) and the profile to an
# analysis with options, what to run alongside, alternatives and checks.
# Every decision is written to the trace, so the plan can be read and
# disputed. See docs/modules/plan.md for the rule table.

KEY <- list(
  ttests = "org.rsage.compare/ttests",
  anova = "org.rsage.compare/anova",
  frequencies = "org.rsage.compare/frequencies",
  regression = "org.rsage.regression/regression",
  missing = "org.rsage.missing/missing",
  explore = "org.rsage.explore/explore",
  # Not built yet: shown as planned (예정).
  mixed = "org.rsage.mixed/mixed",
  correlation = "org.rsage.correlation/correlation",
  ordinal = "org.rsage.ordinal/ordinal",
  multinomial = "org.rsage.multinomial/multinomial"
)

FAMILY_LABEL <- c(gaussian = "선형 회귀", binomial = "로지스틱 회귀", poisson = "개수 회귀 (Poisson)", negative_binomial = "개수 회귀 (음이항)")

# A recommended analysis. role: main (주 분석), also (함께), alt (대안), planned (예정).
rec <- function(role, title, label, analysis, options = list(), why = "", evidence = NULL, tab = title) {
  list(role = role, title = fix_josa(title), label = label, analysis = analysis, options = options, why = fix_josa(why), evidence = evidence, tab = tab)
}
check <- function(id, title, text, evidence = NULL, suggestions = list()) {
  list(id = id, title = fix_josa(title), text = fix_josa(text), evidence = evidence, suggestions = suggestions)
}

# ---------- option builders for the target analyses ----------

opt_ttest_ind <- function(y, g, rank) list(test = "independent", variables = I(y), group = g, tests = list(student = FALSE, welch = TRUE, nonparametric = rank))
opt_ttest_paired <- function(pairs, rank) list(test = "paired", pairs = lapply(pairs, function(p) list(first = p[1], second = p[2])),
                                               tests = list(student = TRUE, welch = FALSE, nonparametric = rank), plots = list(means = TRUE, qq = TRUE))
opt_ttest_one <- function(y, rank) list(test = "one_sample", variables = I(y), mu = 0, tests = list(student = TRUE, welch = FALSE, nonparametric = rank))
opt_anova <- function(y, g, welch, rank, posthoc) {
  list(dependent = y, factors = I(g), tests = list(classic = TRUE, welch = welch, kruskal = rank),
       posthoc = list(gamesHowell = posthoc && welch, tukey = posthoc && !welch, dunn = posthoc && rank))
}
opt_freq <- function(rows, cols) list(rows = rows, columns = cols, tests = list(chisq = TRUE, fisher = "auto"),
                                      cells = list(counts = TRUE, rowPct = TRUE, residuals = TRUE))
opt_regression <- function(y, family, continuous = character(), categorical = character(), event = NULL, interaction = NULL) {
  preds <- c(as.character(continuous), as.character(categorical))
  terms <- lapply(preds, function(v) list(id = paste0("m:", v), kind = "main", variable = v))
  ids <- paste0("m:", preds)
  if (length(interaction) == 2 && all(interaction %in% preds)) {
    terms[[length(terms) + 1]] <- list(id = "i1", kind = "interaction", components = I(paste0("m:", interaction)))
    ids <- c(ids, "i1")
  }
  o <- list(outcome = list(variable = y), model = list(family = family),
            predictors = list(continuous = I(as.character(continuous)), categorical = I(as.character(categorical))),
            terms = terms, models = list(list(id = "m1", label = "모형 1", termIds = I(ids), intercept = TRUE)),
            diagnostics = list(residuals = TRUE, collinearity = length(preds) > 1, dispersion = family %in% c("poisson", "binomial")))
  if (!is.null(event)) o$outcome$event <- event
  o
}

# ---------- the planner ----------

make_plan <- function(data, o, prof) {
  trace <- list()
  step <- function(what, value, decision) trace[[length(trace) + 1]] <<- data.frame(what = what, value = value, decision = fix_josa(decision), stringsAsFactors = FALSE)
  recs <- list(); checks <- list(); ask <- NULL; groups_table <- NULL; plot <- NULL
  add_rec <- function(r) recs[[length(recs) + 1]] <<- r
  add_check <- function(c) checks[[length(checks) + 1]] <<- c

  outcomes <- chr(o$outcomes); groups <- chr(o$groups); id <- one(o$id)
  goal <- one(o$goal) %||% "auto"; design <- one(o$design) %||% "auto"
  kind <- stats::setNames(prof$kind, prof$variable)
  y <- outcomes[1]; ky <- kind[[y]]
  step(if (length(outcomes) > 1) "결과 변수들" else "결과 변수", paste(sprintf("'%s': %s", outcomes, KIND_LABEL[kind[outcomes]]), collapse = ", "), "변수의 값으로 추정한 유형입니다.")

  bad_kinds <- c("empty", "constant", "id", "text", "date", "other")
  if (ky %in% bad_kinds) {
    add_check(check("outcome_kind", sprintf("'%s'는 결과 변수로 쓰기 어렵습니다", y),
      sprintf("이 변수는 %s로 보입니다. 비교하거나 설명할 수치나 범주 변수를 결과 변수로 넣으세요.", KIND_LABEL[[ky]])))
    return(list(recs = recs, checks = checks, ask = NULL, trace = trace, goal = "unknown", design = design))
  }
  if (length(outcomes) > 1 && length(groups)) {
    add_check(check("many_outcomes", "결과 변수가 여럿입니다",
      sprintf("집단·설명 변수가 있을 때는 결과 변수 하나씩 계획합니다. 첫 변수 '%s'로 세웠습니다. 다른 변수는 결과 변수를 바꿔 다시 실행하세요.", y)))
    step("결과 변수 수", length(outcomes), "집단 변수가 있어 첫 결과 변수로 계획합니다.")
  }
  group_kinds <- vapply(groups, function(g) if (group_kind(kind[[g]], data[[g]])) "group" else if (numeric_kind(kind[[g]])) "numeric" else "other", "")
  for (g in groups[group_kinds == "other"]) add_check(check(paste0("pred_kind_", g), sprintf("'%s'는 설명 변수로 쓰기 어렵습니다", g),
    sprintf("이 변수는 %s로 보여 계획에서 뺐습니다.", KIND_LABEL[[kind[[g]]]])))
  groups <- groups[group_kinds != "other"]; group_kinds <- group_kinds[group_kinds != "other"]
  if (length(groups)) step("집단·설명 변수", paste(sprintf("'%s': %s", groups, KIND_LABEL[kind[groups]]), collapse = ", "),
                           if (all(group_kinds == "group")) "모두 집단을 나누는 변수입니다." else "연속 변수가 있습니다.")

  # The goal, when not given.
  if (goal == "auto") {
    goal <- if (!length(groups)) "compare" else if (all(group_kinds == "group") && length(groups) <= 2) "compare" else "relate"
    step("목적", "자동", if (goal == "compare" && !length(groups)) "집단 변수가 없어 측정끼리 또는 기준값과의 '비교'로 해석했습니다."
                         else if (goal == "compare") "집단을 나누는 변수만 있어 '집단 비교'로 해석했습니다." else "연속 변수나 여러 설명 변수가 있어 '관련·예측'으로 해석했습니다.")
  } else step("목적", c(compare = "집단 비교", relate = "관련 보기", predict = "예측")[[goal]], "사용자가 정했습니다.")
  if (goal == "compare" && length(groups) && !all(group_kinds == "group")) {
    goal <- "relate"
    step("목적", "집단 비교 → 관련", "비교할 변수가 연속이라 집단을 나눌 수 없어 회귀로 봅니다.")
  }
  if (goal == "compare" && length(groups) > 2) {
    goal <- "relate"
    step("집단 변수 수", length(groups), "셋 이상의 요인은 분산분석 대신 회귀(범주 설명변수)로 봅니다.")
  }

  # ----- paired / repeated measures in wide form: several outcomes, no groups
  if (!length(groups) && length(outcomes) >= 2) {
    nums <- outcomes[vapply(outcomes, function(v) numeric_kind(kind[[v]]), TRUE)]
    paired_names <- length(outcomes) == 2 && looks_paired(outcomes[1], outcomes[2])
    is_paired <- design == "paired" || (design == "auto" && (paired_names || length(outcomes) > 2))
    step("설계", if (design == "auto") "자동" else design,
         if (is_paired) (if (paired_names) "두 변수 이름이 같은 측정의 두 시점처럼 보여 대응 설계로 봅니다." else "같은 대상을 여러 번 잰 것으로 봅니다.")
         else "두 변수의 관련을 봅니다. 같은 대상의 두 측정을 비교하려면 설계를 '대응'으로 바꾸세요.")
    if (length(nums) < length(outcomes)) {
      add_check(check("paired_numeric", "수치가 아닌 결과 변수가 있습니다", "같은 대상의 여러 측정을 비교하려면 모두 수치 변수여야 합니다."))
      return(list(recs = recs, checks = checks, ask = NULL, trace = trace, goal = goal, design = design))
    }
    if (is_paired && length(outcomes) == 2) {
      a <- data[[outcomes[1]]]; b <- data[[outcomes[2]]]
      ok <- is.finite(a) & is.finite(b); d <- a[ok] - b[ok]
      sp <- shapiro_p(d); sk <- skewness(d)
      rank <- length(d) < 30 && ((!is.na(sp) && sp < 0.05) || (!is.na(sk) && abs(sk) >= 1))
      step("짝지은 값", sprintf("n = %d, 차이의 왜도 = %s, Shapiro p = %s", length(d), fmt(sk), fmt_p(sp)),
           if (rank) "작은 표본에서 차이가 정규분포에서 벗어나 Wilcoxon 부호순위 검정을 함께 봅니다." else "차이가 크게 치우치지 않아 대응 t 검정으로 충분합니다.")
      add_rec(rec("main", if (rank) "대응표본 t 검정 + Wilcoxon 부호순위" else "대응표본 t 검정", "대응표본 t 검정 열기", KEY$ttests,
                  opt_ttest_paired(list(outcomes[1:2]), rank),
                  sprintf("같은 대상의 '%s'와 '%s'를 비교합니다. 대상마다의 차이(첫째 − 둘째)를 검정하므로 사람 사이의 차이가 빠집니다.", outcomes[1], outcomes[2]),
                  evidence = sprintf("짝 n = %d, 차이 평균 = %s, 차이 SD = %s", length(d), fmt(mean(d)), fmt(stats::sd(d))),
                  tab = sprintf("대응 t: %s − %s", outcomes[1], outcomes[2])))
      if (!rank) add_rec(rec("alt", "Wilcoxon 부호순위 검정", "Wilcoxon 함께 보기", KEY$ttests, opt_ttest_paired(list(outcomes[1:2]), TRUE),
                             "차이에 극단값이 있거나 점수가 순서 척도이면 순위로 비교합니다."))
      if (sum(!ok) > 0) add_check(check("paired_missing", "짝이 맞지 않는 행이 있습니다",
        sprintf("두 측정 중 하나가 빠진 %d행은 검정에서 빠집니다. 빠진 사람이 다른 사람과 다르면 결과가 치우칠 수 있습니다.", sum(!ok))))
    } else if (is_paired) {
      prs <- utils::combn(outcomes, 2, simplify = FALSE)
      step("측정 수", length(outcomes), "셋 이상의 반복 측정은 반복측정 분산분석이나 혼합모형으로 봅니다.")
      add_rec(rec("planned", "반복측정 분산분석·혼합모형", "혼합모형 (예정)", KEY$mixed, list(),
                  sprintf("같은 대상을 %d번 잰 값을 한꺼번에 비교합니다. 아직 R Sage에 없는 분석입니다.", length(outcomes))))
      add_rec(rec("alt", "모든 쌍의 대응 t 검정", "쌍별 대응 t 검정 열기", KEY$ttests, opt_ttest_paired(utils::head(prs, 6), FALSE),
                  sprintf("지금 할 수 있는 대안입니다. %d쌍을 비교하므로 p값을 Holm 등으로 보정해 읽으세요.", min(6, length(prs))),
                  tab = "쌍별 대응 t 검정"))
    } else {
      step("관련", sprintf("'%s' ~ '%s'", outcomes[1], outcomes[2]), "한 변수로 다른 변수를 설명하는 단순 회귀로 봅니다.")
      add_rec(rec("main", "단순 선형 회귀", "선형 회귀 열기", KEY$regression, opt_regression(outcomes[1], "gaussian", continuous = outcomes[2]),
                  sprintf("'%s'가 '%s'에 따라 어떻게 달라지는지 기울기와 신뢰구간으로 봅니다.", outcomes[1], outcomes[2]),
                  tab = sprintf("선형 회귀: %s", outcomes[1])))
      add_rec(rec("planned", "상관 분석", "상관 분석 (예정)", KEY$correlation, list(), "두 변수의 관련을 방향 없이 r 하나로 봅니다."))
      ask <- "두 변수는 같은 대상을 두 번 잰 값인가요(전후 비교), 서로 다른 두 변수인가요(관련)? 같은 측정이면 설계를 '대응'으로 바꾸세요."
    }
    return(list(recs = recs, checks = checks, ask = ask, trace = trace, goal = goal, design = if (is_paired) "paired" else "independent"))
  }

  # ----- one outcome, no groups
  if (!length(groups)) {
    if (goal != "compare") {
      ask <- "무엇과의 관련을 볼까요? 설명 변수를 넣으세요."
      return(list(recs = recs, checks = checks, ask = ask, trace = trace, goal = goal, design = design))
    }
    if (numeric_kind(ky)) {
      x <- data[[y]]; x <- x[is.finite(x)]
      sp <- shapiro_p(x); sk <- skewness(x)
      rank <- length(x) < 30 && ((!is.na(sp) && sp < 0.05) || (!is.na(sk) && abs(sk) >= 1))
      step("비교 대상", "집단 변수 없음", "한 변수의 평균을 기준값과 비교하는 일표본 검정으로 봅니다.")
      add_rec(rec("main", "일표본 t 검정", "일표본 t 검정 열기", KEY$ttests, opt_ttest_one(y, rank),
                  sprintf("'%s'의 평균이 기준값과 다른지 봅니다. 열린 탭에서 기준값을 정하세요(지금은 0).", y),
                  evidence = sprintf("n = %d, 평균 = %s, SD = %s", length(x), fmt(mean(x)), fmt(stats::sd(x))), tab = sprintf("일표본 t: %s", y)))
      ask <- "무엇과 비교할까요? 두 집단을 비교하려면 집단 변수를, 같은 대상의 다른 측정과 비교하려면 결과 변수에 그 열을 더 넣으세요."
    } else {
      ask <- "범주 변수 하나만 넣었습니다. 집단에 따라 비율이 다른지 보려면 집단 변수를 넣으세요."
    }
    return(list(recs = recs, checks = checks, ask = ask, trace = trace, goal = goal, design = design))
  }

  # ----- repeated measures in long form (an ID repeats)
  if (!is.null(id) && goal == "compare") {
    ids <- data[[id]][!is.na(data[[y]])]
    reps <- sum(duplicated(ids[!is.na(ids)]))
    if (reps > 0) {
      step("ID 반복", sprintf("'%s': 중복 %d행", id, reps), "한 대상이 여러 행에 있어 반복 측정으로 봅니다. 행이 서로 독립이라는 가정이 깨집니다.")
      add_rec(rec("planned", "혼합모형 (반복 측정)", "혼합모형 (예정)", KEY$mixed, list(),
                  sprintf("'%s'마다 여러 번 잰 '%s'를 '%s'에 따라 비교합니다. 대상 사이의 차이를 무선효과로 다룹니다.", id, y, groups[1])))
      g <- groups[1]
      if (length(unique(stats::na.omit(data[[g]]))) == 2)
        add_check(check("long_to_wide", "두 시점이면 넓은 형식으로 바꿔 대응 t 검정을 할 수 있습니다",
          sprintf("'%s'의 두 값을 두 열로 펼치면(tidyr::pivot_wider) 대응표본 t 검정을 쓸 수 있습니다. 어시스턴트에게 바꿔 달라고 하세요.", g)))
      add_check(check("independence", "행을 독립으로 다루는 분석은 맞지 않습니다",
        "같은 대상의 여러 행을 독립 표본으로 보고 t 검정이나 분산분석을 하면 표본 크기가 부풀려져 p값이 너무 작게 나옵니다."))
      return(list(recs = recs, checks = checks, ask = NULL, trace = trace, goal = goal, design = "repeated"))
    }
    step("ID 반복", sprintf("'%s': 중복 없음", id), "한 대상이 한 행이므로 독립 설계입니다.")
  }

  # ----- compare groups
  if (goal == "compare") {
    if (numeric_kind(ky)) {
      yv <- data[[y]]
      if (length(groups) == 1) {
        g <- groups[1]
        gp <- group_profile(yv, data[[g]])
        groups_table <- gp
        k <- nrow(gp)
        step("집단 수", sprintf("'%s': %d개", g, k), if (k == 2) "두 집단이라 t 검정입니다." else if (k > 2) "셋 이상이라 분산분석입니다." else "집단이 하나뿐입니다.")
        if (k < 2) {
          add_check(check("one_group", "집단이 하나뿐입니다", sprintf("'%s'에 값이 있는 집단이 하나라 비교할 수 없습니다.", g)))
          return(list(recs = recs, checks = checks, ask = NULL, trace = trace, goal = goal, design = design))
        }
        small <- gp$n < 30
        off <- (!is.na(gp$shapiro_p) & gp$shapiro_p < 0.05) | (!is.na(gp$skew) & abs(gp$skew) >= 1)
        rank <- any(small & off) || ky == "ordinal"
        sd_ratio <- max(gp$sd, na.rm = TRUE) / min(gp$sd, na.rm = TRUE)
        n_ratio <- max(gp$n) / min(gp$n)
        step("집단 크기", sprintf("n = %s", paste(gp$n, collapse = ", ")), if (any(gp$n < 2)) "값이 2개 미만인 집단이 있습니다." else if (n_ratio > 1.5) "집단 크기가 고르지 않습니다." else "집단 크기가 비슷합니다.")
        step("퍼짐", sprintf("SD 비 = %s", fmt(sd_ratio)), if (sd_ratio > 2) "퍼짐이 2배 넘게 달라 분산이 같다고 가정하지 않는 방법을 씁니다." else "퍼짐이 크게 다르지 않지만, 분산이 같다고 가정하지 않는 Welch가 기본입니다.")
        step("분포", sprintf("왜도 %s; Shapiro p %s", paste(fmt(gp$skew), collapse = ", "), paste(fmt_p(gp$shapiro_p), collapse = ", ")),
             if (ky == "ordinal") "값이 적은 점수(순서 척도)라 순위 검정을 주 분석으로 함께 봅니다."
             else if (rank) "30명보다 작은 집단에서 분포가 치우치거나 정규성이 의심돼 순위 검정을 함께 봅니다."
             else "평균 비교가 적절합니다 (작은 집단도 크게 치우치지 않음).")
        if (any(gp$n < 2)) {
          add_check(check("too_few", "값이 2개 미만인 집단이 있습니다", "그 집단을 빼거나 다른 집단과 합친 뒤 비교하세요.",
                          evidence = paste(sprintf("%s: n = %d", gp$group, gp$n)[gp$n < 2], collapse = "; ")))
          return(list(recs = recs, checks = checks, ask = NULL, trace = trace, goal = goal, design = design, groups_table = groups_table, plot = c(y, g)))
        }
        ev <- paste(sprintf("%s: n = %d, 평균 = %s, SD = %s", gp$group, gp$n, fmt(gp$mean), fmt(gp$sd)), collapse = "; ")
        if (k == 2) {
          add_rec(rec("main", if (rank) "Welch t 검정 + Mann–Whitney U" else "Welch t 검정", "독립표본 t 검정 열기", KEY$ttests, opt_ttest_ind(y, g, rank),
                      sprintf("'%s'의 평균을 '%s'의 두 집단 사이에서 비교합니다. Welch는 두 집단의 분산이 달라도 맞습니다. 효과크기는 Cohen d와 신뢰구간으로 봅니다.%s", y, g,
                              if (rank) " 분포가 치우쳐 순위 검정을 함께 보고, 결론이 같은지 확인합니다." else ""),
                      evidence = ev, tab = sprintf("t 검정: %s ~ %s", y, g)))
        } else {
          add_rec(rec("main", if (rank) "Welch 분산분석 + Kruskal–Wallis" else "Welch 분산분석 + Games–Howell", "분산분석 열기", KEY$anova, opt_anova(y, g, TRUE, rank, TRUE),
                      sprintf("'%s'의 평균을 '%s'의 %d개 집단 사이에서 비교합니다. Welch 분산분석과 Games–Howell 사후 비교는 분산과 집단 크기가 달라도 맞습니다. 고전 F와 η², ω²도 함께 나옵니다.%s", y, g, k,
                              if (rank) " 분포가 치우쳐 Kruskal–Wallis와 Dunn 비교를 함께 봅니다." else ""),
                      evidence = ev, tab = sprintf("분산분석: %s ~ %s", y, g)))
          if (k > 8) add_check(check("many_groups", "집단이 많습니다", sprintf("%d개 집단의 모든 쌍(%d쌍)을 비교하면 사후 비교가 길어지고 검정력이 낮아집니다. 비슷한 집단을 합칠 수 있는지 보세요.", k, k * (k - 1) / 2)))
        }
        fam <- if (ky == "count") "poisson" else "gaussian"
        add_rec(rec("alt", sprintf("%s (범주 설명변수)", FAMILY_LABEL[[fam]]), paste(FAMILY_LABEL[[fam]], "열기"), KEY$regression,
                    opt_regression(y, fam, categorical = g),
                    if (fam == "poisson") "결과가 개수라 평균 비교보다 개수 회귀가 맞을 수 있습니다. 공변량도 함께 넣을 수 있습니다."
                    else "같은 비교를 회귀로 합니다. 나이 같은 공변량을 보정하려면 설명변수를 더하세요.",
                    tab = sprintf("%s: %s", FAMILY_LABEL[[fam]], y)))
        if (n_ratio > 3) add_check(check("unbalanced", "집단 크기가 많이 다릅니다",
          "가장 큰 집단이 가장 작은 집단의 3배를 넘습니다. 분산이 다르면 고전 F와 Student t의 오류율이 틀어지므로 Welch 결과를 보고하세요.",
          evidence = sprintf("n = %s", paste(gp$n, collapse = ", "))))
        plot <- c(y, g)
      } else {
        g1 <- groups[1]; g2 <- groups[2]
        cells <- table(data[[g1]][is.finite(yv)], data[[g2]][is.finite(yv)])
        step("요인 수", 2, "두 요인과 상호작용을 보는 이원 분산분석입니다.")
        step("칸 크기", sprintf("최소 %d, 최대 %d (%d칸)", min(cells), max(cells), length(cells)),
             if (min(cells) < 2) "빈 칸이나 값이 하나인 칸이 있습니다." else "모든 칸에 값이 있습니다.")
        if (min(cells) < 2) {
          add_check(check("empty_cells", "빈 칸이 있습니다", "두 요인의 어떤 조합에는 값이 없거나 하나뿐이라 상호작용을 추정할 수 없습니다. 상호작용 없이 회귀로 보세요."))
          add_rec(rec("main", "선형 회귀 (두 범주 설명변수, 상호작용 없음)", "선형 회귀 열기", KEY$regression, opt_regression(y, "gaussian", categorical = groups),
                      "빈 칸이 있어 두 요인의 주효과만 봅니다."))
        } else {
          add_rec(rec("main", "이원 분산분석 (유형 III)", "분산분석 열기", KEY$anova, opt_anova(y, groups, FALSE, FALSE, FALSE),
                      sprintf("'%s'를 '%s'와 '%s', 그리고 둘의 상호작용으로 나눠 봅니다. 상호작용 그림에서 선이 평행하지 않으면 한 요인의 효과가 다른 요인에 따라 다릅니다.", y, g1, g2),
                      evidence = sprintf("칸 %d개, 칸 크기 %d~%d", length(cells), min(cells), max(cells)), tab = sprintf("이원 분산분석: %s", y)))
          add_rec(rec("alt", "선형 회귀 (상호작용 포함)", "선형 회귀 열기", KEY$regression, opt_regression(y, "gaussian", categorical = groups, interaction = groups),
                      "같은 모형을 회귀로 봅니다. 공변량을 더하거나 보정 평균(effects)을 보려면 이쪽이 편합니다."))
        }
      }
    } else if (ky %in% c("binary", "categorical")) {
      if (length(groups) == 1) {
        g <- groups[1]
        tab <- table(data[[g]], data[[y]])
        tab <- tab[rowSums(tab) > 0, colSums(tab) > 0, drop = FALSE]
        exp <- outer(rowSums(tab), colSums(tab)) / sum(tab)
        low <- mean(exp < 5)
        step("교차표", sprintf("%d × %d, n = %d", nrow(tab), ncol(tab), sum(tab)), "범주 결과를 범주 집단으로 비교하므로 교차표입니다.")
        step("기대 빈도", sprintf("5 미만인 칸 %.0f%%", low * 100), if (low > 0.2) "20%를 넘어 Fisher 정확 검정을 씁니다 (자동으로 켜짐)." else "카이제곱 근사가 괜찮습니다.")
        add_rec(rec("main", if (low > 0.2) "교차표 + Fisher 정확 검정" else "교차표 + 카이제곱 검정", "교차표 열기", KEY$frequencies, opt_freq(g, y),
                    sprintf("'%s'에 따라 '%s'의 비율이 다른지 봅니다. 행 %%로 집단끼리 비교하고, 관련의 크기는 Cramér V%s로 봅니다.", g, y,
                            if (all(dim(tab) == 2)) "와 오즈비" else ""),
                    evidence = sprintf("%d × %d표, n = %d, 기대 빈도 < 5인 칸 %.0f%%", nrow(tab), ncol(tab), sum(tab), low * 100), tab = sprintf("교차표: %s × %s", g, y)))
        if (ky == "binary") {
          om <- outcome_event(data[[y]])
          add_rec(rec("alt", "로지스틱 회귀", "로지스틱 회귀 열기", KEY$regression, opt_regression(y, "binomial", categorical = g, event = om),
                      "같은 비교를 오즈비로 봅니다. 공변량을 보정하려면 이쪽입니다.", tab = sprintf("로지스틱 회귀: %s", y)))
        }
      } else {
        if (ky == "binary") {
          step("요인 수", 2, "범주 결과를 두 요인으로 설명하므로 로지스틱 회귀입니다.")
          add_rec(rec("main", "로지스틱 회귀 (두 범주 설명변수)", "로지스틱 회귀 열기", KEY$regression,
                      opt_regression(y, "binomial", categorical = groups, event = outcome_event(data[[y]])),
                      sprintf("'%s'의 확률을 '%s'와 '%s'로 설명합니다. 상호작용이 궁금하면 탭에서 항을 더하세요.", y, groups[1], groups[2]), tab = sprintf("로지스틱 회귀: %s", y)))
        } else {
          add_rec(rec("planned", "다항 로지스틱 회귀", "다항 로지스틱 (예정)", KEY$multinomial, list(), "범주가 셋 이상인 결과를 여러 요인으로 설명합니다."))
          add_rec(rec("alt", "요인마다 교차표", "교차표 열기", KEY$frequencies, opt_freq(groups[1], y), "지금 할 수 있는 대안입니다. 요인 하나씩 봅니다."))
        }
      }
    }
    return(list(recs = recs, checks = checks, ask = NULL, trace = trace, goal = goal, design = if (design == "auto") "independent" else design,
                groups_table = groups_table, plot = plot))
  }

  # ----- relate / predict: a regression
  cont <- groups[group_kinds == "numeric" & !vapply(groups, function(g) kind[[g]] == "ordinal" && !is.numeric(data[[g]]), TRUE)]
  cat <- setdiff(groups, cont)
  # Ordinal numeric scores with few values: kept numeric (said so).
  ord <- cont[kind[cont] == "ordinal"]
  if (length(ord)) step("점수 변수", paste(sprintf("'%s'", ord), collapse = ", "), "값이 적은 정수지만 연속 설명변수로 넣었습니다. 범주로 보려면 탭에서 옮기세요.")
  used <- c(y, groups)
  cc <- stats::complete.cases(data[, used, drop = FALSE])
  n <- sum(cc)
  df_pred <- length(cont) + sum(vapply(cat, function(g) max(1, length(unique(stats::na.omit(data[[g]]))) - 1), 0))
  if (ky == "binary") {
    ev <- outcome_event(data[[y]])
    yy <- data[[y]][cc]
    is_ev <- if (is.null(ev)) as.numeric(yy) == 1 else as.character(yy) == ev
    m <- min(sum(is_ev), sum(!is_ev))
    epv <- m / max(1, df_pred)
    step("결과 유형", "이분", "로지스틱 회귀입니다.")
    step("사건 수 / 설명 자유도", sprintf("%d / %d = %s", m, df_pred, fmt(epv, 1)), if (epv < 10) "10보다 작아 추정이 불안정할 수 있습니다." else "충분합니다.")
    add_rec(rec("main", "로지스틱 회귀", "로지스틱 회귀 열기", KEY$regression, opt_regression(y, "binomial", cont, cat, event = ev),
                sprintf("'%s'%s의 확률이 설명변수에 따라 어떻게 달라지는지 오즈비와 신뢰구간으로 봅니다.", y, if (!is.null(ev)) sprintf(" = '%s'", ev) else ""),
                evidence = sprintf("n = %d, 적은 쪽 사건 %d, 설명 자유도 %d", n, m, df_pred), tab = sprintf("로지스틱 회귀: %s", y)))
    if (epv < 10) add_check(check("epv", "설명변수에 비해 사건이 적습니다",
      "적은 쪽 결과의 수를 설명변수 자유도로 나눈 값(EPV)이 10보다 작으면 계수가 부풀고 분리(separation)가 생기기 쉽습니다. 설명변수를 줄이거나 미리 정한 변수만 넣으세요.",
      evidence = sprintf("EPV = %s", fmt(epv, 1))))
  } else if (ky == "categorical") {
    step("결과 유형", "범주 (셋 이상)", "다항 로지스틱 회귀가 필요합니다 (예정).")
    add_rec(rec("planned", "다항 로지스틱 회귀", "다항 로지스틱 (예정)", KEY$multinomial, list(), "범주가 셋 이상인 결과를 설명합니다."))
    if (length(cat)) add_rec(rec("alt", "교차표", "교차표 열기", KEY$frequencies, opt_freq(cat[1], y), "범주 설명변수 하나와의 관련은 지금 볼 수 있습니다."))
  } else {
    fam <- if (ky == "count") "poisson" else "gaussian"
    if (fam == "poisson") {
      v <- data[[y]][cc]
      disp <- stats::var(v) / mean(v)
      if (is.finite(disp) && disp > 1.5) fam <- "negative_binomial"
      step("결과 유형", sprintf("개수, 분산/평균 = %s", fmt(disp)), if (fam == "negative_binomial") "과산포가 있어 음이항 회귀입니다." else "Poisson 회귀입니다.")
    } else step("결과 유형", KIND_LABEL[[ky]], if (ky == "ordinal") "값이 적은 점수지만 선형 회귀로 시작합니다. 순서 로지스틱 회귀가 더 맞을 수 있습니다 (예정)." else "선형 회귀입니다.")
    ratio <- n / max(1, df_pred)
    step("행 수 / 설명 자유도", sprintf("%d / %d = %s", n, df_pred, fmt(ratio, 1)), if (ratio < 15) "15보다 작아 과적합 위험이 있습니다." else "충분합니다.")
    single <- length(cont) == 1 && !length(cat) && fam == "gaussian"
    add_rec(rec("main", if (single) "단순 선형 회귀" else FAMILY_LABEL[[fam]], paste(FAMILY_LABEL[[fam]], "열기"), KEY$regression, opt_regression(y, fam, cont, cat),
                sprintf("'%s'가 설명변수에 따라 어떻게 달라지는지 %s와 신뢰구간으로 봅니다. %s", y,
                        if (fam == "gaussian") "계수" else "비율비(exp(b))",
                        if (goal == "predict") "예측이 목적이면 계수의 p값보다 적합도와 진단을 보세요." else "관찰 자료에서는 '관련'으로 해석하고 원인이라고 하지 않습니다."),
                evidence = sprintf("n = %d, 설명 자유도 %d", n, df_pred), tab = sprintf("%s: %s", FAMILY_LABEL[[fam]], y)))
    if (single) add_rec(rec("planned", "상관 분석", "상관 분석 (예정)", KEY$correlation, list(), "두 변수의 관련을 방향 없이 r 하나로 봅니다."))
    if (ky == "ordinal") add_rec(rec("planned", "순서 로지스틱 회귀", "순서 로지스틱 (예정)", KEY$ordinal, list(), "값이 적은 점수를 순서 범주로 다룹니다."))
    if (ratio < 15) add_check(check("overfit", "설명변수에 비해 행이 적습니다",
      "행 수가 설명 자유도의 15배보다 작으면 모형이 표본에 과하게 맞춰집니다. 미리 정한 변수만 넣고 단계적 선택은 피하세요.", evidence = sprintf("%d / %d", n, df_pred)))
  }
  if (goal == "predict") add_check(check("predict", "예측 성능은 따로 확인해야 합니다",
    "같은 데이터로 적합하고 평가하면 성능이 부풀려집니다. 탐색 안내의 '확인용 데이터 떼어 두기'로 나눠 두고 확인하세요.",
    suggestions = list(rsage::rs_suggest("탐색 안내 (확인용 데이터)", KEY$explore, list(target = y, holdout = list(enabled = TRUE))))))
  list(recs = recs, checks = checks, ask = NULL, trace = trace, goal = goal, design = design)
}

# The event of a binary outcome: NULL for 0/1 and logical, else the rarer value.
outcome_event <- function(x) {
  v <- x[!is.na(x)]
  if (is.logical(x) || (is.numeric(x) && all(v %in% c(0, 1)))) return(NULL)
  t <- sort(table(as.character(v)))
  names(t)[1]
}
