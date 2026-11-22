import { describe, expect, it } from 'vitest';
import {
  cleanLabel,
  displayCurrent,
  displayTime,
  estimateBattery,
  MAX_STATES,
  parseStates,
  serializeStates,
} from '../src/lib/battery';

describe('parseStates', () => {
  it('parses the PSM/eDRX link contract', () => {
    expect(parseStates('Active:6:20;PSM sleep:0.003:3580')).toEqual([
      { label: 'Active', current: 6, duration: 20 },
      { label: 'PSM sleep', current: 0.003, duration: 3580 },
    ]);
  });

  it('works on a URL-decoded query param', () => {
    const p = new URLSearchParams('?states=Active%3A6%3A20%3BPSM%20sleep%3A0.003%3A3580');
    expect(parseStates(p.get('states'))).toHaveLength(2);
    const q = new URLSearchParams('?states=Active:6:20;PSM sleep:0.003:3580');
    expect(parseStates(q.get('states'))[1].label).toBe('PSM sleep');
  });

  it('skips malformed items and keeps the rest', () => {
    expect(parseStates('a:1;b:x:2;c:-1:5;d:1:0;e:2:3;;')).toEqual([{ label: 'e', current: 2, duration: 3 }]);
  });

  it('allows ":" in labels and fills empty labels', () => {
    expect(parseStates('TX: SF12:120:1.5;:0.01:10')).toEqual([
      { label: 'TX: SF12', current: 120, duration: 1.5 },
      { label: 'State 2', current: 0.01, duration: 10 },
    ]);
  });

  it('returns [] for empty input', () => {
    expect(parseStates(null)).toEqual([]);
    expect(parseStates('')).toEqual([]);
    expect(parseStates('garbage')).toEqual([]);
  });

  it('caps the number of states and label length', () => {
    const many = Array.from({ length: 50 }, (_, i) => `s${i}:1:1`).join(';');
    expect(parseStates(many)).toHaveLength(MAX_STATES);
    expect(parseStates(`${'x'.repeat(100)}:1:1`)[0].label).toHaveLength(40);
  });

  it('keeps hostile labels as plain text (escaping is done at render time)', () => {
    expect(parseStates('<img src=x onerror=alert(1)>:1:1')[0].label).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('serializeStates', () => {
  it('round-trips', () => {
    const s = [
      { label: 'Active', current: 6, duration: 20 },
      { label: 'PSM sleep', current: 0.003, duration: 3580 },
    ];
    expect(serializeStates(s)).toBe('Active:6:20;PSM sleep:0.003:3580');
    expect(parseStates(serializeStates(s))).toEqual(s);
  });

  it('strips separators from labels', () => {
    expect(cleanLabel(' a;b\n c ')).toBe('a b c');
    expect(parseStates(serializeStates([{ label: 'x;y', current: 1, duration: 2 }]))[0].label).toBe('x y');
  });

  it('avoids float noise', () => {
    expect(serializeStates([{ label: 'a', current: 0.1 + 0.2, duration: 1 }])).toBe('a:0.3:1');
  });
});

describe('estimateBattery', () => {
  const states = [
    { label: 'Active', current: 6, duration: 20 },
    { label: 'PSM sleep', current: 0.003, duration: 3580 },
  ];

  it('averages current over the cycle', () => {
    const e = estimateBattery(1000, 100, 0, states);
    // (6·20 + 0.003·3580) / 3600 = (120 + 10.74) / 3600 = 0.036317 mA
    expect(e.cycle).toBe(3600);
    expect(e.avgCurrent).toBeCloseTo(0.0363167, 6);
    expect(e.chargePerCycle).toBeCloseTo(0.0363167, 6); // mAh per 1 h cycle
    expect(e.cyclesPerDay).toBe(24);
    expect(e.states[0].share).toBeCloseTo(120 / 130.74, 9);
    expect(e.states[0].timeShare).toBeCloseTo(20 / 3600, 9);
  });

  it('computes lifetime without self-discharge', () => {
    const e = estimateBattery(1000, 100, 0, states);
    expect(e.lifetime / 3600).toBeCloseTo(1000 / 0.0363167, 0);
  });

  it('1 mA average from a 1000 mAh cell at 80 % lasts 800 h', () => {
    const e = estimateBattery(1000, 80, 0, [{ label: 'on', current: 1, duration: 1 }]);
    expect(e.lifetime).toBeCloseTo(800 * 3600, 6);
  });

  it('self-discharge alone: 10 %/year on a 100 % usable cell lasts 10 years', () => {
    const e = estimateBattery(1000, 100, 10, [{ label: 'off', current: 0, duration: 1 }]);
    expect(e.selfDischargeCurrent).toBeCloseTo(1000 * 0.1 / 8760, 12);
    expect(e.lifetime / (8760 * 3600)).toBeCloseTo(10, 9);
    expect(e.selfDischargeShare).toBe(1);
  });

  it('is infinite with no drain', () => {
    expect(estimateBattery(1000, 80, 0, [{ label: 'off', current: 0, duration: 1 }]).lifetime).toBe(Infinity);
  });
});

describe('display units', () => {
  it('picks readable current units', () => {
    expect(displayCurrent(0.003)).toEqual({ value: '3', unit: 'uA' });
    expect(displayCurrent(6)).toEqual({ value: '6', unit: 'mA' });
    expect(displayCurrent(1500)).toEqual({ value: '1.5', unit: 'A' });
    expect(displayCurrent(0)).toEqual({ value: '0', unit: 'mA' });
  });

  it('picks readable time units', () => {
    expect(displayTime(3580)).toEqual({ value: '3580', unit: 's' });
    expect(displayTime(3600)).toEqual({ value: '1', unit: 'h' });
    expect(displayTime(120)).toEqual({ value: '2', unit: 'min' });
    expect(displayTime(0.02)).toEqual({ value: '20', unit: 'ms' });
    expect(displayTime(0.0005)).toEqual({ value: '500', unit: 'us' });
  });
});
