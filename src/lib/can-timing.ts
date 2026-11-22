// CAN bit timing: prescaler and segment search, STM32 bxCAN / FDCAN register encoding, propagation and
// oscillator-tolerance checks. Pure functions, frequencies in hertz, times in seconds.
//
// A bit is SYNC_SEG (1 tq) + TSEG1 (PROP_SEG + PHASE_SEG1) + TSEG2 (PHASE_SEG2), sampled at the end of TSEG1:
//   tq = BRP / f_clk      N = 1 + TSEG1 + TSEG2      bit rate = f_clk / (BRP · N)      SP = (1 + TSEG1) / N
// STM32 controllers merge PROP_SEG and PHASE_SEG1 into one TSEG1 field (RM0090 "bxCAN bit timing",
// RM0440 "FDCAN bit timing").
// Oscillator tolerance (Hartwich & Bassemir, "The Configuration of the CAN Bit Timing", Bosch 1999):
//   (1) df ≤ min(PS1, PS2) / (2 · (13 · N − PS2))      (2) df ≤ SJW / (20 · N)
// CAN FD adds three conditions (A. Mutter, "Robustness of a CAN FD Bus System", iCC 2013, §2):
//   (3) df ≤ DSJW / (20 · DN)
//   (4) df ≤ min(PS1, PS2) / (2 · ((6 · DN − DPS2) · DBRP / BRP + 7 · N))
//   (5) df ≤ (DSJW − max(0, BRP / DBRP − 1)) / (2 · ((2 · N − PS2) · BRP / DBRP + DPS2 + 4 · DN))
// Field ranges follow the Bosch M_CAN user's manual 3.3.1 (Tables 5 and 9), stricter than some ST texts.

export interface CanLimits {
  brp: [number, number];
  tseg1: [number, number];
  tseg2: [number, number];
  sjw: [number, number];
}

/** STM32 bxCAN, CAN_BTR: BRP 1…1024, BS1 1…16, BS2 1…8, SJW 1…4 (all as time-quanta counts). */
export const BXCAN: CanLimits = { brp: [1, 1024], tseg1: [1, 16], tseg2: [1, 8], sjw: [1, 4] };
/** STM32 FDCAN nominal (arbitration) phase, FDCAN_NBTP. Register value 0 is not allowed for NTSEG1 or NTSEG2. */
export const FDCAN_NOMINAL: CanLimits = { brp: [1, 512], tseg1: [2, 256], tseg2: [2, 128], sjw: [1, 128] };
/** STM32 FDCAN data phase, FDCAN_DBTP. Register value 0 is not allowed for DTSEG2. */
export const FDCAN_DATA: CanLimits = { brp: [1, 32], tseg1: [1, 32], tseg2: [2, 16], sjw: [1, 16] };
/** With transmitter delay compensation on, the data prescaler is limited to 1 or 2 (M_CAN Table 5). */
export const TDC_MAX_DBRP = 2;
/** TDCO and the secondary sample point are counted in CAN clock periods and saturate at 127. */
export const TDCO_MAX = 127;

/** ISO 11898-1: PHASE_SEG2 must cover the information processing time, at most 2 tq. */
export const ISO_MIN_PS2 = 2;
/** Signal delay of a typical twisted-pair CAN cable. */
export const CABLE_DELAY_PER_M = 5e-9;

export interface BitTiming {
  brp: number;
  tseg1: number;
  tseg2: number;
  sjw: number;
  /** Time quanta per bit. */
  n: number;
  /** Time quantum (s). */
  tq: number;
  bitrate: number;
  /** 0 … 1. */
  samplePoint: number;
  /** (actual − target) / target. */
  bitrateError: number;
  /** Actual − target sample point (fraction, e.g. 0.005 = 0.5 points). */
  spError: number;
}

