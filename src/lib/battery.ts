// Battery-life estimation for duty-cycled devices. Pure functions.
// Internal units: current in mA, time in seconds, charge in mAh.
//
// URL contract (other tools link here, keep it stable):
//   ?states=<label>:<current_mA>:<duration_s>;<label>:<current_mA>:<duration_s>…&cap=<mAh>&derate=<%>&sd=<%/year>
//   e.g. /tools/battery-life/?states=Active:6:20;PSM sleep:0.003:3580

import { parseNumber } from './format';

export interface PowerState {
  label: string;
  /** Current in mA. */
  current: number;
  /** Time spent in this state per cycle, in seconds. */
  duration: number;
}

export const MAX_STATES = 20;
export const MAX_LABEL = 40;

/** Clean a label for the URL contract: no ';' or control characters, trimmed, length-limited. */
export function cleanLabel(label: string): string {
  return label
    .replace(/[;\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LABEL);
}

/**
 * Parse the `states` query parameter. Robust to junk: items that do not have a valid
 * current (≥ 0) and duration (> 0) are skipped, labels may contain ':' (the two numbers are
 * taken from the right), empty labels get "State n", and at most MAX_STATES items are kept.
 */
export function parseStates(param: string | null | undefined): PowerState[] {
  if (!param) return [];
  const out: PowerState[] = [];
  for (const raw of param.split(';')) {
    if (out.length >= MAX_STATES) break;
    const parts = raw.split(':');
    if (parts.length < 3) continue;
    const duration = parseNumber(parts.pop()!);
    const current = parseNumber(parts.pop()!);
    if (current === null || duration === null || !Number.isFinite(current) || !Number.isFinite(duration)) continue;
    if (current < 0 || duration <= 0) continue;
    const label = cleanLabel(parts.join(':')) || `State ${out.length + 1}`;
    out.push({ label, current, duration });
  }
  return out;
}

/** Shortest decimal form of a number for URLs (no exponent for everyday values). */
function compact(x: number): string {
  return String(Number(x.toPrecision(12)));
}

/** Inverse of parseStates (the caller URL-encodes the result, e.g. with URLSearchParams). */
export function serializeStates(states: PowerState[]): string {
  return states
    .slice(0, MAX_STATES)
    .map((s) => `${cleanLabel(s.label)}:${compact(s.current)}:${compact(s.duration)}`)
    .join(';');
}

export interface StateShare extends PowerState {
  /** Charge per cycle in mAh. */
  charge: number;
  /** Fraction of the cycle's charge, 0 … 1. */
  share: number;
  /** Fraction of the cycle's time, 0 … 1. */
  timeShare: number;
}

export interface BatteryEstimate {
  /** Cycle length in seconds. */
  cycle: number;
  /** Average load current in mA, Σ(I·t) / Σt. */
  avgCurrent: number;
  /** Charge per cycle in mAh. */
  chargePerCycle: number;
  cyclesPerDay: number;
  /** Self-discharge expressed as a constant current, mA. */
  selfDischargeCurrent: number;
  /** Usable capacity in mAh. */
  usable: number;
  /** Lifetime in seconds (Infinity when the total drain is zero). */
  lifetime: number;
  /** Self-discharge share of the total drain, 0 … 1. */
  selfDischargeShare: number;
  states: StateShare[];
}

export const HOURS_PER_YEAR = 8760;

/**
 * Lifetime model:
 *   usable    = capacity · derate
 *   I_avg     = Σ(I_i · t_i) / Σ t_i
 *   I_sd      = capacity · (sd %/year) / 8760 h   (self-discharge as a constant equivalent current)
 *   lifetime  = usable / (I_avg + I_sd)
 * Self-discharge is taken on the nominal capacity and assumed constant over the life of the cell.
 */
export function estimateBattery(
  capacityMah: number,
  deratePercent: number,
  selfDischargePercentPerYear: number,
  states: PowerState[],
): BatteryEstimate {
  const cycle = states.reduce((s, x) => s + x.duration, 0);
  const chargeMas = states.reduce((s, x) => s + x.current * x.duration, 0); // mA·s
  const avgCurrent = cycle > 0 ? chargeMas / cycle : 0;
  const chargePerCycle = chargeMas / 3600;
  const usable = (capacityMah * deratePercent) / 100;
  const selfDischargeCurrent = (capacityMah * selfDischargePercentPerYear) / 100 / HOURS_PER_YEAR;
  const drain = avgCurrent + selfDischargeCurrent;
  const lifetime = drain > 0 ? (usable / drain) * 3600 : Infinity;
  return {
    cycle,
    avgCurrent,
    chargePerCycle,
    cyclesPerDay: cycle > 0 ? 86400 / cycle : 0,
    selfDischargeCurrent,
    usable,
    lifetime,
    selfDischargeShare: drain > 0 ? selfDischargeCurrent / drain : 0,
    states: states.map((s) => ({
      ...s,
      charge: (s.current * s.duration) / 3600,
      share: chargeMas > 0 ? (s.current * s.duration) / chargeMas : 0,
      timeShare: cycle > 0 ? s.duration / cycle : 0,
    })),
  };
}

// ---------- Display units ----------

export const CURRENT_UNITS = [
  { value: 'uA', label: 'µA', factor: 1e-3 },
  { value: 'mA', label: 'mA', factor: 1 },
  { value: 'A', label: 'A', factor: 1e3 },
] as const;

export const TIME_UNITS = [
  { value: 'us', label: 'µs', factor: 1e-6 },
  { value: 'ms', label: 'ms', factor: 1e-3 },
  { value: 's', label: 's', factor: 1 },
  { value: 'min', label: 'min', factor: 60 },
  { value: 'h', label: 'h', factor: 3600 },
] as const;

export type CurrentUnit = (typeof CURRENT_UNITS)[number]['value'];
export type TimeUnit = (typeof TIME_UNITS)[number]['value'];

export function currentFactor(unit: string): number | null {
  return CURRENT_UNITS.find((u) => u.value === unit)?.factor ?? null;
}

export function timeFactor(unit: string): number | null {
  return TIME_UNITS.find((u) => u.value === unit)?.factor ?? null;
}

function tidy(x: number): string {
  return String(Number(x.toPrecision(10)));
}

/** Pick a readable unit for a current in mA: 0.003 mA → { value: "3", unit: "uA" }. */
export function displayCurrent(mA: number): { value: string; unit: CurrentUnit } {
  if (mA !== 0 && Math.abs(mA) < 1) return { value: tidy(mA * 1e3), unit: 'uA' };
  if (Math.abs(mA) >= 1000) return { value: tidy(mA / 1e3), unit: 'A' };
  return { value: tidy(mA), unit: 'mA' };
}

/** Pick a readable unit for a duration in seconds, preferring whole numbers: 3600 → 1 h, 0.02 → 20 ms. */
export function displayTime(s: number): { value: string; unit: TimeUnit } {
  if (s < 1e-3) return { value: tidy(s * 1e6), unit: 'us' };
  if (s < 1) return { value: tidy(s * 1e3), unit: 'ms' };
  if (s >= 3600 && Number.isInteger(s / 3600)) return { value: tidy(s / 3600), unit: 'h' };
  if (s >= 60 && Number.isInteger(s / 60)) return { value: tidy(s / 60), unit: 'min' };
  return { value: tidy(s), unit: 's' };
}
