// LoRaWAN regional data rates and maximum payload sizes.
//
// Source: LoRa Alliance, "RP002-1.0.4 LoRaWAN Regional Parameters" (2022), tables cited per region.
// Values were cross-checked against RP002-1.0.3 for AS923 (identical). Only LoRa (CSS) data
// rates are listed; FSK and LR-FHSS data rates are omitted because the SX127x LoRa
// time-on-air formula does not apply to them.
//
// M = maximum MACPayload size (FHDR + FPort + FRMPayload), bytes.
// N = maximum application payload (FRMPayload) without FOpts, bytes. N = M − 8.
// "repeater" values are the repeater-compatible tables; the defaults are the
// "not repeater compatible" tables, which apply when the device will never operate behind a repeater.

export interface PayloadLimit {
  /** Max MACPayload, not repeater compatible. */
  m: number;
  /** Max application payload, not repeater compatible. */
  n: number;
  /** Max MACPayload, repeater compatible. */
  mRepeater: number;
  /** Max application payload, repeater compatible. */
  nRepeater: number;
}

export interface LoraDataRate {
  dr: number;
  sf: number;
  /** Bandwidth in Hz. */
  bw: number;
  /** Defined for downlink only (US915/AU915 DR8–DR13). */
  downlinkOnly?: boolean;
  /** Limits with no dwell-time restriction (UplinkDwellTime = 0, or a region without dwell time). */
  payload: PayloadLimit;
  /**
   * Limits with UplinkDwellTime = 1 (400 ms), for regions that define them (AS923, AU915).
   * null = data rate not allowed (N/A in the spec). undefined = region has no separate table.
   */
  payloadDwell?: PayloadLimit | null;
}

export type DwellRule =
  /** No dwell-time limitation in the PHY layer. */
  | 'none'
  /** FCC: 400 ms on uplinks whose bandwidth is below 500 kHz (US915). */
  | 'fcc-400ms-below-500khz'
  /** 400 ms on uplinks when the network sets UplinkDwellTime = 1 (AS923, AU915). */
  | 'uplink-dwell-time-param';

export interface Region {
  id: string;
  name: string;
  dwell: DwellRule;
  /** Spec tables used, for the page's citation. */
  source: string;
  note: string;
  dataRates: LoraDataRate[];
}

export const DWELL_LIMIT_S = 0.4;

const kHz = 1000;

/** Same limit with and without repeater compatibility. */
function same(m: number): PayloadLimit {
  return { m, n: m - 8, mRepeater: m, nRepeater: m - 8 };
}
/** 250/242 without repeater, 230/222 repeater compatible. */
const BIG: PayloadLimit = { m: 250, n: 242, mRepeater: 230, nRepeater: 222 };

