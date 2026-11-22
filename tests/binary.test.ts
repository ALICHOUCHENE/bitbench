import { describe, expect, it } from 'vitest';
import {
  bitLayout,
  clz,
  cLiteral,
  ctz,
  fieldMask,
  fieldValue,
  formatBin,
  formatDec,
  formatHex,
  formatOct,
  groupDigits,
  maskCode,
  maskSuffix,
  not,
  parseBitRange,
  parseFieldLabels,
  parseInteger,
  parseOperand,
  parseValue,
  popcount,
  rangeOf,
  rotl,
  rotr,
  shl,
  shrArithmetic,
  shrLogical,
  toBits,
  toSigned,
  and,
  or,
  xor,
  type Width,
} from '../src/lib/binary';

const ok = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const err = (r: { ok: boolean; error?: string }): string => {
  if (r.ok) throw new Error('expected an error');
  return r.error!;
};

describe('two’s complement ranges', () => {
  const cases: [Width, bigint, bigint, bigint][] = [
    [8, -128n, 127n, 255n],
    [16, -32768n, 32767n, 65535n],
    [32, -2147483648n, 2147483647n, 4294967295n],
    [64, -9223372036854775808n, 9223372036854775807n, 18446744073709551615n],
  ];
  for (const [w, smin, smax, umax] of cases) {
    it(`${w} bits`, () => {
      expect(rangeOf(w, true)).toEqual({ min: smin, max: smax });
      expect(rangeOf(w, false)).toEqual({ min: 0n, max: umax });
      // −1 is all ones
      expect(toBits(-1n, w)).toBe(umax);
      expect(toSigned(umax, w)).toBe(-1n);
      // min is the sign bit alone
      expect(toBits(smin, w)).toBe(1n << BigInt(w - 1));
      expect(toSigned(1n << BigInt(w - 1), w)).toBe(smin);
      expect(toSigned(smax, w)).toBe(smax);
      // overflow wraps
      expect(toSigned(smax + 1n, w)).toBe(smin);
      expect(toBits(umax + 1n, w)).toBe(0n);
      // decimal input at the limits
      expect(ok(parseValue(String(smin), 'dec', w, true))).toBe(1n << BigInt(w - 1));
      expect(ok(parseValue(String(smax), 'dec', w, true))).toBe(smax);
      expect(ok(parseValue(String(umax), 'dec', w, false))).toBe(umax);
      expect(err(parseValue(String(smin - 1n), 'dec', w, true))).toContain(`${w} bits signed`);
      expect(err(parseValue(String(smax + 1n), 'dec', w, true))).toContain(`${w} bits signed`);
      expect(err(parseValue(String(umax + 1n), 'dec', w, false))).toBe(
        `Value doesn't fit in ${w} bits unsigned (0 … ${umax}).`,
      );
      expect(err(parseValue('-1', 'dec', w, false))).toContain('Switch to signed');
      expect(formatDec(umax, w, true)).toBe('-1');
      expect(formatDec(umax, w, false)).toBe(String(umax));
    });
  }

  it('gives the exact message from the spec', () => {
    expect(err(parseValue('70000', 'dec', 16, false))).toBe("Value doesn't fit in 16 bits unsigned (0 … 65535).");
  });

  it('64-bit values are exact', () => {
    expect(formatHex(ok(parseValue('18446744073709551615', 'dec', 64, false)), 64)).toBe('FFFF FFFF FFFF FFFF');
    expect(formatDec(ok(parseValue('0x8000000000000001', 'hex', 64, true)), 64, true)).toBe('-9223372036854775807');
  });
});

