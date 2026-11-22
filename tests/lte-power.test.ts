import { describe, expect, it } from 'vitest';
import {
  batteryStates,
  compareModes,
  computeBudget,
  idleAverage,
  overheadBytes,
  PAGING_CYCLES,
  posPerPtw,
  tauCount,
  type PowerInputs,
} from '../src/lib/lte-power';
import { parseStates } from '../src/lib/battery';

const base: PowerInputs = {
  mode: 'psm',
  interval: 3600,
  payload: 50,
  overhead: 28,
  ulRate: 78,
  repetitions: 1,
  t3412: 86400,
  t3324: 10,
  drxCycle: 1.28,
  edrxCycle: 20.48,
  ptw: 2.56,
  inactivity: 10,
  rai: false,
  psmCurrent: 0.003,
  idleFloor: 0.02,
  poCurrent: 10.02,
  poTime: 0.0128,
  setupCurrent: 50,
  setupTime: 1,
  txCurrent: 200,
  tailCurrent: 5,
};

const phase = (b: ReturnType<typeof computeBudget>, id: string) => b.phases.find((p) => p.id === id);

describe('constants', () => {
  it('paging cycles follow TS 36.331 defaultPagingCycle', () => {
    expect(PAGING_CYCLES.wb).toEqual([0.32, 0.64, 1.28, 2.56]);
    expect(PAGING_CYCLES.nb).toEqual([1.28, 2.56, 5.12, 10.24]);
  });
  it('overheads', () => {
    expect(overheadBytes('udp4')).toBe(28);
    expect(overheadBytes('udp6')).toBe(48);
    expect(overheadBytes('tcp4')).toBe(40);
    expect(overheadBytes('none')).toBe(0);
    expect(overheadBytes('x')).toBeNull();
  });
});

describe('idle averaging', () => {
  it('paging DRX: floor + extra charge per cycle', () => {
    // 10 mA extra × 12.8 ms / 1.28 s = 0.1 mA
    expect(idleAverage(base, false)).toBeCloseTo(0.12, 12);
  });
  it('eDRX: POs in the PTW spread over the eDRX cycle', () => {
    expect(posPerPtw(2.56, 1.28)).toBe(2);
    expect(posPerPtw(3.84, 1.28)).toBe(3); // 1.28 × 3 is not exact in floating point
    expect(posPerPtw(1.28, 2.56)).toBe(1);
    // 2 × 0.128 mA·s / 20.48 s = 0.0125 mA
    expect(idleAverage(base, true)).toBeCloseTo(0.0325, 12);
  });
  it('PO current below the floor adds nothing', () => {
    expect(idleAverage({ ...base, poCurrent: 0 }, false)).toBe(0.02);
  });
});

describe('tauCount', () => {
  it('no TAU when reporting more often than T3412', () => {
    expect(tauCount(3600, 20, 86400)).toBe(0);
  });
  it('counts TAUs strictly before the next report', () => {
    expect(tauCount(86400, 0, 3600)).toBe(23);
    expect(tauCount(86400, 20, 3600)).toBe(23);
    expect(tauCount(7200, 0, 3600)).toBe(1);
    expect(tauCount(3601, 0, 3600)).toBe(1);
  });
  it('deactivated T3412', () => {
    expect(tauCount(86400, 0, 0)).toBe(0);
  });
});

describe('computeBudget — PSM', () => {
  const b = computeBudget(base);
  it('TX time from payload, overhead and rate', () => {
    expect(b.bits).toBe(624);
    expect(b.txTime).toBeCloseTo(0.008, 12);
    expect(b.connected).toBeCloseTo(11.008, 12);
  });
  it('phase times add up to the interval', () => {
    const total = b.phases.reduce((s, p) => s + p.time, 0);
    expect(total).toBeCloseTo(3600, 9);
    expect(phase(b, 'psm')!.time).toBeCloseTo(3600 - 11.008 - 10, 9);
    expect(phase(b, 'idle')!.time).toBe(10);
    expect(phase(b, 'tau')).toBeUndefined();
  });
  it('average current is charge / interval', () => {
    const q = 0.003 * (3600 - 21.008) + 0.12 * 10 + 50 * 1 + 200 * 0.008 + 5 * 10;
    expect(b.chargePerInterval).toBeCloseTo(q, 9);
    expect(b.avgCurrent).toBeCloseTo(q / 3600, 12);
    expect(b.phases.reduce((s, p) => s + p.share, 0)).toBeCloseTo(1, 12);
  });
  it('reachability is the report interval', () => {
    expect(b.reachability).toBe(3600);
    expect(b.warnings).toEqual([]);
  });
  it('RAI removes the inactivity tail', () => {
    const r = computeBudget({ ...base, rai: true });
    expect(phase(r, 'tail')).toBeUndefined();
    expect(r.connected).toBeCloseTo(1.008, 12);
    expect(r.avgCurrent).toBeLessThan(b.avgCurrent);
  });
  it('repetitions multiply the TX time', () => {
    expect(computeBudget({ ...base, repetitions: 32 }).txTime).toBeCloseTo(0.256, 12);
  });
});

