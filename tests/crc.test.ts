import { describe, expect, it } from 'vitest';
import {
  CRC_PRESETS,
  byteSwap,
  cIdent,
  crc,
  crcBitwise,
  crcBytesBE,
  crcBytesLE,
  crcTable,
  findPreset,
  generateC,
  parseHexBytes,
  parseHexValue,
  reflect,
  textBytes,
  toHex,
  validateParams,
  type CrcParams,
} from '../src/lib/crc';

const CHECK = new TextEncoder().encode('123456789');

// Check values from the reveng catalogue (https://reveng.sourceforge.io/crc-catalogue/all.htm),
// repeated here independently of the preset table so a typo in either is caught.
const CATALOGUE: [string, bigint][] = [
  ['CRC-8/SMBUS', 0xf4n],
  ['CRC-8/MAXIM-DOW', 0xa1n],
  ['CRC-8/AUTOSAR', 0xdfn],
  ['CRC-16/IBM-3740', 0x29b1n],
  ['CRC-16/CCITT-FALSE', 0x29b1n],
  ['CRC-16/ARC', 0xbb3dn],
  ['CRC-16/MODBUS', 0x4b37n],
  ['CRC-16/XMODEM', 0x31c3n],
  ['CRC-16/KERMIT', 0x2189n],
  ['CRC-16/X-25', 0x906en],
  ['CRC-32/ISO-HDLC', 0xcbf43926n],
  ['CRC-32C', 0xe3069283n],
  ['CRC-32/MPEG-2', 0x0376e6e7n],
  ['CRC-32/BZIP2', 0xfc891918n],
  ['CRC-64/XZ', 0x995dc9bbdf1939fan],
];

describe('presets', () => {
  it.each(CRC_PRESETS.map((p) => [p.name, p] as const))('%s matches its catalogue check value', (_n, preset) => {
    expect(crc(preset, CHECK)).toBe(preset.check);
    expect(crcBitwise(preset, CHECK)).toBe(preset.check);
  });

  it.each(CATALOGUE)('%s (looked up by name or alias) gives the catalogue check', (name, check) => {
    const preset = findPreset(name);
    expect(preset, name).toBeDefined();
    expect(crc(preset!, CHECK)).toBe(check);
  });

  it('every preset has valid parameters and a unique name', () => {
    const names = new Set<string>();
    for (const p of CRC_PRESETS) {
      expect(() => validateParams(p)).not.toThrow();
      expect(names.has(p.name)).toBe(false);
      names.add(p.name);
    }
  });
});

describe('edge cases', () => {
  it('empty input gives init (reflected per refout) xor xorout', () => {
    const empty = new Uint8Array();
    expect(crc(findPreset('CRC-32/ISO-HDLC')!, empty)).toBe(0n);
    expect(crc(findPreset('CRC-16/MODBUS')!, empty)).toBe(0xffffn);
    expect(crc(findPreset('CRC-16/IBM-3740')!, empty)).toBe(0xffffn);
    expect(crc(findPreset('CRC-8/AUTOSAR')!, empty)).toBe(0x00n);
    expect(crc(findPreset('CRC-32/BZIP2')!, empty)).toBe(0n);
    for (const p of CRC_PRESETS) expect(crc(p, empty)).toBe(crcBitwise(p, empty));
  });

  it('Modbus frame example: 01 03 00 00 00 01 → CRC 0x0A84, sent 84 0A', () => {
    // Commonly published Modbus RTU request "read 1 holding register at 0 from slave 1": 01 03 00 00 00 01 84 0A
    const v = crc(findPreset('CRC-16/MODBUS')!, Uint8Array.from([1, 3, 0, 0, 0, 1]));
    expect(v).toBe(0x0a84n);
    expect(crcBytesLE(v, 16)).toEqual([0x84, 0x0a]);
  });

  it('appending the CRC of a non-xorout, matching-reflection CRC gives a zero residue', () => {
    const xmodem = findPreset('CRC-16/XMODEM')!;
    const v = crc(xmodem, CHECK);
    expect(crc(xmodem, Uint8Array.from([...CHECK, ...crcBytesBE(v, 16)]))).toBe(0n);
    const modbus = findPreset('CRC-16/MODBUS')!;
    const m = crc(modbus, CHECK);
    expect(crc(modbus, Uint8Array.from([...CHECK, ...crcBytesLE(m, 16)]))).toBe(0n);
  });

  it('handles refin ≠ refout and odd widths', () => {
    const odd: CrcParams[] = [
      { width: 16, poly: 0x1021n, init: 0xffffn, refin: true, refout: false, xorout: 0n },
      { width: 16, poly: 0x8005n, init: 0x1234n, refin: false, refout: true, xorout: 0xabcdn },
      { width: 3, poly: 0x3n, init: 0x7n, refin: false, refout: true, xorout: 0n },
      { width: 3, poly: 0x3n, init: 0x7n, refin: true, refout: false, xorout: 0x1n },
      { width: 1, poly: 0x1n, init: 0n, refin: false, refout: false, xorout: 0n },
      { width: 12, poly: 0x80fn, init: 0n, refin: false, refout: true, xorout: 0n },
      { width: 40, poly: 0x0004820009n, init: 0n, refin: false, refout: false, xorout: 0xffffffffffn },
    ];
    for (const c of odd) expect(crc(c, CHECK)).toBe(crcBitwise(c, CHECK));
  });

  it('width-1 CRC with poly 1 is the parity of the input', () => {
    const c: CrcParams = { width: 1, poly: 1n, init: 0n, refin: false, refout: false, xorout: 0n };
    expect(crc(c, Uint8Array.from([0x01]))).toBe(1n);
    expect(crc(c, Uint8Array.from([0x03]))).toBe(0n);
  });
});

