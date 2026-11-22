import { describe, expect, it } from 'vitest';
import {
  bitFields,
  bitsFromNumber,
  bitsMaxFinite,
  bitsToBytes,
  decToString,
  decToSci,
  decRatioSci,
  decodeBits,
  encodeDecimal,
  exactDecimal,
  hexBits,
  nextDown,
  nextUp,
  numberFromBits,
  parseDecimal,
  parseHexBits,
  pow2String,
  quietNaN,
  roundingError,
  shortestDecimal,
  ulpExp2,
  type FloatKind,
} from '../src/lib/float754';

const enc = (s: string, k: FloatKind) => encodeDecimal(s, k)!.bits;

describe('decimal → bits', () => {
  // Reference bit patterns: IEEE 754-2019 layout, values cross-checked with DataView below.
  const cases: [string, FloatKind, bigint][] = [
    ['1.0', 32, 0x3f800000n],
    ['-2.0', 32, 0xc0000000n],
    ['0.1', 32, 0x3dcccccdn],
    ['3.14159265358979323846', 32, 0x40490fdbn],
    ['1.0', 64, 0x3ff0000000000000n],
    ['-2', 64, 0xc000000000000000n],
    ['0.1', 64, 0x3fb999999999999an],
    ['3.14159265358979323846', 64, 0x400921fb54442d18n],
    ['0', 32, 0x00000000n],
    ['-0', 32, 0x80000000n],
    ['-0.0', 64, 0x8000000000000000n],
    ['inf', 32, 0x7f800000n],
    ['-Infinity', 64, 0xfff0000000000000n],
    ['NaN', 32, 0x7fc00000n],
    ['nan', 64, 0x7ff8000000000000n],
    ['1.401298464324817e-45', 32, 0x00000001n],
    ['4.9406564584124654e-324', 64, 0x0000000000000001n],
    ['3.4028234663852886e38', 32, 0x7f7fffffn],
    ['1.7976931348623157e308', 64, 0x7fefffffffffffffn],
    ['1.1754943508222875e-38', 32, 0x00800000n],
    ['2.2250738585072014e-308', 64, 0x0010000000000000n],
    ['65504', 32, 0x477fe000n],
    ['16777217', 32, 0x4b800000n], // tie → even (16777216)
    ['16777219', 32, 0x4b800002n], // tie → even (16777220)
  ];
  it.each(cases)('%s as float%i', (s, k, bits) => {
    expect(enc(s, k)).toBe(bits);
  });

  it('agrees with DataView for many doubles (float64) and Math.fround (float32 of exact doubles)', () => {
    const vals = [1 / 3, 2 / 3, 1e-310, 5e-324, 123456.789, -9.87654321e-20, 6.02214076e23, 1e22, 1e23, 0.3, Math.PI, Math.E];
    for (const v of vals) {
      expect(enc(v.toPrecision(17), 64)).toBe(bitsFromNumber(v, 64));
      expect(enc(String(v), 64)).toBe(bitsFromNumber(v, 64));
    }
    // For float32, compare from the exact double expansion (single rounding on both sides).
    for (const v of [0.1, 1 / 3, 1e-40, 3.3e38, 7.1, -1234.5678]) {
      const exact = exactDecimal(bitsFromNumber(v, 64), 64);
      expect(enc(exact, 32)).toBe(bitsFromNumber(v, 32));
    }
  });

  it('rounds once (no double rounding through float64)', () => {
    // 1 + 2^-24 + 2^-60: just above the float32 halfway point between 1 and 1+2^-23.
    // Via double it becomes exactly 1 + 2^-24 (a tie) and rounds to 1.0f; the correct result is 1+2^-23.
    const s = '1.000000059604644776154763517770031103400886058807373046875';
    expect(enc(s, 32)).toBe(0x3f800001n);
    expect(bitsFromNumber(Number(s), 32)).toBe(0x3f800000n); // the double-rounding trap
  });

  it('overflows to infinity and underflows to zero with a status', () => {
    expect(encodeDecimal('3.5e38', 32)).toMatchObject({ bits: 0x7f800000n, status: 'overflow' });
    expect(encodeDecimal('-1e400', 64)).toMatchObject({ bits: 0xfff0000000000000n, status: 'overflow' });
    expect(encodeDecimal('1e-50', 32)).toMatchObject({ bits: 0n, status: 'underflow' });
    expect(encodeDecimal('-1e-400', 64)).toMatchObject({ bits: 0x8000000000000000n, status: 'underflow' });
    // Max finite + half an ULP is a tie with an odd significand → rounds up to infinity.
    expect(encodeDecimal('340282356779733661637539395458142568448', 32)!.status).toBe('overflow');
    expect(encodeDecimal('340282356779733661637539395458142568447', 32)!.bits).toBe(0x7f7fffffn);
    // Half the smallest subnormal ties to even (zero); a hair above rounds up.
    expect(enc('7.006492321624085354618647916449580656401309709382578858785341419448955413429303e-46', 32)).toBe(0n);
    expect(enc('7.0065e-46', 32)).toBe(1n);
  });

  it('reports exact vs inexact', () => {
    expect(encodeDecimal('0.5', 32)!.status).toBe('exact');
    expect(encodeDecimal('0.1', 32)!.status).toBe('inexact');
  });

  it('parses common decimal spellings and rejects junk', () => {
    expect(parseDecimal('.5')).toEqual({ kind: 'finite', dec: { neg: false, n: 5n, e: -1 } });
    expect(parseDecimal('1_000')).toEqual({ kind: 'finite', dec: { neg: false, n: 1000n, e: 0 } });
    expect(parseDecimal('2.5f')).toEqual({ kind: 'finite', dec: { neg: false, n: 25n, e: -1 } });
    expect(parseDecimal('1e')).toBeNull();
    expect(parseDecimal('abc')).toBeNull();
    expect(parseDecimal('.')).toBeNull();
    expect(parseDecimal('')).toBeNull();
  });
});

