import { describe, expect, test } from "@jest/globals";
import {
  compileScrubRuleCustomRegex,
  ScrubRegExp,
} from "../../../Types/Telemetry/ScrubRule";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * A CUSTOM REGEX RULE, IN EVERY READING OF A VALUE (#11031, #11033).
 *
 * A Custom Regex rule - a person's, or the one "Scrub it" makes from a data
 * type's patterns - finds its pattern in a value as written, with the
 * value's percent-escapes read, and with every script's digits read by
 * their values, as Data Security's detectors read it. Each match is hidden
 * on the characters it is written with, escapes and all; a value with no
 * escape and no digit beyond ASCII is read exactly as before.
 */

// A made-up token, put together where it is used: never written whole here.
const TOKEN: string = ["ghp", "Zx8Kq2Lm9Pw4Rt6Hy3Nc8Vb5Jm1Df7Gs0AeQ"].join("_");

// The custom pattern "Scrub it" makes for a GitHub token, in short.
const TOKEN_PATTERN: string =
  "(?<![A-Za-z0-9_])ghp_[A-Za-z0-9]{36}(?![A-Za-z0-9])";

// An IBAN's shape, as a custom pattern reads one: two letters, two check digits, its account.
const IBAN_PATTERN: string =
  "\\b[A-Z]{2}[0-9]{2}(?: ?[0-9]{4}){4} ?[0-9]{2}\\b";

function compiled(pattern: string): ScrubRegExp {
  const regex: ScrubRegExp | null = compileScrubRuleCustomRegex(pattern);

  expect(regex).not.toBeNull();

  return regex!;
}

function hidden(regex: ScrubRegExp, text: string): string {
  return regex.replace(text, (): string => {
    return "[REDACTED]";
  });
}

function matchedTexts(regex: ScrubRegExp, text: string): Array<string> {
  return regex.matchRanges(text).map(([start, end]: [number, number]) => {
    return text.slice(start, end);
  });
}

describe("a value with its percent-escapes read (#11031)", () => {
  test("a token after an encoded = is hidden, the rest of the URL kept", () => {
    const regex: ScrubRegExp = compiled(TOKEN_PATTERN);
    const text: string = `/login?next=https%3A%2F%2Fapp.example.com%2Fcb%3Ftoken%3D${TOKEN}&x=1`;

    expect(regex.test(text)).toBe(true);
    expect(matchedTexts(regex, text)).toEqual([TOKEN]);
    expect(hidden(regex, text)).toBe(
      "/login?next=https%3A%2F%2Fapp.example.com%2Fcb%3Ftoken%3D[REDACTED]&x=1",
    );
  });

  test("a match whose own characters are escaped is hidden whole, escapes and all", () => {
    const regex: ScrubRegExp = compiled(TOKEN_PATTERN);
    const escaped: string = TOKEN.replace(/_/g, "%5F");
    const twice: string = TOKEN.replace("_", "%255F");

    expect(matchedTexts(regex, `state=${escaped}`)).toEqual([escaped]);
    expect(hidden(regex, `state=${escaped}&y=2`)).toBe("state=[REDACTED]&y=2");
    expect(matchedTexts(regex, `state=${twice}`)).toEqual([twice]);
  });

  test("a match the text as written holds and one only its reading does are both hidden, each once", () => {
    const regex: ScrubRegExp = compiled(TOKEN_PATTERN);
    const text: string = `a=${TOKEN} b%3D${TOKEN} c=${TOKEN.replace(/_/g, "%5F")}`;

    expect(matchedTexts(regex, text)).toEqual([
      TOKEN,
      TOKEN,
      TOKEN.replace(/_/g, "%5F"),
    ]);
    expect(hidden(regex, text)).toBe(
      "a=[REDACTED] b%3D[REDACTED] c=[REDACTED]",
    );
  });

  test("a character escaped in UTF-8 is read as it is (#11032)", () => {
    const regex: ScrubRegExp = compiled("José");

    expect(matchedTexts(regex, "name=Jos%C3%A9&x=1")).toEqual(["Jos%C3%A9"]);
  });

  test("an escape alone, or one the pattern spells itself, is matched as written, as before", () => {
    const regex: ScrubRegExp = compiled("%40");

    expect(matchedTexts(regex, "a%40b")).toEqual(["%40"]);
    expect(hidden(compiled("token=[^&]+"), "token=abc%26def&x=1")).toBe(
      "[REDACTED]&x=1",
    );
  });
});

describe("a value with every script's digits read (#11033)", () => {
  test("an IBAN in Arabic-Indic, Persian or fullwidth digits is hidden as written", () => {
    const regex: ScrubRegExp = compiled(IBAN_PATTERN);

    for (const written of [
      "DE٨٩ ٣٧٠٤ ٠٠٤٤ ٠٥٣٢ ٠١٣٠ ٠٠",
      "DE۸۹۳۷۰۴۰۰۴۴۰۵۳۲۰۱۳۰۰۰",
      "DE８９ ３７０４ ００４４ ０５３２ ０１３０ ００",
    ]) {
      const text: string = `iban ${written} on file`;

      expect(matchedTexts(regex, text)).toEqual([written]);
      expect(hidden(regex, text)).toBe("iban [REDACTED] on file");
    }
  });

  test("a digit of another script beside a value is no part of it", () => {
    const regex: ScrubRegExp = compiled("\\b[0-9]{6}\\b");

    expect(matchedTexts(regex, "code ٣٤٥٦٧٨ ok")).toEqual(["٣٤٥٦٧٨"]);
    // Six digits of one script, and one of another after them: no six-digit value alone.
    expect(matchedTexts(regex, "code ٣٤٥٦٧٨۹ ok")).toEqual([]);
  });

  test("a digit escaped in UTF-8 is read by its value", () => {
    const regex: ScrubRegExp = compiled("\\b[0-9]{4}\\b");
    const text: string = `pin=${encodeURIComponent("４２４２")}&x=1`;

    expect(matchedTexts(regex, text)).toEqual([encodeURIComponent("４２４２")]);
  });
});

describe("a value with no other reading", () => {
  test("is read exactly as before: matches, replacements and tests", () => {
    const regex: ScrubRegExp = compiled("EMP-[0-9]{6}");
    const text: string = "employee EMP-004211 and EMP-918273 signed";

    expect(matchedTexts(regex, text)).toEqual(["EMP-004211", "EMP-918273"]);
    expect(
      regex.replace(text, (match: string): string => {
        return `<${match.length}>`;
      }),
    ).toBe("employee <10> and <10> signed");
    expect(regex.test(text)).toBe(true);
    expect(regex.test("nothing here")).toBe(false);
  });

  test("keeps its source and flags", () => {
    const regex: ScrubRegExp = compiled("EMP-[0-9]{6}");

    expect(regex.source).toBe("EMP-[0-9]{6}");
    expect(regex.flags).toBe("g");
  });

  test("a pattern that cannot run, or none at all, still compiles to nothing", () => {
    expect(compileScrubRuleCustomRegex("")).toBeNull();
    expect(compileScrubRuleCustomRegex("(a)\\1")).toBeNull();
    expect(compileScrubRuleCustomRegex(42)).toBeNull();
  });

  test("a match of no text in another reading hides nothing", () => {
    const regex: ScrubRegExp = compiled("x*");

    // As written, as before; with escapes read, no empty match is added.
    expect(
      regex.matchRanges("a%41").every(([start, end]: [number, number]) => {
        return end >= start;
      }),
    ).toBe(true);
    expect(
      regex
        .matchRanges("a%41b")
        .filter(([start, end]: [number, number]): boolean => {
          return end === start;
        }).length,
    ).toBe(0);
  });
});

describe("in time in line with the value's length", () => {
  const LIMIT_IN_MS: number = 2000;
  const LENGTH: number = 400_000;

  function repeat(unit: string): string {
    return unit.repeat(Math.ceil(LENGTH / unit.length)).slice(0, LENGTH);
  }

  test.each([
    ["escapes without end", repeat("%3D")],
    ["UTF-8 escapes without end", repeat("%C3%A9")],
    ["digits of another script without end", repeat("٣")],
    ["digits of many scripts without end", repeat("٣۴५৬੭૮୯௦")],
    ["escaped tokens without end", repeat(`%3D${TOKEN.replace(/_/g, "%5F")}`)],
  ])("reads %s", (_label: string, text: string) => {
    for (const pattern of [TOKEN_PATTERN, IBAN_PATTERN]) {
      const regex: ScrubRegExp = compiled(pattern);
      const timed: FastestRun<number> = fastestRun({
        run: (): number => {
          return regex.matchRanges(text).length;
        },
        limitInMs: LIMIT_IN_MS,
      });

      expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
    }
  });
});
