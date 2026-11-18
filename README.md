# StoreSignal

Open-source, evidence-backed assessments of unfamiliar online stores. **Planning monorepo: no runnable checker exists yet.** The first clients will be a click-to-check Chrome/Chromium extension and a versioned API, deployable on Cloudflare Workers or a conventional self-hosted server from the same codebase. Product code, deployment adapters, shared contracts, docs, and repo-local worker skills belong in this repository, not in separate runtime-specific repos.

## Start here

- [Requirements and launch gates](docs/requirements.md)
- [System architecture and contracts](docs/architecture.md)
- [Coding standards](docs/coding-standards.md)
- [Agent/worker playbook](AGENTS.md) and [project skill](skills/store-signal/SKILL.md)
- [Delivery phases and dependencies](docs/roadmap.md)
- [Decisions and unresolved questions](docs/decisions.md)
- [Contributing](CONTRIBUTING.md) | [Security](SECURITY.md)

## Work ledgers

GitHub Issues and the GitHub Project are the technical backlog and code/PR ledger. Plane is the internal assignment/status ledger. Every Plane work item must link its canonical GitHub issue, and every implementation PR must link both. **Nothing is assigned or running just because a card exists.** See [AGENTS.md](AGENTS.md).

## Status and licensing

This repository is public for architecture review, but a software license has **not** been selected. Public visibility does not grant reuse rights. Selecting and adding an OSI-approved license is an explicit pre-release issue. No third-party review corpus, credentials, screenshots, or scraped content belongs in this repository.
