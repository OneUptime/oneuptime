/*
 * The evaluator's import chain pulls the native isolated-vm addon
 * (MonitorCriteriaEvaluator → VMAPI → VMRunner). Nothing here touches the
 * sandbox, so stub it before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import { describe, expect, jest, test } from "@jest/globals";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorCriteriaEvaluator from "../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MetricWindowCoverage from "../../../Server/Utils/Monitor/Criteria/MetricWindowCoverage";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MetricCriteriaContext, {
  MetricForecastDetails,
} from "../../../Types/Monitor/MetricMonitor/MetricCriteriaContext";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { NO_BREAK_SPACE } from "../../../Types/NoBreakSpaces";
import ObjectID from "../../../Types/ObjectID";
import { createTranslator, Translator } from "../../../Types/Translator";
import { MarkdownText, mdText } from "../../../Utils/Markdown/FeedMarkdown";
import MetricValueFormatter from "../../../Utils/Monitor/MetricValueFormatter";
import MonitorRootCauseWording from "../../../Utils/Monitor/MonitorRootCauseWording";
import {
  readWrittenDuration,
  wordRootCauseFact,
} from "../../../Utils/Monitor/RootCauseFacts";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A METRIC CRITERIA'S LINES IN A ROOT CAUSE, IN THE READER'S LANGUAGE
 * (#8674).
 *
 * A metric criteria's root cause says what it read and when - "- Time
 * Window: last 5 minutes", "- Data Arrives: about 2 minutes late" - and a
 * forecast's says where the trend goes: "- Trend: rising 1% a day over the
 * last 7 days, from 168 samples", "- In 7 days: **91.5%**", "- Reaches
 * 90%: in about 5 days". The engine writes them in English, so a German or
 * Persian page read them in English. They are read back now when they are
 * exactly what the engine writes, and worded with the reader's plurals and
 * digits; the metric's own values stay as the metric formatter wrote them.
 * English reads the root cause as stored, byte for byte.
 */

type EvaluatorPrivate = {
  buildMetricRootCauseContext: (input: {
    criteriaInstance: MonitorCriteriaInstance;
    monitor: Monitor;
    monitorStep?: MonitorStep | undefined;
  }) => MarkdownText | null;
};

const Evaluator: EvaluatorPrivate =
  MonitorCriteriaEvaluator as unknown as EvaluatorPrivate;

const DAY: number = 24 * 60 * 60 * 1000;
const MINUTE: number = 60 * 1000;

function percent(value: number): string {
  return MetricValueFormatter.format({ value: value, unit: "%" });
}

function forecast(
  overrides: Partial<MetricForecastDetails> = {},
): MetricForecastDetails {
  return {
    state: "Forecast",
    direction: "above",
    threshold: 90,
    horizonInHours: 168,
    windowMs: 7 * DAY,
    sampleCount: 168,
    historyMs: 167 * 60 * 60 * 1000,
    requiredHistoryMs: 3.5 * DAY,
    sinceNewestMs: 0,
    currentValue: 84.5,
    projectedValue: 91.5,
    slopePerDay: 1,
    reachesThresholdInMs: 5.5 * DAY,
    ...overrides,
  };
}

// A metric criteria's root cause context, as the engine writes it.
function engineRootCause(context: Partial<MetricCriteriaContext>): string {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.MetricValue,
        filterType: context.forecast
          ? FilterType.ForecastAbove
          : FilterType.GreaterThan,
        value: 90,
        metricCriteriaContext: {
          metricName: "system.filesystem.utilization",
          alias: "disk",
          unit: "%",
          aggregationType: null,
          isFormula: false,
          filterAttributes: {},
          groupBy: [],
          ...context,
        } as MetricCriteriaContext,
      } as CriteriaFilter,
    ],
    incidents: [],
    alerts: [],
    name: "Disk filling up",
    description: "Disk filling up",
    id: ObjectID.generate().toString(),
  };

  const markdown: MarkdownText | null = Evaluator.buildMetricRootCauseContext({
    criteriaInstance: instance,
    monitor: new Monitor(),
  });

  expect(markdown).not.toBeNull();

  return markdown!.toString();
}

