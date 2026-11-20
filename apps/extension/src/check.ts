import { normalizeStoreOrigin, parseEndpoint } from './boundaries.js';

type Assessment = { concern: 'low' | 'caution' | 'high' | 'insufficient'; confidence: 'low' | 'medium' | 'high' | 'insufficient'; checkedAt: string; sources: { label: string; url: string; observedAt: string }[]; limited: boolean };
export type CheckResult = { status: 'cached' | 'complete'; checkId: string; assessment: Assessment } | { status: 'checking'; checkId: string } | { status: 'rate_limited'; retryAfterSeconds: number } | { status: 'unsupported'; reason: string } | { status: 'error'; message: string };
type Request = (url: string, init: RequestInit) => Promise<Response>;
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 500 && !/[\u0000-\u001f\u007f]/.test(v);
const date = (v: unknown): v is string => text(v) && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));
const checkId = (v: unknown): v is string => text(v) && /^[A-Za-z0-9_.-]{1,256}$/.test(v) && v !== '.' && v !== '..';

export function parseResult(value: unknown): CheckResult {
  if (!record(value) || value.schemaVersion !== 1) throw new Error('Invalid /v1 response');
  if (value.status === 'checking' && checkId(value.checkId)) return { status: 'checking', checkId: value.checkId };
  if (value.status === 'rate_limited' && typeof value.retryAfterSeconds === 'number' && Number.isFinite(value.retryAfterSeconds) && value.retryAfterSeconds >= 0 && value.retryAfterSeconds <= 86400) return {status:'rate_limited',retryAfterSeconds:value.retryAfterSeconds};
  if (value.status === 'unsupported' && text(value.reason)) return {status:'unsupported',reason:value.reason};
  if ((value.status === 'cached' || value.status === 'complete') && checkId(value.checkId) && record(value.assessment)) {
    const a = value.assessment;
    if (typeof a.concern !== 'string' || !['low','caution','high','insufficient'].includes(a.concern) || typeof a.confidence !== 'string' || !['low','medium','high','insufficient'].includes(a.confidence) || !date(a.checkedAt) || !Array.isArray(a.sources) || a.sources.length > 20 || typeof a.limited !== 'boolean') throw new Error('Invalid assessment');
    const sources = a.sources.map((source: unknown) => {
      if (!record(source) || !text(source.label) || !text(source.url) || !date(source.observedAt)) throw new Error('Invalid source');
      let url: URL;
      try { url = new URL(source.url); } catch { throw new Error('Invalid source link'); }
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid source link');
      return {label: source.label, url: url.href, observedAt: source.observedAt};
    });
    return {status:value.status,checkId:value.checkId,assessment:{concern:a.concern as Assessment['concern'],confidence:a.confidence as Assessment['confidence'],checkedAt:a.checkedAt,sources,limited:a.limited}};
  }
  throw new Error('Invalid /v1 response');
}

async function receive(response: Response): Promise<CheckResult> {
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new Error('API returned non-JSON data');
  if (!response.ok && response.status !== 429 && response.status !== 503) throw new Error(`API unavailable (${response.status})`);
  const result = parseResult(await response.json() as unknown);
  if (!response.ok && !(response.status === 429 && result.status === 'rate_limited') && !(response.status === 503 && result.status === 'unsupported')) throw new Error('Invalid API status');
  return result;
}
export async function checkStore(tabUrl: string, endpoint: string, request: Request = fetch): Promise<CheckResult> {
  const origin = normalizeStoreOrigin(tabUrl);
  const api = parseEndpoint(endpoint);
  return receive(await request(new URL('checks',api).href,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',redirect:'error',body:JSON.stringify({origin})}));
}
/** Poll only a server-provided check ID on the same selected API endpoint; stop on quota or unsupported. */
export async function pollCheck(initial: CheckResult, endpoint: string, request: Request = fetch, wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve,ms)), maxAttempts = 12): Promise<CheckResult> {
  if (initial.status !== 'checking') return initial;
  const api = parseEndpoint(endpoint);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await wait(2000);
    const response = await request(new URL(`checks/${encodeURIComponent(initial.checkId)}`,api).href,{method:'GET',credentials:'omit',redirect:'error'});
    const result = await receive(response);
    if ('checkId' in result && result.checkId !== initial.checkId) throw new Error('Invalid check status identity');
    if (result.status !== 'checking') return result;
  }
  throw new Error('Status polling timed out; try checking again later');
}
const escape = (v: string): string => v.replace(/[&<>"']/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char] ?? char));
export function renderResult(result: CheckResult): string {
  if (result.status === 'error') return `<p role="alert">${escape(result.message)}</p>`;
  if (result.status === 'checking') return '<p>Checking…</p>';
  if (result.status === 'rate_limited') return `<p>Request limited. Try again in ${Math.ceil(result.retryAfterSeconds)} seconds.</p>`;
  if (result.status === 'unsupported') return '<p>Assessment unavailable for this store.</p>';
  const a = result.assessment;
  const label = {low:'Low concern',caution:'Caution',high:'High concern',insufficient:'Insufficient evidence'}[a.concern];
  const sources = a.sources.map(s => `<li><a href="${escape(s.url)}" target="_blank" rel="noopener noreferrer">${escape(s.label)}</a> · observed ${escape(s.observedAt)}</li>`).join('');
  return `<h2>${label}</h2><p>${a.limited ? 'Limited assessment · ' : ''}Confidence: ${escape(a.confidence)}</p><p>Last checked: ${escape(a.checkedAt)}</p><h3>Sources</h3>${sources ? `<ul>${sources}</ul>` : '<p>No sources available.</p>'}<p>Not proof of fraud or a guarantee of safety.</p>`;
}
