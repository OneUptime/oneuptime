import { describe, expect, test } from "@jest/globals";
import { SloWidgetMetric } from "../../../Types/Dashboard/DashboardComponents/DashboardSloComponent";
import { getNumberLocale } from "../../../Types/DateLanguage";
import { FIRST_STRONG_ISOLATE } from "../../../Types/ReadingDirection";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import { createTranslator, Translator } from "../../../Types/Translator";
import { formatSloPolicyTierThreshold } from "../../../Utils/Slo/SloErrorBudgetPolicy";
import {
  getSloListRowDisplay,
  SLO_DISABLED_STATUS_LABEL,
  SLO_NOT_EVALUATED_STATUS_LABEL,
  SloListRowData,
  SloListRowDisplay,
} from "../../../Utils/Slo/SloListWidgetFormat";
import { getSloBudgetRemainingText } from "../../../Utils/Slo/SloOverviewText";
import {
  BUDGET_PERCENT_DECIMALS,
  BURN_RATE_DECIMALS,
  formatErrorBudgetRemainingSeconds,
  formatSloBurnRate,
  formatSloChartValue,
  formatSloNumber,
  formatSloPercent,
  formatSloTargetSubline,
  getSloMetricLabel,
  getSloWidgetTileDisplay,
  getSloWidgetTitle,
  SLI_DECIMALS,
  SLO_NOT_EVALUATED_TEXT,
  SLO_TARGET_SUBLINE_TEMPLATE,
  SloWidgetStateData,
  SloWidgetTileDisplay,
} from "../../../Utils/Slo/SloWidgetFormat";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * THE SLO FIGURES AS THE READER'S LANGUAGE WRITES THEM (#6695, #6778).
 *
 * The SLO pages' sentences were in the reader's language, but the figures
 * inside them were written with an English decimal point in every language:
 * "99.874%" and "14.4×" between German words. And a dashboard's SLO widget
 * drew its title's metric, "Not evaluated yet" and the line under the error
 * budget ("12 min remaining") in English.
 *
 * Each helper takes the reader's Translator as an optional last argument.
 * With one, the figure is written the reader's way and the words are the
 * Dashboard's own (its locale files, read here as they ship); without one,
 * or for an English reader, every text reads exactly as it always did -
 * what the API, Terraform, the worker and the server's texts get.
 */

const NO_BREAK_SPACE: string = " ";
const MINUS_SIGN: string = "−";

const ENGLISH: Translator = dashboardTranslator("en");
const GERMAN: Translator = dashboardTranslator("de");
const ARABIC: Translator = dashboardTranslator("ar");
const PERSIAN: Translator = dashboardTranslator("fa");
const RUSSIAN: Translator = dashboardTranslator("ru");

const DE: Record<string, string> = readDashboardLocale("de");
const AR: Record<string, string> = readDashboardLocale("ar");

// Arabic-Indic digits: never on an Arabic page, which writes Latin ones.
const ARABIC_INDIC_DIGIT: RegExp = /[٠-٩]/;
// A Latin digit: never in a Persian figure, which writes its own.
const LATIN_DIGIT: RegExp = /[0-9]/;
// A figure with an English decimal point: "99.9", "14.4".
const DECIMAL_POINT: RegExp = /[0-9]\.[0-9]/;

// A percentage as the language's own Intl.NumberFormat writes it.
function percentIn(language: string, value: number, decimals: number): string {
  return new Intl.NumberFormat(getNumberLocale(language), {
    style: "percent",
    maximumFractionDigits: decimals,
  }).format(value / 100);
}

function makeSlo(
  overrides: Partial<SloWidgetStateData> = {},
): SloWidgetStateData {
  return {
    name: "Checkout API",
    targetPercentage: 99.9,
    currentSliPercentage: 99.874,
    errorBudgetRemainingPercentage: 42.5,
    errorBudgetRemainingSeconds: 2580,
    currentBurnRate: 14.4,
    sloStatus: SloStatus.AtRisk,
    ...overrides,
  };
}

