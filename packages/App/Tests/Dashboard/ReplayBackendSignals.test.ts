import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";

/*
 * ReplayBackendSignals imports AnalyticsModelAPI, which transitively loads
 * Common/UI/Config - that reads `window` at import time and throws in this
 * node environment. Mocking it keeps the import graph browser-free and
 * doubles as the seam for the "default fetcher delegates" test.
 */
jest.mock("Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

import ModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import {
  REPLAY_BACKEND_SIGNALS_ROW_LIMIT,
  ReplayBackendSignalKind,
  ReplayBackendSignalsSlot,
  ReplaySignal,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignalTypes";
import {
  REPLAY_BACKEND_RECORDING_RELOAD_DEBOUNCE_MS,
  REPLAY_BACKEND_SESSION_TRACE_IDS_LIMIT,
  REPLAY_BACKEND_SIGNALS_LIVE_REFRESH_MS,
  REPLAY_BACKEND_SIGNALS_WINDOW_PADDING_MS,
  REPLAY_BACKEND_SIGNAL_PERMISSIONS,
  REPLAY_BACKEND_TRACE_IDS_CAP,
  ReplayBackendListFetcher,
  ReplayBackendListRequest,
  ReplayBackendMergedRows,
  ReplayBackendSignalsSnapshot,
  ReplayBackendSignalsStore,
  backendRowIdKey,
  backendSpanRowKey,
  buildBackendExceptionsRequest,
  buildBackendLogsRequest,
  buildBackendSignalsWindow,
  buildBackendSpansRequest,
  buildSessionTraceIdsRequest,
  classifyBackendSignalsFailure,
  isBackendListTruncated,
  isBackendRefreshDue,
  makeIdleBackendSignalsState,
  mergeBackendRows,
  normalizeReplayTraceIds,
  recordingTraceIdsFromSignals,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplayBackendSignals";

/*
 * The backend tabs read through the ordinary model APIs; what matters is
 * that each read is scoped to the session and its padded window, selects
 * only what the rail renders, caps at the row limit and flags truncation,
 * and that a stale response can never overwrite a fresher one.
 */

const START_UNIX_MS: number = 1_700_000_000_000;
const END_UNIX_MS: number = START_UNIX_MS + 10 * 60 * 1000;
const WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date(START_UNIX_MS),
  new Date(END_UNIX_MS),
);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function defer<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {};
  let reject: (error: unknown) => void = (): void => {};
  const promise: Promise<T> = new Promise<T>(
    (res: (value: T) => void, rej: (error: unknown) => void): void => {
      resolve = res;
      reject = rej;
    },
  );

  return { promise, resolve, reject };
}

function listResult<T extends AnalyticsBaseModel>(
  data: Array<T>,
  extra?: Partial<ListResult<T>>,
): ListResult<T> {
  return {
    data: data,
    count: data.length,
    skip: 0,
    limit: REPLAY_BACKEND_SIGNALS_ROW_LIMIT,
    ...extra,
  };
}

function makeLogs(count: number): Array<Log> {
  const rows: Array<Log> = [];

  for (let i: number = 0; i < count; i++) {
    const row: Log = new Log();

    row.body = `line ${i}`;
    rows.push(row);
  }

  return rows;
}

/* A valid, distinct W3C trace id per n >= 1. */
function traceIdOf(n: number): string {
  return n.toString(16).padStart(32, "0");
}

/* The rows the grouped span read returns: one traceId per row. */
function traceIdRows(traceIds: Array<string>): Array<Span> {
  return traceIds.map((traceId: string): Span => {
    const row: Span = new Span();

    row.traceId = traceId;

    return row;
  });
}

function isTraceIdRead(
  request: ReplayBackendListRequest<AnalyticsBaseModel>,
): boolean {
  return request.groupBy !== undefined;
}

/*
 * A fetcher whose every row read returns a controllable promise, in order.
 * The grouped session trace-id read (the only request with a groupBy) goes
 * to its own channel so row-read indexes stay what they were before it
 * existed: by default it answers at once with `sessionTraceIds` (or fails
 * with `traceIdFailure`); `holdTraceIdReads` makes it deferred as well.
 */
class FakeFetcher {
  public readonly requests: Array<
    ReplayBackendListRequest<AnalyticsBaseModel>
  > = [];
  public readonly deferreds: Array<Deferred<ListResult<AnalyticsBaseModel>>> =
    [];
  public readonly traceIdRequests: Array<
    ReplayBackendListRequest<AnalyticsBaseModel>
  > = [];
  public readonly traceIdDeferreds: Array<
    Deferred<ListResult<AnalyticsBaseModel>>
  > = [];
  public sessionTraceIds: Array<string> = [];
  public traceIdFailure: unknown = undefined;
  public holdTraceIdReads: boolean = false;

  public readonly fetchList: ReplayBackendListFetcher = <
    T extends AnalyticsBaseModel,
  >(
    request: ReplayBackendListRequest<T>,
  ): Promise<ListResult<T>> => {
    const generic: ReplayBackendListRequest<AnalyticsBaseModel> =
      request as ReplayBackendListRequest<AnalyticsBaseModel>;

    if (isTraceIdRead(generic)) {
      this.traceIdRequests.push(generic);

      if (this.holdTraceIdReads) {
        const held: Deferred<ListResult<AnalyticsBaseModel>> =
          defer<ListResult<AnalyticsBaseModel>>();

        this.traceIdDeferreds.push(held);

        return held.promise as Promise<ListResult<T>>;
      }

      if (this.traceIdFailure !== undefined) {
        return Promise.reject(this.traceIdFailure);
      }

      return Promise.resolve(
        listResult(
          traceIdRows(this.sessionTraceIds),
        ) as unknown as ListResult<T>,
      );
    }

    const deferred: Deferred<ListResult<AnalyticsBaseModel>> =
      defer<ListResult<AnalyticsBaseModel>>();

    this.requests.push(generic);
    this.deferreds.push(deferred);

    return deferred.promise as Promise<ListResult<T>>;
  };

  public resolve(index: number, result: ListResult<AnalyticsBaseModel>): void {
    (this.deferreds[index] as Deferred<ListResult<AnalyticsBaseModel>>).resolve(
      result,
    );
  }

  public reject(index: number, error: unknown): void {
    (this.deferreds[index] as Deferred<ListResult<AnalyticsBaseModel>>).reject(
      error,
    );
  }

  public resolveTraceIds(index: number, traceIds: Array<string>): void {
    (
      this.traceIdDeferreds[index] as Deferred<ListResult<AnalyticsBaseModel>>
    ).resolve(listResult(traceIdRows(traceIds)));
  }

  public rejectTraceIds(index: number, error: unknown): void {
    (
      this.traceIdDeferreds[index] as Deferred<ListResult<AnalyticsBaseModel>>
    ).reject(error);
  }
}

function makeStore(args?: {
  fetcher?: FakeFetcher;
  isFinalized?: boolean;
  endTimeUnixMs?: number | null;
  now?: () => number;
  traceIds?: Array<string>;
}): { store: ReplayBackendSignalsStore; fetcher: FakeFetcher } {
  const fetcher: FakeFetcher = args?.fetcher || new FakeFetcher();
  const store: ReplayBackendSignalsStore = new ReplayBackendSignalsStore({
    sessionId: "sess-1",
    startTimeUnixMs: START_UNIX_MS,
    endTimeUnixMs:
      args?.endTimeUnixMs === undefined ? END_UNIX_MS : args.endTimeUnixMs,
    isFinalized: args?.isFinalized ?? true,
    now: args?.now,
    fetchList: fetcher.fetchList,
    traceIds: args?.traceIds,
  });

  return { store, fetcher };
}

/* Let the store's awaited fetch settle and its continuation run. */
async function flush(): Promise<void> {
  for (let i: number = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

describe("buildBackendSignalsWindow", () => {
  test("pads both ends of a finalized session", () => {
    const window: InBetween<Date> = buildBackendSignalsWindow({
      startTimeUnixMs: START_UNIX_MS,
      endTimeUnixMs: END_UNIX_MS,
      nowUnixMs: END_UNIX_MS + 99_999_999,
    });

    expect(window.startValue.getTime()).toBe(
      START_UNIX_MS - REPLAY_BACKEND_SIGNALS_WINDOW_PADDING_MS,
    );
    expect(window.endValue.getTime()).toBe(
      END_UNIX_MS + REPLAY_BACKEND_SIGNALS_WINDOW_PADDING_MS,
    );
  });

  test("uses now as the end of a live session and never inverts", () => {
    const now: number = START_UNIX_MS + 30_000;
    const live: InBetween<Date> = buildBackendSignalsWindow({
      startTimeUnixMs: START_UNIX_MS,
      endTimeUnixMs: null,
      nowUnixMs: now,
      paddingMs: 1_000,
    });
    const inverted: InBetween<Date> = buildBackendSignalsWindow({
      startTimeUnixMs: START_UNIX_MS,
      endTimeUnixMs: START_UNIX_MS - 5_000,
      nowUnixMs: now,
      paddingMs: 1_000,
    });

    expect(live.endValue.getTime()).toBe(now + 1_000);
    expect(inverted.startValue.getTime()).toBe(START_UNIX_MS - 1_000);
    expect(inverted.endValue.getTime()).toBe(START_UNIX_MS + 1_000);
  });
});

describe("request shapes", () => {
  test("logs: sessionId + padded time window, the rail's columns, time ascending, limit 500", () => {
    const request: ReplayBackendListRequest<Log> = buildBackendLogsRequest({
      sessionId: "sess-1",
      window: WINDOW,
    });

    expect(request.modelType).toBe(Log);
    expect(request.query).toEqual({ sessionId: "sess-1", time: WINDOW });
    expect(Object.keys(request.select).sort()).toEqual(
      [
        "_id",
        "time",
        "severityText",
        "severityNumber",
        "body",
        "primaryEntityId",
        "primaryEntityType",
        "traceId",
        "spanId",
      ].sort(),
    );
    expect(request.sort).toEqual({ time: SortOrder.Ascending });
    expect(request.limit).toBe(REPLAY_BACKEND_SIGNALS_ROW_LIMIT);
    expect(request.limit).toBe(500);
    expect(request.skip).toBe(0);
  });

  test("spans: sessionId + startTime window, waterfall columns, startTime ascending, limit 500", () => {
    const request: ReplayBackendListRequest<Span> = buildBackendSpansRequest({
      sessionId: "sess-1",
      window: WINDOW,
    });

    expect(request.modelType).toBe(Span);
    expect(request.query).toEqual({ sessionId: "sess-1", startTime: WINDOW });
    expect(Object.keys(request.select).sort()).toEqual(
      [
        "_id",
        "traceId",
        "spanId",
        "parentSpanId",
        "name",
        "kind",
        "startTime",
        "durationUnixNano",
        "statusCode",
        "statusMessage",
        "primaryEntityId",
        "primaryEntityType",
      ].sort(),
    );
    expect(request.sort).toEqual({ startTime: SortOrder.Ascending });
    expect(request.limit).toBe(500);
    expect(request.skip).toBe(0);
  });

  test("exceptions: sessionId + time window, group/instance columns incl. stack, limit 500", () => {
    const request: ReplayBackendListRequest<ExceptionInstance> =
      buildBackendExceptionsRequest({ sessionId: "sess-1", window: WINDOW });

    expect(request.modelType).toBe(ExceptionInstance);
    expect(request.query).toEqual({ sessionId: "sess-1", time: WINDOW });
    expect(Object.keys(request.select).sort()).toEqual(
      [
        "_id",
        "time",
        "fingerprint",
        "message",
        "exceptionType",
        "stackTrace",
        "spanName",
        "traceId",
        "spanId",
        "primaryEntityId",
        "primaryEntityType",
      ].sort(),
    );
    expect(request.sort).toEqual({ time: SortOrder.Ascending });
    expect(request.limit).toBe(500);
  });

  test("never selects a log body-sized column it does not render (attributes)", () => {
    const request: ReplayBackendListRequest<Log> = buildBackendLogsRequest({
      sessionId: "sess-1",
      window: WINDOW,
    });

    expect(Object.keys(request.select)).not.toContain("attributes");
  });
});

describe("classifyBackendSignalsFailure", () => {
  test("403 locks the tab and names the permission for that kind", () => {
    const forbidden: HTTPErrorResponse = new HTTPErrorResponse(
      403,
      { message: "Forbidden" },
      {},
    );

    expect(classifyBackendSignalsFailure(forbidden, "log")).toEqual({
      status: "locked",
      lockedPermission: "Read Telemetry Service Log",
    });
    expect(classifyBackendSignalsFailure(forbidden, "span")).toEqual({
      status: "locked",
      lockedPermission: "Read Telemetry Service Traces",
    });
    expect(classifyBackendSignalsFailure(forbidden, "exception")).toEqual({
      status: "locked",
      lockedPermission: "Read Telemetry Service Exception",
    });
    expect(REPLAY_BACKEND_SIGNAL_PERMISSIONS).toEqual({
      log: Permission.ReadTelemetryServiceLog,
      span: Permission.ReadTelemetryServiceTraces,
      exception: Permission.ReadTelemetryException,
    });
  });

  test("other HTTP failures become retryable errors naming the status", () => {
    const failed: HTTPErrorResponse = new HTTPErrorResponse(
      500,
      { message: "boom" },
      {},
    );

    expect(classifyBackendSignalsFailure(failed, "log")).toEqual({
      status: "error",
      errorMessage: "Loading backend logs failed (HTTP 500). Retry.",
    });
    expect(classifyBackendSignalsFailure({ statusCode: 502 }, "span")).toEqual({
      status: "error",
      errorMessage: "Loading traces failed (HTTP 502). Retry.",
    });
  });

  test("transport errors carry their message; unknown throwables get honest copy", () => {
    expect(
      classifyBackendSignalsFailure(new Error("Failed to fetch"), "exception"),
    ).toEqual({
      status: "error",
      errorMessage: "Loading server exceptions failed: Failed to fetch. Retry.",
    });
    expect(classifyBackendSignalsFailure(undefined, "log")).toEqual({
      status: "error",
      errorMessage:
        "Loading backend logs failed before the server answered. Retry.",
    });
  });
});

describe("ReplayBackendSignalsStore", () => {
  beforeEach(() => {
    (ModelAPI.getList as jest.Mock).mockReset();
  });

  test("starts idle for every kind with no claimed row count", () => {
    const { store } = makeStore();
    const snapshot: ReplayBackendSignalsSnapshot = store.getSnapshot();

    expect(snapshot.slots).toEqual(makeIdleBackendSignalsState());
    expect(snapshot.slots.log.rowCount).toBeNull();
    expect(snapshot.rows).toEqual({ log: [], span: [], exception: [] });
  });

  test("load moves the slot through loading to ready with the rows and a fetch stamp", async () => {
    let now: number = END_UNIX_MS + 1_000;
    const { store, fetcher } = makeStore({
      now: (): number => {
        return now;
      },
    });
    const seen: Array<string> = [];

    store.subscribe((snapshot: ReplayBackendSignalsSnapshot): void => {
      seen.push(snapshot.slots.log.status);
    });

    const loading: Promise<void> = store.load("log");

    expect(store.getSlot("log").status).toBe("loading");
    expect(fetcher.requests).toHaveLength(1);
    expect(fetcher.requests[0]?.modelType).toBe(Log);
    expect(fetcher.requests[0]?.query).toEqual({
      sessionId: "sess-1",
      time: store.getWindow(),
    });

    now = END_UNIX_MS + 2_000;
    fetcher.resolve(0, listResult(makeLogs(3)));
    await loading;

    expect(store.getSlot("log")).toEqual({
      status: "ready",
      rowCount: 3,
      isTruncated: false,
      fetchedAtUnixMs: END_UNIX_MS + 2_000,
    });
    expect(store.getRows("log")).toHaveLength(3);
    expect(store.getSnapshot().slots.span.status).toBe("idle");
    expect(seen).toEqual(["loading", "ready"]);
  });

  test("does not double-fetch while a load is in flight, nor re-fetch a ready slot without force", async () => {
    const { store, fetcher } = makeStore();

    const first: Promise<void> = store.load("span");
    const second: Promise<void> = store.load("span");

    expect(fetcher.requests).toHaveLength(1);
    fetcher.resolve(0, listResult([]));
    await Promise.all([first, second]);

    await store.load("span");
    expect(fetcher.requests).toHaveLength(1);

    const forced: Promise<void> = store.load("span", { force: true });

    expect(fetcher.requests).toHaveLength(2);
    fetcher.resolve(1, listResult([]));
    await forced;
  });

  test("flags truncation when the page is full, when the server says hasMore, or when count exceeds rows", async () => {
    const { store, fetcher } = makeStore();

    const full: Promise<void> = store.load("log");

    fetcher.resolve(0, listResult(makeLogs(REPLAY_BACKEND_SIGNALS_ROW_LIMIT)));
    await full;
    expect(store.getSlot("log").isTruncated).toBe(true);
    expect(store.getSlot("log").rowCount).toBe(500);

    const more: Promise<void> = store.load("span", { force: true });

    fetcher.resolve(1, listResult([new Span()], { hasMore: true }));
    await more;
    expect(store.getSlot("span").isTruncated).toBe(true);

    const counted: Promise<void> = store.load("exception");

    fetcher.resolve(2, listResult([new ExceptionInstance()], { count: 9 }));
    await counted;
    expect(store.getSlot("exception").isTruncated).toBe(true);

    const small: Promise<void> = store.load("log", { force: true });

    fetcher.resolve(3, listResult(makeLogs(2)));
    await small;
    expect(store.getSlot("log").isTruncated).toBe(false);
  });

  test("drops a response that lands after dispose (generation guard)", async () => {
    const { store, fetcher } = makeStore();
    let notifications: number = 0;

    store.subscribe((): void => {
      notifications++;
    });

    const loading: Promise<void> = store.load("log");

    store.dispose();
    fetcher.resolve(0, listResult(makeLogs(4)));
    await loading;
    await flush();

    expect(store.getRows("log")).toEqual([]);
    expect(store.getSlot("log").rowCount).toBeNull();
    /* Only the "loading" transition was ever published. */
    expect(notifications).toBe(1);
    /* And nothing loads after dispose. */
    await store.load("span");
    expect(fetcher.requests).toHaveLength(1);
  });

  test("a rejected stale response is dropped too, not turned into an error slot", async () => {
    const { store, fetcher } = makeStore();
    const loading: Promise<void> = store.load("exception");

    store.dispose();
    fetcher.reject(0, new HTTPErrorResponse(500, { message: "late" }, {}));
    await loading;

    expect(store.getSlot("exception").status).toBe("loading");
    expect(store.getSlot("exception").errorMessage).toBeUndefined();
  });

  test("403 locks the slot naming the permission and clears the row count", async () => {
    const { store, fetcher } = makeStore();
    const loading: Promise<void> = store.load("log");

    fetcher.reject(0, new HTTPErrorResponse(403, { message: "Forbidden" }, {}));
    await loading;

    const slot: ReplayBackendSignalsSlot = store.getSlot("log");

    expect(slot.status).toBe("locked");
    expect(slot.lockedPermission).toBe("Read Telemetry Service Log");
    expect(slot.rowCount).toBeNull();
    expect(slot.isTruncated).toBe(false);
  });

  test("a failed refresh keeps the last good rows and count on screen", async () => {
    const { store, fetcher } = makeStore();
    const first: Promise<void> = store.load("log");

    fetcher.resolve(0, listResult(makeLogs(2)));
    await first;

    const refresh: Promise<void> = store.load("log", { force: true });

    /* Rows stay visible while the refresh is in flight. */
    expect(store.getSlot("log").status).toBe("loading");
    expect(store.getSlot("log").rowCount).toBe(2);
    expect(store.getRows("log")).toHaveLength(2);

    fetcher.reject(0, new Error("Failed to fetch"));
    fetcher.reject(1, new Error("Failed to fetch"));
    await refresh;

    expect(store.getSlot("log").status).toBe("error");
    expect(store.getSlot("log").errorMessage).toBe(
      "Loading backend logs failed: Failed to fetch. Retry.",
    );
    expect(store.getSlot("log").rowCount).toBe(2);
    expect(store.getRows("log")).toHaveLength(2);
  });

  test("loadAll fetches the three kinds in parallel", async () => {
    const { store, fetcher } = makeStore();
    const all: Promise<void> = store.loadAll();

    expect(
      fetcher.requests.map(
        (request: ReplayBackendListRequest<AnalyticsBaseModel>) => {
          return request.modelType;
        },
      ),
    ).toEqual([Log, Span, ExceptionInstance]);

    fetcher.resolve(0, listResult([]));
    fetcher.resolve(1, listResult([]));
    fetcher.resolve(2, listResult([]));
    await all;

    expect(store.getSlot("log").status).toBe("ready");
    expect(store.getSlot("span").status).toBe("ready");
    expect(store.getSlot("exception").status).toBe("ready");
    expect(store.getSlot("log").rowCount).toBe(0);
  });

  test("getSnapshot is referentially stable until something changes", async () => {
    const { store, fetcher } = makeStore();
    const before: ReplayBackendSignalsSnapshot = store.getSnapshot();

    expect(store.getSnapshot()).toBe(before);

    const loading: Promise<void> = store.load("log");

    expect(store.getSnapshot()).not.toBe(before);
    fetcher.resolve(0, listResult([]));
    await loading;
  });

  test("unsubscribe stops notifications", async () => {
    const { store, fetcher } = makeStore();
    let notifications: number = 0;
    const unsubscribe: () => void = store.subscribe((): void => {
      notifications++;
    });

    unsubscribe();

    const loading: Promise<void> = store.load("log");

    fetcher.resolve(0, listResult([]));
    await loading;

    expect(notifications).toBe(0);
  });

  test("the default fetcher delegates to AnalyticsModelAPI.getList with the request shape", async () => {
    (ModelAPI.getList as jest.Mock).mockImplementation(async () => {
      return listResult(makeLogs(1));
    });

    const store: ReplayBackendSignalsStore = new ReplayBackendSignalsStore({
      sessionId: "sess-2",
      startTimeUnixMs: START_UNIX_MS,
      endTimeUnixMs: END_UNIX_MS,
      isFinalized: true,
    });

    await store.load("log");

    /*
     * Two calls since the trace-id join: the log read, and the grouped
     * span read that supplies the session's trace ids (it returned Log
     * rows here, which carry no trace id, so no third read followed).
     */
    expect(ModelAPI.getList).toHaveBeenCalledTimes(2);

    const call: Record<string, unknown> = (ModelAPI.getList as jest.Mock).mock
      .calls[0]?.[0] as Record<string, unknown>;

    expect(call["modelType"]).toBe(Log);
    expect(call["limit"]).toBe(500);
    expect(call["skip"]).toBe(0);
    expect((call["query"] as Record<string, unknown>)["sessionId"]).toBe(
      "sess-2",
    );
    expect(call["groupBy"]).toBeUndefined();

    const grouped: Record<string, unknown> = (ModelAPI.getList as jest.Mock)
      .mock.calls[1]?.[0] as Record<string, unknown>;

    expect(grouped["modelType"]).toBe(Span);
    expect(grouped["groupBy"]).toEqual({ traceId: true });
    expect(grouped["select"]).toEqual({ traceId: true });
    expect(grouped["sort"]).toEqual({ traceId: SortOrder.Ascending });
    expect(store.getSlot("log").status).toBe("ready");
    expect(store.getSlot("log").rowCount).toBe(1);
  });
});

describe("live refresh", () => {
  test("isBackendRefreshDue: only settled slots, only on live sessions, only after the interval", () => {
    const ready: ReplayBackendSignalsSlot = {
      status: "ready",
      rowCount: 1,
      isTruncated: false,
      fetchedAtUnixMs: 1_000,
    };
    const later: number = 1_000 + REPLAY_BACKEND_SIGNALS_LIVE_REFRESH_MS;

    expect(isBackendRefreshDue(ready, later - 1, false)).toBe(false);
    expect(isBackendRefreshDue(ready, later, false)).toBe(true);
    expect(isBackendRefreshDue(ready, later, true)).toBe(false);
    expect(
      isBackendRefreshDue({ ...ready, status: "error" }, later, false),
    ).toBe(true);
    expect(
      isBackendRefreshDue({ ...ready, status: "locked" }, later, false),
    ).toBe(false);
    expect(
      isBackendRefreshDue({ ...ready, status: "idle" }, later, false),
    ).toBe(false);
    expect(
      isBackendRefreshDue({ ...ready, status: "loading" }, later, false),
    ).toBe(false);
    expect(
      isBackendRefreshDue({ ...ready, fetchedAtUnixMs: null }, 0, false),
    ).toBe(true);
  });

  test("refreshIfDue re-reads stale settled slots on a live session and leaves idle/locked ones alone", async () => {
    let now: number = START_UNIX_MS + 60_000;
    const { store, fetcher } = makeStore({
      isFinalized: false,
      endTimeUnixMs: null,
      now: (): number => {
        return now;
      },
    });

    const logLoad: Promise<void> = store.load("log");
    const spanLoad: Promise<void> = store.load("span");

    fetcher.resolve(0, listResult(makeLogs(1)));
    fetcher.reject(1, new HTTPErrorResponse(403, { message: "Forbidden" }, {}));
    await Promise.all([logLoad, spanLoad]);

    expect(store.getRefreshDueKinds()).toEqual([]);

    now += REPLAY_BACKEND_SIGNALS_LIVE_REFRESH_MS;

    expect(store.getRefreshDueKinds()).toEqual(["log"]);

    const refreshing: Promise<Array<ReplayBackendSignalKind>> =
      store.refreshIfDue();

    expect(fetcher.requests).toHaveLength(3);
    expect(fetcher.requests[2]?.modelType).toBe(Log);
    /* The live window's end moved with "now". */
    expect(
      (
        fetcher.requests[2]?.query as { time: InBetween<Date> }
      ).time.endValue.getTime(),
    ).toBe(now + REPLAY_BACKEND_SIGNALS_WINDOW_PADDING_MS);

    fetcher.resolve(2, listResult(makeLogs(5)));

    expect(await refreshing).toEqual(["log"]);
    expect(store.getSlot("log").rowCount).toBe(5);
    expect(store.getSlot("log").fetchedAtUnixMs).toBe(now);
    expect(store.getSlot("span").status).toBe("locked");
    expect(store.getSlot("exception").status).toBe("idle");
  });

  test("finalizing the session through setSessionBounds stops refreshes", async () => {
    let now: number = START_UNIX_MS;
    const { store, fetcher } = makeStore({
      isFinalized: false,
      endTimeUnixMs: null,
      now: (): number => {
        return now;
      },
    });
    const loading: Promise<void> = store.load("exception");

    fetcher.resolve(0, listResult([]));
    await loading;

    now += REPLAY_BACKEND_SIGNALS_LIVE_REFRESH_MS * 2;
    expect(store.getRefreshDueKinds()).toEqual(["exception"]);

    store.setSessionBounds({ isFinalized: true, endTimeUnixMs: now });

    expect(store.getRefreshDueKinds()).toEqual([]);
    expect(await store.refreshIfDue()).toEqual([]);
    expect(fetcher.requests).toHaveLength(1);
  });
});

/* ---- The trace-id join (issue #3979). ---- */

/* More turns than flush(): read B waits on the grouped span read first. */
async function settle(): Promise<void> {
  for (let i: number = 0; i < 30; i++) {
    await Promise.resolve();
  }
}

function makeLog(args: {
  id?: string;
  atMs: number;
  traceId?: string;
  body?: string;
}): Log {
  const row: Log = new Log();

  if (args.id !== undefined) {
    row._id = new ObjectID(args.id);
  }

  row.time = new Date(START_UNIX_MS + args.atMs);
  row.body = args.body ?? `line at ${args.atMs}`;

  if (args.traceId !== undefined) {
    row.traceId = args.traceId;
  }

  return row;
}

function makeSpan(args: {
  traceId?: string;
  spanId?: string;
  atMs: number;
  id?: string;
}): Span {
  const row: Span = new Span();

  if (args.id !== undefined) {
    row._id = new ObjectID(args.id);
  }

  if (args.traceId !== undefined) {
    row.traceId = args.traceId;
  }

  if (args.spanId !== undefined) {
    row.spanId = args.spanId;
  }

  row.startTime = new Date(START_UNIX_MS + args.atMs);

  return row;
}

function recordingNetworkSignal(
  offsetMs: number,
  traceId: string | null,
  overrides?: Partial<ReplaySignal>,
): ReplaySignal {
  return {
    id: `rec:0:${offsetMs}`,
    kind: "network",
    source: "recording",
    offsetMs: offsetMs,
    severity: "info",
    title: "GET 200 /api/items",
    links: traceId === null ? {} : { traceId: traceId },
    detail: {},
    ...overrides,
  };
}

/* The ids a trace-id read named, in order. */
function namedIds(
  request: ReplayBackendListRequest<AnalyticsBaseModel> | undefined,
): Array<string> {
  const query: Record<string, unknown> = (request?.query || {}) as Record<
    string,
    unknown
  >;
  const includes: unknown = query["traceId"];

  expect(includes).toBeInstanceOf(Includes);

  return (includes as Includes).values as Array<string>;
}

function isTraceIdRowRead(
  request: ReplayBackendListRequest<AnalyticsBaseModel> | undefined,
): boolean {
  const query: Record<string, unknown> = (request?.query || {}) as Record<
    string,
    unknown
  >;

  return query["traceId"] instanceof Includes;
}

describe("trace ids: normalisation", () => {
  test("lowercases and trims, keeping 32 hex digits only", () => {
    const upper: string = "4BF92F3577B34DA6A3CE929D0E0E4736";

    expect(normalizeReplayTraceIds([[upper, `  ${traceIdOf(7)}  `]])).toEqual([
      upper.toLowerCase(),
      traceIdOf(7),
    ]);
  });

  test("drops the all-zero id, wrong lengths, non-hex and non-strings", () => {
    expect(
      normalizeReplayTraceIds([
        [
          "0".repeat(32),
          "abc",
          "a".repeat(31),
          "a".repeat(33),
          "g".repeat(32),
          `${"a".repeat(16)}-${"b".repeat(15)}`,
          42,
          null,
          undefined,
          { traceId: traceIdOf(1) },
          traceIdOf(2),
        ],
      ]),
    ).toEqual([traceIdOf(2)]);
  });

  test("dedupes across sources, keeping the first source's position", () => {
    expect(
      normalizeReplayTraceIds([
        [traceIdOf(1), traceIdOf(2)],
        [traceIdOf(2).toUpperCase(), traceIdOf(3)],
        [traceIdOf(1), traceIdOf(4)],
      ]),
    ).toEqual([traceIdOf(1), traceIdOf(2), traceIdOf(3), traceIdOf(4)]);
  });

  test("skips missing sources and caps in source order", () => {
    const many: Array<string> = [];

    for (let i: number = 1; i <= REPLAY_BACKEND_TRACE_IDS_CAP + 50; i++) {
      many.push(traceIdOf(i));
    }

    expect(normalizeReplayTraceIds([null, undefined, many])).toHaveLength(
      REPLAY_BACKEND_TRACE_IDS_CAP,
    );
    expect(REPLAY_BACKEND_TRACE_IDS_CAP).toBe(1000);
    expect(
      normalizeReplayTraceIds(
        [[traceIdOf(9), traceIdOf(8)], [traceIdOf(7)]],
        2,
      ),
    ).toEqual([traceIdOf(9), traceIdOf(8)]);
    expect(normalizeReplayTraceIds([[traceIdOf(9)]], 0)).toEqual([]);
    expect(normalizeReplayTraceIds([])).toEqual([]);
  });

  test("recordingTraceIdsFromSignals reads the recording's network rows only", () => {
    const signals: Array<ReplaySignal> = [
      recordingNetworkSignal(100, traceIdOf(3)),
      recordingNetworkSignal(200, null),
      recordingNetworkSignal(300, traceIdOf(1).toUpperCase()),
      recordingNetworkSignal(400, traceIdOf(3)),
      recordingNetworkSignal(500, "not-a-trace-id"),
      recordingNetworkSignal(600, traceIdOf(5), { kind: "console" }),
      recordingNetworkSignal(700, traceIdOf(6), { source: "telemetry" }),
    ];

    expect(recordingTraceIdsFromSignals(signals)).toEqual([
      traceIdOf(3),
      traceIdOf(1),
    ]);
    expect(recordingTraceIdsFromSignals([])).toEqual([]);
  });

  test("recording ids are not capped (the store caps at read time)", () => {
    const signals: Array<ReplaySignal> = [];

    for (let i: number = 1; i <= REPLAY_BACKEND_TRACE_IDS_CAP + 5; i++) {
      signals.push(recordingNetworkSignal(i, traceIdOf(i)));
    }

    expect(recordingTraceIdsFromSignals(signals)).toHaveLength(
      REPLAY_BACKEND_TRACE_IDS_CAP + 5,
    );
  });
});

describe("trace ids: request shapes", () => {
  const IDS: Array<string> = [traceIdOf(1), traceIdOf(2)];

  test("logs by trace id: traceId IN + the same time window, columns, sort and cap as the session read", () => {
    const bySession: ReplayBackendListRequest<Log> = buildBackendLogsRequest({
      sessionId: "sess-1",
      window: WINDOW,
    });
    const byTrace: ReplayBackendListRequest<Log> = buildBackendLogsRequest({
      traceIds: IDS,
      window: WINDOW,
    });

    expect(byTrace.modelType).toBe(Log);
    expect(byTrace.query).toEqual({
      traceId: new Includes(IDS),
      time: WINDOW,
    });
    expect(Object.keys(byTrace.query)).not.toContain("sessionId");
    expect(
      namedIds(byTrace as ReplayBackendListRequest<AnalyticsBaseModel>),
    ).toEqual(IDS);
    expect(byTrace.select).toEqual(bySession.select);
    expect(byTrace.sort).toEqual(bySession.sort);
    expect(byTrace.limit).toBe(REPLAY_BACKEND_SIGNALS_ROW_LIMIT);
    expect(byTrace.skip).toBe(0);
    expect(byTrace.groupBy).toBeUndefined();
    expect(bySession.groupBy).toBeUndefined();
  });

  test("spans by trace id: traceId IN + startTime window", () => {
    const bySession: ReplayBackendListRequest<Span> = buildBackendSpansRequest({
      sessionId: "sess-1",
      window: WINDOW,
    });
    const byTrace: ReplayBackendListRequest<Span> = buildBackendSpansRequest({
      traceIds: IDS,
      window: WINDOW,
    });

    expect(byTrace.modelType).toBe(Span);
    expect(byTrace.query).toEqual({
      traceId: new Includes(IDS),
      startTime: WINDOW,
    });
    expect(byTrace.select).toEqual(bySession.select);
    expect(byTrace.sort).toEqual({ startTime: SortOrder.Ascending });
    expect(byTrace.limit).toBe(500);
  });

  test("exceptions by trace id: traceId IN + time window", () => {
    const bySession: ReplayBackendListRequest<ExceptionInstance> =
      buildBackendExceptionsRequest({ sessionId: "sess-1", window: WINDOW });
    const byTrace: ReplayBackendListRequest<ExceptionInstance> =
      buildBackendExceptionsRequest({ traceIds: IDS, window: WINDOW });

    expect(byTrace.modelType).toBe(ExceptionInstance);
    expect(byTrace.query).toEqual({
      traceId: new Includes(IDS),
      time: WINDOW,
    });
    expect(byTrace.select).toEqual(bySession.select);
    expect(byTrace.sort).toEqual({ time: SortOrder.Ascending });
    expect(byTrace.limit).toBe(500);
  });

  test("the session trace-id read groups the session's spans by traceId", () => {
    const request: ReplayBackendListRequest<Span> = buildSessionTraceIdsRequest(
      { sessionId: "sess-1", window: WINDOW },
    );

    expect(request.modelType).toBe(Span);
    expect(request.query).toEqual({ sessionId: "sess-1", startTime: WINDOW });
    expect(request.select).toEqual({ traceId: true });
    expect(request.groupBy).toEqual({ traceId: true });
    /* Grouped finds skip the _id tiebreak; the sort must be the grouped column. */
    expect(request.sort).toEqual({ traceId: SortOrder.Ascending });
    expect(request.limit).toBe(REPLAY_BACKEND_SESSION_TRACE_IDS_LIMIT);
    expect(request.limit).toBe(1000);
    expect(request.skip).toBe(0);
  });
});

describe("trace ids: merging read A with read B", () => {
  const logTime: (row: Log) => unknown = (row: Log): unknown => {
    return row.time;
  };
  const spanTime: (row: Span) => unknown = (row: Span): unknown => {
    return row.startTime;
  };

  test("without read B the session read is published exactly as it came back", () => {
    const sessionRead: ListResult<Log> = listResult(
      [makeLog({ atMs: 900 }), makeLog({ atMs: 100 })],
      { hasMore: true },
    );
    const merged: ReplayBackendMergedRows<Log> = mergeBackendRows<Log>({
      sessionRead: sessionRead,
      traceRead: null,
      timeOf: logTime,
      keyOf: backendRowIdKey,
    });

    expect(merged.rows).toBe(sessionRead.data);
    expect(merged.rowCount).toBe(2);
    expect(merged.isTruncated).toBe(true);
  });

  test("logs dedupe by _id (A's copy wins); rows without an id never collapse", () => {
    const shared: string = "aaaaaaaaaaaaaaaaaaaaaaaa";
    const fromA: Log = makeLog({ id: shared, atMs: 300, body: "from A" });
    const fromB: Log = makeLog({ id: shared, atMs: 300, body: "from B" });
    const merged: ReplayBackendMergedRows<Log> = mergeBackendRows<Log>({
      sessionRead: listResult([fromA, makeLog({ atMs: 100 })]),
      traceRead: listResult([
        fromB,
        makeLog({ atMs: 100 }),
        makeLog({ id: "bbbbbbbbbbbbbbbbbbbbbbbb", atMs: 200 }),
      ]),
      timeOf: logTime,
      keyOf: backendRowIdKey,
    });

    expect(merged.rowCount).toBe(4);
    expect(merged.rows).toHaveLength(4);
    expect(merged.rows).toContain(fromA);
    expect(merged.rows).not.toContain(fromB);
    expect(merged.isTruncated).toBe(false);
  });

  test("spans dedupe by traceId + spanId even when their _id differs, falling back to _id", () => {
    const merged: ReplayBackendMergedRows<Span> = mergeBackendRows<Span>({
      sessionRead: listResult([
        makeSpan({
          traceId: traceIdOf(1),
          spanId: "s1",
          atMs: 10,
          id: "a00000000000000000000001",
        }),
        makeSpan({ atMs: 20, id: "a00000000000000000000009" }),
      ]),
      traceRead: listResult([
        makeSpan({
          traceId: traceIdOf(1),
          spanId: "s1",
          atMs: 10,
          id: "b00000000000000000000001",
        }),
        makeSpan({ traceId: traceIdOf(1), spanId: "s2", atMs: 15 }),
        makeSpan({ traceId: traceIdOf(2), spanId: "s1", atMs: 16 }),
        makeSpan({ atMs: 20, id: "a00000000000000000000009" }),
        makeSpan({ atMs: 25 }),
      ]),
      timeOf: spanTime,
      keyOf: backendSpanRowKey,
    });

    expect(merged.rowCount).toBe(5);
    expect(
      merged.rows.map((row: Span): string => {
        return `${row.traceId ?? "-"}/${row.spanId ?? "-"}`;
      }),
    ).toEqual([
      `${traceIdOf(1)}/s1`,
      `${traceIdOf(1)}/s2`,
      `${traceIdOf(2)}/s1`,
      "-/-",
      "-/-",
    ]);
  });

  test("row keys: _id text, span identity, null for rows with neither", () => {
    expect(
      backendRowIdKey(makeLog({ id: "cccccccccccccccccccccccc", atMs: 0 })),
    ).toBe("cccccccccccccccccccccccc");
    expect(backendRowIdKey(makeLog({ atMs: 0 }))).toBeNull();
    expect(
      backendSpanRowKey(
        makeSpan({ traceId: traceIdOf(1), spanId: "x", atMs: 0 }),
      ),
    ).toBe(`span:${traceIdOf(1)}:x`);
    expect(
      backendSpanRowKey(
        makeSpan({
          traceId: traceIdOf(1),
          atMs: 0,
          id: "dddddddddddddddddddddddd",
        }),
      ),
    ).toBe("id:dddddddddddddddddddddddd");
    expect(backendSpanRowKey(makeSpan({ atMs: 0 }))).toBeNull();
  });

  test("sorts ascending by the time column; rows without a time go last in arrival order", () => {
    const noTimeA: Log = new Log();
    const noTimeB: Log = new Log();

    noTimeA.body = "no time A";
    noTimeB.body = "no time B";

    const merged: ReplayBackendMergedRows<Log> = mergeBackendRows<Log>({
      sessionRead: listResult([
        makeLog({ atMs: 500, body: "A500" }),
        noTimeA,
        makeLog({ atMs: 100, body: "A100" }),
      ]),
      traceRead: listResult([
        makeLog({ atMs: 300, body: "B300" }),
        noTimeB,
        makeLog({ atMs: 100, body: "B100" }),
      ]),
      timeOf: logTime,
      keyOf: backendRowIdKey,
    });

    expect(
      merged.rows.map((row: Log): string => {
        return row.body as string;
      }),
    ).toEqual(["A100", "B100", "B300", "A500", "no time A", "no time B"]);
  });

  test("the merge is cut to the row limit, oldest first, and flagged truncated", () => {
    const merged: ReplayBackendMergedRows<Log> = mergeBackendRows<Log>({
      sessionRead: listResult([
        makeLog({ atMs: 30, body: "30" }),
        makeLog({ atMs: 10, body: "10" }),
      ]),
      traceRead: listResult([
        makeLog({ atMs: 20, body: "20" }),
        makeLog({ atMs: 40, body: "40" }),
      ]),
      timeOf: logTime,
      keyOf: backendRowIdKey,
      limit: 3,
    });

    expect(
      merged.rows.map((row: Log): string => {
        return row.body as string;
      }),
    ).toEqual(["10", "20", "30"]);
    expect(merged.rowCount).toBe(3);
    expect(merged.isTruncated).toBe(true);
  });

  test("truncated when either read was, even if the merge fits", () => {
    const small: ListResult<Log> = listResult([makeLog({ atMs: 1 })]);

    expect(
      mergeBackendRows<Log>({
        sessionRead: listResult([makeLog({ atMs: 2 })], { hasMore: true }),
        traceRead: small,
        timeOf: logTime,
        keyOf: backendRowIdKey,
      }).isTruncated,
    ).toBe(true);
    expect(
      mergeBackendRows<Log>({
        sessionRead: small,
        traceRead: listResult([makeLog({ atMs: 3 })], { count: 40 }),
        timeOf: logTime,
        keyOf: backendRowIdKey,
      }).isTruncated,
    ).toBe(true);
    expect(
      mergeBackendRows<Log>({
        sessionRead: small,
        traceRead: listResult([makeLog({ atMs: 3 })]),
        timeOf: logTime,
        keyOf: backendRowIdKey,
      }).isTruncated,
    ).toBe(false);
    expect(isBackendListTruncated(listResult(makeLogs(500)))).toBe(true);
    expect(isBackendListTruncated(listResult([]))).toBe(false);
  });

  test("500 + 500 distinct rows merge to the 500 oldest", () => {
    const fromA: Array<Log> = [];
    const fromB: Array<Log> = [];

    for (let i: number = 0; i < 500; i++) {
      fromA.push(makeLog({ atMs: i * 2, body: `A${i}` }));
      fromB.push(makeLog({ atMs: i * 2 + 1, body: `B${i}` }));
    }

    const merged: ReplayBackendMergedRows<Log> = mergeBackendRows<Log>({
      sessionRead: listResult(fromA),
      traceRead: listResult(fromB),
      timeOf: logTime,
      keyOf: backendRowIdKey,
    });

    expect(merged.rowCount).toBe(500);
    expect(merged.isTruncated).toBe(true);
    expect(merged.rows[0]?.body).toBe("A0");
    expect(merged.rows[1]?.body).toBe("B0");
    expect(merged.rows[499]?.body).toBe("B249");
  });
});

describe("ReplayBackendSignalsStore: the trace-id read", () => {
  test("spans: header ids add read B over the same window; no grouped span read", async () => {
    const { store, fetcher } = makeStore({
      traceIds: [traceIdOf(1).toUpperCase(), "junk", traceIdOf(2)],
    });
    const loading: Promise<void> = store.load("span");

    await settle();

    expect(fetcher.requests).toHaveLength(2);
    expect(fetcher.requests[0]?.query).toEqual({
      sessionId: "sess-1",
      startTime: store.getWindow(),
    });
    expect(fetcher.requests[1]?.modelType).toBe(Span);
    expect(fetcher.requests[1]?.query).toEqual({
      traceId: new Includes([traceIdOf(1), traceIdOf(2)]),
      startTime: store.getWindow(),
    });
    expect(fetcher.traceIdRequests).toHaveLength(0);

    fetcher.resolve(
      0,
      listResult([
        makeSpan({ traceId: traceIdOf(1), spanId: "root", atMs: 10 }),
      ]),
    );
    fetcher.resolve(
      1,
      listResult([
        makeSpan({ traceId: traceIdOf(1), spanId: "root", atMs: 10 }),
        makeSpan({ traceId: traceIdOf(1), spanId: "db", atMs: 12 }),
        makeSpan({ traceId: traceIdOf(2), spanId: "api", atMs: 5 }),
      ]),
    );
    await loading;

    expect(store.getSlot("span")).toMatchObject({
      status: "ready",
      rowCount: 3,
      isTruncated: false,
    });
    expect(
      store.getRows("span").map((row: Span): string => {
        return row.spanId as string;
      }),
    ).toEqual(["api", "root", "db"]);
  });

  test("spans with no trace ids anywhere: exactly today's single read", async () => {
    const { store, fetcher } = makeStore();
    const loading: Promise<void> = store.load("span");

    await settle();
    expect(fetcher.requests).toHaveLength(1);

    fetcher.resolve(0, listResult([makeSpan({ atMs: 1 })]));
    await loading;
    await settle();

    expect(fetcher.requests).toHaveLength(1);
    expect(fetcher.traceIdRequests).toHaveLength(0);
    expect(store.getSlot("span").rowCount).toBe(1);
  });

  test("logs: read A and the grouped span read start together, then B names recording, header and span ids in that order", async () => {
    const { store, fetcher } = makeStore({
      traceIds: [traceIdOf(20), traceIdOf(10)],
    });

    fetcher.holdTraceIdReads = true;
    store.setRecordingTraceIds([traceIdOf(10), traceIdOf(30)]);

    const loading: Promise<void> = store.load("log");

    /* Synchronously: the log read and the grouped span read, nothing else. */
    expect(fetcher.requests).toHaveLength(1);
    expect(fetcher.requests[0]?.modelType).toBe(Log);
    expect(fetcher.traceIdRequests).toHaveLength(1);
    expect(fetcher.traceIdRequests[0]?.query).toEqual({
      sessionId: "sess-1",
      startTime: store.getWindow(),
    });

    await settle();
    /* B waits for the span-derived ids. */
    expect(fetcher.requests).toHaveLength(1);

    fetcher.resolveTraceIds(0, [traceIdOf(40), traceIdOf(20), "bad"]);
    await settle();

    expect(fetcher.requests).toHaveLength(2);
    expect(fetcher.requests[1]?.modelType).toBe(Log);
    expect(namedIds(fetcher.requests[1])).toEqual([
      traceIdOf(10),
      traceIdOf(30),
      traceIdOf(20),
      traceIdOf(40),
    ]);
    expect(fetcher.requests[1]?.query).toMatchObject({
      time: store.getWindow(),
    });

    fetcher.resolve(
      0,
      listResult([
        makeLog({ id: "aaaaaaaaaaaaaaaaaaaaaaaa", atMs: 400, body: "stamped" }),
      ]),
    );
    fetcher.resolve(
      1,
      listResult([
        makeLog({ id: "aaaaaaaaaaaaaaaaaaaaaaaa", atMs: 400, body: "stamped" }),
        makeLog({
          id: "bbbbbbbbbbbbbbbbbbbbbbbb",
          atMs: 100,
          body: "joined by trace",
          traceId: traceIdOf(40),
        }),
      ]),
    );
    await loading;

    expect(store.getSlot("log")).toMatchObject({
      status: "ready",
      rowCount: 2,
      isTruncated: false,
    });
    expect(
      store.getRows("log").map((row: Log): string => {
        return row.body as string;
      }),
    ).toEqual(["joined by trace", "stamped"]);
  });

  test("logs with no ids anywhere: the log read plus an empty grouped read, no B", async () => {
    const { store, fetcher } = makeStore();
    const loading: Promise<void> = store.load("log");

    fetcher.resolve(0, listResult(makeLogs(2)));
    await loading;
    await settle();

    expect(fetcher.requests).toHaveLength(1);
    expect(fetcher.traceIdRequests).toHaveLength(1);
    expect(store.getSlot("log").rowCount).toBe(2);
  });

  test("span-derived ids alone are enough to run B for logs and exceptions", async () => {
    const { store, fetcher } = makeStore();

    fetcher.sessionTraceIds = [traceIdOf(5)];

    const logs: Promise<void> = store.load("log");
    const exceptions: Promise<void> = store.load("exception");

    await settle();

    expect(
      fetcher.requests.map(
        (
          request: ReplayBackendListRequest<AnalyticsBaseModel>,
        ): [unknown, boolean] => {
          return [request.modelType, isTraceIdRowRead(request)];
        },
      ),
    ).toEqual([
      [Log, false],
      [ExceptionInstance, false],
      [Log, true],
      [ExceptionInstance, true],
    ]);
    expect(namedIds(fetcher.requests[2])).toEqual([traceIdOf(5)]);
    expect(namedIds(fetcher.requests[3])).toEqual([traceIdOf(5)]);
    /* One grouped read, shared by both kinds. */
    expect(fetcher.traceIdRequests).toHaveLength(1);

    for (let i: number = 0; i < 4; i++) {
      fetcher.resolve(i, listResult([]));
    }

    await Promise.all([logs, exceptions]);
  });

  test("the grouped span read never touches the Traces slot", async () => {
    const { store, fetcher } = makeStore();

    fetcher.sessionTraceIds = [traceIdOf(5)];

    const logs: Promise<void> = store.load("log");

    await settle();
    fetcher.resolve(0, listResult([]));
    fetcher.resolve(1, listResult([]));
    await logs;

    expect(store.getSlot("span")).toEqual({
      status: "idle",
      rowCount: null,
      isTruncated: false,
      fetchedAtUnixMs: null,
    });
    expect(store.getRows("span")).toEqual([]);
    expect(
      fetcher.requests.every(
        (request: ReplayBackendListRequest<AnalyticsBaseModel>): boolean => {
          return request.modelType !== Span;
        },
      ),
    ).toBe(true);
  });

  test("loadAll issues one grouped read and B for each kind that has ids", async () => {
    const { store, fetcher } = makeStore({ traceIds: [traceIdOf(1)] });

    fetcher.sessionTraceIds = [traceIdOf(2)];

    const all: Promise<void> = store.loadAll();

    await settle();

    expect(fetcher.traceIdRequests).toHaveLength(1);
    expect(fetcher.requests).toHaveLength(6);

    const spanB: ReplayBackendListRequest<AnalyticsBaseModel> | undefined =
      fetcher.requests.find(
        (request: ReplayBackendListRequest<AnalyticsBaseModel>): boolean => {
          return request.modelType === Span && isTraceIdRowRead(request);
        },
      );
    const logB: ReplayBackendListRequest<AnalyticsBaseModel> | undefined =
      fetcher.requests.find(
        (request: ReplayBackendListRequest<AnalyticsBaseModel>): boolean => {
          return request.modelType === Log && isTraceIdRowRead(request);
        },
      );

    /* Spans: header ids only; the stamped spans come through read A. */
    expect(namedIds(spanB)).toEqual([traceIdOf(1)]);
    expect(namedIds(logB)).toEqual([traceIdOf(1), traceIdOf(2)]);

    for (let i: number = 0; i < 6; i++) {
      fetcher.resolve(i, listResult([]));
    }

    await all;

    expect(store.getSlot("log").status).toBe("ready");
    expect(store.getSlot("span").status).toBe("ready");
    expect(store.getSlot("exception").status).toBe("ready");
  });

  test("a finalized session reuses the grouped read across loads and forced reloads", async () => {
    const { store, fetcher } = makeStore();

    fetcher.sessionTraceIds = [traceIdOf(3)];

    const first: Promise<void> = store.load("log");

    await settle();
    fetcher.resolve(0, listResult([]));
    fetcher.resolve(1, listResult([]));
    await first;

    const reload: Promise<void> = store.load("log", { force: true });
    const exceptions: Promise<void> = store.load("exception");

    await settle();

    expect(fetcher.traceIdRequests).toHaveLength(1);
    expect(fetcher.requests).toHaveLength(6);
    expect(namedIds(fetcher.requests[4])).toEqual([traceIdOf(3)]);
    expect(namedIds(fetcher.requests[5])).toEqual([traceIdOf(3)]);

    for (let i: number = 2; i < 6; i++) {
      fetcher.resolve(i, listResult([]));
    }

    await Promise.all([reload, exceptions]);
  });

  test("a live session re-runs the grouped read once the window has moved, and shares one in flight", async () => {
    let now: number = START_UNIX_MS + 60_000;
    const { store, fetcher } = makeStore({
      isFinalized: false,
      endTimeUnixMs: null,
      now: (): number => {
        return now;
      },
    });

    fetcher.holdTraceIdReads = true;

    const logs: Promise<void> = store.load("log");

    now += 5;

    const exceptions: Promise<void> = store.load("exception");

    /* In flight: the exception load shares the log load's read. */
    expect(fetcher.traceIdRequests).toHaveLength(1);

    fetcher.resolveTraceIds(0, []);
    fetcher.resolve(0, listResult([]));
    fetcher.resolve(1, listResult([]));
    await Promise.all([logs, exceptions]);

    now += REPLAY_BACKEND_SIGNALS_LIVE_REFRESH_MS;

    const refreshing: Promise<Array<ReplayBackendSignalKind>> =
      store.refreshIfDue();

    /* One new read for the whole refresh, over the moved window. */
    expect(fetcher.traceIdRequests).toHaveLength(2);
    expect(
      (
        fetcher.traceIdRequests[1]?.query as { startTime: InBetween<Date> }
      ).startTime.endValue.getTime(),
    ).toBe(now + REPLAY_BACKEND_SIGNALS_WINDOW_PADDING_MS);

    fetcher.resolveTraceIds(1, []);
    fetcher.resolve(2, listResult([]));
    fetcher.resolve(3, listResult([]));

    expect(await refreshing).toEqual(["log", "exception"]);
  });

  test("a 403 on the grouped read never locks logs: header ids still run B, and the read is not retried", async () => {
    const { store, fetcher } = makeStore({ traceIds: [traceIdOf(1)] });

    fetcher.traceIdFailure = new HTTPErrorResponse(
      403,
      { message: "Forbidden" },
      {},
    );

    const logs: Promise<void> = store.load("log");

    await settle();

    expect(fetcher.requests).toHaveLength(2);
    expect(namedIds(fetcher.requests[1])).toEqual([traceIdOf(1)]);

    fetcher.resolve(0, listResult(makeLogs(1)));
    fetcher.resolve(1, listResult([]));
    await logs;

    expect(store.getSlot("log").status).toBe("ready");
    expect(store.getSlot("log").rowCount).toBe(1);
    expect(store.getSlot("log").lockedPermission).toBeUndefined();

    const exceptions: Promise<void> = store.load("exception");

    await settle();
    fetcher.resolve(2, listResult([]));
    fetcher.resolve(3, listResult([]));
    await exceptions;

    /* Permissions do not change by the minute: no second grouped read. */
    expect(fetcher.traceIdRequests).toHaveLength(1);
    expect(store.getSlot("exception").status).toBe("ready");
  });

  test("any other grouped-read failure degrades silently and is retried by the next load", async () => {
    const { store, fetcher } = makeStore();

    fetcher.traceIdFailure = new HTTPErrorResponse(500, { message: "x" }, {});

    const first: Promise<void> = store.load("log");

    await settle();
    fetcher.resolve(0, listResult(makeLogs(3)));
    await first;

    expect(store.getSlot("log").status).toBe("ready");
    expect(store.getSlot("log").rowCount).toBe(3);
    expect(fetcher.requests).toHaveLength(1);

    fetcher.traceIdFailure = undefined;
    fetcher.sessionTraceIds = [traceIdOf(8)];

    const second: Promise<void> = store.load("exception");

    await settle();

    expect(fetcher.traceIdRequests).toHaveLength(2);
    expect(namedIds(fetcher.requests[2])).toEqual([traceIdOf(8)]);

    fetcher.resolve(1, listResult([]));
    fetcher.resolve(2, listResult([]));
    await second;
  });

  test("a grouped read that throws synchronously degrades the same way", async () => {
    let calls: number = 0;
    const store: ReplayBackendSignalsStore = new ReplayBackendSignalsStore({
      sessionId: "sess-1",
      startTimeUnixMs: START_UNIX_MS,
      endTimeUnixMs: END_UNIX_MS,
      isFinalized: true,
      fetchList: <T extends AnalyticsBaseModel>(
        request: ReplayBackendListRequest<T>,
      ): Promise<ListResult<T>> => {
        calls++;

        if (request.groupBy !== undefined) {
          throw new Error("sync failure");
        }

        return Promise.resolve(
          listResult(makeLogs(1)) as unknown as ListResult<T>,
        );
      },
    });

    await store.load("log");

    expect(calls).toBe(2);
    expect(store.getSlot("log").status).toBe("ready");
    expect(store.getSlot("log").rowCount).toBe(1);
  });

  test("read B failing keeps read A's rows on a ready slot (never blanks a working tab)", async () => {
    const { store, fetcher } = makeStore({ traceIds: [traceIdOf(1)] });
    const logs: Promise<void> = store.load("log");

    await settle();
    fetcher.resolve(0, listResult(makeLogs(2)));
    fetcher.reject(1, new HTTPErrorResponse(502, { message: "bad" }, {}));
    await logs;

    expect(store.getSlot("log")).toMatchObject({
      status: "ready",
      rowCount: 2,
      isTruncated: false,
    });
    expect(store.getSlot("log").errorMessage).toBeUndefined();
    expect(store.getRows("log")).toHaveLength(2);

    const spans: Promise<void> = store.load("span");

    await settle();
    fetcher.resolve(2, listResult([makeSpan({ atMs: 1 })]));
    fetcher.reject(3, new HTTPErrorResponse(403, { message: "no" }, {}));
    await spans;

    expect(store.getSlot("span").status).toBe("ready");
    expect(store.getSlot("span").rowCount).toBe(1);
  });

  test("read A failing fails the slot as before, even when B succeeded", async () => {
    const { store, fetcher } = makeStore({ traceIds: [traceIdOf(1)] });
    const logs: Promise<void> = store.load("log");

    await settle();
    fetcher.resolve(1, listResult(makeLogs(4)));
    await settle();
    fetcher.reject(0, new HTTPErrorResponse(500, { message: "boom" }, {}));
    await logs;

    expect(store.getSlot("log").status).toBe("error");
    expect(store.getSlot("log").errorMessage).toBe(
      "Loading backend logs failed (HTTP 500). Retry.",
    );
    expect(store.getRows("log")).toEqual([]);

    const exceptions: Promise<void> = store.load("exception");

    await settle();
    fetcher.reject(2, new HTTPErrorResponse(403, { message: "no" }, {}));
    await exceptions;

    expect(store.getSlot("exception").status).toBe("locked");
  });

  test("a 403 on read A locks the slot without waiting for the grouped read, and B is never sent", async () => {
    const { store, fetcher } = makeStore();

    fetcher.holdTraceIdReads = true;

    const logs: Promise<void> = store.load("log");

    fetcher.reject(0, new HTTPErrorResponse(403, { message: "no" }, {}));
    await logs;

    expect(store.getSlot("log").status).toBe("locked");
    expect(store.getSlot("log").lockedPermission).toBe(
      "Read Telemetry Service Log",
    );

    fetcher.resolveTraceIds(0, [traceIdOf(9)]);
    await settle();

    expect(fetcher.requests).toHaveLength(1);
    expect(store.getSlot("log").status).toBe("locked");
  });

  test("generation guard: a B that lands after dispose is dropped", async () => {
    const { store, fetcher } = makeStore({ traceIds: [traceIdOf(1)] });
    let notifications: number = 0;

    store.subscribe((): void => {
      notifications++;
    });

    const logs: Promise<void> = store.load("log");

    await settle();
    fetcher.resolve(0, listResult(makeLogs(2)));
    await settle();

    /* A is in; B is still in flight. */
    expect(store.getSlot("log").status).toBe("loading");

    store.dispose();
    fetcher.resolve(1, listResult(makeLogs(3)));
    await logs;
    await settle();

    expect(store.getRows("log")).toEqual([]);
    expect(store.getSlot("log").status).toBe("loading");
    expect(notifications).toBe(1);
  });

  test("the merged slot is truncated when A and B together overflow the cap", async () => {
    const { store, fetcher } = makeStore({ traceIds: [traceIdOf(1)] });
    const fromA: Array<Log> = [];
    const fromB: Array<Log> = [];

    for (let i: number = 0; i < 300; i++) {
      fromA.push(
        makeLog({ atMs: i, id: `a${i.toString().padStart(23, "0")}` }),
      );
      fromB.push(
        makeLog({ atMs: i, id: `b${i.toString().padStart(23, "0")}` }),
      );
    }

    const logs: Promise<void> = store.load("log");

    await settle();
    fetcher.resolve(0, listResult(fromA));
    fetcher.resolve(1, listResult(fromB));
    await logs;

    expect(store.getSlot("log").rowCount).toBe(
      REPLAY_BACKEND_SIGNALS_ROW_LIMIT,
    );
    expect(store.getSlot("log").isTruncated).toBe(true);
    expect(store.getRows("log")).toHaveLength(500);
  });

  test("B names at most 1000 ids: recording ids first, then header ids", async () => {
    const header: Array<string> = [];
    const recording: Array<string> = [];

    for (let i: number = 1; i <= 600; i++) {
      header.push(traceIdOf(i));
      recording.push(traceIdOf(10_000 + i));
    }

    const { store, fetcher } = makeStore({ traceIds: header });

    store.setRecordingTraceIds(recording);

    const spans: Promise<void> = store.load("span");

    await settle();

    const ids: Array<string> = namedIds(fetcher.requests[1]);

    expect(ids).toHaveLength(REPLAY_BACKEND_TRACE_IDS_CAP);
    expect(ids.slice(0, 600)).toEqual(recording);
    expect(ids.slice(600)).toEqual(header.slice(0, 400));

    fetcher.resolve(0, listResult([]));
    fetcher.resolve(1, listResult([]));
    await spans;
  });

  test("setSessionBounds replaces the header ids for the next load", async () => {
    const { store, fetcher } = makeStore({ traceIds: [traceIdOf(1)] });

    store.setSessionBounds({ traceIds: [traceIdOf(2), traceIdOf(3)] });

    const spans: Promise<void> = store.load("span");

    await settle();

    expect(namedIds(fetcher.requests[1])).toEqual([traceIdOf(2), traceIdOf(3)]);

    fetcher.resolve(0, listResult([]));
    fetcher.resolve(1, listResult([]));
    await spans;

    /* Omitting traceIds leaves them alone. */
    store.setSessionBounds({ isFinalized: true });

    const again: Promise<void> = store.load("span", { force: true });

    await settle();
    expect(namedIds(fetcher.requests[3])).toEqual([traceIdOf(2), traceIdOf(3)]);
    fetcher.resolve(2, listResult([]));
    fetcher.resolve(3, listResult([]));
    await again;

    store.setSessionBounds({ traceIds: [] });

    const none: Promise<void> = store.load("span", { force: true });

    await settle();
    expect(fetcher.requests).toHaveLength(5);
    fetcher.resolve(4, listResult([]));
    await none;
  });
});

describe("ReplayBackendSignalsStore: recording trace ids", () => {
  beforeEach(() => {
    /*
     * Only the debounce timer needs faking. The sinon backend jest 28 uses
     * cannot hijack the read-only `performance` global on current Node,
     * and promise continuations must keep running on the real queue.
     */
    jest.useFakeTimers({
      doNotFake: ["performance", "hrtime", "nextTick", "queueMicrotask"],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function loadReady(
    store: ReplayBackendSignalsStore,
    fetcher: FakeFetcher,
    kind: ReplayBackendSignalKind,
  ): Promise<void> {
    const loading: Promise<void> = store.load(kind);

    await settle();

    for (let i: number = 0; i < fetcher.deferreds.length; i++) {
      fetcher.resolve(i, listResult([]));
    }

    await loading;
    await settle();
  }

  test("growth after a slot is ready reloads it once the decoder has been quiet for the debounce", async () => {
    const { store, fetcher } = makeStore();

    await loadReady(store, fetcher, "span");
    expect(fetcher.requests).toHaveLength(1);

    store.setRecordingTraceIds([traceIdOf(1)]);
    jest.advanceTimersByTime(REPLAY_BACKEND_RECORDING_RELOAD_DEBOUNCE_MS - 1);
    await settle();
    expect(fetcher.requests).toHaveLength(1);

    /* Another chunk decodes: the debounce restarts. */
    store.setRecordingTraceIds([traceIdOf(1), traceIdOf(2)]);
    jest.advanceTimersByTime(REPLAY_BACKEND_RECORDING_RELOAD_DEBOUNCE_MS - 1);
    await settle();
    expect(fetcher.requests).toHaveLength(1);

    jest.advanceTimersByTime(1);
    await settle();

    /* One forced reload: A again plus B naming both new ids. */
    expect(fetcher.requests).toHaveLength(3);
    expect(store.getSlot("span").status).toBe("loading");
    expect(namedIds(fetcher.requests[2])).toEqual([traceIdOf(1), traceIdOf(2)]);
    expect(REPLAY_BACKEND_RECORDING_RELOAD_DEBOUNCE_MS).toBe(3000);

    fetcher.resolve(1, listResult([]));
    fetcher.resolve(
      2,
      listResult([makeSpan({ traceId: traceIdOf(1), spanId: "a", atMs: 1 })]),
    );
    await settle();

    expect(store.getSlot("span").status).toBe("ready");
    expect(store.getSlot("span").rowCount).toBe(1);

    /* Nothing new: no further reload. */
    store.setRecordingTraceIds([traceIdOf(2), traceIdOf(1)]);
    jest.advanceTimersByTime(REPLAY_BACKEND_RECORDING_RELOAD_DEBOUNCE_MS * 2);
    await settle();
    expect(fetcher.requests).toHaveLength(3);
  });

  test("only READY slots reload: idle, locked and failed slots keep their state", async () => {
    const { store, fetcher } = makeStore();

    const logs: Promise<void> = store.load("log");
    const spans: Promise<void> = store.load("span");

    fetcher.reject(0, new HTTPErrorResponse(403, { message: "no" }, {}));
    fetcher.reject(1, new HTTPErrorResponse(500, { message: "x" }, {}));
    await Promise.all([logs, spans]);

    expect(store.getSlot("log").status).toBe("locked");
    expect(store.getSlot("span").status).toBe("error");

    store.setRecordingTraceIds([traceIdOf(1)]);
    jest.advanceTimersByTime(REPLAY_BACKEND_RECORDING_RELOAD_DEBOUNCE_MS * 2);
    await settle();

    expect(fetcher.requests).toHaveLength(2);
    expect(store.getSlot("exception").status).toBe("idle");
  });

  test("ids the slot's read already named do not reload it; invalid ids are not growth", async () => {
    const { store, fetcher } = makeStore();

    store.setRecordingTraceIds([traceIdOf(1)]);
    await loadReady(store, fetcher, "span");

    /* A and B, B naming the id known before the load. */
    expect(fetcher.requests).toHaveLength(2);

    store.setRecordingTraceIds(["nonsense", "0".repeat(32)]);
    store.setRecordingTraceIds([traceIdOf(1).toUpperCase()]);
    jest.advanceTimersByTime(REPLAY_BACKEND_RECORDING_RELOAD_DEBOUNCE_MS * 2);
    await settle();

    expect(fetcher.requests).toHaveLength(2);
  });

  test("ids that arrive while a load is in flight reload it after it settles", async () => {
    const { store, fetcher } = makeStore();
    const spans: Promise<void> = store.load("span");

    store.setRecordingTraceIds([traceIdOf(4)]);
    fetcher.resolve(0, listResult([]));
    await spans;
    await settle();

    expect(fetcher.requests).toHaveLength(1);

    jest.advanceTimersByTime(REPLAY_BACKEND_RECORDING_RELOAD_DEBOUNCE_MS);
    await settle();

    expect(fetcher.requests).toHaveLength(3);
    expect(namedIds(fetcher.requests[2])).toEqual([traceIdOf(4)]);

    fetcher.resolve(1, listResult([]));
    fetcher.resolve(2, listResult([]));
    await settle();
  });

  test("logs reload too, reusing the finalized session's grouped read; unopened tabs stay idle", async () => {
    const { store, fetcher } = makeStore();

    fetcher.sessionTraceIds = [traceIdOf(7)];
    await loadReady(store, fetcher, "log");

    expect(fetcher.requests).toHaveLength(2);

    store.setRecordingTraceIds([traceIdOf(6)]);
    jest.advanceTimersByTime(REPLAY_BACKEND_RECORDING_RELOAD_DEBOUNCE_MS);
    await settle();

    expect(fetcher.traceIdRequests).toHaveLength(1);
    expect(fetcher.requests).toHaveLength(4);
    expect(namedIds(fetcher.requests[3])).toEqual([traceIdOf(6), traceIdOf(7)]);
    expect(store.getSlot("span").status).toBe("idle");
    expect(store.getSlot("exception").status).toBe("idle");

    fetcher.resolve(2, listResult([]));
    fetcher.resolve(3, listResult([]));
    await settle();
  });

  test("dispose cancels a pending reload, and a disposed store ignores new ids", async () => {
    const { store, fetcher } = makeStore();

    await loadReady(store, fetcher, "span");
    store.setRecordingTraceIds([traceIdOf(1)]);
    expect(jest.getTimerCount()).toBe(1);

    store.dispose();
    expect(jest.getTimerCount()).toBe(0);

    jest.advanceTimersByTime(REPLAY_BACKEND_RECORDING_RELOAD_DEBOUNCE_MS * 2);
    await settle();

    expect(fetcher.requests).toHaveLength(1);

    store.setRecordingTraceIds([traceIdOf(2)]);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("no slot loaded yet: growth schedules nothing, and the first load names the ids", async () => {
    const { store, fetcher } = makeStore();

    store.setRecordingTraceIds([traceIdOf(3)]);
    expect(jest.getTimerCount()).toBe(0);

    const spans: Promise<void> = store.load("span");

    await settle();
    expect(namedIds(fetcher.requests[1])).toEqual([traceIdOf(3)]);
    fetcher.resolve(0, listResult([]));
    fetcher.resolve(1, listResult([]));
    await spans;
  });

  test("past the cap a new recording id cannot reach a read, so it does not reload", async () => {
    const { store, fetcher } = makeStore();
    const ids: Array<string> = [];

    for (let i: number = 1; i <= REPLAY_BACKEND_TRACE_IDS_CAP; i++) {
      ids.push(traceIdOf(i));
    }

    store.setRecordingTraceIds(ids);
    await loadReady(store, fetcher, "span");

    expect(fetcher.requests).toHaveLength(2);

    store.setRecordingTraceIds([traceIdOf(REPLAY_BACKEND_TRACE_IDS_CAP + 1)]);
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(REPLAY_BACKEND_RECORDING_RELOAD_DEBOUNCE_MS * 2);
    await settle();

    expect(fetcher.requests).toHaveLength(2);
  });

  test("a failed B still counts as having named its ids, so a failing read cannot loop", async () => {
    const { store, fetcher } = makeStore();

    store.setRecordingTraceIds([traceIdOf(1)]);

    const spans: Promise<void> = store.load("span");

    await settle();
    fetcher.resolve(0, listResult([]));
    fetcher.reject(1, new HTTPErrorResponse(500, { message: "x" }, {}));
    await spans;

    jest.advanceTimersByTime(REPLAY_BACKEND_RECORDING_RELOAD_DEBOUNCE_MS * 3);
    await settle();

    expect(fetcher.requests).toHaveLength(2);
    expect(store.getSlot("span").status).toBe("ready");
  });
});
