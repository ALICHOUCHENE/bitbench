// Parameterised CRC engine (Rocksoft / Ross Williams model, as used by the reveng catalogue).
// Pure functions, no DOM. All arithmetic is BigInt so any width from 1 to 64 bits is exact.
//
// Model: width, poly (normal / MSB-first form, top bit implicit), init (unreflected),
// refin (reflect each input byte), refout (reflect the final register), xorout.
// check = CRC of the ASCII bytes "123456789".

export interface CrcParams {
  width: number;
  poly: bigint;
  init: bigint;
  refin: boolean;
  refout: boolean;
  xorout: bigint;
}

export interface CrcPreset extends CrcParams {
  /** reveng catalogue name. */
  name: string;
  /** Other names the same algorithm goes by. */
  aliases: string[];
  /** CRC of "123456789" from the catalogue. */
  check: bigint;
  /** Where it is typically used. */
  usage: string;
}

const p = (
  name: string,
  width: number,
  poly: bigint,
  init: bigint,
  refin: boolean,
  refout: boolean,
  xorout: bigint,
  check: bigint,
  aliases: string[],
  usage: string,
): CrcPreset => ({ name, width, poly, init, refin, refout, xorout, check, aliases, usage });

/**
 * Presets copied from the reveng "Catalogue of parametrised CRC algorithms"
 * (https://reveng.sourceforge.io/crc-catalogue/all.htm, fetched 2026-10-02).
 * Every parameter set and check value was compared against the catalogue entry; the unit tests
 * re-verify each check value.
 */