describe("formatSloPercent in the reader's language", () => {
  test("English reads exactly as it always did, with or without a translator", () => {
    for (const translator of [undefined, ENGLISH]) {
      expect(formatSloPercent(99.874, undefined, translator)).toBe("99.874%");
      expect(formatSloPercent(99.9, SLI_DECIMALS, translator)).toBe("99.9%");
      expect(formatSloPercent(100, undefined, translator)).toBe("100%");
      expect(formatSloPercent(0, undefined, translator)).toBe("0%");
      expect(formatSloPercent(-12.46, 1, translator)).toBe("-12.5%");
      // No thousands mark, as the English never had one.
      expect(formatSloPercent(1234.5, 1, translator)).toBe("1234.5%");
    }
  });

  test("German writes a decimal comma and a no-break space before the sign", () => {
    expect(formatSloPercent(99.874, undefined, GERMAN)).toBe(
      `99,874${NO_BREAK_SPACE}%`,
    );
    expect(formatSloPercent(99.9, SLI_DECIMALS, GERMAN)).toBe(
      `99,9${NO_BREAK_SPACE}%`,
    );
    expect(formatSloPercent(25, undefined, GERMAN)).toBe(
      `25${NO_BREAK_SPACE}%`,
    );
  });

  test("the rounding rules stay as they are: three decimals for an SLI, one for a budget", () => {
    // 99.99949 rounds to 99.999 before it is written, never to 100.
    expect(formatSloPercent(99.99949, undefined, GERMAN)).toBe(
      `99,999${NO_BREAK_SPACE}%`,
    );
    expect(formatSloPercent(42.46, BUDGET_PERCENT_DECIMALS, GERMAN)).toBe(
      `42,5${NO_BREAK_SPACE}%`,
    );
    // Trailing zeros are dropped, as in English: "99,9 %", never "99,900 %".
    expect(formatSloPercent(99.9000001, undefined, GERMAN)).toBe(
      `99,9${NO_BREAK_SPACE}%`,
    );
  });

  test("Italian writes the sign right after the figure, as its Intl does", () => {
    expect(formatSloPercent(99.874, undefined, dashboardTranslator("it"))).toBe(
      "99,874%",
    );
  });

  test("Persian writes its own digits, decimal mark and percent sign", () => {
    expect(formatSloPercent(99.874, undefined, PERSIAN)).toBe("۹۹٫۸۷۴٪");
    expect(formatSloPercent(25, undefined, PERSIAN)).toBe("۲۵٪");
  });

  test("Arabic writes Latin digits, as its Intl writes a percentage", () => {
    const written: string = formatSloPercent(99.874, undefined, ARABIC) || "";

    expect(written).toBe(percentIn("ar", 99.874, 3));
    expect(written).toContain("99.874");
    expect(written).not.toMatch(ARABIC_INDIC_DIGIT);
  });

  test.each(DASHBOARD_LANGUAGES.map((language: string) => [language]))(
    "%s: the figure is the language's own Intl percentage",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      expect(formatSloPercent(99.874, undefined, translator)).toBe(
        percentIn(language, 99.874, 3),
      );
    },
  );

  test("a value that is not a figure stays null in every language", () => {
    for (const translator of [undefined, ENGLISH, GERMAN, PERSIAN]) {
      expect(formatSloPercent(null, undefined, translator)).toBeNull();
      expect(formatSloPercent(undefined, undefined, translator)).toBeNull();
      expect(formatSloPercent(NaN, undefined, translator)).toBeNull();
      expect(formatSloPercent(Infinity, undefined, translator)).toBeNull();
    }
  });
});

