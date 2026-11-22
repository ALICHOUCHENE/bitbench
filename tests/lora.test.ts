import { describe, expect, it } from 'vitest';
import {
  LORAWAN_OVERHEAD_BYTES,
  dutyCycleOffTime,
  effectivePayloadRate,
  fairUseMessagesPerDay,
  ldroRequired,
  loraTimeOnAir,
  maxMessages,
  payloadSymbols,
  rawBitRate,
  resolveLdro,
  sfSweep,
  symbolTime,
  validateLora,
  type LoraParams,
} from '../src/lib/lora';

const base: LoraParams = {
  sf: 7,
  bw: 125_000,
  cr: 1,
  payload: 20,
  preamble: 8,
  implicitHeader: false,
  crc: true,
  ldro: 'auto',
};

describe('symbolTime', () => {
  it('is 2^SF / BW', () => {
    expect(symbolTime(7, 125_000)).toBeCloseTo(1.024e-3, 12);
    expect(symbolTime(12, 125_000)).toBeCloseTo(32.768e-3, 12);
    expect(symbolTime(12, 500_000)).toBeCloseTo(8.192e-3, 12);
  });
});

describe('LDRO auto (symbol time exceeds 16 ms)', () => {
  it('is on for SF11/SF12 at 125 kHz and SF12 at 250 kHz only', () => {
    expect(ldroRequired(10, 125_000)).toBe(false); // 8.192 ms
    expect(ldroRequired(11, 125_000)).toBe(true); // 16.384 ms
    expect(ldroRequired(12, 125_000)).toBe(true);
    expect(ldroRequired(11, 250_000)).toBe(false); // 8.192 ms
    expect(ldroRequired(12, 250_000)).toBe(true); // 16.384 ms
    expect(ldroRequired(12, 500_000)).toBe(false); // 8.192 ms
  });

  it('uses a strict threshold: exactly 16 ms is not "exceeds"', () => {
    // 2^7 / 8000 Hz = 16 ms exactly (not a real LoRa bandwidth, but exercises the boundary).
    expect(ldroRequired(7, 8000)).toBe(false);
    expect(ldroRequired(7, 7999)).toBe(true);
  });

  it('On / Off override Auto', () => {
    expect(resolveLdro('on', 7, 125_000)).toBe(true);
    expect(resolveLdro('off', 12, 125_000)).toBe(false);
    expect(resolveLdro('auto', 12, 125_000)).toBe(true);
  });
});

