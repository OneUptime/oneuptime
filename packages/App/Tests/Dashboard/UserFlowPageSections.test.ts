import { describe, expect, test } from "@jest/globals";
import {
  DEFAULT_USER_FLOW_OPTIONS,
  UserFlowOptions,
  UserFlowSessionFilter,
} from "Common/Utils/Rum/UserFlow";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import {
  getClearedUserFlowFilters,
  getUserFlowPageSections,
  getUserFlowPageState,
  hasUserFlowNarrowingFilters,
  UserFlowNarrowingFilters,
  UserFlowPageSection,
  UserFlowPageState,
  UserFlowPageStateInput,
} from "../../FeatureSet/Dashboard/src/Components/UserFlow/UserFlowPageSections";
import { formatUserFlowSessionsHint } from "../../FeatureSet/Dashboard/src/Components/UserFlow/UserFlowFormat";
import { UserFlowScope } from "../../FeatureSet/Dashboard/src/Components/UserFlow/UserFlowScope";

/*
 * What the User Flows page's body shows, and in what order (issue #6192:
 * narrowed to one user, the page drew their journeys first and the map
 * under them). The rendered page is pinned against these in
 * Common/Tests/UI/Rum/UserFlowsPageLayout.test.tsx.
 */

const USER: UserFlowScope = {
  kind: "user",
  identifiedUserKey: "a".repeat(64),
  identifiedUserRef: "",
};
const TYPED_USER: UserFlowScope = {
  kind: "user",
  identifiedUserKey: "",
  identifiedUserRef: "jane@example.com",
};
const VISITOR: UserFlowScope = {
  kind: "visitor",
  visitorId: "0123456789abcdef0123456789abcdef",
};
const SESSION: UserFlowScope = {
  kind: "session",
  sessionId: "c0000000000000000000000000000001",
};
const EVERY_SCOPE: Array<UserFlowScope> = [USER, TYPED_USER, VISITOR, SESSION];
const NAMED_SCOPES: Array<[string, UserFlowScope]> = [
  ["one user", USER],
  ["one user by a typed reference", TYPED_USER],
  ["one visitor", VISITOR],
  ["one session", SESSION],
];
const EVERY_SCOPE_OR_NONE: Array<UserFlowScope | null> = [null, ...EVERY_SCOPE];

const NO_FILTERS: UserFlowNarrowingFilters = {
  sessionFilter: "all",
  deviceType: "",
  hiddenPages: [],
};

/* One of each control that drops whole sessions, alone. */
const EACH_FILTER: Array<[string, UserFlowNarrowingFilters]> = [
  ["sessions with errors", { ...NO_FILTERS, sessionFilter: "errors" }],
  [
    "sessions with frustration signals",
    { ...NO_FILTERS, sessionFilter: "frustration" },
  ],
  ["one device", { ...NO_FILTERS, deviceType: "mobile" }],
  ["a hidden page", { ...NO_FILTERS, hiddenPages: ["/"] }],
];

function state(overrides: Partial<UserFlowPageStateInput>): UserFlowPageState {
  return getUserFlowPageState({
    isLoading: false,
    error: "",
    scope: null,
    sessionsRead: 10,
    journeysKept: 10,
    options: NO_FILTERS,
    ...overrides,
  });
}

describe("the order the body reads in", () => {
  test("for everyone: the numbers and findings, then the map, then the tables", () => {
    expect(getUserFlowPageSections(null)).toEqual([
      "overview",
      "map",
      "tables",
    ]);
  });

  test.each(NAMED_SCOPES)(
    "for %s: the same, with their journeys under the map and above the tables",
    (_name: string, scope: UserFlowScope) => {
      expect(getUserFlowPageSections(scope)).toEqual([
        "overview",
        "map",
        "journeys",
        "tables",
      ]);
    },
  );

  test("narrowing only adds the journeys: every other section keeps its place", () => {
    for (const scope of EVERY_SCOPE) {
      expect(
        getUserFlowPageSections(scope).filter(
          (section: UserFlowPageSection): boolean => {
            return section !== "journeys";
          },
        ),
      ).toEqual(getUserFlowPageSections(null));
    }
  });

  test("the map is never under the journeys, and the overview always comes first", () => {
    for (const scope of EVERY_SCOPE_OR_NONE) {
      const sections: Array<UserFlowPageSection> =
        getUserFlowPageSections(scope);

      expect(sections[0]).toBe("overview");
      expect(sections[1]).toBe("map");
      expect(sections[sections.length - 1]).toBe("tables");

      if (sections.includes("journeys")) {
        expect(sections.indexOf("journeys")).toBeGreaterThan(
          sections.indexOf("map"),
        );
      }
    }
  });

  test("only a narrowed page lists journeys, and each section is drawn once", () => {
    for (const scope of EVERY_SCOPE_OR_NONE) {
      const sections: Array<UserFlowPageSection> =
        getUserFlowPageSections(scope);

      expect(sections.includes("journeys")).toBe(scope !== null);
      expect(new Set(sections).size).toBe(sections.length);
    }
  });

  test("each call is a list of its own, so a caller cannot reorder the next page", () => {
    const first: Array<UserFlowPageSection> = getUserFlowPageSections(USER);

    first.reverse();

    expect(getUserFlowPageSections(USER)).toEqual([
      "overview",
      "map",
      "journeys",
      "tables",
    ]);
  });
});

