// STM32 I2C (v2 peripheral: F0/F3/F7/G0/G4/L0/L4/L5/H7/U5/WB…) TIMINGR solver and decoder.
// Pure functions. Times in seconds, frequencies in hertz.
//
// Sources: ST RM0351 (STM32L4) §37.4.9 "I2C timings" and §37.7.5 TIMINGR, the same text in the
// other v2 reference manuals; ST AN4235 "I2C timing configuration tool"; NXP UM10204 Rev. 7
// table 10 (I2C-bus timing). The search follows the method of the Linux i2c-stm32f7 driver
// (stm32f7_i2c_compute_timing), extended to try every prescaler.

import type { I2cMode } from './analog';

export interface I2cTimingSpec {
  /** Maximum SCL frequency, Hz. */
  fSclMax: number;
  /** Minimum SCL LOW period tLOW, s. */
  tLowMin: number;
  /** Minimum SCL HIGH period tHIGH, s. */
  tHighMin: number;
  /** Minimum data set-up time tSU;DAT, s. */
  tSuDatMin: number;
  /** Minimum data hold time tHD;DAT, s. */
  tHdDatMin: number;
  /** Maximum data valid time tVD;DAT, s. */
  tVdDatMax: number;
  /** Maximum rise and fall times, s. */
  trMax: number;
  tfMax: number;
}

/** UM10204 Rev. 7 table 10. */
export const I2C_TIMING_SPECS: Record<I2cMode, I2cTimingSpec> = {
  standard: { fSclMax: 100e3, tLowMin: 4.7e-6, tHighMin: 4.0e-6, tSuDatMin: 250e-9, tHdDatMin: 0, tVdDatMax: 3.45e-6, trMax: 1000e-9, tfMax: 300e-9 },
  fast: { fSclMax: 400e3, tLowMin: 1.3e-6, tHighMin: 0.6e-6, tSuDatMin: 100e-9, tHdDatMin: 0, tVdDatMax: 0.9e-6, trMax: 300e-9, tfMax: 300e-9 },
  fastplus: { fSclMax: 1e6, tLowMin: 0.5e-6, tHighMin: 0.26e-6, tSuDatMin: 50e-9, tHdDatMin: 0, tVdDatMax: 0.45e-6, trMax: 120e-9, tfMax: 120e-9 },
};

/** Analog noise filter delay, s. STM32 datasheets give 50 ns min and 260 ns max (tAF). */
export const T_AF_MIN = 50e-9;
export const T_AF_MAX = 260e-9;

export const PRESC_MAX = 15;
export const SCLDEL_MAX = 15;
export const SDADEL_MAX = 15;
export const SCLL_MAX = 255;
export const SCLH_MAX = 255;
export const DNF_MAX = 15;
/** Solutions are accepted from 80 % up to 100 % of the target SCL frequency (as the Linux driver does). */
export const MIN_SPEED_RATIO = 0.8;

export interface I2cTimingConfig {
  /** I2C kernel clock fI2CCLK, Hz. */
  clock: number;
  mode: I2cMode;
  /** Target SCL frequency, Hz (at most the mode's maximum). */
  target: number;
  /** SCL/SDA rise time (30 % → 70 %), s. */
  tr: number;
  /** SCL/SDA fall time (70 % → 30 %), s. */
  tf: number;
  analogFilter: boolean;
  /** Digital noise filter DNF, 0–15 I2CCLK periods. */
  dnf: number;
}

export interface TimingFields {
  presc: number;
  scldel: number;
  sdadel: number;
  sclh: number;
  scll: number;
}

/** Pack the five fields into the 32-bit TIMINGR value. */
export function encodeTimingr(f: TimingFields): number {
  return ((f.presc << 28) | (f.scldel << 20) | (f.sdadel << 16) | (f.sclh << 8) | f.scll) >>> 0;
}

/** Split a TIMINGR value into its fields. Bits 27:24 are reserved and ignored. */
export function decodeTimingr(value: number): TimingFields {
  const v = value >>> 0;
  return {
    presc: (v >>> 28) & 0xf,
    scldel: (v >>> 20) & 0xf,
    sdadel: (v >>> 16) & 0xf,
    sclh: (v >>> 8) & 0xff,
    scll: v & 0xff,
  };
}

/** Constraint window for SDADEL and the minimum SCLDEL, in seconds (RM0351 §37.4.9). */
export interface DelayWindow {
  sdadelMin: number;
  sdadelMax: number;
  scldelMin: number;
}

export function delayWindow(c: I2cTimingConfig): DelayWindow {
  const s = I2C_TIMING_SPECS[c.mode];
  const t = 1 / c.clock;
  const afMin = c.analogFilter ? T_AF_MIN : 0;
  const afMax = c.analogFilter ? T_AF_MAX : 0;
  return {
    sdadelMin: Math.max(0, c.tf + s.tHdDatMin - afMin - (c.dnf + 3) * t),
    sdadelMax: s.tVdDatMax - c.tr - afMax - (c.dnf + 4) * t,
    scldelMin: c.tr + s.tSuDatMin,
  };
}

