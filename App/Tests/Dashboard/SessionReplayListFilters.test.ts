import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import TimeRange from "Common/Types/Time/TimeRange";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { SessionReplaySortedListCursorDto } from "Common/Types/Rum/SessionReplayApi";
import {
  buildCursorMemoryKey,
  buildFilteredUrl,
  buildSessionReplayListFilters,
  DEFAULT_SESSION_REPLAY_SORT_BY,
  DEFAULT_SESSION_REPLAY_TIME_RANGE,
  EMPTY_ADVANCED_FILTERS,
  FILTER_URL_KEYS,
  hasAnyAdvancedFilter,
  normalizeUrlPrefix,
  parseCursorMemory,
  parseTagFilter,
  readFiltersFromSearch,
  readListStateFromSearch,
  readTimeRangeFromSearch,
  serializeCursorMemory,
  SESSION_REPLAY_SIGNAL_OPTIONS,
  SESSION_REPLAY_SIGNALS,
  SESSION_REPLAY_SORT_OPTIONS,
  SessionReplayListUrlState,
  stringifyTagFilter,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayListFilters";

/*
 * The list filter model: the one place that translates the table's filter
 * UI into the /telemetry/rum/session-replay/list endpoint's field names,
 * and into the URL query string that makes a filtered list shareable.
 * Misspell one endpoint key here and the filter silently matches nothing —
 * the endpoint ignores unknown fields — so the exact shapes are pinned.
 */

describe("buildSessionReplayListFilters", () => {
  test("the frustration signal is a SERVER-side filter now", () => {
    expect(buildSessionReplayListFilters("frustration")).toEqual({
      hasFrustration: true,
    });
    expect(buildSessionReplayListFilters("errors")).toEqual({
      hasError: true,
    });
    expect(buildSessionReplayListFilters("all")).toEqual({});
  });

  test("every quick filter maps to exactly one server predicate", () => {
    expect(buildSessionReplayListFilters("identified")).toEqual({
      hasIdentifiedUser: true,
    });
    expect(buildSessionReplayListFilters("playable")).toEqual({
      isPlayable: true,
    });
    expect(buildSessionReplayListFilters("live")).toEqual({
      isFinalized: false,
    });
    expect(buildSessionReplayListFilters("traced")).toEqual({
      hasTraces: true,
    });
    expect(buildSessionReplayListFilters("slow")).toEqual({
      triggerReasons: ["performance"],
    });
  });

  test("the Slow quick filter wins over the advanced trigger field", () => {
    expect(
      buildSessionReplayListFilters("slow", {
        ...EMPTY_ADVANCED_FILTERS,
        triggerReason: "error",
      }),
    ).toEqual({ triggerReasons: ["performance"] });
  });

  test("field filters land under the exact names the endpoint parses", () => {
    const filters: JSONObject = buildSessionReplayListFilters("all", {
      ...EMPTY_ADVANCED_FILTERS,
      browserName: " Chrome ",
      osName: "macOS",
      deviceType: "desktop",
      countryCode: "de",
      identifiedUserRef: "jane@example.com",
      route: "/checkout",
      minDurationSeconds: "90",
      triggerReason: "error",
      urlPrefix: " /checkout ",
      tags: "build=1.4.2, plan = pro",
      search: " checkout ",
    });

    expect(filters).toEqual({
      browserNames: ["Chrome"],
      osNames: ["macOS"],
      deviceTypes: ["desktop"],
      /* The stored column is upper-case ISO codes. */
      countryCodes: ["DE"],
      /*
       * The REFERENCE, not a digest. The server hashes it with the
       * per-project derivation the ingest used - the raw key is displayed
       * nowhere in the product, so a field demanding it could never match.
       */
      identifiedUserRef: "jane@example.com",
      route: "/checkout",
      /* The input is seconds; the endpoint takes milliseconds. */
      minDurationMs: 90000,
      triggerReasons: ["error"],
      urlPrefix: "/checkout",
      tags: { build: "1.4.2", plan: "pro" },
      search: "checkout",
    });
  });

  /*
   * ux-03 / integration-001: the modal writes urlPrefix straight from a
   * text input, and the endpoint's prefix comparison starts at the
   * beginning of each address. An un-anchored value can only ever return
   * "no sessions match", so it is anchored on the way out.
   */
  test("a URL prefix is anchored before it reaches the endpoint", () => {
    expect(normalizeUrlPrefix("checkout")).toBe("/checkout");
    expect(normalizeUrlPrefix("shop.example.com/cart")).toBe(
      "https://shop.example.com/cart",
    );
    expect(normalizeUrlPrefix("localhost:3000/cart")).toBe(
      "https://localhost:3000/cart",
    );
    /* A dotted word alone is a page, not a host typed without a scheme. */
    expect(normalizeUrlPrefix("checkout.html")).toBe("/checkout.html");
    /* Already anchored: untouched, both shapes the server can match. */
    expect(normalizeUrlPrefix(" /checkout ")).toBe("/checkout");
    expect(normalizeUrlPrefix("https://app.acme.com/cart")).toBe(
      "https://app.acme.com/cart",
    );
    expect(normalizeUrlPrefix("   ")).toBe("");

    expect(
      buildSessionReplayListFilters("all", {
        ...EMPTY_ADVANCED_FILTERS,
        urlPrefix: "checkout",
      }),
    ).toEqual({ urlPrefix: "/checkout" });
  });

  test("empty and unparseable fields are dropped, not sent as empties", () => {
    expect(
      buildSessionReplayListFilters("all", {
        ...EMPTY_ADVANCED_FILTERS,
        minDurationSeconds: "not-a-number",
        browserName: "   ",
        tags: "no-equals-sign, =missing-key",
        search: "  ",
      }),
    ).toEqual({});
  });

  test("hasAnyAdvancedFilter ignores whitespace-only values", () => {
    expect(hasAnyAdvancedFilter(EMPTY_ADVANCED_FILTERS)).toBe(false);
    expect(
      hasAnyAdvancedFilter({ ...EMPTY_ADVANCED_FILTERS, route: "  " }),
    ).toBe(false);
    expect(
      hasAnyAdvancedFilter({ ...EMPTY_ADVANCED_FILTERS, route: "/cart" }),
    ).toBe(true);
    expect(
      hasAnyAdvancedFilter({ ...EMPTY_ADVANCED_FILTERS, search: "jane" }),
    ).toBe(true);
  });
});

describe("tag filter text", () => {
  test("parses key=value pairs and drops malformed ones", () => {
    expect(parseTagFilter("build=1.4.2, plan=pro, junk, =x, empty=")).toEqual({
      build: "1.4.2",
      plan: "pro",
      empty: "",
    });
  });

  test("stringify round-trips through parse", () => {
    const tags: Record<string, string> = { build: "1.4.2", plan: "pro" };

    expect(parseTagFilter(stringifyTagFilter(tags))).toEqual(tags);
  });
});

describe("quick filter and sort catalogues", () => {
  test("every signal has a label and a description, and 'all' is first", () => {
    expect(SESSION_REPLAY_SIGNALS[0]).toBe("all");

    for (const option of SESSION_REPLAY_SIGNAL_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.description.length).toBeGreaterThan(0);
    }

    expect(SESSION_REPLAY_SIGNALS).toEqual([
      "all",
      "errors",
      "frustration",
      "identified",
      "playable",
      "slow",
      "live",
      "traced",
    ]);
  });

  test("the sort options are the four keys the server accepts, newest first", () => {
    expect(
      SESSION_REPLAY_SORT_OPTIONS.map((option: { value: string }): string => {
        return option.value;
      }),
    ).toEqual(["startTime", "durationMs", "errorCount", "frustration"]);
    expect(DEFAULT_SESSION_REPLAY_SORT_BY).toBe("startTime");
  });
});

