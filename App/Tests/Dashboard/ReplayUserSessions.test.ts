import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import type {
  ReplayUserSessionDescription,
  ReplayUserSessionItem,
  ReplayUserSessionsWindow,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayUserSessions";

/*
 * "This user's other sessions" in the player header
 * (github.com/OneUptime/oneuptime/issues/3705): which key links a
 * session to its siblings, the 30-day window anchored on the session,
 * the merge of the per-key lists (dedupe, the current session always
 * present, newest first, a stable tiebreak), the older/newer lookup at
 * the ends, the row copy, the defensive row parse, and the two list
 * requests the fetch makes.
 *
 * API and ModelAPI are mocked before the module loads; the module also
 * pulls in Common/UI/Config, which reads `window` on load, so the browser
 * stub is installed first and the import is deferred - the same pattern
 * as RumSessionLookup.test.ts.
 */

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(),
      getFriendlyMessage: (error: unknown): string => {
        return String(error);
      },
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

const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const VISITOR: string = "7f3a2b1c9d8e4f5a6b7c8d9e0f1a2b3c";
const USER_KEY: string =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const NOW: number = Date.parse("2026-09-05T10:00:00.000Z");
const DAY_MS: number = 24 * 60 * 60 * 1000;

type UserSessionsModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayUserSessions");

let userSessions: UserSessionsModule;
let postMock: jest.Mock;

function item(
  sessionId: string,
  startTimeUnixMs: number,
  overrides?: Partial<ReplayUserSessionItem>,
): ReplayUserSessionItem {
  return {
    sessionId: sessionId,
    startTimeUnixMs: startTimeUnixMs,
    durationMs: 60_000,
    entryUrl: "https://app.acme.com/checkout",
    browserName: "Chrome",
    deviceType: "desktop",
    hasError: false,
    errorCount: 0,
    isFinalized: true,
    identifiedUserKey: USER_KEY,
    visitorId: VISITOR,
    identifiedUserLabel: "jane@acme.com",
    ...overrides,
  };
}

/* One list row as /list serialises it, counters quoted the way ClickHouse does. */
function wireRow(overrides?: JSONObject): JSONObject {
  return {
    sessionId: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
    rumApplicationId: APP_ID,
    startTime: "2026-09-05T09:00:00.000Z",
    startTimeUnixMs: String(NOW - 60 * 60 * 1000),
    durationMs: "252000",
    isFinalized: "1",
    hasError: 1,
    errorCount: "2",
    entryUrl: "https://app.acme.com/checkout?step=2",
    browserName: "Chrome",
    deviceType: "desktop",
    identifiedUserKey: USER_KEY,
    visitorId: VISITOR,
    identifiedUserLabel: "jane@acme.com",
    ...overrides,
  };
}

beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: {
      state: null,
      replaceState: (): void => {
        /* never asserted on */
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
          /* no-op */
        },
        removeItem: (): void => {
          /* no-op */
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

  userSessions = await import(
    "../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayUserSessions"
  );
});

beforeEach(() => {
  postMock.mockReset();
});

describe("resolveReplayUserSessionsKind", () => {
  test("the identity key wins over the visitor id", () => {
    expect(
      userSessions.resolveReplayUserSessionsKind({
        identifiedUserKey: USER_KEY,
        visitorId: VISITOR,
      }),
    ).toBe("identified");
    expect(
      userSessions.resolveReplayUserSessionsKind({
        identifiedUserKey: USER_KEY,
        visitorId: "",
      }),
    ).toBe("identified");
  });

  test("an anonymous session with a visitor id follows the browser", () => {
    expect(
      userSessions.resolveReplayUserSessionsKind({
        identifiedUserKey: "",
        visitorId: VISITOR,
      }),
    ).toBe("visitor");
  });

  test("neither key means nothing can be looked up", () => {
    expect(
      userSessions.resolveReplayUserSessionsKind({
        identifiedUserKey: "",
        visitorId: "",
      }),
    ).toBe("none");
  });
});

describe("buildReplayUserSessionsWindow", () => {
  test("spans thirty days before the session's start, up to now", () => {
    const start: number = NOW - 3 * DAY_MS;
    const window: ReplayUserSessionsWindow =
      userSessions.buildReplayUserSessionsWindow(start, NOW);

    expect(window.startTime.getTime()).toBe(
      start - userSessions.REPLAY_USER_SESSIONS_WINDOW_MS,
    );
    expect(window.endTime.getTime()).toBe(NOW);
    expect(userSessions.REPLAY_USER_SESSIONS_WINDOW_MS).toBe(30 * DAY_MS);
  });

  test("the end is never before the session's own start", () => {
    /* A device clock ahead of the server's puts the start in the future. */
    const start: number = NOW + 5 * 60 * 1000;
    const window: ReplayUserSessionsWindow =
      userSessions.buildReplayUserSessionsWindow(start, NOW);

    expect(window.endTime.getTime()).toBe(start);
    expect(window.startTime.getTime()).toBe(
      start - userSessions.REPLAY_USER_SESSIONS_WINDOW_MS,
    );
  });

  test("a manifest without a clock falls back to a window ending now", () => {
    const window: ReplayUserSessionsWindow =
      userSessions.buildReplayUserSessionsWindow(null, NOW);

    expect(window.endTime.getTime()).toBe(NOW);
    expect(window.startTime.getTime()).toBe(
      NOW - userSessions.REPLAY_USER_SESSIONS_WINDOW_MS,
    );
  });
});

describe("mergeReplayUserSessions", () => {
  const current: ReplayUserSessionItem = item("current", NOW - 2 * DAY_MS);

  test("unions the per-key lists, drops duplicates and sorts newest first", () => {
    const merged: Array<ReplayUserSessionItem> =
      userSessions.mergeReplayUserSessions(
        [
          [item("b", NOW - 1 * DAY_MS), item("current", NOW - 2 * DAY_MS)],
          [item("a", NOW - 3 * DAY_MS), item("b", NOW - 1 * DAY_MS)],
        ],
        current,
      );

    expect(
      merged.map((entry: ReplayUserSessionItem): string => {
        return entry.sessionId;
      }),
    ).toEqual(["b", "current", "a"]);
  });

  test("inserts the current session when neither list returned it", () => {
    const merged: Array<ReplayUserSessionItem> =
      userSessions.mergeReplayUserSessions(
        [[item("b", NOW - 1 * DAY_MS)], [item("a", NOW - 3 * DAY_MS)]],
        current,
      );

    expect(
      merged.map((entry: ReplayUserSessionItem): string => {
        return entry.sessionId;
      }),
    ).toEqual(["b", "current", "a"]);
  });

  test("a fetched row wins over the manifest-built stand-in", () => {
    const fetched: ReplayUserSessionItem = item("current", NOW - 2 * DAY_MS, {
      isFinalized: false,
      errorCount: 3,
    });
    const merged: Array<ReplayUserSessionItem> =
      userSessions.mergeReplayUserSessions([[fetched]], {
        ...current,
        isFinalized: true,
        errorCount: 0,
      });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.isFinalized).toBe(false);
    expect(merged[0]?.errorCount).toBe(3);
  });

  test("orders equal start times by session id so the list is stable", () => {
    const first: Array<ReplayUserSessionItem> =
      userSessions.mergeReplayUserSessions(
        [[item("zzz", NOW), item("aaa", NOW), item("mmm", NOW)]],
        item("aaa", NOW),
      );
    const second: Array<ReplayUserSessionItem> =
      userSessions.mergeReplayUserSessions(
        [[item("mmm", NOW), item("zzz", NOW)], [item("aaa", NOW)]],
        item("zzz", NOW),
      );

    const ids: (list: Array<ReplayUserSessionItem>) => Array<string> = (
      list: Array<ReplayUserSessionItem>,
    ): Array<string> => {
      return list.map((entry: ReplayUserSessionItem): string => {
        return entry.sessionId;
      });
    };

    expect(ids(first)).toEqual(["aaa", "mmm", "zzz"]);
    expect(ids(second)).toEqual(ids(first));
  });

  test("ignores rows without a session id", () => {
    const merged: Array<ReplayUserSessionItem> =
      userSessions.mergeReplayUserSessions([[item("", NOW)]], current);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.sessionId).toBe("current");
  });
});

