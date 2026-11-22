// IEEE-754 binary32 / binary64 encode and decode. Pure functions, no DOM.
//
// Decimal → bits is done with exact rational arithmetic (BigInt) and round-half-to-even, so a
// decimal string is rounded once, directly to the target format. (Going through a JS double
// first and then Math.fround() would round twice and can be wrong for float32 near halfway
// points.) Bits → decimal gives the exact value of the stored number, every digit.

export type FloatKind = 32 | 64;

export interface FloatFormat {
  bits: number;
  expBits: number;
  fracBits: number;
  bias: number;
  /** Smallest normal unbiased exponent (1 − bias). */
  emin: number;
  /** Largest unbiased exponent (bias). */
  emax: number;
}

export const FORMATS: Record<FloatKind, FloatFormat> = {
  32: { bits: 32, expBits: 8, fracBits: 23, bias: 127, emin: -126, emax: 127 },
  64: { bits: 64, expBits: 11, fracBits: 52, bias: 1023, emin: -1022, emax: 1023 },
};

export type FloatClass = 'zero' | 'subnormal' | 'normal' | 'infinity' | 'nan';

// ---------- Exact decimal numbers: (−1)^neg · n · 10^e ----------

export interface Dec {
  neg: boolean;
  n: bigint;
  e: number;
}

const pow10Cache = new Map<number, bigint>();
function pow10(k: number): bigint {
  let v = pow10Cache.get(k);
  if (v === undefined) {
    v = 10n ** BigInt(k);
    if (pow10Cache.size < 2048) pow10Cache.set(k, v);
  }
  return v;
}

/** Plain decimal string of a Dec, no exponent, no trailing zeros after the point. */
export function decToString(d: Dec): string {
  if (d.n === 0n) return d.neg ? '-0' : '0';
  let s = d.n.toString();
  if (d.e >= 0) s += '0'.repeat(d.e);
  else {
    const k = -d.e;
    if (s.length <= k) s = '0'.repeat(k - s.length + 1) + s;
    s = `${s.slice(0, s.length - k)}.${s.slice(s.length - k)}`;
    s = s.replace(/0+$/, '').replace(/\.$/, '');
  }
  return (d.neg ? '-' : '') + s;
}

/** Number of significant decimal digits in d (exact value). */
export function significantDigits(d: Dec): number {
  if (d.n === 0n) return 1;
  return d.n.toString().replace(/0+$/, '').length;
}

function decSub(a: Dec, b: Dec): Dec {
  const e = Math.min(a.e, b.e);
  const an = (a.neg ? -a.n : a.n) * pow10(a.e - e);
  const bn = (b.neg ? -b.n : b.n) * pow10(b.e - e);
  const r = an - bn;
  return { neg: r < 0n, n: r < 0n ? -r : r, e };
}

/** Approximate a Dec as a JS number (for display of relative error etc.). */
export function decToNumber(d: Dec): number {
  const s = d.n.toString();
  return (d.neg ? -1 : 1) * Number(`${s}e${d.e}`);
}

// ---------- Parsing decimal input ----------

export type ParsedValue =
  | { kind: 'finite'; dec: Dec }
  | { kind: 'inf'; neg: boolean }
  | { kind: 'nan'; neg: boolean };

/**
 * Parse a decimal number: "3.14159", "-1e-45", ".5", "1_000.25", "+inf", "-Infinity", "NaN".
 * Returns null when the text is not a number.
 */
export function parseDecimal(input: string): ParsedValue | null {
  const s = input.trim().replace(/[_\s]/g, '').replace(/([0-9.])[fFdD]$/, '$1').replace(/^−/, '-');
  const sp = /^([+-]?)(inf|infinity|∞|nan)$/i.exec(s);
  if (sp) {
    const neg = sp[1] === '-';
    return sp[2].toLowerCase() === 'nan' ? { kind: 'nan', neg } : { kind: 'inf', neg };
  }
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m) return null;
  const int = m[2] ?? '';
  const frac = m[3] ?? '';
  if (int === '' && frac === '') return null;
  const exp = m[4] ? parseInt(m[4], 10) : 0;
  if (!Number.isFinite(exp) || Math.abs(exp) > 100000) return null;
  const digits = (int + frac).replace(/^0+/, '');
  return { kind: 'finite', dec: { neg: m[1] === '-', n: digits === '' ? 0n : BigInt(digits), e: exp - frac.length } };
}

