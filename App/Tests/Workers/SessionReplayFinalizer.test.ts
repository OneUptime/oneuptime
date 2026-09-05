import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import {
  MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
  SESSION_REPLAY_ACTIVE_CHUNK_MIN_EVENTS,
  SESSION_REPLAY_MAX_SESSION_MS,
  SESSION_REPLAY_SCHEMA_VERSION,
  SESSION_REPLAY_WIRE_VERSION,
  SessionReplaySealedReason,
} from "Common/Types/Rum/SessionReplay";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

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

/*
 * The subset of ioredis the finalizer touches, in memory, so the job loops
 * (which own the ZREM-only-on-success, sweep and reconcile contracts) can be
 * driven end to end rather than only their row builders.
 */
class MockRedis {
  public strings: Map<string, string> = new Map<string, string>();
  public sets: Map<string, Set<string>> = new Map<string, Set<string>>();
  public zsets: Map<string, Map<string, number>> = new Map<
    string,
    Map<string, number>
  >();
  public connected: boolean = true;
  public scanCalls: Array<string> = [];
  /* Keys handed out per SCAN page, and the cursor the page reports next. */
  public scanPages: Array<{ keys: Array<string>; next: string }> = [];

  public reset(): void {
    this.strings = new Map<string, string>();
    this.sets = new Map<string, Set<string>>();
    this.zsets = new Map<string, Map<string, number>>();
    this.connected = true;
    this.scanCalls = [];
    this.scanPages = [];
  }

  public client(): unknown {
    return {
      get: (key: string): Promise<string | null> => {
        return Promise.resolve(this.strings.get(key) ?? null);
      },
      set: (
        key: string,
        value: string,
        _expiryToken?: string,
        _seconds?: number,
        nxToken?: string,
      ): Promise<"OK" | null> => {
        if (nxToken === "NX" && this.strings.has(key)) {
          return Promise.resolve(null);
        }
        this.strings.set(key, value);
        return Promise.resolve("OK");
      },
      sadd: (key: string, members: Array<string> | string): Promise<number> => {
        const set: Set<string> = this.sets.get(key) || new Set<string>();
        for (const member of Array.isArray(members) ? members : [members]) {
          set.add(member);
        }
        this.sets.set(key, set);
        return Promise.resolve(set.size);
      },
      smembers: (key: string): Promise<Array<string>> => {
        return Promise.resolve(Array.from(this.sets.get(key) || []));
      },
      srem: (key: string, member: string): Promise<number> => {
        return Promise.resolve(this.sets.get(key)?.delete(member) ? 1 : 0);
      },
      sismember: (key: string, member: string): Promise<number> => {
        return Promise.resolve(this.sets.get(key)?.has(member) ? 1 : 0);
      },
      zadd: (key: string, score: number, member: string): Promise<number> => {
        const zset: Map<string, number> =
          this.zsets.get(key) || new Map<string, number>();
        zset.set(member, score);
        this.zsets.set(key, zset);
        return Promise.resolve(1);
      },
      zrem: (key: string, members: Array<string> | string): Promise<number> => {
        const zset: Map<string, number> | undefined = this.zsets.get(key);
        let removed: number = 0;
        for (const member of Array.isArray(members) ? members : [members]) {
          if (zset?.delete(member)) {
            removed++;
          }
        }
        return Promise.resolve(removed);
      },
      zcard: (key: string): Promise<number> => {
        return Promise.resolve(this.zsets.get(key)?.size || 0);
      },
      zrangebyscore: (
        key: string,
        _min: string,
        max: number,
      ): Promise<Array<string>> => {
        const flat: Array<string> = [];
        for (const [member, score] of this.zsets.get(key)?.entries() || []) {
          if (score <= max) {
            flat.push(member, String(score));
          }
        }
        return Promise.resolve(flat);
      },
      scan: (cursor: string): Promise<[string, Array<string>]> => {
        this.scanCalls.push(cursor);
        const page: { keys: Array<string>; next: string } | undefined =
          this.scanPages.shift();
        if (page) {
          return Promise.resolve([page.next, page.keys]);
        }
        return Promise.resolve(["0", Array.from(this.zsets.keys())]);
      },
    };
  }
}