describe('loraTimeOnAir — reference values', () => {
  it('SF7 / 125 kHz / CR4/5 / 20 B / explicit / CRC / preamble 8 = 56.576 ms', () => {
    // Tsym 1.024 ms; preamble 12.25 sym = 12.544 ms
    // ceil((160 − 28 + 28 + 16) / 28) = ceil(6.29) = 7 → 7·5 + 8 = 43 symbols = 44.032 ms
    const r = loraTimeOnAir(base);
    expect(r.preambleSymbols).toBe(12.25);
    expect(r.preambleTime).toBeCloseTo(12.544e-3, 12);
    expect(r.payloadSymbols).toBe(43);
    expect(r.payloadTime).toBeCloseTo(44.032e-3, 12);
    expect(r.timeOnAir).toBeCloseTo(56.576e-3, 12);
    expect(r.ldro).toBe(false);
  });

  it('SF12 / 125 kHz / CR4/5 / 51 B / LDRO = 2465.792 ms', () => {
    // Tsym 32.768 ms; preamble 12.25 · 32.768 = 401.408 ms
    // ceil((408 − 48 + 28 + 16) / (4·10)) = ceil(10.1) = 11 → 55 + 8 = 63 sym = 2064.384 ms
    const r = loraTimeOnAir({ ...base, sf: 12, payload: 51 });
    expect(r.ldro).toBe(true);
    expect(r.payloadSymbols).toBe(63);
    expect(r.timeOnAir).toBeCloseTo(2465.792e-3, 12);
  });

  it('SF12 / 125 kHz / 51 B with LDRO forced off is shorter (2138.112 ms)', () => {
    // ceil(404 / 48) = ceil(8.42) = 9 → 45 + 8 = 53 sym = 1736.704 ms; + 401.408 = 2138.112 ms
    const r = loraTimeOnAir({ ...base, sf: 12, payload: 51, ldro: 'off' });
    expect(r.payloadSymbols).toBe(53);
    expect(r.timeOnAir).toBeCloseTo(2138.112e-3, 12);
  });

  it('SF9 / 125 kHz / CR4/5 / 12 B = 144.384 ms', () => {
    // Tsym 4.096 ms; ceil((96 − 36 + 28 + 16) / 36) = ceil(2.89) = 3 → 15 + 8 = 23 sym
    // (12.25 + 23) · 4.096 = 144.384 ms
    const r = loraTimeOnAir({ ...base, sf: 9, payload: 12 });
    expect(r.payloadSymbols).toBe(23);
    expect(r.timeOnAir).toBeCloseTo(144.384e-3, 12);
  });

  it('SF7 / 500 kHz / CR4/8 / 255 B', () => {
    // Tsym 0.256 ms; ceil((2040 − 28 + 28 + 16) / 28) = ceil(73.43) = 74 → 74·8 + 8 = 600 sym
    // (12.25 + 600) · 0.256 = 156.736 ms
    const r = loraTimeOnAir({ ...base, bw: 500_000, cr: 4, payload: 255 });
    expect(r.payloadSymbols).toBe(600);
    expect(r.timeOnAir).toBeCloseTo(156.736e-3, 12);
  });

  it('implicit header removes 20 bits', () => {
    // SF7 20 B CRC implicit: ceil((160 − 28 + 28 + 16 − 20) / 28) = ceil(5.57) = 6 → 38 sym
    const r = loraTimeOnAir({ ...base, implicitHeader: true });
    expect(r.payloadSymbols).toBe(38);
    expect(r.timeOnAir).toBeCloseTo((12.25 + 38) * 1.024e-3, 12);
  });

  it('CRC off removes 16 bits', () => {
    // ceil((160 − 28 + 28) / 28) = ceil(5.71) = 6 → 38 sym
    expect(loraTimeOnAir({ ...base, crc: false }).payloadSymbols).toBe(38);
  });

  it('payload 0 still sends the 8-symbol header block', () => {
    // ceil((0 − 28 + 28 + 16) / 28) = ceil(0.571) = 1 → 5 + 8 = 13 sym
    expect(payloadSymbols(7, 1, 0, true, false, false)).toBe(13);
  });

  it('max(…, 0) branch: negative numerator clamps to exactly 8 symbols', () => {
    // SF12, 0 B, no CRC, implicit: 0 − 48 + 28 − 20 = −40 → ceil(−40/48) = −0 → 8 symbols
    expect(payloadSymbols(12, 1, 0, false, true, false)).toBe(8);
    // SF12, 0 B, implicit, no CRC, LDRO: −40 / 40 = −1 → −1·(CR+4) = −5 → max(−5, 0) = 0 → 8
    expect(payloadSymbols(12, 1, 0, false, true, true)).toBe(8);
    // SF12, 1 B, implicit, no CRC, LDRO: 8 − 48 + 28 − 20 = −32 → ceil(−0.8) = 0 → 8
    expect(payloadSymbols(12, 4, 1, false, true, true)).toBe(8);
    const r = loraTimeOnAir({ ...base, sf: 12, payload: 0, crc: false, implicitHeader: true, ldro: 'off' });
    expect(r.timeOnAir).toBeCloseTo((12.25 + 8) * 32.768e-3, 12);
  });

  it('coding rate scales the payload blocks', () => {
    // SF7 20 B: 7 blocks · (CR + 4) + 8
    expect(payloadSymbols(7, 1, 20, true, false, false)).toBe(43);
    expect(payloadSymbols(7, 2, 20, true, false, false)).toBe(50);
    expect(payloadSymbols(7, 3, 20, true, false, false)).toBe(57);
    expect(payloadSymbols(7, 4, 20, true, false, false)).toBe(64);
  });

  it('preamble length adds whole symbols', () => {
    const a = loraTimeOnAir(base).timeOnAir;
    const b = loraTimeOnAir({ ...base, preamble: 16 }).timeOnAir;
    expect(b - a).toBeCloseTo(8 * 1.024e-3, 12);
  });
});

