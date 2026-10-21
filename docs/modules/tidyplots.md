# 그림을 tidyplots로 바꾸기

_2026-10-21 · 계획: [tidyplots 그림 변환 모듈 계획](https://claude.ai/artifact/28dzNube3uworJJ5mXkx3q)_

## 1. 목적

qmd에 있는 그림(주로 ggplot2)을 [tidyplots](https://tidyplots.org/)로 다시 쓴다. 그림이 보여 주는 데이터와 숫자는 그대로 두고, 모양을 tidyplots의 논문용 스타일로 통일한다. 바뀐 청크에는 평범한 tidyplots 코드만 남아서, R Sage 없이도 같은 그림으로 렌더된다.

분석 모듈이 아니라 플롯 창의 도구다. 데이터를 받아 새 결과를 내지 않고, 이미 있는 청크 코드를 고치기 때문이다. 분석 메뉴와 모듈 registry는 쓰지 않는다.

## 2. 쓰는 법

1. 바꾸고 싶은 그림을 플롯 창에 띄운다 (qmd 청크를 실행하면 뜬다).
2. 도구 막대의 **tidyplots**를 누른다. 변환된 그림이 새 플롯으로 뜨고, 그 아래에 변환 막대가 생긴다. 문서는 아직 그대로다.
3. 변환 막대에서 색 구성, 테마, 크기를 바꿔 본다. 바꿀 때마다 다시 그린다. ← →로 원본과 비교한다.
4. 마음에 들면 **문서에 반영**을 누른다. 바뀌는 줄을 diff로 보여 주고, 승인하면 원본 청크의 그림 코드가 바뀐다. 문서에 `library(tidyplots)`가 없으면 setup 청크(라벨이 setup인 청크, 없으면 첫 R 청크)에 넣는다. ⌘Z로 되돌릴 수 있다.

콘솔이나 R 스크립트에서 그린 그림은 **코드 복사**만 된다. 규칙으로 다 바꾸지 못한 그림은 **어시스턴트에게**로 넘긴다.

## 3. 백엔드

- **tidyplots** 0.4.0 (CRAN, MIT, Jan Broder Engler, iMeta 2025). 의존: ggplot2 ≥ 3.5, dplyr, tidyr, forcats, ggpubr, ggrastr, ggrepel, ggbeeswarm, patchwork, Hmisc, scales, rlang, glue, purrr, stringr, cli, lifecycle, htmltools, tidyselect. conda-forge 빌드 기준이다.
- 결과가 ggplot 객체(`tidyplot` 클래스)라서 원본과 같은 방법(`ggplot_build()`)으로 읽고 비교한다.
- 확인한 동작 (2026-10-21, 0.4.0):
  - 기본 패널 크기는 50×50mm, 기본 글자는 7pt다. `adjust_size(width = NA, height = NA)`로 고정을 풀면 그림 장치를 채운다.
  - `theme_*()`는 글자 크기를 7pt로 되돌린다. 그래서 `adjust_font()`는 테마 뒤에 온다.
  - `split_plot()`은 패널마다 축을 따로 잡는다. ggplot의 기본(축 공유)을 지키려고 `scales = "fixed"`를 붙인다.
  - `add_pie()`는 비율로 쌓는다(ggplot은 개수). 비교는 비율로 한다.
  - `as_tidyplot()`은 개발판에만 있어 쓰지 않는다.

## 4. 구조

```
플롯 창 "tidyplots" ─▶ host figures.convert ─▶ R: rsageFigures::convert_json()
                                                  capture()   청크를 자식 환경에서 실행, ggplot 찾기
                                                  translate() 규칙표로 tidyplots 코드 만들기
                                                  실행 + compare() 원본과 숫자 비교
                        ◀── 결과 JSON + 새 그림(.rds) ──
host가 print(readRDS()) 실행 ─▶ Ark ─▶ 플롯 창에 새 플롯
"문서에 반영" ─▶ applyFigureConversion() (packages/shared/src/figures.ts) ─▶ diff 승인 ─▶ Monaco 모델 편집
```

- `r-packages/rsageFigures`: 그림 읽기, 규칙 변환, 비교. 앱이 처음 쓸 때 사용자 R 라이브러리에 설치하고, 소스가 바뀌면 다시 설치한다(`RSageHash`).
- `packages/host/src/figures.ts`: 설치 확인, 세션에서 조용히 실행, 새 그림 그리기(콘솔에 코드를 남기지 않음).
- `packages/ui/src/figures.tsx`: 변환 상태, 문서 반영, 어시스턴트 요청. `components/PlotsPanel.tsx`의 버튼과 변환 막대.
- 사용자 세션을 건드리지 않는다. 청크 안의 대입은 자식 환경에만 남고, tidyplots는 `library()`로 붙이지 않고 함수만 빌려 쓴다.

## 5. 변환 규칙표

`translate()`(`r-packages/rsageFigures/R/translate.R`)가 이 표를 구현한다. 표를 바꾸면 코드와 `inst/examples/figures.qmd`도 같이 바꾼다.

| 원본 | tidyplots | 비고 |
| --- | --- | --- |
| `ggplot(d, aes(x, y, colour = g))`, `d %>% ggplot(aes(...))` | `d \|> tidyplot(x = x, y = y, color = g)` | colour와 fill은 color 하나로. 서로 다른 변수면 어시스턴트 |
| `aes(x = factor(cyl))` 등 식 | `dplyr::mutate(cyl = factor(cyl))` 뒤 열 이름 | factor·as.factor·as.character·ordered·as.numeric는 같은 이름, 그 밖의 식은 식 그대로를 열 이름으로 |
| 레이어마다 다른 aes | 겹치지 않으면 합침, 다르면 어시스턴트 | |
| shape·size·linetype 매핑 | 빠짐 (partial) | tidyplots에 없음 |
| `geom_point()` / `geom_jitter()` / beeswarm | `add_data_points()` / `_jitter(jitter_width)` / `_beeswarm()` | size, alpha 옮김 |
| `stat_summary(fun = mean, geom = "bar"/"point"/"line"/"area"/"text")` | `add_mean_bar/dot/line/area/value()` | median이면 `add_median_*` |
| `stat_summary(fun.data = mean_se/mean_sdl/mean_cl_normal, geom = "errorbar")` | `add_sem/sd/ci95_errorbar(width)` | ribbon이면 `_ribbon`. mean_cl_boot는 ci95로 바뀜(알림) |
| `stat_summary()` 기본(pointrange) | `add_mean_dot()` + `add_sem_errorbar(width = 0)` | |
| `geom_bar()` (개수) | `add_count_bar()`, 색 변수가 있고 쌓으면 `add_barstack_absolute()` | `position = "fill"`이면 `_relative()` |
| `geom_col()` | 쌓으면 `add_barstack_*()`, 아니면 `add_sum_bar()` | x마다 한 행일 때 같은 막대(알림, 비교로 확인) |
| `geom_histogram(bins, binwidth)` | `add_histogram(bins, binwidth)` | |
| `geom_boxplot(outlier.shape = NA)` | `add_boxplot(show_outliers = FALSE)` | |
| `geom_violin()` | `add_violin()` | |
| `geom_line()`, `geom_area()` | `add_line(group)`, `add_area(group)` | |
| `geom_smooth(method, se)` | `add_curve_fit(method, se)` | 기본은 loess |
| `geom_tile()`, `geom_raster()` | `add_heatmap()` | |
| `stat_ellipse()` | `add_ellipse()` | |
| `geom_hline(yintercept)`, `geom_vline(xintercept)` | `add_reference_lines(y = , x = )` | |
| `geom_bar()` + `coord_polar(theta = "y")` | `add_pie()` | 극좌표의 다른 그림은 바꾸지 않음 |
| `facet_wrap(~g, ncol, nrow, scales)` | `split_plot(by = g, ncol, nrow, scales)` | 변수 하나만 |
| `facet_grid(r ~ c)` | `split_plot(rows = r, cols = c, scales)` | 각 쪽 변수 하나만 |
| `labs()`, `xlab()`, `ylab()`, `ggtitle()` | `add_title()`, `adjust_x/y_axis_title()`, `adjust_legend_title()`, `add_caption()` | 부제는 빠짐(알림) |
| `scale_x/y_continuous(name, limits)`, `scale_*_log10/sqrt/reverse` | `adjust_x/y_axis(title, limits, transform)` | 다른 변환은 빠짐(알림) |
| `scale_x/y_discrete(name, limits)` | `adjust_*_axis_title()`, `reorder_*_axis_levels()` | |
| `scale_colour/fill_manual(values)` | `adjust_colors(new_colors = values)` | 다른 색 척도는 tidyplots 기본 색(알림) |
| `coord_flip()` | x·y 매핑을 바꿈 | |
| `coord_cartesian(xlim, ylim)` | `adjust_x/y_axis(limits)` | coord_fixed 등은 빠짐(알림) |
| `theme_*()`, `theme()`, `guides()` | 빠짐 (tidyplots 테마로 바뀜, 알림) | |
| 그 밖의 레이어 (geom_text, annotate, geom_density 등) | `add(<원본 코드>)` | partial. 어시스턴트가 tidyplots 함수로 바꿀 수 있음 |

**바꾸지 않는 그림** (unsupported): 지도(geom_sf, coord_sf, coord_map), 밀도 능선(ggridges), 등고선, 극좌표의 원그래프가 아닌 그림, lattice.

**어시스턴트에게 넘기는 그림** (ai): base R 그림(plot, hist, barplot, boxplot 등), `ggplot(데이터, aes())`로 시작하지 않는 그림(변수에 담긴 그림에 레이어를 더한 것 등), 레이어마다 다른 매핑, 규칙 코드가 실행 중 오류를 낸 그림.

## 6. 옵션

| 옵션 | 값 | 기본 | 코드 |
| --- | --- | --- | --- |
| 색 구성 `colors` | auto(원본 유지), friendly, okabeito, seaside, ibm, apple, metro, candy, viridis | auto | `adjust_colors(new_colors = colors_discrete_<값>)`, 연속형 색 변수면 `colors_continuous_<값>`가 있을 때만 |
| 테마 `theme` | tidyplot, minimal_xy, minimal_y, minimal_x, ggplot2 | tidyplot | `theme_<값>()` |
| 크기 `size` | fill(문서 크기에 맞춤), fixed(논문용 고정 크기) | fill | fill: `adjust_size(width = NA, height = NA) \|> adjust_font(fontsize = 10)` |

크기를 fill로 두면 청크의 `fig-width`·`fig-height`가 그대로 그림 크기가 된다. 분석 모듈 결과가 아니므로 `rs_figure_size()`는 쓰지 않는다.

## 7. 확인 (compare)

변환한 그림과 원본을 `ggplot_build()`로 만들어 다음을 비교한다. 색, 글꼴, 테마는 바뀌는 것이 정상이라 비교하지 않는다.

- 데이터 행 수
- x, y, 색 변수 (factor(v)는 v로 본다)
- 레이어마다 그리는 숫자: 막대 높이(ymax − ymin, 원그래프는 비율), 오차막대 끝값, 점·선 y값, 상자 사분위수와 수염, 추세선, 타일 수, 기준선. 같은 종류의 레이어 중 하나라도 같은 숫자를 그리면 통과다.

하나라도 다르면 상태가 mismatch가 되고, 변환 막대에 무엇이 다른지 보인다. 어시스턴트가 바꾼 코드는 `rsageFigures::check(before, after)`로 같은 확인을 한다.

## 8. 상태와 알림

| 상태 | 뜻 | 플롯 창 |
| --- | --- | --- |
| rule | 모두 규칙으로 바꾸고 확인함 | 새 플롯 + 변환 막대 (초록) |
| partial | 일부를 `add()`로 남기거나 뺌 | 새 플롯 + 변환 막대 (노랑), 어시스턴트에게 |
| mismatch | 바꿨지만 숫자가 다름 | 새 플롯 + 변환 막대 (빨강), 어시스턴트에게 |
| ai | 규칙으로 못 바꿈 | 어시스턴트에게 맡길지 묻기 |
| unsupported | tidyplots에 없는 그림 | 이유 알림 |
| already / none / error | 이미 tidyplots / 그림 없음 / 코드 오류 | 알림 |
| missing | tidyplots 등 설치 필요 | 설치할지 묻고, 설치가 끝나면 이어서 변환 |

## 9. 검증

- R: `r-packages/rsageFigures/tests` (예제 qmd 16개 청크의 기대 상태, 숫자 비교, 대입된 그림의 줄 범위, 옵션, 잘못된 요약 잡아내기, 패싯 축). `inst/examples/figures.qmd`의 `fig-cap` 끝 괄호가 기대 상태다.
- TS: `packages/ui/test/figures.test.ts` (문서 반영: 줄 바꾸기, setup 청크에 library 넣기, 옵션 줄 포함 실행, 코드가 사라진 경우).
- 세션: `packages/host/test/figures.test.ts` (설치, 조용한 실행, 세션 보존, base R은 ai).
- Mac 확인(Mac 스레드): WKWebView에서 버튼과 변환 막대, 한글 축 제목, 문서 반영 후 비주얼 편집기, `quarto render`.
