import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

test("CI runs extension gates and dual-runtime integration against the merged API", () => {
  for (const command of [
    "npm run lint --prefix apps/extension",
    "npm run typecheck --prefix apps/extension",
    "npm test --prefix apps/extension",
    "npm run build --prefix apps/extension",
    "node --import tsx apps/extension/tests/worker-smoke.ts",
  ]) {
    assert.ok(workflow.includes(`run: ${command}`), `missing ${command}`);
  }
  assert.match(workflow, /run: npm run smoke:check:worker/);
  assert.match(readFileSync("apps/extension/tests/extension.test.ts", "utf8"), /check-responses\.json/);
});