describe("findAdjacentUserSessions", () => {
  const list: Array<ReplayUserSessionItem> = [
    item("newest", NOW),
    item("middle", NOW - DAY_MS),
    item("oldest", NOW - 2 * DAY_MS),
  ];

  test("in the middle, both neighbours exist", () => {
    const adjacent: ReturnType<typeof userSessions.findAdjacentUserSessions> =
      userSessions.findAdjacentUserSessions(list, "middle");

    expect(adjacent.newer?.sessionId).toBe("newest");
    expect(adjacent.older?.sessionId).toBe("oldest");
  });

  test("at the newest end there is nothing newer; at the oldest, nothing older", () => {
    expect(userSessions.findAdjacentUserSessions(list, "newest")).toEqual({
      newer: null,
      older: list[1],
    });
    expect(userSessions.findAdjacentUserSessions(list, "oldest")).toEqual({
      newer: list[1],
      older: null,
    });
  });

  test("a single session has no neighbours", () => {
    expect(
      userSessions.findAdjacentUserSessions([item("only", NOW)], "only"),
    ).toEqual({ newer: null, older: null });
  });

  test("a session not in the list goes nowhere, not to the ends", () => {
    expect(userSessions.findAdjacentUserSessions(list, "missing")).toEqual({
      newer: null,
      older: null,
    });
    expect(userSessions.findAdjacentUserSessions([], "missing")).toEqual({
      newer: null,
      older: null,
    });
  });
});

