import { describe, expect, it } from 'vitest';
import {
  SPI_MODES,
  pickClock,
  signalLimits,
  spiDiagramSvg,
  spiMode,
  stm32Options,
  transferTime,
} from '../src/lib/spi-timing';

describe('stm32Options', () => {
  it('lists BR 0–7 as fPCLK / 2 … / 256', () => {
    const o = stm32Options(84e6);
    expect(o.map((x) => x.div)).toEqual([2, 4, 8, 16, 32, 64, 128, 256]);
    expect(o.map((x) => x.br)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(o[0].sck).toBe(42e6);
    expect(o[7].sck).toBeCloseTo(328_125, 6);
  });
});

describe('pickClock', () => {
  it('takes the fastest STM32 setting at or below the limit', () => {
    expect(pickClock(84e6, 20e6, 'stm32')).toEqual({ div: 8, br: 2, sck: 10.5e6 });
    expect(pickClock(84e6, 21e6, 'stm32')).toEqual({ div: 4, br: 1, sck: 21e6 }); // exact counts
    expect(pickClock(84e6, 100e6, 'stm32')).toEqual({ div: 2, br: 0, sck: 42e6 });
    expect(pickClock(170e6, 100e3, 'stm32')).toBeNull(); // 170 MHz / 256 = 664 kHz
  });

  it('integer dividers round up and stay at 2 or more', () => {
    expect(pickClock(48e6, 10e6, 'integer')).toEqual({ div: 5, br: null, sck: 9.6e6 });
    expect(pickClock(48e6, 12e6, 'integer')).toEqual({ div: 4, br: null, sck: 12e6 });
    expect(pickClock(48e6, 100e6, 'integer')!.div).toBe(2);
  });
});

describe('spiMode', () => {
  it('matches the standard CPOL/CPHA table', () => {
    expect(SPI_MODES.map((m) => [m.cpol, m.cpha, m.idle, m.sample, m.shift])).toEqual([
      [0, 0, 'low', 'rising', 'falling'],
      [0, 1, 'low', 'falling', 'rising'],
      [1, 0, 'high', 'falling', 'rising'],
      [1, 1, 'high', 'rising', 'falling'],
    ]);
    expect(spiMode(3).mode).toBe(3);
  });
});

describe('transferTime', () => {
  it('adds CS set-up/hold and inter-frame gaps to the clocked bits', () => {
    const r = transferTime({ sck: 1e6, frameBits: 8, frames: 4, gap: 2e-6, csSetup: 1e-6, csHold: 1e-6 });
    expect(r.clockTime).toBeCloseTo(32e-6, 15);
    expect(r.total).toBeCloseTo(32e-6 + 3 * 2e-6 + 2e-6, 15);
    expect(r.throughput).toBeCloseTo(32 / 40e-6, 3);
    expect(r.efficiency).toBeCloseTo(0.8, 12);
  });

  it('back-to-back frames run at the full SCK rate', () => {
    const r = transferTime({ sck: 10e6, frameBits: 16, frames: 100, gap: 0, csSetup: 0, csHold: 0 });
    expect(r.throughput).toBeCloseTo(10e6, 3);
  });
});

describe('signalLimits', () => {
  it('read path counts the round trip, write path does not', () => {
    const l = signalLimits({ slaveTv: 8e-9, slaveTsu: 3e-9, masterTsu: 4e-9, masterTv: 5e-9, tpd: 1e-9 });
    expect(l.fRead).toBeCloseTo(1 / (2 * 14e-9), 0); // 35.7 MHz
    expect(l.fWrite).toBeCloseTo(1 / (2 * 8e-9), 0); // 62.5 MHz
  });

  it('is unbounded when no timing is given', () => {
    expect(signalLimits({ slaveTv: 0, slaveTsu: 0, masterTsu: 0, masterTv: 0, tpd: 0 }).fRead).toBe(Infinity);
  });
});

describe('spiDiagramSvg', () => {
  it('draws eight sample markers and labels every bit, MSB first', () => {
    for (const mode of [0, 1, 2, 3] as const) {
      const svg = spiDiagramSvg(mode);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.match(/class="sd-sample"/g)).toHaveLength(8);
      expect(svg).toContain(`SPI mode ${mode}`);
      expect(svg.indexOf('>7</text>')).toBeLessThan(svg.indexOf('>0</text>'));
    }
  });

  it('starts SCK at the idle level set by CPOL', () => {
    // The SCK path begins at x = 52 and y = 70 ± 14.
    expect(spiDiagramSvg(0)).toMatch(/M52 84 /);
    expect(spiDiagramSvg(2)).toMatch(/M52 56 /);
  });
});
