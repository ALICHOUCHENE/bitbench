import { describe, expect, it } from 'vitest';
import {
  base64Decode,
  base64Encode,
  byteSwap,
  decodeCEscapes,
  formatHexBytes,
  fromBytes,
  parseCArray,
  parseCInteger,
  parseHexBytes,
  toBytes,
  toCArray,
  type CArrayOptions,
} from '../src/lib/bytes';

const ok = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const bytesOf = (s: string) => ok(parseHexBytes(s)).bytes;
const DEADBEEF = [0xde, 0xad, 0xbe, 0xef];

describe('byte order', () => {
  it('swaps 16, 32 and 64-bit values', () => {
    expect(byteSwap(0x1234n, 16)).toBe(0x3412n);
    expect(byteSwap(0x12345678n, 32)).toBe(0x78563412n);
    expect(byteSwap(0x0102030405060708n, 64)).toBe(0x0807060504030201n);
    expect(byteSwap(byteSwap(0xdeadbeefcafef00dn, 64), 64)).toBe(0xdeadbeefcafef00dn);
  });
  it('gives big- and little-endian byte sequences', () => {
    expect(toBytes(0x12345678n, 32, 'big')).toEqual([0x12, 0x34, 0x56, 0x78]);
    expect(toBytes(0x12345678n, 32, 'little')).toEqual([0x78, 0x56, 0x34, 0x12]);
    expect(toBytes(-1n, 16, 'big')).toEqual([0xff, 0xff]);
    expect(fromBytes([0x78, 0x56, 0x34, 0x12], 'little')).toBe(0x12345678n);
  });
});

describe('parseHexBytes', () => {
  it.each([
    'DE AD BE EF',
    'deadbeef',
    '0xDE,0xAD,0xBE,0xEF',
    '0xde, 0xad, 0xbe, 0xef',
    'de:ad:be:ef',
    'DE-AD-BE-EF',
    '\\xde\\xad\\xbe\\xef',
    "b'\\xde\\xad\\xbe\\xef'",
    '{ 0xDE, 0xAD, 0xBE, 0xEF };',
    'static const uint8_t buf[4] = { 0xDE, 0xAD, 0xBE, 0xEF };',
    'DEAD\nBEEF',
    '  de ad\n\n be ef  ',
  ])('reads %j', (input) => {
    expect(bytesOf(input)).toEqual(DEADBEEF);
  });

  it('pads single digits and 0x values', () => {
    expect(bytesOf('0x1, 0x2, 0xA')).toEqual([1, 2, 10]);
    expect(bytesOf('1 2 3')).toEqual([1, 2, 3]);
    expect(bytesOf('0x123')).toEqual([0x01, 0x23]);
  });

  it('rejects bad input with a specific message', () => {
    const r = parseHexBytes('DE AD XY');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('“XY” is not hex.');
    const odd = parseHexBytes('ABC');
    expect(odd.ok).toBe(false);
    if (!odd.ok) expect(odd.error).toContain('odd number');
  });

  it('empty input is zero bytes', () => {
    expect(ok(parseHexBytes('  \n'))).toEqual({ bytes: [], dump: false });
  });

  const HELLO = [...'Hello, world!\n'].map((c) => c.charCodeAt(0));
  const LONG = [...'The quick brown fox jumps.\n'].map((c) => c.charCodeAt(0));

  it('strips offsets and the ASCII column of hexdump -C', () => {
    const dump = [
      '00000000  54 68 65 20 71 75 69 63  6b 20 62 72 6f 77 6e 20  |The quick brown |',
      '00000010  66 6f 78 20 6a 75 6d 70  73 2e 0a                 |fox jumps..|',
      '0000001b',
    ].join('\n');
    const r = ok(parseHexBytes(dump));
    expect(r.dump).toBe(true);
    expect(r.bytes).toEqual(LONG);
  });

  it('strips offsets and the ASCII column of xxd', () => {
    const dump = [
      '00000000: 5468 6520 7175 6963 6b20 6272 6f77 6e20  The quick brown ',
      '00000010: 666f 7820 6a75 6d70 732e 0a              fox jumps..',
    ].join('\n');
    const r = ok(parseHexBytes(dump));
    expect(r.dump).toBe(true);
    expect(r.bytes).toEqual(LONG);
  });

  it('handles a single-line xxd dump whose ASCII column looks like hex', () => {
    // bytes "cafe" render as the ASCII text "cafe", which is also valid hex
    expect(bytesOf('00000000: 6361 6665  cafe')).toEqual([0x63, 0x61, 0x66, 0x65]);
  });

  it('strips a Wireshark-style dump (offset, bytes, ASCII without delimiters)', () => {
    const dump = [
      '0000   48 65 6c 6c 6f 2c 20 77 6f 72 6c 64 21 0a   Hello, world!.',
    ].join('\n');
    expect(bytesOf(dump)).toEqual(HELLO);
    const two = [
      '0000   48 65 6c 6c 6f 2c 20 77   Hello, w',
      '0008   6f 72 6c 64 21 0a         orld!.',
    ].join('\n');
    expect(bytesOf(two)).toEqual(HELLO);
  });

  it('strips od -A x -t x1z output', () => {
    const dump = ['000000 48 65 6c 6c 6f 2c 20 77 6f 72 6c 64 21 0a        >Hello, world!.<', '00000e'].join('\n');
    expect(bytesOf(dump)).toEqual(HELLO);
  });

  it('does not mistake plain hex words for offsets', () => {
    expect(bytesOf('DEAD BEEF CAFE F00D')).toEqual([0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe, 0xf0, 0x0d]);
    expect(ok(parseHexBytes('1234 5678\n9ABC DEF0')).dump).toBe(false);
  });
});