describe('computeBudget — periodic TAU', () => {
  it('adds a setup and an Active Time per TAU', () => {
    const b = computeBudget({ ...base, interval: 86400, t3412: 3600, rai: true });
    expect(b.taus).toBe(23);
    expect(phase(b, 'tau')!.time).toBe(23);
    expect(phase(b, 'idle')!.time).toBe(24 * 10);
    expect(b.reachability).toBe(3600);
    expect(b.phases.reduce((s, p) => s + p.time, 0)).toBeCloseTo(86400, 9);
  });
});

describe('computeBudget — other modes', () => {
  it('PSM + eDRX uses the eDRX idle current in Active Time', () => {
    const b = computeBudget({ ...base, mode: 'psm-edrx' });
    expect(b.idleCurrent).toBeCloseTo(0.0325, 12);
    expect(phase(b, 'psm')).toBeDefined();
  });
  it('eDRX only: idle for the rest of the interval, reachable every eDRX cycle', () => {
    const b = computeBudget({ ...base, mode: 'edrx' });
    expect(phase(b, 'psm')).toBeUndefined();
    expect(phase(b, 'idle')!.time).toBeCloseTo(3600 - 11.008, 9);
    expect(b.reachability).toBe(20.48);
  });
  it('paging DRX only', () => {
    const b = computeBudget({ ...base, mode: 'drx' });
    expect(b.idleCurrent).toBeCloseTo(0.12, 12);
    expect(b.reachability).toBe(1.28);
  });
  it('compareModes ranks PSM lowest for hourly reports', () => {
    const rows = compareModes(base);
    expect(rows.map((r) => r.mode)).toEqual(['psm', 'psm-edrx', 'edrx', 'drx']);
    const avg = Object.fromEntries(rows.map((r) => [r.mode, r.budget.avgCurrent]));
    expect(avg['psm-edrx']).toBeLessThan(avg.psm);
    expect(avg.psm).toBeLessThan(avg.edrx);
    expect(avg.edrx).toBeLessThan(avg.drx);
  });
});

describe('computeBudget — edge cases', () => {
  it('Active Time longer than the interval: never reaches PSM', () => {
    const b = computeBudget({ ...base, t3324: 7200 });
    expect(b.noPsm).toBe(true);
    expect(phase(b, 'psm')!.time).toBe(0);
    expect(phase(b, 'idle')!.time).toBeCloseTo(3600 - 11.008, 9);
    expect(b.reachability).toBe(1.28);
    expect(b.warnings.some((w) => w.includes('never reaches PSM'))).toBe(true);
  });
  it('connection longer than the interval is scaled into it', () => {
    const b = computeBudget({ ...base, interval: 5 });
    expect(b.phases.reduce((s, p) => s + p.time, 0)).toBeCloseTo(5, 9);
    expect(b.warnings[0]).toMatch(/never leaves connected mode/);
  });
  it('warns about pointless eDRX settings', () => {
    const b = computeBudget({ ...base, mode: 'edrx', edrxCycle: 1.28, ptw: 2.56 });
    expect(b.warnings).toHaveLength(2);
  });
  it('warns when T3324 ≥ T3412', () => {
    expect(computeBudget({ ...base, t3412: 10 }).warnings.some((w) => w.includes('T3324'))).toBe(true);
  });
});

describe('batteryStates', () => {
  it('round-trips through the battery-life parser', () => {
    const b = computeBudget(base);
    const states = parseStates(batteryStates(b));
    expect(states.map((s) => s.label)).toEqual(['PSM sleep', 'Idle (paging)', 'Connection setup', 'Uplink TX', 'RRC inactivity tail']);
    const avg = states.reduce((s, x) => s + x.current * x.duration, 0) / states.reduce((s, x) => s + x.duration, 0);
    expect(avg).toBeCloseTo(b.avgCurrent, 9);
  });
});
