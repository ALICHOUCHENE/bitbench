import { describe, expect, it } from 'vitest';
import {
  EDRX_S1,
  T3324_UNITS,
  T3412_EXT_UNITS,
  TIMER_DEACTIVATED,
  batteryStatesParam,
  cedrxsCommand,
  cedrxsDisableCommand,
  cpsmsCommand,
  cpsmsDisableCommand,
  decodeEdrx,
  decodeTimer,
  edrxAct,
  edrxOctet,
  edrxValidCycles,
  encodeTimer,
  findEdrx,
  findPtw,
  findTimer,
  hexByte,
  isEdrxValid,
  parseByte,
  parseModemResponse,
  parseNibble,
  ptwSeconds,
  ptwValues,
  splitParams,
  timelineSplit,
  timerBitsSpaced,
  timerEncodings,
  timerMaxSeconds,
  toBits,
} from '../src/lib/psm-edrx';

// Expected values transcribed independently from 3GPP TS 24.008 V19.5.0.
// Table 10.5.163a (GPRS Timer 3): unit bits 8-6 → seconds per step.
const T3412_STEPS: (number | null)[] = [600, 3600, 36000, 2, 30, 60, 320 * 3600, null];
// Table 10.5.172 (GPRS Timer, used by GPRS Timer 2): 011–110 are "interpreted as 1 minute".
const T3324_STEPS: (number | null)[] = [2, 60, 360, 60, 60, 60, 60, null];

