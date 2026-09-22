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
  DEFAULT_USER_FLOW_TIME_RANGE,
  readUserFlowStateFromSearch,
  USER_FLOW_URL_KEYS,
  UserFlowUrlState,
} from "../../FeatureSet/Dashboard/src/Components/UserFlow/UserFlowUrlState";
import { readFiltersFromSearch } from "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayListFilters";

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
