import { describe, expect, test } from "@jest/globals";
import {
  UserFlowJourneysResponseDto,
  UserFlowSessionDetailDto,
  UserFlowSessionDto,
} from "Common/Types/Rum/UserFlow";
import { UserFlowSessionJourney } from "Common/Utils/Rum/UserFlow";
import {
  describeUserFlowPerson,
  getUserFlowPersonFilters,
  getUserFlowPersonKey,
  getUserFlowRecordingState,
  getUserFlowSessionOwner,
  resolveUserFlowPerson,
  summarizeUserFlowJourney,
  UserFlowPerson,
  UserFlowPersonDescription,
  UserFlowRecordingState,
} from "../../FeatureSet/Dashboard/src/Components/UserFlow/UserFlowPerson";

/*
 * Whose journeys the page shows. The rules that decide what reaches the
 * server, what reaches the address and what the page calls someone live
 * here, without React, so each is pinned on its own.
 */

const KEY: string = "a".repeat(64);
const VISITOR: string = "b".repeat(32);
const SESSION: string = "c".repeat(32);
const NOW: number = 1_800_000_000_000;

const DETAIL: UserFlowSessionDetailDto = {
  identifiedUserKey: KEY,
  visitorId: VISITOR,
  identifiedUserLabel: "jane@example.com",
  isFinalized: true,
  hasRecordingEnded: false,
  sealedReason: "",
  chunkCount: 3,
};

function session(
  sessionId: string,
  detail?: UserFlowSessionDetailDto,
): UserFlowSessionDto {
  return {
    sessionId: sessionId,
    startUnixMs: NOW,
    durationMs: 1000,
    deviceType: "desktop",
    browserName: "Chrome",
    countryCode: "DK",
    errorCount: 0,
    frustrationCount: 0,
    pages: [0],
    pageSignals: [],
    ...(detail ? { detail: detail } : {}),
  };
}

function response(
  sessions: Array<UserFlowSessionDto>,
): UserFlowJourneysResponseDto {
  return {
    pages: ["https://shop.example.com/"],
    sessions: sessions,
    sessionsInWindow: sessions.length,
    isSampled: false,
    maxSessions: 5000,
    startUnixMs: 0,
    endUnixMs: 1,
    ignoredFilters: [],
  };
}

describe("getUserFlowPersonFilters", () => {
  test("each person is one filter, under the key the server reads", () => {
    expect(
      getUserFlowPersonFilters({ kind: "user", identifiedUserKey: KEY }),
    ).toEqual({ identifiedUserKey: KEY });
    expect(
      getUserFlowPersonFilters({ kind: "visitor", visitorId: VISITOR }),
    ).toEqual({ visitorId: VISITOR });
    expect(
      getUserFlowPersonFilters({ kind: "session", sessionId: SESSION }),
    ).toEqual({ sessionId: SESSION });
    expect(
      getUserFlowPersonFilters({ kind: "lookup", identifier: "jane" }),
    ).toEqual({ identifier: "jane" });
  });

  test("no person is no filter", () => {
    expect(getUserFlowPersonFilters(undefined)).toEqual({});
  });
});

describe("getUserFlowPersonKey", () => {
  test("tells people apart, and everyone from anyone", () => {
    const keys: Array<string> = [
      getUserFlowPersonKey(undefined),
      getUserFlowPersonKey({ kind: "user", identifiedUserKey: "x" }),
      getUserFlowPersonKey({ kind: "visitor", visitorId: "x" }),
      getUserFlowPersonKey({ kind: "session", sessionId: "x" }),
      getUserFlowPersonKey({ kind: "lookup", identifier: "x" }),
    ];

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe("");
  });
});

describe("resolveUserFlowPerson", () => {
  const typed: (identifier: string) => UserFlowPerson = (
    identifier: string,
  ): UserFlowPerson => {
    return { kind: "lookup", identifier: identifier };
  };

  test("a person a link named is left alone", () => {
    const person: UserFlowPerson = { kind: "visitor", visitorId: VISITOR };

    expect(
      resolveUserFlowPerson(person, response([session("s", DETAIL)])),
    ).toBe(person);
  });

  test("before the answer, and with no match, it stays what was typed", () => {
    expect(resolveUserFlowPerson(typed("jane"), null)).toEqual(typed("jane"));
    expect(resolveUserFlowPerson(typed("jane"), response([]))).toEqual(
      typed("jane"),
    );
  });

  test("a reference becomes the digest it was stored under", () => {
    expect(
      resolveUserFlowPerson(
        typed("jane@example.com"),
        response([session("s", DETAIL)]),
      ),
    ).toEqual({ kind: "user", identifiedUserKey: KEY });
  });

  test("a session id stays a session, though the session has an owner", () => {
    expect(
      resolveUserFlowPerson(
        typed(SESSION),
        response([session(SESSION, DETAIL)]),
      ),
    ).toEqual({ kind: "session", sessionId: SESSION });
  });

  test("a visitor id stays a browser, though the session names a user", () => {
    expect(
      resolveUserFlowPerson(typed(VISITOR), response([session("s", DETAIL)])),
    ).toEqual({ kind: "visitor", visitorId: VISITOR });
  });

  test("the session wins, wherever it sits in the answer", () => {
    expect(
      resolveUserFlowPerson(
        typed(SESSION),
        response([session("other", DETAIL), session(SESSION, DETAIL)]),
      ),
    ).toEqual({ kind: "session", sessionId: SESSION });
  });

  test("a match with nothing to name it by stays what was typed", () => {
    expect(
      resolveUserFlowPerson(
        typed("x"),
        response([
          session("s", { ...DETAIL, identifiedUserKey: "", visitorId: "" }),
        ]),
      ),
    ).toEqual(typed("x"));
    expect(resolveUserFlowPerson(typed("x"), response([session("s")]))).toEqual(
      typed("x"),
    );
  });
});

