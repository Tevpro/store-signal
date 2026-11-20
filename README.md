# StoreSignal

Planned evidence-backed assessments of unfamiliar online stores. **Only a local, synthetic dual-runtime fixture harness exists; there is no runnable store checker or provider integration yet.** The first clients will be a click-to-check Chrome/Chromium extension and a versioned API, deployable on Cloudflare Workers or a conventional self-hosted server from the same codebase. Product code, deployment adapters, shared contracts, docs, and repo-local worker skills belong in this repository, not in separate runtime-specific repos.

## Start here

- [Requirements and launch gates](docs/requirements.md)
- [System architecture and contracts](docs/architecture.md)
- [Coding standards](docs/coding-standards.md)
- [Agent/worker playbook](AGENTS.md) and [project skill](skills/store-signal/SKILL.md)
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

`smoke:worker` runs `wrangler d1 migrations apply --local` in a temporary directory, starts `wrangler dev --local` bound to loopback, checks `/smoke` over HTTP and cleans up. `smoke:node` exercises native SQLite in memory. `build` emits Node JS and bundles the Worker with Wrangler `--dry-run` only; it does **not** deploy. These fixtures prove only local database/runtime wiring and schema parity, not store identity, source verification, job admission, public ratings or launch readiness. The Worker config contains a synthetic all-zero local D1 ID; never use it for production deployment. Provider rights, credentials and terms remain gated by G02/G03.

## Status and licensing

Created by [Tevpro](https://tevpro.com). Community contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

Keith has recorded the choice of **Apache-2.0** for Tevpro-owned project code, with DCO 1.1 sign-offs and a separate trademark policy ([decision record](docs/decisions.md); [license text](LICENSE)). The licensing PR is still draft and unmerged: ownership/authority and third-party provenance remain unverified, and the proposed grant is not effective on `main` merely because the repository or draft PR is public. Verify the actual merged tree and rights before relying on a license grant. No third-party review corpus, credentials, screenshots, or scraped content belongs in this repository.
