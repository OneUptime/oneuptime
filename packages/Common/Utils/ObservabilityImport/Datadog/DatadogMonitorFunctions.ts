import {
  AnomalyDetectionSensitivity,
  EvaluateOverTimeType,
  FilterType,
  FORECAST_HORIZON_IN_HOURS_OPTIONS,
} from "../../../Types/Monitor/CriteriaFilter";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import {
  ConvertedQuery,
  ImportItemStatus,
  ImportNote,
  ImportNoteKind,
  ImportedMetricQuery,
} from "../../../Types/ObservabilityImport/ObservabilityImport";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import { translationKey } from "../../../Types/Translator";
import { WINDOW_NEAREST_READ, readImportWindow } from "../AlertImportCommon";
import { toDatadogMetricAttributeKey } from "./DatadogAttributes";
import {
  DATADOG_FUNCTION_NOT_CONVERTED,
  DATADOG_PERCENTILE_NOT_CONVERTED,
  DatadogMetricKind,
  DatadogQueryContext,
  convertDatadogQuery,
} from "./DatadogPromQL";
import {
  DatadogExpression,
  DatadogExpressionKind,
  DatadogScope,
  DatadogScopeKind,
} from "./DatadogQueryParser";

/*
 * DATADOG'S ANOMALY AND FORECAST MONITORS, AS ONEUPTIME'S OWN CONDITIONS
 * (issue #10325).
 *
 * Datadog writes them as a metric monitor whose query is wrapped in a
 * function (docs.datadoghq.com/monitors/types/anomaly and .../forecasts):
 *
 *   avg(last_1h):anomalies(avg:nginx.net.request_per_s{*} by {host},
 *     'basic', 2, direction='above', alert_window='last_15m', interval=60,
 *     count_default_zero='true') >= 1
 *
 *   max(next_1w):forecast(avg:system.disk.in_use{*} by {host,device},
 *     'linear', 1, interval='60m', history='1w', model='default') >= 0.9
 *
 * An anomaly becomes a Metrics monitor whose condition is Anomalously High
 * (direction above), Anomalously Low (below) or Anomalous (both, Datadog's
 * default), over the metric inside the function. OneUptime's anomaly
 * conditions compare a metric with its own earlier weeks, which only a
 * metric read by the query builder has (a PromQL expression keeps no
 * history), so the query must be one metric narrowed to exact tag values:
 * anything else is not converted, and says why. Each value of the alert
 * window is compared with the same hour of the week over the 14 days
 * before it, and the first one outside that range fires: Datadog's
 * algorithm (basic, agile, robust), seasonality and bounds are its own,
 * its bounds read as the nearest sensitivity (2 deviations or fewer High,
 * 3 Medium, more Low: OneUptime's 2, 3 and 4 standard deviations), and
 * Datadog's threshold - the share of the alert window's values that must
 * be anomalous - is not read: the notes say all three. The query window
 * (avg(last_1h)) only draws Datadog's notification graphs.
 *
 * A forecast becomes a Metrics monitor with one PromQL step - OneUptime
 * forecasts a PromQL expression too - whose condition is Forecast Above
 * (>, >=) or Forecast Below (<, <=) the threshold within the horizon
 * (next_1w, the nearest OneUptime offers), over a window of the history
 * the forecast reads (history='1w'; a week when it names none). OneUptime
 * draws a straight line through the window's values and alerts once the
 * line is past the threshold at the horizon's end; Datadog's algorithm and
 * model, and its alerting on the edge of the forecast's confidence bounds
 * rather than the line, are said.
 *
 * Outliers compare a group's series with each other, which no OneUptime
 * condition does: they stay not converted (DatadogPromQL).
 */

export const ANOMALY_ALGORITHM: string = translationKey(
  "Datadog's {{algorithm}} algorithm and its bounds of {{deviations}} deviations are its own: OneUptime compares each value with the same hour of the week over the 14 days before it, at the nearest sensitivity.",
);

