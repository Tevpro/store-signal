const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function publicHostname(host: string): boolean {
  const name = host.toLowerCase();
  return name.includes('.') && !name.endsWith('.') && !name.endsWith('.local') && !name.endsWith('.localhost') && !name.endsWith('.internal')
    && !LOOPBACK.has(name) && !/^\d+(?:\.\d+){3}$/.test(name) && !name.includes(':')
    && /^[a-z0-9.-]+$/.test(name) && name.split('.').every(part => part.length > 0 && !part.startsWith('-') && !part.endsWith('-'));
}

export function normalizeStoreOrigin(raw: string): string {
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol) || !publicHostname(url.hostname) || url.username || url.password || url.port) throw new Error('Only public web stores can be checked');
  return url.origin;
}

export function parseEndpoint(raw: string): URL {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/v1/') throw new Error('Use an API endpoint ending in /v1/ without credentials or parameters');
  if (url.protocol === 'https:' && !publicHostname(url.hostname)) throw new Error('Invalid public API host');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) throw new Error('API must use HTTPS, except local development on loopback');
  return url;
}

export function endpointPermission(url: URL): string {
  return `${url.origin}/*`;
}
