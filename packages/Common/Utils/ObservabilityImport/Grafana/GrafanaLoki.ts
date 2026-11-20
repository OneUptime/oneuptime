import {
  ImportItemStatus,
  ImportNote,
  ImportNoteKind,
  ImportStatusUtil,
} from "../../../Types/ObservabilityImport/ObservabilityImport";
import { translationKey } from "../../../Types/Translator";
import { escapeWildcards } from "../../../Types/BaseDatabase/WildcardPattern";
import {
  LogQLLineFilterOperator,
  LogQLLogSelector,
  LogQLQuery,
  LogQLRangeAggregation,
  LogQLRangeOperation,
  LogQLStage,
} from "../../LogQL/LogQLAst";
import { parseLogQL } from "../../LogQL/LogQLParser";
import {
  PromQLAggregateOperator,
  PromQLExpression,
  PromQLLabelMatcher,
  PromQLMatchType,
  PromQLNodeKind,
} from "../../PromQL/PromQLAst";

/*
 * A GRAFANA PANEL OVER LOKI, AS A ONEUPTIME LOG WIDGET (issue #7697).
 *
 * Logs sent to OneUptime's Loki push keep their stream's labels as
 * attributes under the names they have in Loki, so a LogQL selector's
 * labels are a log widget's attribute filters:
 *
 *   {app="checkout"}           @app:checkout
 *   {app!="checkout"}          -@app:checkout
 *   {app=~"a|b"}               @app:(a OR b)
 *   {app=~"check.*"}           @app:check*
 *   |= "error"                 the widget's "body contains"
 *
 * A logs panel becomes a Log Stream, and a panel charting
 * sum(count_over_time(<selector>[...])) a Log Chart, which counts the
 * matching logs. What a log widget cannot filter on - a regex, a line
 * filter after the first, a parser and its label filters - is left out,
 * and said. A selector's label bound to a dashboard variable is filtered
 * by the variable itself, as every log widget is.
 */

export const LOGQL_DOES_NOT_PARSE: string = translationKey(
  "OneUptime's LogQL does not read this query: {{error}}",
);

export const LOGQL_MATCHER_LEFT_OUT: string = translationKey(
  "The filter {{matcher}} is left out: a log widget filters labels by their exact values and simple patterns.",
);

export const LOGQL_LINE_FILTER_LEFT_OUT: string = translationKey(
  "The line filter {{filter}} is left out: a log widget finds one piece of text in a log.",
);

export const LOGQL_PIPELINE_LEFT_OUT: string = translationKey(
  "The query's {{stage}} stage is left out: a log widget filters on labels and text only.",
);

export const LOGQL_VARIABLE_LINE_FILTER: string = translationKey(
  "The line filter reads a variable, which a log widget cannot: it is left out.",
);

export const LOGQL_RATE_AS_COUNT: string = translationKey(
  "A Log Chart counts the logs in each interval; Grafana charted them per second.",
);

export const LOGQL_GROUPING_LEFT_OUT: string = translationKey(
  "A Log Chart counts the matching logs together; Grafana split them by {{labels}}.",
);

export const LOGQL_METRIC_NOT_COUNT: string = translationKey(
  "The query is not a count of logs, which is what a Log Chart draws.",
);

export const LOGQL_VARIABLES_EVERYWHERE: string = translationKey(
  "A log widget is narrowed by every attribute variable of the dashboard, not only those its query names.",
);

export interface LogWidgetFilters {
  bodyContains?: string | undefined;
  // In the log search's words: "@app:checkout -@env:dev".
  attributeFilterQuery: string;
  // The same exact matches, as a Log Chart stores them.
  attributeFilters: Record<string, string>;
}

export interface ConvertedLokiQuery {
  status: ImportItemStatus;
  notes: Array<ImportNote>;
  filters?: LogWidgetFilters | undefined;
}

// A placeholder a variable stands as while the query is parsed.
const VARIABLE_PLACEHOLDER_PREFIX: string = "__oneuptime_variable_";

const LOKI_VARIABLE_REFERENCE: RegExp =
  /\$\{([A-Za-z0-9_]+)(?::[A-Za-z0-9_]+)?\}|\[\[([A-Za-z0-9_]+)(?::[A-Za-z0-9_]+)?\]\]|\$([A-Za-z_][A-Za-z0-9_]*)/g;

