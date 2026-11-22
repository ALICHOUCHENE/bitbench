import { describe, expect, it } from 'vitest';
import { eCeil, eFloor, eMantissas, eNearest, eValuesInRange } from '../src/lib/eseries';

describe('E-series tables (IEC 60063)', () => {
  it('has the right number of values per decade', () => {
    expect(eMantissas('E12')).toHaveLength(12);
    expect(eMantissas('E24')).toHaveLength(24);
    expect(eMantissas('E96')).toHaveLength(96);
  });

  it('E96 equals round(100·10^(i/96)) for every value', () => {
    const m = eMantissas('E96');
    m.forEach((v, i) => expect(Math.round(v * 100)).toBe(Math.round(100 * 10 ** (i / 96))));
  });

  it('E24 keeps its historical values (2.7, 3.0 … 8.2, 9.1), not the computed ones', () => {
    const e24 = eMantissas('E24');
    for (const v of [2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 8.2, 9.1]) expect(e24).toContain(v);
  });

  it('E12 is every other E24 value', () => {
    const e24 = eMantissas('E24');
    expect(eMantissas('E12')).toEqual(e24.filter((_, i) => i % 2 === 0));
  });
});

describe('E-series lookups', () => {
  it('lists values in a range without float noise', () => {
    expect(eValuesInRange('E12', 1000, 10000)).toEqual([1000, 1200, 1500, 1800, 2200, 2700, 3300, 3900, 4700, 5600, 6800, 8200, 10000]);
  });

  it('finds nearest, ceiling and floor values', () => {
    expect(eNearest('E24', 4600)).toBe(4700);
    expect(eNearest('E96', 10_050)).toBe(10_000);
    expect(eCeil('E12', 4701)).toBe(5600);
    expect(eCeil('E12', 4700)).toBe(4700);
    expect(eFloor('E24', 9999)).toBe(9100);
    expect(eFloor('E96', 1e6)).toBe(1e6);
  });
});
