import { describe, expect, it } from 'vitest';
import type { I2cMode } from '../src/lib/analog';
import {
  I2C_TIMING_SPECS,
  checkTiming,
  decodeTimingr,
  delayWindow,
  encodeTimingr,
  formatTimingr,
  parseTimingr,
  solveTiming,
  timingFromFields,
  type I2cTimingConfig,
} from '../src/lib/i2c-timing';

const cfg = (mode: I2cMode, clock: number, over: Partial<I2cTimingConfig> = {}): I2cTimingConfig => ({
  clock,
  mode,
  target: I2C_TIMING_SPECS[mode].fSclMax,
  tr: mode === 'standard' ? 500e-9 : mode === 'fast' ? 200e-9 : 40e-9,
  tf: mode === 'fastplus' ? 20e-9 : 100e-9,
  analogFilter: true,
  dnf: 0,
  ...over,
});

describe('TIMINGR encode / decode', () => {
  it('decodes the RM0351 example values for fI2CCLK = 16 MHz', () => {
    expect(decodeTimingr(0x30420f13)).toEqual({ presc: 3, scldel: 4, sdadel: 2, sclh: 0x0f, scll: 0x13 });
    expect(decodeTimingr(0x10320309)).toEqual({ presc: 1, scldel: 3, sdadel: 2, sclh: 0x03, scll: 0x09 });
    expect(decodeTimingr(0x00200204)).toEqual({ presc: 0, scldel: 2, sdadel: 0, sclh: 0x02, scll: 0x04 });
  });

  it('round-trips and ignores the reserved bits 27:24', () => {
    for (const v of [0x30420f13, 0x10320309, 0x00200204, 0xf0ffffff]) expect(encodeTimingr(decodeTimingr(v))).toBe(v >>> 0);
    expect(decodeTimingr(0x3f420f13)).toEqual(decodeTimingr(0x30420f13));
  });

  it('parses and formats hex', () => {
    expect(parseTimingr('0x30420F13')).toBe(0x30420f13);
    expect(parseTimingr('30420f13h')).toBe(0x30420f13);
    expect(parseTimingr('0x1_0320309')).toBe(0x10320309);
    expect(parseTimingr('0x123456789')).toBeNull();
    expect(parseTimingr('xyz')).toBeNull();
    expect(formatTimingr(0x204)).toBe('0x00000204');
  });
});

describe('timingFromFields', () => {
  it('reproduces the RM0351 table: 16 MHz, Standard-mode 0x30420F13', () => {
    const r = timingFromFields(cfg('standard', 16e6, { analogFilter: false, tr: 0, tf: 0 }), decodeTimingr(0x30420f13));
    expect(r.tPresc).toBeCloseTo(250e-9, 15);
    // tSCLL = 20 × 250 ns = 5.0 µs, tSCLH = 16 × 250 ns = 4.0 µs, plus 2 × 62.5 ns sync each.
    expect(r.tLow).toBeCloseTo(5.0e-6 + 125e-9, 12);
    expect(r.tHigh).toBeCloseTo(4.0e-6 + 125e-9, 12);
    expect(r.tSdadel).toBeCloseTo(2 * 250e-9 + 62.5e-9, 15);
    expect(r.tScldel).toBeCloseTo(5 * 250e-9, 15);
    // With tr = tf = 0 only the 4-cycle synchronisation is added: 1 / 9.25 µs.
    expect(r.fScl).toBeCloseTo(1 / 9.25e-6, 6);
    expect(r.fSclMin).toBeLessThan(r.fScl);
  });
});

describe('delayWindow', () => {
  it('follows the RM formulas for SDADEL and SCLDEL', () => {
    const c = cfg('fast', 16e6, { tr: 300e-9, tf: 120e-9, dnf: 2 });
    const w = delayWindow(c);
    const t = 62.5e-9;
    expect(w.sdadelMin).toBeCloseTo(120e-9 - 50e-9 - 5 * t > 0 ? 120e-9 - 50e-9 - 5 * t : 0, 15);
    expect(w.sdadelMax).toBeCloseTo(0.9e-6 - 300e-9 - 260e-9 - 6 * t, 15);
    expect(w.scldelMin).toBeCloseTo(300e-9 + 100e-9, 15);
  });
});

describe('solveTiming', () => {
  const cases: [I2cMode, number, boolean?][] = [
    ['standard', 8e6],
    ['standard', 16e6],
    ['standard', 48e6],
    ['standard', 170e6],
    ['fast', 16e6],
    ['fast', 48e6],
    ['fast', 80e6],
    ['fastplus', 48e6],
    ['fastplus', 64e6],
    ['fastplus', 32e6, false],
  ];
  for (const [mode, clock, analogFilter = true] of cases) {
    it(`${mode} at ${clock / 1e6} MHz${analogFilter ? '' : ', analog filter off,'} passes every check, 80–100 % of the target`, () => {
      const c = cfg(mode, clock, { analogFilter });
      const s = solveTiming(c);
      expect(s.best, s.reason ?? '').not.toBeNull();
      const r = s.best!;
      expect(checkTiming(c, r).filter((k) => !k.ok)).toEqual([]);
      expect(r.fScl).toBeLessThanOrEqual(c.target * (1 + 1e-12));
      expect(r.fScl).toBeGreaterThanOrEqual(c.target * 0.8);
      expect(decodeTimingr(r.timingr)).toEqual(r.fields);
    });
  }

  it('lands within 2 % of 100 kHz at 16 MHz', () => {
    const r = solveTiming(cfg('standard', 16e6)).best!;
    expect(r.fScl / 100e3).toBeGreaterThan(0.98);
  });

  it('honours a lower target speed', () => {
    const c = cfg('fast', 48e6, { target: 250e3 });
    const r = solveTiming(c).best!;
    expect(r.fScl).toBeLessThanOrEqual(250e3);
    expect(r.fScl).toBeGreaterThan(245e3);
  });

  it('finds nothing for Fast-mode Plus at 8 MHz', () => {
    const s = solveTiming(cfg('fastplus', 8e6));
    expect(s.best).toBeNull();
    expect(s.reason).toBeTruthy();
  });

  it('finds nothing when the rise time and the analog filter eat the data-valid window', () => {
    // Fm+: 450 ns tVD;DAT − 100 ns tr − 260 ns tAF(max) − 4 × 31.25 ns < 0.
    const s = solveTiming(cfg('fastplus', 32e6, { tr: 100e-9 }));
    expect(s.best).toBeNull();
    expect(s.reason).toMatch(/data hold/);
  });
});

describe('checkTiming', () => {
  it('flags a TIMINGR made for 16 MHz when the clock is really 48 MHz', () => {
    const c = cfg('standard', 48e6);
    const fails = checkTiming(c, timingFromFields(c, decodeTimingr(0x30420f13))).filter((k) => !k.ok).map((k) => k.id);
    expect(fails).toContain('tlow');
    expect(fails).toContain('thigh');
  });

  it('flags rise times beyond the mode limit', () => {
    const c = cfg('fast', 16e6, { tr: 400e-9 });
    expect(checkTiming(c, timingFromFields(c, decodeTimingr(0x10320309))).find((k) => k.id === 'tr')!.ok).toBe(false);
  });
});