// ---------- Bits helpers ----------

function fmt(kind: FloatKind): FloatFormat {
  return FORMATS[kind];
}

export function signMask(kind: FloatKind): bigint {
  return 1n << BigInt(fmt(kind).bits - 1);
}

export function allOnes(kind: FloatKind): bigint {
  return (1n << BigInt(fmt(kind).bits)) - 1n;
}

/** Bits of the canonical quiet NaN (0x7FC00000 / 0x7FF8000000000000). */
export function quietNaN(kind: FloatKind, neg = false): bigint {
  const f = fmt(kind);
  const v = (((1n << BigInt(f.expBits)) - 1n) << BigInt(f.fracBits)) | (1n << BigInt(f.fracBits - 1));
  return neg ? v | signMask(kind) : v;
}

export function infinityBits(kind: FloatKind, neg = false): bigint {
  const f = fmt(kind);
  const v = ((1n << BigInt(f.expBits)) - 1n) << BigInt(f.fracBits);
  return neg ? v | signMask(kind) : v;
}

/** Bits of a JS number stored as float32 (rounded by the engine) or float64, via DataView. */
export function bitsFromNumber(x: number, kind: FloatKind): bigint {
  const dv = new DataView(new ArrayBuffer(8));
  if (kind === 32) {
    dv.setFloat32(0, x);
    return BigInt(dv.getUint32(0));
  }
  dv.setFloat64(0, x);
  return dv.getBigUint64(0);
}

/** The JS number (exactly) represented by the bits, via DataView. NaN payloads are not preserved. */
export function numberFromBits(bits: bigint, kind: FloatKind): number {
  const dv = new DataView(new ArrayBuffer(8));
  if (kind === 32) {
    dv.setUint32(0, Number(bits & 0xffffffffn));
    return dv.getFloat32(0);
  }
  dv.setBigUint64(0, bits & 0xffffffffffffffffn);
  return dv.getFloat64(0);
}

/** Bytes as stored in memory: 'be' = most significant first, 'le' = as on x86/ARM little-endian. */
export function bitsToBytes(bits: bigint, kind: FloatKind, order: 'be' | 'le'): number[] {
  const n = kind / 8;
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(Number((bits >> BigInt(8 * i)) & 0xffn));
  return order === 'le' ? out.reverse() : out;
}

export function hexBits(bits: bigint, kind: FloatKind): string {
  return `0x${bits.toString(16).toUpperCase().padStart(kind / 4, '0')}`;
}

export type HexParse = { ok: true; bits: bigint } | { ok: false; error: string };

/**
 * Parse a hex bit pattern. Big-endian ('be'): "0x40490FDB", "4049 0fdb"; shorter values are
 * zero-extended on the left like any integer. Little-endian ('le'): the bytes as they appear in
 * memory ("DB 0F 49 40"), which must be complete.
 */
export function parseHexBits(input: string, kind: FloatKind, order: 'be' | 'le'): HexParse {
  const s = input.trim().replace(/0x/gi, '').replace(/[\s,:_\-]/g, '');
  const need = kind / 4;
  if (s === '') return { ok: false, error: `Enter ${need} hex digits, e.g. ${kind === 32 ? '0x40490FDB' : '0x400921FB54442D18'}.` };
  if (!/^[0-9a-fA-F]+$/.test(s)) return { ok: false, error: 'Use hex digits 0–9 and A–F only.' };
  if (s.length > need) return { ok: false, error: `Too many digits: float${kind} has ${need} hex digits (${kind} bits).` };
  if (order === 'le') {
    if (s.length !== need) return { ok: false, error: `Little-endian input needs all ${kind / 8} bytes (${need} hex digits).` };
    const bytes = s.match(/../g)!.reverse().join('');
    return { ok: true, bits: BigInt(`0x${bytes}`) };
  }
  return { ok: true, bits: BigInt(`0x${s}`) };
}

