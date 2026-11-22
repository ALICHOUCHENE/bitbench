// LTE-M / NB-IoT power budget for a device that reports periodically. Pure functions.
// Internal units: current in mA, time in seconds, charge in mA·s unless stated.
//
// One report interval is modelled as:
//   report:  connection setup → uplink TX (× repetitions) → RRC inactivity tail → idle (Active Time) → PSM
//   k TAUs:  connection setup                                                → idle (Active Time) → PSM
// T3412 and T3324 both start when the UE enters idle (TS 24.301 §5.3.5, §5.3.11), so every
// connection — report or periodic TAU — is followed by a full Active Time.

import type { EdrxMode } from './psm-edrx';

export type Rat = EdrxMode; // 'wb' = LTE-M (WB-S1), 'nb' = NB-IoT (NB-S1)
export type SavingMode = 'psm' | 'psm-edrx' | 'edrx' | 'drx';

export const SAVING_MODES: { value: SavingMode; label: string }[] = [
  { value: 'psm', label: 'PSM' },
  { value: 'psm-edrx', label: 'PSM + eDRX' },
  { value: 'edrx', label: 'eDRX only' },
  { value: 'drx', label: 'Paging DRX only' },
];

/**
 * Paging DRX cycle (defaultPagingCycle), TS 36.331 PCCH-Config: rf32 … rf256 for E-UTRA /
 * LTE-M, and PCCH-Config-NB rf128 … rf1024 for NB-IoT. One radio frame = 10 ms.
 */
export const PAGING_CYCLES: Record<Rat, readonly number[]> = {
  wb: [0.32, 0.64, 1.28, 2.56],
  nb: [1.28, 2.56, 5.12, 10.24],
};

/** Transport overhead per uplink datagram, bytes: IPv4 header 20 (RFC 791), IPv6 40 (RFC 8200), UDP 8 (RFC 768), TCP 20 without options (RFC 9293). */
export const OVERHEADS: { value: string; label: string; bytes: number }[] = [
  { value: 'udp4', label: 'UDP / IPv4 (28 B)', bytes: 28 },
  { value: 'udp6', label: 'UDP / IPv6 (48 B)', bytes: 48 },
  { value: 'tcp4', label: 'TCP / IPv4 (40 B)', bytes: 40 },
  { value: 'none', label: 'None (Non-IP / raw)', bytes: 0 },
];

export function overheadBytes(value: string): number | null {
  return OVERHEADS.find((o) => o.value === value)?.bytes ?? null;
}

export interface PowerInputs {
  mode: SavingMode;
  /** Time between reports, s. */
  interval: number;
  /** Application payload per report, bytes. */
  payload: number;
  /** Transport/IP overhead per report, bytes. */
  overhead: number;
  /** Effective uplink data rate before repetitions, kbit/s. */
  ulRate: number;
  /** Repetition factor applied to the uplink data time (CE level / mode). */
  repetitions: number;
  /** Periodic TAU T3412 (extended), s. 0 = periodic TAU deactivated. */
  t3412: number;
  /** Active Time T3324, s (PSM modes only). */
  t3324: number;
  /** Paging DRX cycle, s. */
  drxCycle: number;
  /** eDRX cycle, s (eDRX modes only). */
  edrxCycle: number;
  /** Paging time window, s (eDRX modes only). */
  ptw: number;
  /** RRC inactivity timer, s: connected time after the last data before the network releases the UE. */
  inactivity: number;
  /** Release Assistance Indication: the network releases right after the uplink, no inactivity tail. */
  rai: boolean;
  // Currents (mA) and durations (s) of the module.
  psmCurrent: number;
  idleFloor: number;
  poCurrent: number;
  poTime: number;
  setupCurrent: number;
  setupTime: number;
  txCurrent: number;
  tailCurrent: number;
}

export type PhaseId = 'psm' | 'idle' | 'setup' | 'tx' | 'tail' | 'tau';

export const PHASE_LABELS: Record<PhaseId, string> = {
  psm: 'PSM sleep',
  idle: 'Idle (paging)',
  setup: 'Connection setup',
  tx: 'Uplink TX',
  tail: 'RRC inactivity tail',
  tau: 'Periodic TAU',
};

export interface Phase {
  id: PhaseId;
  label: string;
  /** Average current while in this phase, mA. */
  current: number;
  /** Time per report interval, s. */
  time: number;
  /** Charge per report interval, mA·s. */
  charge: number;
  /** Share of the interval's charge, 0 … 1. */
  share: number;
}

export interface PowerBudget {
  /** Uplink bits per report, payload + overhead. */
  bits: number;
  /** Uplink TX time per report including repetitions, s. */
  txTime: number;
  /** Connected time per report (setup + TX + tail), s. */
  connected: number;
  /** Periodic TAUs between two reports. */
  taus: number;
  /** Average current while idle (DRX or eDRX paging), mA. */
  idleCurrent: number;
  phases: Phase[];
  /** Average current over the report interval, mA. */
  avgCurrent: number;
  /** Charge per report interval, mA·s. */
  chargePerInterval: number;
  /** Worst-case delay before the network can reach the device with downlink data, s. */
  reachability: number;
  /** True when connections and Active Times fill the whole interval, so the UE never reaches PSM. */
  noPsm: boolean;
  warnings: string[];
}

/** Paging occasions per eDRX cycle: one per paging DRX cycle inside the PTW, at least one. */
export function posPerPtw(ptw: number, drxCycle: number): number {
  return Math.max(1, Math.floor(ptw / drxCycle + 1e-9));
}

