import {
  KeyFormat,
  makeKeyFromName,
  makeUniqueKey,
  makeUniqueKeyFromName,
  transliterateToAscii,
  trimKeyToLength,
} from "../../Utils/KeyFromName";
import {
  CUSTOM_FIELD_VARIABLE_KEY_FORMAT,
  generateCustomFieldVariableKey,
  getCustomFieldVariableKeyBase,
} from "../../Types/CustomField/CustomFieldVariableKey";
import { describe, expect, test } from "@jest/globals";

/*
 * The one place a name becomes a key (Utils/KeyFromName): what the form
 * shows under a Name field while it is typed, and what the server stamps
 * when a create leaves the key out. These pin its rules for both
 * separators: which characters survive, how other scripts and accents are
 * treated, how long a key may get, and how a clash is numbered.
 */

const HYPHEN: KeyFormat = {
  separator: "-",
  maxLength: 50,
  fallback: "thing",
};

const UNDERSCORE: KeyFormat = {
  separator: "_",
  maxLength: 64,
  fallback: "field",
};

const KEY_SHAPE: Record<KeyFormat["separator"], RegExp> = {
  "-": /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  _: /^[a-z0-9]+(?:_[a-z0-9]+)*$/,
};

// Names people type, and names nobody should but somebody will.
const NAME_CORPUS: Array<string> = [
  "Time to Detect",
  "time to detect",
  "TIME TO DETECT",
  "Time-to-Detect",
  "time_to_detect",
  "  Time   to    Detect  ",
  "Time to Acknowledge (P1)",
  "MTTR",
  "p99 latency",
  "5xx error rate",
  "HTTP 5xx error rate",
  "Error rate %",
  "Café au lait",
  "Größe",
  "Zeit bis zur Lösung",
  "Ærø Ølsted",
  "Łódź",
  "Ångström",
  "naïve façade",
  "ﬁnance",
  "Ｆｕｌｌ Ｗｉｄｔｈ",
  "① two ③",
  "検出までの時間",
  "Время обнаружения",
  "زمان تشخیص",
  "時間 to detect",
  "🚀 Launch time 🚀",
  "!!!",
  "---",
  "___",
  "",
  "   ",
  "a",
  "A".repeat(200),
  "word ".repeat(40),
  "a-".repeat(40),
  "x".repeat(49) + " y",
  "Time\tto\nDetect",
  "time.to.detect",
  "time/to\\detect",
  "<script>alert(1)</script>",
  "__proto__",
  "constructor",
  "0",
  "007 James",
];

describe("transliterateToAscii", () => {
  test.each([
    ["Café", "Cafe"],
    ["naïve façade", "naive facade"],
    ["Größe", "Grosse"],
    ["ẞ", "ss"],
    ["Ærø", "Aero"],
    ["Œuvre", "oeuvre"],
    ["Łódź", "lodz"],
    ["Đorđe", "dorde"],
    ["Þing", "thing"],
    ["ﬁ", "fi"],
    ["Ａ", "A"],
    ["①", "1"],
  ])("%p -> %p (case aside)", (input: string, expected: string) => {
    expect(transliterateToAscii(input).toLowerCase()).toBe(
      expected.toLowerCase(),
    );
  });

  test("leaves letters of other scripts as they are, for the caller to drop", () => {
    expect(transliterateToAscii("検出")).toBe("検出");
    expect(transliterateToAscii("Время")).toBe("Время");
  });

  test("treats anything that is not a string as nothing", () => {
    expect(transliterateToAscii(undefined as unknown as string)).toBe("");
    expect(transliterateToAscii(null as unknown as string)).toBe("");
    expect(transliterateToAscii(42 as unknown as string)).toBe("");
  });
});

describe("trimKeyToLength", () => {
  test("cuts to the length", () => {
    expect(trimKeyToLength("abcdef", 3, "-")).toBe("abc");
  });

  test("never leaves the separator dangling", () => {
    expect(trimKeyToLength("time-to-detect", 8, "-")).toBe("time-to");
    expect(trimKeyToLength("time__to", 6, "_")).toBe("time");
  });

  test("only strips its own separator", () => {
    expect(trimKeyToLength("time_to", 5, "-")).toBe("time_");
  });

  test("a length of zero or less leaves nothing", () => {
    expect(trimKeyToLength("abc", 0, "-")).toBe("");
    expect(trimKeyToLength("abc", -4, "-")).toBe("");
  });
});

