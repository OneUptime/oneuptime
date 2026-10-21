import { describe, expect, test } from "@jest/globals";
import {
  collapseLlmWhitespace,
  compactLlmArguments,
  formatLlmClock,
  formatLlmCost,
  formatLlmCount,
  formatLlmDuration,
  formatLlmShare,
  formatLlmTokens,
  prettyLlmJson,
  truncateLlmText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmConversationFormat";

/*
 * How the AI pages write a latency, a cost and a token count. Every surface
 * - the list's rows, the summary tiles, an answer's meta line, the replay's
 * clock - goes through these, so a rule broken here is broken everywhere at
 * once. The unit boundaries are pinned on both sides: a value that rounds
 * up must read in the next unit ("1.0 s", never "1000 ms").
 */

/*
 * Values just under, at and just over each unit's boundary, scaled to it:
 * where a rounding rule goes wrong, it goes wrong here.
 */
function nearBoundaries(boundaries: Array<number>): Array<number> {
  const values: Array<number> = [];

  for (const boundary of boundaries) {
    for (const fraction of [
      -0.06, -0.05, -0.0051, -0.005, -0.0049, -0.001, -0.0005, -0.0004, 0,
      0.0004, 0.0005, 0.001, 0.005, 0.05,
    ]) {
      values.push(boundary * (1 + fraction));
    }

    for (const delta of [-1, -0.6, -0.5, -0.4, 0.4, 0.5, 0.6, 1]) {
      values.push(boundary + delta);
    }
  }

  return values;
}

describe("formatLlmDuration", () => {
  test.each([
    [Number.NaN, "0 ms"],
    [Number.POSITIVE_INFINITY, "0 ms"],
    [-5, "0 ms"],
    [0, "0 ms"],
    [0.4, "0 ms"],
    [1, "1 ms"],
    [850, "850 ms"],
    [999.4, "999 ms"],
  ])("%p ms reads as milliseconds: %s", (ms: number, expected: string) => {
    expect(formatLlmDuration(ms)).toBe(expected);
  });

  test.each([
    [999.6, "1.0 s"],
    [1000, "1.0 s"],
    [1049, "1.0 s"],
    [1050, "1.1 s"],
    [2345, "2.3 s"],
    [9949, "9.9 s"],
  ])(
    "%p ms reads as seconds with a tenth: %s",
    (ms: number, expected: string) => {
      expect(formatLlmDuration(ms)).toBe(expected);
    },
  );

  test.each([
    [9950, "10 s"],
    [10_000, "10 s"],
    [42_000, "42 s"],
    [59_499, "59 s"],
  ])("%p ms reads as whole seconds: %s", (ms: number, expected: string) => {
    expect(formatLlmDuration(ms)).toBe(expected);
  });

  test.each([
    [59_500, "1m 00s"],
    [60_000, "1m 00s"],
    [245_000, "4m 05s"],
    [3_599_499, "59m 59s"],
  ])(
    "%p ms reads as minutes and seconds: %s",
    (ms: number, expected: string) => {
      expect(formatLlmDuration(ms)).toBe(expected);
    },
  );

  test.each([
    [3_599_500, "1h 00m"],
    [3_720_000, "1h 02m"],
    // 1h 59m 30s rounds to two hours, not "1h 60m".
    [7_170_000, "2h 00m"],
    [90_000_000, "25h 00m"],
  ])("%p ms reads as hours and minutes: %s", (ms: number, expected: string) => {
    expect(formatLlmDuration(ms)).toBe(expected);
  });

  test("never writes a unit's upper bound in that unit", () => {
    for (const ms of nearBoundaries([1000, 10_000, 60_000, 3_600_000])) {
      const text: string = formatLlmDuration(ms);

      expect(text).not.toBe("1000 ms");
      expect(text).not.toBe("10.0 s");
      expect(text).not.toBe("60 s");
      expect(text).not.toMatch(/m 60s$/);
      expect(text).not.toMatch(/h 60m$/);
    }
  });
});

describe("formatLlmCost", () => {
  test.each([
    [0, "$0"],
    [-1, "$0"],
    [Number.NaN, "$0"],
    [Number.POSITIVE_INFINITY, "$0"],
  ])("%p reads as nothing spent: %s", (usd: number, expected: string) => {
    expect(formatLlmCost(usd)).toBe(expected);
  });

  test("a fraction of a hundredth of a cent is not rounded to zero", () => {
    expect(formatLlmCost(0.00005)).toBe("<$0.0001");
    expect(formatLlmCost(0.0000001)).toBe("<$0.0001");
  });

  test.each([
    [0.0001, "$0.0001"],
    [0.0012, "$0.0012"],
    [0.00994, "$0.0099"],
  ])(
    "a call's cost keeps four places: %p -> %s",
    (usd: number, expected: string) => {
      expect(formatLlmCost(usd)).toBe(expected);
    },
  );

  test.each([
    [0.00995, "$0.010"],
    [0.042, "$0.042"],
    [0.9994, "$0.999"],
  ])("cents keep three places: %p -> %s", (usd: number, expected: string) => {
    expect(formatLlmCost(usd)).toBe(expected);
  });

  test.each([
    [0.9995, "$1.00"],
    [0.99996, "$1.00"],
    [1, "$1.00"],
    [12.4, "$12.40"],
    [1204, "$1,204.00"],
    [1_234_567.891, "$1,234,567.89"],
  ])("dollars read like money: %p -> %s", (usd: number, expected: string) => {
    expect(formatLlmCost(usd)).toBe(expected);
  });
});

describe("formatLlmTokens", () => {
  test.each([
    [0, "0"],
    [-3, "0"],
    [Number.NaN, "0"],
    [850, "850"],
    [999.4, "999"],
    [999.6, "1k"],
    [1000, "1k"],
    [12_345, "12.3k"],
    [99_949, "99.9k"],
    [99_950, "100k"],
    [123_456, "123k"],
    [999_499, "999k"],
    [999_500, "1M"],
    [1_234_567, "1.2M"],
    [4_500_000, "4.5M"],
    [99_949_999, "99.9M"],
    [99_950_000, "100M"],
    [150_000_000, "150M"],
  ])("%p tokens -> %s", (count: number, expected: string) => {
    expect(formatLlmTokens(count)).toBe(expected);
  });

  test("never writes 1000 of a unit, or 100.0 of a tenth", () => {
    for (const count of nearBoundaries([
      1000, 100_000, 1_000_000, 100_000_000,
    ])) {
      expect(formatLlmTokens(count)).not.toMatch(/^1000[kM]?$/);
      expect(formatLlmTokens(count)).not.toMatch(/^100\.\d[kM]$/);
    }
  });
});

describe("formatLlmCount", () => {
  test("whole numbers with thousands separators", () => {
    expect(formatLlmCount(1204)).toBe("1,204");
    expect(formatLlmCount(1204.6)).toBe("1,205");
    expect(formatLlmCount(0)).toBe("0");
    expect(formatLlmCount(-3)).toBe("-3");
  });

  test("anything that is not a number reads as 0", () => {
    expect(formatLlmCount(Number.NaN)).toBe("0");
    expect(formatLlmCount(Number.POSITIVE_INFINITY)).toBe("0");
  });
});

describe("formatLlmShare", () => {
  test("no whole is 0%, not NaN% or Infinity%", () => {
    expect(formatLlmShare(1, 0)).toBe("0%");
    expect(formatLlmShare(0, 0)).toBe("0%");
    expect(formatLlmShare(Number.NaN, 10)).toBe("0%");
    expect(formatLlmShare(1, Number.NaN)).toBe("0%");
    expect(formatLlmShare(1, -4)).toBe("0%");
  });

  test("a tiny share is not shown as none", () => {
    expect(formatLlmShare(0, 10)).toBe("0%");
    expect(formatLlmShare(1, 2000)).toBe("<0.1%");
    expect(formatLlmShare(1, 1000)).toBe("0.1%");
  });

  test("one decimal under 10%, whole percents above", () => {
    expect(formatLlmShare(31, 1000)).toBe("3.1%");
    expect(formatLlmShare(99, 1000)).toBe("9.9%");
    expect(formatLlmShare(125, 1000)).toBe("13%");
    expect(formatLlmShare(999, 1000)).toBe("100%");
    expect(formatLlmShare(1, 1)).toBe("100%");
  });
});

describe("formatLlmClock", () => {
  test.each([
    [0, "0:00"],
    [7_999, "0:07"],
    [65_000, "1:05"],
    [3_599_000, "59:59"],
    [3_729_000, "1:02:09"],
    [-5, "0:00"],
    [Number.NaN, "0:00"],
  ])("%p ms on the replay clock reads %s", (ms: number, expected: string) => {
    expect(formatLlmClock(ms)).toBe(expected);
  });
});

describe("truncateLlmText", () => {
  test("text that fits is returned as it is", () => {
    expect(truncateLlmText("hello", 10)).toBe("hello");
    expect(truncateLlmText("hello", 5)).toBe("hello");
  });

  test("cut text ends in an ellipsis and fits the length", () => {
    const cut: string = truncateLlmText("hello world", 6);

    expect(cut).toBe("hello…");
    expect(Array.from(cut).length).toBeLessThanOrEqual(6);
  });

  test("spaces before the ellipsis are dropped", () => {
    expect(truncateLlmText("hello   world", 8)).toBe("hello…");
  });

  test("an emoji is never split in half", () => {
    expect(truncateLlmText("👍👍👍", 2)).toBe("👍…");
    expect(truncateLlmText("a😀b😀c😀", 4)).toBe("a😀b…");
  });

  test("nothing in, nothing out", () => {
    expect(truncateLlmText("", 5)).toBe("");
    expect(truncateLlmText(undefined as unknown as string, 5)).toBe("");
  });
});

describe("collapseLlmWhitespace", () => {
  test("runs of spaces, tabs and newlines read as one space", () => {
    expect(collapseLlmWhitespace("  a \n\t b  \r\n c ", 100)).toBe("a b c");
  });

  test("reads at most the limit", () => {
    expect(collapseLlmWhitespace("abcdef", 3)).toBe("abc");
    expect(collapseLlmWhitespace("a  b", 2)).toBe("a");
  });

  test("a megabytes-long tool result is not read past the limit", () => {
    const huge: string = "x ".repeat(2_500_000);
    const started: number = Date.now();

    expect(collapseLlmWhitespace(huge, 10)).toBe("x x x x x");
    // A loop over 10 characters, not a regular expression over 5 MB.
    expect(Date.now() - started).toBeLessThan(500);
  });

  test("nothing in, nothing out", () => {
    expect(collapseLlmWhitespace("", 10)).toBe("");
    expect(collapseLlmWhitespace(null as unknown as string, 10)).toBe("");
  });
});

describe("compactLlmArguments", () => {
  test("JSON is written on one line", () => {
    expect(compactLlmArguments('{ "city" : "Paris",\n "days": 3 }')).toBe(
      '{"city":"Paris","days":3}',
    );
  });

  test("anything else is returned trimmed, as it is", () => {
    expect(compactLlmArguments("  city=Paris  ")).toBe("city=Paris");
    expect(compactLlmArguments("{not json")).toBe("{not json");
  });

  test("nothing in, nothing out", () => {
    expect(compactLlmArguments("")).toBe("");
    expect(compactLlmArguments("   ")).toBe("");
  });

  test("a very long value is not parsed", () => {
    const long: string = `{"text":"${"a".repeat(25_000)}"}`;

    expect(compactLlmArguments(`  ${long}  `)).toBe(long);
  });
});

describe("prettyLlmJson", () => {
  test("JSON is pretty-printed for a code block", () => {
    expect(prettyLlmJson('{"a":1,"b":[true]}')).toBe(
      '{\n  "a": 1,\n  "b": [\n    true\n  ]\n}',
    );
  });

  test("anything else is returned trimmed, as it is", () => {
    expect(prettyLlmJson("  The weather is sunny.  ")).toBe(
      "The weather is sunny.",
    );
  });

  test("a value over 200 KB is not parsed", () => {
    const long: string = `{"text":"${"a".repeat(210_000)}"}`;

    expect(prettyLlmJson(long)).toBe(long);
  });
});
