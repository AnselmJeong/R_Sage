// Shapes of Ark's data explorer comm (crates/amalthea/src/comm/data_explorer_comm.rs),
// the same backend Positron's Data Explorer talks to.

export type DisplayType =
  | "boolean" | "string" | "date" | "datetime" | "time" | "interval" | "object" | "array"
  | "struct" | "unknown" | "floating" | "integer" | "decimal";

export interface ColumnSchema {
  column_name: string;
  column_label?: string;
  column_index: number;
  type_name: string;
  type_display: DisplayType;
  description?: string;
}

export interface TableShape {
  num_rows: number;
  num_columns: number;
}

export interface SortKey {
  column_index: number;
  ascending: boolean;
}

export type RowFilterType =
  | "between" | "compare" | "is_empty" | "is_false" | "is_null" | "is_true"
  | "not_between" | "not_empty" | "not_null" | "search" | "set_membership";
export type CompareOp = "=" | "!=" | "<" | "<=" | ">" | ">=";
export type TextSearchType = "contains" | "not_contains" | "starts_with" | "ends_with" | "regex_match";

export type RowFilterParams =
  | { left_value: string; right_value: string }
  | { op: CompareOp; value: string }
  | { search_type: TextSearchType; term: string; case_sensitive: boolean }
  | { values: string[]; inclusive: boolean };

export interface RowFilter {
  filter_id: string;
  filter_type: RowFilterType;
  column_schema: ColumnSchema;
  condition: "and" | "or";
  is_valid?: boolean;
  error_message?: string;
  params?: RowFilterParams;
}

export interface BackendState {
  display_name: string;
  table_shape: TableShape;
  table_unfiltered_shape: TableShape;
  has_row_labels: boolean;
  row_filters: RowFilter[];
  sort_keys: SortKey[];
  supported_features?: { convert_to_code?: { support_status: string; code_syntaxes?: { code_syntax_name: string }[] } };
}

export interface ColumnHistogram {
  bin_edges: string[];
  bin_counts: number[];
  quantiles: { q: number; value: string; exact: boolean }[];
}

export interface FrequencyTable {
  values: (string | number)[];
  counts: number[];
  other_count?: number;
}

export interface SummaryStats {
  type_display: DisplayType;
  number_stats?: { min_value?: string; max_value?: string; mean?: string; median?: string; stdev?: string };
  string_stats?: { num_empty: number; num_unique: number };
  boolean_stats?: { true_count: number; false_count: number };
  date_stats?: { num_unique?: number; min_date?: string; mean_date?: string; median_date?: string; max_date?: string };
  datetime_stats?: { num_unique?: number; min_date?: string; mean_date?: string; median_date?: string; max_date?: string; timezone?: string };
  other_stats?: { num_unique?: number };
}

export interface ColumnProfile {
  null_count?: number;
  summary_stats?: SummaryStats;
  small_histogram?: ColumnHistogram;
  large_histogram?: ColumnHistogram;
  small_frequency_table?: FrequencyTable;
  large_frequency_table?: FrequencyTable;
}

export const FORMAT = { large_num_digits: 2, small_num_digits: 4, max_integral_digits: 7, max_value_length: 1000, thousands_sep: "" };

export const isNumeric = (t: DisplayType) => t === "floating" || t === "integer" || t === "decimal";
export const isDateLike = (t: DisplayType) => t === "date" || t === "datetime" || t === "time";

/** Ark encodes missing values as numeric codes instead of strings. */
export const special = (v: unknown) =>
  typeof v === "string" ? v : v === 0 ? "NULL" : v === 1 ? "NA" : v === 2 ? "NaN" : v === 3 ? "NaT" : v === 4 ? "None" : v === 10 ? "Inf" : v === 11 ? "-Inf" : "?";

/** The short type label shown under a column name, like Positron's (dbl, chr, fct). */
export function typeLabel(c: ColumnSchema): string {
  const n = c.type_name;
  if (/^ordered|ord/.test(n)) return "ord";
  if (/factor/.test(n)) return "fct";
  if (n === "double" || n === "numeric") return "dbl";
  if (n === "integer") return "int";
  if (n === "character") return "chr";
  if (n === "logical") return "lgl";
  if (n === "Date") return "date";
  if (/POSIX/.test(n)) return "dttm";
  return n.length > 10 ? c.type_display : n;
}
