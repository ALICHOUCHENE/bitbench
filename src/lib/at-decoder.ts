// Decoder for 3GPP TS 27.007 AT command responses and unsolicited result codes. Pure functions.
// Paste a modem log; every line is classified (command, response, URC, final result) and the
// parameters of the commands an LTE-M / NB-IoT developer meets most are explained field by field.
//
// Value tables follow TS 27.007 V20.0.0 unless stated; error and cause tables live in at-tables.ts.

import { formatDuration } from './format';
import { CME_EPS, CME_GENERAL, CME_GPRS, CME_VBS, EMM_CAUSES } from './at-tables';
import { decodeEdrx, decodeTimer, parseByte, parseNibble, ptwSeconds, toBits, type EdrxMode, type TimerKind } from './psm-edrx';

export type Tone = 'ok' | 'warn' | 'bad';

export interface Field {
  name: string;
  value: string;
  meaning: string;
  tone?: Tone;
}

export type LineKind = 'command' | 'response' | 'urc' | 'final' | 'error' | 'info' | 'unknown';

export interface Decoded {
  raw: string;
  kind: LineKind;
  /** Command name with "+", e.g. "+CEREG"; null for plain text. */
  command: string | null;
  title: string;
  /** Spec clause, e.g. "TS 27.007 §10.1.22". */
  ref: string | null;
  fields: Field[];
  notes: string[];
  tone?: Tone;
}

// ---------------------------------------------------------------------------------------------
// Parameter splitting

export interface Param {
  value: string;
  quoted: boolean;
}

/** Split a parameter list on commas outside quotes and parentheses; quotes are removed. */
export function splitParams(s: string): Param[] {
  const out: Param[] = [];
  let cur = '';
  let quoted = false;
  let wasQuoted = false;
  let depth = 0;
  for (const ch of s) {
    if (ch === '"') {
      quoted = !quoted;
      // Inside parentheses keep the quotes: the group is split again by the caller.
      if (depth > 0) cur += ch;
      else wasQuoted = true;
    } else if (!quoted && ch === '(') {
      depth++;
      cur += ch;
    } else if (!quoted && ch === ')') {
      depth = Math.max(0, depth - 1);
      cur += ch;
    } else if (ch === ',' && !quoted && depth === 0) {
      out.push({ value: wasQuoted ? cur : cur.trim(), quoted: wasQuoted });
      cur = '';
      wasQuoted = false;
    } else cur += ch;
  }
  out.push({ value: wasQuoted ? cur : cur.trim(), quoted: wasQuoted });
  return out;
}

const isInt = (s: string | undefined) => s !== undefined && /^\d+$/.test(s.trim());

// ---------------------------------------------------------------------------------------------
// Shared value tables (TS 27.007)

/** <stat> of +CEREG (§10.1.22) and +CREG (§7.2). */
export const REG_STAT: Record<number, { text: string; tone: Tone }> = {
  0: { text: 'not registered, not searching for an operator', tone: 'bad' },
  1: { text: 'registered, home network', tone: 'ok' },
  2: { text: 'not registered, attaching or searching for an operator', tone: 'warn' },
  3: { text: 'registration denied', tone: 'bad' },
  4: { text: 'unknown (e.g. out of coverage)', tone: 'bad' },
  5: { text: 'registered, roaming', tone: 'ok' },
  6: { text: 'registered for "SMS only", home network', tone: 'warn' },
  7: { text: 'registered for "SMS only", roaming', tone: 'warn' },
  8: { text: 'attached for emergency bearer services only', tone: 'warn' },
  9: { text: 'registered for "CSFB not preferred", home network', tone: 'ok' },
  10: { text: 'registered for "CSFB not preferred", roaming', tone: 'ok' },
  11: { text: 'attached for access to RLOS', tone: 'warn' },
  12: { text: 'registered for "disaster roaming services"', tone: 'warn' },
  13: { text: 'disaster condition applies to the current PLMN', tone: 'warn' },
};

/** <AcT> of +CEREG / +CREG / +COPS. */
export const ACT: Record<number, string> = {
  0: 'GSM',
  1: 'GSM Compact',
  2: 'UTRAN',
  3: 'GSM w/EGPRS',
  4: 'UTRAN w/HSDPA',
  5: 'UTRAN w/HSUPA',
  6: 'UTRAN w/HSDPA and HSUPA',
  7: 'E-UTRAN (LTE, including LTE-M)',
  8: 'EC-GSM-IoT (A/Gb mode)',
  9: 'E-UTRAN (NB-S1 mode), i.e. NB-IoT',
  10: 'E-UTRA connected to a 5GCN',
  11: 'NR connected to a 5GCN',
  12: 'NG-RAN',
  13: 'E-UTRA-NR dual connectivity',
  14: 'satellite E-UTRAN (NB-S1 mode)',
  15: 'satellite E-UTRAN (WB-S1 mode)',
  16: 'satellite NG-RAN',
};

/** E-UTRAN access technologies, for which <ci> is a 28-bit E-UTRAN Cell Identity. */
const EUTRAN_ACT = new Set([7, 9, 13, 14, 15]);

/** <AcT-type> of +CEDRXS / +CEDRXP / +CEDRXRDP (§7.40, §7.41). */
export const EDRX_ACT: Record<number, string> = {
  0: 'access technology is not using eDRX',
  1: 'EC-GSM-IoT (A/Gb mode)',
  2: 'GSM (A/Gb mode)',
  3: 'UTRAN (Iu mode)',
  4: 'E-UTRAN (WB-S1 mode), i.e. LTE-M',
  5: 'E-UTRAN (NB-S1 mode), i.e. NB-IoT',
  6: 'satellite E-UTRAN (NB-S1 mode)',
  7: 'satellite E-UTRAN (WB-S1 mode)',
  8: 'NG-RAN (N1 mode)',
  9: 'satellite NG-RAN (N1 mode)',
};

const CFUN: Record<number, string> = {
  0: 'minimum functionality',
  1: 'full functionality',
  2: 'transmit RF circuits disabled',
  3: 'receive RF circuits disabled',
  4: 'transmit and receive RF circuits disabled (flight mode)',
  128: 'full functionality, RATs according to +CSRA',
  129: 'prepare for shutdown',
};

const CPIN: Record<string, string> = {
  READY: 'no password is pending',
  'SIM PIN': 'waiting for the SIM PIN',
  'SIM PUK': 'waiting for the SIM PUK',
  'PH-SIM PIN': 'waiting for the phone-to-SIM password',
  'PH-FSIM PIN': 'waiting for the phone-to-very-first-SIM password',
  'PH-FSIM PUK': 'waiting for the phone-to-very-first-SIM unblocking password',
  'SIM PIN2': 'waiting for SIM PIN2',
  'SIM PUK2': 'waiting for SIM PUK2',
  'PH-NET PIN': 'waiting for the network personalization password',
  'PH-NET PUK': 'waiting for the network personalization unblocking password',
  'PH-NETSUB PIN': 'waiting for the network subset personalization password',
  'PH-NETSUB PUK': 'waiting for the network subset personalization unblocking password',
  'PH-SP PIN': 'waiting for the service provider personalization password',
  'PH-SP PUK': 'waiting for the service provider personalization unblocking password',
  'PH-CORP PIN': 'waiting for the corporate personalization password',
  'PH-CORP PUK': 'waiting for the corporate personalization unblocking password',
};

const COPS_MODE: Record<number, string> = {
  0: 'automatic network selection',
  1: 'manual network selection',
  2: 'deregistered from the network',
  3: 'set only <format>',
  4: 'manual, falling back to automatic',
};
const COPS_FORMAT: Record<number, string> = { 0: 'long alphanumeric', 1: 'short alphanumeric', 2: 'numeric (MCC + MNC)' };
const COPS_STAT: Record<number, string> = {
  0: 'unknown',
  1: 'available',
  2: 'current',
  3: 'forbidden',
  4: 'forbidden and supports disaster roaming',
  5: 'allowable and supports disaster roaming',
  6: 'manual selection only; PLMN with NB-IoT not allowed',
  7: 'manual selection only; N1 mode not allowed for 3GPP access',
  8: 'manual selection only; voice not possible over satellite NG-RAN in N1 mode',
  9: 'manual selection only; voice not possible in N1 mode',
  10: 'manual selection only; PLMN with satellite E-UTRAN not allowed',
  11: 'manual selection only; PLMN with satellite NG-RAN not allowed',
  12: 'manual selection only; PLMN with E-UTRAN not allowed',
  13: 'manual selection only; E-UTRA capability disabled',
};

