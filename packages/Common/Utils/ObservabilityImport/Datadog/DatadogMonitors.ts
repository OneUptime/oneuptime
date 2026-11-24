import {
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../Types/Monitor/CriteriaFilter";
import {
  AlertImportItem,
  AlertImportPlan,
  ConvertedQuery,
  IMPORT_MAX_ITEMS,
  ImportItemStatus,
  ImportNote,
  ImportNoteKind,
  ImportQueryOverrides,
  ImportSourceKind,
  ImportStatusUtil,
  ImportedAlertRuleKind,
  ImportedAlertSeverity,
  NO_QUERY_OVERRIDES,
} from "../../../Types/ObservabilityImport/ObservabilityImport";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import { translationKey } from "../../../Types/Translator";
import {
  ALERT_TEXT_TEMPLATE_LEFT_OUT,
  REMOVED_TEMPLATE,
  readImportWindow,
  tidyAlertText,
} from "../AlertImportCommon";
import {
  ImportObject,
  asObject,
  arrayField,
  booleanField,
  numberField,
  objectField,
  textField,
} from "../ImportValues";
import {
  readDatadogLogField,
  toDatadogMetricAttributeKey,
} from "./DatadogAttributes";
import {
  ConvertedLogMonitor,
  DatadogLogMonitorQuery,
  LOG_MONITOR_COMPARISONS,
  convertDatadogLogMonitorQuery,
  parseDatadogLogMonitorQuery,
} from "./DatadogLogs";
import {
  ConvertedAnomaly,
  ConvertedForecast,
  DatadogMonitorFunction,
  convertDatadogAnomaly,
  convertDatadogForecast,
  readDatadogDurationMs,
  readDatadogMonitorFunction,
  readFirstArgumentText,
} from "./DatadogMonitorFunctions";
import {
  DatadogMetricKind,
  DatadogQueryContext,
  convertDatadogQuery,
  readDatadogAsCountMetricNames,
  readDatadogMetricNames,
  toDatadogTagLabel,
} from "./DatadogPromQL";
import {
  DatadogExpression,
  DatadogExpressionKind,
  DatadogMonitorQuery,
  DatadogQueryError,
  parseDatadogExpression,
  parseDatadogMonitorQuery,
} from "./DatadogQueryParser";

/*
 * DATADOG'S MONITORS, AS ONEUPTIME'S (issues #7697, #10324, #10325).
 *
 * Read from a monitor's Export (its JSON), GET /api/v1/monitor (a list),
 * or an integration's monitor asset ({"definition": {...}}). A metric
 * monitor's query names how it reads its window, the window, the metric
 * query and the threshold:
 *
 *   avg(last_5m):avg:system.cpu.user{env:prod} by {host} > 90
 *
 * It becomes one PromQL step over what the Datadog Agent sent: each check
 * reads the minute before it the way the window is read (avg_over_time
 * for avg, max_over_time for max...), the window is read as Datadog reads
 * it (its average, highest, lowest or total), and a monitor grouped `by`
 * a tag opens an alert for each group, as Datadog's multi alert does.
 * Its critical threshold is the condition; its name and message are the
 * alert's title and description.
 *
 * A metric monitor of anomalies() or forecast() is a monitor of OneUptime's
 * own anomaly or forecast condition (DatadogMonitorFunctions), and a log
 * monitor a Logs monitor counting the logs its search matches
 * (DatadogLogs).
 *
 * Monitors of traces, events, services, processes and the other kinds read
 * data OneUptime does not import, and outlier and change monitors have no
 * condition like them: they are listed with why.
 */

export const MONITOR_TYPE_NOT_SUPPORTED: string = translationKey(
  "It is a Datadog {{type}} monitor: OneUptime imports Datadog's metric and log monitors.",
);

export const MONITOR_QUERY_NOT_READ: string = translationKey(
  "OneUptime cannot read this monitor's query: {{error}}",
);

export const MONITOR_TIME_AGGREGATION_NOT_READ: string = translationKey(
  "Datadog reads its window with {{function}}, which a OneUptime monitor does not.",
);

export const MONITOR_WARNING_LEFT_OUT: string = translationKey(
  "Datadog's warning threshold of {{warning}} is left out: OneUptime alerts at the critical threshold.",
);

export const MONITOR_RECOVERY_LEFT_OUT: string = translationKey(
  "Datadog's recovery threshold is left out: OneUptime resolves once the value no longer breaches.",
);

export const MONITOR_NO_DATA_ALERTS: string = translationKey(
  "Datadog alerts when there is no data, and so does this monitor.",
);

export const MONITOR_NOTIFICATIONS_LEFT_OUT: string = translationKey(
  "Datadog's notification handles ({{handles}}) are not imported: page people with on-call policies.",
);

export const MONITOR_EVALUATION_DELAY: string = translationKey(
  "Datadog waits {{seconds}} seconds for late data; OneUptime checks the latest minute.",
);

// Datadog's monitor types that read metrics.
const METRIC_MONITOR_TYPES: ReadonlySet<string> = new Set<string>([
  "metric alert",
  "query alert",
]);

// Datadog's monitor type of a log monitor.
const LOG_MONITOR_TYPE: string = "log alert";

const AGGREGATIONS: ReadonlyMap<string, EvaluateOverTimeType> = new Map<
  string,
  EvaluateOverTimeType
>([
  ["avg", EvaluateOverTimeType.Average],
  ["sum", EvaluateOverTimeType.Sum],
  ["max", EvaluateOverTimeType.MaximumValue],
  ["min", EvaluateOverTimeType.MunimumValue],
]);

const COMPARISONS: ReadonlyMap<string, FilterType> = new Map<
  string,
  FilterType
>([
  [">", FilterType.GreaterThan],
  [">=", FilterType.GreaterThanOrEqualTo],
  ["<", FilterType.LessThan],
  ["<=", FilterType.LessThanOrEqualTo],
  ["==", FilterType.EqualTo],
  ["=", FilterType.EqualTo],
  ["!=", FilterType.NotEqualTo],
]);

const WINDOW_UNIT_SECONDS: ReadonlyMap<string, number> = new Map<
  string,
  number
>([
  ["m", 60],
  ["h", 3600],
  ["d", 86400],
  ["w", 7 * 86400],
]);

// "last_5m" in milliseconds; NaN for anything else.
const readWindowMs: (window: string) => number = (window: string): number => {
  const match: RegExpMatchArray | null = window.match(
    /^last_([0-9]+)([mhdw])$/,
  );

  if (!match) {
    return Number.NaN;
  }

  return (
    Number(match[1]) * (WINDOW_UNIT_SECONDS.get(match[2] || "") || 0) * 1000
  );
};

/*
 * Datadog's conditional blocks that do not describe an open alert: their
 * text is not the alert's. {{^is_warning}} - not warning - is.
 */
const NOT_ALERT_BLOCKS: ReadonlySet<string> = new Set<string>([
  "is_warning",
  "is_warning_recovery",
  "is_recovery",
  "is_alert_recovery",
  "is_no_data",
  "is_no_data_recovery",
  "is_renotify",
  "is_alert_to_warning",
  "is_warning_to_alert",
]);

// A block's own tag: {{#is_alert}}, {{^is_warning}}, {{/is_alert}}.
const BLOCK_TAG: RegExp = /^[#^/]/;

// A group's value: {{[@cisco_aci.code].name}}, a log facet's, in brackets.
const GROUP_VALUE_IN_BRACKETS: RegExp = /^\[@?([^\]\s]+)\]\.name$/;

// A group's value: {{host.name}}, {{@http.status_code.name}}.
const GROUP_VALUE_NAME: RegExp = /^@?([A-Za-z0-9_.-]+)\.name$/;

// A log monitor's group value by its facet alone: {{@Connector}}.
const LOG_FACET_VALUE: RegExp = /^@([A-Za-z0-9_.-]+)$/;

// The text of a Datadog message as it reads for an open alert.
const keepAlertBlocks: (text: string) => string = (text: string): string => {
  let current: string = text;

  // Blocks inside blocks: the outer is read first, then what it held.
  for (let pass: number = 0; pass < 10; pass++) {
    const next: string = current.replace(
      /\{\{\s*([#^])\s*([A-Za-z_]+)[^{}]*\}\}([\s\S]*?)\{\{\s*\/\s*\2\s*\}\}/g,
      (_match: string, sign: string, name: string, inner: string): string => {
        const isAlert: boolean =
          name === "is_alert" || !NOT_ALERT_BLOCKS.has(name);
        const shown: boolean = sign === "#" ? isAlert : !isAlert;
        return shown ? inner : "";
      },
    );

    if (next === current) {
      break;
    }

    current = next;
  }

  return current;
};

/*
 * A Datadog monitor's text, as it reads for an open alert: a group's tag
 * ({{host.name}}) is the label OneUptime's alert fills from its series -
 * {{resource_host_name}} for a PromQL step's series, which `labelOf` names
 * (a Logs monitor's group is named by its attribute, {{resource.host.name}});
 * {{threshold}} and {{comparator}} are the monitor's own; the text of
 * {{#is_alert}} blocks stays, and the text of blocks for a warning, a
 * recovery or no data goes. The value and notification handles are left
 * out, and said.
 */
export const convertDatadogMessage: (data: {
  text: string;
  notes: Array<ImportNote>;
  threshold?: number | undefined;
  comparison?: string | undefined;
  labelOf?: ((tag: string) => string) | undefined;
}) => string = (data: {
  text: string;
  notes: Array<ImportNote>;
  threshold?: number | undefined;
  comparison?: string | undefined;
  labelOf?: ((tag: string) => string) | undefined;
}): string => {
  const labelOf: (tag: string) => string = data.labelOf || toDatadogTagLabel;
  const handles: Array<string> = (
    data.text.match(/(^|\s)@[\w.+@-]+/g) || []
  ).map((handle: string): string => {
    return handle.trim();
  });

  if (handles.length > 0) {
    data.notes.push({
      kind: ImportNoteKind.Info,
      text: MONITOR_NOTIFICATIONS_LEFT_OUT,
      values: { handles: Array.from(new Set(handles)).join(", ") },
    });
  }

  let leftOut: boolean = false;

  const converted: string = keepAlertBlocks(data.text)
    .replace(/\{\{([^{}]*)\}\}/g, (_match: string, inner: string): string => {
      const name: string = inner.trim();
      /*
       * A group's tag is the series' label: {{host.name}} is the host's,
       * and a log facet's {{[@http.status_code].name}},
       * {{@http.status_code.name}} or {{@http.status_code}}.
       */
      const tag: RegExpMatchArray | null =
        name.match(GROUP_VALUE_IN_BRACKETS) ||
        name.match(GROUP_VALUE_NAME) ||
        name.match(LOG_FACET_VALUE);

      if (tag) {
        return `{{${labelOf(tag[1] || "")}}}`;
      }

      if (name === "threshold" && data.threshold !== undefined) {
        return String(data.threshold);
      }

      if (name === "comparator" && data.comparison) {
        return data.comparison;
      }

      // A block left over, the value, the warning threshold: they go.
      if (!BLOCK_TAG.test(name)) {
        leftOut = true;
      }

      return REMOVED_TEMPLATE;
    })
    .replace(/(^|\s)@[\w.+@-]+/g, "$1")
    // A link into Datadog's own app leads nowhere here: its words stay.
    .replace(/\[([^\]]*)\]\(\/[^)]*\)/g, "$1");

  if (leftOut) {
    data.notes.push({
      kind: ImportNoteKind.Info,
      text: ALERT_TEXT_TEMPLATE_LEFT_OUT,
    });
  }

  return tidyAlertText(converted);
};

export const getDatadogMonitorTargetKey: (itemKey: string) => string = (
  itemKey: string,
): string => {
  return `${itemKey}:query`;
};

// What every converted monitor shares: its name, tags and where it sits.
type MonitorBase = Pick<
  AlertImportItem,
  "key" | "name" | "group" | "sourceType" | "isEnabledInSource"
>;

const notConvertedMonitor: (
  base: MonitorBase,
  note: ImportNote,
) => AlertImportItem = (
  base: MonitorBase,
  note: ImportNote,
): AlertImportItem => {
  return { ...base, status: ImportItemStatus.NotConverted, notes: [note] };
};

const queryNotRead: (base: MonitorBase, error: unknown) => AlertImportItem = (
  base: MonitorBase,
  error: unknown,
): AlertImportItem => {
  return notConvertedMonitor(base, {
    kind: ImportNoteKind.Reason,
    text: MONITOR_QUERY_NOT_READ,
    values: {
      error:
        error instanceof DatadogQueryError || error instanceof Error
          ? error.message
          : String(error),
    },
  });
};

/*
 * What every kind of monitor reads the same way from its options and text:
 * its warning and recovery thresholds, no data, its delay, its alert's
 * title and text, its priority.
 */
interface MonitorOutcome {
  notifiesNoData: boolean;
  severity: ImportedAlertSeverity;
  title: string;
  description: string;
  monitorDescription: string;
}

const readMonitorOutcome: (data: {
  monitor: ImportObject;
  notes: Array<ImportNote>;
  threshold: number;
  comparison: string;
  // A group's tag as the label its alert names it by.
  labelOf: (tag: string) => string;
  /*
   * A recovery of 0 is what OneUptime does on its own, for an anomaly:
   * resolved once no value in the window is anomalous.
   */
  isRecoveryAtZeroOwn?: boolean | undefined;
}) => MonitorOutcome = (data: {
  monitor: ImportObject;
  notes: Array<ImportNote>;
  threshold: number;
  comparison: string;
  labelOf: (tag: string) => string;
  isRecoveryAtZeroOwn?: boolean | undefined;
}): MonitorOutcome => {
  const options: ImportObject | undefined = objectField(
    data.monitor,
    "options",
  );
  const thresholds: ImportObject | undefined = objectField(
    options,
    "thresholds",
  );
  const warning: number | undefined = numberField(thresholds, "warning");

  if (warning !== undefined) {
    data.notes.push({
      kind: ImportNoteKind.Approximation,
      text: MONITOR_WARNING_LEFT_OUT,
      values: { warning: String(warning) },
    });
  }

  const criticalRecovery: number | undefined = numberField(
    thresholds,
    "critical_recovery",
  );

  if (
    (criticalRecovery !== undefined &&
      !(data.isRecoveryAtZeroOwn && criticalRecovery === 0)) ||
    numberField(thresholds, "warning_recovery") !== undefined
  ) {
    data.notes.push({
      kind: ImportNoteKind.Approximation,
      text: MONITOR_RECOVERY_LEFT_OUT,
    });
  }

  const notifiesNoData: boolean =
    booleanField(options, "notify_no_data") === true;

  if (notifiesNoData) {
    data.notes.push({
      kind: ImportNoteKind.Info,
      text: MONITOR_NO_DATA_ALERTS,
    });
  }

  const delay: number | undefined = numberField(options, "evaluation_delay");

  if (delay !== undefined && delay > 0) {
    data.notes.push({
      kind: ImportNoteKind.Info,
      text: MONITOR_EVALUATION_DELAY,
      values: { seconds: String(delay) },
    });
  }

  const name: string = textField(data.monitor, "name");
  const message: string = convertDatadogMessage({
    text: textField(data.monitor, "message"),
    notes: data.notes,
    threshold: data.threshold,
    comparison: data.comparison,
    labelOf: data.labelOf,
  });
  const title: string =
    convertDatadogMessage({
      text: name,
      notes: [],
      threshold: data.threshold,
      comparison: data.comparison,
      labelOf: data.labelOf,
    }) || name;
  const priority: number | undefined = numberField(data.monitor, "priority");

  return {
    notifiesNoData,
    severity:
      priority !== undefined && priority >= 3
        ? ImportedAlertSeverity.Warning
        : ImportedAlertSeverity.Critical,
    title,
    description: message,
    monitorDescription: textField(data.monitor, "description") || message,
  };
};

// A metric's tag as the attribute a builder query's series are named by.
const attributeLabelOf: (tag: string) => string = (tag: string): string => {
  return toDatadogMetricAttributeKey(tag);
};

// A log facet as the attribute a Logs monitor's groups are named by.
const logLabelOf: (tag: string) => string = (tag: string): string => {
  return readDatadogLogField(tag).attributeKey || tag;
};

/*
 * A log monitor (issue #10324): logs("<search>")...last("5m") > 10 as a
 * Logs monitor counting the logs its search matches in the window.
 */
const convertLogMonitor: (data: {
  monitor: ImportObject;
  base: MonitorBase;
}) => AlertImportItem = (data: {
  monitor: ImportObject;
  base: MonitorBase;
}): AlertImportItem => {
  let query: DatadogLogMonitorQuery;

  try {
    query = parseDatadogLogMonitorQuery(textField(data.monitor, "query"));
  } catch (error) {
    return queryNotRead(data.base, error);
  }

  const filterType: FilterType | undefined = LOG_MONITOR_COMPARISONS.get(
    query.comparison,
  );
  const windowMs: number = readDatadogDurationMs(query.window);

  if (!filterType) {
    return queryNotRead(data.base, query.comparison);
  }

  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    return queryNotRead(data.base, query.window || "last()");
  }

  const converted: ConvertedLogMonitor = convertDatadogLogMonitorQuery(query);

  if (!converted.logQuery) {
    return {
      ...data.base,
      status: ImportItemStatus.NotConverted,
      notes: converted.notes,
    };
  }

  const notes: Array<ImportNote> = [...converted.notes];
  const windowInSeconds: number = Math.round(windowMs / 1000);
  const outcome: MonitorOutcome = readMonitorOutcome({
    monitor: data.monitor,
    notes,
    threshold: query.threshold,
    comparison: query.comparison,
    labelOf: logLabelOf,
  });

  return {
    ...data.base,
    status: ImportStatusUtil.fromNotes(notes),
    notes,
    rule: {
      kind: ImportedAlertRuleKind.LogCount,
      promQL: "",
      logQuery: converted.logQuery,
      filterType,
      threshold: query.threshold,
      // The window a metric rule would read, for the preview's words.
      rollingTime: readImportWindow({
        ms: windowMs,
        sourceText: query.window,
        notes: [],
      }),
      windowInSeconds,
      aggregation: EvaluateOverTimeType.Sum,
      // A log count is 0 when nothing matches, and compared as one.
      onNoData: NoDataPolicy.Ignore,
      severity: outcome.severity,
      title: outcome.title,
      description: outcome.description,
      monitorDescription: outcome.monitorDescription,
    },
  };
};

/*
 * An anomaly monitor (issue #10325) as a Metrics monitor of one metric
 * read by the query builder, whose condition is OneUptime's anomaly
 * condition (DatadogMonitorFunctions).
 */
const convertAnomalyMonitor: (data: {
  monitor: ImportObject;
  base: MonitorBase;
  query: DatadogMonitorQuery;
  call: Extract<DatadogExpression, { kind: DatadogExpressionKind.Call }>;
}) => AlertImportItem = (data: {
  monitor: ImportObject;
  base: MonitorBase;
  query: DatadogMonitorQuery;
  call: Extract<DatadogExpression, { kind: DatadogExpressionKind.Call }>;
}): AlertImportItem => {
  const anomaly: ConvertedAnomaly = convertDatadogAnomaly({
    call: data.call,
    threshold: data.query.threshold,
  });

  if (
    !anomaly.metricQuery ||
    !anomaly.filterType ||
    !anomaly.rollingTime ||
    !anomaly.aggregation
  ) {
    return {
      ...data.base,
      status: ImportItemStatus.NotConverted,
      notes: anomaly.notes,
    };
  }

  const notes: Array<ImportNote> = [...anomaly.notes];
  const outcome: MonitorOutcome = readMonitorOutcome({
    monitor: data.monitor,
    notes,
    threshold: data.query.threshold,
    comparison: data.query.comparison,
    labelOf: attributeLabelOf,
    isRecoveryAtZeroOwn: true,
  });

  return {
    ...data.base,
    status: ImportStatusUtil.fromNotes(notes),
    notes,
    rule: {
      kind: ImportedAlertRuleKind.MetricQuery,
      promQL: "",
      metricQuery: anomaly.metricQuery,
      filterType: anomaly.filterType,
      threshold: data.query.threshold,
      rollingTime: anomaly.rollingTime,
      aggregation: anomaly.aggregation,
      anomalySensitivity: anomaly.sensitivity,
      onNoData: outcome.notifiesNoData
        ? NoDataPolicy.Trigger
        : NoDataPolicy.Ignore,
      severity: outcome.severity,
      title: outcome.title,
      description: outcome.description,
      monitorDescription: outcome.monitorDescription,
    },
  };
};

/*
 * A forecast monitor (issue #10325) as a Metrics monitor with one PromQL
 * step, whose condition is OneUptime's forecast condition
 * (DatadogMonitorFunctions).
 */
const convertForecastMonitor: (data: {
  monitor: ImportObject;
  base: MonitorBase;
  query: DatadogMonitorQuery;
  call: Extract<DatadogExpression, { kind: DatadogExpressionKind.Call }>;
  targetKey: string;
  overrides: ImportQueryOverrides;
  knownMetricKinds?: ReadonlyMap<string, DatadogMetricKind> | undefined;
  rateIntervalsInSeconds?: ReadonlyMap<string, number> | undefined;
}) => AlertImportItem = (data: {
  monitor: ImportObject;
  base: MonitorBase;
  query: DatadogMonitorQuery;
  call: Extract<DatadogExpression, { kind: DatadogExpressionKind.Call }>;
  targetKey: string;
  overrides: ImportQueryOverrides;
  knownMetricKinds?: ReadonlyMap<string, DatadogMetricKind> | undefined;
  rateIntervalsInSeconds?: ReadonlyMap<string, number> | undefined;
}): AlertImportItem => {
  const queryText: string | undefined = readFirstArgumentText(
    data.query.expression,
  );

  if (!queryText || !["<", "<=", ">", ">="].includes(data.query.comparison)) {
    return queryNotRead(data.base, data.query.comparison || "forecast()");
  }

  const forecast: ConvertedForecast = convertDatadogForecast({
    call: data.call,
    queryText,
    comparison: data.query.comparison,
    horizon: data.query.window,
    knownMetricKinds: data.knownMetricKinds,
    rateIntervalsInSeconds: data.rateIntervalsInSeconds,
    aiQuery: data.overrides.get(data.targetKey),
  });

  if (
    forecast.converted.status === ImportItemStatus.NotConverted ||
    !forecast.filterType ||
    !forecast.rollingTime
  ) {
    return {
      ...data.base,
      status: ImportItemStatus.NotConverted,
      notes: forecast.converted.notes,
      ...(forecast.converted.aiCandidate
        ? {
            aiCandidate: {
              ...forecast.converted.aiCandidate,
              targetKey: data.targetKey,
            },
          }
        : {}),
    };
  }

  const notes: Array<ImportNote> = [...forecast.converted.notes];
  const outcome: MonitorOutcome = readMonitorOutcome({
    monitor: data.monitor,
    notes,
    threshold: data.query.threshold,
    comparison: data.query.comparison,
    labelOf: toDatadogTagLabel,
  });

  return {
    ...data.base,
    status: ImportStatusUtil.fromNotes(notes),
    notes,
    rule: {
      kind: ImportedAlertRuleKind.PromQL,
      promQL: forecast.converted.promQL,
      filterType: forecast.filterType,
      threshold: data.query.threshold,
      rollingTime: forecast.rollingTime,
      // A forecast reads every value of its window into one trend.
      aggregation: EvaluateOverTimeType.AllValues,
      forecastHorizonInHours: forecast.horizonInHours,
      onNoData: outcome.notifiesNoData
        ? NoDataPolicy.Trigger
        : NoDataPolicy.Ignore,
      severity: outcome.severity,
      title: outcome.title,
      description: outcome.description,
      monitorDescription: outcome.monitorDescription,
    },
  };
};

const convertMonitor: (data: {
  monitor: ImportObject;
  key: string;
  overrides: ImportQueryOverrides;
  knownMetricKinds?: ReadonlyMap<string, DatadogMetricKind> | undefined;
  rateIntervalsInSeconds?: ReadonlyMap<string, number> | undefined;
}) => AlertImportItem = (data: {
  monitor: ImportObject;
  key: string;
  overrides: ImportQueryOverrides;
  knownMetricKinds?: ReadonlyMap<string, DatadogMetricKind> | undefined;
  rateIntervalsInSeconds?: ReadonlyMap<string, number> | undefined;
}): AlertImportItem => {
  const monitor: ImportObject = data.monitor;
  const type: string = textField(monitor, "type");
  const name: string = textField(monitor, "name");
  const tags: Array<string> = arrayField(monitor, "tags")
    .filter((tag: unknown): boolean => {
      return typeof tag === "string";
    })
    .map((tag: unknown): string => {
      return tag as string;
    });
  const base: MonitorBase = {
    key: data.key,
    name,
    group: tags.join(", "),
    sourceType: type,
    isEnabledInSource: true,
  };

  if (type === LOG_MONITOR_TYPE) {
    return convertLogMonitor({ monitor, base });
  }

  if (!METRIC_MONITOR_TYPES.has(type)) {
    return notConvertedMonitor(base, {
      kind: ImportNoteKind.Reason,
      text: MONITOR_TYPE_NOT_SUPPORTED,
      values: { type: type || "unknown" },
    });
  }

  let query: DatadogMonitorQuery;

  try {
    query = parseDatadogMonitorQuery(textField(monitor, "query"));
  } catch (error) {
    return queryNotRead(base, error);
  }

  const targetKey: string = getDatadogMonitorTargetKey(data.key);

  // A monitor of an anomaly or a forecast is OneUptime's own condition.
  let wholeQuery: DatadogExpression | undefined = undefined;

  try {
    wholeQuery = parseDatadogExpression(query.expression);
  } catch {
    // Read below, where the conversion says why it does not read.
  }

  const monitorFunction: ReturnType<typeof readDatadogMonitorFunction> =
    wholeQuery ? readDatadogMonitorFunction(wholeQuery) : undefined;

  if (monitorFunction?.fn === DatadogMonitorFunction.Anomalies) {
    return convertAnomalyMonitor({
      monitor,
      base,
      query,
      call: monitorFunction.call,
    });
  }

  if (monitorFunction?.fn === DatadogMonitorFunction.Forecast) {
    return convertForecastMonitor({
      monitor,
      base,
      query,
      call: monitorFunction.call,
      targetKey,
      overrides: data.overrides,
      knownMetricKinds: data.knownMetricKinds,
      rateIntervalsInSeconds: data.rateIntervalsInSeconds,
    });
  }

  const aggregation: EvaluateOverTimeType | undefined = AGGREGATIONS.get(
    query.timeAggregation,
  );

  if (!aggregation) {
    return notConvertedMonitor(base, {
      kind: ImportNoteKind.Reason,
      text: MONITOR_TIME_AGGREGATION_NOT_READ,
      values: { function: query.timeAggregation },
    });
  }

  const filterType: FilterType | undefined = COMPARISONS.get(query.comparison);

  if (!filterType) {
    return queryNotRead(base, query.comparison);
  }

  const converted: ConvertedQuery = convertDatadogQuery({
    query: query.expression,
    options: {
      context: DatadogQueryContext.Monitor,
      monitorTimeAggregation: query.timeAggregation,
      variablePrefixes: new Map<string, string>(),
      knownMetricKinds: data.knownMetricKinds,
      rateIntervalsInSeconds: data.rateIntervalsInSeconds,
    },
    aiQuery: data.overrides.get(targetKey),
  });

  if (converted.status === ImportItemStatus.NotConverted) {
    return {
      ...base,
      status: ImportItemStatus.NotConverted,
      notes: converted.notes,
      ...(converted.aiCandidate
        ? { aiCandidate: { ...converted.aiCandidate, targetKey } }
        : {}),
    };
  }

  const notes: Array<ImportNote> = [...converted.notes];

  const rollingTime: RollingTime = readImportWindow({
    ms: readWindowMs(query.window),
    sourceText: query.window,
    notes,
  });

  const outcome: MonitorOutcome = readMonitorOutcome({
    monitor,
    notes,
    threshold: query.threshold,
    comparison: query.comparison,
    labelOf: toDatadogTagLabel,
  });

  return {
    ...base,
    status: ImportStatusUtil.fromNotes(notes),
    notes,
    rule: {
      promQL: converted.promQL,
      filterType,
      threshold: query.threshold,
      rollingTime,
      aggregation,
      onNoData: outcome.notifiesNoData
        ? NoDataPolicy.Trigger
        : NoDataPolicy.Ignore,
      severity: outcome.severity,
      title: outcome.title,
      description: outcome.description,
      monitorDescription: outcome.monitorDescription,
    },
  };
};

// Every metric the monitors read, by its Datadog name.
export const listDatadogMonitorMetricNames: (
  monitors: Array<ImportObject>,
) => Array<string> = (monitors: Array<ImportObject>): Array<string> => {
  const names: Set<string> = new Set<string>();

  for (const monitor of monitors) {
    try {
      const query: DatadogMonitorQuery = parseDatadogMonitorQuery(
        textField(monitor, "query"),
      );

      for (const name of readDatadogMetricNames(query.expression)) {
        names.add(name);
      }
    } catch {
      // Not a metric monitor's query: nothing to look up.
    }
  }

  return Array.from(names).sort();
};

// The metrics the monitors read with .as_count(), by their Datadog names.
export const listDatadogMonitorAsCountMetricNames: (
  monitors: Array<ImportObject>,
) => Array<string> = (monitors: Array<ImportObject>): Array<string> => {
  const names: Set<string> = new Set<string>();

  for (const monitor of monitors) {
    try {
      const query: DatadogMonitorQuery = parseDatadogMonitorQuery(
        textField(monitor, "query"),
      );

      for (const name of readDatadogAsCountMetricNames(query.expression)) {
        names.add(name);
      }
    } catch {
      // Not a metric monitor's query: nothing to look up.
    }
  }

  return Array.from(names).sort();
};

export const convertDatadogMonitors: (
  monitors: Array<ImportObject>,
  options?: {
    queryOverrides?: ImportQueryOverrides | undefined;
    knownMetricKinds?: ReadonlyMap<string, DatadogMetricKind> | undefined;
    rateIntervalsInSeconds?: ReadonlyMap<string, number> | undefined;
  },
) => AlertImportPlan = (
  monitors: Array<ImportObject>,
  options?: {
    queryOverrides?: ImportQueryOverrides | undefined;
    knownMetricKinds?: ReadonlyMap<string, DatadogMetricKind> | undefined;
    rateIntervalsInSeconds?: ReadonlyMap<string, number> | undefined;
  },
): AlertImportPlan => {
  const overrides: ImportQueryOverrides =
    options?.queryOverrides || NO_QUERY_OVERRIDES;

  return {
    source: ImportSourceKind.DatadogMonitors,
    items: monitors
      .slice(0, IMPORT_MAX_ITEMS)
      .map((monitor: ImportObject, index: number): AlertImportItem => {
        return convertMonitor({
          monitor: asObject(monitor) || {},
          key: `monitor-${index}`,
          overrides,
          knownMetricKinds: options?.knownMetricKinds,
          rateIntervalsInSeconds: options?.rateIntervalsInSeconds,
        });
      }),
    notes: [],
  };
};
