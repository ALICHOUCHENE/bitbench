// Byte order, hex dump parsing, C array generation and parsing, Base64. Pure functions, no DOM.

export type Endian = 'big' | 'little';
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

// ---------- Byte order of a value ----------

/** Bytes of a value of `width` bits (8, 16, 32, 64) in the given byte order. */
export function toBytes(value: bigint, width: number, endian: Endian): number[] {
  const n = width / 8;
  const v = BigInt.asUintN(width, value);
  const be: number[] = [];
  for (let i = n - 1; i >= 0; i--) be.push(Number((v >> BigInt(i * 8)) & 0xffn));
  return endian === 'big' ? be : be.reverse();
}

/** Value of a byte sequence read in the given byte order. */
export function fromBytes(bytes: number[], endian: Endian): bigint {
  const seq = endian === 'big' ? bytes : [...bytes].reverse();
  let v = 0n;
  for (const b of seq) v = (v << 8n) | BigInt(b & 0xff);
  return v;
}

/** Reverse the byte order of a 16, 32 or 64-bit value. */
export function byteSwap(value: bigint, width: 16 | 32 | 64): bigint {
  return fromBytes(toBytes(value, width, 'little'), 'big');
}

// ---------- Hex output ----------

export function hexByte(b: number, upper = true): string {
  const s = (b & 0xff).toString(16).padStart(2, '0');
  return upper ? s.toUpperCase() : s;
}

export type HexStyle = 'spaced' | 'continuous' | 'c' | 'colon' | 'python';

/** Format bytes as hex: "DE AD", "DEAD", "0xDE, 0xAD", "DE:AD" or b'\xde\xad'. */
export function formatHexBytes(bytes: number[], style: HexStyle, upper = true): string {
  const h = bytes.map((b) => hexByte(b, upper));
  switch (style) {
    case 'spaced':
      return h.join(' ');
    case 'continuous':
      return h.join('');
    case 'c':
      return h.map((x) => `0x${x}`).join(', ');
    case 'colon':
      return h.join(':');
    case 'python':
      return `b'${h.map((x) => `\\x${x}`).join('')}'`;
  }
}

// ---------- Hex text / hex dump parsing ----------

export interface HexParse {
  bytes: number[];
  /** True when the input was recognised as a hex dump with offsets (offsets and ASCII column dropped). */
  dump: boolean;
}

const HEX_TOKEN = /^[0-9a-f]+$/i;
const OFFSET_TOKEN = /^(?:0x)?([0-9a-f]{4,16}):?$/i;

/** The ASCII column of a hex dump renders printable bytes as themselves and the rest as '.'. */
function asciiColumn(bytes: number[]): string {
  return bytes.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
}

function bytesOfToken(tok: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < tok.length; i += 2) out.push(parseInt(tok.slice(i, i + 2), 16));
  return out;
}

interface DumpLine {
  offset: number;
  colon: boolean;
  /** Text after the offset. */
  rest: string;
}

function splitDumpLine(line: string): DumpLine | null {
  const m = /^\s*(\S+)(.*)$/.exec(line);
  if (!m) return null;
  const off = OFFSET_TOKEN.exec(m[1]);
  if (!off) return null;
  return { offset: parseInt(off[1], 16), colon: m[1].endsWith(':'), rest: m[2] };
}

/**
 * Read the data bytes of a dump line (after the offset). Data tokens are hex groups of an even
 * number of digits; the ASCII column is recognised because it mirrors the bytes before it.
 * `expected` is the byte count implied by the next line's offset, when known.
 */
function dumpLineBytes(rest: string, expected: number | null): Result<number[]> {
  // hexdump -C and od use |…| or >…< around the ASCII column.
  const delimited = rest.replace(/\s(?:\|.*\||>.*<)\s*$/, '');
  const tokens: { text: string; end: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(delimited))) tokens.push({ text: m[0], end: m.index + m[0].length });
  const bytes: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].text;
    if (!HEX_TOKEN.test(t) || t.length % 2 !== 0) break;
    if (expected !== null && bytes.length >= expected) break;
    bytes.push(...bytesOfToken(t));
    const remainder = delimited.slice(tokens[i].end).replace(/\s/g, '');
    if (remainder !== '' && remainder === asciiColumn(bytes).replace(/\s/g, '') && expected === null) break;
  }
  if (bytes.length === 0 && tokens.length > 0 && expected !== 0) {
    return { ok: false, error: `Couldn't find hex bytes in “${rest.trim().slice(0, 40)}”.` };
  }
  return { ok: true, value: bytes };
}

