import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  SESSION_REPLAY_SESSION_ID_BATCH_MAX,
  SESSION_REPLAY_SESSION_ID_MAX_LENGTH,
} from "Common/Types/Rum/SessionReplayApi";

/*
 * The shared session-id -> RumSession header lookup behind every inbound
 * replay link (log line, span panel, occurrence table). The contract:
 * one /resolve read per session id for the life of the page, an in-flight
 * read shared by concurrent callers, an empty answer cached as "no
 * recording", a failure NOT cached so the next caller retries, and a
 * batched form that fills the same cache.
 *
 * The read is the bespoke POST /telemetry/rum/session-replay/resolve.
 * RumSession has no crudApiPath, so the generic AnalyticsModelAPI list it
 * used to call threw before sending anything and every link silently
 * resolved to nothing - with a mocked getList these tests could not see it.
 * They now assert the request that actually leaves the browser.
 *
 * API is mocked before the module loads; the module also pulls in RouteMap
 * (via ReplayPlayerUrlState), which reads `window` on load, so the browser
 * stub is installed first and the imports are deferred.
 */

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(),
    },
  };
});

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "project-1" };
      },
    },
  };
});

const PROJECT_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const SESSION_A: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const SESSION_B: string = "b1b2c3d4e5f60718293a4b5c6d7e8f90";
const START_A: Date = new Date("2026-08-14T10:00:00.000Z");
const RESOLVE_ROUTE: string = "/telemetry/rum/session-replay/resolve";

type LookupModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/RumSessionLookup");
type UrlStateModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayPlayerUrlState");
type NavigationClass = (typeof import("Common/UI/Utils/Navigation"))["default"];

let lookup: LookupModule;
let urlState: UrlStateModule;
let postMock: jest.Mock;

interface WireSession {
  sessionId: string;
  rumApplicationId: string;
  startTime?: string | undefined;
  startTimeUnixMs?: number | string | undefined;
}

interface PostedRequest {
  url: { toString(): string };
  data: JSONObject;
  headers: Record<string, string>;
}

/* The route's response body, as the server serialises it. */
function resolved(rows: Array<WireSession>): HTTPResponse<JSONObject> {
  return new HTTPResponse(
    200,
    {
      sessions: rows as unknown as JSONObject,
      isApplicationScopeTruncated: false,
    },
    {},
  );
}

function posted(call: number = 0): PostedRequest {
  const request: PostedRequest | undefined = postMock.mock.calls[call]?.[0] as
    | PostedRequest
    | undefined;

  if (!request) {
    throw new Error(`API.post call ${call} was not made`);
  }

  return request;
}

function postedSessionIds(call: number = 0): Array<string> {
  return posted(call).data["sessionIds"] as Array<string>;
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

  const api: { default: { post: jest.Mock } } = (await import(
    "Common/UI/Utils/API/API"
  )) as unknown as { default: { post: jest.Mock } };

  postMock = api.default.post;

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
  postMock.mockReset();
  lookup.clearRumSessionLookupCache();
});

