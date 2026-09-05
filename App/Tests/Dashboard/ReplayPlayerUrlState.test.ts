import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * The player's URL model: what "Copy link at this moment" writes, what a log
 * row / span / exception occurrence link carries in, and how the player
 * turns either back into a playhead. The parser and serializer are pure;
 * buildReplayMomentRoute pulls in RouteMap, which pulls in Common/UI/Config,
 * which reads `window` the moment it loads - so the module is imported
 * after a browser stub exists (same approach as MonitorListFacetRoute.test.ts).
 */

const PROJECT_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const SESSION_ID: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const SESSION_START_UNIX_MS: number = 1_757_000_000_000;

type UrlStateModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayPlayerUrlState");
type NavigationClass = (typeof import("Common/UI/Utils/Navigation"))["default"];

let urlState: UrlStateModule;

const browser: {
  location: { pathname: string; search: string; hash: string };
  history: { state: unknown; replaceState: () => void };
} = {
  location: {
    pathname: `/dashboard/${PROJECT_ID}/rum/${APP_ID}/session-replay/${SESSION_ID}`,
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

beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = browser;

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

  urlState = await import(
    "../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayPlayerUrlState"
  );

  const Navigation: NavigationClass = (
    await import("Common/UI/Utils/Navigation")
  ).default;

  Navigation.setLocation({
    pathname: browser.location.pathname,
  } as unknown as Parameters<typeof Navigation.setLocation>[0]);
});

describe("parseReplayPlayerUrlState", () => {
  test("reads every key, accepting a search string, an href or URLSearchParams", () => {
    const search: string = `?t=41.2&at=${SESSION_START_UNIX_MS + 5000}&tab=tab-2&rail=logs&signal=rec:3:7&q=status%3A500`;

    for (const input of [
      search,
      `https://app.example.com/player${search}#hash`,
      new URLSearchParams(search),
    ]) {
      const parsed: import("../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayPlayerUrlState").ReplayPlayerUrlState =
        urlState.parseReplayPlayerUrlState(input);

      expect(parsed).toEqual({
        offsetMs: 41200,
        atUnixMs: SESSION_START_UNIX_MS + 5000,
        tabId: "tab-2",
        railTab: "logs",
        signalId: "rec:3:7",
        railSearch: "status:500",
      });
    }
  });

  test("an empty or absent search is the empty state", () => {
    const empty: ReturnType<typeof urlState.makeEmptyReplayPlayerUrlState> =
      urlState.makeEmptyReplayPlayerUrlState();

    expect(urlState.parseReplayPlayerUrlState("")).toEqual(empty);
    expect(urlState.parseReplayPlayerUrlState(null)).toEqual(empty);
    expect(urlState.parseReplayPlayerUrlState(undefined)).toEqual(empty);
    expect(urlState.parseReplayPlayerUrlState("?")).toEqual(empty);
  });

  test("decimal and whole ?t are both read, in milliseconds", () => {
    expect(urlState.parseReplayOffsetParam("41")).toBe(41000);
    expect(urlState.parseReplayOffsetParam("41.2")).toBe(41200);
    expect(urlState.parseReplayOffsetParam("0")).toBe(0);
    expect(urlState.parseReplayOffsetParam(" 7 ")).toBe(7000);
  });

  test("a ?t that is not a non-negative number is treated as absent", () => {
    for (const bad of [
      "-1",
      "abc",
      "1e3",
      "",
      "  ",
      "1:30",
      "NaN",
      "Infinity",
    ]) {
      expect(urlState.parseReplayOffsetParam(bad)).toBeNull();
    }

    expect(urlState.parseReplayOffsetParam(null)).toBeNull();
  });

  test("?at is an integer unix-millisecond value only", () => {
    expect(urlState.parseReplayAtParam(String(SESSION_START_UNIX_MS))).toBe(
      SESSION_START_UNIX_MS,
    );

    for (const bad of [
      "2026-09-04T10:00:00Z",
      "-5",
      "0",
      "1.5",
      "",
      "99999999999999999999",
    ]) {
      expect(urlState.parseReplayAtParam(bad)).toBeNull();
    }
  });

  test("an unknown rail tab is ignored; the short forms map to the canonical ids", () => {
    expect(
      urlState.parseReplayPlayerUrlState("?rail=bogus").railTab,
    ).toBeNull();
    expect(urlState.parseReplayPlayerUrlState("?rail=nav").railTab).toBe(
      "navigation",
    );
    expect(urlState.parseReplayPlayerUrlState("?rail=perf").railTab).toBe(
      "performance",
    );
    expect(urlState.parseReplayPlayerUrlState("?rail=Errors").railTab).toBe(
      "errors",
    );
    expect(urlState.parseReplayPlayerUrlState("?rail=all").railTab).toBe("all");
  });

  test("a signal id is kept only when it has one of the four shapes", () => {
    for (const good of [
      "rec:0:0",
      "log:abc",
      "span:0af1",
      "exc:id:with:colons",
    ]) {
      expect(
        urlState.parseReplayPlayerUrlState(`?signal=${good}`).signalId,
      ).toBe(good);
    }

    for (const bad of [
      "rec:1",
      "rec:a:b",
      "rec:-1:0",
      "foo:1",
      "log:",
      "rec",
    ]) {
      expect(
        urlState.parseReplayPlayerUrlState(`?signal=${bad}`).signalId,
      ).toBeNull();
    }
  });

  test("free text is trimmed and capped", () => {
    const long: string = "x".repeat(
      urlState.REPLAY_URL_RAIL_SEARCH_MAX_LENGTH + 50,
    );

    expect(
      urlState.parseReplayPlayerUrlState(`?q=${long}`).railSearch,
    ).toHaveLength(urlState.REPLAY_URL_RAIL_SEARCH_MAX_LENGTH);
    expect(
      urlState.parseReplayPlayerUrlState("?q=%20%20").railSearch,
    ).toBeNull();
    expect(
      urlState.parseReplayPlayerUrlState(
        `?tab=${"t".repeat(urlState.REPLAY_URL_TAB_ID_MAX_LENGTH + 1)}`,
      ).tabId,
    ).toBeNull();
  });
});