/** Does the input look like a hex dump with an offset column? */
function detectDump(lines: string[]): DumpLine[] | null {
  const parsed = lines.map(splitDumpLine);
  if (parsed.some((p) => p === null)) return null;
  const dl = parsed as DumpLine[];
  // xxd style: every line starts with "offset:".
  if (dl.every((d) => d.colon)) return dl;
  if (dl.length === 1) {
    // A single line counts as a dump only if it starts at offset 0, and either the offset is
    // long ("000000") or an ASCII column follows the bytes ("0000  48 69  Hi").
    const tok = lines[0].trim().split(/\s+/)[0];
    const rest = dl[0].rest.trim().split(/\s+/).filter(Boolean);
    if (dl[0].offset !== 0 || rest.length === 0) return null;
    const hasText = rest.some((t) => !HEX_TOKEN.test(t) || t.length % 2 !== 0);
    return tok.length >= 6 || hasText ? dl : null;
  }
  // Offsets must increase, and the first line's step must look like a dump line (4…64 bytes).
  for (let i = 1; i < dl.length; i++) if (dl[i].offset <= dl[i - 1].offset) return null;
  const step = dl[1].offset - dl[0].offset;
  if (step < 4 || step > 64) return null;
  // The first line must contain exactly `step` bytes of data before anything else.
  const first = dumpLineBytes(dl[0].rest, step);
  if (!first.ok || first.value.length !== step) return null;
  return dl;
}

/**
 * Parse bytes written as hex in any common form:
 * "DE AD BE EF", "deadbeef", "0xDE, 0xAD", "de:ad:be:ef", "DE-AD", "\xde\xad", a C initializer
 * of hex values, or a hex dump with offsets and an ASCII column (xxd, hexdump -C, od, Wireshark).
 */
