// Fixed-point Qm.n conversion. Pure functions, no DOM. BigInt throughout, so word sizes up to
// 64 bits are exact and real → fixed rounding is done on the exact decimal input.
//
// Notation (TI convention): Qm.n has m integer bits and n fractional bits, and m does NOT count
// the sign bit. A signed Qm.n word is 1 + m + n bits; an unsigned UQm.n word is m + n bits.
//   Q15  = Q0.15  → 16-bit signed, range [−1, 1 − 2^−15]
//   Q31  = Q0.31  → 32-bit signed
//   Q1.14         → 16-bit signed, range [−2, 2 − 2^−14]
// ARM's notation counts the sign bit in m, so ARM Q1.15 = TI Q0.15 (= Q15) and the 32-bit
// signed type usually called "Q16.16" (libfixmath fix16_t) is Q15.16 here.

import { decToString, parseDecimal, type Dec } from './float754';

export interface QFormat {
  /** Integer bits, excluding the sign bit. */
  m: number;
  /** Fractional bits. */
  n: number;
  signed: boolean;
}

export type RoundMode = 'nearest' | 'nearest-even' | 'floor' | 'ceil' | 'zero';

export const ROUND_MODES: { value: RoundMode; label: string; c: string }[] = [
  { value: 'nearest', label: 'Nearest, ties away from zero', c: 'round' },
  { value: 'nearest-even', label: 'Nearest, ties to even', c: 'rint' },
  { value: 'floor', label: 'Floor (truncate bits, toward −∞)', c: 'floor' },
  { value: 'zero', label: 'Toward zero (C cast)', c: 'trunc' },
  { value: 'ceil', label: 'Ceiling (toward +∞)', c: 'ceil' },
];

export const MAX_WORD_BITS = 64;

export function wordBits(f: QFormat): number {
  return f.m + f.n + (f.signed ? 1 : 0);
}

/** Error message, or null when the format is usable. */
export function validateFormat(f: QFormat): string | null {
  if (!Number.isInteger(f.m) || f.m < 0) return 'Integer bits m must be a whole number ≥ 0.';
  if (!Number.isInteger(f.n) || f.n < 0) return 'Fractional bits n must be a whole number ≥ 0.';
  const w = wordBits(f);
  if (w < 1) return 'The word needs at least one bit.';
  if (w > MAX_WORD_BITS) return `Word size is ${w} bits; the maximum supported is ${MAX_WORD_BITS}.`;
  return null;
}

/** "Q15", "Q1.14", "UQ16.16". The short "Qn" form is used for signed Q0.n. */
export function qName(f: QFormat): string {
  if (f.signed) return f.m === 0 ? `Q${f.n}` : `Q${f.m}.${f.n}`;
  return `UQ${f.m}.${f.n}`;
}

/** The same format in ARM notation (sign bit counted in m). */
export function armName(f: QFormat): string {
  return f.signed ? `Q${f.m + 1}.${f.n}` : `UQ${f.m}.${f.n}`;
}

/** Smallest and largest raw integers. */
export function rawRange(f: QFormat): { min: bigint; max: bigint } {
  const span = 1n << BigInt(f.m + f.n);
  return f.signed ? { min: -span, max: span - 1n } : { min: 0n, max: span - 1n };
}

/** Exact real value of a raw integer: raw · 2^−n. */
export function rawToDec(raw: bigint, n: number): Dec {
  const neg = raw < 0n;
  const a = neg ? -raw : raw;
  return { neg, n: a * 5n ** BigInt(n), e: -n };
}

export function rawToReal(raw: bigint, f: QFormat): string {
  return decToString(rawToDec(raw, f.n));
}

/** Range and resolution as exact decimal strings. */
export function formatInfo(f: QFormat): { min: string; max: string; resolution: string; word: number } {
  const r = rawRange(f);
  return { min: rawToReal(r.min, f), max: rawToReal(r.max, f), resolution: rawToReal(1n, f), word: wordBits(f) };
}

/** Raw signed value → W-bit pattern (two's complement for negatives). */
export function toPattern(raw: bigint, f: QFormat): bigint {
  return BigInt.asUintN(wordBits(f), raw);
}

