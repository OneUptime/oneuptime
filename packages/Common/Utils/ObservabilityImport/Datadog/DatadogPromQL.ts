import {
  ConvertedQuery,
  ImportItemStatus,
  ImportNote,
  ImportNoteKind,
  ImportQueryLanguage,
  ImportStatusUtil,
} from "../../../Types/ObservabilityImport/ObservabilityImport";
import { translationKey } from "../../../Types/Translator";
import {
  toPromQLLabelName,
  toPromQLMetricName,
} from "../../PromQL/PromQLMetricNames";
import { findPromQLImportProblem } from "../PromQLImportQuery";
import {
  DatadogExpression,
  DatadogExpressionKind,
  DatadogMethod,
  DatadogQueryError,
  DatadogScope,
  DatadogScopeKind,
  parseDatadogExpression,
} from "./DatadogQueryParser";

/*
 * A DATADOG QUERY, AS PROMQL OVER WHAT THE DATADOG AGENT SENT (issue
 * #7697).
 *
 * OneUptime's Datadog intake keeps a metric's name and each tag as an
 * attribute (DatadogIntake): `system.cpu.user{host:web-1}` arrives as the
 * metric system.cpu.user with the attribute host = web-1, which PromQL
 * names system_cpu_user{host="web-1"} (PromQLMetricNames). A tag with no
 * key is kept in datadog.tags, comma-joined. So:
 *
 *   avg:system.cpu.user{env:prod,!host:db-*} by {host}
 *     avg by (host) (avg_over_time(system_cpu_user{env="prod",
 *       host!~"db-.*"}[$__interval]))
 *
 * Datadog first reduces each series' points in an interval (its time
 * aggregation: an average for a gauge, a sum with .as_count(), or what
 * .rollup() names), then combines the series (the space aggregation). The
 * PromQL does the same, in that order. Datadog's export does not say
 * whether a metric is a gauge or a count, so a query that does not say
 * (.as_count(), .rollup()) is read as a gauge, and its notes say so.
 *
 * In a monitor, each check reads one minute of points ([1m]) with the
 * function the monitor reduces its window with, so a 5-minute window of
 * one-minute averages is the window's average, as Datadog takes it.
 *
 * A dashboard's template variable with a prefix (`$host` for host:...) is
 * the dashboard's variable on that attribute: host="{{host}}", which the
 * widget reads as Grafana's Prometheus does (DataSourceQueryText): All
 * matches every host. What has no PromQL - anomalies, forecasts,
 * outliers, smoothing, a cumulative sum - is not converted, and may be
 * offered to OneUptime AI.
 */

export const DATADOG_QUERY_UNREADABLE: string = translationKey(
  "OneUptime cannot read this Datadog query: {{error}}",
);

export const DATADOG_FUNCTION_NOT_CONVERTED: string = translationKey(
  "Datadog's {{function}}() has no PromQL that OneUptime runs.",
);

export const DATADOG_PERCENTILE_NOT_CONVERTED: string = translationKey(
  "OneUptime keeps a Datadog distribution's count, sum, minimum and maximum, not its {{aggregator}} percentile.",
);

export const DATADOG_SCOPE_NOT_CONVERTED: string = translationKey(
  "The query's tags {{scope}} combine OR across different tags, which a PromQL selector cannot.",
);

export const DATADOG_GROUPS_DO_NOT_MATCH: string = translationKey(
  "The formula combines series grouped by different tags, which OneUptime does not match up.",
);

export const DATADOG_UNKNOWN_QUERY_NAME: string = translationKey(
  "The formula names {{name}}, which is not one of the widget's queries.",
);

export const DATADOG_READ_AS_GAUGE: string = translationKey(
  "Datadog's export does not say whether {{metrics}} are gauges or counts, and the project has no data for them yet: they are read as gauges, averaging their points in each interval.",
);

export const DATADOG_FILL_LEFT_OUT: string = translationKey(
  "Datadog's .fill() is left out: OneUptime charts a gap where there is no data.",
);