export const ANOMALY_FIRST_VALUE: string = translationKey(
  "Datadog alerted once {{share}} of the values in {{window}} were anomalous; OneUptime alerts on the first anomalous value in its window.",
);

export const ANOMALY_LEARNS_FIRST: string = translationKey(
  "OneUptime learns the metric's usual range from its own history: the monitor alerts once each hour of the week has two weeks of data.",
);

export const ANOMALY_NOT_ONE_METRIC: string = translationKey(
  "OneUptime's anomaly conditions read one metric, and this anomaly reads a formula.",
);

export const ANOMALY_SCOPE_NOT_EXACT: string = translationKey(
  "OneUptime's anomaly conditions read a metric narrowed to exact tag values, and this anomaly reads {{scope}}.",
);

export const ANOMALY_METHOD_NOT_READ: string = translationKey(
  "OneUptime's anomaly conditions read a metric's values as they are, and this anomaly reads them with .{{method}}().",
);

export const FORECAST_ALGORITHM: string = translationKey(
  "Datadog's {{algorithm}} forecast is its own: OneUptime draws a straight line through the values of the monitor's window and follows it ahead.",
);

export const FORECAST_BOUNDS: string = translationKey(
  "Datadog alerted once the edge of its forecast's bounds reached the threshold; OneUptime alerts once the line itself does.",
);

export const FORECAST_HORIZON_NEAREST: string = translationKey(
  "Datadog looked {{source}} ahead; OneUptime looks as far ahead as the nearest horizon it offers.",
);

// The functions a monitor's whole query can be, and become a condition.
export enum DatadogMonitorFunction {
  Anomalies = "anomalies",
  Forecast = "forecast",
}

// Datadog's space aggregators, as the query builder's aggregations.
const BUILDER_AGGREGATIONS: ReadonlyMap<string, MetricsAggregationType> =
  new Map<string, MetricsAggregationType>([
    ["avg", MetricsAggregationType.Avg],
    ["sum", MetricsAggregationType.Sum],
    ["min", MetricsAggregationType.Min],
    ["max", MetricsAggregationType.Max],
  ]);

// The methods an anomaly's metric may carry: what reads a count as one.
const ANOMALY_METHODS: ReadonlySet<string> = new Set<string>([
  "as_count",
  "as_rate",
]);

// A number of seconds, as a duration may be written.
const WHOLE_NUMBER: RegExp = /^[0-9]+$/;

// A named argument's name: direction='above'.
const ARGUMENT_NAME: RegExp = /^[A-Za-z_]+$/;

// A distribution's percentile, as an aggregator: p50, p99.
const PERCENTILE_AGGREGATOR: RegExp = /^p[0-9]+$/;

const DURATION_UNIT_SECONDS: ReadonlyMap<string, number> = new Map<
  string,
  number
>([
  ["s", 1],
  ["m", 60],
  ["h", 3600],
  ["d", 86400],
  ["w", 7 * 86400],
  ["mo", 30 * 86400],
]);

/*
 * A Datadog duration in milliseconds - "last_15m", "next_1w", "1w", "60m",
 * a number of seconds - or NaN for anything else.
 */
export const readDatadogDurationMs: (text: string) => number = (
  text: string,
): number => {
  const value: string = (text || "").trim().replace(/^(last|next)_/, "");

  if (WHOLE_NUMBER.test(value)) {
    return Number(value) * 1000;
  }

  const match: RegExpMatchArray | null = value.match(/^([0-9]+)(mo|[smhdw])$/);

  if (!match) {
    return Number.NaN;
  }

  return (
    Number(match[1]) * (DURATION_UNIT_SECONDS.get(match[2] || "") || 0) * 1000
  );
};

/*
 * The text of a call's first argument, as written: `avg:a{*} by {host}` of
 * `forecast(avg:a{*} by {host}, 'linear', 1)`. Brackets and quotes inside
 * it are stepped over; undefined when the text is not a call.
 */
