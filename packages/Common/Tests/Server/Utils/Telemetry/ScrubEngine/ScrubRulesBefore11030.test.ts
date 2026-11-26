import { describe, expect, test } from "@jest/globals";
import {
  CompiledScrubRule,
  compileScrubRule,
  ScrubEngineRule,
  withOwnPhoneAndSsnPatterns,
} from "../../../../../Server/Utils/Telemetry/ScrubEngine/CompiledScrubRule";
import LogScrubEngine from "../../../../../Server/Utils/Telemetry/ScrubEngine/LogScrubEngine";
import { JSONObject } from "../../../../../Types/JSON";
import LogScrubAction from "../../../../../Types/Log/LogScrubAction";
import LogScrubField from "../../../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../../../Types/Log/LogScrubPatternType";
import {
  SCRUB_RULE_BUILT_IN_PATTERNS,
  scrubRegExpFromBuiltIn,
} from "../../../../../Types/Telemetry/ScrubRule";

/*
 * THE RULES AS THEY READ BEFORE #11030.
 *
 * Since #11030 a Phone Number or SSN rule hides what Data Security finds
 * beside its own pattern's matches. An exception found in a log before
 * #10434 is found by what the rules left of it then, so the logs ingest
 * reads it as they left it then too: each Phone Number or SSN rule with its
 * own pattern alone, every other rule as it is.
 */

function compiled(
  patternType: string,
  extra: Partial<ScrubEngineRule> = {},
): CompiledScrubRule {
  return compileScrubRule({
    name: patternType,
    projectId: "10000000-0000-4000-8000-000000011030",
    patternType,
    scrubAction: LogScrubAction.Redact,
    fieldsToScrub: LogScrubField.Both,
    ...extra,
  })!;
}

function scrub(text: string, rules: Array<CompiledScrubRule>): string {
  return LogScrubEngine.scrubLog({ body: text, attributes: {} }, rules, null, {
    countValues: false,
  })["body"] as string;
}

const TEXT: string =
  "SMS to +44 161 321 4567 for ssn 536.22.8731 and 555-123-4567, ada@example.com";

describe("withOwnPhoneAndSsnPatterns", () => {
  test("is null when no rule is a Phone Number or SSN rule: the rules read as they did", () => {
    expect(withOwnPhoneAndSsnPatterns([])).toBeNull();
    expect(
      withOwnPhoneAndSsnPatterns([
        compiled(LogScrubPatternType.Email),
        compiled(LogScrubPatternType.CreditCard),
        compiled(LogScrubPatternType.IPAddress),
        compiled(LogScrubPatternType.Custom, { customRegex: "secret-[0-9]+" }),
        compiled(LogScrubPatternType.SensitiveKeys),
      ]),
    ).toBeNull();
  });

  test("gives a Phone Number and an SSN rule their own pattern alone, and keeps every other rule as it is", () => {
    const email: CompiledScrubRule = compiled(LogScrubPatternType.Email);
    const phone: CompiledScrubRule = compiled(LogScrubPatternType.PhoneNumber);
    const ssn: CompiledScrubRule = compiled(LogScrubPatternType.SSN);
    const earlier: Array<CompiledScrubRule> = withOwnPhoneAndSsnPatterns([
      email,
      phone,
      ssn,
    ])!;

    expect(earlier).toHaveLength(3);
    expect(earlier[0]).toBe(email);
    expect(earlier[1]!.rule).toBe(phone.rule);
    expect(earlier[2]!.rule).toBe(ssn.rule);

    for (const [index, patternType] of [
      [1, LogScrubPatternType.PhoneNumber],
      [2, LogScrubPatternType.SSN],
    ] as Array<[number, string]>) {
      const own: Array<[number, number]> = scrubRegExpFromBuiltIn(
        SCRUB_RULE_BUILT_IN_PATTERNS[patternType]!,
      ).matchRanges(TEXT);

      expect(earlier[index]!.regex.matchRanges(TEXT)).toEqual(own);
    }
  });

  test("leaves what the rules left before #11030, where they now hide more", () => {
    const rules: Array<CompiledScrubRule> = [
      compiled(LogScrubPatternType.Email),
      compiled(LogScrubPatternType.PhoneNumber),
      compiled(LogScrubPatternType.SSN),
    ];

    expect(scrub(TEXT, rules)).toBe(
      "SMS to [REDACTED] for ssn [REDACTED] and [REDACTED], [REDACTED]",
    );
    expect(scrub(TEXT, withOwnPhoneAndSsnPatterns(rules)!)).toBe(
      "SMS to +44 [REDACTED] for ssn 536.22.8731 and [REDACTED], [REDACTED]",
    );
  });

  test("keeps the attributes a rule names, and its action", () => {
    const phone: CompiledScrubRule = compiled(LogScrubPatternType.PhoneNumber, {
      scrubAction: LogScrubAction.Mask,
      attributeKeys: ["sms.to"],
    });
    const earlier: CompiledScrubRule = withOwnPhoneAndSsnPatterns([phone])![0]!;

    expect(earlier.keys).toBe(phone.keys);
    expect(earlier.rule.scrubAction).toBe(LogScrubAction.Mask);

    const row: JSONObject = LogScrubEngine.scrubLog(
      {
        body: "+44 161 321 4567",
        attributes: { "sms.to": "+44 161 321 4567", other: "+44 161 321 4567" },
      },
      [earlier],
      null,
      { countValues: false },
    );

    expect(row["attributes"]).toEqual({
      "sms.to": "+44 ***-***-4567",
      other: "+44 161 321 4567",
    });
  });

  test("changes none of the rules it is handed", () => {
    const phone: CompiledScrubRule = compiled(LogScrubPatternType.PhoneNumber);
    const regex: unknown = phone.regex;

    withOwnPhoneAndSsnPatterns([phone]);

    expect(phone.regex).toBe(regex);
    expect(scrub(TEXT, [phone])).toContain("SMS to [REDACTED] for");
  });
});
