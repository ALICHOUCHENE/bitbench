import { describe, expect, it } from 'vitest';
import { ASCII, cStringLiteral, searchAscii, textToBytes } from '../src/lib/ascii';

describe('ASCII table', () => {
  it('has 128 rows in order with consistent representations', () => {
    expect(ASCII).toHaveLength(128);
    ASCII.forEach((e, i) => {
      expect(e.code).toBe(i);
      expect(Number(e.dec)).toBe(i);
      expect(parseInt(e.hex, 16)).toBe(i);
      expect(parseInt(e.oct, 8)).toBe(i);
      expect(parseInt(e.bin, 2)).toBe(i);
      expect(e.bin).toHaveLength(7);
      expect(e.name.length).toBeGreaterThan(0);
    });
  });

  it('names all 33 control codes per ANSI X3.4 / ISO 646', () => {
    const expected: [string, string][] = [
      ['NUL', 'Null'], ['SOH', 'Start of Heading'], ['STX', 'Start of Text'], ['ETX', 'End of Text'],
      ['EOT', 'End of Transmission'], ['ENQ', 'Enquiry'], ['ACK', 'Acknowledge'], ['BEL', 'Bell'],
      ['BS', 'Backspace'], ['HT', 'Horizontal Tabulation'], ['LF', 'Line Feed'], ['VT', 'Vertical Tabulation'],
      ['FF', 'Form Feed'], ['CR', 'Carriage Return'], ['SO', 'Shift Out'], ['SI', 'Shift In'],
      ['DLE', 'Data Link Escape'], ['DC1', 'Device Control One'], ['DC2', 'Device Control Two'],
      ['DC3', 'Device Control Three'], ['DC4', 'Device Control Four'], ['NAK', 'Negative Acknowledge'],
      ['SYN', 'Synchronous Idle'], ['ETB', 'End of Transmission Block'], ['CAN', 'Cancel'], ['EM', 'End of Medium'],
      ['SUB', 'Substitute'], ['ESC', 'Escape'], ['FS', 'File Separator'], ['GS', 'Group Separator'],
      ['RS', 'Record Separator'], ['US', 'Unit Separator'],
    ];
    const controls = ASCII.filter((e) => e.isControl);
    expect(controls).toHaveLength(33);
    expected.forEach(([abbr, name], i) => {
      expect(ASCII[i].abbr).toBe(abbr);
      expect(ASCII[i].name).toBe(name);
      expect(ASCII[i].char).toBe('');
    });
    expect(ASCII[127]).toMatchObject({ abbr: 'DEL', name: 'Delete', caret: '^?', isControl: true });
  });

  it('printables', () => {
    expect(ASCII[32]).toMatchObject({ abbr: 'SP', name: 'Space', char: ' ', isControl: false });
    expect(ASCII[65]).toMatchObject({ char: 'A', name: 'Latin capital letter A', hex: '41', oct: '101', bin: '1000001' });
    expect(ASCII[48].name).toBe('Digit zero');
    expect(ASCII.slice(32, 127).every((e) => e.char.length === 1 && e.caret === null)).toBe(true);
  });

  it('caret notation', () => {
    expect(ASCII[0].caret).toBe('^@');
    expect(ASCII[1].caret).toBe('^A');
    expect(ASCII[26].caret).toBe('^Z');
    expect(ASCII[27].caret).toBe('^[');
    expect(ASCII[28].caret).toBe('^\\');
    expect(ASCII[31].caret).toBe('^_');
  });

  it('C escapes', () => {
    const esc = (i: number) => ASCII[i].cEscape;
    expect([0, 7, 8, 9, 10, 11, 12, 13].map(esc)).toEqual(['\\0', '\\a', '\\b', '\\t', '\\n', '\\v', '\\f', '\\r']);
    expect(esc(27)).toBe('\\x1B');
    expect(esc(1)).toBe('\\x01');
    expect(esc(127)).toBe('\\x7F');
    expect(esc(92)).toBe('\\\\');
    expect(esc(39)).toBe("\\'");
    expect(esc(34)).toBe('\\"');
    expect(esc(65)).toBe('A');
  });
});

describe('searchAscii', () => {
  const codes = (q: string, g?: Parameters<typeof searchAscii>[1]) => searchAscii(q, g).map((e) => e.code);
  it('empty query returns everything', () => {
    expect(codes('')).toHaveLength(128);
  });
  it('by character', () => {
    expect(codes('A')).toContain(65);
    expect(codes(' ')).toEqual([32]);
  });
  it('by code in any base', () => {
    expect(codes('0x41')).toEqual([65]);
    expect(codes('65')).toContain(65);
    expect(codes('41')).toEqual(expect.arrayContaining([41, 65])); // decimal 41 and hex 41
    expect(codes('0b1000001')).toEqual([65]);
    expect(codes('1000001')).toContain(65);
    expect(codes('0o101')).toEqual([65]);
    expect(codes('1B')).toEqual([27]);
  });
  it('by name, mnemonic, alias, caret and escape', () => {
    expect(codes('heading')).toEqual([1]);
    expect(codes('esc')).toContain(27);
    expect(codes('xoff')).toEqual([19]);
    expect(codes('^C')).toEqual([3]);
    expect(codes('\\n')).toEqual([10]);
    expect(codes('tab')).toEqual(expect.arrayContaining([9, 11]));
  });
  it('by group', () => {
    expect(codes('', 'control')).toHaveLength(33);
    expect(codes('', 'digit')).toHaveLength(10);
    expect(codes('', 'punct')).toHaveLength(32);
    expect(codes('', 'printable')).toHaveLength(95);
  });
});

describe('text → bytes', () => {
  it('ASCII text', () => {
    expect(textToBytes('AT\r\n')).toEqual({ bytes: [65, 84, 13, 10], nonAscii: [] });
  });
  it('flags non-ASCII characters with their UTF-8 bytes', () => {
    const r = textToBytes('é€é');
    expect(r.bytes).toEqual([0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xc3, 0xa9]);
    expect(r.nonAscii).toEqual([
      { char: 'é', codePoint: 0xe9, utf8: [0xc3, 0xa9] },
      { char: '€', codePoint: 0x20ac, utf8: [0xe2, 0x82, 0xac] },
    ]);
  });
  it('C string literal escapes and splits greedy escapes', () => {
    expect(cStringLiteral([65, 84, 13, 10])).toBe('"AT\\r\\n"');
    expect(cStringLiteral([0x1b, 0x41])).toBe('"\\x1B""A"');
    expect(cStringLiteral([0x1b, 0x5b])).toBe('"\\x1B["');
    expect(cStringLiteral([0, 0x31])).toBe('"\\0""1"');
    expect(cStringLiteral([34, 39, 92])).toBe('"\\"\'\\\\"');
  });
});
