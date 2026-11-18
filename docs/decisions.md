# Decision record

## Confirmed

- Public repository and intended open-source product; license **deferred**, no license grant yet.
- Click-to-check Chrome/Chromium v1; store risk with citations first; product/image comparison later. No screenshot or full-HTML capture in v1.
- Hosted API + self-hosted packaging both support Cloudflare Workers and Node/SQLite from first public release. Shared core and versioned contract.
- Public shareable noindex store pages. Owner verification DNS TXT/file; corrections remain public and get human review when credible. Routine refresh history internal; corrections visible.
- Concern level + evidence confidence, no numeric score. Weekly cache, early refresh owner/admin only. 5 new investigations/min/user, 30 cached lookups/min/user, one new investigation per store/min globally, separate polling/AI limits.
- Anonymous limited hosted checks; account required for managed AI (small free allowance then paid). BYOK key encrypted server-side; BYOK result private. Managed AI requested by logged-in user may propose public rating after citation validation. Non-AI results clearly limited.
- Google/Reddit trusted reviews only: exact GBP match; Google rating below 3.0 with 20+ reviews may support High concern after validation; one Reddit thread can support Caution but High needs corroboration. Reddit search-indexed direct links acceptable v1, no complete-coverage claim. Configured licensed search and Google Places connectors mandatory at startup.
- Missing trusted reviews push Caution, reason `limited independent track record`; a distinct Caution reason for negative evidence. Exception for Low without reviews: linked verified business identity from an actually verifying directory/provider and 1+ year independently verified operation. Few complaints alone not bad.
- Risky label comprises credible non-delivery, deceptive listings, payment abuse, repeated refund refusal. Launch benchmark: >=80% risky stores Caution/High and <=5% false High among High verdicts on adjudicated representative set. Prefer catching risky stores, within the false-High ceiling.
- US/English first; independent stores and separate hosted tenant subdomains; no marketplace sellers in v1. Chrome/Chromium first, Firefox later.

## Open, do not guess

- OSI license, contributor license and trademark policy before release.
- Approved search provider terms and cost; Google Places identity, display/attribution, caching and payment rules; exact approval of indexed Reddit snippets/link handling. Product launch blocked until both connectors configured and verified. **A search result is not a Reddit data-API license.**
- Final paid AI allowance/pricing and tenant quota structure. Exact provider adapters and app frameworks/package manager selected in foundation issues, not implied by diagrams.
- Evaluation dataset composition, reviewer adjudication protocol, confidence intervals, correction response target and security/privacy retention schedule. No benchmark claim without real measurement.