export const CRC_PRESETS: CrcPreset[] = [
  p('CRC-5/USB', 5, 0x05n, 0x1fn, true, true, 0x1fn, 0x19n, [], 'USB token packets'),
  p('CRC-7/MMC', 7, 0x09n, 0x00n, false, false, 0x00n, 0x75n, ['CRC-7'], 'SD/MMC command frames'),
  p('CRC-8/SMBUS', 8, 0x07n, 0x00n, false, false, 0x00n, 0xf4n, ['CRC-8'], 'SMBus PEC, many sensors'),
  p('CRC-8/MAXIM-DOW', 8, 0x31n, 0x00n, true, true, 0x00n, 0xa1n, ['CRC-8/MAXIM', 'DOW-CRC'], '1-Wire ROM codes, DS18B20'),
  p('CRC-8/NRSC-5', 8, 0x31n, 0xffn, false, false, 0x00n, 0xf7n, [], 'Sensirion SHT3x/SHT4x/SCD4x (same parameters)'),
  p('CRC-8/AUTOSAR', 8, 0x2fn, 0xffn, false, false, 0xffn, 0xdfn, [], 'AUTOSAR E2E profile 2'),
  p('CRC-8/SAE-J1850', 8, 0x1dn, 0xffn, false, false, 0xffn, 0x4bn, [], 'AUTOSAR E2E profile 1, OBD'),
  p('CRC-8/I-432-1', 8, 0x07n, 0x00n, false, false, 0x55n, 0xa1n, ['CRC-8/ITU'], 'ATM HEC'),
  p('CRC-8/ROHC', 8, 0x07n, 0xffn, true, true, 0x00n, 0xd0n, [], 'RFC 3095 header compression'),
  p('CRC-8/BLUETOOTH', 8, 0xa7n, 0x00n, true, true, 0x00n, 0x26n, [], 'Bluetooth header error check'),
  p('CRC-15/CAN', 15, 0x4599n, 0x0000n, false, false, 0x0000n, 0x059en, ['CRC-15'], 'Classical CAN frames'),
  p('CRC-16/IBM-3740', 16, 0x1021n, 0xffffn, false, false, 0x0000n, 0x29b1n, ['CRC-16/CCITT-FALSE', 'CRC-16/AUTOSAR'], 'Very common "CCITT" in firmware'),
  p('CRC-16/XMODEM', 16, 0x1021n, 0x0000n, false, false, 0x0000n, 0x31c3n, ['CRC-16/ACORN', 'CRC-16/LTE', 'CRC-16/V-41-MSB', 'ZMODEM'], 'XMODEM, ZMODEM'),
  p('CRC-16/KERMIT', 16, 0x1021n, 0x0000n, true, true, 0x0000n, 0x2189n, ['CRC-16/CCITT', 'CRC-16/CCITT-TRUE', 'CRC-16/BLUETOOTH', 'CRC-CCITT'], 'Kermit, Bluetooth'),
  p('CRC-16/IBM-SDLC', 16, 0x1021n, 0xffffn, true, true, 0xffffn, 0x906en, ['CRC-16/X-25', 'CRC-16/ISO-HDLC', 'CRC-B'], 'HDLC, X.25, PPP, ISO 14443-B'),
  p('CRC-16/MCRF4XX', 16, 0x1021n, 0xffffn, true, true, 0x0000n, 0x6f91n, [], 'Microchip RFID tags'),
  p('CRC-16/GENIBUS', 16, 0x1021n, 0xffffn, false, false, 0xffffn, 0xd64en, ['CRC-16/DARC', 'CRC-16/EPC', 'CRC-16/I-CODE'], 'EPC Gen2 RFID'),
  p('CRC-16/SPI-FUJITSU', 16, 0x1021n, 0x1d0fn, false, false, 0x0000n, 0xe5ccn, ['CRC-16/AUG-CCITT'], 'Fujitsu SPI, "augmented" CCITT'),
  p('CRC-16/ARC', 16, 0x8005n, 0x0000n, true, true, 0x0000n, 0xbb3dn, ['ARC', 'CRC-16', 'CRC-16/LHA', 'CRC-IBM'], 'ARC, LHA, "CRC-16"'),
  p('CRC-16/MODBUS', 16, 0x8005n, 0xffffn, true, true, 0x0000n, 0x4b37n, ['MODBUS'], 'Modbus RTU'),
  p('CRC-16/USB', 16, 0x8005n, 0xffffn, true, true, 0xffffn, 0xb4c8n, [], 'USB data packets'),
  p('CRC-16/MAXIM-DOW', 16, 0x8005n, 0x0000n, true, true, 0xffffn, 0x44c2n, ['CRC-16/MAXIM'], '1-Wire 16-bit CRC'),
  p('CRC-16/UMTS', 16, 0x8005n, 0x0000n, false, false, 0x0000n, 0xfee8n, ['CRC-16/BUYPASS', 'CRC-16/VERIFONE'], 'UMTS, Verifone'),
  p('CRC-16/CMS', 16, 0x8005n, 0xffffn, false, false, 0x0000n, 0xaee7n, [], 'CMS'),
  p('CRC-16/DNP', 16, 0x3d65n, 0x0000n, true, true, 0xffffn, 0xea82n, [], 'DNP3, M-Bus'),
  p('CRC-16/T10-DIF', 16, 0x8bb7n, 0x0000n, false, false, 0x0000n, 0xd0dbn, [], 'SCSI T10 data integrity'),
  p('CRC-24/OPENPGP', 24, 0x864cfbn, 0xb704cen, false, false, 0x000000n, 0x21cf02n, ['CRC-24'], 'OpenPGP armour'),
  p('CRC-32/ISO-HDLC', 32, 0x04c11db7n, 0xffffffffn, true, true, 0xffffffffn, 0xcbf43926n, ['CRC-32', 'CRC-32/ADCCP', 'CRC-32/V-42', 'CRC-32/XZ', 'PKZIP'], 'Ethernet, zlib, PNG, ZIP'),
  p('CRC-32/ISCSI', 32, 0x1edc6f41n, 0xffffffffn, true, true, 0xffffffffn, 0xe3069283n, ['CRC-32C', 'CRC-32/CASTAGNOLI', 'CRC-32/INTERLAKEN', 'CRC-32/NVME'], 'iSCSI, SCTP, ext4, SSE4.2 crc32'),
  p('CRC-32/MPEG-2', 32, 0x04c11db7n, 0xffffffffn, false, false, 0x00000000n, 0x0376e6e7n, [], 'MPEG-2 TS; STM32 hardware CRC unit defaults'),
  p('CRC-32/BZIP2', 32, 0x04c11db7n, 0xffffffffn, false, false, 0xffffffffn, 0xfc891918n, ['CRC-32/AAL5', 'CRC-32/DECT-B', 'B-CRC-32'], 'bzip2, ATM AAL5'),
  p('CRC-32/CKSUM', 32, 0x04c11db7n, 0x00000000n, false, false, 0xffffffffn, 0x765e7680n, ['CKSUM', 'CRC-32/POSIX'], 'POSIX cksum (without length)'),
  p('CRC-32/JAMCRC', 32, 0x04c11db7n, 0xffffffffn, true, true, 0x00000000n, 0x340bc6d9n, ['JAMCRC'], 'CRC-32 without final XOR'),
  p('CRC-32/AUTOSAR', 32, 0xf4acfb13n, 0xffffffffn, true, true, 0xffffffffn, 0x1697d06an, [], 'AUTOSAR E2E profile 4'),
  p('CRC-64/ECMA-182', 64, 0x42f0e1eba9ea3693n, 0n, false, false, 0n, 0x6c40df5f0b497347n, ['CRC-64'], 'ECMA-182 tape'),
  p('CRC-64/XZ', 64, 0x42f0e1eba9ea3693n, 0xffffffffffffffffn, true, true, 0xffffffffffffffffn, 0x995dc9bbdf1939fan, ['CRC-64/GO-ECMA'], 'xz, Go hash/crc64 ECMA'),
];

