import { describe, expect, it } from 'vitest';
import { decToString } from '../src/lib/float754';
import {
  COMMON_FORMATS,
  armName,
  formatInfo,
  fromPattern,
  generateC,
  parseRaw,
  parseReal,
  patternBinary,
  patternHex,
  qName,
  rawRange,
  rawToReal,
  realToFixed,
  roundRational,
  toPattern,
  validateFormat,
  wordBits,
  type QFormat,
  type RoundMode,
} from '../src/lib/fixed-point';

const Q15: QFormat = { m: 0, n: 15, signed: true };
const Q31: QFormat = { m: 0, n: 31, signed: true };
const Q7: QFormat = { m: 0, n: 7, signed: true };
const Q15_16: QFormat = { m: 15, n: 16, signed: true }; // ARM "Q16.16"
const UQ16_16: QFormat = { m: 16, n: 16, signed: false };
const UQ8_8: QFormat = { m: 8, n: 8, signed: false };
const Q1_14: QFormat = { m: 1, n: 14, signed: true };

function conv(x: string, f: QFormat, mode: RoundMode = 'nearest', sat = true) {
  const d = parseReal(x);
  if (!d) throw new Error(`bad input ${x}`);
  return realToFixed(d, f, mode, sat);
}

describe('format basics', () => {
  it('word sizes follow the TI convention (sign bit not counted in m)', () => {
    expect(wordBits(Q15)).toBe(16);
    expect(wordBits(Q31)).toBe(32);
    expect(wordBits(Q7)).toBe(8);
    expect(wordBits(Q1_14)).toBe(16);
    expect(wordBits(Q15_16)).toBe(32);
    expect(wordBits(UQ16_16)).toBe(32);
    expect(wordBits(UQ8_8)).toBe(16);
  });

  it('names in TI and ARM notation', () => {
    expect(qName(Q15)).toBe('Q15');
    expect(armName(Q15)).toBe('Q1.15');
    expect(qName(Q15_16)).toBe('Q15.16');
    expect(armName(Q15_16)).toBe('Q16.16');
    expect(qName(UQ8_8)).toBe('UQ8.8');
  });

  it('range and resolution', () => {
    expect(formatInfo(Q15)).toEqual({ min: '-1', max: '0.999969482421875', resolution: '0.000030517578125', word: 16 });
    expect(formatInfo(Q7)).toEqual({ min: '-1', max: '0.9921875', resolution: '0.0078125', word: 8 });
    expect(formatInfo(Q1_14).min).toBe('-2');
    expect(formatInfo(Q1_14).max).toBe('1.99993896484375');
    expect(formatInfo(Q15_16)).toMatchObject({ min: '-32768', max: '32767.9999847412109375', resolution: '0.0000152587890625' });
    expect(formatInfo(UQ16_16)).toMatchObject({ min: '0', max: '65535.9999847412109375' });
    expect(formatInfo(UQ8_8)).toMatchObject({ min: '0', max: '255.99609375', resolution: '0.00390625' });
    expect(rawRange(Q31)).toEqual({ min: -2147483648n, max: 2147483647n });
  });

  it('validates', () => {
    expect(validateFormat(Q15)).toBeNull();
    expect(validateFormat({ m: 40, n: 30, signed: true })).toMatch(/71 bits/);
    expect(validateFormat({ m: 0, n: 0, signed: false })).toMatch(/at least one bit/);
    expect(validateFormat({ m: -1, n: 3, signed: true })).not.toBeNull();
    expect(validateFormat({ m: 31, n: 32, signed: true })).toBeNull();
  });

  it('common formats are all valid', () => {
    for (const f of COMMON_FORMATS) expect(validateFormat(f), f.id).toBeNull();
  });
});

