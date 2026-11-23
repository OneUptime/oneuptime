import DashboardChartType from "../../../Types/Dashboard/Chart/ChartType";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import { FilterType } from "../../../Types/Monitor/CriteriaFilter";
import LogSeverity from "../../../Types/Log/LogSeverity";
import {
  ImportItemStatus,
  ImportNote,
  ImportNoteKind,
  ImportStatusUtil,
  ImportedLogQuery,
} from "../../../Types/ObservabilityImport/ObservabilityImport";
import { translationKey } from "../../../Types/Translator";
import { LOGQL_VARIABLES_EVERYWHERE } from "../Grafana/GrafanaLoki";
import {
  ImportObject,
  arrayField,
  asObject,
  field,
  objectField,
  textField,
} from "../ImportValues";
import { buildLogChartWidget, buildLogStreamWidget } from "../ImportWidgets";
import {
  DatadogLogField,
  DatadogLogFieldTarget,
  readDatadogLogField,
} from "./DatadogAttributes";
import {
  DatadogLogFilters,
  DatadogLogSearchTarget,
  convertDatadogLogSearch,
  readLogStreamSeverity,
} from "./DatadogLogSearch";
import { DatadogQueryError } from "./DatadogQueryParser";

/*
 * DATADOG'S LOG WIDGETS AND LOG MONITORS (issue #10324).
 *
 * What reads Datadog's logs becomes what reads OneUptime's, each search
 * read by DatadogLogSearch:
 *
 *   log_stream, list_stream of logs_stream   Log Stream
 *     (docs.datadoghq.com/dashboards/widgets/log_stream, .../widgets/list)
 *   timeseries counting logs                 Log Chart
 *     (a query of data_source "logs", or an old request's log_query, whose
 *     compute is a count)
 *   a log monitor                            Logs monitor
 *     (docs.datadoghq.com/monitors/types/log; its query is
 *     logs(query).index(index).rollup(method[, measure]).by(facets)
 *     .last(window) operator threshold)
 *
 * A Log Stream lists each log's severity, time and message, newest first:
 * Datadog's other columns and an oldest-first order are said. A Log Chart
 * and a Logs monitor count the logs their filters match, together: a count
 * Datadog split by facets is said, a monitor's facets that are attributes
 * becoming its group-by. What computes something other than a count - an
 * average of a measure, a count of unique values - is not converted, and
 * neither are log patterns and transactions.
 *
 * Datadog's log indexes are a choice of where logs are kept: OneUptime
 * searches all of a project's logs, which the notes say.
 */

export const LOG_COLUMNS_LEFT_OUT: string = translationKey(
  "Datadog's columns {{columns}} are left out: a Log Stream shows each log's severity, time and message.",
);

export const LOG_OLDEST_FIRST: string = translationKey(
  "Datadog listed the oldest logs first; a Log Stream lists the newest first.",
);

export const LOG_INDEXES_LEFT_OUT: string = translationKey(
  "Datadog's log indexes ({{indexes}}) are left out: OneUptime searches all of the project's logs.",
);

export const LOG_COMPUTES_OTHER: string = translationKey(
  "It computes {{aggregation}} over the logs, where OneUptime counts them.",
);

export const LOG_GROUPS_LEFT_OUT: string = translationKey(
  "OneUptime counts the matching logs together; Datadog split them by {{facets}}.",
);

export const LOG_FORMULA_NOT_CONVERTED: string = translationKey(
  "Its formula combines log counts, and a Log Chart draws one count.",
);

export const LOG_WIDGET_NOT_SUPPORTED: string = translationKey(
  "OneUptime draws logs as a Log Stream or a Log Chart, not as Datadog's {{type}} widget.",
);

// The columns a Log Stream shows of its own: severity, time and message.
const SHOWN_COLUMNS: ReadonlySet<string> = new Set<string>([
  "status_line",
  "status",
  "timestamp",
  "date",
  "time",
  "content",
  "message",
]);

