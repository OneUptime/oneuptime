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
  ImportedAlertSeverity,
  NO_QUERY_OVERRIDES,
} from "../../../Types/ObservabilityImport/ObservabilityImport";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import { translationKey } from "../../../Types/Translator";
import { toPromQLLabelName } from "../../PromQL/PromQLMetricNames";
import { readImportWindow } from "../AlertImportCommon";
import {
  ImportObject,
  asObject,
  arrayField,
  booleanField,
  numberField,
  objectField,
  textField,
} from "../ImportValues";
import { DatadogQueryContext, convertDatadogQuery } from "./DatadogPromQL";
import {
  DatadogMonitorQuery,
  DatadogQueryError,
  parseDatadogMonitorQuery,
} from "./DatadogQueryParser";

/*
 * DATADOG'S METRIC MONITORS, AS METRICS MONITORS (issue #7697).
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
 * Monitors of logs, traces, events, services, processes and the other
 * kinds read data that is not metrics, and anomaly, outlier, forecast and
 * change monitors have no PromQL: they are listed with why.
 */

export const MONITOR_TYPE_NOT_SUPPORTED: string = translationKey(
  "It is a Datadog {{type}} monitor: OneUptime imports Datadog's metric monitors.",
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

export const MONITOR_NOT_EQUAL: string = translationKey(
  "Datadog compares with {{comparison}}; OneUptime's condition is not equal to.",
);

// Datadog's monitor types that read metrics.
const METRIC_MONITOR_TYPES: ReadonlySet<string> = new Set<string>([
  "metric alert",
  "query alert",
]);

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
  const match: RegExpMatchArray | null = window.match(/^last_([0-9]+)([mhdw])$/);

  if (!match) {
    return Number.NaN;
  }

  return Number(match[1]) * (WINDOW_UNIT_SECONDS.get(match[2] || "") || 0) * 1000;
};

/*
 * A Datadog monitor's text: a group's tag ({{host.name}}) is OneUptime's
 * {{host}}, which a PromQL monitor's alert fills from its series;
 * conditional blocks keep their text ({{#is_alert}}...{{/is_alert}}), and
 * the value, the threshold and notification handles are left out.
 */