export function parseHexBytes(input: string): Result<HexParse> {
  const lines = input.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { ok: true, value: { bytes: [], dump: false } };

  const dump = detectDump(lines);
  if (dump) {
    const bytes: number[] = [];
    for (let i = 0; i < dump.length; i++) {
      const next = dump[i + 1];
      const expected = next ? next.offset - dump[i].offset : null;
      const r = dumpLineBytes(dump[i].rest, expected);
      if (!r.ok) return { ok: false, error: `Line ${i + 1}: ${r.error}` };
      bytes.push(...r.value);
    }
    return { ok: true, value: { bytes, dump: true } };
  }

  const text = input
    .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ' ')
    .replace(/^\s*(?:(?:static|const|unsigned|signed|char|u?int\d+_t|uint8|byte)\s+)*[A-Za-z_]\w*\s*\[[^\]]*\]\s*=\s*/, '')
    .replace(/\bb(?=['"])/g, '') // Python bytes literal b'…'
    .replace(/['"]/g, ' ')
    .replace(/\\x/gi, ' ');
  const tokens = text.split(/[\s,;:{}\[\]()\-]+/).filter(Boolean);
  const bytes: number[] = [];
  for (const raw of tokens) {
    let t = raw;
    let prefixed = false;
    if (/^0x/i.test(t)) {
      t = t.slice(2);
      prefixed = true;
    } else if (/^[0-9a-f]+h$/i.test(t) && t.length <= 3) {
      t = t.slice(0, -1); // assembler style: 0FFh
      prefixed = true;
    }
    t = t.replace(/^(.+?)(?:ul?|lu?)$/i, (all, d: string) => (prefixed && HEX_TOKEN.test(d) ? d : all));
    if (t === '' || !HEX_TOKEN.test(t)) return { ok: false, error: `“${raw}” is not hex.` };
    if (t.length % 2 !== 0) {
      if (prefixed || t.length === 1) t = `0${t}`;
      else return { ok: false, error: `“${raw}” has an odd number of hex digits.` };
    }
    bytes.push(...bytesOfToken(t));
  }
  return { ok: true, value: { bytes, dump: false } };
}

// ---------- C array output ----------

export type ElementType = 'uint8_t' | 'uint16_t' | 'uint32_t';

export const ELEMENT_SIZE: Record<ElementType, number> = { uint8_t: 1, uint16_t: 2, uint32_t: 4 };

export interface CArrayOptions {
  type: ElementType;
  /** Byte order used to group bytes into 16/32-bit elements. */
  endian: Endian;
  perLine: number;
  name: string;
  staticConst: boolean;
  upper: boolean;
  /** 'define': #define NAME_LEN n and name[NAME_LEN]; 'sizeof': name[] and a sizeof-based length. */
  length: 'define' | 'sizeof';
}

export interface CArrayResult {
  code: string;
  elements: number;
  /** Zero bytes added to complete the last element. */
  padded: number;
}

/** Group bytes into elements of `size` bytes, padding the last one with zeros. */
export function groupBytes(bytes: number[], size: number, endian: Endian): { values: bigint[]; padded: number } {
  const padded = (size - (bytes.length % size)) % size;
  const all = [...bytes, ...new Array<number>(padded).fill(0)];
  const values: bigint[] = [];
  for (let i = 0; i < all.length; i += size) values.push(fromBytes(all.slice(i, i + size), endian));
  return { values, padded };
}

/** Render bytes as a C array initializer. */
export function toCArray(bytes: number[], o: CArrayOptions): CArrayResult {
  const size = ELEMENT_SIZE[o.type];
  const { values, padded } = groupBytes(bytes, size, o.endian);
  const digits = size * 2;
  const lit = (v: bigint) => {
    const h = v.toString(16).padStart(digits, '0');
    return `0x${o.upper ? h.toUpperCase() : h}`;
  };
  const per = Math.max(1, Math.floor(o.perLine));
  const rows: string[] = [];
  for (let i = 0; i < values.length; i += per) rows.push(`    ${values.slice(i, i + per).map(lit).join(', ')}`);
  const lenName = `${o.name.toUpperCase()}_LEN`;
  const decl = `${o.staticConst ? 'static const ' : ''}${o.type} ${o.name}`;
  const body = values.length ? `{\n${rows.join(',\n')}\n}` : '{ 0 }';
  const out: string[] = [];
  if (o.length === 'define') {
    out.push(`#define ${lenName} ${values.length}U`, '', `${decl}[${lenName}] = ${body};`);
  } else {
    out.push(`${decl}[] = ${body};`, '', `#define ${lenName} (sizeof(${o.name}) / sizeof(${o.name}[0]))  /* ${values.length} */`);
  }
  return { code: out.join('\n'), elements: values.length, padded };
}

// ---------- C array / literal parsing ----------

const SIMPLE_ESCAPES: Record<string, number> = {
  n: 10, t: 9, r: 13, '0': 0, a: 7, b: 8, f: 12, v: 11, e: 27, '\\': 92, "'": 39, '"': 34, '?': 63,
};

/** Decode the contents of a C char or string literal (without the quotes) into byte values. */
export function decodeCEscapes(s: string): Result<number[]> {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') {
      const code = c.codePointAt(0)!;
      if (code > 0x7f) {
        out.push(...new TextEncoder().encode(String.fromCodePoint(code)));
        if (code > 0xffff) i++;
      } else out.push(code);
      continue;
    }
    const n = s[++i];
    if (n === undefined) return { ok: false, error: 'Literal ends with a lone backslash.' };
    if (n === 'x' || n === 'X') {
      const m = /^[0-9a-f]+/i.exec(s.slice(i + 1));
      if (!m) return { ok: false, error: '\\x must be followed by hex digits.' };
      const v = parseInt(m[0], 16);
      if (v > 0xff) return { ok: false, error: `\\x${m[0]} is larger than a byte (hex escapes are greedy in C).` };
      out.push(v);
      i += m[0].length;
    } else if (/[0-7]/.test(n)) {
      const m = /^[0-7]{1,3}/.exec(s.slice(i))!;
      const v = parseInt(m[0], 8);
      if (v > 0xff) return { ok: false, error: `\\${m[0]} is larger than a byte.` };
      out.push(v);
      i += m[0].length - 1;
    } else if (n in SIMPLE_ESCAPES) out.push(SIMPLE_ESCAPES[n]);
    else return { ok: false, error: `Unknown escape \\${n}.` };
  }
  return { ok: true, value: out };
}

/** Parse one C integer constant (hex, binary, octal, decimal, char literal; optional sign and suffix). */
export function parseCInteger(token: string): Result<bigint> {
  let t = token.trim().replace(/^\(\s*(?:const\s+)?(?:unsigned\s+|signed\s+)?[A-Za-z_]\w*\s*\)\s*/, ''); // cast
  if (/^'.*'$/s.test(t)) {
    const r = decodeCEscapes(t.slice(1, -1));
    if (!r.ok) return r;
    if (r.value.length !== 1) return { ok: false, error: `${t} is not a single character.` };
    return { ok: true, value: BigInt(r.value[0]) };
  }
  let neg = false;
  if (t.startsWith('-') || t.startsWith('+')) {
    neg = t[0] === '-';
    t = t.slice(1).trim();
  }
  t = t.replace(/'/g, '').replace(/(?:u?l{0,2}|l{1,2}u)$/i, '');
  let v: bigint;
  if (/^0x[0-9a-f]+$/i.test(t)) v = BigInt(t);
  else if (/^0b[01]+$/i.test(t)) v = BigInt(t);
  else if (/^0[0-7]+$/.test(t)) v = BigInt(`0o${t.slice(1)}`);
  else if (/^(?:0|[1-9]\d*)$/.test(t)) v = BigInt(t);
  else return { ok: false, error: `“${token.trim()}” is not a C integer or char literal.` };
  return { ok: true, value: neg ? -v : v };
}

/** Split an initializer list on commas that are not inside char literals. */
function splitItems(s: string): string[] {
  const items: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === '\\') cur += s[++i] ?? '';
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"') {
      quote = c;
      cur += c;
    } else if (c === ',') {
      items.push(cur);
      cur = '';
    } else cur += c;
  }
  items.push(cur);
  return items.map((x) => x.trim()).filter((x) => x !== '');
}

