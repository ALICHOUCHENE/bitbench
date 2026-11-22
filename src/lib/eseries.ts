// IEC 60063:2015 preferred number series (E12, E24, E96) for resistor values.
// Pure functions, no DOM.

export type ESeries = 'E12' | 'E24' | 'E96';

/** Mantissas per decade, ×10 for E12/E24 and ×100 for E96 (IEC 60063:2015, tables 1–2). */
const MANTISSAS: Record<ESeries, { scale: number; values: number[] }> = {
  E12: { scale: 10, values: [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82] },
  E24: {
    scale: 10,
    values: [10, 11, 12, 13, 15, 16, 18, 20, 22, 24, 27, 30, 33, 36, 39, 43, 47, 51, 56, 62, 68, 75, 82, 91],
  },
  // E96 equals round(100 · 10^(i/96)) for every i (unlike E24, which has historical deviations).
  E96: {
    scale: 100,
    values: [
      100, 102, 105, 107, 110, 113, 115, 118, 121, 124, 127, 130, 133, 137, 140, 143, 147, 150, 154, 158, 162, 165,
      169, 174, 178, 182, 187, 191, 196, 200, 205, 210, 215, 221, 226, 232, 237, 243, 249, 255, 261, 267, 274, 280,
      287, 294, 301, 309, 316, 324, 332, 340, 348, 357, 365, 374, 383, 392, 402, 412, 422, 432, 442, 453, 464, 475,
      487, 499, 511, 523, 536, 549, 562, 576, 590, 604, 619, 634, 649, 665, 681, 698, 715, 732, 750, 768, 787, 806,
      825, 845, 866, 887, 909, 931, 953, 976,
    ],
  },
};

/** Mantissas of one decade as numbers in [1, 10): E24 → 1.0, 1.1, … 9.1. */
export function eMantissas(series: ESeries): number[] {
  const { scale, values } = MANTISSAS[series];
  return values.map((v) => v / scale);
}

/** Clean up floating-point noise: 4.7 × 1000 → 4700 exactly. */
function clean(x: number): number {
  return Number(x.toPrecision(6));
}

/** All series values in [min, max] (inclusive), ascending. */
export function eValuesInRange(series: ESeries, min: number, max: number): number[] {
  if (!(min > 0) || !(max >= min) || !Number.isFinite(max)) return [];
  const out: number[] = [];
  const m = eMantissas(series);
  for (let exp = Math.floor(Math.log10(min)) - 1; exp <= Math.ceil(Math.log10(max)); exp++) {
    for (const mant of m) {
      const v = clean(mant * 10 ** exp);
      if (v >= min * (1 - 1e-12) && v <= max * (1 + 1e-12)) out.push(v);
    }
  }
  return out;
}

/** Candidates around a value: the series values in the decades just below, at and above it. */
function around(series: ESeries, value: number): number[] {
  return eValuesInRange(series, value / 10.5, value * 10.5);
}

/** Nearest series value on a logarithmic scale (the usual meaning of "nearest" for tolerances). */
export function eNearest(series: ESeries, value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) return NaN;
  let best = NaN;
  let bestErr = Infinity;
  for (const v of around(series, value)) {
    const err = Math.abs(Math.log(v / value));
    if (err < bestErr) [best, bestErr] = [v, err];
  }
  return best;
}

/** Smallest series value ≥ value. */
export function eCeil(series: ESeries, value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) return NaN;
  return around(series, value).find((v) => v >= value * (1 - 1e-12)) ?? NaN;
}

/** Largest series value ≤ value. */
export function eFloor(series: ESeries, value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) return NaN;
  const c = around(series, value).filter((v) => v <= value * (1 + 1e-12));
  return c.length ? c[c.length - 1] : NaN;
}