export const DATADOG_TOP_PER_STEP: string = translationKey(
  "Datadog ranks the series over the whole time range; OneUptime ranks them at each point.",
);

export const DATADOG_RATE_FUNCTION: string = translationKey(
  "Datadog's {{function}}() is read as the per-second values a Datadog Agent sends, multiplied out.",
);

export const DATADOG_DIFF: string = translationKey(
  "Datadog's {{function}}() is read as the change since the previous interval.",
);

export const DATADOG_VARIABLE_WITHOUT_PREFIX: string = translationKey(
  "The variable ${{name}} takes a whole tag, so the query reads every value, as Datadog does on *.",
);

/*
 * What a Datadog metric is, as the project's own data says: the Agent's
 * gauges arrive as gauges, its counts as sums (DatadogIntake).
 */
export enum DatadogMetricKind {
  Gauge = "Gauge",
  Count = "Count",
}

export const DATADOG_AS_RATE: string = translationKey(
  "Datadog's .as_rate() is read as the per-second values a Datadog Agent sends.",
);

export const DATADOG_WEIGHTED: string = translationKey(
  "Datadog's .weighted() is left out.",
);

export const DATADOG_CONVERTED_BY_AI: string = translationKey(
  "OneUptime AI converted this query. Check that it reads what you expect.",
);

// Datadog's space aggregators and the PromQL aggregation of each.
const SPACE_AGGREGATORS: ReadonlyMap<string, string> = new Map<string, string>(
  [
    ["avg", "avg"],
    ["sum", "sum"],
    ["min", "min"],
    ["max", "max"],
  ],
);

// Datadog's rollup methods and the PromQL function of each.
const ROLLUPS: ReadonlyMap<string, string> = new Map<string, string>([
  ["avg", "avg_over_time"],
  ["sum", "sum_over_time"],
  ["min", "min_over_time"],
  ["max", "max_over_time"],
  ["count", "count_over_time"],
]);

// Functions that are the same in PromQL.
const SAME_FUNCTIONS: ReadonlyMap<string, string> = new Map<string, string>([
  ["abs", "abs"],
  ["log2", "log2"],
  ["log10", "log10"],
  ["sqrt", "sqrt"],
  ["ceil", "ceil"],
  ["floor", "floor"],
]);

const TIME_SHIFTS: ReadonlyMap<string, string> = new Map<string, string>([
  ["hour_before", "1h"],
  ["day_before", "1d"],
  ["week_before", "7d"],
  ["month_before", "28d"],
]);

// Datadog's per-second values written out per minute or hour.
const RATE_FUNCTIONS: ReadonlyMap<string, number> = new Map<string, number>([
  ["per_second", 1],
  ["per_minute", 60],
  ["per_hour", 3600],
]);

// Where a converted query runs, which decides how it reads its points.
export enum DatadogQueryContext {
  // A widget: each interval of the chart, as $__interval.
  Dashboard = "Dashboard",
  // A monitor's check: one minute, with the window's own reduction.
  Monitor = "Monitor",
}

export interface DatadogConversionOptions {
  context: DatadogQueryContext;
  // For a monitor: the function it reduces its window with (avg, sum...).
  monitorTimeAggregation?: string | undefined;
  // The dashboard's template variables: name -> the tag they filter.
  variablePrefixes: ReadonlyMap<string, string>;
  // A widget's queries by name, for its formulas.
  namedQueries?: ReadonlyMap<string, DatadogExpression> | undefined;
  // What the project's metrics say a Datadog metric is, by its Datadog name.
  knownMetricKinds?: ReadonlyMap<string, DatadogMetricKind> | undefined;
}

interface Converted {
  promQL: string;
  // The labels its series keep: the `by` tags; empty for one series.
  groups: Array<string> | undefined;
  // A number, not a series.
  isScalar: boolean;
}

class DatadogConversionError extends Error {
  public readonly note: ImportNote;
  // Whether OneUptime AI could write it: not what PromQL has no way to do.
  public readonly offersAi: boolean;

