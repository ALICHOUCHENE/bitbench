// LoRa link budget: receiver sensitivity, maximum path loss and range from path-loss models.
// Pure functions. Powers and gains in dB / dBm, frequency in Hz, distances and heights in metres.
//
// Sources: Semtech SX1276/77/78/79 datasheet Rev. 7 (May 2020), §4.1.1.2 table 13 (demodulator
// SNR per spreading factor) and §2.5 (sensitivity); Semtech AN1200.22 "LoRa Modulation Basics";
// Hata, IEEE Trans. Veh. Technol. VT-29 (1980) and ITU-R P.529 for the Okumura-Hata model;
// ITU-R P.525 for free-space loss.

import { SF_MAX, SF_MIN } from './lora';

/** Thermal noise density at 290 K, dBm/Hz (10·log10(k·T·1 Hz / 1 mW)). */
export const THERMAL_NOISE_DBM_HZ = -174;

/** Minimum demodulator SNR per spreading factor, dB (SX1276 datasheet table 13). */
export const REQUIRED_SNR_DB: Record<number, number> = {
  7: -7.5,
  8: -10,
  9: -12.5,
  10: -15,
  11: -17.5,
  12: -20,
};

/** Difference between EIRP and ERP: gain of a half-wave dipole over an isotropic antenna, dB. */
export const DIPOLE_GAIN_DBI = 2.15;

/** Noise floor of a receiver: −174 + 10·log10(BW) + NF, dBm. */
export function noiseFloor(bwHz: number, noiseFigureDb: number): number {
  return THERMAL_NOISE_DBM_HZ + 10 * Math.log10(bwHz) + noiseFigureDb;
}

/** Receiver sensitivity: noise floor + required SNR for the spreading factor, dBm. */
export function sensitivity(sf: number, bwHz: number, noiseFigureDb: number): number {
  return noiseFloor(bwHz, noiseFigureDb) + REQUIRED_SNR_DB[sf];
}

export interface LinkParams {
  sf: number;
  /** Bandwidth, Hz. */
  bw: number;
  /** Transmitter conducted output power, dBm. */
  txPower: number;
  txGain: number;
  txLoss: number;
  rxGain: number;
  rxLoss: number;
  /** Receiver noise figure, dB. */
  noiseFigure: number;
  /** Fade (link) margin kept in reserve, dB. */
  fadeMargin: number;
  /** Extra fixed loss: building penetration, body, foliage, dB. */
  extraLoss: number;
}

export interface LinkBudget {
  eirp: number;
  erp: number;
  noiseFloor: number;
  requiredSnr: number;
  sensitivity: number;
  /** Path loss the link tolerates with zero margin, dB. */
  maxPathLoss: number;
  /** Path loss left for propagation after fade margin and extra losses, dB. Range is computed from this. */
  allowedPathLoss: number;
}

export function linkBudget(p: LinkParams): LinkBudget {
  const eirp = p.txPower + p.txGain - p.txLoss;
  const sens = sensitivity(p.sf, p.bw, p.noiseFigure);
  const maxPathLoss = eirp + p.rxGain - p.rxLoss - sens;
  return {
    eirp,
    erp: eirp - DIPOLE_GAIN_DBI,
    noiseFloor: noiseFloor(p.bw, p.noiseFigure),
    requiredSnr: REQUIRED_SNR_DB[p.sf],
    sensitivity: sens,
    maxPathLoss,
    allowedPathLoss: maxPathLoss - p.fadeMargin - p.extraLoss,
  };
}

/** Received power for a given propagation path loss, dBm. Extra loss is included, fade margin is not. */
export function receivedPower(p: LinkParams, pathLoss: number): number {
  return p.txPower + p.txGain - p.txLoss - pathLoss - p.extraLoss + p.rxGain - p.rxLoss;
}

// ── Path-loss models ──────────────────────────────────────────────────────────────

export type ModelId = 'fspl' | 'hata-urban' | 'hata-large' | 'hata-suburban' | 'hata-rural' | 'log-distance';