/** Synchronisation delay added to each SCL half period: tAF(min) + DNF·tI2CCLK + 2·tI2CCLK (min case). */
export function syncDelay(c: I2cTimingConfig, extraCycles = 0): number {
  const t = 1 / c.clock;
  return (c.analogFilter ? T_AF_MIN : 0) + c.dnf * t + (2 + extraCycles) * t;
}

export interface TimingResult {
  fields: TimingFields;
  timingr: number;
  /** Prescaled clock period tPRESC, s. */
  tPresc: number;
  /** SCL LOW and HIGH periods including synchronisation, s. */
  tLow: number;
  tHigh: number;
  /** SCL period tLOW + tHIGH + tr + tf, s (2-cycle synchronisation, minimum analog filter delay). */
  tScl: number;
  fScl: number;
  /** Lowest SCL frequency over the 2–3 cycle synchronisation and the tAF spread, Hz. */
  fSclMin: number;
  /** Data hold delay tSDADEL = SDADEL·tPRESC + tI2CCLK, s. */
  tSdadel: number;
  /** Data set-up delay tSCLDEL = (SCLDEL + 1)·tPRESC, s. */
  tScldel: number;
}

/** Bus timing produced by a set of TIMINGR fields under a configuration. */
export function timingFromFields(c: I2cTimingConfig, f: TimingFields): TimingResult {
  const t = 1 / c.clock;
  const tPresc = (f.presc + 1) * t;
  const sync = syncDelay(c);
  const tLow = (f.scll + 1) * tPresc + sync;
  const tHigh = (f.sclh + 1) * tPresc + sync;
  const tScl = tLow + tHigh + c.tr + c.tf;
  // Slowest case: 3 synchronisation cycles and the maximum analog filter delay on both edges.
  const slowSync = syncDelay(c, 1) + (c.analogFilter ? T_AF_MAX - T_AF_MIN : 0);
  const tSclMax = (f.scll + 1) * tPresc + (f.sclh + 1) * tPresc + 2 * slowSync + c.tr + c.tf;
  return {
    fields: f,
    timingr: encodeTimingr(f),
    tPresc,
    tLow,
    tHigh,
    tScl,
    fScl: 1 / tScl,
    fSclMin: 1 / tSclMax,
    tSdadel: f.sdadel * tPresc + t,
    tScldel: (f.scldel + 1) * tPresc,
  };
}

export interface TimingCheck {
  id: string;
  label: string;
  ok: boolean;
  /** Human-readable value and limit, e.g. "5.12 µs ≥ 4.7 µs". Formatting is left to the caller via the raw numbers. */
  value: number;
  limit: number;
  /** 'min' when value must be ≥ limit, 'max' when ≤ limit. */
  kind: 'min' | 'max';
  unit: 's' | 'Hz';
}

/** Small tolerance so values computed from different paths compare equal. */
const EPS = 1e-15;

/** Check a timing against the I2C-bus specification and the STM32 peripheral rules. */
export function checkTiming(c: I2cTimingConfig, r: TimingResult): TimingCheck[] {
  const s = I2C_TIMING_SPECS[c.mode];
  const w = delayWindow(c);
  const t = 1 / c.clock;
  const filters = (c.analogFilter ? T_AF_MIN : 0) + c.dnf * t;
  const min = (id: string, label: string, value: number, limit: number, unit: 's' | 'Hz' = 's'): TimingCheck => ({
    id, label, value, limit, kind: 'min', unit, ok: value >= limit - EPS,
  });
  const max = (id: string, label: string, value: number, limit: number, unit: 's' | 'Hz' = 's'): TimingCheck => ({
    id, label, value, limit, kind: 'max', unit, ok: value <= limit + (unit === 'Hz' ? limit * 1e-9 : EPS),
  });
  return [
    max('fscl', 'SCL frequency', r.fScl, Math.min(c.target, s.fSclMax), 'Hz'),
    min('tlow', 'SCL LOW period tLOW', r.tLow, s.tLowMin),
    min('thigh', 'SCL HIGH period tHIGH', r.tHigh, s.tHighMin),
    min('sdadelMin', 'Data hold delay tSDADEL (min)', r.tSdadel, w.sdadelMin),
    max('sdadelMax', 'Data hold delay tSDADEL (max, tVD;DAT)', r.tSdadel, w.sdadelMax),
    min('scldel', 'Data set-up delay tSCLDEL (tr + tSU;DAT)', r.tScldel, w.scldelMin),
    max('clkLow', 'tI2CCLK < (tLOW − filters) / 4', t, (r.tLow - filters) / 4),
    max('clkHigh', 'tI2CCLK < tHIGH', t, r.tHigh),
    max('tr', 'Rise time tr', c.tr, s.trMax),
    max('tf', 'Fall time tf', c.tf, s.tfMax),
  ];
}

