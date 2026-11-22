// Analog helpers: RC filters, voltage dividers, ADC conversion, NTC thermistors, I²C pull-ups.
// Pure functions in SI units (ohms, farads, hertz, volts, seconds).

// ---------- First-order RC filter ----------

export type RcMode = 'lowpass' | 'highpass';

/** Cutoff (−3 dB) frequency of a first-order RC filter: fc = 1 / (2π·R·C). */
export function rcCutoff(r: number, c: number): number {
  return 1 / (2 * Math.PI * r * c);
}

/** Capacitance that gives cutoff fc with resistor r. */
export function rcCapacitanceFor(fc: number, r: number): number {
  return 1 / (2 * Math.PI * r * fc);
}

/** Resistance that gives cutoff fc with capacitor c. */
export function rcResistanceFor(fc: number, c: number): number {
  return 1 / (2 * Math.PI * c * fc);
}

export interface RcResponse {
  /** |H(f)|, linear. */
  gain: number;
  /** 20·log10|H(f)|. */
  gainDb: number;
  /** Phase in degrees. */
  phaseDeg: number;
}

/** Magnitude and phase of a first-order RC filter at frequency f. */
export function rcResponse(mode: RcMode, fc: number, f: number): RcResponse {
  const x = f / fc;
  const gain = mode === 'lowpass' ? 1 / Math.sqrt(1 + x * x) : x / Math.sqrt(1 + x * x);
  const phaseRad = mode === 'lowpass' ? -Math.atan(x) : Math.PI / 2 - Math.atan(x);
  return { gain, gainDb: 20 * Math.log10(gain), phaseDeg: (phaseRad * 180) / Math.PI };
}

/** Time for a step response to settle within `fraction` of its final value (0.01 → 1 %): t = −τ·ln(fraction). */
export function rcSettlingTime(tau: number, fraction: number): number {
  return -tau * Math.log(fraction);
}

// ---------- ADC conversion ----------

/**
 * How the LSB is defined.
 * - 'pow2':   LSB = Vref / 2^N. Code k means V ≈ k·Vref/2^N; the top code 2^N − 1 is Vref − 1 LSB.
 *             This is the ideal transfer function used by most MCU and SAR-ADC datasheets.
 * - 'pow2m1': LSB = Vref / (2^N − 1). The top code 2^N − 1 maps exactly to Vref (some datasheets and
 *             many code examples use this).
 */
export type AdcConvention = 'pow2' | 'pow2m1';

/** Highest output code of an N-bit converter: 2^N − 1. */
export function adcMaxCode(bits: number): number {
  return 2 ** bits - 1;
}

/** Size of one LSB in volts. */
export function adcLsb(vref: number, bits: number, conv: AdcConvention = 'pow2'): number {
  return vref / (conv === 'pow2' ? 2 ** bits : 2 ** bits - 1);
}

/** Voltage represented by an output code (the code centre for the ideal transfer function). */
export function adcCodeToVoltage(code: number, vref: number, bits: number, conv: AdcConvention = 'pow2'): number {
  return code * adcLsb(vref, bits, conv);
}

export interface AdcCodeResult {
  /** V / LSB before rounding. */
  exact: number;
  /** Rounded and clamped to 0 … 2^N − 1. */
  code: number;
  /** True when the input was above the top code and the result saturated at 2^N − 1. */
  saturated: boolean;
}

/**
 * Expected output code for a voltage (rounded to nearest: ideal ADC with ½-LSB first transition).
 * Throws a RangeError when the voltage is outside 0 … Vref.
 */
export function adcVoltageToCode(v: number, vref: number, bits: number, conv: AdcConvention = 'pow2'): AdcCodeResult {
  if (v < 0 || v > vref) throw new RangeError('Voltage is outside the ADC range 0 … Vref.');
  const exact = v / adcLsb(vref, bits, conv);
  const max = adcMaxCode(bits);
  const rounded = Math.round(exact);
  return { exact, code: Math.min(rounded, max), saturated: rounded > max };
}

/** Ideal SNR of an N-bit quantiser for a full-scale sine: 6.02·N + 1.76 dB. */
export function adcIdealSnrDb(bits: number): number {
  return 20 * Math.log10(2 ** bits) + 10 * Math.log10(1.5);
}

// ---------- Resistive divider (R1 on top, R2 to ground) ----------

/** Divider ratio Vout / Vin = R2 / (R1 + R2). */
export function dividerRatio(r1: number, r2: number): number {
  return r2 / (r1 + r2);
}

