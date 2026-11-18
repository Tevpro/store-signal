# GitHub issue pack

Canonical GitHub issues will be created from this versioned list. Plane cards link these issues and mirror ownership/status. Paths in architecture are proposed until foundation is implemented.

## G01 · Choose an OSI license and contribution/trademark policy
Phase: P0 | Area: governance | Dependencies: none

Acceptance:
- Record license tradeoff and approved SPDX license; add LICENSE and contribution terms after approval.
- No third-party code merged before the license decision.

## G02 · Validate licensed search provider for indexed Reddit evidence
Phase: P0 | Area: research | Dependencies: none

Acceptance:
- Compare approved search APIs for indexed Reddit URLs, coverage, quotas, cost and Workers/Node compatibility.
- Document compliant links/snippets/cache retention and test exact-domain identity matching with synthetic cases.
- Do not implement unauthorized scraping or claim full Reddit coverage.

## G03 · Validate Google Places access and exact-business identity mapping
Phase: P0 | Area: research | Dependencies: none

Acceptance:
- Verify API credentials, billing, attribution and storage/display terms for rating and review count.
- Document exact-store matching, no-match and ambiguous-match cases; test a bounded sample with approved access.
- Record provider rate limits and both deployment configurations.

## G04 · Create adjudicated evaluation dataset and measurement protocol
Phase: P0 | Area: qa | Dependencies: none

Acceptance:
- Define risky labels, independent review process, sampling and uncertainty reporting; use permitted data/synthetic fixtures.
- Specify launch gates: >=80% risky Caution/High and <=5% false High among High outputs.
- Ensure benign new stores, ambiguous business names, reposts and malicious content are represented.

## G05 · Approve threat, privacy, and public-claims operating policy
Phase: P0 | Area: governance | Dependencies: none

Acceptance:
- Document privacy/retention, anonymous identity limits, SSRF and prompt-injection controls, correction SLA and evidence-validation gate.
- Define public High concern language and appeal path; review source-attribution and US-English scope.
- No public launch on unreviewed draft policy.

## F01 · Scaffold TypeScript monorepo and dual-runtime test harness
Phase: P1 | Area: foundation | Dependencies: G02, G03

Acceptance:
- Choose package manager/runtime versions and workspace layout for apps and packages in one repository.
- Create runnable Wrangler-local and Node/SQLite smoke tests with shared fixtures and locked dependencies.
- Document exact commands; do not provision production resources.

## F02 · Define versioned domain identity, evidence, coverage and assessment contracts
Phase: P1 | Area: foundation | Dependencies: F01

Acceptance:
- Define runtime-validated /v1 schemas for store identity, coverage, evidence and assessment with explicit limited/no-match/failed states.
- Test hosted tenant subdomain separation, URL normalization and backwards-compatible serialization.
- Core imports no Node/Cloudflare provider SDKs.

## F03 · Implement portable persistence and migration adapters
Phase: P1 | Area: backend | Dependencies: F02

Acceptance:
- Same schema semantics verified on D1 and local SQLite; tested migration up/down or safe forward recovery.
- Persist dated evidence references, jobs, corrections and account-separated private analysis without storing full review corpora.
- Include retention/deletion tests and no production IDs/secrets.

## F04 · Implement atomic job admission, cache freshness and quotas
Phase: P1 | Area: backend | Dependencies: F03

Acceptance:
- One new investigation/store/min globally with concurrent join and crash-safe retry; week-long freshness and owner/admin early refresh path.
- Enforce 5 new jobs/min/user, 30 cached reads/min/user, separate status/AI quotas and anonymous abuse backstop.
- Race tests on both runtimes; no D1 read-then-write assumption.

## F05 · Implement versioned check/status/store API
Phase: P1 | Area: backend | Dependencies: F04

Acceptance:
- POST /v1/checks and GET /v1/checks/{id} return cached/checking/complete/rate-limited/unsupported with retry-after.
- Normalize origins, validate public fetch destinations, redirects and body bounds; never forward shopper cookies.
- Contract tests in Wrangler local and Node with no external credentials.

## F06 · Add CI, fixtures, dependency and cross-runtime gates
Phase: P1 | Area: qa | Dependencies: F05

Acceptance:
- CI runs formatting, lint, strict typecheck, unit/integration tests, dual-runtime smoke, build and audit.
- Synthetic fixtures cover identity confusion, outage vs no-match, low-review-count, duplicate jobs and malicious source text.
- Document required check names before enforcing branch protection.

## E01 · Build approved indexed-Reddit search connector
Phase: P2 | Area: connectors | Dependencies: F05, G02

Acceptance:
- Use operator-configured approved search provider; return direct indexed Reddit URLs with timestamps and source metadata.
- Only exact domain/corroborated store identity affects rating; deduplicate reposts; no complete-coverage claims.
- Fixtures for missing results, provider outage, quota and malicious snippets on both runtimes.

## E02 · Build Google Business Profile connector and match validator
Phase: P2 | Area: connectors | Dependencies: F05, G03

Acceptance:
- Use configured Places API; exact-entity match with documented rationale and explicit ambiguity/no-match.
- Return linked rating, review count and observed date with required attribution; no full review corpus persisted.
- Test similarly named businesses and below-3.0/20-review boundary.

