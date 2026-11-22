// The 7-bit ASCII table (ANSI X3.4 / ISO 646 IRV) with control-character names, caret notation
// and C escapes, plus search and a text → bytes converter. Pure functions, no DOM.

export interface AsciiEntry {
  code: number;
  dec: string;
  hex: string;
  oct: string;
  bin: string;
  /** The printable glyph, or '' for control characters (and ' ' for space). */
  char: string;
  /** Mnemonic for control characters and space (NUL, SOH … US, SP, DEL), else null. */
  abbr: string | null;
  /** Full name, e.g. "Start of Heading", "Latin capital letter A". */
  name: string;
  /** Caret notation (^@, ^A … ^_, ^?) for control characters, else null. */
  caret: string | null;
  /** How to write the character in a C char literal (without the quotes). */
  cEscape: string;
  /** Common other names and notes, used for search ("tab", "XON", "Ctrl-C"). */
  aka: string;
  isControl: boolean;
}

// Names per ANSI X3.4-1986 / ECMA-6 (ISO 646). HT and VT are "Horizontal/Vertical Tabulation".
export const CONTROL_NAMES: [abbr: string, name: string, aka: string][] = [
  ['NUL', 'Null', 'null terminator, string end'],
  ['SOH', 'Start of Heading', ''],
  ['STX', 'Start of Text', 'frame start'],
  ['ETX', 'End of Text', 'Ctrl-C, interrupt, frame end'],
  ['EOT', 'End of Transmission', 'Ctrl-D, Unix end of file'],
  ['ENQ', 'Enquiry', ''],
  ['ACK', 'Acknowledge', ''],
  ['BEL', 'Bell', 'alert, beep'],
  ['BS', 'Backspace', ''],
  ['HT', 'Horizontal Tabulation', 'tab'],
  ['LF', 'Line Feed', 'newline, NL, Unix line ending'],
  ['VT', 'Vertical Tabulation', 'vertical tab'],
  ['FF', 'Form Feed', 'new page'],
  ['CR', 'Carriage Return', 'Enter, AT command terminator'],
  ['SO', 'Shift Out', ''],
  ['SI', 'Shift In', ''],
  ['DLE', 'Data Link Escape', 'byte stuffing'],
  ['DC1', 'Device Control One', 'XON, Ctrl-Q, software flow control resume'],
  ['DC2', 'Device Control Two', ''],
  ['DC3', 'Device Control Three', 'XOFF, Ctrl-S, software flow control pause'],
  ['DC4', 'Device Control Four', ''],
  ['NAK', 'Negative Acknowledge', 'NACK'],
  ['SYN', 'Synchronous Idle', ''],
  ['ETB', 'End of Transmission Block', ''],
  ['CAN', 'Cancel', 'Ctrl-X'],
  ['EM', 'End of Medium', ''],
  ['SUB', 'Substitute', 'Ctrl-Z, DOS end of file, SMS send'],
  ['ESC', 'Escape', 'ANSI escape sequences, \\e'],
  ['FS', 'File Separator', 'IS4'],
  ['GS', 'Group Separator', 'IS3'],
  ['RS', 'Record Separator', 'IS2'],
  ['US', 'Unit Separator', 'IS1'],
];

const C_ESCAPES: Record<number, string> = {
  0: '\\0',
  7: '\\a',
  8: '\\b',
  9: '\\t',
  10: '\\n',
  11: '\\v',
  12: '\\f',
  13: '\\r',
  34: '\\"',
  39: "\\'",
  92: '\\\\',
};

const PUNCT_NAMES: Record<number, string> = {
  32: 'Space', 33: 'Exclamation mark', 34: 'Quotation mark', 35: 'Number sign (hash)', 36: 'Dollar sign',
  37: 'Percent sign', 38: 'Ampersand', 39: 'Apostrophe', 40: 'Left parenthesis', 41: 'Right parenthesis',
  42: 'Asterisk', 43: 'Plus sign', 44: 'Comma', 45: 'Hyphen-minus', 46: 'Full stop (period)', 47: 'Solidus (slash)',
  58: 'Colon', 59: 'Semicolon', 60: 'Less-than sign', 61: 'Equals sign', 62: 'Greater-than sign', 63: 'Question mark',
  64: 'Commercial at', 91: 'Left square bracket', 92: 'Reverse solidus (backslash)', 93: 'Right square bracket',
  94: 'Circumflex accent (caret)', 95: 'Low line (underscore)', 96: 'Grave accent (backtick)', 123: 'Left curly bracket',
  124: 'Vertical line (pipe)', 125: 'Right curly bracket', 126: 'Tilde',
};

const DIGIT_NAMES = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

