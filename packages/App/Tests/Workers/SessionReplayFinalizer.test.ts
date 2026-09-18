import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import {
  MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
  SESSION_REPLAY_ACTIVE_CHUNK_MIN_EVENTS,
  SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS,
  SESSION_REPLAY_ENDED_TRAILING_CHUNK_TOLERANCE_MS,
  SESSION_REPLAY_IDLE_FINALIZE_MS as SHARED_SESSION_REPLAY_IDLE_FINALIZE_MS,
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
  /* Every plain ZREM, so a test can prove a removal went through the script. */
  public zremCalls: Array<{ key: string; members: Array<string> }> = [];
  /* Every conditional-removal script call, as KEYS[1] and flat ARGV. */
  public evalCalls: Array<{ key: string; argv: Array<string> }> = [];
  /* Every SET, with its full argument list, so lock options can be pinned. */
  public setCalls: Array<Array<string | number>> = [];
  public failSmembers: boolean = false;

  public reset(): void {
    this.strings = new Map<string, string>();
    this.sets = new Map<string, Set<string>>();
    this.zsets = new Map<string, Map<string, number>>();
    this.connected = true;
    this.scanCalls = [];
    this.scanPages = [];
    this.zremCalls = [];
    this.evalCalls = [];
    this.setCalls = [];
    this.failSmembers = false;
  }

  /* Synchronous seeding, for fixtures. */
  public seedZset(key: string, member: string, score: number): void {
    const zset: Map<string, number> =
      this.zsets.get(key) || new Map<string, number>();
    zset.set(member, score);
    this.zsets.set(key, zset);
  }

  public seedSet(key: string, member: string): void {
    const set: Set<string> = this.sets.get(key) || new Set<string>();
    set.add(member);
    this.sets.set(key, set);
  }

  public scoreOf(key: string, member: string): number | undefined {
    return this.zsets.get(key)?.get(member);
  }

  public membersOf(key: string): Array<string> {
    return Array.from(this.zsets.get(key)?.keys() || []).sort();
  }

  public client(): unknown {
    return {
      get: (key: string): Promise<string | null> => {
        return Promise.resolve(this.strings.get(key) ?? null);
      },
      set: (
        key: string,
        value: string,
        expiryToken?: string,
        ttl?: number,
        nxToken?: string,
      ): Promise<"OK" | null> => {
        this.setCalls.push(
          [key, value, expiryToken ?? "", ttl ?? 0, nxToken ?? ""].filter(
            (argument: string | number): boolean => {
              return argument !== "";
            },
          ),
        );
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
        if (this.failSmembers) {
          return Promise.reject(new Error("smembers exploded"));
        }
        return Promise.resolve(Array.from(this.sets.get(key) || []));
      },
      srem: (key: string, member: string): Promise<number> => {
        return Promise.resolve(this.sets.get(key)?.delete(member) ? 1 : 0);
      },
      incr: (key: string): Promise<number> => {
        const next: number = Number(this.strings.get(key) ?? "0") + 1;
        this.strings.set(key, String(next));
        return Promise.resolve(next);
      },
      expire: (): Promise<number> => {
        return Promise.resolve(1);
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
        const list: Array<string> = Array.isArray(members)
          ? members
          : [members];
        this.zremCalls.push({ key: key, members: list });
        let removed: number = 0;
        for (const member of list) {
          if (zset?.delete(member)) {
            removed++;
          }
        }
        return Promise.resolve(removed);
      },
      zcard: (key: string): Promise<number> => {
        return Promise.resolve(this.zsets.get(key)?.size || 0);
      },
      zscore: (key: string, member: string): Promise<string | null> => {
        const score: number | undefined = this.zsets.get(key)?.get(member);
        return Promise.resolve(score === undefined ? null : String(score));
      },
      /*
       * ZRANGEBYSCORE key min max [WITHSCORES] [LIMIT offset count], ordered
       * by score as Redis orders it, so per-run caps are exercised for real.
       */
      zrangebyscore: (
        key: string,
        min: string | number,
        max: string | number,
        ...rest: Array<string | number>
      ): Promise<Array<string>> => {
        const lower: number = min === "-inf" ? -Infinity : Number(min);
        const upper: number = max === "+inf" ? Infinity : Number(max);
        const withScores: boolean = rest.includes("WITHSCORES");
        const limitAt: number = rest.indexOf("LIMIT");
        const offset: number = limitAt >= 0 ? Number(rest[limitAt + 1]) : 0;
        const count: number =
          limitAt >= 0 ? Number(rest[limitAt + 2]) : Number.MAX_SAFE_INTEGER;

        const matched: Array<[string, number]> = Array.from(
          this.zsets.get(key)?.entries() || [],
        )
          .filter(([, score]: [string, number]): boolean => {
            return score >= lower && score <= upper;
          })
          .sort((a: [string, number], b: [string, number]): number => {
            return a[1] - b[1] || a[0].localeCompare(b[0]);
          })
          .slice(offset, offset + count);

        const flat: Array<string> = [];
        for (const [member, score] of matched) {
          flat.push(member);
          if (withScores) {
            flat.push(String(score));
          }
        }
        return Promise.resolve(flat);
      },
      /*
       * Emulates exactly two scripts: the finalizer's conditional removal and
       * the ended job's lock release. Anything else is a test failure rather
       * than a silent no-op.
       */
      eval: (
        script: string,
        numKeys: number,
        ...args: Array<string | number>
      ): Promise<number> => {
        if (
          script === SESSION_REPLAY_ENDED_RUN_LOCK_RELEASE_SCRIPT &&
          numKeys === 1
        ) {
          const lockKey: string = String(args[0]);
          if (this.strings.get(lockKey) === String(args[1])) {
            this.strings.delete(lockKey);
            return Promise.resolve(1);
          }
          return Promise.resolve(0);
        }
        if (
          script !== SESSION_REPLAY_REMOVE_IF_NOT_NEWER_SCRIPT ||
          numKeys !== 1
        ) {
          return Promise.reject(new Error("unexpected EVAL in MockRedis"));
        }
        const key: string = String(args[0]);
        const argv: Array<string> = args.slice(1).map(String);
        this.evalCalls.push({ key: key, argv: argv });
        const zset: Map<string, number> | undefined = this.zsets.get(key);
        let removed: number = 0;
        for (let index: number = 0; index + 1 < argv.length; index += 2) {
          const score: number | undefined = zset?.get(argv[index]!);
          if (score !== undefined && score <= Number(argv[index + 1])) {
            zset!.delete(argv[index]!);
            removed++;
          }
        }
        return Promise.resolve(removed);
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
  ConditionalMemberRemoval,
  discoverActiveProjectIds,
  ENDED_RUN_BUDGET_MS,
  ENDED_RUN_LOCK_TTL_MS,
  fetchSessionCorrelation,
  finalizeEndedSessions,
  FinalizeEndedSessionsSummary,
  finalizeExpiredSessions,
  finalizeSession,
  FinalizeSessionOutcome,
  FinalizeSessionResult,
  finalizeSessionWithTabs,
  getActiveSessionsKey,
  getEndedSessionsKey,
  getSessionSealHintKey,
  MAX_ENDED_CANDIDATES_PER_PROJECT_PER_RUN,
  MAX_ENDED_SESSIONS_PER_RUN,
  MAX_EXCEPTION_FINGERPRINTS_PER_SESSION,
  MIN_ENDED_PROJECT_SLICE_MS,
  MIN_ENDED_SESSIONS_PER_PROJECT_PER_RUN,
  MAX_SWEEP_SESSIONS_PER_RUN,
  MAX_TRACE_IDS_PER_SESSION,
  parseActiveSessionMember,
  parseProvisionalHeaderRow,
  parseTabAggregateRow,
  PROJECT_INDEX_SCAN_CURSOR_KEY,
  ProvisionalSessionHeader,
  reconcileActiveProjectIndex,
  removeActivityMembersIfNotNewer,
  resolveSealedReason,
  rotateEndedProjectOrder,
  SESSION_REPLAY_ACTIVE_KEY_PREFIX,
  SESSION_REPLAY_ACTIVE_PROJECTS_KEY,
  SESSION_REPLAY_ENDED_KEY_PREFIX,
  SESSION_REPLAY_ENDED_PROJECT_CURSOR_KEY,
  SESSION_REPLAY_ENDED_RUN_LOCK_KEY,
  SESSION_REPLAY_ENDED_RUN_LOCK_RELEASE_SCRIPT,
  SESSION_REPLAY_IDLE_FINALIZE_MS,
  SESSION_REPLAY_REMOVE_IF_NOT_NEWER_SCRIPT,
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
import {
  hasSessionRecordingEnded,
  hasTabRecordingEnded,
} from "Common/Utils/Rum/SessionReplayRecordingEnded";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../FeatureSet/Workers/Utils/Cron";

/*
 * RunCron is a jest.fn() (mocked above), called once per job when the module
 * was imported. Captured now, before any test can reset mock state.
 */
const runCronRegistrations: Array<Array<unknown>> = (
  RunCron as unknown as { mock: { calls: Array<Array<unknown>> } }
).mock.calls.slice();

const projectId: ObjectID = new ObjectID("6600000000000000000000a1");
const sessionId: string = "1f0c9a4b6d2e47f8a1b3c5d7e9f00112";
/* The recorder-minted per-browser id the fixture header was ingested with. */
const visitorId: string = "3f1a9c7e5b2d4801f6a3c9e7b1d5028f";
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
  /*
   * Wall-clock overrides, for the recording-ended rule: by default a chunk
   * occupies its 15s flush window after the session start.
   */
  chunkStartUnixMs?: number;
  chunkEndUnixMs?: number;
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
    chunkStartUnixMs:
      data.chunkStartUnixMs ??
      sessionStartUnixMs + chunkIndex * CHUNK_DURATION_MS,
    chunkEndUnixMs:
      data.chunkEndUnixMs ??
      sessionStartUnixMs + (chunkIndex + 1) * CHUNK_DURATION_MS,
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
      totalEventCount: String(
        sum((row: RawChunkRow): number => {
          return row.eventCount;
        }),
      ),
      payloadBytes: String(
        sum((row: RawChunkRow): number => {
          return row.payloadBytes;
        }),
      ),
      totalErrorCount: sum((row: RawChunkRow): number => {
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
      /*
       * toUnixTimestamp64Milli(maxIf(chunkEndTime, isFinal)): the epoch (0)
       * when the tab sent no final chunk, exactly as ClickHouse returns it.
       */
      finalChunkEndUnixMs: String(
        tabRows
          .filter((row: RawChunkRow): boolean => {
            return row.isFinal;
          })
          .reduce((latest: number, row: RawChunkRow): number => {
            return Math.max(latest, row.chunkEndUnixMs);
          }, 0),
      ),
      /* toUnixTimestamp64Milli(max(chunkStartTime)), final or not. */
      lastChunkStartUnixMs: String(
        max((row: RawChunkRow): number => {
          return row.chunkStartUnixMs;
        }),
      ),
      /* max(version): a UInt64, so a quoted string on some servers. */
      lastChunkStoredAtUnixMs: String(
        max((row: RawChunkRow): number => {
          return row.version;
        }),
      ),
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
    visitorId: visitorId,
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

  /*
   * The visitor id is stored by the ingest and CARRIED, never re-derived:
   * the chunk rows do not hold it, so a session whose provisional header
   * was lost has nothing to fall back to and reads "" - the same as a
   * session from a recorder that predates the id - which the list renders
   * as ungrouped rather than inventing a link.
   */
  test("the visitor id is carried from the provisional header, and a headerless session has none", () => {
    const rows: Array<RawChunkRow> = [makeChunkRow({ chunkIndex: 0 })];

    expect(rowFor(rows, makeProvisionalHeader())["visitorId"]).toBe(visitorId);
    expect(
      rowFor(rows, makeProvisionalHeader({ visitorId: "" }))["visitorId"],
    ).toBe("");
    expect(rowFor(rows, null)["visitorId"]).toBe("");
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

  test("the chunk aggregate reads each tab's end facts under names no aggregate reads", () => {
    const query: string = buildTabAggregateStatement({
      databaseName: databaseName,
      projectId: projectId,
      sessionId: sessionId,
    }).query;

    /*
     * Spelled exactly as Common/Utils/Rum/SessionReplayRecordingEnded
     * documents them, so the finalizer and the read path judge a tab from
     * the same expressions.
     */
    expect(query).toContain(
      "toUnixTimestamp64Milli(maxIf(chunkEndTime, isFinal)) AS finalChunkEndUnixMs",
    );
    expect(query).toContain(
      "toUnixTimestamp64Milli(max(chunkStartTime)) AS lastChunkStartUnixMs",
    );
    expect(query).toContain("max(toUInt8(isFinal)) AS hasFinalChunk");
    /*
     * The chunk-cap fact and the server write time the grace is measured
     * on. version is SERVER unix ms already, so it is read as is.
     */
    expect(query).toContain("max(chunkIndex) AS maxChunkIndex");
    expect(query).toContain("max(version) AS lastChunkStoredAtUnixMs");

    /*
     * ClickHouse resolves an identifier to a SELECT alias before a column,
     * so an alias named after a column another aggregate reads turns that
     * read into a nested aggregate and the server rejects the query.
     */
    expect(query).not.toContain("AS isFinal");
    expect(query).not.toContain("AS chunkEndTime");
    expect(query).not.toContain("AS chunkStartTime");
    expect(query).not.toContain("AS version");
    expect(query).not.toMatch(/AS chunkIndex\b/);

    /* The inner projection carries every column the new aggregates read. */
    expect(query).toContain("isFinal,");
    expect(query).toContain("chunkStartTime,");
    expect(query).toContain("chunkEndTime,");
    expect(query).toContain("version,");
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

  test("the header read carries the visitor id, which lives on the header row alone", () => {
    const statement: Statement = buildProvisionalHeaderStatement({
      databaseName: databaseName,
      projectId: projectId,
      rumApplicationId: "6600000000000000000000b2",
      sessionId: sessionId,
    });

    /*
     * The chunk rows never hold it, so a SELECT that forgot it would blank
     * every finalized session's visitor link without any other symptom.
     */
    expect(statement.query).toContain("visitorId AS visitorId");
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
      totalEventCount: "30",
      payloadBytes: "3000",
      totalErrorCount: 1,
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

  test("a tab's end facts are parsed from the aggregate row", () => {
    const storedAt: number = Date.now() - 5 * 60 * 1000;

    const parsed: TabChunkAggregate = parseTabAggregateRow({
      tabId: "tab-a",
      hasFinalChunk: "1",
      maxChunkIndex: "1",
      /* Int64 renderings arrive quoted on some server versions. */
      finalChunkEndUnixMs: String(sessionStartUnixMs + 30_000),
      lastChunkStartUnixMs: sessionStartUnixMs + 15_000,
      /* max(version) is a UInt64, quoted the same way. */
      lastChunkStoredAtUnixMs: String(storedAt),
    });

    expect(parsed.hasFinalChunk).toBe(true);
    expect(parsed.maxChunkIndex).toBe(1);
    expect(parsed.finalChunkEndUnixMs).toBe(sessionStartUnixMs + 30_000);
    expect(parsed.lastChunkStartUnixMs).toBe(sessionStartUnixMs + 15_000);
    expect(parsed.lastChunkStoredAtUnixMs).toBe(storedAt);
    /* The parsed row is directly what the shared rule reads. */
    expect(hasTabRecordingEnded(parsed)).toBe(true);
    expect(hasSessionRecordingEnded([parsed], Date.now())).toBe(true);
    expect(
      hasSessionRecordingEnded(
        [parsed],
        storedAt + SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS - 1,
      ),
    ).toBe(false);
  });

  test("a row without the end facts parses to zeros and never counts as ended", () => {
    const parsed: TabChunkAggregate = parseTabAggregateRow({
      tabId: "tab-a",
      hasFinalChunk: 0,
    });

    expect(parsed.finalChunkEndUnixMs).toBe(0);
    expect(parsed.lastChunkStartUnixMs).toBe(0);
    expect(parsed.lastChunkStoredAtUnixMs).toBe(0);
    expect(hasTabRecordingEnded(parsed)).toBe(false);
  });

  test("the in-test GROUP BY model derives the end facts the SQL does", () => {
    const tabs: Array<TabChunkAggregate> = runGroupByOverChunkRows([
      makeChunkRow({ chunkIndex: 0 }),
      makeChunkRow({ chunkIndex: 1, isFinal: true }),
      makeChunkRow({ chunkIndex: 0, tabId: "tab-b" }),
    ]).map(parseTabAggregateRow);

    const tabA: TabChunkAggregate = tabs.find((tab: TabChunkAggregate) => {
      return tab.tabId === "tab-a";
    })!;
    const tabB: TabChunkAggregate = tabs.find((tab: TabChunkAggregate) => {
      return tab.tabId === "tab-b";
    })!;

    expect(tabA.finalChunkEndUnixMs).toBe(
      sessionStartUnixMs + 2 * CHUNK_DURATION_MS,
    );
    expect(tabA.lastChunkStartUnixMs).toBe(
      sessionStartUnixMs + CHUNK_DURATION_MS,
    );
    expect(hasTabRecordingEnded(tabA)).toBe(true);

    expect(tabB.hasFinalChunk).toBe(false);
    expect(tabB.finalChunkEndUnixMs).toBe(0);
    expect(hasTabRecordingEnded(tabB)).toBe(false);

    /* max(version) over the deduped rows: tab-a's chunk 1 is its newest. */
    expect(tabA.lastChunkStoredAtUnixMs).toBe(1_700_000_000_000 + 1);
    expect(tabB.lastChunkStoredAtUnixMs).toBe(1_700_000_000_000);
  });

  test("the provisional header's visitor id is mapped, and a row that predates the column reads as empty", () => {
    expect(parseProvisionalHeaderRow(headerRowOf()).visitorId).toBe(visitorId);

    /*
     * A header written before the column existed comes back without the
     * key at all on some server versions and as "" on others; both are
     * "no visitor link", never a throw that would strand the session.
     */
    const legacy: JSONObject = headerRowOf();
    delete legacy["visitorId"];

    expect(parseProvisionalHeaderRow(legacy).visitorId).toBe("");
    expect(
      parseProvisionalHeaderRow(headerRowOf({ visitorId: "" })).visitorId,
    ).toBe("");
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
  /*
   * Per-session chunk aggregates, for batches whose sessions differ. A
   * session missing from the record falls back to tabRows.
   */
  tabRowsBySessionId?: Record<string, Array<JSONObject>>;
  headerRows?: Array<JSONObject>;
  sweepRows?: Array<JSONObject>;
  failAggregate?: Error;
  /* What the grouped correlation reads over ExceptionInstance / Span find. */
  exceptionRows?: Array<JSONObject>;
  traceRows?: Array<JSONObject>;
  /*
   * Runs when the tab aggregate is read, before its rows are returned: the
   * moment a slow read lets the clock move on.
   */
  onAggregate?: () => void;
  /*
   * Runs after the rows are accepted, before the insert resolves: the moment
   * a concurrent ingest would re-queue a member mid-finalization.
   */
  onInsert?: (rows: Array<JSONObject>) => void;
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
      if (data.onAggregate) {
        data.onAggregate();
      }
      const boundValues: Array<unknown> = Object.values(statement.query_params);
      for (const [rowsSessionId, rows] of Object.entries(
        data.tabRowsBySessionId || {},
      )) {
        if (boundValues.includes(rowsSessionId)) {
          return Promise.resolve(resultSetOf(rows));
        }
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

    if (query.includes("AS exceptionFingerprints")) {
      return Promise.resolve(resultSetOf(data.exceptionRows || []));
    }

    if (query.includes("AS traceIds")) {
      return Promise.resolve(resultSetOf(data.traceRows || []));
    }

    return Promise.resolve(resultSetOf([]));
  };

  sessionServiceStub.insertJsonRows = (
    rows: Array<JSONObject>,
  ): Promise<void> => {
    inserted.push(...rows);
    if (data.onInsert) {
      data.onInsert(rows);
    }
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

  test("the finalized row carries the provisional header's visitor id", async () => {
    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([makeChunkRow({ chunkIndex: 0 })]),
      headerRows: [headerRowOf({ visitorId: visitorId })],
    });

    await seedActive(sessionId, idleSince);

    await finalizeExpiredSessions();

    expect(inserted).toHaveLength(1);
    expect(inserted[0]!["isFinalized"]).toBe(true);
    expect(inserted[0]!["visitorId"]).toBe(visitorId);
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

  test("a finalized session leaves the ended set too, so the minute job does not finalize it again", async () => {
    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0, isFinal: true }),
      ]),
      headerRows: [headerRowOf()],
    });

    const endedKey: string = getEndedSessionsKey(projectId.toString());

    await seedActive(sessionId, idleSince);
    /* The ingest path writes the candidate with the activity score. */
    mockRedis.seedZset(endedKey, `${sessionId}:tab-a`, idleSince);

    await finalizeExpiredSessions();

    expect(inserted).toHaveLength(1);
    expect(
      mockRedis.membersOf(getActiveSessionsKey(projectId.toString())),
    ).toEqual([]);
    expect(mockRedis.membersOf(endedKey)).toEqual([]);
  });

  test("a chunk processed while the session was being finalized keeps its entries in both sets", async () => {
    /*
     * The race behind "stays provisional for hours": the ingest path ZADDs
     * the same member again between this job's read and its removal. An
     * unconditional ZREM deleted the fresh entry, the header just written
     * did not count that chunk, and nothing re-queued the session until the
     * hourly sweep.
     */
    const activeKey: string = getActiveSessionsKey(projectId.toString());
    const endedKey: string = getEndedSessionsKey(projectId.toString());
    const bumpedTo: number = Date.now();

    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([makeChunkRow({ chunkIndex: 0 })]),
      headerRows: [headerRowOf()],
      onInsert: (): void => {
        mockRedis.seedZset(activeKey, `${sessionId}:tab-a`, bumpedTo);
        mockRedis.seedZset(endedKey, `${sessionId}:tab-a`, bumpedTo);
      },
    });

    await seedActive(sessionId, idleSince);
    mockRedis.seedZset(endedKey, `${sessionId}:tab-a`, idleSince);

    await finalizeExpiredSessions();

    expect(inserted).toHaveLength(1);
    expect(mockRedis.scoreOf(activeKey, `${sessionId}:tab-a`)).toBe(bumpedTo);
    expect(mockRedis.scoreOf(endedKey, `${sessionId}:tab-a`)).toBe(bumpedTo);
  });

  test("members are removed through the conditional script, never a plain ZREM", async () => {
    stubClickhouse({
      tabRows: runGroupByOverChunkRows([makeChunkRow({ chunkIndex: 0 })]),
      headerRows: [headerRowOf()],
    });

    await seedActive(sessionId, idleSince);

    await finalizeExpiredSessions();

    expect(mockRedis.zremCalls).toEqual([]);

    const activeKey: string = getActiveSessionsKey(projectId.toString());

    /* Each member rides with the exact score the range read returned. */
    expect(mockRedis.evalCalls).toContainEqual({
      key: activeKey,
      argv: [`${sessionId}:tab-a`, String(idleSince)],
    });
    expect(mockRedis.evalCalls).toContainEqual({
      key: getEndedSessionsKey(projectId.toString()),
      argv: [`${sessionId}:tab-a`, String(idleSince)],
    });
  });

  test("an ended candidate of a tab that is not idle yet is left for the minute job", async () => {
    stubClickhouse({
      tabRows: runGroupByOverChunkRows([makeChunkRow({ chunkIndex: 0 })]),
      headerRows: [headerRowOf()],
    });

    const endedKey: string = getEndedSessionsKey(projectId.toString());
    const otherSessionId: string = "c".repeat(32);

    await seedActive(sessionId, idleSince);
    mockRedis.seedZset(endedKey, `${otherSessionId}:tab-z`, nowUnixMs - 5_000);

    await finalizeExpiredSessions();

    expect(mockRedis.membersOf(endedKey)).toEqual([`${otherSessionId}:tab-z`]);
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
    /*
     * And so does the visitor link: the chunks are gone, the header is not,
     * and a sealed row that dropped it would vanish from its visitor's
     * group precisely when a reader is asking "what else did they hit".
     */
    expect(inserted[0]!["visitorId"]).toBe(visitorId);
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

/*
 * ------------------------------------------------------------------
 * The tab-close fix: a closed tab used to keep "Recording now" for 10-15
 * minutes, because the recorder's final chunk was only ever a label and
 * finalization waited for the idle window. Everything below pins the
 * pieces that end a recording as soon as every tab has said it is over.
 * ------------------------------------------------------------------
 */
describe("Rum:FinalizeEndedSessions Redis contract", () => {
  test("the ended set has its own prefix, outside the reconcile's replay:active:* SCAN", () => {
    expect(SESSION_REPLAY_ENDED_KEY_PREFIX).toBe("replay:ended:");
    expect(getEndedSessionsKey("p1")).toBe("replay:ended:p1");
    /*
     * The reconcile reads every replay:active:* key as a project's activity
     * set; an ended key under that prefix would index a project named
     * "ended:<projectId>".
     */
    expect(
      getEndedSessionsKey("p1").startsWith(SESSION_REPLAY_ACTIVE_KEY_PREFIX),
    ).toBe(false);
  });

  test("the idle window is the shared constant, still importable from the job", () => {
    expect(SESSION_REPLAY_IDLE_FINALIZE_MS).toBe(
      SHARED_SESSION_REPLAY_IDLE_FINALIZE_MS,
    );
    expect(SESSION_REPLAY_IDLE_FINALIZE_MS).toBe(10 * 60 * 1000);
  });

  test("the removal script touches exactly one key, so it is Redis Cluster safe", () => {
    expect(SESSION_REPLAY_REMOVE_IF_NOT_NEWER_SCRIPT).toContain("KEYS[1]");
    expect(SESSION_REPLAY_REMOVE_IF_NOT_NEWER_SCRIPT).not.toContain("KEYS[2]");
    /* Compare and remove happen inside one script, so nothing races them. */
    expect(SESSION_REPLAY_REMOVE_IF_NOT_NEWER_SCRIPT).toContain("ZSCORE");
    expect(SESSION_REPLAY_REMOVE_IF_NOT_NEWER_SCRIPT).toContain("ZREM");
    expect(SESSION_REPLAY_REMOVE_IF_NOT_NEWER_SCRIPT).toContain("<=");
  });
});

describe("removeActivityMembersIfNotNewer", () => {
  const key: string = "replay:active:p1";

  beforeEach(() => {
    mockRedis.reset();
  });

  function client(): ClientType {
    return mockRedis.client() as unknown as ClientType;
  }

  test("removes a member at or below its threshold and keeps one that moved past it", async () => {
    mockRedis.seedZset(key, "s:at", 100);
    mockRedis.seedZset(key, "s:below", 50);
    mockRedis.seedZset(key, "s:bumped", 101);

    const removed: number = await removeActivityMembersIfNotNewer(
      client(),
      key,
      [
        { member: "s:at", maxScore: 100 },
        { member: "s:below", maxScore: 100 },
        { member: "s:bumped", maxScore: 100 },
      ],
    );

    expect(removed).toBe(2);
    expect(mockRedis.membersOf(key)).toEqual(["s:bumped"]);
  });

  test("a member that is already gone is neither removed nor counted", async () => {
    const removed: number = await removeActivityMembersIfNotNewer(
      client(),
      key,
      [{ member: "s:gone", maxScore: 100 }],
    );

    expect(removed).toBe(0);
  });

  test("is one script call per batch with the key in KEYS and member/score pairs in ARGV", async () => {
    mockRedis.seedZset(key, "s:a", 1);
    mockRedis.seedZset(key, "s:b", 2);

    await removeActivityMembersIfNotNewer(client(), key, [
      { member: "s:a", maxScore: 1 },
      { member: "s:b", maxScore: 2 },
    ]);

    expect(mockRedis.evalCalls).toEqual([
      { key: key, argv: ["s:a", "1", "s:b", "2"] },
    ]);
    expect(mockRedis.zremCalls).toEqual([]);
  });

  test("nothing to remove means no round trip", async () => {
    await expect(
      removeActivityMembersIfNotNewer(client(), key, []),
    ).resolves.toBe(0);
    expect(mockRedis.evalCalls).toEqual([]);
  });

  test("a threshold that is not a number is dropped instead of failing the batch", async () => {
    mockRedis.seedZset(key, "s:a", 1);
    mockRedis.seedZset(key, "s:nan", 1);

    const removed: number = await removeActivityMembersIfNotNewer(
      client(),
      key,
      [
        { member: "s:a", maxScore: 1 },
        { member: "s:nan", maxScore: Number.NaN },
      ],
    );

    expect(removed).toBe(1);
    expect(mockRedis.membersOf(key)).toEqual(["s:nan"]);
    expect(mockRedis.evalCalls[0]!.argv).toEqual(["s:a", "1"]);
  });

  test("a large removal is split into several short script calls", async () => {
    const entries: Array<ConditionalMemberRemoval> = [];

    for (let index: number = 0; index < 1_201; index++) {
      mockRedis.seedZset(key, `s:${index}`, index);
      entries.push({ member: `s:${index}`, maxScore: index });
    }

    const removed: number = await removeActivityMembersIfNotNewer(
      client(),
      key,
      entries,
    );

    expect(removed).toBe(1_201);
    expect(mockRedis.evalCalls.length).toBe(3);
    expect(mockRedis.membersOf(key)).toEqual([]);
  });
});

describe("Rum:FinalizeEndedSessions gated finalization", () => {
  const appA: string = "6600000000000000000000b2";
  const appB: string = "6600000000000000000000c3";

  beforeEach(() => {
    mockRedis.reset();
  });

  afterEach(() => {
    chunkServiceStub.executeQuery = realExecuteQuery;
    sessionServiceStub.insertJsonRows = realInsertJsonRows;
    chunkServiceStub.database = realDatabase;
    jest.restoreAllMocks();
  });

  function gated(
    overrides?: Partial<Parameters<typeof finalizeSessionWithTabs>[0]>,
  ): Promise<FinalizeSessionResult> {
    return finalizeSessionWithTabs({
      projectId: projectId,
      sessionId: sessionId,
      databaseName: databaseName,
      requireRecordingEnded: true,
      ...overrides,
    });
  }

  function issuedHeaderRead(statements: Array<Statement>): boolean {
    return statements.some((statement: Statement): boolean => {
      return statement.query.includes("toString(startTime) AS startTimeText");
    });
  }

  test("a single tab that sent its final chunk is written", async () => {
    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0 }),
        makeChunkRow({ chunkIndex: 1, isFinal: true }),
      ]),
      headerRows: [headerRowOf()],
    });

    const result: FinalizeSessionResult = await gated();

    expect(result).toEqual({ outcome: "written", writtenTabIds: ["tab-a"] });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!["isFinalized"]).toBe(true);
    expect(inserted[0]!["sealedReason"]).toBe(
      SessionReplaySealedReason.FinalChunk,
    );
  });

  test("the one trailing non-final chunk an older recorder posts at unload does not keep the session live", async () => {
    /*
     * pagehide fires before visibilitychange on a visible tab, and the old
     * hidden handler flushed one more non-final chunk right after the final.
     */
    const finalEnd: number = sessionStartUnixMs + 2 * CHUNK_DURATION_MS;

    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0 }),
        makeChunkRow({ chunkIndex: 1, isFinal: true }),
        makeChunkRow({
          chunkIndex: 2,
          chunkStartUnixMs:
            finalEnd + SESSION_REPLAY_ENDED_TRAILING_CHUNK_TOLERANCE_MS - 1,
          chunkEndUnixMs:
            finalEnd + SESSION_REPLAY_ENDED_TRAILING_CHUNK_TOLERANCE_MS + 5,
        }),
      ]),
      headerRows: [headerRowOf()],
    });

    const result: FinalizeSessionResult = await gated();

    expect(result.outcome).toBe("written");
    expect(inserted).toHaveLength(1);
  });

  test("a chunk that started well after the final one means the tab kept recording, and nothing is written", async () => {
    const finalEnd: number = sessionStartUnixMs + 2 * CHUNK_DURATION_MS;

    const { inserted, statements } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0 }),
        makeChunkRow({ chunkIndex: 1, isFinal: true }),
        makeChunkRow({
          chunkIndex: 2,
          chunkStartUnixMs:
            finalEnd + SESSION_REPLAY_ENDED_TRAILING_CHUNK_TOLERANCE_MS + 1,
          chunkEndUnixMs:
            finalEnd +
            SESSION_REPLAY_ENDED_TRAILING_CHUNK_TOLERANCE_MS +
            15_000,
        }),
      ]),
      headerRows: [headerRowOf()],
    });

    const result: FinalizeSessionResult = await gated();

    expect(result).toEqual({ outcome: "still-recording", writtenTabIds: [] });
    expect(inserted).toHaveLength(0);
    /* Not even the header read: the gate decides before any of that. */
    expect(issuedHeaderRead(statements)).toBe(false);
  });

  test("two tabs where one is still live is still recording", async () => {
    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0, tabId: "tab-a", isFinal: true }),
        makeChunkRow({ chunkIndex: 0, tabId: "tab-b" }),
      ]),
      headerRows: [headerRowOf()],
    });

    const result: FinalizeSessionResult = await gated();

    expect(result.outcome).toBe("still-recording");
    expect(inserted).toHaveLength(0);
  });

  test("two tabs that both ended are written together", async () => {
    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0, tabId: "tab-a", isFinal: true }),
        makeChunkRow({ chunkIndex: 0, tabId: "tab-b", isFinal: true }),
      ]),
      headerRows: [headerRowOf()],
    });

    const result: FinalizeSessionResult = await gated();

    expect(result.outcome).toBe("written");
    expect([...result.writtenTabIds].sort()).toEqual(["tab-a", "tab-b"]);
    expect(inserted).toHaveLength(1);
  });

  test("a tab that stored its last permitted chunk index has ended without a final chunk", async () => {
    /*
     * The ingest gate refuses every index at or past the cap, including the
     * recorder's own truncation seal, so nothing more can land for it.
     */
    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: MAX_SESSION_REPLAY_CHUNKS_PER_SESSION - 1 }),
      ]),
      headerRows: [headerRowOf()],
    });

    const result: FinalizeSessionResult = await gated();

    expect(result.outcome).toBe("written");
    expect(inserted).toHaveLength(1);
  });

  test("of two applications sharing the id, only the one that ended gets a header", async () => {
    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({
          chunkIndex: 0,
          tabId: "tab-a",
          rumApplicationId: appA,
          isFinal: true,
        }),
        makeChunkRow({ chunkIndex: 0, tabId: "tab-b", rumApplicationId: appB }),
      ]),
      headerRows: [
        headerRowOf({ rumApplicationId: appA, primaryEntityId: appA }),
        headerRowOf({ rumApplicationId: appB, primaryEntityId: appB }),
      ],
    });

    const result: FinalizeSessionResult = await gated();

    expect(result).toEqual({ outcome: "written", writtenTabIds: ["tab-a"] });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!["rumApplicationId"]).toBe(appA);
  });

  test("a tab id shared with an application that is still recording is not reported as written", async () => {
    /*
     * The activity member carries no application, so reporting tab-a would
     * have the caller act on the live application's queue entry too.
     */
    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({
          chunkIndex: 0,
          tabId: "tab-a",
          rumApplicationId: appA,
          isFinal: true,
        }),
        makeChunkRow({ chunkIndex: 0, tabId: "tab-a", rumApplicationId: appB }),
      ]),
      headerRows: [
        headerRowOf({ rumApplicationId: appA, primaryEntityId: appA }),
        headerRowOf({ rumApplicationId: appB, primaryEntityId: appB }),
      ],
    });

    const result: FinalizeSessionResult = await gated();

    expect(result).toEqual({ outcome: "written", writtenTabIds: [] });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!["rumApplicationId"]).toBe(appA);
  });

  test("the erasure tombstone wins over an ended recording, before any chunk is read", async () => {
    const { inserted, statements } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0, isFinal: true }),
      ]),
      headerRows: [headerRowOf()],
    });

    mockRedis.seedSet(getErasedSessionsKey(projectId.toString()), sessionId);

    const result: FinalizeSessionResult = await gated();

    expect(result).toEqual({ outcome: "erased", writtenTabIds: [] });
    expect(inserted).toHaveLength(0);
    expect(statements).toHaveLength(0);
  });

  test("an erasure that lands while correlation is being resolved still gets no header", async () => {
    /*
     * The lazy batch correlation is two grouped ClickHouse reads. An erasure
     * that tombstones the session and submits its ALTER DELETE meanwhile
     * would never see a header inserted afterwards, and does not revisit a
     * tombstoned session - so the row would outlive the erasure.
     */
    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0, isFinal: true }),
      ]),
      headerRows: [headerRowOf()],
    });

    const result: FinalizeSessionResult = await gated({
      resolveCorrelation: (): Promise<SessionCorrelation> => {
        mockRedis.seedSet(
          getErasedSessionsKey(projectId.toString()),
          sessionId,
        );
        return Promise.resolve({ traceIds: [], exceptionFingerprints: [] });
      },
    });

    expect(result).toEqual({ outcome: "erased", writtenTabIds: [] });
    expect(inserted).toHaveLength(0);
  });

  test("an erasure that lands during the header read stops the ungated write too", async () => {
    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([makeChunkRow({ chunkIndex: 0 })]),
      headerRows: [headerRowOf()],
    });

    const routed: unknown = chunkServiceStub.executeQuery;

    chunkServiceStub.executeQuery = (
      statement: Statement,
    ): Promise<unknown> => {
      if (statement.query.includes("toString(startTime) AS startTimeText")) {
        mockRedis.seedSet(
          getErasedSessionsKey(projectId.toString()),
          sessionId,
        );
      }
      return (routed as (statement: Statement) => Promise<unknown>)(statement);
    };

    const outcome: FinalizeSessionOutcome = await finalizeSession({
      projectId: projectId,
      sessionId: sessionId,
      databaseName: databaseName,
    });

    expect(outcome).toBe("erased");
    expect(inserted).toHaveLength(0);
  });

  test("a session with no stored chunks answers no-chunks, as before", async () => {
    const { inserted } = stubClickhouse({ tabRows: [] });

    const result: FinalizeSessionResult = await gated();

    expect(result).toEqual({ outcome: "no-chunks", writtenTabIds: [] });
    expect(inserted).toHaveLength(0);
  });

  test("finalizeSession keeps its ungated contract: a live session is still written", async () => {
    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([makeChunkRow({ chunkIndex: 0 })]),
      headerRows: [headerRowOf()],
    });

    const outcome: FinalizeSessionOutcome = await finalizeSession({
      projectId: projectId,
      sessionId: sessionId,
      databaseName: databaseName,
    });

    expect(outcome).toBe("written");
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!["sealedReason"]).toBe(
      SessionReplaySealedReason.IdleTimeout,
    );
  });

  test("finalizeSession ignores the grace: a just-stored session is still written", async () => {
    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0, isFinal: true, version: Date.now() }),
      ]),
      headerRows: [headerRowOf()],
    });

    const outcome: FinalizeSessionOutcome = await finalizeSession({
      projectId: projectId,
      sessionId: sessionId,
      databaseName: databaseName,
    });

    expect(outcome).toBe("written");
    expect(inserted).toHaveLength(1);
  });

  test("correlation is resolved lazily, and only when a header is written", async () => {
    let resolved: number = 0;
    const resolveCorrelation: () => Promise<SessionCorrelation> =
      (): Promise<SessionCorrelation> => {
        resolved++;
        return Promise.resolve({
          traceIds: ["trace-late"],
          exceptionFingerprints: ["fp-late"],
        });
      };

    stubClickhouse({
      tabRows: runGroupByOverChunkRows([makeChunkRow({ chunkIndex: 0 })]),
      headerRows: [headerRowOf()],
    });

    await gated({ resolveCorrelation: resolveCorrelation });
    expect(resolved).toBe(0);

    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0, isFinal: true }),
      ]),
      headerRows: [headerRowOf({ traceIds: [], exceptionFingerprints: [] })],
    });

    await gated({ resolveCorrelation: resolveCorrelation });

    expect(resolved).toBe(1);
    expect(inserted[0]!["traceIds"]).toEqual(["trace-late"]);
    expect(inserted[0]!["exceptionFingerprints"]).toEqual(["fp-late"]);
  });

  test("the header version is stamped before the chunk rows are read, not after the slow steps", async () => {
    /*
     * A run that read the rows at T and then stalled in correlation must not
     * outrank a later run's header built from a later read.
     */
    const readStartedAt: number = Date.now();
    let clockUnixMs: number = readStartedAt;

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
      return new Date(clockUnixMs);
    });

    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0, isFinal: true }),
      ]),
      headerRows: [headerRowOf()],
      onAggregate: (): void => {
        clockUnixMs += 5_000;
      },
    });

    const result: FinalizeSessionResult = await gated({
      resolveCorrelation: (): Promise<SessionCorrelation> => {
        clockUnixMs += 2 * 60 * 1000;
        return Promise.resolve({ traceIds: [], exceptionFingerprints: [] });
      },
    });

    expect(result.outcome).toBe("written");
    expect(inserted[0]!["version"]).toBe(readStartedAt);
  });

  test("a defer check that says stop leaves an ended session unwritten, before correlation", async () => {
    let resolved: number = 0;
    let asked: number = 0;

    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0, isFinal: true }),
      ]),
      headerRows: [headerRowOf()],
    });

    const result: FinalizeSessionResult = await gated({
      shouldDefer: (): boolean => {
        asked++;
        return true;
      },
      resolveCorrelation: (): Promise<SessionCorrelation> => {
        resolved++;
        return Promise.resolve({ traceIds: [], exceptionFingerprints: [] });
      },
    });

    expect(result).toEqual({ outcome: "deferred", writtenTabIds: [] });
    expect(asked).toBe(1);
    expect(resolved).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  test("the defer check is not consulted for a session that has not ended", async () => {
    let asked: number = 0;

    stubClickhouse({
      tabRows: runGroupByOverChunkRows([makeChunkRow({ chunkIndex: 0 })]),
      headerRows: [headerRowOf()],
    });

    const result: FinalizeSessionResult = await gated({
      shouldDefer: (): boolean => {
        asked++;
        return true;
      },
    });

    expect(result.outcome).toBe("still-recording");
    expect(asked).toBe(0);
  });

  describe("with the ended-session grace", () => {
    const endedKey: string = getEndedSessionsKey(projectId.toString());

    test("a tab whose newest chunk was stored inside the grace holds the session back as settling", async () => {
      /*
       * Page A ended long ago, page B's final chunk was stored 10s ago: page
       * C may be about to register under the same session.
       */
      const { inserted, statements } = stubClickhouse({
        tabRows: runGroupByOverChunkRows([
          makeChunkRow({ chunkIndex: 0, tabId: "tab-a", isFinal: true }),
          makeChunkRow({
            chunkIndex: 0,
            tabId: "tab-b",
            isFinal: true,
            version: Date.now() - 10_000,
          }),
        ]),
        headerRows: [headerRowOf()],
      });

      const result: FinalizeSessionResult = await gated();

      expect(result).toEqual({ outcome: "settling", writtenTabIds: [] });
      expect(inserted).toHaveLength(0);
      expect(issuedHeaderRead(statements)).toBe(false);
    });

    test("the grace holds even when the newest tab has no ended candidate at all", async () => {
      /*
       * Its ended-set ZADD failed, or has not landed yet. The old Redis-score
       * refinement read a missing member as "settled" and wrote at once;
       * the chunk rows' own write time does not depend on the ZADD.
       */
      mockRedis.seedZset(
        endedKey,
        `${sessionId}:tab-a`,
        Date.now() - 5 * 60 * 1000,
      );

      const { inserted } = stubClickhouse({
        tabRows: runGroupByOverChunkRows([
          makeChunkRow({ chunkIndex: 0, tabId: "tab-a", isFinal: true }),
          makeChunkRow({
            chunkIndex: 0,
            tabId: "tab-b",
            isFinal: true,
            version: Date.now() - 1_000,
          }),
        ]),
        headerRows: [headerRowOf()],
      });

      const result: FinalizeSessionResult = await gated();

      expect(result.outcome).toBe("settling");
      expect(inserted).toHaveLength(0);
    });

    test("once the newest chunk is older than the grace, the session is written with no Redis read", async () => {
      const { inserted } = stubClickhouse({
        tabRows: runGroupByOverChunkRows([
          makeChunkRow({ chunkIndex: 0, tabId: "tab-a", isFinal: true }),
          makeChunkRow({
            chunkIndex: 0,
            tabId: "tab-b",
            isFinal: true,
            version:
              Date.now() - SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS - 1_000,
          }),
        ]),
        headerRows: [headerRowOf()],
      });

      const result: FinalizeSessionResult = await gated();

      expect(result.outcome).toBe("written");
      expect(inserted).toHaveLength(1);
      /* The ended set was never consulted. */
      expect(mockRedis.evalCalls).toEqual([]);
    });

    test("the grace is judged per application", async () => {
      const { inserted } = stubClickhouse({
        tabRows: runGroupByOverChunkRows([
          makeChunkRow({
            chunkIndex: 0,
            tabId: "tab-a",
            rumApplicationId: appA,
            isFinal: true,
          }),
          makeChunkRow({
            chunkIndex: 0,
            tabId: "tab-b",
            rumApplicationId: appB,
            isFinal: true,
            version: Date.now() - 1_000,
          }),
        ]),
        headerRows: [
          headerRowOf({ rumApplicationId: appA, primaryEntityId: appA }),
          headerRowOf({ rumApplicationId: appB, primaryEntityId: appB }),
        ],
      });

      const result: FinalizeSessionResult = await gated();

      expect(result).toEqual({ outcome: "written", writtenTabIds: ["tab-a"] });
      expect(inserted).toHaveLength(1);
      expect(inserted[0]!["rumApplicationId"]).toBe(appA);
    });

    test("a live tab answers still-recording, not settling, whatever its age", async () => {
      stubClickhouse({
        tabRows: runGroupByOverChunkRows([
          makeChunkRow({
            chunkIndex: 0,
            tabId: "tab-a",
            isFinal: true,
            version: Date.now() - 1_000,
          }),
          makeChunkRow({ chunkIndex: 0, tabId: "tab-b" }),
        ]),
        headerRows: [headerRowOf()],
      });

      const result: FinalizeSessionResult = await gated();

      expect(result.outcome).toBe("still-recording");
    });
  });
});

