import { describe, expect, it } from 'vitest';
import { loraTimeOnAir } from '../src/lib/lora';
import {
  DWELL_LIMIT_S,
  REGIONS,
  dwellLimit,
  findDataRate,
  getRegion,
  hasDwellParam,
  payloadLimit,
  type LoraDataRate,
} from '../src/lib/lorawan-regions';

// Expected rows transcribed from LoRaWAN RP002-1.0.4:
// [DR, SF, BW kHz, M (no repeater), N (no repeater), M (repeater), N (repeater), dwell M, dwell N, downlinkOnly]
// dwell M/N: undefined = no separate table, null = N/A.
type Row = [number, number, number, number, number, number, number, (number | null)?, (number | null)?, boolean?];

const EXPECTED: Record<string, Row[]> = {
  // Table 8 / Table 12 / not-repeater table (§2.4.6)
  eu868: [
    [0, 12, 125, 59, 51, 59, 51],
    [1, 11, 125, 59, 51, 59, 51],
    [2, 10, 125, 59, 51, 59, 51],
    [3, 9, 125, 123, 115, 123, 115],
    [4, 8, 125, 250, 242, 230, 222],
    [5, 7, 125, 250, 242, 230, 222],
    [6, 7, 250, 250, 242, 230, 222],
  ],
  // Table 15 / Tables 19, 20
  us915: [
    [0, 10, 125, 19, 11, 19, 11],
    [1, 9, 125, 61, 53, 61, 53],
    [2, 8, 125, 133, 125, 133, 125],
    [3, 7, 125, 250, 242, 230, 222],
    [4, 8, 500, 250, 242, 230, 222],
    [8, 12, 500, 61, 53, 61, 53, undefined, undefined, true],
    [9, 11, 500, 137, 129, 137, 129, undefined, undefined, true],
    [10, 10, 500, 250, 242, 230, 222, undefined, undefined, true],
    [11, 9, 500, 250, 242, 230, 222, undefined, undefined, true],
    [12, 8, 500, 250, 242, 230, 222, undefined, undefined, true],
    [13, 7, 500, 250, 242, 230, 222, undefined, undefined, true],
  ],
  // Table 31 / Tables 35, 36 (dwell columns from the not-repeater table)
  au915: [
    [0, 12, 125, 59, 51, 59, 51, null, null],
    [1, 11, 125, 59, 51, 59, 51, null, null],
    [2, 10, 125, 59, 51, 59, 51, 19, 11],
    [3, 9, 125, 123, 115, 123, 115, 61, 53],
    [4, 8, 125, 250, 242, 230, 222, 133, 125],
    [5, 7, 125, 250, 242, 230, 222, 250, 242],
    [6, 8, 500, 250, 242, 230, 222, 250, 242],
    [8, 12, 500, 61, 53, 61, 53, 61, 53, true],
    [9, 11, 500, 137, 129, 137, 129, 137, 129, true],
    [10, 10, 500, 250, 242, 230, 222, 250, 242, true],
    [11, 9, 500, 250, 242, 230, 222, 250, 242, true],
    [12, 8, 500, 250, 242, 230, 222, 250, 242, true],
    [13, 7, 500, 250, 242, 230, 222, 250, 242, true],
  ],
  // Table 57 / Tables 61, 62
  as923: [
    [0, 12, 125, 59, 51, 59, 51, null, null],
    [1, 11, 125, 59, 51, 59, 51, null, null],
    [2, 10, 125, 123, 115, 123, 115, 19, 11],
    [3, 9, 125, 123, 115, 123, 115, 61, 53],
    [4, 8, 125, 250, 242, 230, 222, 133, 125],
    [5, 7, 125, 250, 242, 230, 222, 250, 242],
    [6, 7, 250, 250, 242, 230, 222, 250, 242],
  ],
  // Table 69 / Tables 73, 74
  kr920: [
    [0, 12, 125, 59, 51, 59, 51],
    [1, 11, 125, 59, 51, 59, 51],
    [2, 10, 125, 59, 51, 59, 51],
    [3, 9, 125, 123, 115, 123, 115],
    [4, 8, 125, 250, 242, 230, 222],
    [5, 7, 125, 250, 242, 230, 222],
  ],
  // Table 79 / Tables 83, 84
  in865: [
    [0, 12, 125, 59, 51, 59, 51],
    [1, 11, 125, 59, 51, 59, 51],
    [2, 10, 125, 59, 51, 59, 51],
    [3, 9, 125, 123, 115, 123, 115],
    [4, 8, 125, 250, 242, 230, 222],
    [5, 7, 125, 250, 242, 230, 222],
  ],
};

