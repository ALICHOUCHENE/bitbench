// LTE-M / NB-IoT power saving timers: T3412 extended (periodic TAU), T3324 (Active Time),
// eDRX cycle and Paging Time Window. Pure functions, no DOM.
//
// Every table below was checked against the ETSI publications of the 3GPP specifications:
//   - 3GPP TS 24.008 V19.5.0 (ETSI TS 124 008), §10.5.7.3 / §10.5.7.4 / §10.5.7.4a / §10.5.5.32
//   - 3GPP TS 24.301 V19.8.0 (ETSI TS 124 301), §5.3.5 / §5.3.11
//   - 3GPP TS 36.304 V19.3.0 (ETSI TS 136 304), §7.3
//   - 3GPP TS 27.007 V19.6.0 (ETSI TS 127 007), §7.38 +CPSMS, §7.40 +CEDRXS, §7.41 +CEDRXRDP, §10.1.22 +CEREG

import { formatDuration } from './format';

export type TimerKind = 't3412' | 't3324';
export type EdrxMode = 'wb' | 'nb';

export interface TimerUnit {
  /** Value of bits 8–6. */
  code: number;
  /** Seconds per step of the 5-bit value, or null when the code means "deactivated". */
  step: number | null;
  /** Human label, e.g. "10 minutes". */
  label: string;
  /** "ok" = defined unit; "reinterpreted" = undefined code the spec maps to another unit. */
  status: 'ok' | 'deactivated' | 'reinterpreted';
}

/**
 * GPRS Timer 3, octet 3, bits 8–6 — 3GPP TS 24.008 Table 10.5.163a (§10.5.7.4a).
 * Used for the T3412 extended value IE (TS 24.301 §9.9.3.16B "GPRS timer 3") and +CPSMS <Requested_Periodic-TAU>.
 */
export const T3412_EXT_UNITS: readonly TimerUnit[] = [
  { code: 0b000, step: 600, label: '10 minutes', status: 'ok' },
  { code: 0b001, step: 3600, label: '1 hour', status: 'ok' },
  { code: 0b010, step: 36000, label: '10 hours', status: 'ok' },
  { code: 0b011, step: 2, label: '2 seconds', status: 'ok' },
  { code: 0b100, step: 30, label: '30 seconds', status: 'ok' },
  { code: 0b101, step: 60, label: '1 minute', status: 'ok' },
  // NOTE 1: only applied when received in an integrity-protected message, otherwise read as 1 hour.
  { code: 0b110, step: 1152000, label: '320 hours', status: 'ok' },
  // NOTE 2: not applicable to T3412 extended value; the IE is then treated as not included.
  { code: 0b111, step: null, label: 'deactivated', status: 'deactivated' },
];

/**
 * GPRS Timer 2 value = octet 2 of the GPRS Timer IE — 3GPP TS 24.008 Table 10.5.163 (§10.5.7.4),
 * which refers to Table 10.5.172 (§10.5.7.3) for the coding. Used for T3324 and
 * +CPSMS <Requested_Active-Time>. "Other values shall be interpreted as multiples of 1 minute
 * in this version of the protocol."
 */
export const T3324_UNITS: readonly TimerUnit[] = [
  { code: 0b000, step: 2, label: '2 seconds', status: 'ok' },
  { code: 0b001, step: 60, label: '1 minute', status: 'ok' },
  { code: 0b010, step: 360, label: 'decihours (6 minutes)', status: 'ok' },
  { code: 0b011, step: 60, label: 'undefined → 1 minute', status: 'reinterpreted' },
  { code: 0b100, step: 60, label: 'undefined → 1 minute', status: 'reinterpreted' },
  { code: 0b101, step: 60, label: 'undefined → 1 minute', status: 'reinterpreted' },
  { code: 0b110, step: 60, label: 'undefined → 1 minute', status: 'reinterpreted' },
  { code: 0b111, step: null, label: 'deactivated', status: 'deactivated' },
];

