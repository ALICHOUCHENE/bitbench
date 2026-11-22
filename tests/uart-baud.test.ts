import { describe, expect, it } from 'vitest';
import { avrUbrr, hex, STANDARD_BAUDS, stm32Brr, stm32HalOver8 } from '../src/lib/uart-baud';

describe('stm32Brr', () => {
  it('84 MHz / 115200, OVER16 → BRR 0x2D9 (USARTDIV 45.5625)', () => {
    // 84e6 / 115200 = 729.17 → 729 = 0x2D9: mantissa 45 (0x2D), fraction 9 (0.5729 · 16 = 9.17)
    const r = stm32Brr(84e6, 115200, 16)!;
    expect(hex(r.brr)).toBe('0x2D9');
    expect(r.mantissa).toBe(45);
    expect(r.fraction).toBe(9);
    expect(r.actual).toBeCloseTo(115226.34, 1);
    expect(r.error * 100).toBeCloseTo(0.0229, 3);
  });

  it('RM0090 worked examples: USARTDIV 25.62 → 0x19A (OVER16), 0x195 (OVER8)', () => {
    // Choose f_ck/baud so USARTDIV = 25.62: OVER16 → f_ck/baud = 409.92, OVER8 → 204.96
    expect(stm32Brr(409.92 * 9600, 9600, 16)!.brr).toBe(0x19a);
    expect(stm32Brr(204.96 * 9600, 9600, 8)!.brr).toBe(0x195);
  });

  it('RM0090 worked example: USARTDIV 50.99 → fraction carries, BRR 0x330', () => {
    expect(stm32Brr(50.99 * 16 * 9600, 9600, 16)!.brr).toBe(0x330);
  });

  it('OVER8 keeps BRR[3] clear', () => {
    for (const b of STANDARD_BAUDS) {
      const r = stm32Brr(72e6, b, 8);
      if (r) expect(r.brr & 0x8).toBe(0);
    }
  });

  it('RM0351 example: 8 MHz / 9600 OVER8 → BRR 0x681', () => {
    // USARTDIV = 2 · 8e6 / 9600 = 1666.67 → 1667 = 0x683 → BRR = 0x680 | (0x3 >> 1) = 0x681
    expect(stm32HalOver8(8e6, 9600)!.brr).toBe(0x681);
    expect(stm32Brr(8e6, 9600, 8)!.brr).toBe(0x681);
  });

  it('nearest divisor can beat the HAL OVER8 truncation', () => {
    // 2·f/baud = 22.98 → HAL 23 → >>1 = 11 (11.49 ideal, ok); 2·f/baud = 21.2 → 21 → 10, ideal 10.6 → 11
    const f = 10.6 * 115200;
    expect(stm32HalOver8(f, 115200)!.divisor).toBe(10);
    expect(stm32Brr(f, 115200, 8)!.divisor).toBe(11);
  });

  it('rejects baud rates above f_ck/16 (OVER16) or f_ck/8 (OVER8)', () => {
    expect(stm32Brr(16e6, 2e6, 16)).toBeNull();
    expect(stm32Brr(16e6, 2e6, 8)!.brr).toBe(0x10);
    expect(stm32Brr(16e6, 1e6, 16)!.brr).toBe(0x10);
  });

  it('rejects baud rates too low for the 12-bit mantissa', () => {
    expect(stm32Brr(84e6, 300, 16)).toBeNull(); // 280 000 > 65 535
    expect(stm32Brr(16e6, 300, 16)!.brr).toBe(53333);
  });
});

describe('avrUbrr (ATmega328P Table 24-1)', () => {
  it('16 MHz / 9600, U2X = 0 → UBRR 103, +0.16 %', () => {
    const r = avrUbrr(16e6, 9600, false)!;
    expect(r.ubrr).toBe(103);
    expect(r.error * 100).toBeCloseTo(0.16, 2);
  });

  it('16 MHz / 115200, U2X = 0 → UBRR 8, −3.5 %', () => {
    const r = avrUbrr(16e6, 115200, false)!;
    expect(r.ubrr).toBe(8);
    expect(r.error * 100).toBeCloseTo(-3.55, 2);
  });

  it('16 MHz / 115200, U2X = 1 → UBRR 16, +2.1 %', () => {
    const r = avrUbrr(16e6, 115200, true)!;
    expect(r.ubrr).toBe(16);
    expect(r.error * 100).toBeCloseTo(2.12, 2);
  });

  it('7.3728 MHz gives 0 % error at 115200 (UBRR 3)', () => {
    const r = avrUbrr(7.3728e6, 115200, false)!;
    expect(r.ubrr).toBe(3);
    expect(r.error).toBe(0);
  });

  it('16 MHz / 1 Mbaud → UBRR 0, U2X = 1 → UBRR 1', () => {
    expect(avrUbrr(16e6, 1e6, false)!.ubrr).toBe(0);
    expect(avrUbrr(16e6, 1e6, true)!.ubrr).toBe(1);
  });

  it('respects the 12-bit UBRR limit', () => {
    // 16 MHz / (16 · 300) = 3333.3 → UBRR 3332; 20 MHz needs 4166.7 > 4096 → out of range
    expect(avrUbrr(16e6, 300, false)!.ubrr).toBe(3332);
    expect(avrUbrr(20e6, 300, false)).toBeNull();
    expect(avrUbrr(20e6, 300, true)).toBeNull();
  });
});
