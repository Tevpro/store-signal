---
name: store-signal-delivery
description: Deliver StoreSignal issues with evidence and dual-runtime tests.
version: 0.1.0
license: pending
metadata:
  hermes:
    tags: [store-signal, evidence, browser-extension, cloudflare]
---

# StoreSignal delivery

Use when a delegated worker implements or reviews a StoreSignal GitHub issue. This is repo-local guidance; load explicitly with `AGENTS.md` if the runtime does not discover repo skills. The repository is public but its software license is undecided.

## Procedure

1. Read `AGENTS.md`, requirements, architecture, standards, decisions, assigned GitHub issue and linked Plane card. Verify that a package path in architecture is a proposal until it actually exists.
2. Claim one issue in Plane, confirm dependency PRs and exact scope, and work in an isolated branch/worktree. Do not start other workers.
3. Write failing tests or synthetic fixtures for the behavior, including missing evidence, identity mismatches and security boundaries. Implement minimal code through ports so Cloudflare and Node backends stay interchangeable.
4. Run focused tests and affected lint/typecheck/build; shared changes also run D1/Wrangler and SQLite/Node integration checks. Record actual results, not expected outputs.
5. Open a scoped PR linked to the GitHub issue and Plane card; include tests, risk, evidence and rollback. Update Plane to QA Review only after verified implementation. Request Cassandra's review through the configured authenticated A2A peer `review` for every PR, resolve her findings and obtain re-review of the current head before merge. A local self-review does not count. See `docs/review-and-delivery.md`; human public-release approval remains separate.

## Pitfalls

- No source/review results from a configured provider is different from provider unavailable. A missing Google Business Profile is not a failed connector.
- Similar business names and repeated Reddit allegations are not corroboration.
- A D1 read then write is not an atomic global cooldown. Test concurrent requests.
- BYOK analysis is private; only evidence-validated managed AI may change shared public assessments.
- A public repo with no license is not yet an open-source grant. Do not assume Apache or AGPL is selected.

## Verification

Check issue acceptance item by item, linked PR/Plane status, exact test output, public-page publication gate, and both runtime targets when required. Block with explicit missing prerequisites rather than presenting a stub as done.