const CSCON_MODE: Record<number, string> = { 0: 'idle', 1: 'connected' };
const CSCON_STATE: Record<number, string> = {
  0: 'UTRAN URA_PCH',
  1: 'UTRAN Cell_PCH',
  2: 'UTRAN Cell_FACH',
  3: 'UTRAN Cell_DCH',
  4: 'GERAN CS connected',
  5: 'GERAN PS connected',
  6: 'GERAN CS and PS connected',
  7: 'E-UTRAN connected',
  8: 'NG-RAN connected',
  9: 'NG-RAN inactive',
};
const CSCON_ACCESS: Record<number, string> = { 0: 'GERAN', 1: 'UTRAN TDD', 2: 'UTRAN FDD', 3: 'E-UTRA TDD', 4: 'E-UTRA FDD', 5: 'NR' };
const CSCON_CORE: Record<number, string> = { 0: 'EPC', 1: '5GCN' };

const REG_N: Record<string, Record<number, string>> = {
  CEREG: {
    0: 'unsolicited +CEREG disabled',
    1: 'URC with <stat>',
    2: 'URC with <stat>, location (TAC, cell ID) and AcT',
    3: 'as 2, plus EMM reject cause',
    4: 'as 2, plus Active Time and Periodic TAU (for PSM)',
    5: 'as 4, plus EMM reject cause',
  },
  CREG: {
    0: 'unsolicited +CREG disabled',
    1: 'URC with <stat>',
    2: 'URC with <stat>, location (LAC/TAC, cell ID) and AcT',
    3: 'as 2, plus MM reject cause',
  },
};

const CSCON_N: Record<number, string> = {
  0: 'unsolicited +CSCON disabled',
  1: 'URC with <mode>',
  2: 'URC with <mode> and <state>',
  3: 'URC with <mode>, <state> and <access>',
  4: 'URC with <mode>, <state>, <access> and <coreNetwork>',
};

const CMEE_N: Record<number, string> = {
  0: '+CME ERROR disabled, plain ERROR is used',
  1: '+CME ERROR with numeric codes',
  2: '+CME ERROR with verbose text',
};

const CGEV_REASON: Record<number, string> = {
  0: 'IPv4 only allowed',
  1: 'IPv6 only allowed',
  2: 'single address bearers only allowed',
  3: 'single address bearers only allowed, and the second address type bearer could not be activated',
};

const CHANGE_REASON_BITS = [
  'TFT changed',
  'QoS changed',
  'WLAN offload changed',
  'relocation of PDU session anchor requested',
  'PDP address or PDP type changed',
  'ATSSS parameters changed',
  'P-CSCF restoration requested',
];

/** Commands this decoder knows, with their title and clause. */
export const COMMANDS: Record<string, { title: string; ref: string }> = {
  CEREG: { title: 'EPS network registration status', ref: '§10.1.22' },
  CREG: { title: 'Network registration (circuit mode)', ref: '§7.2' },
  COPS: { title: 'PLMN selection', ref: '§7.3' },
  CSQ: { title: 'Signal quality', ref: '§8.5' },
  CESQ: { title: 'Extended signal quality', ref: '§8.69' },
  CFUN: { title: 'Phone functionality', ref: '§8.2' },
  CPIN: { title: 'SIM PIN status', ref: '§8.3' },
  CCLK: { title: 'Clock', ref: '§8.15' },
  CSCON: { title: 'Signalling connection status', ref: '§10.1.30' },
  CGATT: { title: 'PS attach state', ref: '§10.1.9' },
  CGACT: { title: 'PDP context activation state', ref: '§10.1.10' },
  CGDCONT: { title: 'PDP context definition', ref: '§10.1.1' },
  CGPADDR: { title: 'PDP address', ref: '§10.1.14' },
  CGEV: { title: 'Packet domain event', ref: '§10.1.19' },
  CPSMS: { title: 'Power saving mode (PSM) setting', ref: '§7.38' },
  CEDRXS: { title: 'eDRX setting', ref: '§7.40' },
  CEDRXP: { title: 'eDRX parameters (URC)', ref: '§7.40' },
  CEDRXRDP: { title: 'eDRX dynamic parameters', ref: '§7.41' },
  CMEE: { title: 'Mobile termination error reporting', ref: '§9.1' },
  CME: { title: 'Mobile termination error', ref: '§9.2' },
  CGSN: { title: 'Product serial number (IMEI)', ref: '§5.4' },
  CIMI: { title: 'International mobile subscriber identity (IMSI)', ref: '§5.6' },
};

// ---------------------------------------------------------------------------------------------
// Value helpers

const minus = (x: number) => (x < 0 ? `−${-x}` : `${x}`);

function lookup(table: Record<number, string>, v: string | undefined, fallback = 'reserved or manufacturer-specific value'): string {
  if (!isInt(v)) return v === undefined || v === '' ? 'omitted' : 'not a number';
  return table[Number(v)] ?? fallback;
}

/**
 * Measurement index → range, for the +CESQ-style tables: index 0 is "< low1", index n is
 * [low1 + (n − 1)·step, low1 + n·step), and the top index is "≥ …" when openTop.
 */
export function measRange(n: number, low1: number, step: number, max: number, unit: string, label: string, openTop = true): string | null {
  if (!Number.isInteger(n) || n < 0 || n > max) return null;
  const lo = (k: number) => Number((low1 + (k - 1) * step).toFixed(2));
  if (n === 0) return `${label} < ${minus(low1)} ${unit}`;
  if (n === max && openTop) return `${label} ≥ ${minus(lo(n))} ${unit}`;
  return `${minus(lo(n))} ${unit} ≤ ${label} < ${minus(lo(n + 1))} ${unit}`;
}

interface MeasSpec {
  name: string;
  label: string;
  unit: string;
  low1: number;
  step: number;
  max: number;
  unknown: number;
  openTop?: boolean;
  what: string;
}

/** +CESQ parameters in order, TS 27.007 §8.69. */
export const CESQ_PARAMS: MeasSpec[] = [
  { name: '<rxlev>', label: 'RSSI', unit: 'dBm', low1: -110, step: 1, max: 63, unknown: 99, what: 'GSM received signal level' },
  { name: '<ber>', label: '', unit: '', low1: 0, step: 0, max: 7, unknown: 99, what: 'GSM bit error rate (RXQUAL)' },
  { name: '<rscp>', label: 'RSCP', unit: 'dBm', low1: -120, step: 1, max: 96, unknown: 255, what: 'UTRAN received signal code power' },
  { name: '<ecno>', label: 'Ec/Io', unit: 'dB', low1: -24, step: 0.5, max: 49, unknown: 255, what: 'UTRAN Ec/Io' },
  { name: '<rsrq>', label: 'RSRQ', unit: 'dB', low1: -19.5, step: 0.5, max: 34, unknown: 255, what: 'E-UTRAN reference signal received quality' },
  { name: '<rsrp>', label: 'RSRP', unit: 'dBm', low1: -140, step: 1, max: 97, unknown: 255, what: 'E-UTRAN reference signal received power' },
  { name: '<ss_rsrq>', label: 'SS-RSRQ', unit: 'dB', low1: -43, step: 0.5, max: 126, unknown: 255, openTop: false, what: 'NR SS-RSRQ' },
  { name: '<ss_rsrp>', label: 'SS-RSRP', unit: 'dBm', low1: -156, step: 1, max: 126, unknown: 255, what: 'NR SS-RSRP' },
  { name: '<ss_sinr>', label: 'SS-SINR', unit: 'dB', low1: -23, step: 0.5, max: 127, unknown: 255, what: 'NR SS-SINR' },
];

/** +CSQ <rssi>, §8.5: 0 ≤ −113 dBm, 1 = −111 dBm, 2…30 = −109…−53 dBm, 31 ≥ −51 dBm. */
export function csqRssi(n: number): string | null {
  if (n === 99) return 'not known or not detectable';
  if (!Number.isInteger(n) || n < 0 || n > 31) return null;
  if (n === 0) return '−113 dBm or less';
  if (n === 31) return '−51 dBm or greater';
  return `${minus(-113 + 2 * n)} dBm`;
}