export const REGIONS: Region[] = [
  {
    id: 'eu868',
    name: 'EU863-870 (EU868)',
    dwell: 'none',
    source: 'RP002-1.0.4 §2.4: Table 8 (data rates), Table 12 and the not-repeater-compatible table (payload)',
    note: 'No dwell-time limit, but ETSI EN 300 220 duty cycles apply per sub-band (1 % on the default 868.1/868.3/868.5 MHz channels, 0.1 % or 10 % elsewhere). DR7 (FSK) and DR8–11 (LR-FHSS) are not listed.',
    dataRates: [
      { dr: 0, sf: 12, bw: 125 * kHz, payload: same(59) },
      { dr: 1, sf: 11, bw: 125 * kHz, payload: same(59) },
      { dr: 2, sf: 10, bw: 125 * kHz, payload: same(59) },
      { dr: 3, sf: 9, bw: 125 * kHz, payload: same(123) },
      { dr: 4, sf: 8, bw: 125 * kHz, payload: BIG },
      { dr: 5, sf: 7, bw: 125 * kHz, payload: BIG },
      { dr: 6, sf: 7, bw: 250 * kHz, payload: BIG },
    ],
  },
  {
    id: 'us915',
    name: 'US902-928 (US915)',
    dwell: 'fcc-400ms-below-500khz',
    source: 'RP002-1.0.4 §2.5: Table 15 (data rates), Tables 19 and 20 (payload)',
    note: 'FCC rules limit uplink dwell time to 400 ms on 125 kHz channels, which is why DR0 (SF10) is the slowest uplink and SF11/SF12 are only used at 500 kHz for downlinks. DR5–6 (LR-FHSS) are not listed.',
    dataRates: [
      { dr: 0, sf: 10, bw: 125 * kHz, payload: same(19) },
      { dr: 1, sf: 9, bw: 125 * kHz, payload: same(61) },
      { dr: 2, sf: 8, bw: 125 * kHz, payload: same(133) },
      { dr: 3, sf: 7, bw: 125 * kHz, payload: BIG },
      { dr: 4, sf: 8, bw: 500 * kHz, payload: BIG },
      { dr: 8, sf: 12, bw: 500 * kHz, downlinkOnly: true, payload: same(61) },
      { dr: 9, sf: 11, bw: 500 * kHz, downlinkOnly: true, payload: same(137) },
      { dr: 10, sf: 10, bw: 500 * kHz, downlinkOnly: true, payload: BIG },
      { dr: 11, sf: 9, bw: 500 * kHz, downlinkOnly: true, payload: BIG },
      { dr: 12, sf: 8, bw: 500 * kHz, downlinkOnly: true, payload: BIG },
      { dr: 13, sf: 7, bw: 500 * kHz, downlinkOnly: true, payload: BIG },
    ],
  },
  {
    id: 'au915',
    name: 'AU915-928 (AU915)',
    dwell: 'uplink-dwell-time-param',
    source: 'RP002-1.0.4 §2.8: Table 31 (data rates), Tables 35 and 36 (payload)',
    note: 'Devices assume UplinkDwellTime = 1 (400 ms) at boot until the network sends TxParamSetupReq. DR7 (LR-FHSS) is not listed.',
    dataRates: [
      { dr: 0, sf: 12, bw: 125 * kHz, payload: same(59), payloadDwell: null },
      { dr: 1, sf: 11, bw: 125 * kHz, payload: same(59), payloadDwell: null },
      { dr: 2, sf: 10, bw: 125 * kHz, payload: same(59), payloadDwell: same(19) },
      { dr: 3, sf: 9, bw: 125 * kHz, payload: same(123), payloadDwell: same(61) },
      { dr: 4, sf: 8, bw: 125 * kHz, payload: BIG, payloadDwell: same(133) },
      { dr: 5, sf: 7, bw: 125 * kHz, payload: BIG, payloadDwell: BIG },
      { dr: 6, sf: 8, bw: 500 * kHz, payload: BIG, payloadDwell: BIG },
      { dr: 8, sf: 12, bw: 500 * kHz, downlinkOnly: true, payload: same(61), payloadDwell: same(61) },
      { dr: 9, sf: 11, bw: 500 * kHz, downlinkOnly: true, payload: same(137), payloadDwell: same(137) },
      { dr: 10, sf: 10, bw: 500 * kHz, downlinkOnly: true, payload: BIG, payloadDwell: BIG },
      { dr: 11, sf: 9, bw: 500 * kHz, downlinkOnly: true, payload: BIG, payloadDwell: BIG },
      { dr: 12, sf: 8, bw: 500 * kHz, downlinkOnly: true, payload: BIG, payloadDwell: BIG },
      { dr: 13, sf: 7, bw: 500 * kHz, downlinkOnly: true, payload: BIG, payloadDwell: BIG },
    ],
  },
  {
    id: 'as923',
    name: 'AS923 (AS923-1 to -4)',
    dwell: 'uplink-dwell-time-param',
    source: 'RP002-1.0.4 §2.10: Table 57 (data rates), Tables 61 and 62 (payload)',
    note: 'Uplink dwell time is country-specific (for example 400 ms in Japan); the network signals it with TxParamSetupReq. DR7 (FSK) is not listed.',
    dataRates: [
      { dr: 0, sf: 12, bw: 125 * kHz, payload: same(59), payloadDwell: null },
      { dr: 1, sf: 11, bw: 125 * kHz, payload: same(59), payloadDwell: null },
      { dr: 2, sf: 10, bw: 125 * kHz, payload: same(123), payloadDwell: same(19) },
      { dr: 3, sf: 9, bw: 125 * kHz, payload: same(123), payloadDwell: same(61) },
      { dr: 4, sf: 8, bw: 125 * kHz, payload: BIG, payloadDwell: same(133) },
      { dr: 5, sf: 7, bw: 125 * kHz, payload: BIG, payloadDwell: BIG },
      { dr: 6, sf: 7, bw: 250 * kHz, payload: BIG, payloadDwell: BIG },
    ],
  },
  {
    id: 'kr920',
    name: 'KR920-923 (KR920)',
    dwell: 'none',
    source: 'RP002-1.0.4 §2.11: Table 69 (data rates), Tables 73 and 74 (payload)',
    note: 'No 400 ms dwell limit; the payload table is derived from the Korean rule of less than 4 s per transmission with listen-before-talk.',
    dataRates: [
      { dr: 0, sf: 12, bw: 125 * kHz, payload: same(59) },
      { dr: 1, sf: 11, bw: 125 * kHz, payload: same(59) },
      { dr: 2, sf: 10, bw: 125 * kHz, payload: same(59) },
      { dr: 3, sf: 9, bw: 125 * kHz, payload: same(123) },
      { dr: 4, sf: 8, bw: 125 * kHz, payload: BIG },
      { dr: 5, sf: 7, bw: 125 * kHz, payload: BIG },
    ],
  },
  {
    id: 'in865',
    name: 'IN865-867 (IN865)',
    dwell: 'none',
    source: 'RP002-1.0.4 §2.12: Table 79 (data rates), Tables 83 and 84 (payload)',
    note: 'No dwell-time or duty-cycle limitation in the PHY layer. DR6 is RFU and DR7 (FSK) is not listed.',
    dataRates: [
      { dr: 0, sf: 12, bw: 125 * kHz, payload: same(59) },
      { dr: 1, sf: 11, bw: 125 * kHz, payload: same(59) },
      { dr: 2, sf: 10, bw: 125 * kHz, payload: same(59) },
      { dr: 3, sf: 9, bw: 125 * kHz, payload: same(123) },
      { dr: 4, sf: 8, bw: 125 * kHz, payload: BIG },
      { dr: 5, sf: 7, bw: 125 * kHz, payload: BIG },
    ],
  },
];