describe("makeKeyFromName", () => {
  test.each([
    ["Time to Detect", "time-to-detect"],
    ["Time to Acknowledge (P1)", "time-to-acknowledge-p1"],
    ["  Time   to    Detect  ", "time-to-detect"],
    ["Time-to-Detect", "time-to-detect"],
    ["time_to_detect", "time-to-detect"],
    ["time.to.detect", "time-to-detect"],
    ["Time\tto\nDetect", "time-to-detect"],
    ["MTTR", "mttr"],
    ["p99 latency", "p99-latency"],
    ["HTTP 5xx error rate", "http-5xx-error-rate"],
    ["Error rate %", "error-rate"],
    ["Café au lait", "cafe-au-lait"],
    ["Zeit bis zur Lösung", "zeit-bis-zur-losung"],
    ["Größe", "grosse"],
    ["Ærø Ølsted", "aero-olsted"],
    ["Ｆｕｌｌ Ｗｉｄｔｈ", "full-width"],
    ["① two ③", "1-two-3"],
    ["時間 to detect", "to-detect"],
    ["🚀 Launch time 🚀", "launch-time"],
    ["<script>alert(1)</script>", "script-alert-1-script"],
    ["007 James", "007-james"],
    ["0", "0"],
  ])("with hyphens: %p -> %p", (name: string, expected: string) => {
    expect(makeKeyFromName(name, HYPHEN)).toBe(expected);
  });

  test.each([
    ["Expected Resolution", "expected_resolution"],
    ["Time-to-Detect", "time_to_detect"],
    ["HTTP 5xx error rate", "http_5xx_error_rate"],
    ["Größe", "grosse"],
  ])("with underscores: %p -> %p", (name: string, expected: string) => {
    expect(makeKeyFromName(name, UNDERSCORE)).toBe(expected);
  });

  test.each([
    "!!!",
    "---",
    "___",
    "",
    "   ",
    "検出までの時間",
    "Время обнаружения",
    "زمان تشخیص",
  ])(
    "a name with nothing usable in it, %p, gets the fallback",
    (name: string) => {
      expect(makeKeyFromName(name, HYPHEN)).toBe("thing");
      expect(makeKeyFromName(name, UNDERSCORE)).toBe("field");
    },
  );

  test("a name that is not a string gets the fallback rather than throwing", () => {
    expect(makeKeyFromName(undefined as unknown as string, HYPHEN)).toBe(
      "thing",
    );
    expect(makeKeyFromName(null as unknown as string, HYPHEN)).toBe("thing");
  });

  test("a long name is cut to the format's length, at a word where the cut lands on a separator", () => {
    const key: string = makeKeyFromName("word ".repeat(40), HYPHEN);

    expect(key.length).toBeLessThanOrEqual(50);
    expect(key.endsWith("-")).toBe(false);
    expect(key.startsWith("word-word")).toBe(true);
  });

  test("a cut that would end on a separator drops it", () => {
    // 49 x's, a space, then y: the 50th character is the separator.
    expect(makeKeyFromName("x".repeat(49) + " y", HYPHEN)).toBe("x".repeat(49));
  });

  describe.each([
    ["hyphens", HYPHEN],
    ["underscores", UNDERSCORE],
  ])("whatever the name, with %s", (_label: string, format: KeyFormat) => {
    test.each(NAME_CORPUS)("%p makes a valid key", (name: string) => {
      const key: string = makeKeyFromName(name, format);

      expect(key).toMatch(KEY_SHAPE[format.separator]);
      expect(key.length).toBeGreaterThan(0);
      expect(key.length).toBeLessThanOrEqual(format.maxLength);
    });

    test.each(NAME_CORPUS)(
      "%p makes the same key every time, and a key makes itself",
      (name: string) => {
        const key: string = makeKeyFromName(name, format);

        expect(makeKeyFromName(name, format)).toBe(key);
        // A key typed back in as a name stays the key.
        expect(makeKeyFromName(key, format)).toBe(key);
      },
    );
  });
});