// A value the log search reads as written: wildcards and quotes set apart.
const searchValue: (value: string) => string | undefined = (
  value: string,
): string | undefined => {
  if (value.includes('"')) {
    return undefined;
  }

  const escaped: string = escapeWildcards(value);
  return /[\s()[\],]/.test(escaped) || escaped === "" ? `"${escaped}"` : escaped;
};

// A label name as the log search names an attribute.
const searchKey: (label: string) => string | undefined = (
  label: string,
): string | undefined => {
  return /^[A-Za-z0-9_.-]+$/.test(label) ? label : undefined;
};

const LITERAL_ALTERNATION: RegExp = /^[A-Za-z0-9_.:/@ -]+(\|[A-Za-z0-9_.:/@ -]+)*$/;

const matcherText: (matcher: PromQLLabelMatcher) => string = (
  matcher: PromQLLabelMatcher,
): string => {
  return `${matcher.name}${matcher.type}"${matcher.value}"`;
};

const variableOf: (value: string) => string | undefined = (
  value: string,
): string | undefined => {
  return value.startsWith(VARIABLE_PLACEHOLDER_PREFIX)
    ? value.slice(VARIABLE_PLACEHOLDER_PREFIX.length)
    : undefined;
};

/*
 * One matcher in the log search's words, or undefined when it has none:
 * an exact value, its negation, a list of exact values, or a prefix.
 */
const matcherToSearch: (matcher: PromQLLabelMatcher) => string | undefined = (
  matcher: PromQLLabelMatcher,
): string | undefined => {
  const key: string | undefined = searchKey(matcher.name);

  if (!key) {
    return undefined;
  }

  const negate: string =
    matcher.type === PromQLMatchType.NotEqual ||
    matcher.type === PromQLMatchType.RegexNoMatch
      ? "-"
      : "";

  if (
    matcher.type === PromQLMatchType.Equal ||
    matcher.type === PromQLMatchType.NotEqual
  ) {
    const value: string | undefined = searchValue(matcher.value);
    return value === undefined ? undefined : `${negate}@${key}:${value}`;
  }

  const pattern: string = matcher.value;

  // A prefix: "check.*".
  if (/^[A-Za-z0-9_:/@-]+\.\*$/.test(pattern)) {
    return `${negate}@${key}:${escapeWildcards(pattern.slice(0, -2))}*`;
  }

  // A list of exact values: "a|b|c".
  if (LITERAL_ALTERNATION.test(pattern) && !pattern.includes(".")) {
    const values: Array<string> = pattern.split("|");
    const written: Array<string | undefined> = values.map(searchValue);

    if (written.some((value: string | undefined): boolean => !value)) {
      return undefined;
    }

    return values.length === 1
      ? `${negate}@${key}:${written[0]}`
      : `${negate}@${key}:(${written.join(" OR ")})`;
  }

  return undefined;
};

/*
 * A Loki query with its variables as placeholders, so it parses: the
 * names of the variables it reads, kept to tell the matchers they bind.
 */
const withVariablePlaceholders: (expr: string) => string = (
  expr: string,
): string => {
  return expr.replace(
    LOKI_VARIABLE_REFERENCE,
    (
      _match: string,
      braced: string | undefined,
      bracket: string | undefined,
      bare: string | undefined,
    ): string => {
      const name: string = braced || bracket || bare || "";

      if (name.startsWith("__")) {
        // $__interval, $__auto, $__range: a range the parser reads as 1m.
        return "1m";
      }

      return `${VARIABLE_PLACEHOLDER_PREFIX}${name}`;
    },
  );
};

/*
 * A selector's matchers and stages as a log widget's filters. A Log Chart
 * filters on exact values only (`exactOnly`): its other matchers are left
 * out, and said.
 */
