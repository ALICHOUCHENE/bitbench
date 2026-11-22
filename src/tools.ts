// Single source of truth for every tool: drives the homepage directory, page titles,
// meta descriptions and navigation. Add a tool here, then create src/pages/tools/<slug>.astro.

export type Category = 'timing' | 'binary' | 'wireless' | 'analog';

export const CATEGORIES: { id: Category; label: string; blurb: string }[] = [
  { id: 'wireless', label: 'Networking & IoT', blurb: 'LTE-M / NB-IoT power saving, power budget and AT responses, LoRa / LoRaWAN airtime and link budget.' },
  { id: 'timing', label: 'Timing & MCU', blurb: 'Timer prescalers, PWM, UART baud rates, SPI clocks, I²C and CAN bit timing, and watchdogs.' },
  { id: 'binary', label: 'Binary & Data', blurb: 'Number formats, bit fields, checksums and byte order.' },
  { id: 'analog', label: 'Analog & Power', blurb: 'ADC inputs, sensors, filters, pull-ups and battery life.' },
];

export interface ToolMeta {
  slug: string;
  /** Short name used in the directory and <h1>. */
  name: string;
  /** Full <title> (without the site name suffix). Written for search. */
  title: string;
  /** One sentence. Used as the page lede and meta description. */
  description: string;
  category: Category;
  /** Extra search terms for the homepage filter. */
  keywords: string[];
}

