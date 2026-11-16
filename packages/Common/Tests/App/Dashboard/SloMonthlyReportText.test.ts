/**
 * @timezone UTC
 */
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DEFAULT_SLO_MONTHLY_REPORT_PERIOD,
  SLO_MONTHLY_REPORT_MONTHS_QUERY_PARAM,
  SLO_MONTHLY_REPORT_UNAVAILABLE_TEXT,
  SLO_MONTHLY_REPORT_YEAR_QUERY_PARAM,
  SLO_MONTH_VERDICT_BADGE_TYPE,
  SLO_MONTH_VERDICT_TEXT,
  SLO_MONTH_VERDICT_TEXT_CLASS,
  SloMonthlyReportPeriodChoice,
  formatSloBudgetUsed,
  formatSloMonthlyReportSli,
  getSloBudgetUsedBarClassName,
  getSloMonthlyReportPeriodChoices,
  getSloMonthlyReportPeriodSearch,
  getSloMonthlyReportPeriodValue,
  getSloReportMonthName,
  readSloMonthlyReportPeriod,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloMonthlyReportText";
import { StatusBadgeType } from "../../../UI/Components/StatusBadge/StatusBadge";
import { createTranslator, Translator } from "../../../Types/Translator";
import { MEANING_KEYS } from "../../../Types/MeaningKeys";
import {
  SLO_MONTHLY_REPORT_MONTH_CHOICES,
  SloMonthVerdict,
  SloMonthlyReportPeriodKind,
  SloMonthlyReportUnavailableReason,
} from "../../../Utils/Slo/SloMonthlyReport";

/*
 * The words and figures of an SLO's Monthly Report page (#5476): the
 * periods it offers and how the address keeps one, each verdict's words and
 * colour, an SLI floored so a miss never reads as the target, a month named
 * where the report cut it, and every sentence worded in every Dashboard
 * language.
 */

const NOW: Date = new Date("2026-11-16T12:00:00.000Z");

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const DASHBOARD_LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
  "ar",
];

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const ENGLISH: Translator = createTranslator(undefined);

function translatorFor(locale: string): Translator {
  const words: Record<string, string> = readLocale(locale);

  return createTranslator((text: string): string | undefined => {
    return words[text];
  }, locale);
}

describe("the periods the page offers", () => {
  const choices: Array<SloMonthlyReportPeriodChoice> =
    getSloMonthlyReportPeriodChoices(NOW);

  test("the last 3, 6, 9 and 12 months, then this year and last year", () => {
    expect(
      choices.map((choice: SloMonthlyReportPeriodChoice): string => {
        return choice.value;
      }),
    ).toEqual([
      "months-3",
      "months-6",
      "months-9",
      "months-12",
      "year-2026",
      "year-2025",
    ]);

    expect(
      choices.slice(0, 4).map((choice: SloMonthlyReportPeriodChoice) => {
        return choice.label;
      }),
    ).toEqual(["3 months", "6 months", "9 months", "12 months"]);

    expect(
      choices
        .slice(0, 4)
        .map((choice: SloMonthlyReportPeriodChoice): number => {
          return (choice.period as { months: number }).months;
        }),
    ).toEqual([...SLO_MONTHLY_REPORT_MONTH_CHOICES]);
  });

  test("a year is named as the reader writes one", () => {
    expect(choices[4]!.label).toBe("2026");
    expect(choices[4]!.period).toEqual({
      kind: SloMonthlyReportPeriodKind.Year,
      year: 2026,
    });
  });

  test("every month choice is worded in every Dashboard language", () => {
    for (const locale of DASHBOARD_LOCALES) {
      const words: Record<string, string> = readLocale(locale);

      for (const choice of choices.slice(0, 4)) {
        expect({
          locale,
          label: choice.label,
          worded:
            Boolean(words[choice.label]) &&
            words[choice.label] !== choice.label,
        }).toEqual({ locale, label: choice.label, worded: true });
      }
    }
  });
});

