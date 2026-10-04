import LogScrubAction from "../../../Types/Log/LogScrubAction";
import LogScrubField from "../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import {
  checkScrubRuleCustomRegex,
  compileScrubRuleCustomRegex,
  doesScrubRuleScrubNothing,
  getRegexSyntaxErrorReason,
  LOG_SCRUB_FIELDS,
  LOG_SCRUB_PATTERN_TYPES,
  LOG_SCRUB_RULE_DEFAULTS,
  SCRUB_RULE_CUSTOM_PATTERN_TYPE,
  SCRUB_RULE_REGEX_FLAGS,
  SCRUB_RULE_SENSITIVE_KEYS_PATTERN_TYPE,
  ScrubRuleCustomRegexCheck,
  ScrubRuleCustomRegexProblem,
  TRACE_SCRUB_FIELDS,
  TRACE_SCRUB_PATTERN_TYPES,
  TRACE_SCRUB_RULE_DEFAULTS,
} from "../../../Types/Telemetry/ScrubRule";
import TraceScrubAction from "../../../Types/Trace/TraceScrubAction";
import TraceScrubField from "../../../Types/Trace/TraceScrubField";
import TraceScrubPatternType from "../../../Types/Trace/TraceScrubPatternType";
import { describe, expect, test } from "@jest/globals";

/*
 * The rules every scrub rule is judged by - the models' defaults, the
 * server's save-time check, ingest and the dashboard's form all take them
 * from Types/Telemetry/ScrubRule.
 *
 * The bug behind it: a Custom Regex rule saved with an empty pattern, or one
 * that does not compile, was skipped by ingest, so it looked active in the
 * rules table while the personal data it was made for was stored in the
 * clear.
 */

describe("what a new scrub rule starts with", () => {
  test("a log rule redacts, in the body and the attributes, from the start", () => {
    expect(LOG_SCRUB_RULE_DEFAULTS).toEqual({
      scrubAction: LogScrubAction.Redact,
      fieldsToScrub: LogScrubField.Both,
      isEnabled: true,
    });
  });

  test("a trace rule redacts, in every field of a span, from the start", () => {
    expect(TRACE_SCRUB_RULE_DEFAULTS).toEqual({
      scrubAction: TraceScrubAction.Redact,
      fieldsToScrub: TraceScrubField.All,
      isEnabled: true,
    });
  });

  test("spells the values ingest reads", () => {
    expect(LOG_SCRUB_RULE_DEFAULTS.scrubAction).toBe("redact");
    expect(LOG_SCRUB_RULE_DEFAULTS.fieldsToScrub).toBe("both");
    expect(TRACE_SCRUB_RULE_DEFAULTS.fieldsToScrub).toBe("all");
  });
});

describe("the pattern types and fields ingest knows", () => {
  test("are every value of the models' enums", () => {
    expect([...LOG_SCRUB_PATTERN_TYPES].sort()).toEqual(
      Object.values(LogScrubPatternType).sort(),
    );
    expect([...TRACE_SCRUB_PATTERN_TYPES].sort()).toEqual(
      Object.values(TraceScrubPatternType).sort(),
    );
    expect([...LOG_SCRUB_FIELDS].sort()).toEqual([
      "attributes",
      "body",
      "both",
    ]);
    expect([...TRACE_SCRUB_FIELDS].sort()).toEqual([
      "all",
      "attributes",
      "events",
      "name",
    ]);
  });

  test("name the custom and sensitive-keys types the way both enums spell them", () => {
    expect(SCRUB_RULE_CUSTOM_PATTERN_TYPE).toBe(LogScrubPatternType.Custom);
    expect(SCRUB_RULE_CUSTOM_PATTERN_TYPE).toBe(TraceScrubPatternType.Custom);
    expect(SCRUB_RULE_SENSITIVE_KEYS_PATTERN_TYPE).toBe(
      LogScrubPatternType.SensitiveKeys,
    );
    expect(SCRUB_RULE_SENSITIVE_KEYS_PATTERN_TYPE).toBe(
      TraceScrubPatternType.SensitiveKeys,
    );
  });
});

