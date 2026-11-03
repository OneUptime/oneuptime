import { describe, expect, test } from "@jest/globals";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import japaneseLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import {
  formatForecastHorizon,
  getComparisonChoices,
  getForecastHorizonChoices,
  getRuleSentence,
  TelemetryRuleChoice,
  TelemetryRuleCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/TelemetryRule/TelemetryRuleText";
import { getForecastStart } from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/TelemetryRule/TelemetryRuleEditor";
import CriteriaFilterUiUtil, {
  METRIC_FORECAST_ABOVE_LABEL,
  METRIC_FORECAST_BELOW_LABEL,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import CriteriaNameUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaName";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  FORECAST_HORIZON_IN_HOURS_OPTIONS,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorType from "../../../Types/Monitor/MonitorType";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * The words of a forecast rule on a Metrics monitor: the two conditions,
 * the Within choices, the sentence the rule is said back in, and what a
 * rule switched to a forecast starts with - in English and, through the
 * Dashboard's own locale files, in German and Japanese, so a missing or
 * broken translation of what a person reads before saving fails here.
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
const JAPANESE: Translator = translatorFor(
  japaneseLocale as unknown as Locale,
  "ja",
);

function sentence(data: {
  filterType: FilterType;
  threshold: number | undefined;
  horizonInHours?: number | undefined;
  translator?: Translator;
}): string {
  return getRuleSentence({
    monitorType: MonitorType.Metrics,
    rule: {
      filterType: data.filterType,
      threshold: data.threshold,
      windowInSeconds: undefined,
      rollingTime: RollingTime.Past7Days,
      metricAggregationType: EvaluateOverTimeType.AllValues,
      ...(data.horizonInHours
        ? { forecast: { horizonInHours: data.horizonInHours } }
        : {}),
    },
    translator: data.translator || ENGLISH,
    metricName: "Disk Used",
    unit: "%",
  });
}

describe("the forecast conditions of a Metrics rule", () => {
  test("come after the anomaly conditions, and only for a metric", () => {
    const metric: Array<TelemetryRuleChoice<FilterType>> = getComparisonChoices(
      { monitorType: MonitorType.Metrics },
    );

    expect(
      metric.slice(-2).map((choice: TelemetryRuleChoice<FilterType>) => {
        return [choice.value, choice.label];
      }),
    ).toEqual([
      [FilterType.ForecastAbove, "Forecast to rise above"],
      [FilterType.ForecastBelow, "Forecast to fall below"],
    ]);

    for (const monitorType of [
      MonitorType.Logs,
      MonitorType.Traces,
      MonitorType.Exceptions,
    ]) {
      expect(
        getComparisonChoices({ monitorType }).map(
          (choice: TelemetryRuleChoice<FilterType>) => {
            return choice.value;
          },
        ),
      ).not.toContain(FilterType.ForecastAbove);
    }
  });

  test("are said back as where the trend is headed, and by when", () => {
    expect(
      sentence({
        filterType: FilterType.ForecastAbove,
        threshold: 90,
        horizonInHours: 168,
      }),
    ).toBe(
      "Alerts when the trend of Disk Used over the last 7 days is forecast to rise above 90 % within 7 days.",
    );
    expect(
      sentence({
        filterType: FilterType.ForecastBelow,
        threshold: 10,
        horizonInHours: 12,
      }),
    ).toBe(
      "Alerts when the trend of Disk Used over the last 7 days is forecast to fall below 10 % within 12 hours.",
    );
  });

  test("ask for the value before it is entered, and look a week ahead unless told otherwise", () => {
    expect(
      sentence({ filterType: FilterType.ForecastAbove, threshold: undefined }),
    ).toBe(
      "Alerts when the trend of Disk Used over the last 7 days is forecast to rise above the value you enter within 7 days.",
    );
    expect(
      sentence({ filterType: FilterType.ForecastBelow, threshold: undefined }),
    ).toBe(
      "Alerts when the trend of Disk Used over the last 7 days is forecast to fall below the value you enter within 7 days.",
    );
  });

  test("are said whole in German and Japanese, never with English inside", () => {
    const german: string = sentence({
      filterType: FilterType.ForecastAbove,
      threshold: 90,
      horizonInHours: 168,
      translator: GERMAN,
    });
    const japanese: string = sentence({
      filterType: FilterType.ForecastBelow,
      threshold: 10,
      horizonInHours: 24,
      translator: JAPANESE,
    });

    expect(german).toContain("voraussichtlich über 90 % steigt");
    expect(german).toContain("Prognosezeitraum: 7 Tage");
    expect(german).not.toContain("forecast");
    expect(japanese).toContain("10 %を下回ると予測される");
    expect(japanese).not.toContain("forecast");
  });

  test("offer every horizon from an hour to a month, a horizon of its own kept", () => {
    expect(
      getForecastHorizonChoices({ current: 168, translator: ENGLISH }).map(
        (choice: TelemetryRuleChoice<number>) => {
          return [choice.value, choice.label];
        },
      ),
    ).toEqual([
      [1, "1 hour"],
      [6, "6 hours"],
      [12, "12 hours"],
      [24, "1 day"],
      [72, "3 days"],
      [168, "7 days"],
      [336, "14 days"],
      [720, "30 days"],
    ]);
    expect(
      getForecastHorizonChoices({ current: 168, translator: ENGLISH }).map(
        (choice: TelemetryRuleChoice<number>) => {
          return choice.value;
        },
      ),
    ).toEqual([...FORECAST_HORIZON_IN_HOURS_OPTIONS]);

    // 48 hours, written through the API: offered back, as days.
    expect(
      getForecastHorizonChoices({ current: 48, translator: ENGLISH }).find(
        (choice: TelemetryRuleChoice<number>) => {
          return choice.value === 48;
        },
      ),
    ).toEqual({ value: 48, label: "2 days" });
    expect(formatForecastHorizon(36, ENGLISH)).toBe("36 hours");
    expect(formatForecastHorizon(168, GERMAN)).toBe("7 Tage");
    expect(formatForecastHorizon(1, GERMAN)).toBe("1 Stunde");
  });

  test("have a Within field and a hint in every language's words", () => {
    expect(TelemetryRuleCopy.forecastHorizonTitle).toBe("Within");
    expect(GERMAN.translateText(TelemetryRuleCopy.forecastHorizonTitle)).toBe(
      "Prognosezeitraum",
    );
    expect(GERMAN.translateText(TelemetryRuleCopy.forecastHint)).not.toBe(
      TelemetryRuleCopy.forecastHint,
    );
  });
});

describe("a rule switched to a forecast", () => {
  test("starts a week ahead, over the last 7 days when it read under an hour", () => {
    expect(
      getForecastStart({
        rule: {
          filterType: FilterType.GreaterThan,
          rollingTime: RollingTime.Past5Minutes,
          forecast: undefined,
        },
        filterType: FilterType.ForecastAbove,
      }),
    ).toEqual({
      forecast: { horizonInHours: 168 },
      rollingTime: RollingTime.Past7Days,
    });
  });

  test("keeps a window of an hour or more, and a horizon it was given before", () => {
    expect(
      getForecastStart({
        rule: {
          filterType: FilterType.GreaterThan,
          rollingTime: RollingTime.Past14Days,
          forecast: { horizonInHours: 72 },
        },
        filterType: FilterType.ForecastBelow,
      }),
    ).toEqual({ forecast: { horizonInHours: 72 } });
  });

  test("keeps its window when it goes from one forecast to the other", () => {
    expect(
      getForecastStart({
        rule: {
          filterType: FilterType.ForecastAbove,
          rollingTime: RollingTime.Past30Minutes,
          forecast: { horizonInHours: 1 },
        },
        filterType: FilterType.ForecastBelow,
      }),
    ).toEqual({ forecast: { horizonInHours: 1 } });
  });
});

describe("the full criteria editor", () => {
  test("offers the forecasts on a metric value, under their own names, before the data conditions", () => {
    const options: Array<{ value: unknown; label: string }> =
      CriteriaFilterUiUtil.getFilterTypeOptionsByCheckOn(
        CheckOn.MetricValue,
      ) as Array<{ value: unknown; label: string }>;

    expect(
      options.slice(-4).map((option: { value: unknown; label: string }) => {
        return [option.value, option.label];
      }),
    ).toEqual([
      [FilterType.ForecastAbove, METRIC_FORECAST_ABOVE_LABEL],
      [FilterType.ForecastBelow, METRIC_FORECAST_BELOW_LABEL],
      [FilterType.IsEmpty, "Has No Data"],
      [FilterType.IsNotEmpty, "Has Data"],
    ]);
    expect(METRIC_FORECAST_ABOVE_LABEL).toBe("Forecast To Rise Above");
    expect(METRIC_FORECAST_BELOW_LABEL).toBe("Forecast To Fall Below");
  });

  test.each(
    Object.values(CheckOn).filter((checkOn: CheckOn) => {
      return checkOn !== CheckOn.MetricValue;
    }),
  )(
    "offers no forecast on %s: nothing but a metric's series is forecast",
    (checkOn: CheckOn) => {
      const values: Array<unknown> =
        CriteriaFilterUiUtil.getFilterTypeOptionsByCheckOn(checkOn).map(
          (option: { value: unknown }) => {
            return option.value;
          },
        );

      expect(values).not.toContain(FilterType.ForecastAbove);
      expect(values).not.toContain(FilterType.ForecastBelow);
    },
  );

  test("lists a forecast as where it is headed, without the aggregation it ignores", () => {
    const filter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.ForecastBelow,
      value: 10,
      metricMonitorOptions: {
        metricAggregationType: EvaluateOverTimeType.AllValues,
        thresholdUnit: "GB",
        forecast: { horizonInHours: 72 },
      },
    };

    expect(
      CriteriaFilterUiUtil.translateFilterToText(filter, FilterCondition.All),
    ).toBe(
      'Check if "Metric Value" is forecast to fall below 10 GB within 3 days and,',
    );
    expect(
      CriteriaFilterUiUtil.translateFilterToText({
        ...filter,
        filterType: FilterType.ForecastAbove,
        value: 90,
        metricMonitorOptions: { thresholdUnit: "%" },
      }),
    ).toBe(
      'Check if "Metric Value" is forecast to rise above 90 % within 7 days',
    );
  });

  test("names a forecast criteria by its metric and threshold", () => {
    expect(
      CriteriaNameUtil.describeFilter({
        checkOn: CheckOn.MetricValue,
        filterType: FilterType.ForecastAbove,
        value: 90,
        metricMonitorOptions: { metricAlias: "disk" },
      }),
    ).toBe("disk is forecast above 90");
    expect(
      CriteriaNameUtil.describeFilter({
        checkOn: CheckOn.MetricValue,
        filterType: FilterType.ForecastBelow,
        value: 5,
        metricMonitorOptions: { metricAlias: "free" },
      }),
    ).toBe("free is forecast below 5");
  });
});
