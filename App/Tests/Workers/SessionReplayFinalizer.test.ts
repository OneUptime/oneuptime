import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import {
  MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
  SESSION_REPLAY_MAX_SESSION_MS,
  SESSION_REPLAY_SCHEMA_VERSION,
  SESSION_REPLAY_WIRE_VERSION,
  SessionReplaySealedReason,
} from "Common/Types/Rum/SessionReplay";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * RunCron registers a repeatable BullMQ job at import time, so it is
 * stubbed out — the job module is imported here purely for its exported
 * aggregation logic.
 */
jest.mock("../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

import {
  buildFinalizedSessionRow,
  buildNeverFinalizedStatement,
  buildProvisionalHeaderStatement,
  buildSessionExceptionFingerprintStatement,
  buildSessionTraceIdStatement,
  buildTabAggregateStatement,
  combineTabAggregates,
  fetchSessionCorrelation,
  MAX_EXCEPTION_FINGERPRINTS_PER_SESSION,
  MAX_SWEEP_SESSIONS_PER_RUN,
  MAX_TRACE_IDS_PER_SESSION,
  parseActiveSessionMember,
  parseTabAggregateRow,
  ProvisionalSessionHeader,
  resolveSealedReason,
  SessionChunkAggregate,
  SessionCorrelation,
  SWEEP_LOOKBACK_MS,
  SWEEP_MIN_SESSION_AGE_MS,
  TabChunkAggregate,
} from "../../FeatureSet/Workers/Jobs/Rum/FinalizeSessions";
import RumSessionChunkService from "Common/Server/Services/RumSessionChunkService";
import { Results } from "Common/Server/Services/AnalyticsDatabaseService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";

const projectId: ObjectID = new ObjectID("6600000000000000000000a1");
const sessionId: string = "1f0c9a4b6d2e47f8a1b3c5d7e9f00112";
const databaseName: string = "oneuptime";

/* Chunk 0 of the fixture session starts at this wall-clock instant. */
const sessionStartUnixMs: number = new Date(
  "2026-07-29T10:00:00.000Z",
).getTime();

/* One chunk per 15s flush window, matching the recorder's cadence. */
const CHUNK_DURATION_MS: number = 15 * 1000;

interface RawChunkRow {
  tabId: string;
  chunkIndex: number;
  version: number;
  hasFullSnapshot: boolean;
  isFinal: boolean;
  eventCount: number;
  payloadBytes: number;
  errorCount: number;
  rageClickCount: number;
  deadClickCount: number;
  errorClickCount: number;
  refreshRageCount: number;
  routeCount: number;
  sessionStartUnixMs: number;
  chunkEndUnixMs: number;
  chunkEndOffsetMs: number;
  schemaVersion: number;
  recorderKind: string;
  rumApplicationId: string;
  primaryEntityId: string;
  primaryEntityType: string;
  retentionDate: string;
}

function makeChunkRow(data: {
  chunkIndex: number;
  tabId?: string;
  version?: number;
  hasFullSnapshot?: boolean;
  isFinal?: boolean;
  eventCount?: number;
  payloadBytes?: number;
  errorCount?: number;
  routeCount?: number;
}): RawChunkRow {
  const chunkIndex: number = data.chunkIndex;

  return {
    tabId: data.tabId ?? "tab-a",
    chunkIndex: chunkIndex,
    version: data.version ?? 1_700_000_000_000 + chunkIndex,
    /* rrweb checks out every 60s, so every 4th 15s chunk is an anchor. */
    hasFullSnapshot: data.hasFullSnapshot ?? chunkIndex % 4 === 0,
    isFinal: data.isFinal ?? false,
    eventCount: data.eventCount ?? 10 + chunkIndex,
    payloadBytes: data.payloadBytes ?? 1000 + chunkIndex,
    errorCount: data.errorCount ?? 0,
    rageClickCount: 0,
    deadClickCount: 0,
    errorClickCount: 0,
    refreshRageCount: 0,
    routeCount: data.routeCount ?? 0,
    sessionStartUnixMs: sessionStartUnixMs,
    chunkEndUnixMs: sessionStartUnixMs + (chunkIndex + 1) * CHUNK_DURATION_MS,
    chunkEndOffsetMs: (chunkIndex + 1) * CHUNK_DURATION_MS,
    schemaVersion: SESSION_REPLAY_SCHEMA_VERSION,
    recorderKind: "dom",
    rumApplicationId: "6600000000000000000000b2",
    primaryEntityId: "6600000000000000000000b2",
    primaryEntityType: "RealUserMonitor",
    retentionDate: "2026-08-05",
  };
}

/*
 * Faithful in-test model of what the production SQL does inside
 * ClickHouse:
 *
 *   FROM ( ... ORDER BY version DESC LIMIT 1 BY tabId, chunkIndex )
 *   GROUP BY tabId
 *
 * The dedupe half is the part that matters: without it a retried chunk
 * POST is visible as two ReplacingMergeTree rows (there is no FINAL
 * support anywhere in this repo) and every sum would double-count. The
 * SQL text itself is pinned by a separate test below, so the two halves
 * cannot drift apart silently.
 */
function runGroupByOverChunkRows(rows: Array<RawChunkRow>): Array<JSONObject> {
  const latestByIdentity: Map<string, RawChunkRow> = new Map<
    string,
    RawChunkRow
  >();

  for (const row of rows) {
    const identity: string = `${row.tabId}:${row.chunkIndex}`;
    const existing: RawChunkRow | undefined = latestByIdentity.get(identity);

    if (!existing || row.version > existing.version) {
      latestByIdentity.set(identity, row);
    }
  }

  const byTab: Map<string, Array<RawChunkRow>> = new Map<
    string,
    Array<RawChunkRow>
  >();

  for (const row of latestByIdentity.values()) {
    const existing: Array<RawChunkRow> | undefined = byTab.get(row.tabId);

    if (existing) {
      existing.push(row);
    } else {
      byTab.set(row.tabId, [row]);
    }
  }

  const groupRows: Array<JSONObject> = [];

  for (const [tabId, tabRows] of byTab.entries()) {
    const sum: (pick: (row: RawChunkRow) => number) => number = (
      pick: (row: RawChunkRow) => number,
    ): number => {
      return tabRows.reduce((total: number, row: RawChunkRow): number => {
        return total + pick(row);
      }, 0);
    };

    const max: (pick: (row: RawChunkRow) => number) => number = (
      pick: (row: RawChunkRow) => number,
    ): number => {
      return tabRows.reduce((highest: number, row: RawChunkRow): number => {
        return Math.max(highest, pick(row));
      }, 0);
    };

    groupRows.push({
      tabId: tabId,
      /* UInt64 aggregates arrive as JSON strings on some server versions. */
      chunkCount: String(tabRows.length),
      maxChunkIndex: max((row: RawChunkRow): number => {
        return row.chunkIndex;
      }),
      chunkIndexes: tabRows.map((row: RawChunkRow): number => {
        return row.chunkIndex;
      }),
      fullSnapshotChunkIndexes: tabRows
        .filter((row: RawChunkRow): boolean => {
          return row.hasFullSnapshot;
        })
        .map((row: RawChunkRow): number => {
          return row.chunkIndex;
        }),
      eventCount: String(
        sum((row: RawChunkRow): number => {
          return row.eventCount;
        }),
      ),
      payloadBytes: String(
        sum((row: RawChunkRow): number => {
          return row.payloadBytes;
        }),
      ),
      errorCount: sum((row: RawChunkRow): number => {
        return row.errorCount;
      }),
      rageClickCount: sum((row: RawChunkRow): number => {
        return row.rageClickCount;
      }),
      deadClickCount: sum((row: RawChunkRow): number => {
        return row.deadClickCount;
      }),
      errorClickCount: sum((row: RawChunkRow): number => {
        return row.errorClickCount;
      }),
      refreshRageCount: sum((row: RawChunkRow): number => {
        return row.refreshRageCount;
      }),
      routeCount: sum((row: RawChunkRow): number => {
        return row.routeCount;
      }),
      hasFinalChunk: tabRows.some((row: RawChunkRow): boolean => {
        return row.isFinal;
      })
        ? 1
        : 0,
      sessionStartUnixMs: String(
        Math.min(
          ...tabRows.map((row: RawChunkRow): number => {
            return row.sessionStartUnixMs;
          }),
        ),
      ),
      lastChunkEndUnixMs: String(
        max((row: RawChunkRow): number => {
          return row.chunkEndUnixMs;
        }),
      ),
      maxChunkEndOffsetMs: max((row: RawChunkRow): number => {
        return row.chunkEndOffsetMs;
      }),
      schemaVersion: max((row: RawChunkRow): number => {
        return row.schemaVersion;
      }),
      recorderKind: "dom",
      rumApplicationId: "6600000000000000000000b2",
      primaryEntityId: "6600000000000000000000b2",
      primaryEntityType: "RealUserMonitor",
      retentionDate: "2026-08-05",
    });
  }

  return groupRows;
}

function aggregateOf(rows: Array<RawChunkRow>): SessionChunkAggregate {
  return combineTabAggregates(
    runGroupByOverChunkRows(rows).map(parseTabAggregateRow),
  );
}

function makeProvisionalHeader(
  overrides?: Partial<ProvisionalSessionHeader>,
): ProvisionalSessionHeader {
  const header: ProvisionalSessionHeader = {
    startTimeText: "2026-07-29 10:00:00.000000000",
    startTimeUnixMs: sessionStartUnixMs,
    clientReportedStartTimeText: "2026-07-29 09:58:12.123000000",
    retentionDateText: "2026-08-05",
    rumApplicationId: "6600000000000000000000b2",
    primaryEntityId: "6600000000000000000000b2",
    primaryEntityType: "RealUserMonitor",
    sealedReason: "",
    triggerReason: "error",
    samplePercentageAtCapture: 0,
    clockSkewMs: -107877,
    entryUrl: "https://shop.example.com/checkout",
    exitUrl: "https://shop.example.com/checkout/failed",
    routes: ["/checkout", "/checkout/failed"],
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
    countryCode: "GB",
    identifiedUserKey: "a".repeat(32),
    identifiedUserLabel: "",
    traceIds: ["trace-existing"],
    exceptionFingerprints: ["fingerprint-1"],
    fidelityNotices: ["cross-origin-iframe"],
    schemaVersion: SESSION_REPLAY_SCHEMA_VERSION,
    wireVersion: SESSION_REPLAY_WIRE_VERSION,
    isLegalHold: false,
    isPinnedCopy: false,
    attributes: { plan: "growth" },
    attributeKeys: ["plan"],
    entityKeys: ["rum:shop"],
  };

  return { ...header, ...overrides };
}

describe("Rum:FinalizeSessions aggregate derivation", () => {
  test("chunks 0..9 delivered out of order with a duplicate produce exact aggregates", () => {
    /*
     * The scenario the finalizer exists for: at ingest concurrency chunks
     * arrive in whatever order the queue drains them, and at-least-once
     * delivery means one of them arrives twice. A read-modify-write
     * increment onto the header would lose updates here; a derived
     * aggregate must not care about order OR duplication.
     */
    const deliveryOrder: Array<number> = [3, 0, 7, 1, 9, 2, 8, 5, 4, 6];

    const rows: Array<RawChunkRow> = deliveryOrder.map(
      (chunkIndex: number): RawChunkRow => {
        return makeChunkRow({
          chunkIndex: chunkIndex,
          isFinal: chunkIndex === 9,
          errorCount: chunkIndex === 5 ? 2 : 0,
          routeCount: chunkIndex === 2 || chunkIndex === 6 ? 1 : 0,
        });
      },
    );

    /* Redelivery of chunk 4: same identity, later version, same numbers. */
    rows.push(
      makeChunkRow({
        chunkIndex: 4,
        version: 1_800_000_000_000,
      }),
    );

    const aggregate: SessionChunkAggregate = aggregateOf(rows);

    expect(aggregate.chunkCount).toBe(10);
    expect(aggregate.maxChunkIndex).toBe(9);
    expect(aggregate.missingChunkCount).toBe(0);

    /* sum(10..19) = 145, and the duplicate must not add its 14 again. */
    expect(aggregate.eventCount).toBe(145);
    /* sum(1000..1009) = 10045, likewise counted once. */
    expect(aggregate.payloadBytes).toBe(10045);

    expect(aggregate.errorCount).toBe(2);
    expect(aggregate.pageCount).toBe(2);
    expect(aggregate.hasFinalChunk).toBe(true);
    expect(aggregate.fullSnapshotChunkIndexes).toEqual([0, 4, 8]);
    expect(aggregate.sessionStartUnixMs).toBe(sessionStartUnixMs);
    expect(aggregate.lastChunkEndUnixMs).toBe(
      sessionStartUnixMs + 10 * CHUNK_DURATION_MS,
    );
    expect(aggregate.tabCount).toBe(1);
  });

  test("gaps are identified from the index set difference, not from a counter", () => {
    /* Chunks 3 and 4 never arrived (413, budget cut, tab killed mid-flush). */
    const present: Array<number> = [0, 1, 2, 5, 6, 7];

    const aggregate: SessionChunkAggregate = aggregateOf(
      present.map((chunkIndex: number): RawChunkRow => {
        return makeChunkRow({ chunkIndex: chunkIndex });
      }),
    );

    expect(aggregate.chunkCount).toBe(6);
    expect(aggregate.maxChunkIndex).toBe(7);
    expect(aggregate.missingChunkCount).toBe(2);
    /* Chunk 4 was an anchor and is gone; only 0 remains as a seek target. */
    expect(aggregate.fullSnapshotChunkIndexes).toEqual([0]);
  });

  test("a duplicate delivery cannot inflate the missing-chunk count", () => {
    const rows: Array<RawChunkRow> = [
      makeChunkRow({ chunkIndex: 0 }),
      makeChunkRow({ chunkIndex: 1 }),
      makeChunkRow({ chunkIndex: 1, version: 1_900_000_000_000 }),
      makeChunkRow({ chunkIndex: 2 }),
    ];

    const aggregate: SessionChunkAggregate = aggregateOf(rows);

    expect(aggregate.chunkCount).toBe(3);
    expect(aggregate.missingChunkCount).toBe(0);
  });

  test("per-tab index sets keep one tab's gap from being masked by another", () => {
    /*
     * sessionStorage is COPIED on tab duplication, so two live tabs can
     * share a sessionId and both mint chunkIndex from 0. Detecting gaps
     * over the union would report a complete session here.
     */
    const rows: Array<RawChunkRow> = [
      makeChunkRow({ chunkIndex: 0, tabId: "tab-a" }),
      makeChunkRow({ chunkIndex: 2, tabId: "tab-a" }),
      makeChunkRow({ chunkIndex: 0, tabId: "tab-b" }),
      makeChunkRow({ chunkIndex: 1, tabId: "tab-b" }),
      makeChunkRow({ chunkIndex: 2, tabId: "tab-b" }),
    ];

    const aggregate: SessionChunkAggregate = aggregateOf(rows);

    expect(aggregate.tabCount).toBe(2);
    expect(aggregate.chunkCount).toBe(5);
    /* tab-a is missing index 1; tab-b is complete. */
    expect(aggregate.missingChunkCount).toBe(1);
  });

  test("empty aggregate is well formed", () => {
    const aggregate: SessionChunkAggregate = combineTabAggregates([]);

    expect(aggregate.chunkCount).toBe(0);
    expect(aggregate.missingChunkCount).toBe(0);
    expect(aggregate.fullSnapshotChunkIndexes).toEqual([]);
    expect(aggregate.hasFinalChunk).toBe(false);
  });
});

describe("Rum:FinalizeSessions sealed reason", () => {
  const baseAggregate: SessionChunkAggregate = combineTabAggregates([]);

  test("a terminal chunk means the recording ended", () => {
    expect(
      resolveSealedReason({
        aggregate: { ...baseAggregate, hasFinalChunk: true },
        durationMs: 60_000,
        existingSealedReason: "",
      }),
    ).toBe(SessionReplaySealedReason.FinalChunk);
  });

  test("no terminal chunk means the recorder went away", () => {
    expect(
      resolveSealedReason({
        aggregate: baseAggregate,
        durationMs: 60_000,
        existingSealedReason: "",
      }),
    ).toBe(SessionReplaySealedReason.IdleTimeout);
  });

  test("the duration cap wins over an idle timeout", () => {
    expect(
      resolveSealedReason({
        aggregate: baseAggregate,
        durationMs: SESSION_REPLAY_MAX_SESSION_MS,
        existingSealedReason: "",
      }),
    ).toBe(SessionReplaySealedReason.DurationCap);
  });

  test("the per-session chunk cap reports truncation", () => {
    expect(
      resolveSealedReason({
        aggregate: {
          ...baseAggregate,
          chunkCount: MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
        },
        durationMs: 60_000,
        existingSealedReason: "",
      }),
    ).toBe(SessionReplaySealedReason.Truncated);
  });

  test("a budget seal set at ingest is preserved, not recomputed", () => {
    /*
     * Only the ingest path knows it refused chunks for budget reasons, so
     * the finalizer must not overwrite that with "idle-timeout" and lose
     * the one explanation a support ticket needs.
     */
    expect(
      resolveSealedReason({
        aggregate: { ...baseAggregate, hasFinalChunk: true },
        durationMs: 60_000,
        existingSealedReason: SessionReplaySealedReason.Budget,
      }),
    ).toBe(SessionReplaySealedReason.Budget);
  });
});

describe("Rum:FinalizeSessions header row", () => {
  const writtenAt: Date = new Date("2026-07-29T10:20:00.000Z");

  function rowFor(
    rows: Array<RawChunkRow>,
    header: ProvisionalSessionHeader | null,
    traceIds?: Array<string>,
    exceptionFingerprints?: Array<string>,
  ): JSONObject {
    return buildFinalizedSessionRow({
      projectId: projectId,
      sessionId: sessionId,
      aggregate: aggregateOf(rows),
      header: header,
      traceIds: traceIds ?? [],
      exceptionFingerprints: exceptionFingerprints ?? [],
      writtenAt: writtenAt,
    });
  }

  test("writes one finalized version carrying the derived aggregates", () => {
    const rows: Array<RawChunkRow> = [0, 1, 2, 3].map(
      (chunkIndex: number): RawChunkRow => {
        return makeChunkRow({
          chunkIndex: chunkIndex,
          isFinal: chunkIndex === 3,
          errorCount: chunkIndex === 1 ? 1 : 0,
        });
      },
    );

    const row: JSONObject = rowFor(rows, makeProvisionalHeader(), [
      "trace-new",
    ]);

    expect(row["isFinalized"]).toBe(true);
    expect(row["sealedReason"]).toBe(SessionReplaySealedReason.FinalChunk);
    expect(row["version"]).toBe(writtenAt.getTime());
    expect(row["chunkCount"]).toBe(4);
    expect(row["maxChunkIndex"]).toBe(3);
    expect(row["missingChunkCount"]).toBe(0);
    expect(row["eventCount"]).toBe(46);
    expect(row["payloadBytes"]).toBe(4006);
    expect(row["errorCount"]).toBe(1);
    expect(row["hasError"]).toBe(true);
    expect(row["durationMs"]).toBe(4 * CHUNK_DURATION_MS);
    expect(row["fullSnapshotChunkIndexes"]).toEqual([0]);

    /* Capture metadata the chunk rows do not carry is passed through. */
    expect(row["browserName"]).toBe("Chrome");
    expect(row["countryCode"]).toBe("GB");
    expect(row["routes"]).toEqual(["/checkout", "/checkout/failed"]);
    expect(row["attributes"]).toEqual({ plan: "growth" });

    /* Correlation ids accumulate rather than replace. */
    expect(row["traceIds"]).toEqual(["trace-existing", "trace-new"]);

    /* insertJsonRows bypasses sanitizeCreate, so both must be supplied. */
    expect(typeof row["_id"]).toBe("string");
    expect(row["createdAt"]).toBe("2026-07-29 10:20:00");
  });

  test("startTime is reused verbatim so the row replaces instead of duplicating", () => {
    /*
     * startTime is the 3rd sort-key element AND the partition key. A value
     * that differs by one sub-millisecond digit inserts a SECOND header
     * row rather than replacing the provisional one, which is exactly the
     * duplicate the argMax read path was added to paper over.
     */
    const header: ProvisionalSessionHeader = makeProvisionalHeader({
      startTimeText: "2026-07-29 10:00:00.123456789",
    });

    const row: JSONObject = rowFor([makeChunkRow({ chunkIndex: 0 })], header);

    expect(row["startTime"]).toBe("2026-07-29 10:00:00.123456789");
    expect(row["retentionDate"]).toBe("2026-08-05");
  });

  test("hasError stays false when no chunk reported an error", () => {
    const row: JSONObject = rowFor(
      [makeChunkRow({ chunkIndex: 0 })],
      makeProvisionalHeader(),
    );

    expect(row["hasError"]).toBe(false);
    expect(row["errorCount"]).toBe(0);
  });

  test("a session whose provisional header was lost still gets a header", () => {
    /*
     * Otherwise a session with perfectly playable chunks would never
     * appear in the list, and nothing would ever meter it.
     */
    const row: JSONObject = rowFor(
      [0, 1].map((chunkIndex: number): RawChunkRow => {
        return makeChunkRow({ chunkIndex: chunkIndex });
      }),
      null,
    );

    expect(row["isFinalized"]).toBe(true);
    expect(row["sessionId"]).toBe(sessionId);
    expect(row["projectId"]).toBe(projectId.toString());
    expect(row["startTime"]).toBe("2026-07-29 10:00:00.000000000");
    /* Falls back to the chunk-derived retention date. */
    expect(row["retentionDate"]).toBe("2026-08-05");
    expect(row["schemaVersion"]).toBe(SESSION_REPLAY_SCHEMA_VERSION);
    expect(row["wireVersion"]).toBe(SESSION_REPLAY_WIRE_VERSION);
    expect(row["primaryEntityType"]).toBe("RealUserMonitor");
    expect(row["chunkCount"]).toBe(2);
  });

  test("correlation arrays stay capped", () => {
    const manyTraceIds: Array<string> = Array.from(
      { length: MAX_TRACE_IDS_PER_SESSION + 50 },
      (_unused: unknown, index: number): string => {
        return `trace-${index}`;
      },
    );

    const row: JSONObject = rowFor(
      [makeChunkRow({ chunkIndex: 0 })],
      makeProvisionalHeader({ traceIds: [] }),
      manyTraceIds,
    );

    expect((row["traceIds"] as Array<string>).length).toBe(
      MAX_TRACE_IDS_PER_SESSION,
    );
  });

  test("exception fingerprints merge the header's with the batch's, deduped", () => {
    /*
     * The header carries at most what the FIRST chunk's envelope declared;
     * the batch query over ExceptionInstance is the real producer. An id
     * present in both must appear once, and the header's ids keep their
     * slots at the front.
     */
    const row: JSONObject = rowFor(
      [makeChunkRow({ chunkIndex: 0 })],
      makeProvisionalHeader({ exceptionFingerprints: ["fingerprint-1"] }),
      [],
      ["fingerprint-2", "fingerprint-1", "fingerprint-3"],
    );

    expect(row["exceptionFingerprints"]).toEqual([
      "fingerprint-1",
      "fingerprint-2",
      "fingerprint-3",
    ]);
  });

  test("exception fingerprints stay capped", () => {
    const manyFingerprints: Array<string> = Array.from(
      { length: MAX_EXCEPTION_FINGERPRINTS_PER_SESSION + 40 },
      (_unused: unknown, index: number): string => {
        return `fp-${index}`;
      },
    );

    const row: JSONObject = rowFor(
      [makeChunkRow({ chunkIndex: 0 })],
      makeProvisionalHeader({ exceptionFingerprints: ["fingerprint-1"] }),
      [],
      manyFingerprints,
    );

    const fingerprints: Array<string> = row[
      "exceptionFingerprints"
    ] as Array<string>;

    expect(fingerprints.length).toBe(MAX_EXCEPTION_FINGERPRINTS_PER_SESSION);
    /* The header-declared id survives cap pressure. */
    expect(fingerprints[0]).toBe("fingerprint-1");
  });

  test("a session with no exceptions keeps its header fingerprints untouched", () => {
    const row: JSONObject = rowFor(
      [makeChunkRow({ chunkIndex: 0 })],
      makeProvisionalHeader(),
      [],
      [],
    );

    expect(row["exceptionFingerprints"]).toEqual(["fingerprint-1"]);
  });

  test("a headerless session with no exceptions gets an empty array, not undefined", () => {
    const row: JSONObject = rowFor([makeChunkRow({ chunkIndex: 0 })], null);

    expect(row["exceptionFingerprints"]).toEqual([]);
    expect(row["traceIds"]).toEqual([]);
  });
});

describe("Rum:FinalizeSessions queries", () => {
  test("the chunk aggregate dedupes redeliveries and groups per tab", () => {
    const statement: Statement = buildTabAggregateStatement({
      databaseName: databaseName,
      projectId: projectId,
      sessionId: sessionId,
    });

    const query: string = statement.query;

    /*
     * Pins the two properties the in-test GROUP BY model above assumes.
     * Losing the LIMIT 1 BY would double-count the metering signal on
     * every retried chunk, and there is no FINAL support in this repo to
     * fall back on.
     */
    expect(query).toContain("ORDER BY version DESC");
    expect(query).toContain("LIMIT 1 BY tabId, chunkIndex");
    expect(query).toContain("GROUP BY tabId");
    expect(query).toContain("sum(payloadBytes)");
    expect(query).toContain("sum(eventCount)");
    expect(query).toContain("max(chunkIndex)");
    expect(query).toContain("groupArrayIf(chunkIndex, hasFullSnapshot)");

    /*
     * The payload column must never be read here: it is the fattest column
     * in the system and finalization needs none of it.
     */
    expect(query).not.toContain("payload,");
    expect(query).not.toContain("SELECT *");

    /* Both key-range predicates are bound, never interpolated. */
    const params: Record<string, unknown> = statement.query_params;
    expect(Object.values(params)).toContain(projectId.toString());
    expect(Object.values(params)).toContain(sessionId);
  });

  test("the header read collapses ReplacingMergeTree versions", () => {
    const statement: Statement = buildProvisionalHeaderStatement({
      databaseName: databaseName,
      projectId: projectId,
      rumApplicationId: "6600000000000000000000b2",
      sessionId: sessionId,
    });

    const query: string = statement.query;

    expect(query).toContain("ORDER BY version DESC");
    expect(query).toContain("LIMIT 1");
    /* Raw text, because startTime is a sort key and partition key. */
    expect(query).toContain("toString(startTime) AS startTimeText");
    /* rumApplicationId narrows the key range to one application. */
    expect(query).toContain("rumApplicationId =");
  });
});

/*
 * The correlation producer: at finalize time, ONE grouped query per
 * telemetry table per batch fills traceIds (Span.sessionId is stamped and
 * bloom-indexed) and exceptionFingerprints (ExceptionInstance.sessionId)
 * for every session in the batch. This is what the
 * /telemetry/rum/session-replay/for-exception endpoint switches on.
 */
describe("Rum:FinalizeSessions correlation producer", () => {
  const sessionIds: Array<string> = [
    sessionId,
    "2a1b3c4d5e6f708192a3b4c5d6e7f809",
  ];
  const windowStartUnixMs: number = new Date(
    "2026-07-29T06:00:00.000Z",
  ).getTime();
  const windowEndUnixMs: number = new Date(
    "2026-07-29T11:00:00.000Z",
  ).getTime();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function resultSetOf(rows: Array<JSONObject>): Results {
    return {
      json: () => {
        return Promise.resolve({ data: rows });
      },
    } as unknown as Results;
  }

  test("the exception query is one grouped read scoped to project, window and batch", () => {
    const statement: Statement = buildSessionExceptionFingerprintStatement({
      databaseName: databaseName,
      projectId: projectId,
      sessionIds: sessionIds,
      windowStartUnixMs: windowStartUnixMs,
      windowEndUnixMs: windowEndUnixMs,
    });

    const query: string = statement.query;

    /* Deduped and capped inside ClickHouse, grouped for the whole batch. */
    expect(query).toContain(
      `groupUniqArray(${MAX_EXCEPTION_FINGERPRINTS_PER_SESSION})(fingerprint)`,
    );
    expect(query).toContain("GROUP BY sessionId");
    /* One IN over the batch, never a query per session. */
    expect(query).toContain("sessionId IN");
    expect(query).toContain("fingerprint != ''");
    expect(query).toContain("time >=");
    expect(query).toContain("time <=");

    const bound: Array<unknown> = Object.values(statement.query_params);

    expect(bound).toContainEqual(projectId.toString());
    /* The batch's session ids ride as ONE bound array parameter. */
    expect(bound).toContainEqual(sessionIds);
    expect(bound).toContainEqual(
      OneUptimeDate.toClickhouseDateTime64(new Date(windowStartUnixMs)),
    );
    expect(bound).toContainEqual(
      OneUptimeDate.toClickhouseDateTime64(new Date(windowEndUnixMs)),
    );
  });

  test("the span query mirrors the exception query over Span.startTime/traceId", () => {
    const statement: Statement = buildSessionTraceIdStatement({
      databaseName: databaseName,
      projectId: projectId,
      sessionIds: sessionIds,
      windowStartUnixMs: windowStartUnixMs,
      windowEndUnixMs: windowEndUnixMs,
    });

    const query: string = statement.query;

    expect(query).toContain(
      `groupUniqArray(${MAX_TRACE_IDS_PER_SESSION})(traceId)`,
    );
    expect(query).toContain("GROUP BY sessionId");
    expect(query).toContain("sessionId IN");
    expect(query).toContain("traceId != ''");
    expect(query).toContain("startTime >=");
    expect(query).toContain("startTime <=");

    const bound: Array<unknown> = Object.values(statement.query_params);

    expect(bound).toContainEqual(projectId.toString());
    expect(bound).toContainEqual(sessionIds);
  });

  test("both grouped reads fold into one per-session map", async () => {
    const issuedStatements: Array<Statement> = [];

    jest
      .spyOn(RumSessionChunkService, "executeQuery")
      .mockImplementation((statement: Statement | string): Promise<Results> => {
        issuedStatements.push(statement as Statement);

        if ((statement as Statement).query.includes("fingerprint")) {
          return Promise.resolve(
            resultSetOf([
              {
                sessionId: sessionIds[0],
                exceptionFingerprints: ["fp-a", "fp-b"],
              },
            ]),
          );
        }

        return Promise.resolve(
          resultSetOf([
            { sessionId: sessionIds[0], traceIds: ["trace-1"] },
            { sessionId: sessionIds[1], traceIds: ["trace-2", "trace-3"] },
          ]),
        );
      });

    const correlation: Map<string, SessionCorrelation> =
      await fetchSessionCorrelation({
        databaseName: databaseName,
        projectId: projectId,
        sessionIds: sessionIds,
        windowStartUnixMs: windowStartUnixMs,
        windowEndUnixMs: windowEndUnixMs,
      });

    /* Exactly one grouped query per table — never one per session. */
    expect(issuedStatements.length).toBe(2);

    expect(correlation.get(sessionIds[0]!)).toEqual({
      traceIds: ["trace-1"],
      exceptionFingerprints: ["fp-a", "fp-b"],
    });
    /* A session with spans but no exceptions gets an empty fingerprints set. */
    expect(correlation.get(sessionIds[1]!)).toEqual({
      traceIds: ["trace-2", "trace-3"],
      exceptionFingerprints: [],
    });
  });

  test("a session with no telemetry at all has no entry — and finalizes to []", () => {
    const correlationlessRow: JSONObject = buildFinalizedSessionRow({
      projectId: projectId,
      sessionId: sessionId,
      aggregate: combineTabAggregates([]),
      header: null,
      traceIds: [],
      exceptionFingerprints: [],
      writtenAt: new Date("2026-07-29T10:20:00.000Z"),
    });

    expect(correlationlessRow["exceptionFingerprints"]).toEqual([]);
    expect(correlationlessRow["traceIds"]).toEqual([]);
  });

  test("an empty batch performs no reads", async () => {
    let queriesIssued: number = 0;

    jest
      .spyOn(RumSessionChunkService, "executeQuery")
      .mockImplementation((): Promise<Results> => {
        queriesIssued++;
        return Promise.resolve(resultSetOf([]));
      });

    const correlation: Map<string, SessionCorrelation> =
      await fetchSessionCorrelation({
        databaseName: databaseName,
        projectId: projectId,
        sessionIds: [],
        windowStartUnixMs: windowStartUnixMs,
        windowEndUnixMs: windowEndUnixMs,
      });

    expect(correlation.size).toBe(0);
    expect(queriesIssued).toBe(0);
  });

  test("a failed read degrades to missing enrichment, never a failed finalization", async () => {
    /*
     * The header write is what drives metering; correlation is
     * enrichment. One table being unreadable must not stop the other
     * from contributing, and must not throw into the finalize loop.
     */
    jest
      .spyOn(RumSessionChunkService, "executeQuery")
      .mockImplementation((statement: Statement | string): Promise<Results> => {
        if ((statement as Statement).query.includes("fingerprint")) {
          return Promise.reject(new Error("ClickHouse timeout"));
        }

        return Promise.resolve(
          resultSetOf([{ sessionId: sessionIds[0], traceIds: ["trace-1"] }]),
        );
      });

    const correlation: Map<string, SessionCorrelation> =
      await fetchSessionCorrelation({
        databaseName: databaseName,
        projectId: projectId,
        sessionIds: sessionIds,
        windowStartUnixMs: windowStartUnixMs,
        windowEndUnixMs: windowEndUnixMs,
      });

    expect(correlation.get(sessionIds[0]!)).toEqual({
      traceIds: ["trace-1"],
      exceptionFingerprints: [],
    });
  });

  test("malformed grouped rows are skipped without poisoning the batch", async () => {
    jest
      .spyOn(RumSessionChunkService, "executeQuery")
      .mockImplementation((statement: Statement | string): Promise<Results> => {
        if ((statement as Statement).query.includes("fingerprint")) {
          return Promise.resolve(
            resultSetOf([
              /* No sessionId — cannot be attributed to anyone. */
              { exceptionFingerprints: ["fp-orphan"] },
              /* Non-array payload — coerced to []. */
              { sessionId: sessionIds[0], exceptionFingerprints: "fp-a" },
            ]),
          );
        }

        return Promise.resolve(
          resultSetOf([
            /* Null-ish members inside the array are dropped, not stringified. */
            { sessionId: sessionIds[0], traceIds: ["trace-1", null, ""] },
          ]),
        );
      });

    const correlation: Map<string, SessionCorrelation> =
      await fetchSessionCorrelation({
        databaseName: databaseName,
        projectId: projectId,
        sessionIds: sessionIds,
        windowStartUnixMs: windowStartUnixMs,
        windowEndUnixMs: windowEndUnixMs,
      });

    expect(correlation.get(sessionIds[0]!)?.exceptionFingerprints).toEqual([]);
    expect(correlation.get(sessionIds[0]!)?.traceIds).toEqual(["trace-1"]);
  });
});

describe("Rum:FinalizeSessions activity members", () => {
  test("splits on the first separator so an opaque tabId survives", () => {
    expect(parseActiveSessionMember(`${sessionId}:tab:1:2`)).toEqual({
      sessionId: sessionId,
      tabId: "tab:1:2",
    });
  });

  test("rejects malformed members instead of finalizing a wrong session", () => {
    expect(parseActiveSessionMember(sessionId)).toBeNull();
    expect(parseActiveSessionMember(`:tab-a`)).toBeNull();
    expect(parseActiveSessionMember(`${sessionId}:`)).toBeNull();
  });
});

describe("Rum:FinalizeSessions row parsing", () => {
  test("64-bit aggregates arriving as JSON strings are coerced", () => {
    /*
     * ClickHouse quotes 64-bit integers in JSON output on some server
     * versions and not others, so a naive cast would silently produce
     * string concatenation in the sums.
     */
    const parsed: TabChunkAggregate = parseTabAggregateRow({
      tabId: "tab-a",
      chunkCount: "3",
      maxChunkIndex: 2,
      chunkIndexes: [0, 1, 2],
      fullSnapshotChunkIndexes: [0],
      eventCount: "30",
      payloadBytes: "3000",
      errorCount: 1,
      rageClickCount: 0,
      deadClickCount: 0,
      errorClickCount: 0,
      refreshRageCount: 0,
      routeCount: 0,
      hasFinalChunk: 1,
      sessionStartUnixMs: String(sessionStartUnixMs),
      lastChunkEndUnixMs: String(sessionStartUnixMs + 45_000),
      maxChunkEndOffsetMs: 45_000,
      schemaVersion: 1,
      recorderKind: "dom",
      rumApplicationId: "6600000000000000000000b2",
      primaryEntityId: "6600000000000000000000b2",
      primaryEntityType: "RealUserMonitor",
      retentionDate: "2026-08-05",
    });

    expect(parsed.chunkCount).toBe(3);
    expect(parsed.eventCount).toBe(30);
    expect(parsed.payloadBytes).toBe(3000);
    expect(parsed.hasFinalChunk).toBe(true);
    expect(parsed.sessionStartUnixMs).toBe(sessionStartUnixMs);
  });
});

/*
 * The never-finalized sweep. Finalization discovery lives in a Redis that
 * runs with persistence off, so a Redis restart used to orphan every
 * in-flight session permanently — provisional forever, and unmetered,
 * because billing reads only finalized headers. The sweep is the
 * ClickHouse-side safety net that turns that loss into bounded delay.
 */
describe("Rum:SweepNeverFinalizedSessions statement", () => {
  const nowUnixMs: number = new Date("2026-07-30T12:00:00.000Z").getTime();

  function buildStatement(): Statement {
    return buildNeverFinalizedStatement({
      databaseName: databaseName,
      nowUnixMs: nowUnixMs,
      limit: MAX_SWEEP_SESSIONS_PER_RUN,
    });
  }

  test("dedupes with argMax over version, never a bare isFinalized filter", () => {
    const statement: Statement = buildStatement();

    /*
     * Until a background merge collapses the ReplacingMergeTree versions,
     * a finalized session still has its old provisional row visible. A
     * bare WHERE isFinalized = 0 would re-finalize every recently
     * finalized session in the window on every single run.
     */
    expect(statement.query).toContain(
      "HAVING argMax(toUInt8(isFinalized), version) = 0",
    );
    expect(statement.query).toContain(
      "GROUP BY projectId, rumApplicationId, sessionId",
    );
    expect(statement.query).not.toMatch(/WHERE[^G]*isFinalized/);
  });

  test("bounds the scan to sessions old enough that no chunk can still arrive", () => {
    const statement: Statement = buildStatement();

    const bound: Array<unknown> = Object.values(statement.query_params);

    /* DateTime64 params are bound as ClickHouse datetime strings. */
    const cutoff: string = OneUptimeDate.toClickhouseDateTime64(
      new Date(nowUnixMs - SWEEP_MIN_SESSION_AGE_MS),
    );
    const floor: string = OneUptimeDate.toClickhouseDateTime64(
      new Date(nowUnixMs - SWEEP_LOOKBACK_MS),
    );

    expect(bound).toContain(cutoff);
    expect(bound).toContain(floor);

    /* Expired sessions are the TTL's problem, not the sweep's. */
    expect(statement.query).toContain("retentionDate >= now()");
    expect(bound).toContain(MAX_SWEEP_SESSIONS_PER_RUN);
  });

  test("the sweep carries each session's startTime so correlation gets a window", () => {
    const statement: Statement = buildStatement();

    expect(statement.query).toContain(
      "toUnixTimestamp64Milli(max(startTime)) AS startTimeUnixMs",
    );
  });

  test("the sweep age floor clears the recorder's hard session cap", () => {
    /*
     * Finalizing an ACTIVE session early publishes an under-count. The
     * cutoff must exceed the longest a session can legally keep receiving
     * chunks (the 4h cap) by a margin.
     */
    expect(SWEEP_MIN_SESSION_AGE_MS).toBeGreaterThan(
      SESSION_REPLAY_MAX_SESSION_MS,
    );
  });
});

describe("recording-lost seal", () => {
  test("the sealedReason override wins over anything the aggregate resolves", () => {
    const header: ProvisionalSessionHeader = makeProvisionalHeader();

    const emptyAggregate: SessionChunkAggregate = {
      tabCount: 0,
      chunkCount: 0,
      maxChunkIndex: 0,
      missingChunkCount: 0,
      fullSnapshotChunkIndexes: [],
      eventCount: 0,
      payloadBytes: 0,
      errorCount: 0,
      rageClickCount: 0,
      deadClickCount: 0,
      errorClickCount: 0,
      refreshRageCount: 0,
      pageCount: 0,
      hasFinalChunk: false,
      sessionStartUnixMs: header.startTimeUnixMs,
      lastChunkEndUnixMs: header.startTimeUnixMs,
      schemaVersion: header.schemaVersion,
      recorderKind: header.recorderKind,
      rumApplicationId: header.rumApplicationId,
      primaryEntityId: header.primaryEntityId,
      primaryEntityType: header.primaryEntityType,
      retentionDate: header.retentionDateText,
    };

    const row: JSONObject = buildFinalizedSessionRow({
      projectId: projectId,
      sessionId: sessionId,
      aggregate: emptyAggregate,
      header: header,
      traceIds: [],
      exceptionFingerprints: [],
      writtenAt: new Date("2026-07-30T12:00:00.000Z"),
      sealedReasonOverride: SessionReplaySealedReason.RecordingLost,
    });

    expect(row["sealedReason"]).toBe(SessionReplaySealedReason.RecordingLost);
    expect(row["isFinalized"]).toBe(true);
    expect(row["chunkCount"]).toBe(0);

    /*
     * The sealed row must share the provisional row's exact replace key,
     * or it sits BESIDE it instead of replacing it — startTime is carried
     * byte for byte.
     */
    expect(row["startTime"]).toBe(header.startTimeText);
    expect(row["rumApplicationId"]).toBe(header.rumApplicationId);
  });
});