export const TIMER_UNITS: Record<TimerKind, readonly TimerUnit[]> = { t3412: T3412_EXT_UNITS, t3324: T3324_UNITS };
export const TIMER_NAMES: Record<TimerKind, string> = {
  t3412: 'T3412 extended (periodic TAU)',
  t3324: 'T3324 (Active Time)',
};

/** Byte meaning "deactivated" (unit 111, value 0). */
export const TIMER_DEACTIVATED = 0b111_00000;

// ---------------------------------------------------------------------------------------------
// Bit-string helpers

export function toBits(value: number, width: number): string {
  return value.toString(2).padStart(width, '0');
}

/** "00100110" → "001 00110" (unit | value). */
export function timerBitsSpaced(byte: number): string {
  const b = toBits(byte, 8);
  return `${b.slice(0, 3)} ${b.slice(3)}`;
}

export function hexByte(byte: number): string {
  return `0x${byte.toString(16).toUpperCase().padStart(2, '0')}`;
}

export type Parsed = { ok: true; value: number } | { ok: false; error: string };

function clean(input: string): string {
  return input.trim().replace(/^"|"$/g, '').replace(/[\s_]/g, '');
}

/**
 * Parse one timer byte typed by a user. Accepts:
 *   8 binary digits ("00101010", "001 01010", "0010_1010"), "0b00101010",
 *   hex with or without prefix ("0x2A", "2a", "0X2A", "2Ah"). Quotes around the value are ignored.
 * Binary must have exactly 8 digits (without 0b) so that "10" is read as hex 0x10, not binary 2.
 */
export function parseByte(input: string): Parsed {
  const s = clean(input);
  if (s === '') return { ok: false, error: 'Enter 8 bits (e.g. 00100110) or a hex byte (e.g. 0x26).' };
  let m: RegExpExecArray | null;
  if ((m = /^0b([01]{1,8})$/i.exec(s))) return { ok: true, value: parseInt(m[1], 2) };
  if (/^[01]{8}$/.test(s)) return { ok: true, value: parseInt(s, 2) };
  if ((m = /^(?:0x)?([0-9a-f]{1,2})h?$/i.exec(s))) return { ok: true, value: parseInt(m[1], 16) };
  if (/^[01]+$/.test(s)) return { ok: false, error: `Binary input must be exactly 8 bits; got ${s.length}.` };
  if (/^(?:0x)?[0-9a-f]+$/i.test(s)) return { ok: false, error: 'Hex value must fit in one byte (00–FF).' };
  return { ok: false, error: 'Not a byte: use 8 binary digits (00100110) or hex (0x26).' };
}

/**
 * Parse a 4-bit field (eDRX value or PTW). Accepts 4 binary digits ("0101", "0b0101"),
 * or one hex digit ("5", "0x5", "A").
 */
export function parseNibble(input: string): Parsed {
  const s = clean(input);
  if (s === '') return { ok: false, error: 'Enter 4 bits (e.g. 0101) or one hex digit (e.g. 5).' };
  let m: RegExpExecArray | null;
  if ((m = /^0b([01]{1,4})$/i.exec(s))) return { ok: true, value: parseInt(m[1], 2) };
  if (/^[01]{4}$/.test(s)) return { ok: true, value: parseInt(s, 2) };
  if ((m = /^(?:0x)?([0-9a-f])h?$/i.exec(s))) return { ok: true, value: parseInt(m[1], 16) };
  if (/^[01]+$/.test(s)) return { ok: false, error: `Binary input must be exactly 4 bits; got ${s.length}.` };
  return { ok: false, error: 'Not a 4-bit value: use 4 binary digits (0101) or one hex digit (5).' };
}

// ---------------------------------------------------------------------------------------------
// GPRS Timer 2 / 3 decode and encode

export interface TimerDecoded {
  byte: number;
  bits: string;
  hex: string;
  unit: TimerUnit;
  value: number;
  /** Effective duration in seconds; null if deactivated. 0 has a special meaning (see notes). */
  seconds: number | null;
  /** Spec remarks the user should see (reinterpretation, special meaning of zero, …). */
  notes: string[];
}