describe('parseInteger / parseValue', () => {
  it('accepts prefixes that override the field base', () => {
    expect(ok(parseInteger('0xFF', 'dec')).value).toBe(255n);
    expect(ok(parseInteger('0b1010', 'hex')).value).toBe(10n);
    expect(ok(parseInteger('0o17', 'dec')).value).toBe(15n);
    expect(ok(parseInteger('0XAB', 'dec')).value).toBe(171n);
  });
  it('accepts underscores, spaces, apostrophes and C suffixes', () => {
    expect(ok(parseInteger('1010_0101', 'bin')).value).toBe(0xa5n);
    expect(ok(parseInteger('DEAD BEEF', 'hex')).value).toBe(0xdeadbeefn);
    expect(ok(parseInteger("1'000'000", 'dec')).value).toBe(1000000n);
    expect(ok(parseInteger('0xFFUL', 'dec')).value).toBe(255n);
    expect(ok(parseInteger('42u', 'dec')).value).toBe(42n);
  });
  it('treats leading zeros in decimal as decimal, not C octal', () => {
    expect(ok(parseInteger('010', 'dec')).value).toBe(10n);
  });
  it('reports bad digits specifically', () => {
    expect(err(parseInteger('12G', 'hex'))).toBe('“G” is not a hex digit.');
    expect(err(parseInteger('102', 'bin'))).toBe('“2” is not a binary digit.');
    expect(err(parseInteger('0x', 'dec'))).toContain('after the prefix');
    expect(err(parseInteger('  ', 'dec'))).toBe('Enter a value.');
  });
  it('hex/bin/oct are bit patterns; decimal and signed input are numbers', () => {
    expect(ok(parseValue('FF', 'hex', 8, true))).toBe(255n); // reads as −1
    expect(formatDec(ok(parseValue('FF', 'hex', 8, true)), 8, true)).toBe('-1');
    expect(err(parseValue('1FF', 'hex', 8, false))).toBe("Bit pattern doesn't fit in 8 bits (max 0xFF).");
    expect(ok(parseValue('-0x80', 'hex', 8, true))).toBe(0x80n);
    expect(err(parseValue('255', 'dec', 8, true))).toContain('Switch to unsigned');
  });
  it('operand B accepts the whole signed-to-unsigned span', () => {
    expect(ok(parseOperand('-1', 8))).toBe(255n);
    expect(ok(parseOperand('255', 8))).toBe(255n);
    expect(err(parseOperand('256', 8))).toContain('-128 … 255');
  });
});

describe('formatting', () => {
  it('pads and groups', () => {
    expect(formatHex(0xa5n, 8)).toBe('A5');
    expect(formatHex(0x1234n, 32)).toBe('0000 1234');
    expect(formatBin(0xa5n, 8)).toBe('1010 0101');
    expect(formatBin(5n, 16)).toBe('0000 0000 0000 0101');
    expect(formatOct(8n, 8)).toBe('10');
    expect(groupDigits('12345', 4)).toBe('1 2345');
  });
  it('C literals', () => {
    expect(cLiteral('hex', 0xa5n, 16, false)).toBe('0x00A5');
    expect(cLiteral('bin', 5n, 8, false)).toBe('0b00000101');
    expect(cLiteral('oct', 8n, 8, false)).toBe('010');
    expect(cLiteral('oct', 0n, 8, false)).toBe('0');
    expect(cLiteral('dec', 0xffn, 8, true)).toBe('-1');
  });
});

