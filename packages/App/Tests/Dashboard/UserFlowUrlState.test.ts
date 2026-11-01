import { describe, expect, test } from "@jest/globals";
import TimeRange from "Common/Types/Time/TimeRange";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import {
  DEFAULT_USER_FLOW_OPTIONS,
  USER_FLOW_MAX_STEPS,
} from "Common/Utils/Rum/UserFlow";
import {
  buildSessionsForPageSearch,
  buildSessionsForPersonSearch,
  buildUserFlowPageUrl,
  buildUserFlowPersonSearch,
  DEFAULT_USER_FLOW_TIME_RANGE,
  readUserFlowStateFromSearch,
  USER_FLOW_URL_KEYS,
  UserFlowUrlState,
} from "../../FeatureSet/Dashboard/src/Components/UserFlow/UserFlowUrlState";
import { UserFlowPerson } from "../../FeatureSet/Dashboard/src/Components/UserFlow/UserFlowPerson";
import {
  buildUserSessionsListSearch,
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
        timeRange: DEFAULT_USER_FLOW_TIME_RANGE,
        options: { ...DEFAULT_USER_FLOW_OPTIONS, direction: "backward" },
      }),
    );

    expect(url.searchParams.has(USER_FLOW_URL_KEYS.direction)).toBe(false);
  });

  test("a custom window is written as an ISO pair and stale keys are removed", () => {
    const url: URL = new URL(
      buildUserFlowPageUrl(`${PAGE}?range=Past+1+Hour&start=x&steps=9`, {
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

describe("one person", () => {
  const KEY: string = "a".repeat(64);
  const VISITOR: string = "b".repeat(32);
  const SESSION: string = "c".repeat(32);

  const USER: UserFlowPerson = { kind: "user", identifiedUserKey: KEY };
  const BROWSER: UserFlowPerson = { kind: "visitor", visitorId: VISITOR };
  const ONE_SESSION: UserFlowPerson = { kind: "session", sessionId: SESSION };

  const stateOf: (
    person: UserFlowPerson | undefined,
    view?: "journeys" | "map",
  ) => UserFlowUrlState = (
    person: UserFlowPerson | undefined,
    view?: "journeys" | "map",
  ): UserFlowUrlState => {
    return {
      timeRange: DEFAULT_USER_FLOW_TIME_RANGE,
      options: DEFAULT_USER_FLOW_OPTIONS,
      person: person,
      view: view,
    };
  };

  test("no person is everyone's flows, and asks for nothing in the URL", () => {
    expect(readUserFlowStateFromSearch("").person).toBeUndefined();
    expect(readUserFlowStateFromSearch("").view).toBeUndefined();
    expect(buildUserFlowPageUrl(PAGE, stateOf(undefined))).toBe(PAGE);
  });

  test.each([
    ["a user", USER, `userKey=${KEY}`],
    ["a browser", BROWSER, `visitor=${VISITOR}`],
    ["a session", ONE_SESSION, `sessionId=${SESSION}`],
  ])(
    "%s round-trips through the URL",
    (_name: string, person: UserFlowPerson, expected: string) => {
      const url: URL = new URL(buildUserFlowPageUrl(PAGE, stateOf(person)));

      expect(url.search).toBe(`?${expected}`);
      expect(readUserFlowStateFromSearch(url.search).person).toEqual(person);
    },
  );

  /*
   * What someone typed is typically an email, and a query string reaches
   * browser history, shared links and every proxy's access log. This is the
   * one rule of this state that must never slip.
   */
  describe("what was typed", () => {
    const TYPED: UserFlowPerson = {
      kind: "lookup",
      identifier: "jane@example.com",
    };

    test("is never written, in any spelling", () => {
      const search: string = decodeURIComponent(
        new URL(
          buildUserFlowPageUrl(
            `${PAGE}?range=Past+1+Hour`,
            stateOf(TYPED, "map"),
          ),
        ).search,
      );

      expect(search).not.toContain("jane");
      expect(search).not.toContain("example.com");
      expect(search).not.toContain(USER_FLOW_URL_KEYS.userKey);
      /* A view belongs to a person a link can name. */
      expect(search).not.toContain(USER_FLOW_URL_KEYS.view);
    });

    test("cannot be read back from a URL either", () => {
      for (const search of [
        "?identifier=jane@example.com",
        "?user=jane@example.com",
        "?userKey=jane@example.com",
      ]) {
        expect(readUserFlowStateFromSearch(search).person).toBeUndefined();
      }
    });
  });

  test("taking the person away removes every trace of them", () => {
    for (const person of [USER, BROWSER, ONE_SESSION]) {
      const withPerson: string = buildUserFlowPageUrl(
        PAGE,
        stateOf(person, "map"),
      );

      expect(buildUserFlowPageUrl(withPerson, stateOf(undefined))).toBe(PAGE);
    }
  });

  test("changing person leaves no key of the last one behind", () => {
    const fromUser: string = buildUserFlowPageUrl(PAGE, stateOf(USER));
    const url: URL = new URL(buildUserFlowPageUrl(fromUser, stateOf(BROWSER)));

    expect(url.searchParams.has(USER_FLOW_URL_KEYS.userKey)).toBe(false);
    expect(url.searchParams.get(USER_FLOW_URL_KEYS.visitor)).toBe(VISITOR);
  });

  describe("the view", () => {
    test("the journeys are the default, written as absence", () => {
      expect(
        new URL(buildUserFlowPageUrl(PAGE, stateOf(USER, "journeys"))).search,
      ).toBe(`?userKey=${KEY}`);
    });

    test("the map round-trips", () => {
      const url: URL = new URL(
        buildUserFlowPageUrl(PAGE, stateOf(USER, "map")),
      );

      expect(url.searchParams.get(USER_FLOW_URL_KEYS.view)).toBe("map");
      expect(readUserFlowStateFromSearch(url.search).view).toBe("map");
    });

    test("means nothing without a person, and is not kept", () => {
      expect(readUserFlowStateFromSearch("?view=map").view).toBeUndefined();
      expect(buildUserFlowPageUrl(PAGE, stateOf(undefined, "map"))).toBe(PAGE);
    });

    test("anything else is the default", () => {
      expect(
        readUserFlowStateFromSearch(`?userKey=${KEY}&view=galaxy`).view,
      ).toBeUndefined();
    });
  });

  /*
   * A pasted link is untrusted input. A value that could never match would
   * come back as a 400, so it degrades to everyone's flows, as the session
   * list does with a bad visitor id.
   */
  describe("a link that does not name anyone", () => {
    test.each([
      ["a short digest", "?userKey=abc"],
      ["a digest that is not hex", `?userKey=${"z".repeat(64)}`],
      ["a long digest", `?userKey=${"a".repeat(65)}`],
      ["a short visitor id", "?visitor=abc"],
      ["a visitor id that is not hex", `?visitor=${"z".repeat(32)}`],
      ["an empty session id", "?sessionId="],
      ["a blank session id", "?sessionId=%20%20"],
      ["a session id past its cap", `?sessionId=${"s".repeat(129)}`],
    ])("%s", (_name: string, search: string) => {
      expect(readUserFlowStateFromSearch(search).person).toBeUndefined();
    });

    test("an upper-cased id is the same id", () => {
      expect(
        readUserFlowStateFromSearch(`?visitor=${VISITOR.toUpperCase()}`).person,
      ).toEqual(BROWSER);
      expect(
        readUserFlowStateFromSearch(`?userKey=${KEY.toUpperCase()}`).person,
      ).toEqual(USER);
    });
  });

  test("a link naming several people opens the narrowest", () => {
    expect(
      readUserFlowStateFromSearch(
        `?userKey=${KEY}&visitor=${VISITOR}&sessionId=${SESSION}`,
      ).person,
    ).toEqual(ONE_SESSION);
    expect(
      readUserFlowStateFromSearch(`?userKey=${KEY}&visitor=${VISITOR}`).person,
    ).toEqual(USER);
  });

  test("a person travels with every other control", () => {
    const state: UserFlowUrlState = {
      timeRange: { range: TimeRange.PAST_ONE_DAY },
      options: {
        ...DEFAULT_USER_FLOW_OPTIONS,
        deviceType: "mobile",
        sessionFilter: "errors",
      },
      person: USER,
      view: "map",
    };
    const url: URL = new URL(buildUserFlowPageUrl(PAGE, state));

    expect(readUserFlowStateFromSearch(url.search)).toEqual(state);
  });

  describe("buildUserFlowPersonSearch", () => {
    test("carries the person and the window they were counted in", () => {
      const search: string = buildUserFlowPersonSearch(USER, {
        range: TimeRange.PAST_ONE_DAY,
      });

      expect(new URLSearchParams(search).get("userKey")).toBe(KEY);
      /* A day is the session list's default, but not this page's: it is written. */
      expect(readUserFlowStateFromSearch(search).timeRange.range).toBe(
        TimeRange.PAST_ONE_DAY,
      );
    });

    test("this page's own default window stays absence", () => {
      expect(
        buildUserFlowPersonSearch(BROWSER, DEFAULT_USER_FLOW_TIME_RANGE),
      ).toBe(`?visitor=${VISITOR}`);
    });

    test("carries a custom window whole", () => {
      const search: string = buildUserFlowPersonSearch(ONE_SESSION, {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date("2026-09-01T00:00:00.000Z"),
          new Date("2026-09-02T00:00:00.000Z"),
        ),
      });
      const state: UserFlowUrlState = readUserFlowStateFromSearch(search);

      expect(state.person).toEqual(ONE_SESSION);
      expect(state.timeRange.range).toBe(TimeRange.CUSTOM);
    });
  });

  describe("links back to the session list", () => {
    test("name the same person with the list's own keys", () => {
      const fromHere: string = buildSessionsForPersonSearch(USER, {
        range: TimeRange.PAST_ONE_WEEK,
      });

      expect(readFiltersFromSearch(fromHere).advanced.identifiedUserKey).toBe(
        KEY,
      );

      /* What the Users page's own link for the same person reads as. */
      const fromUsersPage: string = buildUserSessionsListSearch(
        {
          filter: { identifiedUserKey: KEY },
          identifiedUserKey: KEY,
          identifiedUserLabel: "",
        },
        { range: TimeRange.PAST_ONE_WEEK },
      );

      expect(readFiltersFromSearch(fromHere)).toEqual(
        readFiltersFromSearch(fromUsersPage),
      );
    });

    test("a browser too", () => {
      expect(
        readFiltersFromSearch(
          buildSessionsForPersonSearch(BROWSER, {
            range: TimeRange.PAST_ONE_DAY,
          }),
        ).advanced.visitorId,
      ).toBe(VISITOR);
    });

    test("the list cannot narrow to one session, so there is no link", () => {
      expect(
        buildSessionsForPersonSearch(ONE_SESSION, {
          range: TimeRange.PAST_ONE_DAY,
        }),
      ).toBe("");
      expect(
        buildSessionsForPageSearch(
          "/cart",
          { range: TimeRange.PAST_ONE_DAY },
          ONE_SESSION,
        ),
      ).toBe("");
    });

    test("nor can it name what was only typed", () => {
      expect(
        buildSessionsForPersonSearch(
          { kind: "lookup", identifier: "jane@example.com" },
          { range: TimeRange.PAST_ONE_DAY },
        ),
      ).toBe("");
    });

    test("a page's sessions stay that person's", () => {
      const search: string = buildSessionsForPageSearch(
        "/orders/:id",
        { range: TimeRange.PAST_ONE_DAY },
        USER,
      );
      const { advanced } = readFiltersFromSearch(search);

      expect(advanced.urlPrefix).toBe("/orders/");
      expect(advanced.identifiedUserKey).toBe(KEY);
    });
  });
});