function checkByte(byte: number): void {
  if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new RangeError(`Not a byte: ${byte}`);
}

export function encodeTimer(unitCode: number, value: number): number {
  if (!Number.isInteger(unitCode) || unitCode < 0 || unitCode > 7) throw new RangeError('Unit code must be 0–7');
  if (!Number.isInteger(value) || value < 0 || value > 31) throw new RangeError('Timer value must be 0–31');
  return (unitCode << 5) | value;
}

export function decodeTimer(kind: TimerKind, byte: number): TimerDecoded {
  checkByte(byte);
  const unit = TIMER_UNITS[kind][byte >> 5];
  const value = byte & 0x1f;
  const seconds = unit.step === null ? null : unit.step * value;
  const notes: string[] = [];

  if (kind === 't3412') {
    if (unit.status === 'deactivated') {
      notes.push(
        'Unit 111 ("deactivated") is not applicable to the T3412 extended value: a UE receiving it treats the IE as not included and falls back to the legacy T3412 value (TS 24.008 Table 10.5.163a, NOTE 2).',
      );
    } else if (value === 0) {
      notes.push('A zero value deactivates T3412: the UE performs no periodic TAU at all (TS 24.301 §5.3.5).');
    }
    if (unit.code === 0b110 && value !== 0) {
      notes.push(
        `320-hour unit: a UE applies it only if the IE arrives in an integrity-protected message; otherwise it reads the value as 1-hour units, i.e. ${formatDuration(value * 3600)} (TS 24.008 Table 10.5.163a, NOTE 1).`,
      );
    }
  } else {
    if (unit.status === 'reinterpreted') {
      notes.push(
        `Unit bits ${toBits(unit.code, 3)} are undefined for GPRS Timer 2; this version of the protocol interprets them as multiples of 1 minute (TS 24.008 Table 10.5.172).`,
      );
    }
    if (unit.status === 'deactivated') {
      notes.push('Active Time "deactivated": the UE may not use PSM (TS 24.301 §5.3.11).');
    } else if (value === 0) {
      notes.push('Zero Active Time: the UE may enter PSM as soon as it returns to idle, so it is not reachable for paging (TS 24.301 §5.3.11).');
    }
  }
  return { byte, bits: toBits(byte, 8), hex: hexByte(byte), unit, value, seconds, notes };
}

export interface TimerEncoding {
  byte: number;
  bits: string;
  unit: TimerUnit;
  value: number;
  seconds: number;
}

const encodingCache = new Map<TimerKind, TimerEncoding[]>();

/**
 * Every distinct duration that the timer can express with a defined unit, sorted ascending.
 * When several encodings give the same duration (60 s = 2 s × 30 = 30 s × 2 = 1 min × 1),
 * the one with the coarsest unit is kept, which reads most naturally. For zero, the finest
 * unit is used (011 00000 for T3412, 000 00000 for T3324).
 */
export function timerEncodings(kind: TimerKind): readonly TimerEncoding[] {
  const cached = encodingCache.get(kind);
  if (cached) return cached;
  const best = new Map<number, TimerEncoding>();
  for (const unit of TIMER_UNITS[kind]) {
    if (unit.status !== 'ok' || unit.step === null) continue;
    for (let value = 0; value <= 31; value++) {
      const seconds = unit.step * value;
      const byte = encodeTimer(unit.code, value);
      const enc: TimerEncoding = { byte, bits: toBits(byte, 8), unit, value, seconds };
      const prev = best.get(seconds);
      const better = !prev || (seconds === 0 ? unit.step < prev.unit.step! : unit.step > prev.unit.step!);
      if (better) best.set(seconds, enc);
    }
  }
  const list = [...best.values()].sort((a, b) => a.seconds - b.seconds);
  encodingCache.set(kind, list);
  return list;
}