describe("what the body shows", () => {
  test("the first read for anyone is a loader", () => {
    for (const scope of EVERY_SCOPE_OR_NONE) {
      expect(state({ scope: scope, isLoading: true, sessionsRead: null })).toBe(
        "loading",
      );
    }
  });

  test("a read with an answer in hand keeps drawing it, and the map says Updating", () => {
    expect(state({ isLoading: true })).toBe("ready");
    expect(state({ scope: USER, isLoading: true })).toBe("ready");
  });

  test("a failed read is said", () => {
    expect(state({ error: "Could not load", sessionsRead: null })).toBe(
      "error",
    );
  });

  test("a failed read is said even with an older answer in hand, which is for the range before", () => {
    for (const scope of EVERY_SCOPE_OR_NONE) {
      expect(state({ scope: scope, error: "Could not load" })).toBe("error");
      expect(
        state({
          scope: scope,
          error: "Could not load",
          sessionsRead: 0,
          journeysKept: 0,
        }),
      ).toBe("error");
    }
  });

  test("a new read for another person shows the loader, not the last person's error", () => {
    expect(
      state({
        scope: USER,
        isLoading: true,
        error: "The server did not narrow this read",
        sessionsRead: null,
      }),
    ).toBe("loading");
  });

  test("nobody recorded in the range reads as a missing install", () => {
    expect(state({ sessionsRead: 0, journeysKept: 0 })).toBe("empty");
  });

  test.each(NAMED_SCOPES)(
    "%s nobody recorded in the range says so, as themselves",
    (_name: string, scope: UserFlowScope) => {
      expect(state({ scope: scope, sessionsRead: 0, journeysKept: 0 })).toBe(
        "scope-empty",
      );
    },
  );

  test.each(EACH_FILTER)(
    "%s that leaves nothing says so, for everyone and for one person",
    (_name: string, filters: UserFlowNarrowingFilters) => {
      for (const scope of EVERY_SCOPE_OR_NONE) {
        expect(
          state({
            scope: scope,
            sessionsRead: 3,
            journeysKept: 0,
            options: filters,
          }),
        ).toBe("filtered-out");
      }
    },
  );

  test("filters that keep one session draw the page", () => {
    for (const [, filters] of EACH_FILTER) {
      expect(
        state({ sessionsRead: 3, journeysKept: 1, options: filters }),
      ).toBe("ready");
    }
  });

  test("nothing kept with no filter to clear reads as nothing recorded, not as a filter", () => {
    expect(state({ sessionsRead: 3, journeysKept: 0 })).toBe("empty");
    expect(state({ scope: USER, sessionsRead: 3, journeysKept: 0 })).toBe(
      "scope-empty",
    );
  });

  test("no answer, no read and no error is the page with nothing recorded", () => {
    expect(state({ sessionsRead: null, journeysKept: 0 })).toBe("empty");
  });

  test("a read whose journeys survive the filters draws the page", () => {
    for (const scope of EVERY_SCOPE_OR_NONE) {
      expect(state({ scope: scope, sessionsRead: 1, journeysKept: 1 })).toBe(
        "ready",
      );
    }
  });

  /*
   * Every combination of what the page can hold, drawn, against the rules
   * above stated once more as invariants. A state that never comes up would
   * be dead code, so every one must.
   */
  test("over drawn inputs, every state keeps its rule and every state comes up", () => {
    const random: SeededRandom = seededRandom(6192);
    const sessionFilters: Array<UserFlowSessionFilter> = [
      "all",
      "errors",
      "frustration",
    ];
    const seen: Set<UserFlowPageState> = new Set<UserFlowPageState>();

    for (let draw: number = 0; draw < 5000; draw++) {
      const sessionsRead: number | null =
        random(4) === 0 ? null : random(3) === 0 ? 0 : 1 + random(20);
      const options: UserFlowNarrowingFilters = {
        sessionFilter: sessionFilters[random(3)] as UserFlowSessionFilter,
        deviceType: random(3) === 0 ? "mobile" : "",
        hiddenPages: random(4) === 0 ? ["/"] : [],
      };
      const input: UserFlowPageStateInput = {
        isLoading: random(2) === 0,
        error: random(5) === 0 ? "Could not load" : "",
        scope: EVERY_SCOPE_OR_NONE[random(5)] as UserFlowScope | null,
        sessionsRead: sessionsRead,
        journeysKept:
          sessionsRead === null || random(3) === 0
            ? 0
            : random(sessionsRead + 1),
        options: options,
      };
      const result: UserFlowPageState = getUserFlowPageState(input);
      const isFirstRead: boolean =
        input.isLoading && input.sessionsRead === null;

      seen.add(result);

      expect(result === "loading").toBe(isFirstRead);
      expect(result === "error").toBe(!isFirstRead && Boolean(input.error));

      if (result === "ready") {
        expect(input.journeysKept).toBeGreaterThan(0);
        expect(input.error).toBe("");
      }

      if (result === "filtered-out") {
        expect(input.sessionsRead).toBeGreaterThan(0);
        expect(input.journeysKept).toBe(0);
        expect(hasUserFlowNarrowingFilters(input.options)).toBe(true);
      }

      if (result === "scope-empty") {
        expect(input.scope).not.toBeNull();
      }

      if (
        !isFirstRead &&
        !input.error &&
        input.sessionsRead !== null &&
        input.sessionsRead > 0 &&
        input.journeysKept > 0
      ) {
        expect(result).toBe("ready");
      }
    }

    expect(Array.from(seen).sort()).toEqual(
      [
        "empty",
        "error",
        "filtered-out",
        "loading",
        "ready",
        "scope-empty",
      ].sort(),
    );
  });
});