describe("formatSloNumber and formatSloBurnRate in the reader's language", () => {
  test("English reads exactly as it always did", () => {
    for (const translator of [undefined, ENGLISH]) {
      expect(formatSloNumber(0.088, SLI_DECIMALS, translator)).toBe("0.088");
      expect(formatSloNumber(1440.5, 1, translator)).toBe("1440.5");
      expect(formatSloBurnRate(14.4, translator)).toBe("14.4×");
      expect(formatSloBurnRate(3, translator)).toBe("3×");
      expect(formatSloBurnRate(0.333333, translator)).toBe("0.33×");
    }
  });

  test("German: a decimal comma, and the thousands mark German writes", () => {
    expect(formatSloNumber(0.088, SLI_DECIMALS, GERMAN)).toBe("0,088");
    expect(formatSloNumber(1440.5, 1, GERMAN)).toBe("1.440,5");
    expect(formatSloBurnRate(14.4, GERMAN)).toBe("14,4×");
    expect(formatSloBurnRate(0.333333, GERMAN)).toBe("0,33×");
  });

  test("Persian: its own digits and decimal mark, the multiplier's sign as it is", () => {
    expect(formatSloNumber(0.088, SLI_DECIMALS, PERSIAN)).toBe("۰٫۰۸۸");
    expect(formatSloBurnRate(14.4, PERSIAN)).toBe("۱۴٫۴×");
    expect(formatSloBurnRate(14.4, PERSIAN)).not.toMatch(LATIN_DIGIT);
  });

  test("Arabic: Latin digits and a decimal point", () => {
    expect(formatSloBurnRate(14.4, ARABIC)).toBe("14.4×");
    expect(formatSloNumber(0.088, SLI_DECIMALS, ARABIC)).toBe("0.088");
  });

  test("the burn rate keeps its two decimals in every language", () => {
    expect(BURN_RATE_DECIMALS).toBe(2);
    expect(formatSloBurnRate(1.2345, GERMAN)).toBe("1,23×");
    expect(formatSloBurnRate(1.2345, PERSIAN)).toBe("۱٫۲۳×");
  });

  test("a value that is not a figure stays null", () => {
    expect(formatSloNumber(null, 2, GERMAN)).toBeNull();
    expect(formatSloBurnRate(undefined, GERMAN)).toBeNull();
    expect(formatSloBurnRate(NaN, PERSIAN)).toBeNull();
  });
});

describe("formatErrorBudgetRemainingSeconds: the line under the error budget", () => {
  test("without a translator, the English every other caller reads is unchanged", () => {
    expect(formatErrorBudgetRemainingSeconds(2580)).toBe("43 min remaining");
    expect(formatErrorBudgetRemainingSeconds(60)).toBe("1 min remaining");
    expect(formatErrorBudgetRemainingSeconds(0)).toBe("0 min remaining");
    expect(formatErrorBudgetRemainingSeconds(20)).toBe("under 1 min remaining");
    expect(formatErrorBudgetRemainingSeconds(-2520)).toBe(
      `${MINUS_SIGN}42 min over budget`,
    );
    expect(formatErrorBudgetRemainingSeconds(-20)).toBe(
      "under 1 min over budget",
    );
    expect(formatErrorBudgetRemainingSeconds(86400)).toBe("1440 min remaining");
    expect(formatErrorBudgetRemainingSeconds(null)).toBeNull();
  });

  test("an English reader's translator reads the same English, word for word", () => {
    for (const seconds of [2580, 60, 0, 20, -2520, -60, -20, 86400]) {
      expect([
        seconds,
        formatErrorBudgetRemainingSeconds(seconds, ENGLISH),
      ]).toEqual([seconds, formatErrorBudgetRemainingSeconds(seconds)]);
    }
  });

  test("German: each case is a German sentence, with German figures", () => {
    expect(formatErrorBudgetRemainingSeconds(2580, GERMAN)).toBe(
      "Noch 43 Min.",
    );
    expect(formatErrorBudgetRemainingSeconds(60, GERMAN)).toBe("Noch 1 Min.");
    expect(formatErrorBudgetRemainingSeconds(0, GERMAN)).toBe("Noch 0 Min.");
    expect(formatErrorBudgetRemainingSeconds(20, GERMAN)).toBe(
      DE["under 1 min remaining"],
    );
    expect(formatErrorBudgetRemainingSeconds(-2520, GERMAN)).toBe(
      "42 Min. über dem Budget",
    );
    expect(formatErrorBudgetRemainingSeconds(-20, GERMAN)).toBe(
      DE["under 1 min over budget"],
    );
    // German writes a thousands mark.
    expect(formatErrorBudgetRemainingSeconds(86400, GERMAN)).toBe(
      "Noch 1.440 Min.",
    );
  });

  test("Arabic: a short unit the same for every count, and an overage said in words", () => {
    expect(formatErrorBudgetRemainingSeconds(2580, ARABIC)).toBe("يتبقى 43 د");
    expect(formatErrorBudgetRemainingSeconds(60, ARABIC)).toBe("يتبقى 1 د");
    expect(formatErrorBudgetRemainingSeconds(-2520, ARABIC)).toBe(
      "تجاوز الميزانية بمقدار 42 د",
    );
    // A negative figure is written out in words, never with a minus.
    expect(formatErrorBudgetRemainingSeconds(-2520, ARABIC)).not.toContain(
      MINUS_SIGN,
    );
  });

  test("Persian writes the minutes in its own digits", () => {
    expect(formatErrorBudgetRemainingSeconds(2580, PERSIAN)).toBe(
      "۴۳ دقیقه مانده",
    );
    expect(formatErrorBudgetRemainingSeconds(-2520, PERSIAN)).toBe(
      "۴۲ دقیقه بیش از بودجه",
    );
  });

  test("Russian takes its own form for one, 21 and 31, and the general one for the rest", () => {
    expect(formatErrorBudgetRemainingSeconds(60, RUSSIAN)).toBe(
      "Осталась 1 мин",
    );
    expect(formatErrorBudgetRemainingSeconds(21 * 60, RUSSIAN)).toBe(
      "Осталась 21 мин",
    );
    expect(formatErrorBudgetRemainingSeconds(3 * 60, RUSSIAN)).toBe(
      "Осталось 3 мин",
    );
    expect(formatErrorBudgetRemainingSeconds(5 * 60, RUSSIAN)).toBe(
      "Осталось 5 мин",
    );
  });

  test.each(DASHBOARD_LANGUAGES.map((language: string) => [language]))(
    "%s: every case is the language's own sentence, never the English one",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      for (const seconds of [2580, 60, 0, 20, -2520, -60, -20]) {
        const line: string =
          formatErrorBudgetRemainingSeconds(seconds, translator) || "";
        const english: string =
          formatErrorBudgetRemainingSeconds(seconds) || "";

        /*
         * "min" is the abbreviation in French, Spanish and the Nordic
         * languages too, and "budget" a French and Dutch word: what may not
         * be left is the English sentence, or its English words.
         */
        expect({
          seconds,
          line,
          isEnglish: line === english || /remaining|over budget/.test(line),
        }).toEqual({ seconds, line, isEnglish: false });
      }
    },
  );
});