function word(
  rootCause: string,
  language: string,
  setsValuesApart: boolean = false,
): string {
  return MonitorRootCauseWording.wordRootCause({
    rootCause: rootCause,
    translator: dashboardTranslator(language),
    setsValuesApart: setsValuesApart,
  });
}

// A text with its isolates' marks left out, and each no-break space a plain one.
function plain(text: string): string {
  return withoutIsolateMarks(text).split(NO_BREAK_SPACE).join(" ");
}

// The worded line that holds `start`'s place: the same index as the stored one.
function lineLike(stored: string, worded: string, start: string): string {
  const index: number = stored.split("\n").findIndex((line: string) => {
    return line.startsWith(start);
  });

  expect(index).toBeGreaterThanOrEqual(0);

  return worded.split("\n")[index] as string;
}

const METRIC_ROOT_CAUSE: string = engineRootCause({
  timeWindowMinutes: 5,
  dataLagMs: 12 * MINUTE,
});

const FORECAST_ROOT_CAUSE: string = engineRootCause({ forecast: forecast() });

const FALLING_ROOT_CAUSE: string = engineRootCause({
  forecast: forecast({
    direction: "below",
    threshold: 10,
    horizonInHours: 12,
    windowMs: 3 * 60 * 60 * 1000,
    sampleCount: 1,
    slopePerDay: -48,
    reachesThresholdInMs: 0,
  }),
});

describe("the lines as the engine writes them", () => {
  test("Time Window, Data Arrives and the Forecast section", () => {
    expect(METRIC_ROOT_CAUSE).toContain("- Time Window: last 5 minutes");
    expect(METRIC_ROOT_CAUSE).toContain(
      "- Data Arrives: about 12 minutes late",
    );
    expect(FORECAST_ROOT_CAUSE).toContain(
      `- Now, on its trend: **${percent(84.5)}**`,
    );
    expect(FORECAST_ROOT_CAUSE).toContain(`- In 7 days: **${percent(91.5)}**`);
    expect(FORECAST_ROOT_CAUSE).toContain(
      `- Trend: rising ${percent(1)} a day over the last 7 days, from 168 samples`,
    );
    expect(FORECAST_ROOT_CAUSE).toContain(
      `- Reaches ${percent(90)}: in about 5 days`,
    );
    expect(FALLING_ROOT_CAUSE).toContain(
      `- Trend: falling ${percent(2)} an hour over the last 3 hours, from 1 sample`,
    );
    expect(FALLING_ROOT_CAUSE).toContain(`- In 12 hours: **`);
    expect(FALLING_ROOT_CAUSE).toContain(
      `- Reaches ${percent(10)}: already below it`,
    );
  });

  test("a duration as describeDuration writes it is read back, and no other", () => {
    for (const ms of [
      30 * 1000,
      MINUTE,
      5 * MINUTE,
      90 * MINUTE,
      3 * 60 * MINUTE,
      5 * DAY,
    ]) {
      const written: string = MetricWindowCoverage.describeDuration(ms);

      expect({ written, read: readWrittenDuration(written) !== null }).toEqual({
        written,
        read: true,
      });
    }

    for (const text of [
      "1 minutes",
      "2 minute",
      "0 minutes",
      "05 minutes",
      "2 weeks",
      "a minute",
      "less than an hour",
    ]) {
      expect({ text, read: readWrittenDuration(text) }).toEqual({
        text,
        read: null,
      });
    }
  });
});

describe("in English", () => {
  test("byte for byte as stored", () => {
    for (const rootCause of [
      METRIC_ROOT_CAUSE,
      FORECAST_ROOT_CAUSE,
      FALLING_ROOT_CAUSE,
    ]) {
      expect(word(rootCause, "en")).toBe(rootCause);
      expect(word(rootCause, "en", true)).toBe(rootCause);
    }
  });
});