export interface CArrayParse {
  /** Element values as written. */
  values: bigint[];
  /** Byte size of each element: the requested size, or the smallest of 1/2/4/8 that fits (auto). */
  size: number;
  bytes: number[];
}

/**
 * Parse a C array initializer — `{0x01, 0x02, 3, 'A', 0101, -1}`, with or without the
 * declaration, comments, casts or string literals — into bytes. `size` is the element size in
 * bytes or 0 to pick the smallest that fits every value. Negative values are stored in two's
 * complement at the element size.
 */
export function parseCArray(input: string, size: number, endian: Endian): Result<CArrayParse> {
  let s = input.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ' ');
  const open = s.indexOf('{');
  if (open >= 0) {
    const close = s.lastIndexOf('}');
    s = s.slice(open + 1, close > open ? close : undefined);
  } else {
    s = s.replace(/^[^=]*=\s*/, '').replace(/;\s*$/, '');
  }
  const values: bigint[] = [];
  const items = splitItems(s);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const str = /^"((?:[^"\\]|\\.)*)"$/s.exec(item);
    if (str) {
      const r = decodeCEscapes(str[1]);
      if (!r.ok) return { ok: false, error: `Item ${i + 1}: ${r.error}` };
      values.push(...r.value.map(BigInt));
      continue;
    }
    const r = parseCInteger(item);
    if (!r.ok) return { ok: false, error: `Item ${i + 1}: ${r.error}` };
    values.push(r.value);
  }
  let sz = size;
  if (sz === 0) {
    sz = 1;
    for (const v of values) {
      const need = v < 0n ? (v >= -128n ? 1 : v >= -32768n ? 2 : v >= -(2n ** 31n) ? 4 : 8) : v <= 0xffn ? 1 : v <= 0xffffn ? 2 : v <= 0xffffffffn ? 4 : 8;
      sz = Math.max(sz, need);
    }
  }
  const bits = sz * 8;
  const bytes: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const min = -(1n << BigInt(bits - 1));
    const max = (1n << BigInt(bits)) - 1n;
    if (v < min || v > max) {
      return { ok: false, error: `Item ${i + 1} (${v}) doesn't fit in ${sz} byte${sz > 1 ? 's' : ''}; choose a wider element type.` };
    }
    bytes.push(...toBytes(v, bits, endian));
  }
  return { ok: true, value: { values, size: sz, bytes } };
}