describe('real → fixed (Q15)', () => {
  it('0.5 → 0x4000', () => {
    const r = conv('0.5', Q15);
    expect(r.raw).toBe(16384n);
    expect(patternHex(r.raw, Q15)).toBe('0x4000');
    expect(r.status).toBe('ok');
    expect(decToString(r.error)).toBe('0');
  });

  it('−1 → 0x8000', () => {
    const r = conv('-1', Q15);
    expect(r.raw).toBe(-32768n);
    expect(patternHex(r.raw, Q15)).toBe('0x8000');
    expect(r.status).toBe('ok');
  });

  it('1.0 saturates to 0x7FFF', () => {
    const r = conv('1.0', Q15);
    expect(r.raw).toBe(32767n);
    expect(patternHex(r.raw, Q15)).toBe('0x7FFF');
    expect(r.status).toBe('saturated-high');
    expect(r.unclamped).toBe(32768n);
    expect(decToString(r.error)).toBe('-0.000030517578125');
  });

  it('1.0 without saturation wraps to −1 (0x8000), like a C cast', () => {
    const r = conv('1.0', Q15, 'nearest', false);
    expect(r.raw).toBe(-32768n);
    expect(r.status).toBe('wrapped');
  });

  it('−1.5 saturates low', () => {
    const r = conv('-1.5', Q15);
    expect(r.raw).toBe(-32768n);
    expect(r.status).toBe('saturated-low');
  });

  it('quantization error of 0.1 is exact', () => {
    const r = conv('0.1', Q15);
    expect(r.raw).toBe(3277n); // 0.1 · 32768 = 3276.8
    expect(decToString(r.value)).toBe('0.100006103515625');
    expect(decToString(r.error)).toBe('0.000006103515625');
  });

  it('Q31 and Q7 known values', () => {
    expect(patternHex(conv('0.5', Q31).raw, Q31)).toBe('0x40000000');
    expect(patternHex(conv('-0.25', Q31).raw, Q31)).toBe('0xE0000000');
    expect(patternHex(conv('0.9999999999', Q31).raw, Q31)).toBe('0x7FFFFFFF');
    expect(patternHex(conv('-0.5', Q7).raw, Q7)).toBe('0xC0');
  });
});

describe('rounding modes on negative values', () => {
  // −0.3 · 32768 = −9830.4 ; −0.300006103515625 · 32768 = −9830.6 ; −0.3000030517578125 → −9830.5 (tie)
  const cases: [string, RoundMode, bigint][] = [
    ['-0.3', 'nearest', -9830n],
    ['-0.3', 'nearest-even', -9830n],
    ['-0.3', 'floor', -9831n],
    ['-0.3', 'zero', -9830n],
    ['-0.3', 'ceil', -9830n],
    ['-0.300006103515625', 'nearest', -9831n], // −9830.6
    ['-0.300006103515625', 'floor', -9831n],
    ['-0.300006103515625', 'zero', -9830n],
    ['-0.3000030517578125', 'nearest', -9831n], // −9830.5 tie → away from zero
    ['-0.3000030517578125', 'nearest-even', -9830n], // tie → even
    ['-0.2999725341796875', 'nearest-even', -9830n], // −9829.5 tie → even (−9830)
    ['-0.2999725341796875', 'nearest', -9830n],
  ];
  it.each(cases)('%s with %s', (x, mode, raw) => {
    expect(conv(x, Q15, mode).raw).toBe(raw);
  });

  it('positive values', () => {
    expect(conv('0.3', Q15, 'floor').raw).toBe(9830n);
    expect(conv('0.3', Q15, 'ceil').raw).toBe(9831n);
    expect(conv('0.3000030517578125', Q15, 'nearest').raw).toBe(9831n);
    expect(conv('0.3000030517578125', Q15, 'nearest-even').raw).toBe(9830n);
  });

  it('roundRational directly', () => {
    expect(roundRational(-7n, 2n, 'floor')).toBe(-4n);
    expect(roundRational(-7n, 2n, 'zero')).toBe(-3n);
    expect(roundRational(-7n, 2n, 'nearest')).toBe(-4n);
    expect(roundRational(-7n, 2n, 'nearest-even')).toBe(-4n);
    expect(roundRational(-5n, 2n, 'nearest-even')).toBe(-2n);
    expect(roundRational(-5n, 2n, 'ceil')).toBe(-2n);
    expect(roundRational(6n, 3n, 'ceil')).toBe(2n);
  });
});

describe('Q16.16-style 32-bit formats', () => {
  it('signed Q15.16 (ARM Q16.16, fix16_t)', () => {
    expect(patternHex(conv('1', Q15_16).raw, Q15_16)).toBe('0x00010000');
    expect(patternHex(conv('-1', Q15_16).raw, Q15_16)).toBe('0xFFFF0000');
    expect(patternHex(conv('3.14159265', Q15_16).raw, Q15_16)).toBe('0x0003243F'); // fix16_pi = 205887
    expect(conv('3.14159265', Q15_16).raw).toBe(205887n);
    expect(conv('32768', Q15_16).status).toBe('saturated-high');
    expect(patternHex(conv('-32768', Q15_16).raw, Q15_16)).toBe('0x80000000');
    expect(patternHex(conv('100.5', Q15_16).raw, Q15_16)).toBe('0x00648000');
  });

  it('unsigned UQ16.16', () => {
    expect(patternHex(conv('65535.5', UQ16_16).raw, UQ16_16)).toBe('0xFFFF8000');
    expect(conv('-0.1', UQ16_16).raw).toBe(0n);
    expect(conv('-0.1', UQ16_16).status).toBe('saturated-low');
    expect(conv('70000', UQ16_16).raw).toBe(0xffffffffn);
  });
});