describe("the widget's title, metric label and not-evaluated value", () => {
  test("English: the label and title read as they always did", () => {
    for (const translator of [undefined, ENGLISH]) {
      expect(getSloMetricLabel(SloWidgetMetric.Sli, translator)).toBe("SLI");
      expect(
        getSloMetricLabel(SloWidgetMetric.ErrorBudgetRemaining, translator),
      ).toBe("Error Budget Remaining");
      expect(getSloMetricLabel(SloWidgetMetric.BurnRate, translator)).toBe(
        "Burn Rate",
      );
      expect(
        getSloWidgetTitle({
          sloName: "Checkout API",
          sloMetric: SloWidgetMetric.BurnRate,
          translator: translator,
        }),
      ).toBe("Checkout API · Burn Rate");
      expect(
        getSloWidgetTitle({
          widgetTitle: "Checkout",
          sloName: "Checkout API",
          followsSelection: true,
          translator: translator,
        }),
      ).toBe("Checkout API · Checkout");
    }
  });

  test("German: the metric's label is German, the SLO's name as written", () => {
    expect(
      getSloMetricLabel(SloWidgetMetric.ErrorBudgetRemaining, GERMAN),
    ).toBe(DE["Error Budget Remaining"]);
    expect(DE["Error Budget Remaining"]).not.toBe("Error Budget Remaining");

    expect(
      getSloWidgetTitle({
        sloName: "Checkout API",
        sloMetric: SloWidgetMetric.ErrorBudgetRemaining,
        translator: GERMAN,
      }),
    ).toBe(`Checkout API · ${DE["Error Budget Remaining"]}`);
    expect(
      getSloWidgetTitle({
        sloName: "Checkout API",
        sloMetric: SloWidgetMetric.BurnRate,
        translator: GERMAN,
      }),
    ).toBe(`Checkout API · ${DE["Burn Rate"]}`);
    // No name: the label alone.
    expect(
      getSloWidgetTitle({
        sloMetric: SloWidgetMetric.BurnRate,
        translator: GERMAN,
      }),
    ).toBe(DE["Burn Rate"]);
  });

  test("an author's own title is drawn as written in every language", () => {
    expect(
      getSloWidgetTitle({
        widgetTitle: "Checkout budget",
        sloName: "Checkout API",
        sloMetric: SloWidgetMetric.ErrorBudgetRemaining,
        translator: GERMAN,
      }),
    ).toBe("Checkout budget");
  });

  test("Arabic: an English name is set apart from the Arabic label, so it keeps its place", () => {
    const title: string = getSloWidgetTitle({
      sloName: "Checkout API",
      sloMetric: SloWidgetMetric.ErrorBudgetRemaining,
      translator: ARABIC,
    });

    expect(title).toBe(
      `${isolated("Checkout API")} · ${AR["Error Budget Remaining"]}`,
    );
    expect(withoutIsolateMarks(title)).toBe(
      `Checkout API · ${AR["Error Budget Remaining"]}`,
    );
  });

  test("Arabic: an Arabic name in an Arabic title needs no isolate", () => {
    const title: string = getSloWidgetTitle({
      sloName: "واجهة الدفع",
      sloMetric: SloWidgetMetric.BurnRate,
      translator: ARABIC,
    });

    expect(title).toBe(`واجهة الدفع · ${AR["Burn Rate"]}`);
    expect(title).not.toContain(FIRST_STRONG_ISOLATE);
  });

  test("Persian: the facts are set off with the bullet a dot-zero language uses", () => {
    const title: string = getSloWidgetTitle({
      sloName: "Checkout API",
      sloMetric: SloWidgetMetric.BurnRate,
      translator: PERSIAN,
    });

    expect(withoutIsolateMarks(title)).toBe(
      `Checkout API • ${readDashboardLocale("fa")["Burn Rate"]}`,
    );
  });

  test("the not-evaluated value is the reader's, and the English constant is kept for callers without one", () => {
    expect(SLO_NOT_EVALUATED_TEXT).toBe("Not evaluated yet");

    const display: SloWidgetTileDisplay = getSloWidgetTileDisplay({
      sloMetric: SloWidgetMetric.Sli,
      slo: makeSlo({ currentSliPercentage: null }),
      translator: GERMAN,
    });

    expect(display).toEqual({
      isEvaluated: false,
      value: DE["Not evaluated yet"],
      subline: null,
    });
    expect(
      getSloWidgetTileDisplay({ sloMetric: SloWidgetMetric.Sli, slo: null })
        .value,
    ).toBe("Not evaluated yet");
  });
});