describe("the period in the address", () => {
  test.each([
    [
      { months: "6", year: null },
      { kind: "LastMonths", months: 6 },
    ],
    [
      { months: "1", year: null },
      { kind: "LastMonths", months: 1 },
    ],
    [
      { months: "24", year: null },
      { kind: "LastMonths", months: 24 },
    ],
    [
      { months: null, year: "2025" },
      { kind: "Year", year: 2025 },
    ],
    // A year wins over months: it is the more specific ask.
    [
      { months: "6", year: "2024" },
      { kind: "Year", year: 2024 },
    ],
  ])(
    "%p reads as %p",
    (
      search: { months: string | null; year: string | null },
      period: unknown,
    ) => {
      expect(readSloMonthlyReportPeriod({ ...search, now: NOW })).toEqual(
        period,
      );
    },
  );

  test.each([
    [{ months: null, year: null }],
    [{ months: "0", year: null }],
    [{ months: "25", year: null }],
    [{ months: "six", year: null }],
    [{ months: "-3", year: null }],
    [{ months: null, year: "1999" }],
    [{ months: null, year: "2027" }],
  ])(
    "%p reads as the last 12 months",
    (search: { months: string | null; year: string | null }) => {
      expect(readSloMonthlyReportPeriod({ ...search, now: NOW })).toEqual(
        DEFAULT_SLO_MONTHLY_REPORT_PERIOD,
      );
    },
  );

  test("a period is written back as one value, the other taken away", () => {
    expect(
      getSloMonthlyReportPeriodSearch({
        kind: SloMonthlyReportPeriodKind.LastMonths,
        months: 6,
      }),
    ).toEqual({
      [SLO_MONTHLY_REPORT_MONTHS_QUERY_PARAM]: "6",
      [SLO_MONTHLY_REPORT_YEAR_QUERY_PARAM]: null,
    });

    expect(
      getSloMonthlyReportPeriodSearch({
        kind: SloMonthlyReportPeriodKind.Year,
        year: 2025,
      }),
    ).toEqual({
      [SLO_MONTHLY_REPORT_MONTHS_QUERY_PARAM]: null,
      [SLO_MONTHLY_REPORT_YEAR_QUERY_PARAM]: "2025",
    });
  });

  test("the default leaves the address clean", () => {
    expect(
      getSloMonthlyReportPeriodSearch(DEFAULT_SLO_MONTHLY_REPORT_PERIOD),
    ).toEqual({
      [SLO_MONTHLY_REPORT_MONTHS_QUERY_PARAM]: null,
      [SLO_MONTHLY_REPORT_YEAR_QUERY_PARAM]: null,
    });
  });

  test("a period's value is the button that stands for it", () => {
    expect(
      getSloMonthlyReportPeriodValue({
        kind: SloMonthlyReportPeriodKind.LastMonths,
        months: 9,
      }),
    ).toBe("months-9");
    expect(
      getSloMonthlyReportPeriodValue({
        kind: SloMonthlyReportPeriodKind.Year,
        year: 2025,
      }),
    ).toBe("year-2025");
  });
});

describe("figures", () => {
  test.each([
    [100, "100%"],
    [99.95, "99.95%"],
    [99.9, "99.9%"],
    // A miss never reads as the target it missed.
    [99.8996, "99.899%"],
    [99.89999999999, "99.899%"],
    [99.9999, "99.999%"],
    [0, "0%"],
  ])("an SLI of %p is written %p", (value: number, written: string) => {
    expect(formatSloMonthlyReportSli(value, ENGLISH)).toBe(written);
  });

  test("an SLI of no data is no figure", () => {
    expect(formatSloMonthlyReportSli(null, ENGLISH)).toBeNull();
    expect(formatSloMonthlyReportSli(NaN, ENGLISH)).toBeNull();
  });

  test("an SLI in German has a decimal comma", () => {
    expect(formatSloMonthlyReportSli(99.8996, translatorFor("de"))).toMatch(
      /^99,899\s%$/,
    );
  });

  test("the error budget used: one decimal, never capped, never below zero", () => {
    expect(formatSloBudgetUsed(277.7777, ENGLISH)).toBe("277.8%");
    expect(formatSloBudgetUsed(12.04, ENGLISH)).toBe("12%");
    expect(formatSloBudgetUsed(-3, ENGLISH)).toBe("0%");
    expect(formatSloBudgetUsed(null, ENGLISH)).toBeNull();
  });

  test.each([
    [0, "bg-emerald-500"],
    [74.9, "bg-emerald-500"],
    [75, "bg-amber-500"],
    [100, "bg-amber-500"],
    [100.1, "bg-red-500"],
  ])("a budget %p%% used is drawn %p", (used: number, className: string) => {
    expect(getSloBudgetUsedBarClassName(used)).toBe(className);
  });

  test("a month is named in the zone the report cut it in", () => {
    // March 1st in Berlin starts at 23:00 UTC on February 28th.
    const marchInBerlin: Date = new Date("2026-02-28T23:00:00.000Z");

    expect(
      getSloReportMonthName({
        monthStart: marchInBerlin,
        timezone: "Europe/Berlin",
      }),
    ).toBe("March 2026");
    expect(
      getSloReportMonthName({
        monthStart: marchInBerlin,
        timezone: "Europe/Berlin",
        isShort: true,
      }),
    ).toBe("Mar 2026");
    // The same instant in UTC is still February.
    expect(
      getSloReportMonthName({ monthStart: marchInBerlin, timezone: "UTC" }),
    ).toBe("February 2026");
  });
});

