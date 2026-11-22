import { describe, expect, it } from 'vitest';
import {
  cToK,
  kToC,
  ntcBetaFromPoints,
  ntcBetaResistance,
  ntcBetaTemperature,
  ntcCTable,
  ntcDividerVout,
  ntcResistanceFromVout,
  ntcTable,
  shFromPoints,
  shResistance,
  shTemperature,
  tempRange,
} from '../src/lib/analog';

// Typical magnitudes for a 10 kΩ-class NTC (used only for round-trip tests).
const SH = { a: 1.009249522e-3, b: 2.378405444e-4, c: 2.019202697e-7 };

describe('Kelvin conversion', () => {
  it('uses exactly 273.15', () => {
    expect(cToK(0)).toBe(273.15);
    expect(cToK(25)).toBe(298.15);
    expect(kToC(273.15)).toBe(0);
  });
});

describe('Beta model', () => {
  it('10k / B3950 is exactly 10 kΩ at 25 °C', () => {
    expect(ntcBetaResistance(25, 10e3, 3950)).toBe(10e3);
  });

  it('10k / B3950 at 0 °C ≈ 33.6206 kΩ', () => {
    // 1/273.15 − 1/298.15 = 3.069757e-4 K⁻¹; × 3950 = 1.212554; e^1.212554 = 3.362060
    expect(ntcBetaResistance(0, 10e3, 3950)).toBeCloseTo(33620.6037, 3);
  });

  it('10k / B3950 at 100 °C ≈ 697.52 Ω', () => {
    expect(ntcBetaResistance(100, 10e3, 3950)).toBeCloseTo(697.5198, 3);
  });

  it('inverse round-trips', () => {
    for (const t of [-40, 0, 25, 85, 125]) {
      expect(ntcBetaTemperature(ntcBetaResistance(t, 10e3, 3950), 10e3, 3950)).toBeCloseTo(t, 9);
    }
  });

  it('Beta from two points recovers B', () => {
    const r25 = ntcBetaResistance(25, 10e3, 3435);
    const r85 = ntcBetaResistance(85, 10e3, 3435);
    expect(ntcBetaFromPoints(25, r25, 85, r85)).toBeCloseTo(3435, 9);
  });
});

describe('Steinhart–Hart', () => {
  it('evaluates 1/T = A + B·ln R + C·(ln R)³', () => {
    const l = Math.log(10e3);
    expect(shTemperature(10e3, SH)).toBeCloseTo(1 / (SH.a + SH.b * l + SH.c * l ** 3) - 273.15, 12);
  });

  it('a fit through three Beta-model points tracks the Beta curve in between', () => {
    const r = (t: number) => ntcBetaResistance(t, 10e3, 3950);
    const k = shFromPoints([[0, r(0)], [25, r(25)], [50, r(50)]]);
    expect(shTemperature(r(10), k)).toBeCloseTo(10, 1);
    expect(shTemperature(r(40), k)).toBeCloseTo(40, 1);
  });

  it('closed-form inverse round-trips over −40 … 150 °C', () => {
    for (let t = -40; t <= 150; t += 5) {
      expect(shTemperature(shResistance(t, SH), SH)).toBeCloseTo(t, 9);
    }
  });

  it('handles C = 0 (reduces to the Beta-like form)', () => {
    const k = { a: SH.a, b: SH.b, c: 0 };
    expect(shTemperature(shResistance(60, k), k)).toBeCloseTo(60, 9);
  });

  it('coefficients from three points reproduce the inputs', () => {
    const pts: [number, number][] = [
      [0, 32650],
      [25, 10000],
      [85, 1452],
    ];
    const k = shFromPoints(pts);
    for (const [t, r] of pts) {
      expect(shTemperature(r, k)).toBeCloseTo(t, 9);
      expect(shResistance(t, k) / r).toBeCloseTo(1, 9);
    }
  });

  it('coefficients from three points of the standard curve recover A, B, C', () => {
    const pts = [-20, 25, 100].map((t) => [t, shResistance(t, SH)] as [number, number]);
    const k = shFromPoints(pts);
    expect(k.a / SH.a).toBeCloseTo(1, 6);
    expect(k.b / SH.b).toBeCloseTo(1, 6);
    expect(k.c / SH.c).toBeCloseTo(1, 5);
  });

  it('rejects repeated temperatures', () => {
    expect(() => shFromPoints([[25, 1e4], [25, 1e4], [50, 3e3]])).toThrow(RangeError);
  });
});

describe('NTC divider and table', () => {
  it('equal resistors give half the supply in either position', () => {
    expect(ntcDividerVout(10e3, 10e3, 3.3, 'bottom')).toBeCloseTo(1.65, 12);
    expect(ntcDividerVout(10e3, 10e3, 3.3, 'top')).toBeCloseTo(1.65, 12);
    expect(ntcDividerVout(30e3, 10e3, 4, 'bottom')).toBeCloseTo(3, 12);
    expect(ntcDividerVout(30e3, 10e3, 4, 'top')).toBeCloseTo(1, 12);
  });

  it('resistance from Vout inverts the divider', () => {
    for (const pos of ['top', 'bottom'] as const) {
      const v = ntcDividerVout(4321, 10e3, 3.3, pos);
      expect(ntcResistanceFromVout(v, 10e3, 3.3, pos)).toBeCloseTo(4321, 6);
    }
    expect(ntcResistanceFromVout(3.3, 10e3, 3.3, 'bottom')).toBeNaN();
  });

  it('builds a −40 … 125 °C table in 5 °C steps with ADC codes', () => {
    const temps = tempRange(-40, 125, 5);
    expect(temps).toHaveLength(34);
    const rows = ntcTable(temps, (t) => ntcBetaResistance(t, 10e3, 3950), 10e3, 3.3, 'bottom', 3.3, 12);
    const at25 = rows.find((r) => r.tC === 25)!;
    expect(at25.r).toBe(10e3);
    expect(at25.code).toBe(2048);
    // Bottom position: code falls monotonically with temperature.
    for (let i = 1; i < rows.length; i++) expect(rows[i].code).toBeLessThanOrEqual(rows[i - 1].code);
  });

  it('generates a C table with every code', () => {
    const rows = ntcTable(tempRange(0, 50, 25), (t) => ntcBetaResistance(t, 10e3, 3950), 10e3, 3.3, 'bottom', 3.3, 12);
    const c = ntcCTable(rows, 12, 'test');
    expect(c).toContain('static const uint16_t ntc_table[NTC_TABLE_LEN]');
    expect(c).toContain('#define NTC_TABLE_LEN   3');
    for (const r of rows) expect(c).toContain(String(r.code));
  });
});