export function timerMaxSeconds(kind: TimerKind): number {
  const list = timerEncodings(kind);
  return list[list.length - 1].seconds;
}

export interface NearestResult<T> {
  /** Smallest absolute error; ties go to the longer value. */
  closest: T;
  /** Shortest value ≥ the target, or null if the target is above the maximum. */
  notBelow: T | null;
  /** Longest value ≤ the target, or null if the target is below the minimum. */
  notAbove: T | null;
  exact: boolean;
  /** Target is above the largest encodable value. */
  aboveMax: boolean;
}

function nearest<T extends { seconds: number }>(sorted: readonly T[], target: number): NearestResult<T> {
  if (!Number.isFinite(target) || target < 0) throw new RangeError('Duration must be a non-negative number');
  const eps = 1e-9 * Math.max(1, target);
  let notBelow: T | null = null;
  let notAbove: T | null = null;
  for (const e of sorted) {
    if (e.seconds >= target - eps) {
      notBelow = e;
      break;
    }
  }
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].seconds <= target + eps) {
      notAbove = sorted[i];
      break;
    }
  }
  let closest: T;
  if (!notBelow) closest = notAbove!;
  else if (!notAbove) closest = notBelow;
  else closest = target - notAbove.seconds < notBelow.seconds - target - eps ? notAbove : notBelow;
  return {
    closest,
    notBelow,
    notAbove,
    exact: Math.abs(closest.seconds - target) <= eps,
    aboveMax: notBelow === null,
  };
}

/** Find the encodings nearest to a desired duration in seconds. */
export function findTimer(kind: TimerKind, seconds: number): NearestResult<TimerEncoding> {
  return nearest(timerEncodings(kind), seconds);
}

// ---------------------------------------------------------------------------------------------
// eDRX — 3GPP TS 24.008 Table 10.5.5.32 (§10.5.5.32), "S1 mode, NB-N1 mode, and WB-N1 mode"

/** One hyperframe = 1024 radio frames × 10 ms. */
export const HYPERFRAME_S = 10.24;

export interface EdrxCycle {
  code: number;
  seconds: number;
  /** TeDRX,H in hyperframes (TS 36.304 §7.3); null for 5.12 s, which uses T = 512 radio frames instead. */
  hyperframes: number | null;
}

/** eDRX value, octet 3 bits 4–1, S1 mode. Table 10.5.5.32. */
export const EDRX_S1: readonly EdrxCycle[] = [
  { code: 0b0000, seconds: 5.12, hyperframes: null }, // NOTE 3, NOTE 4 (WB only)
  { code: 0b0001, seconds: 10.24, hyperframes: 1 }, // NOTE 4 (WB only)
  { code: 0b0010, seconds: 20.48, hyperframes: 2 },
  { code: 0b0011, seconds: 40.96, hyperframes: 4 },
  { code: 0b0100, seconds: 61.44, hyperframes: 6 }, // NOTE 5 (WB only)
  { code: 0b0101, seconds: 81.92, hyperframes: 8 },
  { code: 0b0110, seconds: 102.4, hyperframes: 10 }, // NOTE 5 (WB only)
  { code: 0b0111, seconds: 122.88, hyperframes: 12 }, // NOTE 5 (WB only)
  { code: 0b1000, seconds: 143.36, hyperframes: 14 }, // NOTE 5 (WB only)
  { code: 0b1001, seconds: 163.84, hyperframes: 16 },
  { code: 0b1010, seconds: 327.68, hyperframes: 32 },
  { code: 0b1011, seconds: 655.36, hyperframes: 64 },
  { code: 0b1100, seconds: 1310.72, hyperframes: 128 },
  { code: 0b1101, seconds: 2621.44, hyperframes: 256 },
  { code: 0b1110, seconds: 5242.88, hyperframes: 512 }, // NOTE 6 (NB only)
  { code: 0b1111, seconds: 10485.76, hyperframes: 1024 }, // NOTE 6 (NB only)
];