export function findPreset(name: string): CrcPreset | undefined {
  const n = name.trim().toUpperCase();
  return CRC_PRESETS.find((x) => x.name === n || x.aliases.some((a) => a.toUpperCase() === n));
}

export function crcMask(width: number): bigint {
  return (1n << BigInt(width)) - 1n;
}

/** Reverse the low `bits` bits of v. */
export function reflect(v: bigint, bits: number): bigint {
  let r = 0n;
  for (let i = 0; i < bits; i++) {
    r = (r << 1n) | (v & 1n);
    v >>= 1n;
  }
  return r;
}

/** Throws a descriptive Error when the parameters are not a valid CRC model. */
export function validateParams(c: CrcParams): void {
  if (!Number.isInteger(c.width) || c.width < 1 || c.width > 64) throw new Error('Width must be an integer from 1 to 64.');
  const m = crcMask(c.width);
  if (c.poly < 0n || c.poly > m) throw new Error(`Polynomial must fit in ${c.width} bits.`);
  if (c.init < 0n || c.init > m) throw new Error(`Init must fit in ${c.width} bits.`);
  if (c.xorout < 0n || c.xorout > m) throw new Error(`XorOut must fit in ${c.width} bits.`);
}

/**
 * Reference implementation: bit by bit, straight from the Rocksoft model. Slow but obviously
 * correct; used to cross-check the table-driven version.
 */
export function crcBitwise(c: CrcParams, data: Uint8Array): bigint {
  const w = BigInt(c.width);
  const mask = crcMask(c.width);
  const top = 1n << (w - 1n);
  let reg = c.init;
  for (const byte of data) {
    const b = c.refin ? Number(reflect(BigInt(byte), 8)) : byte;
    for (let i = 7; i >= 0; i--) {
      const bit = (b >> i) & 1;
      const fb = ((reg & top) !== 0n ? 1 : 0) ^ bit;
      reg = (reg << 1n) & mask;
      if (fb) reg ^= c.poly;
    }
  }
  if (c.refout) reg = reflect(reg, c.width);
  return (reg ^ c.xorout) & mask;
}