// Indexes that mean every log: none named, all of them, the default one.
const ALL_INDEXES: ReadonlySet<string> = new Set<string>(["", "*", "main"]);

// One character of white space.
const WHITE_SPACE: RegExp = /\s/;

// How a log monitor's query starts: logs("<search>").
const LOG_MONITOR_QUERY_START: RegExp = /^logs\s*\(/;

// Datadog's chart displays, as a Log Chart's.
const LOG_CHART_TYPES: ReadonlyMap<string, DashboardChartType> = new Map<
  string,
  DashboardChartType
>([
  ["bars", DashboardChartType.Bar],
  ["line", DashboardChartType.Line],
  ["area", DashboardChartType.Area],
]);

export interface ConvertedLogWidget {
  status: ImportItemStatus;
  notes: Array<ImportNote>;
  component?: DashboardBaseComponent | undefined;
}

const notConverted: (note: ImportNote) => ConvertedLogWidget = (
  note: ImportNote,
): ConvertedLogWidget => {
  return { status: ImportItemStatus.NotConverted, notes: [note] };
};

// Text values of a list, as written: indexes, columns.
const textList: (values: Array<unknown>) => Array<string> = (
  values: Array<unknown>,
): Array<string> => {
  return values
    .map((value: unknown): string => {
      if (typeof value === "string") {
        return value;
      }

      // A list stream's column: {"field": "host", "width": "auto"}.
      return textField(asObject(value), "field");
    })
    .filter((value: string): boolean => {
      return value.length > 0;
    });
};

const noteIndexes: (
  indexes: Array<string>,
  notes: Array<ImportNote>,
) => void = (indexes: Array<string>, notes: Array<ImportNote>): void => {
  const named: Array<string> = indexes.filter((index: string): boolean => {
    return !ALL_INDEXES.has(index);
  });

  if (named.length > 0) {
    notes.push({
      kind: ImportNoteKind.Info,
      text: LOG_INDEXES_LEFT_OUT,
      values: { indexes: named.join(", ") },
    });
  }
};

// The dashboard's variables narrow every log widget, not only those named.
const noteVariables: (data: {
  variablePrefixes: ReadonlyMap<string, string>;
  notes: Array<ImportNote>;
}) => void = (data: {
  variablePrefixes: ReadonlyMap<string, string>;
  notes: Array<ImportNote>;
}): void => {
  if (data.variablePrefixes.size > 0) {
    data.notes.push({
      kind: ImportNoteKind.Info,
      text: LOGQL_VARIABLES_EVERYWHERE,
    });
  }
};

/*
 * A log_stream widget, or a list_stream of logs, as a Log Stream: its
 * search, the columns it shows, the order it lists.
 */
export const convertDatadogLogStreamWidget: (data: {
  definition: ImportObject;
  title: string;
  variablePrefixes: ReadonlyMap<string, string>;
}) => ConvertedLogWidget = (data: {
  definition: ImportObject;
  title: string;
  variablePrefixes: ReadonlyMap<string, string>;
}): ConvertedLogWidget => {
  const isList: boolean = textField(data.definition, "type") === "list_stream";
  const request: ImportObject | undefined = isList
    ? asObject(arrayField(data.definition, "requests")[0])
    : undefined;
  const query: ImportObject | undefined = objectField(request, "query");

  if (isList) {
    const dataSource: string = textField(query, "data_source") || "logs_stream";

    if (dataSource !== "logs_stream") {
      return notConverted({
        kind: ImportNoteKind.Reason,
        text: LOG_WIDGET_NOT_SUPPORTED,
        values: { type: `list_stream (${dataSource})` },
      });
    }
  }

  const searchText: string = isList
    ? textField(query, "query_string")
    : textField(data.definition, "query");
  const notes: Array<ImportNote> = [];

  const filters: DatadogLogFilters = convertDatadogLogSearch({
    query: searchText,
    target: DatadogLogSearchTarget.Stream,
    notes,
    variablePrefixes: data.variablePrefixes,
  });

  const severity: LogSeverity | undefined = readLogStreamSeverity({
    severities: filters.severities,
    notes,
  });

  noteIndexes(
    textList(
      isList
        ? arrayField(query, "indexes")
        : [
            ...arrayField(data.definition, "indexes"),
            textField(data.definition, "logset"),
          ],
    ),
    notes,
  );

  const columns: Array<string> = textList(
    isList
      ? arrayField(request, "columns")
      : arrayField(data.definition, "columns"),
  ).filter((column: string): boolean => {
    return !SHOWN_COLUMNS.has(column);
  });

  if (columns.length > 0) {
    notes.push({
      kind: ImportNoteKind.Approximation,
      text: LOG_COLUMNS_LEFT_OUT,
      values: { columns: columns.join(", ") },
    });
  }

  const sort: ImportObject | undefined = objectField(
    isList ? query : data.definition,
    "sort",
  );

  if (textField(sort, "order") === "asc") {
    notes.push({ kind: ImportNoteKind.Approximation, text: LOG_OLDEST_FIRST });
  }

  noteVariables({ variablePrefixes: data.variablePrefixes, notes });

  return {
    status: ImportStatusUtil.fromNotes(notes),
    notes,
    component: buildLogStreamWidget({
      title: data.title,
      filters: {
        bodyContains: filters.bodyContains,
        attributeFilterQuery: filters.attributeQuery,
        attributeFilters: {},
      },
      severity,
    }),
  };
};

// One log query of a widget: its name, search, indexes, compute and groups.
interface LogQuery {
  name: string;
  search: string;
  indexes: Array<string>;
  aggregation: string;
  measure: string;
  groupBy: Array<string>;
}

// A request's log queries, in the shapes Datadog's widgets write them.
const readLogQueries: (request: ImportObject) => Array<LogQuery> = (
  request: ImportObject,
): Array<LogQuery> => {
  const queries: Array<LogQuery> = [];
  const old: ImportObject | undefined = objectField(request, "log_query");

  // An old request: {"log_query": {"index", "search": {"query"}, "compute"}}.
  if (old) {
    const compute: ImportObject | undefined = objectField(old, "compute");

    queries.push({
      name: "",
      search:
        textField(objectField(old, "search"), "query") ||
        textField(old, "query"),
      indexes: textList([textField(old, "index")]),
      aggregation: textField(compute, "aggregation") || "count",
      measure: textField(compute, "facet"),
      groupBy: textList(
        arrayField(old, "group_by").map((group: unknown): string => {
          return textField(asObject(group), "facet");
        }),
      ),
    });
  }

  for (const item of arrayField(request, "queries")) {
    const query: ImportObject | undefined = asObject(item);

    if (textField(query, "data_source") !== "logs") {
      continue;
    }

    const compute: ImportObject | undefined = objectField(query, "compute");

    queries.push({
      name: textField(query, "name"),
      search: textField(objectField(query, "search"), "query"),
      indexes: textList(arrayField(query, "indexes")),
      aggregation: textField(compute, "aggregation") || "count",
      measure: textField(compute, "metric"),
      groupBy: textList(
        arrayField(query, "group_by").map((group: unknown): string => {
          return textField(asObject(group), "facet");
        }),
      ),
    });
  }

  return queries;
};

// Whether a widget's requests read logs and nothing else.
export const isDatadogLogCountWidget: (definition: ImportObject) => boolean = (
  definition: ImportObject,
): boolean => {
  const value: unknown = field(definition, "requests");
  const requests: Array<ImportObject> = (Array.isArray(value) ? value : [value])
    .map(asObject)
    .filter((request: ImportObject | undefined): boolean => {
      return Boolean(request);
    }) as Array<ImportObject>;

  if (requests.length === 0) {
    return false;
  }

  return requests.every((request: ImportObject): boolean => {
    const queries: Array<unknown> = arrayField(request, "queries");
    const readsLogsOnly: boolean =
      queries.length > 0 &&
      queries.every((item: unknown): boolean => {
        return textField(asObject(item), "data_source") === "logs";
      });

    return (
      (readsLogsOnly || objectField(request, "log_query") !== undefined) &&
      textField(request, "q") === ""
    );
  });
};

/*
 * A timeseries of log counts as a Log Chart: the first count's search,
 * each other said, as a chart of metrics draws its first query alone
 * where it can draw one.
 */
export const convertDatadogLogChartWidget: (data: {
  definition: ImportObject;
  title: string;
  variablePrefixes: ReadonlyMap<string, string>;
  showsFirstQueryNote: (count: number) => ImportNote;
}) => ConvertedLogWidget = (data: {
  definition: ImportObject;
  title: string;
  variablePrefixes: ReadonlyMap<string, string>;
  showsFirstQueryNote: (count: number) => ImportNote;
}): ConvertedLogWidget => {
  const value: unknown = field(data.definition, "requests");
  const requests: Array<ImportObject> = (Array.isArray(value) ? value : [value])
    .map(asObject)
    .filter((request: ImportObject | undefined): boolean => {
      return Boolean(request);
    }) as Array<ImportObject>;

  const counts: Array<LogQuery> = [];

  for (const request of requests) {
    const queries: Array<LogQuery> = readLogQueries(request);
    const formulas: Array<string> = arrayField(request, "formulas")
      .map((formula: unknown): string => {
        return textField(asObject(formula), "formula").trim();
      })
      .filter((formula: string): boolean => {
        return formula.length > 0;
      });

    // Each formula must be one of the queries itself: query1, not query1 / query2.
    const byName: Map<string, LogQuery> = new Map<string, LogQuery>(
      queries.map((query: LogQuery): [string, LogQuery] => {
        return [query.name, query];
      }),
    );

    if (formulas.length > 0) {
      for (const formula of formulas) {
        const query: LogQuery | undefined = byName.get(formula);

        if (!query) {
          return notConverted({
            kind: ImportNoteKind.Reason,
            text: LOG_FORMULA_NOT_CONVERTED,
          });
        }

        counts.push(query);
      }
      continue;
    }

    counts.push(...queries);
  }

  const first: LogQuery | undefined = counts[0];

  if (!first) {
    return notConverted({
      kind: ImportNoteKind.Reason,
      text: LOG_WIDGET_NOT_SUPPORTED,
      values: { type: textField(data.definition, "type") },
    });
  }

  if (first.aggregation !== "count" || first.measure) {
    return notConverted({
      kind: ImportNoteKind.Reason,
      text: LOG_COMPUTES_OTHER,
      values: {
        aggregation: first.measure
          ? `${first.aggregation}(${first.measure})`
          : first.aggregation,
      },
    });
  }

  const notes: Array<ImportNote> = [];

  if (counts.length > 1) {
    notes.push(data.showsFirstQueryNote(counts.length));
  }

  const filters: DatadogLogFilters = convertDatadogLogSearch({
    query: first.search,
    target: DatadogLogSearchTarget.Exact,
    notes,
    variablePrefixes: data.variablePrefixes,
  });

  if (first.groupBy.length > 0) {
    notes.push({
      kind: ImportNoteKind.Approximation,
      text: LOG_GROUPS_LEFT_OUT,
      values: { facets: first.groupBy.join(", ") },
    });
  }

  noteIndexes(first.indexes, notes);
  noteVariables({ variablePrefixes: data.variablePrefixes, notes });

  const display: string = textField(asObject(requests[0]), "display_type");

  return {
    status: ImportStatusUtil.fromNotes(notes),
    notes,
    component: buildLogChartWidget({
      title: data.title,
      filters: {
        bodyContains: filters.bodyContains,
        attributeFilterQuery: "",
        attributeFilters: filters.attributes,
      },
      severities: filters.severities,
      chartType: LOG_CHART_TYPES.get(display) || DashboardChartType.Bar,
    }),
  };
};

// -------------------------------------------------------------- monitors

/*
 * A log monitor's query, read: logs("<search>").index("<index>")
 * .rollup("<method>"[, "<measure>"]).by("<facets>").last("<window>")
 * <comparison> <threshold>.
 */
export interface DatadogLogMonitorQuery {
  search: string;
  indexes: Array<string>;
  rollup: string;
  measure: string;
  groupBy: Array<string>;
  window: string;
  comparison: string;
  threshold: number;
}

// A quoted argument, its escapes undone, from `index` on; where it ends.
const readQuoted: (
  text: string,
  index: number,
) => { value: string; end: number } | undefined = (
  text: string,
  index: number,
): { value: string; end: number } | undefined => {
  const quote: string = text.charAt(index);

  if (quote !== '"' && quote !== "'") {
    return undefined;
  }

  let value: string = "";

  for (let at: number = index + 1; at < text.length; at++) {
    const char: string = text.charAt(at);

    if (char === "\\" && at + 1 < text.length) {
      value += text.charAt(at + 1);
      at++;
      continue;
    }

    if (char === quote) {
      return { value, end: at + 1 };
    }

    value += char;
  }

  return undefined;
};

// A method's arguments: quoted strings, or bare words and numbers.
const readArguments: (
  text: string,
  open: number,
) => { args: Array<string>; end: number } = (
  text: string,
  open: number,
): { args: Array<string>; end: number } => {
  const args: Array<string> = [];
  let at: number = open + 1;

  for (;;) {
    while (WHITE_SPACE.test(text.charAt(at))) {
      at++;
    }

    if (at >= text.length) {
      throw new DatadogQueryError("a method's arguments are never closed");
    }

    if (text.charAt(at) === ")") {
      return { args, end: at + 1 };
    }

    const quoted: { value: string; end: number } | undefined = readQuoted(
      text,
      at,
    );

    if (quoted) {
      args.push(quoted.value);
      at = quoted.end;
    } else {
      const word: RegExpMatchArray | null = text
        .slice(at)
        .match(/^[A-Za-z0-9_.@*-]+/);

      if (!word) {
        throw new DatadogQueryError(
          `unexpected "${text.charAt(at)}" at character ${at + 1}`,
        );
      }

      args.push(word[0]);
      at += word[0].length;
    }

    while (WHITE_SPACE.test(text.charAt(at))) {
      at++;
    }

    if (text.charAt(at) === ",") {
      at++;
    }
  }
};

export const parseDatadogLogMonitorQuery: (
  text: string,
) => DatadogLogMonitorQuery = (text: string): DatadogLogMonitorQuery => {
  const source: string = (text || "").trim();

  if (!LOG_MONITOR_QUERY_START.test(source)) {
    throw new DatadogQueryError(
      'a log monitor\'s query starts with its search, as logs("status:error")',
    );
  }

  const read: DatadogLogMonitorQuery = {
    search: "",
    indexes: [],
    rollup: "count",
    measure: "",
    groupBy: [],
    window: "",
    comparison: "",
    threshold: Number.NaN,
  };

  const first: { args: Array<string>; end: number } = readArguments(
    source,
    source.indexOf("("),
  );
  read.search = first.args[0] || "";

  let at: number = first.end;

  for (;;) {
    while (WHITE_SPACE.test(source.charAt(at))) {
      at++;
    }

    if (source.charAt(at) !== ".") {
      break;
    }

    const method: RegExpMatchArray | null = source
      .slice(at + 1)
      .match(/^([A-Za-z_]+)\s*\(/);

    if (!method) {
      throw new DatadogQueryError("a method has no name");
    }

    const name: string = method[1] || "";
    const parsed: { args: Array<string>; end: number } = readArguments(
      source,
      at + method[0].length,
    );

    switch (name) {
      case "index":
        read.indexes.push(
          ...parsed.args.flatMap((arg: string): Array<string> => {
            return arg.split(",").map((index: string): string => {
              return index.trim();
            });
          }),
        );
        break;
      case "rollup":
        read.rollup = parsed.args[0] || "count";
        read.measure = parsed.args[1] || "";
        break;
      case "by":
        read.groupBy.push(
          ...parsed.args
            .flatMap((arg: string): Array<string> => {
              return arg.split(",");
            })
            .map((facet: string): string => {
              return facet.trim();
            })
            .filter((facet: string): boolean => {
              return facet.length > 0;
            }),
        );
        break;
      case "last":
        read.window = parsed.args[0] || "";
        break;
      default:
        throw new DatadogQueryError(`OneUptime does not read .${name}()`);
    }

    at = parsed.end;
  }

  const tail: RegExpMatchArray | null = source
    .slice(at)
    .match(
      /^\s*(>=|<=|==|!=|>|<|=)\s*(-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)\s*$/,
    );

  if (!tail) {
    throw new DatadogQueryError(
      "a log monitor's query ends in a comparison with a number, as > 10",
    );
  }

  read.comparison = tail[1] || "";
  read.threshold = Number(tail[2]);

  return read;
};

export interface ConvertedLogMonitor {
  status: ImportItemStatus;
  notes: Array<ImportNote>;
  logQuery?: ImportedLogQuery | undefined;
}

/*
 * A log monitor's search, facets and indexes as a Logs monitor's filters
 * and group-by. Its window and threshold are the monitor's own.
 */
export const convertDatadogLogMonitorQuery: (
  query: DatadogLogMonitorQuery,
) => ConvertedLogMonitor = (
  query: DatadogLogMonitorQuery,
): ConvertedLogMonitor => {
  if (query.rollup !== "count" || query.measure) {
    return {
      status: ImportItemStatus.NotConverted,
      notes: [
        {
          kind: ImportNoteKind.Reason,
          text: LOG_COMPUTES_OTHER,
          values: {
            aggregation: query.measure
              ? `${query.rollup}(${query.measure})`
              : query.rollup,
          },
        },
      ],
    };
  }

  const notes: Array<ImportNote> = [];
  const filters: DatadogLogFilters = convertDatadogLogSearch({
    query: query.search,
    target: DatadogLogSearchTarget.Exact,
    notes,
  });

  const groupByAttributes: Array<string> = [];
  const groupsLeftOut: Array<string> = [];

  for (const facet of query.groupBy) {
    const target: DatadogLogFieldTarget = readDatadogLogField(
      facet.replace(/^@/, ""),
    );

    if (target.field === DatadogLogField.Attribute && target.attributeKey) {
      if (!groupByAttributes.includes(target.attributeKey)) {
        groupByAttributes.push(target.attributeKey);
      }
      continue;
    }

    groupsLeftOut.push(facet);
  }

  if (groupsLeftOut.length > 0) {
    notes.push({
      kind: ImportNoteKind.Approximation,
      text: LOG_GROUPS_LEFT_OUT,
      values: { facets: groupsLeftOut.join(", ") },
    });
  }

  noteIndexes(query.indexes, notes);

  return {
    status: ImportStatusUtil.fromNotes(notes),
    notes,
    logQuery: {
      attributes: filters.attributes,
      bodyContains: filters.bodyContains || "",
      severityTexts: filters.severities || [],
      groupByAttributes,
      searchText: filters.searchText,
    },
  };
};

// Datadog's comparisons, as a count's conditions.
export const LOG_MONITOR_COMPARISONS: ReadonlyMap<string, FilterType> = new Map<
  string,
  FilterType
>([
  [">", FilterType.GreaterThan],
  [">=", FilterType.GreaterThanOrEqualTo],
  ["<", FilterType.LessThan],
  ["<=", FilterType.LessThanOrEqualTo],
  ["==", FilterType.EqualTo],
  ["=", FilterType.EqualTo],
]);