const mockRedis: MockRedis = new MockRedis();

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        return mockRedis.connected ? mockRedis.client() : null;
      },
      isConnected: (): boolean => {
        return mockRedis.connected;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
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
  discoverActiveProjectIds,
  fetchSessionCorrelation,
  finalizeExpiredSessions,
  getActiveSessionsKey,
  getSessionSealHintKey,
  MAX_EXCEPTION_FINGERPRINTS_PER_SESSION,
  MAX_SWEEP_SESSIONS_PER_RUN,
  MAX_TRACE_IDS_PER_SESSION,
  parseActiveSessionMember,
  parseTabAggregateRow,
  PROJECT_INDEX_SCAN_CURSOR_KEY,
  ProvisionalSessionHeader,
  reconcileActiveProjectIndex,
  resolveSealedReason,
  SESSION_REPLAY_ACTIVE_PROJECTS_KEY,
  SESSION_REPLAY_IDLE_FINALIZE_MS,
  SessionChunkAggregate,
  SessionCorrelation,
  SWEEP_LOOKBACK_MS,
  SWEEP_MIN_SESSION_AGE_MS,
  sweepNeverFinalizedSessions,
  TabChunkAggregate,
} from "../../FeatureSet/Workers/Jobs/Rum/FinalizeSessions";
import RumSessionChunkService from "Common/Server/Services/RumSessionChunkService";
import RumSessionService from "Common/Server/Services/RumSessionService";
import { ClientType } from "Common/Server/Infrastructure/Redis";
import { Results } from "Common/Server/Services/AnalyticsDatabaseService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import { getErasedSessionsKey } from "Common/Server/Utils/SessionReplay/SessionReplayErasureTombstone";

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
  clickCount: number;
  customEventCount: number;
  url: string;
  routes: Array<string>;
  sessionStartUnixMs: number;
  chunkStartUnixMs: number;
  chunkEndUnixMs: number;
  chunkStartOffsetMs: number;
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
  clickCount?: number;
  customEventCount?: number;
  url?: string;
  routes?: Array<string>;
  /*
   * Two RUM applications on one origin share sessionStorage, so they share
   * the browser-minted sessionId; the chunk rows are what tells them apart.
   */
  rumApplicationId?: string;
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
    clickCount: data.clickCount ?? 0,
    customEventCount: data.customEventCount ?? 0,
    /*
     * Empty by default so the pre-existing fixtures keep exercising the
     * "chunks written before the url/routes columns existed" path, where
     * the finalizer must still fall back to the provisional header.
     */
    url: data.url ?? "",
    routes: data.routes ?? (data.url ? [data.url] : []),
    sessionStartUnixMs: sessionStartUnixMs,
    chunkStartUnixMs: sessionStartUnixMs + chunkIndex * CHUNK_DURATION_MS,
    chunkEndUnixMs: sessionStartUnixMs + (chunkIndex + 1) * CHUNK_DURATION_MS,
    chunkStartOffsetMs: chunkIndex * CHUNK_DURATION_MS,
    chunkEndOffsetMs: (chunkIndex + 1) * CHUNK_DURATION_MS,
    schemaVersion: SESSION_REPLAY_SCHEMA_VERSION,
    recorderKind: "dom",
    rumApplicationId: data.rumApplicationId ?? "6600000000000000000000b2",
    primaryEntityId: data.rumApplicationId ?? "6600000000000000000000b2",
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
/* ClickHouse argMinIf / argMaxIf over a non-empty url. */
function pickUrlBy(
  rows: Array<RawChunkRow>,
  clock: (row: RawChunkRow) => number,
  wantEarliest: boolean,
): string {
  let chosen: RawChunkRow | null = null;

  for (const row of rows) {
    if (!row.url) {
      continue;
    }

    if (!chosen) {
      chosen = row;
      continue;
    }

    const isBetter: boolean = wantEarliest
      ? clock(row) < clock(chosen)
      : clock(row) >= clock(chosen);

    if (isBetter) {
      chosen = row;
    }
  }

  return chosen ? chosen.url : "";
}

/*
 * ClickHouse minIf(chunkStartTime, url != '') / maxIf(chunkEndTime, url != '').
 * 0 when no chunk of the tab carries a url, exactly as ClickHouse returns.
 */
function clockOfUrlBearing(
  rows: Array<RawChunkRow>,
  wantEarliestStart: boolean,
): number {
  const times: Array<number> = rows
    .filter((row: RawChunkRow): boolean => {
      return Boolean(row.url);
    })
    .map((row: RawChunkRow): number => {
      return wantEarliestStart ? row.chunkStartUnixMs : row.chunkEndUnixMs;
    });

  if (times.length === 0) {
    return 0;
  }

  return wantEarliestStart ? Math.min(...times) : Math.max(...times);
}

/* ClickHouse arraySort(arrayDistinct(arrayFlatten(groupArray(routes)))). */
function distinctRoutes(rows: Array<RawChunkRow>): Array<string> {
  const seen: Set<string> = new Set<string>();

  for (const row of rows) {
    for (const route of row.routes) {
      seen.add(route);
    }
  }

  return Array.from(seen).sort();
}