describe("compileScrubRuleCustomRegex - what ingest does with a stored pattern", () => {
  test("compiles a pattern with the global flag, case-sensitive", () => {
    const regex: RegExp | null = compileScrubRuleCustomRegex(
      "\\bSECRET-[A-Z0-9]+\\b",
    );

    expect(regex).not.toBeNull();
    expect(regex!.flags).toBe(SCRUB_RULE_REGEX_FLAGS);
    expect(SCRUB_RULE_REGEX_FLAGS).toBe("g");
    expect("a SECRET-AB12 and SECRET-CD34".replace(regex!, "[X]")).toBe(
      "a [X] and [X]",
    );
    // Case-sensitive: a lower-case token is not matched.
    expect("secret-ab12".replace(regex!, "[X]")).toBe("secret-ab12");
  });

  test("returns null for no pattern at all", () => {
    for (const missing of [undefined, null, "", 0, {}, []]) {
      expect(compileScrubRuleCustomRegex(missing)).toBeNull();
    }
  });

  test("returns null for a pattern that does not compile", () => {
    for (const invalid of ["(", "[a-", "a{2,1}", "*abc", "(?<name"]) {
      expect(compileScrubRuleCustomRegex(invalid)).toBeNull();
    }
  });

  /*
   * Engine-exact, not stricter: a stored pattern of spaces compiles and
   * scrubs runs of spaces, so a rule holding one is not one that "scrubs
   * nothing" - the server refuses to save it (checkScrubRuleCustomRegex).
   */
  test("compiles a pattern of only spaces, as ingest always has", () => {
    expect(compileScrubRuleCustomRegex("  ")).not.toBeNull();
  });

  test("hands out a new regex each time, so lastIndex is never shared", () => {
    const first: RegExp | null = compileScrubRuleCustomRegex("a");
    const second: RegExp | null = compileScrubRuleCustomRegex("a");

    expect(first).not.toBe(second);
  });
});

describe("checkScrubRuleCustomRegex - what may be saved", () => {
  function problemOf(customRegex: unknown): ScrubRuleCustomRegexProblem | null {
    const check: ScrubRuleCustomRegexCheck | null =
      checkScrubRuleCustomRegex(customRegex);

    return check ? check.problem : null;
  }

  test("accepts patterns ingest can scrub with", () => {
    for (const valid of [
      "\\bSECRET-[A-Z0-9]+\\b",
      "password=\\S+",
      "[0-9]{4}-[0-9]{4}",
      "token",
      "(?:api|access)[_-]?key=\\w+",
      ".+",
      "a|b",
    ]) {
      expect(checkScrubRuleCustomRegex(valid)).toBeNull();
    }
  });

  test("calls an empty pattern, or one of only spaces, missing", () => {
    for (const missing of [undefined, null, "", " ", "\t\n", 42]) {
      expect(problemOf(missing)).toBe(ScrubRuleCustomRegexProblem.Missing);
    }
  });

  test("calls a pattern that does not compile invalid, with the engine's reason", () => {
    const check: ScrubRuleCustomRegexCheck | null =
      checkScrubRuleCustomRegex("(unclosed");

    expect(check).not.toBeNull();
    expect(check!.problem).toBe(ScrubRuleCustomRegexProblem.Invalid);
    expect(check!.reason).toBeTruthy();
    // The reason, not the pattern repeated in front of it.
    expect(check!.reason).not.toContain("Invalid regular expression");
    expect(check!.reason).not.toContain("(unclosed");
  });

  test("calls every invalid pattern ingest skips invalid", () => {
    for (const invalid of ["(", "[a-", "a{2,1}", "*abc", "(?<name"]) {
      expect(problemOf(invalid)).toBe(ScrubRuleCustomRegexProblem.Invalid);
    }
  });

  test("calls a pattern that matches empty text a mistake", () => {
    for (const matchesEmpty of [
      "\\d*",
      "(secret)?",
      "a*",
      "^",
      "$",
      "(?:)",
      "x{0,3}",
      ".*",
    ]) {
      expect(problemOf(matchesEmpty)).toBe(
        ScrubRuleCustomRegexProblem.MatchesEmptyText,
      );
    }
  });

  /*
   * These match no text on their own, only a position inside a record - and
   * a global replace puts the replacement at every such position.
   */
  test("calls a pattern that matches a position inside text a mistake too", () => {
    for (const matchesPosition of [
      "\\b",
      "(?=@)",
      "(?<=:)\\s*",
      "x*(?=y)",
      "\\B",
      "(?<=\\d)",
    ]) {
      expect(problemOf(matchesPosition)).toBe(
        ScrubRuleCustomRegexProblem.MatchesEmptyText,
      );
    }

    // What one of them does to a record.
    expect("a@b: c xy".replace(new RegExp("\\b", "g"), "#")).toBe(
      "#a#@#b#: #c# #xy#",
    );
  });

  test("keeps a pattern that only uses a position to find text", () => {
    for (const pattern of [
      "(?<=password=)\\S+",
      "\\b\\d{3}-\\d{2}-\\d{4}\\b",
      "(?=SECRET)[A-Z-]+",
      "^Bearer \\S+$",
    ]) {
      expect(problemOf(pattern)).toBeNull();
    }
  });

  /*
   * Why it is refused: a global replace with a pattern that matches empty
   * text puts the replacement between every character.
   */
  test("refuses exactly what would garble every record", () => {
    const regex: RegExp = new RegExp("\\d*", SCRUB_RULE_REGEX_FLAGS);

    expect("abc".replace(regex, "#")).toBe("#a#b#c#");
  });

  test("never calls a pattern that compiles and matches text a mistake", () => {
    for (const pattern of ["\\d+", "x{1,3}", "[A-Z]{2}\\d{6}", "\\S+@\\S+"]) {
      expect(problemOf(pattern)).toBeNull();
    }
  });
});

