// Number parsing and formatting shared by every tool. Pure functions, no DOM.

const PREFIX: Record<string, number> = {
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  µ: 1e-6,
  m: 1e-3,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
};

/**
 * Parse a number typed by an engineer. Accepts plain and exponent notation ("1e-3"),
 * an optional SI prefix and unit ("10k", "100nF", "8 MHz", "4.7µ"), and resistor
 * notation ("4k7" = 4700, "2R2" = 2.2). Returns null when the input is not a number.
 */
export function parseNumber(input: string): number | null {
  const s = input.trim().replace(/,/g, '').replace(/_/g, '');
  if (s === '') return null;

  // Resistor/capacitor notation: digits, prefix-or-R, digits (4k7, 2R2, 1M5).
  const rkm = /^(\d+)([pnuµmkKMGR])(\d+)$/.exec(s);
  if (rkm) {
    const mult = rkm[2] === 'R' ? 1 : PREFIX[rkm[2]];
    return Number(`${rkm[1]}.${rkm[3]}`) * mult;
  }

  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([pnuµmkKMG])?([a-zA-ZΩ°%]*)$/.exec(s);
  if (!m) return null;
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return null;
  // The trailing unit (m[3]) is ignored: "100nF" and "100n" mean the same thing.
  const prefix = m[2];
  return prefix ? base * PREFIX[prefix] : base;
}

/** Trim trailing zeros from a fixed or precision string ("1.2300" → "1.23"). */
function trimZeros(s: string): string {
  if (!s.includes('.') || s.includes('e')) return s;
  return s.replace(/\.?0+$/, '');
}

/**
 * Format with a given number of significant digits, without exponent notation
 * for values between 1e-6 and 1e15. Trailing zeros are removed.
 */
export function formatNumber(x: number, sig = 6): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'NaN' : x > 0 ? '∞' : '−∞';
  if (x === 0) return '0';
  const abs = Math.abs(x);
  if (abs >= 1e15 || abs < 1e-6) return x.toPrecision(sig).replace(/\.?0+e/, 'e');
  const digits = Math.max(0, sig - 1 - Math.floor(Math.log10(abs)));
  return trimZeros(x.toFixed(Math.min(digits, 20)));
}

const SI_STEPS: [number, string][] = [
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
  [1e-12, 'p'],
];

/** Format with an SI prefix so the mantissa sits between 1 and 999: 0.056576 s → "56.576 ms". */
export function formatSI(value: number, unit: string, sig = 5): string {
  if (!Number.isFinite(value)) return `${formatNumber(value)} ${unit}`.trim();
  if (value === 0) return `0 ${unit}`.trim();
  const abs = Math.abs(value);
  // Round first so 999.9996 does not print as "1000 m" instead of "1".
  const rounded = Number(abs.toPrecision(sig));
  const step = SI_STEPS.find(([f]) => rounded >= f) ?? SI_STEPS[SI_STEPS.length - 1];
  return `${formatNumber(value / step[0], sig)} ${step[1]}${unit}`.trim();
}

/**
 * Human-readable duration: "40.96 s", "6 min", "1 h 30 min", "13 d 8 h".
 * Shows at most two units; sub-minute values keep their decimals.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '∞';
  if (seconds < 0) return `−${formatDuration(-seconds)}`;
  if (seconds < 1) return formatSI(seconds, 's', 4);
  if (seconds < 60) return `${formatNumber(seconds, 6)} s`;

  const units: [number, string][] = [
    [365 * 86400, 'y'],
    [86400, 'd'],
    [3600, 'h'],
    [60, 'min'],
    [1, 's'],
  ];
  // Largest unit gets the integer part; the next unit is rounded (seconds keep 2 decimals)
  // and carries into the larger unit when it rounds up to a whole one (59.999 min → 1 h).
  const i = units.findIndex(([size]) => seconds >= size);
  const [big, bigLabel] = units[i];
  const [small, smallLabel] = units[i + 1] ?? [1, 's'];
  let whole = Math.floor(seconds / big);
  const restUnits = (seconds - whole * big) / small;
  let rest = small === 1 ? Math.round(restUnits * 100) / 100 : Math.round(restUnits);
  if (rest * small >= big) {
    // Carry; the result may now reach the next larger unit (59 min 60 s → 1 h).
    return formatDuration((whole + 1) * big);
  }
  const parts = [`${formatNumber(whole, 6)} ${bigLabel}`];
  if (rest > 0 && i + 1 < units.length) parts.push(`${formatNumber(rest, 6)} ${smallLabel}`);
  return parts.join(' ');
}

/** Format a ratio as a percentage: 0.0123 → "1.23 %". */
export function formatPercent(ratio: number, sig = 4): string {
  return `${formatNumber(ratio * 100, sig)} %`;
}

/** True when the input carries its own SI prefix or resistor notation ("72M", "8 MHz", "4k7"). */
export function hasSiPrefix(input: string): boolean {
  const s = input.trim().replace(/,/g, '').replace(/_/g, '');
  return /^\d+[pnuµmkKMGR]\d+$/.test(s) || /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?\s*[pnuµmkKMG]/.test(s);
}

/**
 * Combine a parsed number with a unit selector. When the user already typed a prefix
 * ("72M" next to a MHz selector) the typed value wins instead of being scaled twice.
 */
export function applyUnit(raw: string, value: number, multiplier: number): number {
  return hasSiPrefix(raw) ? value : value * multiplier;
}
