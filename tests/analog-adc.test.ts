import { describe, expect, it } from 'vitest';
import {
  adcCodeToVoltage,
  adcIdealSnrDb,
  adcLsb,
  adcMaxCode,
  adcVoltageToCode,
  dividerLoad,
  dividerRatio,
  parallel,
  suggestDivider,
} from '../src/lib/analog';
import { eValuesInRange } from '../src/lib/eseries';

describe('ADC conversion', () => {
  it('12-bit, 3.3 V: LSB = 3.3/4096 = 805.664 µV (2^N convention)', () => {
    expect(adcLsb(3.3, 12)).toBeCloseTo(805.6640625e-6, 12);
    expect(adcMaxCode(12)).toBe(4095);
  });

  it('2^N − 1 convention: top code maps exactly to Vref', () => {
    expect(adcLsb(3.3, 12, 'pow2m1')).toBeCloseTo(3.3 / 4095, 15);
    expect(adcCodeToVoltage(4095, 3.3, 12, 'pow2m1')).toBeCloseTo(3.3, 12);
    expect(adcCodeToVoltage(4095, 3.3, 12, 'pow2')).toBeCloseTo(3.3 - 3.3 / 4096, 12);
  });

  it('counts → voltage', () => {
    expect(adcCodeToVoltage(2048, 3.3, 12)).toBeCloseTo(1.65, 12);
    expect(adcCodeToVoltage(512, 5, 10)).toBeCloseTo(2.5, 12);
  });

  it('voltage → counts rounds to nearest and saturates at the top code', () => {
    expect(adcVoltageToCode(1.65, 3.3, 12)).toEqual({ exact: 2048, code: 2048, saturated: false });
    expect(adcVoltageToCode(1.0, 3.3, 12).code).toBe(1241); // 1241.21
    const top = adcVoltageToCode(3.3, 3.3, 12);
    expect(top.code).toBe(4095);
    expect(top.saturated).toBe(true);
    expect(adcVoltageToCode(3.3, 3.3, 12, 'pow2m1')).toEqual({ exact: 4095, code: 4095, saturated: false });
  });

  it('rejects voltages outside 0 … Vref', () => {
    expect(() => adcVoltageToCode(-0.01, 3.3, 12)).toThrow(RangeError);
    expect(() => adcVoltageToCode(3.31, 3.3, 12)).toThrow(RangeError);
  });

  it('ideal SNR is 6.02·N + 1.76 dB', () => {
    expect(adcIdealSnrDb(12)).toBeCloseTo(74.0, 1);
    expect(adcIdealSnrDb(16)).toBeCloseTo(98.09, 2);
  });
});

describe('divider', () => {
  it('ratio, parallel and load for 30k/10k at 12 V', () => {
    expect(dividerRatio(30e3, 10e3)).toBe(0.25);
    expect(parallel(30e3, 10e3)).toBe(7500);
    const l = dividerLoad(12, 30e3, 10e3);
    expect(l.current).toBeCloseTo(300e-6, 12);
    expect(l.power).toBeCloseTo(3.6e-3, 12);
    expect(l.powerR1).toBeCloseTo(2.7e-3, 12);
    expect(l.powerR2).toBeCloseTo(0.9e-3, 12);
    expect(l.sourceImpedance).toBe(7500);
  });

  it('suggests an E24 pair that never exceeds the target ratio and respects the impedance limit', () => {
    const values = eValuesInRange('E24', 100, 10e6);
    const k = 3.3 / 12;
    const s = suggestDivider(k, 10e3, values)!;
    expect(s.ratio).toBeLessThanOrEqual(k);
    expect(s.sourceImpedance).toBeLessThanOrEqual(10e3);
    expect(values).toContain(s.r1);
    expect(values).toContain(s.r2);
    expect(s.ratio).toBeGreaterThan(k * 0.97);
  });

  it('finds an exact ratio when one exists (1:4 → 30k/10k scaled to the impedance limit)', () => {
    const s = suggestDivider(0.25, 10e3, eValuesInRange('E24', 100, 10e6))!;
    expect(s.ratio).toBeCloseTo(0.25, 12);
    expect(s.r1 / s.r2).toBeCloseTo(3, 12);
    expect(s.sourceImpedance).toBeLessThanOrEqual(10e3);
  });

  it('returns null for impossible targets', () => {
    expect(suggestDivider(1.2, 10e3, eValuesInRange('E24', 100, 1e6))).toBeNull();
  });
});
