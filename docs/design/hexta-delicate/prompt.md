# Imagegen prompt

Use case: ui-mockup.
Create a meticulously art-directed high-fidelity DESKTOP UI concept for R Sage, a Korean R analysis and Quarto writing app. The attached image is a screenshot of HextaUI's actual Button Variants page. Use it ONLY as the visual language reference: the soft near-black surfaces, fine low-contrast contours, precise small typography, tiny dimensional buttons and carefully rounded controls. Do NOT reproduce that website, documentation layout, heading or mobile proportions.

Deliver one flat front-facing full application screenshot, wide 16:10, highest practical resolution, crisp enough to inspect tiny controls. No surrounding desktop, no laptop frame, no concept-board labels, no branding presentation, no photographic materials. This is an application for daily research.

The user rejected previous designs as ugly and crude. Previous failures: simply changing a gray IDE to green/white, large editorial serif document titles, high-contrast colored sidebars, flat rectangles everywhere, coarse controls. This design must instead feel DELICATE: exact spacing, optically balanced tiny icons, exquisite edges, restrained component proportions, tactile subtlety. HextaUI is the visual anchor. Native desktop usability with the polish of thoughtfully crafted contemporary component design.

VISUAL SYSTEM:
Entire interface in neutral soft black, not green, not navy. Shell #101011. Sidebar #141415. Main working panels #181819. Inputs #1D1D1F. Raised selected controls #28282B. Contours gray-white at 7–10% opacity. Text #E4E4E7, secondary #A1A1AA. Tiny tertiary labels must remain readable. Extremely subtle inset light line along the top of raised buttons, faint 1px shadow below, like HextaUI outline and secondary buttons. This micro-depth must be nearly imperceptible at a distance, not glossy bevels or neumorphism.
8px button corners, 12px main pane corners, 14px composer, 4/8/12/16/24 spacing. 15px fine Tabler-style icons with 1.4px strokes. Regular/medium modern Korean sans for UI, 12–13px logical, compact but legible. Document body 14px, headings at most 22px, NO SERIF, no oversized headings, no uppercase editorial eyebrows. Monospace only in code and console.
The only strongly filled primary actions are small porcelain-white buttons with charcoal text (Render and AI send). Tiny soft green status dots. Syntax and plot may use restrained mauve, desaturated blue and warm sand. No branded sage green, no neon.

LAYOUT must retain R Sage workbench: files/navigation on left, editor in upper center, console below center, AI assistant upper right, plots lower right. At logical 1600x1000: top bar 48px; left region 214px; center about 925px; right about 425px; bottom status 22px. The two main columns have only 6–8px breathing gutters, and their main tool surfaces have beautifully subtle rounded corners. Keep content dense enough for a real IDE. No dozens of floating cards. Exactly four major work surfaces (editor, console, assistant, plot); left navigation stays on shell.

TOP BAR: tiny macOS traffic lights far left, small 'R Sage', subtle folder and 'ToothGrowth' project chooser, centered low-contrast command field '명령 검색' with a tiny inset keycap '⌘ K'; far right subtle layout icon, plus menu and gear. No large primary buttons up here.
LEFT NAV: compact paired square icon controls for files/search/source control/packages at top, selected file icon rests in subtly raised dark square. Header '프로젝트' with plus and ellipsis. A small neat file tree: data expanded with study.csv; analysis expanded with analysis.R; report.qmd selected with a quiet rounded neutral fill; figures collapsed; references.bib. Monochrome icons with only faint distinguishing colors. Rows 29px. Fine indentation guides visible only faintly. At lower portion a modest section '문서 개요' with three simple anchors '데이터 불러오기', '분포 살펴보기', '분석 메모'. Bottom tiny branch main and green dot 'R 연결됨'. Leave breathing space.

