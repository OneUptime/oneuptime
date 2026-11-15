import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";
import SliType from "Common/Types/ServiceLevelObjective/SliType";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import { SloRollingWindowFill } from "Common/Utils/Slo/SloProjection";
import { formatSloNumber } from "Common/Utils/Slo/SloWidgetFormat";
import { DASHBOARD_LANGUAGES } from "Common/Tests/Helpers/TranslatedLanguages";
import {
  describeRequestErrorBudgetInLanguage,
  getRequestBudgetRemainingOfTotalInLanguage,
  getRequestBudgetRemainingSecondsEquivalent,
  getRequestWindowFill,
  getSloServiceCountInLanguage,
} from "../../FeatureSet/Dashboard/src/Components/Slo/SloRequestTextInLanguage";

/*
 * A REQUEST SLO's numbers in the reader's language (#6799): its error
 * budget is counted in requests - failed ones for Request Success, slow
 * ones for Request Latency - never in minutes; its services are counted
 * in place of monitors; what its objective allows is "1 bad request in
 * every 1,000"; and its window fills as OneUptime counts the older
 * requests of its services. Each sentence is read from the shipped locale
 * files, so every language words it and writes its figures in its own
 * digits.
 */

const DASHBOARD: string = path.resolve(__dirname, "../../FeatureSet/Dashboard");

const ENGLISH: Translator = createTranslator(undefined);

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

const COUNTED_UNTIL: Date = new Date("2026-09-15T12:00:00.000Z");

const LATIN_DIGIT: RegExp = /[0-9]/;

