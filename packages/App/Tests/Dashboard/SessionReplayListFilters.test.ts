import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import TimeRange from "Common/Types/Time/TimeRange";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { SessionReplaySortedListCursorDto } from "Common/Types/Rum/SessionReplayApi";
import {
  buildCursorMemoryKey,
  buildFilteredUrl,
  buildHandedOffUserFilterLabel,
  buildSessionReplayListFilters,
  buildTimeRangeSearch,
  buildUserFilterLabelStorageKey,
  buildUserSessionsListSearch,
  buildUsersPageUrl,
  DEFAULT_SESSION_REPLAY_SORT_BY,
  DEFAULT_SESSION_REPLAY_TIME_RANGE,
  EMPTY_ADVANCED_FILTERS,
  FILTER_URL_KEYS,
  handedOffUserKeyToWrite,
  hasAnyAdvancedFilter,
  LIST_URL_KEYS,
  normalizeUrlPrefix,
  parseCursorMemory,
  parseTagFilter,
  readFiltersFromSearch,
  readListStateFromSearch,
  readTimeRangeFromSearch,
  resolveHandedOffUserFilter,
  serializeCursorMemory,
  SESSION_REPLAY_SIGNAL_OPTIONS,
  SESSION_REPLAY_SIGNALS,
  SESSION_REPLAY_SORT_OPTIONS,
  SessionReplayListUrlState,
  SessionReplayUserSessionsHandoff,
  stringifyTagFilter,
  USER_FILTER_LABEL_STORAGE_KEY_PREFIX,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayListFilters";

/*
 * The list filter model: the one place that translates the table's filter
 * UI into the /telemetry/rum/session-replay/list endpoint's field names,
 * and into the URL query string that makes a filtered list shareable.
 * Misspell one endpoint key here and the filter silently matches nothing —
 * the endpoint ignores unknown fields — so the exact shapes are pinned.
 */

const VISITOR: string = "7f3a2b1c9d8e4f5a6b7c8d9e0f1a2b3c";
const USER_KEY: string =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

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
    /* The click-set identity filters count like any other. */
    expect(
      hasAnyAdvancedFilter({ ...EMPTY_ADVANCED_FILTERS, visitorId: VISITOR }),
    ).toBe(true);
    expect(
      hasAnyAdvancedFilter({
        ...EMPTY_ADVANCED_FILTERS,
        identifiedUserKey: USER_KEY,
      }),
    ).toBe(true);
  });

  /*
   * Issue #3705: "every session from this person" for a role that cannot
   * read the label goes by the digest the list already returns, and
   * "every session from this browser" by the recorder's visitor id.
   */
  test("the visitor id and the identity digest land under the endpoint's names", () => {
    expect(
      buildSessionReplayListFilters("all", {
        ...EMPTY_ADVANCED_FILTERS,
        visitorId: ` ${VISITOR} `,
      }),
    ).toEqual({ visitorId: VISITOR });

    expect(
      buildSessionReplayListFilters("all", {
        ...EMPTY_ADVANCED_FILTERS,
        identifiedUserKey: USER_KEY,
      }),
    ).toEqual({ identifiedUserKey: USER_KEY });
  });

  test("the digest is sent ONLY without a reference - the server ignores it beside one", () => {
    expect(
      buildSessionReplayListFilters("all", {
        ...EMPTY_ADVANCED_FILTERS,
        identifiedUserRef: "jane@example.com",
        identifiedUserKey: USER_KEY,
      }),
    ).toEqual({ identifiedUserRef: "jane@example.com" });

    /* A visitor id is a different predicate and rides along with either. */
    expect(
      buildSessionReplayListFilters("all", {
        ...EMPTY_ADVANCED_FILTERS,
        identifiedUserRef: "jane@example.com",
        visitorId: VISITOR,
      }),
    ).toEqual({ identifiedUserRef: "jane@example.com", visitorId: VISITOR });
  });

  test("EMPTY_ADVANCED_FILTERS carries every field as an empty string", () => {
    expect(EMPTY_ADVANCED_FILTERS).toEqual({
      browserName: "",
      osName: "",
      deviceType: "",
      countryCode: "",
      identifiedUserRef: "",
      identifiedUserKey: "",
      visitorId: "",
      route: "",
      minDurationSeconds: "",
      triggerReason: "",
      urlPrefix: "",
      tags: "",
      search: "",
    });
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
      {
        ...EMPTY_ADVANCED_FILTERS,
        identifiedUserRef: "jane@example.com",
        /* Still true with the pseudonymous filters beside it. */
        identifiedUserKey: USER_KEY,
        visitorId: VISITOR,
      },
    );

    expect(url).not.toContain("jane");
    expect(
      readFiltersFromSearch(new URL(url).search).advanced.identifiedUserRef,
    ).toBe("");
  });

  /*
   * The two pseudonymous identity filters ARE shareable: a digest cannot
   * be reversed and a visitor id was minted by the recorder, so a support
   * engineer can paste "this person's sessions" into a ticket.
   */
  test("the visitor id and identity digest round-trip as visitor= and userKey=", () => {
    expect(FILTER_URL_KEYS.visitorId).toBe("visitor");
    expect(FILTER_URL_KEYS.identifiedUserKey).toBe("userKey");

    const url: string = buildFilteredUrl(
      "https://dash.example.com/replay",
      "all",
      {
        ...EMPTY_ADVANCED_FILTERS,
        visitorId: VISITOR,
        identifiedUserKey: USER_KEY,
      },
    );

    expect(url).toContain(`visitor=${VISITOR}`);
    expect(url).toContain(`userKey=${USER_KEY}`);

    const restored: SessionReplayListUrlState = readListStateFromSearch(
      new URL(url).search,
    );

    expect(restored.advanced.visitorId).toBe(VISITOR);
    expect(restored.advanced.identifiedUserKey).toBe(USER_KEY);
  });

  test("the list URL knows no view any more; a stray ?view= is left alone and ignored", () => {
    /*
     * Users is its own page now. The list neither reads nor writes view=;
     * Pages/Rum/View/SessionReplay.tsx redirects view=users before the list
     * mounts, and anything else is just an unrelated param it preserves.
     */
    expect(LIST_URL_KEYS).not.toHaveProperty("view");
    expect(readListStateFromSearch("?view=users")).not.toHaveProperty("view");

    const url: string = buildFilteredUrl(
      "https://dash.example.com/replay?view=users",
      "all",
      EMPTY_ADVANCED_FILTERS,
    );

    expect(url).toBe("https://dash.example.com/replay?view=users");
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

describe("the Users page URL", () => {
  test("buildUsersPageUrl writes the window with the list's keys, defaults as absence", () => {
    expect(
      buildUsersPageUrl(
        "https://dash.example.com/rum/app-1/session-replay-users?range=Past%201%20Week",
        DEFAULT_SESSION_REPLAY_TIME_RANGE,
      ),
    ).toBe("https://dash.example.com/rum/app-1/session-replay-users");

    const named: string = buildUsersPageUrl(
      "https://dash.example.com/rum/app-1/session-replay-users",
      { range: TimeRange.PAST_ONE_WEEK },
    );

    expect(new URL(named).searchParams.get(LIST_URL_KEYS.range)).toBe(
      TimeRange.PAST_ONE_WEEK,
    );
    /* And the list reads the same window back from it. */
    expect(readTimeRangeFromSearch(new URL(named).search)).toEqual({
      range: TimeRange.PAST_ONE_WEEK,
    });

    const start: Date = new Date("2026-09-01T00:00:00.000Z");
    const end: Date = new Date("2026-09-02T00:00:00.000Z");
    const custom: string = buildUsersPageUrl(
      "https://dash.example.com/rum/app-1/session-replay-users?range=Past%201%20Week&start=x&end=y",
      {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(start, end),
      },
    );
    const params: URLSearchParams = new URL(custom).searchParams;

    expect(params.get(LIST_URL_KEYS.startTime)).toBe(start.toISOString());
    expect(params.get(LIST_URL_KEYS.endTime)).toBe(end.toISOString());
    /* A named range and the tile aliases never linger beside an absolute pair. */
    expect(params.has(LIST_URL_KEYS.range)).toBe(false);
    expect(params.has("start")).toBe(false);
    expect(params.has("end")).toBe(false);
  });

  test("buildUsersPageUrl keeps params that are not its own", () => {
    expect(
      buildUsersPageUrl("https://dash.example.com/users?keep=me", {
        range: TimeRange.PAST_ONE_WEEK,
      }),
    ).toContain("keep=me");
  });

  test("buildTimeRangeSearch is empty for the default window and a query string otherwise", () => {
    expect(buildTimeRangeSearch(DEFAULT_SESSION_REPLAY_TIME_RANGE)).toBe("");
    expect(buildTimeRangeSearch({ range: TimeRange.PAST_ONE_WEEK })).toBe(
      "?range=Past+1+Week",
    );
    expect(
      readTimeRangeFromSearch(
        buildTimeRangeSearch({ range: TimeRange.PAST_ONE_WEEK }),
      ),
    ).toEqual({ range: TimeRange.PAST_ONE_WEEK });
  });
});

describe("the Users page's hand-off to the list", () => {
  const visitorHandoff: SessionReplayUserSessionsHandoff = {
    filter: { visitorId: VISITOR },
    identifiedUserKey: "",
    identifiedUserLabel: "",
  };
  const identifiedHandoff: SessionReplayUserSessionsHandoff = {
    filter: { identifiedUserRef: "jane@example.com" },
    identifiedUserKey: USER_KEY,
    identifiedUserLabel: "jane@example.com",
  };
  const hiddenHandoff: SessionReplayUserSessionsHandoff = {
    filter: { identifiedUserKey: USER_KEY },
    identifiedUserKey: USER_KEY,
    identifiedUserLabel: "",
  };

  test("a visitor goes as visitor=", () => {
    const search: string = buildUserSessionsListSearch(
      visitorHandoff,
      DEFAULT_SESSION_REPLAY_TIME_RANGE,
    );

    expect(search).toBe(`?visitor=${VISITOR}`);
    expect(readListStateFromSearch(search).advanced.visitorId).toBe(VISITOR);
  });

  test("an identified user goes as userKey=, never as the reference", () => {
    const search: string = buildUserSessionsListSearch(
      identifiedHandoff,
      DEFAULT_SESSION_REPLAY_TIME_RANGE,
    );

    expect(search).toBe(`?userKey=${USER_KEY}`);
    expect(search).not.toContain("jane");
    expect(search).not.toContain("example.com");

    const restored: SessionReplayListUrlState = readListStateFromSearch(search);

    expect(restored.advanced.identifiedUserKey).toBe(USER_KEY);
    expect(restored.advanced.identifiedUserRef).toBe("");
  });

  test("a hidden label's digest goes as userKey= too", () => {
    expect(
      buildUserSessionsListSearch(
        hiddenHandoff,
        DEFAULT_SESSION_REPLAY_TIME_RANGE,
      ),
    ).toBe(`?userKey=${USER_KEY}`);
  });

  test("the reference without a digest, or the anonymous bucket, hands nothing to filter by", () => {
    expect(
      buildUserSessionsListSearch(
        {
          filter: { identifiedUserRef: "jane@example.com" },
          identifiedUserKey: "",
          identifiedUserLabel: "jane@example.com",
        },
        DEFAULT_SESSION_REPLAY_TIME_RANGE,
      ),
    ).toBe("");
    expect(
      buildUserSessionsListSearch(
        { filter: {}, identifiedUserKey: "", identifiedUserLabel: "" },
        DEFAULT_SESSION_REPLAY_TIME_RANGE,
      ),
    ).toBe("");
  });

  test("the time range rides along; the default window is absent", () => {
    const named: string = buildUserSessionsListSearch(visitorHandoff, {
      range: TimeRange.PAST_ONE_WEEK,
    });

    expect(named).toBe(`?visitor=${VISITOR}&range=Past+1+Week`);
    expect(readListStateFromSearch(named).timeRange).toEqual({
      range: TimeRange.PAST_ONE_WEEK,
    });

    const start: Date = new Date("2026-09-01T00:00:00.000Z");
    const end: Date = new Date("2026-09-02T00:00:00.000Z");
    const custom: string = buildUserSessionsListSearch(identifiedHandoff, {
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(start, end),
    });
    const restored: SessionReplayListUrlState = readListStateFromSearch(custom);

    expect(restored.timeRange.range).toBe(TimeRange.CUSTOM);
    expect(restored.timeRange.startAndEndDate?.startValue.toISOString()).toBe(
      start.toISOString(),
    );
    expect(restored.timeRange.startAndEndDate?.endValue.toISOString()).toBe(
      end.toISOString(),
    );
    expect(custom).not.toContain("range=");
  });

  test("only an identified user with a visible label needs a stashed label", () => {
    expect(buildHandedOffUserFilterLabel(identifiedHandoff)).toEqual({
      identifiedUserKey: USER_KEY,
      identifiedUserLabel: "jane@example.com",
    });
    expect(buildHandedOffUserFilterLabel(visitorHandoff)).toBeNull();
    expect(buildHandedOffUserFilterLabel(hiddenHandoff)).toBeNull();
    /* A reference with no digest to key it under has nowhere to be found from. */
    expect(
      buildHandedOffUserFilterLabel({
        ...identifiedHandoff,
        identifiedUserKey: "",
      }),
    ).toBeNull();
  });

  test("the storage key is per application", () => {
    expect(buildUserFilterLabelStorageKey("app-1")).toBe(
      `${USER_FILTER_LABEL_STORAGE_KEY_PREFIX}app-1`,
    );
    expect(buildUserFilterLabelStorageKey("app-1")).not.toBe(
      buildUserFilterLabelStorageKey("app-2"),
    );
  });

  describe("the digest written on a handed-off reference's behalf", () => {
    const handedOff: {
      identifiedUserKey: string;
      identifiedUserLabel: string;
    } = {
      identifiedUserKey: USER_KEY,
      identifiedUserLabel: "jane@example.com",
    };

    test("while the reference filter is that person, userKey= is written and nothing about the reference is", () => {
      const advanced: typeof EMPTY_ADVANCED_FILTERS = {
        ...EMPTY_ADVANCED_FILTERS,
        identifiedUserRef: " jane@example.com ",
        browserName: "Chrome",
      };

      expect(handedOffUserKeyToWrite(advanced, handedOff)).toBe(USER_KEY);

      const url: URL = new URL(
        buildFilteredUrl(
          "https://dash.example.com/rum/app-1/session-replay",
          "all",
          advanced,
          {
            timeRange: { range: TimeRange.PAST_ONE_WEEK },
            handedOffUser: handedOff,
          },
        ),
      );

      expect(
        url.searchParams.get(FILTER_URL_KEYS.identifiedUserKey as string),
      ).toBe(USER_KEY);
      expect(url.search).not.toContain("jane");
      expect(url.searchParams.get("browser")).toBe("Chrome");
      /* And reading that URL back is the pasted-link case: the digest filter. */
      expect(readListStateFromSearch(url.search).advanced).toEqual({
        ...EMPTY_ADVANCED_FILTERS,
        identifiedUserKey: USER_KEY,
        browserName: "Chrome",
      });
    });

    test("nothing is written once the reference has been cleared or is somebody else", () => {
      expect(handedOffUserKeyToWrite(EMPTY_ADVANCED_FILTERS, handedOff)).toBe(
        "",
      );
      expect(
        handedOffUserKeyToWrite(
          { ...EMPTY_ADVANCED_FILTERS, identifiedUserRef: "bob@example.com" },
          handedOff,
        ),
      ).toBe("");
      expect(
        handedOffUserKeyToWrite(
          { ...EMPTY_ADVANCED_FILTERS, identifiedUserRef: "jane@example.com" },
          null,
        ),
      ).toBe("");
      expect(
        handedOffUserKeyToWrite(
          { ...EMPTY_ADVANCED_FILTERS, identifiedUserRef: "jane@example.com" },
          { identifiedUserKey: "  ", identifiedUserLabel: "jane@example.com" },
        ),
      ).toBe("");

      const url: URL = new URL(
        buildFilteredUrl(
          `https://dash.example.com/rum/app-1/session-replay?userKey=${USER_KEY}`,
          "all",
          { ...EMPTY_ADVANCED_FILTERS, identifiedUserRef: "bob@example.com" },
          { handedOffUser: handedOff },
        ),
      );

      expect(
        url.searchParams.has(FILTER_URL_KEYS.identifiedUserKey as string),
      ).toBe(false);
    });

    test("a digest filter of its own wins over the handed-off one", () => {
      const advanced: typeof EMPTY_ADVANCED_FILTERS = {
        ...EMPTY_ADVANCED_FILTERS,
        identifiedUserRef: "jane@example.com",
        identifiedUserKey: "another-digest",
      };

      expect(handedOffUserKeyToWrite(advanced, handedOff)).toBe("");

      const url: URL = new URL(
        buildFilteredUrl(
          "https://dash.example.com/rum/app-1/session-replay",
          "all",
          advanced,
          { handedOffUser: handedOff },
        ),
      );

      expect(
        url.searchParams.get(FILTER_URL_KEYS.identifiedUserKey as string),
      ).toBe("another-digest");
    });
  });

  describe("resolveHandedOffUserFilter", () => {
    const fromUrl: SessionReplayListUrlState = readListStateFromSearch(
      `?userKey=${USER_KEY}&browser=Chrome&range=Past%201%20Week`,
    );
    const stored: string = JSON.stringify({
      identifiedUserKey: USER_KEY,
      identifiedUserLabel: "jane@example.com",
    });

    test("a matching entry swaps the digest for the reference and keeps everything else", () => {
      const resolved: SessionReplayListUrlState = resolveHandedOffUserFilter(
        fromUrl,
        stored,
      );

      expect(resolved).not.toBe(fromUrl);
      expect(resolved.advanced.identifiedUserRef).toBe("jane@example.com");
      expect(resolved.advanced.identifiedUserKey).toBe("");
      expect(resolved.advanced.browserName).toBe("Chrome");
      expect(resolved.timeRange).toEqual({ range: TimeRange.PAST_ONE_WEEK });
      /* The input is not mutated: the caller compares identity to know it was consumed. */
      expect(fromUrl.advanced.identifiedUserKey).toBe(USER_KEY);

      /* And the request that follows sends the reference, not the digest. */
      expect(
        buildSessionReplayListFilters(resolved.signal, resolved.advanced),
      ).toEqual({
        identifiedUserRef: "jane@example.com",
        browserNames: ["Chrome"],
      });
    });

    test("an entry for another digest leaves the state as read", () => {
      const other: string = JSON.stringify({
        identifiedUserKey: "somebody-else",
        identifiedUserLabel: "bob@example.com",
      });

      expect(resolveHandedOffUserFilter(fromUrl, other)).toBe(fromUrl);
    });

    test("no entry, garbage, or an entry without a label leaves the state as read", () => {
      expect(resolveHandedOffUserFilter(fromUrl, null)).toBe(fromUrl);
      expect(resolveHandedOffUserFilter(fromUrl, "")).toBe(fromUrl);
      expect(resolveHandedOffUserFilter(fromUrl, "{not json")).toBe(fromUrl);
      expect(resolveHandedOffUserFilter(fromUrl, '"a string"')).toBe(fromUrl);
      expect(resolveHandedOffUserFilter(fromUrl, "null")).toBe(fromUrl);
      expect(
        resolveHandedOffUserFilter(
          fromUrl,
          JSON.stringify({ identifiedUserKey: USER_KEY }),
        ),
      ).toBe(fromUrl);
      expect(
        resolveHandedOffUserFilter(
          fromUrl,
          JSON.stringify({
            identifiedUserKey: USER_KEY,
            identifiedUserLabel: "   ",
          }),
        ),
      ).toBe(fromUrl);
      expect(
        resolveHandedOffUserFilter(
          fromUrl,
          JSON.stringify({
            identifiedUserKey: USER_KEY,
            identifiedUserLabel: 7,
          }),
        ),
      ).toBe(fromUrl);
    });

    test("a URL without userKey never consults the entry", () => {
      const noKey: SessionReplayListUrlState = readListStateFromSearch(
        `?visitor=${VISITOR}`,
      );

      expect(resolveHandedOffUserFilter(noKey, stored)).toBe(noKey);
    });
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

/*
 * A pasted ?visitor= is untrusted input like the search box: anything that
 * is not a visitor id must degrade to the unfiltered list rather than reach
 * the server as a 400 the list can only render as a generic failure.
 */
describe("visitor URL parameter validation", () => {
  test("a malformed visitor= degrades to no filter", () => {
    expect(readListStateFromSearch("?visitor=nope").advanced.visitorId).toBe(
      "",
    );
    expect(
      readListStateFromSearch("?visitor=0123456789abcdef").advanced.visitorId,
    ).toBe("");
  });

  test("a well-formed visitor= is kept, lower-cased", () => {
    const id: string = "0123456789abcdef".repeat(2);

    expect(readListStateFromSearch(`?visitor=${id}`).advanced.visitorId).toBe(
      id,
    );
    expect(
      readListStateFromSearch(`?visitor=${id.toUpperCase()}`).advanced
        .visitorId,
    ).toBe(id);
  });
});
