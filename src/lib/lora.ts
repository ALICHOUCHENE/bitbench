// LoRa (SX127x) time-on-air, bit rates and duty-cycle budgets.
// Pure functions in SI units (hertz, seconds, bytes).
//
// Source: Semtech SX1276/77/78/79 datasheet Rev. 7 (May 2020), §4.1.1.7 "Time on air",
// and the LoRa Modem Designer's Guide AN1200.13. Scope: SF7–SF12 at 125/250/500 kHz,
// i.e. what LoRaWAN uses. SF6 (SX127x) and SF5/SF6 (SX126x) are not covered.

export const SF_MIN = 7;
export const SF_MAX = 12;
export const BANDWIDTHS_HZ = [125_000, 250_000, 500_000] as const;
/** SX1276 RegPreamble range (programmed symbols, before the fixed 4.25-symbol overhead). */
export const PREAMBLE_MIN = 6;
export const PREAMBLE_MAX = 65_535;
export const PAYLOAD_MAX = 255;
/** SX1276 §4.1.1.6: LowDataRateOptimize is mandated when the symbol duration exceeds 16 ms. */
export const LDRO_THRESHOLD_S = 0.016;

/**
 * LoRaWAN framing added around the application payload, minimum case (no FOpts):
 * MHDR 1 + FHDR 7 (DevAddr 4, FCtrl 1, FCnt 2) + FPort 1 + MIC 4 = 13 bytes.
 */
export const LORAWAN_OVERHEAD_BYTES = 13;

/** TTN community Fair Use Policy: 30 s of uplink airtime per device per 24 h. Not a regulation. */
export const TTN_FAIR_USE_SECONDS_PER_DAY = 30;

export type LdroMode = 'auto' | 'on' | 'off';

export interface LoraParams {
  /** Spreading factor 7–12. */
  sf: number;
  /** Bandwidth in Hz (125000, 250000 or 500000). */
  bw: number;
  /** Coding rate index: 1 = 4/5 … 4 = 4/8. */
  cr: number;
  /** PHY payload length in bytes (0–255). */
  payload: number;
  /** Programmed preamble length in symbols (default 8). */
  preamble: number;
  /** true = implicit header (IH = 1). */
  implicitHeader: boolean;
  /** true = payload CRC on. */
  crc: boolean;
  ldro: LdroMode;
}

export interface ToaResult {
  /** Symbol duration Tsym = 2^SF / BW, s. */
  symbolTime: number;
  /** Preamble symbols including the 4.25 fixed overhead. */
  preambleSymbols: number;
  /** Preamble duration, s. */
  preambleTime: number;
  /** Number of payload symbols (header block of 8 included). */
  payloadSymbols: number;
  /** Payload duration, s. */
  payloadTime: number;
  /** Total packet duration, s. */
  timeOnAir: number;
  /** Whether low data rate optimisation is in effect (after resolving Auto). */
  ldro: boolean;
}

/** Symbol duration Tsym = 2^SF / BW, in seconds. */
export function symbolTime(sf: number, bw: number): number {
  return 2 ** sf / bw;
}

/** Auto LDRO: on when the symbol duration exceeds 16 ms (SX1276 datasheet §4.1.1.6). */
export function ldroRequired(sf: number, bw: number): boolean {
  return symbolTime(sf, bw) > LDRO_THRESHOLD_S;
}

export function resolveLdro(mode: LdroMode, sf: number, bw: number): boolean {
  return mode === 'on' ? true : mode === 'off' ? false : ldroRequired(sf, bw);
}

/**
 * Number of payload symbols:
 * 8 + max(ceil((8·PL − 4·SF + 28 + 16·CRC − 20·IH) / (4·(SF − 2·DE))) · (CR + 4), 0)
 */
export function payloadSymbols(
  sf: number,
  cr: number,
  payload: number,
  crc: boolean,
  implicitHeader: boolean,
  ldro: boolean,
): number {
  const num = 8 * payload - 4 * sf + 28 + 16 * (crc ? 1 : 0) - 20 * (implicitHeader ? 1 : 0);
  const den = 4 * (sf - 2 * (ldro ? 1 : 0));
  return 8 + Math.max(Math.ceil(num / den) * (cr + 4), 0);
}

