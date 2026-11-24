import MonitorEvaluationTime, {
  SLOW_EVALUATION_CEILING_IN_MS,
  SLOW_EVALUATION_FLOOR_IN_MS,
  SLOW_EVALUATION_SHARE_OF_INTERVAL,
} from "../../../Utils/Monitor/MonitorEvaluationTime";
import { Translator } from "../../../Types/Translator";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";
import { describe, expect, test } from "@jest/globals";

/*
 * HOW LONG AN EVALUATION TOOK, AND WHEN THAT IS TOO LONG (#10317).
 *
 * Each evaluation's summary says how long it took, and warns when it took
 * too long for its monitor: more than a tenth of the monitor's interval,
 * never under 5 seconds and always past a minute (MonitorEvaluationTime's
 * header says why). These tests pin the threshold at the intervals monitors
 * are checked at, the boundary on either side, and the time as a reader
 * reads it.
 */

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;

// What NO-BREAK SPACE a figure is held to its unit with.
const NB: string = String.fromCharCode(0x00a0);

describe("MonitorEvaluationTime.getSlowThresholdInMs", () => {
  test("the bounds are 5 seconds, a tenth and a minute", () => {
    expect(SLOW_EVALUATION_FLOOR_IN_MS).toBe(5 * SECOND);
    expect(SLOW_EVALUATION_SHARE_OF_INTERVAL).toBe(0.1);
    expect(SLOW_EVALUATION_CEILING_IN_MS).toBe(MINUTE);
  });

  test.each([
    // Checked every 30 seconds: a tenth is 3 s, so 5 s.
    [30 * SECOND, 5 * SECOND],
    // Every minute, the most common interval: a tenth.
    [MINUTE, 6 * SECOND],
    [2 * MINUTE, 12 * SECOND],
    [5 * MINUTE, 30 * SECOND],
    // Every 10 minutes and longer: a minute.
    [10 * MINUTE, MINUTE],
    [HOUR, MINUTE],
    [24 * HOUR, MINUTE],
  ])(
    "a monitor checked every %i ms is slow past %i ms",
    (intervalInMs: number, thresholdInMs: number) => {
      expect(MonitorEvaluationTime.getSlowThresholdInMs(intervalInMs)).toBe(
        thresholdInMs,
      );
    },
  );

  test.each([undefined, null, 0, -MINUTE, Number.NaN, Infinity])(
    "with no interval (%s), as an incoming request's, 5 seconds",
    (intervalInMs: number | null | undefined) => {
      expect(MonitorEvaluationTime.getSlowThresholdInMs(intervalInMs)).toBe(
        5 * SECOND,
      );
    },
  );
});

describe("MonitorEvaluationTime.isSlow", () => {
  test.each([
    // [took, interval, slow]
    [5 * SECOND, MINUTE, false],
    [6 * SECOND, MINUTE, false],
    [6 * SECOND + 1, MINUTE, true],
    [48 * SECOND, MINUTE, true],
    [5 * SECOND, undefined, false],
    [5 * SECOND + 1, undefined, true],
    [29 * SECOND, 5 * MINUTE, false],
    [31 * SECOND, 5 * MINUTE, true],
    [59 * SECOND, HOUR, false],
    [61 * SECOND, HOUR, true],
    [2_400, MINUTE, false],
  ])(
    "an evaluation of %i ms on a %s ms interval: slow is %s",
    (durationInMs: number, intervalInMs: number | undefined, slow: boolean) => {
      expect(
        MonitorEvaluationTime.isSlow({
          durationInMs: durationInMs,
          intervalInMs: intervalInMs,
        }),
      ).toBe(slow);
    },
  );

  test("a summary that does not say how long it took is never slow", () => {
    expect(MonitorEvaluationTime.isSlow(undefined)).toBe(false);
    expect(MonitorEvaluationTime.isSlow(null)).toBe(false);
    expect(MonitorEvaluationTime.isSlow({})).toBe(false);
    expect(MonitorEvaluationTime.isSlow({ intervalInMs: MINUTE })).toBe(false);
    expect(
      MonitorEvaluationTime.isSlow({
        durationInMs: Number.NaN,
        intervalInMs: MINUTE,
      }),
    ).toBe(false);
  });
});

describe("MonitorEvaluationTime.formatDuration", () => {
  const en: Translator = dashboardTranslator("en");

  test.each([
    [0, `0${NB}ms`],
    [12, `12${NB}ms`],
    [820.6, `821${NB}ms`],
    [1_000, `1${NB}s`],
    [2_400, `2.4${NB}s`],
    [2_449, `2.4${NB}s`],
    [59_900, `59.9${NB}s`],
    [MINUTE, `1${NB}min`],
    [90 * SECOND, `1.5${NB}min`],
    [5 * MINUTE, `5${NB}min`],
    [HOUR, `1${NB}h`],
    [36 * HOUR, `1.5${NB}d`],
  ])("%i ms reads %s in English", (durationInMs: number, text: string) => {
    expect(MonitorEvaluationTime.formatDuration(en, durationInMs)).toBe(text);
  });

  test("in the reader's language: their digits, decimal sign and unit, held to the figure", () => {
    const de: string = MonitorEvaluationTime.formatDuration(
      dashboardTranslator("de"),
      2_400,
    );
    const fa: string = MonitorEvaluationTime.formatDuration(
      dashboardTranslator("fa"),
      2_400,
    );

    expect(de).toMatch(/^2,4\u00A0\S/);
    expect(de).not.toContain(" ");
    // Persian digits and decimal sign, never "2.4 s".
    expect(fa).toContain("۲٫۴");
    expect(fa).not.toMatch(/[0-9]/);
  });

  test("a time that is no time reads as the missing value", () => {
    expect(MonitorEvaluationTime.formatDuration(en, Number.NaN)).toBe("-");
    expect(MonitorEvaluationTime.formatDuration(en, -1)).toBe("-");
  });
});
