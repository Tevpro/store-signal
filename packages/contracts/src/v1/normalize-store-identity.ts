import { parse as parseDomain } from "tldts";
import type { StoreIdentity } from "../types/store-identity.ts";
import type { HostedTenantRule } from "../types/hosted-tenant-rule.ts";
import { invalid } from "./contract-validation.ts";
import { HOSTED_TENANT_RULES } from "./hosted-tenant-rules.ts";

/** Only string-level normalization: callers must independently validate DNS and redirects at fetch time. */
export function normalizeStoreIdentity(
  input: string,
  rules: readonly HostedTenantRule[] = [],
): StoreIdentity {
  if (typeof input !== "string" || input.length > 2048 || input.includes("\\"))
    return invalid("URL");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return invalid("URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port
  )
    return invalid("web origin");
  const hostname = url.hostname.replace(/\.$/, "").toLowerCase();
  if (
    !/^[a-z0-9.-]+$/.test(hostname) ||
    hostname.includes("..") ||
    hostname.length > 253
  )
    return invalid("hostname");
  const parsed = parseDomain(hostname, { allowPrivateDomains: false });
  // .example is reserved for synthetic tests only; all other hosts require ICANN suffixes.
  if (
    parsed.isIp ||
    !parsed.domain ||
    (!parsed.isIcann && !hostname.endsWith(".example"))
  )
    return invalid("public registrable domain");
  const rule = [...HOSTED_TENANT_RULES, ...rules].find((candidate) => {
    if (
      candidate.platformDomain !== candidate.platformDomain.toLowerCase() ||
      !/^[a-z0-9.-]+$/.test(candidate.platformDomain) ||
      !Number.isInteger(candidate.tenantLabels) ||
      candidate.tenantLabels < 1
    )
      return invalid("hosted rule");
    return hostname.endsWith(`.${candidate.platformDomain}`);
  });
  // The ICANN-only view collapses unrelated tenants on private PSL suffixes.
  // Reject those hosts unless a trusted, reviewed rule defines their tenant boundary.
  if (!rule && parseDomain(hostname, { allowPrivateDomains: true }).isPrivate)
    return invalid("private hosted suffix without reviewed rule");
  let tenantKey: string | undefined;
  if (rule) {
    const prefix = hostname.slice(0, -rule.platformDomain.length - 1);
    const labels = prefix.split(".");
    if (labels.length < rule.tenantLabels)
      return invalid("hosted tenant labels");
    tenantKey = labels.slice(-rule.tenantLabels).join(".");
  }
  const storeIdValue = rule
    ? `tenant:${tenantKey}.${rule.platformDomain}`
    : `domain:${parsed.domain}`;
  const origin = `${url.protocol}//${hostname}${url.port ? `:${url.port}` : ""}`;
  return {
    schemaVersion: 1,
    storeId: storeIdValue,
    origin,
    registrableDomain: parsed.domain,
    ...(tenantKey ? { tenantKey } : {}),
    matchExplanation: rule
      ? `Reviewed hosted tenant rule: ${rule.platformDomain}`
      : "Independent registrable domain",
  };
}