/** Luhn check, used for the IMEI check digit (TS 23.003 Annex B). */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function decodeImei(s: string): Field[] {
  const d = s.trim();
  if (/^\d{15}$/.test(d)) {
    const ok = luhnValid(d);
    return [
      { name: 'TAC', value: d.slice(0, 8), meaning: 'Type Allocation Code: identifies the device model' },
      { name: 'SNR', value: d.slice(8, 14), meaning: 'serial number' },
      { name: 'CD', value: d[14], meaning: ok ? 'check digit, valid (Luhn)' : 'check digit does not match (Luhn): probably a typo', tone: ok ? 'ok' : 'bad' },
    ];
  }
  if (/^\d{16}$/.test(d)) {
    return [
      { name: 'TAC', value: d.slice(0, 8), meaning: 'Type Allocation Code: identifies the device model' },
      { name: 'SNR', value: d.slice(8, 14), meaning: 'serial number' },
      { name: 'SVN', value: d.slice(14), meaning: 'software version number (IMEISV)' },
    ];
  }
  return [{ name: 'IMEI', value: d, meaning: 'expected 15 digits (IMEI) or 16 digits (IMEISV)', tone: 'warn' }];
}

export function decodeImsi(s: string): Field[] {
  const d = s.trim();
  if (!/^\d{6,15}$/.test(d)) return [{ name: 'IMSI', value: d, meaning: 'expected up to 15 digits', tone: 'warn' }];
  return [
    { name: 'MCC', value: d.slice(0, 3), meaning: 'mobile country code' },
    { name: 'MNC + MSIN', value: d.slice(3), meaning: 'mobile network code (2 or 3 digits, depending on the operator) followed by the subscriber number' },
  ];
}

/** Numeric PLMN: 3-digit MCC + 2- or 3-digit MNC. */
function plmnMeaning(oper: string): string | null {
  if (!/^\d{5,6}$/.test(oper)) return null;
  return `MCC ${oper.slice(0, 3)}, MNC ${oper.slice(3)}`;
}

/** 28-bit E-UTRAN cell identity → eNB ID (20 bits) and cell (8 bits), TS 36.413 / TS 23.003. */
export function eutranCell(hex: string): string | null {
  if (!/^[0-9a-f]{1,8}$/i.test(hex)) return null;
  const eci = parseInt(hex, 16);
  if (eci > 0x0fffffff) return `${eci} (more than 28 bits, not a valid E-UTRAN cell ID)`;
  return `ECI ${eci} = eNB ID ${eci >>> 8}, cell ${eci & 0xff} (for a macro eNB)`;
}

function hexToDec(hex: string): string | null {
  return /^[0-9a-f]{1,8}$/i.test(hex) ? String(parseInt(hex, 16)) : null;
}

/** IPv6 given as 16 dot-separated decimal bytes (TS 27.007 PDP_addr) → RFC 5952 text. */
export function dottedToIpv6(s: string): string | null {
  const parts = s.split('.');
  if (parts.length !== 16 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null;
  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(Number(parts[i]) * 256 + Number(parts[i + 1]));
  // Compress the longest run (≥ 2) of zero groups.
  let best = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen && j - i >= 2) {
      best = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (best < 0) return hex.join(':');
  return `${hex.slice(0, best).join(':')}::${hex.slice(best + bestLen).join(':')}`;
}

function addrMeaning(a: string): string {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(a)) return 'IPv4 address';
  const v6 = dottedToIpv6(a);
  if (v6) return `IPv6 address ${v6}`;
  if (a.includes(':')) return 'IPv6 address';
  return 'address';
}

function timerField(name: string, kind: TimerKind, raw: string | undefined, what: string): { field: Field; notes: string[] } | null {
  if (raw === undefined || raw === '') return null;
  const p = parseByte(raw);
  if (!p.ok || !/^[01]{8}$/.test(raw.trim())) return { field: { name, value: raw, meaning: `${what}: expected 8 bits, e.g. "00100100"`, tone: 'warn' }, notes: [] };
  const t = decodeTimer(kind, p.value);
  const dur = t.seconds === null ? 'deactivated' : t.seconds === 0 ? '0 (see note)' : formatDuration(t.seconds);
  return {
    field: { name, value: raw, meaning: `${what} = ${dur} (unit ${t.unit.label}, value ${t.value})`, tone: t.seconds === null ? 'warn' : undefined },
    notes: t.notes,
  };
}

function edrxMode(act: number): EdrxMode | null {
  return act === 4 || act === 7 ? 'wb' : act === 5 || act === 6 ? 'nb' : null;
}

function edrxFields(f: Param[], from: number): { fields: Field[]; notes: string[] } {
  const fields: Field[] = [];
  const notes: string[] = [];
  const act = Number(f[from]?.value);
  fields.push({ name: '<AcT-type>', value: f[from]?.value ?? '', meaning: lookup(EDRX_ACT, f[from]?.value), tone: act === 0 ? 'warn' : undefined });
  const mode = edrxMode(act);
  const names = ['<Requested_eDRX_value>', '<NW-provided_eDRX_value>'];
  names.forEach((name, i) => {
    const raw = f[from + 1 + i]?.value;
    if (raw === undefined || raw === '') return;
    const p = parseNibble(raw);
    if (!p.ok || !/^[01]{4}$/.test(raw.trim())) {
      fields.push({ name, value: raw, meaning: 'expected 4 bits, e.g. "0101"', tone: 'warn' });
      return;
    }
    if (!mode) {
      fields.push({ name, value: raw, meaning: `eDRX value ${toBits(p.value, 4)} (cycle depends on the access technology)` });
      return;
    }
    const d = decodeEdrx(mode, p.value);
    const cycle = d.effective ? `${d.effective.seconds} s${d.effective.seconds >= 60 ? ` (${formatDuration(d.effective.seconds)})` : ''}` : 'eDRX not used';
    fields.push({ name, value: raw, meaning: `eDRX cycle ${cycle}`, tone: d.status === 'ok' ? (i === 1 ? 'ok' : undefined) : 'warn' });
    if (d.note) notes.push(d.note);
  });
  const ptwRaw = f[from + 3]?.value;
  if (ptwRaw !== undefined && ptwRaw !== '') {
    const p = parseNibble(ptwRaw);
    if (p.ok && /^[01]{4}$/.test(ptwRaw.trim()) && mode) {
      fields.push({ name: '<Paging_time_window>', value: ptwRaw, meaning: `paging time window ${ptwSeconds(mode, p.value)} s` });
    } else fields.push({ name: '<Paging_time_window>', value: ptwRaw, meaning: 'expected 4 bits; value depends on the access technology', tone: p.ok ? undefined : 'warn' });
  }
  const req = f[from + 1]?.value;
  const nw = f[from + 2]?.value;
  if (req && nw && req !== nw && mode) notes.push('The network granted a different eDRX cycle than requested. The granted value is the one in use.');
  return { fields, notes };
}

// ---------------------------------------------------------------------------------------------
// Per-command decoders. `form` is 'read' for a read/execute response, 'urc' for an unsolicited code.

type Form = 'read' | 'urc' | 'test';
interface Out {
  fields: Field[];
  notes: string[];
  tone?: Tone;
  form?: Form;
}

