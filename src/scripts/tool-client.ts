// Browser-side helpers shared by every tool page. Calculation logic lives in src/lib/;
// this file only wires the DOM: reading inputs, URL sync, showing results and errors.
import { readParams, writeParams, type Values } from '../lib/url-state';

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function fields(form: HTMLFormElement): Field[] {
  return Array.from(form.elements).filter(
    (el): el is Field =>
      (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) &&
      el.name !== '',
  );
}

/** Current values of all named controls. Checkboxes are "1" / "0"; radios give the checked value. */
export function collect(form: HTMLFormElement): Values {
  const out: Values = {};
  for (const el of fields(form)) {
    if (el instanceof HTMLInputElement && el.type === 'checkbox') out[el.name] = el.checked ? '1' : '0';
    else if (el instanceof HTMLInputElement && el.type === 'radio') {
      if (el.checked) out[el.name] = el.value;
      else if (!(el.name in out)) out[el.name] = '';
    } else out[el.name] = el.value;
  }
  return out;
}

/** Set controls from a values object (e.g. restored from the URL). */
export function apply(form: HTMLFormElement, values: Values): void {
  for (const el of fields(form)) {
    const v = values[el.name];
    if (v === undefined) continue;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = v === '1';
    else if (el instanceof HTMLInputElement && el.type === 'radio') el.checked = el.value === v;
    else el.value = v;
  }
}

export interface BindOptions {
  /** Keys whose value should not be written to the URL (e.g. large text areas). Default none. */
  skipUrl?: string[];
}

/**
 * Wire a tool form: restore inputs from the query string, recompute on every change and keep
 * the URL in sync. `update` receives all current values as strings and should render results.
 * Use one bindForm per page: each call rewrites the whole query string.
 * Returns a function that forces a recompute (call it after changing inputs programmatically).
 */
export function bindForm(
  formOrId: HTMLFormElement | string,
  update: (values: Values) => void,
  options: BindOptions = {},
): () => void {
  const form = typeof formOrId === 'string' ? (document.getElementById(formOrId) as HTMLFormElement | null) : formOrId;
  if (!form) throw new Error(`bindForm: form not found: ${String(formOrId)}`);

  const defaults = collect(form);
  // Fields marked data-no-url (or listed in skipUrl) are still passed to update(), just never put in the URL.
  const noUrl = fields(form).filter((el) => el.hasAttribute('data-no-url')).map((el) => el.name);
  for (const key of [...noUrl, ...(options.skipUrl ?? [])]) delete defaults[key];
  apply(form, readParams(location.search, defaults));

  let urlTimer: number | undefined;
  const run = () => {
    const values = collect(form);
    try {
      update(values);
    } catch (err) {
      console.error(err);
    }
    window.clearTimeout(urlTimer);
    urlTimer = window.setTimeout(() => {
      const query = writeParams(values, defaults);
      history.replaceState(null, '', `${location.pathname}${query}${location.hash}`);
    }, 250);
  };

  form.addEventListener('input', run);
  form.addEventListener('change', run);
  form.addEventListener('submit', (e) => e.preventDefault());
  run();
  return run;
}

// Results only flash after the first render, so a page load doesn't light everything up.
const flashAfter = performance.now() + 800;

function flash(el: HTMLElement): void {
  if (performance.now() < flashAfter || el.closest('pre')) return;
  el.classList.remove('is-updated');
  void el.offsetWidth; // restart the animation
  el.classList.add('is-updated');
}

/** Write text into every element marked data-result="name". Changed values briefly light up. */
export function setResult(name: string, text: string): void {
  document.querySelectorAll<HTMLElement>(`[data-result="${name}"]`).forEach((el) => {
    if (el.textContent === text) return;
    el.textContent = text;
    flash(el);
  });
}

/** Clear a set of results to an em dash (used when inputs are invalid). */
export function clearResults(...names: string[]): void {
  for (const n of names) setResult(n, '—');
}

/**
 * Show or clear the inline error for an input. Passing null clears it.
 * Returns true when there is an error, so callers can write `if (setError(...)) return;`.
 */
export function setError(name: string, message: string | null): boolean {
  document.querySelectorAll<HTMLElement>(`[data-error-for="${name}"]`).forEach((el) => {
    el.textContent = message ?? '';
  });
  document.querySelectorAll<HTMLElement>(`[name="${name}"]`).forEach((el) => {
    if (message) el.setAttribute('aria-invalid', 'true');
    else el.removeAttribute('aria-invalid');
  });
  return message !== null;
}

/** Show or hide an element by id (uses the hidden attribute). */
export function show(id: string, visible: boolean): void {
  const el = document.getElementById(id);
  if (el) el.hidden = !visible;
}

/** Escape text for safe insertion with innerHTML. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