describe('formatHexBytes', () => {
  it('all styles', () => {
    expect(formatHexBytes(DEADBEEF, 'spaced')).toBe('DE AD BE EF');
    expect(formatHexBytes(DEADBEEF, 'continuous', false)).toBe('deadbeef');
    expect(formatHexBytes(DEADBEEF, 'c')).toBe('0xDE, 0xAD, 0xBE, 0xEF');
    expect(formatHexBytes(DEADBEEF, 'colon')).toBe('DE:AD:BE:EF');
    expect(formatHexBytes(DEADBEEF, 'python', false)).toBe("b'\\xde\\xad\\xbe\\xef'");
  });
});

describe('toCArray', () => {
  const base: CArrayOptions = {
    type: 'uint8_t',
    endian: 'little',
    perLine: 8,
    name: 'payload',
    staticConst: true,
    upper: true,
    length: 'define',
  };
  it('uint8_t with a length define', () => {
    const r = toCArray(DEADBEEF, base);
    expect(r.code).toBe('#define PAYLOAD_LEN 4U\n\nstatic const uint8_t payload[PAYLOAD_LEN] = {\n    0xDE, 0xAD, 0xBE, 0xEF\n};');
    expect(r.elements).toBe(4);
  });
  it('items per line and sizeof length', () => {
    const r = toCArray([1, 2, 3], { ...base, perLine: 2, staticConst: false, upper: false, length: 'sizeof' });
    expect(r.code).toBe(
      'uint8_t payload[] = {\n    0x01, 0x02,\n    0x03\n};\n\n#define PAYLOAD_LEN (sizeof(payload) / sizeof(payload[0]))  /* 3 */',
    );
  });
  it('uint16_t / uint32_t grouping honours endianness and pads', () => {
    expect(toCArray(DEADBEEF, { ...base, type: 'uint16_t' }).code).toContain('0xADDE, 0xEFBE');
    expect(toCArray(DEADBEEF, { ...base, type: 'uint16_t', endian: 'big' }).code).toContain('0xDEAD, 0xBEEF');
    expect(toCArray(DEADBEEF, { ...base, type: 'uint32_t' }).code).toContain('0xEFBEADDE');
    const r = toCArray([1, 2, 3, 4, 5], { ...base, type: 'uint32_t', endian: 'big' });
    expect(r.padded).toBe(3);
    expect(r.code).toContain('0x01020304, 0x05000000');
  });
});

