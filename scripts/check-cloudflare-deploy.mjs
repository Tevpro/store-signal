import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCOUNT = /^[0-9a-f]{32}$/i;
const NAME = /^[a-z][a-z0-9-]{2,62}$/;
const SHA = /^[0-9a-f]{40}$/i;
const FIXTURE = /fixture|smoke|local|sample|synthetic|test/i;
const REQUIRED_SECRETS = ["SEARCH_API_KEY", "GOOGLE_PLACES_API_KEY"];
const ENTRYPOINT = "apps/api/src/cloudflare.ts";
const MANIFEST = "deploy/cloudflare-production.json";

export function validate({ manifest, env, source }) {
  if (
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    !SHA.test(env.GITHUB_SHA ?? "") ||
    env.GITHUB_SHA !== env.DEPLOY_SHA ||
    env.CONFIRM_DEPLOY !== `deploy ${env.GITHUB_SHA}`
  )
    throw Error(
      "Manual main-branch dispatch, exact commit and confirmation required",
    );
  if (
    !ACCOUNT.test(env.CLOUDFLARE_ACCOUNT_ID ?? "") ||
    !env.CLOUDFLARE_API_TOKEN?.trim()
  )
    throw Error("Cloudflare account ID and API token required");
  if (
    !manifest ||
    Object.keys(manifest).sort().join(",") !==
      [
        "compatibility_date",
        "d1DatabaseId",
        "d1DatabaseName",
        "entrypoint",
        "publicBaseUrl",
        "requiredSecrets",
        "route",
        "workerName",
        "zoneName",
      ]
        .sort()
        .join(",")
  )
    throw Error(
      "Reviewed production manifest with all required fields is required",
    );
  if (
    !NAME.test(manifest.workerName ?? "") ||
    FIXTURE.test(manifest.workerName) ||
    !NAME.test(manifest.d1DatabaseName ?? "") ||
    FIXTURE.test(manifest.d1DatabaseName)
  )
    throw Error("Production Worker and D1 names must not be local fixtures");
  if (
    !UUID.test(manifest.d1DatabaseId ?? "") ||
    /^0+$/.test(manifest.d1DatabaseId.replaceAll("-", ""))
  )
    throw Error("Real D1 UUID required");
  if (
    manifest.entrypoint !== ENTRYPOINT ||
    FIXTURE.test(source) ||
    !source.trim()
  )
    throw Error(
      "Production app entrypoint required; fixture Worker prohibited",
    );
  if (
    !NAME.test(manifest.zoneName ?? "") &&
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(manifest.zoneName ?? "")
  )
    throw Error("Reviewed Cloudflare zone name required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(manifest.compatibility_date ?? ""))
    throw Error("Compatibility date required");
  for (const field of ["publicBaseUrl", "route"]) {
    const value = manifest[field];
    if (
      typeof value !== "string" ||
      FIXTURE.test(value) ||
      !value.startsWith("https://")
    )
      throw Error(`Production ${field} must be an explicit HTTPS URL`);
    const url = new URL(value);
    if (
      !url.hostname.includes(".") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      url.hostname.endsWith(".example") ||
      url.hostname.endsWith(".workers.dev") ||
      (field === "route" &&
        !url.hostname.endsWith(`.${manifest.zoneName}`) &&
        url.hostname !== manifest.zoneName)
    )
      throw Error(`Production ${field} must name a reviewed public host`);
  }
  if (
    !Array.isArray(manifest.requiredSecrets) ||
    !REQUIRED_SECRETS.every((s) => manifest.requiredSecrets.includes(s)) ||
    manifest.requiredSecrets.length !==
      new Set(manifest.requiredSecrets).size ||
    manifest.requiredSecrets.some((s) => !/^[A-Z][A-Z0-9_]*$/.test(s))
  )
    throw Error("Search and Places runtime secret names required");
  return manifest;
}

export async function checkRemote(manifest, env, fetcher = fetch) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}`;
  const headers = { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` };
  async function get(path) {
    const response = await fetcher(`${base}/${path}`, { headers });
    if (!response.ok)
      throw Error("Cloudflare read-only prerequisite check failed");
    const body = await response.json();
    if (body.success !== true)
      throw Error("Cloudflare read-only prerequisite check failed");
    return body.result;
  }
  const database = await get(`d1/database/${manifest.d1DatabaseId}`);
  if (
    database?.uuid !== manifest.d1DatabaseId ||
    database?.name !== manifest.d1DatabaseName
  )
    throw Error("D1 UUID/name not found in authorized account");
  const secrets = await get(`workers/scripts/${manifest.workerName}/secrets`);
  if (
    !Array.isArray(secrets) ||
    !manifest.requiredSecrets.every((s) =>
      secrets.some((item) => item.name === s),
    )
  )
    throw Error("Pre-provisioned Worker runtime secrets are missing");
}

export async function main() {
  const root = resolve(import.meta.dirname, "..");
  const manifest = JSON.parse(await readFile(resolve(root, MANIFEST), "utf8"));
  const source = await readFile(resolve(root, manifest.entrypoint), "utf8");
  validate({ manifest, env: process.env, source });
  await checkRemote(manifest, process.env);
  const wrangler = {
    name: manifest.workerName,
    main: `../../${ENTRYPOINT}`,
    compatibility_date: manifest.compatibility_date,
    workers_dev: false,
    routes: [
      {
        pattern: new URL(manifest.route).hostname + "/*",
        zone_name: manifest.zoneName,
      },
    ],
    d1_databases: [
      {
        binding: "DB",
        database_name: manifest.d1DatabaseName,
        database_id: manifest.d1DatabaseId,
      },
    ],
    vars: { APP_ENV: "production", PUBLIC_BASE_URL: manifest.publicBaseUrl },
  };
  const out = resolve(
    root,
    "packages/runtime-cloudflare/wrangler.production.generated.json",
  );
  await writeFile(out, JSON.stringify(wrangler, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    "Production prerequisites verified (read-only); deploy config generated. No mutation performed.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(`Deployment preflight refused: ${error.message}`);
    process.exitCode = 1;
  });
}
