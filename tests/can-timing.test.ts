import { describe, expect, it } from 'vitest';
import {
  BXCAN,
  FDCAN_DATA,
  FDCAN_NOMINAL,
  checkFields,
  TDC_MAX_DBRP,
  dataPhaseTolerance,
  decodeBtr,
  decodeDbtp,
  decodeNbtp,
  encodeBtr,
  encodeDbtp,
  encodeNbtp,
  fdTolerance,
  maxBusLength,
  oscillatorTolerance,
  parseHexRegister,
  propagation,
  searchBitTiming,
  tdcSettings,
  timingFromFields,
} from '../src/lib/can-timing';

describe('timingFromFields', () => {
  it('computes bit rate and sample point', () => {
    // 42 MHz APB1 (STM32F407 at 168 MHz), prescaler 6, BS1 11, BS2 2: 14 tq, 500 kbit/s, 85.7 %.
    const t = timingFromFields(42e6, 6, 11, 2, 1);
    expect(t.n).toBe(14);
    expect(t.bitrate).toBeCloseTo(500e3, 6);
    expect(t.samplePoint).toBeCloseTo(12 / 14, 12);
    expect(t.tq).toBeCloseTo(6 / 42e6, 15);
  });
});

describe('searchBitTiming, bxCAN', () => {
  it('finds the usual 500 kbit/s setting at 42 MHz', () => {
    const [best] = searchBitTiming(42e6, 500e3, 0.875, BXCAN);
    expect(best).toMatchObject({ brp: 6, tseg1: 11, tseg2: 2, sjw: 2, bitrateError: 0 });
  });

  it('finds 500 kbit/s at 36 MHz (STM32F103)', () => {
    const [best] = searchBitTiming(36e6, 500e3, 0.875, BXCAN);
    expect(best).toMatchObject({ brp: 4, tseg1: 15, tseg2: 2, bitrateError: 0 });
    expect(best.samplePoint).toBeCloseTo(16 / 18, 12);
  });

  it('respects a fixed SJW and the field limits', () => {
    for (const t of searchBitTiming(48e6, 125e3, 0.875, BXCAN, { sjw: 1 })) {
      expect(t.sjw).toBe(1);
      expect(checkFields(t, BXCAN)).toEqual([]);
      expect(t.tseg2).toBeGreaterThanOrEqual(2);
    }
  });

  it('allows TSEG2 = 1 only when ISO checking is off', () => {
    // 8 MHz, 1 Mbit/s: 8 tq per bit; 87.5 % needs TSEG2 = 1.
    expect(searchBitTiming(8e6, 1e6, 0.875, BXCAN)[0].tseg2).toBe(2);
    expect(searchBitTiming(8e6, 1e6, 0.875, BXCAN, { isoPs2: false })[0].tseg2).toBe(1);
  });

  it('reports the bit-rate error when no prescaler is exact', () => {
    // 10 MHz cannot make 33.333 kbit/s exactly with ≤ 25 tq per bit at every prescaler.
    const [best] = searchBitTiming(10e6, 33.3e3, 0.875, BXCAN);
    expect(Math.abs(best.bitrateError)).toBeGreaterThan(0);
    expect(Math.abs(best.bitrateError)).toBeLessThan(0.01);
  });
});

describe('searchBitTiming, FDCAN', () => {
  it('hits 500 kbit/s 80 % and 2 Mbit/s 75 % exactly at 80 MHz with prescaler 1', () => {
    const [data] = searchBitTiming(80e6, 2e6, 0.75, FDCAN_DATA);
    expect(data).toMatchObject({ brp: 1, tseg1: 29, tseg2: 10, sjw: 10, spError: 0 });
    const [nom] = searchBitTiming(80e6, 500e3, 0.8, FDCAN_NOMINAL, { preferBrp: data.brp });
    expect(nom).toMatchObject({ brp: 1, tseg1: 127, tseg2: 32, sjw: 32 });
    expect(nom.samplePoint).toBeCloseTo(0.8, 12);
  });

  it('prefers the data-phase prescaler for the nominal phase', () => {
    const [nom] = searchBitTiming(80e6, 500e3, 0.8, FDCAN_NOMINAL, { preferBrp: 2 });
    expect(nom.brp).toBe(2);
  });
});

describe('register encoding', () => {
  it('round-trips CAN_BTR', () => {
    const btr = encodeBtr({ brp: 6, tseg1: 11, tseg2: 2, sjw: 1 });
    expect(btr).toBe(0x001a0005);
    expect(decodeBtr(btr)).toEqual({ brp: 6, tseg1: 11, tseg2: 2, sjw: 1, silm: false, lbkm: false });
    expect(decodeBtr(0xc0000000)).toMatchObject({ silm: true, lbkm: true, brp: 1, tseg1: 1, tseg2: 1, sjw: 1 });
  });

  it('round-trips FDCAN_NBTP and FDCAN_DBTP', () => {
    const nbtp = encodeNbtp({ brp: 1, tseg1: 127, tseg2: 32, sjw: 32 });
    expect(nbtp).toBe(0x3e007e1f);
    expect(decodeNbtp(nbtp)).toEqual({ brp: 1, tseg1: 127, tseg2: 32, sjw: 32 });
    // NBTP reset value 0x06000A03: NSJW 4, NBRP 1, NTSEG1 11, NTSEG2 4.
    expect(decodeNbtp(0x06000a03)).toEqual({ sjw: 4, brp: 1, tseg1: 11, tseg2: 4 });
    const dbtp = encodeDbtp({ brp: 1, tseg1: 29, tseg2: 10, sjw: 10 }, true);
    expect(dbtp).toBe(0x00801c99);
    expect(decodeDbtp(dbtp)).toEqual({ tdc: true, brp: 1, tseg1: 29, tseg2: 10, sjw: 10 });
  });

  it('flags out-of-range fields', () => {
    expect(checkFields({ brp: 1, tseg1: 17, tseg2: 9, sjw: 5 }, BXCAN)).toHaveLength(3);
  });
});

