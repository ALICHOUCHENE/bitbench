// STM32-style timer maths: prescaler (PSC) and auto-reload (ARR) search, PWM compare values.
// Pure functions. Frequencies in hertz, periods in seconds.
//
// Update frequency of an up-counting timer (RM0008 §15.3.1, RM0090 §18.3.1):
//   f_out = f_clk / ((PSC + 1) · (ARR + 1))
// PWM mode 1, edge-aligned, up-counting (RM0008 §15.3.9, RM0090 §18.3.9): OCxREF is high while
// CNT < CCRx, so duty = CCRx / (ARR + 1); CCRx > ARR gives 100 %, CCRx = 0 gives 0 %.

export interface TimerSolution {
  /** Register value written to TIMx_PSC (divider − 1). */
  psc: number;
  /** Register value written to TIMx_ARR (period − 1). */
  arr: number;
  /** Achieved update frequency (Hz). */
  freq: number;
  /** Achieved period (s). */
  period: number;
  /** Relative frequency error, (actual − target) / target. 0 means exact. */
  error: number;
  /** PWM resolution in bits: log2(ARR + 1). */
  bits: number;
}

export interface TimerSearch {
  /** Best solutions, ranked by |error| then by largest ARR. */
  solutions: TimerSolution[];
  /** Ideal total division f_clk / f_target. */
  divisor: number;
  /** Highest and lowest frequencies the timer can produce. */
  maxFreq: number;
  minFreq: number;
}

/** Errors below this (relative) are floating-point noise and reported as exact. */
const EXACT = 1e-12;

/**
 * Search every prescaler value for the ARR that best hits `target` Hz.
 * For each PSC, ARR = round(N / (PSC+1)) − 1 with N = f_clk / target, clamped to 1 … 2^counterBits − 1,
 * and both neighbours are tried so the true nearest frequency is never missed.
 */
export function searchTimer(clock: number, target: number, counterBits = 16, pscBits = 16, top = 5): TimerSearch {
  const maxArrPlus1 = 2 ** counterBits; // ARR + 1 ranges 2 … 2^bits
  const maxPscPlus1 = 2 ** pscBits;
  const divisor = clock / target;
  const best: TimerSolution[] = [];

  const consider = (p: number, a: number) => {
    if (a < 2 || a > maxArrPlus1) return;
    const freq = clock / (p * a);
    let error = divisor / (p * a) - 1;
    if (Math.abs(error) < EXACT) error = 0;
    const cand: TimerSolution = { psc: p - 1, arr: a - 1, freq, period: 1 / freq, error, bits: Math.log2(a) };
    // Keep a small sorted list instead of sorting 65 536 candidates.
    let i = best.length;
    while (i > 0 && better(cand, best[i - 1])) i--;
    if (i < top) {
      best.splice(i, 0, cand);
      if (best.length > top) best.pop();
    }
  };

  for (let p = 1; p <= maxPscPlus1; p++) {
    const ideal = divisor / p;
    if (ideal < 1.5 && p > 1) break; // larger prescalers only get worse (ARR + 1 is already at its minimum)
    const r = Math.round(ideal);
    const clamped = Math.min(maxArrPlus1, Math.max(2, r));
    consider(p, clamped);
    if (clamped === r) {
      // Rounding the divisor is not always the same as rounding the frequency; try the neighbour.
      const other = ideal >= r ? r + 1 : r - 1;
      if (other >= 2 && other <= maxArrPlus1) consider(p, other);
    }
  }

  return {
    solutions: best,
    divisor,
    maxFreq: clock / 2,
    minFreq: clock / (maxPscPlus1 * maxArrPlus1),
  };
}

function better(a: TimerSolution, b: TimerSolution): boolean {
  const ea = Math.abs(a.error);
  const eb = Math.abs(b.error);
  if (ea !== eb) return ea < eb;
  return a.arr > b.arr;
}

export interface PwmSetting {
  /** Compare value for TIMx_CCRx. */
  ccr: number;
  /** Achieved duty cycle, 0 … 1. */
  duty: number;
  /** Number of distinct duty steps (ARR + 2: 0 … ARR+1) expressed in bits, log2(ARR + 1). */
  bits: number;
  /** Smallest duty step, 1 / (ARR + 1). */
  step: number;
}

/** Edge-aligned PWM mode 1: CCR = round(duty% · (ARR + 1) / 100), duty = CCR / (ARR + 1). */
export function pwmCompare(arr: number, dutyPercent: number): PwmSetting {
  const n = arr + 1;
  const ccr = Math.min(n, Math.max(0, Math.round((dutyPercent * n) / 100)));
  return { ccr, duty: ccr / n, bits: Math.log2(n), step: 1 / n };
}