describe("verdicts", () => {
  test("every verdict has its words, its badge and its colour", () => {
    for (const verdict of Object.values(SloMonthVerdict)) {
      expect(SLO_MONTH_VERDICT_TEXT[verdict]).toBeTruthy();
      expect(SLO_MONTH_VERDICT_BADGE_TYPE[verdict]).toBeTruthy();
      expect(SLO_MONTH_VERDICT_TEXT_CLASS[verdict]).toBeTruthy();
    }

    expect(SLO_MONTH_VERDICT_BADGE_TYPE[SloMonthVerdict.Met]).toBe(
      StatusBadgeType.Success,
    );
    expect(SLO_MONTH_VERDICT_BADGE_TYPE[SloMonthVerdict.Missed]).toBe(
      StatusBadgeType.Danger,
    );
    expect(SLO_MONTH_VERDICT_BADGE_TYPE[SloMonthVerdict.BelowTarget]).toBe(
      StatusBadgeType.Warning,
    );
  });

  test("a missed month is a missed target, not a missed deadline: its own key, which English reads as Missed", () => {
    expect(SLO_MONTH_VERDICT_TEXT[SloMonthVerdict.Missed]).toBe(
      "Missed (target)",
    );
    expect(MEANING_KEYS).toContain("Missed (target)");
    expect(ENGLISH.translateText("Missed (target)")).toBe("Missed");
  });

  test("every verdict reads in every Dashboard language", () => {
    for (const locale of DASHBOARD_LOCALES) {
      const words: Record<string, string> = readLocale(locale);

      for (const verdict of Object.values(SloMonthVerdict)) {
        const key: string = SLO_MONTH_VERDICT_TEXT[verdict];

        expect({ locale, key, worded: Boolean(words[key]) }).toEqual({
          locale,
          key,
          worded: true,
        });
      }
    }

    /*
     * The target's word, where the SLA's "Missed" names a deadline:
     * Danish "Overskredet" (exceeded), Norwegian "Oversittet", Japanese
     * 見逃し (overlooked). Arabic's لم يُستوفَ ("not fulfilled") fits both.
     */
    for (const locale of ["da", "no", "ja", "es", "pt", "zh-CN", "fa"]) {
      const words: Record<string, string> = readLocale(locale);

      expect({ locale, word: words["Missed (target)"] }).not.toEqual({
        locale,
        word: words["Missed"],
      });
    }
  });
});

describe("why there is nothing to report", () => {
  test("every reason has a sentence, said in every Dashboard language", () => {
    for (const reason of Object.values(SloMonthlyReportUnavailableReason)) {
      const sentence: string = SLO_MONTHLY_REPORT_UNAVAILABLE_TEXT[reason];

      expect(sentence).toMatch(/^[A-Z].*\.$/);

      for (const locale of DASHBOARD_LOCALES) {
        const words: Record<string, string> = readLocale(locale);

        expect({
          locale,
          reason,
          worded: Boolean(words[sentence]) && words[sentence] !== sentence,
        }).toEqual({ locale, reason, worded: true });
      }
    }
  });
});
