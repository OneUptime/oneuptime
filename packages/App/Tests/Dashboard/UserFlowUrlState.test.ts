import { describe, expect, test } from "@jest/globals";
import TimeRange from "Common/Types/Time/TimeRange";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import {
  DEFAULT_USER_FLOW_OPTIONS,
  USER_FLOW_MAX_STEPS,
} from "Common/Utils/Rum/UserFlow";
import {
  buildSessionsForPageSearch,
  buildUserFlowPageUrl,
  buildUserFlowScopeSearch,
  DEFAULT_USER_FLOW_TIME_RANGE,
  isGroupedByDefault,
  readUserFlowStateFromSearch,
  USER_FLOW_URL_KEYS,
  UserFlowUrlState,
} from "../../FeatureSet/Dashboard/src/Components/UserFlow/UserFlowUrlState";
import { UserFlowScope } from "../../FeatureSet/Dashboard/src/Components/UserFlow/UserFlowScope";
import {
  buildUserSessionsListSearch,
  FILTER_URL_KEYS,
  readFiltersFromSearch,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayListFilters";

/*
 * Every control on the User Flows page lives in the URL, so a map is a
 * link. These pin the grammar both ways, and the hand-off to the session
 * list's own filter reader.
 */

const PAGE: string =
  "https://oneuptime.example.com/dashboard/p/rum/a/user-flows";

describe("readUserFlowStateFromSearch", () => {
  test("an empty query is the default map over the default week", () => {
    const state: UserFlowUrlState = readUserFlowStateFromSearch("");

    expect(state.timeRange).toEqual(DEFAULT_USER_FLOW_TIME_RANGE);
    expect(state.timeRange.range).toBe(TimeRange.PAST_ONE_WEEK);
    expect(state.options).toEqual(DEFAULT_USER_FLOW_OPTIONS);
    expect(state.scope).toBeNull();
  });

  test("reads every key", () => {
    const state: UserFlowUrlState = readUserFlowStateFromSearch(
      "?range=Past+1+Hour&page=%2Fcheckout&dir=backward&steps=7&perStep=9&group=0&hide=%2Flogin&hide=%2Fsso&device=mobile&sessions=errors",
    );

    expect(state.timeRange.range).toBe(TimeRange.PAST_ONE_HOUR);
    expect(state.options).toEqual({
      anchorPage: "/checkout",
      direction: "backward",
      steps: 7,
      pagesPerStep: 9,
      groupDynamicSegments: false,
      hiddenPages: ["/login", "/sso"],
      deviceType: "mobile",
      sessionFilter: "errors",
    });
  });

  test("clamps and ignores what it cannot use", () => {
    const state: UserFlowUrlState = readUserFlowStateFromSearch(
      "?steps=500&perStep=abc&sessions=everything&dir=sideways",
    );

    expect(state.options.steps).toBe(USER_FLOW_MAX_STEPS);
    expect(state.options.pagesPerStep).toBe(
      DEFAULT_USER_FLOW_OPTIONS.pagesPerStep,
    );
    expect(state.options.sessionFilter).toBe("all");
    expect(state.options.direction).toBe("forward");
  });

  test("an absolute window wins", () => {
    const state: UserFlowUrlState = readUserFlowStateFromSearch(
      "?startTime=2026-09-01T00:00:00.000Z&endTime=2026-09-02T00:00:00.000Z",
    );

    expect(state.timeRange.range).toBe(TimeRange.CUSTOM);
    expect(state.timeRange.startAndEndDate?.startValue.toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
  });
});

describe("buildUserFlowPageUrl", () => {
  test("defaults are written as absence", () => {
    expect(buildUserFlowPageUrl(PAGE, readUserFlowStateFromSearch(""))).toBe(
      PAGE,
    );
  });

  test("round-trips every control", () => {
    const state: UserFlowUrlState = {
      scope: null,
      timeRange: { range: TimeRange.PAST_ONE_DAY },
      options: {
        anchorPage: "/orders/:id",
        direction: "backward",
        steps: 3,
        pagesPerStep: 12,
        groupDynamicSegments: false,
        hiddenPages: ["/login"],
        deviceType: "tablet",
        sessionFilter: "frustration",
      },
    };
    const url: URL = new URL(buildUserFlowPageUrl(PAGE, state));

    /* The week is this page's default, so an explicit day IS written. */
    expect(url.searchParams.get("range")).toBe(TimeRange.PAST_ONE_DAY);
    expect(readUserFlowStateFromSearch(url.search)).toEqual(state);
  });

  test("a direction without an anchor is not written", () => {
    const url: URL = new URL(
      buildUserFlowPageUrl(PAGE, {
        scope: null,
        timeRange: DEFAULT_USER_FLOW_TIME_RANGE,
        options: { ...DEFAULT_USER_FLOW_OPTIONS, direction: "backward" },
      }),
    );

    expect(url.searchParams.has(USER_FLOW_URL_KEYS.direction)).toBe(false);
  });

  test("a custom window is written as an ISO pair and stale keys are removed", () => {
    const url: URL = new URL(
      buildUserFlowPageUrl(`${PAGE}?range=Past+1+Hour&start=x&steps=9`, {
        scope: null,
        timeRange: {
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(
            new Date("2026-09-01T00:00:00.000Z"),
            new Date("2026-09-02T00:00:00.000Z"),
          ),
        },
        options: DEFAULT_USER_FLOW_OPTIONS,
      }),
    );

    expect(url.searchParams.get("startTime")).toBe("2026-09-01T00:00:00.000Z");
    expect(url.searchParams.get("endTime")).toBe("2026-09-02T00:00:00.000Z");
    expect(url.searchParams.has("range")).toBe(false);
    expect(url.searchParams.has("start")).toBe(false);
    expect(url.searchParams.has("steps")).toBe(false);
  });

  test("keys it does not own survive", () => {
    const url: URL = new URL(
      buildUserFlowPageUrl(`${PAGE}?foo=bar`, readUserFlowStateFromSearch("")),
    );

    expect(url.searchParams.get("foo")).toBe("bar");
  });
});

describe("narrowed to one person or one session", () => {
  const KEY: string = "a".repeat(64);
  const VISITOR: string = "0123456789abcdef0123456789abcdef";
  const SESSION: string = "fedcba9876543210fedcba9876543210";

  const stateOf: (scope: UserFlowScope | null) => UserFlowUrlState = (
    scope: UserFlowScope | null,
  ): UserFlowUrlState => {
    return {
      scope: scope,
      timeRange: DEFAULT_USER_FLOW_TIME_RANGE,
      options: {
        ...DEFAULT_USER_FLOW_OPTIONS,
        groupDynamicSegments: isGroupedByDefault(scope),
      },
    };
  };

  test("a key, a visitor and a session round-trip", () => {
    const scopes: Array<UserFlowScope> = [
      { kind: "user", identifiedUserKey: KEY, identifiedUserRef: "" },
      { kind: "visitor", visitorId: VISITOR },
      { kind: "session", sessionId: SESSION },
    ];

    for (const scope of scopes) {
      const url: URL = new URL(buildUserFlowPageUrl(PAGE, stateOf(scope)));

      expect(readUserFlowStateFromSearch(url.search)).toEqual(stateOf(scope));
    }
  });

  test("a person uses the session list's own keys, so a link means one thing", () => {
    expect(USER_FLOW_URL_KEYS.userKey).toBe(FILTER_URL_KEYS.identifiedUserKey);
    expect(USER_FLOW_URL_KEYS.visitor).toBe(FILTER_URL_KEYS.visitorId);

    const search: string = new URL(
      buildUserFlowPageUrl(
        PAGE,
        stateOf({ kind: "visitor", visitorId: VISITOR }),
      ),
    ).search;

    expect(readFiltersFromSearch(search).advanced.visitorId).toBe(VISITOR);
    expect(
      readFiltersFromSearch(
        new URL(
          buildUserFlowPageUrl(
            PAGE,
            stateOf({
              kind: "user",
              identifiedUserKey: KEY,
              identifiedUserRef: "",
            }),
          ),
        ).search,
      ).advanced.identifiedUserKey,
    ).toBe(KEY);
  });

  /*
   * The one thing that may not happen: a reference names a real end user,
   * and a query string reaches history, shared links and every proxy's log.
   */
  test("a typed reference never reaches the URL", () => {
    const reference: string = "jane.doe+billing@example.com";
    const scope: UserFlowScope = {
      kind: "user",
      identifiedUserKey: "",
      identifiedUserRef: reference,
    };

    const beforeAnswer: string = buildUserFlowPageUrl(PAGE, stateOf(scope));
    const afterAnswer: string = buildUserFlowPageUrl(PAGE, stateOf(scope), {
      kind: "user",
      identifiedUserKey: KEY,
      visitorId: "",
      sessionId: "",
      identifiedUserLabel: reference,
    });

    for (const url of [beforeAnswer, afterAnswer]) {
      const search: string = decodeURIComponent(new URL(url).search);

      expect(search).not.toContain("jane");
      expect(search).not.toContain("billing");
      expect(search).not.toContain("example.com");
    }
  });

  test("a label known with the key stays out of the URL too", () => {
    const url: string = buildUserFlowPageUrl(
      PAGE,
      stateOf({
        kind: "user",
        identifiedUserKey: KEY,
        identifiedUserRef: "jane@example.com",
      }),
    );

    expect(decodeURIComponent(url)).not.toContain("jane");
    expect(new URL(url).searchParams.get("userKey")).toBe(KEY);
  });

  test("once the server answers, the link carries the reference's key", () => {
    const scope: UserFlowScope = {
      kind: "user",
      identifiedUserKey: "",
      identifiedUserRef: "jane@example.com",
    };

    expect(
      new URL(buildUserFlowPageUrl(PAGE, stateOf(scope))).searchParams.has(
        "userKey",
      ),
    ).toBe(false);

    const url: URL = new URL(
      buildUserFlowPageUrl(PAGE, stateOf(scope), {
        kind: "user",
        identifiedUserKey: KEY,
        visitorId: "",
        sessionId: "",
      }),
    );

    expect(url.searchParams.get("userKey")).toBe(KEY);
    /* Reloading that link asks for the same person, by the key. */
    expect(readUserFlowStateFromSearch(url.search).scope).toEqual({
      kind: "user",
      identifiedUserKey: KEY,
      identifiedUserRef: "",
    });
  });

  test("clearing the scope clears every key it wrote", () => {
    for (const leftover of [
      `userKey=${KEY}`,
      `visitor=${VISITOR}`,
      `sessionId=${SESSION}`,
    ]) {
      expect(buildUserFlowPageUrl(`${PAGE}?${leftover}`, stateOf(null))).toBe(
        PAGE,
      );
    }
  });

  test("a link that holds no real id reads as everyone, not as a failed request", () => {
    for (const search of [
      "?userKey=not-a-key",
      "?userKey=",
      `?userKey=${"Z".repeat(64)}`,
      "?visitor=abc",
      "?sessionId=abc",
      "?sessionId=%3Cscript%3E",
    ]) {
      expect(readUserFlowStateFromSearch(search).scope).toBeNull();
    }
  });

  test("a pasted id of another case still reads", () => {
    expect(
      readUserFlowStateFromSearch(`?visitor=${VISITOR.toUpperCase()}`).scope,
    ).toEqual({ kind: "visitor", visitorId: VISITOR });
    expect(
      readUserFlowStateFromSearch(`?sessionId=${SESSION.toUpperCase()}`).scope,
    ).toEqual({ kind: "session", sessionId: SESSION });
  });

  test("ids are grouped for everyone and shown for one person", () => {
    expect(readUserFlowStateFromSearch("").options.groupDynamicSegments).toBe(
      true,
    );

    for (const search of [
      `?userKey=${KEY}`,
      `?visitor=${VISITOR}`,
      `?sessionId=${SESSION}`,
    ]) {
      expect(
        readUserFlowStateFromSearch(search).options.groupDynamicSegments,
      ).toBe(false);
    }
  });

  test("each view's default is absence, and the other choice is written", () => {
    const person: UserFlowScope = { kind: "visitor", visitorId: VISITOR };
    const grouped: UserFlowUrlState = {
      ...stateOf(person),
      options: { ...stateOf(person).options, groupDynamicSegments: true },
    };
    const url: URL = new URL(buildUserFlowPageUrl(PAGE, grouped));

    expect(
      new URL(buildUserFlowPageUrl(PAGE, stateOf(person))).searchParams.has(
        "group",
      ),
    ).toBe(false);
    expect(url.searchParams.get("group")).toBe("1");
    expect(readUserFlowStateFromSearch(url.search)).toEqual(grouped);
  });

  test("the session count filter and the session scope are different keys", () => {
    const state: UserFlowUrlState = readUserFlowStateFromSearch(
      `?sessions=errors&sessionId=${SESSION}`,
    );

    expect(state.options.sessionFilter).toBe("errors");
    expect(state.scope).toEqual({ kind: "session", sessionId: SESSION });
  });
});

describe("buildUserFlowScopeSearch", () => {
  const KEY: string = "a".repeat(64);
  const person: UserFlowScope = {
    kind: "user",
    identifiedUserKey: KEY,
    identifiedUserRef: "jane@example.com",
  };

  test("opens the page on the person, with the label left behind", () => {
    const search: string = buildUserFlowScopeSearch(person, {
      range: TimeRange.PAST_ONE_DAY,
    });

    expect(readUserFlowStateFromSearch(search).scope).toEqual({
      kind: "user",
      identifiedUserKey: KEY,
      identifiedUserRef: "",
    });
    expect(decodeURIComponent(search)).not.toContain("jane");
  });

  /*
   * The Users page's default is a day and this page's a week: spelled by the
   * list's helper, a day is written as absence, which this page reads as a
   * week, and the journeys would cover more than the row counted.
   */
  test("keeps the window the person was found in", () => {
    const day: string = buildUserFlowScopeSearch(person, {
      range: TimeRange.PAST_ONE_DAY,
    });

    expect(readUserFlowStateFromSearch(day).timeRange.range).toBe(
      TimeRange.PAST_ONE_DAY,
    );

    const week: string = buildUserFlowScopeSearch(person, {
      range: TimeRange.PAST_ONE_WEEK,
    });

    expect(readUserFlowStateFromSearch(week).timeRange.range).toBe(
      TimeRange.PAST_ONE_WEEK,
    );
  });

  test("agrees with the link to the same person's session list", () => {
    const flows: string = buildUserFlowScopeSearch(person, {
      range: TimeRange.PAST_ONE_DAY,
    });
    const list: string = buildUserSessionsListSearch(
      {
        filter: { identifiedUserRef: "jane@example.com" },
        identifiedUserKey: KEY,
        identifiedUserLabel: "jane@example.com",
      },
      { range: TimeRange.PAST_ONE_DAY },
    );

    expect(new URLSearchParams(flows).get("userKey")).toBe(
      new URLSearchParams(list).get("userKey"),
    );
  });

  test("a custom window comes along as its ISO pair", () => {
    const search: string = buildUserFlowScopeSearch(person, {
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(
        new Date("2026-09-01T00:00:00.000Z"),
        new Date("2026-09-02T00:00:00.000Z"),
      ),
    });

    expect(new URLSearchParams(search).get("startTime")).toBe(
      "2026-09-01T00:00:00.000Z",
    );
    expect(readUserFlowStateFromSearch(search).timeRange.range).toBe(
      TimeRange.CUSTOM,
    );
  });
});

describe("buildSessionsForPageSearch", () => {
  test("hands the session list a URL prefix it understands", () => {
    const search: string = buildSessionsForPageSearch("/orders/:id", {
      range: TimeRange.PAST_ONE_WEEK,
    });

    /* Read back with the list's own reader, so the two cannot drift. */
    expect(readFiltersFromSearch(search).advanced.urlPrefix).toBe("/orders/");
    expect(new URLSearchParams(search).get("range")).toBe(
      TimeRange.PAST_ONE_WEEK,
    );
  });

  test("the list's own default window is left implicit", () => {
    const search: string = buildSessionsForPageSearch("/cart", {
      range: TimeRange.PAST_ONE_DAY,
    });

    expect(new URLSearchParams(search).has("range")).toBe(false);
    expect(readFiltersFromSearch(search).advanced.urlPrefix).toBe("/cart");
  });

  test("the Other pages bucket has no single prefix", () => {
    expect(
      buildSessionsForPageSearch("__other__", {
        range: TimeRange.PAST_ONE_DAY,
      }),
    ).toBe("");
  });
});