describe("Rum:FinalizeEndedSessions loop", () => {
  const activeKey: string = getActiveSessionsKey(projectId.toString());
  const endedKey: string = getEndedSessionsKey(projectId.toString());
  const otherSessionId: string = "2a1b3c4d5e6f708192a3b4c5d6e7f809";

  beforeEach(() => {
    mockRedis.reset();
  });

  afterEach(() => {
    chunkServiceStub.executeQuery = realExecuteQuery;
    sessionServiceStub.insertJsonRows = realInsertJsonRows;
    chunkServiceStub.database = realDatabase;
    jest.restoreAllMocks();
  });

  /* What the ingest path writes for a tab's final frame. */
  function seedFinalFrame(
    sessionIdToSeed: string,
    tabId: string,
    score: number,
    projectIdToSeed: string = projectId.toString(),
  ): void {
    mockRedis.seedZset(
      getActiveSessionsKey(projectIdToSeed),
      `${sessionIdToSeed}:${tabId}`,
      score,
    );
    mockRedis.seedZset(
      getEndedSessionsKey(projectIdToSeed),
      `${sessionIdToSeed}:${tabId}`,
      score,
    );
    mockRedis.seedSet(SESSION_REPLAY_ACTIVE_PROJECTS_KEY, projectIdToSeed);
  }

  /* What the ingest path writes for any other frame. */
  function seedChunk(
    sessionIdToSeed: string,
    tabId: string,
    score: number,
  ): void {
    mockRedis.seedZset(activeKey, `${sessionIdToSeed}:${tabId}`, score);
    mockRedis.seedSet(SESSION_REPLAY_ACTIVE_PROJECTS_KEY, projectId.toString());
  }

  function settledAgo(): number {
    return Date.now() - SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS - 30_000;
  }

  function aggregateReads(statements: Array<Statement>): number {
    return statements.filter((statement: Statement): boolean => {
      return statement.query.includes("GROUP BY rumApplicationId, tabId");
    }).length;
  }

  /* Moves both clocks the job reads - Date.now and the header stamp - on. */
  function advanceClocksBy(offsetMs: () => number): void {
    const realNow: () => number = Date.now.bind(Date);

    jest.spyOn(Date, "now").mockImplementation((): number => {
      return realNow() + offsetMs();
    });
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
      return new Date(realNow() + offsetMs());
    });
  }

  test("a closed tab is finalized once it settles; its candidate goes, its activity entry stays for the idle pass", async () => {
    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0 }),
        makeChunkRow({ chunkIndex: 1, isFinal: true }),
      ]),
      headerRows: [headerRowOf()],
    });

    seedFinalFrame(sessionId, "tab-a", settledAgo());

    const summary: FinalizeEndedSessionsSummary = await finalizeEndedSessions();

    expect(summary.finalized).toBe(1);
    expect(summary.checked).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!["isFinalized"]).toBe(true);
    expect(inserted[0]!["sealedReason"]).toBe(
      SessionReplaySealedReason.FinalChunk,
    );
    expect(mockRedis.membersOf(endedKey)).toEqual([]);
    expect(mockRedis.membersOf(activeKey)).toEqual([`${sessionId}:tab-a`]);
    /* Every removal went through the conditional script. */
    expect(mockRedis.zremCalls).toEqual([]);
  });

  test("a candidate younger than the grace is not even checked", async () => {
    const { inserted, statements } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0, isFinal: true }),
      ]),
      headerRows: [headerRowOf()],
    });

    seedFinalFrame(
      sessionId,
      "tab-a",
      Date.now() - SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS + 10_000,
    );

    const summary: FinalizeEndedSessionsSummary = await finalizeEndedSessions();

    expect(summary.checked).toBe(0);
    expect(inserted).toHaveLength(0);
    expect(statements).toHaveLength(0);
    expect(mockRedis.membersOf(activeKey)).toEqual([`${sessionId}:tab-a`]);
    expect(mockRedis.membersOf(endedKey)).toEqual([`${sessionId}:tab-a`]);
  });

  test("an early finalization leaves every tab's activity entry, including a page without a candidate", async () => {
    /*
     * tab-a (page A) ended long ago and its candidate was consumed by a
     * still-recording check while page B recorded. The header covers both
     * pages; the idle path finalizes the session once more from these.
     */
    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0, tabId: "tab-a", isFinal: true }),
        makeChunkRow({ chunkIndex: 0, tabId: "tab-b", isFinal: true }),
      ]),
      headerRows: [headerRowOf()],
    });

    const pageBEnded: number = settledAgo();

    seedChunk(sessionId, "tab-a", pageBEnded - 5 * 60 * 1000);
    seedFinalFrame(sessionId, "tab-b", pageBEnded);

    const summary: FinalizeEndedSessionsSummary = await finalizeEndedSessions();

    expect(summary.finalized).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(mockRedis.membersOf(activeKey)).toEqual([
      `${sessionId}:tab-a`,
      `${sessionId}:tab-b`,
    ]);
    expect(mockRedis.scoreOf(activeKey, `${sessionId}:tab-a`)).toBe(
      pageBEnded - 5 * 60 * 1000,
    );
    expect(mockRedis.membersOf(endedKey)).toEqual([]);
  });

  test("the idle pass re-finalizes an early-finalized session and adds telemetry that landed after it", async () => {
    /*
     * The span and exception batch of the page that just closed is ingested
     * later than its final replay chunk. The early header cannot hold ids
     * that are not in ClickHouse yet; the idle pass, 10 minutes after the
     * last chunk, reads them and merges them onto the ids already there.
     */
    const lastChunkAt: number = settledAgo();

    const early: { inserted: Array<JSONObject> } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0, isFinal: true }),
      ]),
      headerRows: [
        headerRowOf({
          traceIds: ["trace-early"],
          exceptionFingerprints: ["fp-early"],
        }),
      ],
    });

    seedFinalFrame(sessionId, "tab-a", lastChunkAt);

    expect((await finalizeEndedSessions()).finalized).toBe(1);
    expect(early.inserted).toHaveLength(1);
    expect(early.inserted[0]!["exceptionFingerprints"]).toEqual(["fp-early"]);

    /* Ten minutes on, the late telemetry is in, and the idle job runs. */
    advanceClocksBy((): number => {
      return SESSION_REPLAY_IDLE_FINALIZE_MS;
    });

    const idle: { inserted: Array<JSONObject> } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0, isFinal: true }),
      ]),
      /* The newest header version is now the early finalized one. */
      headerRows: [
        headerRowOf({
          traceIds: early.inserted[0]!["traceIds"] as Array<string>,
          exceptionFingerprints: early.inserted[0]![
            "exceptionFingerprints"
          ] as Array<string>,
        }),
      ],
      exceptionRows: [
        { sessionId: sessionId, exceptionFingerprints: ["fp-late"] },
      ],
      traceRows: [{ sessionId: sessionId, traceIds: ["trace-late"] }],
    });

    await finalizeExpiredSessions();

    expect(idle.inserted).toHaveLength(1);
    expect(idle.inserted[0]!["isFinalized"]).toBe(true);
    expect(
      [...(idle.inserted[0]!["exceptionFingerprints"] as Array<string>)].sort(),
    ).toEqual(["fp-early", "fp-late"]);
    expect(
      [...(idle.inserted[0]!["traceIds"] as Array<string>)].sort(),
    ).toEqual(["trace-early", "trace-late"]);
    /* And only now is the session off both queues. */
    expect(mockRedis.membersOf(activeKey)).toEqual([]);
    expect(mockRedis.membersOf(endedKey)).toEqual([]);
  });

  test("a tab of another session is untouched", async () => {
    stubClickhouse({
      tabRowsBySessionId: {
        [sessionId]: runGroupByOverChunkRows([
          makeChunkRow({ chunkIndex: 0, isFinal: true }),
        ]),
      },
      headerRows: [headerRowOf()],
    });

    seedFinalFrame(sessionId, "tab-a", settledAgo());
    seedChunk(otherSessionId, "tab-a", settledAgo() - 1_000);

    await finalizeEndedSessions();

    expect(mockRedis.membersOf(activeKey)).toContain(`${otherSessionId}:tab-a`);
    expect(mockRedis.membersOf(endedKey)).toEqual([]);
  });

  test("a final chunk re-queued while the header was being written survives in the ended set", async () => {
    const bumpedTo: number = Date.now();

    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0, tabId: "tab-a", isFinal: true }),
        makeChunkRow({ chunkIndex: 0, tabId: "tab-b", isFinal: true }),
      ]),
      headerRows: [headerRowOf()],
      onInsert: (): void => {
        /* The same tab posts again (a stop() then start()), final this time. */
        mockRedis.seedZset(activeKey, `${sessionId}:tab-b`, bumpedTo);
        mockRedis.seedZset(endedKey, `${sessionId}:tab-b`, bumpedTo);
      },
    });

    seedFinalFrame(sessionId, "tab-a", settledAgo() - 1_000);
    seedFinalFrame(sessionId, "tab-b", settledAgo());

    await finalizeEndedSessions();

    expect(inserted).toHaveLength(1);
    expect(mockRedis.membersOf(activeKey)).toEqual([
      `${sessionId}:tab-a`,
      `${sessionId}:tab-b`,
    ]);
    expect(mockRedis.scoreOf(activeKey, `${sessionId}:tab-b`)).toBe(bumpedTo);
    expect(mockRedis.membersOf(endedKey)).toEqual([`${sessionId}:tab-b`]);
    expect(mockRedis.scoreOf(endedKey, `${sessionId}:tab-b`)).toBe(bumpedTo);
  });

  test("still recording: the candidate leaves the ended set, the activity entries stay with the idle path", async () => {
    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0, tabId: "tab-a", isFinal: true }),
        makeChunkRow({ chunkIndex: 0, tabId: "tab-b" }),
      ]),
      headerRows: [headerRowOf()],
    });

    seedFinalFrame(sessionId, "tab-a", settledAgo());
    seedChunk(sessionId, "tab-b", Date.now() - 5_000);

    const summary: FinalizeEndedSessionsSummary = await finalizeEndedSessions();

    expect(summary.stillRecording).toBe(1);
    expect(summary.finalized).toBe(0);
    expect(inserted).toHaveLength(0);
    expect(mockRedis.membersOf(endedKey)).toEqual([]);
    expect(mockRedis.membersOf(activeKey)).toEqual([
      `${sessionId}:tab-a`,
      `${sessionId}:tab-b`,
    ]);

    /* A second run has nothing left to re-check. */
    const second: FinalizeEndedSessionsSummary = await finalizeEndedSessions();
    expect(second.checked).toBe(0);
  });

  test("the live tab's own final chunk later brings the session back and finalizes it", async () => {
    const tabsLive: Array<JSONObject> = runGroupByOverChunkRows([
      makeChunkRow({ chunkIndex: 0, tabId: "tab-a", isFinal: true }),
      makeChunkRow({ chunkIndex: 0, tabId: "tab-b" }),
    ]);
    const tabsEnded: Array<JSONObject> = runGroupByOverChunkRows([
      makeChunkRow({ chunkIndex: 0, tabId: "tab-a", isFinal: true }),
      makeChunkRow({ chunkIndex: 0, tabId: "tab-b" }),
      makeChunkRow({ chunkIndex: 1, tabId: "tab-b", isFinal: true }),
    ]);

    stubClickhouse({ tabRows: tabsLive, headerRows: [headerRowOf()] });

    seedFinalFrame(sessionId, "tab-a", settledAgo() - 60_000);
    seedChunk(sessionId, "tab-b", Date.now() - 5_000);

    expect((await finalizeEndedSessions()).stillRecording).toBe(1);

    const { inserted } = stubClickhouse({
      tabRows: tabsEnded,
      headerRows: [headerRowOf()],
    });

    seedFinalFrame(sessionId, "tab-b", settledAgo());

    const summary: FinalizeEndedSessionsSummary = await finalizeEndedSessions();

    expect(summary.finalized).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(mockRedis.membersOf(endedKey)).toEqual([]);
    expect(mockRedis.membersOf(activeKey)).toEqual([
      `${sessionId}:tab-a`,
      `${sessionId}:tab-b`,
    ]);
  });

  test("a final chunk still inside its grace holds the whole session back, and its old candidate stays until it settles", async () => {
    /*
     * A user who spent under a minute on page B: page A's candidate is old
     * enough to read, page B's rows are not old enough to pass the grace.
     * Finalizing now would be undone by page C's first chunk.
     */
    const pageBStoredAt: number = Date.now() - 10_000;

    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0, tabId: "tab-a", isFinal: true }),
        makeChunkRow({
          chunkIndex: 0,
          tabId: "tab-b",
          isFinal: true,
          version: pageBStoredAt,
        }),
      ]),
      headerRows: [headerRowOf()],
    });

    seedFinalFrame(sessionId, "tab-a", settledAgo());
    seedFinalFrame(sessionId, "tab-b", pageBStoredAt + 50);

    const first: FinalizeEndedSessionsSummary = await finalizeEndedSessions();

    expect(first.settling).toBe(1);
    expect(inserted).toHaveLength(0);
    /* Nothing is removed while the session settles. */
    expect(mockRedis.membersOf(endedKey)).toEqual([
      `${sessionId}:tab-a`,
      `${sessionId}:tab-b`,
    ]);

    /* A minute later page B has settled too. */
    advanceClocksBy((): number => {
      return SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS;
    });

    const second: FinalizeEndedSessionsSummary = await finalizeEndedSessions();

    expect(second.finalized).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(mockRedis.membersOf(endedKey)).toEqual([]);
    expect(mockRedis.membersOf(activeKey)).toEqual([
      `${sessionId}:tab-a`,
      `${sessionId}:tab-b`,
    ]);
  });

  test("a settling session whose newest tab has no candidate is still finalized once it settles", async () => {
    /*
     * Page B's rows landed but its ended-set ZADD failed: only page A's old
     * candidate can bring the session back, so it must not be consumed by
     * the check that the grace held back.
     */
    const pageBStoredAt: number = Date.now() - 5_000;

    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0, tabId: "tab-a", isFinal: true }),
        makeChunkRow({
          chunkIndex: 0,
          tabId: "tab-b",
          isFinal: true,
          version: pageBStoredAt,
        }),
      ]),
      headerRows: [headerRowOf()],
    });

    seedFinalFrame(sessionId, "tab-a", settledAgo());

    expect((await finalizeEndedSessions()).settling).toBe(1);
    expect(inserted).toHaveLength(0);
    expect(mockRedis.membersOf(endedKey)).toEqual([`${sessionId}:tab-a`]);

    advanceClocksBy((): number => {
      return SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS;
    });

    expect((await finalizeEndedSessions()).finalized).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(mockRedis.membersOf(endedKey)).toEqual([]);
  });

  test("a finalize that throws leaves the candidate and the activity entry for the next run", async () => {
    stubClickhouse({ failAggregate: new Error("clickhouse timeout") });

    seedFinalFrame(sessionId, "tab-a", settledAgo());

    const summary: FinalizeEndedSessionsSummary = await finalizeEndedSessions();

    expect(summary.failed).toBe(1);
    expect(mockRedis.membersOf(activeKey)).toEqual([`${sessionId}:tab-a`]);
    expect(mockRedis.membersOf(endedKey)).toEqual([`${sessionId}:tab-a`]);
  });

  test("an insert that throws also leaves everything in place", async () => {
    stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0, isFinal: true }),
      ]),
      headerRows: [headerRowOf()],
    });

    sessionServiceStub.insertJsonRows = (): Promise<void> => {
      return Promise.reject(new Error("async insert flush failed"));
    };

    seedFinalFrame(sessionId, "tab-a", settledAgo());

    const summary: FinalizeEndedSessionsSummary = await finalizeEndedSessions();

    expect(summary.failed).toBe(1);
    expect(summary.finalized).toBe(0);
    expect(mockRedis.membersOf(activeKey)).toEqual([`${sessionId}:tab-a`]);
    expect(mockRedis.membersOf(endedKey)).toEqual([`${sessionId}:tab-a`]);
  });

  test("an erased session gets no header; its candidate goes, its activity entry stays", async () => {
    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0, isFinal: true }),
      ]),
      headerRows: [headerRowOf()],
    });

    mockRedis.seedSet(getErasedSessionsKey(projectId.toString()), sessionId);
    seedFinalFrame(sessionId, "tab-a", settledAgo());

    await finalizeEndedSessions();

    expect(inserted).toHaveLength(0);
    expect(mockRedis.membersOf(endedKey)).toEqual([]);
    expect(mockRedis.membersOf(activeKey)).toEqual([`${sessionId}:tab-a`]);
  });

  test("a session erased while its batch correlation is fetched gets no header", async () => {
    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0, isFinal: true }),
      ]),
      headerRows: [headerRowOf()],
    });

    const routed: unknown = chunkServiceStub.executeQuery;

    chunkServiceStub.executeQuery = (
      statement: Statement,
    ): Promise<unknown> => {
      if (statement.query.includes("AS traceIds")) {
        mockRedis.seedSet(
          getErasedSessionsKey(projectId.toString()),
          sessionId,
        );
      }
      return (routed as (statement: Statement) => Promise<unknown>)(statement);
    };

    seedFinalFrame(sessionId, "tab-a", settledAgo());

    const summary: FinalizeEndedSessionsSummary = await finalizeEndedSessions();

    expect(summary.finalized).toBe(0);
    expect(inserted).toHaveLength(0);
    expect(mockRedis.membersOf(endedKey)).toEqual([]);
  });

  test("a session with no stored chunks: its candidate goes, its activity entry stays", async () => {
    const { inserted } = stubClickhouse({ tabRows: [] });

    seedFinalFrame(sessionId, "tab-a", settledAgo());

    await finalizeEndedSessions();

    expect(inserted).toHaveLength(0);
    expect(mockRedis.membersOf(endedKey)).toEqual([]);
    expect(mockRedis.membersOf(activeKey)).toEqual([`${sessionId}:tab-a`]);
  });

  test("a malformed candidate is dropped from the ended set", async () => {
    const { statements } = stubClickhouse({ tabRows: [] });

    mockRedis.seedZset(endedKey, "no-separator", settledAgo());
    mockRedis.seedSet(SESSION_REPLAY_ACTIVE_PROJECTS_KEY, projectId.toString());

    const summary: FinalizeEndedSessionsSummary = await finalizeEndedSessions();

    expect(summary.checked).toBe(0);
    expect(statements).toHaveLength(0);
    expect(mockRedis.membersOf(endedKey)).toEqual([]);
  });

  test("several candidates of one session are checked once", async () => {
    const { statements } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0, tabId: "tab-a", isFinal: true }),
        makeChunkRow({ chunkIndex: 0, tabId: "tab-b", isFinal: true }),
      ]),
      headerRows: [headerRowOf()],
    });

    seedFinalFrame(sessionId, "tab-a", settledAgo() - 1_000);
    seedFinalFrame(sessionId, "tab-b", settledAgo());

    const summary: FinalizeEndedSessionsSummary = await finalizeEndedSessions();

    expect(summary.candidates).toBe(2);
    expect(summary.checked).toBe(1);
    expect(aggregateReads(statements)).toBe(1);
  });

  test("correlation is read once per batch, and not at all when nothing is written", async () => {
    const correlationReads: (statements: Array<Statement>) => number = (
      statements: Array<Statement>,
    ): number => {
      return statements.filter((statement: Statement): boolean => {
        return (
          statement.query.includes("groupUniqArray(") &&
          statement.query.includes("GROUP BY sessionId")
        );
      }).length;
    };

    const liveRun: { statements: Array<Statement> } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0, tabId: "tab-a", isFinal: true }),
        makeChunkRow({ chunkIndex: 0, tabId: "tab-b" }),
      ]),
      headerRows: [headerRowOf()],
    });

    seedFinalFrame(sessionId, "tab-a", settledAgo());
    seedFinalFrame(otherSessionId, "tab-a", settledAgo());

    await finalizeEndedSessions();

    expect(correlationReads(liveRun.statements)).toBe(0);

    const endedRun: {
      inserted: Array<JSONObject>;
      statements: Array<Statement>;
    } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0, tabId: "tab-a", isFinal: true }),
      ]),
      headerRows: [headerRowOf()],
    });

    seedFinalFrame(sessionId, "tab-a", settledAgo());
    seedFinalFrame(otherSessionId, "tab-a", settledAgo());

    await finalizeEndedSessions();

    expect(endedRun.inserted).toHaveLength(2);
    /* One Span read and one ExceptionInstance read for both sessions. */
    expect(correlationReads(endedRun.statements)).toBe(2);
  });

  test("only indexed projects are read, and the keyspace is never scanned", async () => {
    const { statements } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0, isFinal: true }),
      ]),
      headerRows: [headerRowOf()],
    });

    /* A candidate for a project the index does not hold. */
    mockRedis.seedZset(endedKey, `${sessionId}:tab-a`, settledAgo());

    const summary: FinalizeEndedSessionsSummary = await finalizeEndedSessions();

    expect(summary.checked).toBe(0);
    expect(statements).toHaveLength(0);
    expect(mockRedis.scanCalls).toEqual([]);
  });

  test("candidates per project are capped, oldest first, and the rest wait for the next run", async () => {
    stubClickhouse({ tabRows: [] });

    const oldest: number = settledAgo() - 10 * 60 * 1000;

    for (
      let index: number = 0;
      index < MAX_ENDED_CANDIDATES_PER_PROJECT_PER_RUN + 5;
      index++
    ) {
      const member: string = `${index.toString(16).padStart(32, "0")}:tab-a`;
      mockRedis.seedZset(endedKey, member, oldest + index);
    }
    mockRedis.seedSet(SESSION_REPLAY_ACTIVE_PROJECTS_KEY, projectId.toString());

    const summary: FinalizeEndedSessionsSummary = await finalizeEndedSessions();

    expect(summary.checked).toBe(MAX_ENDED_CANDIDATES_PER_PROJECT_PER_RUN);
    /* The five NEWEST were beyond the window. */
    expect(mockRedis.membersOf(endedKey)).toHaveLength(5);
    expect(
      Math.min(
        ...mockRedis.membersOf(endedKey).map((member: string): number => {
          return mockRedis.scoreOf(endedKey, member)!;
        }),
      ),
    ).toBe(oldest + MAX_ENDED_CANDIDATES_PER_PROJECT_PER_RUN);
  });

  test("the run budget stops the loop and leaves the rest queued", async () => {
    const realNow: () => number = Date.now.bind(Date);
    let skewMs: number = 0;

    jest.spyOn(Date, "now").mockImplementation((): number => {
      return realNow() + skewMs;
    });

    const { inserted } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0, isFinal: true }),
      ]),
      headerRows: [headerRowOf()],
      onInsert: (): void => {
        /* The first finalization eats the whole budget. */
        skewMs += ENDED_RUN_BUDGET_MS + 1;
      },
    });

    seedFinalFrame(sessionId, "tab-a", settledAgo() - 1_000);
    seedFinalFrame(otherSessionId, "tab-a", settledAgo());

    const summary: FinalizeEndedSessionsSummary = await finalizeEndedSessions();

    expect(summary.budgetExhausted).toBe(true);
    expect(summary.checked).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(mockRedis.membersOf(endedKey)).toEqual([`${otherSessionId}:tab-a`]);
  });

  test("an ended session that would start its correlation past the budget stays queued, unwritten", async () => {
    const realNow: () => number = Date.now.bind(Date);
    let skewMs: number = 0;

    jest.spyOn(Date, "now").mockImplementation((): number => {
      return realNow() + skewMs;
    });

    const { inserted, statements } = stubClickhouse({
      tabRows: runGroupByOverChunkRows([
        makeChunkRow({ chunkIndex: 0, isFinal: true }),
      ]),
      headerRows: [headerRowOf()],
      onAggregate: (): void => {
        /* The chunk read itself runs the run out of budget. */
        skewMs += ENDED_RUN_BUDGET_MS + 1;
      },
    });

    seedFinalFrame(sessionId, "tab-a", settledAgo());

    const summary: FinalizeEndedSessionsSummary = await finalizeEndedSessions();

    expect(summary.deferred).toBe(1);
    expect(summary.budgetExhausted).toBe(true);
    expect(inserted).toHaveLength(0);
    /* No correlation read was started. */
    expect(
      statements.some((statement: Statement): boolean => {
        return statement.query.includes("GROUP BY sessionId");
      }),
    ).toBe(false);
    expect(mockRedis.membersOf(endedKey)).toEqual([`${sessionId}:tab-a`]);
  });

  describe("single flight", () => {
    test("the lock is taken with NX and a TTL well over the worst case of one run", async () => {
      stubClickhouse({ tabRows: [] });

      await finalizeEndedSessions();

      const lockSet: Array<string | number> | undefined =
        mockRedis.setCalls.find((call: Array<string | number>): boolean => {
          return call[0] === SESSION_REPLAY_ENDED_RUN_LOCK_KEY;
        });

      expect(lockSet).toBeDefined();
      expect(lockSet!.slice(2)).toEqual(["PX", ENDED_RUN_LOCK_TTL_MS, "NX"]);
      /* The budget plus one correlation fetch of two 58s reads, and margin. */
      expect(ENDED_RUN_LOCK_TTL_MS).toBeGreaterThan(
        ENDED_RUN_BUDGET_MS + 2 * 58 * 1000,
      );
      /* And the lock is gone again once the run is over. */
      expect(mockRedis.strings.has(SESSION_REPLAY_ENDED_RUN_LOCK_KEY)).toBe(
        false,
      );
    });

    test("a run that finds the lock held skips without reading a candidate", async () => {
      const { inserted, statements } = stubClickhouse({
        tabRows: runGroupByOverChunkRows([
          makeChunkRow({ chunkIndex: 0, isFinal: true }),
        ]),
        headerRows: [headerRowOf()],
      });

      mockRedis.strings.set(SESSION_REPLAY_ENDED_RUN_LOCK_KEY, "earlier-run");
      seedFinalFrame(sessionId, "tab-a", settledAgo());

      const summary: FinalizeEndedSessionsSummary =
        await finalizeEndedSessions();

      expect(summary.skippedLockHeld).toBe(true);
      expect(summary.checked).toBe(0);
      expect(statements).toHaveLength(0);
      expect(inserted).toHaveLength(0);
      expect(mockRedis.membersOf(endedKey)).toEqual([`${sessionId}:tab-a`]);
      /* Another run's lock is never released by this one. */
      expect(mockRedis.strings.get(SESSION_REPLAY_ENDED_RUN_LOCK_KEY)).toBe(
        "earlier-run",
      );
    });

    test("overlapping runs: exactly one does the work", async () => {
      const { inserted, statements } = stubClickhouse({
        tabRows: runGroupByOverChunkRows([
          makeChunkRow({ chunkIndex: 0, isFinal: true }),
        ]),
        headerRows: [headerRowOf()],
      });

      seedFinalFrame(sessionId, "tab-a", settledAgo());

      const runs: Array<FinalizeEndedSessionsSummary> = await Promise.all([
        finalizeEndedSessions(),
        finalizeEndedSessions(),
      ]);

      expect(
        runs.filter((run: FinalizeEndedSessionsSummary): boolean => {
          return run.skippedLockHeld;
        }),
      ).toHaveLength(1);
      expect(inserted).toHaveLength(1);
      expect(aggregateReads(statements)).toBe(1);
      expect(mockRedis.strings.has(SESSION_REPLAY_ENDED_RUN_LOCK_KEY)).toBe(
        false,
      );

      /* Released, so the next run does its work again. */
      expect((await finalizeEndedSessions()).skippedLockHeld).toBe(false);
    });

    test("a run that overran its TTL does not release the lock a later run took", async () => {
      stubClickhouse({
        tabRows: runGroupByOverChunkRows([
          makeChunkRow({ chunkIndex: 0, isFinal: true }),
        ]),
        headerRows: [headerRowOf()],
        onInsert: (): void => {
          mockRedis.strings.set(SESSION_REPLAY_ENDED_RUN_LOCK_KEY, "later-run");
        },
      });

      seedFinalFrame(sessionId, "tab-a", settledAgo());

      await finalizeEndedSessions();

      expect(mockRedis.strings.get(SESSION_REPLAY_ENDED_RUN_LOCK_KEY)).toBe(
        "later-run",
      );
    });

    test("the lock is released even when the run throws", async () => {
      stubClickhouse({ tabRows: [] });
      mockRedis.failSmembers = true;

      await expect(finalizeEndedSessions()).rejects.toThrow(
        "smembers exploded",
      );
      expect(mockRedis.strings.has(SESSION_REPLAY_ENDED_RUN_LOCK_KEY)).toBe(
        false,
      );
    });
  });

  describe("fairness across projects", () => {
    const busyProjectId: string = projectId.toString();
    const quietProjectId: string = "6600000000000000000000a2";

    function sessionIdAt(index: number): string {
      return (index + 1).toString(16).padStart(32, "0");
    }

    function projectOfAggregate(statement: Statement): string | undefined {
      return Object.values(statement.query_params).find(
        (value: unknown): boolean => {
          return value === busyProjectId || value === quietProjectId;
        },
      ) as string | undefined;
    }

    test("the project order is sorted and rotates with the cursor", () => {
      const projects: Array<string> = ["p-c", "p-a", "p-b", "p-a"];

      expect(rotateEndedProjectOrder(projects, 0)).toEqual([
        "p-a",
        "p-b",
        "p-c",
      ]);
      expect(rotateEndedProjectOrder(projects, 1)).toEqual([
        "p-b",
        "p-c",
        "p-a",
      ]);
      expect(rotateEndedProjectOrder(projects, 5)).toEqual([
        "p-c",
        "p-a",
        "p-b",
      ]);
      expect(rotateEndedProjectOrder(projects, -1)).toEqual([
        "p-c",
        "p-a",
        "p-b",
      ]);
      expect(rotateEndedProjectOrder([], 3)).toEqual([]);
    });

    test("each run starts one project further on", async () => {
      const firstProjectPerRun: Array<string | undefined> = [];

      for (let run: number = 0; run < 3; run++) {
        const { statements } = stubClickhouse({ tabRows: [] });

        seedFinalFrame(sessionIdAt(0), "tab-a", settledAgo(), busyProjectId);
        seedFinalFrame(sessionIdAt(1), "tab-a", settledAgo(), quietProjectId);

        await finalizeEndedSessions();

        const firstAggregate: Statement | undefined = statements.find(
          (statement: Statement): boolean => {
            return statement.query.includes("GROUP BY rumApplicationId, tabId");
          },
        );

        firstProjectPerRun.push(
          firstAggregate ? projectOfAggregate(firstAggregate) : undefined,
        );
      }

      expect(firstProjectPerRun[0]).toBeDefined();
      expect(firstProjectPerRun[1]).not.toBe(firstProjectPerRun[0]);
      expect(firstProjectPerRun[2]).toBe(firstProjectPerRun[0]);
      expect(
        mockRedis.strings.get(SESSION_REPLAY_ENDED_PROJECT_CURSOR_KEY),
      ).toBe("3");
    });

    test("a busy project first in the order cannot starve the next one", async () => {
      /*
       * Every written header costs a second of the run. The busy project has
       * far more settled sessions than the whole budget covers.
       */
      const realNow: () => number = Date.now.bind(Date);
      let skewMs: number = 0;

      jest.spyOn(Date, "now").mockImplementation((): number => {
        return realNow() + skewMs;
      });

      const { inserted } = stubClickhouse({
        tabRows: runGroupByOverChunkRows([
          makeChunkRow({ chunkIndex: 0, isFinal: true }),
        ]),
        headerRows: [headerRowOf()],
        onInsert: (): void => {
          skewMs += 1_000;
        },
      });

      const busySessions: number = 200;

      for (let index: number = 0; index < busySessions; index++) {
        seedFinalFrame(
          sessionIdAt(index),
          "tab-a",
          settledAgo() - 1_000 + index,
          busyProjectId,
        );
      }

      seedFinalFrame(
        sessionIdAt(busySessions),
        "tab-a",
        settledAgo(),
        quietProjectId,
      );

      /* The next INCR lands on 2, i.e. offset 0: the busy project goes first. */
      mockRedis.strings.set(SESSION_REPLAY_ENDED_PROJECT_CURSOR_KEY, "1");

      const summary: FinalizeEndedSessionsSummary =
        await finalizeEndedSessions();

      const writtenProjects: Array<unknown> = inserted.map(
        (row: JSONObject): unknown => {
          return row["projectId"];
        },
      );

      expect(writtenProjects[0]).toBe(busyProjectId);
      /* The quiet project was served in the same run. */
      expect(writtenProjects).toContain(quietProjectId);
      expect(mockRedis.membersOf(getEndedSessionsKey(quietProjectId))).toEqual(
        [],
      );
      /* The busy one drains over several runs instead, oldest first. */
      const busyLeft: number = mockRedis.membersOf(
        getEndedSessionsKey(busyProjectId),
      ).length;
      expect(busyLeft).toBeGreaterThan(busySessions / 2);
      expect(summary.budgetExhausted).toBe(false);
    });

    test("no project can take the whole run's session cap: every project gets a share", async () => {
      /*
       * Three projects, each holding as many settled candidates as one
       * project may read. Walked in order with only the per-project read cap,
       * the first two used all 2000 checks and the third was never read.
       */
      stubClickhouse({ tabRows: [] });

      const thirdProjectId: string = "6600000000000000000000a3";
      const projects: Array<string> = [
        busyProjectId,
        quietProjectId,
        thirdProjectId,
      ];

      for (const projectIdToSeed of projects) {
        mockRedis.seedSet(SESSION_REPLAY_ACTIVE_PROJECTS_KEY, projectIdToSeed);

        for (
          let index: number = 0;
          index < MAX_ENDED_CANDIDATES_PER_PROJECT_PER_RUN;
          index++
        ) {
          mockRedis.seedZset(
            getEndedSessionsKey(projectIdToSeed),
            `${sessionIdAt(index)}:tab-a`,
            settledAgo() - 100_000 + index,
          );
        }
      }

      const summary: FinalizeEndedSessionsSummary =
        await finalizeEndedSessions();

      expect(summary.checked).toBe(MAX_ENDED_SESSIONS_PER_RUN);

      const checkedPerProject: Array<number> = projects.map(
        (projectIdToRead: string): number => {
          return (
            MAX_ENDED_CANDIDATES_PER_PROJECT_PER_RUN -
            mockRedis.membersOf(getEndedSessionsKey(projectIdToRead)).length
          );
        },
      );

      for (const checked of checkedPerProject) {
        expect(checked).toBeGreaterThanOrEqual(
          Math.max(
            MIN_ENDED_SESSIONS_PER_PROJECT_PER_RUN,
            Math.floor(MAX_ENDED_SESSIONS_PER_RUN / projects.length),
          ),
        );
      }

      /* The floors stay below an even split, so they cannot undo it. */
      expect(MIN_ENDED_SESSIONS_PER_PROJECT_PER_RUN).toBeLessThan(
        MAX_ENDED_SESSIONS_PER_RUN / projects.length,
      );
      expect(MIN_ENDED_PROJECT_SLICE_MS).toBeLessThan(ENDED_RUN_BUDGET_MS);
    });
  });

  test("Redis down skips the run with a warning instead of throwing", async () => {
    const { statements } = stubClickhouse({});

    mockRedis.connected = false;

    const summary: FinalizeEndedSessionsSummary = await finalizeEndedSessions();

    expect(summary).toEqual({
      candidates: 0,
      checked: 0,
      finalized: 0,
      stillRecording: 0,
      settling: 0,
      deferred: 0,
      failed: 0,
      budgetExhausted: false,
      skippedLockHeld: false,
    });
    expect(statements).toHaveLength(0);
  });
});

describe("Rum:FinalizeSessions cron registration", () => {
  function registrationOf(jobName: string): Array<unknown> | undefined {
    return runCronRegistrations.find((call: Array<unknown>): boolean => {
      return call[0] === jobName;
    });
  }

  test("the ended-session job runs every minute with a one-minute timeout", () => {
    const registration: Array<unknown> | undefined = registrationOf(
      "Rum:FinalizeEndedSessions",
    );

    expect(registration).toBeDefined();
    expect(registration![1]).toEqual({
      schedule: EVERY_MINUTE,
      runOnStartup: false,
      timeoutInMS: 60 * 1000,
    });
    expect(typeof registration![2]).toBe("function");
    /* The run budget sits comfortably inside that timeout. */
    expect(ENDED_RUN_BUDGET_MS).toBeLessThanOrEqual(50 * 1000);
  });

  test("the idle job and the sweep are still registered", () => {
    expect(registrationOf("Rum:FinalizeSessions")).toBeDefined();
    expect(registrationOf("Rum:SweepNeverFinalizedSessions")).toBeDefined();
  });
});
