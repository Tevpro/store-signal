---
name: store-signal-delivery
description: Deliver StoreSignal issues with evidence and dual-runtime tests.
version: 0.1.0
license: pending # effective grant awaits rights verification and merge
license_choice: Apache-2.0
metadata:
  hermes:
    tags: [store-signal, evidence, browser-extension, cloudflare]
---

# StoreSignal delivery

Use when a delegated worker implements or reviews a StoreSignal GitHub issue. This is repo-local guidance; load explicitly with `AGENTS.md` if the runtime does not discover repo skills. Keith recorded Apache-2.0 for Tevpro-owned project code, but the license PR is draft/unmerged and ownership/authority has not been verified; public visibility is not a grant.

## Procedure

1. Read `AGENTS.md`, requirements, architecture, standards, decisions, assigned GitHub issue and linked Plane card. Verify that a package path in architecture is a proposal until it actually exists.
2. Claim one issue in Plane, confirm dependency PRs and exact scope, and work in an isolated branch/worktree. Do not start other workers.
3. Write failing tests or synthetic fixtures for the behavior, including missing evidence, identity mismatches and security boundaries. Implement minimal code through ports so Cloudflare and Node backends stay interchangeable.
4. Run focused tests and affected lint/typecheck/build; shared changes also run D1/Wrangler and SQLite/Node integration checks. Record actual results, not expected outputs.
5. Open a scoped PR linked to the GitHub issue and Plane card; include tests, risk, evidence and rollback. Update Plane to QA Review only after verified implementation; independent review and human public-release approval remain separate.

## Pitfalls

- No source/review results from a configured provider is different from provider unavailable. A missing Google Business Profile is not a failed connector.
- Similar business names and repeated Reddit allegations are not corroboration.
- A D1 read then write is not an atomic global cooldown. Test concurrent requests.
- BYOK analysis is private; only evidence-validated managed AI may change shared public assessments.
- The recorded choice is Apache-2.0, superseding the earlier AGPL-3.0-only decision. A public repo or draft license PR is not an effective grant on `main`; verify rights, merged status and dependency provenance before asserting reuse rights.

## Verification

Check issue acceptance item by item, linked PR/Plane status, exact test output, public-page publication gate, and both runtime targets when required. Block with explicit missing prerequisites rather than presenting a stub as done.