/** NOTE 4: WB-only values; in NB-S1 the IE is treated as not included (no eDRX). */
const NB_IGNORED = new Set([0b0000, 0b0001]);
/** NOTE 5: WB-only values; in NB-S1 they are interpreted as 0010 (20.48 s). */
const NB_AS_0010 = new Set([0b0100, 0b0110, 0b0111, 0b1000]);
/** NOTE 6: NB-only values; in WB-S1 they are interpreted as 1101 (2621.44 s). */
const WB_AS_1101 = new Set([0b1110, 0b1111]);

export const EDRX_MODE_NAMES: Record<EdrxMode, string> = {
  wb: 'WB-S1 (LTE-M / Cat-M1)',
  nb: 'NB-S1 (NB-IoT)',
};

export function edrxValidCycles(mode: EdrxMode): readonly EdrxCycle[] {
  return EDRX_S1.filter((c) => (mode === 'wb' ? !WB_AS_1101.has(c.code) : !NB_IGNORED.has(c.code) && !NB_AS_0010.has(c.code)));
}

export function isEdrxValid(mode: EdrxMode, code: number): boolean {
  return edrxValidCycles(mode).some((c) => c.code === code);
}

export interface EdrxDecoded {
  code: number;
  bits: string;
  /** Duration listed for this code in the table, regardless of mode. */
  nominal: EdrxCycle;
  /** ok = valid in this mode; reinterpreted = spec maps it to another code; ignored = eDRX IE dropped. */
  status: 'ok' | 'reinterpreted' | 'ignored';
  /** Cycle the UE/network will actually use, or null when the IE is ignored (eDRX not used). */
  effective: EdrxCycle | null;
  note: string | null;
}

export function decodeEdrx(mode: EdrxMode, code: number): EdrxDecoded {
  if (!Number.isInteger(code) || code < 0 || code > 15) throw new RangeError('eDRX value must be 0–15');
  const nominal = EDRX_S1[code];
  const base = { code, bits: toBits(code, 4), nominal };
  if (mode === 'nb' && NB_IGNORED.has(code)) {
    return {
      ...base,
      status: 'ignored',
      effective: null,
      note: `${base.bits} (${nominal.seconds} s) is only valid for WB-S1. Received in NB-S1 mode, the Extended DRX parameters IE is treated as not included, so eDRX is not used (TS 24.008 Table 10.5.5.32, NOTE 4).`,
    };
  }
  if (mode === 'nb' && NB_AS_0010.has(code)) {
    return {
      ...base,
      status: 'reinterpreted',
      effective: EDRX_S1[0b0010],
      note: `${base.bits} (${nominal.seconds} s) is only valid for WB-S1. In NB-S1 mode it is interpreted as 0010 = 20.48 s (TS 24.008 Table 10.5.5.32, NOTE 5).`,
    };
  }
  if (mode === 'wb' && WB_AS_1101.has(code)) {
    return {
      ...base,
      status: 'reinterpreted',
      effective: EDRX_S1[0b1101],
      note: `${base.bits} (${nominal.seconds} s) is only valid for NB-S1. In WB-S1 mode it is interpreted as 1101 = 2621.44 s (TS 24.008 Table 10.5.5.32, NOTE 6).`,
    };
  }
  return { ...base, status: 'ok', effective: nominal, note: null };
}

export function findEdrx(mode: EdrxMode, seconds: number): NearestResult<EdrxCycle> {
  return nearest(edrxValidCycles(mode), seconds);
}

// ---------------------------------------------------------------------------------------------
// Paging Time Window — Table 10.5.5.32, octet 3 bits 8–5.
// WB-S1: 1.28 s × (n + 1), 1.28 … 20.48 s.  NB-S1: 2.56 s × (n + 1), 2.56 … 40.96 s.

export const PTW_STEP_S: Record<EdrxMode, number> = { wb: 1.28, nb: 2.56 };

export interface PtwValue {
  code: number;
  seconds: number;
}

