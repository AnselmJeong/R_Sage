// Minimal ANSI SGR parser for R console output (cli, crayon, testthat colour).

export interface Segment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fg?: string;
  bg?: string;
}

// The 16 basic colours come from the theme (styles.css --ansi-*), so console
// output stays readable in both the dark and the light theme.
const BASIC = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `var(--ansi-${i})`);
const BRIGHT = [8, 9, 10, 11, 12, 13, 14, 15].map((i) => `var(--ansi-${i})`);

function color256(n: number): string {
  if (n < 8) return BASIC[n]!;
  if (n < 16) return BRIGHT[n - 8]!;
  if (n < 232) {
    const i = n - 16;
    const c = (v: number) => (v === 0 ? 0 : 55 + v * 40);
    return `rgb(${c(Math.floor(i / 36))},${c(Math.floor(i / 6) % 6)},${c(i % 6)})`;
  }
  const g = 8 + (n - 232) * 10;
  return `rgb(${g},${g},${g})`;
}

// eslint-disable-next-line no-control-regex
const ESC = /\x1b\[([0-9;]*)m|\x1b\][^\x07]*\x07|\x1b\[[0-9;?]*[A-Za-z]/g;

export function parseAnsi(input: string): Segment[] {
  const out: Segment[] = [];
  let style: Omit<Segment, "text"> = {};
  let last = 0;
  ESC.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ESC.exec(input))) {
    if (m.index > last) out.push({ text: input.slice(last, m.index), ...style });
    last = ESC.lastIndex;
    if (m[1] === undefined) continue; // non-SGR escape: drop
    const codes = m[1] === "" ? [0] : m[1].split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]!;
      if (c === 0) style = {};
      else if (c === 1) style = { ...style, bold: true };
      else if (c === 3) style = { ...style, italic: true };
      else if (c === 4) style = { ...style, underline: true };
      else if (c === 22) style = { ...style, bold: false };
      else if (c === 23) style = { ...style, italic: false };
      else if (c === 24) style = { ...style, underline: false };
      else if (c >= 30 && c <= 37) style = { ...style, fg: BASIC[c - 30] };
      else if (c === 39) style = { ...style, fg: undefined };
      else if (c >= 40 && c <= 47) style = { ...style, bg: BASIC[c - 40] };
      else if (c === 49) style = { ...style, bg: undefined };
      else if (c >= 90 && c <= 97) style = { ...style, fg: BRIGHT[c - 90] };
      else if (c >= 100 && c <= 107) style = { ...style, bg: BRIGHT[c - 100] };
      else if ((c === 38 || c === 48) && codes[i + 1] === 5) {
        const col = color256(codes[i + 2] ?? 0);
        style = c === 38 ? { ...style, fg: col } : { ...style, bg: col };
        i += 2;
      } else if ((c === 38 || c === 48) && codes[i + 1] === 2) {
        const col = `rgb(${codes[i + 2] ?? 0},${codes[i + 3] ?? 0},${codes[i + 4] ?? 0})`;
        style = c === 38 ? { ...style, fg: col } : { ...style, bg: col };
        i += 4;
      }
    }
  }
  if (last < input.length) out.push({ text: input.slice(last), ...style });
  return out;
}

export function stripAnsi(s: string) {
  return s.replace(ESC, "");
}
