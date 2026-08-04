import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import {
  buildFilteredUrl,
  buildSessionReplayListFilters,
  EMPTY_ADVANCED_FILTERS,
  hasAnyAdvancedFilter,
  readFiltersFromSearch,
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

  test("field filters land under the exact names the endpoint parses", () => {
    const filters: JSONObject = buildSessionReplayListFilters("all", {
      ...EMPTY_ADVANCED_FILTERS,
      browserName: " Chrome ",
      osName: "macOS",
      deviceType: "desktop",
      countryCode: "de",
      identifiedUserKey: "abc123",
      route: "/checkout",
      minDurationSeconds: "90",
      triggerReason: "error",
    });

    expect(filters).toEqual({
      browserNames: ["Chrome"],
      osNames: ["macOS"],
      deviceTypes: ["desktop"],
      /* The stored column is upper-case ISO codes. */
      countryCodes: ["DE"],
      identifiedUserKey: "abc123",
      route: "/checkout",
      /* The input is seconds; the endpoint takes milliseconds. */
      minDurationMs: 90000,
      triggerReasons: ["error"],
    });
  });

  test("empty and unparseable fields are dropped, not sent as empties", () => {
    expect(
      buildSessionReplayListFilters("all", {
        ...EMPTY_ADVANCED_FILTERS,
        minDurationSeconds: "not-a-number",
        browserName: "   ",
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
      },
    );

    /* Unrelated params are preserved, not clobbered. */
    expect(url).toContain("keep=me");

    const restored: ReturnType<typeof readFiltersFromSearch> =
      readFiltersFromSearch(new URL(url).search);

    expect(restored.signal).toBe("errors");
    expect(restored.advanced.browserName).toBe("Firefox");
    expect(restored.advanced.route).toBe("/checkout");
    expect(restored.advanced.minDurationSeconds).toBe("30");
    expect(restored.advanced.osName).toBe("");
  });

  test("clearing filters removes their params instead of writing empties", () => {
    const withFilters: string = buildFilteredUrl(
      "https://dash.example.com/replay",
      "frustration",
      { ...EMPTY_ADVANCED_FILTERS, browserName: "Chrome" },
    );

    const cleared: string = buildFilteredUrl(
      withFilters,
      "all",
      EMPTY_ADVANCED_FILTERS,
    );

    expect(cleared).toBe("https://dash.example.com/replay");
  });

  test("an unknown signal in the URL degrades to 'all'", () => {
    expect(readFiltersFromSearch("?signal=exfiltrate").signal).toBe("all");
  });
});
