import { describe, expect, it } from 'vitest';
import { applyUnit, formatDuration, formatNumber, formatPercent, formatSI, hasSiPrefix, parseNumber } from '../src/lib/format';

describe('parseNumber', () => {
  it('parses plain and exponent notation', () => {
    expect(parseNumber('42')).toBe(42);
    expect(parseNumber('-3.5')).toBe(-3.5);
    expect(parseNumber('.5')).toBe(0.5);
    expect(parseNumber('1e-3')).toBe(1e-3);
    expect(parseNumber(' 12 ')).toBe(12);
    expect(parseNumber('1,000,000')).toBe(1e6);
  });

  it('parses SI prefixes with or without a unit', () => {
    expect(parseNumber('10k')).toBe(10000);
    expect(parseNumber('8 MHz')).toBe(8e6);
    expect(parseNumber('100nF')).toBeCloseTo(100e-9, 20);
    expect(parseNumber('4.7µ')).toBeCloseTo(4.7e-6, 20);
    expect(parseNumber('4.7u')).toBeCloseTo(4.7e-6, 20);
    expect(parseNumber('3.3V')).toBe(3.3);
    expect(parseNumber('100 mA')).toBeCloseTo(0.1, 12);
  });

  it('parses resistor notation', () => {
    expect(parseNumber('4k7')).toBe(4700);
    expect(parseNumber('2R2')).toBe(2.2);
    expect(parseNumber('1M5')).toBe(1.5e6);
  });

  it('rejects non-numbers', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('1.2.3')).toBeNull();
    expect(parseNumber('--1')).toBeNull();
  });
});

describe('formatNumber', () => {
  it('uses significant digits and trims zeros', () => {
    expect(formatNumber(56.576)).toBe('56.576');
    expect(formatNumber(1 / 3, 4)).toBe('0.3333');
    expect(formatNumber(1000)).toBe('1000');
    expect(formatNumber(2.5)).toBe('2.5');
    expect(formatNumber(0)).toBe('0');
  });

  it('switches to exponent notation for extreme values', () => {
    expect(formatNumber(1.5e-9, 3)).toBe('1.5e-9');
    expect(formatNumber(2e20, 3)).toBe('2e+20');
  });

  it('handles non-finite values', () => {
    expect(formatNumber(Infinity)).toBe('∞');
    expect(formatNumber(NaN)).toBe('NaN');
  });
});

describe('formatSI', () => {
  it('picks the prefix so the mantissa is between 1 and 999', () => {
    expect(formatSI(0.056576, 's')).toBe('56.576 ms');
    expect(formatSI(1.024e-3, 's')).toBe('1.024 ms');
    expect(formatSI(15915.49, 'Hz', 5)).toBe('15.915 kHz');
    expect(formatSI(4700, 'Ω')).toBe('4.7 kΩ');
    expect(formatSI(3.3, 'V')).toBe('3.3 V');
    expect(formatSI(0, 'A')).toBe('0 A');
  });

  it('does not print 1000 of a smaller prefix after rounding', () => {
    expect(formatSI(0.99999999, 's', 4)).toBe('1 s');
  });
});

describe('formatDuration', () => {
  it('formats short durations with decimals', () => {
    expect(formatDuration(40.96)).toBe('40.96 s');
    expect(formatDuration(0.5)).toBe('500 ms');
  });

  it('formats long durations with two units', () => {
    expect(formatDuration(360)).toBe('6 min');
    expect(formatDuration(5400)).toBe('1 h 30 min');
    expect(formatDuration(86400 * 13 + 3600 * 8)).toBe('13 d 8 h');
    expect(formatDuration(3600)).toBe('1 h');
    expect(formatDuration(10485.76)).toBe('2 h 55 min');
    expect(formatDuration(81.92)).toBe('1 min 21.92 s');
    expect(formatDuration(3599.999)).toBe('1 h');
  });

  it('rounds the second unit instead of truncating it', () => {
    expect(formatDuration(1_151_998)).toBe('13 d 8 h');
    expect(formatDuration(86400 * 365 + 86400 * 0.6)).toBe('1 y 1 d');
    expect(formatDuration(3570)).toBe('59 min 30 s');
  });
});

describe('formatPercent', () => {
  it('formats ratios', () => {
    expect(formatPercent(0.0123)).toBe('1.23 %');
    expect(formatPercent(0.01)).toBe('1 %');
  });
});

describe('applyUnit', () => {
  it('scales plain numbers by the unit selector', () => {
    expect(applyUnit('72', 72, 1e6)).toBe(72e6);
  });
  it('does not scale twice when the input has its own prefix', () => {
    expect(applyUnit('72M', 72e6, 1e6)).toBe(72e6);
    expect(applyUnit('8 kHz', 8e3, 1e6)).toBe(8e3);
    expect(hasSiPrefix('4k7')).toBe(true);
    expect(hasSiPrefix('1e6')).toBe(false);
    expect(hasSiPrefix('100')).toBe(false);
  });
});