export const readFirstArgumentText: (callText: string) => string | undefined = (
  callText: string,
): string | undefined => {
  const text: string = callText || "";
  const open: number = text.indexOf("(");

  if (open <= 0) {
    return undefined;
  }

  let depth: number = 0;
  let quote: string = "";

  for (let index: number = open + 1; index < text.length; index++) {
    const char: string = text.charAt(index);

    if (quote) {
      if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "(" || char === "{" || char === "[") {
      depth++;
      continue;
    }

    if (char === ")" || char === "}" || char === "]") {
      if (depth === 0) {
        return char === ")"
          ? text.slice(open + 1, index).trim() || undefined
          : undefined;
      }

      depth--;
      continue;
    }

    if (char === "," && depth === 0) {
      return text.slice(open + 1, index).trim() || undefined;
    }
  }

  return undefined;
};

// A function's arguments: its positional ones, and its named ones by name.
export interface DatadogFunctionArguments {
  query: DatadogExpression | undefined;
  positional: Array<DatadogExpression>;
  named: Map<string, string>;
}

/*
 * The arguments of anomalies(...) or forecast(...): the query first, then
 * 'basic', 2 and the like, then name='value' pairs (the parser keeps a
 * named argument as the text name=value).
 */
export const readDatadogFunctionArguments: (
  call: Extract<DatadogExpression, { kind: DatadogExpressionKind.Call }>,
) => DatadogFunctionArguments = (
  call: Extract<DatadogExpression, { kind: DatadogExpressionKind.Call }>,
): DatadogFunctionArguments => {
  const positional: Array<DatadogExpression> = [];
  const named: Map<string, string> = new Map<string, string>();

  call.args.slice(1).forEach((arg: DatadogExpression): void => {
    if (arg.kind === DatadogExpressionKind.Text) {
      const equals: number = arg.value.indexOf("=");
      const name: string = equals > 0 ? arg.value.slice(0, equals) : "";

      if (ARGUMENT_NAME.test(name)) {
        named.set(name, arg.value.slice(equals + 1));
        return;
      }
    }

    positional.push(arg);
  });

  return { query: call.args[0], positional, named };
};

const positionalText: (
  args: DatadogFunctionArguments,
  index: number,
) => string = (args: DatadogFunctionArguments, index: number): string => {
  const arg: DatadogExpression | undefined = args.positional[index];

  if (arg?.kind === DatadogExpressionKind.Text) {
    return arg.value;
  }

  if (arg?.kind === DatadogExpressionKind.Reference) {
    return arg.name;
  }

  return "";
};

const positionalNumber: (
  args: DatadogFunctionArguments,
  index: number,
) => number | undefined = (
  args: DatadogFunctionArguments,
  index: number,
): number | undefined => {
  const arg: DatadogExpression | undefined = args.positional[index];

  return arg?.kind === DatadogExpressionKind.Number ? arg.value : undefined;
};

// The function a monitor's whole query is, when it is one of these.
export const readDatadogMonitorFunction: (expression: DatadogExpression) =>
  | {
      fn: DatadogMonitorFunction;
      call: Extract<DatadogExpression, { kind: DatadogExpressionKind.Call }>;
    }
  | undefined = (
  expression: DatadogExpression,
):
  | {
      fn: DatadogMonitorFunction;
      call: Extract<DatadogExpression, { kind: DatadogExpressionKind.Call }>;
    }
  | undefined => {
  if (expression.kind !== DatadogExpressionKind.Call) {
    return undefined;
  }

  if (expression.name === DatadogMonitorFunction.Anomalies) {
    return { fn: DatadogMonitorFunction.Anomalies, call: expression };
  }

  if (expression.name === DatadogMonitorFunction.Forecast) {
    return { fn: DatadogMonitorFunction.Forecast, call: expression };
  }

  return undefined;
};