/**
 * 256-entry lookup table for byte-at-a-time processing.
 * - refin: entries are for the reflected (LSB-first) register, poly reflected.
 * - !refin, width ≥ 8: normal MSB-first register.
 * - !refin, width < 8: the register is kept left-aligned in 8 bits (poly << (8 − width)).
 */
export function crcTable(c: CrcParams): bigint[] {
  const table: bigint[] = new Array(256);
  if (c.refin) {
    const rpoly = reflect(c.poly, c.width);
    for (let i = 0; i < 256; i++) {
      let r = BigInt(i);
      for (let k = 0; k < 8; k++) r = r & 1n ? (r >> 1n) ^ rpoly : r >> 1n;
      table[i] = r;
    }
    return table;
  }
  const rw = Math.max(c.width, 8);
  const shift = BigInt(rw - c.width);
  const poly = c.poly << shift;
  const mask = crcMask(rw);
  const top = 1n << BigInt(rw - 1);
  for (let i = 0; i < 256; i++) {
    let r = BigInt(i) << BigInt(rw - 8);
    for (let k = 0; k < 8; k++) r = r & top ? ((r << 1n) ^ poly) & mask : (r << 1n) & mask;
    table[i] = r;
  }
  return table;
}

const tableCache = new Map<string, bigint[]>();
function cachedTable(c: CrcParams): bigint[] {
  const key = `${c.width}:${c.poly}:${c.refin}`;
  let t = tableCache.get(key);
  if (!t) {
    t = crcTable(c);
    if (tableCache.size > 64) tableCache.clear();
    tableCache.set(key, t);
  }
  return t;
}

/** Table-driven CRC (one lookup per byte). Same result as crcBitwise. */
export function crc(c: CrcParams, data: Uint8Array): bigint {
  const t = cachedTable(c);
  const mask = crcMask(c.width);
  let reg: bigint;
  if (c.refin) {
    reg = reflect(c.init, c.width);
    for (const byte of data) reg = t[Number((reg ^ BigInt(byte)) & 0xffn)] ^ (reg >> 8n);
    // reg is the reflected register; refout=false means the result must be un-reflected.
    if (!c.refout) reg = reflect(reg, c.width);
  } else {
    const rw = Math.max(c.width, 8);
    const shift = BigInt(rw - c.width);
    const rmask = crcMask(rw);
    const hi = BigInt(rw - 8);
    reg = c.init << shift;
    for (const byte of data) reg = ((reg << 8n) & rmask) ^ t[Number(((reg >> hi) ^ BigInt(byte)) & 0xffn)];
    reg >>= shift;
    if (c.refout) reg = reflect(reg, c.width);
  }
  return (reg ^ c.xorout) & mask;
}

// ---------- Input parsing and output formatting ----------

export type ParseResult = { ok: true; bytes: Uint8Array } | { ok: false; error: string };

/**
 * Parse hex bytes typed or pasted in any common form: "DE AD BE EF", "deadbeef", "de:ad:be:ef",
 * "0xDE, 0xAD", "{0x01,0x02}", "\x01\x02". Tokens of 1–2 digits are one byte; longer tokens
 * are split into pairs and must have an even number of digits.
 */