describe('bits → value', () => {
  it('exact decimal expansion of 0.1f', () => {
    expect(exactDecimal(0x3dcccccdn, 32)).toBe('0.100000001490116119384765625');
  });

  it('exact decimal expansion of 0.1 (double)', () => {
    expect(exactDecimal(0x3fb999999999999an, 64)).toBe('0.1000000000000000055511151231257827021181583404541015625');
  });

  it('exact expansions of extremes', () => {
    expect(exactDecimal(0x7f7fffffn, 32)).toBe('340282346638528859811704183484516925440');
    expect(exactDecimal(1n, 32)).toBe(
      '0.000000000000000000000000000000000000000000001401298464324817070923729583289916131280261941876515771757068283889791082685860601486638188362121582031250'.replace(/0+$/, ''),
    );
    expect(exactDecimal(0x40490fdbn, 32)).toBe('3.1415927410125732421875');
    expect(exactDecimal(1n, 64).startsWith('0.000')).toBe(true);
    expect(exactDecimal(1n, 64).endsWith('625')).toBe(true);
    expect(exactDecimal(0x80000000n, 32)).toBe('-0');
    expect(exactDecimal(0x7f800000n, 32)).toBe('Infinity');
    expect(exactDecimal(0xfff0000000000000n, 64)).toBe('-Infinity');
  });

  it('classifies values and splits fields', () => {
    expect(decodeBits(0x3f800000n, 32)).toMatchObject({ sign: 0, biasedExp: 127, unbiasedExp: 0, fraction: 0n, cls: 'normal', value: 1 });
    expect(decodeBits(0xc0000000n, 32)).toMatchObject({ sign: 1, biasedExp: 128, unbiasedExp: 1, cls: 'normal', value: -2 });
    expect(decodeBits(0x00000001n, 32)).toMatchObject({ cls: 'subnormal', biasedExp: 0, unbiasedExp: -126 });
    expect(decodeBits(0x0000000000000001n, 64)).toMatchObject({ cls: 'subnormal', value: 5e-324 });
    expect(decodeBits(0n, 32).cls).toBe('zero');
    const nz = decodeBits(0x8000000000000000n, 64);
    expect(nz.cls).toBe('zero');
    expect(Object.is(nz.value, -0)).toBe(true);
    expect(decodeBits(0x7f800000n, 32)).toMatchObject({ cls: 'infinity', sign: 0, unbiasedExp: null });
    expect(decodeBits(0xff800000n, 32)).toMatchObject({ cls: 'infinity', sign: 1 });
    expect(decodeBits(0x7f7fffffn, 32).value).toBe(3.4028234663852886e38);
    expect(decodeBits(0x7fefffffffffffffn, 64).value).toBe(Number.MAX_VALUE);
  });

  it('distinguishes quiet and signalling NaNs and reports the payload', () => {
    expect(decodeBits(0x7fc00000n, 32)).toMatchObject({ cls: 'nan', quiet: true, payload: 0n });
    expect(decodeBits(0x7fc00001n, 32)).toMatchObject({ cls: 'nan', quiet: true, payload: 1n });
    expect(decodeBits(0x7f800001n, 32)).toMatchObject({ cls: 'nan', quiet: false, payload: 1n });
    expect(decodeBits(0xffc00000n, 32)).toMatchObject({ cls: 'nan', quiet: true, sign: 1 });
    expect(decodeBits(0x7ff0000000000001n, 64)).toMatchObject({ cls: 'nan', quiet: false, payload: 1n });
    expect(decodeBits(0x7ff8000000000000n, 64)).toMatchObject({ cls: 'nan', quiet: true });
    expect(quietNaN(32)).toBe(0x7fc00000n);
    expect(Number.isNaN(numberFromBits(0x7f800001n, 32))).toBe(true);
  });

  it('bit fields', () => {
    expect(bitFields(0x40490fdbn, 32)).toEqual({ sign: '0', exponent: '10000000', fraction: '10010010000111111011011' });
    const f = bitFields(0xbff0000000000000n, 64);
    expect(f.sign).toBe('1');
    expect(f.exponent).toBe('01111111111');
    expect(f.fraction.length).toBe(52);
  });
});