const selectorToFilters: (data: {
  selector: LogQLLogSelector;
  variableKeys: ReadonlyMap<string, string>;
  notes: Array<ImportNote>;
  exactOnly?: boolean | undefined;
}) => LogWidgetFilters = (data: {
  selector: LogQLLogSelector;
  variableKeys: ReadonlyMap<string, string>;
  notes: Array<ImportNote>;
  exactOnly?: boolean | undefined;
}): LogWidgetFilters => {
  const searches: Array<string> = [];
  const attributeFilters: Record<string, string> = {};
  let readsVariable: boolean = false;

  for (const matcher of data.selector.matchers) {
    const variable: string | undefined = variableOf(matcher.value);

    if (variable !== undefined) {
      readsVariable = true;

      // Bound to the variable that filters on this label: the variable filters it.
      if (
        matcher.type === PromQLMatchType.Equal ||
        matcher.type === PromQLMatchType.RegexMatch
      ) {
        if (data.variableKeys.get(variable) === matcher.name) {
          continue;
        }
      }

      data.notes.push({
        kind: ImportNoteKind.Approximation,
        text: LOGQL_MATCHER_LEFT_OUT,
        values: { matcher: `${matcher.name}${matcher.type}"$${variable}"` },
      });
      continue;
    }

    const search: string | undefined =
      data.exactOnly && matcher.type !== PromQLMatchType.Equal
        ? undefined
        : matcherToSearch(matcher);

    if (!search) {
      data.notes.push({
        kind: ImportNoteKind.Approximation,
        text: LOGQL_MATCHER_LEFT_OUT,
        values: { matcher: matcherText(matcher) },
      });
      continue;
    }

    searches.push(search);

    if (matcher.type === PromQLMatchType.Equal) {
      attributeFilters[matcher.name] = matcher.value;
    }
  }

  let bodyContains: string | undefined = undefined;

  for (const stage of data.selector.stages) {
    if (stage.kind === "LineFilter") {
      const isFirstContains: boolean =
        bodyContains === undefined &&
        stage.operator === LogQLLineFilterOperator.Contains &&
        stage.values.length === 1;

      if (isFirstContains) {
        const value: string = stage.values[0] || "";

        if (variableOf(value) !== undefined) {
          data.notes.push({
            kind: ImportNoteKind.Approximation,
            text: LOGQL_VARIABLE_LINE_FILTER,
          });
          continue;
        }

        bodyContains = value;
        continue;
      }

      data.notes.push({
        kind: ImportNoteKind.Approximation,
        text: LOGQL_LINE_FILTER_LEFT_OUT,
        values: {
          filter: `${stage.operator} ${stage.values
            .map((value: string): string => {
              return `"${value}"`;
            })
            .join(" or ")}`,
        },
      });
      continue;
    }

    if (stage.kind === "Decolorize") {
      continue;
    }

    data.notes.push({
      kind: ImportNoteKind.Approximation,
      text: LOGQL_PIPELINE_LEFT_OUT,
      values: { stage: stageName(stage) },
    });
  }

  if (readsVariable || data.variableKeys.size > 0) {
    data.notes.push({ kind: ImportNoteKind.Info, text: LOGQL_VARIABLES_EVERYWHERE });
  }

  return {
    bodyContains,
    attributeFilterQuery: searches.join(" "),
    attributeFilters,
  };
};

const stageName: (stage: LogQLStage) => string = (stage: LogQLStage): string => {
  switch (stage.kind) {
    case "Parser":
      return `| ${stage.parser}`;
    case "LabelFilter":
      return "label filter";
    case "LineFormat":
      return "| line_format";
    case "Drop":
      return "| drop";
    case "Keep":
      return "| keep";
    default:
      return stage.kind;
  }
};

const parse: (
  expr: string,
) => { query: LogQLQuery } | { problem: ImportNote } = (
  expr: string,
): { query: LogQLQuery } | { problem: ImportNote } => {
  try {
    return { query: parseLogQL(withVariablePlaceholders(expr)) };
  } catch (error) {
    return {
      problem: {
        kind: ImportNoteKind.Reason,
        text: LOGQL_DOES_NOT_PARSE,
        values: {
          error: error instanceof Error ? error.message : String(error),
        },
      },
    };
  }
};

/*
 * A logs panel's query as a Log Stream's filters. `variableKeys` names the
 * attribute each dashboard variable filters on, by the variable's name.
 */
export const convertLokiLogQuery: (data: {
  expr: string;
  variableKeys: ReadonlyMap<string, string>;
}) => ConvertedLokiQuery = (data: {
  expr: string;
  variableKeys: ReadonlyMap<string, string>;
}): ConvertedLokiQuery => {
  const parsed: { query: LogQLQuery } | { problem: ImportNote } = parse(
    data.expr,
  );

  if ("problem" in parsed) {
    return { status: ImportItemStatus.NotConverted, notes: [parsed.problem] };
  }

  if (parsed.query.kind !== "LogQuery") {
    return {
      status: ImportItemStatus.NotConverted,
      notes: [{ kind: ImportNoteKind.Reason, text: LOGQL_METRIC_NOT_COUNT }],
    };
  }

  const notes: Array<ImportNote> = [];
  const filters: LogWidgetFilters = selectorToFilters({
    selector: parsed.query.selector,
    variableKeys: data.variableKeys,
    notes,
  });

  return { status: ImportStatusUtil.fromNotes(notes), notes, filters };
};