describe('bitwise operations', () => {
  it('AND / OR / XOR / NOT', () => {
    expect(and(0xf0n, 0x3cn, 8)).toBe(0x30n);
    expect(or(0xf0n, 0x0fn, 8)).toBe(0xffn);
    expect(xor(0xffn, 0x0fn, 8)).toBe(0xf0n);
    expect(not(0n, 8)).toBe(0xffn);
    expect(not(0n, 64)).toBe(0xffffffffffffffffn);
    expect(not(0x0fn, 16)).toBe(0xfff0n);
  });
  it('shift left drops bits beyond the width', () => {
    expect(shl(0x81n, 1, 8)).toBe(0x02n);
    expect(shl(1n, 31, 32)).toBe(0x80000000n);
    expect(shl(1n, 32, 32)).toBe(0n);
    expect(shl(1n, 63, 64)).toBe(1n << 63n);
  });
  it('logical vs arithmetic shift of a negative value', () => {
    // −16 at 8 bits = 0xF0
    expect(shrLogical(0xf0n, 2, 8)).toBe(0x3cn);
    expect(shrArithmetic(0xf0n, 2, 8)).toBe(0xfcn); // −4
    expect(toSigned(shrArithmetic(0xf0n, 2, 8), 8)).toBe(-4n);
    // positive values: both the same
    expect(shrArithmetic(0x70n, 4, 8)).toBe(shrLogical(0x70n, 4, 8));
    // shifting by ≥ width
    expect(shrLogical(0x80000000n, 32, 32)).toBe(0n);
    expect(shrArithmetic(0x80000000n, 32, 32)).toBe(0xffffffffn);
    expect(shrArithmetic(0x7fffffffn, 40, 32)).toBe(0n);
    expect(shrArithmetic(1n << 63n, 63, 64)).toBe(0xffffffffffffffffn);
  });
  it('rotate', () => {
    expect(rotl(0x81n, 1, 8)).toBe(0x03n);
    expect(rotr(0x81n, 1, 8)).toBe(0xc0n);
    expect(rotl(0x12345678n, 8, 32)).toBe(0x34567812n);
    expect(rotr(0x12345678n, 8, 32)).toBe(0x78123456n);
    expect(rotl(0x8000000000000001n, 4, 64)).toBe(0x18n);
  });
  it('rotate by 0 and by the width is the identity', () => {
    for (const w of [8, 16, 32, 64] as Width[]) {
      const v = toBits(0xa5c3_0f1e_9b7d_2468n, w);
      expect(rotl(v, 0, w)).toBe(v);
      expect(rotr(v, 0, w)).toBe(v);
      expect(rotl(v, w, w)).toBe(v);
      expect(rotr(v, w, w)).toBe(v);
      expect(rotl(v, w + 3, w)).toBe(rotl(v, 3, w));
    }
  });
  it('popcount, clz, ctz', () => {
    expect(popcount(0xa5n)).toBe(4);
    expect(popcount(0xffffffffffffffffn)).toBe(64);
    expect(clz(1n, 32)).toBe(31);
    expect(clz(0n, 16)).toBe(16);
    expect(ctz(0x80n, 8)).toBe(7);
    expect(ctz(0n, 8)).toBe(8);
  });
});

describe('parseFieldLabels', () => {
  it('parses the canonical form, highest field first', () => {
    const r = parseFieldLabels('[2:0] DIV, [7:4] MODE, [3] EN', 8);
    expect(r.errors).toEqual([]);
    expect(r.fields).toEqual([
      { name: 'MODE', hi: 7, lo: 4 },
      { name: 'EN', hi: 3, lo: 3 },
      { name: 'DIV', hi: 2, lo: 0 },
    ]);
  });
  it('accepts alternative notations', () => {
    const r = parseFieldLabels('MODE[7:4]; 3 EN\nbits 2..1 = DIV\n[0:0] LOCK, RX_EN = [9], 15-12 PRESC, [11:10]', 16);
    expect(r.errors).toEqual([]);
    expect(r.fields).toEqual([
      { name: 'PRESC', hi: 15, lo: 12 },
      { name: '', hi: 11, lo: 10 },
      { name: 'RX_EN', hi: 9, lo: 9 },
      { name: 'MODE', hi: 7, lo: 4 },
      { name: 'EN', hi: 3, lo: 3 },
      { name: 'DIV', hi: 2, lo: 1 },
      { name: 'LOCK', hi: 0, lo: 0 },
    ]);
  });
  it('normalises reversed ranges', () => {
    expect(parseFieldLabels('[4:7] MODE', 8).fields).toEqual([{ name: 'MODE', hi: 7, lo: 4 }]);
  });
  it('reports out-of-range fields', () => {
    const r = parseFieldLabels('[9:4] MODE, [3] EN', 8);
    expect(r.errors).toEqual(['MODE [9:4] is outside the 8-bit value (bits 7…0).']);
    expect(r.fields).toEqual([{ name: 'EN', hi: 3, lo: 3 }]);
  });
  it('reports overlaps and keeps the first field', () => {
    const r = parseFieldLabels('[7:4] MODE, [4] EN', 8);
    expect(r.errors).toEqual(['EN [4] overlaps MODE [7:4].']);
    expect(r.fields).toHaveLength(1);
  });
  it('reports unreadable items', () => {
    const r = parseFieldLabels('MODE, [3] EN', 8);
    expect(r.errors[0]).toContain('Couldn’t read “MODE”'.replace('’', "'"));
    expect(r.fields).toEqual([{ name: 'EN', hi: 3, lo: 3 }]);
  });
  it('ignores empty input and stray separators', () => {
    expect(parseFieldLabels(' , ;\n', 8)).toEqual({ fields: [], errors: [] });
  });
  it('field values', () => {
    expect(fieldValue(0xa5n, { hi: 7, lo: 4 })).toBe(0xan);
    expect(fieldValue(0xa5n, { hi: 2, lo: 0 })).toBe(5n);
    expect(fieldMask(7, 4)).toBe(0xf0n);
    expect(fieldMask(63, 0)).toBe(0xffffffffffffffffn);
  });
});

