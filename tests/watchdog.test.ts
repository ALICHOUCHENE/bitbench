import { describe, expect, it } from 'vitest';
import {
  IWDG_WINR_DISABLED,
  iwdgDivider,
  iwdgReport,
  iwdgTimeout,
  iwdgWindow,
  parseRegister,
  solveIwdg,
  solveWwdg,
  wwdgDivider,
  wwdgReport,
  wwdgTimeout,
  wwdgWindow,
} from '../src/lib/watchdog';

describe('IWDG timeout', () => {
  it('matches the DS9773 (STM32F030) table 55 at 40 kHz', () => {
    expect(iwdgDivider(0)).toBe(4);
    expect(iwdgDivider(6)).toBe(256);
    expect(iwdgTimeout(40e3, 0, 0)).toBeCloseTo(0.1e-3, 12);
    expect(iwdgTimeout(40e3, 0, 0xfff)).toBeCloseTo(409.6e-3, 12);
    expect(iwdgTimeout(40e3, 6, 0)).toBeCloseTo(6.4e-3, 12);
    expect(iwdgTimeout(40e3, 6, 0xfff)).toBeCloseTo(26.2144, 9);
  });

  it('gives the familiar 32 kHz values', () => {
    // ÷32 at 32 kHz is a 1 ms tick, so RL = 999 is exactly 1 s.
    expect(iwdgTimeout(32e3, 3, 999)).toBeCloseTo(1, 12);
    expect(iwdgTimeout(32e3, 6, 0xfff)).toBeCloseTo(32.768, 9);
  });
});

describe('solveIwdg', () => {
  it('finds an exact 1 s at 32 kHz with the finest prescaler that reaches it', () => {
    const s = solveIwdg(32e3, 1);
    const best = s.options[s.best];
    // ÷8 tops out at 1.024 s, so 1 s fits and is exact: RL = 3999.
    expect(best.code).toBe(1);
    expect(best.reload).toBe(3999);
    expect(best.error).toBe(0);
    expect(s.options[0].fits).toBe(false); // ÷4 max is 512 ms
  });

  it('rounds to the nearest tick, or up with atLeast', () => {
    // 40 kHz, ÷4 → 100 µs tick; 250.04 ms is 2500.4 ticks.
    expect(solveIwdg(40e3, 0.25004).options[0].reload).toBe(2499);
    expect(solveIwdg(40e3, 0.25004, 7, true).options[0].reload).toBe(2500);
  });

  it('reports out-of-range targets', () => {
    expect(solveIwdg(40e3, 30).best).toBe(-1); // max 26.2 s at 40 kHz
    expect(solveIwdg(40e3, 30, 9).best).toBeGreaterThan(-1); // ÷1024 reaches 104.9 s
    expect(solveIwdg(40e3, 50e-6).best).toBe(-1);
  });
});

describe('IWDG window and tolerance', () => {
  it('computes WINR from the earliest refresh time', () => {
    // 1 ms tick, RL = 999: a window opening after 200 ms is WINR = 799.
    expect(iwdgWindow(32e3, 3, 999, 0.2)).toBe(799);
    expect(iwdgWindow(32e3, 3, 999, 0)).toBe(IWDG_WINR_DISABLED);
    expect(iwdgWindow(32e3, 3, 999, 1.5)).toBeNull();
  });

  it('widens the timeout over the LSI range and narrows the safe refresh interval', () => {
    const r = iwdgReport(32e3, 17e3, 47e3, 3, 999, 799);
    expect(r.timeout).toBeCloseTo(1, 12);
    expect(r.windowOpen).toBeCloseTo(0.2, 12);
    expect(r.timeoutMin).toBeCloseTo(32_000 / 47e3, 12); // 0.681 s
    expect(r.timeoutMax).toBeCloseTo(32_000 / 17e3, 12); // 1.882 s
    expect(r.windowOpenMax).toBeCloseTo(6_400 / 17e3, 12); // 0.376 s
    expect(r.safe![0]).toBeCloseTo(r.windowOpenMax, 12);
    expect(r.safe![1]).toBeCloseTo(r.timeoutMin, 12);
  });

  it('flags a window that can never be met over the whole range', () => {
    // Window opens at 600 ms nominal: 1.13 s at 17 kHz, after the 681 ms fastest timeout.
    expect(iwdgReport(32e3, 17e3, 47e3, 3, 999, 399).safe).toBeNull();
  });

  it('treats WINR ≥ RL as no window', () => {
    expect(iwdgReport(32e3, 30e3, 34e3, 3, 999).windowOpen).toBe(0);
    expect(iwdgReport(32e3, 30e3, 34e3, 3, 999, 999).windowOpen).toBe(0);
  });
});

describe('WWDG', () => {
  it('matches the DS9773 (STM32F030) table 56 at PCLK = 48 MHz', () => {
    expect(wwdgDivider(0)).toBe(4096);
    expect(wwdgTimeout(48e6, 0, 0x40)).toBeCloseTo(85.333e-6, 9);
    expect(wwdgTimeout(48e6, 0, 0x7f)).toBeCloseTo(5.4613e-3, 7);
    expect(wwdgTimeout(48e6, 3, 0x7f)).toBeCloseTo(43.69e-3, 5);
  });

  it('solves a 40 ms timeout at 48 MHz', () => {
    const s = solveWwdg(48e6, 40e-3);
    const best = s.options[s.best];
    // Only ÷32768 (683 µs tick, max 43.69 ms) reaches 40 ms: 58.6 ticks → 59 → T = 0x7A.
    expect(best.code).toBe(3);
    expect(best.reload).toBe(0x3f + 59);
    expect(best.timeout).toBeCloseTo((59 * 32768) / 48e6, 12);
  });

  it('needs the 3-bit WDGTB for long timeouts', () => {
    expect(solveWwdg(48e6, 0.3).best).toBe(-1);
    expect(solveWwdg(48e6, 0.3, 8).options[solveWwdg(48e6, 0.3, 8).best].code).toBe(6);
  });

  it('computes the window, EWI and W', () => {
    const r = wwdgReport(48e6, 3, 0x7f, 0x50);
    const tick = 32768 / 48e6;
    expect(r.timeout).toBeCloseTo(64 * tick, 12);
    expect(r.windowOpen).toBeCloseTo(0x2f * tick, 12);
    expect(r.ewi).toBeCloseTo(63 * tick, 12);
    expect(wwdgReport(48e6, 0, 0x50).windowOpen).toBe(0); // W = 0x7F ≥ T
    expect(wwdgWindow(48e6, 3, 0x7f, 0x2f * tick)).toBe(0x50);
    expect(wwdgWindow(48e6, 3, 0x7f, 0)).toBe(0x7f);
    expect(wwdgWindow(48e6, 3, 0x7f, 0.05)).toBeNull();
  });
});

describe('parseRegister', () => {
  it('accepts decimal, hex and binary', () => {
    expect(parseRegister('999')).toBe(999);
    expect(parseRegister('0xFFF')).toBe(0xfff);
    expect(parseRegister(' 0b1010 ')).toBe(10);
    expect(parseRegister('0x7f')).toBe(127);
  });
  it('rejects anything else', () => {
    expect(parseRegister('')).toBeNull();
    expect(parseRegister('-1')).toBeNull();
    expect(parseRegister('1.5')).toBeNull();
    expect(parseRegister('0xZZ')).toBeNull();
  });
});
