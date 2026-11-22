// STM32 independent (IWDG) and window (WWDG) watchdog maths. Pure functions, times in seconds.
//
// IWDG (RM0360 / RM0351, "Independent watchdog"): a 12-bit down-counter clocked by LSI / (4 · 2^PR), reloaded with RL.
//   t_timeout = 4 · 2^PR · (RL + 1) / f_LSI
//   Window (families with IWDG_WINR): a refresh while the counter is above WINR resets the MCU,
//   so the window opens (RL − WINR) ticks after a refresh. WINR = 0xFFF disables it.
// WWDG (RM0360 / RM0351, "System window watchdog"): a 7-bit down-counter clocked by PCLK / (4096 · 2^WDGTB).
//   A reset occurs when T6 clears (0x40 → 0x3F), so t_timeout = 4096 · 2^WDGTB · (T[5:0] + 1) / f_PCLK.
//   A refresh while the counter is above W resets the MCU: the window opens (T − W) ticks after a refresh.
//   The early-wakeup interrupt (EWI) fires at 0x40, one tick before the reset.

export const IWDG_RL_MAX = 0xfff;
export const IWDG_WINR_DISABLED = 0xfff;
export const WWDG_T_MIN = 0x40;
export const WWDG_T_MAX = 0x7f;

/** Divider applied to LSI for prescaler code PR (0 → ÷4 … 6 → ÷256, 8 → ÷1024 on newer parts). */
export function iwdgDivider(pr: number): number {
  return 4 * 2 ** pr;
}

/** Divider applied to PCLK for WDGTB (0 → ÷4096 … 3 → ÷32768, 7 → ÷524288 on 3-bit parts). */
export function wwdgDivider(wdgtb: number): number {
  return 4096 * 2 ** wdgtb;
}

export function iwdgTimeout(fLsi: number, pr: number, rl: number): number {
  return (iwdgDivider(pr) * (rl + 1)) / fLsi;
}

export function wwdgTimeout(fPclk: number, wdgtb: number, t: number): number {
  return (wwdgDivider(wdgtb) * (t - 0x3f)) / fPclk;
}

export interface WatchdogOption {
  /** Prescaler code: IWDG PR or WWDG WDGTB. */
  code: number;
  divider: number;
  /** Counter tick (s). */
  tick: number;
  /** Shortest and longest timeout with this prescaler (s). */
  min: number;
  max: number;
  /** Best reload value: IWDG RL or WWDG T (0x40 … 0x7F). */
  reload: number;
  /** Timeout with that reload (s), at the frequency used for the search. */
  timeout: number;
  /** (timeout − target) / target. */
  error: number;
  /** True when the target lies inside min … max. */
  fits: boolean;
}

export interface WatchdogSolution {
  options: WatchdogOption[];
  /** Index of the recommended option, or −1 when the target is out of range for every prescaler. */
  best: number;
}

/**
 * Generic search: for each prescaler, pick the reload count n (1 … nMax ticks) closest to the target, or the
 * smallest n that is not shorter than the target when `atLeast` is set. The best option is the one with the
 * smallest |error| among those that fit, the smaller prescaler (finer tick) winning ties.
 */