## E03 · Implement verified business identity and operating-history evidence
Phase: P2 | Area: connectors | Dependencies: F05, G05

Acceptance:
- Document and test actually verifying directories/providers with store-to-identity link and >=1 year independent operation.
- Do not equate domain age, HTTPS, policy pages or payment logos with verified business identity.
- Return missing/ambiguous provenance as no match or limited evidence.

## E04 · Implement concern policy, provenance and public evidence gate
Phase: P2 | Area: core | Dependencies: E01, E02, E03, G04

Acceptance:
- Distinguish Caution limited-history vs negative-evidence; no reviews alone never proof of fraud.
- One credible Reddit complaint can support Caution; High requires corroboration except exact matched Google rating <3.0 with >=20 reviews, always validated.
- All public High concern outputs carry attributable, dated, independent sources and pass gate; failure downgrades with explicit reason.

## U01 · Ship click-to-check Chrome/Chromium MV3 extension
Phase: P3 | Area: frontend | Dependencies: F05

Acceptance:
- Explicit click only; send normalized store origin, no screenshots/full HTML or passive browsing collection.
- Display cached/checking/limited/caution/high/insufficient, sources, confidence and last checked.
- Extension points to hosted or self-hosted API; permission/privacy and browser smoke tests.

## U02 · Build public noindex store result pages
Phase: P3 | Area: frontend | Dependencies: E04

Acceptance:
- Shareable dated evidence/coverage pages, noindex at launch, accessible UI and cautious non-defamatory copy.
- Cached result and in-progress state accurate; no personal check history.
- Verify noindex header/meta, source links, no-match disclosure, accessibility and correction link.

## U03 · Implement domain ownership verification and early refresh
Phase: P3 | Area: backend | Dependencies: F04, U02

Acceptance:
- Verify DNS TXT or site-file proof bound to exact store identity and tenant subdomain.
- Only verified owner/admin may refresh before weekly expiry, still respecting global cooldown; ownership never changes concern.
- Audit proof/expiry/revocation and reject same-name impersonation.

## U04 · Implement disputes, human review and public correction notices
Phase: P3 | Area: frontend | Dependencies: U02, U03, G05

Acceptance:
- Any reader can report a factual issue; credible High concern dispute flags page for human review while dated finding remains.
- Moderation records decision; public correction notices show factual changes, routine reassessments not exposed.
- No store owner can delete or self-edit verdict.

## A01 · Implement provider-pluggable private BYOK analysis
Phase: P4 | Area: ai | Dependencies: E04, F03

Acceptance:
- Capability-based AI interface, structured output with evidence IDs and prompt-injection defenses; non-AI result stays functional and marked limited.
- BYOK key encrypted server-side, deletable, redacted in logs and isolated by account; BYOK result private and cannot mutate public verdict.
- Test at least two provider adapters with fixtures; local-only models unavailable to Workers are documented.

## A02 · Implement managed AI allowance, metering and public validation
Phase: P4 | Area: ai | Dependencies: A01, E04

Acceptance:
- Logged-in request only; small free allowance and paid usage design with independent AI quota and no anonymous managed AI spend.
- Managed AI proposal may update public result only after identity, citations and publication gate succeed.
- Provide billing/abuse tests and explicit fail-closed behavior; do not enable paid usage without approval.

## D01 · Package and verify Cloudflare Workers deployment
Phase: P4 | Area: deployment | Dependencies: F06, U04, A02

Acceptance:
- Document Wrangler/D1/Queues/secrets setup and reproducible local bootstrap; no hardcoded live IDs.
- Verify API, worker, public page and dispute flow against actual Worker local runtime.
- Live provisioning and external provider smoke require separately approved credentials.

## D02 · Package and verify conventional self-hosted deployment
Phase: P4 | Area: deployment | Dependencies: F06, U04, A02

Acceptance:
- Document Node/SQLite durable jobs, backups/migrations, secret configuration and container deployment.
- Same API/public/owner/dispute acceptance suite as Cloudflare; startup refuses absent search/Places config.
- Provide bootstrap fixture, health/readiness and upgrade/rollback instructions.

## L01 · Run independent launch evaluation and security/privacy review
Phase: P4 | Area: qa | Dependencies: D01, D02, G04, G05

Acceptance:
- Measure thresholds on independent labeled dataset and publish sample size, false-High precision, risky detection and uncertainty.
- Test concurrent limits, SSRF, tenant isolation, correction response, public noindex and provider terms in both deployments.
- Block public launch when gates or licensing unresolved; no unverified performance claim.

## N01 · Research product/image match and alternative-vendor phase
Phase: LATER | Area: research | Dependencies: L01

Acceptance:
- Design licensed image/product search and gold set for same-product vs same-photo false matches.
- Recommendations require delivered price, variant match and documented protections; no paid placement in safety ranking.
- No v1 screenshot, evasion or product comparison implementation.

## N02 · Plan Firefox, broader markets and anti-evasion after v1
Phase: LATER | Area: research | Dependencies: L01

Acceptance:
- Document permission and API differences, language/local data licensing, and evidence for bot-evasion work.
- Keep separate from v1 launch scope; no speculative crawler bypass.