export interface SolveResult {
  /** Best solution, or null when nothing satisfies every rule. */
  best: TimingResult | null;
  /** Number of PRESC values that admitted a valid SCLDEL/SDADEL pair. */
  prescCandidates: number;
  window: DelayWindow;
  /** Why no solution exists, when best is null. */
  reason: string | null;
}

/**
 * Search PRESC, SCLDEL, SDADEL, SCLL and SCLH for the SCL frequency closest to the target from
 * below (down to 80 % of it). For each PRESC the smallest valid SCLDEL and SDADEL are taken.
 * Ties go to the lower PRESC, which gives the finest SCL resolution.
 */
export function solveTiming(c: I2cTimingConfig): SolveResult {
  const s = I2C_TIMING_SPECS[c.mode];
  const t = 1 / c.clock;
  const w = delayWindow(c);
  const sync = syncDelay(c);
  const filters = (c.analogFilter ? T_AF_MIN : 0) + c.dnf * t;
  const target = Math.min(c.target, s.fSclMax);
  const tTarget = 1 / target;
  const tSlowest = 1 / (target * MIN_SPEED_RATIO);

  let best: TimingResult | null = null;
  let bestErr = Infinity;
  let prescCandidates = 0;

  if (w.sdadelMax < w.sdadelMin) {
    return { best: null, prescCandidates, window: w, reason: 'The rise time and filter delays leave no room for the data hold time (tVD;DAT): reduce tr, the digital filter or switch the analog filter off.' };
  }

  for (let p = 0; p <= PRESC_MAX; p++) {
    const tPresc = (p + 1) * t;
    let scldel = -1;
    for (let l = 0; l <= SCLDEL_MAX; l++) {
      if ((l + 1) * tPresc >= w.scldelMin - EPS) {
        scldel = l;
        break;
      }
    }
    let sdadel = -1;
    for (let a = 0; a <= SDADEL_MAX; a++) {
      const d = a * tPresc + t;
      if (d >= w.sdadelMin - EPS && d <= w.sdadelMax + EPS) {
        sdadel = a;
        break;
      }
    }
    if (scldel < 0 || sdadel < 0) continue;
    prescCandidates++;

    for (let l = 0; l <= SCLL_MAX; l++) {
      const tLow = (l + 1) * tPresc + sync;
      if (tLow < s.tLowMin - EPS || t >= (tLow - filters) / 4) continue;
      // tSCL grows with SCLH: find the range of h that lands between the target and 80 % of it.
      const fixed = tLow + sync + c.tr + c.tf;
      const hLo = Math.max(0, Math.ceil((tTarget - fixed) / tPresc - 1 - 1e-9));
      const hHi = Math.min(SCLH_MAX, Math.floor((tSlowest - fixed) / tPresc - 1 + 1e-9));
      for (let h = hLo; h <= hHi; h++) {
        const tHigh = (h + 1) * tPresc + sync;
        if (tHigh < s.tHighMin - EPS || t >= tHigh) continue;
        const tScl = tLow + tHigh + c.tr + c.tf;
        if (tScl < tTarget - EPS || tScl > tSlowest + EPS) continue;
        const err = tScl - tTarget;
        if (err < bestErr - EPS) {
          bestErr = err;
          best = timingFromFields(c, { presc: p, scldel, sdadel, sclh: h, scll: l });
        }
        break; // larger h only moves further from the target
      }
    }
  }

  let reason: string | null = null;
  if (!best)
    reason =
      prescCandidates === 0
        ? 'No prescaler gives a valid SCLDEL/SDADEL pair: the I2C clock is too fast for 4-bit delay fields or too slow for the hold-time window.'
        : `No SCLL/SCLH pair reaches ${formatKHz(target * MIN_SPEED_RATIO)}–${formatKHz(target)} kHz with the LOW/HIGH minimums: raise the I2C clock, lower the target speed or shorten tr/tf.`;
  return { best, prescCandidates, window: w, reason };
}

function formatKHz(hz: number): string {
  return String(Math.round(hz / 100) / 10);
}

/** Parse "0x30420F13", "30420F13" or "30420f13h". Returns null for anything that is not 1–8 hex digits. */
export function parseTimingr(input: string): number | null {
  const s = input.trim().replace(/_/g, '').replace(/^0x/i, '').replace(/h$/i, '');
  if (!/^[0-9a-f]{1,8}$/i.test(s)) return null;
  return Number.parseInt(s, 16) >>> 0;
}

export function formatTimingr(v: number): string {
  return `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}
