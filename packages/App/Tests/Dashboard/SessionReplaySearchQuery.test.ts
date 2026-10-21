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
  parseSessionReplaySearchBox,
  removeSearchBoxChipTokens,
  SEARCH_BOX_CHIP_FIELDS,
  SEARCH_BOX_CHIP_TOKEN_KEYS,
  SESSION_REPLAY_SEARCH_HELP_COMBINED_EXAMPLE,
  SESSION_REPLAY_SEARCH_HELP_ROWS,
  SESSION_REPLAY_SEARCH_TOKEN_KEYS,
  SessionReplaySearchParseResult,
  stringifySessionReplaySearch,
  stringifySessionReplaySearchBox,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplaySearchQuery";
import { SearchHelpRow } from "Common/UI/Components/TelemetryViewer/types";

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

describe("visitor: is an exact visitor id", () => {
  const VISITOR: string = "7f3a2b1c9d8e4f5a6b7c8d9e0f1a2b3c";

  test("a whole 32-hex id is the visitorId filter, lower-cased, and round-trips", () => {
    const result: SessionReplaySearchParseResult = parseSessionReplaySearch(
      `visitor:${VISITOR.toUpperCase()} /checkout`,
    );

    expect(result.advanced.visitorId).toBe(VISITOR);
    expect(result.advanced.urlPrefix).toBe("/checkout");
    expect(result.warnings).toEqual([]);

    const filters: SessionReplayAdvancedFilters = {
      ...EMPTY_ADVANCED_FILTERS,
      visitorId: VISITOR,
      browserName: "Chrome",
    };

    expect(stringifySessionReplaySearch(filters)).toBe(
      `visitor:${VISITOR} browser:Chrome`,
    );
    expect(
      parseSessionReplaySearch(stringifySessionReplaySearch(filters)).advanced,
    ).toEqual(filters);
  });

  /*
   * The server refuses anything but a whole id with a 400; a half-pasted
   * id is dropped with a hint rather than sent, so the list never fails a
   * request over it.
   */
  test("a malformed visitor value warns and is dropped, nothing else affected", () => {
    const result: SessionReplaySearchParseResult = parseSessionReplaySearch(
      "visitor:7f3a2b browser:Chrome",
    );

    expect(result.advanced.visitorId).toBe("");
    expect(result.advanced.browserName).toBe("Chrome");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("visitor:");
    expect(result.warnings[0]).toContain('"7f3a2b"');
  });

  test("visitor is in the token vocabulary", () => {
    expect(SESSION_REPLAY_SEARCH_TOKEN_KEYS).toContain("visitor");
  });
});