  public constructor(note: ImportNote, offersAi: boolean) {
    super(note.text);
    this.note = note;
    this.offersAi = offersAi;
  }
}

/*
 * What no PromQL does: anomalies, outliers and forecasts are models of
 * Datadog's, and a distribution's percentiles are not in what was sent.
 * OneUptime AI is not offered for them - it could only guess.
 */
const NO_PROMQL_FUNCTIONS: ReadonlySet<string> = new Set<string>([
  "anomalies",
  "outliers",
  "forecast",
  "robust_trend",
  "trend_line",
  "piecewise_constant",
  "piecewise_linear",
]);

const fail: (text: string, values?: Record<string, string>) => never = (
  text: string,
  values?: Record<string, string>,
): never => {
  const offersAi: boolean =
    text !== DATADOG_PERCENTILE_NOT_CONVERTED &&
    !NO_PROMQL_FUNCTIONS.has(values?.["function"] || "");

  throw new DatadogConversionError(
    {
      kind: ImportNoteKind.Reason,
      text,
      ...(values ? { values } : {}),
    },
    offersAi,
  );
};

// A label value inside a PromQL string, its backslashes and quotes set apart.
const promQLString: (value: string) => string = (value: string): string => {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
};

// A Datadog value with `*` wildcards, as an RE2 pattern.
const wildcardPattern: (value: string) => string = (value: string): string => {
  return value
    .split("*")
    .map((part: string): string => {
      return part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    })
    .join(".*");
};

// The tag a bare (keyless) Datadog tag is kept in.
const KEYLESS_TAGS_LABEL: string = toPromQLLabelName("datadog.tags");

interface Matcher {
  label: string;
  operator: "=" | "!=" | "=~" | "!~";
  value: string;
}

const matcherText: (matcher: Matcher) => string = (matcher: Matcher): string => {
  return `${matcher.label}${matcher.operator}"${promQLString(matcher.value)}"`;
};

// One tag as a matcher: exact, a wildcard, or a keyless tag.
const tagMatcher: (data: {
  key: string | undefined;
  value: string;
  negated: boolean;
}) => Matcher = (data: {
  key: string | undefined;
  value: string;
  negated: boolean;
}): Matcher => {
  if (!data.key) {
    return {
      label: KEYLESS_TAGS_LABEL,
      operator: data.negated ? "!~" : "=~",
      value: `(.*,)?${wildcardPattern(data.value)}(,.*)?`,
    };
  }

  const label: string = toPromQLLabelName(data.key);

  if (data.value.includes("*")) {
    return {
      label,
      operator: data.negated ? "!~" : "=~",
      value: wildcardPattern(data.value),
    };
  }

  return { label, operator: data.negated ? "!=" : "=", value: data.value };
};

/*
 * A scope as PromQL matchers: tags joined by AND, OR only between values
 * of one tag, NOT before a tag or such an OR.
 */