describe("in German", () => {
  test("Time Window and Data Arrives", () => {
    const worded: string = word(METRIC_ROOT_CAUSE, "de");
    const de: Record<string, string> = readDashboardLocale("de");

    expect(lineLike(METRIC_ROOT_CAUSE, worded, "- Time Window:")).toBe(
      `- ${de["Time Window"]}: letzte 5 Minuten`,
    );
    expect(plain(lineLike(METRIC_ROOT_CAUSE, worded, "- Data Arrives:"))).toBe(
      `- ${de["Data Arrives"]}: etwa 12 Minuten zu spät`,
    );
  });

  test("the Forecast section, the metric's values as written", () => {
    const worded: string = word(FORECAST_ROOT_CAUSE, "de");

    expect(lineLike(FORECAST_ROOT_CAUSE, worded, "- Now, on its trend:")).toBe(
      `- Jetzt, laut Trend: **${percent(84.5)}**`,
    );
    /*
     * Placed as text, as the engine placed its label: its brackets escaped.
     * Intl's "7 Tage", its number held to its unit (DateLanguage, #8456).
     */
    expect(lineLike(FORECAST_ROOT_CAUSE, worded, "- In 7 days:")).toBe(
      mdText`- ${`Am Ende des Zeitraums (7${NO_BREAK_SPACE}Tage)`}: **${percent(91.5)}**`.toString(),
    );
    expect(plain(lineLike(FORECAST_ROOT_CAUSE, worded, "- Trend:"))).toBe(
      `- ${readDashboardLocale("de")["Trend"]}: steigt um ${percent(1)} pro Tag über 7 Tage, aus 168 Samples`,
    );
    expect(plain(lineLike(FORECAST_ROOT_CAUSE, worded, "- Reaches"))).toBe(
      `- Erreicht ${percent(90)}: noch etwa 5 Tage`,
    );
  });

  test("a falling trend, one sample and a threshold already passed", () => {
    const worded: string = plain(word(FALLING_ROOT_CAUSE, "de"));

    expect(worded).toContain(
      `fällt um ${percent(2)} pro Stunde über 3 Stunden, aus 1 Sample`,
    );
    expect(worded).toContain(`- Erreicht ${percent(10)}: bereits darunter`);
  });

  /*
   * A duration is each language's own numeral phrase (Intl's long unit),
   * not a label's plural: Russian "7 дней", "3 часа", never "7 дн.";
   * Arabic "7 أيام", never "الأيام: 7".
   */
  test("Russian and Arabic say a duration as a sentence does", () => {
    const russian: string = plain(word(FORECAST_ROOT_CAUSE, "ru"));
    const russianFalling: string = plain(word(FALLING_ROOT_CAUSE, "ru"));
    const arabic: string = plain(word(FORECAST_ROOT_CAUSE, "ar"));

    expect(russian).toContain("за последние 7 дней");
    expect(russian).not.toContain("дн.");
    expect(russianFalling).toContain("за последние 3 часа");
    expect(arabic).toContain("7 أيام");
    expect(arabic).not.toContain("الأيام: 7");
  });

  /*
   * Intl's duration is asked of DateLanguage, which holds its number to its
   * unit (#8456): a narrow line never ends on "7" and starts on "дней".
   */
  test("a duration's number is held to its unit in Russian, Arabic and German", () => {
    const russian: string = withoutIsolateMarks(
      word(FORECAST_ROOT_CAUSE, "ru"),
    );
    const russianFalling: string = withoutIsolateMarks(
      word(FALLING_ROOT_CAUSE, "ru"),
    );
    const arabic: string = withoutIsolateMarks(word(FORECAST_ROOT_CAUSE, "ar"));
    const german: string = withoutIsolateMarks(word(METRIC_ROOT_CAUSE, "de"));

    expect(russian).toContain(`7${NO_BREAK_SPACE}дней`);
    expect(russian).not.toContain("7 дней");
    expect(russianFalling).toContain(`3${NO_BREAK_SPACE}часа`);
    expect(russianFalling).not.toContain("3 часа");
    expect(arabic).toContain(`7${NO_BREAK_SPACE}أيام`);
    expect(arabic).not.toContain("7 أيام");
    expect(german).toContain(`etwa 12${NO_BREAK_SPACE}Minuten zu spät`);
    expect(german).not.toContain("12 Minuten zu spät");
  });

  test("an engine that cannot write a unit says the duration with the reader's plural", () => {
    const original: typeof Intl.NumberFormat = Intl.NumberFormat;
    const withoutUnits: typeof Intl.NumberFormat = function (
      locales?: string | Array<string>,
      options?: Intl.NumberFormatOptions,
    ): Intl.NumberFormat {
      if (options && options.style === "unit") {
        throw new RangeError("this engine has no unit style");
      }

      return new original(locales, options);
    } as unknown as typeof Intl.NumberFormat;

    Intl.NumberFormat = withoutUnits;

    try {
      const german: string = plain(word(FORECAST_ROOT_CAUSE, "de"));
      const plural: string = dashboardTranslator("de").translatePlural(
        { one: "{{count}} day", other: "{{count}} days" },
        7,
      );

      expect(plain(plural)).toBe("7 Tage");
      expect(german).toContain(`(${plain(plural)})`);
      expect(german).toContain("noch etwa 5 Tage");
    } finally {
      Intl.NumberFormat = original;
    }

    // Negative control: Intl back, the duration is Intl's again, held.
    expect(withoutIsolateMarks(word(FORECAST_ROOT_CAUSE, "ru"))).toContain(
      `7${NO_BREAK_SPACE}дней`,
    );
  });
});

