import {
  AnomalyDetectionSensitivity,
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil as CommonCriteriaFilterUtil,
  EVALUATE_OVER_TIME_PERCENTILE_OPTIONS,
  EvaluateOverTimeMinutes,
  EvaluateOverTimeOptions,
  EvaluateOverTimeType,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import {
  DatabaseMetricDefinition,
  getDatabaseMetricByMetricType,
} from "Common/Types/Monitor/DatabaseMetricCatalog";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import { isExceptionMeasure } from "Common/Types/Monitor/ExceptionMonitor/ExceptionMonitorEvaluation";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import {
  TRANSCEIVER_READING_TITLES,
  TRANSCEIVER_READING_UNITS,
  TransceiverReadingKind,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTransceiver";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import { ExternalStatusPageComponentStatusValue } from "Common/Utils/Monitor/ExternalStatusPageComponentStatusUtil";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import {
  composedValue,
  createTranslator,
  DEFAULT_LANGUAGE,
  fillTemplate,
  PluralTemplate,
  TemplateValues,
  translatableTerm,
  translatePlural,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import {
  formatDurationUnit,
  formatReaderFigure,
  isEnglishDateLanguage,
} from "Common/Types/DateLanguage";
import { formatMilliseconds } from "../../Milliseconds";

/*
 * The labels of the numbers an AI / LLM monitor's criteria compare: the
 * CheckOn values getCheckOnOptionsByMonitorType offers for MonitorType.Llm,
 * in that order. The dropdown draws each option's label in the reader's
 * language; spelling them out here is what puts them in the locale files.
 */
export const LLM_CHECK_ON_LABELS: ReadonlyArray<string> = [
  translationKey("Bad AI Answers (in %)"),
  translationKey("Bad AI Answers"),
  translationKey("AI Answers"),
];

// The same for a Profiles monitor's criteria (MonitorType.Profiles).
export const PROFILE_CHECK_ON_LABELS: ReadonlyArray<string> = [
  translationKey("Profile Count"),
  translationKey("Function Share (in %)"),
];

/*
 * The two conditions a metric criteria asks without a threshold: whether
 * its query sent anything in the window (FilterType.IsEmpty / IsNotEmpty,
 * worded for a metric). An infrastructure monitor's out-of-the-box
 * criteria are these two: offline while its agent sends nothing, online
 * while it sends.
 */
export const METRIC_HAS_NO_DATA_LABEL: string = translationKey("Has No Data");
export const METRIC_HAS_DATA_LABEL: string = translationKey("Has Data");

/*
 * The two conditions that compare where a metric is headed with the
 * threshold (FilterType.ForecastAbove / ForecastBelow), worded as the
 * Condition dropdown of the simple rule words them.
 */
export const METRIC_FORECAST_ABOVE_LABEL: string = translationKey(
  "Forecast To Rise Above",
);
export const METRIC_FORECAST_BELOW_LABEL: string = translationKey(
  "Forecast To Fall Below",
);

/*
 * A CRITERIA FILTER, SUMMED UP AS ONE SENTENCE IN THE READER'S LANGUAGE
 * (#8350).
 *
 * The criteria list wrote each filter as an English sentence built by hand
 * - `Check if "Response Time (in ms)" is greater than 500ms and,` - so it
 * read English under a German or a Persian form, its threshold glued to an
 * English "ms" in Latin digits. Each part of it is a whole sentence now,
 * with the part it wraps as a {{placeholder}}, worded in every Dashboard
 * language: what is checked (a check's name, then where - a disk, a path,
 * an interface, a table - then how its window is read), the comparison
 * with the threshold, the window of checks it is judged on, and whether
 * the next filter must match too. Each part goes into the one around it as
 * a composedValue, so the whole summary is in one language: the reader's,
 * or English while their language has not worded one of its sentences.
 *
 * The threshold is a figure in the reader's digits (formatReaderFigure), a
 * percentage with the language's percent sign, a duration in milliseconds
 * with formatMilliseconds ("500 ms", "۵۰۰ میلی‌ثانیه"); a unit the person
 * typed, a text and an expression are put in as typed.
 */

// What is checked: a check's name, in quotes; a name the catalog gives.
const CRITERIA_CHECK_SENTENCE: string = '"{{check}}"';

// Where it is checked.
export const CRITERIA_ON_DISK_SENTENCE: string = translationKey(
  "{{measure}} on {{diskPath}}",
);
export const CRITERIA_AT_PATH_SENTENCE: string = translationKey(
  "{{measure}} at {{path}}",
);
const CRITERIA_READING_SENTENCE: string = "{{measure}} ({{reading}})";
export const CRITERIA_ON_INTERFACE_SENTENCE: string = translationKey(
  "{{measure}} on interface {{interface}}",
);
export const CRITERIA_IN_TABLE_SENTENCE: string = translationKey(
  "{{measure}} in SNMP table {{table}}",
);
export const CRITERIA_IN_TABLE_EACH_ROW_SENTENCE: string = translationKey(
  "{{measure}} in SNMP table {{table}} for each row",
);
export const CRITERIA_IN_TABLE_ROW_SENTENCE: string = translationKey(
  "{{measure}} in SNMP table {{table}} on row {{row}}",
);

// How a window's values are read, around what is checked.
export const CRITERIA_EVALUATE_OVER_TIME_SENTENCES: Readonly<
  Partial<Record<EvaluateOverTimeType, string>>
> = {
  [EvaluateOverTimeType.AllValues]: translationKey("all values of {{measure}}"),
  [EvaluateOverTimeType.AnyValue]: translationKey("any value of {{measure}}"),
  [EvaluateOverTimeType.Average]: translationKey(
    "average value of {{measure}}",
  ),
  [EvaluateOverTimeType.MaximumValue]: translationKey(
    "maximum value of {{measure}}",
  ),
  [EvaluateOverTimeType.MunimumValue]: translationKey(
    "minimum value of {{measure}}",
  ),
  [EvaluateOverTimeType.Sum]: translationKey(
    "sum of all values of {{measure}}",
  ),
  // "p95 of "Response Time (in ms)"", as monitoring tools write it.
  [EvaluateOverTimeType.Percentile]: translationKey(
    "p{{percentile}} of {{measure}}",
  ),
};

/*
 * A window that counts its checks (#10355), around the condition each check
 * is judged by: "Is Online" is false on more than 30 checks in the past 8
 * hours; on more than 10% of the checks; changed more than 5 times.
 */
export const CRITERIA_ON_CHECKS_SENTENCE: string = translationKey(
  "{{condition}} on {{checks}} in the past {{window}}",
);
export const CRITERIA_ON_SHARE_OF_CHECKS_SENTENCE: string = translationKey(
  "{{condition}} on {{share}} of the checks in the past {{window}}",
);
// A yes or no check changes on its own: "Is Online" changed 6 times.
export const CRITERIA_CHECK_CHANGED_SENTENCE: string = translationKey(
  "{{check}} changed {{times}} in the past {{window}}",
);
/*
 * Any other condition: how often the checks went between matching it and
 * not, the condition last, so it reads whole after "Check if".
 */
export const CRITERIA_CONDITION_CHANGED_SENTENCE: string = translationKey(
  "the checks changed {{times}} between matching and not in the past {{window}}: {{condition}}",
);

// How many checks a count takes, by how it is compared.
export const CRITERIA_CHECKS_COMPARISONS: Readonly<
  Partial<Record<FilterType, PluralTemplate>>
> = {
  [FilterType.GreaterThan]: {
    one: "more than {{count}} check",
    other: "more than {{count}} checks",
  },
  [FilterType.GreaterThanOrEqualTo]: {
    one: "at least {{count}} check",
    other: "at least {{count}} checks",
  },
  [FilterType.LessThan]: {
    one: "fewer than {{count}} check",
    other: "fewer than {{count}} checks",
  },
  [FilterType.LessThanOrEqualTo]: {
    one: "at most {{count}} check",
    other: "at most {{count}} checks",
  },
  [FilterType.EqualTo]: {
    one: "exactly {{count}} check",
    other: "exactly {{count}} checks",
  },
  [FilterType.NotEqualTo]: {
    one: "other than {{count}} check",
    other: "other than {{count}} checks",
  },
};

// How many times a number of changes takes.
export const CRITERIA_TIMES_COMPARISONS: Readonly<
  Partial<Record<FilterType, PluralTemplate>>
> = {
  [FilterType.GreaterThan]: {
    one: "more than {{count}} time",
    other: "more than {{count}} times",
  },
  [FilterType.GreaterThanOrEqualTo]: {
    one: "at least {{count}} time",
    other: "at least {{count}} times",
  },
  [FilterType.LessThan]: {
    one: "fewer than {{count}} time",
    other: "fewer than {{count}} times",
  },
  [FilterType.LessThanOrEqualTo]: {
    one: "at most {{count}} time",
    other: "at most {{count}} times",
  },
  [FilterType.EqualTo]: {
    one: "exactly {{count}} time",
    other: "exactly {{count}} times",
  },
  [FilterType.NotEqualTo]: {
    one: "other than {{count}} time",
    other: "other than {{count}} times",
  },
};

// What share of the checks a percentage takes: "more than 10%".
export const CRITERIA_SHARE_COMPARISONS: Readonly<
  Partial<Record<FilterType, string>>
> = {
  [FilterType.GreaterThan]: translationKey("more than {{share}}"),
  [FilterType.GreaterThanOrEqualTo]: translationKey("at least {{share}}"),
  [FilterType.LessThan]: translationKey("less than {{share}}"),
  [FilterType.LessThanOrEqualTo]: translationKey("at most {{share}}"),
  [FilterType.EqualTo]: translationKey("exactly {{share}}"),
  [FilterType.NotEqualTo]: translationKey("other than {{share}}"),
};

// The window a count is read over, in hours when it is whole hours.
export const CRITERIA_WINDOW_MINUTES: PluralTemplate = {
  one: "{{count}} minute",
  other: "{{count}} minutes",
};
export const CRITERIA_WINDOW_HOURS: PluralTemplate = {
  one: "{{count}} hour",
  other: "{{count}} hours",
};

/*
 * What the window types that came with #10355 do, under their names in the
 * Evaluate dropdown. The older six are said by the description above it.
 */
export const EVALUATE_OVER_TIME_TYPE_DESCRIPTIONS: Readonly<
  Partial<Record<EvaluateOverTimeType, string>>
> = {
  [EvaluateOverTimeType.Percentile]: translationKey(
    "A percentile of the window's values, such as p95.",
  ),
  [EvaluateOverTimeType.Count]: translationKey(
    "How many checks in the window match.",
  ),
  [EvaluateOverTimeType.Percentage]: translationKey(
    "What share of the window's checks match, in %.",
  ),
  [EvaluateOverTimeType.StatusChanges]: translationKey(
    "How often the checks changed between matching and not: a device going up and down.",
  ),
};

/*
 * The number a counted window is compared with, under the Evaluate dropdown:
 * its label, what it means, and the word after it.
 */
export const COUNTED_WINDOW_FIELDS: Readonly<
  Partial<
    Record<
      EvaluateOverTimeType,
      { title: string; description: string; unit: string }
    >
  >
> = {
  [EvaluateOverTimeType.Count]: {
    title: translationKey("Checks That Match"),
    description: translationKey(
      "How many checks in the window must match the condition above.",
    ),
    unit: translationKey("checks"),
  },
  [EvaluateOverTimeType.Percentage]: {
    title: translationKey("Share of Checks That Match"),
    description: translationKey(
      "What share of the window's checks must match the condition above.",
    ),
    unit: "%",
  },
  [EvaluateOverTimeType.StatusChanges]: {
    title: translationKey("Times It Changed"),
    description: translationKey(
      "How often the checks must change between matching the condition above and not.",
    ),
    unit: translationKey("times"),
  },
};

export const PERCENTILE_FIELD_TITLE: string = translationKey("Percentile");
export const PERCENTILE_FIELD_DESCRIPTION: string = translationKey(
  "The threshold above is compared with it: p95 is the value 95% of the window's values are at or below.",
);

// A metric's aggregation ("Average of ..."), read before the window.
export const CRITERIA_AGGREGATION_SENTENCE: string = translationKey(
  "{{aggregation}} of {{measure}}",
);

// The window a measured value is read over.
export const CRITERIA_IN_THE_PAST_SENTENCE: PluralTemplate = {
  one: "{{measure}} in the past {{count}} minute",
  other: "{{measure}} in the past {{count}} minutes",
};

/*
 * What is checked, compared with its threshold: one sentence for each
 * condition, as RuleCriteriaSummary words a rule's. A text is quoted; a
 * yes or no, an emptiness and a state take no value.
 */
export const CRITERIA_COMPARISON_SENTENCES: Readonly<
  Partial<Record<FilterType, string>>
> = {
  [FilterType.EqualTo]: translationKey("{{subject}} is equal to {{value}}"),
  [FilterType.NotEqualTo]: translationKey(
    "{{subject}} is not equal to {{value}}",
  ),
  [FilterType.GreaterThan]: translationKey(
    "{{subject}} is greater than {{value}}",
  ),
  [FilterType.LessThan]: translationKey("{{subject}} is less than {{value}}"),
  [FilterType.GreaterThanOrEqualTo]: translationKey(
    "{{subject}} is greater than or equal to {{value}}",
  ),
  [FilterType.LessThanOrEqualTo]: translationKey(
    "{{subject}} is less than or equal to {{value}}",
  ),
  [FilterType.Contains]: translationKey('{{subject}} contains "{{value}}"'),
  [FilterType.NotContains]: translationKey(
    '{{subject}} does not contain "{{value}}"',
  ),
  [FilterType.StartsWith]: translationKey(
    '{{subject}} starts with "{{value}}"',
  ),
  [FilterType.EndsWith]: translationKey('{{subject}} ends with "{{value}}"'),
  [FilterType.IsEmpty]: translationKey("{{subject}} is empty"),
  [FilterType.IsNotEmpty]: translationKey("{{subject}} is not empty"),
  [FilterType.True]: translationKey("{{subject}} is true"),
  [FilterType.False]: translationKey("{{subject}} is false"),
  [FilterType.EvaluatesToTrue]: translationKey("{{subject}} evaluates to true"),
  [FilterType.IsExecuting]: translationKey("{{subject}} is executing"),
  [FilterType.IsNotExecuting]: translationKey("{{subject}} is not executing"),
};

// A condition whose threshold is a number of minutes.
export const CRITERIA_MINUTES_COMPARISON_SENTENCES: Readonly<
  Partial<Record<FilterType, PluralTemplate>>
> = {
  [FilterType.RecievedInMinutes]: {
    one: "{{subject}} is received within {{count}} minute",
    other: "{{subject}} is received within {{count}} minutes",
  },
  [FilterType.NotRecievedInMinutes]: {
    one: "{{subject}} is not received within {{count}} minute",
    other: "{{subject}} is not received within {{count}} minutes",
  },
};

// A condition this list has no sentence of: its name, mid-sentence.
export const CRITERIA_OTHER_COMPARISON_SENTENCE: string = translationKey(
  "{{subject}} is {{comparison}} {{value}}",
);

// An anomaly against the metric's own baseline, and how far back it reaches.
export const CRITERIA_ANOMALY_SENTENCES: Readonly<
  Partial<Record<FilterType, PluralTemplate>>
> = {
  [FilterType.AnomalouslyHigh]: {
    one: "{{subject}} is anomalously high (sensitivity: {{sensitivity}}, baseline window: {{count}} day)",
    other:
      "{{subject}} is anomalously high (sensitivity: {{sensitivity}}, baseline window: {{count}} days)",
  },
  [FilterType.AnomalouslyLow]: {
    one: "{{subject}} is anomalously low (sensitivity: {{sensitivity}}, baseline window: {{count}} day)",
    other:
      "{{subject}} is anomalously low (sensitivity: {{sensitivity}}, baseline window: {{count}} days)",
  },
  [FilterType.Anomalous]: {
    one: "{{subject}} is anomalous in either direction (sensitivity: {{sensitivity}}, baseline window: {{count}} day)",
    other:
      "{{subject}} is anomalous in either direction (sensitivity: {{sensitivity}}, baseline window: {{count}} days)",
  },
};

// Where a metric is headed, and by when.
export const CRITERIA_FORECAST_ABOVE_SENTENCE: string = translationKey(
  "{{subject}} is forecast to rise above {{value}} within {{horizon}}",
);
export const CRITERIA_FORECAST_BELOW_SENTENCE: string = translationKey(
  "{{subject}} is forecast to fall below {{value}} within {{horizon}}",
);
export const CRITERIA_FORECAST_DAYS: PluralTemplate = {
  one: "{{count}} day",
  other: "{{count}} days",
};
export const CRITERIA_FORECAST_HOURS: PluralTemplate = {
  one: "{{count}} hour",
  other: "{{count}} hours",
};

// A JavaScript expression, as typed, judged true.
export const CRITERIA_EXPRESSION_SENTENCE: string = translationKey(
  "JavaScript expression {{expression}} - evaluates to true",
);

/*
 * A condition judged from the match history of a window: on every check
 * of it, or on any one.
 */
export const CRITERIA_ON_EVERY_CHECK_SENTENCE: PluralTemplate = {
  one: "{{condition}} on every check in the past {{count}} minute",
  other: "{{condition}} on every check in the past {{count}} minutes",
};
export const CRITERIA_ON_ANY_CHECK_SENTENCE: PluralTemplate = {
  one: "{{condition}} on any check in the past {{count}} minute",
  other: "{{condition}} on any check in the past {{count}} minutes",
};

/*
 * The whole filter. Whether all of a criteria's filters must match or any
 * one is said once, above them (MonitorCriteriaInstance's heading), never
 * as an "and," or "or," left at the end of each line (#8533).
 */
export const CRITERIA_FILTER_SENTENCE: string = translationKey(
  "Check if {{condition}}",
);
export const CRITERIA_EXPRESSION_FILTER_SENTENCE: string = translationKey(
  "Check if {{condition}}.",
);

export interface CheckByCheckWindow {
  minutes: number;
  // Any one check of the window is enough (Any Value); otherwise every check.
  isAnyCheck: boolean;
}

// The criteria list in English: a test, and a caller with no translator.
const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE, {
  drawsOnPage: true,
});

// A threshold typed as a plain number: "90", "-14", "99.5".
const NUMERIC_THRESHOLD: RegExp = /^-?\d+(\.\d+)?$/;

/*
 * A percentile as "p95" writes it: its number, at most one decimal (99.9).
 * Notation, in Latin digits in every language, as monitoring tools write it.
 */
export function describePercentile(percentile: number): string {
  return Number.isInteger(percentile)
    ? String(percentile)
    : String(Math.round(percentile * 10) / 10);
}

/*
 * A part of the summary: a sentence of `translator`'s language wrapped
 * around the part inside it, which is written in the same language.
 */
type CriteriaPart = (translator: Translator) => string;

// A sentence around `inner`, filled in the language it is read in.
function wrapPart(
  template: string,
  placeholder: string,
  inner: CriteriaPart,
  values?: TemplateValues,
): CriteriaPart {
  return (translator: Translator): string => {
    return translator.translateTemplate(template, {
      ...values,
      [placeholder]: composedValue(inner),
    });
  };
}

// A count-dependent sentence around `inner`.
function wrapPluralPart(
  template: PluralTemplate,
  count: number,
  placeholder: string,
  inner: CriteriaPart,
  values?: TemplateValues,
): CriteriaPart {
  return (translator: Translator): string => {
    return translator.translatePlural(template, count, {
      ...values,
      [placeholder]: composedValue(inner),
    });
  };
}

/*
 * A threshold as `translator`'s language writes it: a plain number in its
 * digits ("3000", "3.000", "۳۰۰۰" - toFixed's figure in English), a
 * percentage with its percent sign ("90%", "90 %", "۹۰٪"), milliseconds
 * through formatMilliseconds ("3,000 ms", "۳٬۰۰۰ میلی‌ثانیه"), a unit
 * after it as written ("10 GB", "-14 dBm"). Anything that is not a plain
 * number is put in as it was typed.
 */
function writeThreshold(data: {
  value: string;
  translator: Translator;
  isPercentage: boolean;
  isMilliseconds: boolean;
  units: Array<string>;
}): string {
  const isNumber: boolean = NUMERIC_THRESHOLD.test(data.value.trim());
  const figure: number = Number(data.value);
  const decimals: number = isNumber
    ? (data.value.trim().split(".")[1] || "").length
    : 0;
  const units: Array<string> = data.units.filter((unit: string): boolean => {
    return unit.length > 0;
  });
  const isUnitMilliseconds: boolean = units.length === 1 && units[0] === "ms";

  if (!isNumber) {
    return data.isPercentage
      ? `${data.value}%`
      : [data.value, ...units].join(" ");
  }

  if (data.isMilliseconds || isUnitMilliseconds) {
    return formatMilliseconds(data.translator, figure);
  }

  const written: string = formatReaderFigure(figure, {
    decimals: decimals,
    isPercent: data.isPercentage,
    language: data.translator.language,
  });

  // The figure held to its unit by a no-break space (#8720).
  return units.length > 0
    ? fillTemplate("{{value}}\u00A0{{unit}}", {
        value: written,
        unit: units.join(" "),
      })
    : written;
}

export default class CriteriaFilterUtil {
  /*
   * The window a filter is given when "Evaluate this criteria over a period
   * of time" is ticked: every check of the last 5 minutes. All Values is the
   * choice that waits - the reason most people tick the box - and the one
   * every dropdown below already fell back to.
   */
  public static readonly DEFAULT_EVALUATE_OVER_TIME_OPTIONS: EvaluateOverTimeOptions =
    {
      timeValueInMinutes: 5,
      evaluateOverTimeType: EvaluateOverTimeType.AllValues,
    };

  /*
   * The windows the form offers: minutes up to an hour, then whole hours up
   * to a day (#10355), each named in its own unit - "8 Hours", not "480
   * Minutes".
   */
  public static getEvaluateOverTimeMinutesOptions(): Array<DropdownOption> {
    return Object.values(EvaluateOverTimeMinutes).map(
      (value: string): DropdownOption => {
        const minutes: number = Number(value);
        const isInHours: boolean = minutes >= 120 && minutes % 60 === 0;

        return {
          label: isInHours
            ? translatePlural(
                { one: "{{count}} Hour", other: "{{count}} Hours" },
                minutes / 60,
              )
            : translatePlural(
                { one: "{{count}} Minute", other: "{{count}} Minutes" },
                minutes,
              ),
          value: value,
        };
      },
    );
  }

  /*
   * The Evaluate dropdown's choices for a filter: each window type it is
   * offered, under its name, with what it does for the ones that came with
   * #10355.
   */
  public static getEvaluateOverTimeTypeOptions(
    criteriaFilter: CriteriaFilter | undefined,
    monitorType?: MonitorType | undefined,
  ): Array<DropdownOption> {
    return CommonCriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter(
      criteriaFilter,
      monitorType,
    ).map((type: EvaluateOverTimeType): DropdownOption => {
      const description: string | undefined =
        EVALUATE_OVER_TIME_TYPE_DESCRIPTIONS[type];

      return {
        value: type,
        label: type,
        ...(description ? { description: description } : {}),
      };
    });
  }

  /*
   * How a counted window's number is compared: the comparisons a filter's
   * own condition offers for a number, by the same names.
   */
  public static getCountComparisonOptions(): Array<DropdownOption> {
    return CommonCriteriaFilterUtil.COUNT_COMPARISONS.map(
      (filterType: FilterType): DropdownOption => {
        return { value: filterType, label: filterType };
      },
    );
  }

  // The percentiles offered, the default first: p95, p50, p90, p99.
  public static getPercentileOptions(): Array<DropdownOption> {
    return EVALUATE_OVER_TIME_PERCENTILE_OPTIONS.map(
      (percentile: number): DropdownOption => {
        return {
          value: percentile,
          // Notation, the same in every language.
          label: `p${percentile}`,
          isUserContent: true,
        };
      },
    );
  }

  /*
   * The filter once its window type is picked. A count starts as "more
   * than" 0 checks or changes, unless it already holds a number; a share
   * keeps a number of at most 100; a percentile starts at p95.
   */
  public static setEvaluateOverTimeType(data: {
    criteriaFilter: CriteriaFilter;
    evaluateOverTimeType: EvaluateOverTimeType;
  }): CriteriaFilter {
    const options: EvaluateOverTimeOptions = {
      ...(data.criteriaFilter.evaluateOverTimeOptions ||
        CriteriaFilterUtil.DEFAULT_EVALUATE_OVER_TIME_OPTIONS),
      evaluateOverTimeType: data.evaluateOverTimeType,
    };

    if (
      CommonCriteriaFilterUtil.isCountedWindowType(data.evaluateOverTimeType)
    ) {
      options.countFilterType = CommonCriteriaFilterUtil.isCountComparison(
        options.countFilterType,
      )
        ? options.countFilterType
        : FilterType.GreaterThan;

      const countValue: number = Number(options.countValue);

      options.countValue =
        Number.isFinite(countValue) && countValue >= 0
          ? data.evaluateOverTimeType === EvaluateOverTimeType.Percentage
            ? Math.min(countValue, 100)
            : countValue
          : 0;
    } else {
      delete options.countFilterType;
      delete options.countValue;
    }

    if (data.evaluateOverTimeType === EvaluateOverTimeType.Percentile) {
      options.percentile = CommonCriteriaFilterUtil.getPercentile(
        data.criteriaFilter,
      );
    } else {
      delete options.percentile;
    }

    return {
      ...data.criteriaFilter,
      evaluateOverTime: true,
      evaluateOverTimeOptions: options,
    };
  }

  /*
   * The "For the last" option a saved window shows as. The form used to
   * save the minutes as the option's string ("5"), while the API, Terraform
   * and the form's own defaults hold a number (5) - and a strict comparison
   * of the two drew an empty dropdown over a window that was saved and in
   * force. Both spellings name the same option.
   */
  public static getEvaluateOverTimeMinutesOption(
    timeValueInMinutes: number | string | undefined,
  ): DropdownOption | undefined {
    if (
      timeValueInMinutes === undefined ||
      timeValueInMinutes === null ||
      String(timeValueInMinutes).trim() === ""
    ) {
      return undefined;
    }

    const minutes: number = Number(timeValueInMinutes);

    return CriteriaFilterUtil.getEvaluateOverTimeMinutesOptions().find(
      (option: DropdownOption) => {
        return Number(option.value) === minutes;
      },
    );
  }

  /*
   * The filter once "Evaluate this criteria over a period of time" is
   * ticked or unticked.
   *
   * Ticking it on a filter with no window gives it the default one. The box
   * used to set the flag alone, so a filter saved straight after ticking it
   * had no window - and the server judges such a filter on the latest check
   * alone, while the form showed the box ticked. Unticking keeps the window,
   * so ticking it again brings back what was chosen.
   */
  public static setEvaluateOverTime(data: {
    criteriaFilter: CriteriaFilter;
    evaluateOverTime: boolean;
  }): CriteriaFilter {
    if (!data.evaluateOverTime) {
      return {
        ...data.criteriaFilter,
        evaluateOverTime: false,
      };
    }

    return {
      ...data.criteriaFilter,
      evaluateOverTime: true,
      evaluateOverTimeOptions: data.criteriaFilter.evaluateOverTimeOptions
        ? { ...data.criteriaFilter.evaluateOverTimeOptions }
        : { ...CriteriaFilterUtil.DEFAULT_EVALUATE_OVER_TIME_OPTIONS },
    };
  }

  /*
   * The filter with one of its window's settings changed. A window that
   * was never set starts from the default, so changing one setting never
   * leaves the others empty.
   */
  public static setEvaluateOverTimeOption(data: {
    criteriaFilter: CriteriaFilter;
    change: Partial<EvaluateOverTimeOptions>;
  }): CriteriaFilter {
    return {
      ...data.criteriaFilter,
      evaluateOverTime: true,
      evaluateOverTimeOptions: {
        ...(data.criteriaFilter.evaluateOverTimeOptions ||
          CriteriaFilterUtil.DEFAULT_EVALUATE_OVER_TIME_OPTIONS),
        ...data.change,
      },
    };
  }

  /*
   * What the "Evaluate" dropdown's choices mean for this filter. A check
   * judged check by check (a yes/no series, or a body, header or expression
   * judged from its match history on this monitor type) is offered All
   * Values and Any Value only, so it is told what those two mean; a
   * measured value is told the aggregates as well.
   */
  public static getEvaluateOverTimeTypeDescription(
    criteriaFilter: CriteriaFilter | undefined,
    monitorType?: MonitorType | undefined,
  ): string {
    if (
      CommonCriteriaFilterUtil.isJudgedCheckByCheck(
        criteriaFilter?.checkOn,
        monitorType,
      )
    ) {
      return translationKey(
        "All Values matches only when every check in the window matched. Any Value matches as soon as one check did.",
      );
    }

    return translationKey(
      "Average, Sum, Maximum Value and Minimum Value compare one figure for the whole window. All Values needs every check to meet the condition, Any Value just one.",
    );
  }

  /*
   * The filter as a sentence, for the criteria list, in the translator's
   * language (#8350): "Check if "Response Time (in ms)" is greater than
   * 3,000 ms", "Prüfen: "Antwortzeit (in ms)" ist größer als 3.000 ms". Pass
   * the monitor type when it is known: whether a window is judged check by
   * check depends on it (CommonCriteriaFilterUtil.isJudgedCheckByCheck).
   * Without a translator it is English. How the filters combine is the
   * list's to say, once (#8533).
   */
  public static translateFilterToText(
    criteriaFilter: CriteriaFilter,
    monitorType?: MonitorType | undefined,
    translator: Translator = ENGLISH,
  ): string {
    const isPercentage: boolean =
      criteriaFilter?.checkOn === CheckOn.CPUUsagePercent ||
      criteriaFilter?.checkOn === CheckOn.DiskUsagePercent ||
      criteriaFilter?.checkOn === CheckOn.MemoryUsagePercent ||
      criteriaFilter?.checkOn === CheckOn.SwapUsagePercent ||
      criteriaFilter?.checkOn === CheckOn.CPUIoWaitPercent ||
      criteriaFilter?.checkOn === CheckOn.PacketLossPercent ||
      criteriaFilter?.checkOn === CheckOn.SnmpInterfaceUtilizationPercent ||
      criteriaFilter?.checkOn === CheckOn.LlmBadAnswerPercent ||
      criteriaFilter?.checkOn === CheckOn.SessionsWithExceptionsPercent ||
      criteriaFilter?.checkOn === CheckOn.InstallsWithExceptionsPercent;

    const isMilliseconds: boolean =
      criteriaFilter?.checkOn === CheckOn.ResponseTime ||
      criteriaFilter?.checkOn === CheckOn.Jitter ||
      criteriaFilter?.checkOn === CheckOn.PortDnsLookupTime ||
      criteriaFilter?.checkOn === CheckOn.PortTcpConnectTime ||
      criteriaFilter?.checkOn === CheckOn.NtpClockOffset ||
      criteriaFilter?.checkOn === CheckOn.NtpResponseTime ||
      criteriaFilter?.checkOn === CheckOn.NtpRootDispersion;

    /*
     * A Database Health filter names its series in databaseMonitorOptions,
     * not in the check, so its unit is per-metric - the same check reads a
     * percentage, a byte count or a number of seconds depending on which
     * metric was picked. The catalog is the only place that knows which,
     * which is also why "Database Metric" is deliberately absent from the
     * two flat lists above: they would label a byte count a percentage.
     */
    const databaseMetric: DatabaseMetricDefinition | null =
      criteriaFilter?.checkOn === CheckOn.DatabaseMetric &&
      criteriaFilter?.databaseMonitorOptions?.metricType
        ? getDatabaseMetricByMetricType(
            criteriaFilter.databaseMonitorOptions.metricType,
          )
        : null;

    /*
     * The type the server judges the window with: a true/false filter (Is
     * Online and the like) saved with an aggregate is judged as All Values.
     */
    const evaluateOverTimeType: EvaluateOverTimeType | undefined =
      CommonCriteriaFilterUtil.getEffectiveEvaluateOverTimeType(
        criteriaFilter,
        monitorType,
      );

    /*
     * A body, a header or an expression judged from its match history has
     * no values to speak of - "all values of Response Body" reads as
     * nonsense - so it says which checks it must have matched on, after
     * what it checks: ... does not contain "App Title" on every check in
     * the past 5 minutes.
     */
    const checkByCheckWindow: CheckByCheckWindow | null =
      CriteriaFilterUtil.getCheckByCheckWindow(criteriaFilter, monitorType);

    /*
     * A body, header or expression filter with the box ticked but no minutes
     * is judged on the latest check, so it reads as one.
     */
    const isEvaluatedOverTime: boolean =
      CommonCriteriaFilterUtil.isEvaluatedOverTime(criteriaFilter, monitorType);

    const isForecast: boolean = CommonCriteriaFilterUtil.isForecastFilterType(
      criteriaFilter?.filterType,
    );

    /*
     * A window that counts its checks (#10355) is said around the condition
     * each check is judged by, below: its measure reads as on one check.
     */
    const isCounted: boolean =
      isEvaluatedOverTime &&
      CommonCriteriaFilterUtil.isCountedWindowType(evaluateOverTimeType);

    // How a window's values are read, and a metric's aggregation, around it.
    const readOverTime: (measure: CriteriaPart) => CriteriaPart = (
      measure: CriteriaPart,
    ): CriteriaPart => {
      let part: CriteriaPart = measure;

      const overTimeSentence: string | undefined = evaluateOverTimeType
        ? CRITERIA_EVALUATE_OVER_TIME_SENTENCES[evaluateOverTimeType]
        : undefined;

      if (
        isEvaluatedOverTime &&
        overTimeSentence &&
        !checkByCheckWindow &&
        !isCounted
      ) {
        part = wrapPart(overTimeSentence, "measure", part, {
          percentile: describePercentile(
            CommonCriteriaFilterUtil.getPercentile(criteriaFilter),
          ),
        });
      }

      // Not for a forecast, which reads every value of the window into its trend.
      const aggregation: string | undefined =
        criteriaFilter?.metricMonitorOptions?.metricAggregationType?.toString();

      if (aggregation && !isForecast) {
        part = wrapPart(CRITERIA_AGGREGATION_SENTENCE, "measure", part, {
          aggregation: translatableTerm(aggregation),
        });
      }

      return part;
    };

    const checkName: (label: string) => CriteriaPart = (
      label: string,
    ): CriteriaPart => {
      return (sentence: Translator): string => {
        return sentence.translateTemplate(CRITERIA_CHECK_SENTENCE, {
          check: translatableTerm(label),
        });
      };
    };

    const condition: CriteriaPart = ((): CriteriaPart => {
      const filterType: FilterType | undefined = criteriaFilter?.filterType;
      const anomaly: PluralTemplate | undefined = filterType
        ? CRITERIA_ANOMALY_SENTENCES[filterType]
        : undefined;

      /*
       * Anomaly criteria don't use the static threshold value field: they
       * say how sensitive they are and how far back their baseline reaches.
       */
      if (anomaly) {
        const sensitivity: AnomalyDetectionSensitivity =
          (criteriaFilter?.metricMonitorOptions?.anomalyDetection
            ?.sensitivity as AnomalyDetectionSensitivity | undefined) ||
          AnomalyDetectionSensitivity.Medium;
        const windowDays: number =
          criteriaFilter?.metricMonitorOptions?.anomalyDetection?.windowDays ||
          14;

        return wrapPluralPart(
          anomaly,
          windowDays,
          "subject",
          readOverTime(checkName(`${criteriaFilter?.checkOn ?? ""}`)),
          { sensitivity: translatableTerm(sensitivity) },
        );
      }

      // A forecast says where the metric is headed, and by when.
      if (isForecast) {
        const horizonInHours: number =
          CommonCriteriaFilterUtil.getForecastHorizonInHours(criteriaFilter);
        const isInDays: boolean =
          horizonInHours >= 24 && horizonInHours % 24 === 0;
        const unit: string =
          criteriaFilter?.metricMonitorOptions?.thresholdUnit || "";

        return wrapPart(
          filterType === FilterType.ForecastAbove
            ? CRITERIA_FORECAST_ABOVE_SENTENCE
            : CRITERIA_FORECAST_BELOW_SENTENCE,
          "subject",
          readOverTime(checkName(`${criteriaFilter?.checkOn ?? ""}`)),
          {
            value: composedValue((sentence: Translator): string => {
              return criteriaFilter?.value === undefined ||
                criteriaFilter?.value === null
                ? "..."
                : writeThreshold({
                    value: criteriaFilter.value.toString(),
                    translator: sentence,
                    isPercentage: false,
                    isMilliseconds: false,
                    units: [unit],
                  });
            }),
            /*
             * "3 days" as the sentence's language writes a length in full
             * (Intl: "3 Tage", "3 أيام", "۳ روز"), its plural forms all
             * its own; English, and an engine Intl cannot write it in, as
             * the plural keys word it.
             */
            horizon: composedValue((sentence: Translator): string => {
              const count: number = isInDays
                ? horizonInHours / 24
                : horizonInHours;
              const written: string | null = isEnglishDateLanguage(
                sentence.language,
              )
                ? null
                : formatDurationUnit({
                    part: { count: count, unit: isInDays ? "day" : "hour" },
                    locale: sentence.language,
                    unitDisplay: "long",
                  });

              return (
                written ||
                sentence.translatePlural(
                  isInDays ? CRITERIA_FORECAST_DAYS : CRITERIA_FORECAST_HOURS,
                  count,
                )
              );
            }),
          },
        );
      }

      /*
       * The expression as typed. On a monitor type that keeps no match
       * history, a window is read over its values like a measured one's.
       */
      if (criteriaFilter?.checkOn === CheckOn.JavaScriptExpression) {
        return readOverTime((sentence: Translator): string => {
          return sentence.translateTemplate(CRITERIA_EXPRESSION_SENTENCE, {
            expression: `${criteriaFilter?.value}`,
          });
        });
      }

      /*
       * Name the metric rather than the check: "Database Metric is greater
       * than 90" says nothing about what is being measured, and every
       * database filter would read identically in the criteria list.
       */
      let measure: CriteriaPart = checkName(
        databaseMetric?.friendlyName || `${criteriaFilter?.checkOn ?? ""}`,
      );

      const diskPath: string | undefined =
        criteriaFilter?.serverMonitorOptions?.diskPath;

      if (diskPath) {
        measure = wrapPart(CRITERIA_ON_DISK_SENTENCE, "measure", measure, {
          diskPath: diskPath,
        });
      }

      const resultValuePath: string | undefined =
        criteriaFilter?.customCodeMonitorOptions?.resultValuePath?.trim();

      if (resultValuePath && criteriaFilter?.checkOn === CheckOn.ResultValue) {
        measure = wrapPart(CRITERIA_AT_PATH_SENTENCE, "measure", measure, {
          path: resultValuePath,
        });
      }

      const transceiverReading: string | undefined =
        criteriaFilter?.snmpMonitorOptions?.transceiverReading;
      const transceiverTitle: string | undefined = transceiverReading
        ? TRANSCEIVER_READING_TITLES[
            transceiverReading as TransceiverReadingKind
          ]
        : undefined;

      if (
        criteriaFilter?.checkOn === CheckOn.SnmpTransceiverReading &&
        transceiverTitle
      ) {
        measure = wrapPart(CRITERIA_READING_SENTENCE, "measure", measure, {
          reading: translatableTerm(transceiverTitle),
        });
      }

      const interfaceName: string | undefined =
        criteriaFilter?.snmpMonitorOptions?.interfaceName;

      if (interfaceName) {
        measure = wrapPart(CRITERIA_ON_INTERFACE_SENTENCE, "measure", measure, {
          interface: interfaceName,
        });
      }

      const tableKey: string | undefined =
        criteriaFilter?.snmpMonitorOptions?.tableKey;

      if (tableKey) {
        const tableRow: string | undefined =
          criteriaFilter.snmpMonitorOptions?.tableRow;

        measure = wrapPart(
          !tableRow
            ? CRITERIA_IN_TABLE_SENTENCE
            : tableRow.trim() === "*"
              ? CRITERIA_IN_TABLE_EACH_ROW_SENTENCE
              : CRITERIA_IN_TABLE_ROW_SENTENCE,
          "measure",
          measure,
          { table: tableKey, row: tableRow || "" },
        );
      }

      // The minutes a measured value is read over.
      const minutes: number = Number(
        criteriaFilter?.evaluateOverTimeOptions?.timeValueInMinutes,
      );

      let subject: CriteriaPart = readOverTime(measure);

      if (
        isEvaluatedOverTime &&
        minutes > 0 &&
        !checkByCheckWindow &&
        !isCounted
      ) {
        subject = wrapPluralPart(
          CRITERIA_IN_THE_PAST_SENTENCE,
          minutes,
          "measure",
          subject,
        );
      }

      // A text comparison quotes what it looks for, as typed.
      const isTextComparison: boolean =
        CriteriaFilterUtil.isTextComparison(filterType);
      // A transceiver reading is in its own unit: dBm, °C, V or mA.
      const transceiverUnit: string | undefined =
        criteriaFilter?.checkOn === CheckOn.SnmpTransceiverReading &&
        transceiverReading
          ? TRANSCEIVER_READING_UNITS[
              transceiverReading as TransceiverReadingKind
            ]
          : undefined;
      const hasValue: boolean =
        criteriaFilter?.value !== undefined && criteriaFilter?.value !== null;
      const value: TemplateValues["value"] = composedValue(
        (sentence: Translator): string => {
          if (!hasValue) {
            return "...";
          }

          const typed: string = criteriaFilter.value!.toString();

          return isTextComparison
            ? typed
            : writeThreshold({
                value: typed,
                translator: sentence,
                isPercentage: isPercentage,
                isMilliseconds: isMilliseconds,
                units: [
                  criteriaFilter?.checkOn === CheckOn.MetricValue
                    ? criteriaFilter?.metricMonitorOptions?.thresholdUnit || ""
                    : "",
                  databaseMetric?.unit || "",
                  transceiverUnit || "",
                ],
              });
        },
      );

      const comparison: string | undefined = filterType
        ? CRITERIA_COMPARISON_SENTENCES[filterType]
        : undefined;
      const minutesComparison: PluralTemplate | undefined = filterType
        ? CRITERIA_MINUTES_COMPARISON_SENTENCES[filterType]
        : undefined;
      const thresholdMinutes: number =
        hasValue && NUMERIC_THRESHOLD.test(criteriaFilter.value!.toString())
          ? Number(criteriaFilter.value)
          : NaN;

      return (sentence: Translator): string => {
        if (minutesComparison && Number.isFinite(thresholdMinutes)) {
          return sentence.translatePlural(minutesComparison, thresholdMinutes, {
            subject: composedValue(subject),
          });
        }

        if (comparison) {
          return sentence.translateTemplate(comparison, {
            subject: composedValue(subject),
            value: value,
          });
        }

        // No condition picked yet: what is checked, on its own.
        if (!filterType) {
          return subject(sentence);
        }

        return sentence.translateTemplate(CRITERIA_OTHER_COMPARISON_SENTENCE, {
          subject: composedValue(subject),
          comparison: translatableTerm(filterType, { inSentence: true }),
          value: value,
        });
      };
    })();

    // On every check of the window, or on any one.
    const judged: CriteriaPart = isCounted
      ? CriteriaFilterUtil.wrapCountedWindow({
          criteriaFilter: criteriaFilter,
          type: evaluateOverTimeType!,
          condition: condition,
          check: (sentence: Translator): string => {
            return sentence.translateTemplate(CRITERIA_CHECK_SENTENCE, {
              check: translatableTerm(
                databaseMetric?.friendlyName ||
                  `${criteriaFilter?.checkOn ?? ""}`,
              ),
            });
          },
        })
      : checkByCheckWindow
        ? wrapPluralPart(
            checkByCheckWindow.isAnyCheck
              ? CRITERIA_ON_ANY_CHECK_SENTENCE
              : CRITERIA_ON_EVERY_CHECK_SENTENCE,
            checkByCheckWindow.minutes,
            "condition",
            condition,
          )
        : condition;

    const isExpression: boolean =
      criteriaFilter?.checkOn === CheckOn.JavaScriptExpression &&
      !CommonCriteriaFilterUtil.isAnomalyFilterType(
        criteriaFilter?.filterType,
      ) &&
      !isForecast;

    const whole: string = isExpression
      ? CRITERIA_EXPRESSION_FILTER_SENTENCE
      : CRITERIA_FILTER_SENTENCE;

    return translator.translateTemplate(whole, {
      condition: composedValue(judged),
    });
  }

  /*
   * A counted window around the condition each check is judged by (#10355):
   * ... on more than 30 checks in the past 8 hours; on more than 10% of the
   * checks; and for Status Changes, "Is Online" changed more than 5 times -
   * the check itself, for a yes or no check, or whether the condition held.
   */
  public static wrapCountedWindow(data: {
    criteriaFilter: CriteriaFilter;
    type: EvaluateOverTimeType;
    condition: CriteriaPart;
    check: CriteriaPart;
  }): CriteriaPart {
    const minutes: number = CommonCriteriaFilterUtil.getEvaluateOverTimeMinutes(
      data.criteriaFilter,
    );
    const comparison: { filterType: FilterType; value: number } =
      CommonCriteriaFilterUtil.getCountComparison(data.criteriaFilter);

    const isInHours: boolean = minutes >= 60 && minutes % 60 === 0;

    const window: TemplateValues["window"] = composedValue(
      (sentence: Translator): string => {
        return sentence.translatePlural(
          isInHours ? CRITERIA_WINDOW_HOURS : CRITERIA_WINDOW_MINUTES,
          isInHours ? minutes / 60 : minutes,
        );
      },
    );

    if (data.type === EvaluateOverTimeType.Percentage) {
      return (sentence: Translator): string => {
        return sentence.translateTemplate(
          CRITERIA_ON_SHARE_OF_CHECKS_SENTENCE,
          {
            condition: composedValue(data.condition),
            share: composedValue((inner: Translator): string => {
              return inner.translateTemplate(
                CRITERIA_SHARE_COMPARISONS[comparison.filterType] ||
                  CRITERIA_SHARE_COMPARISONS[FilterType.GreaterThan]!,
                {
                  share: formatReaderFigure(comparison.value, {
                    decimals: Number.isInteger(comparison.value) ? 0 : 1,
                    isPercent: true,
                    language: inner.language,
                  }),
                },
              );
            }),
            window: window,
          },
        );
      };
    }

    const isChanges: boolean = data.type === EvaluateOverTimeType.StatusChanges;

    const howMany: TemplateValues["checks"] = composedValue(
      (inner: Translator): string => {
        const template: PluralTemplate =
          (isChanges
            ? CRITERIA_TIMES_COMPARISONS[comparison.filterType]
            : CRITERIA_CHECKS_COMPARISONS[comparison.filterType]) ||
          (isChanges
            ? CRITERIA_TIMES_COMPARISONS[FilterType.GreaterThan]!
            : CRITERIA_CHECKS_COMPARISONS[FilterType.GreaterThan]!);

        return inner.translatePlural(template, comparison.value);
      },
    );

    if (!isChanges) {
      return (sentence: Translator): string => {
        return sentence.translateTemplate(CRITERIA_ON_CHECKS_SENTENCE, {
          condition: composedValue(data.condition),
          checks: howMany,
          window: window,
        });
      };
    }

    if (CommonCriteriaFilterUtil.isBooleanSeries(data.criteriaFilter.checkOn)) {
      return (sentence: Translator): string => {
        return sentence.translateTemplate(CRITERIA_CHECK_CHANGED_SENTENCE, {
          check: composedValue(data.check),
          times: howMany,
          window: window,
        });
      };
    }

    return (sentence: Translator): string => {
      return sentence.translateTemplate(CRITERIA_CONDITION_CHANGED_SENTENCE, {
        condition: composedValue(data.condition),
        times: howMany,
        window: window,
      });
    };
  }

  /*
   * Whether a condition compares text: what it looks for is a piece of
   * text, quoted when the filter is written as a sentence.
   */
  public static isTextComparison(filterType: FilterType | undefined): boolean {
    return (
      filterType === FilterType.Contains ||
      filterType === FilterType.NotContains ||
      filterType === FilterType.StartsWith ||
      filterType === FilterType.EndsWith
    );
  }

  /*
   * The window a body, header or expression filter is judged on from its
   * match history: its minutes, and whether any one check of it is enough
   * (Any Value) or every check must have matched. Null for every other
   * filter, for one whose window is not set (the server judges that one on
   * the latest check alone), and for one on a monitor type that keeps no
   * match history for it.
   *
   * Is Request Timeout keeps a match history too, but it is a true/false
   * check like Is Online and reads like one: "all values of ... is true".
   */
  public static getCheckByCheckWindow(
    criteriaFilter: CriteriaFilter | undefined,
    monitorType?: MonitorType | undefined,
  ): CheckByCheckWindow | null {
    const minutes: number = Number(
      criteriaFilter?.evaluateOverTimeOptions?.timeValueInMinutes,
    );

    if (
      !CommonCriteriaFilterUtil.isEvaluatedOverTime(
        criteriaFilter,
        monitorType,
      ) ||
      !(minutes > 0) ||
      !CommonCriteriaFilterUtil.keepsMatchHistory(
        criteriaFilter?.checkOn,
        monitorType,
      ) ||
      CommonCriteriaFilterUtil.isBooleanSeries(criteriaFilter?.checkOn) ||
      // A count of its checks says how many, not every or any (#10355).
      CommonCriteriaFilterUtil.isCountedWindowType(
        CommonCriteriaFilterUtil.getEffectiveEvaluateOverTimeType(
          criteriaFilter,
          monitorType,
        ),
      )
    ) {
      return null;
    }

    return {
      minutes: minutes,
      isAnyCheck:
        CommonCriteriaFilterUtil.getEffectiveEvaluateOverTimeType(
          criteriaFilter,
          monitorType,
        ) === EvaluateOverTimeType.AnyValue,
    };
  }

  public static getCheckOnOptionsByMonitorType(
    monitorType: MonitorType,
  ): Array<DropdownOption> {
    let options: Array<DropdownOption> =
      DropdownUtil.getDropdownOptionsFromEnum(CheckOn);

    /*
     * Manual monitors have no criteria at all. Nothing polls them - their
     * status is set by hand - and MonitorCriteriaEvaluator has no branch
     * for the type, so no check would ever be evaluated. That is what
     * MonitorTypeHelper.doesMonitorTypeHaveCriteria records, and it is why
     * the Criteria page renders an empty state in place of this form.
     * Offering the whole CheckOn enum here would be offering rules that
     * can never fire.
     */
    if (!MonitorTypeHelper.doesMonitorTypeHaveCriteria(monitorType)) {
      return [];
    }

    if (monitorType === MonitorType.Ping || monitorType === MonitorType.IP) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.IsOnline ||
          i.value === CheckOn.ResponseTime ||
          i.value === CheckOn.PacketLossPercent ||
          i.value === CheckOn.Jitter ||
          i.value === CheckOn.IsRequestTimeout
        );
      });
    }

    if (monitorType === MonitorType.Port) {
      options = options
        .filter((i: DropdownOption) => {
          return (
            i.value === CheckOn.IsOnline ||
            i.value === CheckOn.ResponseTime ||
            i.value === CheckOn.PortDnsLookupTime ||
            i.value === CheckOn.PortTcpConnectTime ||
            i.value === CheckOn.IsRequestTimeout
          );
        })
        .map((i: DropdownOption) => {
          if (i.value === CheckOn.ResponseTime) {
            return {
              ...i,
              label: "Total Connection Time (DNS + TCP) (in ms)",
            };
          }

          return i;
        });
    }

    if (monitorType === MonitorType.Server) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.IsOnline ||
          i.value === CheckOn.DiskUsagePercent ||
          i.value === CheckOn.CPUUsagePercent ||
          i.value === CheckOn.MemoryUsagePercent ||
          i.value === CheckOn.LoadAverage1Min ||
          i.value === CheckOn.LoadAverage5Min ||
          i.value === CheckOn.LoadAverage15Min ||
          i.value === CheckOn.SwapUsagePercent ||
          i.value === CheckOn.CPUIoWaitPercent ||
          i.value === CheckOn.ServerProcessCommand ||
          i.value === CheckOn.ServerProcessName ||
          i.value === CheckOn.ServerProcessPID
        );
      });
    }

    if (monitorType === MonitorType.CustomJavaScriptCode) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.Error ||
          i.value === CheckOn.ResultValue ||
          i.value === CheckOn.ExecutionTime
        );
      });
    }

    if (monitorType === MonitorType.SyntheticMonitor) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.Error ||
          i.value === CheckOn.ResultValue ||
          i.value === CheckOn.ExecutionTime ||
          i.value === CheckOn.BrowserType ||
          i.value === CheckOn.ScreenSizeType
        );
      });
    }

    if (monitorType === MonitorType.SSLCertificate) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.IsValidCertificate ||
          i.value === CheckOn.IsSelfSignedCertificate ||
          i.value === CheckOn.IsExpiredCertificate ||
          i.value === CheckOn.IsNotAValidCertificate ||
          i.value === CheckOn.IsRevokedCertificate ||
          i.value === CheckOn.ExpiresInDays ||
          i.value === CheckOn.ExpiresInHours
        );
      });
    }

    if (monitorType === MonitorType.IncomingRequest) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.IncomingRequest ||
          i.value === CheckOn.RequestBody ||
          i.value === CheckOn.RequestHeader ||
          i.value === CheckOn.RequestHeaderValue ||
          i.value === CheckOn.JavaScriptExpression
        );
      });
    }

    if (monitorType === MonitorType.IncomingEmail) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.EmailReceivedAt ||
          i.value === CheckOn.EmailSubject ||
          i.value === CheckOn.EmailFrom ||
          i.value === CheckOn.EmailBody ||
          i.value === CheckOn.EmailTo ||
          i.value === CheckOn.JavaScriptExpression
        );
      });
    }

    if (
      monitorType === MonitorType.Website ||
      monitorType === MonitorType.API
    ) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.IsOnline ||
          i.value === CheckOn.ResponseTime ||
          i.value === CheckOn.ResponseBody ||
          i.value === CheckOn.ResponseHeader ||
          i.value === CheckOn.ResponseHeaderValue ||
          i.value === CheckOn.ResponseStatusCode ||
          i.value === CheckOn.JavaScriptExpression ||
          i.value === CheckOn.IsRequestTimeout
        );
      });
    }

    if (monitorType === MonitorType.Logs) {
      options = options.filter((i: DropdownOption) => {
        return i.value === CheckOn.LogCount;
      });
    }

    if (monitorType === MonitorType.SecurityEvents) {
      options = options.filter((i: DropdownOption) => {
        return i.value === CheckOn.SecurityEventCount;
      });
    }

    if (monitorType === MonitorType.Traces) {
      options = options.filter((i: DropdownOption) => {
        return i.value === CheckOn.SpanCount;
      });
    }

    /*
     * AI / LLM monitors compare their answers: the share that was bad
     * first, since that is what most alerts on an AI want, then the count
     * of bad answers and the count of answers ("the AI stopped answering").
     */
    if (monitorType === MonitorType.Llm) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.LlmBadAnswerPercent ||
          i.value === CheckOn.LlmBadAnswerCount ||
          i.value === CheckOn.LlmAnswerCount
        );
      });
    }

    /*
     * Every monitor type whose criteria the server hands to
     * MetricMonitorCriteria (MonitorTypeHelper's one list): the metric-only
     * types this form already pins to CheckOn.MetricValue, plus IoT Device,
     * which is not metric-only here, so it still draws the full criteria UI.
     * All of them alert on one thing - an ingested metric.
     */
    if (MonitorTypeHelper.isMetricBackedMonitor(monitorType)) {
      options = options.filter((i: DropdownOption) => {
        return i.value === CheckOn.MetricValue;
      });
    }

    if (monitorType === MonitorType.Exceptions) {
      /*
       * How many, new ones, ones that came back, and the rise over the
       * usual count (ExceptionMonitorEvaluation).
       */
      options = options.filter((i: DropdownOption) => {
        return isExceptionMeasure(i.value);
      });
    }

    if (monitorType === MonitorType.Profiles) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.ProfileCount ||
          i.value === CheckOn.ProfileFunctionShare
        );
      });
    }

    if (monitorType === MonitorType.NetworkDevice) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.SnmpIsOnline ||
          /*
           * Offered beside "Is Online" because the two now mean different
           * things: a device is online when it answers ping OR its walk
           * succeeds, so a switch whose SNMP agent has stopped answering is
           * still Online while its walk is not succeeding. Without this
           * option an operator has no way to alert on the walk breaking —
           * which is the failure that silently stops interface, topology and
           * inventory data from arriving.
           */
          i.value === CheckOn.SnmpWalkIsSucceeding ||
          i.value === CheckOn.SnmpResponseTime ||
          i.value === CheckOn.SnmpOidValue ||
          i.value === CheckOn.SnmpOidExists ||
          // A counter OID's growth per second: what a counter is alerted on.
          i.value === CheckOn.SnmpOidRatePerSecond ||
          i.value === CheckOn.SnmpInterfaceIsDown ||
          i.value === CheckOn.SnmpInterfaceUtilizationPercent ||
          i.value === CheckOn.SnmpInterfaceErrorsPerSecond ||
          // Optics (SFP, SFP+, QSFP), port by port.
          i.value === CheckOn.SnmpTransceiverNotDetected ||
          i.value === CheckOn.SnmpTransceiverPastAlarmThreshold ||
          i.value === CheckOn.SnmpTransceiverPastWarningThreshold ||
          i.value === CheckOn.SnmpTransceiverRxPowerDrop ||
          i.value === CheckOn.SnmpTransceiverReading ||
          i.value === CheckOn.SnmpTableValue ||
          i.value === CheckOn.SnmpTableRowIsUnhealthy ||
          i.value === CheckOn.SnmpTableRowCount ||
          i.value === CheckOn.SnmpTrapReceived ||
          i.value === CheckOn.SnmpTrapVarbindValue
        );
      });
    }

    if (monitorType === MonitorType.DNS) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.DnsIsOnline ||
          i.value === CheckOn.DnsResponseTime ||
          i.value === CheckOn.DnsRecordValue ||
          i.value === CheckOn.DnssecIsValid ||
          i.value === CheckOn.DnsRecordExists
        );
      });
    }

    /*
     * In CheckOn order, which puts online and synchronized - the two an NTP
     * monitor starts with - first, and a new filter on "NTP Is Online". The
     * stratum, offset and root dispersion are there for the thresholds
     * people add: "stratum at most 2", "offset over 100 ms".
     */
    if (monitorType === MonitorType.NTP) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.NtpIsOnline ||
          i.value === CheckOn.NtpIsSynchronized ||
          i.value === CheckOn.NtpClockOffset ||
          i.value === CheckOn.NtpStratum ||
          i.value === CheckOn.NtpRootDispersion ||
          i.value === CheckOn.NtpResponseTime
        );
      });
    }

    if (monitorType === MonitorType.Domain) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.IsOnline ||
          i.value === CheckOn.IsRequestTimeout ||
          i.value === CheckOn.DomainExpiresDaysIn ||
          i.value === CheckOn.DomainRegistrar ||
          i.value === CheckOn.DomainNameServer ||
          i.value === CheckOn.DomainStatusCode ||
          i.value === CheckOn.DomainIsExpired
        );
      });
    }

    if (monitorType === MonitorType.DNSSEC) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.DnssecChainValid ||
          i.value === CheckOn.DnssecDnskeyExists ||
          i.value === CheckOn.DnssecDsExists ||
          i.value === CheckOn.DnssecResolverConsensus ||
          i.value === CheckOn.DnssecNameserverConsistent ||
          i.value === CheckOn.DnssecSignatureExpiresInDays
        );
      });
    }

    if (monitorType === MonitorType.SQLQuery) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.SqlIsOnline ||
          i.value === CheckOn.SqlQueryRowCount ||
          i.value === CheckOn.SqlQueryScalarValue ||
          i.value === CheckOn.SqlQueryExecutionTime ||
          i.value === CheckOn.SqlQueryError ||
          i.value === CheckOn.JavaScriptExpression
        );
      });
    }

    /*
     * Every collected series is reachable through the one DatabaseMetric
     * check, which names it in databaseMonitorOptions.metricType - the same
     * shape as SnmpOidValue and its OID. A check per metric would put forty
     * entries in this dropdown and forty branches in the evaluator.
     */
    if (monitorType === MonitorType.Database) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.DatabaseIsOnline ||
          i.value === CheckOn.DatabaseMetric ||
          i.value === CheckOn.DatabaseCollectionError ||
          i.value === CheckOn.JavaScriptExpression
        );
      });
    }

    if (monitorType === MonitorType.ExternalStatusPage) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.ExternalStatusPageIsOnline ||
          i.value === CheckOn.ExternalStatusPageOverallStatus ||
          i.value === CheckOn.ExternalStatusPageComponentStatus ||
          i.value === CheckOn.ExternalStatusPageActiveIncidents ||
          i.value === CheckOn.ExternalStatusPageResponseTime
        );
      });
    }

    /*
     * A Probe Status monitor counts the probes it watches. Disconnected
     * Probes leads - "a probe is down" is the rule nearly everyone writes,
     * and a new filter starts on it - then Connected Probes, for "fewer
     * than two are left" on a monitor that watches several, then Probes
     * Behind, for "a probe does not keep up" (#9501).
     */
    if (monitorType === MonitorType.ProbeStatus) {
      options = [
        CheckOn.DisconnectedProbes,
        CheckOn.ConnectedProbes,
        CheckOn.ProbesBehind,
      ]
        .map((checkOn: CheckOn): DropdownOption | undefined => {
          return options.find((i: DropdownOption) => {
            return i.value === checkOn;
          });
        })
        .filter(
          (option: DropdownOption | undefined): option is DropdownOption => {
            return Boolean(option);
          },
        );
    }

    return options;
  }

  public static getFilterTypeOptionsByCheckOn(
    checkOn: CheckOn,
  ): Array<DropdownOption> {
    let options: Array<DropdownOption> =
      DropdownUtil.getDropdownOptionsFromEnum(FilterType);

    if (!checkOn) {
      return [];
    }

    if (
      checkOn === CheckOn.ResponseTime ||
      checkOn === CheckOn.ExecutionTime ||
      checkOn === CheckOn.PacketLossPercent ||
      checkOn === CheckOn.Jitter ||
      checkOn === CheckOn.PortDnsLookupTime ||
      checkOn === CheckOn.PortTcpConnectTime
    ) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.GreaterThanOrEqualTo
        );
      });
    }

    if (
      checkOn === CheckOn.LogCount ||
      checkOn === CheckOn.SpanCount ||
      checkOn === CheckOn.SecurityEventCount ||
      checkOn === CheckOn.MetricValue
    ) {
      /*
       * Span/log counts also support the baseline anomaly filters — the
       * server evaluators (TraceMonitorCriteria / LogMonitorCriteria)
       * compare the observed per-minute rate to windows around the same
       * time of the earlier weeks, read from the monitor's scope in
       * SpanCountBaseline / LogCountBaseline (CountWindowBaseline). Security events have no
       * volume baseline yet, so they keep the static comparators only.
       */
      const allowAnomaly: boolean =
        checkOn === CheckOn.MetricValue ||
        checkOn === CheckOn.LogCount ||
        checkOn === CheckOn.SpanCount;
      options = options.filter((i: DropdownOption) => {
        const baseStatic: boolean =
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.GreaterThanOrEqualTo ||
          i.value === FilterType.EqualTo ||
          /*
           * Right after Equal To, in FilterType's order. Many metrics are a
           * state written as a number - a Windows service's status (4 is
           * Running), a unit's state, an enum gauge - and what is asked of
           * one is "anything but the healthy state" (#10449). Without it,
           * "not Running" took two comparisons (Less Than 4, or Greater
           * Than 4), and Less Than 4 alone missed Paused (7).
           */
          (checkOn === CheckOn.MetricValue &&
            i.value === FilterType.NotEqualTo);
        const baseAnomaly: boolean =
          allowAnomaly &&
          (i.value === FilterType.AnomalouslyHigh ||
            i.value === FilterType.AnomalouslyLow ||
            i.value === FilterType.Anomalous);
        return baseStatic || baseAnomaly;
      });

      /*
       * A metric can also be asked where its trend is headed
       * (MetricMonitorCriteria's forecast), and whether it sent anything at
       * all - last, after the comparisons people pick most.
       */
      if (checkOn === CheckOn.MetricValue) {
        options = [
          ...options,
          {
            label: METRIC_FORECAST_ABOVE_LABEL,
            value: FilterType.ForecastAbove,
          },
          {
            label: METRIC_FORECAST_BELOW_LABEL,
            value: FilterType.ForecastBelow,
          },
          { label: METRIC_HAS_NO_DATA_LABEL, value: FilterType.IsEmpty },
          { label: METRIC_HAS_DATA_LABEL, value: FilterType.IsNotEmpty },
        ];
      }
    }

    /*
     * The AI / LLM numbers are compared by LlmMonitorCriteria with
     * CompareCriteria.compareCriteriaNumbers: these six conditions, and no
     * anomaly baseline behind any of them. Greater Than leads, so a new
     * filter reads "more than 5% of answers were bad" rather than "exactly
     * 5%".
     */
    if (
      checkOn === CheckOn.LlmBadAnswerPercent ||
      checkOn === CheckOn.LlmBadAnswerCount ||
      checkOn === CheckOn.LlmAnswerCount
    ) {
      const llmComparisons: Array<FilterType> = [
        FilterType.GreaterThan,
        FilterType.GreaterThanOrEqualTo,
        FilterType.LessThan,
        FilterType.LessThanOrEqualTo,
        FilterType.EqualTo,
        FilterType.NotEqualTo,
      ];

      options = llmComparisons
        .map((filterType: FilterType): DropdownOption | undefined => {
          return options.find((i: DropdownOption) => {
            return i.value === filterType;
          });
        })
        .filter(
          (option: DropdownOption | undefined): option is DropdownOption => {
            return Boolean(option);
          },
        );
    }

    /*
     * A function's share of the window is judged by ProfileMonitorCriteria
     * with CompareCriteria.compareCriteriaNumbers: above or below a share.
     * Greater Than leads, so a new filter reads "more than 30% of the CPU
     * time"; equal-to a share of sampled time would never fire.
     */
    if (checkOn === CheckOn.ProfileFunctionShare) {
      const shareComparisons: Array<FilterType> = [
        FilterType.GreaterThan,
        FilterType.GreaterThanOrEqualTo,
        FilterType.LessThan,
        FilterType.LessThanOrEqualTo,
      ];

      options = shareComparisons
        .map((filterType: FilterType): DropdownOption | undefined => {
          return options.find((i: DropdownOption) => {
            return i.value === filterType;
          });
        })
        .filter(
          (option: DropdownOption | undefined): option is DropdownOption => {
            return Boolean(option);
          },
        );
    }

    if (isExceptionMeasure(checkOn) || checkOn === CheckOn.ProfileCount) {
      /*
       * Exception and profile counts are whole numbers the server decides
       * on with CompareCriteria.compareCriteriaNumbers
       * (ExceptionMonitorCriteria / ProfileMonitorCriteria). That
       * comparator recognises exactly these six conditions and returns
       * "no match" for every other filter type, so anything else offered
       * here would let the user save a rule that silently never fires.
       *
       * The exception count also supports the anomaly conditions: the
       * server judges them against the monitor's own earlier weeks
       * (ExceptionLearnedBaseline). New and regressed exceptions, the rise
       * over the usual and profile counts have no baseline behind them,
       * and no anomaly branch, so the anomaly conditions stay off for them.
       */
      const allowAnomaly: boolean = checkOn === CheckOn.ExceptionCount;
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.EqualTo ||
          i.value === FilterType.NotEqualTo ||
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.GreaterThanOrEqualTo ||
          (allowAnomaly &&
            (i.value === FilterType.AnomalouslyHigh ||
              i.value === FilterType.AnomalouslyLow ||
              i.value === FilterType.Anomalous))
        );
      });
    }

    if (
      checkOn === CheckOn.CPUUsagePercent ||
      checkOn === CheckOn.DiskUsagePercent ||
      checkOn === CheckOn.MemoryUsagePercent ||
      checkOn === CheckOn.SwapUsagePercent ||
      checkOn === CheckOn.CPUIoWaitPercent ||
      checkOn === CheckOn.LoadAverage1Min ||
      checkOn === CheckOn.LoadAverage5Min ||
      checkOn === CheckOn.LoadAverage15Min
    ) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.GreaterThanOrEqualTo
        );
      });
    }

    if (
      checkOn === CheckOn.ServerProcessPID ||
      checkOn === CheckOn.ServerProcessCommand ||
      checkOn === CheckOn.ServerProcessName
    ) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.IsExecuting ||
          i.value === FilterType.IsNotExecuting
        );
      });
    }

    if (checkOn === CheckOn.IncomingRequest) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.NotRecievedInMinutes ||
          i.value === FilterType.RecievedInMinutes
        );
      });
    }

    if (checkOn === CheckOn.EmailReceivedAt) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.NotRecievedInMinutes ||
          i.value === FilterType.RecievedInMinutes
        );
      });
    }

    if (
      checkOn === CheckOn.EmailSubject ||
      checkOn === CheckOn.EmailFrom ||
      checkOn === CheckOn.EmailBody ||
      checkOn === CheckOn.EmailTo
    ) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.Contains ||
          i.value === FilterType.NotContains ||
          i.value === FilterType.EqualTo ||
          i.value === FilterType.NotEqualTo ||
          i.value === FilterType.StartsWith ||
          i.value === FilterType.EndsWith ||
          i.value === FilterType.IsEmpty ||
          i.value === FilterType.IsNotEmpty
        );
      });
    }

    if (checkOn === CheckOn.IsOnline || checkOn === CheckOn.IsRequestTimeout) {
      options = options.filter((i: DropdownOption) => {
        return i.value === FilterType.True || i.value === FilterType.False;
      });
    }

    if (
      checkOn === CheckOn.ResponseBody ||
      checkOn === CheckOn.ResponseHeader ||
      checkOn === CheckOn.ResponseHeaderValue ||
      checkOn === CheckOn.RequestBody ||
      checkOn === CheckOn.RequestHeader ||
      checkOn === CheckOn.RequestHeaderValue
    ) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.Contains || i.value === FilterType.NotContains
        );
      });
    }

    if (checkOn === CheckOn.ResultValue) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.Contains ||
          i.value === FilterType.NotContains ||
          i.value === FilterType.EqualTo ||
          i.value === FilterType.NotEqualTo ||
          i.value === FilterType.IsEmpty ||
          i.value === FilterType.IsNotEmpty ||
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.GreaterThanOrEqualTo ||
          i.value === FilterType.True ||
          i.value === FilterType.False
        );
      });
    }

    if (checkOn === CheckOn.BrowserType || checkOn === CheckOn.ScreenSizeType) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.EqualTo || i.value === FilterType.NotEqualTo
        );
      });
    }

    if (checkOn === CheckOn.Error) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.Contains ||
          i.value === FilterType.NotContains ||
          i.value === FilterType.EqualTo ||
          i.value === FilterType.NotEqualTo ||
          i.value === FilterType.IsEmpty ||
          i.value === FilterType.IsNotEmpty
        );
      });
    }

    if (checkOn === CheckOn.JavaScriptExpression) {
      options = options.filter((i: DropdownOption) => {
        return i.value === FilterType.EvaluatesToTrue;
      });
    }

    if (checkOn === CheckOn.ResponseStatusCode) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.GreaterThanOrEqualTo ||
          i.value === FilterType.EqualTo ||
          i.value === FilterType.NotEqualTo
        );
      });
    }

    if (
      checkOn === CheckOn.IsValidCertificate ||
      checkOn === CheckOn.IsSelfSignedCertificate ||
      checkOn === CheckOn.IsExpiredCertificate ||
      checkOn === CheckOn.IsNotAValidCertificate ||
      checkOn === CheckOn.IsRevokedCertificate
    ) {
      options = options.filter((i: DropdownOption) => {
        return i.value === FilterType.True || i.value === FilterType.False;
      });
    }

    if (
      checkOn === CheckOn.ExpiresInDays ||
      checkOn === CheckOn.ExpiresInHours
    ) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.GreaterThanOrEqualTo
        );
      });
    }

    if (
      checkOn === CheckOn.SnmpIsOnline ||
      /*
       * "Is False" on the walk means the walk was ATTEMPTED and failed. A
       * poll that ran no walk at all — a device with no credentials, which
       * is only pinged — is not evaluated against this criterion, so it can
       * never raise an incident for a device nobody asked an OID of. See
       * SnmpMonitorCriteria.isWalkDependentCheckOn.
       */
      checkOn === CheckOn.SnmpWalkIsSucceeding ||
      checkOn === CheckOn.SnmpOidExists ||
      checkOn === CheckOn.SnmpInterfaceIsDown ||
      checkOn === CheckOn.SnmpTableRowIsUnhealthy ||
      checkOn === CheckOn.SnmpTransceiverNotDetected ||
      checkOn === CheckOn.SnmpTransceiverPastAlarmThreshold ||
      checkOn === CheckOn.SnmpTransceiverPastWarningThreshold
    ) {
      options = options.filter((i: DropdownOption) => {
        return i.value === FilterType.True || i.value === FilterType.False;
      });
    }

    /*
     * A transceiver reading or the drop in received power is a number: dBm,
     * degrees C, volts, milliamps or dB.
     */
    if (
      checkOn === CheckOn.SnmpTransceiverReading ||
      checkOn === CheckOn.SnmpTransceiverRxPowerDrop
    ) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.GreaterThanOrEqualTo ||
          i.value === FilterType.LessThanOrEqualTo
        );
      });
    }

    /*
     * A table cell or a trap varbind can hold a number or text, so both
     * kinds of comparison are offered - numbers compare as numbers, text
     * against both the raw value and its label (SnmpTableCriteria).
     */
    if (
      checkOn === CheckOn.SnmpTableValue ||
      checkOn === CheckOn.SnmpTrapVarbindValue
    ) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.EqualTo ||
          i.value === FilterType.NotEqualTo ||
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.GreaterThanOrEqualTo ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.Contains ||
          i.value === FilterType.NotContains ||
          i.value === FilterType.StartsWith ||
          i.value === FilterType.EndsWith ||
          i.value === FilterType.IsEmpty ||
          i.value === FilterType.IsNotEmpty
        );
      });
    }

    if (checkOn === CheckOn.SnmpTableRowCount) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.EqualTo ||
          i.value === FilterType.NotEqualTo ||
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.GreaterThanOrEqualTo ||
          i.value === FilterType.LessThanOrEqualTo
        );
      });
    }

    if (
      checkOn === CheckOn.SnmpInterfaceUtilizationPercent ||
      checkOn === CheckOn.SnmpInterfaceErrorsPerSecond
    ) {
      /*
       * Utilization also supports the baseline anomaly filters — the
       * server evaluator (SnmpMonitorCriteria) compares the busiest
       * in-scope interface to this monitor's same-hour-of-week baseline
       * via MetricBaselineService, mirroring the Metric monitor path.
       * Errors/sec has no baselined metric evaluation yet, so it keeps
       * the static comparators only.
       */
      const allowAnomaly: boolean =
        checkOn === CheckOn.SnmpInterfaceUtilizationPercent;
      options = options.filter((i: DropdownOption) => {
        const baseStatic: boolean =
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.GreaterThanOrEqualTo;
        const baseAnomaly: boolean =
          allowAnomaly &&
          (i.value === FilterType.AnomalouslyHigh ||
            i.value === FilterType.AnomalouslyLow ||
            i.value === FilterType.Anomalous);
        return baseStatic || baseAnomaly;
      });
    }

    if (checkOn === CheckOn.SnmpTrapReceived) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.EqualTo ||
          i.value === FilterType.NotEqualTo ||
          i.value === FilterType.Contains ||
          i.value === FilterType.NotContains ||
          i.value === FilterType.StartsWith ||
          i.value === FilterType.EndsWith
        );
      });
    }

    if (
      checkOn === CheckOn.DnsIsOnline ||
      checkOn === CheckOn.DnssecIsValid ||
      checkOn === CheckOn.DnsRecordExists
    ) {
      options = options.filter((i: DropdownOption) => {
        return i.value === FilterType.True || i.value === FilterType.False;
      });
    }

    if (checkOn === CheckOn.DnsResponseTime) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.GreaterThanOrEqualTo
        );
      });
    }

    if (checkOn === CheckOn.DnsRecordValue) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.Contains ||
          i.value === FilterType.NotContains ||
          i.value === FilterType.EqualTo ||
          i.value === FilterType.NotEqualTo ||
          i.value === FilterType.StartsWith ||
          i.value === FilterType.EndsWith
        );
      });
    }

    if (
      checkOn === CheckOn.SnmpResponseTime ||
      // A rate is a number: above or below a threshold.
      checkOn === CheckOn.SnmpOidRatePerSecond
    ) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.GreaterThanOrEqualTo
        );
      });
    }

    if (checkOn === CheckOn.SnmpOidValue) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.Contains ||
          i.value === FilterType.NotContains ||
          i.value === FilterType.EqualTo ||
          i.value === FilterType.NotEqualTo ||
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.GreaterThanOrEqualTo ||
          i.value === FilterType.LessThanOrEqualTo
        );
      });
    }

    if (checkOn === CheckOn.DomainExpiresDaysIn) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.GreaterThanOrEqualTo
        );
      });
    }

    if (
      checkOn === CheckOn.DomainRegistrar ||
      checkOn === CheckOn.DomainNameServer ||
      checkOn === CheckOn.DomainStatusCode
    ) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.Contains ||
          i.value === FilterType.NotContains ||
          i.value === FilterType.EqualTo ||
          i.value === FilterType.NotEqualTo ||
          i.value === FilterType.StartsWith ||
          i.value === FilterType.EndsWith
        );
      });
    }

    if (checkOn === CheckOn.DomainIsExpired) {
      options = options.filter((i: DropdownOption) => {
        return i.value === FilterType.True || i.value === FilterType.False;
      });
    }

    if (
      checkOn === CheckOn.DnssecChainValid ||
      checkOn === CheckOn.DnssecDnskeyExists ||
      checkOn === CheckOn.DnssecDsExists ||
      checkOn === CheckOn.DnssecResolverConsensus ||
      checkOn === CheckOn.DnssecNameserverConsistent
    ) {
      options = options.filter((i: DropdownOption) => {
        return i.value === FilterType.True || i.value === FilterType.False;
      });
    }

    if (checkOn === CheckOn.DnssecSignatureExpiresInDays) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.GreaterThanOrEqualTo
        );
      });
    }

    if (checkOn === CheckOn.SqlIsOnline) {
      options = options.filter((i: DropdownOption) => {
        return i.value === FilterType.True || i.value === FilterType.False;
      });
    }

    if (
      checkOn === CheckOn.SqlQueryRowCount ||
      checkOn === CheckOn.SqlQueryExecutionTime
    ) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.GreaterThanOrEqualTo ||
          i.value === FilterType.EqualTo ||
          i.value === FilterType.NotEqualTo
        );
      });
    }

    if (checkOn === CheckOn.SqlQueryScalarValue) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.GreaterThanOrEqualTo ||
          i.value === FilterType.EqualTo ||
          i.value === FilterType.NotEqualTo ||
          i.value === FilterType.Contains ||
          i.value === FilterType.NotContains ||
          i.value === FilterType.StartsWith ||
          i.value === FilterType.EndsWith
        );
      });
    }

    if (checkOn === CheckOn.SqlQueryError) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.Contains ||
          i.value === FilterType.NotContains ||
          i.value === FilterType.EqualTo ||
          i.value === FilterType.NotEqualTo ||
          i.value === FilterType.IsEmpty ||
          i.value === FilterType.IsNotEmpty
        );
      });
    }

    if (checkOn === CheckOn.DatabaseIsOnline) {
      options = options.filter((i: DropdownOption) => {
        return i.value === FilterType.True || i.value === FilterType.False;
      });
    }

    if (checkOn === CheckOn.DatabaseMetric) {
      /*
       * Listed in reading order instead of being filtered out of the enum,
       * because the default a new filter opens on is options[0] and a
       * database metric is a measurement: "connections used equal to 90" is
       * almost never the rule anyone means. Equality still has to be
       * offered - "replicas connected equal to 0" is a real alert.
       */
      options = [
        FilterType.GreaterThan,
        FilterType.LessThan,
        FilterType.GreaterThanOrEqualTo,
        FilterType.LessThanOrEqualTo,
        FilterType.EqualTo,
        FilterType.NotEqualTo,
      ].map((filterType: FilterType): DropdownOption => {
        return {
          label: filterType.toString(),
          value: filterType,
        };
      });
    }

    if (checkOn === CheckOn.DatabaseCollectionError) {
      /*
       * Ordered for the same reason: the rule worth writing about a
       * collection error is "there is one at all", so Is Not Empty leads
       * even though FilterType declares Is Empty first.
       */
      options = [
        FilterType.IsNotEmpty,
        FilterType.IsEmpty,
        FilterType.Contains,
        FilterType.NotContains,
      ].map((filterType: FilterType): DropdownOption => {
        return {
          label: filterType.toString(),
          value: filterType,
        };
      });
    }

    if (checkOn === CheckOn.ExternalStatusPageIsOnline) {
      options = options.filter((i: DropdownOption) => {
        return i.value === FilterType.True || i.value === FilterType.False;
      });
    }

    if (
      checkOn === CheckOn.NtpIsOnline ||
      checkOn === CheckOn.NtpIsSynchronized
    ) {
      options = options.filter((i: DropdownOption) => {
        return i.value === FilterType.True || i.value === FilterType.False;
      });
    }

    /*
     * Measurements in milliseconds, so the four comparisons; Greater Than
     * leads because "offset over 100 ms" is the rule people mean.
     */
    if (
      checkOn === CheckOn.NtpClockOffset ||
      checkOn === CheckOn.NtpResponseTime ||
      checkOn === CheckOn.NtpRootDispersion
    ) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.GreaterThanOrEqualTo
        );
      });
    }

    /*
     * A whole number from 1 to 16, so equality is a real rule too
     * ("stratum equal to 1" for a GPS server). Greater Than leads: "stratum
     * greater than 2" is the alert most people write.
     */
    if (checkOn === CheckOn.NtpStratum) {
      options = [
        FilterType.GreaterThan,
        FilterType.GreaterThanOrEqualTo,
        FilterType.LessThan,
        FilterType.LessThanOrEqualTo,
        FilterType.EqualTo,
        FilterType.NotEqualTo,
      ].map((filterType: FilterType): DropdownOption => {
        return {
          label: filterType.toString(),
          value: filterType,
        };
      });
    }

    if (checkOn === CheckOn.ExternalStatusPageResponseTime) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.GreaterThanOrEqualTo
        );
      });
    }

    if (checkOn === CheckOn.ExternalStatusPageActiveIncidents) {
      /*
       * Active incidents is a whole-number count, not a measurement, so
       * "is exactly N" reads naturally - "no active incidents" is the
       * out-of-the-box online criteria and it is written as Equal To 0.
       * Leaving Equal To / Not Equal To off this list is what left that
       * seeded criteria showing an empty Filter Condition dropdown: the
       * stored filter type was not among the options the dropdown could
       * render. The server evaluates this check with
       * CompareCriteria.compareCriteriaNumbers, which handles both.
       */
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.EqualTo ||
          i.value === FilterType.NotEqualTo ||
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.GreaterThanOrEqualTo
        );
      });
    }

    /*
     * Probe counts are whole numbers the server compares with
     * CompareCriteria.compareCriteriaNumbers. Greater Than leads, so a new
     * filter reads "more than 0 disconnected"; equality is a real rule too
     * ("0 disconnected" is the online default).
     */
    if (
      checkOn === CheckOn.ConnectedProbes ||
      checkOn === CheckOn.DisconnectedProbes ||
      checkOn === CheckOn.ProbesBehind
    ) {
      options = [
        FilterType.GreaterThan,
        FilterType.GreaterThanOrEqualTo,
        FilterType.LessThan,
        FilterType.LessThanOrEqualTo,
        FilterType.EqualTo,
        FilterType.NotEqualTo,
      ].map((filterType: FilterType): DropdownOption => {
        return {
          label: filterType.toString(),
          value: filterType,
        };
      });
    }

    if (
      checkOn === CheckOn.ExternalStatusPageOverallStatus ||
      checkOn === CheckOn.ExternalStatusPageComponentStatus
    ) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.Contains ||
          i.value === FilterType.NotContains ||
          i.value === FilterType.EqualTo ||
          i.value === FilterType.NotEqualTo ||
          i.value === FilterType.StartsWith ||
          i.value === FilterType.EndsWith
        );
      });
    }

    /*
     * Only a metric criteria forecasts (MetricMonitorCriteria): a check
     * that offers every condition must not offer one no evaluator judges.
     */
    if (checkOn !== CheckOn.MetricValue) {
      options = options.filter((i: DropdownOption) => {
        return !CommonCriteriaFilterUtil.isForecastFilterType(
          i.value as FilterType,
        );
      });
    }

    return options;
  }

  /*
   * The filter condition a brand new filter should start on for a given
   * "check on".
   *
   * Every filter the form hands the user has to arrive with a condition
   * already chosen. A filter with no condition is not just untidy - the
   * server's comparators switch on the filter type and return "no match"
   * for anything they do not recognise, so a criteria carrying a blank
   * condition silently never fires, and the empty dropdown is easy to
   * miss when every field around it is filled in.
   *
   * The first option offered for the check is that default. The option
   * lists above are written in FilterType declaration order, and each is
   * already led by the condition that reads as the natural starting
   * point for its kind of check - True for booleans, Greater Than for
   * measurements, Contains for free text, Equal To for counts and
   * enumerated values, Evaluates To True for JavaScript expressions.
   * Deriving it keeps the default correct by construction: reorder or
   * extend a list and the default follows it.
   */
  public static getDefaultFilterTypeByCheckOn(
    checkOn: CheckOn,
  ): FilterType | undefined {
    const options: Array<DropdownOption> =
      CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(checkOn);

    return options[0]?.value as FilterType | undefined;
  }

  /*
   * Keep the filter type the user already chose when it still applies to
   * the check being switched to, otherwise fall back to that check's
   * default. Used wherever `checkOn` changes underneath an existing
   * filter so the condition dropdown is never left showing nothing.
   */
  public static getFilterTypeOrDefault(data: {
    checkOn: CheckOn;
    filterType?: FilterType | undefined;
  }): FilterType | undefined {
    const options: Array<DropdownOption> =
      CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(data.checkOn);

    const isStillValid: boolean = options.some((option: DropdownOption) => {
      return option.value === data.filterType;
    });

    if (isStillValid) {
      return data.filterType;
    }

    return options[0]?.value as FilterType | undefined;
  }

  /*
   * The "check on" a brand new filter should start on for a monitor type.
   *
   * Prefer the up/down check (or the metric value, on monitor types that
   * only alert on metrics) because that is the check most people reach
   * for first, but only when the monitor type actually offers it - most
   * of the protocol-specific types (DNS, SNMP, SQL, External Status Page,
   * telemetry...) do not, and seeding a check they never offer leaves the
   * Filter Type dropdown blank too. Fall back to the first check the type
   * does offer.
   */
  public static getDefaultCheckOnByMonitorType(
    monitorType: MonitorType,
  ): CheckOn | undefined {
    const options: Array<DropdownOption> =
      CriteriaFilterUtil.getCheckOnOptionsByMonitorType(monitorType);

    const preferredCheckOn: CheckOn =
      CriteriaFilterUtil.isMetricOnlyMonitorType(monitorType)
        ? CheckOn.MetricValue
        : CheckOn.IsOnline;

    const isPreferredOffered: boolean = options.some(
      (option: DropdownOption) => {
        return option.value === preferredCheckOn;
      },
    );

    if (isPreferredOffered) {
      return preferredCheckOn;
    }

    return options[0]?.value as CheckOn | undefined;
  }

  /*
   * Monitor types whose criteria are expressed purely as metric
   * thresholds. Their criteria form hides the "Filter Type" dropdown
   * entirely and pins every filter to CheckOn.MetricValue.
   *
   * Every metric-backed type (MonitorTypeHelper's one list) but IoT Device,
   * which is left out on purpose: its criteria form keeps the full filter
   * UI, so its criteria stay filters, not alert rules.
   */
  public static isMetricOnlyMonitorType(monitorType: MonitorType): boolean {
    return (
      MonitorTypeHelper.isMetricBackedMonitor(monitorType) &&
      monitorType !== MonitorType.IoTDevice
    );
  }

  /*
   * A complete, immediately usable filter for a monitor type - both
   * dropdowns pre-selected. This is what "Add Filter" and "Add Criteria"
   * seed, so a newly added rule is valid the moment it appears instead of
   * waiting on the user to notice an empty dropdown.
   */
  public static getDefaultCriteriaFilter(
    monitorType: MonitorType,
  ): CriteriaFilter {
    const checkOn: CheckOn =
      CriteriaFilterUtil.getDefaultCheckOnByMonitorType(monitorType) ||
      CheckOn.IsOnline;

    const criteriaFilter: CriteriaFilter = {
      checkOn: checkOn,
      filterType: CriteriaFilterUtil.getDefaultFilterTypeByCheckOn(checkOn),
      value: "",
    };

    if (checkOn === CheckOn.MetricValue) {
      criteriaFilter.metricMonitorOptions = {
        metricAggregationType: EvaluateOverTimeType.AnyValue,
      };
    }

    return criteriaFilter;
  }

  /*
   * Bring a filter that was written against one monitor type back to
   * something the criteria form for `monitorType` can actually draw, or
   * report that it cannot be brought back at all.
   *
   * Monitor type and criteria live on different steps of the create form,
   * so a user can seed criteria for a Website, walk back a step, and pick
   * External Status Page instead. The filters they already have then name
   * checks the new type never offers, and both dropdowns render react-
   * select's empty "Select..." placeholder over a rule the server would
   * never match.
   *
   * Repair the smallest thing that is broken:
   *
   *   - check still offered, condition still offered: leave the filter
   *     alone entirely, down to object identity, so callers can tell
   *     "nothing to do" from "repaired" without a deep compare.
   *   - check still offered, condition no longer is: keep the check and
   *     the value the user typed and move the condition to that check's
   *     default. Only reachable for filters stored before a check's
   *     condition list was corrected, and the check still pins what the
   *     rule means, so the meaning survives.
   *   - check no longer offered: return null. The rule cannot be
   *     expressed for this monitor type at all, and the caller has to
   *     decide what to put in its place.
   *
   * Returning null rather than this monitor type's default filter is the
   * whole point. That default is a positive, immediately-firing rule
   * ("is online / True"), so substituting it in place of, say, "is online
   * is False" INVERTS the rule while leaving the criteria's name, its
   * "create incident" flag and its offline monitor status untouched - a
   * criteria that used to fire when the target was down would fire while
   * it was healthy, and open an incident saying it was offline. A stale
   * filter at least failed safe by never matching; a fabricated one does
   * not. Deciding a replacement needs the whole criteria for context, so
   * that decision belongs to the caller, not here.
   */
  public static repairCriteriaFilterForMonitorType(data: {
    criteriaFilter: CriteriaFilter;
    monitorType: MonitorType;
  }): CriteriaFilter | null {
    const { criteriaFilter, monitorType } = data;

    const isCheckOnOffered: boolean =
      CriteriaFilterUtil.getCheckOnOptionsByMonitorType(monitorType).some(
        (option: DropdownOption) => {
          return option.value === criteriaFilter.checkOn;
        },
      );

    if (!isCheckOnOffered) {
      return null;
    }

    const filterType: FilterType | undefined =
      CriteriaFilterUtil.getFilterTypeOrDefault({
        checkOn: criteriaFilter.checkOn,
        filterType: criteriaFilter.filterType,
      });

    if (filterType === criteriaFilter.filterType) {
      return criteriaFilter;
    }

    return {
      ...criteriaFilter,
      filterType: filterType,
    };
  }

  public static isDropdownValueField(data: {
    checkOn?: CheckOn | undefined;
  }): boolean {
    const { checkOn } = data;

    if (
      checkOn === CheckOn.ScreenSizeType ||
      checkOn === CheckOn.BrowserType ||
      checkOn === CheckOn.ExternalStatusPageComponentStatus
    ) {
      return true;
    }

    return false;
  }

  public static getDropdownOptionsByCheckOn(data: {
    checkOn: CheckOn;
  }): Array<DropdownOption> {
    const { checkOn } = data;

    if (checkOn === CheckOn.ScreenSizeType) {
      return DropdownUtil.getDropdownOptionsFromEnum(ScreenSizeType);
    }

    if (checkOn === CheckOn.BrowserType) {
      return DropdownUtil.getDropdownOptionsFromEnum(BrowserType);
    }

    if (checkOn === CheckOn.ExternalStatusPageComponentStatus) {
      /*
       * Canonical component status values reported by external status page
       * providers: Atlassian Statuspage and incident.io report them as they
       * are, and a OneUptime status page's statuses are read as the value
       * they stand for (ExternalStatusPageComponentStatusUtil). The stored
       * value remains the provider's snake_case string so criteria
       * evaluation is unaffected; only the user-facing label is friendly.
       */
      return [
        {
          label: "Operational",
          value: ExternalStatusPageComponentStatusValue.Operational,
        },
        {
          label: "Under Maintenance",
          value: ExternalStatusPageComponentStatusValue.UnderMaintenance,
        },
        {
          label: "Degraded Performance",
          value: ExternalStatusPageComponentStatusValue.DegradedPerformance,
        },
        {
          label: "Partial Outage",
          value: ExternalStatusPageComponentStatusValue.PartialOutage,
        },
        {
          label: "Major Outage",
          value: ExternalStatusPageComponentStatusValue.MajorOutage,
        },
        {
          label: "Full Outage",
          value: ExternalStatusPageComponentStatusValue.FullOutage,
        },
      ];
    }

    return [];
  }

  public static getFilterTypePlaceholderValueByCheckOn(data: {
    monitorType: MonitorType;
    checkOn: CheckOn;
  }): string {
    const { monitorType, checkOn } = data;

    if (!checkOn) {
      return "";
    }

    if (checkOn === CheckOn.ResponseTime) {
      return "5000";
    }

    if (
      checkOn === CheckOn.PortDnsLookupTime ||
      checkOn === CheckOn.PortTcpConnectTime
    ) {
      return "1000";
    }

    if (checkOn === CheckOn.PacketLossPercent) {
      return "2";
    }

    if (checkOn === CheckOn.Jitter) {
      return "30";
    }

    if (checkOn === CheckOn.ServerProcessPID) {
      return "1234";
    }

    if (checkOn === CheckOn.LogCount) {
      return "1";
    }

    if (checkOn === CheckOn.SecurityEventCount) {
      return "1";
    }

    if (checkOn === CheckOn.LlmBadAnswerPercent) {
      return "5";
    }

    if (checkOn === CheckOn.LlmBadAnswerCount) {
      return "3";
    }

    if (checkOn === CheckOn.LlmAnswerCount) {
      return "0";
    }

    // A share of the window, in percent.
    if (checkOn === CheckOn.ProfileFunctionShare) {
      return "30";
    }

    /*
     * A mobile app's crash rate: Android vitals calls more than 1.09% of
     * its users crashing bad behaviour. Its sessions, the fewest a rate is
     * judged on.
     */
    if (checkOn === CheckOn.SessionsWithExceptionsPercent) {
      return "1";
    }

    if (checkOn === CheckOn.SessionCount) {
      return "250";
    }

    /*
     * The same rate per install over a day is the one Android vitals
     * judges (#9924): more than 1.09% of the day's users crashing. Its
     * installs, the fewest a rate is judged on.
     */
    if (checkOn === CheckOn.InstallsWithExceptionsPercent) {
      return "1.09";
    }

    if (checkOn === CheckOn.InstallCount) {
      return "100";
    }

    if (
      checkOn === CheckOn.DisconnectedProbes ||
      checkOn === CheckOn.ProbesBehind
    ) {
      return "0";
    }

    if (checkOn === CheckOn.ConnectedProbes) {
      return "1";
    }

    if (checkOn === CheckOn.ServerProcessCommand) {
      return "node index.js";
    }

    if (checkOn === CheckOn.ServerProcessName) {
      return "node";
    }

    if (
      checkOn === CheckOn.CPUUsagePercent ||
      checkOn === CheckOn.DiskUsagePercent ||
      checkOn === CheckOn.MemoryUsagePercent
    ) {
      return "65";
    }

    if (checkOn === CheckOn.SwapUsagePercent) {
      return "10";
    }

    if (checkOn === CheckOn.CPUIoWaitPercent) {
      return "20";
    }

    if (
      checkOn === CheckOn.LoadAverage1Min ||
      checkOn === CheckOn.LoadAverage5Min ||
      checkOn === CheckOn.LoadAverage15Min
    ) {
      return "2";
    }

    if (checkOn === CheckOn.IncomingRequest) {
      return "5";
    }

    if (checkOn === CheckOn.EmailReceivedAt) {
      return "5";
    }

    if (checkOn === CheckOn.EmailSubject) {
      return "Alert: Server Down";
    }

    if (checkOn === CheckOn.EmailFrom) {
      return "alerts@example.com";
    }

    if (checkOn === CheckOn.EmailBody) {
      return "Error occurred";
    }

    if (checkOn === CheckOn.EmailTo) {
      return "monitor@inbound.oneuptime.com";
    }

    if (
      checkOn === CheckOn.ResponseBody ||
      checkOn === CheckOn.ResponseHeader ||
      checkOn === CheckOn.ResponseHeaderValue ||
      checkOn === CheckOn.RequestBody ||
      checkOn === CheckOn.RequestHeader ||
      checkOn === CheckOn.RequestHeaderValue
    ) {
      return "Some Text";
    }

    if (checkOn === CheckOn.JavaScriptExpression) {
      if (monitorType === MonitorType.IncomingRequest) {
        return "{{requestBody.result}} === true";
      }
      if (monitorType === MonitorType.SQLQuery) {
        return "{{scalarValue}} > 50";
      }
      if (monitorType === MonitorType.Database) {
        return "{{metrics['oneuptime.monitor.database.connections.used.percent']}} > 90";
      }
      return "{{responseBody.result}} === true";
    }

    if (checkOn === CheckOn.SqlQueryRowCount) {
      return "0";
    }

    if (checkOn === CheckOn.SqlQueryScalarValue) {
      return "50";
    }

    if (checkOn === CheckOn.SqlQueryExecutionTime) {
      return "5000";
    }

    if (checkOn === CheckOn.SqlQueryError) {
      return "connection refused";
    }

    if (checkOn === CheckOn.DatabaseMetric) {
      return "90";
    }

    if (checkOn === CheckOn.DatabaseCollectionError) {
      // The group name or the grant named in the collection issue.
      return "pg_monitor";
    }

    if (checkOn === CheckOn.ResponseStatusCode) {
      return "200";
    }

    if (checkOn === CheckOn.ExpiresInDays) {
      return "30";
    }

    if (checkOn === CheckOn.ExpiresInHours) {
      return "24";
    }

    if (checkOn === CheckOn.SnmpResponseTime) {
      return "5000";
    }

    if (checkOn === CheckOn.SnmpOidValue) {
      return "1";
    }

    if (checkOn === CheckOn.SnmpOidRatePerSecond) {
      return "100";
    }

    if (checkOn === CheckOn.SnmpInterfaceUtilizationPercent) {
      return "80";
    }

    if (checkOn === CheckOn.SnmpInterfaceErrorsPerSecond) {
      return "1";
    }

    if (checkOn === CheckOn.SnmpTrapReceived) {
      // linkDown
      return "1.3.6.1.6.3.1.1.5.3";
    }

    if (checkOn === CheckOn.SnmpTableValue) {
      return "1";
    }

    if (checkOn === CheckOn.SnmpTableRowCount) {
      return "1";
    }

    if (checkOn === CheckOn.SnmpTrapVarbindValue) {
      return "tunnel is down";
    }

    // RX power in dBm - the reading most criteria are written on.
    if (checkOn === CheckOn.SnmpTransceiverReading) {
      return "-14";
    }

    if (checkOn === CheckOn.SnmpTransceiverRxPowerDrop) {
      return "2";
    }

    if (checkOn === CheckOn.DnsResponseTime) {
      return "5000";
    }

    if (checkOn === CheckOn.DnsRecordValue) {
      return "192.168.1.1";
    }

    if (checkOn === CheckOn.DomainExpiresDaysIn) {
      return "30";
    }

    if (checkOn === CheckOn.DomainRegistrar) {
      return "GoDaddy";
    }

    if (checkOn === CheckOn.DomainNameServer) {
      return "ns1.example.com";
    }

    if (checkOn === CheckOn.DomainStatusCode) {
      return "clientTransferProhibited";
    }

    if (checkOn === CheckOn.DnssecSignatureExpiresInDays) {
      return "7";
    }

    if (checkOn === CheckOn.ExternalStatusPageResponseTime) {
      return "5000";
    }

    if (checkOn === CheckOn.NtpClockOffset) {
      return "100";
    }

    if (checkOn === CheckOn.NtpStratum) {
      return "2";
    }

    if (checkOn === CheckOn.NtpRootDispersion) {
      return "500";
    }

    if (checkOn === CheckOn.NtpResponseTime) {
      return "1000";
    }

    if (checkOn === CheckOn.ExternalStatusPageOverallStatus) {
      return "operational";
    }

    if (checkOn === CheckOn.ExternalStatusPageComponentStatus) {
      return "operational";
    }

    if (checkOn === CheckOn.ExternalStatusPageActiveIncidents) {
      return "0";
    }

    return "";
  }
}