describe('propagation and tolerance', () => {
  it('sizes PROP_SEG for the bus', () => {
    // 125 ns tq, 40 m (200 ns) and 255 ns loop delay: 2 · 455 ns = 910 ns → 8 tq.
    const p = propagation(125e-9, 13, 40, 255e-9);
    expect(p.tProp).toBeCloseTo(910e-9, 15);
    expect(p.propSeg).toBe(8);
    expect(p.ps1).toBe(5);
  });

  it('gives the longest bus for a setting', () => {
    // TSEG1 13 at 125 ns leaves 12 tq = 1.5 µs for the round trip with PS1 = 1.
    expect(maxBusLength(125e-9, 13, 255e-9)).toBeCloseTo((0.75e-6 - 255e-9) / 5e-9, 9);
  });

  it('evaluates both oscillator conditions', () => {
    const t = oscillatorTolerance(16, 5, 4, 4);
    expect(t.phase).toBeCloseTo(4 / 408, 12);
    expect(t.sjw).toBeCloseTo(4 / 320, 12);
    expect(t.df).toBe(t.phase);
    expect(oscillatorTolerance(16, 0, 4, 4).df).toBe(0);
    expect(dataPhaseTolerance(40, 10)).toBeCloseTo(10 / 800, 12);
  });
});

describe('parseHexRegister', () => {
  it('reads hex with or without 0x', () => {
    expect(parseHexRegister('0x001A0005')).toBe(0x001a0005);
    expect(parseHexRegister('001a0005')).toBe(0x001a0005);
    expect(parseHexRegister('10')).toBe(16);
    expect(parseHexRegister('3E007E1F')).toBe(0x3e007e1f);
    expect(parseHexRegister('0x1_C99')).toBe(0x1c99);
  });
  it('rejects junk and values above 32 bits', () => {
    expect(parseHexRegister('')).toBeNull();
    expect(parseHexRegister('0x123456789')).toBeNull();
    expect(parseHexRegister('xyz')).toBeNull();
  });
});

describe('CAN FD rules', () => {
  it('keeps NTSEG2 and DTSEG2 at 2 tq or more even without the ISO option (M_CAN ranges)', () => {
    expect(FDCAN_NOMINAL.tseg2[0]).toBe(2);
    expect(FDCAN_DATA.tseg2[0]).toBe(2);
    for (const t of searchBitTiming(40e6, 5e6, 0.875, FDCAN_DATA, { isoPs2: false })) expect(t.tseg2).toBeGreaterThanOrEqual(2);
  });

  it('evaluates Mutter conditions 3 to 5', () => {
    const nom = timingFromFields(80e6, 1, 127, 32, 32);
    const data = timingFromFields(80e6, 1, 29, 10, 10);
    const t = fdTolerance(nom, data, 54);
    expect(t.c3).toBeCloseTo(10 / 800, 12);
    expect(t.c4).toBeCloseTo(32 / (2 * ((240 - 10) * 1 + 7 * 160)), 12);
    expect(t.c5).toBeCloseTo(10 / (2 * ((320 - 32) + 10 + 160)), 12);
    expect(t.df).toBeCloseTo(Math.min(t.c3, t.c4, t.c5, 32 / (2 * (13 * 160 - 32)), 32 / 3200), 12);
  });

  it('includes the prescaler ratio in condition 5', () => {
    const nom = timingFromFields(80e6, 4, 31, 8, 8);
    const data = timingFromFields(80e6, 1, 29, 10, 10);
    // BRP / DBRP = 4 removes 3 tq from DSJW.
    expect(fdTolerance(nom, data, 20).c5).toBeCloseTo(7 / (2 * ((80 - 8) * 4 + 10 + 160)), 12);
  });

  it('checks transmitter delay compensation', () => {
    const data = timingFromFields(80e6, 1, 29, 10, 10);
    expect(tdcSettings(80e6, data, 250e-9)).toEqual({ tdco: 29, ok: true, reason: null });
    expect(tdcSettings(80e6, timingFromFields(80e6, TDC_MAX_DBRP + 1, 9, 3, 3), 250e-9).ok).toBe(false);
    // 1 µs of loop delay is 80 clock periods: 80 + 29 is fine, but at 160 MHz it saturates past 127.
    expect(tdcSettings(80e6, data, 1e-6).ok).toBe(true);
    expect(tdcSettings(160e6, timingFromFields(160e6, 1, 29, 10, 10), 1e-6).ok).toBe(false);
  });
});
