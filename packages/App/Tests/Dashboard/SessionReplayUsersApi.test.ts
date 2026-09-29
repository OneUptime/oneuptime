import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import type {
  SessionReplayUserRollup,
  SessionReplayUsersResult,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayUsersApi";

/*
 * The client half of /telemetry/rum/session-replay/users: the request body
 * shape the server parses, the defensive read of its projection (64-bit
 * counters as strings, an absent kind, a withheld label), and the cursor
 * echoed back verbatim.
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
const SESSION_ID: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const NOW: number = Date.parse("2026-09-05T10:00:00.000Z");

type UsersApiModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayUsersApi");

let usersApi: UsersApiModule;
let postMock: jest.Mock;

/* One row as /users serialises it, every counter quoted the way ClickHouse does. */
function wireRollup(overrides?: JSONObject): JSONObject {
  return {
    groupKey: `u:${USER_KEY}`,
    kind: "identified",
    identifiedUserKey: USER_KEY,
    visitorId: VISITOR,
    identifiedUserLabel: "jane@acme.com",
    identifiedUserTraits: { plan: "pro" },
    sessionCount: "12",
    liveSessionCount: "1",
    firstSeenUnixMs: String(NOW - 86_400_000),
    lastSeenUnixMs: String(NOW - 60_000),
    totalDurationMs: "5400000",
    errorCount: "4",
    frustrationCount: "2",
    errorSessionCount: "3",
    pageCount: "40",
    lastSessionId: SESSION_ID,
    lastEntryUrl: "https://app.acme.com/checkout",
    browserName: "Chrome",
    browserVersion: "126",
    osName: "macOS",
    deviceType: "desktop",
    countryCode: "DE",
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

  usersApi = await import(
    "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayUsersApi"
  );
});

beforeEach(() => {
  postMock.mockReset();
});

describe("SESSION_REPLAY_USERS_ROUTE", () => {
  test("is the users route under the telemetry API", () => {
    expect(usersApi.SESSION_REPLAY_USERS_ROUTE).toBe(
      "/telemetry/rum/session-replay/users",
    );
  });
});

describe("parseSessionReplayUserRollup", () => {
  test("reads quoted counters as numbers and the identity fields as given", () => {
    const rollup: SessionReplayUserRollup =
      usersApi.parseSessionReplayUserRollup(wireRollup());

    expect(rollup.groupKey).toBe(`u:${USER_KEY}`);
    expect(rollup.kind).toBe("identified");
    expect(rollup.identifiedUserKey).toBe(USER_KEY);
    expect(rollup.visitorId).toBe(VISITOR);
    expect(rollup.identifiedUserLabel).toBe("jane@acme.com");
    expect(rollup.identifiedUserTraits).toEqual({ plan: "pro" });
    expect(rollup.isIdentityVisible).toBe(true);
    expect(rollup.sessionCount).toBe(12);
    expect(rollup.liveSessionCount).toBe(1);
    expect(rollup.firstSeenUnixMs).toBe(NOW - 86_400_000);
    expect(rollup.lastSeenUnixMs).toBe(NOW - 60_000);
    expect(rollup.totalDurationMs).toBe(5_400_000);
    expect(rollup.errorCount).toBe(4);
    expect(rollup.frustrationCount).toBe(2);
    expect(rollup.errorSessionCount).toBe(3);
    expect(rollup.pageCount).toBe(40);
    expect(rollup.lastSessionId).toBe(SESSION_ID);
    expect(rollup.browserName).toBe("Chrome");
    expect(rollup.countryCode).toBe("DE");
  });

  test("an absent label means hidden from this role, not anonymous", () => {
    const row: JSONObject = wireRollup();

    delete row["identifiedUserLabel"];
    delete row["identifiedUserTraits"];

    const rollup: SessionReplayUserRollup =
      usersApi.parseSessionReplayUserRollup(row);

    expect(rollup.isIdentityVisible).toBe(false);
    expect(rollup.identifiedUserLabel).toBeUndefined();
    expect(rollup.identifiedUserTraits).toBeUndefined();
    /* The kind is still the server's: an identified person. */
    expect(rollup.kind).toBe("identified");
  });

  test("an empty label WITH the column present is visible-and-empty", () => {
    const rollup: SessionReplayUserRollup =
      usersApi.parseSessionReplayUserRollup(
        wireRollup({
          groupKey: `v:${VISITOR}`,
          kind: "visitor",
          identifiedUserKey: "",
          identifiedUserLabel: "",
        }),
      );

    expect(rollup.isIdentityVisible).toBe(true);
    expect(rollup.identifiedUserLabel).toBe("");
    expect(rollup.kind).toBe("visitor");
  });

  test("a server without the kind column is read from the group key prefix", () => {
    const identified: JSONObject = wireRollup();
    const visitor: JSONObject = wireRollup({
      groupKey: `v:${VISITOR}`,
      identifiedUserKey: "",
    });
    const anonymous: JSONObject = wireRollup({
      groupKey: "",
      identifiedUserKey: "",
      visitorId: "",
    });

    for (const row of [identified, visitor, anonymous]) {
      delete row["kind"];
    }

    expect(usersApi.parseSessionReplayUserRollup(identified).kind).toBe(
      "identified",
    );
    expect(usersApi.parseSessionReplayUserRollup(visitor).kind).toBe("visitor");
    expect(usersApi.parseSessionReplayUserRollup(anonymous).kind).toBe(
      "anonymous",
    );
    /* An unknown kind is not trusted either. */
    expect(
      usersApi.parseSessionReplayUserRollup(wireRollup({ kind: "robot" })).kind,
    ).toBe("identified");
  });

  test("missing counters read as 0, never NaN", () => {
    const rollup: SessionReplayUserRollup =
      usersApi.parseSessionReplayUserRollup({
        groupKey: "",
        kind: "anonymous",
      });

    expect(rollup.sessionCount).toBe(0);
    expect(rollup.errorCount).toBe(0);
    expect(rollup.lastSeenUnixMs).toBe(0);
    expect(rollup.lastSessionId).toBe("");
  });
});

describe("parseSessionReplayUsersCursor", () => {
  test("reads both halves, keeps the anonymous bucket's empty key, and refuses the rest", () => {
    expect(
      usersApi.parseSessionReplayUsersCursor({
        lastSeenUnixMs: "1757000000000",
        groupKey: `u:${USER_KEY}`,
      }),
    ).toEqual({ lastSeenUnixMs: 1_757_000_000_000, groupKey: `u:${USER_KEY}` });
    expect(
      usersApi.parseSessionReplayUsersCursor({
        lastSeenUnixMs: 1,
        groupKey: "",
      }),
    ).toEqual({ lastSeenUnixMs: 1, groupKey: "" });
    expect(usersApi.parseSessionReplayUsersCursor(null)).toBeNull();
    expect(
      usersApi.parseSessionReplayUsersCursor({ groupKey: "x" }),
    ).toBeNull();
    expect(
      usersApi.parseSessionReplayUsersCursor({ lastSeenUnixMs: 1 }),
    ).toBeNull();
    expect(usersApi.parseSessionReplayUsersCursor([1, "x"])).toBeNull();
  });
});

describe("fetchSessionReplayUsers", () => {
  test("posts the documented body to the users route and echoes the cursor verbatim", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        {
          users: [wireRollup()],
          nextCursor: {
            lastSeenUnixMs: NOW - 60_000,
            groupKey: `u:${USER_KEY}`,
          },
        },
        {},
      ),
    );

    const result: SessionReplayUsersResult =
      await usersApi.fetchSessionReplayUsers({
        rumApplicationId: new ObjectID(APP_ID),
        startTime: new Date(NOW - 86_400_000),
        endTime: new Date(NOW),
        limit: 50,
        cursor: { lastSeenUnixMs: NOW, groupKey: "v:abc" },
      });

    expect(postMock).toHaveBeenCalledTimes(1);

    const request: {
      url: { toString: () => string };
      data: JSONObject;
      headers: JSONObject;
    } = postMock.mock.calls[0]![0] as {
      url: { toString: () => string };
      data: JSONObject;
      headers: JSONObject;
    };

    expect(request.url.toString()).toContain(
      "/telemetry/rum/session-replay/users",
    );
    expect(request.data).toEqual({
      rumApplicationId: APP_ID,
      startTime: new Date(NOW - 86_400_000).toISOString(),
      endTime: new Date(NOW).toISOString(),
      limit: 50,
      cursor: { lastSeenUnixMs: NOW, groupKey: "v:abc" },
    });
    expect(request.headers).toEqual({ tenantid: "project-1" });

    expect(result.users).toHaveLength(1);
    expect(result.users[0]?.sessionCount).toBe(12);
    expect(result.nextCursor).toEqual({
      lastSeenUnixMs: NOW - 60_000,
      groupKey: `u:${USER_KEY}`,
    });
  });

  test("omits the cursor for the first page and reads a null cursor as the last page", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { users: [], nextCursor: null }, {}),
    );

    const result: SessionReplayUsersResult =
      await usersApi.fetchSessionReplayUsers({
        rumApplicationId: new ObjectID(APP_ID),
        startTime: new Date(NOW - 86_400_000),
        endTime: new Date(NOW),
        limit: 50,
      });

    const sent: JSONObject = (
      postMock.mock.calls[0]![0] as { data: JSONObject }
    ).data;

    expect(sent["cursor"]).toBeUndefined();
    expect(result.users).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  test("throws the HTTPErrorResponse so the table can read its status", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(403, { message: "no" }, {}),
    );

    await expect(
      usersApi.fetchSessionReplayUsers({
        rumApplicationId: new ObjectID(APP_ID),
        startTime: new Date(NOW - 86_400_000),
        endTime: new Date(NOW),
        limit: 50,
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });
});