describe("serializeReplayPlayerUrlState", () => {
  test("round-trips with the parser", () => {
    const state: ReturnType<typeof urlState.parseReplayPlayerUrlState> = {
      offsetMs: 41000,
      atUnixMs: null,
      tabId: "tab-2",
      railTab: "network",
      signalId: "span:0af1",
      railSearch: "POST /api",
    };

    const serialized: string = urlState.serializeReplayPlayerUrlState(state);

    expect(urlState.parseReplayPlayerUrlState(serialized)).toEqual(state);
  });

  test("writes whole seconds for ?t even when the offset has a fraction", () => {
    expect(urlState.serializeReplayPlayerUrlState({ offsetMs: 41_999 })).toBe(
      "t=41",
    );
    expect(urlState.serializeReplayPlayerUrlState({ offsetMs: 0 })).toBe("t=0");
  });

  test("rewrites the player keys and leaves every other key alone", () => {
    const serialized: string = urlState.serializeReplayPlayerUrlState(
      { railTab: "errors", offsetMs: null },
      "?t=10&rail=logs&q=old&other=kept&tab=tab-1",
    );
    const params: URLSearchParams = new URLSearchParams(serialized);

    expect(params.get("other")).toBe("kept");
    expect(params.get("rail")).toBe("errors");
    expect(params.get("t")).toBeNull();
    expect(params.get("q")).toBeNull();
    expect(params.get("tab")).toBeNull();
  });

  test("drops invalid values instead of writing them", () => {
    expect(
      urlState.serializeReplayPlayerUrlState({
        offsetMs: -5,
        atUnixMs: 0,
        railTab: "bogus" as never,
        signalId: "nope",
        railSearch: "   ",
        tabId: "",
      }),
    ).toBe("");
  });
});

