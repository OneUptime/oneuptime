import {
  EvaluateOverTimeType,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import MonitorType from "Common/Types/Monitor/MonitorType";
import TelemetryAlertRuleUtil, {
  TelemetryAlertRule,
  TelemetryAlertRuleAction,
  TelemetryAlertRuleShapeProblem,
} from "Common/Types/Monitor/TelemetryAlertRule";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import RollingTimeUtil from "Common/Types/RollingTime/RollingTimeUtil";
import {
  DurationTextPart,
  DurationTextUnit,
  formatDurationText,
  formatDurationUnit,
} from "Common/Types/DateLanguage";
import { TelemetryRulePreviewSummary } from "Common/Types/Monitor/TelemetryRulePreview";
import {
  TranslatableTerm,
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of a telemetry monitor's rule editor - "When to alert" and
 * "What happens" on a Logs, Traces, Exceptions or Metrics monitor's
 * criteria step - kept free of React so the editor and App/Tests read
 * them.
 *
 * The rule is stored as a criteria (Common/Types/Monitor/TelemetryAlertRule);
 * these are the plain words it is edited and read back in: the condition
 * as a choice ("More than"), the window as the forms always offered it
 * ("Last 5 minutes"), and one sentence that says the whole rule ("Alerts
 * when the number of matching logs in 5 minutes is more than 10."). Each
 * sentence is translated whole, with the comparison and the window as the
 * values a language may move.
 */

export interface TelemetryRuleWindowOption {
  value: number;
  label: string;
}

/*
 * A metric rule's windows: the rolling times a metric criteria stores,
 * named the way a count rule's windows are ("Last 5 minutes").
 */
export const METRIC_RULE_WINDOW_OPTIONS: Array<{
  value: RollingTime;
  label: string;
}> = [
  { value: RollingTime.Past1Minute, label: translationKey("Last 1 minute") },
  { value: RollingTime.Past5Minutes, label: translationKey("Last 5 minutes") },
  {
    value: RollingTime.Past10Minutes,
    label: translationKey("Last 10 minutes"),
  },
  {
    value: RollingTime.Past15Minutes,
    label: translationKey("Last 15 minutes"),
  },
  {
    value: RollingTime.Past30Minutes,
    label: translationKey("Last 30 minutes"),
  },
  { value: RollingTime.Past1Hour, label: translationKey("Last 1 hour") },
  { value: RollingTime.Past2Hours, label: translationKey("Last 2 hours") },
  { value: RollingTime.Past3Hours, label: translationKey("Last 3 hours") },
  { value: RollingTime.Past6Hours, label: translationKey("Last 6 hours") },
  { value: RollingTime.Past12Hours, label: translationKey("Last 12 hours") },
  { value: RollingTime.Past1Hours, label: translationKey("Last 24 hours") },
  { value: RollingTime.Past2Days, label: translationKey("Last 2 days") },
  { value: RollingTime.Past3Days, label: translationKey("Last 3 days") },
  { value: RollingTime.Past7Days, label: translationKey("Last 7 days") },
  { value: RollingTime.Past14Days, label: translationKey("Last 14 days") },
  { value: RollingTime.Past30Days, label: translationKey("Last 30 days") },
  { value: RollingTime.Past60Days, label: translationKey("Last 60 days") },
  { value: RollingTime.Past90Days, label: translationKey("Last 90 days") },
  { value: RollingTime.Past180Days, label: translationKey("Last 180 days") },
  { value: RollingTime.Past365Days, label: translationKey("Last 365 days") },
];

/*
 * The windows a Logs, Traces or Exceptions monitor counts over - the
 * eleven its form always offered, under the same words, and the ten
 * minutes the "stop" recipes count over (Logs stop, Requests stop).
 */
export const TELEMETRY_RULE_WINDOW_OPTIONS: Array<TelemetryRuleWindowOption> = [
  { value: 5, label: translationKey("Last 5 seconds") },
  { value: 10, label: translationKey("Last 10 seconds") },
  { value: 30, label: translationKey("Last 30 seconds") },
  { value: 60, label: translationKey("Last 1 minute") },
  { value: 300, label: translationKey("Last 5 minutes") },
  { value: 600, label: translationKey("Last 10 minutes") },
  { value: 900, label: translationKey("Last 15 minutes") },
  { value: 1800, label: translationKey("Last 30 minutes") },
  { value: 3600, label: translationKey("Last 1 hour") },
  { value: 21600, label: translationKey("Last 6 hours") },
  { value: 43200, label: translationKey("Last 12 hours") },
  { value: 86400, label: translationKey("Last 24 hours") },
];

/*
 * The window options for a rule, with the one it holds added when the API
 * stored another length (90 seconds), so the dropdown never drops it.
 */
export const getWindowOptions: (
  current: number | undefined,
) => Array<TelemetryRuleWindowOption> = (
  current: number | undefined,
): Array<TelemetryRuleWindowOption> => {
  if (
    !current ||
    TELEMETRY_RULE_WINDOW_OPTIONS.some(
      (option: TelemetryRuleWindowOption): boolean => {
        return option.value === current;
      },
    )
  ) {
    return TELEMETRY_RULE_WINDOW_OPTIONS;
  }

  return [
    ...TELEMETRY_RULE_WINDOW_OPTIONS,
    { value: current, label: `${current}s` },
  ].sort((a: TelemetryRuleWindowOption, b: TelemetryRuleWindowOption) => {
    return a.value - b.value;
  });
};

/*
 * A window as a sentence says it: "5 minutes", "5 Minuten", "۵ دقیقه" -
 * the largest whole unit, in the reader's language, from the browser's own
 * unit names. English words when the browser has none.
 */
export const formatWindow: (
  seconds: number,
  translator: Translator,
) => string = (seconds: number, translator: Translator): string => {
  const units: Array<{ unit: DurationTextUnit; seconds: number }> = [
    { unit: "day", seconds: 86400 },
    { unit: "hour", seconds: 3600 },
    { unit: "minute", seconds: 60 },
    { unit: "second", seconds: 1 },
  ];

  const whole: { unit: DurationTextUnit; seconds: number } =
    units.find((unit: { unit: DurationTextUnit; seconds: number }) => {
      return seconds >= unit.seconds && seconds % unit.seconds === 0;
    }) || units[units.length - 1]!;

  const count: number = Math.round(seconds / whole.seconds);

  return (
    formatDurationUnit({
      part: { count, unit: whole.unit },
      locale: translator.language || "en",
      unitDisplay: "long",
    }) || `${count} ${whole.unit}${count === 1 ? "" : "s"}`
  );
};

// A metric rule's rolling time, in seconds, as its sentence says it.
export const getRollingTimeInSeconds: (rollingTime: RollingTime) => number = (
  rollingTime: RollingTime,
): number => {
  return Math.round(RollingTimeUtil.getWindowInMs(rollingTime) / 1000);
};

export interface TelemetryRuleChoice<T> {
  value: T;
  label: string;
  description?: string | undefined;
}

/*
 * The Condition choices: how a count, or a metric, is compared. A count is
 * "more than" or "fewer than" a number of things; a metric is "above" or
 * "below" a value.
 */
const COUNT_COMPARISON_LABELS: Record<string, string> = {
  [FilterType.GreaterThan]: translationKey("More than"),
  [FilterType.GreaterThanOrEqualTo]: translationKey("At least"),
  [FilterType.LessThan]: translationKey("Fewer than"),
  [FilterType.LessThanOrEqualTo]: translationKey("At most"),
  [FilterType.EqualTo]: translationKey("Exactly"),
  [FilterType.NotEqualTo]: translationKey("Anything but"),
  [FilterType.AnomalouslyHigh]: translationKey("Unusually high"),
  [FilterType.AnomalouslyLow]: translationKey("Unusually low"),
  [FilterType.Anomalous]: translationKey("Unusually high or low"),
};

const METRIC_COMPARISON_LABELS: Record<string, string> = {
  [FilterType.GreaterThan]: translationKey("Above"),
  [FilterType.GreaterThanOrEqualTo]: translationKey("At or above"),
  [FilterType.LessThan]: translationKey("Below"),
  [FilterType.LessThanOrEqualTo]: translationKey("At or below"),
  [FilterType.EqualTo]: translationKey("Exactly"),
  [FilterType.NotEqualTo]: translationKey("Anything but"),
  [FilterType.AnomalouslyHigh]: translationKey("Unusually high"),
  [FilterType.AnomalouslyLow]: translationKey("Unusually low"),
  [FilterType.Anomalous]: translationKey("Unusually high or low"),
};

// The same comparisons, as they read in the middle of a sentence.
const COUNT_COMPARISON_TERMS: Record<string, string> = {
  [FilterType.GreaterThan]: translationKey("more than"),
  [FilterType.GreaterThanOrEqualTo]: translationKey("at least"),
  [FilterType.LessThan]: translationKey("fewer than"),
  [FilterType.LessThanOrEqualTo]: translationKey("at most"),
  [FilterType.EqualTo]: translationKey("exactly"),
  [FilterType.NotEqualTo]: translationKey("anything but"),
};

/*
 * A value's comparisons are words of their own, not a count's: a language
 * says "is above 80" with another verb than "is more than 10".
 */
const METRIC_COMPARISON_TERMS: Record<string, string> = {
  [FilterType.GreaterThan]: translationKey("above"),
  [FilterType.GreaterThanOrEqualTo]: translationKey("at or above"),
  [FilterType.LessThan]: translationKey("below"),
  [FilterType.LessThanOrEqualTo]: translationKey("at or below"),
  [FilterType.EqualTo]: translationKey("equal to"),
  [FilterType.NotEqualTo]: translationKey("not equal to"),
};

export const getComparisonChoices: (data: {
  monitorType: MonitorType;
  current?: FilterType | undefined;
}) => Array<TelemetryRuleChoice<FilterType>> = (data: {
  monitorType: MonitorType;
  current?: FilterType | undefined;
}): Array<TelemetryRuleChoice<FilterType>> => {
  const labels: Record<string, string> =
    data.monitorType === MonitorType.Metrics
      ? METRIC_COMPARISON_LABELS
      : COUNT_COMPARISON_LABELS;

  return TelemetryAlertRuleUtil.getComparisons(data).map(
    (filterType: FilterType): TelemetryRuleChoice<FilterType> => {
      return {
        value: filterType,
        label: labels[filterType] || filterType,
      };
    },
  );
};

/*
 * How a metric rule reads its window: one number taken from every value
 * the window holds (EvaluateOverTimeType). Left unset, a window is judged
 * by every value (CompareCriteria), which is what the form shows.
 */
export const METRIC_AGGREGATION_CHOICES: Array<
  TelemetryRuleChoice<EvaluateOverTimeType>
> = [
  {
    value: EvaluateOverTimeType.Average,
    label: translationKey("The average"),
  },
  {
    value: EvaluateOverTimeType.MaximumValue,
    label: translationKey("The highest value"),
  },
  {
    value: EvaluateOverTimeType.MunimumValue,
    label: translationKey("The lowest value"),
  },
  { value: EvaluateOverTimeType.Sum, label: translationKey("The sum") },
  {
    value: EvaluateOverTimeType.AllValues,
    label: translationKey("Every value (the whole window)"),
  },
  {
    value: EvaluateOverTimeType.AnyValue,
    label: translationKey("Any value (at any point)"),
  },
];

const METRIC_AGGREGATION_TERMS: Record<string, string> = {
  [EvaluateOverTimeType.Average]: translationKey("the average"),
  [EvaluateOverTimeType.MaximumValue]: translationKey("the highest value"),
  [EvaluateOverTimeType.MunimumValue]: translationKey("the lowest value"),
  [EvaluateOverTimeType.Sum]: translationKey("the sum"),
  [EvaluateOverTimeType.AllValues]: translationKey("every value"),
  [EvaluateOverTimeType.AnyValue]: translationKey("any value"),
};

export const ANOMALY_SENSITIVITY_CHOICES: Array<TelemetryRuleChoice<string>> = [
  {
    value: "Low",
    label: translationKey("Low"),
    description: translationKey("Only big changes from what is normal."),
  },
  {
    value: "Medium",
    label: translationKey("Medium"),
  },
  {
    value: "High",
    label: translationKey("High"),
    description: translationKey("Smaller changes too."),
  },
];

/*
 * What happens when the rule matches. Worded as the monitor
 * recommendations and the burn-rate rules word the same choice.
 */
export const ACTION_CHOICES: Array<
  TelemetryRuleChoice<TelemetryAlertRuleAction>
> = [
  {
    value: TelemetryAlertRuleAction.Alert,
    label: translationKey("Create an alert"),
    description: translationKey(
      "Tells your team. Alerts are not shown on status pages.",
    ),
  },
  {
    value: TelemetryAlertRuleAction.Incident,
    label: translationKey("Declare an incident"),
    description: translationKey(
      "Tells your team, and can be shown on your status pages.",
    ),
  },
  {
    value: TelemetryAlertRuleAction.AlertAndIncident,
    label: translationKey("Both"),
    description: translationKey("Creates an alert and declares an incident."),
  },
];

/*
 * Offered only to a rule that already does this: rules made here always
 * tell someone.
 */
export const STATUS_ONLY_ACTION_CHOICE: TelemetryRuleChoice<TelemetryAlertRuleAction> =
  {
    value: TelemetryAlertRuleAction.StatusOnly,
    label: translationKey("Only change the monitor's status"),
    description: translationKey("Nothing is created, and nobody is told."),
  };

export const getActionChoices: (
  current: TelemetryAlertRuleAction,
) => Array<TelemetryRuleChoice<TelemetryAlertRuleAction>> = (
  current: TelemetryAlertRuleAction,
): Array<TelemetryRuleChoice<TelemetryAlertRuleAction>> => {
  return current === TelemetryAlertRuleAction.StatusOnly
    ? [...ACTION_CHOICES, STATUS_ONLY_ACTION_CHOICE]
    : ACTION_CHOICES;
};

export const TelemetryRuleCopy: {
  whenToAlertTitle: string;
  whenToAlertDescription: string;
  whatHappensTitle: string;
  whatHappensDescription: string;
  conditionTitle: string;
  logCountTitle: string;
  spanCountTitle: string;
  exceptionCountTitle: string;
  metricValueTitle: string;
  windowTitle: string;
  metricTitle: string;
  aggregationTitle: string;
  sensitivityTitle: string;
  noDataTitle: string;
  noDataDescription: string;
  statusTitle: string;
  statusDescription: string;
  ruleNameTitle: string;
  ruleNameDescription: string;
  editAsCustomCriteria: string;
  editAsCustomCriteriaDescription: string;
  backToSimpleRule: string;
  customCriteriaTitle: string;
  customCriteriaDescription: string;
  windowFieldDescription: string;
  metricWindowFieldDescription: string;
  valueRequired: string;
  anomalyHint: string;
  groupedHint: string;
} = {
  whenToAlertTitle: translationKey("When to alert"),
  whenToAlertDescription: translationKey(
    "The rule this monitor checks every minute.",
  ),
  whatHappensTitle: translationKey("What happens"),
  whatHappensDescription: translationKey(
    "An alert or incident notifies its owners, or the project's owners when it has none. Pick an on-call policy to page whoever is on call.",
  ),
  conditionTitle: translationKey("Condition"),
  logCountTitle: translationKey("Number of logs"),
  spanCountTitle: translationKey("Number of spans"),
  exceptionCountTitle: translationKey("Number of exceptions"),
  metricValueTitle: translationKey("Value"),
  windowTitle: translationKey("Time window"),
  metricTitle: translationKey("Metric"),
  aggregationTitle: translationKey("Measured as"),
  sensitivityTitle: translationKey("Sensitivity"),
  noDataTitle: translationKey("If there is no data"),
  noDataDescription: translationKey("What a window with no values counts as."),
  statusTitle: translationKey("Monitor status while it matches"),
  statusDescription: translationKey(
    "The monitor goes back to its default status when the rule stops matching.",
  ),
  ruleNameTitle: translationKey("Rule name"),
  ruleNameDescription: translationKey(
    "Shown with the incidents and alerts this rule opens.",
  ),
  editAsCustomCriteria: translationKey("Edit as custom criteria"),
  editAsCustomCriteriaDescription: translationKey(
    "For several rules, or a rule with more than one filter.",
  ),
  backToSimpleRule: translationKey("Back to the simple rule"),
  customCriteriaTitle: translationKey("When to alert"),
  customCriteriaDescription: translationKey(
    "Checked from top to bottom. The first criteria that matches decides.",
  ),
  windowFieldDescription: translationKey(
    "Every check counts what arrived in this window before it.",
  ),
  metricWindowFieldDescription: translationKey(
    "Every check reads the metric's values in this window before it.",
  ),
  valueRequired: translationKey("Enter the value to compare with."),
  anomalyHint: translationKey(
    "Compared with the same hour of the week over the last 14 days. A new monitor waits until there is enough history.",
  ),
  groupedHint: translationKey(
    "Counted together here. The monitor counts each group on its own.",
  ),
};

/*
 * Why criteria open in the full editor instead of as one rule: one line
 * above them.
 */
export const getShapeProblemText: (
  problem: TelemetryAlertRuleShapeProblem | null,
) => string = (problem: TelemetryAlertRuleShapeProblem | null): string => {
  switch (problem) {
    case TelemetryAlertRuleShapeProblem.SeveralRules:
      return translationKey(
        "These criteria are more than one rule, so each one is shown in full.",
      );
    case TelemetryAlertRuleShapeProblem.DisabledRule:
      return translationKey(
        "This rule is turned off, so it is shown in full. Turn it on there.",
      );
    case TelemetryAlertRuleShapeProblem.SeveralFilters:
      return translationKey(
        "This rule has more than one filter, so it is shown in full.",
      );
    case TelemetryAlertRuleShapeProblem.SeveralIncidentsOrAlerts:
      return translationKey(
        "This rule opens more than one incident or alert, so it is shown in full.",
      );
    default:
      return translationKey(
        "These criteria are not one simple rule, so they are shown in full.",
      );
  }
};

/*
 * The whole rule in one sentence, in the reader's language: what is
 * compared, over which window, with what.
 */
export const getRuleSentence: (data: {
  monitorType: MonitorType;
  rule: Pick<
    TelemetryAlertRule,
    | "filterType"
    | "threshold"
    | "windowInSeconds"
    | "rollingTime"
    | "metricAggregationType"
  >;
  translator: Translator;
  metricName?: string | undefined;
  unit?: string | undefined;
}) => string = (data: {
  monitorType: MonitorType;
  rule: Pick<
    TelemetryAlertRule,
    | "filterType"
    | "threshold"
    | "windowInSeconds"
    | "rollingTime"
    | "metricAggregationType"
  >;
  translator: Translator;
  metricName?: string | undefined;
  unit?: string | undefined;
}): string => {
  const { translator, rule } = data;

  if (data.monitorType === MonitorType.Metrics) {
    return getMetricRuleSentence(data);
  }

  const window: string = formatWindow(rule.windowInSeconds || 60, translator);
  const threshold: number | undefined = rule.threshold;
  const count: string =
    threshold === undefined ? "" : translator.formatNumber(threshold);

  const isNone: boolean =
    threshold !== undefined &&
    ((rule.filterType === FilterType.EqualTo && threshold === 0) ||
      (rule.filterType === FilterType.LessThan && threshold === 1) ||
      (rule.filterType === FilterType.LessThanOrEqualTo && threshold === 0));

  const isAny: boolean =
    threshold !== undefined &&
    ((rule.filterType === FilterType.GreaterThan && threshold === 0) ||
      (rule.filterType === FilterType.GreaterThanOrEqualTo && threshold === 1));

  const comparison: string = COUNT_COMPARISON_TERMS[rule.filterType] || "";

  // A rule whose number is not entered yet says so, not "more than .".
  const hasCount: boolean = threshold !== undefined;

  switch (data.monitorType) {
    case MonitorType.Logs:
      if (rule.filterType === FilterType.AnomalouslyHigh) {
        return translator.translateTemplate(
          "Alerts when matching logs in {{window}} are unusually many for this hour of the week.",
          { window },
        );
      }
      if (rule.filterType === FilterType.AnomalouslyLow) {
        return translator.translateTemplate(
          "Alerts when matching logs in {{window}} are unusually few for this hour of the week.",
          { window },
        );
      }
      if (rule.filterType === FilterType.Anomalous) {
        return translator.translateTemplate(
          "Alerts when matching logs in {{window}} are unusually many or few for this hour of the week.",
          { window },
        );
      }
      if (isNone) {
        return translator.translateTemplate(
          "Alerts when no matching logs arrive in {{window}}.",
          { window },
        );
      }
      if (isAny) {
        return translator.translateTemplate(
          "Alerts when any matching log arrives in {{window}}.",
          { window },
        );
      }
      if (!hasCount) {
        return translator.translateTemplate(
          "Alerts when the number of matching logs in {{window}} is {{comparison}} the number you enter.",
          { window, comparison: translatableTerm(comparison) },
        );
      }
      return translator.translateTemplate(
        "Alerts when the number of matching logs in {{window}} is {{comparison}} {{count}}.",
        { window, count, comparison: translatableTerm(comparison) },
      );
    case MonitorType.Traces:
      if (rule.filterType === FilterType.AnomalouslyHigh) {
        return translator.translateTemplate(
          "Alerts when matching spans in {{window}} are unusually many for this hour of the week.",
          { window },
        );
      }
      if (rule.filterType === FilterType.AnomalouslyLow) {
        return translator.translateTemplate(
          "Alerts when matching spans in {{window}} are unusually few for this hour of the week.",
          { window },
        );
      }
      if (rule.filterType === FilterType.Anomalous) {
        return translator.translateTemplate(
          "Alerts when matching spans in {{window}} are unusually many or few for this hour of the week.",
          { window },
        );
      }
      if (isNone) {
        return translator.translateTemplate(
          "Alerts when no matching spans arrive in {{window}}.",
          { window },
        );
      }
      if (isAny) {
        return translator.translateTemplate(
          "Alerts when any matching span arrives in {{window}}.",
          { window },
        );
      }
      if (!hasCount) {
        return translator.translateTemplate(
          "Alerts when the number of matching spans in {{window}} is {{comparison}} the number you enter.",
          { window, comparison: translatableTerm(comparison) },
        );
      }
      return translator.translateTemplate(
        "Alerts when the number of matching spans in {{window}} is {{comparison}} {{count}}.",
        { window, count, comparison: translatableTerm(comparison) },
      );
    case MonitorType.Exceptions:
      if (isNone) {
        return translator.translateTemplate(
          "Alerts when no matching exceptions happen in {{window}}.",
          { window },
        );
      }
      if (isAny) {
        return translator.translateTemplate(
          "Alerts when any matching exception happens in {{window}}.",
          { window },
        );
      }
      if (!hasCount) {
        return translator.translateTemplate(
          "Alerts when the number of matching exceptions in {{window}} is {{comparison}} the number you enter.",
          { window, comparison: translatableTerm(comparison) },
        );
      }
      return translator.translateTemplate(
        "Alerts when the number of matching exceptions in {{window}} is {{comparison}} {{count}}.",
        { window, count, comparison: translatableTerm(comparison) },
      );
    default:
      return "";
  }
};

const getMetricRuleSentence: (data: {
  rule: Pick<
    TelemetryAlertRule,
    "filterType" | "threshold" | "rollingTime" | "metricAggregationType"
  >;
  translator: Translator;
  metricName?: string | undefined;
  unit?: string | undefined;
}) => string = (data: {
  rule: Pick<
    TelemetryAlertRule,
    "filterType" | "threshold" | "rollingTime" | "metricAggregationType"
  >;
  translator: Translator;
  metricName?: string | undefined;
  unit?: string | undefined;
}): string => {
  const { translator, rule } = data;

  const window: string = formatWindow(
    getRollingTimeInSeconds(rule.rollingTime || RollingTime.Past1Minute),
    translator,
  );
  // Before a metric is picked, the sentence says "the metric".
  const metric: string | TranslatableTerm =
    data.metricName || translatableTerm(translationKey("the metric"));
  const aggregation: string =
    METRIC_AGGREGATION_TERMS[
      rule.metricAggregationType || EvaluateOverTimeType.AllValues
    ] || "";

  if (rule.filterType === FilterType.AnomalouslyHigh) {
    return translator.translateTemplate(
      "Alerts when {{aggregation}} of {{metric}} over the last {{window}} is unusually high for this hour of the week.",
      { window, metric, aggregation: translatableTerm(aggregation) },
    );
  }

  if (rule.filterType === FilterType.AnomalouslyLow) {
    return translator.translateTemplate(
      "Alerts when {{aggregation}} of {{metric}} over the last {{window}} is unusually low for this hour of the week.",
      { window, metric, aggregation: translatableTerm(aggregation) },
    );
  }

  if (rule.filterType === FilterType.Anomalous) {
    return translator.translateTemplate(
      "Alerts when {{aggregation}} of {{metric}} over the last {{window}} is unusually high or low for this hour of the week.",
      { window, metric, aggregation: translatableTerm(aggregation) },
    );
  }

  if (rule.threshold === undefined) {
    return translator.translateTemplate(
      "Alerts when {{aggregation}} of {{metric}} over the last {{window}} is {{comparison}} the value you enter.",
      {
        window,
        metric,
        aggregation: translatableTerm(aggregation),
        comparison: translatableTerm(
          METRIC_COMPARISON_TERMS[rule.filterType] || "",
        ),
      },
    );
  }

  const value: string = `${translator.formatNumber(rule.threshold)}${
    data.unit ? ` ${data.unit}` : ""
  }`;

  return translator.translateTemplate(
    "Alerts when {{aggregation}} of {{metric}} over the last {{window}} is {{comparison}} {{value}}.",
    {
      window,
      metric,
      value,
      aggregation: translatableTerm(aggregation),
      comparison: translatableTerm(
        METRIC_COMPARISON_TERMS[rule.filterType] || "",
      ),
    },
  );
};

// The count a count rule compares, as its field is titled.
export const getCountTitle: (monitorType: MonitorType) => string = (
  monitorType: MonitorType,
): string => {
  switch (monitorType) {
    case MonitorType.Traces:
      return TelemetryRuleCopy.spanCountTitle;
    case MonitorType.Exceptions:
      return TelemetryRuleCopy.exceptionCountTitle;
    case MonitorType.Metrics:
      return TelemetryRuleCopy.metricValueTitle;
    default:
      return TelemetryRuleCopy.logCountTitle;
  }
};

/*
 * The preview's caption: what each bar counts, and over how long the
 * preview reads.
 */
export const getPreviewCaption: (data: {
  monitorType: MonitorType;
  windowInSeconds: number;
  rangeInSeconds: number;
  translator: Translator;
}) => string = (data: {
  monitorType: MonitorType;
  windowInSeconds: number;
  rangeInSeconds: number;
  translator: Translator;
}): string => {
  const window: string = formatWindow(data.windowInSeconds, data.translator);
  const range: string = formatWindow(data.rangeInSeconds, data.translator);

  switch (data.monitorType) {
    case MonitorType.Traces:
      return data.translator.translateTemplate(
        "Matching spans in each {{window}}, over the last {{range}}.",
        { window, range },
      );
    case MonitorType.Exceptions:
      return data.translator.translateTemplate(
        "Matching exceptions in each {{window}}, over the last {{range}}.",
        { window, range },
      );
    default:
      return data.translator.translateTemplate(
        "Matching logs in each {{window}}, over the last {{range}}.",
        { window, range },
      );
  }
};

/*
 * What the preview found: how often the rule would have fired over the
 * windows read, or that it would not have.
 */
export const getPreviewVerdict: (data: {
  summary: TelemetryRulePreviewSummary;
  windowInSeconds: number;
  // Whether the rule matches a window with nothing in it ("no logs").
  matchesNothing: boolean;
  translator: Translator;
}) => string = (data: {
  summary: TelemetryRulePreviewSummary;
  windowInSeconds: number;
  matchesNothing: boolean;
  translator: Translator;
}): string => {
  const { summary, translator } = data;

  if (!summary.hasData) {
    return (
      translator.translateText(
        data.matchesNothing
          ? "Nothing matched in this time, so this rule would alert as soon as the monitor is saved."
          : "Nothing matched in this time.",
      ) || ""
    );
  }

  if (summary.timesItWouldHaveFired === 0) {
    return (
      translator.translateText(
        "This rule would not have alerted in this time.",
      ) || ""
    );
  }

  return translator.translatePlural(
    {
      // With its number: Russian says this form for 21 as well.
      one: "This rule would have alerted {{count}} time, for {{duration}}.",
      other:
        "This rule would have alerted {{count}} times, for {{duration}} in all.",
    },
    summary.timesItWouldHaveFired,
    {
      duration: formatDuration(
        summary.matchedWindowCount * data.windowInSeconds,
        translator,
      ),
    },
  );
};

/*
 * A length of time as a sentence says it, in its two largest units: "4
 * hours, 5 minutes", "4 Stunden und 5 Minuten" - in the reader's language,
 * English words when the browser has none.
 */
export const formatDuration: (
  seconds: number,
  translator: Translator,
) => string = (seconds: number, translator: Translator): string => {
  const units: Array<{ unit: DurationTextUnit; seconds: number }> = [
    { unit: "day", seconds: 86400 },
    { unit: "hour", seconds: 3600 },
    { unit: "minute", seconds: 60 },
    { unit: "second", seconds: 1 },
  ];

  let remaining: number = Math.max(0, Math.round(seconds));
  const parts: Array<DurationTextPart> = [];

  for (const unit of units) {
    const count: number = Math.floor(remaining / unit.seconds);

    if (count > 0) {
      parts.push({ count, unit: unit.unit });
      remaining -= count * unit.seconds;
    }

    if (parts.length === 2) {
      break;
    }
  }

  if (parts.length === 0) {
    return formatWindow(seconds || 1, translator);
  }

  return (
    formatDurationText({
      parts,
      locale: translator.language || "en",
      unitDisplay: "long",
      listStyle: "long",
    }) ||
    parts
      .map((part: DurationTextPart) => {
        return `${part.count} ${part.unit}${part.count === 1 ? "" : "s"}`;
      })
      .join(", ")
  );
};

export default TelemetryRuleCopy;