describe('bitLayout', () => {
  it('rows of 16, MSB first, with gap tracks', () => {
    const rows = bitLayout(32, 16, [{ name: 'X', hi: 19, lo: 12 }]);
    expect(rows).toHaveLength(2);
    expect(rows[0].hi).toBe(31);
    expect(rows[1].lo).toBe(0);
    expect(rows[0].cells[0]).toEqual({ bit: 31, col: 1 });
    expect(rows[0].cells[4]).toEqual({ bit: 27, col: 6 }); // after a nibble gap track
    expect(rows[0].template.split(' ')).toHaveLength(19);
    // field split across rows
    expect(rows[0].labels[0]).toMatchObject({ contLeft: false, contRight: true });
    expect(rows[1].labels[0]).toMatchObject({ contLeft: true, contRight: false });
  });
  it('8-bit width gives a single row', () => {
    const rows = bitLayout(8, 16);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells).toHaveLength(8);
    expect(rows[0].nibbles).toHaveLength(2);
  });
});

describe('mask generation', () => {
  it('suffix follows the register width', () => {
    expect(maskSuffix(8)).toBe('U');
    expect(maskSuffix(32)).toBe('U');
    expect(maskSuffix(32, true)).toBe('UL');
    expect(maskSuffix(64)).toBe('ULL');
  });
  it('single bit', () => {
    const code = maskCode({ hi: 5, lo: 5, regWidth: 32 });
    expect(code).toContain('reg |=  (1U << 5);');
    expect(code).toContain('reg &= ~(1U << 5);');
    expect(code).toContain('reg ^=  (1U << 5);');
    expect(code).toContain('if ((reg >> 5) & 1U) { }');
    expect(code).toContain('0x00000020');
  });
  it('64-bit registers use ULL', () => {
    expect(maskCode({ hi: 40, lo: 40, regWidth: 64 })).toContain('reg |=  (1ULL << 40);');
  });
  it('field mask, extract and insert', () => {
    const code = maskCode({ hi: 7, lo: 4, regWidth: 32, name: 'MODE', reg: 'CR1' });
    expect(code).toContain('mask = ((1U << 4) - 1U) << 4;');
    expect(code).toContain('#define MODE_Msk  (0xFU << MODE_Pos)');
    expect(code).toContain('val  = (CR1 >> 4) & 0xFU;');
    expect(code).toContain('CR1 = (CR1 & ~MODE_Msk) | ((val << MODE_Pos) & MODE_Msk);');
  });
  it('avoids the undefined (1U << 32) for a full-width field', () => {
    const code = maskCode({ hi: 31, lo: 0, regWidth: 32 });
    expect(code).not.toContain('1U << 32');
    expect(code).toContain('mask = 0xFFFFFFFFU << 0;');
  });
  it('parseBitRange', () => {
    expect(ok(parseBitRange('5', 8))).toEqual({ hi: 5, lo: 5 });
    expect(ok(parseBitRange('[4:7]', 8))).toEqual({ hi: 7, lo: 4 });
    expect(err(parseBitRange('8', 8))).toContain('outside');
    expect(err(parseBitRange('x', 8))).toContain('Enter a bit number');
  });
});
