import { describe, expect, test } from "@jest/globals";
import TimeRange from "Common/Types/Time/TimeRange";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import {
  analyzeUserFlow,
  DEFAULT_USER_FLOW_OPTIONS,
  getUserFlowPageText,
  USER_FLOW_MAX_STEPS,
  UserFlowAnalysis,
  UserFlowNode,
  UserFlowPageCount,
  UserFlowPageStats,
} from "Common/Utils/Rum/UserFlow";
import { UserFlowJourneysResponseDto } from "Common/Types/Rum/UserFlow";
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

/*
 * #8018: User Flows keys a page in one spelling since #7983 ("/caf%C3%A9"),
 * but a link made before it holds the spelling its session was stored in:
 * "/caf%c3%a9" (lower-case hex) or "/cafe%CC%81" (a decomposed accent). No
 * row has that key any more, so the map lost its anchor and the hidden
 * page came back. The link is read in the key's spelling, opens on the row
 * it named, and is written back in that spelling.
 */
describe("a link made before a page had one spelling", () => {
  const CAFE: string = "/caf%C3%A9";
  const MENU: string = "/men%C3%BC";

  // ?page=/caf%c3%a9&hide=/men%c3%bc&hide=/menu%CC%88, as a browser escapes them.
  const OLD_LINK: string = `?page=${encodeURIComponent("/caf%c3%a9")}&dir=backward&hide=${encodeURIComponent("/men%c3%bc")}&hide=${encodeURIComponent("/menu%CC%88")}&hide=%2Flogin`;

  function session(
    id: string,
    pages: Array<number>,
  ): UserFlowJourneysResponseDto["sessions"][number] {
    return {
      sessionId: id,
      startUnixMs: 0,
      durationMs: 1000,
      deviceType: "desktop",
      browserName: "Chrome",
      countryCode: "US",
      errorCount: 0,
      frustrationCount: 0,
      pages: pages,
      pageSignals: [],
    };
  }

  /*
   * Five sessions to /café, stored before and after the one spelling, each
   * through a menu page stored in three spellings, or through /login.
   */
  const RESPONSE: UserFlowJourneysResponseDto = {
    pages: [
      "https://shop.example.com/",
      "https://shop.example.com/men%c3%bc",
      "https://shop.example.com/men%C3%BC",
      "https://shop.example.com/menu%CC%88",
      "https://shop.example.com/caf%c3%a9",
      "https://shop.example.com/cafe%CC%81",
      "https://shop.example.com/caf%C3%A9",
      "https://shop.example.com/login",
    ],
    sessions: [
      session("s1", [0, 1, 4]),
      session("s2", [0, 2, 5]),
      session("s3", [0, 3, 6]),
      session("s4", [0, 7, 6]),
      session("s5", [0, 6]),
    ],
    sessionsInWindow: 5,
    isSampled: false,
    maxSessions: 5000,
    startUnixMs: 0,
    endUnixMs: 1,
    scope: null,
  };

  test("reads the anchor and the hidden pages in the key's one spelling", () => {
    const state: UserFlowUrlState = readUserFlowStateFromSearch(OLD_LINK);

    expect(state.options.anchorPage).toBe(CAFE);
    expect(state.options.direction).toBe("backward");
    // Two spellings of one page are one hidden page.
    expect(state.options.hiddenPages).toEqual([MENU, "/login"]);
  });

  test("opens on the /caf%C3%A9 row, with the hidden page hidden in every spelling", () => {
    const state: UserFlowUrlState = readUserFlowStateFromSearch(OLD_LINK);
    const analysis: UserFlowAnalysis = analyzeUserFlow(RESPONSE, state.options);

    // One row for the page, with every session that reached it.
    expect(
      analysis.availablePages.filter((page: UserFlowPageCount): boolean => {
        return getUserFlowPageText(page.page) === "/café";
      }),
    ).toEqual([{ page: CAFE, sessions: 5 }]);

    // The map is anchored on it: step 0 is the page, all five sessions there.
    const anchor: UserFlowNode | undefined = analysis.graph.nodes.find(
      (node: UserFlowNode): boolean => {
        return node.step === 0;
      },
    );

    expect(analysis.graph.anchorPage).toBe(CAFE);
    expect(anchor).toMatchObject({ page: CAFE, sessions: 5 });

    // Backward, the page before it: the menu and /login are hidden, so "/".
    expect(
      analysis.graph.nodes
        .filter((node: UserFlowNode): boolean => {
          return node.step === 1;
        })
        .map((node: UserFlowNode): [string, number] => {
          return [node.page, node.sessions];
        }),
    ).toEqual([["/", 5]]);
    expect(
      analysis.pages.some((page: UserFlowPageStats): boolean => {
        return page.page === MENU || page.page === "/login";
      }),
    ).toBe(false);
  });

  test("the link it shows is written back in the new spelling", () => {
    const state: UserFlowUrlState = readUserFlowStateFromSearch(OLD_LINK);
    const url: URL = new URL(buildUserFlowPageUrl(`${PAGE}${OLD_LINK}`, state));

    expect(url.searchParams.get(USER_FLOW_URL_KEYS.anchor)).toBe(CAFE);
    expect(url.searchParams.getAll(USER_FLOW_URL_KEYS.hide)).toEqual([
      MENU,
      "/login",
    ]);
    expect(url.search).not.toContain("%25c3");
    expect(url.search).not.toContain("%25CC");
    // Read again, it is the same state: the spelling is settled.
    expect(readUserFlowStateFromSearch(url.search)).toEqual(state);
  });

  test("a hidden page that is the anchor in another spelling is not hidden", () => {
    const state: UserFlowUrlState = readUserFlowStateFromSearch(
      `?page=${encodeURIComponent(CAFE)}&hide=${encodeURIComponent("/cafe%CC%81")}&hide=${encodeURIComponent("/caf%c3%a9")}`,
    );

    expect(state.options.anchorPage).toBe(CAFE);
    expect(state.options.hiddenPages).toEqual([]);
  });

  test("a key that names a host, a grouped id or a page apart keeps its own", () => {
    const state: UserFlowUrlState = readUserFlowStateFromSearch(
      `?page=${encodeURIComponent("shop.example.com/caf%c3%a9")}&hide=${encodeURIComponent("/orders/:id")}&hide=${encodeURIComponent("/a%2fb")}&hide=${encodeURIComponent("/a/b")}&hide=%2FCart&hide=%2Fcart`,
    );

    expect(state.options.anchorPage).toBe("shop.example.com/caf%C3%A9");
    expect(state.options.hiddenPages).toEqual([
      "/orders/:id",
      "/a%2Fb",
      "/a/b",
      "/Cart",
      "/cart",
    ]);
  });

  test("a page a person typed as it reads opens on its row too", () => {
    expect(
      readUserFlowStateFromSearch(`?page=${encodeURIComponent("/café")}`)
        .options.anchorPage,
    ).toBe(CAFE);
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
