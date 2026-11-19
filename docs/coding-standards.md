# Coding and review standards

## Source, boundaries and structure

- TypeScript `strict`, explicit runtime validation at HTTP/provider/queue boundaries, exported contract schemas versioned and tested. No `any`, implicit casts of untrusted JSON, hidden provider SDK types in core, or catch-and-return-success patterns.
- `packages/core` must be deterministic and import no Worker, Node, network or database APIs. External I/O behind narrow ports. Pure rating functions take immutable normalized evidence and coverage; include reason codes and evidence IDs.
- One task/issue per PR where practical. Small modules and reviewable diffs; no giant handler with HTTP, scraping, scoring, storage and AI in one file. Add migrations for schema changes and test them on D1 and local SQLite.
- Put reusable or nontrivial object models, interfaces, and schemas in a dedicated `models/`, `types/`, or `schemas/` module (whichever fits the package), separate from handlers, validators, and other implementation logic. Group related contracts in a focused file rather than creating a file for every interface. Keep the public import path stable with type-only imports/re-exports where needed; avoid circular runtime imports. Small, simple one-off output shapes can stay beside their sole use.
- No speculative image-matching implementation in v1. Code may express future-compatible interfaces, but avoid empty provider classes and disconnected abstractions.

## Safety and correctness

- Public claims are evidence-backed. The High concern publication gate validates source URL/identity/independence/recency and cited IDs. Do not let free-text AI output set a public verdict without validation. Differentiate no-match, no-access, and not-checked.
- Reject non-public destinations, credentialed URLs, redirects to private ranges, huge pages, and unsafe schemes on **every** fetch path, including AI provider overrides. Treat extension metadata, search snippets, Reddit content and Google data as untrusted. Never fetch user-provided URL with user cookies.
- Redact secrets, account identifiers and browsing paths from logs. No secrets in GitHub issues/PRs/fixtures; synthetic fixtures only. BYOK keys encrypted server-side, deletable and scoped to account; do not log or return them.
- Rate limiting and single-flight are atomic under concurrency. Test 5 new investigations/min/user, 30 cached lookups/min/user, one new per store globally/minute, stale cache/weekly refresh, and separate polling/AI budgets. Do not claim an install token is a secure identity.
- Public `noindex`, correction notices, verified-owner refresh and moderation workflows are release requirements in both deployments.

## Tests and required PR evidence

- Every code issue starts with a failing focused test or reproducible fixture, then implementation and passing test. Unit tests for classification, subject matching, limits and cache keys; contract tests for every connector; integration tests for both Wrangler local runtime and Node/SQLite; extension tests for click-only permissions; race tests for duplicate requests; browser smoke for public correction flow.
- Every PR body links the GitHub issue and Plane card, lists changed contracts/data/migrations, exact commands + outputs, failure cases/coverage, security and privacy implications, and rollout/rollback. No claim of live deployment from local tests.
- Run formatting, lint, typecheck, tests, build and dependency audit in the affected packages. Full cross-runtime validation for shared contracts or storage changes. Do not merge on unverified CI or unresolved review comments.

## Dependencies and release

Pin package manager/runtime versions and commit lockfile when implementation begins. Prefer audited dependencies compatible with both Workers and Node for shared packages; verify rather than assuming Node compatibility. Keep generated code and fixtures documented. Use small explicit migrations and rollback notes. License selection remains open; do not add a guessed LICENSE or copy third-party material into this public repository.