const describeScope: (scope: DatadogScope) => string = (
  scope: DatadogScope,
): string => {
  switch (scope.kind) {
    case DatadogScopeKind.All:
      return "*";
    case DatadogScopeKind.Tag:
      return scope.key ? `${scope.key}:${scope.value}` : scope.value;
    case DatadogScopeKind.Variable:
      return scope.key ? `${scope.key}:$${scope.name}` : `$${scope.name}`;
    case DatadogScopeKind.In:
      return `${scope.key} IN (${scope.values.join(", ")})`;
    case DatadogScopeKind.Not:
      return `NOT ${describeScope(scope.term)}`;
    case DatadogScopeKind.And:
      return scope.terms.map(describeScope).join(" AND ");
    case DatadogScopeKind.Or:
      return `(${scope.terms.map(describeScope).join(" OR ")})`;
    default:
      return "";
  }
};

/*
 * A scope as exact attribute values: tags of a key and a value with no
 * wildcard, joined by AND. Undefined for anything else.
 */
const exactAttributes: (
  scope: DatadogScope,
) => Record<string, string> | undefined = (
  scope: DatadogScope,
): Record<string, string> | undefined => {
  if (scope.kind === DatadogScopeKind.All) {
    return {};
  }

  if (scope.kind === DatadogScopeKind.Tag) {
    if (!scope.key || scope.value.includes("*") || !scope.value) {
      return undefined;
    }

    return { [toDatadogMetricAttributeKey(scope.key)]: scope.value };
  }

  if (scope.kind === DatadogScopeKind.And) {
    const attributes: Record<string, string> = {};

    for (const term of scope.terms) {
      const read: Record<string, string> | undefined = exactAttributes(term);

      if (!read) {
        return undefined;
      }

      for (const [key, value] of Object.entries(read)) {
        // Two values of one tag match nothing in Datadog: not one filter.
        if (attributes[key] !== undefined && attributes[key] !== value) {
          return undefined;
        }

        attributes[key] = value;
      }
    }

    return attributes;
  }

  return undefined;
};

export interface ConvertedAnomaly {
  status: ImportItemStatus;
  notes: Array<ImportNote>;
  metricQuery?: ImportedMetricQuery | undefined;
  filterType?: FilterType | undefined;
  sensitivity?: AnomalyDetectionSensitivity | undefined;
  rollingTime?: RollingTime | undefined;
  aggregation?: EvaluateOverTimeType | undefined;
}

// Datadog's bounds, as the nearest of OneUptime's 2, 3 and 4 deviations.
export const readAnomalySensitivity: (
  deviations: number | undefined,
) => AnomalyDetectionSensitivity = (
  deviations: number | undefined,
): AnomalyDetectionSensitivity => {
  if (deviations === undefined || !Number.isFinite(deviations)) {
    return AnomalyDetectionSensitivity.Medium;
  }

  if (deviations <= 2.5) {
    return AnomalyDetectionSensitivity.High;
  }

  if (deviations <= 3.5) {
    return AnomalyDetectionSensitivity.Medium;
  }

  return AnomalyDetectionSensitivity.Low;
};

const notConvertedAnomaly: (note: ImportNote) => ConvertedAnomaly = (
  note: ImportNote,
): ConvertedAnomaly => {
  return { status: ImportItemStatus.NotConverted, notes: [note] };
};

/*
 * anomalies(<query>, '<algorithm>', <deviations>, direction=..., alert_window
 * =..., ...) as one metric read by the query builder, OneUptime's anomaly
 * condition and its window. `threshold` is the monitor's: the share of the
 * alert window's values that must be anomalous.
 */