/** Full time-on-air breakdown for one LoRa packet. Call validateLora() first for user input. */
export function loraTimeOnAir(p: LoraParams): ToaResult {
  const tsym = symbolTime(p.sf, p.bw);
  const ldro = resolveLdro(p.ldro, p.sf, p.bw);
  const preambleSymbols = p.preamble + 4.25;
  const nPayload = payloadSymbols(p.sf, p.cr, p.payload, p.crc, p.implicitHeader, ldro);
  const preambleTime = preambleSymbols * tsym;
  const payloadTime = nPayload * tsym;
  return {
    symbolTime: tsym,
    preambleSymbols,
    preambleTime,
    payloadSymbols: nPayload,
    payloadTime,
    timeOnAir: preambleTime + payloadTime,
    ldro,
  };
}

export type LoraField = 'sf' | 'bw' | 'cr' | 'payload' | 'preamble';

/** Check parameters; returns a map of field → message (empty when valid). */
export function validateLora(p: LoraParams): Partial<Record<LoraField, string>> {
  const errors: Partial<Record<LoraField, string>> = {};
  if (!Number.isInteger(p.sf) || p.sf < SF_MIN || p.sf > SF_MAX)
    errors.sf = `Spreading factor must be between ${SF_MIN} and ${SF_MAX}.`;
  if (!(BANDWIDTHS_HZ as readonly number[]).includes(p.bw)) errors.bw = 'Bandwidth must be 125, 250 or 500 kHz.';
  if (!Number.isInteger(p.cr) || p.cr < 1 || p.cr > 4) errors.cr = 'Coding rate must be 4/5, 4/6, 4/7 or 4/8.';
  if (!Number.isInteger(p.payload) || p.payload < 0 || p.payload > PAYLOAD_MAX)
    errors.payload = `Payload must be a whole number of bytes from 0 to ${PAYLOAD_MAX}.`;
  if (!Number.isInteger(p.preamble) || p.preamble < PREAMBLE_MIN || p.preamble > PREAMBLE_MAX)
    errors.preamble = `Preamble must be a whole number of symbols from ${PREAMBLE_MIN} to ${PREAMBLE_MAX}.`;
  return errors;
}

/** Raw (equivalent) bit rate Rb = SF · (BW / 2^SF) · 4 / (4 + CR), bit/s. Ignores preamble, header and CRC. */
export function rawBitRate(sf: number, bw: number, cr: number): number {
  return sf * (bw / 2 ** sf) * (4 / (4 + cr));
}

/** Effective payload rate: payload bits delivered per second of airtime, 8·PL / ToA. */
export function effectivePayloadRate(payloadBytes: number, timeOnAir: number): number {
  return (8 * payloadBytes) / timeOnAir;
}

/** Minimum silent time after a packet so the duty cycle is respected: ToA · (1/dc − 1). dc is a ratio (0.01 = 1 %). */
export function dutyCycleOffTime(timeOnAir: number, dutyCycle: number): number {
  return timeOnAir * (1 / dutyCycle - 1);
}

/** Small tolerance so 3600·0.01/0.036 = 999.999… still counts as 1000 messages. */
const EPS = 1e-9;

/** Whole packets that fit in `periodSeconds` when the airtime budget is periodSeconds · dc. */
export function maxMessages(timeOnAir: number, dutyCycle: number, periodSeconds: number): number {
  return Math.floor((periodSeconds * dutyCycle) / timeOnAir + EPS);
}

/** Whole packets per day within an airtime budget (default: TTN's 30 s/day fair-use policy). */
export function fairUseMessagesPerDay(timeOnAir: number, budgetSeconds = TTN_FAIR_USE_SECONDS_PER_DAY): number {
  return Math.floor(budgetSeconds / timeOnAir + EPS);
}

export interface SfRow {
  sf: number;
  ldro: boolean;
  symbolTime: number;
  timeOnAir: number;
  payloadSymbols: number;
}

/** Same packet at every spreading factor SF7–SF12 (other parameters unchanged, LDRO mode re-resolved). */
export function sfSweep(p: LoraParams): SfRow[] {
  const rows: SfRow[] = [];
  for (let sf = SF_MIN; sf <= SF_MAX; sf++) {
    const r = loraTimeOnAir({ ...p, sf });
    rows.push({ sf, ldro: r.ldro, symbolTime: r.symbolTime, timeOnAir: r.timeOnAir, payloadSymbols: r.payloadSymbols });
  }
  return rows;
}