export function getRegion(id: string): Region | undefined {
  return REGIONS.find((r) => r.id === id);
}

/** Whether a region has a separate payload table for UplinkDwellTime = 1. */
export function hasDwellParam(region: Region): boolean {
  return region.dwell === 'uplink-dwell-time-param';
}

/**
 * Payload limit for a data rate. Returns null when the DR is not allowed
 * (AS923/AU915 DR0–1 with UplinkDwellTime = 1).
 */
export function payloadLimit(rate: LoraDataRate, uplinkDwellTime: boolean): PayloadLimit | null {
  if (uplinkDwellTime && rate.payloadDwell !== undefined) return rate.payloadDwell;
  return rate.payload;
}

/** Uplink dwell-time limit (seconds) that applies to a transmission, or null when there is none. */
export function dwellLimit(region: Region, bw: number, uplinkDwellTime: boolean): number | null {
  if (region.dwell === 'fcc-400ms-below-500khz') return bw < 500 * kHz ? DWELL_LIMIT_S : null;
  if (region.dwell === 'uplink-dwell-time-param') return uplinkDwellTime ? DWELL_LIMIT_S : null;
  return null;
}

/** Uplink data rates of a region matching an SF/BW pair (first match; US915 DR4 = DR12 is uplink DR4). */
export function findDataRate(region: Region, sf: number, bw: number): LoraDataRate | undefined {
  return (
    region.dataRates.find((d) => d.sf === sf && d.bw === bw && !d.downlinkOnly) ??
    region.dataRates.find((d) => d.sf === sf && d.bw === bw)
  );
}
