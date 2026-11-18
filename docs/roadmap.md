# Delivery roadmap and worker sequencing

GitHub Issues carry acceptance criteria; Plane mirrors implementation ownership and status. The GitHub Project is the planning view. Do not move all issues to In Progress or dispatch workers until the prerequisites below pass.

1. **Gate 0: feasibility and governance.** License decision; approved search/Google Places terms and access; source identity policy, privacy/dispute/publication threat model; initial labeled evaluation plan. No expensive connector implementation before rights are confirmed.
2. **Foundation: dual-runtime skeleton.** Shared versioned contracts, deterministic evidence core, D1 and SQLite migrations, atomic job admission/limits, API test harness and CI. Prove same fixtures in Wrangler local and Node before delegating separate connectors.
3. **Evidence: independent connectors.** Search-indexed Reddit results, exact-entity Google Business Profile, verified business/operating history, coverage failure states; contract tests with synthetic examples and bounded live smoke by credential-aware operator.
4. **Experience: extension + public pages.** Click-to-check Chrome MV3, cached/checking states, noindex shareable pages, owner verification, disputes/corrections, operational response process.
5. **AI and launch gates.** Pluggable provider ports, private encrypted BYOK, managed AI budget/billing and validation/publication gate. Independent evaluation set, security/privacy review, two-target deployment smoke. Public launch only after gates in requirements pass.
6. **Later:** product/image matching, alternatives, screenshots only by explicit consent, anti-evasion, marketplace sellers, Firefox, broader locales.

Parallelize connectors, extension and public UI only after shared contracts are merged. Review independent of implementation. Each worker gets a single issue and clean branch; never assign the whole project to one agent or automatically dispatch the full board.
