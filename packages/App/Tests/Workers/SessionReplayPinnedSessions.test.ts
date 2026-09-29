import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import RumSessionPin from "Common/Models/DatabaseModels/RumSessionPin";
import RumSessionPinService from "Common/Server/Services/RumSessionPinService";
import RumSessionChunkService from "Common/Server/Services/RumSessionChunkService";
import RumSessionService from "Common/Server/Services/RumSessionService";
import AnalyticsTableName from "Common/Types/AnalyticsDatabase/AnalyticsTableName";
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
 * loops and statements.
 */
jest.mock("../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

/*
 * The subset of ioredis these loops touch: the erasure tombstone (a set)
 * and the revert marker (a string with EX). Real membership semantics
 * matter here because the tombstone decides whether a copy is written.
 */
class MockRedis {
  public sets: Map<string, Set<string>> = new Map<string, Set<string>>();
  public strings: Map<string, string> = new Map<string, string>();
  public connected: boolean = true;

  public reset(): void {
    this.sets = new Map<string, Set<string>>();
    this.strings = new Map<string, string>();
    this.connected = true;
  }

  public client(): unknown {
    return {
      sadd: (key: string, members: Array<string>): Promise<number> => {
        const set: Set<string> = this.sets.get(key) || new Set<string>();

        for (const member of members) {
          set.add(member);
        }

        this.sets.set(key, set);
        return Promise.resolve(members.length);
      },
      expire: (): Promise<number> => {
        return Promise.resolve(1);
      },
      sismember: (key: string, member: string): Promise<number> => {
        return Promise.resolve(this.sets.get(key)?.has(member) ? 1 : 0);
      },
      set: (key: string, value: string): Promise<"OK"> => {
        this.strings.set(key, value);
        return Promise.resolve("OK");
      },
      exists: (key: string): Promise<number> => {
        return Promise.resolve(this.strings.has(key) ? 1 : 0);
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

import {
  buildChunkCopyStatement,
  buildHeaderRetentionRevertStatement,
  buildPinnedSessionsStatement,
  getRevertedPinMarkerKey,
  HeaderState,
  isPinLapsed,
  MaterializeRunSummary,
  materializePinnedSessions,
  PINNED_DEFAULT_RETENTION_DAYS,
  ReconcileRunSummary,
  reconcilePinnedCopies,
  revertPinnedSession,
} from "../../FeatureSet/Workers/Jobs/Rum/MaterializePinnedSessions";
import { writeErasureTombstones } from "Common/Server/Utils/SessionReplay/SessionReplayErasureTombstone";

const projectId: ObjectID = new ObjectID("6600000000000000000000a1");
const rumApplicationId: ObjectID = new ObjectID("6600000000000000000000b2");
const pinId: ObjectID = new ObjectID("6600000000000000000000d4");
const sessionId: string = "1f0c9a4b6d2e47f8a1b3c5d7e9f00112";
const databaseName: string = "oneuptime";

/* "YYYY-MM-DD HH:mm:ss", the shape a bound ClickHouse DateTime takes. */
const CLICKHOUSE_DATE_TIME: RegExp = new RegExp("^\\d{4}-\\d{2}-\\d{2} ");

/*
 * What ClickHouse "contains" for the session under test. The service
 * stubs answer each statement from this state by recognising the
 * statement's shape, so a test describes a situation rather than a
 * sequence of canned replies.
 */
interface ClickhouseState {
  headerState: HeaderState;
  retainedChunkCount: number;
  originalChunkCount: number;
  originalRetentionDate: string;
  pinnedSessions: Array<JSONObject>;
  failingStatement: ((statement: Statement) => boolean) | null;
}

const state: ClickhouseState = {
  headerState: "finalized",
  retainedChunkCount: 3,
  originalChunkCount: 3,
  originalRetentionDate: "2026-08-05",
  pinnedSessions: [],
  failingStatement: null,
};

function resultSetOf(rows: Array<JSONObject>): unknown {
  return {
    json: (): Promise<{ data: Array<JSONObject> }> => {
      return Promise.resolve({ data: rows });
    },
  };
}

function answerQuery(statement: Statement): Promise<unknown> {
  const query: string = statement.query;

  if (query.includes("toUInt8(isFinalized) AS isFinalized")) {
    if (state.headerState === "missing") {
      return Promise.resolve(resultSetOf([]));
    }

    return Promise.resolve(
      resultSetOf([{ isFinalized: state.headerState === "finalized" ? 1 : 0 }]),
    );
  }

  if (query.includes("toString(max(retentionDate)) AS retentionDate")) {
    return Promise.resolve(
      resultSetOf([
        {
          chunkCount: state.originalChunkCount,
          retentionDate:
            state.originalChunkCount > 0 ? state.originalRetentionDate : "",
        },
      ]),
    );
  }

  if (query.includes("count() AS chunkCount")) {
    return Promise.resolve(
      resultSetOf([{ chunkCount: state.retainedChunkCount }]),
    );
  }

  if (query.includes("GROUP BY projectId, rumApplicationId, sessionId")) {
    return Promise.resolve(resultSetOf(state.pinnedSessions));
  }

  throw new Error(`Unexpected query in test: ${query}`);
}

/* Every write submitted to ClickHouse, in order, across both services. */
let executed: Array<Statement> = [];

function recordExecute(statement: Statement | string): Promise<unknown> {
  if (typeof statement === "string") {
    throw new Error("The job never submits raw SQL strings");
  }

  if (state.failingStatement && state.failingStatement(statement)) {
    return Promise.reject(new Error("ClickHouse is unavailable"));
  }

  executed.push(statement);
  return Promise.resolve({});
}

function isChunkCopy(statement: Statement): boolean {
  return (
    statement.query.includes("INSERT INTO") &&
    statement.query.includes("true AS isPinnedCopy") &&
    statement.query.includes("LIMIT 1 BY tabId, chunkIndex")
  );
}

function isHeaderCopy(statement: Statement): boolean {
  return (
    statement.query.includes("INSERT INTO") &&
    statement.query.includes("true AS isPinnedCopy") &&
    !statement.query.includes("LIMIT 1 BY")
  );
}

function isHeaderRevert(statement: Statement): boolean {
  return (
    statement.query.includes("INSERT INTO") &&
    statement.query.includes("false AS isPinnedCopy")
  );
}

function isPinnedCopyDelete(statement: Statement): boolean {
  return (
    statement.query.includes("DELETE WHERE") &&
    statement.query.includes("isPinnedCopy = true")
  );
}

function isFullSessionDelete(statement: Statement): boolean {
  return (
    statement.query.includes("DELETE WHERE") &&
    !statement.query.includes("isPinnedCopy")
  );
}

function boundTable(statement: Statement): string {
  const bound: Array<unknown> = Object.values(statement.query_params);

  if (bound.includes(`${AnalyticsTableName.RumSessionChunk}Local`)) {
    return AnalyticsTableName.RumSessionChunk;
  }

  if (bound.includes(`${AnalyticsTableName.RumSession}Local`)) {
    return AnalyticsTableName.RumSession;
  }

  return bound.includes(AnalyticsTableName.RumSessionChunk)
    ? AnalyticsTableName.RumSessionChunk
    : AnalyticsTableName.RumSession;
}

function makePin(data?: {
  expiresAt?: Date | undefined;
  materializedAt?: Date | undefined;
}): RumSessionPin {
  const pin: RumSessionPin = new RumSessionPin();

  pin.id = pinId;
  pin.projectId = projectId;
  pin.rumApplicationId = rumApplicationId;
  pin.sessionId = sessionId;

  if (data?.expiresAt) {
    pin.expiresAt = data.expiresAt;
  }

  if (data?.materializedAt) {
    pin.materializedAt = data.materializedAt;
  }

  return pin;
}

type SpiedFn = ReturnType<typeof jest.fn>;

interface PinServiceHarness {
  getUnmaterializedPins: SpiedFn;
  markMaterialized: SpiedFn;
  deleteOneById: SpiedFn;
  findBy: SpiedFn;
}

function installPinService(data: {
  unmaterialized: Array<RumSessionPin>;
  lapsed: Array<RumSessionPin>;
  live: Array<RumSessionPin>;
}): PinServiceHarness {
  return {
    getUnmaterializedPins: jest
      .spyOn(RumSessionPinService, "getUnmaterializedPins")
      .mockResolvedValue(data.unmaterialized as never) as unknown as SpiedFn,
    markMaterialized: jest
      .spyOn(RumSessionPinService, "markMaterialized")
      .mockResolvedValue(undefined as never) as unknown as SpiedFn,
    deleteOneById: jest
      .spyOn(RumSessionPinService, "deleteOneById")
      .mockResolvedValue(1 as never) as unknown as SpiedFn,
    findBy: jest
      .spyOn(RumSessionPinService, "findBy")
      .mockImplementation(((findBy: {
        query: Record<string, unknown>;
      }): Promise<Array<RumSessionPin>> => {
        /*
         * The reconcile issues two shapes of lookup: the lapsed sweep
         * (by expiresAt) and the per-project membership check (by
         * sessionId list). Answer each from its own fixture.
         */
        if (findBy.query["expiresAt"]) {
          return Promise.resolve(data.lapsed);
        }

        return Promise.resolve(data.live);
      }) as never) as unknown as SpiedFn,
  };
}

const pinnedSessionRow: JSONObject = {
  projectId: projectId.toString(),
  rumApplicationId: rumApplicationId.toString(),
  sessionId: sessionId,
};

beforeEach(() => {
  mockRedis.reset();
  executed = [];

  state.headerState = "finalized";
  state.retainedChunkCount = 3;
  state.originalChunkCount = 3;
  state.originalRetentionDate = "2026-08-05";
  state.pinnedSessions = [];
  state.failingStatement = null;

  jest
    .spyOn(RumSessionChunkService, "executeQuery")
    .mockImplementation(answerQuery as never);
  jest
    .spyOn(RumSessionService, "executeQuery")
    .mockImplementation(answerQuery as never);
  jest
    .spyOn(RumSessionChunkService, "execute")
    .mockImplementation(recordExecute as never);
  jest
    .spyOn(RumSessionService, "execute")
    .mockImplementation(recordExecute as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("isPinLapsed", () => {
  const now: Date = new Date("2026-07-30T12:00:00.000Z");

  test("a pin without an expiry never lapses", () => {
    expect(isPinLapsed(makePin(), now)).toBe(false);
  });

  test("a future expiry is live, a past or present one has lapsed", () => {
    expect(
      isPinLapsed(makePin({ expiresAt: new Date("2027-01-01") }), now),
    ).toBe(false);
    expect(
      isPinLapsed(makePin({ expiresAt: new Date("2020-01-01") }), now),
    ).toBe(true);
    expect(isPinLapsed(makePin({ expiresAt: now }), now)).toBe(true);
  });
});

describe("Rum:MaterializePinnedSessions loop", () => {
  test("a finalized session with chunks is copied chunks-first, header-second, then marked", async () => {
    const harness: PinServiceHarness = installPinService({
      unmaterialized: [makePin()],
      lapsed: [],
      live: [],
    });

    const summary: MaterializeRunSummary = await materializePinnedSessions();

    expect(summary.materialized).toBe(1);
    expect(summary.failed).toBe(0);

    expect(executed.length).toBe(2);
    expect(isChunkCopy(executed[0]!)).toBe(true);
    expect(isHeaderCopy(executed[1]!)).toBe(true);

    /* Both copies share one version so the engine collapses them together. */
    const chunkVersion: unknown = Object.values(executed[0]!.query_params).find(
      (value: unknown): boolean => {
        return typeof value === "number" && value > 1_000_000_000_000;
      },
    );
    expect(Object.values(executed[1]!.query_params)).toContain(chunkVersion);

    expect(harness.markMaterialized).toHaveBeenCalledTimes(1);
    expect(harness.deleteOneById).not.toHaveBeenCalled();
  });

  test("a pin whose expiresAt already passed is removed, not materialized for two years", async () => {
    /*
     * "Keep for three days" reaching the worker on day four used to fall
     * through to the 730-day default — the opposite of what was asked.
     */
    const harness: PinServiceHarness = installPinService({
      unmaterialized: [makePin({ expiresAt: new Date("2020-01-01") })],
      lapsed: [],
      live: [],
    });

    const summary: MaterializeRunSummary = await materializePinnedSessions();

    expect(summary.lapsedPinsRemoved).toBe(1);
    expect(summary.materialized).toBe(0);
    expect(executed).toEqual([]);
    expect(harness.markMaterialized).not.toHaveBeenCalled();
    expect(harness.deleteOneById).toHaveBeenCalledTimes(1);
  });

  test("a still-recording session is deferred: no copy, no mark, pin kept for the next run", async () => {
    state.headerState = "provisional";

    const harness: PinServiceHarness = installPinService({
      unmaterialized: [makePin()],
      lapsed: [],
      live: [],
    });

    const summary: MaterializeRunSummary = await materializePinnedSessions();

    /*
     * A copy taken mid-recording protects only the first minutes and is
     * never topped up by this job; waiting for the finalized header is
     * what makes "Pinned" mean the whole recording.
     */
    expect(summary.deferred).toBe(1);
    expect(summary.materialized).toBe(0);
    expect(executed).toEqual([]);
    expect(harness.markMaterialized).not.toHaveBeenCalled();
    expect(harness.deleteOneById).not.toHaveBeenCalled();
  });

  test("a session with no retained header gets its pin removed instead of a false 'protected'", async () => {
    state.headerState = "missing";

    const harness: PinServiceHarness = installPinService({
      unmaterialized: [makePin()],
      lapsed: [],
      live: [],
    });

    const summary: MaterializeRunSummary = await materializePinnedSessions();

    expect(summary.emptyPinsRemoved).toBe(1);
    expect(executed).toEqual([]);
    expect(harness.markMaterialized).not.toHaveBeenCalled();
    expect(harness.deleteOneById).toHaveBeenCalledTimes(1);
  });

  test("a finalized session whose chunks all expired is never marked materialized", async () => {
    state.retainedChunkCount = 0;

    const harness: PinServiceHarness = installPinService({
      unmaterialized: [makePin()],
      lapsed: [],
      live: [],
    });

    const summary: MaterializeRunSummary = await materializePinnedSessions();

    /* Two INSERT ... SELECTs that copy zero rows are not protection. */
    expect(summary.emptyPinsRemoved).toBe(1);
    expect(executed).toEqual([]);
    expect(harness.markMaterialized).not.toHaveBeenCalled();
    expect(harness.deleteOneById).toHaveBeenCalledTimes(1);
  });

  test("a pin on an erased session is removed before anything is copied", async () => {
    await writeErasureTombstones({
      projectId: projectId.toString(),
      sessionIds: [sessionId],
    });

    const harness: PinServiceHarness = installPinService({
      unmaterialized: [makePin()],
      lapsed: [],
      live: [],
    });

    const summary: MaterializeRunSummary = await materializePinnedSessions();

    expect(summary.erasedPinsRemoved).toBe(1);
    expect(executed).toEqual([]);
    expect(harness.deleteOneById).toHaveBeenCalledTimes(1);
    expect(harness.markMaterialized).not.toHaveBeenCalled();
  });

  test("an erasure that lands during the copy deletes the copies and the pin, and never marks", async () => {
    let copies: number = 0;

    /* The tombstone appears the moment the header copy is submitted. */
    jest.spyOn(RumSessionService, "execute").mockImplementation((async (
      statement: Statement,
    ): Promise<unknown> => {
      copies++;
      await writeErasureTombstones({
        projectId: projectId.toString(),
        sessionIds: [sessionId],
      });
      return recordExecute(statement);
    }) as never);

    const harness: PinServiceHarness = installPinService({
      unmaterialized: [makePin()],
      lapsed: [],
      live: [],
    });

    const summary: MaterializeRunSummary = await materializePinnedSessions();

    expect(copies).toBe(1);
    expect(summary.erasedPinsRemoved).toBe(1);
    expect(summary.materialized).toBe(0);

    const deletes: Array<Statement> = executed.filter(isFullSessionDelete);

    expect(deletes.length).toBe(2);
    expect(deletes.map(boundTable)).toEqual([
      AnalyticsTableName.RumSessionChunk,
      AnalyticsTableName.RumSession,
    ]);
    expect(harness.deleteOneById).toHaveBeenCalledTimes(1);
    expect(harness.markMaterialized).not.toHaveBeenCalled();
  });

  test("a ClickHouse failure leaves the pin unmaterialized for a retry and never marks it", async () => {
    state.failingStatement = isHeaderCopy;

    const harness: PinServiceHarness = installPinService({
      unmaterialized: [makePin()],
      lapsed: [],
      live: [],
    });

    const summary: MaterializeRunSummary = await materializePinnedSessions();

    expect(summary.failed).toBe(1);
    expect(summary.materialized).toBe(0);
    expect(harness.markMaterialized).not.toHaveBeenCalled();
    expect(harness.deleteOneById).not.toHaveBeenCalled();
  });

  test("a Redis outage fails closed: the pin is retried, not materialized", async () => {
    mockRedis.connected = false;

    const harness: PinServiceHarness = installPinService({
      unmaterialized: [makePin()],
      lapsed: [],
      live: [],
    });

    const summary: MaterializeRunSummary = await materializePinnedSessions();

    expect(summary.failed).toBe(1);
    expect(executed).toEqual([]);
    expect(harness.markMaterialized).not.toHaveBeenCalled();
  });

  test("the chunk copy skips chunks that already have a pinned copy", () => {
    const statement: Statement = buildChunkCopyStatement({
      databaseName: databaseName,
      projectId: projectId,
      rumApplicationId: rumApplicationId,
      sessionId: sessionId,
      versionUnixMs: 1_800_000_000_000,
      retentionDate: new Date("2028-07-30T00:00:00.000Z"),
    });

    /*
     * This is what turns the copy into a top-up: a re-run after a crash,
     * or the hourly reconcile of a session that kept recording after its
     * pin, copies only what is new.
     */
    expect(statement.query).toContain("(tabId, chunkIndex) NOT IN");
    expect(statement.query).toContain("isPinnedCopy = true");
    expect(statement.query).toContain("isPinnedCopy = false");
  });
});

describe("Rum:ReconcilePinnedCopies", () => {
  test("copies without a pin are reverted to ordinary retention and deleted", async () => {
    state.pinnedSessions = [pinnedSessionRow];

    installPinService({ unmaterialized: [], lapsed: [], live: [] });

    const summary: ReconcileRunSummary = await reconcilePinnedCopies();

    expect(summary.unpinned).toBe(1);
    expect(summary.failed).toBe(0);

    /*
     * Header version first so the far-future header is never the winner
     * once the copies are gone, then the pinned copies are ALTER-deleted
     * from both tables with the erasure job's own statement shape.
     */
    expect(executed.length).toBe(3);
    expect(isHeaderRevert(executed[0]!)).toBe(true);
    expect(Object.values(executed[0]!.query_params)).toContain("2026-08-05");

    expect(isPinnedCopyDelete(executed[1]!)).toBe(true);
    expect(isPinnedCopyDelete(executed[2]!)).toBe(true);
    expect([executed[1]!, executed[2]!].map(boundTable)).toEqual([
      AnalyticsTableName.RumSessionChunk,
      AnalyticsTableName.RumSession,
    ]);

    /* Ordinary rows are untouched: only the pinned copies are deleted. */
    expect(executed.filter(isFullSessionDelete)).toEqual([]);

    expect(
      mockRedis.strings.has(
        getRevertedPinMarkerKey({
          projectId: projectId.toString(),
          sessionId: sessionId,
        }),
      ),
    ).toBe(true);
  });

  test("a session reverted on the previous run is not reverted again while its mutation drains", async () => {
    state.pinnedSessions = [pinnedSessionRow];
    mockRedis.strings.set(
      getRevertedPinMarkerKey({
        projectId: projectId.toString(),
        sessionId: sessionId,
      }),
      "1",
    );

    installPinService({ unmaterialized: [], lapsed: [], live: [] });

    const summary: ReconcileRunSummary = await reconcilePinnedCopies();

    expect(summary.unpinned).toBe(0);
    expect(executed).toEqual([]);
  });

  test("a live, materialized pin is topped up with new chunks and nothing is reverted", async () => {
    state.pinnedSessions = [pinnedSessionRow];

    const harness: PinServiceHarness = installPinService({
      unmaterialized: [],
      lapsed: [],
      live: [makePin({ materializedAt: new Date("2026-07-29T10:00:00Z") })],
    });

    const summary: ReconcileRunSummary = await reconcilePinnedCopies();

    expect(summary.toppedUp).toBe(1);
    expect(summary.unpinned).toBe(0);
    expect(executed.length).toBe(1);
    expect(isChunkCopy(executed[0]!)).toBe(true);
    expect(harness.deleteOneById).not.toHaveBeenCalled();
  });

  test("a live pin that is not yet materialized is left to the 5-minute job", async () => {
    state.pinnedSessions = [pinnedSessionRow];

    installPinService({
      unmaterialized: [],
      lapsed: [],
      live: [makePin()],
    });

    const summary: ReconcileRunSummary = await reconcilePinnedCopies();

    expect(summary.toppedUp).toBe(0);
    expect(summary.unpinned).toBe(0);
    expect(executed).toEqual([]);
  });

  test("a materialized pin whose expiresAt passed is reverted and the pin row removed", async () => {
    state.pinnedSessions = [pinnedSessionRow];

    const harness: PinServiceHarness = installPinService({
      unmaterialized: [],
      lapsed: [],
      live: [
        makePin({
          expiresAt: new Date("2020-01-01"),
          materializedAt: new Date("2019-12-01"),
        }),
      ],
    });

    const summary: ReconcileRunSummary = await reconcilePinnedCopies();

    expect(summary.lapsed).toBe(1);
    expect(executed.filter(isHeaderRevert).length).toBe(1);
    expect(executed.filter(isPinnedCopyDelete).length).toBe(2);
    expect(harness.deleteOneById).toHaveBeenCalledTimes(1);
  });

  test("lapsed pins are also found from Postgres when their copies already TTL-expired", async () => {
    /*
     * A lapsed pin's copies carry expiresAt as their retentionDate, so
     * the ClickHouse enumeration no longer sees them; the pin row would
     * sit in Postgres forever, still reading as "Pinned".
     */
    const harness: PinServiceHarness = installPinService({
      unmaterialized: [],
      lapsed: [
        makePin({
          expiresAt: new Date("2020-01-01"),
          materializedAt: new Date("2019-12-01"),
        }),
      ],
      live: [],
    });

    const summary: ReconcileRunSummary = await reconcilePinnedCopies();

    expect(summary.lapsed).toBe(1);
    expect(harness.deleteOneById).toHaveBeenCalledTimes(1);
    expect(executed.filter(isPinnedCopyDelete).length).toBe(2);
  });

  test("copies of an erased session are left to the erasure mutation, never rewritten", async () => {
    state.pinnedSessions = [pinnedSessionRow];

    await writeErasureTombstones({
      projectId: projectId.toString(),
      sessionIds: [sessionId],
    });

    installPinService({ unmaterialized: [], lapsed: [], live: [] });

    const summary: ReconcileRunSummary = await reconcilePinnedCopies();

    /*
     * A header version written here would resurrect the subject's
     * identifying columns in a part the in-flight erasure mutation will
     * never see.
     */
    expect(summary.skippedErased).toBe(1);
    expect(summary.unpinned).toBe(0);
    expect(executed).toEqual([]);
  });

  test("when the pin lookup fails the project is skipped rather than treated as unpinned", async () => {
    state.pinnedSessions = [pinnedSessionRow];

    installPinService({ unmaterialized: [], lapsed: [], live: [] });
    jest.spyOn(RumSessionPinService, "findBy").mockImplementation(((findBy: {
      query: Record<string, unknown>;
    }): Promise<Array<RumSessionPin>> => {
      if (findBy.query["expiresAt"]) {
        return Promise.resolve([]);
      }

      return Promise.reject(new Error("postgres down"));
    }) as never);

    const summary: ReconcileRunSummary = await reconcilePinnedCopies();

    expect(summary.failed).toBe(1);
    expect(summary.unpinned).toBe(0);
    expect(executed).toEqual([]);
  });

  test("a revert on a session past ordinary retention hands the header a past date", async () => {
    state.originalChunkCount = 0;

    await revertPinnedSession({
      databaseName: databaseName,
      projectId: projectId,
      rumApplicationId: rumApplicationId,
      sessionId: sessionId,
    });

    const revert: Statement | undefined = executed.find(isHeaderRevert);

    expect(revert).toBeDefined();

    const boundText: string | undefined = Object.values(
      revert!.query_params,
    ).find((value: unknown): boolean => {
      return typeof value === "string" && CLICKHOUSE_DATE_TIME.test(value);
    }) as string | undefined;

    expect(boundText).toBeDefined();
    expect(OneUptimeDate.fromString(boundText!).getTime()).toBeLessThan(
      Date.now(),
    );
  });

  test("the revert header version is an ordinary row, not another pinned copy", () => {
    const statement: Statement = buildHeaderRetentionRevertStatement({
      databaseName: databaseName,
      projectId: projectId,
      rumApplicationId: rumApplicationId,
      sessionId: sessionId,
      versionUnixMs: 1_800_000_000_000,
      retentionDateText: "2026-08-05",
    });

    expect(statement.query).toContain("false AS isPinnedCopy");
    expect(statement.query).toContain("toDate(");
    expect(statement.query).toContain(":UInt64}");
    /* The winner is copied whatever its retention, so no now() filter. */
    expect(statement.query).not.toContain("retentionDate >= now()");
    expect(Object.values(statement.query_params)).toContain("2026-08-05");
  });

  test("the enumeration lists only live pinned copies, bounded", () => {
    const statement: Statement = buildPinnedSessionsStatement({
      databaseName: databaseName,
      limit: 500,
    });

    expect(statement.query).toContain("isPinnedCopy = true");
    expect(statement.query).toContain("retentionDate >= now()");
    expect(statement.query).toContain(
      "GROUP BY projectId, rumApplicationId, sessionId",
    );
    expect(Object.values(statement.query_params)).toContain(500);
  });

  test("the default pinned retention stays two years", () => {
    expect(PINNED_DEFAULT_RETENTION_DAYS).toBe(730);
  });
});