export function parseHexBytes(input: string): ParseResult {
  const cleaned = input.replace(/\\x/gi, ' ').replace(/0x/gi, ' ').replace(/[{}[\]()";]/g, ' ');
  const tokens = cleaned.split(/[\s,:\-_.|]+/).filter(Boolean);
  const out: number[] = [];
  for (const tok of tokens) {
    if (!/^[0-9a-fA-F]+$/.test(tok)) return { ok: false, error: `"${tok}" is not hex. Use digits 0–9 and A–F.` };
    if (tok.length <= 2) out.push(parseInt(tok, 16));
    else if (tok.length % 2 === 1) return { ok: false, error: `"${tok}" has an odd number of hex digits; add a leading 0 or separate the bytes.` };
    else for (let i = 0; i < tok.length; i += 2) out.push(parseInt(tok.slice(i, i + 2), 16));
  }
  return { ok: true, bytes: Uint8Array.from(out) };
}

/** UTF-8 encode text. Optionally interpret C escapes \n \r \t \0 \\ \xHH. */
export function textBytes(input: string, escapes = false): ParseResult {
  if (!escapes) return { ok: true, bytes: new TextEncoder().encode(input) };
  const out: number[] = [];
  const enc = new TextEncoder();
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch !== '\\') {
      const cp = input.codePointAt(i)!;
      const s = String.fromCodePoint(cp);
      out.push(...enc.encode(s));
      i += s.length - 1;
      continue;
    }
    const n = input[++i];
    if (n === undefined) return { ok: false, error: 'Trailing backslash: write \\\\ for a literal backslash.' };
    const simple: Record<string, number> = { n: 10, r: 13, t: 9, '0': 0, '\\': 92, '"': 34, "'": 39, a: 7, b: 8, f: 12, v: 11 };
    if (n in simple) out.push(simple[n]);
    else if (n === 'x') {
      const h = /^[0-9a-fA-F]{2}/.exec(input.slice(i + 1));
      if (!h) return { ok: false, error: '\\x must be followed by exactly two hex digits, e.g. \\x0D.' };
      out.push(parseInt(h[0], 16));
      i += 2;
    } else return { ok: false, error: `Unknown escape \\${n}. Supported: \\n \\r \\t \\0 \\\\ \\xHH.` };
  }
  return { ok: true, bytes: Uint8Array.from(out) };
}

/** Parse a CRC parameter value written in hex, with or without 0x (up to 16 digits). */
export function parseHexValue(input: string): bigint | null {
  const s = input.trim().replace(/_/g, '').replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{1,16}$/.test(s)) return null;
  return BigInt(`0x${s}`);
}

/** Hex digits needed for a width (CRC-15 → 4). */
export function hexDigits(width: number): number {
  return Math.ceil(width / 4);
}

export function toHex(v: bigint, width: number): string {
  return `0x${v.toString(16).toUpperCase().padStart(hexDigits(width), '0')}`;
}

/** CRC split into bytes, most significant first (as XMODEM/CCITT-FALSE frames carry it). */
export function crcBytesBE(v: bigint, width: number): number[] {
  const n = Math.ceil(width / 8);
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(Number((v >> BigInt(8 * i)) & 0xffn));
  return out;
}

/** CRC split into bytes, least significant first (as Modbus RTU / CRC-32 frames carry it). */
export function crcBytesLE(v: bigint, width: number): number[] {
  return crcBytesBE(v, width).reverse();
}

/** Byte-swap a CRC value of the given width (whole bytes only). */
export function byteSwap(v: bigint, width: number): bigint {
  return crcBytesLE(v, width).reduce((acc, b) => (acc << 8n) | BigInt(b), 0n);
}

// ---------- C code generation ----------

function cType(width: number): { name: string; bits: number } {
  if (width <= 8) return { name: 'uint8_t', bits: 8 };
  if (width <= 16) return { name: 'uint16_t', bits: 16 };
  if (width <= 32) return { name: 'uint32_t', bits: 32 };
  return { name: 'uint64_t', bits: 64 };
}

function cLit(v: bigint, digits: number, bits: number): string {
  const h = `0x${v.toString(16).toUpperCase().padStart(digits, '0')}`;
  return bits === 64 ? `${h}ULL` : bits === 32 ? `${h}u` : h;
}

/** C identifier from a preset name: "CRC-16/MODBUS" → "crc16_modbus". */
export function cIdent(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/^crc-(\d+)/, 'crc$1')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return /^[a-z_]/.test(s) ? s : `crc_${s}`;
}

/**
 * C source: a 256-entry lookup table (8 entries per line) and a function that computes the CRC
 * of a buffer with it. Entries are exactly crcTable(c).
 */