/*
 * The range aggregation a metric query counts with, when the query is
 * that count alone or summed: count_over_time(...), sum(count_over_time
 * (...)), sum by (level) (rate(...)).
 */
const countedRange: (
  expression: PromQLExpression,
  range: LogQLRangeAggregation,
) => { grouping: Array<string> } | undefined = (
  expression: PromQLExpression,
  range: LogQLRangeAggregation,
): { grouping: Array<string> } | undefined => {
  let node: PromQLExpression = expression;

  while (node.kind === PromQLNodeKind.Paren) {
    node = node.expression;
  }

  const isRange: (candidate: PromQLExpression) => boolean = (
    candidate: PromQLExpression,
  ): boolean => {
    return (
      candidate.kind === PromQLNodeKind.VectorSelector &&
      candidate.name === range.seriesName
    );
  };

  if (isRange(node)) {
    return { grouping: [] };
  }

  if (
    node.kind === PromQLNodeKind.Aggregate &&
    node.operator === PromQLAggregateOperator.Sum
  ) {
    let inner: PromQLExpression = node.expression;

    while (inner.kind === PromQLNodeKind.Paren) {
      inner = inner.expression;
    }

    if (isRange(inner)) {
      return { grouping: node.without ? [] : node.grouping };
    }
  }

  return undefined;
};

// A panel charting a count of logs, as a Log Chart's filters.
export const convertLokiCountQuery: (data: {
  expr: string;
  variableKeys: ReadonlyMap<string, string>;
}) => ConvertedLokiQuery = (data: {
  expr: string;
  variableKeys: ReadonlyMap<string, string>;
}): ConvertedLokiQuery => {
  const parsed: { query: LogQLQuery } | { problem: ImportNote } = parse(
    data.expr,
  );

  if ("problem" in parsed) {
    return { status: ImportItemStatus.NotConverted, notes: [parsed.problem] };
  }

  const query: LogQLQuery = parsed.query;

  if (query.kind !== "MetricQuery" || query.ranges.length !== 1) {
    return {
      status: ImportItemStatus.NotConverted,
      notes: [{ kind: ImportNoteKind.Reason, text: LOGQL_METRIC_NOT_COUNT }],
    };
  }

  const range: LogQLRangeAggregation = query.ranges[0]!;
  const counted: { grouping: Array<string> } | undefined = countedRange(
    query.expression,
    range,
  );

  if (
    !counted ||
    (range.operation !== LogQLRangeOperation.CountOverTime &&
      range.operation !== LogQLRangeOperation.Rate) ||
    range.unwrap
  ) {
    return {
      status: ImportItemStatus.NotConverted,
      notes: [{ kind: ImportNoteKind.Reason, text: LOGQL_METRIC_NOT_COUNT }],
    };
  }

  const notes: Array<ImportNote> = [];

  if (range.operation === LogQLRangeOperation.Rate) {
    notes.push({ kind: ImportNoteKind.Approximation, text: LOGQL_RATE_AS_COUNT });
  }

  if (counted.grouping.length > 0) {
    notes.push({
      kind: ImportNoteKind.Approximation,
      text: LOGQL_GROUPING_LEFT_OUT,
      values: { labels: counted.grouping.join(", ") },
    });
  }

  const filters: LogWidgetFilters = selectorToFilters({
    selector: range.selector,
    variableKeys: data.variableKeys,
    notes,
    exactOnly: true,
  });

  return { status: ImportStatusUtil.fromNotes(notes), notes, filters };
};

// Whether a query reads as LogQL rather than PromQL: it starts at a stream.
export const looksLikeLogQL: (expr: string) => boolean = (
  expr: string,
): boolean => {
  const text: string = (expr || "").trim();

  return (
    /^\{[^}]*\}/.test(text) ||
    /\(\s*\{[^}]*\}[^)]*\[/.test(text) ||
    /\|[=~]\s*["`]/.test(text)
  );
};
