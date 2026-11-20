import { createAdmission } from "../packages/storage-sqlite/src/admission.ts";
import { createQuotas } from "../packages/storage-sqlite/src/quota.ts";
import { createStorage } from "../packages/storage-sqlite/src/index.ts";
import { d1SqlPort } from "../packages/runtime-cloudflare/src/storage.ts";

const identity = {
  schemaVersion: 1,
  storeId: "domain:example.com",
  origin: "https://example.com",
  registrableDomain: "example.com",
  matchExplanation: "Independent registrable domain",
};
let waiting = 0;
let armed = false;
export default {
  async fetch(request: Request, env: { DB: D1Database }): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ready") return Response.json({ ready: true });
    if (url.pathname === "/arm" && request.method === "POST") {
      waiting = 0;
      armed = true;
      return Response.json({ armed: true });
    }
    if (url.pathname === "/waiting") return Response.json({ waiting });
    if (url.pathname === "/quota-state") {
      const db = d1SqlPort(env.DB);
      return Response.json({
        jobs: await db.query("SELECT id,state FROM investigation_jobs"),
        events: await db.query("SELECT scope,bucket FROM quota_events"),
        violations: await db.query("PRAGMA foreign_key_check"),
      });
    }
    if (url.pathname === "/quota-expiry") {
      const id = url.searchParams.get("id");
      const [row] = await d1SqlPort(env.DB).query(
        "SELECT expires_at FROM assessments WHERE job_id=?",
        [id],
      );
      return Response.json({ expiry: row?.expires_at ?? null });
    }
    if (url.pathname === "/quota-prune" && request.method === "POST") {
      const input = (await request.json()) as { now: string };
      await createStorage(d1SqlPort(env.DB)).prune(input.now);
      return Response.json({ pruned: true });
    }
    if (url.pathname === "/quota-complete" && request.method === "POST") {
      const input = (await request.json()) as {
        id: string;
        name: string;
        at: number;
        now: number;
        secondsExpiry?: boolean;
      };
      if (!/^[a-z0-9-]{1,64}$/.test(input.name))
        return new Response("Invalid name", { status: 400 });
      const storeId = `domain:${input.name}.example`;
      const assessment = {
        schemaVersion: 1,
        id: `result-${input.name}`,
        storeId,
        status: "no_match",
        concern: "insufficient",
        reasonCodes: ["NO_MATCH"],
        confidence: "insufficient",
        evidenceIds: [],
        coverage: [
          {
            schemaVersion: 1,
            connector: "synthetic",
            status: "no_match",
            checkedAt: new Date(input.at).toISOString(),
          },
        ],
        limitations: [],
        checkedAt: new Date(input.at).toISOString(),
        expiresAt: input.secondsExpiry
          ? new Date(input.at + 7 * 86400_000)
              .toISOString()
              .replace(".000Z", "Z")
          : new Date(input.at + 7 * 86400_000).toISOString(),
        aiMode: "none",
        publicationStatus: "draft",
      };
      return Response.json({
        completed: await createAdmission(d1SqlPort(env.DB)).complete(
          input.id,
          1,
          input.now,
          assessment,
        ),
      });
    }
    if (
      (url.pathname === "/quota-check" ||
        url.pathname === "/quota-check-unheld" ||
        url.pathname === "/quota-take") &&
      request.method === "POST"
    ) {
      const input = (await request.json()) as Record<string, unknown>;
      if (typeof input.now !== "number")
        return new Response("Invalid clock", { status: 400 });
      // Test-only fixed server-derived identity; request body tenant/principal ignored.
      // The synthetic anonymousInstall switch simulates separate server-resolved installs
      // behind one trusted edge; not a product identity/authentication mechanism.
      const scope =
        typeof input.anonymousInstall === "number" &&
        Number.isInteger(input.anonymousInstall) &&
        input.anonymousInstall >= 0 &&
        input.anonymousInstall < 1000
          ? {
              principal: `install:rotated-${input.anonymousInstall}`,
              edge: "edge:same-network",
            }
          : { principal: "account:trusted-a", edge: "edge:trusted-network" };
      if (url.pathname === "/quota-take") {
        if (
          input.bucket !== "status" &&
          input.bucket !== "ai" &&
          input.bucket !== "cached" &&
          !(input.bucket === "new" && scope.principal.startsWith("install:"))
        )
          return new Response("Invalid bucket", { status: 400 });
        const result = await createQuotas(d1SqlPort(env.DB)).take(
          input.bucket,
          scope,
          input.now,
        );
        return Response.json(
          result.allowed
            ? { allowed: true }
            : { allowed: false, retryAfterMs: result.retryAfterMs },
        );
      }
      if (
        typeof input.id !== "string" ||
        typeof input.name !== "string" ||
        !/^[a-z0-9-]{1,64}$/.test(input.name)
      )
        return new Response("Invalid job", { status: 400 });
      if (armed && url.pathname !== "/quota-check-unheld") {
        waiting++;
        while (armed)
          await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      const store = {
        schemaVersion: 1,
        storeId: `domain:${input.name}.example`,
        origin: `https://${input.name}.example`,
        registrableDomain: `${input.name}.example`,
        matchExplanation: "Synthetic independent store",
      };
      return Response.json(
        await createAdmission(d1SqlPort(env.DB)).check(
          store,
          input.id,
          input.now,
          false,
          scope,
        ),
      );
    }
    if (url.pathname === "/release" && request.method === "POST") {
      armed = false;
      return Response.json({ released: true });
    }
    if (
      (url.pathname === "/check" || url.pathname === "/admin-check") &&
      request.method === "POST"
    ) {
      const input: unknown = await request.json();
      if (!input || typeof input !== "object")
        return new Response("Invalid input", { status: 400 });
      const { id, now } = input as Record<string, unknown>;
      if (typeof id !== "string" || typeof now !== "number")
        return new Response("Invalid input", { status: 400 });
      if (armed) {
        waiting++;
        while (armed)
          await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      // /admin-check is a synthetic, test-only capability, not a production auth route.
      return Response.json(
        await createAdmission(d1SqlPort(env.DB)).check(
          identity,
          id,
          now,
          url.pathname === "/admin-check",
        ),
      );
    }
    if (url.pathname === "/complete" && request.method === "POST") {
      const input = (await request.json()) as {
        id: string;
        generation: number;
        now: number;
        assessment: unknown;
      };
      return Response.json({
        completed: await createAdmission(d1SqlPort(env.DB)).complete(
          input.id,
          input.generation,
          input.now,
          input.assessment,
        ),
      });
    }
    if (url.pathname === "/state") {
      const db = d1SqlPort(env.DB);
      return Response.json({
        jobs: await db.query(
          "SELECT id,state,generation,created_at FROM investigation_jobs ORDER BY id",
        ),
        assessments: await db.query(
          "SELECT job_id,id,expires_at FROM assessments ORDER BY job_id",
        ),
        violations: await db.query("PRAGMA foreign_key_check"),
      });
    }
    return new Response("Not found", { status: 404 });
  },
};
