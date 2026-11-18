# G03 Google Places feasibility: discovery checkpoint

Status: **conditional / not approved for public ratings**. Research checked 2026-11-18 against Google's published documentation; no Google project, key, billing account, live response, account quota, or product-specific license approval was inspected. This document does **not** satisfy the live-access or bounded live-sample acceptance criteria in [GitHub #3](https://github.com/Tevpro/store-signal/issues/3). It records the decision gates before any connector or public result is built. Plane: [STSIG-3](https://plane.tevpro.com/tevpro/browse/STSIG-3).

## Feasibility and critical terms conflict

- Places API (New) can search text and fetch details by place ID using HTTPS and an explicit field mask. A search response can include `places.id`, `places.displayName`, `places.websiteUri`, and `places.googleMapsUri`; `websiteUri`, `rating` and `userRatingCount` trigger the **Text Search Enterprise** SKU. Details by ID can request `id,displayName,websiteUri,rating,userRatingCount,googleMapsUri`; `rating`/`userRatingCount` trigger **Place Details Enterprise**. Do not request `reviews` unless specifically approved: details documents describe a higher tier with review text.[2][3]
- **Blocking design conflict:** the product's one-week cached/public assessment and stored evidence cannot assume a one-week copy of Google's rating/count, name, address, website URL, or review bodies. Google says Places content must not be pre-fetched, cached or stored except permitted exceptions, and expressly exempts *place IDs*; its policies also restrict derived content based on Google Maps Content. The Maps Platform Terms explicitly prohibit caching Maps Content except as permitted and creating content based on Maps Content; Service Specific Terms explicitly permit caching eligible Google IDs including `place_id`. A stored risk classification derived from a Google rating, even without persisting the number, needs explicit legal/product approval, not an engineering guess.[1][7][9]
  Until counsel/provider approval, keep any fetched fields ephemeral, store only place ID if authorized, and do not expose a Google-derived public verdict or snapshot.[10] Existing `docs/requirements.md` launch gate remains unresolved.
- For a licensed display without a map, Google requires the Google Maps logo/appropriate attribution, visible distinction from non-Google content, and third-party attributions where supplied. If displaying individual reviews, author credit and direct Google Maps access are required; avoid review text entirely at this checkpoint. Applications need publicly accessible terms and privacy policy incorporating Google's terms/privacy policy. Document the exact extension, API, and public-page attribution design before launch; a plain hyperlink alone is not an approved substitute.[1]
- Google's documentation is not legal approval for a public, shareable risk assessment, bulk investigation, white-label self-hosting, or redistributed snapshots. Operator/legal must review current Maps Platform Terms and Service Specific Terms, applicable billing region/EEA terms, derivative/public-cache rights, attribution, termination/deletion obligations, and each deployment's account ownership. Do not treat a public repo as a license grant.[1]

## Costs, quotas, and bounded request shape

The published pay-as-you-go pricing table checked 2026-11-18 lists **Text Search Enterprise: 1,000 free monthly billable events, then $35/1,000 in the first paid tier**; **Place Details Enterprise: 1,000 free, then $20/1,000**. The cheaper IDs-only Text Search field mask can discover candidates, but does not supply website identity proof; a follow-up Enterprise Details request is needed for every inspected candidate. If Text Search requests `websiteUri` directly, that search itself is Enterprise. These are list prices and published SKU caps, not a cost forecast, negotiated terms, a guaranteed free trial, or a verified project quota; check console pricing/budget before an authorized sample. Field masks and pagination affect billed calls.[2][3][5]

Places API (New) quotas are **per API method per project, per minute**; the operator must read actual project quotas in Google Cloud Console, set conservative budget alerts/limits, and specify handling of 429/403, bounded retries and circuit breaking. The product's one-investigation-per-store/minute and weekly *assessment* freshness are separate product limits, not Google's quota or permission to cache Places data. No live quota is verified here.[4]

Proposed smallest *approved* sample (not executed): select a small, operator-approved list containing a domain-anchored exact match, similarly named different store, tenant store, no listing, and conflicting multi-location candidates. Use Text Search with `places.id,nextPageToken` and a bounded page size; request targeted Details for at most a small fixed candidate set with `id,displayName,websiteUri,googleMapsUri,rating,userRatingCount` **only if terms permit rating use**. Count calls by SKU and log only redacted request metadata, status, field mask and timing; never log keys or review text. Stop on quota/cost ceiling, ambiguity or outage.[2][3][4]

Sample must run separately on Worker and Node runtime via server-side HTTPS; no browser extension key.[6]

## Credential and runtime compatibility

