# BitBench

*Precision calculators for embedded systems engineers.*

A free, fast, ad-free website of calculators for embedded systems engineers: LTE-M/NB-IoT PSM & eDRX timers,
LoRa airtime, STM32 timers, UART baud rates, CRC, IEEE-754, fixed-point, ADC, NTC, I²C pull-ups and more.
Everything runs in the browser. There's no backend, no database, no cookies and no tracking.

- Static site built with [Astro](https://astro.build), all calculation logic in TypeScript
- Every formula lives in a pure, unit-tested module in `src/lib/` ([Vitest](https://vitest.dev))
- Every tool has its own URL, and its inputs are mirrored in the query string so results can be shared
- Works offline after the first visit (service worker), light and dark themes

## Local development

Requires Node.js 22.12 or newer.

```sh
npm install
npm run dev        # http://localhost:4321/bitbench/
npm test           # run all unit tests once
npm run test:watch # re-run tests on change
npm run build      # static site in dist/
npm run preview    # serve dist/ locally
```

## Licence

Code: MIT. Content (explanations): CC BY 4.0. Replace with your preference.
