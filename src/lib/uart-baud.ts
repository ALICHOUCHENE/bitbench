// UART baud-rate generator maths for STM32 USART and AVR USART. Pure functions, clock in Hz.

export const STANDARD_BAUDS = [
  300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 28800, 38400, 57600, 76800, 115200, 230400, 250000, 460800,
  500000, 921600, 1000000, 2000000, 3000000,
];

export interface BaudResult {
  /** Actual baud rate produced. */
  actual: number;
  /** Relative error (actual − target) / target. */
  error: number;
}

/** Relative error, snapped to 0 when it is only floating-point noise. */
function relError(actual: number, target: number): number {
  const e = actual / target - 1;
  return Math.abs(e) < 1e-12 ? 0 : e;
}

/** Of the two integer divisors around `ideal`, the one whose baud rate is closest to the target. */
function nearestDivisor(ideal: number, min: number, max: number): number {
  const lo = Math.min(max, Math.max(min, Math.floor(ideal)));
  const hi = Math.min(max, Math.max(min, Math.ceil(ideal)));
  // Baud is proportional to 1/divisor, so compare errors in baud space, not divisor space.
  return Math.abs(ideal / lo - 1) <= Math.abs(ideal / hi - 1) ? lo : hi;
}

// ---------- STM32 USART ----------

export type Oversampling = 16 | 8;

export interface Stm32Baud extends BaudResult {
  oversampling: Oversampling;
  /** Value to write in USART_BRR. */
  brr: number;
  /** DIV_Mantissa = BRR[15:4]. */
  mantissa: number;
  /** DIV_Fraction = BRR[3:0] (OVER16) or BRR[2:0] (OVER8, BRR[3] = 0). */
  fraction: number;
  /** USARTDIV as a real number, mantissa + fraction / (oversampling). */
  usartdiv: number;
  /** Clock cycles per bit actually used: f_ck / actual baud. */
  divisor: number;
}

/**
 * STM32 USART baud register.
 *
 * Reference manuals describe the same divider in two ways:
 *  - RM0008 / RM0090 (F1, F2, F4): baud = f_ck / (8 · (2 − OVER8) · USARTDIV), with USARTDIV coded
 *    as a 12-bit mantissa and a 4-bit (OVER16) or 3-bit (OVER8, BRR[3] kept clear) fraction.
 *  - RM0351 and later (F0, F3, F7, L4, G0, G4, H7…): USARTDIV = f_ck / baud (OVER16), BRR = USARTDIV;
 *    USARTDIV = 2 · f_ck / baud (OVER8), BRR[15:4] = USARTDIV[15:4], BRR[3] = 0, BRR[2:0] = USARTDIV[3:0] >> 1.
 * Both give the same register: f_ck divided by an integer D, in 1/16-bit steps (OVER16) or 1/8-bit
 * steps (OVER8). This function picks the D closest to the target, which is what RM0090's worked
 * examples do (fraction rounded, carry into the mantissa).
 *
 * Returns null when the baud rate is out of range: D must be ≥ 16 (OVER16) or ≥ 8 (OVER8), i.e.
 * baud ≤ f_ck/16 or f_ck/8, and the mantissa is 12 bits.
 */
export function stm32Brr(clock: number, baud: number, oversampling: Oversampling): Stm32Baud | null {
  const ideal = clock / baud; // clock cycles per bit
  const min = oversampling; // USARTDIV ≥ 1.0
  const max = oversampling === 16 ? 0xffff : 0xfff * 8 + 7;
  if (!(ideal >= min - 0.5) || !(ideal <= max + 0.5)) return null;
  const d = nearestDivisor(ideal, min, max);
  return stm32FromDivisor(clock, baud, oversampling, d);
}

function stm32FromDivisor(clock: number, baud: number, oversampling: Oversampling, d: number): Stm32Baud {
  const mantissa = Math.floor(d / oversampling);
  const fraction = d % oversampling;
  const brr = (mantissa << 4) | fraction;
  const actual = clock / d;
  return {
    oversampling,
    brr,
    mantissa,
    fraction,
    usartdiv: d / oversampling,
    divisor: d,
    actual,
    error: relError(actual, baud),
  };
}

/**
 * What STM32Cube HAL for the newer USART (L4, G0, G4, H7, WB… UART_DIV_SAMPLING8) writes with OVER8:
 * usartdiv = round(2·f_ck / baud); BRR = (usartdiv & 0xFFF0) | ((usartdiv & 0xF) >> 1).
 * Dropping bit 0 truncates, so this can be one step below the nearest divisor.
 */
export function stm32HalOver8(clock: number, baud: number): Stm32Baud | null {
  const usartdiv = Math.floor((2 * clock + Math.floor(baud / 2)) / baud);
  if (usartdiv < 16 || usartdiv > 0xffff) return null;
  const d = usartdiv >> 1; // effective divisor in 1/8-bit steps
  return stm32FromDivisor(clock, baud, 8, d);
}

// ---------- AVR USART ----------

export interface AvrBaud extends BaudResult {
  u2x: boolean;
  /** UBRRn register value, 0 … 4095. */
  ubrr: number;
}

/**
 * AVR (ATmega328P datasheet, Table 24-1, asynchronous mode):
 *   U2X = 0: UBRR = f_osc / (16 · baud) − 1,  baud = f_osc / (16 · (UBRR + 1))
 *   U2X = 1: UBRR = f_osc / (8 · baud) − 1,   baud = f_osc / (8 · (UBRR + 1))
 * UBRR is rounded to the value that gives the smallest baud error. Null when out of the 12-bit range.
 */
export function avrUbrr(clock: number, baud: number, u2x: boolean): AvrBaud | null {
  const k = u2x ? 8 : 16;
  const ideal = clock / (k * baud); // = UBRR + 1
  if (!(ideal >= 0.5) || !(ideal <= 4096.5)) return null;
  const n = nearestDivisor(ideal, 1, 4096);
  const actual = clock / (k * n);
  return { u2x, ubrr: n - 1, actual, error: relError(actual, baud) };
}

/** Rule-of-thumb limit for the baud error of one end (see the page explainer). */
export const BAUD_ERROR_LIMIT = 0.02;

export function hex(n: number, digits = 1): string {
  return `0x${n.toString(16).toUpperCase().padStart(digits, '0')}`;
}
