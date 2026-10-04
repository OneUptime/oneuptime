import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import { JSONObject } from "Common/Types/JSON";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import {
  checkScrubRuleCustomRegex,
  compileScrubRuleCustomRegex,
  doesScrubRuleScrubNothing,
  LOG_SCRUB_PATTERN_TYPES,
  LOG_SCRUB_RULE_DEFAULTS,
  TRACE_SCRUB_PATTERN_TYPES,
} from "Common/Types/Telemetry/ScrubRule";
import TraceScrubPatternType from "Common/Types/Trace/TraceScrubPatternType";
import { describe, expect, test } from "@jest/globals";

/*
 * Ingest and the save-time check judge a custom pattern alike.
 *
 * A Custom Regex scrub rule with an empty pattern, or one that does not
 * compile, was saved, skipped by ingest - getRegexForPattern returns null -
 * and shown as active in the rules table while it scrubbed nothing. The API
 * now refuses such a rule (Common/Server/Utils/ScrubRuleValidation) and the
 * rules table flags the ones saved before (doesScrubRuleScrubNothing). Both
 * are only true if they read a pattern exactly as ingest compiles it, so
 * this drives the engines' real getRegexForPattern over the same patterns.
 */

type GetRegexForPattern = (
  patternType: string,
  customRegex?: string,
) => RegExp | null;

interface Engine {
  name: string;
  getRegexForPattern: GetRegexForPattern;
  patternTypes: ReadonlyArray<string>;
}

const ENGINES: Array<Engine> = [
  {
    name: "LogScrubRuleService",
    getRegexForPattern: (
      LogScrubRuleService as unknown as {
        getRegexForPattern: GetRegexForPattern;
      }
    ).getRegexForPattern.bind(LogScrubRuleService),
    patternTypes: LOG_SCRUB_PATTERN_TYPES,
  },
  {
    name: "TraceScrubRuleService",
    getRegexForPattern: (
      TraceScrubRuleService as unknown as {
        getRegexForPattern: GetRegexForPattern;
      }
    ).getRegexForPattern.bind(TraceScrubRuleService),
    patternTypes: TRACE_SCRUB_PATTERN_TYPES,
  },
];

const PATTERNS: Array<string> = [
  "",
  " ",
  "(",
  "[a-",
  "a{2,1}",
  "*abc",
  "\\bSECRET-[A-Z0-9]+\\b",
  "password=\\S+",
  "\\d*",
  "token",
  "(?:api|access)[_-]?key=\\w+",
];

describe.each(ENGINES)(
  "$name",
  ({ getRegexForPattern, patternTypes }: Engine) => {
    test("compiles a custom pattern exactly when the shared helper does", () => {
      for (const pattern of PATTERNS) {
        const engine: RegExp | null = getRegexForPattern("custom", pattern);
        const shared: RegExp | null = compileScrubRuleCustomRegex(pattern);

        expect(engine === null).toBe(shared === null);

        if (engine && shared) {
          expect(engine.source).toBe(shared.source);
          expect(engine.flags).toBe(shared.flags);
        }
      }
    });

    test("scrubs with every pattern the save-time check accepts", () => {
      for (const pattern of PATTERNS) {
        if (checkScrubRuleCustomRegex(pattern) !== null) {
          continue;
        }

        expect(getRegexForPattern("custom", pattern)).not.toBeNull();
      }
    });

    test("skips every stored rule the rules table flags as scrubbing nothing", () => {
      for (const patternType of [...patternTypes, "Email", "unknown"]) {
        for (const pattern of [undefined, ...PATTERNS]) {
          const flagged: boolean = doesScrubRuleScrubNothing({
            patternType,
            customRegex: pattern,
            knownPatternTypes: patternTypes,
          });

          expect(getRegexForPattern(patternType, pattern) === null).toBe(
            flagged,
          );
        }
      }
    });

    test("still skips a custom rule with no pattern, as it always has", () => {
      expect(getRegexForPattern("custom", undefined)).toBeNull();
      expect(getRegexForPattern("custom", "")).toBeNull();
      expect(getRegexForPattern("custom", "(")).toBeNull();
    });
  },
);

describe("a custom rule ingest scrubs with", () => {
  test("redacts every match in a log body, the default action", () => {
    const rule: LogScrubRule = new LogScrubRule();
    rule.patternType = LogScrubPatternType.Custom;
    rule.customRegex = "\\bSECRET-[A-Z0-9]+\\b";
    rule.scrubAction = LOG_SCRUB_RULE_DEFAULTS.scrubAction;
    rule.fieldsToScrub = LOG_SCRUB_RULE_DEFAULTS.fieldsToScrub;

    const regex: RegExp | null = (
      LogScrubRuleService as unknown as {
        getRegexForPattern: GetRegexForPattern;
      }
    ).getRegexForPattern("custom", rule.customRegex);

    expect(regex).not.toBeNull();
    expect(LOG_SCRUB_RULE_DEFAULTS.scrubAction).toBe(LogScrubAction.Redact);

    const row: JSONObject = LogScrubRuleService.scrubLog(
      {
        body: "token SECRET-AB12 and SECRET-CD34",
        attributes: { note: "SECRET-EF56" },
      },
      [{ rule, regex: regex as RegExp }],
    );

    expect(row["body"]).toBe("token [REDACTED] and [REDACTED]");
    expect((row["attributes"] as JSONObject)["note"]).toBe("[REDACTED]");
  });

  test("the trace engine reads the same pattern types", () => {
    expect([...TRACE_SCRUB_PATTERN_TYPES].sort()).toEqual(
      Object.values(TraceScrubPatternType).sort(),
    );
  });
});
