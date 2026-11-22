import { describe, expect, it } from 'vitest';
import { readParams, writeParams } from '../src/lib/url-state';

const defaults = { sf: '7', bw: '125', crc: '1' };

describe('readParams', () => {
  it('returns defaults for an empty query', () => {
    expect(readParams('', defaults)).toEqual(defaults);
  });

  it('overrides known keys and ignores unknown ones', () => {
    expect(readParams('?sf=12&foo=bar', defaults)).toEqual({ sf: '12', bw: '125', crc: '1' });
  });

  it('decodes encoded values', () => {
    expect(readParams('?bw=a%20b', defaults).bw).toBe('a b');
  });
});

describe('writeParams', () => {
  it('omits default values', () => {
    expect(writeParams(defaults, defaults)).toBe('');
    expect(writeParams({ ...defaults, sf: '9' }, defaults)).toBe('?sf=9');
  });

  it('round-trips through readParams', () => {
    const values = { sf: '12', bw: '500', crc: '0' };
    expect(readParams(writeParams(values, defaults), defaults)).toEqual(values);
  });
});