export function timingFromFields(clock: number, brp: number, tseg1: number, tseg2: number, sjw: number, target?: { bitrate: number; sp: number }): BitTiming {
  const n = 1 + tseg1 + tseg2;
  const bitrate = clock / (brp * n);
  const samplePoint = (1 + tseg1) / n;
  let bitrateError = target ? bitrate / target.bitrate - 1 : 0;
  if (Math.abs(bitrateError) < 1e-12) bitrateError = 0;
  return { brp, tseg1, tseg2, sjw, n, tq: brp / clock, bitrate, samplePoint, bitrateError, spError: target ? samplePoint - target.sp : 0 };
}

export interface SearchOptions {
  /** Fixed SJW in tq; null or undefined uses the largest allowed (min(TSEG2, TSEG1, SJW max)). */
  sjw?: number | null;
  /** Prefer this prescaler when two candidates are otherwise as good (CAN FD: same BRP in both phases). */
  preferBrp?: number;
  /** Keep TSEG2 ≥ 2 tq (ISO 11898-1). Default true. */
  isoPs2?: boolean;
  /** Maximum number of results. Default 12. */
  top?: number;
}

/** Largest SJW that is allowed by the controller and does not exceed either phase segment. */
export function maxSjw(limits: CanLimits, tseg1: number, tseg2: number): number {
  return Math.max(1, Math.min(limits.sjw[1], tseg2, tseg1));
}

/**
 * Every prescaler that gives a whole number of time quanta per bit near the target, with the segment split
 * closest to the target sample point. Ranked by bit-rate error, then sample-point error (in 0.5-point steps),
 * then the preferred prescaler, then the most time quanta per bit (finest resolution, smallest BRP).
 */
export function searchBitTiming(clock: number, bitrate: number, sp: number, limits: CanLimits, opts: SearchOptions = {}): BitTiming[] {
  const ps2Min = Math.max(limits.tseg2[0], opts.isoPs2 === false ? 1 : ISO_MIN_PS2);
  const nMin = 1 + limits.tseg1[0] + ps2Min;
  const nMax = 1 + limits.tseg1[1] + limits.tseg2[1];
  const target = { bitrate, sp };
  const found: BitTiming[] = [];

  for (let brp = limits.brp[0]; brp <= limits.brp[1]; brp++) {
    const ideal = clock / (brp * bitrate);
    if (ideal < nMin - 0.5) break; // larger prescalers only give fewer quanta
    const n = Math.round(ideal);
    if (n < nMin || n > nMax) continue;
    // Split N − 1 into TSEG1 + TSEG2 as close as possible to the sample point, within the field ranges.
    let tseg2 = Math.round(n * (1 - sp));
    tseg2 = Math.min(limits.tseg2[1], Math.max(ps2Min, tseg2));
    let tseg1 = n - 1 - tseg2;
    if (tseg1 > limits.tseg1[1]) {
      tseg1 = limits.tseg1[1];
      tseg2 = n - 1 - tseg1;
    } else if (tseg1 < limits.tseg1[0]) {
      tseg1 = limits.tseg1[0];
      tseg2 = n - 1 - tseg1;
    }
    if (tseg2 < ps2Min || tseg2 > limits.tseg2[1]) continue;
    const sjw = opts.sjw ? Math.min(opts.sjw, maxSjw(limits, tseg1, tseg2)) : maxSjw(limits, tseg1, tseg2);
    found.push(timingFromFields(clock, brp, tseg1, tseg2, sjw, target));
  }

  const bucket = (t: BitTiming) => Math.round(Math.abs(t.spError) / 0.005);
  found.sort(
    (a, b) =>
      Math.abs(a.bitrateError) - Math.abs(b.bitrateError) ||
      bucket(a) - bucket(b) ||
      (opts.preferBrp !== undefined ? Number(b.brp === opts.preferBrp) - Number(a.brp === opts.preferBrp) : 0) ||
      Math.abs(a.spError) - Math.abs(b.spError) ||
      a.brp - b.brp,
  );
  return found.slice(0, opts.top ?? 12);
}

// ---- Registers ---------------------------------------------------------------------------------------------

export interface CanFields {
  brp: number;
  tseg1: number;
  tseg2: number;
  sjw: number;
}