describe('C literals and arrays', () => {
  it('parses every literal form', () => {
    expect(ok(parseCInteger('0x1F'))).toBe(31n);
    expect(ok(parseCInteger('0b101'))).toBe(5n);
    expect(ok(parseCInteger('017'))).toBe(15n);
    expect(ok(parseCInteger('0'))).toBe(0n);
    expect(ok(parseCInteger('42u'))).toBe(42n);
    expect(ok(parseCInteger('-1'))).toBe(-1n);
    expect(ok(parseCInteger("'A'"))).toBe(65n);
    expect(ok(parseCInteger("'\\n'"))).toBe(10n);
    expect(ok(parseCInteger("'\\x1B'"))).toBe(27n);
    expect(ok(parseCInteger("'\\101'"))).toBe(65n);
    expect(ok(parseCInteger("'\\0'"))).toBe(0n);
    expect(ok(parseCInteger("'\\''"))).toBe(39n);
    expect(ok(parseCInteger("'\\\\'"))).toBe(92n);
    expect(ok(parseCInteger('(uint8_t)0x80'))).toBe(128n);
    expect(parseCInteger('FOO').ok).toBe(false);
    expect(parseCInteger('08').ok).toBe(false);
  });
  it('decodes escapes and rejects greedy hex escapes larger than a byte', () => {
    expect(ok(decodeCEscapes('A\\r\\n'))).toEqual([65, 13, 10]);
    expect(decodeCEscapes('\\x1BA').ok).toBe(false);
  });
  it('parses an initializer with mixed literals', () => {
    const r = ok(parseCArray("{0x01, 0x02, 3, 'A', 010, -1, ','}", 0, 'little'));
    expect(r.size).toBe(1);
    expect(r.bytes).toEqual([1, 2, 3, 65, 8, 0xff, 44]);
  });
  it('accepts a full declaration with comments and a trailing comma', () => {
    const src = 'static const uint8_t lut[] = {\n  0xDE, /* first */ 0xAD, // second\n  0xBE, 0xEF,\n};';
    expect(ok(parseCArray(src, 1, 'little')).bytes).toEqual(DEADBEEF);
  });
  it('expands wider elements in the chosen byte order', () => {
    expect(ok(parseCArray('{0x1234, 0x5678}', 2, 'little')).bytes).toEqual([0x34, 0x12, 0x78, 0x56]);
    expect(ok(parseCArray('{0x1234, 0x5678}', 2, 'big')).bytes).toEqual([0x12, 0x34, 0x56, 0x78]);
    const auto = ok(parseCArray('{0x12345678, 1}', 0, 'big'));
    expect(auto.size).toBe(4);
    expect(auto.bytes).toEqual([0x12, 0x34, 0x56, 0x78, 0, 0, 0, 1]);
  });
  it('string literals become their bytes (no terminator)', () => {
    expect(ok(parseCArray('"AT\\r\\n"', 1, 'little')).bytes).toEqual([65, 84, 13, 10]);
  });
  it('reports values too big for the element and bad items', () => {
    const big = parseCArray('{1, 0x100}', 1, 'little');
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.error).toContain('Item 2');
    const bad = parseCArray('{1, FOO}', 1, 'little');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain('“FOO”');
  });
});

describe('Base64', () => {
  it('known vectors (RFC 4648 §10)', () => {
    const enc = (s: string) => base64Encode([...s].map((c) => c.charCodeAt(0)));
    expect(enc('')).toBe('');
    expect(enc('f')).toBe('Zg==');
    expect(enc('fo')).toBe('Zm8=');
    expect(enc('foo')).toBe('Zm9v');
    expect(enc('foob')).toBe('Zm9vYg==');
    expect(enc('fooba')).toBe('Zm9vYmE=');
    expect(enc('foobar')).toBe('Zm9vYmFy');
    expect(base64Encode(DEADBEEF)).toBe('3q2+7w==');
  });
  it('round-trips every byte value and every length', () => {
    const all = Array.from({ length: 256 }, (_, i) => i);
    for (let n = 0; n <= 10; n++) expect(ok(base64Decode(base64Encode(all.slice(0, n))))).toEqual(all.slice(0, n));
    expect(ok(base64Decode(base64Encode(all)))).toEqual(all);
  });
  it('accepts URL-safe, unpadded and wrapped input', () => {
    expect(ok(base64Decode('3q2-7w'))).toEqual(DEADBEEF);
    expect(ok(base64Decode('3q2+\n7w=='))).toEqual(DEADBEEF);
  });
  it('rejects invalid input', () => {
    expect(base64Decode('3q2*').ok).toBe(false);
    expect(base64Decode('A').ok).toBe(false);
  });
});

describe('swapCode', () => {
  it('names the builtin and shows the swapped constant', async () => {
    const { swapCode } = await import('../src/lib/bytes');
    const c32 = swapCode(0x12345678n, 32);
    expect(c32).toContain('__builtin_bswap32(0x12345678U);  /* = 0x78563412U');
    expect(c32).toContain('__REV(x)');
    expect(c32).toContain('((uint32_t)p[3] << 24)');
    expect(swapCode(0x1234n, 16)).toContain('uint16_t le = (uint16_t)p[0] | ((uint16_t)p[1] << 8);');
    expect(swapCode(1n, 64)).toContain('__builtin_bswap64(0x0000000000000001ULL);  /* = 0x0100000000000000ULL');
  });
});