describe("the tile's figure and the line under it, per metric", () => {
  test("German", () => {
    expect(
      getSloWidgetTileDisplay({
        sloMetric: SloWidgetMetric.Sli,
        slo: makeSlo(),
        translator: GERMAN,
      }),
    ).toEqual({
      isEvaluated: true,
      value: `99,874${NO_BREAK_SPACE}%`,
      subline: `Ziel 99,9${NO_BREAK_SPACE}%`,
    });
    expect(
      getSloWidgetTileDisplay({
        sloMetric: SloWidgetMetric.ErrorBudgetRemaining,
        slo: makeSlo(),
        translator: GERMAN,
      }),
    ).toEqual({
      isEvaluated: true,
      value: `42,5${NO_BREAK_SPACE}%`,
      subline: "Noch 43 Min.",
    });
    expect(
      getSloWidgetTileDisplay({
        sloMetric: SloWidgetMetric.ErrorBudgetRemaining,
        slo: makeSlo({
          errorBudgetRemainingPercentage: -12.46,
          errorBudgetRemainingSeconds: -2520,
        }),
        translator: GERMAN,
      }),
    ).toEqual({
      isEvaluated: true,
      value: `-12,5${NO_BREAK_SPACE}%`,
      subline: "42 Min. über dem Budget",
    });
    expect(
      getSloWidgetTileDisplay({
        sloMetric: SloWidgetMetric.BurnRate,
        slo: makeSlo(),
        translator: GERMAN,
      }),
    ).toEqual({ isEvaluated: true, value: "14,4×", subline: null });
  });

  test("English, with or without a translator, as it always read", () => {
    for (const translator of [undefined, ENGLISH]) {
      expect(
        getSloWidgetTileDisplay({
          sloMetric: SloWidgetMetric.Sli,
          slo: makeSlo(),
          translator: translator,
        }),
      ).toEqual({
        isEvaluated: true,
        value: "99.874%",
        subline: "target 99.9%",
      });
      expect(
        getSloWidgetTileDisplay({
          sloMetric: SloWidgetMetric.ErrorBudgetRemaining,
          slo: makeSlo({
            errorBudgetRemainingPercentage: -12.46,
            errorBudgetRemainingSeconds: -2520,
          }),
          translator: translator,
        }),
      ).toEqual({
        isEvaluated: true,
        value: "-12.5%",
        subline: `${MINUS_SIGN}42 min over budget`,
      });
    }
  });

  test.each(DASHBOARD_LANGUAGES.map((language: string) => [language]))(
    "%s: no figure keeps an English decimal point where the language writes a comma",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const usesDecimalComma: boolean =
        new Intl.NumberFormat(getNumberLocale(language)).format(1.5) !== "1.5";

      for (const metric of [
        SloWidgetMetric.Sli,
        SloWidgetMetric.ErrorBudgetRemaining,
        SloWidgetMetric.BurnRate,
      ]) {
        const display: SloWidgetTileDisplay = getSloWidgetTileDisplay({
          sloMetric: metric,
          slo: makeSlo(),
          translator: translator,
        });
        const text: string = `${display.value} ${display.subline || ""}`;

        expect({
          metric,
          text,
          hasDecimalPoint: DECIMAL_POINT.test(text),
        }).toEqual({ metric, text, hasDecimalPoint: !usesDecimalComma });
      }
    },
  );
});

