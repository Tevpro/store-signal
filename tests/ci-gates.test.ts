import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const { scripts } = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};

test("CI names independent format, lint, strict typecheck, test, build and full audit gates", () => {
  for (const name of [
    "Formatting",
    "Lint",
    "Strict typecheck",
    "Unit and integration tests",
    "Build (Worker dry-run only)",
    "Audit all dependencies",
  ]) {
    assert.ok(workflow.includes(`- name: ${name}`), `missing CI gate: ${name}`);
  }
  assert.match(workflow, /run: npm run format:check/);
  assert.match(workflow, /run: npm audit --audit-level=high/);
  assert.match(scripts["format:check"] ?? "", /prettier --check/);
  assert.match(scripts["format:check"] ?? "", /packages\/\*\*/);
  assert.match(scripts["format:check"] ?? "", /tests\/\*\*/);
  assert.match(scripts.lint ?? "", /eslint/);
  assert.equal(scripts["test"], "node --import tsx --test tests/*.test.ts");
  assert.match(workflow, /node --test tests\/cloudflare-deploy\.test\.mjs/);
  assert.match(workflow, /run: npm audit --omit=dev --audit-level=high/);
});

test("CI invokes the real Node/SQLite HTTP test and all isolated Wrangler-local D1 HTTP smokes", () => {
  assert.match(workflow, /run: npm test/);
  for (const name of [
    "smoke:node",
    "smoke:worker",
    "smoke:persistence:worker",
    "smoke:admission:worker",
    "smoke:quota:worker",
    "smoke:check:worker",
  ]) {
    assert.ok(scripts[name], `missing script ${name}`);
    assert.ok(
      workflow.includes(`run: npm run ${name}`),
      `missing CI invocation ${name}`,
    );
  }
  assert.match(
    readFileSync("tests/check-node-http.test.ts", "utf8"),
    /real Node HTTP isolates two trusted principals across checking, completion and SQLite restart/,
  );
  assert.match(
    readFileSync("tests/smoke-check-worker.ts", "utf8"),
    /account:alice|alice/,
  );
  assert.match(
    readFileSync("tests/smoke-check-worker.ts", "utf8"),
    /account:bob|bob/,
  );
});