export function generateC(c: CrcParams, name = 'crc'): string {
  validateParams(c);
  const id = cIdent(name);
  const t = cType(c.width);
  const table = crcTable(c);
  const entryBits = c.refin ? c.width : Math.max(c.width, 8);
  const digits = hexDigits(entryBits);
  const lines: string[] = [];
  for (let i = 0; i < 256; i += 8) {
    lines.push('    ' + table.slice(i, i + 8).map((v) => cLit(v, digits, t.bits)).join(', ') + (i + 8 < 256 ? ',' : ''));
  }
  const W = c.width;
  const lit = (v: bigint, bits = W) => cLit(v, hexDigits(bits), t.bits);
  const needMask = c.width !== t.bits;
  const mask = lit(crcMask(W));
  const yn = (b: boolean) => (b ? 'true' : 'false');

  const head = [
    `/* ${name}: width=${W} poly=${toHex(c.poly, W)} init=${toHex(c.init, W)} refin=${yn(c.refin)} refout=${yn(c.refout)} xorout=${toHex(c.xorout, W)}`,
    ` * Generated by BitBench. Table-driven, one lookup per byte. */`,
    '#include <stdint.h>',
    '#include <stddef.h>',
    '',
  ];

  const needReflect = c.refin !== c.refout;
  const reflectFn = needReflect
    ? [
        `static ${t.name} ${id}_reflect(${t.name} v)`,
        '{',
        `    ${t.name} r = 0;`,
        `    for (int i = 0; i < ${W}; i++) {`,
        `        r = (${t.name})((r << 1) | (v & 1u));`,
        '        v >>= 1;',
        '    }',
        '    return r;',
        '}',
        '',
      ]
    : [];

  const body: string[] = [];
  if (c.refin) {
    body.push(`    ${t.name} crc = ${lit(reflect(c.init, W))}; /* init, reflected */`);
    body.push('    while (len--) {');
    body.push(
      W <= 8
        ? `        crc = ${id}_table[(crc ^ *data++) & 0xFFu];`
        : `        crc = (${t.name})((crc >> 8) ^ ${id}_table[(crc ^ *data++) & 0xFFu]);`,
    );
    body.push('    }');
    if (needReflect) body.push(`    crc = ${id}_reflect(crc); /* refout = false */`);
  } else if (W < 8) {
    const sh = 8 - W;
    body.push(`    ${t.name} crc = ${cLit(c.init << BigInt(sh), 2, 8)}; /* init << ${sh}: register kept left-aligned in 8 bits */`);
    body.push('    while (len--) {');
    body.push(`        crc = ${id}_table[crc ^ *data++];`);
    body.push('    }');
    body.push(`    crc >>= ${sh};`);
    if (needReflect) body.push(`    crc = ${id}_reflect(crc); /* refout = true */`);
  } else {
    body.push(`    ${t.name} crc = ${lit(c.init)};`);
    body.push('    while (len--) {');
    if (W === 8) body.push(`        crc = ${id}_table[crc ^ *data++];`);
    else {
      const expr = `(crc << 8) ^ ${id}_table[((crc >> ${W - 8}) ^ *data++) & 0xFFu]`;
      body.push(needMask ? `        crc = (${t.name})((${expr}) & ${mask});` : `        crc = (${t.name})(${expr});`);
    }
    body.push('    }');
    if (needReflect) body.push(`    crc = ${id}_reflect(crc); /* refout = true */`);
  }
  body.push(c.xorout === 0n ? '    return crc;' : `    return (${t.name})(crc ^ ${lit(c.xorout)});`);

  return [
    ...head,
    `static const ${t.name} ${id}_table[256] = {`,
    ...lines,
    '};',
    '',
    ...reflectFn,
    `${t.name} ${id}(const uint8_t *data, size_t len)`,
    '{',
    ...body,
    '}',
    '',
  ].join('\n');
}
