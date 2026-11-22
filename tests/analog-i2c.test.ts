import { describe, expect, it } from 'vitest';
import { I2C_MODES, i2cCheck, i2cLowLevel, i2cRiseTime, i2cRpMax, i2cRpMin } from '../src/lib/analog';

// Values from NXP UM10204 rev. 7.0 (2021), Tables 10/11 and §7.1.
describe('I²C mode table', () => {
  it('matches UM10204', () => {
    expect(I2C_MODES.standard).toMatchObject({ fScl: 100e3, trMax: 1000e-9, iol: 3e-3, cbMax: 400e-12 });
    expect(I2C_MODES.fast).toMatchObject({ fScl: 400e3, trMax: 300e-9, iol: 3e-3, cbMax: 400e-12 });
    expect(I2C_MODES.fastplus).toMatchObject({ fScl: 1e6, trMax: 120e-9, iol: 20e-3, cbMax: 550e-12 });
  });
});

describe('Rp(min)', () => {
  it('3.3 V: (3.3 − 0.4) / 3 mA = 966.7 Ω (Sm, Fm), / 20 mA = 145 Ω (Fm+)', () => {
    expect(i2cRpMin(3.3, 'standard')).toBeCloseTo(966.667, 2);
    expect(i2cRpMin(3.3, 'fast')).toBeCloseTo(966.667, 2);
    expect(i2cRpMin(3.3, 'fastplus')).toBeCloseTo(145, 9);
  });

  it('5 V: 1533 Ω (Sm, Fm), 230 Ω (Fm+)', () => {
    expect(i2cRpMin(5, 'fast')).toBeCloseTo(1533.33, 1);
    expect(i2cRpMin(5, 'fastplus')).toBeCloseTo(230, 9);
  });

  it('VDD ≤ 2 V uses VOL = 0.2·VDD at 2 mA', () => {
    const low = i2cLowLevel(1.8, 'fast');
    expect(low.vol).toBeCloseTo(0.36, 12);
    expect(low.iol).toBe(2e-3);
    expect(low.lowVoltage).toBe(true);
    expect(i2cRpMin(1.8, 'fast')).toBeCloseTo(720, 9);
    expect(i2cRpMin(1.8, 'fastplus')).toBeCloseTo(720, 9);
    expect(i2cLowLevel(2.5, 'fast').lowVoltage).toBe(false);
  });
});

describe('Rp(max) = tr / (0.8473·Cb)', () => {
  it('Standard-mode, 400 pF: 2.95 kΩ', () => {
    expect(i2cRpMax(400e-12, 'standard')).toBeCloseTo(1000e-9 / (0.8473 * 400e-12), 6);
    expect(i2cRpMax(400e-12, 'standard')).toBeCloseTo(2950.55, 1);
  });

  it('Fast-mode, 100 pF: 3.54 kΩ', () => {
    expect(i2cRpMax(100e-12, 'fast')).toBeCloseTo(3540.66, 1);
  });

  it('Fast-mode Plus, 550 pF: 257.5 Ω', () => {
    expect(i2cRpMax(550e-12, 'fastplus')).toBeCloseTo(257.50, 1);
  });

  it('rise time is the inverse relation', () => {
    expect(i2cRiseTime(i2cRpMax(200e-12, 'fast'), 200e-12)).toBeCloseTo(300e-9, 15);
  });
});

describe('i2cCheck', () => {
  it('4.7 kΩ on a 200 pF Fast-mode bus fails the rise time', () => {
    const c = i2cCheck(3.3, 200e-12, 'fast', 4700);
    expect(c.feasible).toBe(true);
    expect(c.resistor!.riseTime).toBeCloseTo(0.8473 * 4700 * 200e-12, 15);
    expect(c.resistor!.riseOk).toBe(false);
    expect(c.resistor!.sinkOk).toBe(true);
  });

  it('2.2 kΩ on a 100 pF Fast-mode bus passes', () => {
    const c = i2cCheck(3.3, 100e-12, 'fast', 2200);
    expect(c.resistor!.riseOk).toBe(true);
    expect(c.resistor!.sinkOk).toBe(true);
    expect(c.resistor!.sinkCurrent).toBeCloseTo(2.9 / 2200, 12);
  });

  it('flags infeasible and over-capacitance buses', () => {
    const c = i2cCheck(5, 450e-12, 'fast');
    expect(c.capacitanceOk).toBe(false);
    expect(c.feasible).toBe(false); // 1533 Ω > 787 Ω
    expect(i2cCheck(3.3, 500e-12, 'fastplus').capacitanceOk).toBe(true);
  });

  it('too small a resistor overloads the driver', () => {
    expect(i2cCheck(3.3, 100e-12, 'standard', 680).resistor!.sinkOk).toBe(false);
  });
});
