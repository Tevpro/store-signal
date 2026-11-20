import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function runWithFakeWrangler(script: string) {
  const sandbox = mkdtempSync(
    join(tmpdir(), "storesignal-smoke-failure-test-"),
  );
  const bin = join(sandbox, "fake-wrangler");
  writeFileSync(bin, `#!/bin/sh\n${script}\n`);
  chmodSync(bin, 0o700);
  try {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "tests/smoke-worker.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TMPDIR: sandbox,
          STORE_SIGNAL_WRANGLER_BIN: bin,
        },
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    assert.equal(result.error, undefined, "failure probe must not time out");
    assert.notEqual(result.status, null, "failure probe must exit normally");
    return {
      result,
      leftovers: readdirSync(sandbox).filter((name) =>
        name.startsWith("storesignal-wrangler-"),
      ),
    };
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

test("failed D1 migration reports stderr and removes temporary persistence", () => {
  const { result, leftovers } = runWithFakeWrangler(
    'echo "fixture migration failed" >&2\nexit 23',
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fixture migration failed/);
  assert.deepEqual(leftovers, []);
});

test("failed Wrangler spawn removes temporary persistence without teardown crash", () => {
  const { result, leftovers } = runWithFakeWrangler('rm -- "$0"\nexit 0');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ENOENT/);
  assert.doesNotMatch(result.stderr, /Unhandled 'error' event/);
  assert.deepEqual(leftovers, []);
});
