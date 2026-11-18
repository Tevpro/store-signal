# Product requirements, v1

## Outcome

A shopper explicitly clicks the extension to assess an independent online store. The API returns a fresh cached domain assessment immediately, or an asynchronous `checking` result; a completed assessment shows **Low concern / Caution / High concern / Insufficient evidence**, evidence confidence, source links, observed dates, connector coverage, and a last-checked timestamp. Do not describe any verdict as proof of fraud or as a guarantee of safety.

## In scope

- Chrome/Chromium extension, click-to-check only. No passive browsing-history upload, screenshots, or full HTML in v1. Send only a normalized store identity; remove URL paths, query strings, credentials, fragments and tracking tokens for domain checks.
- Independent store domains, including tenant-specific hosted-store subdomains. Do not collapse separate tenants into the parent platform domain. Individual marketplace sellers are later scope.
- Hosted API with anonymous limited access and a self-hosted deployment, both on Cloudflare Workers and conventional infrastructure at first public release. Same engine and result contract; portability proved by integration tests.
- Public shareable store pages with `noindex` at launch; no per-user browsing history retained. Corrections visibly noted; routine refresh history remains internal. Disputes flag the page for prompt human review while dated findings remain visible.
- Operator-supplied licensed search provider and configured Google Places access are mandatory at startup in both deployment models. Search indexed Reddit posts with direct links; say **indexed Reddit results checked**, not complete Reddit coverage. Match Google Business Profile to the exact store before using its rating/review count; individual review text is optional. If connectors are unavailable, fail readiness/configuration and do not silently publish incomplete results. A store may have no Google listing or Reddit posts despite healthy connectors; say so.
- US-focused, English-language v1. Out-of-scope or unassessable stores receive an explicit limited/insufficient result.
- AI-provider-agnostic analysis. Non-AI checks are allowed but marked limited. BYOK output is private and cannot change the shared public result. Managed AI runs only when requested by a logged-in user; a small free allowance then paid usage, metered separately. Managed AI may propose a shared public concern level subject to citation/evidence validation.

## Rating rules and safeguards

- Caution reasons distinguish **limited independent track record** from **credible negative evidence**. Few complaints are not inherently suspicious; absence of trusted positive/negative reviews pushes toward Caution. Low concern without trusted reviews needs independently verified business identity from an actually verifying directory/provider, a proven link to the store, and at least one year of independently verifiable operation. Domain registration age, HTTPS, self-published policies, and payment logos are not sufficient substitutes.
- Trusted review/discussion signals in v1: exactly matched Google Business Profile reviews and Reddit reports tied to the exact domain or corroborated store identity. Other discoveries may appear as context but do not move the trusted-review signal. A single credible Reddit thread may support Caution; High concern requires corroboration. Reposts of one allegation are not independent corroboration.
- A matched Google Business Profile rating **below 3.0 with at least 20 reviews** may independently support High concern, after evidence validation. Show count, rating, matching rationale and date. Low stars indicate customer concern, not necessarily fraud.
- AI cannot invent evidence. A proposed public High concern result must cite validated, attributable evidence, pass identity/link checks and a separate publication gate. A failed gate becomes Caution or Insufficient evidence with a recorded reason, never an ungrounded public accusation. Results carry source provenance and coverage/limitations.
- Risky-store validation label: credible non-delivery, deceptive listings, payment abuse, or repeated refund refusal; ordinary slow shipping or poor quality alone do not satisfy that label.

## Checks, caching and privacy

- One new investigation per store identity globally per minute; concurrent users join the existing job. Default cache freshness: one week. Early refresh only by an administrator or domain owner verified via DNS TXT or site verification file; ownership proves control, not trust. A cache hit never triggers a duplicate investigation.
- Per-user/installation defaults: **5 new investigations/minute** and **30 cached lookups/minute**; separate limits for status polling and managed AI. Anonymous install identity has IP/edge abuse backstops and is not asserted to be a secure person identity. Implement atomic admission/idempotency across instances; D1 check-then-insert alone is insufficient proof of atomicity.
- Store-only public cache; no stored relationship between a user and a checked domain. Retention, privacy notice, IP/security logs and account data policy require review before launch.

## Out of scope for v1

Product/image comparison, Temu/Shein alternatives, screenshots, full HTML, anti-bot evasion, marketplace sellers, Firefox/Safari, multilingual and global coverage. Leave room for these in interfaces without building speculative infrastructure now. Alternatives must eventually require an actual product match, delivered price and defensible buyer protections; no paid placement in safety rankings.

## Launch gates

1. Operator-supplied search provider and Google Places connector are licensed/configured; legal/display/retention obligations documented. Search-indexed Reddit links and exact Business Profile identity matching work in hosted and self-hosted/Worker runtimes.
2. End-to-end click -> cached or checking -> evidence result, public noindex page, dispute/owner verification, and per-user/global limits tested in **both** runtimes. Security review covers SSRF, redirects, extension permissions, tenant isolation, secret storage and prompt injection.
3. On an independently adjudicated, representative labeled set: at most **5% false High concern** among High concern outputs and at least **80% of labeled risky stores** classified Caution or High concern. Publish methodology, sample size, uncertainty and hard cases; do not claim these thresholds met before measurements exist.
4. Human correction workflow, documented operator response process, credible-source checks, privacy policy, security policy, and OSI-approved license selected before open-source release. The repo may remain public and unlicensed while planning.