describe("formatSloTargetSubline: the line under an SLI", () => {
  test("English as it always read, and null without a target", () => {
    expect(formatSloTargetSubline(99.9)).toBe("target 99.9%");
    expect(formatSloTargetSubline(99.9, ENGLISH)).toBe("target 99.9%");
    expect(formatSloTargetSubline(null, GERMAN)).toBeNull();
    expect(SLO_TARGET_SUBLINE_TEMPLATE).toBe("target {{target}}");
  });

  test("German, Arabic and Persian: the language's word and figure", () => {
    expect(formatSloTargetSubline(99.9, GERMAN)).toBe(
      `${DE[SLO_TARGET_SUBLINE_TEMPLATE]!.replace("{{target}}", "")}99,9${NO_BREAK_SPACE}%`,
    );
    expect(formatSloTargetSubline(99.9, ARABIC)).toBe(
      AR[SLO_TARGET_SUBLINE_TEMPLATE]!.replace(
        "{{target}}",
        percentIn("ar", 99.9, 3),
      ),
    );
    expect(formatSloTargetSubline(99.9, PERSIAN)).toBe("هدف ۹۹٫۹٪");
  });
});

describe("formatSloChartValue: the axis and the tooltip", () => {
  test("each metric carries its unit, in the reader's figures", () => {
    expect(formatSloChartValue(SloWidgetMetric.Sli, 99.8745, GERMAN)).toBe(
      `99,875${NO_BREAK_SPACE}%`,
    );
    expect(
      formatSloChartValue(SloWidgetMetric.ErrorBudgetRemaining, 42.46, GERMAN),
    ).toBe(`42,5${NO_BREAK_SPACE}%`);
    expect(formatSloChartValue(SloWidgetMetric.BurnRate, 3.2, GERMAN)).toBe(
      "3,2×",
    );
    expect(formatSloChartValue(SloWidgetMetric.BurnRate, 3.2)).toBe("3.2×");
    expect(formatSloChartValue(SloWidgetMetric.Sli, 99.8745)).toBe("99.875%");
  });
});