/** CAN_BTR timing bits (SILM/LBKM left at 0). Fields are tq counts; the register holds count − 1. */
export function encodeBtr(f: CanFields): number {
  return (((f.sjw - 1) << 24) | ((f.tseg2 - 1) << 20) | ((f.tseg1 - 1) << 16) | (f.brp - 1)) >>> 0;
}

export function decodeBtr(btr: number): CanFields & { silm: boolean; lbkm: boolean } {
  return {
    brp: (btr & 0x3ff) + 1,
    tseg1: ((btr >>> 16) & 0xf) + 1,
    tseg2: ((btr >>> 20) & 0x7) + 1,
    sjw: ((btr >>> 24) & 0x3) + 1,
    silm: ((btr >>> 31) & 1) === 1,
    lbkm: ((btr >>> 30) & 1) === 1,
  };
}

export function encodeNbtp(f: CanFields): number {
  return (((f.sjw - 1) << 25) | ((f.brp - 1) << 16) | ((f.tseg1 - 1) << 8) | (f.tseg2 - 1)) >>> 0;
}

export function decodeNbtp(v: number): CanFields {
  return {
    sjw: ((v >>> 25) & 0x7f) + 1,
    brp: ((v >>> 16) & 0x1ff) + 1,
    tseg1: ((v >>> 8) & 0xff) + 1,
    tseg2: (v & 0x7f) + 1,
  };
}

export function encodeDbtp(f: CanFields, tdc = false): number {
  return ((Number(tdc) << 23) | ((f.brp - 1) << 16) | ((f.tseg1 - 1) << 8) | ((f.tseg2 - 1) << 4) | (f.sjw - 1)) >>> 0;
}

export function decodeDbtp(v: number): CanFields & { tdc: boolean } {
  return {
    tdc: ((v >>> 23) & 1) === 1,
    brp: ((v >>> 16) & 0x1f) + 1,
    tseg1: ((v >>> 8) & 0x1f) + 1,
    tseg2: ((v >>> 4) & 0xf) + 1,
    sjw: (v & 0xf) + 1,
  };
}

/** Which fields fall outside the controller's ranges (empty when valid). */
export function checkFields(f: CanFields, limits: CanLimits): string[] {
  const bad: string[] = [];
  const chk = (name: string, v: number, [lo, hi]: [number, number]) => {
    if (v < lo || v > hi) bad.push(`${name} = ${v} tq is outside ${lo} … ${hi}`);
  };
  chk('Prescaler', f.brp, limits.brp);
  chk('TSEG1', f.tseg1, limits.tseg1);
  chk('TSEG2', f.tseg2, limits.tseg2);
  chk('SJW', f.sjw, limits.sjw);
  return bad;
}

// ---- Propagation and oscillator tolerance -----------------------------------------------------------------

export interface Propagation {
  /** Round-trip delay that PROP_SEG must cover: 2 · (bus delay + transceiver loop delay) (s). */
  tProp: number;
  /** PROP_SEG in tq, rounded up. */
  propSeg: number;
  /** What remains of TSEG1 for PHASE_SEG1 (can be ≤ 0 when the sample point is too early). */
  ps1: number;
}

/**
 * Split TSEG1 into PROP_SEG and PHASE_SEG1 for a bus of `length` metres and transceivers with `loopDelay`
 * (TXD → RXD, seconds). The signal has to reach the farthest node and come back before the sample point.
 */
export function propagation(tq: number, tseg1: number, length: number, loopDelay: number, cableDelay = CABLE_DELAY_PER_M): Propagation {
  const tProp = 2 * (length * cableDelay + loopDelay);
  const propSeg = Math.ceil(tProp / tq - 1e-9);
  return { tProp, propSeg, ps1: tseg1 - propSeg };
}

/** Longest bus that still leaves `ps1Min` tq of PHASE_SEG1 (m). Negative when even 0 m does not fit. */
export function maxBusLength(tq: number, tseg1: number, loopDelay: number, ps1Min = 1, cableDelay = CABLE_DELAY_PER_M): number {
  const tPropMax = (tseg1 - ps1Min) * tq;
  return (tPropMax / 2 - loopDelay) / cableDelay;
}