const scopeMatchers: (data: {
  scope: DatadogScope;
  options: DatadogConversionOptions;
  notes: Array<ImportNote>;
  negated?: boolean | undefined;
}) => Array<Matcher> = (data: {
  scope: DatadogScope;
  options: DatadogConversionOptions;
  notes: Array<ImportNote>;
  negated?: boolean | undefined;
}): Array<Matcher> => {
  const scope: DatadogScope = data.scope;
  const negated: boolean = Boolean(data.negated);

  switch (scope.kind) {
    case DatadogScopeKind.All:
      return [];
    case DatadogScopeKind.Tag:
      return [tagMatcher({ key: scope.key, value: scope.value, negated })];
    case DatadogScopeKind.Variable: {
      const key: string | undefined =
        scope.key || data.options.variablePrefixes.get(scope.name);

      if (!key) {
        // The variable is not converted, and says so; on "*" it reads it all.
        data.notes.push({
          kind: ImportNoteKind.Info,
          text: DATADOG_VARIABLE_WITHOUT_PREFIX,
          values: { name: scope.name },
        });
        return [];
      }

      return [
        {
          label: toPromQLLabelName(key),
          operator: negated ? "!=" : "=",
          value: `{{${scope.name}}}`,
        },
      ];
    }
    case DatadogScopeKind.In:
      return [
        {
          label: toPromQLLabelName(scope.key),
          operator: negated ? "!~" : "=~",
          value: scope.values.map(wildcardPattern).join("|"),
        },
      ];
    case DatadogScopeKind.Not:
      return scopeMatchers({
        ...data,
        scope: scope.term,
        negated: !negated,
      });
    case DatadogScopeKind.And: {
      if (negated) {
        // NOT (a AND b) is OR: only for one term.
        if (scope.terms.length === 1) {
          return scopeMatchers({ ...data, scope: scope.terms[0]!, negated });
        }

        return fail(DATADOG_SCOPE_NOT_CONVERTED, { scope: describeScope(scope) });
      }

      return scope.terms.flatMap((term: DatadogScope): Array<Matcher> => {
        return scopeMatchers({ ...data, scope: term, negated: false });
      });
    }
    case DatadogScopeKind.Or: {
      // Values of one tag: host:a OR host:b.
      const keys: Set<string> = new Set<string>();
      const patterns: Array<string> = [];

      for (const term of scope.terms) {
        if (term.kind !== DatadogScopeKind.Tag || !term.key) {
          return fail(DATADOG_SCOPE_NOT_CONVERTED, {
            scope: describeScope(scope),
          });
        }

        keys.add(term.key);
        patterns.push(wildcardPattern(term.value));
      }

      if (keys.size !== 1) {
        return fail(DATADOG_SCOPE_NOT_CONVERTED, { scope: describeScope(scope) });
      }

      return [
        {
          label: toPromQLLabelName(Array.from(keys)[0]!),
          operator: negated ? "!~" : "=~",
          value: patterns.join("|"),
        },
      ];
    }
    default:
      return [];
  }
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

// The function and window a query reads each series' points with.
const timeAggregation: (data: {
  methods: Array<DatadogMethod>;
  metric: string;
  options: DatadogConversionOptions;
  notes: Array<ImportNote>;
}) => { fn: string; window: string } = (data: {
  methods: Array<DatadogMethod>;
  metric: string;
  options: DatadogConversionOptions;
  notes: Array<ImportNote>;
}): { fn: string; window: string } => {
  const isMonitor: boolean = data.options.context === DatadogQueryContext.Monitor;
  const window: string = isMonitor ? "1m" : "$__interval";
  let fn: string | undefined = undefined;
  let rollupWindow: string | undefined = undefined;

  for (const method of data.methods) {
    switch (method.name) {
      case "as_count":
        fn = "sum_over_time";
        break;
      case "as_rate":
        fn = fn || "avg_over_time";
        data.notes.push({ kind: ImportNoteKind.Approximation, text: DATADOG_AS_RATE });
        break;
      case "rollup": {
        const rollupFn: string | undefined = ROLLUPS.get(method.args[0] || "");
        const seconds: number = Number(method.args[1]);

        if (!rollupFn) {
          fail(DATADOG_FUNCTION_NOT_CONVERTED, {
            function: `rollup(${method.args.join(", ")})`,
          });
        }

        fn = rollupFn;

        if (Number.isFinite(seconds) && seconds > 0 && !isMonitor) {
          rollupWindow = `${Math.round(seconds)}s`;
        }
        break;
      }
      case "fill":
        data.notes.push({ kind: ImportNoteKind.Approximation, text: DATADOG_FILL_LEFT_OUT });
        break;
      case "weighted":
        data.notes.push({ kind: ImportNoteKind.Approximation, text: DATADOG_WEIGHTED });
        break;
      default:
        fail(DATADOG_FUNCTION_NOT_CONVERTED, { function: `.${method.name}` });
    }
  }

  if (!fn) {
    const kind: DatadogMetricKind | undefined =
      data.options.knownMetricKinds?.get(data.metric);

    // A monitor reduces its window: each minute is read the same way.
    const monitorFn: string | undefined = isMonitor
      ? ROLLUPS.get(data.options.monitorTimeAggregation || "avg")
      : undefined;

    if (kind === DatadogMetricKind.Count) {
      // A count's points add up, as Datadog reads a count.
      fn = "sum_over_time";
    } else {
      fn = monitorFn || "avg_over_time";

      if (kind !== DatadogMetricKind.Gauge && fn === "avg_over_time") {
        data.notes.push({
          kind: ImportNoteKind.Approximation,
          text: DATADOG_READ_AS_GAUGE,
          values: { metrics: data.metric },
        });
      }
    }
  }

  return { fn, window: rollupWindow || window };
};

/*
 * A widget's notes, one of each, the metrics read as gauges said together
 * in one: "system.cpu.idle, system.cpu.user are gauges or counts".
 */
export const mergeDatadogNotes: (
  notes: ReadonlyArray<ImportNote>,
) => Array<ImportNote> = (notes: ReadonlyArray<ImportNote>): Array<ImportNote> => {
  const gaugeMetrics: Array<string> = [];
  let gaugeNoteIndex: number = -1;
  const merged: Array<ImportNote> = [];
  const said: Set<string> = new Set<string>();

  for (const note of notes) {
    if (note.text === DATADOG_READ_AS_GAUGE) {
      for (const metric of (note.values?.["metrics"] || "").split(", ")) {
        if (metric && !gaugeMetrics.includes(metric)) {
          gaugeMetrics.push(metric);
        }
      }

      if (gaugeNoteIndex === -1) {
        gaugeNoteIndex = merged.length;
        merged.push(note);
      }

      continue;
    }

    const key: string = `${note.kind}|${note.text}|${JSON.stringify(note.values || {})}`;

    if (said.has(key)) {
      continue;
    }

    said.add(key);
    merged.push(note);
  }

  if (gaugeNoteIndex !== -1) {
    merged[gaugeNoteIndex] = {
      kind: ImportNoteKind.Approximation,
      text: DATADOG_READ_AS_GAUGE,
      values: { metrics: gaugeMetrics.join(", ") },
    };
  }

  return merged;
};

const groupKey: (groups: Array<string> | undefined) => string = (
  groups: Array<string> | undefined,
): string => {
  return (groups || []).slice().sort().join(",");
};

interface ConvertData {
  expression: DatadogExpression;
  options: DatadogConversionOptions;
  notes: Array<ImportNote>;
  references: Set<string>;
  // A shift back in time every selector reads at: `offset 1h`.
  offset?: string | undefined;
}

const convertExpression: (data: ConvertData) => Converted = (
  data: ConvertData,
): Converted => {
  const expression: DatadogExpression = data.expression;
  const recurse: (inner: DatadogExpression) => Converted = (
    inner: DatadogExpression,
  ): Converted => {
    return convertExpression({ ...data, expression: inner });
  };

  switch (expression.kind) {
    case DatadogExpressionKind.Number:
      return { promQL: String(expression.value), groups: [], isScalar: true };
    case DatadogExpressionKind.Text:
      return fail(DATADOG_QUERY_UNREADABLE, {
        error: `"${expression.value}" is text`,
      });
    case DatadogExpressionKind.Reference: {
      const named: DatadogExpression | undefined =
        data.options.namedQueries?.get(expression.name);

      if (!named || data.references.has(expression.name)) {
        return fail(DATADOG_UNKNOWN_QUERY_NAME, { name: expression.name });
      }

      const references: Set<string> = new Set<string>(data.references);
      references.add(expression.name);
      return convertExpression({ ...data, expression: named, references });
    }
    case DatadogExpressionKind.Query: {
      const aggregator: string = expression.aggregator || "avg";

      if (/^p[0-9]+$/.test(aggregator)) {
        return fail(DATADOG_PERCENTILE_NOT_CONVERTED, { aggregator });
      }

      const spaceFn: string | undefined = SPACE_AGGREGATORS.get(aggregator);

      if (!spaceFn) {
        return fail(DATADOG_FUNCTION_NOT_CONVERTED, { function: aggregator });
      }

      const matchers: Array<Matcher> = scopeMatchers({
        scope: expression.scope,
        options: data.options,
        notes: data.notes,
      });
      const time: { fn: string; window: string } = timeAggregation({
        methods: expression.methods,
        metric: expression.metric,
        options: data.options,
        notes: data.notes,
      });
      const selector: string = `${toPromQLMetricName(expression.metric)}${
        matchers.length > 0 ? `{${matchers.map(matcherText).join(",")}}` : ""
      }`;
      const groups: Array<string> = expression.groupBy.map(toPromQLLabelName);
      const by: string = groups.length > 0 ? ` by (${groups.join(", ")})` : "";
      const offset: string = data.offset ? ` offset ${data.offset}` : "";

      return {
        promQL: `${spaceFn}${by} (${time.fn}(${selector}[${time.window}]${offset}))`,
        groups,
        isScalar: false,
      };
    }
    case DatadogExpressionKind.Negate: {
      const inner: Converted = recurse(expression.expression);
      return { ...inner, promQL: `-(${inner.promQL})` };
    }
    case DatadogExpressionKind.Binary: {
      const left: Converted = recurse(expression.left);
      const right: Converted = recurse(expression.right);

      if (left.isScalar || right.isScalar) {
        return {
          promQL: `(${left.promQL}) ${expression.operator} (${right.promQL})`,
          groups: left.isScalar ? right.groups : left.groups,
          isScalar: left.isScalar && right.isScalar,
        };
      }

      // Series grouped alike match one to one, as Datadog matches them.
      if (groupKey(left.groups) === groupKey(right.groups)) {
        return {
          promQL: `(${left.promQL}) ${expression.operator} (${right.promQL})`,
          groups: left.groups,
          isScalar: false,
        };
      }

      // One ungrouped side is one series, shared by every group of the other.
      if ((left.groups || []).length === 0) {
        return {
          promQL: `scalar(${left.promQL}) ${expression.operator} (${right.promQL})`,
          groups: right.groups,
          isScalar: false,
        };
      }

      if ((right.groups || []).length === 0) {
        return {
          promQL: `(${left.promQL}) ${expression.operator} scalar(${right.promQL})`,
          groups: left.groups,
          isScalar: false,
        };
      }

      return fail(DATADOG_GROUPS_DO_NOT_MATCH);
    }
    case DatadogExpressionKind.Call:
      return convertCall({ ...data, call: expression });
    default:
      return fail(DATADOG_QUERY_UNREADABLE, { error: "unknown expression" });
  }
};

const numberArg: (arg: DatadogExpression | undefined) => number | undefined = (
  arg: DatadogExpression | undefined,
): number | undefined => {
  if (arg?.kind === DatadogExpressionKind.Number) {
    return arg.value;
  }

  if (
    arg?.kind === DatadogExpressionKind.Negate &&
    arg.expression.kind === DatadogExpressionKind.Number
  ) {
    return -arg.expression.value;
  }

  return undefined;
};

const textArg: (arg: DatadogExpression | undefined) => string = (
  arg: DatadogExpression | undefined,
): string => {
  if (arg?.kind === DatadogExpressionKind.Text) {
    return arg.value;
  }

  if (arg?.kind === DatadogExpressionKind.Reference) {
    return arg.name;
  }

  return "";
};

const convertCall: (
  data: Omit<ConvertData, "expression"> & {
    call: Extract<DatadogExpression, { kind: DatadogExpressionKind.Call }>;
  },
) => Converted = (
  data: Omit<ConvertData, "expression"> & {
    call: Extract<DatadogExpression, { kind: DatadogExpressionKind.Call }>;
  },
): Converted => {
  const { call } = data;
  const name: string = call.name;
  const first: DatadogExpression | undefined = call.args[0];

  if (!first) {
    return fail(DATADOG_FUNCTION_NOT_CONVERTED, { function: name });
  }

  const convertFirst: (offset?: string | undefined) => Converted = (
    offset?: string | undefined,
  ): Converted => {
    return convertExpression({
      expression: first,
      options: data.options,
      notes: data.notes,
      references: data.references,
      offset: offset ?? data.offset,
    });
  };

  // hour_before(q) and timeshift(q, -3600): every selector read earlier.
  const shift: string | undefined = TIME_SHIFTS.get(name);

  if (shift || name === "timeshift") {
    const seconds: number | undefined = numberArg(call.args[1]);
    const offset: string | undefined = shift
      ? shift
      : seconds !== undefined && seconds !== 0
        ? `${Math.round(-seconds)}s`
        : undefined;

    if (!offset || data.offset) {
      return fail(DATADOG_FUNCTION_NOT_CONVERTED, { function: name });
    }

    return convertFirst(offset);
  }

  const inner: Converted = convertFirst();

  const same: string | undefined = SAME_FUNCTIONS.get(name);

  if (same) {
    return { ...inner, promQL: `${same}(${inner.promQL})` };
  }

  const rate: number | undefined = RATE_FUNCTIONS.get(name);

  if (rate !== undefined) {
    data.notes.push({
      kind: ImportNoteKind.Approximation,
      text: DATADOG_RATE_FUNCTION,
      values: { function: name },
    });
    return {
      ...inner,
      promQL: rate === 1 ? inner.promQL : `${rate} * (${inner.promQL})`,
    };
  }

  if (name === "diff" || name === "derivative") {
    if (data.offset) {
      return fail(DATADOG_FUNCTION_NOT_CONVERTED, { function: name });
    }

    data.notes.push({
      kind: ImportNoteKind.Approximation,
      text: DATADOG_DIFF,
      values: { function: name },
    });
    const before: Converted = convertFirst("$__interval");
    const change: string = `(${inner.promQL}) - (${before.promQL})`;
    return {
      ...inner,
      promQL:
        name === "derivative"
          ? `(${change}) / ($__interval_ms / 1000)`
          : change,
    };
  }

  if (name === "clamp_min" || name === "clamp_max") {
    const limit: number | undefined = numberArg(call.args[1]);

    if (limit === undefined) {
      return fail(DATADOG_FUNCTION_NOT_CONVERTED, { function: name });
    }

    return { ...inner, promQL: `${name}(${inner.promQL}, ${limit})` };
  }

  if (name === "cutoff_min" || name === "cutoff_max") {
    const limit: number | undefined = numberArg(call.args[1]);

    if (limit === undefined) {
      return fail(DATADOG_FUNCTION_NOT_CONVERTED, { function: name });
    }

    return {
      ...inner,
      promQL: `(${inner.promQL}) ${name === "cutoff_min" ? ">=" : "<="} ${limit}`,
    };
  }

  // top(q, 10, 'mean', 'desc'), and top5, top10_max, bottom5 ...
  const top: RegExpMatchArray | null = name.match(
    /^(top|bottom)([0-9]+)?(?:_(mean|min|max|last|area|l2norm|norm))?$/,
  );

  if (top) {
    const count: number | undefined = top[2]
      ? Number(top[2])
      : numberArg(call.args[1]) ?? 10;
    const direction: string = top[2]
      ? top[1] === "bottom"
        ? "asc"
        : "desc"
      : textArg(call.args[3]) || (top[1] === "bottom" ? "asc" : "desc");

    data.notes.push({ kind: ImportNoteKind.Approximation, text: DATADOG_TOP_PER_STEP });

    return {
      ...inner,
      promQL: `${direction === "asc" ? "bottomk" : "topk"}(${count}, ${inner.promQL})`,
    };
  }

  return fail(DATADOG_FUNCTION_NOT_CONVERTED, { function: name });
};

// The metrics a query or formula reads, by their Datadog names.
export const collectDatadogMetricNames: (
  expression: DatadogExpression,
  names: Set<string>,
) => void = (expression: DatadogExpression, names: Set<string>): void => {
  switch (expression.kind) {
    case DatadogExpressionKind.Query:
      names.add(expression.metric);
      return;
    case DatadogExpressionKind.Binary:
      collectDatadogMetricNames(expression.left, names);
      collectDatadogMetricNames(expression.right, names);
      return;
    case DatadogExpressionKind.Negate:
      collectDatadogMetricNames(expression.expression, names);
      return;
    case DatadogExpressionKind.Call:
      for (const arg of expression.args) {
        collectDatadogMetricNames(arg, names);
      }
      return;
    default:
      return;
  }
};

// The metrics a query's text reads; none when it does not parse.
export const readDatadogMetricNames: (query: string) => Array<string> = (
  query: string,
): Array<string> => {
  const names: Set<string> = new Set<string>();

  try {
    collectDatadogMetricNames(parseDatadogExpression(query), names);
  } catch {
    // Not converted either: nothing to look up.
  }

  return Array.from(names);
};

/*
 * A Datadog query or formula, converted for where it runs. A query no rule
 * here converts is not converted: its notes say why, and it is a candidate
 * for OneUptime AI. `isFromAi`: the query is PromQL OneUptime AI wrote,
 * checked the same way as any other.
 */
export const convertDatadogQuery: (data: {
  query: string;
  options: DatadogConversionOptions;
  aiQuery?: string | undefined;
}) => ConvertedQuery = (data: {
  query: string;
  options: DatadogConversionOptions;
  aiQuery?: string | undefined;
}): ConvertedQuery => {
  const variableNames: Array<string> = Array.from(
    data.options.variablePrefixes.keys(),
  );
  const candidate: () => ConvertedQuery["aiCandidate"] = () => {
    return {
      language: ImportQueryLanguage.Datadog,
      query: data.query,
      variableNames,
      isForMonitor: data.options.context === DatadogQueryContext.Monitor,
    };
  };

  if (data.aiQuery !== undefined) {
    const problem: ImportNote | null = findPromQLImportProblem({
      promQL: data.aiQuery,
    });

    if (problem) {
      return {
        status: ImportItemStatus.NotConverted,
        promQL: data.aiQuery,
        notes: [problem],
        aiCandidate: candidate(),
      };
    }

    return {
      status: ImportItemStatus.Approximate,
      promQL: data.aiQuery,
      notes: [{ kind: ImportNoteKind.Approximation, text: DATADOG_CONVERTED_BY_AI }],
    };
  }

  let expression: DatadogExpression;

  try {
    expression = parseDatadogExpression(data.query);
  } catch (error) {
    return {
      status: ImportItemStatus.NotConverted,
      promQL: "",
      notes: [
        {
          kind: ImportNoteKind.Reason,
          text: DATADOG_QUERY_UNREADABLE,
          values: {
            error:
              error instanceof DatadogQueryError || error instanceof Error
                ? error.message
                : String(error),
          },
        },
      ],
      aiCandidate: candidate(),
    };
  }

  const notes: Array<ImportNote> = [];

  try {
    const converted: Converted = convertExpression({
      expression,
      options: data.options,
      notes,
      references: new Set<string>(),
    });

    const problem: ImportNote | null = findPromQLImportProblem({
      promQL: converted.promQL,
    });

    if (problem) {
      return {
        status: ImportItemStatus.NotConverted,
        promQL: converted.promQL,
        notes: [...notes, problem],
        aiCandidate: candidate(),
      };
    }

    // One note of each, in the order first said.
    const distinct: Array<ImportNote> = mergeDatadogNotes(notes);

    return {
      status: ImportStatusUtil.fromNotes(distinct),
      promQL: converted.promQL,
      notes: distinct,
    };
  } catch (error) {
    if (error instanceof DatadogConversionError) {
      return {
        status: ImportItemStatus.NotConverted,
        promQL: "",
        notes: [error.note],
        ...(error.offersAi ? { aiCandidate: candidate() } : {}),
      };
    }

    throw error;
  }
};