describe('table-driven == bitwise on random data and parameters', () => {
  // Deterministic PRNG (mulberry32) so failures are reproducible.
  let seed = 0x1234567;
  const rnd = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rbig = (bits: number) => {
    let v = 0n;
    for (let i = 0; i < bits; i++) v = (v << 1n) | (rnd() < 0.5 ? 1n : 0n);
    return v;
  };

  it('for 300 random parameter sets and inputs', () => {
    for (let n = 0; n < 300; n++) {
      const width = 1 + Math.floor(rnd() * 64);
      const c: CrcParams = {
        width,
        poly: rbig(width) | 1n,
        init: rbig(width),
        refin: rnd() < 0.5,
        refout: rnd() < 0.5,
        xorout: rbig(width),
      };
      const data = Uint8Array.from({ length: Math.floor(rnd() * 40) }, () => Math.floor(rnd() * 256));
      expect(crc(c, data), `w=${c.width} poly=${c.poly} init=${c.init} refin=${c.refin} refout=${c.refout} xorout=${c.xorout}`).toBe(crcBitwise(c, data));
    }
  });

  it('for every preset on random inputs', () => {
    for (const p of CRC_PRESETS) {
      for (let k = 0; k < 5; k++) {
        const data = Uint8Array.from({ length: 1 + Math.floor(rnd() * 64) }, () => Math.floor(rnd() * 256));
        expect(crc(p, data)).toBe(crcBitwise(p, data));
      }
    }
  });
});

describe('crcTable', () => {
  it('has the well-known first entries for CRC-32 (reflected 0xEDB88320)', () => {
    const t = crcTable(findPreset('CRC-32/ISO-HDLC')!);
    expect(t.length).toBe(256);
    expect(t[0]).toBe(0n);
    expect(t[1]).toBe(0x77073096n);
    expect(t[128]).toBe(0xedb88320n);
    expect(t[255]).toBe(0x2d02ef8dn);
  });

  it('has the well-known entries for CRC-16/CCITT (non-reflected 0x1021)', () => {
    const t = crcTable(findPreset('CRC-16/XMODEM')!);
    expect(t[1]).toBe(0x1021n);
    expect(t[2]).toBe(0x2042n);
    expect(t[255]).toBe(0x1ef0n);
  });

  it('Modbus table entry 1 is 0xC0C1', () => {
    expect(crcTable(findPreset('CRC-16/MODBUS')!)[1]).toBe(0xc0c1n);
  });
});