describe('unsigned formats', () => {
  it('UQ8.8', () => {
    expect(patternHex(conv('1.5', UQ8_8).raw, UQ8_8)).toBe('0x0180');
    expect(patternHex(conv('255.99609375', UQ8_8).raw, UQ8_8)).toBe('0xFFFF');
    expect(conv('256', UQ8_8).status).toBe('saturated-high');
    const w = conv('256.5', UQ8_8, 'nearest', false);
    expect(w.status).toBe('wrapped');
    expect(w.raw).toBe(0x80n);
  });
});

describe('fixed → real', () => {
  it('decimal integers', () => {
    expect(rawToReal(16384n, Q15)).toBe('0.5');
    expect(rawToReal(-32768n, Q15)).toBe('-1');
    expect(rawToReal(32767n, Q15)).toBe('0.999969482421875');
  });

  it('parses dec, hex and binary input and sign-extends hex for signed formats', () => {
    expect(parseRaw('0x8000', Q15)).toEqual({ ok: true, raw: -32768n, form: 'hex' });
    expect(parseRaw('0xC000', Q15)).toEqual({ ok: true, raw: -16384n, form: 'hex' });
    expect(parseRaw('0x8000', UQ8_8)).toEqual({ ok: true, raw: 32768n, form: 'hex' });
    expect(parseRaw('-16384', Q15)).toEqual({ ok: true, raw: -16384n, form: 'dec' });
    expect(parseRaw('0b0100000000000000', Q15)).toEqual({ ok: true, raw: 16384n, form: 'bin' });
    expect(parseRaw('0xFFFF0000', Q15_16)).toEqual({ ok: true, raw: -65536n, form: 'hex' });
    expect(rawToReal(-65536n, Q15_16)).toBe('-1');
  });

  it('rejects out-of-range and malformed input with a reason', () => {
    const big = parseRaw('40000', Q15);
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.error).toMatch(/-32768 and 32767/);
    expect(parseRaw('0x10000', Q15).ok).toBe(false);
    expect(parseRaw('-1', UQ8_8).ok).toBe(false);
    expect(parseRaw('1.5', Q15).ok).toBe(false);
    expect(parseRaw('', Q15).ok).toBe(false);
  });

  it('patterns round-trip', () => {
    for (const raw of [-32768n, -1n, 0n, 1n, 32767n]) expect(fromPattern(toPattern(raw, Q15), Q15)).toBe(raw);
    expect(toPattern(-1n, Q15)).toBe(0xffffn);
    expect(patternBinary(-16384n, Q1_14)).toEqual({ sign: '1', int: '1', frac: '00000000000000' });
  });
});

describe('64-bit words', () => {
  it('Q31.32 is exact with BigInt', () => {
    const f: QFormat = { m: 31, n: 32, signed: true };
    const r = conv('1234567.0000000001', f);
    expect(patternHex(r.raw, f)).toBe('0x0012D68700000000');
    expect(formatInfo(f).min).toBe('-2147483648');
    expect(conv('-2147483648', f).raw).toBe(-(1n << 63n));
  });
});

describe('generateC', () => {
  it('Q15 helpers', () => {
    const c = generateC(Q15, 'nearest');
    expect(c).toContain('#define FLOAT_TO_Q15(x) ((int16_t)roundf((x) * 32768.0f))');
    expect(c).toContain('#define Q15_MAX 32767');
    expect(c).toContain('#define Q15_MIN (-32768)');
    expect(c).toContain('static inline int16_t q15_from_float(float x)');
    expect(c).toContain('if (r >= 32768.0f) return Q15_MAX;');
    expect(c).toContain('int32_t p = (int32_t)a * b;');
  });

  it('uses double and the right rounding function for 32-bit words', () => {
    const c = generateC(Q31, 'floor');
    expect(c).toContain('double r = floor(x * 2147483648.0);');
    expect(c).toContain('#define Q31_MIN (-2147483647 - 1)');
    expect(c).toContain('int64_t p');
    const u = generateC(UQ16_16, 'zero');
    expect(u).toContain('uint32_t');
    expect(u).toContain('trunc(');
    expect(u).toContain('#define UQ16_16_MAX 4294967295u');
    expect(u).not.toContain('if (p < UQ16_16_MIN)');
  });

  it('64-bit words use INT64_C and skip the multiply', () => {
    const c = generateC({ m: 31, n: 32, signed: true }, 'nearest-even');
    expect(c).toContain('int64_t');
    expect(c).toContain('INT64_C(');
    expect(c).toContain('rint(');
    expect(c).not.toContain('_mul(');
  });
});
