import CronTab, { CronPreset } from "../../Utils/CronTab";
import cronParser from "cron-parser";

/**
 * These tests cross-check our dependency-free CronTab engine against
 * `cron-parser` (the library BullMQ actually uses to fire repeatable jobs), so
 * the picker's preview and validation stay faithful to real firing behavior.
 */

const FIXED_FROM: Date = new Date(Date.UTC(2026, 0, 1, 0, 0, 30));

function cronParserNextTimes(
  expression: string,
  count: number,
  from: Date,
): Array<number> {
  const interval: {
    next: () => { toDate: () => Date };
  } = cronParser.parseExpression(expression, {
    currentDate: from,
    tz: "UTC",
  }) as unknown as { next: () => { toDate: () => Date } };

  const times: Array<number> = [];
  for (let i: number = 0; i < count; i++) {
    times.push(interval.next().toDate().getTime());
  }
  return times;
}

describe("CronTab", () => {
  describe("isVariableExpression", () => {
    test("detects workflow variable references", () => {
      expect(CronTab.isVariableExpression("{{local.variables.schedule}}")).toBe(
        true,
      );
      expect(
        CronTab.isVariableExpression("* */{{local.variables.h}} * * *"),
      ).toBe(true);
    });

    test("returns false for plain cron expressions", () => {
      expect(CronTab.isVariableExpression("0 */18 * * *")).toBe(false);
      expect(CronTab.isVariableExpression("* * * * *")).toBe(false);
    });
  });

  describe("validation", () => {
    const validExpressions: Array<string> = [
      "* * * * *",
      "*/5 * * * *",
      "0 */18 * * *",
      "0 0 * * *",
      "30 9 * * 1-5",
      "0 0 1 */3 *",
      "0 0 1 1 *",
      "15,45 * * * *",
      "0 0 * * MON",
      "0 0 1 JAN *",
      "0 0 * * 7",
      "*/15 9-17 * * MON-FRI",
      "30 2 * * * ", // trailing space
      "0 0 * * SUN,SAT",
      "5/10 * * * *",
    ];

    test.each(validExpressions)(
      "accepts valid expression %s",
      (expr: string) => {
        expect(CronTab.getValidationError(expr)).toBeNull();
        expect(CronTab.isValid(expr)).toBe(true);
      },
    );

    const invalidExpressions: Array<string> = [
      "",
      "* * * *", // 4 fields
      "* * * * * * *", // 7 fields
      "60 * * * *", // minute out of range
      "* 24 * * *", // hour out of range
      "* * 32 * *", // dom out of range
      "* * * 13 *", // month out of range
      "* * * * 8", // dow out of range
      "*/0 * * * *", // step 0
      "abc * * * *", // not a number
      "5-1 * * * *", // reversed range
      "* * * * FUN", // bad day name
    ];

    test.each(invalidExpressions)(
      "rejects invalid expression %s",
      (expr: string) => {
        expect(CronTab.getValidationError(expr)).not.toBeNull();
        expect(CronTab.isValid(expr)).toBe(false);
      },
    );

    test("variable expressions are not flagged as validation errors", () => {
      expect(
        CronTab.getValidationError("{{local.variables.schedule}}"),
      ).toBeNull();
      // ...but they are not "valid" concrete crons either.
      expect(CronTab.isValid("{{local.variables.schedule}}")).toBe(false);
    });
  });

  describe("all presets are valid and describable", () => {
    test.each(
      CronTab.PRESETS.map((p: CronPreset) => {
        return p.value;
      }),
    )("preset %s", (value: string) => {
      expect(CronTab.isValid(value)).toBe(true);
      expect(CronTab.getHumanReadableDescription(value)).toBeTruthy();
      // cron-parser must also accept it (guards against BullMQ rejecting).
      expect(() => {
        return cronParser.parseExpression(value, { tz: "UTC" });
      }).not.toThrow();
    });
  });

  describe("next execution times match cron-parser", () => {
    const expressions: Array<string> = [
      "* * * * *",
      "*/5 * * * *",
      "*/30 * * * *",
      "0 * * * *",
      "0 */3 * * *",
      "0 */18 * * *",
      "0 0 * * *",
      "30 9 * * *",
      "0 0 * * 0",
      "0 0 * * 1-5",
      "0 0 1 * *",
      "0 0 1 */3 *",
      "0 0 29 2 *", // leap-day only — sparse, exercises month/day jumps
      "15,45 8-10 * * *",
      "0 12 1,15 * *",
    ];

    test.each(expressions)("next 8 runs for %s", (expr: string) => {
      const ours: Array<number> = CronTab.getNextExecutionTimes(
        expr,
        8,
        FIXED_FROM,
      ).map((d: Date) => {
        return d.getTime();
      });

      const theirs: Array<number> = cronParserNextTimes(expr, 8, FIXED_FROM);

      expect(ours).toEqual(theirs);
    });
  });

  describe("human-readable descriptions", () => {
    const cases: Array<[string, string]> = [
      ["* * * * *", "Every minute"],
      ["*/5 * * * *", "Every 5 minutes"],
      ["*/30 * * * *", "Every 30 minutes"],
      ["0 * * * *", "Every hour, on the hour"],
      ["0 */2 * * *", "Every 2 hours"],
      ["0 */18 * * *", "Every 18 hours"],
      ["0 0 * * *", "Every day at 00:00 (UTC)"],
      ["30 9 * * *", "Every day at 09:30 (UTC)"],
      ["0 9 * * 1", "Every week on Monday at 09:00 (UTC)"],
      ["0 0 * * 0", "Every week on Sunday at 00:00 (UTC)"],
      ["0 0 1 * *", "Every month on the 1st at 00:00 (UTC)"],
      ["0 0 1 */3 *", "Every 3 months on the 1st at 00:00 (UTC)"],
      ["0 0 1 1 *", "On the 1st of January at 00:00 (UTC)"],
    ];

    test.each(cases)("describes %s as %s", (expr: string, expected: string) => {
      expect(CronTab.getHumanReadableDescription(expr)).toBe(expected);
    });

    test("returns null for invalid expressions", () => {
      expect(CronTab.getHumanReadableDescription("nonsense")).toBeNull();
    });
  });

  describe("next execution times are in the future and ascending", () => {
    test("returns the requested count in strictly increasing order", () => {
      const times: Array<Date> = CronTab.getNextExecutionTimes(
        "*/15 * * * *",
        5,
        FIXED_FROM,
      );

      expect(times).toHaveLength(5);
      for (let i: number = 0; i < times.length; i++) {
        expect(times[i]!.getTime()).toBeGreaterThan(FIXED_FROM.getTime());
        if (i > 0) {
          expect(times[i]!.getTime()).toBeGreaterThan(times[i - 1]!.getTime());
        }
      }
    });
  });
});
