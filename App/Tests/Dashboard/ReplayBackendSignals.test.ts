import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
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
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignalTypes";
import {
  REPLAY_BACKEND_SIGNALS_LIVE_REFRESH_MS,
  REPLAY_BACKEND_SIGNALS_WINDOW_PADDING_MS,
  REPLAY_BACKEND_SIGNAL_PERMISSIONS,
  ReplayBackendListFetcher,
  ReplayBackendListRequest,
  ReplayBackendSignalsSnapshot,
  ReplayBackendSignalsStore,
  buildBackendExceptionsRequest,
  buildBackendLogsRequest,
  buildBackendSignalsWindow,
  buildBackendSpansRequest,
  classifyBackendSignalsFailure,
  isBackendRefreshDue,
  makeIdleBackendSignalsState,
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

/* A fetcher whose every call returns a controllable promise, in order. */
class FakeFetcher {
  public readonly requests: Array<
    ReplayBackendListRequest<AnalyticsBaseModel>
  > = [];
  public readonly deferreds: Array<Deferred<ListResult<AnalyticsBaseModel>>> =
    [];

  public readonly fetchList: ReplayBackendListFetcher = <
    T extends AnalyticsBaseModel,
  >(
    request: ReplayBackendListRequest<T>,
  ): Promise<ListResult<T>> => {
    const deferred: Deferred<ListResult<AnalyticsBaseModel>> =
      defer<ListResult<AnalyticsBaseModel>>();

    this.requests.push(request as ReplayBackendListRequest<AnalyticsBaseModel>);
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
}

function makeStore(args?: {
  fetcher?: FakeFetcher;
  isFinalized?: boolean;
  endTimeUnixMs?: number | null;
  now?: () => number;
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

    expect(ModelAPI.getList).toHaveBeenCalledTimes(1);

    const call: Record<string, unknown> = (ModelAPI.getList as jest.Mock).mock
      .calls[0]?.[0] as Record<string, unknown>;

    expect(call["modelType"]).toBe(Log);
    expect(call["limit"]).toBe(500);
    expect(call["skip"]).toBe(0);
    expect((call["query"] as Record<string, unknown>)["sessionId"]).toBe(
      "sess-2",
    );
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