/** Two resistors in parallel. */
export function parallel(r1: number, r2: number): number {
  return (r1 * r2) / (r1 + r2);
}

export interface DividerLoad {
  /** Current through the divider, A. */
  current: number;
  /** Total dissipated power, W. */
  power: number;
  /** Power in R1 and R2, W. */
  powerR1: number;
  powerR2: number;
  /** Thevenin output impedance seen by the ADC pin: R1 ∥ R2. */
  sourceImpedance: number;
}

/** Current, power and source impedance of an unloaded divider at input voltage vin. */
export function dividerLoad(vin: number, r1: number, r2: number): DividerLoad {
  const current = vin / (r1 + r2);
  return {
    current,
    power: vin * current,
    powerR1: current * current * r1,
    powerR2: current * current * r2,
    sourceImpedance: parallel(r1, r2),
  };
}

export interface DividerSuggestion {
  r1: number;
  r2: number;
  ratio: number;
  sourceImpedance: number;
}

/**
 * Pick the R1/R2 pair from an E-series that gets as close as possible to `targetRatio` without
 * exceeding it (so the maximum input never drives the pin above Vref), with R1 ∥ R2 ≤ maxImpedance.
 * Among pairs with the same ratio, the highest-impedance one (lowest divider current) wins.
 * `values` is the list of allowed resistor values (e.g. eValuesInRange('E24', 100, 10e6)).
 */
export function suggestDivider(targetRatio: number, maxImpedance: number, values: number[]): DividerSuggestion | null {
  if (!(targetRatio > 0 && targetRatio < 1) || !(maxImpedance > 0)) return null;
  let best: DividerSuggestion | null = null;
  for (const r2 of values) {
    // ratio ≤ target  ⇔  R1 ≥ R2·(1 − k)/k: try the smallest allowed R1 that satisfies it.
    const r1Min = (r2 * (1 - targetRatio)) / targetRatio;
    const r1 = values.find((v) => v >= r1Min * (1 - 1e-12));
    if (r1 === undefined) continue;
    const ratio = dividerRatio(r1, r2);
    if (ratio > targetRatio * (1 + 1e-12)) continue;
    const z = parallel(r1, r2);
    if (z > maxImpedance) continue;
    if (
      best === null ||
      ratio > best.ratio * (1 + 1e-9) ||
      (Math.abs(ratio - best.ratio) <= best.ratio * 1e-9 && z > best.sourceImpedance)
    ) {
      best = { r1, r2, ratio, sourceImpedance: z };
    }
  }
  return best;
}

// ---------- NTC thermistor ----------

/** Offset between degrees Celsius and kelvin (exact, by definition of the Celsius scale). */
export const KELVIN_OFFSET = 273.15;

export const cToK = (c: number): number => c + KELVIN_OFFSET;
export const kToC = (k: number): number => k - KELVIN_OFFSET;

/** Beta model: R(T) = R0 · exp(B · (1/T − 1/T0)). Temperatures in °C. */
export function ntcBetaResistance(tC: number, r0: number, beta: number, t0C = 25): number {
  return r0 * Math.exp(beta * (1 / cToK(tC) - 1 / cToK(t0C)));
}

/** Beta model inverse: 1/T = 1/T0 + ln(R/R0) / B. Returns °C. */
export function ntcBetaTemperature(r: number, r0: number, beta: number, t0C = 25): number {
  return kToC(1 / (1 / cToK(t0C) + Math.log(r / r0) / beta));
}

/** B constant from two (T, R) points: B = ln(R1/R2) / (1/T1 − 1/T2). Temperatures in °C. */
export function ntcBetaFromPoints(t1C: number, r1: number, t2C: number, r2: number): number {
  return Math.log(r1 / r2) / (1 / cToK(t1C) - 1 / cToK(t2C));
}

/** Steinhart–Hart coefficients for 1/T = A + B·ln R + C·(ln R)³ (T in kelvin, R in ohms). */
export interface SteinhartHart {
  a: number;
  b: number;
  c: number;
}

/** Steinhart–Hart: temperature (°C) from resistance. */
export function shTemperature(r: number, k: SteinhartHart): number {
  const l = Math.log(r);
  return kToC(1 / (k.a + k.b * l + k.c * l * l * l));
}

/**
 * Steinhart–Hart inverse: resistance from temperature (°C). Solves C·x³ + B·x + (A − 1/T) = 0 for
 * x = ln R in closed form (Cardano; the cubic has a single real root when B, C > 0), with a Newton
 * fallback for unusual coefficient signs.
 */