describe("describeReplayUserSession", () => {
  test("reads the path off an absolute entry URL and keeps a raw value as it is", () => {
    const absolute: ReplayUserSessionDescription =
      userSessions.describeReplayUserSession(
        item("a", NOW - 5 * 60 * 1000, {
          entryUrl: "https://app.acme.com/checkout?step=2#pay",
        }),
        NOW,
      );
    const raw: ReplayUserSessionDescription =
      userSessions.describeReplayUserSession(
        item("b", NOW - 5 * 60 * 1000, { entryUrl: "/orders/42" }),
        NOW,
      );
    const bare: ReplayUserSessionDescription =
      userSessions.describeReplayUserSession(
        item("c", NOW - 5 * 60 * 1000, { entryUrl: "https://app.acme.com" }),
        NOW,
      );

    expect(absolute.path).toBe("/checkout?step=2");
    expect(raw.path).toBe("/orders/42");
    expect(bare.path).toBe("/");
    expect(
      userSessions.describeReplayUserSession(
        item("d", NOW, { entryUrl: "" }),
        NOW,
      ).path,
    ).toBe("");
  });

  test("formats the duration and the device hint", () => {
    const described: ReplayUserSessionDescription =
      userSessions.describeReplayUserSession(
        item("a", NOW - 5 * 60 * 1000, {
          durationMs: 252_000,
          browserName: "Safari",
          deviceType: "mobile",
        }),
        NOW,
      );

    expect(described.duration).toBe("4m 12s");
    expect(described.deviceHint).toBe("Safari · mobile");
    expect(
      userSessions.describeReplayUserSession(
        item("b", NOW, { browserName: "", deviceType: "" }),
        NOW,
      ).deviceHint,
    ).toBe("");
    expect(
      userSessions.describeReplayUserSession(
        item("c", NOW, { browserName: "Chrome", deviceType: "" }),
        NOW,
      ).deviceHint,
    ).toBe("Chrome");
  });

  test("says when against the supplied clock, never in the future", () => {
    const at: (offsetMs: number) => string = (offsetMs: number): string => {
      return userSessions.describeReplayUserSession(
        item("a", NOW - offsetMs),
        NOW,
      ).when;
    };

    expect(at(10 * 1000)).toBe("just now");
    expect(at(60 * 1000)).toBe("a minute ago");
    expect(at(5 * 60 * 1000)).toBe("5 minutes ago");
    expect(at(60 * 60 * 1000)).toBe("an hour ago");
    expect(at(3 * 60 * 60 * 1000)).toBe("3 hours ago");
    expect(at(DAY_MS)).toBe("a day ago");
    expect(at(6 * DAY_MS)).toBe("6 days ago");
    expect(at(21 * DAY_MS)).toBe("3 weeks ago");
    /* A device clock ahead of the server's. */
    expect(at(-5 * 60 * 1000)).toBe("just now");
  });

  test("carries an absolute timestamp and copes with an unknown start", () => {
    const known: ReplayUserSessionDescription =
      userSessions.describeReplayUserSession(item("a", NOW - DAY_MS), NOW);
    const unknown: ReplayUserSessionDescription =
      userSessions.describeReplayUserSession(item("b", 0), NOW);

    expect(known.absolute.length).toBeGreaterThan(0);
    expect(known.absolute).not.toMatch(/Invalid/);
    expect(unknown.when).toBe("Unknown time");
    expect(unknown.absolute).toBe("Start time unavailable");
  });
});