// ---------- Encode: exact decimal → nearest float ----------

export type EncodeStatus = 'exact' | 'inexact' | 'overflow' | 'underflow' | 'special';

export interface EncodeResult {
  bits: bigint;
  status: EncodeStatus;
}

function bitLength(v: bigint): number {
  return v === 0n ? 0 : v.toString(2).length;
}

/** Round num/den to an integer, ties to even. Returns [q, inexact]. */
function divRoundEven(num: bigint, den: bigint): [bigint, boolean] {
  const q = num / den;
  const r = num - q * den;
  if (r === 0n) return [q, false];
  const twice = 2n * r;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return [q + 1n, true];
  return [q, true];
}

/** Round an exact decimal to the nearest float32/float64 (round-half-to-even, IEEE default). */
export function encodeDec(d: Dec, kind: FloatKind): EncodeResult {
  const f = fmt(kind);
  const sign = d.neg ? signMask(kind) : 0n;
  if (d.n === 0n) return { bits: sign, status: 'exact' };

  // Quick range screen on the decimal magnitude to avoid huge BigInts.
  const mag = d.n.toString().length + d.e; // value < 10^mag
  if (mag > (kind === 32 ? 40 : 310)) return { bits: infinityBits(kind, d.neg), status: 'overflow' };
  if (mag < (kind === 32 ? -46 : -325)) return { bits: sign, status: 'underflow' };

  let num = d.n;
  let den = 1n;
  if (d.e >= 0) num *= pow10(d.e);
  else den = pow10(-d.e);

  // Binary exponent e with 2^e ≤ num/den < 2^(e+1).
  let e = bitLength(num) - bitLength(den);
  const ge = (k: number) => (k >= 0 ? num >= den << BigInt(k) : num << BigInt(-k) >= den);
  if (!ge(e)) e -= 1;

  // Exponent of one unit in the last place for this value (fixed at emin − fracBits for subnormals).
  let q = Math.max(e, f.emin) - f.fracBits;
  let [m, inexact] = q >= 0 ? divRoundEven(num, den << BigInt(q)) : divRoundEven(num << BigInt(-q), den);
  if (m >= 1n << BigInt(f.fracBits + 1)) {
    m >>= 1n; // rounding carried into the next binade; m was exactly 2^(p), so this is exact
    q += 1;
  }
  if (q > f.emax - f.fracBits) return { bits: infinityBits(kind, d.neg), status: 'overflow' };
  if (m === 0n) return { bits: sign, status: 'underflow' };

  let bits: bigint;
  if (m < 1n << BigInt(f.fracBits)) bits = m; // subnormal: biased exponent 0
  else bits = (BigInt(q + f.fracBits + f.bias) << BigInt(f.fracBits)) | (m - (1n << BigInt(f.fracBits)));
  return { bits: bits | sign, status: inexact ? 'inexact' : 'exact' };
}

/** Parse and encode decimal text. Returns null when the text is not a number. */
export function encodeDecimal(input: string, kind: FloatKind): (EncodeResult & { parsed: ParsedValue }) | null {
  const parsed = parseDecimal(input);
  if (!parsed) return null;
  if (parsed.kind === 'nan') return { bits: quietNaN(kind, parsed.neg), status: 'special', parsed };
  if (parsed.kind === 'inf') return { bits: infinityBits(kind, parsed.neg), status: 'special', parsed };
  return { ...encodeDec(parsed.dec, kind), parsed };
}

// ---------- Decode ----------

export interface Decoded {
  kind: FloatKind;
  bits: bigint;
  sign: 0 | 1;
  /** Raw exponent field. */
  biasedExp: number;
  /** Exponent applied to the significand: emin for subnormals/zero, null for Inf/NaN. */
  unbiasedExp: number | null;
  /** Raw fraction (mantissa) field. */
  fraction: bigint;
  cls: FloatClass;
  /** NaN only: quiet (MSB of fraction set) or signalling. */
  quiet?: boolean;
  /** NaN only: the fraction bits below the quiet bit. */
  payload?: bigint;
  /** The value as a JS number. */
  value: number;
  /** Exact value: significand · 2^exp2 (finite values only). */
  significand?: bigint;
  exp2?: number;
}