/** W-bit pattern → raw value (sign-extended when the format is signed). */
export function fromPattern(pattern: bigint, f: QFormat): bigint {
  const w = wordBits(f);
  return f.signed ? BigInt.asIntN(w, pattern) : BigInt.asUintN(w, pattern);
}

export function patternHex(raw: bigint, f: QFormat): string {
  return `0x${toPattern(raw, f).toString(16).toUpperCase().padStart(Math.ceil(wordBits(f) / 4), '0')}`;
}

/** Binary pattern with the binary point shown: Q1.14 0.5 → "0 0.10000000000000"… grouped as sign|int.frac. */
export function patternBinary(raw: bigint, f: QFormat): { sign: string; int: string; frac: string } {
  const s = toPattern(raw, f).toString(2).padStart(wordBits(f), '0');
  const sb = f.signed ? 1 : 0;
  return { sign: s.slice(0, sb), int: s.slice(sb, sb + f.m), frac: s.slice(sb + f.m) };
}

function floorDiv(a: bigint, b: bigint): bigint {
  // b > 0
  const q = a / b;
  return a % b !== 0n && a < 0n ? q - 1n : q;
}

/** Round num/den (den > 0) to an integer with the given mode. */
export function roundRational(num: bigint, den: bigint, mode: RoundMode): bigint {
  const fl = floorDiv(num, den);
  const rem = num - fl * den; // 0 ≤ rem < den
  if (rem === 0n) return fl;
  switch (mode) {
    case 'floor':
      return fl;
    case 'ceil':
      return fl + 1n;
    case 'zero':
      return num < 0n ? fl + 1n : fl;
    case 'nearest': {
      const twice = 2n * rem;
      if (twice > den) return fl + 1n;
      if (twice < den) return fl;
      return num < 0n ? fl : fl + 1n; // tie: away from zero
    }
    case 'nearest-even': {
      const twice = 2n * rem;
      if (twice > den) return fl + 1n;
      if (twice < den) return fl;
      return (fl & 1n) === 0n ? fl : fl + 1n;
    }
  }
}

export type OverflowStatus = 'ok' | 'saturated-high' | 'saturated-low' | 'wrapped';

export interface ToFixedResult {
  raw: bigint;
  /** Rounded but before saturation / wrapping. */
  unclamped: bigint;
  status: OverflowStatus;
  /** Exact real value of raw. */
  value: Dec;
  /** value − input, exact. */
  error: Dec;
}

function decToRational(d: Dec): [bigint, bigint] {
  const s = d.neg ? -d.n : d.n;
  return d.e >= 0 ? [s * 10n ** BigInt(d.e), 1n] : [s, 10n ** BigInt(-d.e)];
}

function decSub(a: Dec, b: Dec): Dec {
  const e = Math.min(a.e, b.e);
  const an = (a.neg ? -a.n : a.n) * 10n ** BigInt(a.e - e);
  const bn = (b.neg ? -b.n : b.n) * 10n ** BigInt(b.e - e);
  const r = an - bn;
  return { neg: r < 0n, n: r < 0n ? -r : r, e };
}

/** Real (exact decimal) → Qm.n raw integer. With saturate=false the result wraps like a C cast. */
export function realToFixed(x: Dec, f: QFormat, mode: RoundMode, saturate: boolean): ToFixedResult {
  const [num, den] = decToRational(x);
  const rounded = roundRational(num << BigInt(f.n), den, mode);
  const { min, max } = rawRange(f);
  let raw = rounded;
  let status: OverflowStatus = 'ok';
  if (rounded > max || rounded < min) {
    if (saturate) {
      raw = rounded > max ? max : min;
      status = rounded > max ? 'saturated-high' : 'saturated-low';
    } else {
      raw = fromPattern(BigInt.asUintN(wordBits(f), rounded), f);
      status = 'wrapped';
    }
  }
  const value = rawToDec(raw, f.n);
  return { raw, unclamped: rounded, status, value, error: decSub(value, x) };
}

/** Parse a real number for real → fixed. */
export function parseReal(input: string): Dec | null {
  const p = parseDecimal(input);
  return p && p.kind === 'finite' ? p.dec : null;
}

export type RawParse = { ok: true; raw: bigint; form: 'dec' | 'hex' | 'bin' } | { ok: false; error: string };

