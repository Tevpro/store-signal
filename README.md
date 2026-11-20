# StoreSignal

Planned evidence-backed assessments of unfamiliar online stores. **Only a local, synthetic dual-runtime fixture harness exists; there is no runnable store checker or provider integration yet.** The first clients will be a click-to-check Chrome/Chromium extension and a versioned API, deployable on Cloudflare Workers or a conventional self-hosted server from the same codebase. Product code, deployment adapters, shared contracts, docs, and repo-local worker skills belong in this repository, not in separate runtime-specific repos.

## Start here

- [Requirements and launch gates](docs/requirements.md)
- [System architecture and contracts](docs/architecture.md)
- [Coding standards](docs/coding-standards.md)
- [Agent/worker playbook](AGENTS.md) and [project skill](skills/store-signal/SKILL.md)
- [Cloudflare deployment runbook (manual, not yet enabled)](docs/cloudflare-deployment.md)
- [PR review and delivery gate](docs/review-and-delivery.md)
- [Delivery phases and dependencies](docs/roadmap.md)
- [Decisions and unresolved questions](docs/decisions.md)
- [Contributing](CONTRIBUTING.md) | [Security](SECURITY.md)

## Work ledgers

GitHub [Issues](https://github.com/Tevpro/store-signal/issues) and the [StoreSignal Build project](https://github.com/orgs/Tevpro/projects/37) are the technical backlog and code/PR ledger. The dedicated Plane project **StoreSignal (STSIG)** is the internal assignment/status ledger. Every Plane work item must link its canonical GitHub issue, and every implementation PR must link both. **Nothing is assigned or running just because a card exists.** See [AGENTS.md](AGENTS.md). The GitHub Project is currently private to authorized collaborators because the authenticated GitHub account cannot change project visibility; the repository and issues are public.

## Local foundation harness (F01)

Node `26.7.0` (`.node-version`) and npm `12.2.3` (`packageManager`) are pinned. The npm workspace/lockfile covers `packages/contracts`, `packages/runtime-node`, and `packages/runtime-cloudflare`; `tests/fixtures/stores.json` is the single synthetic input for both runtimes. Future apps belong under `apps/` when they have real implementation. The SQL migration in `migrations/0001_fixture_stores.sql` runs against both native `node:sqlite` and local Wrangler D1. No production resources, credentials or providers are needed or configured.

From the repository root, with those pinned versions:

```sh
npm ci --ignore-scripts
npm run lint
npm run typecheck
npm test
npm run build
npm run smoke:node
npm run smoke:worker
npm audit --omit=dev
```

`smoke:worker` runs `wrangler d1 migrations apply --local` in a temporary directory, starts `wrangler dev --local` bound to loopback, checks `/smoke` over HTTP and cleans up. `smoke:node` exercises native SQLite in memory. `build` emits Node JS and bundles the Worker with Wrangler `--dry-run` only; it does **not** deploy. These fixtures prove local database/runtime wiring and /v1 contract JSON parity, not source verification, job admission, public ratings or launch readiness. The Worker config contains a synthetic all-zero local D1 ID; never use it for production deployment. Provider rights, credentials and terms remain gated by G02/G03.

## /v1 shared contracts (F02 PR)

`packages/contracts/src/index.ts` exports runtime-validated `StoreIdentity`, `Evidence`, `Coverage`, and `Assessment` from separate `types/` files, with behavior-named validators and normalization modules under `v1/`. `parseV1(kind, unknown)` and `serializeV1(kind, unknown)` reject missing fields, invalid enums/dates, contradictory outcomes and unknown schema versions while retaining additive fields on a v1 JSON roundtrip. `parseAssessmentWithEvidence` checks cited IDs against known same-store evidence. No connector or rating engine is implemented. `tests/fixtures/v1-records.json` is synthetic and exercised through native SQLite JSON1 and Wrangler-local D1 JSON SQL; `/contracts-smoke` is a fixture-only Worker route, not a product API.

`normalizeStoreIdentity` uses the pinned PSL implementation (`tldts`) and a reviewed hosted-tenant rule registry (initially `myshopify.com`; `.example` rules exist only for synthetic tests). Unreviewed private-PSL hosted suffixes (such as `pages.dev` or `github.io`) are rejected rather than collapsing unrelated tenants to their parent; trusted server code may supply additional reviewed rules explicitly, never derived from shopper input. It rejects credentials, non-web schemes, IP literals, non-ICANN suffixes except reserved `.example` test hosts, and non-default ports; it does **not** resolve DNS, follow redirects or prove a remote site is safe. Fetch adapters must validate all resolved and redirected addresses independently before egress. Origin preserves HTTP versus HTTPS, while identity keys do not imply transport safety. Any public High result still needs the independent evidence/publication gate; schema-valid records are not authorization to publish. BYOK records remain private.

## F03 local persistence slice (dependency-aware WIP)

`migrations/0002_persistence.sql` adds versioned JSON-backed identity, investigation job, dated evidence-reference, assessment, correction, and account-scoped private BYOK tables. The shared `packages/storage-sqlite` repository uses atomic `SqlPort.batch` on both native Node/SQLite (`BEGIN IMMEDIATE`/rollback) and D1 (`db.batch`); linked assessment evidence has foreign keys. Run `npm test` for native file-DB restart, forward migration from a populated 0001 fixture, injected mid-batch abort, private isolation, and retention; run `npm run smoke:persistence:worker` for the same local Worker/D1 HTTP-backed behavior, restart, migration, injected abort, and database invariants. The test-only Worker lives in `tests/persistence-worker.ts` with its own Wrangler config, never the default Worker bundle. Both use synthetic data and temporary databases; no provider calls or secrets.

These are **forward-only** migrations. Apply 0001–0004 in order with Wrangler's migration ledger on D1; on self-hosted Node call `migrateNodeStorage(db, [{version:1,sql:...}, ..., {version:4,sql:...}])` with the checked-in SQL files in order. The Node helper transactionally couples each migration to `_storage_migrations`, refuses unknown applied versions, and permits retry after an interrupted migration. Back up before rollout; verify `PRAGMA foreign_key_check` after recovery and never drop correction history as a rollback. `prune(now)` explicitly deletes expired assessed investigations (cascading evidence) and private analysis while preserving corrections and in-flight jobs. The operator must choose an actual retention schedule and arrange the recurring invocation before launch; this library does not auto-purge, authenticate account callers, or encrypt BYOK keys. No BYOK key storage is provided. Private analyses cite same-store evidence through foreign-keyed links; when that evidence expires, the same atomic prune invalidates and deletes affected private analyses rather than leaving orphan citations. Align the eventual operator retention policy and private analysis lifetime before production. Provider rights and public rating authorization remain gated.

## F04 local admission and quota slice

`migrations/0003_admission.sql` adds fenced leases and indexes; `0004_quotas.sql` adds a rolling 60-second reservation ledger without user-to-store links. `createAdmission` conditionally inserts one job per store/minute in a serialized SQLite write, joins concurrent jobs, recovers expired attempts with generation fencing, and serves assessments fresh for seven days. `createQuotas` reserves independently scoped new (5), cached (30), status (60 provisional), and AI (2 provisional) budgets per minute, with separate anonymous edge ceilings. An admission race refunds its quota reservation; process failure before refund can temporarily over-throttle but cannot over-admit. Call `createQuotas.prune(now)` on an operator-defined schedule; no scheduler is provided.

Run `npm test`, `npm run smoke:admission:worker`, and `npm run smoke:quota:worker` for native SQLite multi-connection races and actual Wrangler-local D1 HTTP races, restart, lease fencing, freshness, forged tenant labels, and quota boundaries. These are storage primitives and synthetic-only test routes, **not a public API or job worker**. A future HTTP boundary must derive quota scope from trusted auth/ingress, require it for public calls, and verify owner/admin authority before setting `earlyRefresh`; this fixture-oriented storage function still accepts an omitted scope. `complete` accepts only evidence-free non-BYOK assessments until an atomic evidence-writing completion path exists. No external provider is called, and no public release or production deployment is implied.

## F05 check/status HTTP checkpoint (not a public API)

The shared `createCheckHandler` supports bounded `POST /v1/checks` and principal-bound `GET /v1/checks/{id}` in synthetic Node/SQLite and Wrangler-local D1 harnesses. Responses are versioned `checking`, `cached`, `complete`, `rate_limited`, or `unsupported`; status and new/cached quotas are separate. The handler derives its principal and stable HMAC secret from **trusted server context**, never request headers. Idempotency keys replay within a principal and normalized origin for ten minutes; conflicting reuse returns 409. Migrations `0005` and `0006` add job grants and keyed replay state. Run `npm test` and `npm run smoke:check:worker` for HTTP/DB coverage.

The default Worker does **not** enable this route; its adapter stays fail-closed (503) because authenticated ingress, durable dispatch, licensed connectors, and an operator-managed stable secret are absent. The fixture entrypoint `tests/check-worker.ts` simulates trusted identity only for tests. No outbound store fetch exists, so DNS/public-IP/rebinding and per-hop redirect/egress safeguards are not implemented or claimed. No safety verdict is published: evidence-free status is always `insufficient` even if a stored assessment carries a publication flag. Privacy review of pseudonymous grant/job linkage, retention, and secret rotation is required before launch. Roll back this checkpoint by keeping the route disabled; migrations are forward-only and grants cascade with job deletion. Issue #10 stays open until its remaining acceptance and release gates are met.

## Status and licensing

Created by [Tevpro](https://tevpro.com). Community contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

Keith has recorded the choice of **Apache-2.0** for Tevpro-owned project code, with DCO 1.1 sign-offs and a separate trademark policy ([decision record](docs/decisions.md); [license text](LICENSE)). The licensing PR is still draft and unmerged: ownership/authority and third-party provenance remain unverified, and the proposed grant is not effective on `main` merely because the repository or draft PR is public. Verify the actual merged tree and rights before relying on a license grant. No third-party review corpus, credentials, screenshots, or scraped content belongs in this repository.
