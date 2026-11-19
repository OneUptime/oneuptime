import { describe, expect, test } from "@jest/globals";
import {
  SESSION_REPLAY_NO_PAGE_RECORDED,
  SessionReplayPageRules,
  hasSessionReplayPageRules,
  isSessionReplayPageRecorded,
  readSessionReplayPagePatterns,
  readSessionReplayPageRules,
} from "../../../Types/Rum/SessionReplayPageRules";
import { matchesSessionReplayPagePattern } from "../../../Types/Rum/SessionReplayFrustrationSignals";

/*
 * Which pages of a website a recording may hold (issue #7502): Record only
 * these pages and Never record these pages, matched the way the
 * application's page signals match a page. Absent rules record every page,
 * as before; rules that cannot be read record none, because a privacy
 * setting a recorder cannot read must never record more than it would.
 */

function rules(
  recordOnly: Array<string>,
  neverRecord: Array<string>,
): SessionReplayPageRules {
  return { recordOnly, neverRecord };
}

describe("readSessionReplayPageRules", () => {
  test("absent rules record every page", () => {
    for (const absent of [undefined, null]) {
      const read: SessionReplayPageRules = readSessionReplayPageRules(absent);

      expect(read).toEqual({ recordOnly: [], neverRecord: [] });
      expect(hasSessionReplayPageRules(read)).toBe(false);
      expect(isSessionReplayPageRecorded(read, ["/anything"])).toBe(true);
    }
  });

  test("lists are trimmed, each pattern kept once, as written", () => {
    expect(
      readSessionReplayPageRules({
        recordOnly: [" /checkout* ", "/checkout*", "", "   ", "/Cart"],
        neverRecord: ["/admin*", "/admin*"],
      }),
    ).toEqual({
      recordOnly: ["/checkout*", "/Cart"],
      neverRecord: ["/admin*"],
    });
  });

  test("one list may be left out", () => {
    expect(readSessionReplayPageRules({ neverRecord: ["/admin*"] })).toEqual({
      recordOnly: [],
      neverRecord: ["/admin*"],
    });
    expect(readSessionReplayPageRules({ recordOnly: ["/checkout"] })).toEqual({
      recordOnly: ["/checkout"],
      neverRecord: [],
    });
  });

  test("rules that cannot be read record no page", () => {
    for (const unreadable of [
      "everything",
      7,
      true,
      ["/admin*"],
      { recordOnly: "/checkout" },
      { neverRecord: { path: "/admin" } },
      { neverRecord: ["/admin*", 42] },
      { recordOnly: [null] },
    ]) {
      const read: SessionReplayPageRules =
        readSessionReplayPageRules(unreadable);

      expect({ unreadable, read }).toEqual({
        unreadable,
        read: SESSION_REPLAY_NO_PAGE_RECORDED,
      });

      for (const path of ["/", "/checkout", "/admin", "/a/b/c"]) {
        expect(isSessionReplayPageRecorded(read, [path])).toBe(false);
      }
    }
  });

  test("an unreadable list is not shared with the constant", () => {
    const read: SessionReplayPageRules = readSessionReplayPageRules("x");

    read.neverRecord.push("/mutated");

    expect(SESSION_REPLAY_NO_PAGE_RECORDED.neverRecord).toEqual(["*"]);
  });

  test("readSessionReplayPagePatterns says null only for a list that is not one", () => {
    expect(readSessionReplayPagePatterns(undefined)).toEqual([]);
    expect(readSessionReplayPagePatterns(null)).toEqual([]);
    expect(readSessionReplayPagePatterns([])).toEqual([]);
    expect(readSessionReplayPagePatterns(["/a", "/a "])).toEqual(["/a"]);
    expect(readSessionReplayPagePatterns("/a")).toBeNull();
    expect(readSessionReplayPagePatterns([1])).toBeNull();
  });
});

