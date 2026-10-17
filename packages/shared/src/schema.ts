// The small JSON Schema subset analysis option schemas use, shared by the
// host (validating what the assistant sends) and the UI (form defaults).

export interface SchemaIssue {
  path: string;
  message: string;
}

const typeOf = (v: unknown): string =>
  v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v;

function matchesType(v: unknown, t: string): boolean {
  const k = typeOf(v);
  return k === t || (t === "number" && k === "integer");
}

/** Options with every missing property filled from the schema's defaults. */
export function fillDefaults(schema: any, value: any): any {
  if (!schema) return value;
  if (schema.type === "object" || schema.properties) {
    const base = value && typeof value === "object" && !Array.isArray(value) ? value : (schema.default ?? {});
    const out: Record<string, unknown> = { ...base };
    for (const [k, sub] of Object.entries<any>(schema.properties ?? {})) out[k] = fillDefaults(sub, out[k]);
    return out;
  }
  if (value === undefined) return structuredClone(schema.default);
  return value;
}

/** Problems with value against schema; empty when valid. */
export function validateOptions(schema: any, value: any, path = ""): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  const at = path || "(options)";
  const types: string[] = schema.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : [];
  if (types.length && !types.some((t) => matchesType(value, t))) {
    issues.push({ path: at, message: `expected ${types.join(" or ")}, got ${typeOf(value)}` });
    return issues;
  }
  if (schema.enum && !schema.enum.some((e: unknown) => e === value)) {
    issues.push({ path: at, message: `must be one of ${schema.enum.map((e: unknown) => JSON.stringify(e)).join(", ")}` });
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) issues.push({ path: at, message: `must be ≥ ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) issues.push({ path: at, message: `must be ≤ ${schema.maximum}` });
  }
  if (typeof value === "string" && schema.pattern && !new RegExp(schema.pattern).test(value)) {
    issues.push({ path: at, message: `does not match ${schema.pattern}` });
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((v, i) => issues.push(...validateOptions(schema.items, v, `${path}[${i}]`)));
  }
  if (value && typeof value === "object" && !Array.isArray(value) && schema.properties) {
    for (const [k, v] of Object.entries(value)) {
      const sub = schema.properties[k];
      const p = path ? `${path}.${k}` : k;
      if (!sub) {
        if (schema.additionalProperties === false) issues.push({ path: p, message: "unknown option" });
      } else issues.push(...validateOptions(sub, v, p));
    }
    for (const r of schema.required ?? []) if (!(r in value)) issues.push({ path: path ? `${path}.${r}` : r, message: "required" });
  }
  return issues;
}

/** Read a dotted path ("plots.matrix") from options. */
export function getPath(obj: any, path: string): any {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** A copy of obj with the dotted path set. */
export function setPath(obj: any, path: string, value: unknown): any {
  const [k, ...rest] = path.split(".");
  const cur = obj && typeof obj === "object" ? obj : {};
  return { ...cur, [k!]: rest.length ? setPath(cur[k!], rest.join("."), value) : value };
}