export function ptwSeconds(mode: EdrxMode, code: number): number {
  if (!Number.isInteger(code) || code < 0 || code > 15) throw new RangeError('PTW value must be 0–15');
  // Round to 10 ms to avoid 1.28 × 3 = 3.8400000000000003.
  return Math.round(PTW_STEP_S[mode] * (code + 1) * 100) / 100;
}

export function ptwValues(mode: EdrxMode): PtwValue[] {
  return Array.from({ length: 16 }, (_, code) => ({ code, seconds: ptwSeconds(mode, code) }));
}

export function findPtw(mode: EdrxMode, seconds: number): NearestResult<PtwValue> {
  return nearest(ptwValues(mode), seconds);
}

/** Full octet 3 of the Extended DRX parameters IE: PTW in bits 8–5, eDRX in bits 4–1. */
export function edrxOctet(ptwCode: number, edrxCode: number): number {
  return ((ptwCode & 0xf) << 4) | (edrxCode & 0xf);
}

// ---------------------------------------------------------------------------------------------
// AT commands — 3GPP TS 27.007

/** <AcT-type> for +CEDRXS (§7.40): 4 = E-UTRAN (WB-S1 mode), 5 = E-UTRAN (NB-S1 mode). */
export function edrxAct(mode: EdrxMode): 4 | 5 {
  return mode === 'wb' ? 4 : 5;
}

/**
 * AT+CPSMS=1,,,"<Requested_Periodic-TAU>","<Requested_Active-Time>" (§7.38). The two empty
 * parameters are the GERAN/UTRAN <Requested_Periodic-RAU> and <Requested_GPRS-READY-timer>.
 */
export function cpsmsCommand(t3412Byte: number, t3324Byte: number): string {
  checkByte(t3412Byte);
  checkByte(t3324Byte);
  return `AT+CPSMS=1,,,"${toBits(t3412Byte, 8)}","${toBits(t3324Byte, 8)}"`;
}

/** AT+CPSMS=0 disables PSM; AT+CPSMS=2 also discards the stored parameters (§7.38). */
export function cpsmsDisableCommand(discard = false): string {
  return `AT+CPSMS=${discard ? 2 : 0}`;
}

/** AT+CEDRXS=<mode>,<AcT>,"<eDRX bits>" (§7.40). Mode 2 also enables the +CEDRXP URC. */
export function cedrxsCommand(urc: boolean, mode: EdrxMode, edrxCode: number): string {
  if (!Number.isInteger(edrxCode) || edrxCode < 0 || edrxCode > 15) throw new RangeError('eDRX value must be 0–15');
  return `AT+CEDRXS=${urc ? 2 : 1},${edrxAct(mode)},"${toBits(edrxCode, 4)}"`;
}

/** AT+CEDRXS=0 disables eDRX; AT+CEDRXS=3 also discards the stored parameters (§7.40). */
export function cedrxsDisableCommand(discard = false): string {
  return `AT+CEDRXS=${discard ? 3 : 0}`;
}

// ---------------------------------------------------------------------------------------------
// Reading back what the network granted

export type ResponseLine =
  | { kind: 'cereg'; line: string; activeTime: TimerDecoded | null; periodicTau: TimerDecoded | null }
  | {
      kind: 'cedrx';
      line: string;
      command: string;
      mode: EdrxMode | null;
      act: number;
      requested: number | null;
      granted: number | null;
      ptw: number | null;
    }
  | { kind: 'cpsms'; line: string; periodicTau: TimerDecoded | null; activeTime: TimerDecoded | null }
  | { kind: 'error'; line: string; error: string };