function entry(code: number): AsciiEntry {
  const isControl = code < 32 || code === 127;
  let abbr: string | null = null;
  let name: string;
  let aka = '';
  let char = '';
  if (code < 32) [abbr, name, aka] = CONTROL_NAMES[code];
  else if (code === 127) [abbr, name, aka] = ['DEL', 'Delete', 'rubout'];
  else {
    char = String.fromCharCode(code);
    if (code === 32) abbr = 'SP';
    if (code >= 48 && code <= 57) name = `Digit ${DIGIT_NAMES[code - 48].toLowerCase()}`;
    else if (code >= 65 && code <= 90) name = `Latin capital letter ${char}`;
    else if (code >= 97 && code <= 122) name = `Latin small letter ${char}`;
    else name = PUNCT_NAMES[code];
  }
  let caret: string | null = null;
  if (code < 32) caret = `^${String.fromCharCode(code + 64)}`;
  else if (code === 127) caret = '^?';
  const cEscape = C_ESCAPES[code] ?? (isControl ? `\\x${code.toString(16).toUpperCase().padStart(2, '0')}` : char);
  return {
    code,
    dec: String(code),
    hex: code.toString(16).toUpperCase().padStart(2, '0'),
    oct: code.toString(8).padStart(3, '0'),
    bin: code.toString(2).padStart(7, '0'),
    char,
    abbr,
    name: name!,
    caret,
    cEscape,
    aka,
    isControl,
  };
}

export const ASCII: AsciiEntry[] = Array.from({ length: 128 }, (_, i) => entry(i));

export type AsciiGroup = 'all' | 'control' | 'printable' | 'digit' | 'upper' | 'lower' | 'punct';

export function inGroup(e: AsciiEntry, g: AsciiGroup): boolean {
  const c = e.code;
  switch (g) {
    case 'all':
      return true;
    case 'control':
      return e.isControl;
    case 'printable':
      return !e.isControl;
    case 'digit':
      return c >= 48 && c <= 57;
    case 'upper':
      return c >= 65 && c <= 90;
    case 'lower':
      return c >= 97 && c <= 122;
    case 'punct':
      return !e.isControl && c !== 32 && !/[0-9A-Za-z]/.test(e.char);
  }
}

/**
 * Does an entry match a search query? A query matches when it is the character itself, a code in
 * decimal / hex / octal / binary (prefixes 0x, 0o, 0b narrow the base), the mnemonic, caret
 * notation, C escape, or part of the name or aliases (case-insensitive).
 */
export function matchesQuery(e: AsciiEntry, query: string): boolean {
  const q = query.trim() === '' ? query : query.trim();
  if (q === '') return true;
  if (q === e.char) return true;
  const lower = q.toLowerCase();
  if (e.cEscape === q || `'${e.cEscape}'` === q) return true;
  if (e.caret && e.caret.toLowerCase() === lower) return true;
  if (e.abbr && e.abbr.toLowerCase() === lower) return true;
  let m: RegExpExecArray | null;
  if ((m = /^0x([0-9a-f]{1,2})$/i.exec(q)) || (m = /^\\x([0-9a-f]{1,2})$/i.exec(q))) return parseInt(m[1], 16) === e.code;
  if ((m = /^0b([01]{1,8})$/i.exec(q))) return parseInt(m[1], 2) === e.code;
  if ((m = /^(?:0o|\\)([0-7]{1,3})$/i.exec(q))) return parseInt(m[1], 8) === e.code;
  if (/^\d+$/.test(q)) {
    if (Number(q) === e.code) return true;
    if (/^[0-7]+$/.test(q) && q.length === 3 && parseInt(q, 8) === e.code) return true;
    if (/^[01]{7,8}$/.test(q) && parseInt(q, 2) === e.code) return true;
  }
  if (/^[0-9a-f]{2}$/i.test(q) && parseInt(q, 16) === e.code) return true;
  if (q.length >= 2 && (e.name.toLowerCase().includes(lower) || e.aka.toLowerCase().includes(lower))) return true;
  return false;
}

export function searchAscii(query: string, group: AsciiGroup = 'all'): AsciiEntry[] {
  return ASCII.filter((e) => inGroup(e, group) && matchesQuery(e, query));
}

// ---------- Text → bytes ----------

export interface TextBytes {
  bytes: number[];
  /** Characters outside 7-bit ASCII with their code point and UTF-8 bytes. */
  nonAscii: { char: string; codePoint: number; utf8: number[] }[];
}

const encoder = new TextEncoder();

/** Encode text as UTF-8 and list the characters that are not ASCII. */
export function textToBytes(text: string): TextBytes {
  const nonAscii: TextBytes['nonAscii'] = [];
  const seen = new Set<string>();
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0x7f && !seen.has(ch)) {
      seen.add(ch);
      nonAscii.push({ char: ch, codePoint: cp, utf8: [...encoder.encode(ch)] });
    }
  }
  return { bytes: [...encoder.encode(text)], nonAscii };
}

/** Render bytes as a C string literal, escaping controls, quotes, backslashes and non-ASCII. */
export function cStringLiteral(bytes: number[]): string {
  let out = '';
  let prevHex = false;
  let prevNul = false;
  for (const b of bytes) {
    let piece: string;
    if (C_ESCAPES[b] !== undefined && b !== 39) piece = C_ESCAPES[b];
    else if (b < 32 || b >= 127) piece = `\\x${b.toString(16).toUpperCase().padStart(2, '0')}`;
    else piece = String.fromCharCode(b);
    // "\x1B" followed by a hex digit would extend the escape: split the literal.
    // "\0" followed by an octal digit would become an octal escape: split too.
    if ((prevHex && /^[0-9a-fA-F]/.test(piece)) || (prevNul && /^[0-7]/.test(piece))) out += '""';
    out += piece;
    prevHex = piece.startsWith('\\x');
    prevNul = piece === '\\0';
  }
  return `"${out}"`;
}
