// Site-wide behaviour loaded on every page: theme toggle, copy buttons, offline support.

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function flash(btn: HTMLElement, label: string) {
  const original = btn.dataset.label ?? btn.textContent ?? '';
  btn.dataset.label = original;
  btn.textContent = label;
  btn.setAttribute('data-copied', '');
  window.setTimeout(() => {
    btn.textContent = original;
    btn.removeAttribute('data-copied');
  }, 1400);
}

// Copy buttons: data-copy="<css selector>" copies that element's text,
// data-copy-text="..." copies a literal, data-copy-link copies the current URL.
document.addEventListener('click', async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-copy], [data-copy-text], [data-copy-link]');
  if (!btn) return;
  e.preventDefault();
  let text = '';
  if (btn.hasAttribute('data-copy-link')) text = location.href;
  else if (btn.dataset.copyText !== undefined) text = btn.dataset.copyText;
  else {
    const target = document.querySelector<HTMLElement>(btn.dataset.copy!);
    text = target ? (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target.value : target.textContent ?? '') : '';
  }
  text = text.trim();
  if (!text || text === '—') return;
  flash(btn, (await copyText(text)) ? 'Copied' : 'Copy failed');
});

// Theme toggle. The initial theme is applied by an inline script in <head> to avoid a flash.
const toggle = document.getElementById('theme-toggle');
toggle?.addEventListener('click', () => {
  toggle.classList.remove('is-spinning');
  void toggle.offsetWidth;
  toggle.classList.add('is-spinning');
  const root = document.documentElement;
  const current = root.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  toggle.setAttribute('aria-pressed', String(next === 'dark'));
  try {
    localStorage.setItem('theme', next);
  } catch {
    /* storage unavailable: theme lasts for this page only */
  }
});

// Fade cards in as they scroll into view, staggered within each group. Cards that are already
// on screen when this script runs are left alone, so the first paint never blinks.
const REVEAL = '.cat, .panel, details.howto, .explainer, .refs, .about-card, .author';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const revealTargets = reduceMotion
  ? []
  : Array.from(document.querySelectorAll<HTMLElement>(REVEAL)).filter(
      (el) => el.getBoundingClientRect().top > window.innerHeight && !el.parentElement?.closest(REVEAL),
    );
if ('IntersectionObserver' in window && revealTargets.length) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target as HTMLElement;
        el.classList.add('is-in');
        io.unobserve(el);
        // Drop the transition styles afterwards so they never interfere with hover effects.
        window.setTimeout(() => {
          el.removeAttribute('data-reveal');
          el.classList.remove('is-in');
          el.style.removeProperty('--reveal-delay');
        }, 900);
      }
    },
    { rootMargin: '0px 0px -40px 0px', threshold: 0.05 },
  );
  const siblingsSeen = new Map<Element | null, number>();
  for (const el of revealTargets) {
    const i = siblingsSeen.get(el.parentElement) ?? 0;
    siblingsSeen.set(el.parentElement, i + 1);
    el.style.setProperty('--reveal-delay', `${Math.min(i, 5) * 70}ms`);
    el.setAttribute('data-reveal', '');
    io.observe(el);
  }
}

// Header gains a stronger shadow once the page is scrolled.
const header = document.querySelector('.site-header');
if (header) {
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 4);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// Offline support (production builds only).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL.replace(/\/?$/, '/')}sw.js`).catch(() => {});
  });
}