describe("resolveReplayInitialMoment", () => {
  const empty: () => ReturnType<
    typeof urlState.makeEmptyReplayPlayerUrlState
  > = () => {
    return urlState.makeEmptyReplayPlayerUrlState();
  };

  test("?at is converted with the session start and wins over ?t", () => {
    const moment: ReturnType<typeof urlState.resolveReplayInitialMoment> =
      urlState.resolveReplayInitialMoment({
        state: {
          ...empty(),
          atUnixMs: SESSION_START_UNIX_MS + 12_500,
          offsetMs: 3_000,
        },
        startTimeUnixMs: SESSION_START_UNIX_MS,
        durationMs: 60_000,
      });

    expect(moment).toEqual({
      offsetMs: 12_500,
      source: "at",
      wasClamped: false,
    });
  });

  test("?at without a known session start falls through to ?t", () => {
    expect(
      urlState.resolveReplayInitialMoment({
        state: {
          ...empty(),
          atUnixMs: SESSION_START_UNIX_MS + 12_500,
          offsetMs: 3_000,
        },
        startTimeUnixMs: null,
        durationMs: 60_000,
      }),
    ).toEqual({ offsetMs: 3_000, source: "t", wasClamped: false });
  });

  test("a moment outside the recording is clamped to its edge and says so", () => {
    expect(
      urlState.resolveReplayInitialMoment({
        state: { ...empty(), atUnixMs: SESSION_START_UNIX_MS - 4_000 },
        startTimeUnixMs: SESSION_START_UNIX_MS,
        durationMs: 60_000,
      }),
    ).toEqual({ offsetMs: 0, source: "at", wasClamped: true });

    expect(
      urlState.resolveReplayInitialMoment({
        state: { ...empty(), offsetMs: 90_000 },
        startTimeUnixMs: SESSION_START_UNIX_MS,
        durationMs: 60_000,
      }),
    ).toEqual({ offsetMs: 60_000, source: "t", wasClamped: true });
  });

  test("an unknown duration only clamps at zero", () => {
    expect(
      urlState.resolveReplayInitialMoment({
        state: { ...empty(), offsetMs: 90_000 },
        startTimeUnixMs: null,
        durationMs: null,
      }),
    ).toEqual({ offsetMs: 90_000, source: "t", wasClamped: false });
  });

  test("a ?signal with no t/at seeks to the row's offset minus the pre-roll", () => {
    expect(
      urlState.resolveReplayInitialMoment({
        state: { ...empty(), signalId: "log:abc" },
        startTimeUnixMs: SESSION_START_UNIX_MS,
        durationMs: 60_000,
        signalOffsetMs: 20_000,
      }),
    ).toEqual({
      offsetMs: 20_000 - urlState.REPLAY_SIGNAL_PRE_ROLL_MS,
      source: "signal",
      wasClamped: false,
    });

    /* A row in the first second lands at 0 and that is not a clamp. */
    expect(
      urlState.resolveReplayInitialMoment({
        state: { ...empty(), signalId: "log:abc" },
        startTimeUnixMs: SESSION_START_UNIX_MS,
        durationMs: 60_000,
        signalOffsetMs: 300,
      }),
    ).toEqual({ offsetMs: 0, source: "signal", wasClamped: false });
  });

  test("nothing in the URL opens at the start", () => {
    expect(
      urlState.resolveReplayInitialMoment({
        state: empty(),
        startTimeUnixMs: SESSION_START_UNIX_MS,
        durationMs: 60_000,
      }),
    ).toEqual({ offsetMs: 0, source: "none", wasClamped: false });
  });
});