function runGroupByOverChunkRows(rows: Array<RawChunkRow>): Array<JSONObject> {
  const latestByIdentity: Map<string, RawChunkRow> = new Map<
    string,
    RawChunkRow
  >();

  /*
   * LIMIT 1 BY rumApplicationId, tabId, chunkIndex - the application is in
   * the dedupe key because two applications share the sessionId, and
   * without it one application's chunks silently evict the other's.
   */
  for (const row of rows) {
    const identity: string = `${row.rumApplicationId}:${row.tabId}:${row.chunkIndex}`;
    const existing: RawChunkRow | undefined = latestByIdentity.get(identity);

    if (!existing || row.version > existing.version) {
      latestByIdentity.set(identity, row);
    }
  }

  /* GROUP BY rumApplicationId, tabId. */
  const byTab: Map<string, Array<RawChunkRow>> = new Map<
    string,
    Array<RawChunkRow>
  >();

  for (const row of latestByIdentity.values()) {
    const groupKey: string = `${row.rumApplicationId}:${row.tabId}`;
    const existing: Array<RawChunkRow> | undefined = byTab.get(groupKey);

    if (existing) {
      existing.push(row);
    } else {
      byTab.set(groupKey, [row]);
    }
  }

  const groupRows: Array<JSONObject> = [];

  for (const tabRows of byTab.values()) {
    const tabId: string = tabRows[0]!.tabId;
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
      clickCount: sum((row: RawChunkRow): number => {
        return row.clickCount;
      }),
      customEventCount: sum((row: RawChunkRow): number => {
        return row.customEventCount;
      }),
      /* countIf(errorCount > 0) and minIf(chunkStartOffsetMs, errorCount > 0). */
      erroredChunkCount: tabRows.filter((row: RawChunkRow): boolean => {
        return row.errorCount > 0;
      }).length,
      firstErrorOffsetMs: String(
        tabRows
          .filter((row: RawChunkRow): boolean => {
            return row.errorCount > 0;
          })
          .reduce((lowest: number, row: RawChunkRow): number => {
            return Math.min(lowest, row.chunkStartOffsetMs);
          }, Number.MAX_SAFE_INTEGER) === Number.MAX_SAFE_INTEGER
          ? 0
          : tabRows
              .filter((row: RawChunkRow): boolean => {
                return row.errorCount > 0;
              })
              .reduce((lowest: number, row: RawChunkRow): number => {
                return Math.min(lowest, row.chunkStartOffsetMs);
              }, Number.MAX_SAFE_INTEGER),
      ),
      /* sumIf(chunkEndOffsetMs - chunkStartOffsetMs, eventCount >= 4). */
      activeMs: String(
        sum((row: RawChunkRow): number => {
          return row.eventCount >= SESSION_REPLAY_ACTIVE_CHUNK_MIN_EVENTS
            ? row.chunkEndOffsetMs - row.chunkStartOffsetMs
            : 0;
        }),
      ),
      /*
       * argMinIf(url, chunkStartTime, url != '') and its argMax twin: the
       * earliest and latest NON-EMPTY url of the tab, which is what makes a
       * pre-migration chunk (url = '') fall through to the header instead of
       * blanking the column.
       */
      firstUrl: pickUrlBy(
        tabRows,
        (row: RawChunkRow): number => {
          return row.chunkStartUnixMs;
        },
        true,
      ),
      lastUrl: pickUrlBy(
        tabRows,
        (row: RawChunkRow): number => {
          return row.chunkEndUnixMs;
        },
        false,
      ),
      /* minIf / maxIf over the url-bearing chunks, and countIf. */
      firstUrlAtUnixMs: String(clockOfUrlBearing(tabRows, true)),
      lastUrlAtUnixMs: String(clockOfUrlBearing(tabRows, false)),
      urlChunkCount: tabRows.filter((row: RawChunkRow): boolean => {
        return Boolean(row.url);
      }).length,
      /* arrayDistinct(arrayFlatten(groupArray(routes))) */
      routes: distinctRoutes(tabRows),
      hasFinalChunk: tabRows.some((row: RawChunkRow): boolean => {
        return row.isFinal;
      })
        ? 1
        : 0,
      firstChunkStartUnixMs: String(
        Math.min(
          ...tabRows.map((row: RawChunkRow): number => {
            return row.chunkStartUnixMs;
          }),
        ),
      ),
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
      rumApplicationId: tabRows[0]!.rumApplicationId,
      primaryEntityId: tabRows[0]!.primaryEntityId,
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
    errorCount: 0,
    rageClickCount: 0,
    deadClickCount: 0,
    errorClickCount: 0,
    refreshRageCount: 0,
    pageCount: 0,
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
    identifiedUserTraits: {},
    tags: {},
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

  /*
   * Audit finding workers-lifecycle-7: chunkIndex is minted PER TAB and the
   * ingest gate caps it per tab, so truncation is judged on the highest
   * index any one tab reached - never on the cross-tab sum.
   */
  test("a tab that reached the per-session chunk cap reports truncation", () => {
    expect(
      resolveSealedReason({
        aggregate: {
          ...baseAggregate,
          chunkCount: MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
          maxChunkIndex: MAX_SESSION_REPLAY_CHUNKS_PER_SESSION - 1,
        },
        durationMs: 60_000,
        existingSealedReason: "",
      }),
    ).toBe(SessionReplaySealedReason.Truncated);
  });

  test("two tabs of 250 chunks each are NOT truncated", () => {
    const rows: Array<RawChunkRow> = [];

    for (let index: number = 0; index < 250; index++) {
      rows.push(makeChunkRow({ chunkIndex: index, tabId: "tab-a" }));
      rows.push(makeChunkRow({ chunkIndex: index, tabId: "tab-b" }));
    }

    const aggregate: SessionChunkAggregate = aggregateOf(rows);

    expect(aggregate.chunkCount).toBe(500);
    expect(aggregate.maxChunkIndex).toBe(249);
    expect(
      resolveSealedReason({
        aggregate: aggregate,
        durationMs: 60_000,
        existingSealedReason: "",
      }),
    ).toBe(SessionReplaySealedReason.IdleTimeout);
  });

  test("the gate's seal hint wins over what the chunks can say", () => {
    const rows: Array<RawChunkRow> = [
      makeChunkRow({ chunkIndex: 0 }),
      makeChunkRow({ chunkIndex: 1 }),
    ];

    const row: JSONObject = buildFinalizedSessionRow({
      projectId: projectId,
      sessionId: sessionId,
      aggregate: aggregateOf(rows),
      header: makeProvisionalHeader(),
      traceIds: [],
      exceptionFingerprints: [],
      writtenAt: new Date("2026-07-29T10:20:00.000Z"),
      sealedReasonHint: SessionReplaySealedReason.Budget,
    });

    expect(row["sealedReason"]).toBe(SessionReplaySealedReason.Budget);
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

  /*
   * WHERE the session went.
   *
   * entryUrl / exitUrl / routes[] used to be copied verbatim from the
   * provisional header, which the ingest writes once, on chunk 0. The
   * consequences were all visible in the product:
   *
   *   - a single-page app reported its LANDING page as its exit URL for the
   *     life of the session;
   *   - routes[] could never hold more than one element, so the "Exit page
   *     URL (exact)" filter returned nothing for a page the user
   *     demonstrably reached, and the bloom index over routes was built on
   *     a one-element array;
   *   - pageCount and routes.length disagreed on the same row, which reads
   *     as data corruption;
   *   - a session spanning two page loads had its entryUrl OVERWRITTEN by
   *     the second load, because a new page load mints a new tabId and
   *     therefore a second chunkIndex === 0.
   */
  describe("entry, exit and route derivation", () => {
    const HOME: string = "https://shop.example.com/";
    const CART: string = "https://shop.example.com/cart";
    const CHECKOUT: string = "https://shop.example.com/checkout";

    test("the exit url is the last url of the last chunk, not chunk 0's", () => {
      const rows: Array<RawChunkRow> = [
        makeChunkRow({ chunkIndex: 0, url: HOME }),
        makeChunkRow({ chunkIndex: 1, url: CART, routeCount: 1 }),
        makeChunkRow({
          chunkIndex: 2,
          url: CHECKOUT,
          routeCount: 1,
          isFinal: true,
        }),
      ];

      const row: JSONObject = rowFor(
        rows,
        makeProvisionalHeader({
          entryUrl: HOME,
          exitUrl: HOME,
          routes: [HOME],
        }),
      );

      expect(row["exitUrl"]).toBe(CHECKOUT);
      expect(row["entryUrl"]).toBe(HOME);
    });

    /*
     * routes[] is a de-duplicated, SORTED set - not a path. groupArray's
     * element order is unspecified under parallel aggregation, and the
     * header is a ReplacingMergeTree row the sweep can rewrite, so two runs
     * over identical chunks have to produce identical bytes. entryUrl and
     * exitUrl are what answer the ordered questions.
     */
    test("routes hold every page visited, not just the first", () => {
      const rows: Array<RawChunkRow> = [
        makeChunkRow({ chunkIndex: 0, url: HOME }),
        makeChunkRow({ chunkIndex: 1, url: CART, routeCount: 1 }),
        makeChunkRow({
          chunkIndex: 2,
          url: CHECKOUT,
          routeCount: 1,
          isFinal: true,
        }),
      ];

      const row: JSONObject = rowFor(
        rows,
        makeProvisionalHeader({
          entryUrl: HOME,
          exitUrl: HOME,
          routes: [HOME],
        }),
      );

      expect(row["routes"]).toEqual([HOME, CART, CHECKOUT].sort());
    });

    test("routes are sorted, so re-finalizing produces an identical row", () => {
      const rows: Array<RawChunkRow> = [
        makeChunkRow({ chunkIndex: 0, url: CHECKOUT }),
        makeChunkRow({ chunkIndex: 1, url: HOME }),
        makeChunkRow({ chunkIndex: 2, url: CART, isFinal: true }),
      ];

      const first: JSONObject = rowFor(rows, null);

      /* Same chunks, arriving in a different order from the database. */
      const second: JSONObject = rowFor([...rows].reverse(), null);

      expect(first["routes"]).toEqual(second["routes"]);
      expect(first["routes"]).toEqual(
        [...(first["routes"] as Array<string>)].sort(),
      );
    });

    /*
     * The invariant worth keeping: pageCount is summed from routeCount and
     * was already correct, so tying the list to the count means neither can
     * drift without the other noticing.
     */
    test("routes.length and pageCount can no longer disagree", () => {
      const rows: Array<RawChunkRow> = [
        makeChunkRow({ chunkIndex: 0, url: HOME }),
        makeChunkRow({ chunkIndex: 1, url: CART, routeCount: 1 }),
        makeChunkRow({
          chunkIndex: 2,
          url: CHECKOUT,
          routeCount: 1,
          isFinal: true,
        }),
      ];

      const row: JSONObject = rowFor(
        rows,
        makeProvisionalHeader({
          entryUrl: HOME,
          exitUrl: HOME,
          routes: [HOME],
        }),
      );

      /* Entry page + one per route change. */
      expect((row["routes"] as Array<string>).length).toBe(
        (row["pageCount"] as number) + 1,
      );
    });

    /*
     * Two navigations inside one 15s flush window are invisible to the
     * chunk's own url - which is why the envelope carries the route list
     * and the chunk table stores it.
     */
    test("routes visited and left inside one chunk are still recorded", () => {
      const rows: Array<RawChunkRow> = [
        makeChunkRow({
          chunkIndex: 0,
          url: CHECKOUT,
          routes: [HOME, CART, CHECKOUT],
          routeCount: 2,
          isFinal: true,
        }),
      ];

      const row: JSONObject = rowFor(
        rows,
        makeProvisionalHeader({
          entryUrl: HOME,
          exitUrl: HOME,
          routes: [HOME],
        }),
      );

      expect(row["routes"]).toEqual([HOME, CART, CHECKOUT].sort());
      expect(row["exitUrl"]).toBe(CHECKOUT);
    });

    /*
     * A session spanning two page loads. The SECOND tab's chunk 0 rewrote
     * the provisional header, so the header's entryUrl is the second load's
     * URL - the finalizer must not trust it.
     */
    test("a session spanning two page loads keeps its real entry url", () => {
      const rows: Array<RawChunkRow> = [
        makeChunkRow({ chunkIndex: 0, tabId: "tab-a", url: HOME }),
        makeChunkRow({ chunkIndex: 1, tabId: "tab-a", url: CART }),
        makeChunkRow({ chunkIndex: 0, tabId: "tab-b", url: CHECKOUT }),
        makeChunkRow({
          chunkIndex: 1,
          tabId: "tab-b",
          url: CHECKOUT,
          isFinal: true,
        }),
      ];

      /* What the clobbering second header write left behind. */
      const row: JSONObject = rowFor(
        rows,
        makeProvisionalHeader({
          entryUrl: CHECKOUT,
          exitUrl: CHECKOUT,
          routes: [CHECKOUT],
        }),
      );

      expect(row["entryUrl"]).toBe(HOME);
      expect(row["exitUrl"]).toBe(CHECKOUT);
      expect(row["routes"]).toEqual([HOME, CART, CHECKOUT].sort());
    });

    /*
     * Sessions recorded before the chunk table carried url/routes have empty
     * columns. They must keep rendering exactly as they do today rather than
     * losing their URLs to the new derivation.
     */
    test("chunks predating the url columns fall back to the header", () => {
      const rows: Array<RawChunkRow> = [0, 1, 2].map(
        (chunkIndex: number): RawChunkRow => {
          return makeChunkRow({ chunkIndex: chunkIndex });
        },
      );

      const row: JSONObject = rowFor(
        rows,
        makeProvisionalHeader({
          entryUrl: HOME,
          exitUrl: CHECKOUT,
          routes: [HOME, CHECKOUT],
        }),
      );

      expect(row["entryUrl"]).toBe(HOME);
      expect(row["exitUrl"]).toBe(CHECKOUT);
      expect(row["routes"]).toEqual([HOME, CHECKOUT].sort());
    });

    /*
     * A session live across the deploy that added the url column.
     *
     * argMinIf skips empty urls, so the earliest url the chunk table holds
     * is a MID-session page. Trusting it would move the session's entry URL
     * forward, and would throw away the provisional header - written from
     * chunk 0, before the deploy - which is the only thing that still knows
     * where the session began. The exit URL needs no such care: url-less
     * chunks are always chronologically earlier than url-bearing ones.
     */
    test("a session straddling the url migration keeps the header's entry url", () => {
      const rows: Array<RawChunkRow> = [
        /* Written by the old server: no url column. */
        makeChunkRow({ chunkIndex: 0 }),
        makeChunkRow({ chunkIndex: 1 }),
        /* Written after the deploy. */
        makeChunkRow({ chunkIndex: 2, url: CART }),
        makeChunkRow({ chunkIndex: 3, url: CHECKOUT, isFinal: true }),
      ];

      const row: JSONObject = rowFor(
        rows,
        makeProvisionalHeader({
          entryUrl: HOME,
          exitUrl: HOME,
          routes: [HOME],
        }),
      );

      expect(row["entryUrl"]).toBe(HOME);
      /* The exit url IS derivable, and is the newer, better answer. */
      expect(row["exitUrl"]).toBe(CHECKOUT);
    });

    /*
     * Two tabs of one session. sessionStartTime is written from the
     * recorder's localStorage record and is therefore IDENTICAL across
     * tabs, so it can order none of them - the merge has to compare the
     * per-chunk clocks, or it silently resolves to whatever order ClickHouse
     * grouped the tabs in, and flips between finalizations of the same
     * session.
     */
    test("two concurrent tabs resolve entry and exit urls deterministically", () => {
      const rows: Array<RawChunkRow> = [
        makeChunkRow({ chunkIndex: 0, tabId: "tab-a", url: HOME }),
        makeChunkRow({ chunkIndex: 1, tabId: "tab-a", url: CART }),
        makeChunkRow({ chunkIndex: 0, tabId: "tab-b", url: CHECKOUT }),
        makeChunkRow({
          chunkIndex: 1,
          tabId: "tab-b",
          url: CHECKOUT,
          isFinal: true,
        }),
      ];

      const forwards: JSONObject = rowFor(rows, null);
      const backwards: JSONObject = rowFor([...rows].reverse(), null);

      expect(forwards["entryUrl"]).toBe(backwards["entryUrl"]);
      expect(forwards["exitUrl"]).toBe(backwards["exitUrl"]);
      expect(forwards["routes"]).toEqual(backwards["routes"]);
    });

    test("a session with no header at all still reports its derived urls", () => {
      const rows: Array<RawChunkRow> = [
        makeChunkRow({ chunkIndex: 0, url: HOME }),
        makeChunkRow({ chunkIndex: 1, url: CART, isFinal: true }),
      ];

      const row: JSONObject = rowFor(rows, null);

      expect(row["entryUrl"]).toBe(HOME);
      expect(row["exitUrl"]).toBe(CART);
      expect(row["routes"]).toEqual([HOME, CART].sort());
    });

    test("a page visited twice appears once", () => {
      const rows: Array<RawChunkRow> = [
        makeChunkRow({ chunkIndex: 0, url: HOME }),
        makeChunkRow({ chunkIndex: 1, url: CART, routeCount: 1 }),
        makeChunkRow({
          chunkIndex: 2,
          url: HOME,
          routeCount: 1,
          isFinal: true,
        }),
      ];

      const row: JSONObject = rowFor(rows, null);

      expect(row["routes"]).toEqual([HOME, CART].sort());
      expect(row["exitUrl"]).toBe(HOME);
    });
  });

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
    /*
     * rumApplicationId leads both keys: two applications on one origin
     * share the browser-minted sessionId, so without it one application's
     * chunks evict the other's from the dedupe and both are folded into a
     * single header.
     */
    expect(query).toContain("LIMIT 1 BY rumApplicationId, tabId, chunkIndex");
    expect(query).toContain("GROUP BY rumApplicationId, tabId");
    expect(query).toContain("sum(payloadBytes)");
    expect(query).toContain("sum(eventCount)");
    expect(query).toContain("max(chunkIndex)");
    expect(query).toContain("groupArrayIf(chunkIndex, hasFullSnapshot)");

    /*
     * The URL derivation, pinned because the in-test GROUP BY model above
     * reimplements it and the two must not drift.
     *
     * Every clock here is a per-CHUNK time. sessionStartTime is the
     * SESSION's start, written from the recorder's localStorage record, so
     * it is identical across every tab and can order none of them - a merge
     * that compared it would silently resolve to ClickHouse's grouping
     * order and flip between finalizations of the same session.
     */
    expect(query).toContain("argMinIf(url, chunkStartTime, url != '')");
    expect(query).toContain("argMaxIf(url, chunkEndTime, url != '')");
    expect(query).toContain(
      "minIf(toUnixTimestamp64Milli(chunkStartTime), url != '')",
    );
    expect(query).toContain(
      "maxIf(toUnixTimestamp64Milli(chunkEndTime), url != '')",
    );
    expect(query).toContain("countIf(url != '')");
    expect(query).toContain("min(chunkStartTime)");

    /* Sorted in SQL: the route union is a set, and must be deterministic. */
    expect(query).toContain(
      "arraySort(arrayDistinct(arrayFlatten(groupArray(routes))))",
    );

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
      clickCount: 0,
      customEventCount: 0,
      firstErrorOffsetMs: 0,
      activeMs: 0,
      firstUrl: "",
      lastUrl: "",
      routes: [],
      firstUrlCoversSessionStart: false,
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

/*
 * ------------------------------------------------------------------
 * The job loops, driven end to end against the in-memory Redis and
 * stubbed ClickHouse services (audit finding workers-lifecycle-13).
 * ------------------------------------------------------------------
 */
interface StubbedService {
  executeQuery: unknown;
  insertJsonRows: unknown;
  database: unknown;
}

const chunkServiceStub: StubbedService =
  RumSessionChunkService as unknown as StubbedService;
const sessionServiceStub: StubbedService =
  RumSessionService as unknown as StubbedService;

const realExecuteQuery: unknown = chunkServiceStub.executeQuery;
const realInsertJsonRows: unknown = sessionServiceStub.insertJsonRows;
const realDatabase: unknown = chunkServiceStub.database;

function resultSetOf(rows: Array<JSONObject>): unknown {
  return {
    json: (): Promise<{ data: Array<JSONObject> }> => {
      return Promise.resolve({ data: rows });
    },
  };
}

/*
 * Routes each statement by its shape: the tab aggregate names the chunk
 * table, the header read names the header table, the correlation reads
 * name Span / ExceptionInstance. Returns the rows configured for each.
 */
function stubClickhouse(data: {
  tabRows?: Array<JSONObject>;
  headerRows?: Array<JSONObject>;
  sweepRows?: Array<JSONObject>;
  failAggregate?: Error;
}): { inserted: Array<JSONObject>; statements: Array<Statement> } {
  const inserted: Array<JSONObject> = [];
  const statements: Array<Statement> = [];

  chunkServiceStub.database = {
    getDatasourceOptions: (): { database: string } => {
      return { database: databaseName };
    },
  };

  chunkServiceStub.executeQuery = (statement: Statement): Promise<unknown> => {
    statements.push(statement);
    const query: string = statement.query;

    if (query.includes("HAVING argMax(toUInt8(isFinalized), version) = 0")) {
      return Promise.resolve(resultSetOf(data.sweepRows || []));
    }

    if (query.includes("GROUP BY rumApplicationId, tabId")) {
      if (data.failAggregate) {
        return Promise.reject(data.failAggregate);
      }
      return Promise.resolve(resultSetOf(data.tabRows || []));
    }

    if (query.includes("toString(startTime) AS startTimeText")) {
      /*
       * The provisional header read is application-pinned, so the stub
       * answers only the seeded rows for the application it was asked
       * about - which is what lets a shared-sessionId fixture give each
       * application its own header.
       */
      const boundValues: Array<unknown> = Object.values(statement.query_params);

      const headerRows: Array<JSONObject> = (data.headerRows || []).filter(
        (row: JSONObject): boolean => {
          return boundValues.includes(row["rumApplicationId"]);
        },
      );

      return Promise.resolve(resultSetOf(headerRows));
    }

    return Promise.resolve(resultSetOf([]));
  };

  sessionServiceStub.insertJsonRows = (
    rows: Array<JSONObject>,
  ): Promise<void> => {
    inserted.push(...rows);
    return Promise.resolve();
  };

  return { inserted, statements };
}

function headerRowOf(
  overrides?: Partial<ProvisionalSessionHeader>,
): JSONObject {
  return makeProvisionalHeader(overrides) as unknown as JSONObject;
}

describe("Rum:FinalizeSessions project index reconcile cursor", () => {
  beforeEach(() => {
    mockRedis.reset();
  });

  afterEach(() => {
    chunkServiceStub.executeQuery = realExecuteQuery;
    sessionServiceStub.insertJsonRows = realInsertJsonRows;
    chunkServiceStub.database = realDatabase;
  });

  function client(): ClientType {
    return mockRedis.client() as unknown as ClientType;
  }

  /*
   * Audit finding workers-lifecycle-6: a reconcile that always restarted
   * from "0" re-walked the same keys and never reached a project past the
   * iteration cap. The cursor now persists between runs.
   */
  test("resumes from the persisted cursor and stores where it stopped", async () => {
    mockRedis.strings.set(PROJECT_INDEX_SCAN_CURSOR_KEY, "4096");
    mockRedis.scanPages.push({
      keys: [getActiveSessionsKey("beyond-the-horizon")],
      next: "8192",
    });

    /*
     * A keyspace larger than the iteration cap: every further page still
     * reports more to come, so the walk stops at the cap with "8192" in
     * hand rather than finishing.
     */
    for (let page: number = 0; page < 250; page++) {
      mockRedis.scanPages.push({ keys: [], next: "8192" });
    }

    const discovered: Array<string> =
      await reconcileActiveProjectIndex(client());

    expect(mockRedis.scanCalls[0]).toBe("4096");
    expect(discovered).toEqual(["beyond-the-horizon"]);
    /* Stopped by the page's own cursor, so the next run continues there. */
    expect(mockRedis.strings.get(PROJECT_INDEX_SCAN_CURSOR_KEY)).toBe("8192");
    expect(
      mockRedis.sets
        .get(SESSION_REPLAY_ACTIVE_PROJECTS_KEY)
        ?.has("beyond-the-horizon"),
    ).toBe(true);
  });

  test("a finished walk stores 0 so the next reconcile starts over", async () => {
    mockRedis.strings.set(PROJECT_INDEX_SCAN_CURSOR_KEY, "77");
    mockRedis.scanPages.push({ keys: [], next: "0" });

    await reconcileActiveProjectIndex(client());

    expect(mockRedis.strings.get(PROJECT_INDEX_SCAN_CURSOR_KEY)).toBe("0");
  });

  test("a garbled cursor starts from 0 and never throws", async () => {
    mockRedis.strings.set(PROJECT_INDEX_SCAN_CURSOR_KEY, "not-a-cursor");
    mockRedis.scanPages.push({ keys: [], next: "0" });

    await expect(reconcileActiveProjectIndex(client())).resolves.toEqual([]);
    expect(mockRedis.scanCalls[0]).toBe("0");
  });

  test("the cursor key itself is never mistaken for a project", async () => {
    mockRedis.scanPages.push({
      keys: [
        PROJECT_INDEX_SCAN_CURSOR_KEY,
        SESSION_REPLAY_ACTIVE_PROJECTS_KEY,
        getActiveSessionsKey(projectId.toString()),
      ],
      next: "0",
    });

    expect(await reconcileActiveProjectIndex(client())).toEqual([
      projectId.toString(),
    ]);
  });

  /*
   * The ingest path SADDs the project on every accepted chunk, so a project
   * the SCAN never reaches is still finalized. Modelled by an index entry
   * with no SCAN page ever returning its key.
   */
  test("a project outside the SCAN horizon is still discovered through the ingest SADD", async () => {
    await (
      mockRedis.client() as { sadd: (k: string, m: string) => Promise<number> }
    ).sadd(SESSION_REPLAY_ACTIVE_PROJECTS_KEY, "sadded-by-ingest");
    mockRedis.scanPages.push({ keys: [], next: "0" });

    const projects: Array<string> = await discoverActiveProjectIds(client());

    expect(projects).toContain("sadded-by-ingest");
  });
});

describe("Rum:FinalizeSessions expired-session loop", () => {
  const nowUnixMs: number = Date.now();
  const idleSince: number =
    nowUnixMs - SESSION_REPLAY_IDLE_FINALIZE_MS - 60_000;

  beforeEach(() => {
    mockRedis.reset();
    /* The reconcile lock is taken unconditionally; leave it free. */
  });

  afterEach(() => {
    chunkServiceStub.executeQuery = realExecuteQuery;
    sessionServiceStub.insertJsonRows = realInsertJsonRows;
    chunkServiceStub.database = realDatabase;
  });

  async function seedActive(
    sessionIdToSeed: string,
    score: number,
  ): Promise<void> {
    const raw: {
      zadd: (k: string, s: number, m: string) => Promise<number>;
      sadd: (k: string, m: string) => Promise<number>;
    } = mockRedis.client() as {
      zadd: (k: string, s: number, m: string) => Promise<number>;
      sadd: (k: string, m: string) => Promise<number>;
    };

    await raw.zadd(
      getActiveSessionsKey(projectId.toString()),
      score,
      `${sessionIdToSeed}:tab-a`,
    );
    await raw.sadd(SESSION_REPLAY_ACTIVE_PROJECTS_KEY, projectId.toString());
  }

  test("writes the header and ZREMs the member only after a successful write", async () => {
    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0, errorCount: 1, clickCount: 3 }),
        makeChunkRow({ chunkIndex: 1, clickCount: 4 }),
      ]),
      headerRows: [headerRowOf({ tags: { build: "abc" } })],
    });

    await seedActive(sessionId, idleSince);

    await finalizeExpiredSessions();

    expect(inserted).toHaveLength(1);
    expect(inserted[0]!["isFinalized"]).toBe(true);
    expect(inserted[0]!["clickCount"]).toBe(7);
    expect(inserted[0]!["tags"]).toEqual({ build: "abc" });
    expect(
      mockRedis.zsets.get(getActiveSessionsKey(projectId.toString()))?.size ||
        0,
    ).toBe(0);
  });

  /*
   * sessionId is minted in the browser from sessionStorage, which every RUM
   * application served from one origin shares - so one id legitimately
   * names two applications' recordings. The finalizer used to aggregate on
   * (projectId, sessionId) alone and write ONE header under whichever
   * application `any()` picked, carrying both applications' totals and
   * routes; the other application's session never finalized and stayed
   * provisional - which the list renders as "live" - forever.
   */
  test("two applications sharing a session id each get their own finalized header", async () => {
    const appA: string = "6600000000000000000000b2";
    const appB: string = "6600000000000000000000c3";

    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({
          chunkIndex: 0,
          rumApplicationId: appA,
          errorCount: 2,
          clickCount: 5,
          url: "https://shop.example.com/cart",
        }),
        /* Same tabId and chunkIndex under the OTHER application. */
        makeChunkRow({
          chunkIndex: 0,
          rumApplicationId: appB,
          errorCount: 0,
          clickCount: 1,
          url: "https://help.example.com/faq",
        }),
      ]),
      headerRows: [
        headerRowOf({ rumApplicationId: appA, primaryEntityId: appA }),
        headerRowOf({ rumApplicationId: appB, primaryEntityId: appB }),
      ],
    });

    await seedActive(sessionId, idleSince);

    await finalizeExpiredSessions();

    expect(inserted).toHaveLength(2);

    const byApplication: Map<string, JSONObject> = new Map<
      string,
      JSONObject
    >();

    for (const row of inserted) {
      byApplication.set(row["rumApplicationId"] as string, row);
    }

    /* Neither header carries the other application's numbers. */
    expect(byApplication.get(appA)!["errorCount"]).toBe(2);
    expect(byApplication.get(appA)!["clickCount"]).toBe(5);
    expect(byApplication.get(appA)!["hasError"]).toBe(true);

    expect(byApplication.get(appB)!["errorCount"]).toBe(0);
    expect(byApplication.get(appB)!["clickCount"]).toBe(1);
    expect(byApplication.get(appB)!["hasError"]).toBe(false);

    /* And both are finalized, so neither stays "live" in its own list. */
    expect(byApplication.get(appA)!["isFinalized"]).toBe(true);
    expect(byApplication.get(appB)!["isFinalized"]).toBe(true);
  });

  test("a ClickHouse failure leaves the member queued for the next run", async () => {
    stubClickhouse({ failAggregate: new Error("clickhouse timeout") });

    await seedActive(sessionId, idleSince);

    await finalizeExpiredSessions();

    expect(
      mockRedis.zsets
        .get(getActiveSessionsKey(projectId.toString()))
        ?.has(`${sessionId}:tab-a`),
    ).toBe(true);
  });

  test("a session that is still active is left alone", async () => {
    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([makeChunkRow({ chunkIndex: 0 })]),
      headerRows: [headerRowOf()],
    });

    await seedActive(sessionId, nowUnixMs - 5_000);

    await finalizeExpiredSessions();

    expect(inserted).toHaveLength(0);
  });

  test("a session with no stored chunks is dropped from the queue without a header", async () => {
    const { inserted } = stubClickhouse({ tabRows: [] });

    await seedActive(sessionId, idleSince);

    await finalizeExpiredSessions();

    expect(inserted).toHaveLength(0);
    expect(
      mockRedis.zsets.get(getActiveSessionsKey(projectId.toString()))?.size ||
        0,
    ).toBe(0);
  });

  test("a malformed member is dropped rather than finalizing a wrong session", async () => {
    const { inserted } = stubClickhouse({ tabRows: [] });

    const raw: {
      zadd: (k: string, s: number, m: string) => Promise<number>;
      sadd: (k: string, m: string) => Promise<number>;
    } = mockRedis.client() as {
      zadd: (k: string, s: number, m: string) => Promise<number>;
      sadd: (k: string, m: string) => Promise<number>;
    };

    await raw.zadd(
      getActiveSessionsKey(projectId.toString()),
      idleSince,
      "no-separator",
    );
    await raw.sadd(SESSION_REPLAY_ACTIVE_PROJECTS_KEY, projectId.toString());

    await finalizeExpiredSessions();

    expect(inserted).toHaveLength(0);
    expect(
      mockRedis.zsets.get(getActiveSessionsKey(projectId.toString()))?.size ||
        0,
    ).toBe(0);
  });

  test("the gate's budget seal hint reaches the finalized row", async () => {
    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([makeChunkRow({ chunkIndex: 0 })]),
      headerRows: [headerRowOf()],
    });

    mockRedis.strings.set(
      getSessionSealHintKey(projectId.toString(), sessionId),
      SessionReplaySealedReason.Budget,
    );

    await seedActive(sessionId, idleSince);

    await finalizeExpiredSessions();

    expect(inserted[0]!["sealedReason"]).toBe(SessionReplaySealedReason.Budget);
  });

  test("an erased session is never re-headered, and its member is dropped", async () => {
    const { inserted, statements } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([makeChunkRow({ chunkIndex: 0 })]),
      headerRows: [headerRowOf({ identifiedUserTraits: { plan: "pro" } })],
    });

    await (
      mockRedis.client() as { sadd: (k: string, m: string) => Promise<number> }
    ).sadd(getErasedSessionsKey(projectId.toString()), sessionId);
    await seedActive(sessionId, idleSince);

    await finalizeExpiredSessions();

    expect(inserted).toHaveLength(0);
    /* Not even a read of the chunk rows. */
    expect(
      statements.some((statement: Statement): boolean => {
        return statement.query.includes("GROUP BY tabId");
      }),
    ).toBe(false);
    expect(
      mockRedis.zsets.get(getActiveSessionsKey(projectId.toString()))?.size ||
        0,
    ).toBe(0);
  });

  test("Redis down means no run, not an error", async () => {
    mockRedis.connected = false;
    const { inserted } = stubClickhouse({});

    await expect(finalizeExpiredSessions()).resolves.toBeUndefined();
    expect(inserted).toHaveLength(0);
  });
});