describe("getRegexSyntaxErrorReason", () => {
  test("keeps the engine's reason without the pattern in front of it", () => {
    let error: unknown = null;
    // Built at run time, as ingest builds a stored pattern.
    const pattern: string = ["("].join("");

    try {
      new RegExp(pattern, "g");
    } catch (caught: unknown) {
      error = caught;
    }

    const reason: string = getRegexSyntaxErrorReason(error);

    expect(reason.length).toBeGreaterThan(0);
    expect(reason).not.toMatch(/^Invalid regular expression/);
  });

  test("strips a pattern that itself holds a colon and a slash", () => {
    expect(
      getRegexSyntaxErrorReason(
        new SyntaxError(
          "Invalid regular expression: /a: b/c(/g: Unterminated group",
        ),
      ),
    ).toBe("Unterminated group");
  });

  test("falls back to the whole message when it has another shape", () => {
    expect(getRegexSyntaxErrorReason(new Error("Something else"))).toBe(
      "Something else",
    );
    expect(getRegexSyntaxErrorReason("plain text")).toBe("plain text");
  });
});

describe("doesScrubRuleScrubNothing - the rules table's flag", () => {
  const known: ReadonlyArray<string> = LOG_SCRUB_PATTERN_TYPES;

  function scrubsNothing(rule: {
    patternType: unknown;
    customRegex?: unknown;
    fieldsToScrub?: unknown;
  }): boolean {
    return doesScrubRuleScrubNothing({
      patternType: rule.patternType,
      customRegex: rule.customRegex,
      fieldsToScrub: rule.fieldsToScrub,
      knownPatternTypes: known,
      knownFieldsToScrub: LOG_SCRUB_FIELDS,
    });
  }

  test("flags a custom rule with no pattern, or one that does not compile", () => {
    for (const customRegex of [undefined, null, "", "(", "[a-"]) {
      expect(
        scrubsNothing({ patternType: LogScrubPatternType.Custom, customRegex }),
      ).toBe(true);
    }
  });

  test("flags a pattern type ingest does not know", () => {
    for (const patternType of ["Email", "emails", "", undefined, null, 7]) {
      expect(scrubsNothing({ patternType })).toBe(true);
    }
  });

  /*
   * Ingest scrubs the body for "body" or "both" and the attributes for
   * "attributes" or "both": any other value scrubs neither.
   */
  test("flags fields to scrub ingest does not know", () => {
    for (const fieldsToScrub of ["Body", "all", "everything"]) {
      expect(
        scrubsNothing({
          patternType: LogScrubPatternType.Email,
          fieldsToScrub,
        }),
      ).toBe(true);
    }
  });

  test("does not flag fields to scrub left empty, which ingest reads as every field", () => {
    for (const fieldsToScrub of [undefined, null, ""]) {
      expect(
        scrubsNothing({
          patternType: LogScrubPatternType.Email,
          fieldsToScrub,
        }),
      ).toBe(false);
    }
  });

  test("does not flag a sensitive-keys rule's fields, which ingest ignores", () => {
    expect(
      scrubsNothing({
        patternType: LogScrubPatternType.SensitiveKeys,
        fieldsToScrub: "Body",
      }),
    ).toBe(false);
  });

  test("does not flag a working custom rule", () => {
    expect(
      scrubsNothing({
        patternType: LogScrubPatternType.Custom,
        customRegex: "SECRET-[0-9]+",
        fieldsToScrub: "both",
      }),
    ).toBe(false);
  });

  test("does not flag a built-in pattern type, whatever customRegex holds", () => {
    for (const patternType of Object.values(LogScrubPatternType)) {
      if (patternType === LogScrubPatternType.Custom) {
        continue;
      }

      expect(scrubsNothing({ patternType, customRegex: "" })).toBe(false);
    }
  });
});