function decodeReg(cmd: 'CEREG' | 'CREG', f: Param[], form: Form | null): Out {
  // Read responses start with <n>; URCs start with <stat>. Without context, a quoted second
  // field means URC (<tac>), an unquoted integer second field means read (<stat>).
  const looksRead = f.length >= 2 && !f[1].quoted && isInt(f[1].value);
  const isRead = form ? form === 'read' : looksRead;
  const fields: Field[] = [];
  const notes: string[] = [];
  let i = 0;
  if (isRead) {
    fields.push({ name: '<n>', value: f[0].value, meaning: lookup(REG_N[cmd], f[0].value) });
    i = 1;
  }
  const statRaw = f[i]?.value;
  const stat = REG_STAT[Number(statRaw)];
  fields.push({ name: '<stat>', value: statRaw ?? '', meaning: isInt(statRaw) ? (stat?.text ?? 'reserved value') : 'missing', tone: stat?.tone });
  const area = cmd === 'CEREG' ? '<tac>' : '<lac>';
  const tac = f[i + 1]?.value;
  const ci = f[i + 2]?.value;
  const act = f[i + 3]?.value;
  const actN = isInt(act) ? Number(act) : null;
  if (tac) {
    const dec = hexToDec(tac);
    const what = cmd === 'CEREG' || (actN !== null && EUTRAN_ACT.has(actN)) ? 'tracking area code' : 'location area code';
    fields.push({ name: area, value: tac, meaning: dec ? `${what} ${dec} (decimal)` : 'expected hex, e.g. "00C3"', tone: dec ? undefined : 'warn' });
  }
  if (ci) {
    const eutran = cmd === 'CEREG' || (actN !== null && EUTRAN_ACT.has(actN));
    const m = eutran ? eutranCell(ci) : hexToDec(ci) && `cell ID ${hexToDec(ci)} (decimal)`;
    fields.push({ name: '<ci>', value: ci, meaning: m ?? 'expected hex', tone: m ? undefined : 'warn' });
  }
  if (act !== undefined && act !== '') fields.push({ name: '<AcT>', value: act, meaning: lookup(ACT, act) });
  const causeType = f[i + 4]?.value;
  const cause = f[i + 5]?.value;
  if (causeType) fields.push({ name: '<cause_type>', value: causeType, meaning: causeType === '0' ? (cmd === 'CEREG' ? 'EMM cause (TS 24.301 Annex A)' : 'MM cause (TS 24.008 Annex G)') : causeType === '1' ? 'manufacturer-specific cause' : 'reserved' });
  if (cause) {
    let meaning = 'see the module documentation';
    if (causeType === '0' && cmd === 'CEREG') meaning = isInt(cause) ? (EMM_CAUSES[Number(cause)] ? `#${cause} ${EMM_CAUSES[Number(cause)]}` : `#${cause}: not in the table, treated as "protocol error, unspecified"`) : 'not a number';
    else if (causeType === '0') meaning = `MM cause #${cause}, see TS 24.008 Annex G`;
    fields.push({ name: '<reject_cause>', value: cause, meaning, tone: 'bad' });
  }
  if (cmd === 'CEREG') {
    const at = timerField('<Active-Time>', 't3324', f[i + 6]?.value, 'T3324 Active Time');
    const tau = timerField('<Periodic-TAU>', 't3412', f[i + 7]?.value, 'T3412 extended periodic TAU');
    for (const t of [at, tau]) {
      if (!t) continue;
      fields.push(t.field);
      notes.push(...t.notes);
    }
    if (!at && !tau && (statRaw === '1' || statRaw === '5') && f.length >= i + 4)
      notes.push('No Active-Time / Periodic-TAU fields: use AT+CEREG=4 (or 5) to see the PSM timers granted by the network.');
  }
  if (statRaw === '3') notes.push('Registration denied: the reject cause (AT+CEREG=5, or 3 for +CREG) tells you why. Common causes are a SIM without data plan, a barred IMEI or a missing roaming agreement.');
  if (statRaw === '2') notes.push('Still searching. If this lasts minutes, check the band configuration, the antenna and whether the SIM supports this RAT (LTE-M vs NB-IoT).');
  return { fields, notes, tone: stat?.tone, form: isRead ? 'read' : 'urc' };
}

function decodeCops(f: Param[], form: Form | null): Out {
  // Test response: (stat,"long","short","numeric",AcT),(…),,(modes),(formats)
  if (form === 'test' || f[0]?.value.startsWith('(')) {
    const fields: Field[] = [];
    for (const p of f) {
      const m = /^\((.*)\)$/.exec(p.value);
      if (!m) continue;
      const g = splitParams(m[1]);
      if (g.length >= 4 && g[1].quoted) {
        const plmn = plmnMeaning(g[3].value);
        const act = g[4]?.value;
        fields.push({
          name: g[1].value || g[3].value,
          value: p.value,
          meaning: `${lookup(COPS_STAT, g[0].value)}${plmn ? `; ${plmn}` : ''}${act ? `; ${lookup(ACT, act)}` : ''}`,
          tone: g[0].value === '2' ? 'ok' : g[0].value === '3' ? 'bad' : undefined,
        });
      }
    }
    return { fields, notes: fields.length ? [] : ['List of supported values.'], form: 'test' };
  }
  const fields: Field[] = [{ name: '<mode>', value: f[0]?.value ?? '', meaning: lookup(COPS_MODE, f[0]?.value) }];
  if (f[1]?.value) fields.push({ name: '<format>', value: f[1].value, meaning: lookup(COPS_FORMAT, f[1].value) });
  if (f[2]?.value) fields.push({ name: '<oper>', value: f[2].value, meaning: plmnMeaning(f[2].value) ?? 'operator name' });
  if (f[3]?.value) fields.push({ name: '<AcT>', value: f[3].value, meaning: lookup(ACT, f[3].value) });
  const notes = f.length === 1 ? ['No operator: the module is not registered.'] : [];
  return { fields, notes, tone: f.length === 1 ? 'warn' : undefined };
}

function decodeCsq(f: Param[]): Out {
  const n = Number(f[0]?.value);
  const rssi = isInt(f[0]?.value) ? csqRssi(n) : null;
  const ber = f[1]?.value;
  return {
    fields: [
      { name: '<rssi>', value: f[0]?.value ?? '', meaning: rssi ?? 'out of range', tone: n === 99 ? 'warn' : rssi ? undefined : 'warn' },
      { name: '<ber>', value: ber ?? '', meaning: ber === '99' ? 'not known or not detectable' : isInt(ber) && Number(ber) <= 7 ? `RXQUAL ${ber} (TS 45.008 §8.2.4)` : 'out of range' },
    ],
    notes: ['+CSQ is a GSM-era indicator. On LTE-M and NB-IoT modules the mapping from LTE measurements is manufacturer-specific. Use +CESQ for RSRP and RSRQ.'],
  };
}

function decodeCesq(f: Param[]): Out {
  const fields: Field[] = [];
  const unknown: string[] = [];
  CESQ_PARAMS.forEach((spec, i) => {
    const raw = f[i]?.value;
    if (raw === undefined) return;
    const n = Number(raw);
    if (!isInt(raw)) {
      fields.push({ name: spec.name, value: raw, meaning: 'not a number', tone: 'warn' });
      return;
    }
    if (n === spec.unknown) {
      unknown.push(spec.name);
      return;
    }
    let meaning: string | null;
    if (spec.name === '<ber>') meaning = n <= 7 ? `RXQUAL ${n}` : null;
    else meaning = measRange(n, spec.low1, spec.step, spec.max, spec.unit, spec.label, spec.openTop ?? true);
    fields.push({ name: spec.name, value: raw, meaning: meaning ? `${spec.what}: ${meaning}` : 'out of range', tone: meaning ? undefined : 'warn' });
  });
  const notes: string[] = [];
  if (unknown.length) notes.push(`Not known or not detectable (not measured on this RAT): ${unknown.join(', ')}.`);
  if (f.length !== 9) notes.push(`Expected 9 parameters, got ${f.length}.`);
  return { fields, notes };
}

function decodeCscon(f: Param[], form: Form | null): Out {
  // Read: <n>,<mode>[,<state>[,<access>[,<coreNetwork>]]]  URC: <mode>[,<state>[,<access>[,<coreNetwork>]]]
  const notes: string[] = [];
  let isRead: boolean;
  if (form) isRead = form === 'read';
  else if (f.length === 1) isRead = false;
  else if (Number(f[0].value) > 1) isRead = true;
  else if (Number(f[1].value) > 1) isRead = false;
  else {
    isRead = false;
    notes.push('Read as an unsolicited result code. Without the AT+CSCON? line before it, "+CSCON: a,b" with both values 0 or 1 could also be a read response (<n>,<mode>).');
  }
  const fields: Field[] = [];
  let i = 0;
  if (isRead) {
    fields.push({ name: '<n>', value: f[0].value, meaning: lookup(CSCON_N, f[0].value) });
    i = 1;
  }
  const mode = f[i]?.value;
  fields.push({ name: '<mode>', value: mode ?? '', meaning: lookup(CSCON_MODE, mode), tone: mode === '1' ? 'ok' : undefined });
  if (f[i + 1]?.value) fields.push({ name: '<state>', value: f[i + 1].value, meaning: lookup(CSCON_STATE, f[i + 1].value) });
  if (f[i + 2]?.value) fields.push({ name: '<access>', value: f[i + 2].value, meaning: lookup(CSCON_ACCESS, f[i + 2].value) });
  if (f[i + 3]?.value) fields.push({ name: '<coreNetwork>', value: f[i + 3].value, meaning: lookup(CSCON_CORE, f[i + 3].value) });
  if (mode === '1') notes.push('RRC connected: the radio is on. Time spent here after the last packet is set by the network’s inactivity timer, unless RAI is used.');
  return { fields, notes, form: isRead ? 'read' : 'urc' };
}

