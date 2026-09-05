import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The shared session-id -> RumSession header lookup behind every inbound
 * replay link (log line, span panel, occurrence table). The contract:
 * one AnalyticsModelAPI read per session id for the life of the page, an
 * in-flight read shared by concurrent callers, an empty answer cached as
 * "no recording", a failure NOT cached so the next caller retries, and a
 * batched form that fills the same cache.
 *
 * AnalyticsModelAPI is mocked before the module loads; the module also pulls
 * in RouteMap (via ReplayPlayerUrlState), which reads `window` on load, so
 * the browser stub is installed first and the imports are deferred.
 */

jest.mock("Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

const PROJECT_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const SESSION_A: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const SESSION_B: string = "b1b2c3d4e5f60718293a4b5c6d7e8f90";
const START_A: Date = new Date("2026-08-14T10:00:00.000Z");

type LookupModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/RumSessionLookup");
type UrlStateModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayPlayerUrlState");
type NavigationClass = (typeof import("Common/UI/Utils/Navigation"))["default"];

let lookup: LookupModule;
let urlState: UrlStateModule;
let getListMock: jest.Mock;

interface FakeSessionRow {
  sessionId: string;
  rumApplicationId: string;
  startTime?: Date | string | undefined;
}

function listResult(rows: Array<FakeSessionRow>): {
  data: Array<FakeSessionRow>;
  count: number;
} {
  return { data: rows, count: rows.length };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve: (value: T) => void = (): void => {
    // replaced below
  };
  let reject: (error: unknown) => void = (): void => {
    // replaced below
  };
  const promise: Promise<T> = new Promise<T>(
    (res: (value: T) => void, rej: (error: unknown) => void): void => {
      resolve = res;
      reject = rej;
    },
  );

  return { promise, resolve, reject };
}

beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: {
      pathname: `/dashboard/${PROJECT_ID}/rum/${APP_ID}/session-replay/${SESSION_A}`,
      search: "",
      hash: "",
    },
    history: {
      state: null,
      replaceState: (): void => {
        // never asserted on
      },
    },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  const analyticsModelApi: { default: { getList: jest.Mock } } = (await import(
    "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI"
  )) as unknown as { default: { getList: jest.Mock } };

  getListMock = analyticsModelApi.default.getList;

  lookup = await import(
    "../../FeatureSet/Dashboard/src/Utils/RumSessionLookup"
  );
  urlState = await import(
    "../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayPlayerUrlState"
  );

  const Navigation: NavigationClass = (
    await import("Common/UI/Utils/Navigation")
  ).default;

  Navigation.setLocation({
    pathname: `/dashboard/${PROJECT_ID}/rum/${APP_ID}/session-replay/${SESSION_A}`,
  } as unknown as Parameters<typeof Navigation.setLocation>[0]);
});

beforeEach(() => {
  getListMock.mockReset();
  lookup.clearRumSessionLookupCache();
});

