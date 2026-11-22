import { describe, expect, it } from 'vitest';
import { pwmCompare, searchTimer } from '../src/lib/mcu-timer';

describe('searchTimer', () => {
  it('72 MHz → 1 kHz, 16-bit: exact solutions, largest ARR first', () => {
    const { solutions } = searchTimer(72e6, 1000, 16, 16);
    expect(solutions).toHaveLength(5);
    expect(solutions.every((s) => s.error === 0)).toBe(true);
    // PSC = 0 would need ARR = 71999, which does not fit 16 bits.
    expect(solutions.map((s) => [s.psc, s.arr])).toEqual([
      [1, 35999],
      [2, 23999],
      [3, 17999],
      [4, 14399],
      [5, 11999],
    ]);
    expect(solutions[0].freq).toBeCloseTo(1000, 9);
    expect(solutions[0].bits).toBeCloseTo(Math.log2(36000), 9);
  });

  it('72 MHz → 1 kHz, 32-bit counter: PSC = 0, ARR = 71999', () => {
    const s = searchTimer(72e6, 1000, 32, 16).solutions[0];
    expect([s.psc, s.arr, s.error]).toEqual([0, 71999, 0]);
  });

  it('treats a period target (1 ms) the same as 1 kHz despite float noise', () => {
    const s = searchTimer(72e6, 1 / 1e-3, 16, 16).solutions[0];
    expect([s.psc, s.arr, s.error]).toEqual([1, 35999, 0]);
  });

  it('84 MHz → 1 Hz is exact and ARR fits 16 bits', () => {
    const s = searchTimer(84e6, 1, 16, 16).solutions[0];
    expect(s.error).toBe(0);
    expect((s.psc + 1) * (s.arr + 1)).toBe(84e6);
    expect(s.arr).toBeLessThanOrEqual(65535);
  });

  it('finds the nearest frequency when no exact pair exists', () => {
    // 16 MHz / 7 kHz = 2285.714… → PSC 0, ARR 2285 (2286 counts) → 6999.125 Hz
    const s = searchTimer(16e6, 7000, 16, 16).solutions[0];
    for (const other of searchTimer(16e6, 7000, 16, 16).solutions) {
      expect(Math.abs(s.error)).toBeLessThanOrEqual(Math.abs(other.error));
    }
    expect(Math.abs(s.error)).toBeLessThan(2e-4);
  });

  it('reports the achievable range', () => {
    const r = searchTimer(72e6, 1000, 16, 16);
    expect(r.maxFreq).toBe(36e6);
    expect(r.minFreq).toBeCloseTo(72e6 / 2 ** 32, 12);
  });

  it('clamps when the target is below the minimum frequency', () => {
    const s = searchTimer(72e6, 0.001, 16, 16).solutions[0];
    expect([s.psc, s.arr]).toEqual([65535, 65535]);
    expect(s.error).toBeGreaterThan(0);
  });
});

describe('pwmCompare', () => {
  it('50 % of ARR 999 is CCR 500', () => {
    const p = pwmCompare(999, 50);
    expect(p.ccr).toBe(500);
    expect(p.duty).toBe(0.5);
    expect(p.bits).toBeCloseTo(9.966, 3);
  });

  it('0 % and 100 % map to CCR 0 and ARR + 1', () => {
    expect(pwmCompare(999, 0).ccr).toBe(0);
    expect(pwmCompare(999, 100).ccr).toBe(1000);
    expect(pwmCompare(999, 100).duty).toBe(1);
  });

  it('rounds to the nearest step', () => {
    // ARR = 9 → 10 steps; 33 % → CCR 3 → 30 %
    const p = pwmCompare(9, 33);
    expect(p.ccr).toBe(3);
    expect(p.duty).toBeCloseTo(0.3, 12);
  });
});
