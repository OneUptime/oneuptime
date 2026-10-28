import { describe, expect, test } from "@jest/globals";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import russianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/ru.json";
import {
  formatDuration,
  formatWindow,
  getActionChoices,
  getComparisonChoices,
  getCountTitle,
  getPreviewCaption,
  getPreviewVerdict,
  getRollingTimeInSeconds,
  getRuleSentence,
  getShapeProblemText,
  getWindowOptions,
  METRIC_AGGREGATION_CHOICES,
  METRIC_RULE_WINDOW_OPTIONS,
  TELEMETRY_RULE_WINDOW_OPTIONS,
  TelemetryRuleChoice,
  TelemetryRuleCopy,
  TelemetryRuleWindowOption,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/TelemetryRule/TelemetryRuleText";
import {
  getMetricAliasLabel,
  getMetricAliasName,
  getMetricAliasUnit,
  getRuleMetricAlias,
  getRuleSentenceForStep,
  getRuleSentenceUnit,
  getRuleUnits,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/TelemetryRule/TelemetryRuleMetric";
import {
  applyActionChange,
  applyConditionChange,
  getGeneratedTitle,
  getLegacyRuleNames,
  getLegacyTitles,
  getRuleKind,
  opensAlert,
  opensIncident,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/TelemetryRule/TelemetryRuleEdits";
import {
  buildRecipeRule,
  getRecipe,
  TelemetryRuleRecipe,
  TelemetryRuleRecipeKey,
  TelemetryRuleSeeds,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/TelemetryRule/TelemetryRuleRecipes";
import {
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { MonitorStepMetricMonitorUtil } from "../../../Types/Monitor/MonitorStepMetricMonitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  TelemetryAlertRule,
  TelemetryAlertRuleAction,
  TelemetryAlertRuleRecovery,
  TelemetryAlertRuleShapeProblem,
} from "../../../Types/Monitor/TelemetryAlertRule";
import { TelemetryRulePreviewSummary } from "../../../Types/Monitor/TelemetryRulePreview";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * The words of a telemetry monitor's rule: the windows it counts over, its
 * conditions, the one sentence it is said back in, what its preview found,
 * the metric a Metrics rule reads by the names a person knows - and how a
 * rule's name and the title of what it opens follow an edit of the rule
 * while OneUptime wrote them, and stay once a person typed their own.
 *
 * Said in English, and - through the Dashboard's own locale files - in
 * German, Persian and Russian, so a missing or broken translation of the
 * sentence a person reads before saving fails here.
 */

type Locale = Record<string, string>;

const translatorFor: (locale: Locale, language: string) => Translator = (
  locale: Locale,
  language: string,
): Translator => {
  return createTranslator((text: string) => {
    return locale[text];
  }, language);
};

const ENGLISH: Translator = translatorFor(
  englishLocale as unknown as Locale,
  "en",
);
const GERMAN: Translator = translatorFor(
  germanLocale as unknown as Locale,
  "de",
);
const PERSIAN: Translator = translatorFor(
  persianLocale as unknown as Locale,
  "fa",
);
const RUSSIAN: Translator = translatorFor(
  russianLocale as unknown as Locale,
  "ru",
);

const DEGRADED: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OFFLINE: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const SEEDS: TelemetryRuleSeeds = {
  monitorName: "Checkout",
  operationalStatusId: new ObjectID("11111111-1111-4111-8111-111111111111"),
  degradedStatusId: DEGRADED,
  offlineStatusId: OFFLINE,
  incidentSeverityId: new ObjectID("44444444-4444-4444-8444-444444444444"),
  alertSeverityId: new ObjectID("55555555-5555-4555-8555-555555555555"),
};

type CountRule = Pick<
  TelemetryAlertRule,
  | "filterType"
  | "threshold"
  | "windowInSeconds"
  | "rollingTime"
  | "metricAggregationType"
>;

const countRule: (
  filterType: FilterType,
  threshold: number | undefined,
  windowInSeconds?: number,
) => CountRule = (
  filterType: FilterType,
  threshold: number | undefined,
  windowInSeconds: number = 300,
): CountRule => {
  return {
    filterType,
    threshold,
    windowInSeconds,
    rollingTime: undefined,
    metricAggregationType: undefined,
  };
};

const recipeRule: (key: TelemetryRuleRecipeKey) => TelemetryAlertRule = (
  key: TelemetryRuleRecipeKey,
): TelemetryAlertRule => {
  const recipe: TelemetryRuleRecipe | null = getRecipe(key);

  if (!recipe) {
    throw new Error(`No recipe ${key}`);
  }

  return buildRecipeRule({ recipe, seeds: SEEDS, translator: ENGLISH });
};

const labels: <T>(choices: Array<TelemetryRuleChoice<T>>) => Array<string> = <
  T,
>(
  choices: Array<TelemetryRuleChoice<T>>,
): Array<string> => {
  return choices.map((choice: TelemetryRuleChoice<T>) => {
    return choice.label;
  });
};

describe("the windows a rule counts over", () => {
  test("a count rule offers the windows its form always did, and ten minutes for the stop recipes", () => {
    expect(
      TELEMETRY_RULE_WINDOW_OPTIONS.map((option: TelemetryRuleWindowOption) => {
        return option.value;
      }),
    ).toEqual([5, 10, 30, 60, 300, 600, 900, 1800, 3600, 21600, 43200, 86400]);

    expect(
      TELEMETRY_RULE_WINDOW_OPTIONS.find(
        (option: TelemetryRuleWindowOption) => {
          return option.value === 600;
        },
      )?.label,
    ).toBe("Last 10 minutes");
  });

  test("every window's label is a word the Dashboard translates", () => {
    for (const option of TELEMETRY_RULE_WINDOW_OPTIONS) {
      expect(GERMAN.hasTranslation(option.label)).toBe(true);
      expect(PERSIAN.hasTranslation(option.label)).toBe(true);
    }

    for (const option of METRIC_RULE_WINDOW_OPTIONS) {
      expect(GERMAN.hasTranslation(option.label)).toBe(true);
    }
  });

  test("a stored window no option has is added in its place, so the dropdown never drops it", () => {
    expect(getWindowOptions(undefined)).toBe(TELEMETRY_RULE_WINDOW_OPTIONS);
    expect(getWindowOptions(300)).toBe(TELEMETRY_RULE_WINDOW_OPTIONS);

    const withNinety: Array<TelemetryRuleWindowOption> = getWindowOptions(90);

    expect(
      withNinety.map((option: TelemetryRuleWindowOption) => {
        return option.value;
      }),
    ).toEqual([
      5, 10, 30, 60, 90, 300, 600, 900, 1800, 3600, 21600, 43200, 86400,
    ]);
    expect(
      withNinety.find((option: TelemetryRuleWindowOption) => {
        return option.value === 90;
      })?.label,
    ).toBe("90s");
  });

  test("a metric rule's window is any rolling time, in order", () => {
    const seconds: Array<number> = METRIC_RULE_WINDOW_OPTIONS.map(
      (option: { value: RollingTime }) => {
        return getRollingTimeInSeconds(option.value);
      },
    );

    expect(seconds).toEqual(
      [...seconds].sort((a: number, b: number) => {
        return a - b;
      }),
    );
    expect(getRollingTimeInSeconds(RollingTime.Past5Minutes)).toBe(300);
    expect(getRollingTimeInSeconds(RollingTime.Past1Hours)).toBe(86400);
    expect(
      METRIC_RULE_WINDOW_OPTIONS.find((option: { value: RollingTime }) => {
        return option.value === RollingTime.Past1Hours;
      })?.label,
    ).toBe("Last 24 hours");
  });

  test("a window is said in its largest whole unit, in the reader's language", () => {
    expect(formatWindow(300, ENGLISH)).toBe("5 minutes");
    expect(formatWindow(60, ENGLISH)).toBe("1 minute");
    expect(formatWindow(600, ENGLISH)).toBe("10 minutes");
    expect(formatWindow(3600, ENGLISH)).toBe("1 hour");
    expect(formatWindow(86400, ENGLISH)).toBe("1 day");
    expect(formatWindow(90, ENGLISH)).toBe("90 seconds");
    expect(formatWindow(300, GERMAN)).toBe("5 Minuten");
    expect(formatWindow(300, PERSIAN)).toContain("۵");
  });

  test("a length of time is said in its two largest units", () => {
    expect(formatDuration(19500, ENGLISH)).toBe("5 hours, 25 minutes");
    expect(formatDuration(3600, ENGLISH)).toBe("1 hour");
    expect(formatDuration(90061, ENGLISH)).toBe("1 day, 1 hour");
    expect(formatDuration(0, ENGLISH)).toBe("1 second");
    expect(formatDuration(19500, GERMAN)).toContain("5 Stunden");
  });
});

describe("the conditions a rule offers", () => {
  test("a count is more or fewer than a number, or unusual for the hour", () => {
    expect(
      labels(getComparisonChoices({ monitorType: MonitorType.Logs })),
    ).toEqual([
      "More than",
      "At least",
      "Fewer than",
      "At most",
      "Exactly",
      "Unusually high",
      "Unusually low",
      "Unusually high or low",
    ]);
    expect(
      labels(getComparisonChoices({ monitorType: MonitorType.Traces })),
    ).toEqual(labels(getComparisonChoices({ monitorType: MonitorType.Logs })));
  });

  test("exceptions have no baseline, so no 'unusually'", () => {
    expect(
      labels(getComparisonChoices({ monitorType: MonitorType.Exceptions })),
    ).toEqual(["More than", "At least", "Fewer than", "At most", "Exactly"]);
  });

  test("a metric is above or below a value", () => {
    expect(
      labels(getComparisonChoices({ monitorType: MonitorType.Metrics })),
    ).toEqual([
      "Above",
      "At or above",
      "Below",
      "At or below",
      "Exactly",
      "Unusually high",
      "Unusually low",
      "Unusually high or low",
    ]);
  });

  test("a stored 'not equal to' is offered back to the rule that holds it, and to no other", () => {
    expect(
      labels(
        getComparisonChoices({
          monitorType: MonitorType.Logs,
          current: FilterType.NotEqualTo,
        }),
      ),
    ).toContain("Anything but");
    expect(
      labels(getComparisonChoices({ monitorType: MonitorType.Logs })),
    ).not.toContain("Anything but");
  });

  test("a metric's value is read as one of six measures, worded plainly", () => {
    expect(labels(METRIC_AGGREGATION_CHOICES)).toEqual([
      "The average",
      "The highest value",
      "The lowest value",
      "The sum",
      "Every value (the whole window)",
      "Any value (at any point)",
    ]);
  });

  test("a rule opens an alert, an incident or both; status only when it already does", () => {
    expect(labels(getActionChoices(TelemetryAlertRuleAction.Alert))).toEqual([
      "Create an alert",
      "Declare an incident",
      "Both",
    ]);
    expect(
      labels(getActionChoices(TelemetryAlertRuleAction.StatusOnly)),
    ).toEqual([
      "Create an alert",
      "Declare an incident",
      "Both",
      "Only change the monitor's status",
    ]);
  });

  test("each kind of count is named for what it counts", () => {
    expect(getCountTitle(MonitorType.Logs)).toBe("Number of logs");
    expect(getCountTitle(MonitorType.Traces)).toBe("Number of spans");
    expect(getCountTitle(MonitorType.Exceptions)).toBe("Number of exceptions");
    expect(getCountTitle(MonitorType.Metrics)).toBe("Value");
  });

  test("criteria that are not one rule say why, in one line", () => {
    expect(
      getShapeProblemText(TelemetryAlertRuleShapeProblem.SeveralRules),
    ).toBe(
      "These criteria are more than one rule, so each one is shown in full.",
    );
    expect(
      getShapeProblemText(TelemetryAlertRuleShapeProblem.DisabledRule),
    ).toBe(
      "This rule is turned off, so it is shown in full. Turn it on there.",
    );
    expect(
      getShapeProblemText(TelemetryAlertRuleShapeProblem.SeveralFilters),
    ).toBe("This rule has more than one filter, so it is shown in full.");
    expect(
      getShapeProblemText(
        TelemetryAlertRuleShapeProblem.SeveralIncidentsOrAlerts,
      ),
    ).toBe(
      "This rule opens more than one incident or alert, so it is shown in full.",
    );

    for (const problem of [
      TelemetryAlertRuleShapeProblem.OtherCheck,
      TelemetryAlertRuleShapeProblem.UnsupportedCondition,
      TelemetryAlertRuleShapeProblem.GroupedIncidents,
      TelemetryAlertRuleShapeProblem.UnknownMetric,
      TelemetryAlertRuleShapeProblem.NoCriteria,
      null,
    ]) {
      expect(getShapeProblemText(problem)).toBe(
        "These criteria are not one simple rule, so they are shown in full.",
      );
    }
  });

  test("every word of the rule editor is translated into German and Persian", () => {
    for (const text of Object.values(TelemetryRuleCopy)) {
      expect([text, GERMAN.hasTranslation(text)]).toEqual([text, true]);
      expect([text, PERSIAN.hasTranslation(text)]).toEqual([text, true]);
    }
  });
});

describe("the rule said back in one sentence", () => {
  test.each([
    [
      FilterType.GreaterThan,
      10,
      "Alerts when the number of matching logs in 5 minutes is more than 10.",
    ],
    [
      FilterType.GreaterThanOrEqualTo,
      5,
      "Alerts when the number of matching logs in 5 minutes is at least 5.",
    ],
    [
      FilterType.LessThan,
      3,
      "Alerts when the number of matching logs in 5 minutes is fewer than 3.",
    ],
    [
      FilterType.LessThanOrEqualTo,
      3,
      "Alerts when the number of matching logs in 5 minutes is at most 3.",
    ],
    [
      FilterType.EqualTo,
      7,
      "Alerts when the number of matching logs in 5 minutes is exactly 7.",
    ],
    [
      FilterType.EqualTo,
      0,
      "Alerts when no matching logs arrive in 5 minutes.",
    ],
    [
      FilterType.LessThan,
      1,
      "Alerts when no matching logs arrive in 5 minutes.",
    ],
    [
      FilterType.LessThanOrEqualTo,
      0,
      "Alerts when no matching logs arrive in 5 minutes.",
    ],
    [
      FilterType.GreaterThan,
      0,
      "Alerts when any matching log arrives in 5 minutes.",
    ],
    [
      FilterType.GreaterThanOrEqualTo,
      1,
      "Alerts when any matching log arrives in 5 minutes.",
    ],
    [
      FilterType.AnomalouslyHigh,
      undefined,
      "Alerts when matching logs in 5 minutes are unusually many for this hour of the week.",
    ],
    [
      FilterType.AnomalouslyLow,
      undefined,
      "Alerts when matching logs in 5 minutes are unusually few for this hour of the week.",
    ],
    [
      FilterType.Anomalous,
      undefined,
      "Alerts when matching logs in 5 minutes are unusually many or few for this hour of the week.",
    ],
    [
      FilterType.GreaterThan,
      undefined,
      "Alerts when the number of matching logs in 5 minutes is more than the number you enter.",
    ],
  ])(
    "a Logs rule %s %p reads: %s",
    (
      filterType: FilterType,
      threshold: number | undefined,
      sentence: string,
    ) => {
      expect(
        getRuleSentence({
          monitorType: MonitorType.Logs,
          rule: countRule(filterType, threshold),
          translator: ENGLISH,
        }),
      ).toBe(sentence);
    },
  );

  test("a Traces rule speaks of spans, an Exceptions rule of exceptions", () => {
    expect(
      getRuleSentence({
        monitorType: MonitorType.Traces,
        rule: countRule(FilterType.GreaterThan, 10),
        translator: ENGLISH,
      }),
    ).toBe(
      "Alerts when the number of matching spans in 5 minutes is more than 10.",
    );
    expect(
      getRuleSentence({
        monitorType: MonitorType.Traces,
        rule: countRule(FilterType.EqualTo, 0, 600),
        translator: ENGLISH,
      }),
    ).toBe("Alerts when no matching spans arrive in 10 minutes.");
    expect(
      getRuleSentence({
        monitorType: MonitorType.Exceptions,
        rule: countRule(FilterType.GreaterThan, 0),
        translator: ENGLISH,
      }),
    ).toBe("Alerts when any matching exception happens in 5 minutes.");
    expect(
      getRuleSentence({
        monitorType: MonitorType.Exceptions,
        rule: countRule(FilterType.GreaterThan, 20),
        translator: ENGLISH,
      }),
    ).toBe(
      "Alerts when the number of matching exceptions in 5 minutes is more than 20.",
    );
  });

  test("a count in the thousands is written as the reader's language writes it", () => {
    expect(
      getRuleSentence({
        monitorType: MonitorType.Logs,
        rule: countRule(FilterType.GreaterThan, 12500),
        translator: ENGLISH,
      }),
    ).toBe(
      "Alerts when the number of matching logs in 5 minutes is more than 12,500.",
    );
    expect(
      getRuleSentence({
        monitorType: MonitorType.Logs,
        rule: countRule(FilterType.GreaterThan, 12500),
        translator: GERMAN,
      }),
    ).toBe(
      "Alarmiert, wenn die Zahl passender Logs in 5 Minuten mehr als 12.500 ist.",
    );
  });

  test("the sentence is said in German and Persian, with the window and number in it", () => {
    expect(
      getRuleSentence({
        monitorType: MonitorType.Logs,
        rule: countRule(FilterType.EqualTo, 0, 600),
        translator: GERMAN,
      }),
    ).toBe("Alarmiert, wenn in 10 Minuten keine passenden Logs eintreffen.");

    const persian: string = getRuleSentence({
      monitorType: MonitorType.Logs,
      rule: countRule(FilterType.GreaterThan, 10),
      translator: PERSIAN,
    });

    expect(persian).toContain("هشدار");
    expect(persian).toContain("بیشتر از");
    expect(persian).not.toContain("Alerts when");
  });

  test("a Metrics rule names its measure, metric, window, condition, value and unit", () => {
    expect(
      getRuleSentence({
        monitorType: MonitorType.Metrics,
        rule: {
          filterType: FilterType.GreaterThan,
          threshold: 250,
          windowInSeconds: undefined,
          rollingTime: RollingTime.Past5Minutes,
          metricAggregationType: EvaluateOverTimeType.Average,
        },
        translator: ENGLISH,
        metricName: "http.server.duration",
        unit: "ms",
      }),
    ).toBe(
      "Alerts when the average of http.server.duration over the last 5 minutes is above 250 ms.",
    );

    expect(
      getRuleSentence({
        monitorType: MonitorType.Metrics,
        rule: {
          filterType: FilterType.LessThanOrEqualTo,
          threshold: 1,
          windowInSeconds: undefined,
          rollingTime: RollingTime.Past1Hour,
          metricAggregationType: EvaluateOverTimeType.AllValues,
        },
        translator: ENGLISH,
        metricName: "queue.consumers",
      }),
    ).toBe(
      "Alerts when every value of queue.consumers over the last 1 hour is at or below 1.",
    );
  });

  test("before a metric is picked or a value entered, the sentence says so", () => {
    expect(
      getRuleSentence({
        monitorType: MonitorType.Metrics,
        rule: {
          filterType: FilterType.GreaterThan,
          threshold: undefined,
          windowInSeconds: undefined,
          rollingTime: RollingTime.Past5Minutes,
          metricAggregationType: EvaluateOverTimeType.Average,
        },
        translator: ENGLISH,
      }),
    ).toBe(
      "Alerts when the average of the metric over the last 5 minutes is above the value you enter.",
    );
  });

  test("an unusual metric is judged against the same hour of the week", () => {
    expect(
      getRuleSentence({
        monitorType: MonitorType.Metrics,
        rule: {
          filterType: FilterType.AnomalouslyHigh,
          threshold: undefined,
          windowInSeconds: undefined,
          rollingTime: RollingTime.Past15Minutes,
          metricAggregationType: EvaluateOverTimeType.MaximumValue,
        },
        translator: ENGLISH,
        metricName: "cpu",
      }),
    ).toBe(
      "Alerts when the highest value of cpu over the last 15 minutes is unusually high for this hour of the week.",
    );
  });
});

describe("what the rule's preview found", () => {
  const summary: (
    overrides: Partial<TelemetryRulePreviewSummary>,
  ) => TelemetryRulePreviewSummary = (
    overrides: Partial<TelemetryRulePreviewSummary>,
  ): TelemetryRulePreviewSummary => {
    return {
      hasData: true,
      windowCount: 144,
      matchedWindowCount: 0,
      timesItWouldHaveFired: 0,
      highest: 42,
      lowest: 0,
      typical: 12,
      latest: 9,
      ...overrides,
    };
  };

  test("its caption says what each bar counts, and over how long", () => {
    expect(
      getPreviewCaption({
        monitorType: MonitorType.Logs,
        windowInSeconds: 300,
        rangeInSeconds: 43200,
        translator: ENGLISH,
      }),
    ).toBe("Matching logs in each 5 minutes, over the last 12 hours.");
    expect(
      getPreviewCaption({
        monitorType: MonitorType.Traces,
        windowInSeconds: 60,
        rangeInSeconds: 8640,
        translator: ENGLISH,
      }),
    ).toBe("Matching spans in each 1 minute, over the last 144 minutes.");
    expect(
      getPreviewCaption({
        monitorType: MonitorType.Exceptions,
        windowInSeconds: 3600,
        rangeInSeconds: 518400,
        translator: ENGLISH,
      }),
    ).toBe("Matching exceptions in each 1 hour, over the last 6 days.");
    expect(
      getPreviewCaption({
        monitorType: MonitorType.Logs,
        windowInSeconds: 300,
        rangeInSeconds: 43200,
        translator: GERMAN,
      }),
    ).toBe("Passende Logs je 5 Minuten, über die letzten 12 Stunden.");
  });

  test("nothing matched: a rule that looks for silence would alert at once, and says so", () => {
    expect(
      getPreviewVerdict({
        summary: summary({ hasData: false }),
        windowInSeconds: 300,
        matchesNothing: true,
        translator: ENGLISH,
      }),
    ).toBe(
      "Nothing matched in this time, so this rule would alert as soon as the monitor is saved.",
    );
    expect(
      getPreviewVerdict({
        summary: summary({ hasData: false }),
        windowInSeconds: 300,
        matchesNothing: false,
        translator: ENGLISH,
      }),
    ).toBe("Nothing matched in this time.");
  });

  test("a rule that would not have fired says so", () => {
    expect(
      getPreviewVerdict({
        summary: summary({}),
        windowInSeconds: 300,
        matchesNothing: false,
        translator: ENGLISH,
      }),
    ).toBe("This rule would not have alerted in this time.");
  });

  test("a rule that would have fired says how often, and for how long", () => {
    expect(
      getPreviewVerdict({
        summary: summary({ timesItWouldHaveFired: 1, matchedWindowCount: 65 }),
        windowInSeconds: 300,
        matchesNothing: false,
        translator: ENGLISH,
      }),
    ).toBe("This rule would have alerted 1 time, for 5 hours, 25 minutes.");
    expect(
      getPreviewVerdict({
        summary: summary({ timesItWouldHaveFired: 3, matchedWindowCount: 4 }),
        windowInSeconds: 300,
        matchesNothing: false,
        translator: ENGLISH,
      }),
    ).toBe("This rule would have alerted 3 times, for 20 minutes in all.");
  });

  test("German and Persian readers get the count in their own form; Russian says 21 with the 'one' form", () => {
    expect(
      getPreviewVerdict({
        summary: summary({ timesItWouldHaveFired: 2, matchedWindowCount: 2 }),
        windowInSeconds: 300,
        matchesNothing: false,
        translator: GERMAN,
      }),
    ).toBe("Diese Regel hätte 2-mal alarmiert, insgesamt 10 Minuten.");

    expect(
      getPreviewVerdict({
        summary: summary({ timesItWouldHaveFired: 1, matchedWindowCount: 1 }),
        windowInSeconds: 300,
        matchesNothing: false,
        translator: PERSIAN,
      }),
    ).toContain("هشدار");

    const russianOne: string = getPreviewVerdict({
      summary: summary({ timesItWouldHaveFired: 21, matchedWindowCount: 21 }),
      windowInSeconds: 60,
      matchesNothing: false,
      translator: RUSSIAN,
    });

    expect(russianOne).not.toContain("This rule");
    expect(russianOne).toContain("21");
  });
});

describe("the metric a Metrics rule reads", () => {
  const metricStep: () => MonitorStep = (): MonitorStep => {
    const step: MonitorStep = new MonitorStep();
    step.setMetricMonitor({
      ...MonitorStepMetricMonitorUtil.getDefault(),
      metricViewConfig: {
        queryConfigs: [
          {
            metricAliasData: {
              metricVariable: "a",
              title: "CPU",
              description: "",
              legend: "",
              legendUnit: "%",
            },
            metricQueryData: {
              filterData: { metricName: "system.cpu.utilization" },
            },
          },
          {
            metricAliasData: {
              metricVariable: "b",
              title: "",
              description: "",
              legend: "",
              legendUnit: "{message}",
            },
            metricQueryData: {
              filterData: { metricName: "queue.backlog" },
            },
          },
        ],
        formulaConfigs: [
          {
            metricAliasData: {
              metricVariable: "c",
              title: "",
              description: "",
              legend: "",
              legendUnit: "",
            },
            metricFormulaData: { metricFormula: "a / b" },
          },
        ],
      },
    });

    return step;
  };

  test("by its title, else its metric's name, else the formula", () => {
    const step: MonitorStep = metricStep();

    expect(getMetricAliasName({ monitorStep: step, alias: "a" })).toBe("CPU");
    expect(getMetricAliasName({ monitorStep: step, alias: "b" })).toBe(
      "queue.backlog",
    );
    expect(getMetricAliasName({ monitorStep: step, alias: "c" })).toBe("a / b");
    expect(getMetricAliasName({ monitorStep: step, alias: "z" })).toBe(
      undefined,
    );
    // A picker falls back to the alias itself.
    expect(getMetricAliasLabel({ monitorStep: step, alias: "z" })).toBe("z");
  });

  test("the rule reads the alias it names, else the step's first", () => {
    const step: MonitorStep = metricStep();

    expect(
      getRuleMetricAlias({ monitorStep: step, rule: { metricAlias: "c" } }),
    ).toBe("c");
    expect(
      getRuleMetricAlias({
        monitorStep: step,
        rule: { metricAlias: undefined },
      }),
    ).toBe("a");
  });

  test("its value is entered in the metric's unit, or one it converts to", () => {
    const step: MonitorStep = metricStep();

    expect(getMetricAliasUnit({ monitorStep: step, alias: "a" })).toBe("%");

    const units: ReturnType<typeof getRuleUnits> = getRuleUnits({
      monitorStep: step,
      rule: { metricAlias: "a", thresholdUnit: undefined },
    });

    expect(units.value).toBeTruthy();
    expect(
      units.options.some((option: { value: string }) => {
        return option.value === units.value;
      }),
    ).toBe(true);

    // A stored unit is the one shown.
    expect(
      getRuleUnits({
        monitorStep: step,
        rule: { metricAlias: "a", thresholdUnit: "ratio" },
      }).value,
    ).toBe("ratio");
  });

  test("an annotation names what is counted, not a unit: the sentence says no unit", () => {
    expect(
      getRuleSentenceUnit({
        monitorStep: metricStep(),
        rule: { metricAlias: "b", thresholdUnit: undefined },
      }),
    ).toBeUndefined();
  });

  test.each([
    ["%", undefined, "%"],
    ["ms", undefined, "ms"],
    ["s", undefined, "sec"],
    ["By", undefined, "B"],
    ["h", undefined, "hours"],
    ["%", "1", undefined],
    ["1", undefined, "%"],
    ["requests", undefined, "requests"],
    ["", undefined, undefined],
  ])(
    "a metric in %p, its value entered in %p, is said with %p after the value",
    (
      metricUnit: string,
      thresholdUnit: string | undefined,
      said: string | undefined,
    ) => {
      const step: MonitorStep = new MonitorStep();
      step.setMetricMonitor({
        ...MonitorStepMetricMonitorUtil.getDefault(),
        metricViewConfig: {
          queryConfigs: [
            {
              metricAliasData: {
                metricVariable: "a",
                title: "",
                description: "",
                legend: "",
                legendUnit: metricUnit,
              },
              metricQueryData: { filterData: { metricName: "m" } },
            },
          ],
          formulaConfigs: [],
        },
      });

      expect(
        getRuleSentenceUnit({
          monitorStep: step,
          rule: { metricAlias: "a", thresholdUnit },
        }),
      ).toBe(said);
    },
  );

  test("the sentence on the step names the metric by the name a person knows it by", () => {
    const rule: TelemetryAlertRule = {
      ...recipeRule(TelemetryRuleRecipeKey.MetricAbove),
      threshold: 80,
      metricAlias: "a",
    };

    const sentence: string = getRuleSentenceForStep({
      monitorType: MonitorType.Metrics,
      monitorStep: metricStep(),
      rule,
      translator: ENGLISH,
    });

    expect(sentence).toContain("the average of CPU over the last 5 minutes");
    expect(sentence).toContain("above 80");
  });
});

describe("a rule's name and titles follow an edit while OneUptime wrote them", () => {
  const edit: (
    previous: TelemetryAlertRule,
    changes: Partial<TelemetryAlertRule>,
  ) => TelemetryAlertRule = (
    previous: TelemetryAlertRule,
    changes: Partial<TelemetryAlertRule>,
  ): TelemetryAlertRule => {
    return applyConditionChange({
      monitorType: MonitorType.Logs,
      previous,
      next: { ...previous, ...changes },
      monitorName: "Checkout",
      translator: ENGLISH,
    });
  };

  test("a new number keeps a recipe's title, which says what kind of rule it is", () => {
    const rule: TelemetryAlertRule = recipeRule(
      TelemetryRuleRecipeKey.ErrorLogs,
    );
    const edited: TelemetryAlertRule = edit(rule, { threshold: 50 });

    expect(edited.alert?.title).toBe("Checkout: too many errors");
    // The name, written from the filter, follows the number.
    expect(edited.name).not.toBe(rule.name);
    expect(edited.name).toContain("50");
  });

  test("a 'too many' title stays when its number goes down to none at all", () => {
    const rule: TelemetryAlertRule = recipeRule(
      TelemetryRuleRecipeKey.FailedSpans,
    );
    const anyAtAll: TelemetryAlertRule = applyConditionChange({
      monitorType: MonitorType.Traces,
      previous: rule,
      next: { ...rule, threshold: 0 },
      monitorName: "Checkout",
      translator: ENGLISH,
    });

    expect(anyAtAll.alert?.title).toBe("Checkout: too many failed requests");
  });

  test("'a matching log arrived' does not stay when its number goes up: it is not about any log any more", () => {
    const rule: TelemetryAlertRule = recipeRule(
      TelemetryRuleRecipeKey.LogMessage,
    );
    const tooMany: TelemetryAlertRule = edit(rule, { threshold: 10 });

    expect(tooMany.alert?.title).not.toBe("Checkout: a matching log arrived");

    const tooManyOverAnHour: TelemetryAlertRule = edit(rule, {
      threshold: 25,
      windowInSeconds: 3600,
    });

    expect(tooManyOverAnHour.alert?.title).not.toBe(
      "Checkout: a matching log arrived",
    );
    expect(tooManyOverAnHour.alert?.title).toContain("25");
  });

  test("another kind of rule takes the title of its own kind", () => {
    const rule: TelemetryAlertRule = recipeRule(
      TelemetryRuleRecipeKey.ErrorLogs,
    );
    const edited: TelemetryAlertRule = edit(rule, {
      filterType: FilterType.EqualTo,
      threshold: 0,
      windowInSeconds: 600,
    });

    expect(edited.alert?.title).toBe("Checkout: logs stopped");
  });

  test("the titles the out-of-the-box criteria wrote follow any change", () => {
    const rule: TelemetryAlertRule = {
      ...recipeRule(TelemetryRuleRecipeKey.LogsStop),
      name: "Check if Checkout is offline",
      incident: {
        ...recipeRule(TelemetryRuleRecipeKey.LogsStop).incident!,
        title: "Checkout is offline",
      },
    };

    const edited: TelemetryAlertRule = edit(rule, {
      filterType: FilterType.GreaterThan,
      threshold: 10,
      windowInSeconds: 300,
    });

    expect(edited.incident?.title).toBe("Checkout: too many errors");
    expect(edited.name).not.toBe("Check if Checkout is offline");
  });

  test("a name and a title a person typed stay", () => {
    const rule: TelemetryAlertRule = {
      ...recipeRule(TelemetryRuleRecipeKey.ErrorLogs),
      name: "Checkout errors (page Dana)",
      alert: {
        ...recipeRule(TelemetryRuleRecipeKey.ErrorLogs).alert!,
        title: "Checkout is throwing",
      },
    };

    const edited: TelemetryAlertRule = edit(rule, {
      filterType: FilterType.EqualTo,
      threshold: 0,
    });

    expect(edited.name).toBe("Checkout errors (page Dana)");
    expect(edited.alert?.title).toBe("Checkout is throwing");
  });

  test("a rule's kind is what it is about, whatever its number", () => {
    const kind: (filterType: FilterType, threshold: number) => string = (
      filterType: FilterType,
      threshold: number,
    ): string => {
      return getRuleKind({
        monitorType: MonitorType.Logs,
        rule: { filterType, threshold },
      });
    };

    expect(kind(FilterType.GreaterThan, 10)).toBe("above");
    expect(kind(FilterType.GreaterThan, 0)).toBe("any");
    expect(kind(FilterType.GreaterThanOrEqualTo, 1)).toBe("any");
    expect(kind(FilterType.EqualTo, 0)).toBe("none");
    expect(kind(FilterType.LessThan, 1)).toBe("none");
    expect(kind(FilterType.LessThan, 5)).toBe("below");
    expect(kind(FilterType.EqualTo, 3)).toBe("exactly");
    // A metric value of 0 is a value like any other.
    expect(
      getRuleKind({
        monitorType: MonitorType.Metrics,
        rule: { filterType: FilterType.GreaterThan, threshold: 0 },
      }),
    ).toBe("above");
  });

  test("a rule no recipe is gets the monitor's name with the rule's", () => {
    expect(
      getGeneratedTitle({
        monitorType: MonitorType.Logs,
        rule: {
          filterType: FilterType.GreaterThan,
          threshold: 25,
          windowInSeconds: 900,
          metricAlias: undefined,
        },
        monitorName: "Checkout",
        translator: ENGLISH,
      }),
    ).toMatch(/^Checkout: .*25/);
  });

  test("the out-of-the-box words are known for the monitor they name", () => {
    expect(getLegacyRuleNames("Checkout")).toEqual([
      "Check if Checkout is offline",
      "Check if Checkout is online",
      "Check if Checkout has exceptions",
      "Check if Checkout has no exceptions",
    ]);
    expect(getLegacyTitles("Checkout")).toEqual([
      "Checkout is offline",
      "Checkout has exceptions",
    ]);
  });
});

describe("what a rule opens follows the action picked", () => {
  const change: (
    rule: TelemetryAlertRule,
    action: TelemetryAlertRuleAction,
  ) => TelemetryAlertRule = (
    rule: TelemetryAlertRule,
    action: TelemetryAlertRuleAction,
  ): TelemetryAlertRule => {
    return applyActionChange({
      monitorType: MonitorType.Logs,
      rule,
      action,
      seeds: SEEDS,
      translator: ENGLISH,
    });
  };

  test("both: an incident is made, titled like the alert, and the status becomes offline", () => {
    const rule: TelemetryAlertRule = recipeRule(
      TelemetryRuleRecipeKey.ErrorLogs,
    );
    const both: TelemetryAlertRule = change(
      rule,
      TelemetryAlertRuleAction.AlertAndIncident,
    );

    expect(both.action).toBe(TelemetryAlertRuleAction.AlertAndIncident);
    expect(both.incident?.title).toBe("Checkout: too many errors");
    expect(both.incident?.incidentSeverityId).toBe(SEEDS.incidentSeverityId);
    expect(both.incident?.autoResolveIncident).toBe(true);
    expect(both.alert).toBe(rule.alert);
    expect(both.monitorStatusId).toBe(OFFLINE);
  });

  test("an incident instead of an alert keeps the alert's row, for turning it back on", () => {
    const rule: TelemetryAlertRule = recipeRule(
      TelemetryRuleRecipeKey.ErrorLogs,
    );
    const incident: TelemetryAlertRule = change(
      rule,
      TelemetryAlertRuleAction.Incident,
    );

    expect(incident.alert).toBe(rule.alert);
    expect(incident.incident?.title).toBe(rule.alert?.title);
    expect(incident.monitorStatusId).toBe(OFFLINE);
    expect(opensIncident(incident.action)).toBe(true);
    expect(opensAlert(incident.action)).toBe(false);
  });

  test("back to an alert: the status goes back to degraded, the one an alert comes with", () => {
    const rule: TelemetryAlertRule = recipeRule(
      TelemetryRuleRecipeKey.LogsStop,
    );
    const alert: TelemetryAlertRule = change(
      rule,
      TelemetryAlertRuleAction.Alert,
    );

    expect(alert.alert?.title).toBe("Checkout: logs stopped");
    expect(alert.monitorStatusId).toBe(DEGRADED);
  });

  test("a status a person picked stays whatever is opened", () => {
    const rule: TelemetryAlertRule = {
      ...recipeRule(TelemetryRuleRecipeKey.ErrorLogs),
      monitorStatusId: new ObjectID("88888888-8888-4888-8888-888888888888"),
    };

    expect(
      change(
        rule,
        TelemetryAlertRuleAction.Incident,
      ).monitorStatusId?.toString(),
    ).toBe("88888888-8888-4888-8888-888888888888");
  });

  test("only the status: nothing more is made, and the status stays", () => {
    const rule: TelemetryAlertRule = recipeRule(
      TelemetryRuleRecipeKey.ErrorLogs,
    );
    const statusOnly: TelemetryAlertRule = change(
      rule,
      TelemetryAlertRuleAction.StatusOnly,
    );

    expect(statusOnly.incident).toBeUndefined();
    expect(statusOnly.monitorStatusId).toBe(DEGRADED);
    expect(statusOnly.recovery).toBe(TelemetryAlertRuleRecovery.DefaultStatus);
  });
});