export interface ModelParams {
  model: ModelId;
  /** Carrier frequency, Hz. */
  freq: number;
  /** Gateway (base station) antenna height above ground, m. Used by Hata and the radio horizon. */
  hb: number;
  /** End-device antenna height above ground, m. Used by Hata and the radio horizon. */
  hm: number;
  /** Path-loss exponent. Log-distance only. */
  n: number;
}

export const MODELS: { id: ModelId; label: string }[] = [
  { id: 'hata-urban', label: 'Hata, urban (medium city)' },
  { id: 'hata-large', label: 'Hata, urban (large city)' },
  { id: 'hata-suburban', label: 'Hata, suburban' },
  { id: 'hata-rural', label: 'Hata, open / rural' },
  { id: 'fspl', label: 'Free space (line of sight)' },
  { id: 'log-distance', label: 'Log-distance (exponent n)' },
];

/** Okumura-Hata validity range (Hata 1980). */
export const HATA_LIMITS = { fMinHz: 150e6, fMaxHz: 1500e6, hbMin: 30, hbMax: 200, hmMin: 1, hmMax: 10, dMin: 1_000, dMax: 20_000 };

/** Free-space path loss: 20·log10(d_km) + 20·log10(f_MHz) + 32.44, dB. */
export function fspl(distanceM: number, freqHz: number): number {
  return 20 * Math.log10(distanceM / 1000) + 20 * Math.log10(freqHz / 1e6) + 32.44;
}

/**
 * Okumura-Hata as two coefficients: L = A + B·log10(d_km). Splitting it this way makes the
 * inverse (distance for a given loss) exact.
 */
function hataCoefficients(m: ModelParams): { a: number; b: number } {
  const lf = Math.log10(m.freq / 1e6);
  const lhb = Math.log10(m.hb);
  // Mobile antenna correction a(hm).
  const ahm =
    m.model === 'hata-large'
      ? m.freq >= 300e6
        ? 3.2 * Math.log10(11.75 * m.hm) ** 2 - 4.97
        : 8.29 * Math.log10(1.54 * m.hm) ** 2 - 1.1
      : (1.1 * lf - 0.7) * m.hm - (1.56 * lf - 0.8);
  let a = 69.55 + 26.16 * lf - 13.82 * lhb - ahm;
  if (m.model === 'hata-suburban') a -= 2 * Math.log10(m.freq / 1e6 / 28) ** 2 + 5.4;
  else if (m.model === 'hata-rural') a -= 4.78 * lf ** 2 - 18.33 * lf + 40.94;
  return { a, b: 44.9 - 6.55 * lhb };
}

/** Log-distance reference: free-space loss at d0 = 1 m. */
function logDistanceRef(freqHz: number): number {
  return fspl(1, freqHz);
}

/** Propagation path loss at a distance for the chosen model, dB. */
export function pathLoss(m: ModelParams, distanceM: number): number {
  switch (m.model) {
    case 'fspl':
      return fspl(distanceM, m.freq);
    case 'log-distance':
      return logDistanceRef(m.freq) + 10 * m.n * Math.log10(distanceM);
    default: {
      const { a, b } = hataCoefficients(m);
      return a + b * Math.log10(distanceM / 1000);
    }
  }
}

/** Distance at which the model reaches a given path loss, m (inverse of pathLoss). */
export function rangeForLoss(m: ModelParams, loss: number): number {
  switch (m.model) {
    case 'fspl':
      return 1000 * 10 ** ((loss - 32.44 - 20 * Math.log10(m.freq / 1e6)) / 20);
    case 'log-distance':
      return 10 ** ((loss - logDistanceRef(m.freq)) / (10 * m.n));
    default: {
      const { a, b } = hataCoefficients(m);
      return 1000 * 10 ** ((loss - a) / b);
    }
  }
}

export function isHata(model: ModelId): boolean {
  return model.startsWith('hata-');
}