export const convertDatadogAnomaly: (data: {
  call: Extract<DatadogExpression, { kind: DatadogExpressionKind.Call }>;
  threshold: number;
}) => ConvertedAnomaly = (data: {
  call: Extract<DatadogExpression, { kind: DatadogExpressionKind.Call }>;
  threshold: number;
}): ConvertedAnomaly => {
  const args: DatadogFunctionArguments = readDatadogFunctionArguments(
    data.call,
  );
  const query: DatadogExpression | undefined = args.query;

  if (!query || query.kind !== DatadogExpressionKind.Query) {
    return notConvertedAnomaly({
      kind: ImportNoteKind.Reason,
      text: ANOMALY_NOT_ONE_METRIC,
    });
  }

  const aggregator: string = query.aggregator || "avg";
  const aggregation: MetricsAggregationType | undefined =
    BUILDER_AGGREGATIONS.get(aggregator);

  if (!aggregation) {
    return notConvertedAnomaly(
      PERCENTILE_AGGREGATOR.test(aggregator)
        ? {
            kind: ImportNoteKind.Reason,
            text: DATADOG_PERCENTILE_NOT_CONVERTED,
            values: { aggregator },
          }
        : {
            kind: ImportNoteKind.Reason,
            text: DATADOG_FUNCTION_NOT_CONVERTED,
            values: { function: aggregator },
          },
    );
  }

  const unread: string | undefined = query.methods
    .map((method: { name: string }): string => {
      return method.name;
    })
    .find((name: string): boolean => {
      return !ANOMALY_METHODS.has(name);
    });

  if (unread) {
    return notConvertedAnomaly({
      kind: ImportNoteKind.Reason,
      text: ANOMALY_METHOD_NOT_READ,
      values: { method: unread },
    });
  }

  const attributes: Record<string, string> | undefined = exactAttributes(
    query.scope,
  );

  if (!attributes) {
    return notConvertedAnomaly({
      kind: ImportNoteKind.Reason,
      text: ANOMALY_SCOPE_NOT_EXACT,
      values: { scope: `{${describeScope(query.scope)}}` },
    });
  }

  const direction: string = args.named.get("direction") || "both";
  const filterType: FilterType =
    direction === "above"
      ? FilterType.AnomalouslyHigh
      : direction === "below"
        ? FilterType.AnomalouslyLow
        : FilterType.Anomalous;

  const algorithm: string = positionalText(args, 0) || "basic";
  const deviations: number | undefined = positionalNumber(args, 1);
  const alertWindow: string = args.named.get("alert_window") || "last_15m";
  const notes: Array<ImportNote> = [];

  const rollingTime: RollingTime = readImportWindow({
    ms: readDatadogDurationMs(alertWindow),
    sourceText: alertWindow,
    notes,
    nearestText: WINDOW_NEAREST_READ,
  });

  notes.push({
    kind: ImportNoteKind.Approximation,
    text: ANOMALY_ALGORITHM,
    values: {
      algorithm,
      deviations: deviations === undefined ? "2" : String(deviations),
    },
  });

  notes.push({
    kind: ImportNoteKind.Approximation,
    text: ANOMALY_FIRST_VALUE,
    values: {
      share: `${Math.round(Math.min(1, Math.max(0, data.threshold)) * 100)}%`,
      window: alertWindow,
    },
  });

  notes.push({ kind: ImportNoteKind.Info, text: ANOMALY_LEARNS_FIRST });

  return {
    status: ImportItemStatus.Approximate,
    notes,
    metricQuery: {
      metricName: query.metric,
      attributes,
      aggregation,
      groupByAttributeKeys: query.groupBy.map(toDatadogMetricAttributeKey),
    },
    filterType,
    sensitivity: readAnomalySensitivity(deviations),
    rollingTime,
    // Every value is compared, and the first outside the range fires.
    aggregation: EvaluateOverTimeType.AnyValue,
  };
};

export interface ConvertedForecast {
  converted: ConvertedQuery;
  filterType?: FilterType | undefined;
  horizonInHours?: number | undefined;
  rollingTime?: RollingTime | undefined;
}