describe("getUserFlowSessionOwner", () => {
  test("the user first: they are the stronger statement", () => {
    expect(getUserFlowSessionOwner(DETAIL)).toEqual({
      kind: "user",
      identifiedUserKey: KEY,
    });
  });

  test("the browser when nobody was identified", () => {
    expect(
      getUserFlowSessionOwner({ ...DETAIL, identifiedUserKey: "" }),
    ).toEqual({ kind: "visitor", visitorId: VISITOR });
  });

  test("nobody when it names neither", () => {
    expect(
      getUserFlowSessionOwner({
        ...DETAIL,
        identifiedUserKey: "",
        visitorId: "",
      }),
    ).toBeNull();
    expect(getUserFlowSessionOwner(undefined)).toBeNull();
  });
});

describe("describeUserFlowPerson", () => {
  const USER: UserFlowPerson = { kind: "user", identifiedUserKey: KEY };

  test("a user reads as the name the server sent", () => {
    const description: UserFlowPersonDescription = describeUserFlowPerson(
      USER,
      response([session("s", DETAIL)]),
    );

    expect(description.kind).toBe("user");
    expect(description.value).toBe("jane@example.com");
    expect(description.hue).not.toBeNull();
  });

  /* The digest is in the URL; what it means is the role's to know. */
  test("a role that may not read it sees that it is hidden, not a name", () => {
    const { identifiedUserLabel: _label, ...hidden } = DETAIL;
    const description: UserFlowPersonDescription = describeUserFlowPerson(
      USER,
      response([session("s", hidden)]),
    );

    expect(_label).toBe("jane@example.com");
    expect(description.kind).toBe("hidden");
    expect(JSON.stringify(description)).not.toContain("jane");
  });

  test("a user with no sessions in range has no name to show yet", () => {
    expect(describeUserFlowPerson(USER, response([])).kind).toBe(
      "unknown-user",
    );
    expect(describeUserFlowPerson(USER, null).kind).toBe("unknown-user");
  });

  test("one person keeps one colour, on this page as on the others", () => {
    const named: UserFlowPersonDescription = describeUserFlowPerson(
      USER,
      response([session("s", DETAIL)]),
    );
    const { identifiedUserLabel: _label, ...hidden } = DETAIL;

    expect(_label).toBeTruthy();
    expect(named.hue).toBe(
      describeUserFlowPerson(USER, response([session("s", hidden)])).hue,
    );
  });

  test("a browser reads by its short id", () => {
    expect(
      describeUserFlowPerson({ kind: "visitor", visitorId: VISITOR }, null),
    ).toMatchObject({ kind: "visitor", value: "bbbbbb" });
  });

  test("a session reads by its short id, whole on hover", () => {
    expect(
      describeUserFlowPerson({ kind: "session", sessionId: SESSION }, null),
    ).toMatchObject({ kind: "session", value: "cccccccc", title: SESSION });
  });

  test("what was typed reads as typed, until the answer says who it is", () => {
    expect(
      describeUserFlowPerson({ kind: "lookup", identifier: "nobody" }, null),
    ).toMatchObject({ kind: "typed", value: "nobody" });
  });
});

describe("getUserFlowRecordingState", () => {
  const state: (
    detail: UserFlowSessionDetailDto | undefined,
  ) => UserFlowRecordingState = (
    detail: UserFlowSessionDetailDto | undefined,
  ): UserFlowRecordingState => {
    return getUserFlowRecordingState(detail, NOW);
  };

  test("a finished recording with footage can be watched", () => {
    expect(state(DETAIL)).toEqual({
      isLive: false,
      isWatchable: true,
      reason: "",
    });
  });

  test("a session still recording is live, and footage plays as it arrives", () => {
    expect(state({ ...DETAIL, isFinalized: false, chunkCount: 0 })).toEqual({
      isLive: true,
      isWatchable: true,
      reason: "",
    });
  });

  /* The bug behind "Recording now" on a closed tab: not finalized is not live. */
  test("every tab closed is over, though the counting is pending", () => {
    expect(
      state({
        ...DETAIL,
        isFinalized: false,
        hasRecordingEnded: true,
        chunkCount: 0,
      }),
    ).toMatchObject({ isLive: false, isWatchable: true });
  });

  test("a lost recording says why there is nothing to watch", () => {
    const lost: UserFlowRecordingState = state({
      ...DETAIL,
      sealedReason: "recording-lost",
      chunkCount: 0,
    });

    expect(lost.isWatchable).toBe(false);
    expect(lost.reason).toContain("never arrived");
  });

  test("a finalized session with no chunks has no footage", () => {
    expect(state({ ...DETAIL, chunkCount: 0 }).isWatchable).toBe(false);
  });

  test("a read with no detail offers the link the map's tables offer", () => {
    expect(state(undefined)).toEqual({
      isLive: false,
      isWatchable: true,
      reason: "",
    });
  });
});

describe("summarizeUserFlowJourney", () => {
  const journey: (pages: Array<string>) => UserFlowSessionJourney = (
    pages: Array<string>,
  ): UserFlowSessionJourney => {
    return {
      visits: pages.map((page: string) => {
        return { page: page };
      }),
    } as unknown as UserFlowSessionJourney;
  };

  test("says where it started and where it ended", () => {
    expect(summarizeUserFlowJourney(journey(["/a"]))).toBe("/a");
    expect(summarizeUserFlowJourney(journey(["/a", "/b"]))).toBe("/a → /b");
    expect(summarizeUserFlowJourney(journey(["/a", "/b", "/c"]))).toBe(
      "/a → … → /c",
    );
    expect(summarizeUserFlowJourney(journey([]))).toBe("");
  });
});