function decodeCclk(f: Param[]): Out {
  const s = f.map((p) => p.value).join(',');
  const m = /^(\d{2})\/(\d{2})\/(\d{2}),(\d{2}):(\d{2}):(\d{2})([+-]\d{1,2})?$/.exec(s.trim());
  if (!m) return { fields: [{ name: '<time>', value: s, meaning: 'expected "yy/MM/dd,hh:mm:ss±zz"', tone: 'warn' }], notes: [] };
  const [, yy, MM, dd, hh, mm, ss, zz] = m;
  // Two-digit year: 70–99 → 19xx (covers the 1970 / 1980 power-on defaults), 00–69 → 20xx.
  const year = Number(yy) >= 70 ? 1900 + Number(yy) : 2000 + Number(yy);
  const fields: Field[] = [{ name: '<time>', value: s, meaning: `local time ${year}-${MM}-${dd} ${hh}:${mm}:${ss}` }];
  const notes: string[] = [];
  if (zz !== undefined) {
    const q = Number(zz);
    const offMin = q * 15;
    const sign = offMin < 0 ? '−' : '+';
    const abs = Math.abs(offMin);
    const off = `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
    const local = Date.UTC(year, Number(MM) - 1, Number(dd), Number(hh), Number(mm), Number(ss));
    const utc = new Date(local - offMin * 60000).toISOString().replace('.000Z', 'Z');
    fields.push({ name: 'zz', value: zz, meaning: `time zone ${q} quarter-hours = ${off}` });
    fields.push({ name: 'UTC', value: utc, meaning: 'the same instant in UTC' });
    if (q < -96 || q > 96) notes.push('Time zone out of range (−96…+96 quarter-hours).');
  }
  if (year < 2000 || yy === '00') notes.push('A default-looking date: the clock may not have been set by the network (NITZ) yet.');
  return { fields, notes };
}

function decodeCgdcont(f: Param[]): Out {
  const names = ['<cid>', '<PDP_type>', '<APN>', '<PDP_addr>', '<d_comp>', '<h_comp>', '<IPv4AddrAlloc>', '<request_type>', '<P-CSCF_discovery>', '<IM_CN_Signalling_Flag_Ind>', '<NSLPI>', '<securePCO>', '<IPv4_MTU_discovery>', '<Local_Addr_Ind>', '<Non-IP_MTU_discovery>', '<Reliable_Data_Service>'];
  const PDP_TYPE: Record<string, string> = {
    IP: 'IPv4',
    IPV6: 'IPv6',
    IPV4V6: 'dual stack IPv4 and IPv6',
    'NON-IP': 'Non-IP data (e.g. via SCEF/NIDD)',
    PPP: 'Point-to-Point Protocol',
    ETHERNET: 'Ethernet',
    UNSTRUCTURED: 'unstructured data (5GS)',
  };
  const meaning: Record<string, (v: string) => string> = {
    '<cid>': () => 'context identifier',
    '<PDP_type>': (v) => PDP_TYPE[v.toUpperCase()] ?? 'other PDP type',
    '<APN>': (v) => (v ? 'access point name' : 'empty: the network uses the subscription default APN'),
    '<PDP_addr>': (v) => (v ? addrMeaning(v) : 'none'),
    '<d_comp>': (v) => lookup({ 0: 'off', 1: 'on (manufacturer preferred)', 2: 'V.42bis', 3: 'V.44' }, v) + ' (data compression, SNDCP only)',
    '<h_comp>': (v) => lookup({ 0: 'off', 1: 'on (manufacturer preferred)', 2: 'RFC 1144', 3: 'RFC 2507', 4: 'RFC 3095' }, v) + ' (header compression)',
    '<IPv4AddrAlloc>': (v) => lookup({ 0: 'IPv4 address through NAS signalling', 1: 'IPv4 address through DHCP' }, v),
    '<request_type>': (v) =>
      lookup(
        {
          0: 'new PDP context or handover from non-3GPP access',
          1: 'emergency bearer services',
          2: 'new PDP context establishment',
          3: 'handover from non-3GPP access',
          4: 'handover of emergency bearer services from non-3GPP access',
          5: 'MA PDU session establishment',
        },
        v,
      ),
    '<NSLPI>': (v) => lookup({ 0: 'low priority indicator as configured in the MT', 1: 'not configured for NAS signalling low priority' }, v),
  };
  const fields: Field[] = [];
  f.forEach((p, i) => {
    const name = names[i] ?? `parameter ${i + 1}`;
    if (p.value === '' && i > 3) return;
    fields.push({ name, value: p.value, meaning: meaning[name]?.(p.value) ?? (i < names.length ? 'see TS 27.007 §10.1.1' : 'later parameter, see TS 27.007 §10.1.1') });
  });
  return { fields, notes: [] };
}

function decodeCgpaddr(f: Param[]): Out {
  const fields: Field[] = [{ name: '<cid>', value: f[0]?.value ?? '', meaning: 'context identifier' }];
  f.slice(1).forEach((p, i) => {
    if (p.value) fields.push({ name: `<PDP_addr_${i + 1}>`, value: p.value, meaning: addrMeaning(p.value) });
  });
  const notes = f.length === 1 || f.slice(1).every((p) => !p.value) ? ['No address: the context is not active.'] : [];
  return { fields, notes, tone: notes.length ? 'warn' : 'ok' };
}

function decodeCgev(rest: string): Out {
  const s = rest.trim();
  const m = /^(NW|ME)?\s*(PDN ACT|PDN DEACT|ACT|DEACT|MODIFY|DETACH|CLASS|REACT)\s*(.*)$|^(REJECT)\s*(.*)$/i.exec(s);
  if (!m) return { fields: [{ name: 'event', value: s, meaning: 'unknown event' }], notes: [] };
  const who = m[4] ? null : (m[1] ?? '').toUpperCase();
  const ev = (m[2] ?? m[4]).toUpperCase();
  const args = splitParams(m[3] ?? m[5] ?? '').filter((p, _i, a) => !(a.length === 1 && p.value === ''));
  const by = who === 'NW' ? 'The network' : who === 'ME' ? 'The module' : 'The network';
  const fields: Field[] = [];
  let tone: Tone | undefined;
  let what = '';
  const cid = (i: number) => args[i] && fields.push({ name: '<cid>', value: args[i].value, meaning: 'context identifier (see +CGDCONT)' });
  switch (ev) {
    case 'DETACH':
      what = `${by} forced a PS detach; all contexts are deactivated.`;
      tone = 'bad';
      break;
    case 'PDN ACT':
      what = `${by} activated a PDN connection.`;
      tone = 'ok';
      cid(0);
      if (args[1]?.value) fields.push({ name: '<reason>', value: args[1].value, meaning: lookup(CGEV_REASON, args[1].value) });
      if (args[2]?.value) fields.push({ name: '<cid_other>', value: args[2].value, meaning: 'context for the second address type' });
      break;
    case 'PDN DEACT':
      what = `${by} deactivated a PDN connection.`;
      tone = 'warn';
      cid(0);
      break;
    case 'ACT':
    case 'DEACT':
      if (args.length >= 2 && !args[0].quoted && isInt(args[0].value) && isInt(args[1].value)) {
        what = ev === 'ACT' ? `${by === 'The module' ? 'The network responded to a module-initiated' : 'The network activated a'} dedicated bearer (secondary context).` : `${by === 'The module' ? 'The network responded to a module-initiated' : 'The network deactivated a'} dedicated bearer.`;
        fields.push({ name: '<p_cid>', value: args[0].value, meaning: 'primary context' });
        fields.push({ name: '<cid>', value: args[1].value, meaning: 'secondary context' });
        if (args[2]) fields.push({ name: '<event_type>', value: args[2].value, meaning: lookup({ 0: 'informational', 1: 'acknowledgement required (+CGANS)' }, args[2].value) });
      } else {
        what = `${by} forced a context deactivation.`;
        tone = 'warn';
        if (args[0]) fields.push({ name: '<PDP_type>', value: args[0].value, meaning: 'PDP type' });
        if (args[1]) fields.push({ name: '<PDP_addr>', value: args[1].value, meaning: addrMeaning(args[1].value) });
        cid(2);
      }
      break;
    case 'MODIFY': {
      what = `${by} modified a context.`;
      cid(0);
      const cr = Number(args[1]?.value);
      if (args[1]) {
        const bits = CHANGE_REASON_BITS.filter((_, b) => cr & (1 << b));
        fields.push({ name: '<change_reason>', value: args[1].value, meaning: bits.length ? bits.join(', ') : 'no change bit set' });
      }
      if (args[2]) fields.push({ name: '<event_type>', value: args[2].value, meaning: lookup({ 0: 'informational', 1: 'acknowledgement required (+CGANS)' }, args[2].value) });
      break;
    }
    case 'CLASS':
      what = `${by} forced a change of MT class.`;
      if (args[0]) fields.push({ name: '<class>', value: args[0].value, meaning: 'see +CGCLASS' });
      break;
    case 'REACT':
      what = 'The network requested a context reactivation.';
      if (args[0]) fields.push({ name: '<PDP_type>', value: args[0].value, meaning: 'PDP type' });
      if (args[1]) fields.push({ name: '<PDP_addr>', value: args[1].value, meaning: addrMeaning(args[1].value) });
      cid(2);
      break;
    case 'REJECT':
      what = 'A network request for context activation was automatically rejected.';
      tone = 'warn';
      if (args[0]) fields.push({ name: '<PDP_type>', value: args[0].value, meaning: 'PDP type' });
      if (args[1]) fields.push({ name: '<PDP_addr>', value: args[1].value, meaning: addrMeaning(args[1].value) });
      break;
  }
  return { fields: [{ name: 'event', value: `${who ? `${who} ` : ''}${ev}`, meaning: what }, ...fields], notes: [], tone };
}

/** Look up a +CME ERROR code: general, then EPS, then GPRS-only and VBS tables. */
export function cmeError(code: number): { text: string; domain: string } | null {
  if (CME_GENERAL[code]) return { text: CME_GENERAL[code], domain: 'general' };
  if (CME_EPS[code]) return { text: CME_EPS[code], domain: 'EPS' };
  if (CME_GPRS[code]) return { text: CME_GPRS[code], domain: 'GPRS/UMTS' };
  if (CME_VBS[code]) return { text: CME_VBS[code], domain: 'VBS/VGCS/eMLPP' };
  return null;
}

function decodeCme(rest: string): Out {
  const v = rest.trim();
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    const e = cmeError(n);
    const notes: string[] = [];
    if (!e) notes.push(n >= 256 ? 'Codes from 256 up are manufacturer-specific: check the module’s AT manual.' : 'Reserved code, not defined in TS 27.007.');
    if (e?.domain === 'GPRS/UMTS') notes.push('This code is only defined for GPRS/UMTS in TS 27.007.');
    if (n === 30) notes.push('No network service: check registration with AT+CEREG? first.');
    return { fields: [{ name: '<err>', value: v, meaning: e ? `${e.text}${e.domain === 'general' ? '' : ` (${e.domain})`}` : 'unknown code' }], notes, tone: 'bad' };
  }
  const lower = v.toLowerCase();
  const tables = [CME_GENERAL, CME_EPS, CME_GPRS, CME_VBS];
  for (const t of tables) {
    for (const [code, text] of Object.entries(t)) {
      if (text.toLowerCase() === lower || text.toLowerCase().replace(/\s*\(#\d+\)$/, '') === lower) {
        return { fields: [{ name: '<err>', value: v, meaning: `verbose form of code ${code}` }], notes: [], tone: 'bad' };
      }
    }
  }
  return { fields: [{ name: '<err>', value: v, meaning: 'verbose error text (not a TS 27.007 string: probably manufacturer-specific)' }], notes: [], tone: 'bad' };
}

function decodePsms(f: Param[], form: Form | null): Out {
  if (form === 'test' || f[0]?.value.startsWith('(')) return { fields: [], notes: ['List of supported values.'] };
  const fields: Field[] = [{ name: '<mode>', value: f[0]?.value ?? '', meaning: lookup({ 0: 'PSM disabled', 1: 'PSM enabled', 2: 'PSM disabled, parameters discarded' }, f[0]?.value) }];
  const notes: string[] = [];
  if (f[1]?.value) fields.push({ name: '<Requested_Periodic-RAU>', value: f[1].value, meaning: 'T3312 for GERAN/UTRAN, not used on LTE-M / NB-IoT' });
  if (f[2]?.value) fields.push({ name: '<Requested_GPRS-READY-timer>', value: f[2].value, meaning: 'T3314 for GERAN/UTRAN, not used on LTE-M / NB-IoT' });
  for (const t of [timerField('<Requested_Periodic-TAU>', 't3412', f[3]?.value, 'requested T3412'), timerField('<Requested_Active-Time>', 't3324', f[4]?.value, 'requested T3324')]) {
    if (!t) continue;
    fields.push(t.field);
    notes.push(...t.notes);
  }
  notes.push('These are the values requested by the module. The network may grant different ones: read them with AT+CEREG=4 then AT+CEREG?.');
  return { fields, notes };
}

// ---------------------------------------------------------------------------------------------
// Commands typed by the host (echo): AT+XXX, AT+XXX?, AT+XXX=?, AT+XXX=…

function decodeSet(cmd: string, f: Param[]): Out {
  const v0 = f[0]?.value;
  switch (cmd) {
    case 'CEREG':
    case 'CREG':
      return { fields: [{ name: '<n>', value: v0 ?? '', meaning: lookup(REG_N[cmd], v0) }], notes: [] };
    case 'CSCON':
      return { fields: [{ name: '<n>', value: v0 ?? '', meaning: lookup(CSCON_N, v0) }], notes: [] };
    case 'CMEE':
      return { fields: [{ name: '<n>', value: v0 ?? '', meaning: lookup(CMEE_N, v0) }], notes: [] };
    case 'CFUN': {
      const fields: Field[] = [{ name: '<fun>', value: v0 ?? '', meaning: isInt(v0) && Number(v0) >= 5 && Number(v0) <= 127 ? 'manufacturer-specific intermediate state' : lookup(CFUN, v0) }];
      if (f[1]?.value) fields.push({ name: '<rst>', value: f[1].value, meaning: lookup({ 0: 'no reset', 1: 'reset the MT first' }, f[1].value) });
      return { fields, notes: [] };
    }
    case 'CGATT':
      return { fields: [{ name: '<state>', value: v0 ?? '', meaning: lookup({ 0: 'detach', 1: 'attach' }, v0) }], notes: [] };
    case 'CGACT': {
      const fields: Field[] = [{ name: '<state>', value: v0 ?? '', meaning: lookup({ 0: 'deactivate', 1: 'activate' }, v0) }];
      f.slice(1).forEach((p) => fields.push({ name: '<cid>', value: p.value, meaning: 'context identifier' }));
      return { fields, notes: [] };
    }
    case 'COPS': {
      const fields: Field[] = [{ name: '<mode>', value: v0 ?? '', meaning: lookup(COPS_MODE, v0) }];
      if (f[1]?.value) fields.push({ name: '<format>', value: f[1].value, meaning: lookup(COPS_FORMAT, f[1].value) });
      if (f[2]?.value) fields.push({ name: '<oper>', value: f[2].value, meaning: plmnMeaning(f[2].value) ?? 'operator name' });
      if (f[3]?.value) fields.push({ name: '<AcT>', value: f[3].value, meaning: lookup(ACT, f[3].value) });
      return { fields, notes: [] };
    }
    case 'CPSMS':
      return decodePsms(f, 'read');
    case 'CEDRXS': {
      const fields: Field[] = [{ name: '<mode>', value: v0 ?? '', meaning: lookup({ 0: 'disable eDRX', 1: 'enable eDRX', 2: 'enable eDRX and the +CEDRXP URC', 3: 'disable eDRX and discard parameters' }, v0) }];
      if (f.length < 2) return { fields, notes: [] };
      const e = edrxFields(f, 1);
      return { fields: [...fields, ...e.fields.slice(0, 2)], notes: e.notes };
    }
    case 'CGDCONT':
      return decodeCgdcont(f);
    case 'CGSN':
      return { fields: [{ name: '<snt>', value: v0 ?? '', meaning: lookup({ 0: 'serial number (usually the IMEI), without prefix', 1: 'IMEI', 2: 'IMEISV', 3: 'SVN' }, v0) }], notes: [] };
    default:
      return { fields: [], notes: [] };
  }
}

// ---------------------------------------------------------------------------------------------
// The log parser

const FINAL: Record<string, { text: string; tone: Tone }> = {
  OK: { text: 'command completed successfully', tone: 'ok' },
  ERROR: { text: 'command failed (enable AT+CMEE=1 or 2 to get the reason)', tone: 'bad' },
  'NO CARRIER': { text: 'connection terminated or could not be established', tone: 'bad' },
  CONNECT: { text: 'connected; data mode follows', tone: 'ok' },
  RING: { text: 'incoming call', tone: 'warn' },
  'NO DIALTONE': { text: 'no dial tone', tone: 'bad' },
  BUSY: { text: 'busy', tone: 'bad' },
  'NO ANSWER': { text: 'no answer', tone: 'bad' },
};

function ref(cmd: string): string | null {
  return COMMANDS[cmd] ? `TS 27.007 ${COMMANDS[cmd].ref}` : null;
}

export function decodeLog(text: string): Decoded[] {
  const out: Decoded[] = [];
  /** The last command sent, so that responses are decoded in the right form. */
  let ctx: { cmd: string; form: Form | 'set' | 'exec' } | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const raw = rawLine.replace(/\s+$/, '');
    // Strip common log prefixes: timestamps "[12:00:01.123]", "12:00:01.123 >", "<< " / ">> ".
    const line = raw
      .replace(/^\s*\[[^\]]*\]\s*/, '')
      .replace(/^\s*\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?\s*(?:[<>-]+\s*)?/, '')
      .replace(/^\s*(?:<<|>>|<-|->|RX:|TX:)\s*/i, '')
      .trim();
    if (line === '') continue;

    // Command echo
    const cm = /^AT([+%#$^][A-Z0-9]+)?(.*)$/i.exec(line);
    if (cm && /^AT/i.test(line)) {
      const name = (cm[1] ?? '').toUpperCase();
      const tail = cm[2] ?? '';
      const cmd = name.replace(/^\+/, '');
      const std = name.startsWith('+') && COMMANDS[cmd];
      let form: Form | 'set' | 'exec' = 'exec';
      if (tail === '?') form = 'read';
      else if (tail === '=?') form = 'test';
      else if (tail.startsWith('=')) form = 'set';
      ctx = name ? { cmd, form } : null;
      const verb = { read: 'Read', test: 'Test (list supported values)', set: 'Set', exec: 'Execute' }[form];
      const d = form === 'set' && std ? decodeSet(cmd, splitParams(tail.slice(1))) : { fields: [], notes: [] };
      out.push({
        raw,
        kind: 'command',
        command: name || null,
        title: name ? `${verb}: ${std ? COMMANDS[cmd].title : name.startsWith('+') ? 'command not decoded here' : 'manufacturer-specific command'}` : 'Attention (AT)',
        ref: std ? ref(cmd) : null,
        fields: d.fields,
        notes: name && !name.startsWith('+') ? ['Commands starting with %, #, $ or ^ are vendor extensions: see the module’s AT manual.', ...d.notes] : d.notes,
      });
      continue;
    }

    const upper = line.toUpperCase();
    if (FINAL[upper]) {
      out.push({ raw, kind: 'final', command: null, title: upper, ref: 'ITU-T V.250', fields: [], notes: [FINAL[upper].text], tone: FINAL[upper].tone });
      ctx = null;
      continue;
    }

    const em = /^\+(CME|CMS) ERROR:\s*(.*)$/i.exec(line);
    if (em) {
      if (em[1].toUpperCase() === 'CMS') {
        out.push({ raw, kind: 'error', command: '+CMS ERROR', title: 'SMS error', ref: 'TS 27.005 §3.2.5', fields: [{ name: '<err>', value: em[2], meaning: 'message service failure; codes are listed in TS 27.005' }], notes: [], tone: 'bad' });
      } else {
        const d = decodeCme(em[2]);
        out.push({ raw, kind: 'error', command: '+CME ERROR', title: 'Mobile termination error', ref: 'TS 27.007 §9.2', ...d });
      }
      ctx = null;
      continue;
    }

    const rm = /^\+([A-Z0-9]+):\s*(.*)$/i.exec(line);
    if (rm) {
      const cmd = rm[1].toUpperCase();
      const rest = rm[2];
      // A set command (AT+CEREG=5) has no information response, so a +CEREG line before its OK is a URC.
      // Execute commands with parameters (AT+CGPADDR=1) answer in their only form, so nothing is lost.
      const ctxForm: Form | null = ctx && ctx.cmd === cmd && ctx.form !== 'set' ? (ctx.form === 'test' ? 'test' : 'read') : null;
      const isResponse = ctxForm !== null;
      const f = splitParams(rest);
      let d: Out | null = null;
      switch (cmd) {
        case 'CEREG':
        case 'CREG':
          if (ctxForm === 'test') d = { fields: [], notes: ['List of supported <n> values.'] };
          else d = decodeReg(cmd, f, ctxForm);
          break;
        case 'COPS':
          d = decodeCops(f, ctxForm);
          break;
        case 'CSQ':
          d = ctxForm === 'test' ? { fields: [], notes: ['List of supported values.'] } : decodeCsq(f);
          break;
        case 'CESQ':
          d = ctxForm === 'test' ? { fields: [], notes: ['List of supported values.'] } : decodeCesq(f);
          break;
        case 'CFUN':
          d = decodeSet('CFUN', f);
          d.tone = f[0]?.value === '1' ? 'ok' : f[0]?.value === '0' || f[0]?.value === '4' ? 'warn' : undefined;
          if (f[0]?.value === '4' || f[0]?.value === '0') d.notes.push('The radio is off: the module cannot register until AT+CFUN=1.');
          break;
        case 'CPIN': {
          const code = rest.trim().replace(/^"|"$/g, '').toUpperCase();
          d = { fields: [{ name: '<code>', value: rest.trim(), meaning: CPIN[code] ?? 'manufacturer-specific code' }], notes: [], tone: code === 'READY' ? 'ok' : 'warn' };
          break;
        }
        case 'CCLK':
          d = decodeCclk(f);
          break;
        case 'CSCON':
          d = decodeCscon(f, ctxForm);
          break;
        case 'CGATT':
          d = { fields: [{ name: '<state>', value: f[0]?.value ?? '', meaning: lookup({ 0: 'detached', 1: 'attached' }, f[0]?.value) }], notes: [], tone: f[0]?.value === '1' ? 'ok' : 'warn' };
          break;
        case 'CGACT':
          d = { fields: [{ name: '<cid>', value: f[0]?.value ?? '', meaning: 'context identifier' }, { name: '<state>', value: f[1]?.value ?? '', meaning: lookup({ 0: 'deactivated', 1: 'activated' }, f[1]?.value) }], notes: [], tone: f[1]?.value === '1' ? 'ok' : 'warn' };
          break;
        case 'CGDCONT':
          d = ctxForm === 'test' ? { fields: [], notes: ['List of supported values.'] } : decodeCgdcont(f);
          break;
        case 'CGPADDR':
          d = decodeCgpaddr(f);
          break;
        case 'CGEV':
          d = decodeCgev(rest);
          break;
        case 'CPSMS':
          d = decodePsms(f, ctxForm);
          break;
        case 'CEDRXS':
        case 'CEDRXP':
        case 'CEDRXRDP':
          d = ctxForm === 'test' ? { fields: [], notes: ['List of supported values.'] } : edrxFields(f, 0);
          if (cmd === 'CEDRXS' && ctxForm !== 'test') d.fields = d.fields.slice(0, 2);
          break;
        case 'CMEE':
          d = { fields: [{ name: '<n>', value: f[0]?.value ?? '', meaning: lookup(CMEE_N, f[0]?.value) }], notes: [] };
          break;
        case 'CGSN':
          d = { fields: decodeImei(rest.replace(/"/g, '')), notes: [] };
          break;
      }
      const known = !!COMMANDS[cmd];
      const isUrc = !isResponse && (cmd === 'CEDRXP' || cmd === 'CGEV' || d?.form === 'urc');
      const formLabel = isUrc ? ' (unsolicited)' : ctxForm === 'test' ? ' (supported values)' : '';
      out.push({
        raw,
        kind: isUrc ? 'urc' : known ? 'response' : 'unknown',
        command: `+${cmd}`,
        title: known ? `${COMMANDS[cmd].title}${formLabel}` : 'Not a TS 27.007 response decoded here',
        ref: known ? ref(cmd) : null,
        fields: d?.fields ?? [],
        notes: known ? (d?.notes ?? []) : ['Probably manufacturer-specific, or a standard command this tool does not decode yet.'],
        tone: d?.tone,
      });
      continue;
    }

    // Vendor-prefixed responses (%XMONITOR:, #SOCK:, ^SYSINFO:, $GPS…)
    if (/^[%#$^][A-Z0-9]+:/i.test(line)) {
      out.push({ raw, kind: 'unknown', command: line.split(':')[0], title: 'Manufacturer-specific response', ref: null, fields: [], notes: ['See the module’s AT command manual.'] });
      continue;
    }

    // Bare information text: IMEI after AT+CGSN, IMSI after AT+CIMI.
    if (ctx && /^\d{6,16}$/.test(line) && (ctx.cmd === 'CGSN' || ctx.cmd === 'CIMI' || ctx.cmd === 'GSN')) {
      const imsi = ctx.cmd === 'CIMI';
      out.push({
        raw,
        kind: 'response',
        command: `+${ctx.cmd}`,
        title: imsi ? 'IMSI' : 'IMEI',
        ref: imsi ? 'TS 27.007 §5.6, TS 23.003 §2.2' : 'TS 27.007 §5.4, TS 23.003 §6.2',
        fields: imsi ? decodeImsi(line) : decodeImei(line),
        notes: [],
      });
      continue;
    }

    out.push({ raw, kind: 'info', command: null, title: 'Information text', ref: null, fields: [], notes: [] });
  }
  return out;
}

/** A short example log used to pre-fill the page. */
export const EXAMPLE_LOG = `AT+CFUN?
+CFUN: 1
OK
AT+CEREG=5
OK
+CEREG: 2,"1A2D","01A2D101",7
+CSCON: 1
+CEREG: 1,"1A2D","01A2D101",7,,,"00000110","00101000"
AT+COPS?
+COPS: 0,2,"20801",7
OK
AT+CESQ
+CESQ: 99,99,255,255,22,41,255,255,255
OK
AT+CEDRXRDP
+CEDRXRDP: 4,"0101","0010","0011"
OK
+CGEV: ME PDN ACT 1
AT+CGPADDR=1
+CGPADDR: 1,"10.160.34.17"
OK
+CSCON: 0
AT+CGDCONT=1,"IP","iot.example"
+CME ERROR: 3`;

// ---------------------------------------------------------------------------------------------
// Summary: the modem state at the end of the log

export interface SummaryItem {
  label: string;
  value: string;
  tone?: Tone;
}

const after = (s: string, sep: string) => (s.includes(sep) ? s.slice(s.indexOf(sep) + sep.length) : s);
const duration = (s: string) => /= (.+?) \(/.exec(s)?.[1] ?? s;

/** Latest known value of each key fact, in a fixed order. */
export function summarize(lines: Decoded[]): SummaryItem[] {
  const m = new Map<string, SummaryItem>();
  let errors = 0;
  for (const d of lines) {
    const f = (n: string) => d.fields.find((x) => x.name === n);
    switch (d.command) {
      case '+CEREG':
      case '+CREG': {
        const stat = f('<stat>');
        if (stat) m.set('reg', { label: 'Registration', value: stat.meaning, tone: stat.tone });
        const act = f('<AcT>');
        if (act) m.set('rat', { label: 'Access technology', value: act.meaning });
        const tac = f('<tac>') ?? f('<lac>');
        const ci = f('<ci>');
        if (tac && ci) m.set('cell', { label: 'Cell', value: `TAC ${tac.value}, cell ${ci.value}` });
        const rc = f('<reject_cause>');
        if (rc) m.set('reject', { label: 'Last reject cause', value: rc.meaning, tone: 'bad' });
        const at = f('<Active-Time>');
        const tau = f('<Periodic-TAU>');
        if (at || tau) m.set('psm', { label: 'PSM granted', value: [at && `Active Time ${duration(at.meaning)}`, tau && `periodic TAU ${duration(tau.meaning)}`].filter(Boolean).join(', ') });
        break;
      }
      case '+COPS': {
        const oper = f('<oper>');
        if (oper && d.kind !== 'command') m.set('oper', { label: 'Operator', value: oper.meaning === 'operator name' ? oper.value : `${oper.value} (${oper.meaning})` });
        break;
      }
      case '+CESQ': {
        const parts = ['<rsrp>', '<rsrq>'].map((n) => f(n)).filter(Boolean).map((x) => after(x!.meaning, ': '));
        if (parts.length) m.set('signal', { label: 'Signal', value: parts.join('; ') });
        break;
      }
      case '+CSQ': {
        const r = f('<rssi>');
        if (r && !m.has('signal')) m.set('signal', { label: 'Signal (+CSQ)', value: r.meaning });
        break;
      }
      case '+CEDRXP':
      case '+CEDRXRDP': {
        const nw = f('<NW-provided_eDRX_value>');
        const ptw = f('<Paging_time_window>');
        const act = f('<AcT-type>');
        if (act?.value === '0') m.set('edrx', { label: 'eDRX granted', value: 'not used' });
        else if (nw) m.set('edrx', { label: 'eDRX granted', value: [nw.meaning, ptw?.meaning].filter(Boolean).join(', ') });
        break;
      }
      case '+CSCON': {
        const mode = f('<mode>');
        if (mode) m.set('rrc', { label: 'RRC connection', value: mode.meaning });
        break;
      }
      case '+CGPADDR': {
        const addrs = d.fields.filter((x) => x.name.startsWith('<PDP_addr')).map((x) => x.value);
        if (d.kind !== 'command') m.set('ip', { label: 'IP address', value: addrs.length ? addrs.join(', ') : 'none', tone: addrs.length ? undefined : 'warn' });
        break;
      }
      case '+CFUN': {
        const fun = f('<fun>');
        if (fun && d.kind !== 'command') m.set('fun', { label: 'Functionality', value: fun.meaning, tone: d.tone });
        break;
      }
      case '+CPIN':
        if (d.fields[0]) m.set('sim', { label: 'SIM', value: d.fields[0].meaning, tone: d.tone });
        break;
      case '+CME ERROR':
        errors++;
        m.set('err', { label: 'Last error', value: `${d.fields[0].value}: ${d.fields[0].meaning}`, tone: 'bad' });
        break;
    }
    if (d.kind === 'final' && d.title === 'ERROR') {
      errors++;
      m.set('err', { label: 'Last error', value: 'ERROR (no detail: enable AT+CMEE=1)', tone: 'bad' });
    }
  }
  if (errors > 1) m.set('errors', { label: 'Errors in the log', value: String(errors), tone: 'bad' });
  const order = ['fun', 'sim', 'reg', 'reject', 'rat', 'oper', 'cell', 'signal', 'rrc', 'psm', 'edrx', 'ip', 'err', 'errors'];
  return order.filter((k) => m.has(k)).map((k) => m.get(k)!);
}