describe("lookupRumSessionBySessionId", () => {
  test("posts the id to /resolve with the project headers and reads the three link facts", async () => {
    postMock.mockResolvedValue(
      resolved([
        {
          sessionId: SESSION_A,
          rumApplicationId: APP_ID,
          startTime: START_A.toISOString(),
          startTimeUnixMs: START_A.getTime(),
        },
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
    expect(postMock).toHaveBeenCalledTimes(1);

    const request: PostedRequest = posted();

    expect(new URL(request.url.toString()).pathname).toMatch(
      new RegExp(`${RESOLVE_ROUTE}$`),
    );
    expect(lookup.RUM_SESSION_RESOLVE_ROUTE).toBe(RESOLVE_ROUTE);
    /* Exactly the wire body the route reads - no application, no project. */
    expect(request.data).toEqual({ sessionIds: [SESSION_A] });
    expect(request.headers).toEqual({ tenantid: "project-1" });
  });

  test("falls back to the ISO start time, and ClickHouse-quoted numbers parse", async () => {
    postMock.mockResolvedValueOnce(
      resolved([
        {
          sessionId: SESSION_A,
          rumApplicationId: APP_ID,
          startTime: START_A.toISOString(),
        },
      ]),
    );

    expect(
      (await lookup.lookupRumSessionBySessionId(SESSION_A))?.startTime,
    ).toEqual(START_A);

    postMock.mockResolvedValueOnce(
      resolved([
        {
          sessionId: SESSION_B,
          rumApplicationId: APP_ID,
          startTimeUnixMs: String(START_A.getTime()),
        },
      ]),
    );

    expect(
      (await lookup.lookupRumSessionBySessionId(SESSION_B))?.startTime,
    ).toEqual(START_A);
  });

  test("a second lookup of the same id is served from the cache", async () => {
    postMock.mockResolvedValue(
      resolved([{ sessionId: SESSION_A, rumApplicationId: APP_ID }]),
    );

    await lookup.lookupRumSessionBySessionId(SESSION_A);
    await lookup.lookupRumSessionBySessionId(` ${SESSION_A} `);

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postedSessionIds()).toEqual([SESSION_A]);
    expect(lookup.getRumSessionLookupCacheSize()).toBe(1);
  });

  test("concurrent callers share one in-flight read", async () => {
    const pending: ReturnType<typeof deferred<HTTPResponse<JSONObject>>> =
      deferred<HTTPResponse<JSONObject>>();

    postMock.mockReturnValue(pending.promise);

    const first: ReturnType<typeof lookup.lookupRumSessionBySessionId> =
      lookup.lookupRumSessionBySessionId(SESSION_A);
    const second: ReturnType<typeof lookup.lookupRumSessionBySessionId> =
      lookup.lookupRumSessionBySessionId(SESSION_A);

    expect(postMock).toHaveBeenCalledTimes(1);

    pending.resolve(
      resolved([{ sessionId: SESSION_A, rumApplicationId: APP_ID }]),
    );

    expect((await first)?.rumApplicationId).toBe(APP_ID);
    expect((await second)?.rumApplicationId).toBe(APP_ID);
  });

  test("an empty result resolves to undefined and is cached as such", async () => {
    postMock.mockResolvedValue(resolved([]));

    expect(await lookup.lookupRumSessionBySessionId(SESSION_A)).toBeUndefined();
    expect(await lookup.lookupRumSessionBySessionId(SESSION_A)).toBeUndefined();
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  test("a body without a sessions array is no recording, not a crash", async () => {
    postMock.mockResolvedValue(new HTTPResponse(200, {}, {}));

    expect(await lookup.lookupRumSessionBySessionId(SESSION_A)).toBeUndefined();
  });

  test("a row without an application id is no anchor; a blank id never hits the network", async () => {
    postMock.mockResolvedValue(
      resolved([{ sessionId: SESSION_A, rumApplicationId: "" }]),
    );

    expect(await lookup.lookupRumSessionBySessionId(SESSION_A)).toBeUndefined();

    for (const blank of ["", "   ", null, undefined]) {
      expect(await lookup.lookupRumSessionBySessionId(blank)).toBeUndefined();
    }

    expect(postMock).toHaveBeenCalledTimes(1);
  });

  test("an unsolicited row never anchors the id that was asked about", async () => {
    postMock.mockResolvedValue(
      resolved([{ sessionId: SESSION_B, rumApplicationId: APP_ID }]),
    );

    expect(await lookup.lookupRumSessionBySessionId(SESSION_A)).toBeUndefined();
    /* Nor is it cached under its own id: SESSION_B was never asked for. */
    expect(lookup.getRumSessionLookupCacheSize()).toBe(1);
  });

  test("a failed read rejects and is not cached, so the next caller retries", async () => {
    postMock.mockResolvedValueOnce(
      new HTTPErrorResponse(503, { message: "Service Unavailable" }, {}),
    );

    await expect(
      lookup.lookupRumSessionBySessionId(SESSION_A),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
    expect(lookup.getRumSessionLookupCacheSize()).toBe(0);

    postMock.mockRejectedValueOnce(new Error("network down"));

    await expect(lookup.lookupRumSessionBySessionId(SESSION_A)).rejects.toThrow(
      "network down",
    );
    expect(lookup.getRumSessionLookupCacheSize()).toBe(0);

    postMock.mockResolvedValueOnce(
      resolved([{ sessionId: SESSION_A, rumApplicationId: APP_ID }]),
    );

    expect(
      (await lookup.lookupRumSessionBySessionId(SESSION_A))?.rumApplicationId,
    ).toBe(APP_ID);
    expect(postMock).toHaveBeenCalledTimes(3);
  });

  test("an unparseable start time is null, not an invalid Date", async () => {
    postMock.mockResolvedValue(
      resolved([
        {
          sessionId: SESSION_A,
          rumApplicationId: APP_ID,
          startTime: "not-a-date",
        },
      ]),
    );

    expect(
      (await lookup.lookupRumSessionBySessionId(SESSION_A))?.startTime,
    ).toBeNull();
  });

  test("an id longer than any replay route reads is no recording, without a request", async () => {
    const overlong: string = "x".repeat(
      SESSION_REPLAY_SESSION_ID_MAX_LENGTH + 1,
    );

    expect(await lookup.lookupRumSessionBySessionId(overlong)).toBeUndefined();
    expect(await lookup.lookupRumSessionBySessionId(overlong)).toBeUndefined();
    expect(postMock).not.toHaveBeenCalled();
  });
});

describe("lookupRumSessionsBySessionIds", () => {
  test("fetches only the ids not already cached, in one read, and caches each answer", async () => {
    postMock.mockResolvedValueOnce(
      resolved([{ sessionId: SESSION_A, rumApplicationId: APP_ID }]),
    );
    await lookup.lookupRumSessionBySessionId(SESSION_A);

    postMock.mockResolvedValueOnce(
      resolved([{ sessionId: SESSION_B, rumApplicationId: APP_ID }]),
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

    expect(postMock).toHaveBeenCalledTimes(2);
    /* Deduplicated, trimmed, and without the id already cached. */
    expect(postedSessionIds(1)).toEqual([SESSION_B]);
    expect(Array.from(found.keys()).sort()).toEqual(
      [SESSION_A, SESSION_B].sort(),
    );

    /* The batch answer now serves single lookups without a network call. */
    expect(
      (await lookup.lookupRumSessionBySessionId(SESSION_B))?.rumApplicationId,
    ).toBe(APP_ID);
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  test("several missing ids go out in one request and unknown ids are cached as absent", async () => {
    postMock.mockResolvedValueOnce(
      resolved([{ sessionId: SESSION_A, rumApplicationId: APP_ID }]),
    );

    const found: Map<
      string,
      Awaited<ReturnType<typeof lookup.lookupRumSessionBySessionId>>
    > = await lookup.lookupRumSessionsBySessionIds([SESSION_A, SESSION_B]);

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postedSessionIds()).toEqual([SESSION_A, SESSION_B]);
    expect(found.size).toBe(1);
    expect(found.get(SESSION_A)?.rumApplicationId).toBe(APP_ID);

    expect(await lookup.lookupRumSessionBySessionId(SESSION_B)).toBeUndefined();
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  test("a page larger than the server's batch cap is split into requests it accepts", async () => {
    const ids: Array<string> = Array.from(
      { length: SESSION_REPLAY_SESSION_ID_BATCH_MAX + 5 },
      (_value: unknown, index: number): string => {
        return `session-${index}`;
      },
    );

    postMock.mockImplementation(
      async (request: PostedRequest): Promise<HTTPResponse<JSONObject>> => {
        return resolved(
          (request.data["sessionIds"] as Array<string>).map(
            (sessionId: string): WireSession => {
              return { sessionId: sessionId, rumApplicationId: APP_ID };
            },
          ),
        );
      },
    );

    const found: Map<
      string,
      Awaited<ReturnType<typeof lookup.lookupRumSessionBySessionId>>
    > = await lookup.lookupRumSessionsBySessionIds(ids);

    expect(postMock).toHaveBeenCalledTimes(2);
    expect(postedSessionIds(0)).toHaveLength(
      SESSION_REPLAY_SESSION_ID_BATCH_MAX,
    );
    expect(postedSessionIds(1)).toEqual(
      ids.slice(SESSION_REPLAY_SESSION_ID_BATCH_MAX),
    );
    expect(found.size).toBe(ids.length);
  });

  test("an overlong id is answered locally and does not fail the rest of its page", async () => {
    const overlong: string = "x".repeat(
      SESSION_REPLAY_SESSION_ID_MAX_LENGTH + 1,
    );

    postMock.mockResolvedValueOnce(
      resolved([{ sessionId: SESSION_A, rumApplicationId: APP_ID }]),
    );

    const found: Map<
      string,
      Awaited<ReturnType<typeof lookup.lookupRumSessionBySessionId>>
    > = await lookup.lookupRumSessionsBySessionIds([SESSION_A, overlong]);

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postedSessionIds()).toEqual([SESSION_A]);
    expect(Array.from(found.keys())).toEqual([SESSION_A]);
    expect(await lookup.lookupRumSessionBySessionId(overlong)).toBeUndefined();
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  test("a failed batch rejects and leaves nothing cached", async () => {
    postMock.mockResolvedValueOnce(
      new HTTPErrorResponse(503, { message: "Service Unavailable" }, {}),
    );

    await expect(
      lookup.lookupRumSessionsBySessionIds([SESSION_A, SESSION_B]),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
    expect(lookup.getRumSessionLookupCacheSize()).toBe(0);
  });

  test("no ids means no read", async () => {
    expect((await lookup.lookupRumSessionsBySessionIds([])).size).toBe(0);
    expect((await lookup.lookupRumSessionsBySessionIds(null)).size).toBe(0);
    expect(postMock).not.toHaveBeenCalled();
  });
});

describe("resolveReplayMomentRouteForSession", () => {
  test("resolves the application and builds the moment route through the shared builder", async () => {
    postMock.mockResolvedValue(
      resolved([{ sessionId: SESSION_A, rumApplicationId: APP_ID }]),
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
    postMock.mockResolvedValueOnce(resolved([]));

    expect(
      await lookup.resolveReplayMomentRouteForSession({
        sessionId: SESSION_A,
        at: Date.now(),
      }),
    ).toBeUndefined();

    postMock.mockResolvedValueOnce(
      new HTTPErrorResponse(503, { message: "Service Unavailable" }, {}),
    );

    await expect(
      lookup.resolveReplayMomentRouteForSession({
        sessionId: SESSION_B,
        at: Date.now(),
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });
});
