import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import TraceScrubPatternType from "Common/Types/Trace/TraceScrubPatternType";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * THE BUILT-IN EMAIL SCRUB READS AN INGESTED BODY IN TIME IN LINE WITH ITS
 * LENGTH.
 *
 * The Email built-in runs over every log body and span body/attribute of a
 * project that turns it on, at ingest, over text the project's own
 * application writes. Its parts are now length-bounded to the sizes a real
 * address has, so a long body - even one built to be awkward - is read once,
 * while a real address is still found and replaced.
 *
 * getRegexForPattern is the private factory both ingest and the save-time
 * check share; it is reached here the same way ScrubRuleCustomPatternEngine
 * reaches it, so the regex under test is exactly the one ingest compiles.
 * ---------------------------------------------------------------------------
 */

type GetRegexForPattern = (
  patternType: string,
  customRegex?: string,
) => RegExp | null;

const LENGTH: number = 400000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

const WORST_CASES: Array<[string, string]> = [
  ["letters and dots", repeat("a.", LENGTH)],
  ["an address then dotted labels", "a@" + repeat("a.", LENGTH)],
  ["an at then dotted labels", repeat("a@a.", LENGTH)],
  ["dots and a tail", repeat(".", LENGTH) + "-.aa"],
];

interface Engine {
  name: string;
  getRegexForPattern: GetRegexForPattern;
  emailType: string;
}

const ENGINES: Array<Engine> = [
  {
    name: "LogScrubRuleService",
    getRegexForPattern: (
      LogScrubRuleService as unknown as {
        getRegexForPattern: GetRegexForPattern;
      }
    ).getRegexForPattern.bind(LogScrubRuleService),
    emailType: LogScrubPatternType.Email,
  },
  {
    name: "TraceScrubRuleService",
    getRegexForPattern: (
      TraceScrubRuleService as unknown as {
        getRegexForPattern: GetRegexForPattern;
      }
    ).getRegexForPattern.bind(TraceScrubRuleService),
    emailType: TraceScrubPatternType.Email,
  },
];

describe.each(ENGINES)(
  "$name built-in email scrub",
  (engine: Engine) => {
    test.each(WORST_CASES)(
      "reads %s in time in line with its length",
      (_label: string, body: string) => {
        const regex: RegExp | null = engine.getRegexForPattern(
          engine.emailType,
        );
        expect(regex).not.toBeNull();

        const startedAt: number = Date.now();
        body.replace(regex!, "[REDACTED]");
        expect(Date.now() - startedAt).toBeLessThan(2000);
      },
    );

    test("still finds and replaces a real address", () => {
      const regex: RegExp | null = engine.getRegexForPattern(engine.emailType);
      const out: string = "mail to carol.jones@example.co.uk now".replace(
        regex!,
        "[REDACTED]",
      );
      expect(out).toContain("[REDACTED]");
      expect(out).not.toContain("carol.jones@example.co.uk");
    });
  },
);

describe("LogScrubRuleService.scrubLog with the built-in email rule", () => {
  test("redacts an address in the body in time in line with its length", () => {
    const regex: RegExp | null = (
      LogScrubRuleService as unknown as {
        getRegexForPattern: GetRegexForPattern;
      }
    ).getRegexForPattern(LogScrubPatternType.Email);

    const compiledRules: Array<{ rule: unknown; regex: RegExp }> = [
      {
        rule: {
          patternType: LogScrubPatternType.Email,
          scrubAction: "redact",
          fieldsToScrub: "body",
        },
        regex: regex!,
      },
    ];

    const startedAt: number = Date.now();
    const scrubbed: { body?: unknown } = LogScrubRuleService.scrubLog(
      { body: "a@" + repeat("a.", LENGTH) } as never,
      compiledRules as never,
    ) as { body?: unknown };
    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(typeof scrubbed.body).toBe("string");

    const realScrubbed: { body?: unknown } = LogScrubRuleService.scrubLog(
      { body: "contact dan@example.com please" } as never,
      compiledRules as never,
    ) as { body?: unknown };
    expect(realScrubbed.body).toBe("contact [REDACTED] please");
  });
});