/**
 * Average idle current.
 *   Paging DRX: I_floor + (I_PO − I_floor) · t_PO / T_DRX
 *   eDRX:       I_floor + (I_PO − I_floor) · n_PO · t_PO / T_eDRX,  n_PO = ⌊PTW / T_DRX⌋ (≥ 1)
 * In a PTW the UE monitors paging with the normal DRX cycle (TS 36.304 §7.3).
 */
export function idleAverage(p: Pick<PowerInputs, 'idleFloor' | 'poCurrent' | 'poTime' | 'drxCycle' | 'edrxCycle' | 'ptw'>, edrx: boolean): number {
  const extra = Math.max(0, p.poCurrent - p.idleFloor) * p.poTime;
  if (edrx) return p.idleFloor + (extra * posPerPtw(p.ptw, p.drxCycle)) / p.edrxCycle;
  return p.idleFloor + extra / p.drxCycle;
}

/** Number of periodic TAUs between reports: T3412 restarts at every return to idle. */
export function tauCount(interval: number, connected: number, t3412: number): number {
  if (t3412 <= 0) return 0;
  return Math.max(0, Math.ceil((interval - connected) / t3412 - 1e-9) - 1);
}

export function computeBudget(p: PowerInputs): PowerBudget {
  const warnings: string[] = [];
  const psmMode = p.mode === 'psm' || p.mode === 'psm-edrx';
  const edrx = p.mode === 'psm-edrx' || p.mode === 'edrx';

  const bits = (p.payload + p.overhead) * 8;
  const txTime = (bits / (p.ulRate * 1000)) * p.repetitions;
  const tail = p.rai ? 0 : p.inactivity;
  const connected = p.setupTime + txTime + tail;
  const idleCurrent = idleAverage(p, edrx);

  if (connected >= p.interval) warnings.push('The connection is longer than the report interval: the device never leaves connected mode.');
  if (edrx && p.edrxCycle <= p.drxCycle) warnings.push('The eDRX cycle is not longer than the paging DRX cycle, so eDRX saves nothing.');
  if (edrx && p.ptw >= p.edrxCycle) warnings.push('The paging time window is not shorter than the eDRX cycle.');
  if (psmMode && p.t3412 > 0 && p.t3324 >= p.t3412) warnings.push('Active Time (T3324) is not shorter than the periodic TAU (T3412): the device never enters PSM between TAUs.');

  const taus = tauCount(p.interval, connected, p.t3412);
  let setupT = p.setupTime;
  let tauT = taus * p.setupTime;
  let txT = txTime;
  let tailT = tail;
  let idleT: number;
  let psmT = 0;
  let noPsm = false;

  if (psmMode) {
    idleT = (1 + taus) * p.t3324;
    psmT = p.interval - connected - tauT - idleT;
    if (psmT < 0) {
      // Active Time never expires before the next report: the UE stays idle and TAUs are not needed.
      noPsm = true;
      tauT = 0;
      idleT = Math.max(0, p.interval - connected);
      psmT = 0;
    }
  } else {
    idleT = p.interval - connected - tauT;
    if (idleT < 0) {
      tauT = 0;
      idleT = Math.max(0, p.interval - connected);
    }
  }
  if (connected >= p.interval) {
    // Scale the connected phases into the interval so the budget still adds up.
    const k = p.interval / connected;
    setupT *= k;
    txT *= k;
    tailT *= k;
    idleT = 0;
    psmT = 0;
    tauT = 0;
  }

  const raw: { id: PhaseId; current: number; time: number }[] = [
    { id: 'psm', current: p.psmCurrent, time: psmT },
    { id: 'idle', current: idleCurrent, time: idleT },
    { id: 'setup', current: p.setupCurrent, time: setupT },
    { id: 'tx', current: p.txCurrent, time: txT },
    { id: 'tail', current: p.tailCurrent, time: tailT },
    { id: 'tau', current: p.setupCurrent, time: tauT },
  ];
  const chargePerInterval = raw.reduce((s, x) => s + x.current * x.time, 0);
  const phases = raw
    .filter((x) => (x.id === 'psm' ? psmMode : x.id === 'tau' ? taus > 0 && x.time > 0 : x.id === 'tail' ? !p.rai : true))
    .map((x) => ({
      ...x,
      label: PHASE_LABELS[x.id],
      charge: x.current * x.time,
      share: chargePerInterval > 0 ? (x.current * x.time) / chargePerInterval : 0,
    }));

  if (noPsm) warnings.push('Connections and Active Time fill the whole report interval: the device never reaches PSM. Shorten T3324 or report less often.');

  let reachability: number;
  if (psmMode && !noPsm) reachability = p.t3412 > 0 ? Math.min(p.interval, p.t3412) : p.interval;
  else reachability = edrx ? p.edrxCycle : p.drxCycle;

  return {
    bits,
    txTime,
    connected,
    taus: noPsm || connected >= p.interval ? 0 : taus,
    idleCurrent,
    phases,
    avgCurrent: p.interval > 0 ? chargePerInterval / p.interval : 0,
    chargePerInterval,
    reachability,
    noPsm,
    warnings,
  };
}

/** Run the same inputs through every power-saving mode, for the comparison table. */
export function compareModes(p: PowerInputs): { mode: SavingMode; budget: PowerBudget }[] {
  return SAVING_MODES.map(({ value }) => ({ mode: value, budget: computeBudget({ ...p, mode: value }) }));
}

/** Battery-life tool contract: label:current_mA:duration_s items joined by ';' (not URL-encoded). */
export function batteryStates(b: PowerBudget): string {
  const num = (x: number) => String(Number(x.toPrecision(10)));
  return b.phases
    .filter((ph) => ph.time > 0)
    .map((ph) => `${ph.label}:${num(ph.current)}:${num(ph.time)}`)
    .join(';');
}
