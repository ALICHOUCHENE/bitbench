import { describe, expect, it } from 'vitest';
import { rcCapacitanceFor, rcCutoff, rcResistanceFor, rcResponse, rcSettlingTime } from '../src/lib/analog';

describe('rcCutoff', () => {
  it('matches the textbook value for 10 kΩ / 100 nF', () => {
    // 1 / (2π · 10e3 · 100e-9) = 159.1549 Hz
    expect(rcCutoff(10e3, 100e-9)).toBeCloseTo(159.1549, 3);
  });

  it('1 kΩ / 1 µF gives 159.15 Hz', () => {
    expect(rcCutoff(1e3, 1e-6)).toBeCloseTo(159.1549, 3);
  });

  it('solving for C or R inverts the cutoff', () => {
    const c = rcCapacitanceFor(1000, 4700);
    expect(rcCutoff(4700, c)).toBeCloseTo(1000, 9);
    const r = rcResistanceFor(1000, 10e-9);
    expect(rcCutoff(r, 10e-9)).toBeCloseTo(1000, 9);
  });
});

describe('rcResponse', () => {
  it('is −3.01 dB and ∓45° at the cutoff', () => {
    const lp = rcResponse('lowpass', 1000, 1000);
    expect(lp.gainDb).toBeCloseTo(-3.0103, 3);
    expect(lp.phaseDeg).toBeCloseTo(-45, 9);
    const hp = rcResponse('highpass', 1000, 1000);
    expect(hp.gainDb).toBeCloseTo(-3.0103, 3);
    expect(hp.phaseDeg).toBeCloseTo(45, 9);
  });

  it('rolls off at about 20 dB/decade', () => {
    expect(rcResponse('lowpass', 1000, 100_000).gainDb).toBeCloseTo(-40, 1);
    expect(rcResponse('highpass', 1000, 10).gainDb).toBeCloseTo(-40, 1);
  });

  it('passes the passband with almost no loss', () => {
    expect(rcResponse('lowpass', 1000, 1).gain).toBeCloseTo(1, 5);
    expect(rcResponse('highpass', 1000, 1e6).gain).toBeCloseTo(1, 5);
  });
});

describe('rcSettlingTime', () => {
  it('needs about 4.6 τ to settle within 1 %', () => {
    expect(rcSettlingTime(1, 0.01)).toBeCloseTo(4.60517, 4);
  });
});
