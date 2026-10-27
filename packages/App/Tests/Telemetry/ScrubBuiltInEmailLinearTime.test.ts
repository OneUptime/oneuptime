import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import TraceScrubPatternType from "Common/Types/Trace/TraceScrubPatternType";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "Common/Tests/Helpers/FastestRun";

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
) => ScrubRegExp | null;

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

describe.each(ENGINES)("$name built-in email scrub", (engine: Engine) => {
  test.each(WORST_CASES)(
    "reads %s in time in line with its length",
    (_label: string, body: string) => {
      const regex: ScrubRegExp | null = engine.getRegexForPattern(
        engine.emailType,
      );
      expect(regex).not.toBeNull();

      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          regex!.replace(body, (): string => {
            return "[REDACTED]";
          });
        },
        limitInMs: 2000,
      });
      expect(timed.inMs).toBeLessThan(2000);
    },
  );

  test("still finds and replaces a real address", () => {
    const regex: ScrubRegExp | null = engine.getRegexForPattern(
      engine.emailType,
    );
    const out: string = regex!.replace(
      "mail to carol.jones@example.co.uk now",
      (): string => {
        return "[REDACTED]";
      },
    );
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("carol.jones@example.co.uk");
  });
});

describe("LogScrubRuleService.scrubLog with the built-in email rule", () => {
  test("redacts an address in the body in time in line with its length", () => {
    const regex: ScrubRegExp | null = (
      LogScrubRuleService as unknown as {
        getRegexForPattern: GetRegexForPattern;
      }
    ).getRegexForPattern(LogScrubPatternType.Email);

    const compiledRules: Array<{ rule: unknown; regex: ScrubRegExp }> = [
      {
        rule: {
          patternType: LogScrubPatternType.Email,
          scrubAction: "redact",
          fieldsToScrub: "body",
        },
        regex: regex!,
      },
    ];

    const timed: FastestRun<{ body?: unknown }> = fastestRun({
      run: (): { body?: unknown } => {
        return LogScrubRuleService.scrubLog(
          { body: "a@" + repeat("a.", LENGTH) } as never,
          compiledRules as never,
        ) as { body?: unknown };
      },
      limitInMs: 2000,
    });
    const scrubbed: { body?: unknown } = timed.result;
    expect(timed.inMs).toBeLessThan(2000);
    expect(typeof scrubbed.body).toBe("string");

    const realScrubbed: { body?: unknown } = LogScrubRuleService.scrubLog(
      { body: "contact dan@example.com please" } as never,
      compiledRules as never,
    ) as { body?: unknown };
    expect(realScrubbed.body).toBe("contact [REDACTED] please");
  });
});
