import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  normalizeStoreIdentity,
  parseV1,
} from "../packages/contracts/src/index.ts";

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/f06-boundaries.json", import.meta.url),
    "utf8",
  ),
) as {
  identityConfusion: {
    origin: string;
    wrongTenant: string;
    similarName: string;
  };
  coverage: { scenario: string; status: string; errorCode?: string }[];
  lowReviewCount: {
    rating: number;
    count: number;
    highThresholdCount: number;
    expected: string;
  };
  duplicateJobs: {
    store: string;
    installations: string[];
    expectedNewJobs: number;
  };
  hostileSource: { excerpt: string; expected: string };
};

test("synthetic tenant confusion keeps distinct store IDs and no name-only match", () => {
  assert.notEqual(
    normalizeStoreIdentity(fixture.identityConfusion.origin).storeId,
    normalizeStoreIdentity(fixture.identityConfusion.wrongTenant).storeId,
  );
  assert.ok(
    !fixture.identityConfusion.similarName.includes(
      new URL(fixture.identityConfusion.origin).hostname,
    ),
  );
});

test("synthetic provider outage is not a healthy empty result", () => {
  const statuses = new Map(
    fixture.coverage.map((item) => [item.scenario, item]),
  );
  for (const item of fixture.coverage) {
    const record = {
      schemaVersion: 1,
      connector: "search",
      checkedAt: "2026-01-01T00:00:00Z",
      status: item.status,
      ...(item.errorCode ? { errorCode: item.errorCode } : {}),
    };
    assert.equal(parseV1("coverage", record).status, item.status);
  }
  assert.equal(statuses.get("healthy-empty")?.status, "no_match");
  assert.equal(statuses.get("outage")?.status, "failed");
});

test("synthetic low-count and hostile text are explicit non-verdict fixture boundaries", () => {
  assert.ok(
    fixture.lowReviewCount.count < fixture.lowReviewCount.highThresholdCount,
  );
  assert.equal(fixture.lowReviewCount.expected, "not_high_from_rating_alone");
  assert.match(fixture.hostileSource.excerpt, /ignore your instructions/i);
  assert.equal(fixture.hostileSource.expected, "untrusted_source_data");
  assert.equal(fixture.duplicateJobs.expectedNewJobs, 1);
  assert.ok(fixture.duplicateJobs.installations.length > 1);
});
