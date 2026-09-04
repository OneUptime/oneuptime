import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import RumSessionErasureRequest, {
  RumSessionErasureRequestStatus,
  RumSessionErasureRequestType,
} from "Common/Models/DatabaseModels/RumSessionErasureRequest";
import RumSessionErasureRequestService from "Common/Server/Services/RumSessionErasureRequestService";
import RumSessionPinService from "Common/Server/Services/RumSessionPinService";
import ProjectService from "Common/Server/Services/ProjectService";
import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import { EVERY_DAY, EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
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
 * stubbed out — the job modules are imported here purely for their
 * exported logic.
 */
jest.mock("../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

/*
 * An in-memory stand-in for the handful of Redis commands the erasure and
 * finalization paths use. The tombstone is the whole subject of this file,
 * so it has to be a real set with real membership semantics rather than a
 * jest.fn() that always answers the same thing.
 */
interface MockRedisClient {
  sadd: (key: string, members: Array<string>) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
  sismember: (key: string, member: string) => Promise<number>;
  smembers: (key: string) => Promise<Array<string>>;
  srem: (key: string, member: string) => Promise<number>;
  zadd: (key: string, score: number, member: string) => Promise<number>;
  zrem: (key: string, members: Array<string> | string) => Promise<number>;
  zcard: (key: string) => Promise<number>;
  zscan: (
    key: string,
    cursor: string,
    countToken: string,
    count: number,
  ) => Promise<[string, Array<string>]>;
  set: (
    key: string,
    value: string,
    expiryToken: string,
    seconds: number,
    nxToken: string,
  ) => Promise<"OK" | null>;
  scan: (
    cursor: string,
    matchToken: string,
    pattern: string,
    countToken: string,
    count: number,
  ) => Promise<[string, Array<string>]>;
}

class MockRedis {
  public strings: Map<string, string> = new Map<string, string>();
  public scanCallCount: number = 0;
  public sets: Map<string, Set<string>> = new Map<string, Set<string>>();
  public zsets: Map<string, Map<string, number>> = new Map<
    string,
    Map<string, number>
  >();
  public expires: Map<string, number> = new Map<string, number>();
  public connected: boolean = true;

  public reset(): void {
    this.sets = new Map<string, Set<string>>();
    this.zsets = new Map<string, Map<string, number>>();
    this.expires = new Map<string, number>();
    this.strings = new Map<string, string>();
    this.scanCallCount = 0;
    this.connected = true;
  }

  public client(): MockRedisClient {
    return {
      sadd: (key: string, members: Array<string>): Promise<number> => {
        const set: Set<string> = this.sets.get(key) || new Set<string>();

        for (const member of members) {
          set.add(member);
        }

        this.sets.set(key, set);
        return Promise.resolve(members.length);
      },
      expire: (key: string, seconds: number): Promise<number> => {
        this.expires.set(key, seconds);
        return Promise.resolve(1);
      },
      sismember: (key: string, member: string): Promise<number> => {
        return Promise.resolve(this.sets.get(key)?.has(member) ? 1 : 0);
      },
      smembers: (key: string): Promise<Array<string>> => {
        return Promise.resolve(Array.from(this.sets.get(key) || []));
      },
      srem: (key: string, member: string): Promise<number> => {
        return Promise.resolve(this.sets.get(key)?.delete(member) ? 1 : 0);
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

        if (!zset) {
          return Promise.resolve(0);
        }

        const list: Array<string> = Array.isArray(members)
          ? members
          : [members];

        let removed: number = 0;

        for (const member of list) {
          if (zset.delete(member)) {
            removed++;
          }
        }

        return Promise.resolve(removed);
      },
      zcard: (key: string): Promise<number> => {
        return Promise.resolve(this.zsets.get(key)?.size || 0);
      },
      zscan: (key: string): Promise<[string, Array<string>]> => {
        const zset: Map<string, number> | undefined = this.zsets.get(key);
        const flat: Array<string> = [];

        if (zset) {
          for (const [member, score] of zset.entries()) {
            flat.push(member, String(score));
          }
        }

        /* One page is enough for the fixtures here. */
        return Promise.resolve(["0", flat]);
      },
      set: (
        key: string,
        value: string,
        _expiryToken: string,
        _seconds: number,
        nxToken: string,
      ): Promise<"OK" | null> => {
        if (nxToken === "NX" && this.strings.has(key)) {
          return Promise.resolve(null);
        }

        this.strings.set(key, value);
        return Promise.resolve("OK");
      },
      scan: (
        _cursor: string,
        _matchToken: string,
        pattern: string,
      ): Promise<[string, Array<string>]> => {
        this.scanCallCount++;

        const prefix: string = pattern.replace(/\*$/, "");
        const matched: Array<string> = [];

        for (const key of [
          ...this.zsets.keys(),
          ...this.sets.keys(),
          ...this.strings.keys(),
        ]) {
          if (key.startsWith(prefix)) {
            matched.push(key);
          }
        }

        return Promise.resolve(["0", matched]);
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

import RunCron from "../../FeatureSet/Workers/Utils/Cron";
import {
  buildRumApplicationScopeClause,
  buildSessionDeleteStatement,
  chunkSessionIds,
  ERASURE_JOB_SCHEDULE,
  eraseSessionBatch,
  getErasedSessionsKey,
  MAX_ERASURE_ATTEMPTS,
  MAX_SESSION_IDS_PER_MUTATION,
  MAX_SESSION_IDS_PER_REQUEST_PER_RUN,
  processErasureRequest,
  purgeErasedSessionsFromActivitySet,
  ResolvedErasureTargets,
  resolveTargetSessionIds,
  writeErasureTombstones,
} from "../../FeatureSet/Workers/Jobs/Rum/ProcessSessionErasureRequests";
import {
  FinalizeSessionOutcome,
  SESSION_REPLAY_ACTIVE_PROJECTS_KEY,
  SESSION_REPLAY_ACTIVITY_ABANDON_MS,
  SESSION_REPLAY_IDLE_FINALIZE_MS,
  discoverActiveProjectIds,
  finalizeSession,
  getActiveSessionsKey,
} from "../../FeatureSet/Workers/Jobs/Rum/FinalizeSessions";
import { ClientType } from "Common/Server/Infrastructure/Redis";
import {
  ErasureTombstoneUnavailableError,
  isSessionErased,
} from "Common/Server/Utils/SessionReplay/SessionReplayErasureTombstone";
import RumSessionChunkService from "Common/Server/Services/RumSessionChunkService";
import RumSessionService from "Common/Server/Services/RumSessionService";
import AnalyticsTableName from "Common/Types/AnalyticsDatabase/AnalyticsTableName";

const projectId: ObjectID = new ObjectID("6600000000000000000000a1");
const rumApplicationId: ObjectID = new ObjectID("6600000000000000000000b2");
const otherApplicationId: ObjectID = new ObjectID("6600000000000000000000c3");
const sessionId: string = "1f0c9a4b6d2e47f8a1b3c5d7e9f00112";
const databaseName: string = "oneuptime";

/*
 * The services are process-wide singletons, so the methods that would talk
 * to ClickHouse are swapped out per test and put back afterwards rather
 * than being permanently replaced.
 */
interface QueryableService {
  executeQuery: unknown;
  insertJsonRows: unknown;
}

const chunkService: QueryableService =
  RumSessionChunkService as unknown as QueryableService;
const sessionService: QueryableService =
  RumSessionService as unknown as QueryableService;

const realChunkExecuteQuery: unknown = chunkService.executeQuery;
const realSessionExecuteQuery: unknown = sessionService.executeQuery;
const realSessionInsertJsonRows: unknown = sessionService.insertJsonRows;

function resultSetOf(rows: Array<JSONObject>): unknown {
  return {
    json: (): Promise<{ data: Array<JSONObject> }> => {
      return Promise.resolve({ data: rows });
    },
  };
}

beforeEach(() => {
  mockRedis.reset();
});

afterEach(() => {
  chunkService.executeQuery = realChunkExecuteQuery;
  sessionService.executeQuery = realSessionExecuteQuery;
  sessionService.insertJsonRows = realSessionInsertJsonRows;
});

describe("Rum:ProcessSessionErasureRequests delete statement", () => {
  test("targets the LOCAL storage table with ON CLUSTER, not the Distributed one", () => {
    const statement: Statement = buildSessionDeleteStatement({
      databaseName: databaseName,
      tableName: AnalyticsTableName.RumSessionChunk,
      projectId: projectId,
      sessionIds: [sessionId],
    });

    const query: string = statement.query;

    /*
     * Lightweight DELETE cannot target a Distributed table. The table name
     * is bound as an Identifier parameter rather than inlined, so the
     * assertion is on the bound value: dropping the Local suffix would
     * make the erasure a silent no-op on a real cluster.
     */
    expect(Object.values(statement.query_params)).toContain(
      `${AnalyticsTableName.RumSessionChunk}Local`,
    );
    expect(Object.values(statement.query_params)).toContain(databaseName);
    expect(query).toContain("ON CLUSTER");
    expect(query).toContain("ALTER TABLE");
    expect(query).toContain("DELETE WHERE");
  });

  test("binds the session ids as an Array(String), never inlined into SQL", () => {
    const statement: Statement = buildSessionDeleteStatement({
      databaseName: databaseName,
      tableName: AnalyticsTableName.RumSession,
      projectId: projectId,
      sessionIds: [sessionId, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    });

    expect(statement.query).toContain("Array(String)");
    expect(statement.query).not.toContain(sessionId);
    expect(Object.values(statement.query_params)).toContainEqual([
      sessionId,
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ]);
  });

  test("both projectId and sessionId are constrained, so one project cannot erase another's rows", () => {
    const statement: Statement = buildSessionDeleteStatement({
      databaseName: databaseName,
      tableName: AnalyticsTableName.RumSession,
      projectId: projectId,
      sessionIds: [sessionId],
    });

    expect(statement.query).toContain("projectId");
    expect(statement.query).toContain("sessionId IN");
    expect(Object.values(statement.query_params)).toContain(
      projectId.toString(),
    );
  });

  test("pinnedCopiesOnly narrows the same mutation to the materializer's copies", () => {
    /*
     * Unpinning reuses erasure's delete shape but must leave the
     * ordinary rows (and their ordinary retention) alone.
     */
    const pinnedOnly: Statement = buildSessionDeleteStatement({
      databaseName: databaseName,
      tableName: AnalyticsTableName.RumSessionChunk,
      projectId: projectId,
      sessionIds: [sessionId],
      pinnedCopiesOnly: true,
    });

    const full: Statement = buildSessionDeleteStatement({
      databaseName: databaseName,
      tableName: AnalyticsTableName.RumSessionChunk,
      projectId: projectId,
      sessionIds: [sessionId],
    });

    expect(pinnedOnly.query).toContain("AND isPinnedCopy = true");
    expect(full.query).not.toContain("isPinnedCopy");
  });
});

describe("Rum:ProcessSessionErasureRequests batching", () => {
  test("batches at MAX_SESSION_IDS_PER_MUTATION so one mutation per 1000 ids", () => {
    expect(MAX_SESSION_IDS_PER_MUTATION).toBe(1000);

    const ids: Array<string> = Array.from(
      { length: 2500 },
      (_unused: unknown, index: number): string => {
        return `session-${index}`;
      },
    );

    const batches: Array<Array<string>> = chunkSessionIds(
      ids,
      MAX_SESSION_IDS_PER_MUTATION,
    );

    expect(batches.length).toBe(3);
    expect(batches[0]?.length).toBe(1000);
    expect(batches[1]?.length).toBe(1000);
    expect(batches[2]?.length).toBe(500);
    expect(batches.flat()).toEqual(ids);
  });

  test("an exact multiple does not produce a trailing empty batch", () => {
    const ids: Array<string> = Array.from(
      { length: 2000 },
      (_unused: unknown, index: number): string => {
        return `session-${index}`;
      },
    );

    expect(chunkSessionIds(ids, MAX_SESSION_IDS_PER_MUTATION).length).toBe(2);
  });
});

describe("Rum:ProcessSessionErasureRequests application scope", () => {
  function makeRequest(data: {
    requestType: RumSessionErasureRequestType;
    scopedToApplication: boolean;
  }): RumSessionErasureRequest {
    const request: RumSessionErasureRequest = new RumSessionErasureRequest();

    request.projectId = projectId;
    request.requestType = data.requestType;
    request.startDate = new Date("2026-07-01T00:00:00.000Z");
    request.endDate = new Date("2026-07-02T00:00:00.000Z");
    request.targetValue = "user-42";

    if (data.scopedToApplication) {
      request.rumApplicationId = rumApplicationId;
    }

    return request;
  }

  async function capturedQuery(
    request: RumSessionErasureRequest,
  ): Promise<Statement> {
    let captured: Statement | null = null;

    sessionService.executeQuery = (statement: Statement): Promise<unknown> => {
      captured = statement;
      return Promise.resolve(resultSetOf([]));
    };

    await resolveTargetSessionIds({
      databaseName: databaseName,
      request: request,
    });

    if (!captured) {
      throw new Error("resolveTargetSessionIds issued no query");
    }

    return captured;
  }

  test("an unscoped request produces no application predicate", () => {
    const clause: Statement = buildRumApplicationScopeClause(
      makeRequest({
        requestType: RumSessionErasureRequestType.ByDateRange,
        scopedToApplication: false,
      }),
    );

    expect(clause.query).toBe("");
    expect(Object.keys(clause.query_params).length).toBe(0);
  });

  test("a scoped ByDateRange request confines the delete to its application", async () => {
    const statement: Statement = await capturedQuery(
      makeRequest({
        requestType: RumSessionErasureRequestType.ByDateRange,
        scopedToApplication: true,
      }),
    );

    /*
     * Without this predicate an erasure filed against application A for a
     * date range destroys every OTHER application's recordings in the
     * project for that window, plus their correlated telemetry.
     */
    expect(statement.query).toContain("rumApplicationId =");
    expect(Object.values(statement.query_params)).toContain(
      rumApplicationId.toString(),
    );
  });

  test("an unscoped ByDateRange request stays project-wide", async () => {
    const statement: Statement = await capturedQuery(
      makeRequest({
        requestType: RumSessionErasureRequestType.ByDateRange,
        scopedToApplication: false,
      }),
    );

    expect(statement.query).not.toContain("rumApplicationId");
    expect(Object.values(statement.query_params)).not.toContain(
      rumApplicationId.toString(),
    );
  });

  test("a scoped ByIdentifiedUserKey request confines the delete to its application", async () => {
    const statement: Statement = await capturedQuery(
      makeRequest({
        requestType: RumSessionErasureRequestType.ByIdentifiedUserKey,
        scopedToApplication: true,
      }),
    );

    expect(statement.query).toContain("identifiedUserKey =");
    expect(statement.query).toContain("rumApplicationId =");
    expect(Object.values(statement.query_params)).toContain(
      rumApplicationId.toString(),
    );
  });

  test("the scope clause is rebuilt per request and does not leak between them", async () => {
    const scoped: Statement = await capturedQuery(
      makeRequest({
        requestType: RumSessionErasureRequestType.ByDateRange,
        scopedToApplication: true,
      }),
    );

    const unscoped: Statement = await capturedQuery(
      makeRequest({
        requestType: RumSessionErasureRequestType.ByDateRange,
        scopedToApplication: false,
      }),
    );

    expect(scoped.query).toContain("rumApplicationId");
    expect(unscoped.query).not.toContain("rumApplicationId");
  });
});

describe("Rum:ProcessSessionErasureRequests tombstone", () => {
  test("the tombstone is written to the project's erased set with a TTL", async () => {
    await writeErasureTombstones({
      projectId: projectId.toString(),
      sessionIds: [sessionId],
    });

    const key: string = getErasedSessionsKey(projectId.toString());

    expect(mockRedis.sets.get(key)?.has(sessionId)).toBe(true);
    expect(mockRedis.expires.get(key)).toBeGreaterThan(0);
  });

  test("writing the tombstone fails closed when Redis is down", async () => {
    mockRedis.connected = false;

    await expect(
      writeErasureTombstones({
        projectId: projectId.toString(),
        sessionIds: [sessionId],
      }),
    ).rejects.toThrow("Redis is not connected");
  });

  test("the tombstone has a reader: a tombstoned session reads back as erased", async () => {
    await writeErasureTombstones({
      projectId: projectId.toString(),
      sessionIds: [sessionId],
    });

    await expect(
      isSessionErased({
        projectId: projectId.toString(),
        sessionId: sessionId,
      }),
    ).resolves.toBe(true);

    await expect(
      isSessionErased({
        projectId: projectId.toString(),
        sessionId: "a-session-nobody-erased",
      }),
    ).resolves.toBe(false);
  });

  test("the tombstone read fails CLOSED when Redis cannot answer", async () => {
    mockRedis.connected = false;

    /*
     * If Redis is unreachable we cannot prove the session is safe to write,
     * and a delayed write is exactly how an erased recording comes back.
     * It throws rather than answering "erased", so a transient blip
     * retries instead of permanently discarding a live session.
     */
    await expect(
      isSessionErased({
        projectId: projectId.toString(),
        sessionId: sessionId,
      }),
    ).rejects.toBeInstanceOf(ErasureTombstoneUnavailableError);
  });

  test("the tombstone is scoped per project", async () => {
    await writeErasureTombstones({
      projectId: projectId.toString(),
      sessionIds: [sessionId],
    });

    await expect(
      isSessionErased({
        projectId: otherApplicationId.toString(),
        sessionId: sessionId,
      }),
    ).resolves.toBe(false);
  });
});

describe("Rum:ProcessSessionErasureRequests activity purge", () => {
  test("every tab of an erased session is taken off the finalizer's queue", async () => {
    const activeKey: string = getActiveSessionsKey(projectId.toString());
    const client: MockRedisClient = mockRedis.client();

    await client.zadd(activeKey, 1, `${sessionId}:tab-a`);
    await client.zadd(activeKey, 2, `${sessionId}:tab-b`);
    await client.zadd(activeKey, 3, "another-session:tab-a");

    const removed: number = await purgeErasedSessionsFromActivitySet({
      projectId: projectId.toString(),
      sessionIds: [sessionId],
    });

    expect(removed).toBe(2);
    expect(Array.from(mockRedis.zsets.get(activeKey)?.keys() || [])).toEqual([
      "another-session:tab-a",
    ]);
  });

  test("a tabId containing a colon does not confuse the sessionId prefix match", async () => {
    const activeKey: string = getActiveSessionsKey(projectId.toString());
    const client: MockRedisClient = mockRedis.client();

    await client.zadd(activeKey, 1, `${sessionId}:tab:with:colons`);

    const removed: number = await purgeErasedSessionsFromActivitySet({
      projectId: projectId.toString(),
      sessionIds: [sessionId],
    });

    expect(removed).toBe(1);
  });

  test("the purge is a no-op rather than a throw when Redis is down", async () => {
    mockRedis.connected = false;

    await expect(
      purgeErasedSessionsFromActivitySet({
        projectId: projectId.toString(),
        sessionIds: [sessionId],
      }),
    ).resolves.toBe(0);
  });
});

describe("Rum:FinalizeSessions does not resurrect erased sessions", () => {
  /* One tab, two chunks: enough for the finalizer to derive a header. */
  const tabAggregateRow: JSONObject = {
    tabId: "tab-a",
    chunkCount: 2,
    maxChunkIndex: 1,
    chunkIndexes: [0, 1],
    fullSnapshotChunkIndexes: [0],
    eventCount: 20,
    payloadBytes: 2000,
    errorCount: 0,
    rageClickCount: 0,
    deadClickCount: 0,
    errorClickCount: 0,
    refreshRageCount: 0,
    routeCount: 1,
    hasFinalChunk: 1,
    sessionStartUnixMs: new Date("2026-07-29T10:00:00.000Z").getTime(),
    lastChunkEndUnixMs: new Date("2026-07-29T10:00:30.000Z").getTime(),
    maxChunkEndOffsetMs: 30000,
    schemaVersion: 1,
    recorderKind: "dom",
    rumApplicationId: rumApplicationId.toString(),
    primaryEntityId: rumApplicationId.toString(),
    primaryEntityType: "RealUserMonitor",
    retentionDate: "2026-08-05",
  };

  const provisionalHeaderRow: JSONObject = {
    startTimeText: "2026-07-29 10:00:00.000",
    startTimeUnixMs: new Date("2026-07-29T10:00:00.000Z").getTime(),
    clientReportedStartTimeText: "2026-07-29 10:00:00.000",
    retentionDateText: "2026-08-05",
    rumApplicationId: rumApplicationId.toString(),
    primaryEntityId: rumApplicationId.toString(),
    primaryEntityType: "RealUserMonitor",
    sealedReason: "",
    triggerReason: "always",
    samplePercentageAtCapture: 100,
    clockSkewMs: 0,
    entryUrl: "https://app.example.com/login",
    exitUrl: "https://app.example.com/account",
    routes: ["/login", "/account"],
    browserName: "Chrome",
    browserVersion: "128",
    osName: "macOS",
    deviceType: "desktop",
    viewportWidth: 1440,
    viewportHeight: 900,
    maskingMode: "strict",
    consentState: "granted",
    recorderKind: "dom",
    recorderVersion: "1.0.0",
    rrwebVersion: "2.0.0",
    countryCode: "DE",
    /* The identifying payload an erasure exists to destroy. */
    identifiedUserKey: "user-42",
    identifiedUserLabel: "erasure.subject@example.com",
    traceIds: [],
    exceptionFingerprints: [],
    fidelityNotices: [],
    schemaVersion: 1,
    wireVersion: 1,
    isLegalHold: false,
    attributes: {},
    attributeKeys: [],
    entityKeys: [],
  };

  let insertedRows: Array<JSONObject> = [];

  beforeEach(() => {
    insertedRows = [];

    /*
     * readRows() runs both the tab aggregate and the provisional header
     * read through RumSessionChunkService.executeQuery, so one stub feeds
     * both. The chunk rows are deliberately STILL VISIBLE: that is the real
     * post-erasure state, because ALTER ... DELETE only rewrites the parts
     * that existed when it was submitted and the erasure job does not wait
     * for the mutation.
     */
    chunkService.executeQuery = (statement: Statement): Promise<unknown> => {
      if (statement.query.includes("GROUP BY tabId")) {
        return Promise.resolve(resultSetOf([tabAggregateRow]));
      }

      return Promise.resolve(resultSetOf([provisionalHeaderRow]));
    };

    sessionService.insertJsonRows = (
      rows: Array<JSONObject>,
    ): Promise<void> => {
      insertedRows.push(...rows);
      return Promise.resolve();
    };
  });

  test("a session that has not been erased is finalized normally", async () => {
    const outcome: FinalizeSessionOutcome = await finalizeSession({
      projectId: projectId,
      sessionId: sessionId,
      databaseName: databaseName,
    });

    expect(outcome).toBe("written");
    expect(insertedRows.length).toBe(1);
    expect(insertedRows[0]?.["identifiedUserKey"]).toBe("user-42");
  });

  test("erasing the session then running the finalizer writes NO header back", async () => {
    /* Step 1: the erasure job tombstones the session. */
    await writeErasureTombstones({
      projectId: projectId.toString(),
      sessionIds: [sessionId],
    });

    /*
     * Step 2: the finalizer runs before the ClickHouse mutation has
     * rewritten the parts, so it can still read the chunk rows.
     */
    const outcome: FinalizeSessionOutcome = await finalizeSession({
      projectId: projectId,
      sessionId: sessionId,
      databaseName: databaseName,
    });

    /*
     * Step 3: no header comes back. Before the tombstone check this wrote
     * a brand new RumSessionV1 row at version = Date.now() carrying
     * identifiedUserKey / identifiedUserLabel / entryUrl / routes /
     * countryCode for the erased subject, which the already-submitted
     * mutation would never see and nothing would ever delete again.
     */
    expect(outcome).toBe("erased");
    expect(insertedRows).toEqual([]);
  });

  test("the tombstone is checked before any chunk row is even read", async () => {
    let queriesIssued: number = 0;

    chunkService.executeQuery = (): Promise<unknown> => {
      queriesIssued++;
      return Promise.resolve(resultSetOf([tabAggregateRow]));
    };

    await writeErasureTombstones({
      projectId: projectId.toString(),
      sessionIds: [sessionId],
    });

    await finalizeSession({
      projectId: projectId,
      sessionId: sessionId,
      databaseName: databaseName,
    });

    expect(queriesIssued).toBe(0);
  });

  test("a Redis outage makes the finalizer refuse to write rather than risk a resurrection", async () => {
    mockRedis.connected = false;

    /*
     * The throw propagates to finalizeExpiredSessions' per-session catch,
     * which leaves the activity entries in place — so the session is
     * retried rather than resurrected OR silently discarded.
     */
    await expect(
      finalizeSession({
        projectId: projectId,
        sessionId: sessionId,
        databaseName: databaseName,
      }),
    ).rejects.toBeInstanceOf(ErasureTombstoneUnavailableError);

    expect(insertedRows).toEqual([]);
  });

  test("the finalized header is written with a durable async-insert ack", async () => {
    const captured: { options: JSONObject } = { options: {} };

    sessionService.insertJsonRows = (
      rows: Array<JSONObject>,
      options?: JSONObject,
    ): Promise<void> => {
      insertedRows.push(...rows);
      captured.options = options || {};
      return Promise.resolve();
    };

    await finalizeSession({
      projectId: projectId,
      sessionId: sessionId,
      databaseName: databaseName,
    });

    /*
     * The caller ZREMs the session's activity entries as soon as this
     * resolves, so an ack that only means "buffered" would silently lose
     * the header and leave the session provisional forever.
     */
    const settings: JSONObject =
      (captured.options["clickhouseSettings"] as JSONObject) || {};

    expect(settings["wait_for_async_insert"]).toBe(1);
  });
});

describe("Rum:FinalizeSessions project index reconcile", () => {
  /*
   * The mock speaks the subset of ioredis this function uses; the cast
   * keeps the test honest about that rather than pretending to be a full
   * client.
   */
  function client(): ClientType {
    return mockRedis.client() as unknown as ClientType;
  }

  test("an empty project index still reconciles when the lock is free", async () => {
    const activeKey: string = getActiveSessionsKey(projectId.toString());

    await mockRedis.client().zadd(activeKey, 1, `${sessionId}:tab-a`);

    const discovered: Array<string> = await discoverActiveProjectIds(client());

    expect(mockRedis.scanCallCount).toBe(1);
    expect(discovered).toEqual([projectId.toString()]);
    expect(
      mockRedis.sets
        .get(SESSION_REPLAY_ACTIVE_PROJECTS_KEY)
        ?.has(projectId.toString()),
    ).toBe(true);
  });

  test("an empty project index does NOT bypass the reconcile rate limit", async () => {
    /*
     * Session replay is opt-in, so on most installs the index is
     * permanently empty. Exempting that case from the lock made every
     * 5-minute run perform a full SCAN of a Redis that also holds the
     * chunk staging keys and the whole BullMQ keyspace.
     */
    const first: Array<string> = await discoverActiveProjectIds(client());
    const second: Array<string> = await discoverActiveProjectIds(client());

    expect(first).toEqual([]);
    expect(second).toEqual([]);
    expect(mockRedis.scanCallCount).toBe(1);
  });

  test("a populated index is served without a SCAN while the lock is held", async () => {
    await mockRedis
      .client()
      .sadd(SESSION_REPLAY_ACTIVE_PROJECTS_KEY, [projectId.toString()]);

    /* First call takes the lock and reconciles. */
    await discoverActiveProjectIds(client());
    const scansAfterFirst: number = mockRedis.scanCallCount;

    const second: Array<string> = await discoverActiveProjectIds(client());

    expect(second).toEqual([projectId.toString()]);
    expect(mockRedis.scanCallCount).toBe(scansAfterFirst);
  });
});

describe("Rum session activity abandon window", () => {
  /*
   * The ingest path EXPIREs replay:active:<projectId> at 6h and refreshes
   * it on every accepted chunk. An abandon window at or above that TTL
   * means Redis drops the whole ZSET before any member can cross the
   * cutoff, so CleanupStaleResources' reap (and its "recordings were lost"
   * warning) can never fire.
   */
  const INGEST_ACTIVITY_KEY_TTL_MS: number = 6 * 60 * 60 * 1000;

  test("the abandon window fits strictly inside the ingest activity key TTL", () => {
    expect(SESSION_REPLAY_ACTIVITY_ABANDON_MS).toBeLessThan(
      INGEST_ACTIVITY_KEY_TTL_MS,
    );
  });

  test("the abandon window stays clear of the finalizer's idle window", () => {
    /* Otherwise the two jobs would fight over the same members. */
    expect(SESSION_REPLAY_ACTIVITY_ABANDON_MS).toBeGreaterThan(
      SESSION_REPLAY_IDLE_FINALIZE_MS,
    );
  });
});

describe("AddSessionIdToTelemetryTables is not a no-op", () => {
  /*
   * The migration skips any table whose model does not declare the column,
   * and the runner then records the migration as executed forever. If any
   * of these three assertions fails, erasure of correlated telemetry
   * silently stops working: an erasure that removes the recording and
   * leaves the logs is not erasure.
   */
  test("Log declares the sessionId correlation column", () => {
    expect(new Log().getTableColumn("sessionId")).toBeTruthy();
  });

  test("Span declares the sessionId correlation column", () => {
    expect(new Span().getTableColumn("sessionId")).toBeTruthy();
  });

  test("ExceptionInstance declares the sessionId correlation column", () => {
    expect(new ExceptionInstance().getTableColumn("sessionId")).toBeTruthy();
  });
});

/*
 * Retry-or-fail. A right-to-erasure obligation used to die terminally on
 * the FIRST transient error — markFailed rows were never re-examined, so
 * one Redis blip mid-erasure left it half-done (tombstone written, chunk
 * table deleted, logs and spans intact) with a log line as the only
 * witness.
 */
describe("Rum:ProcessSessionErasureRequests retry-or-fail", () => {
  const buildRequest: (attempts: number) => RumSessionErasureRequest = (
    attempts: number,
  ): RumSessionErasureRequest => {
    const request: RumSessionErasureRequest = new RumSessionErasureRequest();

    request.id = new ObjectID("6600000000000000000000d4");
    request.projectId = projectId;
    request.requestType = RumSessionErasureRequestType.BySessionId;
    request.targetValue = sessionId;
    request.attempts = attempts;

    return request;
  };

  type SpiedFn = ReturnType<typeof jest.fn>;

  interface RetryHarness {
    markInProgress: SpiedFn;
    updateOneById: SpiedFn;
    markFailed: SpiedFn;
    sendEmail: SpiedFn;
  }

  const installHarness: () => RetryHarness = (): RetryHarness => {
    return {
      markInProgress: jest
        .spyOn(RumSessionErasureRequestService, "markInProgress")
        .mockResolvedValue(undefined as never) as unknown as SpiedFn,
      updateOneById: jest
        .spyOn(RumSessionErasureRequestService, "updateOneById")
        .mockResolvedValue(undefined as never) as unknown as SpiedFn,
      markFailed: jest
        .spyOn(RumSessionErasureRequestService, "markFailed")
        .mockResolvedValue(undefined as never) as unknown as SpiedFn,
      sendEmail: jest
        .spyOn(ProjectService, "sendEmailToProjectOwners")
        .mockResolvedValue(undefined as never) as unknown as SpiedFn,
    };
  };

  afterEach(() => {
    jest.restoreAllMocks();
    mockRedis.connected = true;
  });

  test("a transient failure requeues to Pending with the attempt counted, not terminal Failed", async () => {
    const harness: RetryHarness = installHarness();

    /*
     * Redis down makes the tombstone write fail CLOSED — the exact
     * transient-blip class that must not kill the request.
     */
    mockRedis.connected = false;

    await processErasureRequest({
      databaseName: databaseName,
      request: buildRequest(0),
    });

    expect(harness.updateOneById).toHaveBeenCalledTimes(1);

    const update: { data: Record<string, unknown> } = harness.updateOneById.mock
      .calls[0]![0] as never;

    expect(update.data["status"]).toBe(RumSessionErasureRequestStatus.Pending);
    expect(update.data["attempts"]).toBe(1);

    expect(harness.markFailed).not.toHaveBeenCalled();
    expect(harness.sendEmail).not.toHaveBeenCalled();
  });

  test("the final attempt marks Failed and notifies the project owners", async () => {
    const harness: RetryHarness = installHarness();

    mockRedis.connected = false;

    await processErasureRequest({
      databaseName: databaseName,
      request: buildRequest(MAX_ERASURE_ATTEMPTS - 1),
    });

    expect(harness.markFailed).toHaveBeenCalledTimes(1);

    /* The terminal attempt is recorded before the failure is announced. */
    const update: { data: Record<string, unknown> } = harness.updateOneById.mock
      .calls[0]![0] as never;
    expect(update.data["attempts"]).toBe(MAX_ERASURE_ATTEMPTS);
    expect(update.data["status"]).toBeUndefined();

    expect(harness.sendEmail).toHaveBeenCalledTimes(1);
    expect((harness.sendEmail.mock.calls[0]![0] as ObjectID).toString()).toBe(
      projectId.toString(),
    );
  });

  test("a mail failure does not throw back into the job", async () => {
    const harness: RetryHarness = installHarness();

    harness.sendEmail.mockRejectedValue(new Error("smtp down") as never);
    mockRedis.connected = false;

    await expect(
      processErasureRequest({
        databaseName: databaseName,
        request: buildRequest(MAX_ERASURE_ATTEMPTS - 1),
      }),
    ).resolves.toBeUndefined();

    expect(harness.markFailed).toHaveBeenCalledTimes(1);
  });
});

/*
 * Cadence. Daily meant a subject's request sat "Pending" for up to a day
 * with the recording still playable; the throttles that protect
 * ClickHouse are the caps and the tombstone filter, not the cadence.
 */
describe("Rum:ProcessSessionErasureRequests schedule", () => {
  test("the job is registered every 15 minutes, no longer daily", () => {
    expect(ERASURE_JOB_SCHEDULE).toBe(EVERY_FIFTEEN_MINUTE);
    expect(ERASURE_JOB_SCHEDULE).not.toBe(EVERY_DAY);

    const registration: Array<unknown> | undefined = (
      RunCron as unknown as ReturnType<typeof jest.fn>
    ).mock.calls.find((call: Array<unknown>): boolean => {
      return call[0] === "Rum:ProcessSessionErasureRequests";
    });

    expect(registration).toBeDefined();
    expect((registration![1] as { schedule: string }).schedule).toBe(
      EVERY_FIFTEEN_MINUTE,
    );
  });
});

/*
 * With runs 15 minutes apart, a session whose ALTER ... DELETE is still
 * rewriting parts is still visible to the next run's lookup. Re-erasing
 * it would double the mutation load and double-count the subject.
 */
describe("Rum:ProcessSessionErasureRequests tombstone-aware targets", () => {
  function explicitRequest(data: {
    ids: Array<string>;
    attempts?: number | undefined;
  }): RumSessionErasureRequest {
    const request: RumSessionErasureRequest = new RumSessionErasureRequest();

    request.id = new ObjectID("6600000000000000000000d4");
    request.projectId = projectId;
    request.requestType = RumSessionErasureRequestType.BySessionId;
    request.targetValue = data.ids.join(",");
    request.attempts = data.attempts || 0;

    return request;
  }

  function lookupRequest(attempts?: number): RumSessionErasureRequest {
    const request: RumSessionErasureRequest = new RumSessionErasureRequest();

    request.id = new ObjectID("6600000000000000000000d4");
    request.projectId = projectId;
    request.requestType = RumSessionErasureRequestType.ByIdentifiedUserKey;
    request.targetValue = "user-42";
    request.attempts = attempts || 0;

    return request;
  }

  function idsOf(count: number): Array<string> {
    return Array.from(
      { length: count },
      (_unused: unknown, index: number): string => {
        return `session-${index}`;
      },
    );
  }

  test("a first attempt skips sessions an earlier run already tombstoned", async () => {
    await writeErasureTombstones({
      projectId: projectId.toString(),
      sessionIds: ["session-1"],
    });

    const targets: ResolvedErasureTargets = await resolveTargetSessionIds({
      databaseName: databaseName,
      request: explicitRequest({
        ids: ["session-0", "session-1", "session-2"],
      }),
    });

    expect(targets.sessionIds).toEqual(["session-0", "session-2"]);
    expect(targets.alreadyErased).toBe(1);
    expect(targets.moreMayRemain).toBe(false);
  });

  test("a RETRY re-submits tombstoned sessions: the failed attempt may have died before its mutations", async () => {
    await writeErasureTombstones({
      projectId: projectId.toString(),
      sessionIds: ["session-1"],
    });

    const targets: ResolvedErasureTargets = await resolveTargetSessionIds({
      databaseName: databaseName,
      request: explicitRequest({
        ids: ["session-0", "session-1"],
        attempts: 1,
      }),
    });

    expect(targets.sessionIds).toEqual(["session-0", "session-1"]);
    expect(targets.alreadyErased).toBe(0);
  });

  test("an explicit list longer than one run advances past what earlier runs erased", async () => {
    /*
     * Before the filter the cap was a plain slice(0, cap), so a list of
     * more than cap ids re-erased the same first slice on every run and
     * never reached the rest.
     */
    const ids: Array<string> = idsOf(MAX_SESSION_IDS_PER_REQUEST_PER_RUN + 2);

    await writeErasureTombstones({
      projectId: projectId.toString(),
      sessionIds: ["session-0"],
    });

    const targets: ResolvedErasureTargets = await resolveTargetSessionIds({
      databaseName: databaseName,
      request: explicitRequest({ ids: ids }),
    });

    expect(targets.sessionIds.length).toBe(MAX_SESSION_IDS_PER_REQUEST_PER_RUN);
    expect(targets.sessionIds).not.toContain("session-0");
    expect(targets.sessionIds[0]).toBe("session-1");
    expect(targets.moreMayRemain).toBe(true);
  });

  test("a lookup that fills its page reports more may remain even when every row is already tombstoned", async () => {
    const ids: Array<string> = idsOf(MAX_SESSION_IDS_PER_REQUEST_PER_RUN);

    sessionService.executeQuery = (): Promise<unknown> => {
      return Promise.resolve(
        resultSetOf(
          ids.map((id: string): JSONObject => {
            return { sessionId: id };
          }),
        ),
      );
    };

    await writeErasureTombstones({
      projectId: projectId.toString(),
      sessionIds: ids,
    });

    const targets: ResolvedErasureTargets = await resolveTargetSessionIds({
      databaseName: databaseName,
      request: lookupRequest(),
    });

    /*
     * Nothing new to submit this run, but the page was full, so the
     * subject may have sessions beyond it: the request must stay Pending
     * rather than be reported complete.
     */
    expect(targets.sessionIds).toEqual([]);
    expect(targets.alreadyErased).toBe(MAX_SESSION_IDS_PER_REQUEST_PER_RUN);
    expect(targets.moreMayRemain).toBe(true);
  });

  test("a lookup that does not fill its page is the end of the subject", async () => {
    sessionService.executeQuery = (): Promise<unknown> => {
      return Promise.resolve(resultSetOf([{ sessionId: "session-0" }]));
    };

    const targets: ResolvedErasureTargets = await resolveTargetSessionIds({
      databaseName: databaseName,
      request: lookupRequest(),
    });

    expect(targets.sessionIds).toEqual(["session-0"]);
    expect(targets.moreMayRemain).toBe(false);
  });

  test("the tombstone read fails closed when Redis is down", async () => {
    mockRedis.connected = false;

    await expect(
      resolveTargetSessionIds({
        databaseName: databaseName,
        request: explicitRequest({ ids: ["session-0"] }),
      }),
    ).rejects.toThrow("Redis is not connected");
  });

  test("a request with more remaining is requeued to Pending, not marked complete", async () => {
    const ids: Array<string> = idsOf(MAX_SESSION_IDS_PER_REQUEST_PER_RUN);

    sessionService.executeQuery = (): Promise<unknown> => {
      return Promise.resolve(
        resultSetOf(
          ids.map((id: string): JSONObject => {
            return { sessionId: id };
          }),
        ),
      );
    };

    await writeErasureTombstones({
      projectId: projectId.toString(),
      sessionIds: ids,
    });

    const markInProgress: ReturnType<typeof jest.fn> = jest
      .spyOn(RumSessionErasureRequestService, "markInProgress")
      .mockResolvedValue(undefined as never) as unknown as ReturnType<
      typeof jest.fn
    >;
    const updateOneById: ReturnType<typeof jest.fn> = jest
      .spyOn(RumSessionErasureRequestService, "updateOneById")
      .mockResolvedValue(undefined as never) as unknown as ReturnType<
      typeof jest.fn
    >;
    const markCompleted: ReturnType<typeof jest.fn> = jest
      .spyOn(RumSessionErasureRequestService, "markCompleted")
      .mockResolvedValue(undefined as never) as unknown as ReturnType<
      typeof jest.fn
    >;

    try {
      await processErasureRequest({
        databaseName: databaseName,
        request: lookupRequest(),
      });

      expect(markInProgress).toHaveBeenCalledTimes(1);
      expect(markCompleted).not.toHaveBeenCalled();
      expect(updateOneById).toHaveBeenCalledTimes(1);

      const update: { data: Record<string, unknown> } = updateOneById.mock
        .calls[0]![0] as never;

      expect(update.data["status"]).toBe(
        RumSessionErasureRequestStatus.Pending,
      );
      /* No attempt is charged: waiting on a mutation is not a failure. */
      expect(update.data["attempts"]).toBeUndefined();
    } finally {
      jest.restoreAllMocks();
    }
  });
});

/*
 * Erasure must take the pin with it: a RumSessionPin row that survives
 * the recording renders as "Pinned" over a 404 and keeps the pin's reason
 * and incident link as a record of the erased subject.
 */
describe("Rum:ProcessSessionErasureRequests removes pins", () => {
  test("eraseSessionBatch deletes the sessions' pins after the mutations are queued", async () => {
    const order: Array<string> = [];

    chunkService.executeQuery = (): Promise<unknown> => {
      return Promise.resolve(resultSetOf([{ chunkCount: 7 }]));
    };

    const analyticsServices: Array<{ name: string; service: unknown }> = [
      { name: "chunks", service: RumSessionChunkService },
      { name: "headers", service: RumSessionService },
      { name: "logs", service: LogService },
      { name: "spans", service: SpanService },
      { name: "exceptions", service: ExceptionInstanceService },
    ];

    for (const entry of analyticsServices) {
      jest
        .spyOn(entry.service as { execute: () => Promise<unknown> }, "execute")
        .mockImplementation(((): Promise<unknown> => {
          order.push(entry.name);
          return Promise.resolve({});
        }) as never);
    }

    const deleteBy: ReturnType<typeof jest.fn> = jest
      .spyOn(RumSessionPinService, "deleteBy")
      .mockImplementation(((): Promise<number> => {
        order.push("pins");
        return Promise.resolve(1);
      }) as never) as unknown as ReturnType<typeof jest.fn>;

    try {
      const chunksDeleted: number = await eraseSessionBatch({
        databaseName: databaseName,
        projectId: projectId,
        sessionIds: [sessionId, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      });

      expect(chunksDeleted).toBe(7);
      expect(order).toEqual([
        "chunks",
        "headers",
        "logs",
        "spans",
        "exceptions",
        "pins",
      ]);

      const call: {
        query: { projectId: ObjectID; sessionId: unknown };
        props: { isRoot: boolean };
      } = deleteBy.mock.calls[0]![0] as never;

      expect(call.query.projectId.toString()).toBe(projectId.toString());

      /*
       * QueryHelper.any renders an IN (...) operator whose ids travel as
       * bound parameters; the serialized operator is the stable way to
       * see that every erased id is in it.
       */
      const sessionFilter: string = JSON.stringify(call.query.sessionId);

      expect(sessionFilter).toContain(sessionId);
      expect(sessionFilter).toContain("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      expect(call.props.isRoot).toBe(true);
    } finally {
      jest.restoreAllMocks();
    }
  });
});
