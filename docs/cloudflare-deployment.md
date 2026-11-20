# Cloudflare production deployment (prepared, disabled by default)

This is a manual, approval-gated workflow for [D01a #37](https://github.com/Tevpro/store-signal/issues/37), not a deployed application or completion of [D01 #22](https://github.com/Tevpro/store-signal/issues/22). The current `packages/runtime-cloudflare/wrangler.jsonc` and Worker under `src/index.ts` are synthetic local-smoke fixtures. Do not dispatch or deploy them. The workflow fails because the production manifest and application entrypoint do not exist yet; do not add fake IDs merely to make it pass.

## Prerequisites, in order

1. Finish and independently verify the real API/Worker runtime, admission, providers, public noindex page and dispute flow; clear #22's F06 #11, U04 #19, A02 #21 and launch/rights/privacy gates. Review both Node/SQLite and Wrangler-local D1 results. Human approval is still needed for production exposure.
2. Separately provision a real Cloudflare account, zone, production D1 database and *pre-existing* production Worker with its required runtime secrets. Apply reviewed remote schema migrations as a **separate, explicitly approved operation** with backups and validation, never in this workflow. Confirm the Worker can use the D1 binding, route, account, and provider secrets; no auto-provisioning or remote migration is performed here. Cloudflare's Worker secret-list API must be readable before deployment. If a new Worker has no secrets, this deployment workflow intentionally cannot bootstrap it; provision it out of band with an approved procedure.
3. Commit a reviewed `apps/api/src/cloudflare.ts` production entrypoint and `deploy/cloudflare-production.json` manifest (not present now) on a dedicated PR; approve the precise commit. Example **field names only** (replace every placeholder with operator-verified values, not test IDs):

   ```json
   {
     "workerName": "<reviewed-production-worker-name>",
     "entrypoint": "apps/api/src/cloudflare.ts",
     "compatibility_date": "<YYYY-MM-DD>",
     "d1DatabaseName": "<actual-production-database-name>",
     "d1DatabaseId": "<actual-production-d1-uuid>",
     "zoneName": "<actual-zone>",
     "route": "https://<approved-api-host>",
     "publicBaseUrl": "https://<approved-api-host>",
     "requiredSecrets": ["SEARCH_API_KEY", "GOOGLE_PLACES_API_KEY", "<other-real-runtime-secret-names>"]
   }
   ```

   Add every secret the real app actually requires; the baseline Search/Places keys are mandatory. No secret *values* in the manifest. Review the entrypoint's entire import graph, routes, and production config; the guard rejects literal fixture/smoke/local entrypoint text but cannot prove arbitrary imported code is production safe.
4. GitHub `production` environment **already exists** (verified 2026-11-20): it has a `main` branch policy and requires reviewer `newbish`, but `prevent_self_review=false` and `can_admins_bypass=true`. Those settings do **not** establish independent/non-bypass human approval. An authorized operator must require a genuinely independent reviewer, enable self-review prevention and disable admin bypass before any launch; verify the effective protection on the actual repository plan, not merely the environment name. Configure environment secrets `CLOUDFLARE_ACCOUNT_ID` (32-character account ID) and `CLOUDFLARE_API_TOKEN` (scoped token); do not use repository-wide secrets. Allow only the intended Cloudflare account and zone. Minimum Cloudflare access: account Workers Scripts Write for deployment and read of Worker secrets, D1 Read for the preflight database lookup; zone Workers Routes Edit only if route management needs it. Confirm actual Cloudflare permission names in the dashboard for your account and trim any extra scopes. The workflow uses GitHub `contents: read`, pinned action hashes, no persistent checkout credentials and one non-cancellable deployment concurrency group. No environment protections or secrets are changed by this PR.
5. After code-owner and Cassandra exact-head review, locally run pinned `npm ci --ignore-scripts --no-fund`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke:node`, `npm run smoke:worker`, `npm audit --omit=dev`, `node --test tests/cloudflare-deploy.test.mjs`. Confirm the workflow preflight can read the *existing* D1 UUID/name and required pre-provisioned Worker secret names. All Cloudflare HTTP preflight calls are GET only. A real production bundle dry-run follows before remote mutation.
6. Only after a separate operator launch authorization, select **Deploy Cloudflare (manual, gated)** on `main`, enter the exact current reviewed 40-character commit SHA as `commit_sha`, and `deploy <same SHA>` as `confirmation`. Approve the protected environment. If `main` changes before the deploy command the job aborts. No scheduled/push/PR deployment exists.

## Post-deploy / rollback

Check the approved hostname with read-only requests: readiness (including provider configuration), version/commit response if implemented, `/v1` check/status, public `noindex` and dispute status; use synthetic test identities and avoid creating production investigations without explicit approval. Capture Worker logs with secrets redacted and verify D1/Queues binding behavior. No public URL is claimed here. `wrangler deploy` can publish code and route changes; it is not a pure read-only command. Keep the previous known-good artifact/config and documented Wrangler rollback strategy ready; redeploy a prior reviewed commit through a separate authorized process if the release fails. Code rollback does **not** roll back D1 schema or data, provider spend, side effects, or any already-visible public claim. Pause traffic/roll forward a compatible fix when migrations are irreversible. This workflow never applies remote migrations or provisions resources.

References checked 2026-11-20: [Cloudflare GitHub Actions authentication and deployment](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/), [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/), [GitHub workflow syntax and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).
