import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import {
  SESSION_REPLAY_ACTIVE_CHUNK_MIN_EVENTS,
  SESSION_REPLAY_SCHEMA_VERSION,
  SESSION_REPLAY_WIRE_VERSION,
} from "Common/Types/Rum/SessionReplay";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * The engagement aggregates the finalizer derives for the list and the
 * player: clicks and custom events summed across tabs, the offset of the
 * first errored chunk (0 when none), the active time from chunks that held
 * real activity, and the tags / traits carried from the newest header
 * version. Pinned through the exported pure functions plus the SQL text,
 * so the in-process model and the ClickHouse statement cannot drift apart
 * without one of these failing.
 */

jest.mock("../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

import {
  buildFinalizedSessionRow,
  buildProvisionalHeaderStatement,
  buildTabAggregateStatement,
  combineTabAggregates,
  parseProvisionalHeaderRow,
  parseTabAggregateRow,
  ProvisionalSessionHeader,
  SessionChunkAggregate,
  TabChunkAggregate,
} from "../../FeatureSet/Workers/Jobs/Rum/FinalizeSessions";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";

const projectId: ObjectID = new ObjectID("6600000000000000000000a1");
const sessionId: string = "1f0c9a4b6d2e47f8a1b3c5d7e9f00112";
const databaseName: string = "oneuptime";
const startUnixMs: number = new Date("2026-07-29T10:00:00.000Z").getTime();

function tab(overrides: Partial<TabChunkAggregate>): TabChunkAggregate {
  return {
    tabId: "tab-a",
    chunkCount: 1,
    maxChunkIndex: 0,
    chunkIndexes: [0],
    fullSnapshotChunkIndexes: [0],
    eventCount: 10,
    payloadBytes: 1000,
    errorCount: 0,
    rageClickCount: 0,
    deadClickCount: 0,
    errorClickCount: 0,
    refreshRageCount: 0,
    routeCount: 0,
    clickCount: 0,
    customEventCount: 0,
    erroredChunkCount: 0,
    firstErrorOffsetMs: 0,
    activeMs: 0,
    firstUrl: "",
    lastUrl: "",
    firstUrlAtUnixMs: 0,
    lastUrlAtUnixMs: 0,
    urlChunkCount: 0,
    routes: [],
    hasFinalChunk: false,
    sessionStartUnixMs: startUnixMs,
    firstChunkStartUnixMs: startUnixMs,
    lastChunkEndUnixMs: startUnixMs + 15_000,
    maxChunkEndOffsetMs: 15_000,
    schemaVersion: SESSION_REPLAY_SCHEMA_VERSION,
    recorderKind: "dom",
    rumApplicationId: "6600000000000000000000b2",
    primaryEntityId: "6600000000000000000000b2",
    primaryEntityType: "RealUserMonitor",
    retentionDate: "2026-08-05",
    ...overrides,
  };
}

function header(
  overrides?: Partial<ProvisionalSessionHeader>,
): ProvisionalSessionHeader {
  return {
    startTimeText: "2026-07-29 10:00:00.000000000",
    startTimeUnixMs: startUnixMs,
    clientReportedStartTimeText: "2026-07-29 10:00:00.000000000",
    retentionDateText: "2026-08-05",
    rumApplicationId: "6600000000000000000000b2",
    primaryEntityId: "6600000000000000000000b2",
    primaryEntityType: "RealUserMonitor",
    sealedReason: "",
    triggerReason: "sampled",
    samplePercentageAtCapture: 100,
    clockSkewMs: 0,
    errorCount: 0,
    rageClickCount: 0,
    deadClickCount: 0,
    errorClickCount: 0,
    refreshRageCount: 0,
    pageCount: 0,
    entryUrl: "https://shop.example.com/",
    exitUrl: "https://shop.example.com/",
    routes: [],
    browserName: "Chrome",
    browserVersion: "141",
    osName: "macOS",
    deviceType: "desktop",
    viewportWidth: 1440,
    viewportHeight: 900,
    maskingMode: "MaskAllText",
    consentState: "NotRequired",
    recorderKind: "dom",
    recorderVersion: "1.0.0",
    rrwebVersion: "2.1.0",
    countryCode: "",
    identifiedUserKey: "",
    identifiedUserLabel: "",
    identifiedUserTraits: {},
    tags: {},
    traceIds: [],
    exceptionFingerprints: [],
    fidelityNotices: [],
    schemaVersion: SESSION_REPLAY_SCHEMA_VERSION,
    wireVersion: SESSION_REPLAY_WIRE_VERSION,
    isLegalHold: false,
    isPinnedCopy: false,
    attributes: {},
    attributeKeys: [],
    entityKeys: [],
    ...overrides,
  };
}

function rowFor(
  aggregate: SessionChunkAggregate,
  provisional: ProvisionalSessionHeader | null,
): JSONObject {
  return buildFinalizedSessionRow({
    projectId: projectId,
    sessionId: sessionId,
    aggregate: aggregate,
    header: provisional,
    traceIds: [],
    exceptionFingerprints: [],
    writtenAt: new Date("2026-07-29T10:20:00.000Z"),
  });
}

describe("FinalizeSessions engagement aggregates", () => {
  test("clickCount and customEventCount are summed across tabs", () => {
    const aggregate: SessionChunkAggregate = combineTabAggregates([
      tab({ tabId: "tab-a", clickCount: 12, customEventCount: 2 }),
      tab({ tabId: "tab-b", clickCount: 29, customEventCount: 5 }),
    ]);

    expect(aggregate.clickCount).toBe(41);
    expect(aggregate.customEventCount).toBe(7);

    const row: JSONObject = rowFor(aggregate, header());

    expect(row["clickCount"]).toBe(41);
    expect(row["customEventCount"]).toBe(7);
  });

  test("firstErrorOffsetMs is the earliest errored chunk's start across tabs", () => {
    const aggregate: SessionChunkAggregate = combineTabAggregates([
      tab({ tabId: "tab-a", erroredChunkCount: 1, firstErrorOffsetMs: 90_000 }),
      tab({ tabId: "tab-b", erroredChunkCount: 2, firstErrorOffsetMs: 45_000 }),
    ]);

    expect(aggregate.firstErrorOffsetMs).toBe(45_000);
    expect(rowFor(aggregate, header())["firstErrorOffsetMs"]).toBe(45_000);
  });

  test("a tab without errors contributes nothing, even though its minIf reads 0", () => {
    /* ClickHouse returns 0 from minIf over no matching rows. */
    const aggregate: SessionChunkAggregate = combineTabAggregates([
      tab({ tabId: "tab-a", erroredChunkCount: 0, firstErrorOffsetMs: 0 }),
      tab({ tabId: "tab-b", erroredChunkCount: 1, firstErrorOffsetMs: 30_000 }),
    ]);

    expect(aggregate.firstErrorOffsetMs).toBe(30_000);
  });

  test("firstErrorOffsetMs is 0 when no chunk carries an error", () => {
    const aggregate: SessionChunkAggregate = combineTabAggregates([
      tab({ tabId: "tab-a" }),
      tab({ tabId: "tab-b" }),
    ]);

    expect(aggregate.firstErrorOffsetMs).toBe(0);
    expect(rowFor(aggregate, header())["firstErrorOffsetMs"]).toBe(0);
  });

  test("an error on the very first chunk is offset 0, distinguishable through the count", () => {
    const aggregate: SessionChunkAggregate = combineTabAggregates([
      tab({ tabId: "tab-a", erroredChunkCount: 1, firstErrorOffsetMs: 0 }),
      tab({ tabId: "tab-b", erroredChunkCount: 1, firstErrorOffsetMs: 60_000 }),
    ]);

    expect(aggregate.firstErrorOffsetMs).toBe(0);
  });

  test("activeMs is summed across tabs and lands on the row", () => {
    /*
     * A ten-minute session with two tabs that between them were active for
     * ninety seconds - the sum is under the session's own duration, so
     * nothing is clamped and the row carries it whole.
     */
    const aggregate: SessionChunkAggregate = combineTabAggregates([
      tab({
        tabId: "tab-a",
        activeMs: 45_000,
        lastChunkEndUnixMs: startUnixMs + 600_000,
      }),
      tab({
        tabId: "tab-b",
        activeMs: 15_000,
        lastChunkEndUnixMs: startUnixMs + 600_000,
      }),
    ]);

    expect(aggregate.activeMs).toBe(60_000);
    expect(rowFor(aggregate, header())["activeMs"]).toBe(60_000);
  });

  /*
   * activeMs is per-session WALL CLOCK. The SQL sums it per tab and
   * combineTabAggregates adds the tabs up, so two tabs recording the SAME
   * ten minutes contribute twenty - and the row published activeMs greater
   * than durationMs, which the list renders as a negative idle share
   * ("idle -100%") and which would mis-rank sessions the moment anything
   * sorted on it.
   */
  test("concurrent tabs cannot push the row's activeMs past the session duration", () => {
    const aggregate: SessionChunkAggregate = combineTabAggregates([
      tab({
        tabId: "tab-a",
        activeMs: 600_000,
        lastChunkEndUnixMs: startUnixMs + 600_000,
      }),
      tab({
        tabId: "tab-b",
        activeMs: 600_000,
        lastChunkEndUnixMs: startUnixMs + 600_000,
      }),
    ]);

    /* The raw sum is still what the aggregate holds... */
    expect(aggregate.activeMs).toBe(1_200_000);

    const row: JSONObject = rowFor(aggregate, header());

    /* ...and the published row is clamped to the session's own duration. */
    expect(row["durationMs"]).toBe(600_000);
    expect(row["activeMs"]).toBe(600_000);
    expect(row["activeMs"] as number).toBeLessThanOrEqual(
      row["durationMs"] as number,
    );
  });

  test("a nonsensical negative activeMs never reaches the row", () => {
    const aggregate: SessionChunkAggregate = combineTabAggregates([
      tab({
        tabId: "tab-a",
        activeMs: -5_000,
        lastChunkEndUnixMs: startUnixMs + 600_000,
      }),
    ]);

    expect(rowFor(aggregate, header())["activeMs"]).toBe(0);
  });

  test("64-bit aggregates arriving as strings are coerced, including the new ones", () => {
    const parsed: TabChunkAggregate = parseTabAggregateRow({
      tabId: "tab-a",
      chunkCount: "2",
      maxChunkIndex: 1,
      chunkIndexes: [0, 1],
      fullSnapshotChunkIndexes: [0],
      eventCount: "20",
      payloadBytes: "2000",
      errorCount: 1,
      rageClickCount: 0,
      deadClickCount: 0,
      errorClickCount: 0,
      refreshRageCount: 0,
      routeCount: 0,
      clickCount: "41",
      customEventCount: "3",
      erroredChunkCount: "1",
      firstErrorOffsetMs: "15000",
      activeMs: "30000",
      firstUrl: "",
      lastUrl: "",
      firstUrlAtUnixMs: "0",
      lastUrlAtUnixMs: "0",
      urlChunkCount: 0,
      routes: [],
      hasFinalChunk: 0,
      sessionStartUnixMs: String(startUnixMs),
      firstChunkStartUnixMs: String(startUnixMs),
      lastChunkEndUnixMs: String(startUnixMs + 30_000),
      maxChunkEndOffsetMs: 30_000,
      schemaVersion: 1,
      recorderKind: "dom",
      rumApplicationId: "6600000000000000000000b2",
      primaryEntityId: "6600000000000000000000b2",
      primaryEntityType: "RealUserMonitor",
      retentionDate: "2026-08-05",
    });

    expect(parsed.clickCount).toBe(41);
    expect(parsed.customEventCount).toBe(3);
    expect(parsed.erroredChunkCount).toBe(1);
    expect(parsed.firstErrorOffsetMs).toBe(15_000);
    expect(parsed.activeMs).toBe(30_000);
  });
});

describe("FinalizeSessions tags and traits", () => {
  test("tags and traits are carried from the header onto the finalized row", () => {
    const row: JSONObject = rowFor(
      combineTabAggregates([tab({})]),
      header({
        tags: { build: "abc123", experiment: "b" },
        identifiedUserTraits: { plan: "pro" },
      }),
    );

    expect(row["tags"]).toEqual({ build: "abc123", experiment: "b" });
    expect(row["identifiedUserTraits"]).toEqual({ plan: "pro" });
  });

  test("a session with no header gets empty maps, never undefined", () => {
    const row: JSONObject = rowFor(combineTabAggregates([tab({})]), null);

    expect(row["tags"]).toEqual({});
    expect(row["identifiedUserTraits"]).toEqual({});
  });

  test("the header read selects the newest version's tags and traits", () => {
    const statement: Statement = buildProvisionalHeaderStatement({
      databaseName: databaseName,
      projectId: projectId,
      rumApplicationId: "6600000000000000000000b2",
      sessionId: sessionId,
    });

    expect(statement.query).toContain("tags AS tags");
    expect(statement.query).toContain(
      "identifiedUserTraits AS identifiedUserTraits",
    );
    /* Newest version wins: that is how a later meta's tags reach the row. */
    expect(statement.query).toContain("ORDER BY version DESC");
    expect(statement.query).toContain("LIMIT 1");
  });

  test("a Map column that comes back in an unexpected shape reads as empty", () => {
    const parsed: ProvisionalSessionHeader = parseProvisionalHeaderRow({
      startTimeText: "2026-07-29 10:00:00.000000000",
      startTimeUnixMs: startUnixMs,
      tags: [["build", "abc"]],
      identifiedUserTraits: "plan=pro",
    });

    expect(parsed.tags).toEqual({});
    expect(parsed.identifiedUserTraits).toEqual({});

    const wellFormed: ProvisionalSessionHeader = parseProvisionalHeaderRow({
      tags: { build: "abc" },
      identifiedUserTraits: { plan: "pro" },
    });

    expect(wellFormed.tags).toEqual({ build: "abc" });
    expect(wellFormed.identifiedUserTraits).toEqual({ plan: "pro" });
  });
});

describe("FinalizeSessions aggregate statement", () => {
  test("names the engagement columns and the activity threshold, never the payload", () => {
    const statement: Statement = buildTabAggregateStatement({
      databaseName: databaseName,
      projectId: projectId,
      sessionId: sessionId,
    });

    const query: string = statement.query;

    expect(query).toContain("sum(clickCount) AS clickCount");
    expect(query).toContain("sum(customEventCount) AS customEventCount");
    expect(query).toContain("countIf(errorCount > 0) AS erroredChunkCount");
    expect(query).toContain(
      "minIf(chunkStartOffsetMs, errorCount > 0) AS firstErrorOffsetMs",
    );
    expect(query).toContain("AS activeMs");
    expect(query).toContain(
      "greatest(chunkEndOffsetMs - chunkStartOffsetMs, 0)",
    );

    /* The threshold is bound, not inlined, and is the shared constant. */
    expect(Object.values(statement.query_params)).toContain(
      SESSION_REPLAY_ACTIVE_CHUNK_MIN_EVENTS,
    );

    /* The inner projection carries what the aggregates read. */
    expect(query).toContain("chunkStartOffsetMs,");
    expect(query).toContain("clickCount,");
    expect(query).toContain("customEventCount,");

    expect(query).not.toMatch(/\bpayload\b/);
  });

  /*
   * sessionId is minted from sessionStorage, which two RUM applications
   * served from one origin share - so one id can legitimately name two
   * applications' recordings. Without rumApplicationId in the dedupe key
   * one application's chunks evict the other's; without it in the grouping
   * the writer folds both into a single header under whichever id `any()`
   * picked, and the other application's session never finalizes at all.
   */
  test("the aggregate is scoped per application, not just per tab", () => {
    const query: string = buildTabAggregateStatement({
      databaseName: databaseName,
      projectId: projectId,
      sessionId: sessionId,
    }).query;

    expect(query).toContain("LIMIT 1 BY rumApplicationId, tabId, chunkIndex");
    expect(query).toContain("GROUP BY rumApplicationId, tabId");
    /* The grouped column, not any(): it is constant within the group. */
    expect(query).toContain("rumApplicationId AS rumApplicationId");
    expect(query).not.toContain("any(rumApplicationId)");
  });
});