/** Split an AT response parameter list on commas outside quotes, stripping quotes. */
export function splitParams(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function optByte(kind: TimerKind, field: string | undefined): TimerDecoded | null {
  if (!field) return null;
  const p = parseByte(field);
  return p.ok ? decodeTimer(kind, p.value) : null;
}

function optNibble(field: string | undefined): number | null {
  if (!field) return null;
  const p = parseNibble(field);
  return p.ok ? p.value : null;
}

/**
 * Parse modem output lines: +CEREG (n=4/5, read response or URC), +CEDRXP, +CEDRXRDP, +CEDRXS?
 * and +CPSMS?. Other lines (OK, echoes) are skipped.
 */
export function parseModemResponse(text: string): ResponseLine[] {
  const out: ResponseLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const m = /^\+(CEREG|CEDRXP|CEDRXRDP|CEDRXS|CPSMS):\s*(.*)$/i.exec(line);
    if (!m) continue;
    const cmd = m[1].toUpperCase();
    const f = splitParams(m[2]);
    if (cmd === 'CEREG') {
      // URC: <stat>,[<tac>],[<ci>],[<AcT>],[<cause_type>],[<reject_cause>],[<Active-Time>],[<Periodic-TAU>]
      // Read (n=4/5): <n>, then the same fields. TS 27.007 §10.1.22.
      let fields = f;
      if (f.length === 9) fields = f.slice(1);
      if (fields.length !== 8) {
        out.push({
          kind: 'error',
          line,
          error: 'No Active-Time / Periodic-TAU fields in this +CEREG line. Set AT+CEREG=4 first; the timers are only reported once the network has granted PSM.',
        });
        continue;
      }
      out.push({ kind: 'cereg', line, activeTime: optByte('t3324', fields[6]), periodicTau: optByte('t3412', fields[7]) });
    } else if (cmd === 'CPSMS') {
      // <mode>,[<RAU>],[<READY>],[<Periodic-TAU>],[<Active-Time>]  TS 27.007 §7.38
      out.push({ kind: 'cpsms', line, periodicTau: optByte('t3412', f[3]), activeTime: optByte('t3324', f[4]) });
    } else {
      // <AcT-type>[,<Requested_eDRX_value>[,<NW-provided_eDRX_value>[,<Paging_time_window>]]]
      const act = Number(f[0]);
      const mode: EdrxMode | null = act === 4 || act === 7 ? 'wb' : act === 5 || act === 6 ? 'nb' : null;
      out.push({
        kind: 'cedrx',
        line,
        command: `+${cmd}`,
        mode,
        act,
        requested: optNibble(f[1]),
        granted: optNibble(f[2]),
        ptw: optNibble(f[3]),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// One TAU period, for the timeline and the battery-life link

export interface PsmState {
  label: string;
  currentMa: number;
  seconds: number;
}

/**
 * Battery tool contract: states = label:current_mA:duration_s items joined by ";", URL-encoded.
 * Returns the encoded value for the `states` query parameter.
 */
export function batteryStatesParam(states: PsmState[]): string {
  const num = (x: number) => String(Number(x.toPrecision(10)));
  return encodeURIComponent(
    states
      .filter((s) => s.seconds > 0)
      .map((s) => `${s.label.replace(/[:;]/g, ' ')}:${num(s.currentMa)}:${num(s.seconds)}`)
      .join(';'),
  );
}

/**
 * Horizontal layout for the timeline bar. When the active part is too small to see on a linear
 * axis, the axis is broken: the active part gets a fixed share and the sleep part the rest,
 * each on its own scale.
 */
export function timelineSplit(activeS: number, sleepS: number, minShare = 0.18, brokenShare = 0.4) {
  const total = activeS + sleepS;
  if (total <= 0) return { broken: false, activeShare: 0, sleepShare: 0 };
  const linear = activeS / total;
  if (sleepS === 0) return { broken: false, activeShare: 1, sleepShare: 0 };
  if (activeS === 0) return { broken: false, activeShare: 0, sleepShare: 1 };
  if (linear >= minShare && linear <= 1 - minShare / 2) return { broken: false, activeShare: linear, sleepShare: 1 - linear };
  const activeShare = linear < minShare ? brokenShare : 1 - brokenShare / 2;
  return { broken: true, activeShare, sleepShare: 1 - activeShare };
}
