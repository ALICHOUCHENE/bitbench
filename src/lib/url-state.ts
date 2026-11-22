// Mirror tool inputs in the URL query string so a result can be shared by copying the link.
// Only keys present in `defaults` are read or written, and values equal to their default are
// left out to keep links short.

export type Values = Record<string, string>;

/** Read known keys from a query string, falling back to defaults. */
export function readParams(search: string, defaults: Values): Values {
  const params = new URLSearchParams(search);
  const out: Values = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const v = params.get(key);
    if (v !== null) out[key] = v;
  }
  return out;
}

/** Build a query string ("?a=1&b=2", or "" when everything is default). */
export function writeParams(values: Values, defaults: Values): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(defaults)) {
    const v = values[key];
    if (v !== undefined && v !== defaults[key]) params.set(key, v);
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}