export const TOOLS: ToolMeta[] = [
  {
    slug: 'psm-edrx',
    name: 'LTE PSM & eDRX',
    title: 'LTE-M / NB-IoT PSM & eDRX Timer Calculator (T3412, T3324, AT+CPSMS)',
    description:
      'Encode and decode T3412 extended, T3324 and eDRX/PTW timers for LTE-M and NB-IoT, with ready-to-paste AT+CPSMS and AT+CEDRXS commands.',
    category: 'wireless',
    keywords: ['psm', 'edrx', 't3412', 't3324', 'tau', 'active time', 'ptw', 'cpsms', 'cedrxs', 'nb-iot', 'lte-m', 'cat-m1', '3gpp', 'power saving'],
  },
  {
    slug: 'lte-power',
    name: 'LTE-M Power Budget',
    title: 'LTE-M / NB-IoT Power Budget & Battery Life Calculator (PSM, eDRX, RAI)',
    description:
      'Estimate average current and battery life of an LTE-M or NB-IoT device from its report interval, PSM and eDRX timers, RRC inactivity, repetitions and module currents.',
    category: 'wireless',
    keywords: ['lte-m', 'nb-iot', 'cat-m1', 'power budget', 'battery life', 'average current', 'psm', 'edrx', 'rai', 'release assistance', 'rrc inactivity', 'tau', 'paging', 'drx', 'coverage enhancement', 'repetitions', 'cellular iot'],
  },
  {
    slug: 'at-decoder',
    name: 'AT Response Decoder',
    title: '3GPP AT Command Response Decoder (+CEREG, +CESQ, +COPS, +CME ERROR)',
    description:
      'Paste a cellular modem log and decode every 3GPP TS 27.007 response, URC and error code: registration, signal, PSM/eDRX timers, PDP contexts and more.',
    category: 'wireless',
    keywords: ['at command', 'at commands', '27.007', 'cereg', 'creg', 'cesq', 'csq', 'cops', 'cscon', 'cgdcont', 'cgpaddr', 'cgev', 'cme error', 'emm cause', 'reject cause', 'rsrp', 'rsrq', 'urc', 'modem log', 'lte-m', 'nb-iot', 'cellular'],
  },
  {
    slug: 'lora-toa',
    name: 'LoRa Time-on-Air',
    title: 'LoRa Time-on-Air, Duty Cycle & LoRaWAN Payload Calculator',
    description:
      'Compute LoRa packet airtime from SF, bandwidth and coding rate, plus duty-cycle off time, messages per day and LoRaWAN max payload per region.',
    category: 'wireless',
    keywords: ['lora', 'lorawan', 'airtime', 'toa', 'spreading factor', 'duty cycle', 'eu868', 'us915', 'as923', 'au915', 'kr920', 'in865', 'ldro', 'dwell time', 'semtech', 'sx1276', 'fair use'],
  },
  {
    slug: 'lora-link',
    name: 'LoRa Link Budget',
    title: 'LoRa Link Budget & Range Calculator (Sensitivity, Okumura-Hata, Free Space)',
    description:
      'Compute LoRa receiver sensitivity, maximum path loss and estimated range from SF, bandwidth, TX power, antennas and losses, with Okumura-Hata, free-space and log-distance models.',
    category: 'wireless',
    keywords: ['lora', 'lorawan', 'link budget', 'range', 'sensitivity', 'path loss', 'mapl', 'rssi', 'snr', 'noise floor', 'noise figure', 'eirp', 'erp', 'okumura-hata', 'hata', 'free space', 'fspl', 'fresnel', 'radio horizon', 'fade margin', 'antenna gain', 'gateway', 'sx1276'],
  },
  {
    slug: 'mcu-timer',
    name: 'MCU Timer',
    title: 'STM32 Timer Prescaler & ARR Calculator (PWM Frequency)',
    description:
      'Find the prescaler and auto-reload values that hit a target timer frequency with the smallest error, and convert PWM duty cycle to CCR.',
    category: 'timing',
    keywords: ['stm32', 'timer', 'prescaler', 'psc', 'arr', 'pwm', 'ccr', 'frequency', 'period', 'auto-reload'],
  },
  {
    slug: 'uart-baud',
    name: 'UART Baud Rate',
    title: 'UART Baud Rate Error Calculator (STM32 USARTDIV, AVR UBRR)',
    description:
      'Compute the USART divider for a clock and baud rate, the actual baud rate achieved and its error, for STM32 and AVR.',
    category: 'timing',
    keywords: ['uart', 'usart', 'baud', 'brr', 'usartdiv', 'ubrr', 'u2x', 'avr', 'stm32', 'oversampling', 'serial'],
  },
  {
    slug: 'spi-timing',
    name: 'SPI Clock & Modes',
    title: 'SPI Clock, Mode (CPOL/CPHA) & Transfer Time Calculator (STM32 BR Prescaler)',
    description:
      'Pick the SPI prescaler for a slave’s maximum clock, check the read and write timing budget, see the CPOL/CPHA timing diagram and compute transfer time and throughput.',
    category: 'timing',
    keywords: ['spi', 'sck', 'cpol', 'cpha', 'spi mode', 'mode 0', 'mode 3', 'prescaler', 'baud rate prescaler', 'br', 'spi_cr1', 'miso', 'mosi', 'chip select', 'throughput', 'transfer time', 'setup time', 'stm32', 'flash'],
  },
  {
    slug: 'i2c-timing',
    name: 'STM32 I²C Timing',
    title: 'STM32 I2C TIMINGR Calculator (PRESC, SCLL, SCLH, SDADEL, SCLDEL)',
    description:
      'Compute the STM32 I2C_TIMINGR value for any I2C clock, speed mode, rise and fall time and filter setting, checked against the I²C-bus specification, or decode an existing one.',
    category: 'timing',
    keywords: ['i2c', 'i²c', 'timingr', 'i2c_timingr', 'presc', 'scll', 'sclh', 'sdadel', 'scldel', 'stm32', 'cubemx', 'standard mode', 'fast mode', 'fast mode plus', 'rise time', 'analog filter', 'dnf', 'scl frequency', 'an4235'],
  },
  {
    slug: 'can-timing',
    name: 'CAN Bit Timing',
    title: 'CAN Bit Timing Calculator (STM32 bxCAN BTR, FDCAN NBTP / DBTP, Sample Point)',
    description:
      'Find the prescaler, time segments and SJW for a CAN or CAN FD bit rate and sample point, with the STM32 CAN_BTR or FDCAN_NBTP/DBTP value, bus-length and oscillator-tolerance checks.',
    category: 'timing',
    keywords: ['can', 'can fd', 'canfd', 'bit timing', 'bit rate', 'baud rate', 'sample point', 'btr', 'can_btr', 'bxcan', 'fdcan', 'nbtp', 'dbtp', 'tdc', 'tseg1', 'tseg2', 'sjw', 'time quantum', 'prescaler', 'propagation delay', 'oscillator tolerance', 'canopen', 'j1939', 'stm32'],
  },
  {
    slug: 'watchdog',
    name: 'STM32 Watchdog',
    title: 'STM32 Watchdog Timeout Calculator (IWDG Prescaler & Reload, WWDG Window)',
    description:
      'Find the IWDG prescaler, reload and window values for a target timeout, see how far LSI tolerance moves it, and set up the WWDG counter, window and early wakeup.',
    category: 'timing',
    keywords: ['watchdog', 'iwdg', 'wwdg', 'stm32', 'timeout', 'prescaler', 'reload', 'rlr', 'winr', 'window', 'wdgtb', 'ewi', 'early wakeup', 'lsi', 'independent watchdog', 'window watchdog', 'refresh', 'kick'],
  },
  {
    slug: 'binary',
    name: 'Binary / Hex Toolkit',
    title: 'Binary, Hex & Bit-Field Register Calculator',
    description:
      'Convert between decimal, hex, binary and octal at 8 to 64 bits, toggle individual bits, apply bitwise operations and generate C bit masks.',
    category: 'binary',
    keywords: ['binary', 'hex', 'octal', 'decimal', 'twos complement', 'bitwise', 'mask', 'register', 'bit field', 'shift', 'rotate'],
  },
  {
    slug: 'crc',
    name: 'CRC Calculator',
    title: 'CRC-8, CRC-16, CRC-32 Calculator & C Lookup Table Generator',
    description:
      'Compute any CRC-8/16/32/64 from 36 catalogue presets or custom parameters, identify an unknown CRC, and generate a C lookup table.',
    category: 'binary',
    keywords: ['crc', 'crc8', 'crc16', 'crc32', 'ccitt', 'modbus', 'xmodem', 'checksum', 'polynomial', 'lookup table'],
  },
  {
    slug: 'float',
    name: 'IEEE-754 Float',
    title: 'IEEE-754 Float Converter (float32 / float64 to Hex)',
    description:
      'Convert float32 and float64 to and from hex, with sign, exponent and mantissa bits, the exact stored value, rounding error and NaN/subnormal decoding.',
    category: 'binary',
    keywords: ['ieee754', 'ieee 754', 'float', 'double', 'float32', 'float64', 'hex', 'mantissa', 'exponent', 'nan', 'denormal'],
  },
  {
    slug: 'fixed-point',
    name: 'Fixed-Point (Q format)',
    title: 'Fixed-Point Q Format Converter (Qm.n)',
    description:
      'Convert between real numbers and Qm.n fixed-point integers, with range, resolution, quantization error and saturation.',
    category: 'binary',
    keywords: ['fixed point', 'q format', 'q15', 'q31', 'q7', 'qm.n', 'dsp', 'quantization', 'saturation'],
  },
  {
    slug: 'bytes',
    name: 'Bytes & Endianness',
    title: 'Byte Swap, Endianness & Hex to C Array Converter',
    description:
      'Swap byte order, convert hex dumps to C arrays and back, and view a value as big- and little-endian bytes.',
    category: 'binary',
    keywords: ['endianness', 'byte swap', 'big endian', 'little endian', 'hex dump', 'c array', 'uint8_t', 'bswap'],
  },
  {
    slug: 'ascii',
    name: 'ASCII Table',
    title: 'ASCII Table with Hex, Decimal, Binary & C Escape Codes',
    description: 'The full 7-bit ASCII table with decimal, hex, octal, binary, control-character names and C escape sequences.',
    category: 'binary',
    keywords: ['ascii', 'table', 'character', 'escape', 'control', 'hex', 'char'],
  },
  {
    slug: 'battery-life',
    name: 'Battery Life',
    title: 'Battery Life Estimator for Low-Power Devices',
    description:
      'Estimate average current and battery lifetime from a cycle of sleep, active and transmit states, including self-discharge.',
    category: 'analog',
    keywords: ['battery', 'lifetime', 'average current', 'mah', 'sleep', 'low power', 'duty cycle', 'self-discharge', 'iot'],
  },
  {
    slug: 'adc',
    name: 'ADC & Voltage Divider',
    title: 'ADC Counts to Voltage & Voltage Divider Calculator',
    description:
      'Convert ADC counts to voltage and back, find the resolution per LSB and size a resistor divider for an ADC input.',
    category: 'analog',
    keywords: ['adc', 'voltage divider', 'resolution', 'lsb', 'counts', 'vref', 'resistor', 'input impedance'],
  },
  {
    slug: 'rc-filter',
    name: 'RC Filter',
    title: 'RC Low-Pass / High-Pass Filter Cutoff Calculator',
    description:
      'Compute the cutoff frequency, time constant and attenuation of a first-order RC low-pass or high-pass filter.',
    category: 'analog',
    keywords: ['rc filter', 'low pass', 'high pass', 'cutoff', 'corner frequency', 'time constant', 'tau', '-3db'],
  },
  {
    slug: 'ntc',
    name: 'NTC Thermistor',
    title: 'NTC Thermistor Calculator (Beta & Steinhart-Hart)',
    description:
      'Convert NTC thermistor resistance to temperature and back with the Beta or Steinhart-Hart model, and compute the divider voltage.',
    category: 'analog',
    keywords: ['ntc', 'thermistor', 'beta', 'steinhart-hart', 'temperature', 'resistance', 'b25/85', '10k'],
  },
  {
    slug: 'i2c-pullup',
    name: 'I²C Pull-up',
    title: 'I²C Pull-up Resistor Calculator (Standard, Fast, Fast-mode Plus)',
    description:
      'Compute the minimum and maximum I²C pull-up resistor values from supply voltage, bus capacitance and speed mode.',
    category: 'analog',
    keywords: ['i2c', 'iic', 'pull-up', 'pullup', 'resistor', 'bus capacitance', 'rise time', 'fast mode', 'sda', 'scl'],
  },
];

export function getTool(slug: string): ToolMeta {
  const tool = TOOLS.find((t) => t.slug === slug);
  if (!tool) throw new Error(`Unknown tool slug: ${slug}`);
  return tool;
}
