import { describe, expect, it } from 'vitest';
import {
  fresnelRadius,
  fspl,
  hataWarnings,
  linkBudget,
  noiseFloor,
  pathLoss,
  radioHorizon,
  rangeForLoss,
  receivedPower,
  sensitivity,
  sfLinkSweep,
  validateLink,
  type LinkParams,
  type ModelId,
  type ModelParams,
} from '../src/lib/lora-link';

const link: LinkParams = {
  sf: 7,
  bw: 125_000,
  txPower: 14,
  txGain: 2,
  txLoss: 0,
  rxGain: 5,
  rxLoss: 1,
  noiseFigure: 6,
  fadeMargin: 10,
  extraLoss: 0,
};

const model: ModelParams = { model: 'hata-urban', freq: 868e6, hb: 30, hm: 1.5, n: 3 };

describe('noise floor and sensitivity', () => {
  it('noise floor is −174 + 10·log10(BW) + NF', () => {
    expect(noiseFloor(125_000, 6)).toBeCloseTo(-117.03, 2);
    expect(noiseFloor(500_000, 0)).toBeCloseTo(-117.01, 2);
  });

  it('matches the SX1276 datasheet within a dB at NF 6 dB', () => {
    // Datasheet §2.5: about −124 dBm at SF7/125 kHz and −137 dBm at SF12/125 kHz.
    expect(sensitivity(7, 125_000, 6)).toBeCloseTo(-124.53, 2);
    expect(sensitivity(12, 125_000, 6)).toBeCloseTo(-137.03, 2);
  });

  it('gains 2.5 dB per SF step and loses 3 dB per bandwidth doubling', () => {
    expect(sensitivity(8, 125_000, 6) - sensitivity(7, 125_000, 6)).toBeCloseTo(-2.5, 10);
    expect(sensitivity(7, 250_000, 6) - sensitivity(7, 125_000, 6)).toBeCloseTo(3.01, 2);
  });
});

describe('linkBudget', () => {
  it('adds up EIRP, gains, losses and margins', () => {
    const b = linkBudget(link);
    expect(b.eirp).toBe(16);
    expect(b.erp).toBeCloseTo(13.85, 10);
    expect(b.maxPathLoss).toBeCloseTo(16 + 5 - 1 + 124.53, 2);
    expect(b.allowedPathLoss).toBeCloseTo(b.maxPathLoss - 10, 10);
    expect(linkBudget({ ...link, extraLoss: 15 }).allowedPathLoss).toBeCloseTo(b.allowedPathLoss - 15, 10);
  });

  it('received power at the max path loss equals the sensitivity', () => {
    const b = linkBudget(link);
    expect(receivedPower(link, b.maxPathLoss)).toBeCloseTo(b.sensitivity, 10);
  });
});

describe('path-loss models', () => {
  it('free-space loss at 1 km, 868 MHz is 91.2 dB and grows 20 dB per decade', () => {
    expect(fspl(1000, 868e6)).toBeCloseTo(91.21, 2);
    expect(fspl(10_000, 868e6) - fspl(1000, 868e6)).toBeCloseTo(20, 10);
  });

  it('Okumura-Hata reproduces textbook values at 900 MHz, hb 30 m, hm 1.5 m, 1 km', () => {
    const m = { ...model, freq: 900e6 };
    expect(pathLoss({ ...m, model: 'hata-urban' }, 1000)).toBeCloseTo(126.40, 2);
    expect(pathLoss({ ...m, model: 'hata-large' }, 1000)).toBeCloseTo(126.42, 2);
    expect(pathLoss({ ...m, model: 'hata-suburban' }, 1000)).toBeCloseTo(116.46, 2);
    expect(pathLoss({ ...m, model: 'hata-rural' }, 1000)).toBeCloseTo(97.90, 2);
    // Slope 44.9 − 6.55·log10(30) = 35.22 dB/decade.
    expect(pathLoss({ ...m, model: 'hata-urban' }, 10_000)).toBeCloseTo(161.63, 2);
  });

  it('log-distance with n = 2 equals free space', () => {
    const m: ModelParams = { ...model, model: 'log-distance', n: 2 };
    expect(pathLoss(m, 3000)).toBeCloseTo(fspl(3000, 868e6), 10);
  });

  it('rangeForLoss inverts pathLoss for every model', () => {
    const ids: ModelId[] = ['fspl', 'hata-urban', 'hata-large', 'hata-suburban', 'hata-rural', 'log-distance'];
    for (const id of ids) {
      const m = { ...model, model: id };
      expect(rangeForLoss(m, pathLoss(m, 4321))).toBeCloseTo(4321, 6);
    }
  });
});

describe('Hata validity warnings', () => {
  it('flags inputs outside the fitted range only for Hata models', () => {
    expect(hataWarnings(model, 5000)).toEqual([]);
    expect(hataWarnings({ ...model, hb: 10 }, 500)).toEqual(['gateway height outside 30–200 m', 'distance outside 1–20 km']);
    expect(hataWarnings({ ...model, freq: 2.4e9 }, 5000)).toEqual(['frequency outside 150–1500 MHz']);
    expect(hataWarnings({ ...model, model: 'fspl', hb: 10 }, 500)).toEqual([]);
  });
});

describe('geometry', () => {
  it('radio horizon with k = 4/3', () => {
    expect(radioHorizon(30, 1.5)).toBeCloseTo(4120 * (Math.sqrt(30) + Math.sqrt(1.5)), 6);
    expect(radioHorizon(30, 1.5) / 1000).toBeCloseTo(27.6, 1);
  });

  it('first Fresnel zone radius at mid-path: 10 km at 868 MHz is about 29 m', () => {
    expect(fresnelRadius(10_000, 868e6)).toBeCloseTo(29.38, 1);
  });
});

describe('sfLinkSweep', () => {
  it('lists SF7–SF12 with growing path loss and range', () => {
    const rows = sfLinkSweep(link, model);
    expect(rows.map((r) => r.sf)).toEqual([7, 8, 9, 10, 11, 12]);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].maxPathLoss - rows[i - 1].maxPathLoss).toBeCloseTo(2.5, 10);
      expect(rows[i].range).toBeGreaterThan(rows[i - 1].range);
    }
  });
});

describe('validateLink', () => {
  it('accepts sane values and rejects bad ones', () => {
    expect(validateLink(link, model)).toEqual({});
    const e = validateLink({ ...link, txPower: 40, rxLoss: -1, noiseFigure: NaN }, { ...model, hb: 0, model: 'log-distance', n: 9 });
    expect(Object.keys(e).sort()).toEqual(['hb', 'n', 'noiseFigure', 'rxLoss', 'txPower']);
  });
});