describe('rounding error', () => {
  it('0.1f − 0.1 = 1.490116119384765625e-9 exactly', () => {
    const p = parseDecimal('0.1')!;
    if (p.kind !== 'finite') throw new Error();
    expect(decToString(roundingError(0x3dcccccdn, 32, p.dec)!)).toBe('0.000000001490116119384765625');
  });

  it('is zero for exactly representable values and negative when rounding down', () => {
    const half = parseDecimal('0.5')!;
    if (half.kind !== 'finite') throw new Error();
    expect(decToString(roundingError(0x3f000000n, 32, half.dec)!)).toBe('0');
    const third = parseDecimal('0.3')!;
    if (third.kind !== 'finite') throw new Error();
    // 0.3f = 0.300000011920928955078125 (above), 0.3 double = 0.299999999999999988897769753748434595763683319091796875 (below)
    expect(decToString(roundingError(enc('0.3', 32), 32, third.dec)!)).toBe('0.000000011920928955078125');
    expect(decToString(roundingError(enc('0.3', 64), 64, third.dec)!)).toBe('-0.000000000000000011102230246251565404236316680908203125');
  });
});

describe('neighbours and ULP', () => {
  it('nextUp / nextDown around 1.0f', () => {
    expect(nextUp(0x3f800000n, 32)).toBe(0x3f800001n);
    expect(nextDown(0x3f800000n, 32)).toBe(0x3f7fffffn);
    expect(nextUp(0xbf800000n, 32)).toBe(0xbf7fffffn);
    expect(nextDown(0xbf800000n, 32)).toBe(0xbf800001n);
  });

  it('crosses zero, reaches infinity, keeps NaN', () => {
    expect(nextUp(0n, 32)).toBe(1n);
    expect(nextUp(0x80000000n, 32)).toBe(1n);
    expect(nextDown(0n, 32)).toBe(0x80000001n);
    expect(nextUp(0x80000001n, 32)).toBe(0x80000000n);
    expect(nextUp(bitsMaxFinite(32), 32)).toBe(0x7f800000n);
    expect(nextUp(0x7f800000n, 32)).toBe(0x7f800000n);
    expect(nextDown(0x7f800000n, 32)).toBe(0x7f7fffffn);
    expect(nextUp(0xfff0000000000000n, 64)).toBe(0xffefffffffffffffn);
    expect(nextUp(0x7fc00000n, 32)).toBe(0x7fc00000n);
  });

  it('matches Number.EPSILON for 1.0 and FLT_EPSILON for 1.0f', () => {
    expect(ulpExp2(0x3ff0000000000000n, 64)).toBe(-52);
    expect(2 ** ulpExp2(0x3ff0000000000000n, 64)!).toBe(Number.EPSILON);
    expect(ulpExp2(0x3f800000n, 32)).toBe(-23);
    expect(ulpExp2(1n, 32)).toBe(-149);
    expect(ulpExp2(0n, 64)).toBe(-1074);
    expect(ulpExp2(0x7f800000n, 32)).toBeNull();
    expect(pow2String(-3)).toBe('0.125');
    expect(pow2String(10)).toBe('1024');
  });
});