// The horizon OneUptime offers nearest a forecast's, the longer on a tie.
export const nearestForecastHorizonInHours: (hours: number) => number = (
  hours: number,
): number => {
  let nearest: number = FORECAST_HORIZON_IN_HOURS_OPTIONS[0]!;

  for (const option of FORECAST_HORIZON_IN_HOURS_OPTIONS) {
    if (Math.abs(option - hours) <= Math.abs(nearest - hours)) {
      nearest = option;
    }
  }

  return nearest;
};

/*
 * forecast(<query>, '<algorithm>', <deviations>, interval=..., history=...,
 * model=..., seasonality=...) under `max(next_1w)` or `min(next_1w)`: the
 * query as PromQL, OneUptime's forecast condition, its horizon and window.
 * `comparison` is the monitor's (>=, <=...).
 */
export const convertDatadogForecast: (data: {
  call: Extract<DatadogExpression, { kind: DatadogExpressionKind.Call }>;
  queryText: string;
  comparison: string;
  horizon: string;
  knownMetricKinds?: ReadonlyMap<string, DatadogMetricKind> | undefined;
  rateIntervalsInSeconds?: ReadonlyMap<string, number> | undefined;
  aiQuery?: string | undefined;
}) => ConvertedForecast = (data: {
  call: Extract<DatadogExpression, { kind: DatadogExpressionKind.Call }>;
  queryText: string;
  comparison: string;
  horizon: string;
  knownMetricKinds?: ReadonlyMap<string, DatadogMetricKind> | undefined;
  rateIntervalsInSeconds?: ReadonlyMap<string, number> | undefined;
  aiQuery?: string | undefined;
}): ConvertedForecast => {
  const args: DatadogFunctionArguments = readDatadogFunctionArguments(
    data.call,
  );

  const converted: ConvertedQuery = convertDatadogQuery({
    query: data.queryText,
    options: {
      context: DatadogQueryContext.Monitor,
      monitorTimeAggregation: "avg",
      variablePrefixes: new Map<string, string>(),
      knownMetricKinds: data.knownMetricKinds,
      rateIntervalsInSeconds: data.rateIntervalsInSeconds,
    },
    aiQuery: data.aiQuery,
  });

  if (converted.status === ImportItemStatus.NotConverted) {
    return { converted };
  }

  const isAbove: boolean = data.comparison.startsWith(">");
  const notes: Array<ImportNote> = [...converted.notes];

  const sourceHours: number = readDatadogDurationMs(data.horizon) / 3600000;
  const horizonInHours: number = Number.isFinite(sourceHours)
    ? nearestForecastHorizonInHours(sourceHours)
    : nearestForecastHorizonInHours(7 * 24);

  if (!Number.isFinite(sourceHours) || horizonInHours !== sourceHours) {
    notes.push({
      kind: ImportNoteKind.Approximation,
      text: FORECAST_HORIZON_NEAREST,
      values: { source: data.horizon },
    });
  }

  /*
   * The history a linear forecast reads; a week when it names none or one
   * that is not a duration (a seasonal forecast names a season instead).
   */
  const named: string = args.named.get("history") || "";
  const history: string = Number.isFinite(readDatadogDurationMs(named))
    ? named
    : "1w";
  const rollingTime: RollingTime = readImportWindow({
    ms: readDatadogDurationMs(history),
    sourceText: history,
    notes,
    nearestText: WINDOW_NEAREST_READ,
  });

  notes.push({
    kind: ImportNoteKind.Approximation,
    text: FORECAST_ALGORITHM,
    values: { algorithm: positionalText(args, 0) || "linear" },
  });

  notes.push({ kind: ImportNoteKind.Approximation, text: FORECAST_BOUNDS });

  return {
    converted: {
      ...converted,
      status: ImportItemStatus.Approximate,
      notes,
    },
    filterType: isAbove ? FilterType.ForecastAbove : FilterType.ForecastBelow,
    horizonInHours,
    rollingTime,
  };
};
