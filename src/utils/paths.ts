// Every internal link must go through url() so the site works under a GitHub Pages
// sub-path (/bitbench/) as well as at the root of a custom domain.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export function url(path: string): string {
  if (/^[a-z]+:/i.test(path) || path.startsWith('#')) return path;
  return `${BASE}/${path.replace(/^\//, '')}`;
}

export function toolUrl(slug: string): string {
  return url(`tools/${slug}/`);
}
