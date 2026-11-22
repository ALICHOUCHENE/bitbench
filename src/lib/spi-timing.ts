// SPI clock prescaler, modes (CPOL/CPHA), transfer time and maximum clock from signal timing.
// Pure functions. Frequencies in hertz, times in seconds.
//
// Sources: ST RM0090 §28.3 and §28.5.1 (SPI_CR1 BR[2:0], CPOL, CPHA), the same layout in the other
// STM32 reference manuals; Motorola/NXP SPI Block Guide V04.01 (clock phase and polarity);
// datasheet AC timing tables (tv, tsu, th) for the read and write timing budgets.

export type PrescalerFamily = 'stm32' | 'integer';

/** STM32 SPI_CR1 BR[2:0]: fPCLK / 2^(BR + 1), divider 2 … 256. */
export const STM32_DIVIDERS = [2, 4, 8, 16, 32, 64, 128, 256] as const;
export const INTEGER_DIV_MIN = 2;
export const INTEGER_DIV_MAX = 65_536;

export interface SpiClock {
  /** Divider from the peripheral clock to SCK. */
  div: number;
  /** STM32 BR[2:0] value, or null for the integer family. */
  br: number | null;
  sck: number;
}

/** Every STM32 prescaler setting with its SCK. */
export function stm32Options(clock: number): SpiClock[] {
  return STM32_DIVIDERS.map((div, br) => ({ div, br, sck: clock / div }));
}

/**
 * Fastest SCK that does not exceed `maxSck`. Returns null when even the largest divider is too fast.
 * STM32: the smallest power-of-two divider ≥ clock / maxSck. Integer: ceil(clock / maxSck).
 */
export function pickClock(clock: number, maxSck: number, family: PrescalerFamily): SpiClock | null {
  const ideal = clock / maxSck;
  if (family === 'stm32') {
    const br = STM32_DIVIDERS.findIndex((d) => d >= ideal * (1 - 1e-12));
    return br < 0 ? null : { div: STM32_DIVIDERS[br], br, sck: clock / STM32_DIVIDERS[br] };
  }
  const div = Math.max(INTEGER_DIV_MIN, Math.ceil(ideal * (1 - 1e-12)));
  return div > INTEGER_DIV_MAX ? null : { div, br: null, sck: clock / div };
}

// ── Modes ──────────────────────────────────────────────────────────────────────────

export type SpiModeNumber = 0 | 1 | 2 | 3;
export type Edge = 'rising' | 'falling';

export interface SpiMode {
  mode: SpiModeNumber;
  cpol: 0 | 1;
  cpha: 0 | 1;
  /** SCK level while idle. */
  idle: 'low' | 'high';
  /** Edge on which both sides sample. */
  sample: Edge;
  /** Edge on which both sides change data. */
  shift: Edge;
}

export function spiMode(mode: SpiModeNumber): SpiMode {
  const cpol = (mode >> 1) as 0 | 1;
  const cpha = (mode & 1) as 0 | 1;
  // Leading edge is rising when idle low. CPHA = 0 samples on the leading edge, CPHA = 1 on the trailing one.
  const leading: Edge = cpol === 0 ? 'rising' : 'falling';
  const trailing: Edge = cpol === 0 ? 'falling' : 'rising';
  return {
    mode,
    cpol,
    cpha,
    idle: cpol === 0 ? 'low' : 'high',
    sample: cpha === 0 ? leading : trailing,
    shift: cpha === 0 ? trailing : leading,
  };
}

export const SPI_MODES: SpiMode[] = ([0, 1, 2, 3] as const).map(spiMode);

// ── Transfer time ──────────────────────────────────────────────────────────────────

export interface TransferParams {
  sck: number;
  /** Bits per frame (data size), 4–32. */
  frameBits: number;
  /** Number of frames in one chip-select assertion. */
  frames: number;
  /** Idle time between frames, s (0 for back-to-back DMA). */
  gap: number;
  /** CS asserted → first SCK edge, s. */
  csSetup: number;
  /** Last SCK edge → CS released, s. */
  csHold: number;
}

export interface TransferResult {
  /** Time spent clocking bits, s. */
  clockTime: number;
  /** Total CS-low time, s. */
  total: number;
  /** Payload bits per second over the whole transaction. */
  throughput: number;
  /** Fraction of the transaction spent clocking data (0–1). */
  efficiency: number;
}

export function transferTime(p: TransferParams): TransferResult {
  const bits = p.frameBits * p.frames;
  const clockTime = bits / p.sck;
  const total = p.csSetup + clockTime + Math.max(0, p.frames - 1) * p.gap + p.csHold;
  return { clockTime, total, throughput: bits / total, efficiency: clockTime / total };
}

// ── Signal timing ──────────────────────────────────────────────────────────────────

export interface SignalTiming {
  /** Slave: MISO valid after the shift edge, s (tv / tCLQV in datasheets). */
  slaveTv: number;
  /** Slave: MOSI set-up before the sample edge, s. */
  slaveTsu: number;
  /** Master: MISO set-up before its sample edge, s. */
  masterTsu: number;
  /** Master: MOSI valid after the shift edge, s. */
  masterTv: number;
  /** One-way propagation delay over the board and any buffers, s. */
  tpd: number;
}