describe("filter URL round trip", () => {
  test("state survives a write-then-read through the query string", () => {
    const url: string = buildFilteredUrl(
      "https://dash.example.com/rum/app-1/session-replay?keep=me",
      "errors",
      {
        ...EMPTY_ADVANCED_FILTERS,
        browserName: "Firefox",
        route: "/checkout",
        minDurationSeconds: "30",
        urlPrefix: "/cart",
        tags: "build=1.4.2, plan=pro",
        search: "jane",
      },
      { sortBy: "errorCount", timeRange: { range: TimeRange.PAST_ONE_WEEK } },
    );

    /* Unrelated params are preserved, not clobbered. */
    expect(url).toContain("keep=me");

    const restored: SessionReplayListUrlState = readListStateFromSearch(
      new URL(url).search,
    );

    expect(restored.signal).toBe("errors");
    expect(restored.advanced.browserName).toBe("Firefox");
    expect(restored.advanced.route).toBe("/checkout");
    expect(restored.advanced.minDurationSeconds).toBe("30");
    expect(restored.advanced.urlPrefix).toBe("/cart");
    expect(restored.advanced.tags).toBe("build=1.4.2, plan=pro");
    expect(restored.advanced.search).toBe("jane");
    expect(restored.advanced.osName).toBe("");
    expect(restored.sortBy).toBe("errorCount");
    expect(restored.timeRange).toEqual({ range: TimeRange.PAST_ONE_WEEK });
    expect(restored.page).toBe(1);
  });

  test("identifiedUserRef is never written to the URL", () => {
    expect(FILTER_URL_KEYS.identifiedUserRef).toBeUndefined();

    const url: string = buildFilteredUrl(
      "https://dash.example.com/replay",
      "all",
      { ...EMPTY_ADVANCED_FILTERS, identifiedUserRef: "jane@example.com" },
    );

    expect(url).not.toContain("jane");
    expect(
      readFiltersFromSearch(new URL(url).search).advanced.identifiedUserRef,
    ).toBe("");
  });

  test("defaults are written as absence so a pristine list has a clean URL", () => {
    expect(
      buildFilteredUrl(
        "https://dash.example.com/replay",
        "all",
        EMPTY_ADVANCED_FILTERS,
        {
          sortBy: DEFAULT_SESSION_REPLAY_SORT_BY,
          timeRange: DEFAULT_SESSION_REPLAY_TIME_RANGE,
          page: 1,
        },
      ),
    ).toBe("https://dash.example.com/replay");
  });

  test("clearing filters removes their params instead of writing empties", () => {
    const withFilters: string = buildFilteredUrl(
      "https://dash.example.com/replay",
      "frustration",
      { ...EMPTY_ADVANCED_FILTERS, browserName: "Chrome", tags: "a=b" },
      { sortBy: "durationMs", page: 3 },
    );

    const cleared: string = buildFilteredUrl(
      withFilters,
      "all",
      EMPTY_ADVANCED_FILTERS,
      { sortBy: "startTime", page: 1 },
    );

    expect(cleared).toBe("https://dash.example.com/replay");
  });

  test("an unknown signal or sort in the URL degrades to the default", () => {
    expect(readFiltersFromSearch("?signal=exfiltrate").signal).toBe("all");
    expect(readListStateFromSearch("?sort=payloadBytes").sortBy).toBe(
      "startTime",
    );
    expect(readListStateFromSearch("?page=zero").page).toBe(1);
    expect(readListStateFromSearch("?page=-2").page).toBe(1);
    expect(readListStateFromSearch("?page=3").page).toBe(3);
  });

  test("a custom range is written as absolute startTime/endTime and read back", () => {
    const start: Date = new Date("2026-09-01T00:00:00.000Z");
    const end: Date = new Date("2026-09-02T00:00:00.000Z");
    const url: string = buildFilteredUrl(
      "https://dash.example.com/replay",
      "all",
      EMPTY_ADVANCED_FILTERS,
      {
        timeRange: {
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(start, end),
        },
      },
    );

    expect(url).toContain("startTime=2026-09-01");
    expect(url).toContain("endTime=2026-09-02");

    const restored: SessionReplayListUrlState = readListStateFromSearch(
      new URL(url).search,
    );

    expect(restored.timeRange.range).toBe(TimeRange.CUSTOM);
    expect(restored.timeRange.startAndEndDate?.startValue.toISOString()).toBe(
      start.toISOString(),
    );
    expect(restored.timeRange.startAndEndDate?.endValue.toISOString()).toBe(
      end.toISOString(),
    );
  });

  test("an incident link with startTime/endTime wins over a named range", () => {
    const range: ReturnType<typeof readTimeRangeFromSearch> =
      readTimeRangeFromSearch(
        "?range=Past%201%20Week&startTime=2026-09-01T00:00:00.000Z&endTime=2026-09-01T01:00:00.000Z",
      );

    expect(range.range).toBe(TimeRange.CUSTOM);
  });

  /*
   * correlation-11: the RUM overview's tiles link to this list with
   * range/start/end (buildRangedListRoute in Pages/Rum/View/Overview.tsx),
   * while the list writes startTime/endTime. Reading only the canonical
   * pair dropped the tile's custom window on arrival.
   */
  test("the overview tile's start/end window is honoured, and never left behind", () => {
    const fromTile: ReturnType<typeof readTimeRangeFromSearch> =
      readTimeRangeFromSearch(
        "?range=Custom&start=2026-09-01T00%3A00%3A00.000Z&end=2026-09-01T01%3A00%3A00.000Z",
      );

    expect(fromTile.range).toBe(TimeRange.CUSTOM);
    expect(fromTile.startAndEndDate?.startValue.toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
    expect(fromTile.startAndEndDate?.endValue.toISOString()).toBe(
      "2026-09-01T01:00:00.000Z",
    );

    /*
     * Switching back to a named range has to clear the alias too, or the
     * stale window would win the next time this URL is read.
     */
    const rewritten: string = buildFilteredUrl(
      "https://dash.example.com/replay?start=2026-09-01T00:00:00.000Z&end=2026-09-01T01:00:00.000Z",
      "all",
      EMPTY_ADVANCED_FILTERS,
      { timeRange: { range: TimeRange.PAST_ONE_WEEK } },
    );

    expect(rewritten).not.toContain("start=");
    expect(rewritten).not.toContain("end=");
    expect(readTimeRangeFromSearch(new URL(rewritten).search)).toEqual({
      range: TimeRange.PAST_ONE_WEEK,
    });
  });

  test("an inverted or unparseable custom range falls back to the default", () => {
    expect(
      readTimeRangeFromSearch(
        "?startTime=2026-09-02T00:00:00.000Z&endTime=2026-09-01T00:00:00.000Z",
      ),
    ).toEqual(DEFAULT_SESSION_REPLAY_TIME_RANGE);
    expect(readTimeRangeFromSearch("?startTime=yesterday&endTime=now")).toEqual(
      DEFAULT_SESSION_REPLAY_TIME_RANGE,
    );
    expect(readTimeRangeFromSearch("?range=Custom")).toEqual(
      DEFAULT_SESSION_REPLAY_TIME_RANGE,
    );
  });
});

describe("cursor memory", () => {
  const cursor: SessionReplaySortedListCursorDto = {
    sortBy: "errorCount",
    sortValue: 4,
    sessionId: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
  };

  const key: string = buildCursorMemoryKey({
    rumApplicationId: "app-1",
    signal: "errors",
    advanced: EMPTY_ADVANCED_FILTERS,
    sortBy: "errorCount",
    timeRange: DEFAULT_SESSION_REPLAY_TIME_RANGE,
    itemsOnPage: 20,
  });

  test("round-trips both cursor shapes under the same key", () => {
    const serialized: string = serializeCursorMemory({
      key: key,
      cursors: [
        [1, cursor],
        [2, { startTimeUnixMs: 1_757_000_000_000, sessionId: "s2" }],
      ],
    });

    const restored: Map<number, SessionReplaySortedListCursorDto> =
      parseCursorMemory(serialized, key);

    expect(restored.get(1)).toEqual(cursor);
    /* The legacy shape is normalised so the caller has one branch. */
    expect(restored.get(2)).toEqual({
      sortBy: "startTime",
      sortValue: 1_757_000_000_000,
      sessionId: "s2",
    });
  });

  test("a memory for another query, or garbage, yields no cursors", () => {
    const serialized: string = serializeCursorMemory({
      key: key,
      cursors: [[1, cursor]],
    });
    const otherKey: string = buildCursorMemoryKey({
      rumApplicationId: "app-1",
      signal: "errors",
      advanced: EMPTY_ADVANCED_FILTERS,
      sortBy: "durationMs",
      timeRange: DEFAULT_SESSION_REPLAY_TIME_RANGE,
      itemsOnPage: 20,
    });

    expect(parseCursorMemory(serialized, otherKey).size).toBe(0);
    expect(parseCursorMemory("{not json", key).size).toBe(0);
    expect(parseCursorMemory(null, key).size).toBe(0);
    expect(
      parseCursorMemory(
        JSON.stringify({ key: key, cursors: [[1, { sessionId: "" }]] }),
        key,
      ).size,
    ).toBe(0);
  });

  test("the key changes with anything that changes the ordering or the set", () => {
    const variants: Array<string> = [
      buildCursorMemoryKey({
        rumApplicationId: "app-1",
        signal: "all",
        advanced: EMPTY_ADVANCED_FILTERS,
        sortBy: "errorCount",
        timeRange: DEFAULT_SESSION_REPLAY_TIME_RANGE,
        itemsOnPage: 20,
      }),
      buildCursorMemoryKey({
        rumApplicationId: "app-1",
        signal: "errors",
        advanced: { ...EMPTY_ADVANCED_FILTERS, search: "x" },
        sortBy: "errorCount",
        timeRange: DEFAULT_SESSION_REPLAY_TIME_RANGE,
        itemsOnPage: 20,
      }),
      buildCursorMemoryKey({
        rumApplicationId: "app-1",
        signal: "errors",
        advanced: EMPTY_ADVANCED_FILTERS,
        sortBy: "errorCount",
        timeRange: { range: TimeRange.PAST_ONE_WEEK },
        itemsOnPage: 20,
      }),
      buildCursorMemoryKey({
        rumApplicationId: "app-1",
        signal: "errors",
        advanced: EMPTY_ADVANCED_FILTERS,
        sortBy: "errorCount",
        timeRange: DEFAULT_SESSION_REPLAY_TIME_RANGE,
        itemsOnPage: 50,
      }),
    ];

    for (const variant of variants) {
      expect(variant).not.toBe(key);
    }
  });
});