describe("parseReplayUserSessionItem", () => {
  test("reads a list row with its numbers quoted and its booleans as 0/1", () => {
    const parsed: ReplayUserSessionItem = userSessions.parseReplayUserSessionItem(
      wireRow() as Record<string, unknown>,
    );

    expect(parsed).toEqual({
      sessionId: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
      startTimeUnixMs: NOW - 60 * 60 * 1000,
      durationMs: 252000,
      entryUrl: "https://app.acme.com/checkout?step=2",
      browserName: "Chrome",
      deviceType: "desktop",
      hasError: true,
      errorCount: 2,
      isFinalized: true,
      identifiedUserKey: USER_KEY,
      visitorId: VISITOR,
      identifiedUserLabel: "jane@acme.com",
    });
  });

  test("falls back to the ISO start time on an older server", () => {
    const row: JSONObject = wireRow();

    delete row["startTimeUnixMs"];

    expect(
      userSessions.parseReplayUserSessionItem(row as Record<string, unknown>)
        .startTimeUnixMs,
    ).toBe(Date.parse("2026-09-05T09:00:00.000Z"));
  });

  test("a withheld label reads as null; an empty one as empty; missing fields as blanks", () => {
    const withheld: JSONObject = wireRow();

    delete withheld["identifiedUserLabel"];
    delete withheld["visitorId"];
    delete withheld["browserName"];
    delete withheld["errorCount"];
    delete withheld["isFinalized"];

    const parsed: ReplayUserSessionItem = userSessions.parseReplayUserSessionItem(
      withheld as Record<string, unknown>,
    );

    expect(parsed.identifiedUserLabel).toBeNull();
    expect(parsed.visitorId).toBe("");
    expect(parsed.browserName).toBe("");
    expect(parsed.errorCount).toBe(0);
    expect(parsed.isFinalized).toBe(false);

    expect(
      userSessions.parseReplayUserSessionItem(
        wireRow({ identifiedUserLabel: "" }) as Record<string, unknown>,
      ).identifiedUserLabel,
    ).toBe("");
  });

  test("the response parser keeps only rows with a session id", () => {
    const items: Array<ReplayUserSessionItem> =
      userSessions.parseReplayUserSessionsResponse({
        sessions: [
          wireRow({ sessionId: "one" }),
          wireRow({ sessionId: "" }),
          "junk",
          null,
          wireRow({ sessionId: "two" }),
        ],
        nextCursor: null,
      });

    expect(
      items.map((entry: ReplayUserSessionItem): string => {
        return entry.sessionId;
      }),
    ).toEqual(["one", "two"]);
    expect(userSessions.parseReplayUserSessionsResponse({})).toEqual([]);
  });
});

