import { describe, expect, test } from "@jest/globals";
import {
  SESSION_REPLAY_NEVER_RECORD_PAGES_TITLE,
  SESSION_REPLAY_READABLE_EVENT_PROPERTIES_TITLE,
  SESSION_REPLAY_RECORD_ONLY_PAGES_TITLE,
  SessionReplayListCheck,
  checkSessionReplayPagePatterns,
  checkSessionReplayReadablePropertyKeys,
} from "../../../Utils/Rum/SessionReplayPolicyValidation";
import { SESSION_REPLAY_MAX_PAGE_RULES } from "../../../Types/Rum/SessionReplayPageRules";

/*
 * The strict check of a replay policy's page rules (#7502) and readable
 * event properties (#7501) on every write. A page path that could never
 * match is refused with words that name the setting and the entry: stored,
 * a Never record entry like that would be a page someone meant to keep out
 * of every recording, recorded.
 */

const NEVER: string = SESSION_REPLAY_NEVER_RECORD_PAGES_TITLE;

describe("checkSessionReplayPagePatterns", () => {
  test("the titles are the Replay Policy page's", () => {
    expect(SESSION_REPLAY_RECORD_ONLY_PAGES_TITLE).toBe(
      "Record only these pages",
    );
    expect(NEVER).toBe("Never record these pages");
  });

  test("a list of page paths is stored trimmed, each once", () => {
    expect(
      checkSessionReplayPagePatterns(
        [" /admin* ", "/admin*", "/account/*", "*/settings"],
        NEVER,
      ),
    ).toEqual({
      values: ["/admin*", "/account/*", "*/settings"],
      problem: null,
    });
  });

  test("cleared, or left empty, it is an empty list", () => {
    for (const value of [null, undefined, []]) {
      expect(checkSessionReplayPagePatterns(value, NEVER)).toEqual({
        values: [],
        problem: null,
      });
    }
  });

  test("anything but a list of strings is refused, naming the setting", () => {
    for (const value of ["/admin", 7, { path: "/admin" }, ["/admin", 3]]) {
      const check: SessionReplayListCheck = checkSessionReplayPagePatterns(
        value,
        NEVER,
      );

      expect(check.problem).toBe(
        'Never record these pages must be a list of page paths, such as ["/checkout*"].',
      );
      expect(check.values).toEqual([]);
    }
  });

  test("a path that could never match is refused, naming the entry and how to write it", () => {
    expect(checkSessionReplayPagePatterns(["admin"], NEVER).problem).toBe(
      'Never record these pages: "admin" is not a page path. A page pattern starts with / (or with * to match the end of any path), such as /checkout/error.',
    );
    expect(checkSessionReplayPagePatterns(["/search?q=*"], NEVER).problem).toBe(
      'Never record these pages: "/search?q=*" is not a page path. Match the page\'s path only, without ? or #.',
    );
    expect(
      checkSessionReplayPagePatterns(
        ["/#/admin"],
        SESSION_REPLAY_RECORD_ONLY_PAGES_TITLE,
      ).problem,
    ).toBe(
      'Record only these pages: "/#/admin" is not a page path. Match the page\'s path only, without ? or #.',
    );
    expect(checkSessionReplayPagePatterns(["   "], NEVER).problem).toBe(
      'Never record these pages: "" is not a page path. Enter the page\'s path, such as /checkout/error.',
    );
    expect(
      checkSessionReplayPagePatterns([`/${"a".repeat(200)}`], NEVER).problem,
    ).toBe(
      `Never record these pages: "/${"a".repeat(200)}" is not a page path. A page pattern can be at most 200 characters.`,
    );
  });

  test("at most fifty paths, with the way to name many pages with one", () => {
    const paths: Array<string> = Array.from(
      { length: SESSION_REPLAY_MAX_PAGE_RULES + 1 },
      (_value: unknown, index: number): string => {
        return `/page-${index}`;
      },
    );

    expect(SESSION_REPLAY_MAX_PAGE_RULES).toBe(50);
    expect(checkSessionReplayPagePatterns(paths, NEVER).problem).toBe(
      "Never record these pages can name at most 50 page paths. Use a * to name many pages with one path.",
    );
    expect(
      checkSessionReplayPagePatterns(paths.slice(0, 50), NEVER).problem,
    ).toBeNull();
    /* Repeats are one path. */
    expect(
      checkSessionReplayPagePatterns(
        [...paths.slice(0, 50), "/page-0", " /page-1"],
        NEVER,
      ).values,
    ).toHaveLength(50);
  });
});

describe("checkSessionReplayReadablePropertyKeys", () => {
  test("the title is the Replay Policy page's", () => {
    expect(SESSION_REPLAY_READABLE_EVENT_PROPERTIES_TITLE).toBe(
      "Readable event properties",
    );
  });

  test("a list of keys is stored as the recorders read it", () => {
    expect(
      checkSessionReplayReadablePropertyKeys([
        " step ",
        "step",
        "setup",
        "",
        "plan",
      ]),
    ).toEqual({ values: ["step", "setup", "plan"], problem: null });
  });

  test("cleared, it is an empty list", () => {
    for (const value of [null, undefined, []]) {
      expect(checkSessionReplayReadablePropertyKeys(value)).toEqual({
        values: [],
        problem: null,
      });
    }
  });

  test("anything but a list of strings is refused", () => {
    for (const value of ["step", 3, { step: true }, ["step", 4]]) {
      expect(checkSessionReplayReadablePropertyKeys(value).problem).toBe(
        'Readable event properties must be a list of property keys, such as ["plan", "step"].',
      );
    }
  });

  test("a key longer than a property's key can be is refused, not cut short", () => {
    const long: string = "k".repeat(41);

    expect(checkSessionReplayReadablePropertyKeys([long]).problem).toBe(
      `Readable event properties: a property key can be at most 40 characters, and "${long}" is longer.`,
    );
    expect(
      checkSessionReplayReadablePropertyKeys(["k".repeat(40)]).problem,
    ).toBeNull();
  });

  test("at most twenty keys", () => {
    const keys: Array<string> = Array.from(
      { length: 21 },
      (_value: unknown, index: number): string => {
        return `key${index}`;
      },
    );

    expect(checkSessionReplayReadablePropertyKeys(keys).problem).toBe(
      "Readable event properties can name at most 20 property keys.",
    );
    expect(
      checkSessionReplayReadablePropertyKeys(keys.slice(0, 20)).values,
    ).toHaveLength(20);
  });
});