export interface Tolerance {
  /** Condition 1: resynchronisation over 13 bits with a stuff error (fraction). */
  phase: number;
  /** Condition 2: SJW over 10 bits (fraction). */
  sjw: number;
  /** min of the two: the largest allowed oscillator tolerance of each node. */
  df: number;
}

/** Classic CAN oscillator tolerance for one bit-timing setting (ps1 = PHASE_SEG1 after PROP_SEG). */
export function oscillatorTolerance(n: number, ps1: number, ps2: number, sjw: number): Tolerance {
  const phase = ps1 <= 0 ? 0 : Math.min(ps1, ps2) / (2 * (13 * n - ps2));
  const sj = sjw / (20 * n);
  return { phase, sjw: sj, df: Math.min(phase, sj) };
}

/** CAN FD data phase: df ≤ DSJW / (20 · DN), the data-phase counterpart of condition 2 (Mutter condition 3). */
export function dataPhaseTolerance(dn: number, dsjw: number): number {
  return dsjw / (20 * dn);
}

export interface FdTolerance {
  /** Conditions 3, 4 and 5 (fractions). */
  c3: number;
  c4: number;
  c5: number;
  /** min of conditions 1 … 5: the largest allowed oscillator tolerance of each node. */
  df: number;
}

/**
 * All five CAN FD oscillator conditions. `nom` and `data` are the two phases; ps1 is the nominal PHASE_SEG1
 * left after PROP_SEG (the data phase has no propagation segment, its whole TSEG1 is phase).
 */
export function fdTolerance(nom: BitTiming, data: BitTiming, ps1: number): FdTolerance {
  const classic = oscillatorTolerance(nom.n, ps1, nom.tseg2, nom.sjw);
  const r = data.brp / nom.brp; // DBRP / BRP
  const c3 = dataPhaseTolerance(data.n, data.sjw);
  const c4 = ps1 <= 0 ? 0 : Math.min(ps1, nom.tseg2) / (2 * ((6 * data.n - data.tseg2) * r + 7 * nom.n));
  const c5 = Math.max(0, data.sjw - Math.max(0, 1 / r - 1)) / (2 * ((2 * nom.n - nom.tseg2) / r + data.tseg2 + 4 * data.n));
  return { c3, c4, c5, df: Math.min(classic.df, c3, c4, c5) };
}

/**
 * Transmitter delay compensation: ST's recommended default offset TDCO = DBRP · DTSEG1 (the data sample point
 * in CAN clock periods), and whether the secondary sample point stays valid: loop delay + TDCO below
 * 6 data bits and within 127 clock periods.
 */
export function tdcSettings(clock: number, data: BitTiming, loopDelay: number): { tdco: number; ok: boolean; reason: string | null } {
  const tdco = data.brp * data.tseg1;
  if (data.brp > TDC_MAX_DBRP) return { tdco, ok: false, reason: `TDC needs a data prescaler of 1 or 2 (it is ${data.brp})` };
  if (tdco > TDCO_MAX) return { tdco, ok: false, reason: `TDCO = ${tdco} is above the ${TDCO_MAX} maximum` };
  const ssp = loopDelay * clock + tdco; // in CAN clock periods
  if (ssp > TDCO_MAX) return { tdco, ok: false, reason: `loop delay + TDCO = ${Math.round(ssp)} clock periods saturates at ${TDCO_MAX}` };
  if (ssp >= 6 * data.n * data.brp) return { tdco, ok: false, reason: 'loop delay + TDCO must stay below 6 data bit times' };
  return { tdco, ok: true, reason: null };
}

// ---- Misc --------------------------------------------------------------------------------------------------

/** Parse a 32-bit register value typed in hex, with or without 0x ("0x001A0005", "001a0005"). */
export function parseHexRegister(input: string): number | null {
  const s = input.trim().replace(/[_\s]/g, '').toLowerCase().replace(/^0x/, '');
  return /^[0-9a-f]{1,8}$/.test(s) ? Number.parseInt(s, 16) : null;
}