describe("makeUniqueKey", () => {
  test("keeps a key nothing else holds", () => {
    expect(
      makeUniqueKey({
        key: "time-to-detect",
        existingKeys: ["time-to-resolve"],
        format: HYPHEN,
      }),
    ).toBe("time-to-detect");
  });

  test("numbers a key that is taken, from 2", () => {
    expect(
      makeUniqueKey({
        key: "time-to-detect",
        existingKeys: ["time-to-detect"],
        format: HYPHEN,
      }),
    ).toBe("time-to-detect-2");

    expect(
      makeUniqueKey({
        key: "expected_resolution",
        existingKeys: ["expected_resolution"],
        format: UNDERSCORE,
      }),
    ).toBe("expected_resolution_2");
  });

  test("takes the first number nothing holds", () => {
    expect(
      makeUniqueKey({
        key: "ttd",
        existingKeys: ["ttd", "ttd-2", "ttd-3", "ttd-5"],
        format: HYPHEN,
      }),
    ).toBe("ttd-4");
  });

  test("ignores empty, null and missing keys among the existing ones", () => {
    expect(
      makeUniqueKey({
        key: "ttd",
        existingKeys: [null, undefined, "", "other"],
        format: HYPHEN,
      }),
    ).toBe("ttd");
  });

  test("compares exactly: every key it makes is lowercase", () => {
    expect(
      makeUniqueKey({
        key: "ttd",
        existingKeys: ["TTD"],
        format: HYPHEN,
      }),
    ).toBe("ttd");
  });

  test("accepts any iterable of existing keys", () => {
    expect(
      makeUniqueKey({
        key: "ttd",
        existingKeys: new Set<string>(["ttd"]),
        format: HYPHEN,
      }),
    ).toBe("ttd-2");
  });

  test("cuts the key so the number still fits within the format's length", () => {
    const longKey: string = "a".repeat(50);

    const unique: string = makeUniqueKey({
      key: longKey,
      existingKeys: [longKey],
      format: HYPHEN,
    });

    expect(unique).toBe(`${"a".repeat(48)}-2`);
    expect(unique.length).toBe(50);
  });

  test("a cut that ends on a separator does not double it", () => {
    // Cut to 48 the key ends "...b-" - the dash is dropped before "-2".
    const key: string = `${"b".repeat(47)}-cc`;

    expect(makeUniqueKey({ key, existingKeys: [key], format: HYPHEN })).toBe(
      `${"b".repeat(47)}-2`,
    );
  });

  test("always finds a free key, however many are taken", () => {
    const taken: Array<string> = [];

    for (let index: number = 0; index < 120; index++) {
      const next: string = makeUniqueKey({
        key: "ttd",
        existingKeys: taken,
        format: HYPHEN,
      });

      expect(taken).not.toContain(next);
      expect(next).toMatch(KEY_SHAPE["-"]);
      expect(next.length).toBeLessThanOrEqual(50);
      taken.push(next);
    }

    expect(taken.slice(0, 4)).toEqual(["ttd", "ttd-2", "ttd-3", "ttd-4"]);
  });

  test("numbers long keys apart too, with every result within the length", () => {
    const taken: Array<string> = [];
    const longKey: string = "z".repeat(50);

    for (let index: number = 0; index < 30; index++) {
      const next: string = makeUniqueKey({
        key: longKey,
        existingKeys: taken,
        format: HYPHEN,
      });

      expect(taken).not.toContain(next);
      expect(next.length).toBeLessThanOrEqual(50);
      taken.push(next);
    }
  });
});

describe("makeUniqueKeyFromName", () => {
  test("is the name's key, numbered on a clash", () => {
    expect(
      makeUniqueKeyFromName({
        name: "Time to Detect",
        existingKeys: [],
        format: HYPHEN,
      }),
    ).toBe("time-to-detect");

    expect(
      makeUniqueKeyFromName({
        name: "Time to Detect!",
        existingKeys: ["time-to-detect"],
        format: HYPHEN,
      }),
    ).toBe("time-to-detect-2");
  });

  test("numbers fallbacks apart", () => {
    expect(
      makeUniqueKeyFromName({
        name: "!!!",
        existingKeys: ["thing"],
        format: HYPHEN,
      }),
    ).toBe("thing-2");
  });
});

/*
 * Incident custom field template keys were the first keys made from names,
 * with their own copy of these rules. They now go through this module in
 * their own format, and must come out exactly as before: the keys already
 * stored (and placed in templates) were made the old way, and the backfill
 * gives keys to fields that have none with the same generator.
 */
describe("incident custom field template keys", () => {
  test("are this module's keys in the custom field format", () => {
    for (const name of NAME_CORPUS) {
      expect(getCustomFieldVariableKeyBase(name)).toBe(
        makeKeyFromName(name, CUSTOM_FIELD_VARIABLE_KEY_FORMAT),
      );
    }
  });

  test("keep their underscore format, 64 characters and the field fallback", () => {
    expect(CUSTOM_FIELD_VARIABLE_KEY_FORMAT).toEqual({
      separator: "_",
      maxLength: 64,
      fallback: "field",
    });
  });

  test.each([
    ["Expected Resolution", [], "expected_resolution"],
    ["Expected Resolution", ["expected_resolution"], "expected_resolution_2"],
    [
      "Expected Resolution",
      ["expected_resolution", "expected_resolution_2"],
      "expected_resolution_3",
    ],
    ["影响", [], "field"],
    ["影响", ["field"], "field_2"],
    ["Größe", [], "grosse"],
  ])(
    "%p with %p taken is %p, as before",
    (name: string, existingKeys: Array<string>, expected: string) => {
      expect(generateCustomFieldVariableKey({ name, existingKeys })).toBe(
        expected,
      );
    },
  );
});