describe.each(["es", "ar", "fa"])("in %s", (language: string) => {
  test("every metric line in the reader's words and digits", () => {
    const metric: string = plain(word(METRIC_ROOT_CAUSE, language, true));
    const forecastText: string = plain(
      word(FORECAST_ROOT_CAUSE, language, true),
    );
    const words: Record<string, string> = readDashboardLocale(language);

    for (const english of [
      "last 5 minutes",
      "about 12 minutes late",
      "Now, on its trend",
      "In 7 days",
      "rising",
      "over the last",
      "Reaches",
      "in about",
    ]) {
      expect({
        language,
        english,
        left: `${metric}\n${forecastText}`.includes(english),
      }).toEqual({ language, english, left: false });
    }

    expect(forecastText).toContain(words["Now, on its trend"] as string);
    // The metric's own values, as the metric formatter wrote them.
    expect(forecastText).toContain(percent(91.5));

    if (language === "fa") {
      expect(metric).toContain("۱۲");
      expect(metric).toContain("۵");
    }
  });
});

describe.each(DASHBOARD_LANGUAGES)("in %s", (language: string) => {
  test("no metric line is left in English", () => {
    const text: string = plain(
      [METRIC_ROOT_CAUSE, FORECAST_ROOT_CAUSE, FALLING_ROOT_CAUSE]
        .map((rootCause: string): string => {
          return word(rootCause, language, true);
        })
        .join("\n"),
    );

    for (const english of [
      "last 5 minutes",
      "minutes late",
      "Now, on its trend",
      "In 7 days",
      "In 12 hours",
      "over the last",
      "Reaches",
      "in about",
      "already below it",
    ]) {
      expect({ language, english, left: text.includes(english) }).toEqual({
        language,
        english,
        left: false,
      });
    }
  });
});

describe("a line the engine did not write stays as stored", () => {
  test.each([
    ["Time Window", "last 5 hours"],
    ["Time Window", "the last 5 minutes"],
    ["Data Arrives", "about 2 weeks late"],
    ["Data Arrives", "about 1 minutes late"],
    ["Trend", "rising fast"],
    ["Trend", "flat over the last 7 days, from 168 sample"],
    ["Trend", "rising 1% a week over the last 7 days, from 2 samples"],
  ])("%s: %s", (label: string, value: string) => {
    expect(
      wordRootCauseFact({
        label: label,
        value: value,
        translator: dashboardTranslator("de"),
      }),
    ).toBeNull();
  });

  test("an edited forecast line keeps its words", () => {
    for (const line of [
      "- In 7 weeks: **91.5%**",
      "- Reaches 90%: in about a week",
      "- Reaches 90%: already past it",
      "- Now, on its trend: 84.5%",
    ]) {
      expect({ line, worded: word(line, "de") }).toEqual({
        line,
        worded: line,
      });
    }
  });

  test("a language with no wording of a line keeps it as stored", () => {
    const silent: Translator = createTranslator((): undefined => {
      return undefined;
    }, "de");

    expect(
      MonitorRootCauseWording.wordRootCause({
        rootCause: FORECAST_ROOT_CAUSE,
        translator: silent,
      }),
    ).toBe(FORECAST_ROOT_CAUSE);
  });
});