describe('unit tables', () => {
  it('T3412 extended units match Table 10.5.163a', () => {
    expect(T3412_EXT_UNITS.map((u) => u.step)).toEqual(T3412_STEPS);
    expect(T3412_EXT_UNITS.map((u) => u.code)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(T3412_EXT_UNITS[7].status).toBe('deactivated');
    expect(T3412_EXT_UNITS.slice(0, 7).every((u) => u.status === 'ok')).toBe(true);
  });

  it('T3324 units match Table 10.5.172, with undefined codes reinterpreted as 1 minute', () => {
    expect(T3324_UNITS.map((u) => u.step)).toEqual(T3324_STEPS);
    expect(T3324_UNITS.map((u) => u.status)).toEqual([
      'ok', 'ok', 'ok', 'reinterpreted', 'reinterpreted', 'reinterpreted', 'reinterpreted', 'deactivated',
    ]);
  });
});

describe('decodeTimer — every byte', () => {
  for (let byte = 0; byte < 256; byte++) {
    const unit = byte >> 5;
    const value = byte & 31;
    it(`T3412 ${toBits(byte, 8)}`, () => {
      const d = decodeTimer('t3412', byte);
      const step = T3412_STEPS[unit];
      expect(d.unit.code).toBe(unit);
      expect(d.value).toBe(value);
      expect(d.seconds).toBe(step === null ? null : step * value);
      expect(d.bits).toBe(toBits(byte, 8));
    });
    it(`T3324 ${toBits(byte, 8)}`, () => {
      const d = decodeTimer('t3324', byte);
      const step = T3324_STEPS[unit];
      expect(d.seconds).toBe(step === null ? null : step * value);
      if (unit >= 3 && unit <= 6) expect(d.notes.join(' ')).toMatch(/interprets them as multiples of 1 minute/);
    });
  }

  it('matches the TS 27.007 §7.38 examples', () => {
    // "01000111" equals 70 hours (Requested_Periodic-TAU); "00100100" equals 4 minutes (Active-Time).
    expect(decodeTimer('t3412', 0b01000111).seconds).toBe(70 * 3600);
    expect(decodeTimer('t3324', 0b00100100).seconds).toBe(4 * 60);
  });

  it('flags special meanings', () => {
    expect(decodeTimer('t3412', 0b11100000).notes[0]).toMatch(/not applicable to the T3412 extended/);
    expect(decodeTimer('t3412', 0b00100000).notes[0]).toMatch(/deactivates T3412/);
    expect(decodeTimer('t3412', 0b11000001).notes[0]).toMatch(/integrity-protected/);
    expect(decodeTimer('t3412', 0b11000001).seconds).toBe(320 * 3600);
    expect(decodeTimer('t3324', 0b11100000).notes[0]).toMatch(/may not use PSM/);
    expect(decodeTimer('t3324', 0b00000000).notes[0]).toMatch(/Zero Active Time/);
    expect(decodeTimer('t3324', 0b00100101).notes).toEqual([]);
  });

  it('rejects non-bytes', () => {
    expect(() => decodeTimer('t3412', 256)).toThrow(RangeError);
    expect(() => decodeTimer('t3412', -1)).toThrow(RangeError);
    expect(() => decodeTimer('t3412', 1.5)).toThrow(RangeError);
  });
});

describe('encodeTimer / timerEncodings', () => {
  it('packs unit and value', () => {
    expect(encodeTimer(0b001, 6)).toBe(0b00100110);
    expect(encodeTimer(7, 31)).toBe(255);
    expect(() => encodeTimer(8, 0)).toThrow(RangeError);
    expect(() => encodeTimer(0, 32)).toThrow(RangeError);
  });

  it('every encoding round-trips through decodeTimer', () => {
    for (const kind of ['t3412', 't3324'] as const) {
      for (const e of timerEncodings(kind)) {
        const d = decodeTimer(kind, e.byte);
        expect(d.seconds).toBe(e.seconds);
        expect(d.unit.status).toBe('ok');
        expect(findTimer(kind, e.seconds).closest.byte).toBe(e.byte);
        expect(findTimer(kind, e.seconds).exact).toBe(true);
      }
    }
  });

  it('durations are unique, sorted and never use deactivated/undefined units', () => {
    for (const kind of ['t3412', 't3324'] as const) {
      const list = timerEncodings(kind);
      const secs = list.map((e) => e.seconds);
      expect(new Set(secs).size).toBe(secs.length);
      expect([...secs].sort((a, b) => a - b)).toEqual(secs);
      expect(list.every((e) => e.byte >> 5 !== 7)).toBe(true);
    }
    expect(timerEncodings('t3324').every((e) => e.byte >> 5 <= 2)).toBe(true);
  });

  it('covers every (unit, value) duration reachable with defined units', () => {
    const want = new Set<number>();
    for (const s of T3412_STEPS.slice(0, 7)) for (let v = 0; v < 32; v++) want.add(s! * v);
    expect(new Set(timerEncodings('t3412').map((e) => e.seconds))).toEqual(want);
    const want2 = new Set<number>();
    for (const s of [2, 60, 360]) for (let v = 0; v < 32; v++) want2.add(s * v);
    expect(new Set(timerEncodings('t3324').map((e) => e.seconds))).toEqual(want2);
  });

  it('prefers the coarsest unit for duplicated durations, finest for zero', () => {
    expect(findTimer('t3412', 60).closest.bits).toBe('10100001'); // 1 min × 1, not 2 s × 30
    expect(findTimer('t3412', 3600).closest.bits).toBe('00100001'); // 1 h × 1, not 10 min × 6
    expect(findTimer('t3324', 360).closest.bits).toBe('01000001'); // 1 decihour, not 6 × 1 min
    expect(findTimer('t3324', 60).closest.bits).toBe('00100001'); // 1 min, not 2 s × 30
    expect(findTimer('t3412', 0).closest.bits).toBe('01100000');
    expect(findTimer('t3324', 0).closest.bits).toBe('00000000');
  });

  it('knows the maxima', () => {
    expect(timerMaxSeconds('t3412')).toBe(31 * 320 * 3600);
    expect(timerMaxSeconds('t3324')).toBe(31 * 360);
  });
});

describe('findTimer', () => {
  it('finds exact common values', () => {
    expect(findTimer('t3412', 24 * 3600).closest.bits).toBe('00111000'); // 1 h × 24
    expect(findTimer('t3324', 20).closest.bits).toBe('00001010'); // 2 s × 10
  });

  it('reports closest, not-below and not-above when inexact', () => {
    // T3324: 63 s lies between 62 s (2 s × 31) and 120 s (1 min × 2).
    const r = findTimer('t3324', 63);
    expect(r.exact).toBe(false);
    expect(r.closest.seconds).toBe(62);
    expect(r.notAbove!.seconds).toBe(62);
    expect(r.notBelow!.seconds).toBe(120);
    // T3412: 200 h lies between 190 h (10 h × 19) and 200 h (10 h × 20) → exact.
    expect(findTimer('t3412', 200 * 3600).exact).toBe(true);
    // 330 h: 320 h (320 h × 1) vs 640 h → closest 320 h, not-below 640 h.
    const big = findTimer('t3412', 330 * 3600);
    expect(big.closest.seconds).toBe(320 * 3600);
    expect(big.notBelow!.seconds).toBe(640 * 3600);
  });

  it('breaks ties towards the longer value', () => {
    // T3324 has no value between 62 s (2 s × 31) and 120 s (1 min × 2); 91 s is exactly midway.
    const r = findTimer('t3324', 91);
    expect(r.closest.seconds).toBe(120);
  });

  it('clamps above the maximum', () => {
    const r = findTimer('t3324', 10 * 3600);
    expect(r.aboveMax).toBe(true);
    expect(r.notBelow).toBeNull();
    expect(r.closest.seconds).toBe(31 * 360);
    expect(findTimer('t3412', 1e9).closest.bits).toBe('11011111');
  });

  it('handles zero and rejects bad input', () => {
    expect(findTimer('t3412', 0).exact).toBe(true);
    expect(findTimer('t3412', 0.5).closest.seconds).toBe(0); // 0.5 s is nearer 0 than 2 s
    expect(findTimer('t3412', 1).closest.seconds).toBe(2); // tie → longer
    expect(() => findTimer('t3412', -1)).toThrow(RangeError);
    expect(() => findTimer('t3412', NaN)).toThrow(RangeError);
  });
});

describe('parseByte', () => {
  const ok: [string, number][] = [
    ['00101010', 0x2a],
    ['001 01010', 0x2a],
    ['0010 1010', 0x2a],
    ['0010_1010', 0x2a],
    [' "00101010" ', 0x2a],
    ['0b00101010', 0x2a],
    ['0b101010', 0x2a],
    ['0x2A', 0x2a],
    ['0X2a', 0x2a],
    ['2A', 0x2a],
    ['2a', 0x2a],
    ['2Ah', 0x2a],
    ['10', 0x10],
    ['FF', 255],
    ['0', 0],
    ['11111111', 255],
  ];
  for (const [input, value] of ok) it(`accepts ${JSON.stringify(input)}`, () => expect(parseByte(input)).toEqual({ ok: true, value }));

  const bad = ['', '   ', '0010101', '001010101', '0x100', '123', 'zz', '0b2', '-1', '1.5'];
  for (const input of bad) it(`rejects ${JSON.stringify(input)}`, () => expect(parseByte(input).ok).toBe(false));

  it('gives a specific message for wrong bit counts', () => {
    const r = parseByte('0010101');
    expect(r.ok === false && r.error).toMatch(/exactly 8 bits; got 7/);
  });
});

describe('parseNibble', () => {
  const ok: [string, number][] = [
    ['0101', 5],
    ['0b0101', 5],
    ['0b101', 5],
    ['5', 5],
    ['0x5', 5],
    ['A', 10],
    ['f', 15],
    ['"1111"', 15],
    ['0000', 0],
  ];
  for (const [input, value] of ok) it(`accepts ${JSON.stringify(input)}`, () => expect(parseNibble(input)).toEqual({ ok: true, value }));
  const bad = ['', '010', '01010', '0x10', 'G', '16', '0b10101'];
  for (const input of bad) it(`rejects ${JSON.stringify(input)}`, () => expect(parseNibble(input).ok).toBe(false));
});

describe('formatting helpers', () => {
  it('formats bits and hex', () => {
    expect(timerBitsSpaced(0b00100110)).toBe('001 00110');
    expect(hexByte(0x2a)).toBe('0x2A');
    expect(hexByte(5)).toBe('0x05');
    expect(toBits(5, 4)).toBe('0101');
    expect(TIMER_DEACTIVATED).toBe(0b11100000);
  });
});

describe('eDRX (Table 10.5.5.32, S1 mode)', () => {
  const SECONDS = [5.12, 10.24, 20.48, 40.96, 61.44, 81.92, 102.4, 122.88, 143.36, 163.84, 327.68, 655.36, 1310.72, 2621.44, 5242.88, 10485.76];
  const HF = [null, 1, 2, 4, 6, 8, 10, 12, 14, 16, 32, 64, 128, 256, 512, 1024];

  it('has every row', () => {
    expect(EDRX_S1.map((c) => c.seconds)).toEqual(SECONDS);
    expect(EDRX_S1.map((c) => c.hyperframes)).toEqual(HF);
    EDRX_S1.forEach((c, i) => {
      expect(c.code).toBe(i);
      if (c.hyperframes) expect(c.seconds).toBeCloseTo(c.hyperframes * 10.24, 9);
    });
  });

  it('WB-S1 valid set is 0000–1101 (max 256 hyperframes)', () => {
    expect(edrxValidCycles('wb').map((c) => c.code)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it('NB-S1 valid set is 0010, 0011, 0101, 1001–1111', () => {
    expect(edrxValidCycles('nb').map((c) => c.code)).toEqual([2, 3, 5, 9, 10, 11, 12, 13, 14, 15]);
  });

  for (let code = 0; code < 16; code++) {
    it(`decodes ${toBits(code, 4)} in both modes`, () => {
      const wb = decodeEdrx('wb', code);
      const nb = decodeEdrx('nb', code);
      expect(wb.nominal.seconds).toBe(SECONDS[code]);
      expect(nb.nominal.seconds).toBe(SECONDS[code]);
      // WB-S1
      if (code >= 14) {
        expect(wb.status).toBe('reinterpreted');
        expect(wb.effective!.code).toBe(0b1101);
        expect(wb.note).toMatch(/NOTE 6/);
      } else {
        expect(wb.status).toBe('ok');
        expect(wb.effective!.seconds).toBe(SECONDS[code]);
      }
      // NB-S1
      if (code <= 1) {
        expect(nb.status).toBe('ignored');
        expect(nb.effective).toBeNull();
        expect(nb.note).toMatch(/NOTE 4/);
      } else if ([4, 6, 7, 8].includes(code)) {
        expect(nb.status).toBe('reinterpreted');
        expect(nb.effective!.code).toBe(0b0010);
        expect(nb.note).toMatch(/NOTE 5/);
      } else {
        expect(nb.status).toBe('ok');
        expect(nb.effective!.seconds).toBe(SECONDS[code]);
      }
      expect(isEdrxValid('wb', code)).toBe(wb.status === 'ok');
      expect(isEdrxValid('nb', code)).toBe(nb.status === 'ok');
    });
  }

  it('rejects out-of-range codes', () => {
    expect(() => decodeEdrx('wb', 16)).toThrow(RangeError);
  });

  it('finds the nearest valid cycle per mode', () => {
    expect(findEdrx('wb', 60).closest.code).toBe(0b0100); // 61.44 s
    expect(findEdrx('nb', 60).closest.code).toBe(0b0011); // 40.96 s (61.44 not valid in NB)
    expect(findEdrx('nb', 60).notBelow!.code).toBe(0b0101); // 81.92 s
    expect(findEdrx('wb', 3 * 3600).closest.code).toBe(0b1101); // WB max 2621.44 s
    expect(findEdrx('wb', 3 * 3600).aboveMax).toBe(true);
    expect(findEdrx('nb', 3 * 3600).closest.code).toBe(0b1111);
    expect(findEdrx('nb', 1).closest.code).toBe(0b0010); // NB min 20.48 s
    expect(findEdrx('nb', 1).notAbove).toBeNull();
    expect(findEdrx('wb', 0).closest.code).toBe(0);
    for (const mode of ['wb', 'nb'] as const)
      for (const c of edrxValidCycles(mode)) expect(findEdrx(mode, c.seconds).closest.code).toBe(c.code);
  });
});

describe('PTW', () => {
  const WB = [1.28, 2.56, 3.84, 5.12, 6.4, 7.68, 8.96, 10.24, 11.52, 12.8, 14.08, 15.36, 16.64, 17.92, 19.2, 20.48];
  const NB = [2.56, 5.12, 7.68, 10.24, 12.8, 15.36, 17.92, 20.48, 23.04, 25.6, 28.16, 30.72, 33.28, 35.84, 38.4, 40.96];

  it('matches every WB-S1 and NB-S1 row of Table 10.5.5.32', () => {
    expect(ptwValues('wb').map((p) => p.seconds)).toEqual(WB);
    expect(ptwValues('nb').map((p) => p.seconds)).toEqual(NB);
    for (let n = 0; n < 16; n++) {
      expect(ptwSeconds('wb', n)).toBe(WB[n]);
      expect(ptwSeconds('nb', n)).toBe(NB[n]);
      expect(findPtw('wb', WB[n]).closest.code).toBe(n);
      expect(findPtw('nb', NB[n]).closest.code).toBe(n);
    }
    expect(() => ptwSeconds('wb', 16)).toThrow(RangeError);
  });

  it('finds the nearest window', () => {
    expect(findPtw('wb', 10).closest.code).toBe(7); // 10.24 s
    expect(findPtw('nb', 10).closest.code).toBe(3); // 10.24 s
    expect(findPtw('wb', 100).closest.code).toBe(15);
    expect(findPtw('wb', 0).closest.code).toBe(0);
  });

  it('packs octet 3', () => {
    expect(edrxOctet(0b0011, 0b0101)).toBe(0b00110101);
  });
});

describe('AT commands', () => {
  it('builds +CPSMS with the TS 27.007 parameter order', () => {
    expect(cpsmsCommand(0b00100110, 0b00000101)).toBe('AT+CPSMS=1,,,"00100110","00000101"');
    expect(cpsmsCommand(0, 255)).toBe('AT+CPSMS=1,,,"00000000","11111111"');
    expect(() => cpsmsCommand(256, 0)).toThrow(RangeError);
    expect(cpsmsDisableCommand()).toBe('AT+CPSMS=0');
    expect(cpsmsDisableCommand(true)).toBe('AT+CPSMS=2');
  });

  it('builds +CEDRXS', () => {
    expect(edrxAct('wb')).toBe(4);
    expect(edrxAct('nb')).toBe(5);
    expect(cedrxsCommand(true, 'wb', 0b0101)).toBe('AT+CEDRXS=2,4,"0101"');
    expect(cedrxsCommand(false, 'nb', 0b1111)).toBe('AT+CEDRXS=1,5,"1111"');
    expect(() => cedrxsCommand(true, 'wb', 16)).toThrow(RangeError);
    expect(cedrxsDisableCommand()).toBe('AT+CEDRXS=0');
    expect(cedrxsDisableCommand(true)).toBe('AT+CEDRXS=3');
  });
});

describe('parseModemResponse', () => {
  it('splits parameters respecting quotes', () => {
    expect(splitParams('1,"00,1",,3')).toEqual(['1', '00,1', '', '3']);
  });

  it('decodes a +CEREG URC (n=4)', () => {
    const [r] = parseModemResponse('+CEREG: 1,"002F","0012BEEF",7,,,"00000110","00111000"');
    expect(r.kind).toBe('cereg');
    if (r.kind !== 'cereg') return;
    expect(r.activeTime!.seconds).toBe(12);
    expect(r.periodicTau!.seconds).toBe(24 * 3600);
  });

  it('decodes a +CEREG? read response (leading <n>)', () => {
    const [r] = parseModemResponse('OK\r\n+CEREG: 4,5,"002F","0012BEEF",9,,,"00100001","10100101"\r\nOK');
    expect(r.kind).toBe('cereg');
    if (r.kind !== 'cereg') return;
    expect(r.activeTime!.seconds).toBe(60);
    expect(r.periodicTau!.seconds).toBe(5 * 60);
  });

  it('explains a +CEREG line without timers', () => {
    const [r] = parseModemResponse('+CEREG: 2,1,"002F","0012BEEF",7');
    expect(r.kind).toBe('error');
  });

  it('decodes +CEDRXP / +CEDRXRDP', () => {
    const [a, b] = parseModemResponse('+CEDRXP: 4,"0101","0101","0011"\n+CEDRXRDP: 5,"0010","1001","0111"');
    expect(a.kind === 'cedrx' && a.mode).toBe('wb');
    if (a.kind === 'cedrx') {
      expect(a.requested).toBe(5);
      expect(a.granted).toBe(5);
      expect(a.ptw).toBe(3);
    }
    expect(b.kind === 'cedrx' && b.mode).toBe('nb');
    if (b.kind === 'cedrx') expect(b.granted).toBe(9);
  });

  it('decodes +CPSMS? and ignores other lines', () => {
    const r = parseModemResponse('AT+CPSMS?\n+CPSMS: 1,,,"00100110","00000101"\nOK');
    expect(r).toHaveLength(1);
    expect(r[0].kind === 'cpsms' && r[0].periodicTau!.seconds).toBe(6 * 3600);
    expect(r[0].kind === 'cpsms' && r[0].activeTime!.seconds).toBe(10);
  });
});

describe('batteryStatesParam', () => {
  it('follows the label:current_mA:duration_s;… contract, URL-encoded', () => {
    const p = batteryStatesParam([
      { label: 'Active', currentMa: 6, seconds: 20 },
      { label: 'PSM sleep', currentMa: 0.003, seconds: 3580 },
    ]);
    expect(p).toBe(encodeURIComponent('Active:6:20;PSM sleep:0.003:3580'));
    expect(decodeURIComponent(p)).toBe('Active:6:20;PSM sleep:0.003:3580');
  });

  it('drops zero-length states and sanitises separators in labels', () => {
    const p = decodeURIComponent(
      batteryStatesParam([
        { label: 'Con:nected', currentMa: 100, seconds: 0 },
        { label: 'A;B', currentMa: 1, seconds: 1.28 * 3 },
      ]),
    );
    expect(p).toBe('A B:1:3.84');
  });
});

describe('timelineSplit', () => {
  it('stays linear for comparable durations', () => {
    expect(timelineSplit(30, 70)).toEqual({ broken: false, activeShare: 0.3, sleepShare: 0.7 });
  });
  it('breaks the axis for extreme ratios', () => {
    const s = timelineSplit(2, 320 * 3600);
    expect(s.broken).toBe(true);
    expect(s.activeShare).toBeGreaterThan(0.1);
    expect(s.activeShare + s.sleepShare).toBeCloseTo(1, 12);
    expect(timelineSplit(99, 1).broken).toBe(true);
  });
  it('handles empty parts', () => {
    expect(timelineSplit(0, 10).sleepShare).toBe(1);
    expect(timelineSplit(10, 0).activeShare).toBe(1);
    expect(timelineSplit(0, 0).broken).toBe(false);
  });
});
