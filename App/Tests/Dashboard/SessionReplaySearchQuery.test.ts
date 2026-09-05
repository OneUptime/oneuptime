import { describe, expect, test } from "@jest/globals";
import {
  EMPTY_ADVANCED_FILTERS,
  SessionReplayAdvancedFilters,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayListFilters";
import {
  formatDurationToken,
  isLikelySessionId,
  mergeSearchIntoFilters,
  parseDurationToken,
  parseSessionReplaySearch,
  SESSION_REPLAY_SEARCH_TOKEN_KEYS,
  SessionReplaySearchParseResult,
  stringifySessionReplaySearch,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplaySearchQuery";

/*
 * The search box grammar. Every token maps to the right filter, bare text
 * is routed by shape, id: is an intent the parser reports but never acts
 * on, error: is dropped with an explanation, and stringify round-trips so
 * the modal and the box stay in step.
 */

const SESSION_ID: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

describe("parseSessionReplaySearch tokens", () => {
  test("every token maps to its filter", () => {
    const result: SessionReplaySearchParseResult = parseSessionReplaySearch(
      "user:jane@acme.com url:/checkout tag:build=1.4.2 tag:plan=pro browser:Chrome os:macOS device:mobile country:de trigger:error min:2m",
    );

    expect(result.advanced).toEqual({
      ...EMPTY_ADVANCED_FILTERS,
      identifiedUserRef: "jane@acme.com",
      urlPrefix: "/checkout",
      tags: "build=1.4.2, plan=pro",
      browserName: "Chrome",
      osName: "macOS",
      deviceType: "mobile",
      countryCode: "DE",
      triggerReason: "error",
      minDurationSeconds: "120",
    });
    expect(result.warnings).toEqual([]);
    expect(result.navigateToSessionId).toBeNull();
  });

  test("page: is an alias of url:, and quoted values keep their spaces", () => {
    const result: SessionReplaySearchParseResult = parseSessionReplaySearch(
      'page:"https://app.acme.com/my page" browser:"Mobile Safari"',
    );

    expect(result.advanced.urlPrefix).toBe("https://app.acme.com/my page");
    expect(result.advanced.browserName).toBe("Mobile Safari");
  });

  test("trigger: accepts the human spellings and refuses the rest", () => {
    expect(
      parseSessionReplaySearch("trigger:slow").advanced.triggerReason,
    ).toBe("performance");
    expect(
      parseSessionReplaySearch("trigger:always").advanced.triggerReason,
    ).toBe("sampled");

    const bad: SessionReplaySearchParseResult =
      parseSessionReplaySearch("trigger:cosmic-ray");

    expect(bad.advanced.triggerReason).toBe("");
    expect(bad.warnings[0]).toContain("trigger:");
  });

  test("device: is validated against the three stored values", () => {
    expect(parseSessionReplaySearch("device:Tablet").advanced.deviceType).toBe(
      "tablet",
    );

    const bad: SessionReplaySearchParseResult =
      parseSessionReplaySearch("device:fridge");

    expect(bad.advanced.deviceType).toBe("");
    expect(bad.warnings[0]).toContain("desktop, mobile, tablet");
  });

  test("min: takes durations and refuses nonsense", () => {
    expect(
      parseSessionReplaySearch("min:90s").advanced.minDurationSeconds,
    ).toBe("90");
    expect(
      parseSessionReplaySearch("min:1h30m").advanced.minDurationSeconds,
    ).toBe("5400");
    expect(
      parseSessionReplaySearch("min:1:30").advanced.minDurationSeconds,
    ).toBe("90");
    expect(parseSessionReplaySearch("min:soon").warnings[0]).toContain("min:");
  });

  test("a token without a value warns instead of applying an empty filter", () => {
    const result: SessionReplaySearchParseResult =
      parseSessionReplaySearch("user:");

    expect(result.advanced.identifiedUserRef).toBe("");
    expect(result.warnings).toEqual(["user: needs a value."]);
  });

  test("a repeated single-valued token keeps the last and says so", () => {
    const result: SessionReplaySearchParseResult = parseSessionReplaySearch(
      "browser:Chrome browser:Firefox",
    );

    expect(result.advanced.browserName).toBe("Firefox");
    expect(result.warnings[0]).toContain("Only one browser filter");
  });
});

describe("parseSessionReplaySearch bare text", () => {
  test("a leading slash or http is a URL prefix", () => {
    expect(parseSessionReplaySearch("/checkout").advanced.urlPrefix).toBe(
      "/checkout",
    );
    expect(
      parseSessionReplaySearch("https://app.acme.com/cart").advanced.urlPrefix,
    ).toBe("https://app.acme.com/cart");
    /* Not mistaken for an unknown "https:" token. */
    expect(
      parseSessionReplaySearch("https://app.acme.com/cart").warnings,
    ).toEqual([]);
  });

  /*
   * ux-03 / integration-001: the endpoint compares urlPrefix from the
   * START of each stored address (and of its path), so a value that
   * anchors nowhere returns nothing at all - the box must never send one
   * silently.
   */
  test("a URL filter is anchored before it is sent, and says what it applied", () => {
    const bareWord: SessionReplaySearchParseResult =
      parseSessionReplaySearch("url:checkout");

    expect(bareWord.advanced.urlPrefix).toBe("/checkout");
    expect(bareWord.warnings).toHaveLength(1);
    expect(bareWord.warnings[0]).toContain('"checkout" was applied as');
    expect(bareWord.warnings[0]).toContain('"/checkout"');

    const host: SessionReplaySearchParseResult = parseSessionReplaySearch(
      "page:shop.example.com/cart",
    );

    expect(host.advanced.urlPrefix).toBe("https://shop.example.com/cart");
    expect(host.warnings[0]).toContain("https://shop.example.com/cart");
  });

  test("an already anchored URL is left alone and warns about nothing", () => {
    const path: SessionReplaySearchParseResult =
      parseSessionReplaySearch("url:/checkout");

    expect(path.advanced.urlPrefix).toBe("/checkout");
    expect(path.warnings).toEqual([]);

    const absolute: SessionReplaySearchParseResult = parseSessionReplaySearch(
      "url:https://app.acme.com/cart",
    );

    expect(absolute.advanced.urlPrefix).toBe("https://app.acme.com/cart");
    expect(absolute.warnings).toEqual([]);
  });

  test("an @ is a user reference", () => {
    const result: SessionReplaySearchParseResult =
      parseSessionReplaySearch("jane@acme.com");

    expect(result.advanced.identifiedUserRef).toBe("jane@acme.com");
    expect(result.advanced.search).toBe("");
  });

  test("anything else is the server's free-text search, words joined", () => {
    const result: SessionReplaySearchParseResult =
      parseSessionReplaySearch("checkout   payment");

    expect(result.advanced.search).toBe("checkout payment");
  });

  test("mixed bare text routes each word by its own shape", () => {
    const result: SessionReplaySearchParseResult = parseSessionReplaySearch(
      "jane@acme.com /checkout failed",
    );

    expect(result.advanced.identifiedUserRef).toBe("jane@acme.com");
    expect(result.advanced.urlPrefix).toBe("/checkout");
    expect(result.advanced.search).toBe("failed");
  });

  test("search text is capped at the server's limit with a warning", () => {
    const long: string = "x".repeat(250);
    const result: SessionReplaySearchParseResult =
      parseSessionReplaySearch(long);

    expect(result.advanced.search.length).toBe(200);
    expect(result.warnings[0]).toContain("200");
  });
});

describe("id: is an intent, not a filter", () => {
  test("a full session id narrows by prefix AND reports the navigation intent", () => {
    const result: SessionReplaySearchParseResult = parseSessionReplaySearch(
      `id:${SESSION_ID.toUpperCase()}`,
    );

    expect(result.advanced.search).toBe(SESSION_ID.toUpperCase());
    expect(result.navigateToSessionId).toBe(SESSION_ID);
  });

  test("a partial id only narrows the list", () => {
    const result: SessionReplaySearchParseResult =
      parseSessionReplaySearch("id:a1b2c3");

    expect(result.advanced.search).toBe("a1b2c3");
    expect(result.navigateToSessionId).toBeNull();
  });

  test("isLikelySessionId accepts hex ids and nothing else", () => {
    expect(isLikelySessionId(SESSION_ID)).toBe(true);
    expect(isLikelySessionId("a1b2c3d4e5f60718")).toBe(true);
    expect(isLikelySessionId("not-an-id")).toBe(false);
    expect(isLikelySessionId("")).toBe(false);
  });
});

describe("error: is dropped", () => {
  test("with an explanation, and nothing else is affected", () => {
    const result: SessionReplaySearchParseResult = parseSessionReplaySearch(
      "error:TypeError /checkout",
    );

    expect(result.advanced.search).toBe("");
    expect(result.advanced.urlPrefix).toBe("/checkout");
    expect(result.warnings[0]).toContain("error: is not a filter");
  });

  test("error is not in the token vocabulary", () => {
    expect(SESSION_REPLAY_SEARCH_TOKEN_KEYS).not.toContain("error");
  });
});

describe("stringify round trip", () => {
  const full: SessionReplayAdvancedFilters = {
    ...EMPTY_ADVANCED_FILTERS,
    identifiedUserRef: "jane@acme.com",
    urlPrefix: "/checkout",
    tags: "build=1.4.2, plan=pro",
    browserName: "Mobile Safari",
    osName: "iOS",
    deviceType: "mobile",
    countryCode: "DE",
    triggerReason: "performance",
    minDurationSeconds: "90",
    search: "payment failed",
  };

  test("parse(stringify(x)) yields x for every field the grammar covers", () => {
    const text: string = stringifySessionReplaySearch(full);

    expect(text).toBe(
      'user:jane@acme.com url:/checkout tag:build=1.4.2 tag:plan=pro browser:"Mobile Safari" os:iOS device:mobile country:DE trigger:performance min:1m30s payment failed',
    );
    expect(parseSessionReplaySearch(text).advanced).toEqual(full);
  });

  test("an empty filter set is an empty box", () => {
    expect(stringifySessionReplaySearch(EMPTY_ADVANCED_FILTERS)).toBe("");
  });

  test("identifiedUserRef is stringified for the box but that is not the URL", () => {
    /*
     * The box shows the user token; the URL writer (FILTER_URL_KEYS) is
     * what keeps it out of the address bar. Pinned in
     * SessionReplayListFilters.test.ts; here only the box side matters.
     */
    expect(
      stringifySessionReplaySearch({
        ...EMPTY_ADVANCED_FILTERS,
        identifiedUserRef: "jane@acme.com",
      }),
    ).toBe("user:jane@acme.com");
  });
});

describe("modal-only fields survive a keystroke", () => {
  test("route is not part of the grammar and is carried from the base", () => {
    const base: SessionReplayAdvancedFilters = {
      ...EMPTY_ADVANCED_FILTERS,
      route: "https://app.acme.com/exact",
      browserName: "Chrome",
    };

    const result: SessionReplaySearchParseResult = parseSessionReplaySearch(
      "os:macOS",
      base,
    );

    expect(result.advanced.route).toBe("https://app.acme.com/exact");
    /* The grammar covers browser, so the box's silence clears it. */
    expect(result.advanced.browserName).toBe("");
    expect(result.advanced.osName).toBe("macOS");

    expect(
      mergeSearchIntoFilters(
        { ...EMPTY_ADVANCED_FILTERS, osName: "macOS" },
        base,
      ).route,
    ).toBe("https://app.acme.com/exact");
  });
});

describe("duration tokens", () => {
  test("parse accepts seconds, unit strings and clock form", () => {
    expect(parseDurationToken("120")).toBe(120);
    expect(parseDurationToken("2m")).toBe(120);
    expect(parseDurationToken("1h 30m")).toBe(5400);
    expect(parseDurationToken("2:05")).toBe(125);
    expect(parseDurationToken("")).toBeNull();
    expect(parseDurationToken("2 minutes")).toBeNull();
  });

  test("format yields the shortest token that parses back", () => {
    for (const seconds of [5, 60, 90, 3600, 5400, 3661]) {
      expect(parseDurationToken(formatDurationToken(seconds))).toBe(seconds);
    }

    expect(formatDurationToken(90)).toBe("1m30s");
    expect(formatDurationToken(3600)).toBe("1h");
  });
});
