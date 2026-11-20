# Architecture and boundaries

## Principle

One planned TypeScript **monorepo** (Apache-2.0 selected for Tevpro-owned code; draft license unmerged and rights/authority unverified, so no effective grant on `main` yet) with ports for runtime, data, jobs, web search, Google Places, and AI. No Cloudflare binding, Node-only module, SDK-specific model call, or provider search result inside the pure assessment/rating package. The browser extension, public pages and third-party API all consume the same versioned result schema. Repo layout below is **proposed**; implementation issues may refine it with an ADR. Do not split extension, backend or Cloudflare adapters into separate repositories.

```text
apps/extension (Chrome MV3) -> apps/api (HTTP) -> job admission -> apps/worker
                                     |                          |
                                     v                          v
                               status/public page      evidence connectors
                                     |                          |
                                     +---- store evidence & AI interpretation
                                                |
                                          publication gate
```

| Port | Cloudflare | Self-hosted | Contract |
| --- | --- | --- | --- |
| API | Workers | Node HTTP adapter | Versioned `/v1` JSON + auth/rate limits |
| Records | D1 | SQLite | Same migration semantics and repository tests |
| Jobs/admission | Queues + atomic per-store coordinator | durable job runner + atomic DB admission | idempotent key, retries, in-flight join, cooldown |
| Search | operator-configured approved search API | same contract | query, URL, snippet, timestamp, terms/coverage |
| Business reviews | configured Google Places API | same | exact entity match, rating, count, URL, timestamp |
| AI | remote provider adapter | remote or local reachable provider | capability declaration; schema-validated answers and evidence IDs |
| Temporary blobs | R2 if needed later | S3/filesystem if needed later | no screenshots in v1 |

**Cloudflare details are adapters, not requirements on core.** D1 has SQLite semantics but compatibility must be proved against local SQLite. Queues provide async jobs but atomic per-store single-flight/cooldown needs a separate coordinator or verified DB transaction/unique key; never promise that a naive D1 read-then-write prevents concurrent duplicates. Self-hosted job execution must be durable across restarts; no in-memory-only queue for public release. No heavy image index in a Worker.

## Domain identity

Normalize URL client-side and server-side. Accept only HTTPS/HTTP web origins with public DNS; strip path/query/fragment/userinfo. Map independent custom domains to registrable identity, but treat known multi-tenant hosted storefront subdomains as distinct stores. Maintain a reviewed platform/tenant rule registry and tests (`shop-a.platform.example` != `shop-b.platform.example`). Never trust a client-supplied canonical identity or fetch arbitrary internal/loopback/metadata addresses; validate redirects and resolved addresses too.

## Result lifecycle

- `POST /v1/checks` accepts normalized store origin and idempotency key. Return existing fresh assessment, join current job, or atomically admit one new job subject to user/new-job and global/domain cooldown limits. Return typed `cached|checking|rate_limited|unsupported` with retry-after where appropriate.
- `GET /v1/checks/{id}` returns status and result for a specific job; status polling is separately throttled. `GET /v1/stores/{store_id}` serves a public, dated, noindex result page/JSON after publication gate. Cached lookup and new job admission must be measured separately. `POST /v1/stores/{store_id}/refresh` requires admin or DNS/file-verified domain-owner authorization.
- Worker gathers bounded external evidence, records provenance and provider failures, normalizes source identity, then computes candidate concern + confidence. AI is an optional interpreter of existing evidence. Shared public managed-AI update runs only after authenticated user request and publication gate. BYOK analysis is private and does not mutate shared cache. Corrections and revisions are recorded, and public corrections have visible notices.

## Evidence schema (contract to implement and version)

`StoreIdentity { storeId, origin, registrableDomain, tenantKey?, matchExplanation }`
`Evidence { id, storeId, kind, sourceUrl, provider, retrievedAt, observedAt?, subjectMatch, claim, excerpt?, limitations[], lineage[] }`
`Coverage { connector, status: checked|unavailable|no_match|failed, checkedAt, limitation? }`
`Assessment { id, storeId, concern: low|caution|high|insufficient, reasonCodes[], confidence, evidenceIds[], coverage[], checkedAt, expiresAt, aiMode: none|managed|byok, publicationStatus }`

Never store full third-party review bodies or imply rights to redistribute them without source-specific policy review. Store source references/brief necessary excerpts only where licensed; account and private BYOK analyses separated from public evidence. A `no_match` from a healthy provider differs from `unavailable` or `failed`.

## Threat model and failure behavior

- SSRF and redirect validation; egress timeouts, bounded body size, response-type allowlist; no cookies from shoppers; secret-free logs. Malicious web pages and reviews are untrusted data, never instructions to an AI or worker.
- Identity confusion (business with similar name), coordinated reviews/reposts, stale caches, prompt injection, publicly damaging false positives, hosted-tenant mixing, quota abuse, and forged owner verification are first-class tests.
- A connector outage yields explicit coverage failure; startup readiness fails if required search/Places configuration absent. An individual store without a GBP listing or indexed Reddit content is a legitimate no-match outcome, not a connector outage.
- Separate private BYOK analysis and encrypted server-side keys with deletion, redaction and provider allowlist. Cloudflare Workers cannot reach a customer's `localhost` model; conventional self-hosting may. No user-provided arbitrary AI endpoint without SSRF/egress controls.

## Proposed packages

`packages/contracts`, `packages/core`, `packages/connectors`, `packages/ai`, `packages/storage-sqlite`, `packages/runtime-cloudflare`, `packages/runtime-node`, `apps/api`, `apps/worker`, `apps/extension`, `apps/public-web`, `tests/fixtures`. Contracts/core are dependency-inverted; adapters implement them. All concrete file paths are proposals, not assertions that these packages exist today.