describe('REGIONS', () => {
  it('covers exactly the expected regions', () => {
    expect(REGIONS.map((r) => r.id).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const [id, rows] of Object.entries(EXPECTED)) {
    describe(id, () => {
      const region = getRegion(id)!;
      it('has the expected number of LoRa data rates', () => {
        expect(region.dataRates).toHaveLength(rows.length);
      });
      for (const [dr, sf, bwk, m, n, mr, nr, dm, dn, down] of rows) {
        it(`DR${dr} = SF${sf}/${bwk} kHz, M ${m}, N ${n}`, () => {
          const rate = region.dataRates.find((d) => d.dr === dr)!;
          expect(rate).toBeDefined();
          expect(rate.sf).toBe(sf);
          expect(rate.bw).toBe(bwk * 1000);
          expect(rate.payload).toEqual({ m, n, mRepeater: mr, nRepeater: nr });
          expect(Boolean(rate.downlinkOnly)).toBe(Boolean(down));
          if (dm === undefined) expect(rate.payloadDwell).toBeUndefined();
          else if (dm === null) expect(rate.payloadDwell).toBeNull();
          else {
            expect(rate.payloadDwell!.m).toBe(dm);
            expect(rate.payloadDwell!.n).toBe(dn);
          }
        });
      }
    });
  }

  it('N = M − 8 everywhere (FHDR 7 + FPort 1)', () => {
    for (const r of REGIONS)
      for (const d of r.dataRates) {
        expect(d.payload.n).toBe(d.payload.m - 8);
        expect(d.payload.nRepeater).toBe(d.payload.mRepeater - 8);
        if (d.payloadDwell) expect(d.payloadDwell.n).toBe(d.payloadDwell.m - 8);
      }
  });
});

describe('dwell time', () => {
  const us = getRegion('us915')!;
  const as = getRegion('as923')!;
  const eu = getRegion('eu868')!;

  it('US915 limits 125 kHz uplinks to 400 ms, not 500 kHz', () => {
    expect(dwellLimit(us, 125_000, false)).toBe(0.4);
    expect(dwellLimit(us, 500_000, false)).toBeNull();
  });

  it('AS923/AU915 follow UplinkDwellTime', () => {
    expect(hasDwellParam(as)).toBe(true);
    expect(dwellLimit(as, 125_000, false)).toBeNull();
    expect(dwellLimit(as, 125_000, true)).toBe(0.4);
    expect(dwellLimit(getRegion('au915')!, 500_000, true)).toBe(0.4);
  });

  it('EU868 has none', () => {
    expect(hasDwellParam(eu)).toBe(false);
    expect(dwellLimit(eu, 125_000, true)).toBeNull();
  });

  it('payloadLimit picks the dwell table only where it exists', () => {
    const asDr0 = as.dataRates[0];
    expect(payloadLimit(asDr0, false)!.n).toBe(51);
    expect(payloadLimit(asDr0, true)).toBeNull();
    expect(payloadLimit(eu.dataRates[0], true)!.n).toBe(51);
  });

  // Consistency check: every max PHY payload (M + MHDR 1 + MIC 4) under a 400 ms dwell limit
  // must fit in 400 ms at CR 4/5, 8-symbol preamble, explicit header, CRC on (LoRaWAN uplink).
  const limited: [string, number, LoraDataRate, number][] = [];
  for (const r of REGIONS)
    for (const d of r.dataRates) {
      if (d.downlinkOnly) continue;
      const dwell = hasDwellParam(r) ? payloadLimit(d, true) : r.dwell === 'none' ? null : d.payload;
      if (dwell && dwellLimit(r, d.bw, true) !== null) limited.push([r.id, d.dr, d, dwell.m]);
    }

  it.each(limited)('%s DR%i: max PHY payload fits the 400 ms dwell limit', (_id, _dr, d, m) => {
    const toa = loraTimeOnAir({
      sf: d.sf,
      bw: d.bw,
      cr: 1,
      payload: m + 5,
      preamble: 8,
      implicitHeader: false,
      crc: true,
      ldro: 'auto',
    }).timeOnAir;
    expect(toa).toBeLessThanOrEqual(DWELL_LIMIT_S);
  });

  it('US915 DR2 (SF8, 138 B PHY) is just under 400 ms', () => {
    const toa = loraTimeOnAir({ sf: 8, bw: 125_000, cr: 1, payload: 138, preamble: 8, implicitHeader: false, crc: true, ldro: 'auto' }).timeOnAir;
    expect(toa).toBeCloseTo(0.399872, 9);
  });
});

describe('findDataRate', () => {
  it('maps SF/BW to the uplink DR', () => {
    expect(findDataRate(getRegion('eu868')!, 12, 125_000)!.dr).toBe(0);
    expect(findDataRate(getRegion('eu868')!, 7, 250_000)!.dr).toBe(6);
    expect(findDataRate(getRegion('us915')!, 8, 500_000)!.dr).toBe(4); // not DR12
    expect(findDataRate(getRegion('us915')!, 12, 500_000)!.dr).toBe(8); // downlink-only DR
    expect(findDataRate(getRegion('us915')!, 12, 125_000)).toBeUndefined();
  });
});