// ---------- Base64 (RFC 4648) ----------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64Encode(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += b === undefined ? '=' : B64[(n >> 6) & 63];
    out += c === undefined ? '=' : B64[n & 63];
  }
  return out;
}

/** Decode standard or URL-safe Base64; whitespace is ignored and padding is optional. */
export function base64Decode(input: string): Result<number[]> {
  const s = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const body = s.replace(/=+$/, '');
  if (s.length - body.length > 2) return { ok: false, error: 'Too much “=” padding.' };
  const bad = [...body].find((c) => !B64.includes(c));
  if (bad !== undefined) return { ok: false, error: `“${bad}” is not a Base64 character.` };
  if (body.length % 4 === 1) return { ok: false, error: 'Base64 length is invalid (one character too many or too few).' };
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const c of body) {
    acc = (acc << 6) | B64.indexOf(c);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return { ok: true, value: out };
}

// ---------- C helpers for byte order ----------

/** C snippets that swap a value of `width` bits and load it from a byte buffer in either order. */
export function swapCode(value: bigint, width: 16 | 32 | 64): string {
  const n = width / 8;
  const t = `uint${width}_t`;
  const sfx = width === 64 ? 'ULL' : 'U';
  const hex = (v: bigint) => `0x${v.toString(16).toUpperCase().padStart(n * 2, '0')}${sfx}`;
  const v = BigInt.asUintN(width, value);
  const lines: string[] = [];
  lines.push(`${t} y = __builtin_bswap${width}(${hex(v)});  /* = ${hex(byteSwap(v, width))}, GCC / Clang */`);
  if (width === 16) {
    lines.push(`${t} y = __REV16(x);              /* CMSIS: swaps the bytes of each half-word */`);
    lines.push(`${t} y = _byteswap_ushort(x);     /* MSVC */`);
    lines.push(`${t} y = htons(x);  /* POSIX: host to network (big-endian) order; ntohs() back */`);
    lines.push('', '/* portable */', `${t} y = (${t})((x >> 8) | (x << 8));`);
  } else if (width === 32) {
    lines.push(`${t} y = __REV(x);                /* CMSIS: one REV instruction on Cortex-M3 and up */`);
    lines.push(`${t} y = _byteswap_ulong(x);      /* MSVC */`);
    lines.push(`${t} y = htonl(x);  /* POSIX: host to network (big-endian) order; ntohl() back */`);
    lines.push(
      '',
      '/* portable */',
      `static inline ${t} bswap32(${t} x)`,
      '{',
      '    return (x >> 24) | ((x >> 8) & 0x0000FF00U) | ((x << 8) & 0x00FF0000U) | (x << 24);',
      '}',
    );
  } else {
    lines.push(`${t} y = _byteswap_uint64(x);     /* MSVC */`);
    lines.push(
      '',
      '/* portable */',
      `static inline ${t} bswap64(${t} x)`,
      '{',
      '    return ((uint64_t)bswap32((uint32_t)x) << 32) | bswap32((uint32_t)(x >> 32));',
      '}',
    );
  }
  const le = Array.from({ length: n }, (_, i) => (i === 0 ? `(${t})p[0]` : `((${t})p[${i}] << ${i * 8})`));
  const be = Array.from({ length: n }, (_, i) => {
    const shift = (n - 1 - i) * 8;
    return shift === 0 ? `(${t})p[${i}]` : `((${t})p[${i}] << ${shift})`;
  });
  const join = (parts: string[]) => (n <= 2 ? parts.join(' | ') : parts.join('\n         | '));
  lines.push(
    '',
    '/* Load from a byte buffer, independent of the CPU byte order (and of alignment) */',
    `${t} le = ${join(le)};`,
    `${t} be = ${join(be)};`,
  );
  return lines.join('\n');
}