/**
 * Parse a stored fixed-point integer: decimal ("-16384"), or a W-bit pattern in hex ("0xC000")
 * or binary ("0b1100…"). Hex/binary patterns are sign-extended for signed formats.
 */
export function parseRaw(input: string, f: QFormat): RawParse {
  const s = input.trim().replace(/[_\s]/g, '').replace(/^−/, '-');
  if (s === '') return { ok: false, error: 'Enter the stored integer, e.g. 16384 or 0x4000.' };
  const w = wordBits(f);
  const { min, max } = rawRange(f);
  const hex = /^0x([0-9a-f]+)$/i.exec(s);
  const bin = /^0b([01]+)$/i.exec(s);
  if (hex || bin) {
    const pattern = hex ? BigInt(`0x${hex[1]}`) : BigInt(`0b${bin![1]}`);
    if (pattern >> BigInt(w) !== 0n) {
      return { ok: false, error: `${s} does not fit in the ${w}-bit word of ${qName(f)} (max ${patternHex(-1n, f)}).` };
    }
    return { ok: true, raw: fromPattern(pattern, f), form: hex ? 'hex' : 'bin' };
  }
  if (!/^[+-]?\d+$/.test(s)) return { ok: false, error: 'Use a whole number (e.g. -16384), hex (0xC000) or binary (0b…).' };
  const raw = BigInt(s);
  if (raw < min || raw > max) return { ok: false, error: `${s} is outside ${qName(f)}: the integer must be between ${min} and ${max}.` };
  return { ok: true, raw, form: 'dec' };
}

// ---------- Common formats ----------

export interface NamedFormat extends QFormat {
  id: string;
  label: string;
  note: string;
}

export const COMMON_FORMATS: NamedFormat[] = [
  { id: 'q7', label: 'Q7 (Q0.7)', m: 0, n: 7, signed: true, note: 'int8_t, CMSIS-DSP q7_t' },
  { id: 'q15', label: 'Q15 (Q0.15)', m: 0, n: 15, signed: true, note: 'int16_t, CMSIS-DSP q15_t, audio' },
  { id: 'q31', label: 'Q31 (Q0.31)', m: 0, n: 31, signed: true, note: 'int32_t, CMSIS-DSP q31_t' },
  { id: 'q1.14', label: 'Q1.14', m: 1, n: 14, signed: true, note: 'int16_t, coefficients up to ±2' },
  { id: 'q1.30', label: 'Q1.30', m: 1, n: 30, signed: true, note: 'int32_t, biquad coefficients up to ±2' },
  { id: 'q7.8', label: 'Q7.8', m: 7, n: 8, signed: true, note: 'int16_t; ARM notation "Q8.8"' },
  { id: 'uq8.8', label: 'UQ8.8', m: 8, n: 8, signed: false, note: 'uint16_t, e.g. sensor readings' },
  { id: 'q15.16', label: 'Q15.16', m: 15, n: 16, signed: true, note: 'int32_t; ARM notation "Q16.16", libfixmath fix16_t' },
  { id: 'uq16.16', label: 'UQ16.16', m: 16, n: 16, signed: false, note: 'uint32_t' },
  { id: 'q31.32', label: 'Q31.32', m: 31, n: 32, signed: true, note: 'int64_t, wide accumulator / timestamps' },
];

// ---------- C code generation ----------

function cTypes(f: QFormat): { type: string; bits: number; wide: string | null } {
  const w = wordBits(f);
  const bits = w <= 8 ? 8 : w <= 16 ? 16 : w <= 32 ? 32 : 64;
  const type = `${f.signed ? '' : 'u'}int${bits}_t`;
  const wide = bits <= 32 ? `${f.signed ? '' : 'u'}int${bits * 2}_t` : null;
  return { type, bits, wide };
}

/** Exact decimal literal of 2^k (k ≥ 0), e.g. 32768.0 */
function pow2Lit(k: number): string {
  return `${(1n << BigInt(k)).toString()}.0`;
}

function cIdent(f: QFormat): string {
  return qName(f).replace('.', '_');
}

/**
 * C helpers for a format: scale constants, a saturating float → Q conversion using the chosen
 * rounding, Q → float, and (for words up to 32 bits) a rounded, saturating multiply.
 */