export function decodeBits(bits: bigint, kind: FloatKind): Decoded {
  const f = fmt(kind);
  bits &= allOnes(kind);
  const sign = (bits >> BigInt(f.bits - 1)) & 1n ? 1 : 0;
  const biasedExp = Number((bits >> BigInt(f.fracBits)) & ((1n << BigInt(f.expBits)) - 1n));
  const fraction = bits & ((1n << BigInt(f.fracBits)) - 1n);
  const maxExp = (1 << f.expBits) - 1;
  const value = numberFromBits(bits, kind);
  const base = { kind, bits, sign: sign as 0 | 1, biasedExp, fraction, value };
  if (biasedExp === maxExp) {
    if (fraction === 0n) return { ...base, unbiasedExp: null, cls: 'infinity' };
    const qbit = 1n << BigInt(f.fracBits - 1);
    return { ...base, unbiasedExp: null, cls: 'nan', quiet: (fraction & qbit) !== 0n, payload: fraction & (qbit - 1n) };
  }
  if (biasedExp === 0) {
    return {
      ...base,
      unbiasedExp: f.emin,
      cls: fraction === 0n ? 'zero' : 'subnormal',
      significand: fraction,
      exp2: f.emin - f.fracBits,
    };
  }
  return {
    ...base,
    unbiasedExp: biasedExp - f.bias,
    cls: 'normal',
    significand: (1n << BigInt(f.fracBits)) | fraction,
    exp2: biasedExp - f.bias - f.fracBits,
  };
}

/** Exact stored value as a Dec (finite values only). */
export function storedDec(d: Decoded): Dec | null {
  if (d.significand === undefined || d.exp2 === undefined) return null;
  const neg = d.sign === 1;
  if (d.exp2 >= 0) return { neg, n: d.significand << BigInt(d.exp2), e: 0 };
  // m · 2^−k = m · 5^k · 10^−k
  const k = -d.exp2;
  return { neg, n: d.significand * 5n ** BigInt(k), e: -k };
}

/** Exact decimal expansion of the stored value: 0.1f → "0.100000001490116119384765625". */
export function exactDecimal(bits: bigint, kind: FloatKind): string {
  const d = decodeBits(bits, kind);
  if (d.cls === 'nan') return 'NaN';
  if (d.cls === 'infinity') return d.sign ? '-Infinity' : 'Infinity';
  return decToString(storedDec(d)!);
}

/** stored − entered, exactly. */
export function roundingError(bits: bigint, kind: FloatKind, entered: Dec): Dec | null {
  const s = storedDec(decodeBits(bits, kind));
  return s ? decSub(s, entered) : null;
}

// ---------- Neighbours and ULP ----------

/** Next representable value towards +∞ (IEEE nextUp). */
export function nextUp(bits: bigint, kind: FloatKind): bigint {
  const d = decodeBits(bits, kind);
  if (d.cls === 'nan') return bits;
  if (d.cls === 'infinity') return d.sign ? bitsMaxFinite(kind) | signMask(kind) : bits;
  if (d.cls === 'zero') return 1n;
  return d.sign ? bits - 1n : bits + 1n;
}

/** Next representable value towards −∞ (IEEE nextDown). */
export function nextDown(bits: bigint, kind: FloatKind): bigint {
  return negate(nextUp(negate(bits, kind), kind), kind);
}

export function negate(bits: bigint, kind: FloatKind): bigint {
  return bits ^ signMask(kind);
}

export function bitsMaxFinite(kind: FloatKind): bigint {
  return infinityBits(kind) - 1n;
}

/**
 * ULP of a finite value as a power of two: the gap between adjacent floats in its binade
 * (2^(max(e, emin) − fracBits)). For x ≥ 0 this equals nextUp(x) − x, except at the largest
 * finite value, where the next "value" is infinity.
 */