describe("Rum:SweepNeverFinalizedSessions loop", () => {
  beforeEach(() => {
    mockRedis.reset();
  });

  afterEach(() => {
    chunkServiceStub.executeQuery = realExecuteQuery;
    sessionServiceStub.insertJsonRows = realInsertJsonRows;
    chunkServiceStub.database = realDatabase;
  });

  const sweepRow: JSONObject = {
    projectId: projectId.toString(),
    rumApplicationId: "6600000000000000000000b2",
    sessionId: sessionId,
    startTimeUnixMs: String(sessionStartUnixMs),
  };

  test("finalizes a provisional session whose chunks still exist", async () => {
    const { inserted } = stubClickhouse({
      sweepRows: [sweepRow],
      tabRows: runGroupByOverChunkRows([makeChunkRow({ chunkIndex: 0 })]),
      headerRows: [headerRowOf()],
    });

    const summary: { finalized: number; sealedLost: number; failed: number } =
      await sweepNeverFinalizedSessions();

    expect(summary.finalized).toBe(1);
    expect(summary.sealedLost).toBe(0);
    expect(inserted[0]!["isFinalized"]).toBe(true);
  });

  test("seals a chunkless provisional session as recording-lost", async () => {
    const { inserted } = stubClickhouse({
      sweepRows: [sweepRow],
      tabRows: [],
      headerRows: [headerRowOf({ errorCount: 2 })],
    });

    const summary: { finalized: number; sealedLost: number; failed: number } =
      await sweepNeverFinalizedSessions();

    expect(summary.sealedLost).toBe(1);
    expect(inserted[0]!["sealedReason"]).toBe(
      SessionReplaySealedReason.RecordingLost,
    );
    /* Chunk 0's evidence survives the seal. */
    expect(inserted[0]!["errorCount"]).toBe(2);
  });

  test("skips an erased session without sealing or looping", async () => {
    const { inserted } = stubClickhouse({
      sweepRows: [sweepRow],
      tabRows: [],
      headerRows: [headerRowOf()],
    });

    await (
      mockRedis.client() as { sadd: (k: string, m: string) => Promise<number> }
    ).sadd(getErasedSessionsKey(projectId.toString()), sessionId);

    const summary: { finalized: number; sealedLost: number; failed: number } =
      await sweepNeverFinalizedSessions();

    expect(summary.finalized).toBe(0);
    expect(summary.sealedLost).toBe(0);
    expect(summary.failed).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  test("a failure on one session does not stop the sweep", async () => {
    const other: JSONObject = { ...sweepRow, sessionId: "b".repeat(32) };
    let calls: number = 0;

    const { inserted } = stubClickhouse({
      sweepRows: [sweepRow, other],
      tabRows: runGroupByOverChunkRows([makeChunkRow({ chunkIndex: 0 })]),
      headerRows: [headerRowOf()],
    });

    const routed: (statement: Statement) => Promise<unknown> =
      chunkServiceStub.executeQuery as (
        statement: Statement,
      ) => Promise<unknown>;

    chunkServiceStub.executeQuery = (
      statement: Statement,
    ): Promise<unknown> => {
      if (statement.query.includes("GROUP BY rumApplicationId, tabId")) {
        calls++;
        if (calls === 1) {
          return Promise.reject(new Error("first one fails"));
        }
      }
      return routed(statement);
    };

    const summary: { finalized: number; sealedLost: number; failed: number } =
      await sweepNeverFinalizedSessions();

    expect(summary.failed).toBe(1);
    expect(summary.finalized).toBe(1);
    expect(inserted).toHaveLength(1);
  });
});