CENTRAL EDITOR: inside one rounded dark work surface. Header row has lightweight document tabs, active 'report.qmd' softly raised rounded top chip with subtle document icon and tiny close, inactive 'analysis.R' text plus small plus glyph. Active tab does NOT have a colorful underline or thick border.
Next slim toolbar: a SMALL HextaUI-style segmented switch '소스 | 비주얼', visual selected in raised neutral surface. Then minimal inline '본문 ⌄', B, I, link, code glyph, ellipsis. Right compact outline '+ R 청크' and porcelain-white '렌더' with a tiny upward-right arrow. All control baselines align exactly, heights about 28–30px. No toolbar wrap.
Document body with 42px side padding and 28px top margin. Small collapsed muted metadata disclosure '문서 설정' near top. Title '치아 성장 데이터 분석', 22px semibold sans. One short secondary sentence '용량과 투여 방법에 따른 변화를 살펴봅니다.' Below modest heading '데이터 불러오기'.
A code chunk with softly inset rounded #141415 canvas, almost invisible hairline, no chunky header bar: top inside left tiny 'R' symbol and 'explore', top right an elegant ghost play button. 7–8 compact readable lines:
library(tidyverse)
library(tidyplots)

ToothGrowth |>
  tidyplot(x = dose, y = len, color = supp) |>
  add_mean_dot() |>
  add_sem_errorbar()
Line numbers quiet and separated by generous whitespace, restrained syntax. At bottom an unobtrusive tiny green check '실행 완료' and elapsed '0.4s'.
Beneath the chunk, an inline output preview of a tasteful compact three-column data table with headers 'len', 'supp', 'dose', three rows '4.2 VC 0.5', '11.5 VC 0.5', '7.3 VC 0.5'. Table has only fine horizontal row rules, no enclosing nested card. Small footer '60행 · 3열' and text action '데이터 열기 ↗'.
Then small '분석 메모' heading and a single short Korean sentence. Avoid oversized prose consuming the entire workspace.

CONSOLE lower center about 210px tall, its own softly rounded panel. Thin header with small terminal icon and 'Console', subdued neighboring 'Terminal'; right green dot '준비됨', tiny restart and clear glyphs. A few short code/output lines, e.g. '> summary(ToothGrowth$len)' and neatly aligned 'Min.  1st Qu.  Median  Mean  3rd Qu.  Max.' followed by '4.20  13.07  19.25  18.81  25.27  33.90'. Then quiet input prompt and caret. Small 12px code, beautifully aligned.

RIGHT ASSISTANT upper pane about 570px tall:
Header small thin asterisk icon 'AI 조수', history and plus at right. Below a three-option HextaUI-style segmented tab group '대화  환경  이력', active one raised, not huge.
Conversation has generous 20px horizontal padding and readable compact body. User request in one modest right-aligned dark gray bubble with 12px corners: '용량별 차이를 살펴봐 줘.'
Assistant no giant avatar; tiny fine logo and 'R Sage' label. Body '용량에 따른 치아 길이 변화를 확인했습니다. 투여 방법을 함께 나누어 비교해 볼 수 있어요.' Four lines maximum.
A single delicate collapsed activity row: tiny green outlined check, '3개 작업 완료', right chevron; no stack of tool cards.
One understated artifact item, thin outline and rounded 8px, small document glyph, 'report.qmd' and muted '분석 코드 추가됨', right open arrow. Optional small text action '코드 확인' under assistant reply, no large next-step card.
Composer pinned bottom: refined HextaUI InputGroup-style surface with 14px radius, ultra-thin outer line plus faint inner highlight. Placeholder '무엇을 분석할까요?' with generous inset. A tiny file attachment token 'report.qmd' tucked into the next line. Bottom row plus icon, compact unboxed 'GPT-6-Luna ⌄', and white small round upward-arrow send button at right. Crucially the composer feels like one beautifully designed instrument rather than several dropdown boxes. No wrapping buttons.
RIGHT PLOT lower pane about 300px: header small chart icon and '플롯', neighboring '도움말', right expand and export glyphs. Under header small title '용량별 치아 길이', compact two-dot legend OJ / VC. Render an elegant dark scientific point/errorbar plot with two subtly colored series dusty lavender and warm sand, x=0.5,1,2, y=0,10,20,30, fine axes and barely visible horizontal grid, no glaring white plot rectangle. Tiny bottom centered navigation '<  1 / 3  >'.
Bottom full-width status is 22px and same shell tone, only subdued small metadata 'R 4.6.1', 'main', 'UTF-8', 'Quarto', '109 MB'.

Aim for the quiet craft of HextaUI: the viewer should feel the polish in EACH small component and its relationship to neighbors. The result should be calm, contemporary, soft and precise, without decoration, heavy boxes, editorial theatrics or generic IDE harshness.