function readLocale(code: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD, "src/Locales", `${code}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

// A language as the Dashboard ships it.
function shippedTranslatorFor(code: string): Translator {
  const locale: Record<string, unknown> = readLocale(code);

  return createTranslator((text: string): string | undefined => {
    const value: unknown = locale[text];

    return typeof value === "string" && value !== text ? value : undefined;
  }, code);
}

describe("a request SLO's error budget, in requests", () => {
  test.each([
    [
      SliType.RequestSuccess,
      120.4,
      1000.2,
      "120 of 1,000 failed requests left",
    ],
    [SliType.RequestLatency, 120, 1000, "120 of 1,000 slow requests left"],
    [SliType.RequestSuccess, 1, 1, "1 of 1 failed request left"],
    [SliType.RequestLatency, 0, 1, "0 of 1 slow request left"],
    // A decimal column can reach the page as a string.
    [
      SliType.RequestSuccess,
      "600",
      "1000",
      "600 of 1,000 failed requests left",
    ],
  ])(
    "%s with %s of %s left reads %s",
    (
      sliType: SliType,
      remaining: number | string,
      total: number | string,
      expected: string,
    ) => {
      expect(
        getRequestBudgetRemainingOfTotalInLanguage({
          sliType: sliType,
          remainingEvents: remaining as number,
          totalEvents: total as number,
        }),
      ).toBe(expected);
    },
  );

  test.each([
    [SliType.RequestSuccess, -1, "1 failed request over budget"],
    [SliType.RequestSuccess, -1234.6, "1,235 failed requests over budget"],
    [SliType.RequestLatency, -50, "50 slow requests over budget"],
  ])(
    "an overspent %s budget of %s says by how many requests",
    (sliType: SliType, remaining: number, expected: string) => {
      expect(
        getRequestBudgetRemainingOfTotalInLanguage({
          sliType: sliType,
          remainingEvents: remaining,
          totalEvents: 1000,
        }),
      ).toBe(expected);
    },
  );

  test("a budget a fraction of a request below zero is 0 left, never -0", () => {
    expect(
      getRequestBudgetRemainingOfTotalInLanguage({
        sliType: SliType.RequestSuccess,
        remainingEvents: -0.4,
        totalEvents: 1000,
      }),
    ).toBe("0 of 1,000 failed requests left");
  });

  test.each([undefined, null, "", "many", NaN, Infinity])(
    "says nothing before the first evaluation (%s left)",
    (remaining: unknown) => {
      expect(
        getRequestBudgetRemainingOfTotalInLanguage({
          sliType: SliType.RequestSuccess,
          remainingEvents: remaining as number,
          totalEvents: 1000,
        }),
      ).toBeNull();
    },
  );
});

describe("a request SLO's services, counted", () => {
  test.each([
    [0, "No services"],
    [-1, "No services"],
    [NaN, "No services"],
    [1, "1 service"],
    [3, "3 services"],
    [1200, "1,200 services"],
  ])("%s services reads %s", (count: number, expected: string) => {
    expect(getSloServiceCountInLanguage(count)).toBe(expected);
  });
});

describe("what a request SLO's objective allows", () => {
  test.each([
    [99.9, "0.1% of requests: 1 bad request in every 1,000"],
    [99, "1% of requests: 1 bad request in every 100"],
    [99.95, "0.05% of requests: 1 bad request in every 2,000"],
    [99.99, "0.01% of requests: 1 bad request in every 10,000"],
    [95, "5% of requests: 1 bad request in every 20"],
  ])("a %s target allows %s", (target: number, expected: string) => {
    expect(
      describeRequestErrorBudgetInLanguage({ targetPercentage: target }),
    ).toBe(expected);
  });

  test.each([0, 100, 120, -5, null, undefined])(
    "a target of %s leaves no budget to describe",
    (target: number | null | undefined) => {
      expect(
        describeRequestErrorBudgetInLanguage({ targetPercentage: target }),
      ).toBeNull();
    },
  );
});

describe("how much of its window a request SLO's counts cover", () => {
  const counted: (
    days: number,
    overrides?: Partial<Parameters<typeof getRequestWindowFill>[0]>,
  ) => SloRollingWindowFill | null = (
    days: number,
    overrides: Partial<Parameters<typeof getRequestWindowFill>[0]> = {},
  ): SloRollingWindowFill | null => {
    return getRequestWindowFill({
      sliType: SliType.RequestSuccess,
      windowType: SloWindowType.Rolling,
      windowDays: 30,
      timezone: "UTC",
      firstAccumulatedBucketStartAt: new Date(
        COUNTED_UNTIL.getTime() - days * DAY_IN_MS,
      ),
      lastAccumulatedBucketEndAt: COUNTED_UNTIL,
      ...overrides,
    });
  };

  test("6 of 30 days counted: the window is 20% full", () => {
    expect(counted(6)).toEqual({
      fraction: 0.2,
      percent: 20,
      label: "Window 20% full",
      isNotYetFull: true,
    });
  });

  test("a window counted in full, or further back than it reaches, is full", () => {
    expect(counted(30)?.isNotYetFull).toBe(false);
    expect(counted(45)?.percent).toBe(100);
  });

  test("a few hours in is under 1% full, never 0%", () => {
    expect(counted(0.1)?.label).toBe("Window under 1% full");
  });

  test("a step short of the window counts as full: counting works in 5-minute steps", () => {
    expect(counted(30 - 5 / (24 * 60))?.isNotYetFull).toBe(false);
  });

  test("a calendar month is filled from its 1st", () => {
    // 7 of the 14.5 days of September so far.
    const fill: SloRollingWindowFill | null = counted(7, {
      windowType: SloWindowType.CalendarMonth,
    });

    expect(fill?.percent).toBe(48);
    expect(fill?.isNotYetFull).toBe(true);
  });

  test("has nothing to say of a monitor uptime SLO, or before anything is counted", () => {
    expect(counted(6, { sliType: SliType.MonitorUptime })).toBeNull();
    expect(counted(6, { lastAccumulatedBucketEndAt: null })).toBeNull();
    expect(counted(6, { firstAccumulatedBucketStartAt: null })).toBeNull();
  });
});

type EquivalentOverrides = Partial<
  Parameters<typeof getRequestBudgetRemainingSecondsEquivalent>[0]
>;

describe("a request SLO's budget, as the seconds its runway is projected from", () => {
  const equivalent: (overrides: EquivalentOverrides) => number | null = (
    overrides: EquivalentOverrides,
  ): number | null => {
    return getRequestBudgetRemainingSecondsEquivalent({
      sliType: SliType.RequestSuccess,
      windowType: SloWindowType.Rolling,
      windowDays: 30,
      timezone: "UTC",
      firstAccumulatedBucketStartAt: new Date(
        COUNTED_UNTIL.getTime() - 30 * DAY_IN_MS,
      ),
      lastAccumulatedBucketEndAt: COUNTED_UNTIL,
      targetPercentage: 99.9,
      errorBudgetRemainingPercentage: 60,
      ...overrides,
    });
  };

  test("60% of 0.1% of a counted 30 days: what a time SLO with that budget left would have", () => {
    expect(equivalent({})).toBeCloseTo(0.6 * 0.001 * 30 * 86400, 6);
  });

  test("only the time its counts cover: 6 days counted of 30", () => {
    expect(
      equivalent({
        firstAccumulatedBucketStartAt: new Date(
          COUNTED_UNTIL.getTime() - 6 * DAY_IN_MS,
        ),
      }),
    ).toBeCloseTo(0.6 * 0.001 * 6 * 86400, 6);
  });

  test("an overspent budget is negative seconds, as a time SLO's is", () => {
    expect(equivalent({ errorBudgetRemainingPercentage: -50 })).toBeLessThan(0);
  });

  test.each<EquivalentOverrides>([
    { errorBudgetRemainingPercentage: null },
    { targetPercentage: 100 },
    { targetPercentage: null },
    { lastAccumulatedBucketEndAt: null },
    { firstAccumulatedBucketStartAt: null },
  ])(
    "cannot be projected without its inputs: %o",
    (overrides: EquivalentOverrides) => {
      expect(equivalent(overrides)).toBeNull();
    },
  );
});

describe("a request SLO's numbers in every Dashboard language", () => {
  test.each(DASHBOARD_LANGUAGES)(
    "%s words each sentence and writes its counts in its own digits",
    (code: string) => {
      const translator: Translator = shippedTranslatorFor(code);
      const thousand: string = formatSloNumber(1000, 0, translator) as string;
      const sentences: Array<[string, string | null]> = [
        [
          getRequestBudgetRemainingOfTotalInLanguage(
            {
              sliType: SliType.RequestSuccess,
              remainingEvents: 120,
              totalEvents: 1000,
            },
            ENGLISH,
          ) as string,
          getRequestBudgetRemainingOfTotalInLanguage(
            {
              sliType: SliType.RequestSuccess,
              remainingEvents: 120,
              totalEvents: 1000,
            },
            translator,
          ),
        ],
        [
          getRequestBudgetRemainingOfTotalInLanguage(
            {
              sliType: SliType.RequestLatency,
              remainingEvents: -1000,
              totalEvents: 1000,
            },
            ENGLISH,
          ) as string,
          getRequestBudgetRemainingOfTotalInLanguage(
            {
              sliType: SliType.RequestLatency,
              remainingEvents: -1000,
              totalEvents: 1000,
            },
            translator,
          ),
        ],
        [
          describeRequestErrorBudgetInLanguage(
            { targetPercentage: 99.9 },
            ENGLISH,
          ) as string,
          describeRequestErrorBudgetInLanguage(
            { targetPercentage: 99.9 },
            translator,
          ),
        ],
        [
          getSloServiceCountInLanguage(1000, ENGLISH),
          getSloServiceCountInLanguage(1000, translator),
        ],
      ];

      for (const [english, worded] of sentences) {
        expect(worded).not.toBeNull();
        // Worded in the language, with every placeholder filled.
        expect({ english, worded }).not.toEqual({ english, worded: english });
        expect(worded).not.toContain("{{");
        // 1,000 as the language writes it: "1.000", "۱٬۰۰۰", "1 000".
        expect(worded).toContain(thousand);
      }

      expect(getSloServiceCountInLanguage(0, translator)).not.toBe(
        "No services",
      );

      if (code === "fa") {
        for (const [, worded] of sentences) {
          expect(worded).not.toMatch(LATIN_DIGIT);
        }
      }
    },
  );
});