export function shResistance(tC: number, k: SteinhartHart): number {
  const invT = 1 / cToK(tC);
  if (k.c === 0) return Math.exp((invT - k.a) / k.b);
  let x: number;
  if (k.b > 0 && k.c > 0) {
    const y = (k.a - invT) / (2 * k.c);
    const s = Math.sqrt((k.b / (3 * k.c)) ** 3 + y * y);
    x = Math.cbrt(s - y) - Math.cbrt(s + y);
  } else {
    x = (invT - k.a) / k.b; // start from the linear solution
  }
  // Polish (and solve the fallback case) with Newton's method on f(x) = C·x³ + B·x + A − 1/T.
  for (let i = 0; i < 50; i++) {
    const f = k.c * x * x * x + k.b * x + k.a - invT;
    const df = 3 * k.c * x * x + k.b;
    if (df === 0) break;
    const dx = f / df;
    x -= dx;
    if (Math.abs(dx) < 1e-15 * Math.max(1, Math.abs(x))) break;
  }
  return Math.exp(x);
}

/** Solve a 3×3 linear system M·v = y by Gaussian elimination with partial pivoting. */
function solve3(m: number[][], y: number[]): [number, number, number] {
  const a = m.map((row, i) => [...row, y[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    if (Math.abs(a[piv][col]) < 1e-300) throw new RangeError('The three points do not define a unique solution.');
    [a[col], a[piv]] = [a[piv], a[col]];
    for (let r = col + 1; r < 3; r++) {
      const f = a[r][col] / a[col][col];
      for (let c = col; c < 4; c++) a[r][c] -= f * a[col][c];
    }
  }
  const v = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let s = a[r][3];
    for (let c = r + 1; c < 3; c++) s -= a[r][c] * v[c];
    v[r] = s / a[r][r];
  }
  return [v[0], v[1], v[2]];
}

/** Steinhart–Hart coefficients through three (T °C, R Ω) points. Throws RangeError for degenerate points. */
export function shFromPoints(points: [number, number][]): SteinhartHart {
  if (points.length !== 3) throw new RangeError('Exactly three points are needed.');
  const temps = points.map((p) => p[0]);
  if (new Set(temps).size !== 3) throw new RangeError('The three temperatures must be different.');
  if (points.some((p) => !(p[1] > 0))) throw new RangeError('Resistances must be greater than zero.');
  const rows = points.map(([, r]) => {
    const l = Math.log(r);
    return [1, l, l * l * l];
  });
  const [a, b, c] = solve3(
    rows,
    points.map(([t]) => 1 / cToK(t)),
  );
  return { a, b, c };
}

export type NtcPosition = 'top' | 'bottom';

/**
 * Output of a divider made of the NTC and a fixed resistor, supplied from vs.
 * 'bottom': NTC from the output to ground (Vout falls as temperature rises).
 * 'top':    NTC from the supply to the output (Vout rises with temperature).
 */
export function ntcDividerVout(rNtc: number, rFixed: number, vs: number, position: NtcPosition): number {
  return position === 'bottom' ? (vs * rNtc) / (rNtc + rFixed) : (vs * rFixed) / (rNtc + rFixed);
}

/** NTC resistance from the divider output voltage. Returns NaN outside 0 < vout < vs. */
export function ntcResistanceFromVout(vout: number, rFixed: number, vs: number, position: NtcPosition): number {
  if (!(vout > 0 && vout < vs)) return NaN;
  return position === 'bottom' ? (rFixed * vout) / (vs - vout) : (rFixed * (vs - vout)) / vout;
}

export interface NtcRow {
  tC: number;
  r: number;
  vout: number;
  code: number;
}

/** Temperature table: R, divider voltage and ADC code (rounded, clamped) for each temperature. */
export function ntcTable(
  temps: number[],
  rOfT: (tC: number) => number,
  rFixed: number,
  vs: number,
  position: NtcPosition,
  vref: number,
  bits: number,
  conv: AdcConvention = 'pow2',
): NtcRow[] {
  const lsb = adcLsb(vref, bits, conv);
  const max = adcMaxCode(bits);
  return temps.map((tC) => {
    const r = rOfT(tC);
    const vout = ntcDividerVout(r, rFixed, vs, position);
    const code = Math.max(0, Math.min(max, Math.round(vout / lsb)));
    return { tC, r, vout, code };
  });
}

/** Temperatures from tMin to tMax (inclusive when on the grid) in steps of `step`. */
export function tempRange(tMin: number, tMax: number, step: number): number[] {
  const out: number[] = [];
  const n = Math.floor((tMax - tMin) / step + 1e-9);
  for (let i = 0; i <= n; i++) out.push(Number((tMin + i * step).toFixed(6)));
  return out;
}

/**
 * C lookup table + interpolation function for converting a raw ADC code to temperature in
 * tenths of a degree Celsius. Rows must be evenly spaced in temperature and ascending.
 */
export function ntcCTable(rows: NtcRow[], bits: number, header: string, prefix = 'ntc'): string {
  if (rows.length < 2) return '// Need at least two table rows.';
  const step = rows[1].tC - rows[0].tC;
  const t0x10 = Math.round(rows[0].tC * 10);
  const stepx10 = Math.round(step * 10);
  const type = bits <= 16 ? 'uint16_t' : 'uint32_t';
  const rising = rows[rows.length - 1].code > rows[0].code;
  const n = rows.length;
  const P = prefix.toUpperCase();
  const lines: string[] = [];
  lines.push('#include <stdint.h>');
  lines.push('');
  for (const h of header.split('\n')) lines.push(`/* ${h} */`);
  lines.push(`#define ${P}_TABLE_LEN   ${n}`);
  lines.push(`#define ${P}_T0_X10      (${t0x10})  /* first entry, 0.1 °C */`);
  lines.push(`#define ${P}_STEP_X10    (${stepx10})  /* spacing, 0.1 °C */`);
  lines.push('');
  lines.push(`/* ADC code at ${rows[0].tC} °C, ${Number((rows[0].tC + step).toFixed(6))} °C, … ${rows[n - 1].tC} °C (${rising ? 'ascending' : 'descending'}). */`);
  lines.push(`static const ${type} ${prefix}_table[${P}_TABLE_LEN] = {`);
  for (let i = 0; i < n; i += 8) {
    const chunk = rows.slice(i, i + 8).map((r) => String(r.code).padStart(Math.max(4, String(2 ** bits - 1).length)));
    lines.push(`    ${chunk.join(',')},`);
  }
  lines.push('};');
  lines.push('');
  lines.push('/* Raw ADC code → temperature in 0.1 °C, linear interpolation, clamped to the table range. */');
  lines.push(`int32_t ${prefix}_code_to_temp_x10(${type} code)`);
  lines.push('{');
  const cmpFirst = rising ? '<=' : '>=';
  const cmpLast = rising ? '>=' : '<=';
  lines.push(`    if (code ${cmpFirst} ${prefix}_table[0]) return ${P}_T0_X10;`);
  lines.push(`    if (code ${cmpLast} ${prefix}_table[${P}_TABLE_LEN - 1])`);
  lines.push(`        return ${P}_T0_X10 + (${P}_TABLE_LEN - 1) * ${P}_STEP_X10;`);
  lines.push('    /* Binary search for the segment [lo, lo + 1] containing code. */');
  lines.push(`    uint32_t lo = 0, hi = ${P}_TABLE_LEN - 1;`);
  lines.push('    while (hi - lo > 1) {');
  lines.push('        uint32_t mid = (lo + hi) / 2;');
  lines.push(`        if (${prefix}_table[mid] ${rising ? '<=' : '>='} code) lo = mid; else hi = mid;`);
  lines.push('    }');
  lines.push(`    int32_t c0 = (int32_t)${prefix}_table[lo], c1 = (int32_t)${prefix}_table[hi];`);
  lines.push(`    int32_t t = ${P}_T0_X10 + (int32_t)lo * ${P}_STEP_X10;`);
  lines.push('    if (c1 == c0) return t;');
  lines.push(`    return t + (((int32_t)code - c0) * ${P}_STEP_X10 + (c1 - c0) / 2) / (c1 - c0);`);
  lines.push('}');
  return lines.join('\n');
}

// ---------- I²C pull-up resistor (NXP UM10204 rev. 7.0, 1 October 2021) ----------

export type I2cMode = 'standard' | 'fast' | 'fastplus';

export interface I2cModeSpec {
  label: string;
  /** Maximum SCL clock frequency, Hz. */
  fScl: number;
  /** Maximum rise time tr of SDA/SCL (30 % → 70 % VDD), s. UM10204 Table 11. */
  trMax: number;
  /** Minimum LOW-level output current at VOL = 0.4 V, A. UM10204 Table 10. */
  iol: number;
  /** Maximum capacitive load per bus line Cb, F. UM10204 Table 11. */
  cbMax: number;
}

export const I2C_MODES: Record<I2cMode, I2cModeSpec> = {
  standard: { label: 'Standard-mode', fScl: 100e3, trMax: 1000e-9, iol: 3e-3, cbMax: 400e-12 },
  fast: { label: 'Fast-mode', fScl: 400e3, trMax: 300e-9, iol: 3e-3, cbMax: 400e-12 },
  fastplus: { label: 'Fast-mode Plus', fScl: 1e6, trMax: 120e-9, iol: 20e-3, cbMax: 550e-12 },
};

/**
 * Rise-time factor: t(0.7·VDD) − t(0.3·VDD) = RC·ln(0.7/0.3) = 0.8473·RC, the value used in
 * UM10204 §7.1 equation (1).
 */
export const I2C_RISE_FACTOR = 0.8473;

/** Maximum capacitance of each I/O pin Ci, F (UM10204 Table 10, all three modes). */
export const I2C_PIN_CAPACITANCE_MAX = 10e-12;

export interface I2cLowLevel {
  /** VOL(max) used for Rp(min), V. */
  vol: number;
  /** Sink current at that VOL, A. */
  iol: number;
  /** True when VDD ≤ 2 V and the VOL2 row (0.2·VDD at 2 mA) applies. */
  lowVoltage: boolean;
}

/**
 * Low-level output condition (UM10204 Table 10): VOL1 = 0.4 V at the mode's IOL when VDD > 2 V;
 * VOL2 = 0.2·VDD at 2 mA sink current when VDD ≤ 2 V (specified for Fast-mode and Fast-mode Plus;
 * "n/a" for Standard-mode, where we apply the same condition).
 */
export function i2cLowLevel(vdd: number, mode: I2cMode): I2cLowLevel {
  if (vdd <= 2) return { vol: 0.2 * vdd, iol: 2e-3, lowVoltage: true };
  return { vol: 0.4, iol: I2C_MODES[mode].iol, lowVoltage: false };
}

/** Rp(min) = (VDD − VOL(max)) / IOL — UM10204 §7.1 equation (2). */
export function i2cRpMin(vdd: number, mode: I2cMode): number {
  const { vol, iol } = i2cLowLevel(vdd, mode);
  return (vdd - vol) / iol;
}

/** Rp(max) = tr / (0.8473 · Cb) — UM10204 §7.1 equation (1). */
export function i2cRpMax(cb: number, mode: I2cMode): number {
  return I2C_MODES[mode].trMax / (I2C_RISE_FACTOR * cb);
}

/** 30 % → 70 % rise time with pull-up r and bus capacitance cb. */
export function i2cRiseTime(r: number, cb: number): number {
  return I2C_RISE_FACTOR * r * cb;
}

export interface I2cCheck {
  rpMin: number;
  rpMax: number;
  /** False when Rp(min) > Rp(max): no resistor meets both limits. */
  feasible: boolean;
  capacitanceOk: boolean;
  low: I2cLowLevel;
  /** Present when a resistor was given. */
  resistor?: {
    r: number;
    riseTime: number;
    /** Current the driver must sink to hold the line at VOL(max): (VDD − VOL) / R. */
    sinkCurrent: number;
    riseOk: boolean;
    sinkOk: boolean;
    /** Static current while the line is held at 0 V: VDD / R (one line). */
    lowCurrent: number;
  };
}

export function i2cCheck(vdd: number, cb: number, mode: I2cMode, r?: number): I2cCheck {
  const rpMin = i2cRpMin(vdd, mode);
  const rpMax = i2cRpMax(cb, mode);
  const low = i2cLowLevel(vdd, mode);
  const out: I2cCheck = {
    rpMin,
    rpMax,
    feasible: rpMin <= rpMax,
    capacitanceOk: cb <= I2C_MODES[mode].cbMax * (1 + 1e-12),
    low,
  };
  if (r !== undefined && r > 0) {
    const riseTime = i2cRiseTime(r, cb);
    const sinkCurrent = (vdd - low.vol) / r;
    out.resistor = {
      r,
      riseTime,
      sinkCurrent,
      riseOk: riseTime <= I2C_MODES[mode].trMax * (1 + 1e-12),
      sinkOk: sinkCurrent <= low.iol * (1 + 1e-12),
      lowCurrent: vdd / r,
    };
  }
  return out;
}
