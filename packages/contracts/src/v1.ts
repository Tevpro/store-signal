import { parse as parseDomain } from 'tldts';

/** Portable /v1 wire records. Validators preserve unknown additive fields on roundtrips. */
export interface StoreIdentity {
  readonly schemaVersion: 1;
  readonly storeId: string;
  readonly origin: string;
  readonly registrableDomain: string;
  readonly tenantKey?: string;
  readonly matchExplanation: string;
}
export interface Evidence {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly storeId: string;
  readonly kind: string;
  readonly sourceUrl: string;
  readonly provider: string;
  readonly retrievedAt: string;
  readonly observedAt?: string;
  readonly subjectMatch: { readonly status: 'exact' | 'corroborated' | 'ambiguous' | 'unmatched'; readonly rationale: string };
  readonly claim: string;
  readonly excerpt?: string;
  readonly excerptRights?: 'permitted';
  readonly limitations: readonly string[];
  readonly lineage: readonly string[];
}
export interface Coverage {
  readonly schemaVersion: 1;
  readonly connector: string;
  readonly status: 'checked' | 'no_match' | 'unavailable' | 'failed';
  readonly checkedAt: string;
  readonly limitation?: string;
  readonly errorCode?: string;
}
export interface Assessment {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly storeId: string;
  readonly status: 'complete' | 'limited' | 'no_match' | 'failed';
  readonly concern: 'low' | 'caution' | 'high' | 'insufficient';
  readonly reasonCodes: readonly string[];
  readonly confidence: 'low' | 'medium' | 'high' | 'insufficient';
  readonly evidenceIds: readonly string[];
  readonly coverage: readonly Coverage[];
  readonly limitations: readonly string[];
  readonly checkedAt: string;
  readonly expiresAt: string;
  readonly aiMode: 'none' | 'managed' | 'byok';
  readonly publicationStatus: 'draft' | 'held' | 'published';
}
export interface HostedTenantRule { readonly platformDomain: string; readonly tenantLabels: number }
/** Small reviewed registry; add platforms only with their tenant-host semantics tested. */
export const HOSTED_TENANT_RULES: readonly HostedTenantRule[] = [
  { platformDomain: 'myshopify.com', tenantLabels: 1 },
  { platformDomain: 'platform.example', tenantLabels: 1 }, // synthetic fixture only
];

const invalid = (message: string): never => { throw new Error(`Invalid /v1 contract: ${message}`); };
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid('expected object');
  return input as Record<string, unknown>;
}
function text(value: unknown, name: string, max = 256): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) return invalid(name);
  return value;
}
function optionalText(value: unknown, name: string, max = 256): void { if (value !== undefined) text(value, name, max); }
function list(value: unknown, name: string, max = 50): string[] {
  if (!Array.isArray(value) || value.length > max) return invalid(name);
  const result: string[] = value.map((entry: unknown) => text(entry, name));
  if (new Set(result).size !== result.length) return invalid(`duplicate ${name}`);
  return result;
}
function enumValue<T extends string>(value: unknown, values: readonly T[], name: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) return invalid(name);
  return value as T;
}
function date(value: unknown, name: string): string {
  const str = text(value, name);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(str) || !Number.isFinite(Date.parse(str)) || new Date(str).toISOString() !== (str.includes('.') ? str.replace(/\.(\d{1,3})Z$/, (_, digits: string) => `.${digits.padEnd(3, '0')}Z`) : str.replace('Z', '.000Z'))) return invalid(name);
  return str;
}
function version(value: Record<string, unknown>): void { if (value.schemaVersion !== 1) invalid('schemaVersion'); }
function storeId(value: unknown): string {
  const str = text(value, 'storeId');
  if (!/^(?:domain|tenant):[a-z0-9.-]+$/.test(str)) invalid('storeId');
  return str;
}

