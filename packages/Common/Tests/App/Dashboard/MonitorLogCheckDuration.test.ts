import { describe, expect, test } from "@jest/globals";
import {
  getEvaluationSummaryOfLogBody,
  getMonitorLogCheckDuration,
  getMonitorLogCheckDurationText,
  MonitorLogCheckDuration,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/MonitorLogCheckDuration";
import {
  getIntervalInMs,
  getSeriesJudged,
  getSlowEvaluationWords,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SlowEvaluationWords";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import { Translator } from "../../../Types/Translator";
import MonitorEvaluationTime, {
  SLOW_EVALUATION_CEILING_IN_MS,
  SLOW_EVALUATION_FLOOR_IN_MS,
} from "../../../Utils/Monitor/MonitorEvaluationTime";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * EACH CHECK'S TIME IN MONITORING LOGS, AND THE SLOW ONES MARKED (#10842).
 *
 * The Check Duration column reads each row's evaluation summary from its
 * logBody (MonitorLogCheckDuration): how long the check took, whether that
 * was too long for its monitor by the rule its summary warns by
 * (MonitorEvaluationTime.isSlow), and, for a slow one, the summary's words
 * for why (SlowEvaluationWords). An entry logged before its time was kept -
 * before #10809, or before evaluation summaries at all - says nothing.
 */

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;

const en: Translator = dashboardTranslator("en");

const WHY_FOR_AN_INTERVAL: string =
  "That is a lot for a monitor checked every {{interval}}: if its evaluations keep growing, its checks will fall behind.";
const WHY_WITHOUT_AN_INTERVAL: string =
  "That is a lot for one evaluation: if its evaluations keep growing, each will hold up the next.";
// A sentence Chinese or Japanese ends, which runs on into the next with no space.
const ENDS_WITH_A_FULL_WIDTH_STOP: RegExp = /[。！？]$/u;

const HOW_TO_SPEED_UP: string =
  "It judged {{count}} series. To make it faster, narrow its filters or group by fewer attributes.";

function summary(
  overrides: Partial<MonitorEvaluationSummary> = {},
): MonitorEvaluationSummary {
  return {
    evaluatedAt: new Date("2026-11-24T09:00:00.000Z"),
    criteriaResults: [],
    events: [],
    ...overrides,
  };
}

// A monitor log entry's logBody, as MonitorLogUtil stores it: JSON.
function logBody(evaluationSummary?: unknown): unknown {
  return JSON.parse(
    JSON.stringify({
      monitorId: "10842000-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ...(evaluationSummary === undefined ? {} : { evaluationSummary }),
    }),
  );
}

function checkOf(
  overrides: Partial<MonitorEvaluationSummary>,
  translator: Translator = en,
): MonitorLogCheckDuration | null {
  return getMonitorLogCheckDuration(translator, logBody(summary(overrides)));
}

describe("a check's time, read from its log entry", () => {
  test("a check in time for its monitor reads its time, unmarked", () => {
    expect(checkOf({ durationInMs: 2_400, intervalInMs: MINUTE })).toEqual({
      duration: "2.4\u00A0s",
      isSlow: false,
    });
  });

  test("a time under a second reads in milliseconds, and 0 ms is a time", () => {
    expect(checkOf({ durationInMs: 820, intervalInMs: MINUTE })).toEqual({
      duration: "820\u00A0ms",
      isSlow: false,
    });
    expect(checkOf({ durationInMs: 0, intervalInMs: MINUTE })).toEqual({
      duration: "0\u00A0ms",
      isSlow: false,
    });
  });

  test("a slow check is marked, and says why as its summary does", () => {
    expect(
      checkOf({ durationInMs: 25 * SECOND, intervalInMs: MINUTE }),
    ).toEqual({
      duration: "25\u00A0s",
      isSlow: true,
      slowReason:
        "That is a lot for a monitor checked every 1\u00A0min: if its evaluations keep growing, its checks will fall behind.",
    });
  });

  test("a slow grouped check also says how many series it judged, and what makes it faster", () => {
    expect(
      checkOf({
        durationInMs: 48 * SECOND,
        intervalInMs: MINUTE,
        seriesJudged: 16_250,
      })?.slowReason,
    ).toBe(
      "That is a lot for a monitor checked every 1\u00A0min: if its evaluations keep growing, its checks will fall behind. It judged 16,250 series. To make it faster, narrow its filters or group by fewer attributes.",
    );
  });

  test("a slow check with no interval - an incoming request's - says each holds up the next", () => {
    expect(checkOf({ durationInMs: 6 * SECOND })).toEqual({
      duration: "6\u00A0s",
      isSlow: true,
      slowReason:
        "That is a lot for one evaluation: if its evaluations keep growing, each will hold up the next.",
    });
  });

  test("a check in time says nothing of why, though it judged series", () => {
    expect(
      checkOf({
        durationInMs: 2_400,
        intervalInMs: MINUTE,
        seriesJudged: 16_250,
      }),
    ).toEqual({ duration: "2.4\u00A0s", isSlow: false });
  });
});

describe("slow, by the rule the summary warns by", () => {
  /*
   * A tenth of the interval, never under 5 seconds, never over a minute.
   * At the threshold a check is in time; a millisecond over, it is slow.
   */
  test.each([
    ["no interval", undefined, SLOW_EVALUATION_FLOOR_IN_MS],
    ["checked every 30 seconds", 30 * SECOND, SLOW_EVALUATION_FLOOR_IN_MS],
    ["checked every minute", MINUTE, 6 * SECOND],
    ["checked every 5 minutes", 5 * MINUTE, 30 * SECOND],
    ["checked every hour", HOUR, SLOW_EVALUATION_CEILING_IN_MS],
    ["checked every day", 24 * HOUR, SLOW_EVALUATION_CEILING_IN_MS],
  ])(
    "%s: in time at the threshold, slow a millisecond past it",
    (_label: string, intervalInMs: number | undefined, threshold: number) => {
      expect(MonitorEvaluationTime.getSlowThresholdInMs(intervalInMs)).toBe(
        threshold,
      );
      expect(checkOf({ durationInMs: threshold, intervalInMs })?.isSlow).toBe(
        false,
      );
      expect(
        checkOf({ durationInMs: threshold + 1, intervalInMs })?.isSlow,
      ).toBe(true);
    },
  );

  test("the same check is slow every minute and in time every five", () => {
    expect(
      checkOf({ durationInMs: 25 * SECOND, intervalInMs: MINUTE })?.isSlow,
    ).toBe(true);
    expect(
      checkOf({ durationInMs: 25 * SECOND, intervalInMs: 5 * MINUTE })?.isSlow,
    ).toBe(false);
  });

  test("the column and the summary agree on every check", () => {
    for (const durationInMs of [0, 999, 4_999, 5_001, 6_001, 59_999, 61_000]) {
      for (const intervalInMs of [undefined, 10_000, MINUTE, 10 * MINUTE]) {
        expect({
          durationInMs,
          intervalInMs,
          isSlow: checkOf({ durationInMs, intervalInMs })?.isSlow,
        }).toEqual({
          durationInMs,
          intervalInMs,
          isSlow: MonitorEvaluationTime.isSlow({ durationInMs, intervalInMs }),
        });
      }
    }
  });
});

describe("an entry that does not say how long its check took", () => {
  test("one logged before #10809, whose summary has no time, says nothing", () => {
    expect(checkOf({})).toBeNull();
    expect(checkOf({ intervalInMs: MINUTE, seriesJudged: 3 })).toBeNull();
  });

  test("one logged before evaluation summaries says nothing", () => {
    expect(getMonitorLogCheckDuration(en, logBody())).toBeNull();
    expect(getEvaluationSummaryOfLogBody(logBody())).toBeUndefined();
  });

  test("a time that cannot be read says nothing, rather than a wrong time", () => {
    for (const durationInMs of [-1, Number.NaN, Infinity, "2400", null]) {
      expect({
        durationInMs,
        check: getMonitorLogCheckDuration(
          en,
          logBody(summary({ durationInMs: durationInMs as never })),
        ),
      }).toEqual({ durationInMs, check: null });
    }
  });

  test("a logBody that is not an object says nothing", () => {
    for (const body of [null, undefined, "", "text", 42, []]) {
      expect(getMonitorLogCheckDuration(en, body)).toBeNull();
    }

    expect(
      getMonitorLogCheckDuration(en, { evaluationSummary: "not a summary" }),
    ).toBeNull();
  });
});

describe("what the cell says, and what the CSV writes", () => {
  test("a slow check: its time, marked slow", () => {
    expect(
      getMonitorLogCheckDurationText(
        en,
        checkOf({ durationInMs: 25 * SECOND, intervalInMs: MINUTE })!,
      ),
    ).toBe("25\u00A0s (slow)");
  });

  test("a check in time: its time alone", () => {
    expect(
      getMonitorLogCheckDurationText(
        en,
        checkOf({ durationInMs: 2_400, intervalInMs: MINUTE })!,
      ),
    ).toBe("2.4\u00A0s");
  });
});

describe("the summary's words, shared", () => {
  test("an interval and a series count are read only when they mean something", () => {
    expect(getIntervalInMs({ intervalInMs: MINUTE })).toBe(MINUTE);
    expect(getIntervalInMs({ intervalInMs: 0 })).toBeUndefined();
    expect(getIntervalInMs({ intervalInMs: -5 })).toBeUndefined();
    expect(getIntervalInMs({})).toBeUndefined();

    expect(getSeriesJudged({ seriesJudged: 0 })).toBe(0);
    expect(getSeriesJudged({ seriesJudged: 16_250 })).toBe(16_250);
    expect(getSeriesJudged({ seriesJudged: -1 })).toBeUndefined();
    expect(getSeriesJudged({})).toBeUndefined();
  });

  test("what makes it faster is said only of a check split into series", () => {
    expect(getSlowEvaluationWords(en, { intervalInMs: MINUTE })).toEqual({
      why: "That is a lot for a monitor checked every 1\u00A0min: if its evaluations keep growing, its checks will fall behind.",
      howToSpeedUp: undefined,
    });
    expect(getSlowEvaluationWords(en, { seriesJudged: 1 }).howToSpeedUp).toBe(
      "It judged 1 series. To make it faster, narrow its filters or group by fewer attributes.",
    );
  });
});

describe.each([...DASHBOARD_LANGUAGES])("in %s", (language: string) => {
  const translator: Translator = dashboardTranslator(language);

  test("a slow check reads its time and its mark in the language's words", () => {
    const check: MonitorLogCheckDuration = checkOf(
      { durationInMs: 25 * SECOND, intervalInMs: MINUTE },
      translator,
    )!;
    const duration: string = MonitorEvaluationTime.formatDuration(
      translator,
      25 * SECOND,
    );

    expect(check.duration).toBe(duration);
    expect(getMonitorLogCheckDurationText(translator, check)).toBe(
      translator.translateTemplate("{{duration}} (slow)", { duration }),
    );
    expect(getMonitorLogCheckDurationText(translator, check)).not.toContain(
      "(slow)",
    );
  });

  test("why it is slow reads as the summary says it, and never in English", () => {
    const check: MonitorLogCheckDuration = checkOf(
      { durationInMs: 48 * SECOND, intervalInMs: MINUTE, seriesJudged: 7 },
      translator,
    )!;
    const why: string = translator.translateTemplate(WHY_FOR_AN_INTERVAL, {
      interval: MonitorEvaluationTime.formatDuration(translator, MINUTE),
    });
    const howToSpeedUp: string = translator.translatePlural(
      { one: HOW_TO_SPEED_UP, other: HOW_TO_SPEED_UP },
      7,
    );

    expect(check.slowReason).toContain(why);
    expect(check.slowReason).toContain(howToSpeedUp);
    expect(check.slowReason).not.toContain("That is a lot");
    expect(check.slowReason).not.toContain("To make it faster");

    // Chinese and Japanese run sentences together; the others set them apart with a space.
    expect(check.slowReason).toBe(
      ENDS_WITH_A_FULL_WIDTH_STOP.test(why)
        ? `${why}${howToSpeedUp}`
        : `${why} ${howToSpeedUp}`,
    );
  });

  test("a slow check with no interval reads the language's words for it", () => {
    expect(checkOf({ durationInMs: 6 * SECOND }, translator)?.slowReason).toBe(
      translator.translateText(WHY_WITHOUT_AN_INTERVAL),
    );
  });
});