describe("the SLO list widget's row in the reader's language", () => {
  const ROW: SloListRowData = {
    ...makeSlo(),
    isEnabled: true,
  } as SloListRowData;

  test("German: the figures, the target line and the budget line", () => {
    const display: SloListRowDisplay = getSloListRowDisplay(ROW, GERMAN);

    expect(display.sli).toBe(`99,874${NO_BREAK_SPACE}%`);
    expect(display.target).toBe(`Ziel 99,9${NO_BREAK_SPACE}%`);
    expect(display.budget).toBe(`42,5${NO_BREAK_SPACE}%`);
    expect(display.budgetTime).toBe("Noch 43 Min.");
    expect(display.burnRate).toBe("14,4×");
    // The status stays a key the widget looks up where it draws it.
    expect(display.statusText).toBe(SloStatus.AtRisk);
  });

  test("English: the row reads as it always did", () => {
    for (const translator of [undefined, ENGLISH]) {
      const display: SloListRowDisplay = getSloListRowDisplay(ROW, translator);

      expect(display.sli).toBe("99.874%");
      expect(display.target).toBe("target 99.9%");
      expect(display.budget).toBe("42.5%");
      expect(display.budgetTime).toBe("43 min remaining");
      expect(display.burnRate).toBe("14.4×");
    }
  });

  test("a disabled or not-yet-evaluated SLO's figures are the reader's too", () => {
    const disabled: SloListRowDisplay = getSloListRowDisplay(
      { ...ROW, isEnabled: false } as SloListRowData,
      GERMAN,
    );

    expect(disabled.statusText).toBe(SLO_DISABLED_STATUS_LABEL);
    expect(disabled.target).toBe(`Ziel 99,9${NO_BREAK_SPACE}%`);
    expect(disabled.budgetTime).toBe("Noch 43 Min.");

    const notEvaluated: SloListRowDisplay = getSloListRowDisplay(
      { ...ROW, sloStatus: null } as SloListRowData,
      GERMAN,
    );

    expect(notEvaluated.statusText).toBe(SLO_NOT_EVALUATED_STATUS_LABEL);
  });

  test.each(DASHBOARD_LANGUAGES.map((language: string) => [language]))(
    "%s: the status labels the list draws are worded in the language",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const label of [
        SLO_NOT_EVALUATED_STATUS_LABEL,
        SLO_DISABLED_STATUS_LABEL,
      ]) {
        expect({
          label,
          worded: Boolean(words[label]) && words[label] !== label,
        }).toEqual({ label, worded: true });
      }
    },
  );
});

describe("the figures the overview's sentences hold", () => {
  test("a policy tier's threshold: German with a translator, as before without one", () => {
    expect(formatSloPolicyTierThreshold(25)).toBe("25%");
    expect(formatSloPolicyTierThreshold(12.345)).toBe("12.35%");
    expect(formatSloPolicyTierThreshold(25, ENGLISH)).toBe("25%");
    expect(formatSloPolicyTierThreshold(25, GERMAN)).toBe(
      `25${NO_BREAK_SPACE}%`,
    );
    expect(formatSloPolicyTierThreshold(12.345, GERMAN)).toBe(
      `12,35${NO_BREAK_SPACE}%`,
    );
    expect(formatSloPolicyTierThreshold("2.5", PERSIAN)).toBe("۲٫۵٪");
    // Not a threshold: empty in every language.
    expect(formatSloPolicyTierThreshold(-1, GERMAN)).toBe("");
    expect(formatSloPolicyTierThreshold("x", GERMAN)).toBe("");
  });

  test("the budget left: German with a translator, as before without one", () => {
    expect(getSloBudgetRemainingText(42.46)).toBe("42.5%");
    expect(getSloBudgetRemainingText(0.04)).toBe("<0.1%");
    expect(getSloBudgetRemainingText(42.46, GERMAN)).toBe(
      `42,5${NO_BREAK_SPACE}%`,
    );
    expect(getSloBudgetRemainingText(0.04, GERMAN)).toBe(
      `<0,1${NO_BREAK_SPACE}%`,
    );
    expect(getSloBudgetRemainingText(0.04, ENGLISH)).toBe("<0.1%");
  });

  test("a language with no words of its own for a figure still writes it its way", () => {
    // A translator with no lookup at all: the figures are still German.
    const bareGerman: Translator = createTranslator(undefined, "de");

    expect(formatSloPercent(99.874, undefined, bareGerman)).toBe(
      `99,874${NO_BREAK_SPACE}%`,
    );
    // The words fall back to English, with the count written the German way.
    expect(formatErrorBudgetRemainingSeconds(86400, bareGerman)).toBe(
      "1.440 min remaining",
    );
  });
});
