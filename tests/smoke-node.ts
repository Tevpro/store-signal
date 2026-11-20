import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { parseFixtures } from "../packages/contracts/src/index.ts";
import { runNodeSmoke } from "../packages/runtime-node/src/index.ts";

const fixtures = parseFixtures(
  JSON.parse(
    readFileSync(new URL("./fixtures/stores.json", import.meta.url), "utf8"),
  ) as unknown,
);
const migration = readFileSync(
  new URL("../migrations/0001_fixture_stores.sql", import.meta.url),
  "utf8",
);
const db = new DatabaseSync(":memory:");
try {
  assert.deepEqual(runNodeSmoke(db, migration, fixtures), fixtures);
  console.log(
    `Node/SQLite smoke passed: ${fixtures.length} shared fixture rows`,
  );
} finally {
  db.close();
}