describe("buildReplayMomentQueryParams", () => {
  test("applies the 1s pre-roll to a row moment and the 10s pre-roll to an exception", () => {
    expect(
      urlState.buildReplayMomentQueryParams({
        rumApplicationId: APP_ID,
        sessionId: SESSION_ID,
        at: SESSION_START_UNIX_MS + 30_000,
        signal: "log:abc",
        rail: "logs",
      }),
    ).toEqual({
      at: String(
        SESSION_START_UNIX_MS + 30_000 - urlState.REPLAY_MOMENT_PRE_ROLL_MS,
      ),
      signal: "log:abc",
      rail: "logs",
    });

    expect(
      urlState.buildReplayMomentQueryParams({
        rumApplicationId: APP_ID,
        sessionId: SESSION_ID,
        at: new Date(SESSION_START_UNIX_MS + 30_000),
        signal: "exc:inst-1",
        rail: "errors",
      }),
    ).toEqual({
      at: String(
        SESSION_START_UNIX_MS + 30_000 - urlState.REPLAY_EXCEPTION_PRE_ROLL_MS,
      ),
      signal: "exc:inst-1",
      rail: "errors",
    });
  });

  test("a ?t offset is pre-rolled, clamped at zero and written as whole seconds", () => {
    expect(
      urlState.buildReplayMomentQueryParams({
        rumApplicationId: APP_ID,
        sessionId: SESSION_ID,
        t: 400,
      }),
    ).toEqual({ t: "0" });

    expect(
      urlState.buildReplayMomentQueryParams({
        rumApplicationId: APP_ID,
        sessionId: SESSION_ID,
        t: 12_999,
        preRollMs: 0,
      }),
    ).toEqual({ t: "12" });
  });

  test("at wins over t when both are supplied", () => {
    expect(
      urlState.buildReplayMomentQueryParams({
        rumApplicationId: APP_ID,
        sessionId: SESSION_ID,
        at: SESSION_START_UNIX_MS,
        t: 5_000,
        preRollMs: 0,
      }),
    ).toEqual({ at: String(SESSION_START_UNIX_MS) });
  });

  test("invalid signal / rail values are dropped rather than written", () => {
    expect(
      urlState.buildReplayMomentQueryParams({
        rumApplicationId: APP_ID,
        sessionId: SESSION_ID,
        signal: "nonsense",
        rail: "bogus",
        tab: " tab-3 ",
        q: "  500 ",
      }),
    ).toEqual({ tab: "tab-3", q: "500" });
  });
});

describe("buildReplayMomentRoute", () => {
  test("builds the player route for the session with the moment encoded", () => {
    const route: ReturnType<typeof urlState.buildReplayMomentRoute> =
      urlState.buildReplayMomentRoute({
        rumApplicationId: APP_ID,
        sessionId: SESSION_ID,
        at: SESSION_START_UNIX_MS + 30_000,
        signal: "span:0af1",
        rail: "traces",
        q: "POST /api",
      });

    expect(route).not.toBeNull();

    const url: URL = new URL(`https://example.com${route!.toString()}`);

    expect(url.pathname).toBe(
      `/dashboard/${PROJECT_ID}/rum/${APP_ID}/session-replay/${SESSION_ID}`,
    );
    expect(url.searchParams.get("at")).toBe(
      String(
        SESSION_START_UNIX_MS + 30_000 - urlState.REPLAY_MOMENT_PRE_ROLL_MS,
      ),
    );
    expect(url.searchParams.get("signal")).toBe("span:0af1");
    expect(url.searchParams.get("rail")).toBe("traces");
    expect(url.searchParams.get("q")).toBe("POST /api");

    /* And the player reads it back exactly. */
    expect(urlState.parseReplayPlayerUrlState(url.search)).toEqual({
      offsetMs: null,
      atUnixMs:
        SESSION_START_UNIX_MS + 30_000 - urlState.REPLAY_MOMENT_PRE_ROLL_MS,
      tabId: null,
      railTab: "traces",
      signalId: "span:0af1",
      railSearch: "POST /api",
    });
  });

  test("a route with no moment carries no query string", () => {
    const route: ReturnType<typeof urlState.buildReplayMomentRoute> =
      urlState.buildReplayMomentRoute({
        rumApplicationId: APP_ID,
        sessionId: SESSION_ID,
      });

    expect(route!.toString()).not.toContain("?");
  });

  test("renders nothing without both ids", () => {
    expect(
      urlState.buildReplayMomentRoute({
        rumApplicationId: APP_ID,
        sessionId: "",
      }),
    ).toBeNull();
    expect(
      urlState.buildReplayMomentRoute({
        rumApplicationId: null,
        sessionId: SESSION_ID,
      }),
    ).toBeNull();
    expect(
      urlState.buildReplayMomentRoute({
        rumApplicationId: "  ",
        sessionId: SESSION_ID,
      }),
    ).toBeNull();
  });
});