describe('generateC', () => {
  it('emits 256 entries of the right type, 8 per line, matching crcTable', () => {
    const p = findPreset('CRC-16/MODBUS')!;
    const src = generateC(p, p.name);
    expect(src).toContain('static const uint16_t crc16_modbus_table[256] = {');
    expect(src).toContain('uint16_t crc16_modbus(const uint8_t *data, size_t len)');
    const body = src.slice(src.indexOf('{\n') + 2, src.indexOf('};'));
    const rows = body.trim().split('\n');
    expect(rows.length).toBe(32);
    const entries = body.match(/0x[0-9A-F]+/g)!.map((h) => BigInt(h));
    expect(entries).toEqual(crcTable(p));
    expect(src).toContain('crc = 0xFFFF;');
  });

  it('uses uint8_t, uint32_t and uint64_t with proper suffixes', () => {
    expect(generateC(findPreset('CRC-8/SMBUS')!, 'CRC-8/SMBUS')).toContain('static const uint8_t crc8_smbus_table[256]');
    const c32 = generateC(findPreset('CRC-32/ISO-HDLC')!, 'CRC-32/ISO-HDLC');
    expect(c32).toContain('uint32_t');
    expect(c32).toContain('0x77073096u');
    expect(c32).toContain('return (uint32_t)(crc ^ 0xFFFFFFFFu);');
    expect(generateC(findPreset('CRC-64/XZ')!, 'CRC-64/XZ')).toMatch(/0x[0-9A-F]{16}ULL/);
  });

  it('adds a reflect helper only when refin ≠ refout and masks odd widths', () => {
    expect(generateC(findPreset('CRC-16/MODBUS')!)).not.toContain('_reflect');
    const odd = generateC({ width: 12, poly: 0x80fn, init: 0n, refin: false, refout: true, xorout: 0n }, 'CRC-12/UMTS');
    expect(odd).toContain('crc12_umts_reflect');
    expect(odd).toContain('& 0xFFF');
  });

  it('cIdent makes valid identifiers', () => {
    expect(cIdent('CRC-16/IBM-3740')).toBe('crc16_ibm_3740');
    expect(cIdent('Custom')).toBe('custom');
    expect(cIdent('16 bit')).toBe('crc_16_bit');
  });
});

describe('parsing and formatting', () => {
  it('parses hex bytes with flexible separators', () => {
    const want = [0xde, 0xad, 0xbe, 0xef];
    for (const s of ['DE AD BE EF', 'deadbeef', 'de:ad:be:ef', '0xDE, 0xAD, 0xBE, 0xEF', '{0xde,0xad,0xbe,0xef}', '\\xde\\xad\\xbe\\xef', 'de-ad-be-ef', 'DEAD BEEF']) {
      const r = parseHexBytes(s);
      expect(r.ok, s).toBe(true);
      if (r.ok) expect([...r.bytes]).toEqual(want);
    }
    const single = parseHexBytes('1 2 a');
    expect(single.ok && [...single.bytes]).toEqual([1, 2, 10]);
    expect(parseHexBytes('').ok).toBe(true);
    const odd = parseHexBytes('ABC');
    expect(odd.ok).toBe(false);
    expect(parseHexBytes('12 zz').ok).toBe(false);
  });

  it('encodes text as UTF-8 and handles escapes', () => {
    const r = textBytes('µ');
    expect(r.ok && [...r.bytes]).toEqual([0xc2, 0xb5]);
    const e = textBytes('A\\r\\n\\x00\\\\', true);
    expect(e.ok && [...e.bytes]).toEqual([0x41, 13, 10, 0, 0x5c]);
    expect(textBytes('\\q', true).ok).toBe(false);
    expect(textBytes('\\x1', true).ok).toBe(false);
    const raw = textBytes('\\n');
    expect(raw.ok && [...raw.bytes]).toEqual([0x5c, 0x6e]);
  });

  it('formats and splits values', () => {
    expect(toHex(0x59en, 15)).toBe('0x059E');
    expect(toHex(0xan, 8)).toBe('0x0A');
    expect(crcBytesBE(0xcbf43926n, 32)).toEqual([0xcb, 0xf4, 0x39, 0x26]);
    expect(crcBytesLE(0xcbf43926n, 32)).toEqual([0x26, 0x39, 0xf4, 0xcb]);
    expect(byteSwap(0x4b37n, 16)).toBe(0x374bn);
    expect(reflect(0x1n, 8)).toBe(0x80n);
    expect(parseHexValue('0x1021')).toBe(0x1021n);
    expect(parseHexValue('edb88320')).toBe(0xedb88320n);
    expect(parseHexValue('xyz')).toBeNull();
  });

  it('validateParams rejects out-of-range values', () => {
    expect(() => validateParams({ width: 0, poly: 1n, init: 0n, refin: false, refout: false, xorout: 0n })).toThrow();
    expect(() => validateParams({ width: 8, poly: 0x107n, init: 0n, refin: false, refout: false, xorout: 0n })).toThrow(/Polynomial/);
    expect(() => validateParams({ width: 8, poly: 0x07n, init: 0x100n, refin: false, refout: false, xorout: 0n })).toThrow(/Init/);
  });
});