A Google Cloud project with billing enabled and Places API (New) enabled is required. Server-side HTTPS REST and field masks are runtime-neutral in principle; **no Worker or Node adapter or dual-runtime integration harness exists yet**, so compatibility is architectural, not executed. The operator must provision authorized credentials separately for hosted Cloudflare Worker and conventional self-hosted Node, with secrets injected server-side, API scope limited to Places API (New), rotation and budget controls. Google recommends application and API restrictions; server web-service API keys can use known source IPs, but dynamic cloud egress may make that impractical. Evaluate Google-supported OAuth/server-to-server auth or a controlled egress proxy for Worker deployment, and test restrictions from actual egress before claiming secure compatibility. A customer's self-hosted project/billing and policy obligations must be independently verified; never share the hosted credential, bake it into an image, or send it to the extension.[6][8]

## Identity contract proposal, **not** live-validated

Inputs are the separately validated `StoreIdentity` origin/domain/tenant identity from `docs/architecture.md`, not a client-asserted canonical store. Search query derives from trusted operator inputs or bounded normalized domain, with no arbitrary URL fetch. Google `websiteUri` is candidate evidence, **not** an independently verified business directory or proof of domain ownership. Implement with a public-suffix-aware registrable-domain comparison and reviewed hosted-tenant registry; URL parsing must reject non-HTTP(S), userinfo, loopback/private destinations, misleading suffixes and redirect-based identity changes. Never follow a candidate `websiteUri` without full SSRF checks.

Decision stages:
1. `unavailable`/`failed`: connector misconfiguration, auth/billing failure, quota exhaustion or transport error; never convert into `no_match`. The mandatory connector must fail readiness if not configured. A healthy empty bounded search is `no_match` (subject to search coverage limitation); no inferred Google rating.
2. Discard candidate only when exact identity is disproved, e.g., `shop.example.com.evil.test`, another hosted tenant, unrelated registrable domain, franchise sibling or marketplace seller. Name similarity, city, address, category, stars and Google rank **never** establish exact store identity.
3. `candidate`: exact normalized website host, or same registrable domain *only when* site is a reviewed independent custom-domain store and not a multi-tenant/marketplace host. Require linked site evidence and corroborating business name/location where applicable, distinguish a national brand from an individual location. Missing website URI or only a name match is `ambiguous`, not usable. A same-domain URL can still be a corporate branch, stale listing, or user-supplied imitation; human review/authorized cross-check needed before trusting it.
4. `ambiguous`: multiple distinct place IDs surviving checks, conflicting websites/brands/locations, moved/closed listing without verified successor, or only weak association. Do not choose the highest-ranked or lowest-rated candidate. `matched` requires exactly one proven entity, recorded rationale, source URL/ID and retrieval time; absent this, **no rating or count enters scoring or public display**.
5. A healthy `no_match` or `ambiguous` is a store-specific coverage result, not proof of safety or fraud. Google's `placeId` may be stored under its documented exception and should be refreshed when older than 12 months; do not equate an ID with a permanent identity.[1][7]

See [synthetic fixture cases](fixtures/g03-place-identity.json). They specify expected *manual* match decisions, not tested product code or a real provider response. No provider payload or copied third-party reviews are committed.

## Operator gates / unresolved prerequisites

| Gate | Owner evidence required | Current state |
| --- | --- | --- |
| Account | Google Cloud project, enabled Places API (New), billing, restricted server credential for each deployment, no secret in issue/PR | **Not verified** |
| Rights | Written legal/provider decision for rating/count use in public risk assessments, derived decisions, weekly cache and self-hosted redistribution; no production until resolved | **Blocking** |
| Presentation | Terms/privacy, logo and third-party attribution mockups for extension/API/public pages, reviewed against current policies | **Not reviewed** |
| Budget | Actual console quotas, billing geography, SKU pricing, alerts, ceilings, auth/429 behavior | **Not verified** |
| Validation | Approved bounded live sample and exact-match adjudication, negative cases, actual Worker + Node egress and integration results | **Not executed** |
| Launch | Independent review, correction workflow, noindex, provider configuration/readiness; unrelated search provider gate | **Outside G03, still required** |

Rollback for this docs-only checkpoint: revert the PR. No production feature, provider call, data migration, account change, or rating display was made.

## Sources

[1] https://developers.google.com/maps/documentation/places/web-service/policies
[2] https://developers.google.com/maps/documentation/places/web-service/text-search
[3] https://developers.google.com/maps/documentation/places/web-service/place-details
[4] https://developers.google.com/maps/documentation/places/web-service/usage-and-billing
[5] https://developers.google.com/maps/billing-and-pricing/pricing
[6] https://developers.google.com/maps/documentation/places/web-service/get-api-key
[7] https://developers.google.com/maps/documentation/places/web-service/place-id
[8] https://developers.google.com/maps/api-security-best-practices
[9] https://cloud.google.com/maps-platform/terms
[10] https://cloud.google.com/maps-platform/terms/maps-service-terms