/** Only string-level normalization: callers must independently validate DNS and redirects at fetch time. */
export function normalizeStoreIdentity(input: string, rules: readonly HostedTenantRule[] = []): StoreIdentity {
  if (typeof input !== 'string' || input.length > 2048 || input.includes('\\')) return invalid('URL');
  let url: URL;
  try { url = new URL(input); } catch { return invalid('URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return invalid('web origin');
  const hostname = url.hostname.replace(/\.$/, '').toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(hostname) || hostname.includes('..') || hostname.length > 253) return invalid('hostname');
  const parsed = parseDomain(hostname, { allowPrivateDomains: false });
  // .example is reserved for synthetic tests only; all other hosts require ICANN suffixes.
  if (parsed.isIp || !parsed.domain || (!parsed.isIcann && !hostname.endsWith('.example'))) return invalid('public registrable domain');
  const rule = [...HOSTED_TENANT_RULES, ...rules].find((candidate) => {
    if (candidate.platformDomain !== candidate.platformDomain.toLowerCase() || !/^[a-z0-9.-]+$/.test(candidate.platformDomain) || !Number.isInteger(candidate.tenantLabels) || candidate.tenantLabels < 1) return invalid('hosted rule');
    return hostname.endsWith(`.${candidate.platformDomain}`);
  });
  let tenantKey: string | undefined;
  if (rule) {
    const prefix = hostname.slice(0, -rule.platformDomain.length - 1);
    const labels = prefix.split('.');
    if (labels.length < rule.tenantLabels) return invalid('hosted tenant labels');
    tenantKey = labels.slice(-rule.tenantLabels).join('.');
  }
  const storeIdValue = rule ? `tenant:${tenantKey}.${rule.platformDomain}` : `domain:${parsed.domain}`;
  const origin = `${url.protocol}//${hostname}${url.port ? `:${url.port}` : ''}`;
  return { schemaVersion: 1, storeId: storeIdValue, origin, registrableDomain: parsed.domain, ...(tenantKey ? { tenantKey } : {}), matchExplanation: rule ? `Reviewed hosted tenant rule: ${rule.platformDomain}` : 'Independent registrable domain' };
}

function parseIdentity(input: unknown, trustedRules: readonly HostedTenantRule[] = []): StoreIdentity {
  const v = object(input); version(v);
  const id = storeId(v.storeId);
  const origin = text(v.origin, 'origin', 2048);
  const normalized = normalizeStoreIdentity(origin, trustedRules);
  if (normalized.origin !== origin || normalized.storeId !== id || normalized.registrableDomain !== v.registrableDomain || normalized.tenantKey !== v.tenantKey) invalid('identity mismatch');
  text(v.matchExplanation, 'matchExplanation', 512);
  return v as unknown as StoreIdentity;
}
function parseEvidence(input: unknown): Evidence {
  const v = object(input); version(v);
  text(v.id, 'id'); storeId(v.storeId); text(v.kind, 'kind'); text(v.provider, 'provider');
  const url = text(v.sourceUrl, 'sourceUrl', 2048);
  normalizeStoreIdentity(url);
  date(v.retrievedAt, 'retrievedAt'); if (v.observedAt !== undefined) date(v.observedAt, 'observedAt');
  const match = object(v.subjectMatch);
  enumValue(match.status, ['exact', 'corroborated', 'ambiguous', 'unmatched'], 'subjectMatch.status');
  text(match.rationale, 'subjectMatch.rationale', 512);
  text(v.claim, 'claim', 512);
  optionalText(v.excerpt, 'excerpt', 500);
  if (v.excerpt !== undefined && v.excerptRights !== 'permitted') invalid('excerpt rights');
  if (v.excerptRights !== undefined) enumValue(v.excerptRights, ['permitted'], 'excerptRights');
  list(v.limitations, 'limitations'); list(v.lineage, 'lineage');
  return v as unknown as Evidence;
}
function parseCoverage(input: unknown): Coverage {
  const v = object(input); version(v);
  text(v.connector, 'connector');
  const status = enumValue(v.status, ['checked', 'no_match', 'unavailable', 'failed'], 'coverage status');
  date(v.checkedAt, 'checkedAt'); optionalText(v.limitation, 'limitation'); optionalText(v.errorCode, 'errorCode');
  if (status === 'failed' && !v.errorCode || status !== 'failed' && v.errorCode !== undefined || status === 'unavailable' && !v.limitation) invalid('coverage status metadata');
  return v as unknown as Coverage;
}
function parseAssessment(input: unknown): Assessment {
  const v = object(input); version(v);
  text(v.id, 'id'); storeId(v.storeId);
  const status = enumValue(v.status, ['complete', 'limited', 'no_match', 'failed'], 'assessment status');
  const concern = enumValue(v.concern, ['low', 'caution', 'high', 'insufficient'], 'concern');
  if (list(v.reasonCodes, 'reasonCodes').length === 0) invalid('reasonCodes');
  enumValue(v.confidence, ['low', 'medium', 'high', 'insufficient'], 'confidence');
  const evidenceIds = list(v.evidenceIds, 'evidenceIds');
  const coverageInput = v.coverage;
  if (!Array.isArray(coverageInput) || coverageInput.length === 0) invalid('coverage');
  const coverage = (coverageInput as unknown[]).map((entry: unknown) => parseCoverage(entry));
  if (new Set(coverage.map((entry: Coverage) => entry.connector)).size !== coverage.length) invalid('duplicate connector');
  list(v.limitations, 'limitations');
  const checkedAt = date(v.checkedAt, 'checkedAt'); const expiresAt = date(v.expiresAt, 'expiresAt');
  if (Date.parse(expiresAt) <= Date.parse(checkedAt)) invalid('expiry');
  const ai = enumValue(v.aiMode, ['none', 'managed', 'byok'], 'aiMode');
  const publication = enumValue(v.publicationStatus, ['draft', 'held', 'published'], 'publicationStatus');
  if (status === 'no_match' && (concern !== 'insufficient' || evidenceIds.length || coverage.some((c: Coverage) => c.status !== 'no_match')) ||
      status === 'failed' && (concern !== 'insufficient' || evidenceIds.length || !coverage.some((c: Coverage) => c.status === 'failed') || coverage.some((c: Coverage) => c.status === 'checked')) ||
      status === 'complete' && (ai === 'none' || coverage.some((c: Coverage) => c.status === 'failed' || c.status === 'unavailable')) ||
      status === 'limited' && concern === 'high' ||
      ai === 'byok' && publication === 'published' ||
      (status === 'failed' || status === 'no_match') && publication === 'published') invalid('assessment state');
  return v as unknown as Assessment;
}
export interface V1Records { identity: StoreIdentity; evidence: Evidence; coverage: Coverage; assessment: Assessment }
export function parseV1<K extends keyof V1Records>(kind: K, input: unknown, trustedRules: readonly HostedTenantRule[] = []): V1Records[K] {
  if (kind === 'identity') return parseIdentity(input, trustedRules) as V1Records[K];
  const parser = { evidence: parseEvidence, coverage: parseCoverage, assessment: parseAssessment }[kind as 'evidence' | 'coverage' | 'assessment'];
  return parser(input) as V1Records[K];
}
export function serializeV1<K extends keyof V1Records>(kind: K, input: unknown, trustedRules: readonly HostedTenantRule[] = []): string {
  return JSON.stringify(parseV1(kind, input, trustedRules));
}

/** Cross-record check when an assessment and its evidence set are available together. */
export function parseAssessmentWithEvidence(input: unknown, evidence: readonly unknown[]): Assessment {
  const assessment = parseV1('assessment', input);
  const ids = new Map<string, Evidence>();
  for (const value of evidence) {
    const record = parseV1('evidence', value);
    if (ids.has(record.id)) invalid('duplicate evidence id');
    ids.set(record.id, record);
  }
  for (const id of assessment.evidenceIds) {
    const record = ids.get(id);
    if (!record || record.storeId !== assessment.storeId) invalid('foreign evidence id');
  }
  return assessment;
}
