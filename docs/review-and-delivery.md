# StoreSignal PR review and delivery gate

Keith's project rule: Cassandra, reached through the configured authenticated A2A peer `review`, reviews **every** StoreSignal pull request. This applies to planning, documentation, code and follow-up PRs. A previous review does not cover a changed head.

## Handoff and evidence

1. For each open PR, send Cassandra its URL, linked GitHub issue/Plane card, exact head commit, acceptance criteria and validation evidence using the configured A2A client. Keep credentials and private data out of the message. A GitHub reviewer request or local default-profile review alone is not delivery to Cassandra.
2. Capture the returned A2A task/context ID, acknowledgement and verdict, or the precise connection/authorization failure. A submitted message with no acknowledgement is **pending**, not reviewed. Request an actual GitHub review from Cassandra's account only after she confirms that account; do not guess a mapping from a Slack ID.
3. Treat her actionable findings as blocking. Create focused fix cards on the owning issue/PR, push tested corrections, and ask Cassandra to re-review the **new** head. Record links to her review and resolution evidence on the PR and Plane card. Human approval of provider terms, license, paid usage, public release and production deployment remains separate.
4. Merge only after Cassandra's current-head verdict clears, all blocking findings and GitHub conversations are resolved, required CI and repository protection pass, and the PR does not prematurely close an issue whose acceptance is incomplete. Until then, keep work on independent local components moving without merging blocked PRs.

## Current access boundary

The configured `review` peer URL was present, but the HTTPS Agent Card fetch and the configured authenticated A2A client both failed with connection refused when this rule was introduced. No Cassandra review or GitHub identity was verified. Restore that existing service through its approved operator path; do not weaken TLS/auth, use a guessed GitHub account, or claim transport failure as a review.

## Working-app completion evidence

A working app requires a real click-to-check extension and API path with cached/async check states, evidence-backed result with source/coverage disclosure, and runnable verification on Wrangler local Worker and Node/SQLite self-hosted runtimes. Provider-specific features remain gated by written rights, configured credentials and approved tests. A planning PR, synthetic fixture, unmerged scaffold or scheduled controller is not a working app.