/** Okumura-Hata inputs outside the model's fitted range (empty when valid or not a Hata model). */
export function hataWarnings(m: ModelParams, distanceM: number): string[] {
  if (!isHata(m.model)) return [];
  const L = HATA_LIMITS;
  const out: string[] = [];
  if (m.freq < L.fMinHz || m.freq > L.fMaxHz) out.push('frequency outside 150–1500 MHz');
  if (m.hb < L.hbMin || m.hb > L.hbMax) out.push('gateway height outside 30–200 m');
  if (m.hm < L.hmMin || m.hm > L.hmMax) out.push('device height outside 1–10 m');
  if (distanceM < L.dMin || distanceM > L.dMax) out.push('distance outside 1–20 km');
  return out;
}

// ── Geometry ──────────────────────────────────────────────────────────────────────

/** Radio horizon over smooth earth with k = 4/3: 4.12·(√h1 + √h2) km, heights in m. Returns m. */
export function radioHorizon(h1: number, h2: number): number {
  return 4120 * (Math.sqrt(h1) + Math.sqrt(h2));
}

/** Radius of the first Fresnel zone at the midpoint of a path: ½·√(λ·d), m. */
export function fresnelRadius(distanceM: number, freqHz: number): number {
  const lambda = 299_792_458 / freqHz;
  return 0.5 * Math.sqrt(lambda * distanceM);
}

// ── Sweep and validation ──────────────────────────────────────────────────────────

export interface SfLinkRow {
  sf: number;
  requiredSnr: number;
  sensitivity: number;
  maxPathLoss: number;
  range: number;
}

/** Same link at every spreading factor SF7–SF12. */
export function sfLinkSweep(p: LinkParams, m: ModelParams): SfLinkRow[] {
  const rows: SfLinkRow[] = [];
  for (let sf = SF_MIN; sf <= SF_MAX; sf++) {
    const b = linkBudget({ ...p, sf });
    rows.push({ sf, requiredSnr: b.requiredSnr, sensitivity: b.sensitivity, maxPathLoss: b.maxPathLoss, range: rangeForLoss(m, b.allowedPathLoss) });
  }
  return rows;
}

export type LinkField = 'txPower' | 'txGain' | 'txLoss' | 'rxGain' | 'rxLoss' | 'noiseFigure' | 'fadeMargin' | 'extraLoss' | 'freq' | 'hb' | 'hm' | 'n';

/** Check parameters; returns a map of field → message (empty when valid). Hata ranges are warnings, not errors. */
export function validateLink(p: LinkParams, m: ModelParams): Partial<Record<LinkField, string>> {
  const e: Partial<Record<LinkField, string>> = {};
  const finite = (k: LinkField, v: number, label: string) => {
    if (!Number.isFinite(v)) e[k] = `${label} must be a number.`;
  };
  finite('txPower', p.txPower, 'TX power');
  if (!e.txPower && (p.txPower < -30 || p.txPower > 36)) e.txPower = 'TX power must be between −30 and +36 dBm.';
  finite('txGain', p.txGain, 'Antenna gain');
  finite('rxGain', p.rxGain, 'Antenna gain');
  for (const [k, v] of [['txLoss', p.txLoss], ['rxLoss', p.rxLoss], ['fadeMargin', p.fadeMargin], ['extraLoss', p.extraLoss]] as const) {
    if (!Number.isFinite(v) || v < 0) e[k] = 'Must be 0 dB or more.';
  }
  if (!Number.isFinite(p.noiseFigure) || p.noiseFigure < 0 || p.noiseFigure > 30) e.noiseFigure = 'Noise figure must be between 0 and 30 dB.';
  if (!Number.isFinite(m.freq) || m.freq < 30e6 || m.freq > 6e9) e.freq = 'Frequency must be between 30 MHz and 6 GHz.';
  // Heights feed the radio horizon for every model, not just Hata.
  if (!Number.isFinite(m.hb) || m.hb <= 0) e.hb = 'Height must be above 0 m.';
  if (!Number.isFinite(m.hm) || m.hm <= 0) e.hm = 'Height must be above 0 m.';
  if (m.model === 'log-distance' && (!Number.isFinite(m.n) || m.n < 1.5 || m.n > 6)) e.n = 'Exponent must be between 1.5 and 6.';
  return e;
}
