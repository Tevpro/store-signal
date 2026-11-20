import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { parseFixtures } from "../packages/contracts/src/index.ts";
import {
  runNodeContractSmoke,
  runNodeSmoke,
} from "../packages/runtime-node/src/index.ts";

const fixtures = parseFixtures(
  JSON.parse(
    readFileSync(new URL("./fixtures/stores.json", import.meta.url), "utf8"),
  ) as unknown,
);
const migration = readFileSync(
  new URL("../migrations/0001_fixture_stores.sql", import.meta.url),
  "utf8",
);

test("Node SQLite runs the shared migration and fixture records", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const result = runNodeSmoke(db, migration, fixtures);
    assert.deepEqual(result, fixtures);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM fixture_stores").get()?.count,
      fixtures.length,
    );
  } finally {
    db.close();
  }
});

test("Node SQLite roundtrips all /v1 states through real JSON SQL", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const golden = JSON.parse(
      readFileSync(
        new URL("./fixtures/v1-records.json", import.meta.url),
        "utf8",
      ),
    ) as unknown;
    assert.deepEqual(runNodeContractSmoke(db, golden), golden);
  } finally {
    db.close();
  }
});
