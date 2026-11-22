// Integer representation, two's complement, bitwise operations, register field labels and
// C mask generation. Everything is BigInt so 64-bit values are exact. Pure functions, no DOM.
//
// Convention: a value is held as its *bit pattern* — an unsigned BigInt in 0 … 2^width − 1.
// Signedness only matters when the pattern is read as a number (toSigned) or typed in decimal.

export type Width = 8 | 16 | 32 | 64;
export type Base = 'dec' | 'hex' | 'bin' | 'oct';

export const WIDTHS: Width[] = [8, 16, 32, 64];

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const RADIX: Record<Base, number> = { dec: 10, hex: 16, bin: 2, oct: 8 };
const BASE_NAME: Record<Base, string> = { dec: 'decimal', hex: 'hex', bin: 'binary', oct: 'octal' };
const DIGITS: Record<Base, RegExp> = {
  dec: /^[0-9]+$/,
  hex: /^[0-9a-f]+$/i,
  bin: /^[01]+$/,
  oct: /^[0-7]+$/,
};

/** All-ones mask for a width: 2^w − 1. */
export function maskOf(width: number): bigint {
  return (1n << BigInt(width)) - 1n;
}

/** Numeric range of a width as signed or unsigned. */
export function rangeOf(width: number, signed: boolean): { min: bigint; max: bigint } {
  if (!signed) return { min: 0n, max: maskOf(width) };
  const half = 1n << BigInt(width - 1);
  return { min: -half, max: half - 1n };
}

/** Read a bit pattern as a two's complement number. */
export function toSigned(bits: bigint, width: number): bigint {
  return BigInt.asIntN(width, bits);
}

/** Bit pattern of any integer, truncated to the width (two's complement for negatives). */
export function toBits(value: bigint, width: number): bigint {
  return BigInt.asUintN(width, value);
}

/** The pattern as a number: signed (two's complement) or unsigned. */
export function interpret(bits: bigint, width: number, signed: boolean): bigint {
  return signed ? toSigned(bits, width) : toBits(bits, width);
}

export interface ParsedInteger {
  value: bigint;
  /** Base actually used (a 0x/0b/0o prefix overrides the field's base). */
  base: Base;
  /** True when a sign (+ or −) was typed, i.e. the user wrote a number rather than a bit pattern. */
  signed: boolean;
  /** True when a 0x/0b/0o prefix was typed. */
  prefixed: boolean;
}

/**
 * Parse an integer as typed by an engineer. Accepts an optional sign, 0x / 0b / 0o prefixes
 * (which override `base`), a trailing C suffix (U, L, UL, ULL), and digit separators:
 * underscores, spaces and C++14 apostrophes. Leading zeros in decimal are just zeros.
 */
