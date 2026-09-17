import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * RunCron registers a repeatable BullMQ job at import time, so it is
 * stubbed out — the job module is imported here for its exported copy
 * statements and retention logic.
 */
jest.mock("../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

import {
  buildChunkCopyStatement,
  buildHeaderCopyStatement,
  getCopiedColumnList,
  PINNED_DEFAULT_RETENTION_DAYS,
  resolvePinnedRetentionDate,
} from "../../FeatureSet/Workers/Jobs/Rum/MaterializePinnedSessions";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import RumSession from "Common/Models/AnalyticsModels/RumSession";
import RumSessionChunk from "Common/Models/AnalyticsModels/RumSessionChunk";
import RumSessionPin from "Common/Models/DatabaseModels/RumSessionPin";

const projectId: ObjectID = new ObjectID("6600000000000000000000a1");
const rumApplicationId: ObjectID = new ObjectID("6600000000000000000000b2");
const sessionId: string = "1f0c9a4b6d2e47f8a1b3c5d7e9f00112";
const databaseName: string = "oneuptime";

const statementArgs: {
  databaseName: string;
  projectId: ObjectID;
  rumApplicationId: ObjectID;
  sessionId: string;
  versionUnixMs: number;
  retentionDate: Date;
} = {
  databaseName: databaseName,
  projectId: projectId,
  rumApplicationId: rumApplicationId,
  sessionId: sessionId,
  versionUnixMs: 1_800_000_000_000,
  retentionDate: new Date("2028-07-30T00:00:00.000Z"),
};

/*
 * A pin only protects what it actually copies. The column list is derived
 * from the MODEL at runtime precisely so it cannot drift from the physical
 * schema; these tests pin the invariants that make the copy correct.
 */
describe("Rum:MaterializePinnedSessions copy statements", () => {
  test("the copied column list is model-derived, complete, and excludes only the overrides", () => {
    const chunkColumns: Array<string> = getCopiedColumnList(
      new RumSessionChunk(),
    );

    /* The recording itself must travel, or the pin preserves a husk. */
    expect(chunkColumns).toContain("payload");
    expect(chunkColumns).toContain("payloadBytes");
    expect(chunkColumns).toContain("sessionId");
    expect(chunkColumns).toContain("_id");
    /* The six signal counters are declared via a loop — easy to lose. */
    expect(chunkColumns).toContain("errorCount");
    expect(chunkColumns).toContain("routeCount");

    for (const overridden of ["version", "retentionDate", "isPinnedCopy"]) {
      expect(chunkColumns).not.toContain(overridden);
    }

    const headerColumns: Array<string> = getCopiedColumnList(new RumSession());

    expect(headerColumns).toContain("isFinalized");
    expect(headerColumns).toContain("sealedReason");
    expect(headerColumns).not.toContain("version");
  });

  test("the chunk copy dedupes to each chunk's winning version and stamps the overrides", () => {
    const statement: Statement = buildChunkCopyStatement(statementArgs);

    expect(statement.query).toContain("LIMIT 1 BY tabId, chunkIndex");
    expect(statement.query).toContain("ORDER BY tabId ASC, chunkIndex ASC");
    expect(statement.query).toContain("AS isPinnedCopy");

    /* Copies are not re-copied: a re-run must converge, not multiply. */
    expect(statement.query).toContain("isPinnedCopy = false");

    /* An expired chunk cannot be resurrected by pinning. */
    expect(statement.query).toContain("retentionDate >= now()");

    const bound: Array<unknown> = Object.values(statement.query_params);

    expect(bound).toContain(statementArgs.versionUnixMs);
    expect(bound).toContain(
      OneUptimeDate.toClickhouseDateTime64(statementArgs.retentionDate),
    );
    expect(bound).toContain(sessionId);
  });

  test("the version rides as a UInt64 parameter, never an Int32", () => {
    /*
     * Statement maps TableColumnType.Number to an Int32 placeholder, and
     * ClickHouse silently WRAPS an out-of-range Int32 param instead of
     * rejecting it — a unix-ms version (~1.8e12) would truncate, lose the
     * ReplacingMergeTree version race to the original rows, and the
     * pinned copies would protect nothing.
     */
    for (const statement of [
      buildChunkCopyStatement(statementArgs),
      buildHeaderCopyStatement(statementArgs),
    ]) {
      expect(statement.query).toContain(":UInt64}");
      expect(statement.query).not.toContain(":Int32} AS version");
    }
  });

  test("both copies are pinned to project, application and session", () => {
    for (const statement of [
      buildChunkCopyStatement(statementArgs),
      buildHeaderCopyStatement(statementArgs),
    ]) {
      expect(statement.query).toContain("projectId =");
      expect(statement.query).toContain("rumApplicationId =");
      expect(statement.query).toContain("sessionId =");
    }
  });

  test("the header copy takes only the winning header version", () => {
    const statement: Statement = buildHeaderCopyStatement(statementArgs);

    expect(statement.query).toContain("ORDER BY version DESC");
    expect(statement.query).toContain("LIMIT 1");
  });
});

describe("resolvePinnedRetentionDate", () => {
  const now: Date = new Date("2026-07-30T12:00:00.000Z");

  test("a future expiresAt is honoured exactly", () => {
    const pin: RumSessionPin = new RumSessionPin();
    pin.expiresAt = new Date("2027-01-01T00:00:00.000Z");

    expect(resolvePinnedRetentionDate(pin, now).getTime()).toBe(
      pin.expiresAt.getTime(),
    );
  });

  test("no expiry (or a past one) falls back to the long default", () => {
    const pin: RumSessionPin = new RumSessionPin();

    const resolved: Date = resolvePinnedRetentionDate(pin, now);
    const expected: Date = OneUptimeDate.addRemoveDays(
      now,
      PINNED_DEFAULT_RETENTION_DAYS,
    );

    expect(resolved.getTime()).toBe(expected.getTime());

    pin.expiresAt = new Date("2020-01-01T00:00:00.000Z");

    expect(resolvePinnedRetentionDate(pin, now).getTime()).toBe(
      expected.getTime(),
    );
  });
});