describe('bit rates', () => {
  it('raw bit rate matches the indicative LoRaWAN rates', () => {
    expect(rawBitRate(12, 125_000, 1)).toBeCloseTo(292.97, 2); // RP002 lists 250 (rounded down)
    expect(rawBitRate(7, 125_000, 1)).toBeCloseTo(5468.75, 6); // RP002: 5470
    expect(rawBitRate(7, 250_000, 1)).toBeCloseTo(10937.5, 6); // RP002: 11000
    expect(rawBitRate(8, 500_000, 1)).toBeCloseTo(12500, 6); // RP002: 12500
  });

  it('effective payload rate is 8·PL / ToA', () => {
    expect(effectivePayloadRate(20, 56.576e-3)).toBeCloseTo(2828.05, 2);
    expect(effectivePayloadRate(0, 1)).toBe(0);
  });
});

describe('duty cycle', () => {
  it('off time = ToA · (1/dc − 1)', () => {
    expect(dutyCycleOffTime(56.576e-3, 0.01)).toBeCloseTo(5.601024, 9);
    expect(dutyCycleOffTime(1, 0.001)).toBeCloseTo(999, 9);
    expect(dutyCycleOffTime(1, 0.1)).toBeCloseTo(9, 9);
  });

  it('message counts are floor(period · dc / ToA)', () => {
    // 3600 · 0.01 / 0.056576 = 636.3
    expect(maxMessages(56.576e-3, 0.01, 3600)).toBe(636);
    expect(maxMessages(56.576e-3, 0.01, 86400)).toBe(15271);
    // SF12 51 B: 864 / 2.465792 = 350.4
    expect(maxMessages(2.465792, 0.01, 86400)).toBe(350);
    expect(maxMessages(2.465792, 0.001, 3600)).toBe(1);
  });

  it('exact divisions are not lost to floating point', () => {
    // 3600 · 0.01 / 0.036 = 1000 exactly in maths, 999.999… in IEEE 754
    expect(maxMessages(0.036, 0.01, 3600)).toBe(1000);
    expect(maxMessages(0.3, 0.1, 3600)).toBe(1200);
  });
});

describe('TTN fair use (30 s/day)', () => {
  it('counts whole messages', () => {
    expect(fairUseMessagesPerDay(56.576e-3)).toBe(530); // 30 / 0.056576 = 530.3
    expect(fairUseMessagesPerDay(2.465792)).toBe(12); // 12.17
    expect(fairUseMessagesPerDay(0.3)).toBe(100);
    expect(fairUseMessagesPerDay(31)).toBe(0);
  });

  it('LoRaWAN overhead is 13 bytes', () => {
    expect(LORAWAN_OVERHEAD_BYTES).toBe(1 + 7 + 1 + 4);
  });
});

describe('sfSweep', () => {
  it('covers SF7–SF12 and re-resolves Auto LDRO', () => {
    const rows = sfSweep({ ...base, payload: 51 });
    expect(rows.map((r) => r.sf)).toEqual([7, 8, 9, 10, 11, 12]);
    expect(rows.map((r) => r.ldro)).toEqual([false, false, false, false, true, true]);
    expect(rows[5].timeOnAir).toBeCloseTo(2465.792e-3, 12);
    for (let i = 1; i < rows.length; i++) expect(rows[i].timeOnAir).toBeGreaterThan(rows[i - 1].timeOnAir);
  });
});

describe('validateLora', () => {
  it('accepts the defaults', () => {
    expect(validateLora(base)).toEqual({});
  });

  it('gives specific messages', () => {
    expect(validateLora({ ...base, sf: 6 }).sf).toBe('Spreading factor must be between 7 and 12.');
    expect(validateLora({ ...base, sf: 13 }).sf).toBeDefined();
    expect(validateLora({ ...base, bw: 62_500 }).bw).toBeDefined();
    expect(validateLora({ ...base, cr: 5 }).cr).toBeDefined();
    expect(validateLora({ ...base, payload: 256 }).payload).toMatch(/0 to 255/);
    expect(validateLora({ ...base, payload: 2.5 }).payload).toBeDefined();
    expect(validateLora({ ...base, payload: -1 }).payload).toBeDefined();
    expect(validateLora({ ...base, payload: 0 }).payload).toBeUndefined();
    expect(validateLora({ ...base, preamble: 5 }).preamble).toMatch(/6 to 65535/);
    expect(validateLora({ ...base, preamble: 65535 }).preamble).toBeUndefined();
  });
});