describe("the filters that drop whole sessions", () => {
  test("none is set by default", () => {
    expect(hasUserFlowNarrowingFilters(DEFAULT_USER_FLOW_OPTIONS)).toBe(false);
    expect(hasUserFlowNarrowingFilters(NO_FILTERS)).toBe(false);
  });

  test.each(EACH_FILTER)(
    "%s is one",
    (_name: string, filters: UserFlowNarrowingFilters) => {
      expect(hasUserFlowNarrowingFilters(filters)).toBe(true);
    },
  );

  test("the controls that only redraw the same sessions are not", () => {
    const redrawn: UserFlowOptions = {
      ...DEFAULT_USER_FLOW_OPTIONS,
      anchorPage: "/cart",
      direction: "backward",
      steps: 9,
      pagesPerStep: 12,
      groupDynamicSegments: false,
    };

    expect(hasUserFlowNarrowingFilters(redrawn)).toBe(false);
  });

  test("Clear filters keeps every session and shows every page", () => {
    expect(getClearedUserFlowFilters()).toEqual(NO_FILTERS);

    for (const [, filters] of EACH_FILTER) {
      expect(
        hasUserFlowNarrowingFilters({
          ...filters,
          ...getClearedUserFlowFilters(),
        }),
      ).toBe(false);
    }
  });

  test("Clear filters leaves where the map starts and how it is drawn", () => {
    const options: UserFlowOptions = {
      anchorPage: "/cart",
      direction: "backward",
      steps: 7,
      pagesPerStep: 4,
      groupDynamicSegments: false,
      hiddenPages: ["/login", "/help"],
      sessionFilter: "errors",
      deviceType: "tablet",
    };

    expect({ ...options, ...getClearedUserFlowFilters() }).toEqual({
      anchorPage: "/cart",
      direction: "backward",
      steps: 7,
      pagesPerStep: 4,
      groupDynamicSegments: false,
      hiddenPages: [],
      sessionFilter: "all",
      deviceType: "",
    });
  });

  test("each clear is an object of its own, so hiding a page later cannot leak into the next", () => {
    const first: UserFlowNarrowingFilters = getClearedUserFlowFilters();

    first.hiddenPages.push("/checkout");

    expect(getClearedUserFlowFilters().hiddenPages).toEqual([]);
  });
});

describe("the line under Sessions analysed says whose sessions they are", () => {
  const counts: {
    sessions: number;
    sessionsInWindow: number;
    isSampled: boolean;
  } = { sessions: 3, sessionsInWindow: 3, isSampled: false };

  test("everyone's, as it always has", () => {
    expect(formatUserFlowSessionsHint(counts)).toBe(
      "recorded sessions in range",
    );
    expect(formatUserFlowSessionsHint({ ...counts, scopeKind: null })).toBe(
      "recorded sessions in range",
    );
    expect(
      formatUserFlowSessionsHint({ ...counts, scopeKind: undefined }),
    ).toBe("recorded sessions in range");
  });

  test("one user's, one visitor's, or one session's", () => {
    expect(formatUserFlowSessionsHint({ ...counts, scopeKind: "user" })).toBe(
      "this user's sessions in range",
    );
    expect(
      formatUserFlowSessionsHint({ ...counts, scopeKind: "visitor" }),
    ).toBe("this visitor's sessions in range");
    expect(
      formatUserFlowSessionsHint({ ...counts, scopeKind: "session" }),
    ).toBe("this session only");
  });

  test("no narrowed line reads like everyone's, and no two are alike", () => {
    const lines: Array<string> = EVERY_SCOPE_OR_NONE.map(
      (scope: UserFlowScope | null): string => {
        return formatUserFlowSessionsHint({
          ...counts,
          scopeKind: scope?.kind ?? null,
        });
      },
    );

    /* The typed and the keyed user are one kind. */
    expect(new Set(lines).size).toBe(4);
  });

  test("a read cut to the newest sessions says so, for anyone", () => {
    for (const scope of EVERY_SCOPE_OR_NONE) {
      expect(
        formatUserFlowSessionsHint({
          sessions: 5000,
          sessionsInWindow: 12345,
          isSampled: true,
          scopeKind: scope?.kind ?? null,
        }),
      ).toBe("newest 5,000 of 12,345 recorded");
    }
  });
});