export function ulpExp2(bits: bigint, kind: FloatKind): number | null {
  const d = decodeBits(bits, kind);
  if (d.unbiasedExp === null) return null;
  return d.unbiasedExp - fmt(kind).fracBits;
}

/** Exact decimal of 2^k. */
export function pow2String(k: number): string {
  return k >= 0 ? (1n << BigInt(k)).toString() : decToString({ neg: false, n: 5n ** BigInt(-k), e: k });
}

/**
 * Shortest decimal that rounds back to exactly these bits (what printf("%.9g") / "%.17g" would
 * print, minus redundant digits). Useful for writing a float literal in C.
 */
export function shortestDecimal(bits: bigint, kind: FloatKind): string {
  const d = decodeBits(bits, kind);
  if (d.cls === 'nan') return 'NaN';
  if (d.cls === 'infinity') return d.sign ? '-Infinity' : 'Infinity';
  if (d.cls === 'zero') return d.sign ? '-0' : '0';
  if (kind === 64) return String(d.value);
  for (let p = 1; p <= 9; p++) {
    const s = d.value.toPrecision(p);
    const r = encodeDecimal(s, 32);
    if (r && r.bits === bits) return normalizeNumberString(s);
  }
  return normalizeNumberString(d.value.toPrecision(9));
}

function normalizeNumberString(s: string): string {
  // "1.000e+5" → "1e+5", "0.5000" → "0.5"
  const [mant, exp] = s.split('e');
  const m = mant.includes('.') ? mant.replace(/0+$/, '').replace(/\.$/, '') : mant;
  return exp !== undefined ? `${m}e${exp}` : m;
}

/** Bit string split into sign / exponent / fraction. */
export function bitFields(bits: bigint, kind: FloatKind): { sign: string; exponent: string; fraction: string } {
  const f = fmt(kind);
  const s = bits.toString(2).padStart(f.bits, '0');
  return { sign: s.slice(0, 1), exponent: s.slice(1, 1 + f.expBits), fraction: s.slice(1 + f.expBits) };
}

/**
 * Scientific notation of an exact decimal, rounded half-up to `sig` significant digits:
 * {n: 1490116119384765625n, e: -27} → "1.490116e-9". Works far outside the double range.
 */
export function decToSci(d: Dec, sig = 7): string {
  if (d.n === 0n) return d.neg ? '-0' : '0';
  let digits = d.n.toString();
  let exp = digits.length - 1 + d.e;
  if (digits.length > sig) {
    const cut = digits.length - sig;
    const p = 10n ** BigInt(cut);
    let q = d.n / p;
    if ((d.n % p) * 2n >= p) q += 1n;
    digits = q.toString();
    if (digits.length > sig) {
      digits = digits.slice(0, sig);
      exp += 1;
    }
  }
  digits = digits.replace(/0+$/, '') || '0';
  const mant = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
  return `${d.neg ? '-' : ''}${mant}e${exp}`;
}

/** a / b in scientific notation (approximate, any magnitude). Null when b is zero. */
export function decRatioSci(a: Dec, b: Dec, sig = 4): string | null {
  if (b.n === 0n) return null;
  if (a.n === 0n) return '0';
  // Scale numerators to ~20 digits each, then divide as numbers.
  const norm = (d: Dec): [number, number] => {
    const s = d.n.toString();
    const head = Number(`0.${s.slice(0, 20)}`); // in [0.1, 1)
    return [head, s.length + d.e];
  };
  const [am, ae] = norm(a);
  const [bm, be] = norm(b);
  let m = am / bm;
  let e = ae - be;
  while (m >= 10) {
    m /= 10;
    e += 1;
  }
  while (m < 1) {
    m *= 10;
    e -= 1;
  }
  const neg = a.neg !== b.neg;
  let ms = m.toPrecision(sig);
  if (ms.startsWith('10')) {
    ms = (m / 10).toPrecision(sig);
    e += 1;
  }
  return `${neg ? '-' : ''}${ms.replace(/\.?0+$/, '')}e${e}`;
}