export function generateC(f: QFormat, mode: RoundMode): string {
  const err = validateFormat(f);
  if (err) throw new Error(err);
  const id = cIdent(f);
  const lo = id.toLowerCase();
  const w = wordBits(f);
  const { type, bits, wide } = cTypes(f);
  // float has a 24-bit significand: enough for words up to 24 bits; wider words need double.
  const useFloat = w <= 24;
  const ft = useFloat ? 'float' : 'double';
  const sfx = useFloat ? 'f' : '';
  const fn = ROUND_MODES.find((r) => r.value === mode)!.c + (useFloat ? 'f' : '');
  const { min, max } = rawRange(f);
  const lit = (v: bigint) => {
    if (bits === 64) return f.signed ? (v === min ? `(-INT64_MAX - 1)` : `INT64_C(${v})`) : `UINT64_C(${v})`;
    if (f.signed && v === min && bits === 32 && w === 32) return '(-2147483647 - 1)';
    return v < 0n ? `(${v})` : `${v}${f.signed ? '' : 'u'}`;
  };
  const scale = `${pow2Lit(f.n)}${sfx}`;
  const upper = `${pow2Lit(f.m + f.n)}${sfx}`; // max + 1, exact power of two
  const lower = f.signed ? `-${upper}` : `0.0${sfx}`;
  const info = formatInfo(f);
  const P = id;

  const lines: string[] = [
    `/* ${qName(f)} (TI notation; ${armName(f)} in ARM notation): ${f.signed ? 'signed' : 'unsigned'}, ${w}-bit word${w !== bits ? ` stored in ${type}` : ''},`,
    ` * ${f.m} integer bit${f.m === 1 ? '' : 's'}, ${f.n} fractional bit${f.n === 1 ? '' : 's'}.`,
    ` * Range [${info.min}, ${info.max}], resolution 2^-${f.n} = ${info.resolution}.`,
    ' * Generated by BitBench. */',
    '#include <stdint.h>',
    '#include <math.h>',
    '',
    `#define ${P}_FRAC_BITS ${f.n}`,
    `#define ${P}_MAX ${lit(max)}`,
    `#define ${P}_MIN ${lit(min)}`,
    '',
    `/* Quick macros. No saturation: out-of-range input is undefined behaviour in C,`,
    ` * and FLOAT_TO_${P} rounds with ${fn}(). Use the functions below for safe conversion. */`,
    `#define FLOAT_TO_${P}(x) ((${type})${fn}((x) * ${scale}))`,
    `#define ${P}_TO_FLOAT(q) ((${ft})(q) * (1.0${sfx} / ${scale}))`,
    '',
    `/* Saturating conversion: values beyond the range clamp to ${P}_MIN / ${P}_MAX, NaN gives 0. */`,
    `static inline ${type} ${lo}_from_float(${ft} x)`,
    '{',
    `    ${ft} r = ${fn}(x * ${scale});`,
    '    if (r != r) return 0; /* NaN */',
    `    if (r >= ${upper}) return ${P}_MAX;`,
    `    if (r < ${lower}) return ${P}_MIN;`,
    `    return (${type})r;`,
    '}',
    '',
    `static inline ${ft} ${lo}_to_float(${type} q)`,
    '{',
    `    return (${ft})q * (1.0${sfx} / ${scale});`,
    '}',
  ];
  if (wide && f.n > 0) {
    lines.push(
      '',
      `/* Multiply two ${qName(f)} values: ${wide} product, round to nearest (ties up), saturate. */`,
      `static inline ${type} ${lo}_mul(${type} a, ${type} b)`,
      '{',
      `    ${wide} p = (${wide})a * b;`,
      `    p = (p + ((${wide})1 << ${f.n - 1})) >> ${f.n};${f.signed ? ' /* assumes arithmetic right shift */' : ''}`,
      `    if (p > ${P}_MAX) return ${P}_MAX;`,
      ...(f.signed ? [`    if (p < ${P}_MIN) return ${P}_MIN;`] : []),
      `    return (${type})p;`,
      '}',
    );
  }
  if (w > 53) {
    lines.push('', `/* Note: double has a 53-bit significand, so float ↔ ${qName(f)} conversion of large values is not exact. */`);
  }
  return lines.join('\n') + '\n';
}