describe("fetchReplayUserSessions", () => {
  const startTime: Date = new Date(NOW - 30 * DAY_MS);
  const endTime: Date = new Date(NOW);

  test("posts one list request per key it was given, each filtered by that key alone", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        { sessions: [wireRow()], nextCursor: null },
        {},
      ),
    );

    const lists: Array<Array<ReplayUserSessionItem>> =
      await userSessions.fetchReplayUserSessions({
        rumApplicationId: new ObjectID(APP_ID),
        identifiedUserKey: USER_KEY,
        visitorId: VISITOR,
        startTime: startTime,
        endTime: endTime,
      });

    expect(lists).toHaveLength(2);
    expect(lists[0]).toHaveLength(1);
    expect(postMock).toHaveBeenCalledTimes(2);

    const bodies: Array<JSONObject> = postMock.mock.calls.map(
      (call: Array<unknown>): JSONObject => {
        return (call[0] as { data: JSONObject }).data;
      },
    );

    expect(bodies[0]).toEqual({
      rumApplicationId: APP_ID,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      limit: userSessions.REPLAY_USER_SESSIONS_LIMIT,
      filters: { identifiedUserKey: USER_KEY },
    });
    expect(bodies[1]).toEqual({
      rumApplicationId: APP_ID,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      limit: userSessions.REPLAY_USER_SESSIONS_LIMIT,
      filters: { visitorId: VISITOR },
    });

    const firstCall: { url: { toString: () => string }; headers: JSONObject } =
      postMock.mock.calls[0]?.[0] as {
        url: { toString: () => string };
        headers: JSONObject;
      };

    expect(firstCall.url.toString()).toContain(
      userSessions.REPLAY_USER_SESSIONS_LIST_ROUTE,
    );
    expect(firstCall.headers).toEqual({ tenantid: "project-1" });
  });

  test("asks only for the key the session carries", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { sessions: [] }, {}),
    );

    const lists: Array<Array<ReplayUserSessionItem>> =
      await userSessions.fetchReplayUserSessions({
        rumApplicationId: APP_ID,
        identifiedUserKey: "",
        visitorId: VISITOR,
        startTime: startTime,
        endTime: endTime,
        limit: 10,
      });

    expect(lists).toEqual([[]]);
    expect(postMock).toHaveBeenCalledTimes(1);
    expect((postMock.mock.calls[0]?.[0] as { data: JSONObject }).data).toEqual(
      expect.objectContaining({
        limit: 10,
        filters: { visitorId: VISITOR },
      }),
    );
  });

  test("makes no request at all when there is no key", async () => {
    const lists: Array<Array<ReplayUserSessionItem>> =
      await userSessions.fetchReplayUserSessions({
        rumApplicationId: APP_ID,
        identifiedUserKey: "",
        visitorId: "",
        startTime: startTime,
        endTime: endTime,
      });

    expect(lists).toEqual([]);
    expect(postMock).not.toHaveBeenCalled();
  });

  test("throws the HTTP error response so the shell shows 'couldn't load'", async () => {
    const failure: HTTPErrorResponse = new HTTPErrorResponse(
      403,
      { message: "forbidden" },
      {},
    );

    postMock.mockResolvedValue(failure);

    await expect(
      userSessions.fetchReplayUserSessions({
        rumApplicationId: APP_ID,
        identifiedUserKey: USER_KEY,
        visitorId: "",
        startTime: startTime,
        endTime: endTime,
      }),
    ).rejects.toBe(failure);
  });
});