export interface SignalLimits {
  /** Highest SCK for reads (MISO path), Hz. */
  fRead: number;
  /** Highest SCK for writes (MOSI path), Hz. */
  fWrite: number;
}

/**
 * With a 50 % duty clock, data launched on one edge must be sampled on the opposite edge half a
 * period later.
 * Read:  SCK travels to the slave (tpd), MISO comes back (tpd): T/2 ≥ tv(slave) + 2·tpd + tsu(master).
 * Write: SCK and MOSI travel together, so the board delay cancels: T/2 ≥ tv(master) + tsu(slave).
 */
export function signalLimits(s: SignalTiming): SignalLimits {
  const read = s.slaveTv + 2 * s.tpd + s.masterTsu;
  const write = s.masterTv + s.slaveTsu;
  return { fRead: read > 0 ? 1 / (2 * read) : Infinity, fWrite: write > 0 ? 1 / (2 * write) : Infinity };
}

/** Board propagation delay: about 6–7 ps/mm on FR-4 (εr,eff ≈ 3.3–4.3). */
export const FR4_DELAY_S_PER_M = 6.7e-9;

// ── Diagram ──────────────────────────────────────────────────────────────────────

/**
 * SVG timing diagram for one 8-bit frame, MSB first: CS, SCK, MOSI, MISO, with the sample edges
 * marked. Colours come from CSS custom properties so the diagram follows the theme.
 */
export function spiDiagramSvg(mode: SpiModeNumber, bits = 8): string {
  const m = spiMode(mode);
  const W = 640;
  const left = 88;
  const lineStart = 52; // signal traces start right of the row names
  const h = (W - left - 24) / (2 * bits + 2); // half period
  const start = left + h; // first SCK edge
  const end = start + 2 * bits * h + h; // CS release
  const rows = { cs: 22, sck: 70, mosi: 118, miso: 166 };
  const amp = 14;
  const hi = (y: number) => y - amp;
  const lo = (y: number) => y + amp;

  const lead = (k: number) => start + 2 * k * h;
  const trail = (k: number) => start + 2 * k * h + h;

  // CS: high, falls at `left`, rises at `end`.
  const cs = `M${lineStart} ${hi(rows.cs)} H${left} V${lo(rows.cs)} H${end} V${hi(rows.cs)} H${W - 4}`;

  // SCK
  const idleY = m.cpol === 0 ? lo(rows.sck) : hi(rows.sck);
  const activeY = m.cpol === 0 ? hi(rows.sck) : lo(rows.sck);
  let sck = `M${lineStart} ${idleY}`;
  for (let k = 0; k < bits; k++) sck += ` H${lead(k)} V${activeY} H${trail(k)} V${idleY}`;
  sck += ` H${W - 4}`;

  // Data windows: [from, to] per bit.
  const windows: [number, number][] = [];
  for (let k = 0; k < bits; k++) {
    if (m.cpha === 0) windows.push([k === 0 ? left : trail(k - 1), trail(k)]);
    else windows.push([lead(k), k === bits - 1 ? trail(k) + h / 2 : lead(k + 1)]);
  }

  const bus = (y: number) => {
    const s = 4; // crossover slant
    let d = '';
    let text = '';
    const [first] = windows[0];
    const [, last] = windows[bits - 1];
    d += `M${lineStart} ${y} H${first}`;
    d += ` M${last} ${y} H${W - 4}`;
    windows.forEach(([a, b], i) => {
      d += ` M${a} ${y} L${a + s} ${hi(y) + 4} H${b - s} L${b} ${y} L${b - s} ${lo(y) - 4} H${a + s} Z`;
      text += `<text x="${(a + b) / 2}" y="${y + 4}" text-anchor="middle">${bits - 1 - i}</text>`;
    });
    return `<path d="${d}" class="sd-sig" />${text}`;
  };

  let samples = '';
  for (let k = 0; k < bits; k++) {
    const x = m.cpha === 0 ? lead(k) : trail(k);
    samples += `<line x1="${x}" y1="${rows.sck - amp - 6}" x2="${x}" y2="${rows.miso + amp + 6}" class="sd-sample" />`;
  }

  const label = (y: number, t: string) => `<text x="4" y="${y + 4}" class="sd-name">${t}</text>`;
  const f = (n: number) => Math.round(n * 10) / 10;
  const svg =
    `<svg viewBox="0 0 ${W} 196" role="img" aria-label="SPI mode ${mode} timing: CPOL ${m.cpol}, CPHA ${m.cpha}, data sampled on the ${m.sample} edge" class="spi-diagram">` +
    samples +
    label(rows.cs, 'CS') +
    label(rows.sck, 'SCK') +
    label(rows.mosi, 'MOSI') +
    label(rows.miso, 'MISO') +
    `<path d="${cs}" class="sd-sig" /><path d="${sck}" class="sd-sig sd-clk" />` +
    bus(rows.mosi) +
    bus(rows.miso) +
    `</svg>`;
  // Round every coordinate to one decimal to keep the markup small.
  return svg.replace(/(\d+\.\d{2,})/g, (s) => String(f(Number(s))));
}
