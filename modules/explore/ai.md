Use this analysis first when the user opens or loads a data set and asks to look it over, explore it, "see what's in it", find what to analyse, or asks what relates to an outcome without naming a model. It profiles the data and returns hint cards (`hints`) ranked by effect size, with the numbers behind each, a small plot and suggested next analyses. It does not fit or test final models.

- `target`: set it when the user names an outcome or a question about one variable ("what affects PHQ total?"). The first card then lists the variables most related to it and suggests a regression with them.
- `variables` / `exclude`: leave empty to look at everything; exclude free text or columns the user says to ignore.
- `scope.*`: all on by default. Turn parts off only when the user asks for one aspect.
- The table `signals` holds every finding, including those not on a card; `target` ranks variables for the target; `variables` is the per-variable profile with the guessed kind.

When reporting:
- Quote numbers only from the result (each card's evidence line, the `signals` and `target` tables). Say the measure (Spearman ρ, η², Cramér V) and n.
- These are exploratory findings from many pairs at once; present them as things to check, not conclusions. Never say a variable "causes", "affects" or "predicts" another from these cards; say they "go together" or "differ between groups".
- Do not report p-values from this analysis; it has none on purpose.
- To follow a card, run its suggested analysis with run_analysis (the options in the card's suggestion are a valid start) or, for a suggestion marked as not installed (reliability, t test, ANOVA, mixed models), explain and offer run_r code with the user's approval.
- If the guessed kind of a variable is wrong (e.g. a coded category read as numbers), say so and suggest converting it with factor() before re-running.