function solve(
  clock: number,
  target: number,
  codes: number[],
  divider: (code: number) => number,
  nMax: number,
  toReload: (n: number) => number,
  atLeast: boolean,
): WatchdogSolution {
  const options = codes.map((code): WatchdogOption => {
    const div = divider(code);
    const tick = div / clock;
    const ideal = target / tick;
    // The 1e-9 guard keeps exact multiples from rounding up because of floating-point noise.
    const raw = atLeast ? Math.ceil(ideal - 1e-9) : Math.round(ideal);
    const n = Math.min(nMax, Math.max(1, raw));
    const timeout = n * tick;
    let error = timeout / target - 1;
    if (Math.abs(error) < 1e-12) error = 0;
    return { code, divider: div, tick, min: tick, max: nMax * tick, reload: toReload(n), timeout, error, fits: target >= tick * (1 - 1e-12) && target <= nMax * tick * (1 + 1e-12) };
  });
  let best = -1;
  options.forEach((o, i) => {
    if (!o.fits) return;
    if (best < 0 || Math.abs(o.error) < Math.abs(options[best].error) - 1e-12) best = i;
  });
  return { options, best };
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/**
 * IWDG settings for a target timeout. `prCodes` is 7 for the classic ÷4 … ÷256 prescaler, 9 for the
 * 4-bit PR of newer parts (÷512, ÷1024). With `atLeast`, the timeout is never shorter than the target at
 * `fLsi` (pass the fastest LSI to guarantee a minimum timeout over the whole tolerance).
 */
export function solveIwdg(fLsi: number, target: number, prCodes = 7, atLeast = false): WatchdogSolution {
  return solve(fLsi, target, range(prCodes), iwdgDivider, IWDG_RL_MAX + 1, (n) => n - 1, atLeast);
}

/** WWDG settings for a target timeout. `tbCodes` is 4 for the 2-bit WDGTB, 8 for the 3-bit one. */
export function solveWwdg(fPclk: number, target: number, tbCodes = 4, atLeast = false): WatchdogSolution {
  return solve(fPclk, target, range(tbCodes), wwdgDivider, WWDG_T_MAX - 0x3f, (n) => n + 0x3f, atLeast);
}

/**
 * IWDG_WINR that opens the refresh window `earliest` seconds after a refresh (rounded to the nearest tick,
 * never before it when `atLeast`). Returns 0xFFF (disabled) for earliest ≤ 0, null when the window would
 * open at or after the timeout.
 */
export function iwdgWindow(fLsi: number, pr: number, rl: number, earliest: number, atLeast = false): number | null {
  if (earliest <= 0) return IWDG_WINR_DISABLED;
  const ticks = earliest / (iwdgDivider(pr) / fLsi);
  const n = atLeast ? Math.ceil(ticks - 1e-9) : Math.round(ticks);
  const winr = rl - n;
  return winr < 0 ? null : winr;
}

/** WWDG W for a window opening `earliest` seconds after a refresh. 0x7F (no window) for earliest ≤ 0. */
export function wwdgWindow(fPclk: number, wdgtb: number, t: number, earliest: number): number | null {
  if (earliest <= 0) return WWDG_T_MAX;
  const n = Math.round(earliest / (wwdgDivider(wdgtb) / fPclk));
  const w = t - n;
  return w < WWDG_T_MIN ? null : w;
}

export interface IwdgReport {
  tick: number;
  timeout: number;
  /** Seconds after a refresh at which refreshing becomes legal (0 without a window). */
  windowOpen: number;
  /** Timeout at the fastest LSI (shortest) and slowest LSI (longest). */
  timeoutMin: number;
  timeoutMax: number;
  /** Window opening at the fastest LSI (earliest) and slowest LSI (latest). */
  windowOpenMin: number;
  windowOpenMax: number;
  /**
   * Refresh interval that is safe over the whole LSI range: [windowOpenMax, timeoutMin].
   * Null when the window can still be closed when the fastest watchdog already fires.
   */
  safe: [number, number] | null;
}

/** Everything about an IWDG configuration, over an LSI range fMin … fMax around the typical fLsi. */
export function iwdgReport(fLsi: number, fMin: number, fMax: number, pr: number, rl: number, winr = IWDG_WINR_DISABLED): IwdgReport {
  const div = iwdgDivider(pr);
  const openTicks = winr >= rl ? 0 : rl - winr;
  const timeoutMin = (div * (rl + 1)) / fMax;
  const windowOpenMax = (div * openTicks) / fMin;
  return {
    tick: div / fLsi,
    timeout: (div * (rl + 1)) / fLsi,
    windowOpen: (div * openTicks) / fLsi,
    timeoutMin,
    timeoutMax: (div * (rl + 1)) / fMin,
    windowOpenMin: (div * openTicks) / fMax,
    windowOpenMax,
    safe: windowOpenMax < timeoutMin ? [windowOpenMax, timeoutMin] : null,
  };
}

export interface WwdgReport {
  tick: number;
  timeout: number;
  /** Seconds after a refresh at which refreshing becomes legal (0 when W ≥ T). */
  windowOpen: number;
  /** Seconds after a refresh at which the early-wakeup interrupt fires (counter = 0x40). */
  ewi: number;
}

export function wwdgReport(fPclk: number, wdgtb: number, t: number, w = WWDG_T_MAX): WwdgReport {
  const tick = wwdgDivider(wdgtb) / fPclk;
  return {
    tick,
    timeout: (t - 0x3f) * tick,
    windowOpen: w >= t ? 0 : (t - w) * tick,
    ewi: (t - WWDG_T_MIN) * tick,
  };
}

/** Parse a register value typed as decimal, 0x hex or 0b binary. Returns null if it is not a non-negative integer. */
export function parseRegister(input: string): number | null {
  const s = input.trim().replace(/_/g, '').toLowerCase();
  if (s === '') return null;
  let v: number;
  if (/^0x[0-9a-f]+$/.test(s)) v = Number.parseInt(s.slice(2), 16);
  else if (/^0b[01]+$/.test(s)) v = Number.parseInt(s.slice(2), 2);
  else if (/^\d+$/.test(s)) v = Number.parseInt(s, 10);
  else return null;
  return Number.isSafeInteger(v) ? v : null;
}

export interface LsiPreset {
  id: string;
  label: string;
  /** Typical, minimum and maximum LSI frequency (Hz) from the datasheet. */
  typ: number;
  min: number;
  max: number;
  /** IWDG has the IWDG_WINR window register. */
  window: boolean;
}

// LSI characteristics from representative datasheets ("LSI oscillator characteristics": F030 DS9773, F303 DS9118,
// F103x8/B, F205 DS6329, F407 DS8626, F746, L476, G071 DS12232, G474 DS12288), over the full voltage and temperature
// range. L4/G0/G4 print no typical value: 32 kHz is the nominal. Other parts of a family can differ slightly.
export const LSI_PRESETS: LsiPreset[] = [
  { id: 'f0', label: 'STM32F0 / F3 (40 kHz, 30–50)', typ: 40e3, min: 30e3, max: 50e3, window: true },
  { id: 'f1', label: 'STM32F1 (40 kHz, 30–60)', typ: 40e3, min: 30e3, max: 60e3, window: false },
  { id: 'f4', label: 'STM32F2 / F4 (32 kHz, 17–47)', typ: 32e3, min: 17e3, max: 47e3, window: false },
  { id: 'f7', label: 'STM32F7 (32 kHz, 17–47)', typ: 32e3, min: 17e3, max: 47e3, window: true },
  { id: 'l4', label: 'STM32L4 / G0 / G4 (32 kHz, 29.5–34)', typ: 32e3, min: 29.5e3, max: 34e3, window: true },
];
