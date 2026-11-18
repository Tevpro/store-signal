# StoreSignal PR review and delivery gate

Keith's project rule: Cassandra, reached through the configured authenticated A2A peer `review`, reviews **every** StoreSignal pull request. This applies to planning, documentation, code and follow-up PRs. A previous review does not cover a changed head.

## Handoff and evidence

1. For each open PR, send Cassandra its URL, linked GitHub issue/Plane card, exact head commit, acceptance criteria and validation evidence using the configured A2A client. Keep credentials and private data out of the message. A GitHub reviewer request or local default-profile review alone is not delivery to Cassandra.
2. Capture the returned A2A task/context ID, acknowledgement and verdict, or the precise connection/authorization failure. A submitted message with no acknowledgement is **pending**, not reviewed. Request an actual GitHub review from Cassandra's account only after she confirms that account; do not guess a mapping from a Slack ID.
3. Resolve her **Blocking** findings; record dispositions for **Non-blocking** findings without treating every suggestion as a merge blocker. Create focused fixes on the owning issue/PR, push tested corrections, and ask Cassandra to re-review the **new** head. Record links to her review and resolution evidence on the PR and Plane card. Human approval of provider terms, license, paid usage, public release and production deployment remains separate.
4. Merge only after Cassandra's current-head verdict clears, all blocking findings and GitHub conversations are resolved, required CI and repository protection pass, and the PR does not prematurely close an issue whose acceptance is incomplete. Until then, continue only already operator-authorized, dependency-cleared local work under `AGENTS.md`; do not claim cards or spawn workers merely because a PR awaits review. A partial PR uses `References #N`; use `Closes #N` only after every acceptance criterion is verified. The existing `AGENTS.md` instruction to use `Closes #N` has not yet been reconciled because that file is protected; this more restrictive rule prevents premature issue closure pending approved owner edit.

## Review peer access checkpoint

When this rule was introduced, the configured HTTPS Agent Card fetch and authenticated A2A client failed with connection refused. On November 18, 2026, after Keith reported restoration, the Agent Card returned HTTP 200 and authenticated A2A context `ctx-f4277440df244f3e` completed: Cassandra confirmed that the PR #32 review comment was hers and identified her GitHub publishing account as `tevnull`. That account also authored #32, so her substantive assessment does **not** satisfy independent GitHub code-owner approval. Future outages leave reviews pending; do not weaken TLS/auth or infer approval from transport alone.

## Working-app completion evidence

A working app requires a real click-to-check extension and API path with cached/async check states, evidence-backed result with source/coverage disclosure, and runnable verification on Wrangler local Worker and Node/SQLite self-hosted runtimes. Provider-specific features remain gated by written rights, configured credentials and approved tests. A planning PR, synthetic fixture, unmerged scaffold or scheduled controller is not a working app.