describe("lookupRumSessionBySessionId", () => {
  test("reads the header once, selecting the three fields a link needs", async () => {
    getListMock.mockResolvedValue(
      listResult([
        { sessionId: SESSION_A, rumApplicationId: APP_ID, startTime: START_A },
      ]),
    );

    const result: Awaited<
      ReturnType<typeof lookup.lookupRumSessionBySessionId>
    > = await lookup.lookupRumSessionBySessionId(SESSION_A);

    expect(result).toEqual({
      sessionId: SESSION_A,
      rumApplicationId: APP_ID,
      startTime: START_A,
    });
    expect(getListMock).toHaveBeenCalledTimes(1);

    const call: Record<string, unknown> = getListMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(call["query"]).toEqual({ sessionId: SESSION_A });
    expect(call["select"]).toEqual({
      sessionId: true,
      rumApplicationId: true,
      startTime: true,
    });
    expect(call["limit"]).toBe(1);
  });

  test("a second lookup of the same id is served from the cache", async () => {
    getListMock.mockResolvedValue(
      listResult([{ sessionId: SESSION_A, rumApplicationId: APP_ID }]),
    );

    await lookup.lookupRumSessionBySessionId(SESSION_A);
    await lookup.lookupRumSessionBySessionId(` ${SESSION_A} `);

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(lookup.getRumSessionLookupCacheSize()).toBe(1);
  });

  test("concurrent callers share one in-flight read", async () => {
    const pending: ReturnType<
      typeof deferred<{ data: Array<FakeSessionRow>; count: number }>
    > = deferred<{ data: Array<FakeSessionRow>; count: number }>();

    getListMock.mockReturnValue(pending.promise);

    const first: ReturnType<typeof lookup.lookupRumSessionBySessionId> =
      lookup.lookupRumSessionBySessionId(SESSION_A);
    const second: ReturnType<typeof lookup.lookupRumSessionBySessionId> =
      lookup.lookupRumSessionBySessionId(SESSION_A);

    expect(getListMock).toHaveBeenCalledTimes(1);

    pending.resolve(
      listResult([{ sessionId: SESSION_A, rumApplicationId: APP_ID }]),
    );

    expect((await first)?.rumApplicationId).toBe(APP_ID);
    expect((await second)?.rumApplicationId).toBe(APP_ID);
  });

  test("an empty result resolves to undefined and is cached as such", async () => {
    getListMock.mockResolvedValue(listResult([]));

    expect(await lookup.lookupRumSessionBySessionId(SESSION_A)).toBeUndefined();
    expect(await lookup.lookupRumSessionBySessionId(SESSION_A)).toBeUndefined();
    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("a row without an application id is no anchor; a blank id never hits the network", async () => {
    getListMock.mockResolvedValue(
      listResult([{ sessionId: SESSION_A, rumApplicationId: "" }]),
    );

    expect(await lookup.lookupRumSessionBySessionId(SESSION_A)).toBeUndefined();

    for (const blank of ["", "   ", null, undefined]) {
      expect(await lookup.lookupRumSessionBySessionId(blank)).toBeUndefined();
    }

    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("a failed read rejects and is not cached, so the next caller retries", async () => {
    getListMock.mockRejectedValueOnce(new Error("503"));

    await expect(lookup.lookupRumSessionBySessionId(SESSION_A)).rejects.toThrow(
      "503",
    );
    expect(lookup.getRumSessionLookupCacheSize()).toBe(0);

    getListMock.mockResolvedValueOnce(
      listResult([{ sessionId: SESSION_A, rumApplicationId: APP_ID }]),
    );

    expect(
      (await lookup.lookupRumSessionBySessionId(SESSION_A))?.rumApplicationId,
    ).toBe(APP_ID);
    expect(getListMock).toHaveBeenCalledTimes(2);
  });

  test("an unparseable start time is null, not an invalid Date", async () => {
    getListMock.mockResolvedValue(
      listResult([
        { sessionId: SESSION_A, rumApplicationId: APP_ID, startTime: "" },
      ]),
    );

    expect(
      (await lookup.lookupRumSessionBySessionId(SESSION_A))?.startTime,
    ).toBeNull();
  });
});

describe("lookupRumSessionsBySessionIds", () => {
  test("fetches only the ids not already cached, in one Includes read, and caches each answer", async () => {
    getListMock.mockResolvedValueOnce(
      listResult([{ sessionId: SESSION_A, rumApplicationId: APP_ID }]),
    );
    await lookup.lookupRumSessionBySessionId(SESSION_A);

    getListMock.mockResolvedValueOnce(
      listResult([{ sessionId: SESSION_B, rumApplicationId: APP_ID }]),
    );

    const found: Map<
      string,
      Awaited<ReturnType<typeof lookup.lookupRumSessionBySessionId>>
    > = await lookup.lookupRumSessionsBySessionIds([
      SESSION_A,
      SESSION_B,
      SESSION_B,
      "",
    ]);

    expect(getListMock).toHaveBeenCalledTimes(2);

    const batchCall: Record<string, unknown> = getListMock.mock
      .calls[1]![0] as Record<string, unknown>;

    /* A single missing id goes out as an equality, not a one-element Includes. */
    expect(batchCall["query"]).toEqual({ sessionId: SESSION_B });
    expect(Array.from(found.keys()).sort()).toEqual(
      [SESSION_A, SESSION_B].sort(),
    );

    /* The batch answer now serves single lookups without a network call. */
    expect(
      (await lookup.lookupRumSessionBySessionId(SESSION_B))?.rumApplicationId,
    ).toBe(APP_ID);
    expect(getListMock).toHaveBeenCalledTimes(2);
  });

  test("two or more missing ids use an Includes query and unknown ids are cached as absent", async () => {
    getListMock.mockResolvedValueOnce(
      listResult([{ sessionId: SESSION_A, rumApplicationId: APP_ID }]),
    );

    const found: Map<
      string,
      Awaited<ReturnType<typeof lookup.lookupRumSessionBySessionId>>
    > = await lookup.lookupRumSessionsBySessionIds([SESSION_A, SESSION_B]);

    const call: Record<string, unknown> = getListMock.mock
      .calls[0]![0] as Record<string, unknown>;
    const query: { sessionId: { toString(): string } } = call["query"] as {
      sessionId: { toString(): string };
    };

    expect(query.sessionId.constructor.name).toBe("Includes");
    expect(found.size).toBe(1);
    expect(found.get(SESSION_A)?.rumApplicationId).toBe(APP_ID);

    expect(await lookup.lookupRumSessionBySessionId(SESSION_B)).toBeUndefined();
    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("a failed batch rejects and leaves nothing cached", async () => {
    getListMock.mockRejectedValueOnce(new Error("503"));

    await expect(
      lookup.lookupRumSessionsBySessionIds([SESSION_A, SESSION_B]),
    ).rejects.toThrow("503");
    expect(lookup.getRumSessionLookupCacheSize()).toBe(0);
  });

  test("no ids means no read", async () => {
    expect((await lookup.lookupRumSessionsBySessionIds([])).size).toBe(0);
    expect((await lookup.lookupRumSessionsBySessionIds(null)).size).toBe(0);
    expect(getListMock).not.toHaveBeenCalled();
  });
});

describe("resolveReplayMomentRouteForSession", () => {
  test("resolves the application and builds the moment route through the shared builder", async () => {
    getListMock.mockResolvedValue(
      listResult([{ sessionId: SESSION_A, rumApplicationId: APP_ID }]),
    );

    const at: Date = new Date("2026-08-14T10:05:00.000Z");
    const route: Awaited<
      ReturnType<typeof lookup.resolveReplayMomentRouteForSession>
    > = await lookup.resolveReplayMomentRouteForSession({
      sessionId: SESSION_A,
      at: at,
      signal: "log:0193c0de-4444-4aaa-8bbb-000000000004",
      rail: "logs",
    });

    expect(route).toBeDefined();

    const url: URL = new URL(`https://example.com${route!.toString()}`);

    expect(url.pathname).toBe(
      `/dashboard/${PROJECT_ID}/rum/${APP_ID}/session-replay/${SESSION_A}`,
    );
    expect(url.searchParams.get("at")).toBe(
      String(at.getTime() - urlState.REPLAY_MOMENT_PRE_ROLL_MS),
    );
    expect(url.searchParams.get("signal")).toBe(
      "log:0193c0de-4444-4aaa-8bbb-000000000004",
    );
    expect(url.searchParams.get("rail")).toBe("logs");
  });

  test("resolves to undefined for a session with no recording, and rejects on a failed lookup", async () => {
    getListMock.mockResolvedValueOnce(listResult([]));

    expect(
      await lookup.resolveReplayMomentRouteForSession({
        sessionId: SESSION_A,
        at: Date.now(),
      }),
    ).toBeUndefined();

    getListMock.mockRejectedValueOnce(new Error("503"));

    await expect(
      lookup.resolveReplayMomentRouteForSession({
        sessionId: SESSION_B,
        at: Date.now(),
      }),
    ).rejects.toThrow("503");
  });
});