describe("the identity digest is chip-only", () => {
  const USER_KEY: string =
    "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

  test("identifiedUserKey is carried from the base across a parse, never stringified", () => {
    const base: SessionReplayAdvancedFilters = {
      ...EMPTY_ADVANCED_FILTERS,
      identifiedUserKey: USER_KEY,
    };

    const result: SessionReplaySearchParseResult = parseSessionReplaySearch(
      "browser:Chrome",
      base,
    );

    expect(result.advanced.identifiedUserKey).toBe(USER_KEY);
    expect(result.advanced.browserName).toBe("Chrome");
    /* A 64-character hash has no business in the box. */
    expect(stringifySessionReplaySearch(base)).toBe("");
    expect(
      mergeSearchIntoFilters(
        { ...EMPTY_ADVANCED_FILTERS, osName: "macOS" },
        base,
      ).identifiedUserKey,
    ).toBe(USER_KEY);
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

/*
 * The box leaves the chips' fields to the chips under the header: it never
 * writes them out, a keystroke never clears them, a typed chip token still
 * sets its chip, and Enter takes such tokens out of the text.
 */
describe("the search box and the chips", () => {
  const CHIPS: SessionReplayAdvancedFilters = {
    ...EMPTY_ADVANCED_FILTERS,
    browserName: "Chrome",
    osName: "macOS",
    deviceType: "mobile",
    countryCode: "DE",
    triggerReason: "error",
    minDurationSeconds: "120",
  };

  test("the chips' fields are the six the chip row shows, and their tokens are the grammar's", () => {
    expect([...SEARCH_BOX_CHIP_FIELDS]).toEqual([
      "browserName",
      "osName",
      "deviceType",
      "countryCode",
      "triggerReason",
      "minDurationSeconds",
    ]);
    expect([...SEARCH_BOX_CHIP_TOKEN_KEYS]).toEqual([
      "browser",
      "os",
      "device",
      "country",
      "trigger",
      "min",
    ]);

    for (const key of SEARCH_BOX_CHIP_TOKEN_KEYS) {
      expect(SESSION_REPLAY_SEARCH_TOKEN_KEYS).toContain(key);
    }
  });

  test("stringifySessionReplaySearchBox writes everything but the chips", () => {
    expect(stringifySessionReplaySearchBox(CHIPS)).toBe("");
    expect(
      stringifySessionReplaySearchBox({
        ...CHIPS,
        identifiedUserRef: "jane@acme.com",
        visitorId: "abc123def4567890abc123def4567890",
        urlPrefix: "/checkout",
        tags: "plan=pro",
        search: "slow page",
        route: "https://app.acme.com/exact",
        identifiedUserKey: "k1",
      }),
    ).toBe(
      "user:jane@acme.com visitor:abc123def4567890abc123def4567890 url:/checkout tag:plan=pro slow page",
    );
  });

  test("stringifySessionReplaySearchBox is stringifySessionReplaySearch without the chip tokens", () => {
    const filters: SessionReplayAdvancedFilters = {
      ...CHIPS,
      urlPrefix: "/cart",
      search: "x",
    };

    expect(
      removeSearchBoxChipTokens(stringifySessionReplaySearch(filters)),
    ).toBe(stringifySessionReplaySearchBox(filters));
  });

  test("a keystroke keeps every chip the text does not name", () => {
    const result: SessionReplaySearchParseResult = parseSessionReplaySearchBox(
      "/checkout jane",
      CHIPS,
    );

    expect(result.advanced).toEqual({
      ...CHIPS,
      urlPrefix: "/checkout",
      search: "jane",
    });
    expect(result.warnings).toEqual([]);
  });

  test("a chip token the reader typed wins over the chip", () => {
    const result: SessionReplaySearchParseResult = parseSessionReplaySearchBox(
      "browser:Firefox country:gb",
      CHIPS,
    );

    expect(result.advanced.browserName).toBe("Firefox");
    expect(result.advanced.countryCode).toBe("GB");
    expect(result.advanced.osName).toBe("macOS");
  });

  test("a chip token the grammar refuses leaves the chip as it was, with the warning", () => {
    const result: SessionReplaySearchParseResult = parseSessionReplaySearchBox(
      "device:car min:soon",
      CHIPS,
    );

    expect(result.advanced.deviceType).toBe("mobile");
    expect(result.advanced.minDurationSeconds).toBe("120");
    expect(result.warnings).toHaveLength(2);
  });

  test("the box's own fields are read from the text alone; the modal's are carried", () => {
    const result: SessionReplaySearchParseResult = parseSessionReplaySearchBox(
      "",
      {
        ...EMPTY_ADVANCED_FILTERS,
        identifiedUserRef: "jane@acme.com",
        urlPrefix: "/checkout",
        route: "https://app.acme.com/exact",
        identifiedUserKey: "k1",
      },
    );

    expect(result.advanced).toEqual({
      ...EMPTY_ADVANCED_FILTERS,
      route: "https://app.acme.com/exact",
      identifiedUserKey: "k1",
    });
  });

  test("parseSessionReplaySearchBox reads the grammar as parseSessionReplaySearch does", () => {
    const query: string =
      'user:jane@acme.com url:/checkout tag:plan=pro "two words" id:a1b2c3';

    expect(parseSessionReplaySearchBox(query, EMPTY_ADVANCED_FILTERS)).toEqual(
      parseSessionReplaySearch(query, EMPTY_ADVANCED_FILTERS),
    );
  });

  test("removeSearchBoxChipTokens takes the chip tokens out and keeps the rest as typed", () => {
    expect(
      removeSearchBoxChipTokens(
        'browser:"Mobile Safari" /cart OS:Linux min:2m "two words" jane',
      ),
    ).toBe('/cart "two words" jane');
    expect(removeSearchBoxChipTokens("country:DE trigger:error")).toBe("");
  });

  test("removeSearchBoxChipTokens hands back text without a chip token untouched", () => {
    for (const query of [
      "",
      "  /checkout   jane ",
      'user:"Jane Doe" tag:plan=pro',
      "browserish:x os",
    ]) {
      expect(removeSearchBoxChipTokens(query)).toBe(query);
    }
  });
});

/*
 * The syntax help the box drops down: a row per kind of token, each with an
 * example a click puts in the box. The help may not advertise what the
 * grammar does not do.
 */
describe("the search box's syntax help", () => {
  test("every example reads without a warning and sets what its row says", () => {
    for (const row of SESSION_REPLAY_SEARCH_HELP_ROWS) {
      const result: SessionReplaySearchParseResult = parseSessionReplaySearch(
        row.example,
      );

      expect(result.warnings).toEqual([]);
      expect(stringifySessionReplaySearch(result.advanced)).not.toBe("");
    }
  });

  test("every row's token is one the grammar knows", () => {
    for (const row of SESSION_REPLAY_SEARCH_HELP_ROWS) {
      if (row.syntax === "free text") {
        continue;
      }

      const key: string = row.syntax.substring(0, row.syntax.indexOf(":"));

      expect(SESSION_REPLAY_SEARCH_TOKEN_KEYS).toContain(key);
      expect(row.example.startsWith(`${key}:`)).toBe(true);
    }
  });

  test("the chip tokens' row names every chip token", () => {
    const row: SearchHelpRow | undefined = SESSION_REPLAY_SEARCH_HELP_ROWS.find(
      (candidate: SearchHelpRow): boolean => {
        return candidate.syntax.startsWith("browser:");
      },
    );

    expect(row).toBeDefined();

    for (const key of SEARCH_BOX_CHIP_TOKEN_KEYS) {
      if (key === "browser" || key === "min") {
        continue;
      }

      expect(row?.description).toContain(`${key}:`);
    }
  });

  test("the combined example reads without a warning", () => {
    expect(
      parseSessionReplaySearch(SESSION_REPLAY_SEARCH_HELP_COMBINED_EXAMPLE)
        .warnings,
    ).toEqual([]);
  });

  test("the id: example narrows the list and does not open a session", () => {
    const row: SearchHelpRow | undefined = SESSION_REPLAY_SEARCH_HELP_ROWS.find(
      (candidate: SearchHelpRow): boolean => {
        return candidate.syntax.startsWith("id:");
      },
    );
    const result: SessionReplaySearchParseResult = parseSessionReplaySearch(
      row?.example || "",
    );

    expect(result.navigateToSessionId).toBeNull();
    expect(result.advanced.search).not.toBe("");
  });
});