describe('hex input and byte order', () => {
  it('parses big-endian and little-endian forms', () => {
    expect(parseHexBits('0x40490FDB', 32, 'be')).toEqual({ ok: true, bits: 0x40490fdbn });
    expect(parseHexBits('4049 0fdb', 32, 'be')).toEqual({ ok: true, bits: 0x40490fdbn });
    expect(parseHexBits('DB 0F 49 40', 32, 'le')).toEqual({ ok: true, bits: 0x40490fdbn });
    expect(parseHexBits('3f8', 32, 'be')).toEqual({ ok: true, bits: 0x3f8n });
    expect(parseHexBits('18 2D 44 54 FB 21 09 40', 64, 'le')).toEqual({ ok: true, bits: 0x400921fb54442d18n });
    expect(parseHexBits('123456789', 32, 'be').ok).toBe(false);
    expect(parseHexBits('DB 0F 49', 32, 'le').ok).toBe(false);
    expect(parseHexBits('zz', 32, 'be').ok).toBe(false);
  });

  it('bytes in memory order', () => {
    expect(bitsToBytes(0x40490fdbn, 32, 'be')).toEqual([0x40, 0x49, 0x0f, 0xdb]);
    expect(bitsToBytes(0x40490fdbn, 32, 'le')).toEqual([0xdb, 0x0f, 0x49, 0x40]);
    // DataView little-endian agrees
    const dv = new DataView(new ArrayBuffer(4));
    dv.setFloat32(0, Math.fround(Math.PI), true);
    expect([...new Uint8Array(dv.buffer)]).toEqual(bitsToBytes(0x40490fdbn, 32, 'le'));
    expect(hexBits(0x1n, 32)).toBe('0x00000001');
  });
});

describe('shortest round-trip decimal', () => {
  it('gives the short form that reproduces the bits', () => {
    expect(shortestDecimal(0x3dcccccdn, 32)).toBe('0.1');
    expect(shortestDecimal(0x40490fdbn, 32)).toBe('3.1415927');
    expect(shortestDecimal(0x7f7fffffn, 32)).toBe('3.4028235e+38');
    expect(shortestDecimal(1n, 32)).toBe('1e-45');
    expect(shortestDecimal(0x3fb999999999999an, 64)).toBe('0.1');
    expect(shortestDecimal(0x80000000n, 32)).toBe('-0');
    for (const b of [0x3f800001n, 0x00800000n, 0x12345678n, 0x4b800001n]) {
      expect(enc(shortestDecimal(b, 32), 32)).toBe(b);
    }
  });
});

describe('scientific formatting of exact decimals', () => {
  it('decToSci rounds and carries', () => {
    expect(decToSci({ neg: false, n: 1490116119384765625n, e: -27 })).toBe('1.490116e-9');
    expect(decToSci({ neg: true, n: 9999999n, e: 0 }, 3)).toBe('-1e7');
    expect(decToSci({ neg: false, n: 5n, e: -400 })).toBe('5e-400');
    expect(decToSci({ neg: false, n: 0n, e: 0 })).toBe('0');
  });
  it('decRatioSci', () => {
    expect(decRatioSci({ neg: false, n: 1490116119384765625n, e: -27 }, { neg: false, n: 1n, e: -1 })).toBe('1.49e-8');
    expect(decRatioSci({ neg: true, n: 1n, e: -500 }, { neg: false, n: 2n, e: 0 })).toBe('-5e-501');
    expect(decRatioSci({ neg: false, n: 1n, e: 0 }, { neg: false, n: 0n, e: 0 })).toBeNull();
  });
});