export const convertDatadogMessage: (data: {
  text: string;
  notes: Array<ImportNote>;
}) => string = (data: { text: string; notes: Array<ImportNote> }): string => {
  const handles: Array<string> = (data.text.match(/(^|\s)@[\w.+-]+/g) || []).map(
    (handle: string): string => {
      return handle.trim();
    },
  );

  if (handles.length > 0) {
    data.notes.push({
      kind: ImportNoteKind.Info,
      text: MONITOR_NOTIFICATIONS_LEFT_OUT,
      values: { handles: Array.from(new Set(handles)).join(", ") },
    });
  }

  return data.text
    .replace(/\{\{([^{}]*)\}\}/g, (_match: string, inner: string): string => {
      // A group's tag is the series' label: {{host.name}} is {{host}}.
      const tag: RegExpMatchArray | null = inner
        .trim()
        .match(/^([A-Za-z0-9_.-]+)\.name$/);

      if (tag) {
        return `{{${toPromQLLabelName(tag[1] || "")}}}`;
      }

      // A block's tags, the value, the threshold: their text stays, they go.
      return "";
    })
    .replace(/(^|\s)@[\w.+-]+/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

export const getDatadogMonitorTargetKey: (itemKey: string) => string = (
  itemKey: string,
): string => {
  return `${itemKey}:query`;
};

const convertMonitor: (data: {
  monitor: ImportObject;
  key: string;
  overrides: ImportQueryOverrides;
}) => AlertImportItem = (data: {
  monitor: ImportObject;
  key: string;
  overrides: ImportQueryOverrides;
}): AlertImportItem => {
  const monitor: ImportObject = data.monitor;
  const type: string = textField(monitor, "type");
  const name: string = textField(monitor, "name");
  const options: ImportObject | undefined = objectField(monitor, "options");
  const tags: Array<string> = arrayField(monitor, "tags")
    .filter((tag: unknown): boolean => {
      return typeof tag === "string";
    })
    .map((tag: unknown): string => {
      return tag as string;
    });
  const base: Pick<
    AlertImportItem,
    "key" | "name" | "group" | "sourceType" | "isEnabledInSource"
  > = {
    key: data.key,
    name,
    group: tags.join(", "),
    sourceType: type,
    isEnabledInSource: true,
  };

  if (!METRIC_MONITOR_TYPES.has(type)) {
    return {
      ...base,
      status: ImportItemStatus.NotConverted,
      notes: [
        {
          kind: ImportNoteKind.Reason,
          text: MONITOR_TYPE_NOT_SUPPORTED,
          values: { type: type || "unknown" },
        },
      ],
    };
  }

  let query: DatadogMonitorQuery;

  try {
    query = parseDatadogMonitorQuery(textField(monitor, "query"));
  } catch (error) {
    return {
      ...base,
      status: ImportItemStatus.NotConverted,
      notes: [
        {
          kind: ImportNoteKind.Reason,
          text: MONITOR_QUERY_NOT_READ,
          values: {
            error:
              error instanceof DatadogQueryError || error instanceof Error
                ? error.message
                : String(error),
          },
        },
      ],
    };
  }

  const aggregation: EvaluateOverTimeType | undefined = AGGREGATIONS.get(
    query.timeAggregation,
  );

  if (!aggregation) {
    return {
      ...base,
      status: ImportItemStatus.NotConverted,
      notes: [
        {
          kind: ImportNoteKind.Reason,
          text: MONITOR_TIME_AGGREGATION_NOT_READ,
          values: { function: query.timeAggregation },
        },
      ],
    };
  }

  const filterType: FilterType | undefined = COMPARISONS.get(query.comparison);

  if (!filterType) {
    return {
      ...base,
      status: ImportItemStatus.NotConverted,
      notes: [
        {
          kind: ImportNoteKind.Reason,
          text: MONITOR_QUERY_NOT_READ,
          values: { error: query.comparison },
        },
      ],
    };
  }

  const targetKey: string = getDatadogMonitorTargetKey(data.key);
  const converted: ConvertedQuery = convertDatadogQuery({
    query: query.expression,
    options: {
      context: DatadogQueryContext.Monitor,
      monitorTimeAggregation: query.timeAggregation,
      variablePrefixes: new Map<string, string>(),
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

  if (filterType === FilterType.NotEqualTo) {
    notes.push({
      kind: ImportNoteKind.Approximation,
      text: MONITOR_NOT_EQUAL,
      values: { comparison: query.comparison },
    });
  }

  const rollingTime: RollingTime = readImportWindow({
    ms: readWindowMs(query.window),
    sourceText: query.window,
    notes,
  });

  const thresholds: ImportObject | undefined = objectField(
    options,
    "thresholds",
  );
  const warning: number | undefined = numberField(thresholds, "warning");

  if (warning !== undefined) {
    notes.push({
      kind: ImportNoteKind.Approximation,
      text: MONITOR_WARNING_LEFT_OUT,
      values: { warning: String(warning) },
    });
  }

  if (
    numberField(thresholds, "critical_recovery") !== undefined ||
    numberField(thresholds, "warning_recovery") !== undefined
  ) {
    notes.push({
      kind: ImportNoteKind.Approximation,
      text: MONITOR_RECOVERY_LEFT_OUT,
    });
  }

  const notifiesNoData: boolean = booleanField(options, "notify_no_data") === true;

  if (notifiesNoData) {
    notes.push({ kind: ImportNoteKind.Info, text: MONITOR_NO_DATA_ALERTS });
  }

  const delay: number | undefined = numberField(options, "evaluation_delay");

  if (delay !== undefined && delay > 0) {
    notes.push({
      kind: ImportNoteKind.Info,
      text: MONITOR_EVALUATION_DELAY,
      values: { seconds: String(delay) },
    });
  }

  const message: string = convertDatadogMessage({
    text: textField(monitor, "message"),
    notes,
  });
  const title: string =
    convertDatadogMessage({ text: name, notes: [] }) || name;
  const priority: number | undefined = numberField(monitor, "priority");

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
      onNoData: notifiesNoData ? NoDataPolicy.Trigger : NoDataPolicy.Ignore,
      severity:
        priority !== undefined && priority >= 3
          ? ImportedAlertSeverity.Warning
          : ImportedAlertSeverity.Critical,
      title,
      description: message,
      monitorDescription: textField(monitor, "description") || message,
    },
  };
};

export const convertDatadogMonitors: (
  monitors: Array<ImportObject>,
  options?: { queryOverrides?: ImportQueryOverrides | undefined },
) => AlertImportPlan = (
  monitors: Array<ImportObject>,
  options?: { queryOverrides?: ImportQueryOverrides | undefined },
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
        });
      }),
    notes: [],
  };
};