describe("isSessionReplayPageRecorded", () => {
  test("Record only records the pages it names, and no other", () => {
    const only: SessionReplayPageRules = rules(["/checkout*", "/cart"], []);

    expect(isSessionReplayPageRecorded(only, ["/checkout"])).toBe(true);
    expect(isSessionReplayPageRecorded(only, ["/checkout/payment"])).toBe(true);
    expect(isSessionReplayPageRecorded(only, ["/cart"])).toBe(true);
    expect(isSessionReplayPageRecorded(only, ["/cart/42"])).toBe(false);
    expect(isSessionReplayPageRecorded(only, ["/"])).toBe(false);
    expect(isSessionReplayPageRecorded(only, ["/account"])).toBe(false);
  });

  test("Never record keeps out the pages it names, and only those", () => {
    const never: SessionReplayPageRules = rules([], ["/admin*", "/account/*"]);

    expect(isSessionReplayPageRecorded(never, ["/admin"])).toBe(false);
    expect(isSessionReplayPageRecorded(never, ["/admin/users/7"])).toBe(false);
    expect(isSessionReplayPageRecorded(never, ["/account/settings"])).toBe(
      false,
    );
    expect(isSessionReplayPageRecorded(never, ["/account"])).toBe(true);
    expect(isSessionReplayPageRecorded(never, ["/"])).toBe(true);
    expect(isSessionReplayPageRecorded(never, ["/checkout"])).toBe(true);
  });

  test("Never record wins over Record only", () => {
    const both: SessionReplayPageRules = rules(
      ["/checkout*"],
      ["/checkout/card*"],
    );

    expect(isSessionReplayPageRecorded(both, ["/checkout"])).toBe(true);
    expect(isSessionReplayPageRecorded(both, ["/checkout/card"])).toBe(false);
    expect(isSessionReplayPageRecorded(both, ["/checkout/card/3ds"])).toBe(
      false,
    );
    expect(isSessionReplayPageRecorded(both, ["/home"])).toBe(false);
  });

  test("case and the slashes at the end are ignored, as for a page signal", () => {
    const never: SessionReplayPageRules = rules([], ["/Admin"]);

    expect(isSessionReplayPageRecorded(never, ["/admin"])).toBe(false);
    expect(isSessionReplayPageRecorded(never, ["/ADMIN/"])).toBe(false);
    expect(isSessionReplayPageRecorded(never, ["/administrators"])).toBe(true);
  });

  test("a page is read in the spelling a person reads", () => {
    const never: SessionReplayPageRules = rules([], ["/café*"]);

    expect(isSessionReplayPageRecorded(never, ["/caf%C3%A9/menu"])).toBe(false);
  });

  /*
   * A hash router's page is the route after the #: either of a page's paths
   * named by Never record keeps it out, and either named by Record only
   * lets it in.
   */
  test("a hash-routed page is named by its path or by its route", () => {
    const never: SessionReplayPageRules = rules([], ["/admin*"]);
    const only: SessionReplayPageRules = rules(["/checkout*"], []);

    expect(isSessionReplayPageRecorded(never, ["/", "/admin/users"])).toBe(
      false,
    );
    expect(isSessionReplayPageRecorded(never, ["/", "/orders"])).toBe(true);
    expect(isSessionReplayPageRecorded(only, ["/", "/checkout/2"])).toBe(true);
    expect(isSessionReplayPageRecorded(only, ["/", "/orders"])).toBe(false);
  });

  test("a pattern that names no path matches nothing: Record only records nothing, never everything", () => {
    const only: SessionReplayPageRules = rules(["checkout"], []);

    for (const path of ["/", "/checkout", "/checkout/x"]) {
      expect(isSessionReplayPageRecorded(only, [path])).toBe(false);
    }
  });

  test("a star alone in Never record keeps every page out", () => {
    const never: SessionReplayPageRules = rules([], ["*"]);

    for (const path of ["/", "/checkout", "/a/b/c/d"]) {
      expect(isSessionReplayPageRecorded(never, [path])).toBe(false);
    }
  });

  test("matches every page exactly as the page signals' matcher does", () => {
    const patterns: Array<string> = [
      "/checkout*",
      "*/failed",
      "/orders/*/failed",
      "/a",
      "/A/",
      "*",
    ];
    const paths: Array<string> = [
      "/",
      "/a",
      "/a/",
      "/checkout",
      "/checkout/x",
      "/orders/42/failed",
      "/x/failed",
    ];

    for (const pattern of patterns) {
      for (const path of paths) {
        expect({
          pattern,
          path,
          recorded: isSessionReplayPageRecorded(rules([pattern], []), [path]),
        }).toEqual({
          pattern,
          path,
          recorded: matchesSessionReplayPagePattern(pattern, path),
        });
        expect({
          pattern,
          path,
          recorded: isSessionReplayPageRecorded(rules([], [pattern]), [path]),
        }).toEqual({
          pattern,
          path,
          recorded: !matchesSessionReplayPagePattern(pattern, path),
        });
      }
    }
  });
});