export function parseInteger(input: string, base: Base = 'dec'): Result<ParsedInteger> {
  let s = input.replace(/[\s_']/g, '');
  if (s === '') return { ok: false, error: 'Enter a value.' };
  let neg = false;
  let sign = false;
  if (s[0] === '-' || s[0] === '+' || s[0] === '−') {
    neg = s[0] !== '+';
    sign = true;
    s = s.slice(1);
  }
  let b = base;
  let prefixed = false;
  const pre = /^0([xbo])/i.exec(s);
  if (pre) {
    b = ({ x: 'hex', b: 'bin', o: 'oct' } as const)[pre[1].toLowerCase() as 'x' | 'b' | 'o'];
    s = s.slice(2);
    prefixed = true;
  }
  // C integer suffixes (U, L, UL, LL, ULL, LU…). U and L are never hex digits, so this is safe.
  s = s.replace(/(?:u?l{0,2}|l{1,2}u)$/i, '');
  if (s === '') return { ok: false, error: prefixed ? `Add ${BASE_NAME[b]} digits after the prefix.` : 'Enter a value.' };
  if (!DIGITS[b].test(s)) {
    const bad = [...s].find((c) => !DIGITS[b].test(c)) ?? s;
    return { ok: false, error: `“${bad}” is not a ${BASE_NAME[b]} digit.` };
  }
  let value = 0n;
  const radix = BigInt(RADIX[b]);
  for (const c of s.toLowerCase()) value = value * radix + BigInt(parseInt(c, 16));
  return { ok: true, value: { value: neg ? -value : value, base: b, signed: sign, prefixed } };
}

function rangeText(width: number, signed: boolean): string {
  const { min, max } = rangeOf(width, signed);
  return `${min} … ${max}`;
}

/**
 * Parse text from one of the representation fields into a bit pattern of `width` bits.
 *
 * - Decimal, or any input with a sign, is a *number*: it must lie in the signed or unsigned range.
 * - Hex, binary and octal without a sign are a *bit pattern*: they must fit in `width` bits, and
 *   in signed mode a pattern with the top bit set reads as negative (0xFF = −1 at 8 bits).
 */
export function parseValue(input: string, base: Base, width: Width, signed: boolean): Result<bigint> {
  const p = parseInteger(input, base);
  if (!p.ok) return p;
  const { value } = p.value;
  const isPattern = !p.value.signed && p.value.base !== 'dec';
  if (isPattern) {
    if (value > maskOf(width)) {
      return {
        ok: false,
        error: `Bit pattern doesn't fit in ${width} bits (max 0x${maskOf(width).toString(16).toUpperCase()}).`,
      };
    }
    return { ok: true, value };
  }
  const { min, max } = rangeOf(width, signed);
  if (value < min || value > max) {
    let hint = '';
    if (!signed && value < 0n) hint = ' Switch to signed to enter negative numbers.';
    else if (signed && value > max && value <= maskOf(width)) hint = ' Switch to unsigned, or enter it in hex.';
    return {
      ok: false,
      error: `Value doesn't fit in ${width} bits ${signed ? 'signed' : 'unsigned'} (${rangeText(width, signed)}).${hint}`,
    };
  }
  return { ok: true, value: toBits(value, width) };
}

/**
 * Parse a second operand: any integer from the most negative signed value up to the largest
 * unsigned value of the width, converted to its bit pattern.
 */
export function parseOperand(input: string, width: Width): Result<bigint> {
  const p = parseInteger(input, 'dec');
  if (!p.ok) return p;
  const min = rangeOf(width, true).min;
  const max = maskOf(width);
  if (p.value.value < min || p.value.value > max) {
    return { ok: false, error: `Doesn't fit in ${width} bits (${min} … ${max}).` };
  }
  return { ok: true, value: toBits(p.value.value, width) };
}

/** Split a digit string into groups of n from the right. */
export function groupDigits(s: string, n: number, sep = ' '): string {
  if (n <= 0 || s.length <= n) return s;
  const out: string[] = [];
  for (let end = s.length; end > 0; end -= n) out.unshift(s.slice(Math.max(0, end - n), end));
  return out.join(sep);
}

/** Hex, zero-padded to the width, uppercase, grouped in 16-bit chunks ("DEAD BEEF"). */
export function formatHex(bits: bigint, width: number, group = true): string {
  const s = toBits(bits, width).toString(16).toUpperCase().padStart(Math.ceil(width / 4), '0');
  return group ? groupDigits(s, 4) : s;
}

/** Binary, zero-padded to the width, grouped by nibble ("1010 0101"). */
export function formatBin(bits: bigint, width: number, group = true): string {
  const s = toBits(bits, width).toString(2).padStart(width, '0');
  return group ? groupDigits(s, 4) : s;
}

/** Octal without padding. */
export function formatOct(bits: bigint, width: number): string {
  return toBits(bits, width).toString(8);
}

/** Decimal, reading the pattern as signed or unsigned. */
export function formatDec(bits: bigint, width: number, signed: boolean): string {
  return interpret(bits, width, signed).toString();
}

/** Format the pattern in a representation-field style. */
export function formatIn(base: Base, bits: bigint, width: Width, signed: boolean): string {
  switch (base) {
    case 'dec':
      return formatDec(bits, width, signed);
    case 'hex':
      return formatHex(bits, width);
    case 'bin':
      return formatBin(bits, width);
    case 'oct':
      return formatOct(bits, width);
  }
}

/** C-style literal of the pattern for copying (0x…, 0b…, leading-0 octal, decimal). */
export function cLiteral(base: Base, bits: bigint, width: Width, signed: boolean): string {
  switch (base) {
    case 'dec':
      return formatDec(bits, width, signed);
    case 'hex':
      return `0x${formatHex(bits, width, false)}`;
    case 'bin':
      return `0b${formatBin(bits, width, false)}`;
    case 'oct': {
      const o = formatOct(bits, width);
      return o === '0' ? '0' : `0${o}`;
    }
  }
}

// ---------- Bitwise operations (all on bit patterns, results truncated to the width) ----------

export const and = (a: bigint, b: bigint, w: number) => toBits(a & b, w);
export const or = (a: bigint, b: bigint, w: number) => toBits(a | b, w);
export const xor = (a: bigint, b: bigint, w: number) => toBits(a ^ b, w);
export const not = (a: bigint, w: number) => toBits(~a, w);

/** Shift left; bits shifted past the top are lost. n ≥ width gives 0. */
export function shl(a: bigint, n: number, w: number): bigint {
  return toBits(toBits(a, w) << BigInt(n), w);
}

/** Logical shift right: zeros come in from the top. n ≥ width gives 0. */
export function shrLogical(a: bigint, n: number, w: number): bigint {
  return toBits(a, w) >> BigInt(n);
}

/** Arithmetic shift right: copies of the sign bit come in from the top. n ≥ width gives 0 or all ones. */
export function shrArithmetic(a: bigint, n: number, w: number): bigint {
  return toBits(toSigned(a, w) >> BigInt(n), w);
}

/** Rotate left by n (taken modulo the width). */
export function rotl(a: bigint, n: number, w: number): bigint {
  const k = ((n % w) + w) % w;
  const x = toBits(a, w);
  if (k === 0) return x;
  return toBits((x << BigInt(k)) | (x >> BigInt(w - k)), w);
}

/** Rotate right by n (taken modulo the width). */
export function rotr(a: bigint, n: number, w: number): bigint {
  return rotl(a, w - (((n % w) + w) % w), w);
}

/** Number of set bits. */
export function popcount(a: bigint): number {
  let n = 0;
  for (let x = a < 0n ? -a : a; x > 0n; x >>= 1n) n += Number(x & 1n);
  return n;
}

/** Index of the highest set bit, or −1 for zero. */
export function highestSetBit(a: bigint): number {
  return a <= 0n ? -1 : a.toString(2).length - 1;
}

/** Index of the lowest set bit, or −1 for zero. */
export function lowestSetBit(a: bigint): number {
  if (a <= 0n) return -1;
  let i = 0;
  for (let x = a; (x & 1n) === 0n; x >>= 1n) i++;
  return i;
}

/** Count leading zeros within the width (width for zero). */
export function clz(a: bigint, w: number): number {
  return w - 1 - highestSetBit(toBits(a, w));
}

/** Count trailing zeros (width for zero). */
export function ctz(a: bigint, w: number): number {
  const i = lowestSetBit(toBits(a, w));
  return i < 0 ? w : i;
}

export function testBit(a: bigint, n: number): boolean {
  return ((a >> BigInt(n)) & 1n) === 1n;
}

export function toggleBit(a: bigint, n: number, w: number): bigint {
  return toBits(a ^ (1n << BigInt(n)), w);
}

// ---------- Register field labels ----------

export interface FieldLabel {
  name: string;
  hi: number;
  lo: number;
}

export interface FieldParse {
  /** Valid fields, highest bit first. */
  fields: FieldLabel[];
  errors: string[];
}

const RANGE_BR = String.raw`\[\s*(\d+)\s*(?:(?::|\.\.|-)\s*(\d+)\s*)?\]`;
const RANGE_BARE = String.raw`(\d+)(?:\s*(?::|\.\.|-)\s*(\d+))?`;
const NAME = String.raw`([A-Za-z_][^\[\]=:]*?)`;
const ITEM_PATTERNS = [
  // [7:4] MODE   7:4 MODE   bits 7..4 = MODE   [3] EN
  new RegExp(String.raw`^(?:bits?\s*)?(?:${RANGE_BR}|${RANGE_BARE})\s*[:=]?\s*(.*)$`, 'i'),
  // MODE[7:4]   MODE = 7:4   MODE: [3]
  new RegExp(String.raw`^${NAME}\s*[:=]?\s*(?:${RANGE_BR}|${RANGE_BARE})$`, 'i'),
];

export function fieldRangeText(f: { hi: number; lo: number }): string {
  return f.hi === f.lo ? `[${f.hi}]` : `[${f.hi}:${f.lo}]`;
}

function labelText(f: FieldLabel): string {
  return f.name ? `${f.name} ${fieldRangeText(f)}` : fieldRangeText(f);
}

/**
 * Parse register field labels such as "[7:4] MODE, [3] EN, [2:0] DIV". Items are separated by
 * commas, semicolons or new lines. Also accepted: "MODE[7:4]", "7:4 MODE", "7..4 MODE",
 * "bit 3 EN", reversed ranges ([4:7]). Fields outside the width, or overlapping an earlier
 * field, are reported as errors and left out.
 */
export function parseFieldLabels(input: string, width: number): FieldParse {
  const fields: FieldLabel[] = [];
  const errors: string[] = [];
  for (const raw of input.split(/[,;\n]+/)) {
    const item = raw.trim();
    if (!item) continue;
    let parsed: FieldLabel | null = null;
    const a = ITEM_PATTERNS[0].exec(item);
    if (a) {
      const x = Number(a[1] ?? a[3]);
      const y = a[1] !== undefined ? (a[2] !== undefined ? Number(a[2]) : x) : a[4] !== undefined ? Number(a[4]) : x;
      const name = a[5].trim();
      if (name === '' || /^[^\d\[]/.test(name)) parsed = { name, hi: Math.max(x, y), lo: Math.min(x, y) };
    }
    if (!parsed) {
      const b = ITEM_PATTERNS[1].exec(item);
      if (b) {
        const x = Number(b[2] ?? b[4]);
        const y = b[2] !== undefined ? (b[3] !== undefined ? Number(b[3]) : x) : b[5] !== undefined ? Number(b[5]) : x;
        parsed = { name: b[1].trim(), hi: Math.max(x, y), lo: Math.min(x, y) };
      }
    }
    if (!parsed) {
      errors.push(`Couldn't read “${item}”. Write fields as [7:4] NAME or [3] NAME.`);
      continue;
    }
    if (parsed.hi >= width) {
      errors.push(`${labelText(parsed)} is outside the ${width}-bit value (bits ${width - 1}…0).`);
      continue;
    }
    const clash = fields.find((f) => parsed!.lo <= f.hi && f.lo <= parsed!.hi);
    if (clash) {
      errors.push(`${labelText(parsed)} overlaps ${labelText(clash)}.`);
      continue;
    }
    fields.push(parsed);
  }
  fields.sort((p, q) => q.hi - p.hi);
  return { fields, errors };
}

/** Value of a field (bits hi…lo) of a pattern. */
export function fieldValue(bits: bigint, f: { hi: number; lo: number }): bigint {
  return (bits >> BigInt(f.lo)) & maskOf(f.hi - f.lo + 1);
}

/** Mask covering bits hi…lo. */
export function fieldMask(hi: number, lo: number): bigint {
  return maskOf(hi - lo + 1) << BigInt(lo);
}

// ---------- Bit-field visualizer layout (shared by the build-time render and the client) ----------

export interface LayoutCell {
  bit: number;
  /** 1-based CSS grid column. */
  col: number;
}

export interface LayoutLabel {
  name: string;
  /** Full range of the field, for the title. */
  hi: number;
  lo: number;
  colStart: number;
  /** Exclusive end column (CSS grid-column-end). */
  colEnd: number;
  /** The field continues in the row above (higher bits). */
  contLeft: boolean;
  /** The field continues in the row below (lower bits). */
  contRight: boolean;
  /** Index of the field in the input list, for alternating styling. */
  index: number;
}

export interface LayoutNibble {
  /** Bit index of the nibble's lowest bit. */
  lo: number;
  colStart: number;
  colEnd: number;
}

export interface LayoutRow {
  hi: number;
  lo: number;
  /** grid-template-columns value: cell tracks with narrow nibble gaps and wider byte gaps. */
  template: string;
  cells: LayoutCell[];
  nibbles: LayoutNibble[];
  labels: LayoutLabel[];
}

/** Grid column (1-based) of position p (0 = leftmost) in a row: one gap track after every 4 cells. */
function colOf(p: number): number {
  return p + Math.floor(p / 4) + 1;
}

/**
 * Lay out `width` bits in rows of `perRow` (8 or 16), MSB first, with field label segments.
 * Pure: the same layout is rendered at build time and by the client.
 */
export function bitLayout(width: number, perRow: number, fields: FieldLabel[] = []): LayoutRow[] {
  const per = Math.min(perRow, width);
  const tracks: string[] = [];
  for (let p = 0; p < per; p++) {
    tracks.push('var(--bf-cell)');
    if ((p + 1) % 4 === 0 && p < per - 1) tracks.push((p + 1) % 8 === 0 ? 'var(--bf-byte-gap)' : 'var(--bf-nib-gap)');
  }
  const template = tracks.join(' ');
  const rows: LayoutRow[] = [];
  for (let top = width - 1; top >= 0; top -= per) {
    const lo = top - per + 1;
    const pos = (bit: number) => top - bit;
    const cells: LayoutCell[] = [];
    for (let bit = top; bit >= lo; bit--) cells.push({ bit, col: colOf(pos(bit)) });
    const nibbles: LayoutNibble[] = [];
    for (let nlo = top - 3; nlo >= lo; nlo -= 4) {
      nibbles.push({ lo: nlo, colStart: colOf(pos(nlo + 3)), colEnd: colOf(pos(nlo)) + 1 });
    }
    const labels: LayoutLabel[] = [];
    fields.forEach((f, index) => {
      const sHi = Math.min(f.hi, top);
      const sLo = Math.max(f.lo, lo);
      if (sHi < sLo) return;
      labels.push({
        name: f.name,
        hi: f.hi,
        lo: f.lo,
        colStart: colOf(pos(sHi)),
        colEnd: colOf(pos(sLo)) + 1,
        contLeft: f.hi > top,
        contRight: f.lo < lo,
        index,
      });
    });
    rows.push({ hi: top, lo, template, cells, nibbles, labels });
  }
  return rows;
}

// ---------- C mask generation ----------

export type Suffix = 'U' | 'UL' | 'ULL';

/**
 * Literal suffix for masks used on a register of `regWidth` bits. The suffix follows the
 * register width, not the bit number, because `~(1U << n)` on a 64-bit register is a 32-bit
 * value and would clear the upper half. On targets with 16-bit int (AVR, MSP430) `1U` is only
 * 16 bits wide, so 32-bit registers need `1UL`.
 */
export function maskSuffix(regWidth: Width, int16 = false): Suffix {
  if (regWidth === 64) return 'ULL';
  if (regWidth === 32 && int16) return 'UL';
  return 'U';
}

function suffixBits(s: Suffix, int16: boolean): number {
  return s === 'ULL' ? 64 : s === 'UL' ? 32 : int16 ? 16 : 32;
}

export interface MaskOptions {
  hi: number;
  lo: number;
  regWidth: Width;
  /** Register expression, e.g. "reg" or "GPIOA->ODR". */
  reg?: string;
  /** Field name used for the _Pos / _Msk defines. */
  name?: string;
  int16?: boolean;
  /** Optional value to write into the field (shown as a concrete insert). */
  value?: bigint;
}

/** Parse "5", "7:4", "[7:4]", "4..7" into a bit range within the width. */
export function parseBitRange(input: string, width: number): Result<{ hi: number; lo: number }> {
  const m = /^\s*\[?\s*(\d+)\s*(?:(?::|\.\.|-)\s*(\d+)\s*)?\]?\s*$/.exec(input);
  if (!m) return { ok: false, error: 'Enter a bit number (5) or a range (7:4).' };
  const x = Number(m[1]);
  const y = m[2] !== undefined ? Number(m[2]) : x;
  const hi = Math.max(x, y);
  const lo = Math.min(x, y);
  if (hi >= width) return { ok: false, error: `Bit ${hi} is outside a ${width}-bit register (bits ${width - 1}…0).` };
  return { ok: true, value: { hi, lo } };
}

/** Is s a valid C identifier? */
export function isCIdentifier(s: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
}

/** Join [code, comment] lines with the comments aligned in one column. */
function aligned(lines: ([string, string?] | string)[]): string {
  const width = Math.max(...lines.map((l) => (typeof l === 'string' || !l[1] ? 0 : l[0].length)));
  return lines
    .map((l) => {
      if (typeof l === 'string') return l;
      const [code, comment] = l;
      return comment ? `${code.padEnd(width)}  /* ${comment} */` : code;
    })
    .join('\n');
}

/** Generate C code to set, clear, toggle and test a bit, or to build, extract and insert a field. */
export function maskCode(o: MaskOptions): string {
  const reg = o.reg?.trim() || 'reg';
  const name = o.name?.trim() || (o.hi === o.lo ? 'BIT' : 'FIELD');
  const int16 = o.int16 ?? false;
  const sfx = maskSuffix(o.regWidth, int16);
  const tBits = suffixBits(sfx, int16);
  const { hi, lo, regWidth } = o;
  const w = hi - lo + 1;
  const one = `1${sfx}`;
  const maskHex = `0x${formatHex(fieldMask(hi, lo), regWidth, false)}`;

  if (w === 1) {
    const n = hi;
    return aligned([
      `/* Bit ${n} of a ${regWidth}-bit register */`,
      [`#define ${name}_Pos  ${n}U`],
      [`#define ${name}_Msk  (${one} << ${name}_Pos)`, maskHex],
      '',
      [`${reg} |=  (${one} << ${n});`, 'set'],
      [`${reg} &= ~(${one} << ${n});`, 'clear'],
      [`${reg} ^=  (${one} << ${n});`, 'toggle'],
      [`if ((${reg} >> ${n}) & ${one}) { }`, 'test'],
      '',
      '/* same, with the defines */',
      [`${reg} |=  ${name}_Msk;`],
      [`${reg} &= ~${name}_Msk;`],
      [`${reg} ^=  ${name}_Msk;`],
      [`if (${reg} & ${name}_Msk) { }`],
    ]);
  }

  const fm = `0x${maskOf(w).toString(16).toUpperCase()}${sfx}`;
  // (1U << w) is undefined behaviour when w is the full width of the literal's type.
  const built = w < tBits ? `((${one} << ${w}) - ${one})` : fm;
  const lines: ([string, string?] | string)[] = [
    `/* Field [${hi}:${lo}], ${w} bits wide, in a ${regWidth}-bit register */`,
    [`#define ${name}_Pos  ${lo}U`],
    [`#define ${name}_Msk  (${fm} << ${name}_Pos)`, maskHex],
    '',
    [`mask = ${built} << ${lo};`, maskHex],
    [`val  = (${reg} >> ${lo}) & ${fm};`, 'extract'],
    '/* insert val */',
    [`${reg} = (${reg} & ~(${fm} << ${lo})) | ((val & ${fm}) << ${lo});`],
    '',
    '/* same, with the defines */',
    [`val = (${reg} & ${name}_Msk) >> ${name}_Pos;`],
    [`${reg} = (${reg} & ~${name}_Msk) | ((val << ${name}_Pos) & ${name}_Msk);`],
  ];
  if (o.value !== undefined) {
    const v = o.value & maskOf(w);
    lines.push('', `/* write the current field value, ${v} */`);
    lines.push([`${reg} = (${reg} & ~${name}_Msk) | (0x${v.toString(16).toUpperCase()}${sfx} << ${name}_Pos);`]);
  }
  return aligned(lines);
}

// ---------- Bit-field visualizer markup (string, so the build and the client render identically) ----------

function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * HTML for the bit-field visualizer: one grid per row with field brackets, bit numbers, a toggle
 * button per bit and the hex digit of each nibble. Styles live in BitField.astro.
 */
export function bitFieldMarkup(width: number, perRow: number, fields: FieldLabel[], signed: boolean, bits = 0n): string {
  const owner = (bit: number) => fields.find((f) => bit <= f.hi && bit >= f.lo);
  return bitLayout(width, perRow, fields)
    .map((row) => {
      let h = `<div class="bf-row" style="grid-template-columns:${row.template}">`;
      for (const l of row.labels) {
        const text = l.name || fieldRangeText(l);
        const cls = ['bf-label', l.index % 2 ? 'bf-label--alt' : '', l.contLeft ? 'bf-cont-l' : '', l.contRight ? 'bf-cont-r' : '']
          .filter(Boolean)
          .join(' ');
        const title = l.name ? `${l.name} ${fieldRangeText(l)}` : fieldRangeText(l);
        h += `<div class="${cls}" style="grid-column:${l.colStart}/${l.colEnd}" title="${escHtml(title)}"><span>${escHtml(text)}</span></div>`;
      }
      for (const c of row.cells) {
        const sign = signed && c.bit === width - 1;
        h += `<span class="bf-num${sign ? ' bf-num--sign' : ''}" style="grid-column:${c.col}" aria-hidden="true"${sign ? ' title="Sign bit"' : ''}>${c.bit}</span>`;
      }
      for (const c of row.cells) {
        const on = testBit(bits, c.bit);
        const f = owner(c.bit);
        const label = `Bit ${c.bit}${f?.name ? ` (${f.name})` : ''}${signed && c.bit === width - 1 ? ', sign bit' : ''}`;
        h += `<button type="button" class="bf-bit" style="grid-column:${c.col}" data-bit="${c.bit}" aria-pressed="${on}" aria-label="${escHtml(label)}" tabindex="${c.bit === width - 1 ? 0 : -1}">${on ? 1 : 0}</button>`;
      }
      for (const n of row.nibbles) {
        const d = Number((bits >> BigInt(n.lo)) & 0xfn).toString(16).toUpperCase();
        h += `<span class="bf-hex" style="grid-column:${n.colStart}/${n.colEnd}" data-nib="${n.lo}" aria-hidden="true">${d}</span>`;
      }
      return `${h}</div>`;
    })
    .join('');
}
