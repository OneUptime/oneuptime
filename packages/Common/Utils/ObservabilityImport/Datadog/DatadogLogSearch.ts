import { escapeWildcards } from "../../../Types/BaseDatabase/WildcardPattern";
import LogSeverity from "../../../Types/Log/LogSeverity";
import {
  ImportNote,
  ImportNoteKind,
} from "../../../Types/ObservabilityImport/ObservabilityImport";
import {
  buildSearchTokenComparison,
  buildSearchTokenGlob,
  buildSearchTokenValue,
  searchTokenListEntry,
  SearchTokenComparisonOperator,
} from "../../../Types/Telemetry/TelemetrySearchQuery";
import { translationKey } from "../../../Types/Translator";
import {
  DATADOG_KEYLESS_TAGS_ATTRIBUTE,
  DatadogLogField,
  DatadogLogFieldTarget,
  readDatadogLogField,
} from "./DatadogAttributes";
import { DATADOG_VARIABLE_WITHOUT_PREFIX } from "./DatadogPromQL";

/*
 * A DATADOG LOG SEARCH, AS ONEUPTIME'S LOG FILTERS (issue #10324).
 *
 * Datadog's log search (docs.datadoghq.com/logs/explorer/search_syntax):
 *
 *   service:checkout status:error @http.status_code:(500 OR 503)
 *     -env:dev "connection refused" @duration:>1000
 *
 * terms joined by AND (the default), OR and NOT or `-`, in parentheses;
 * free text and "quoted sequences", which search the message; reserved
 * attributes (host, service, status, source, trace_id, message) and tags as
 * key:value; any other attribute as @key:value; a value with `*` and `?`
 * wildcards (none inside quotes), a list (a OR b), a comparison (>10) or an
 * inclusive range [10 TO 20]; a dashboard's template variable as $name.
 *
 * OneUptime keeps a Datadog log as DatadogAttributes says: a tag or an
 * attribute under its own name, the host, the service and the source under
 * the resource's and the intake's names, the status as the severity, the
 * message as the body. So each term becomes:
 *
 *   status:error              the severity Error
 *   service:checkout          @resource.service.name:checkout
 *   host:web-*                @resource.host.name:web-*
 *   source:nginx              @datadog.source:nginx
 *   env:prod, @http.method:GET  @env:prod, @http.method:GET
 *   "connection refused"      the text the body contains
 *
 * for what each place reads:
 *
 *   - a Log Stream: one severity, one text, and attributes in the log
 *     search's own words, which read wildcards, lists, negation and
 *     comparisons as Datadog does (its attributeFilterQuery);
 *   - a Log Chart and a Logs monitor: severities, one text, and attributes
 *     by exact value only (exactOnly).
 *
 * What a place cannot read is left out, and said: an OR across different
 * terms, a NOT before a group, a second text, a negated text, a search on
 * every attribute (*:term), the trace a log belongs to. A variable with a
 * prefix narrows every log widget by itself (DashboardVariableInterpolation),
 * so its term is left to it; one without a prefix takes a whole tag, which
 * nothing narrows, as Datadog reads `*`.
 */

export const LOG_TERM_LEFT_OUT: string = translationKey(
  "The search term {{term}} is left out: OneUptime has no filter like it.",
);

export const LOG_TERM_NOT_EXACT: string = translationKey(
  "The search term {{term}} is left out: this filters on exact values only.",
);

export const LOG_TEXT_LEFT_OUT: string = translationKey(
  "The search text {{text}} is left out: OneUptime looks for one piece of text in a log.",
);

export const LOG_STATUSES_SHARED: string = translationKey(
  "OneUptime keeps Datadog's alert, critical and error logs at one severity, and its ok, info and notice logs at another: a search for one of them finds them all.",
);

export const LOG_ONE_SEVERITY: string = translationKey(
  "A Log Stream filters on one severity, so the search's severities are left out.",
);

// Where the filters go, which decides what they can say.
export enum DatadogLogSearchTarget {
  // A Log Stream: attributes in the log search's own words.
  Stream = "Stream",
  // A Log Chart or a Logs monitor: exact attribute values.
  Exact = "Exact",
}

export interface DatadogLogFilters {
  // Attribute filters in the log search's words: a Log Stream's.
  attributeQuery: string;
  // Exact attribute values: a Log Chart's and a Logs monitor's.
  attributes: Record<string, string>;
  // The text a log's body contains.
  bodyContains?: string | undefined;
  // The severities it matches; undefined matches any.
  severities?: Array<LogSeverity> | undefined;
  // The same filters in the log search's words, for the preview.
  searchText: string;
}

/*
 * Datadog's statuses (its status remapper's words) as the severity the
 * intake keeps each at (DatadogIntake: syslog's severities, critical and
 * alert at ERROR2 and ERROR3, notice at INFO2). Datadog reads a log sent as
 * trace at debug, which OneUptime keeps at Trace, so debug is both.
 */
const STATUS_SEVERITIES: ReadonlyMap<string, Array<LogSeverity>> = new Map<
  string,
  Array<LogSeverity>
>([
  ["emergency", [LogSeverity.Fatal]],
  ["emerg", [LogSeverity.Fatal]],
  ["alert", [LogSeverity.Error]],
  ["critical", [LogSeverity.Error]],
  ["crit", [LogSeverity.Error]],
  ["error", [LogSeverity.Error]],
  ["err", [LogSeverity.Error]],
  ["warning", [LogSeverity.Warning]],
  ["warn", [LogSeverity.Warning]],
  ["notice", [LogSeverity.Information]],
  ["info", [LogSeverity.Information]],
  ["informational", [LogSeverity.Information]],
  ["ok", [LogSeverity.Information]],
  ["success", [LogSeverity.Information]],
  ["debug", [LogSeverity.Debug, LogSeverity.Trace]],
  ["trace", [LogSeverity.Trace]],
]);

// The Datadog statuses OneUptime keeps together, under one severity.
const SHARED_STATUSES: ReadonlyArray<ReadonlyArray<string>> = [
  ["alert", "critical", "error"],
  ["notice", "info", "ok"],
];

// The keys a term may name: a facet's path, a tag's key.
const TERM_KEY: RegExp = /^@?[A-Za-z0-9_.\-/]+$/;
const BOOLEAN_KEYWORDS: ReadonlySet<string> = new Set<string>([
  "AND",
  "OR",
  "NOT",
]);
const COMPARISON: RegExp = /^(>=|<=|>|<)(.+)$/;
const RANGE: RegExp = /^([[{])\s*(\S+)\s+TO\s+(\S+)\s*([\]}])$/;
const WHITE_SPACE: RegExp = /\s/;
// A word that opens a group or a list: (, [ or {.
const OPENS_A_GROUP: RegExp = /^[([{]/;
// A function's call, such as CIDR(@network.client.ip, 10.0.0.0/8).
const FUNCTION_CALL_START: RegExp = /^[A-Za-z_]+\(/;
// A `*` or `?` no backslash escapes.
const UNESCAPED_WILDCARD: RegExp = /(^|[^\\])[*?]/;

export type DatadogLogValue =
  | { kind: "Exact"; value: string; quoted: boolean }
  | { kind: "Any"; values: Array<{ value: string; quoted: boolean }> }
  | {
      kind: "Compare";
      operator: SearchTokenComparisonOperator;
      value: string;
    }
  | {
      kind: "Range";
      from: string;
      to: string;
      fromInclusive: boolean;
      toInclusive: boolean;
    };

export type DatadogLogTerm =
  | {
      kind: "Text";
      text: string;
      quoted: boolean;
      negated: boolean;
      raw: string;
    }
  | {
      kind: "Field";
      key: string;
      value: DatadogLogValue;
      negated: boolean;
      raw: string;
    }
  | {
      kind: "Variable";
      name: string;
      key: string | undefined;
      negated: boolean;
      raw: string;
    }
  // What no OneUptime filter reads, as written.
  | { kind: "Unsupported"; raw: string };

/*
 * The search cut into its top-level words: white space ends a word outside
 * quotes, brackets and an escape, so `@k:(a OR b)`, `"a b"` and `[1 TO 9]`
 * are one word each.
 */
const splitWords: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  const words: Array<string> = [];
  let current: string = "";
  let inQuotes: boolean = false;
  let depth: number = 0;

  for (let index: number = 0; index < text.length; index++) {
    const char: string = text.charAt(index);

    if (char === "\\" && index + 1 < text.length) {
      current += char + text.charAt(index + 1);
      index++;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }

    if (!inQuotes && (char === "(" || char === "[" || char === "{")) {
      depth++;
    } else if (!inQuotes && (char === ")" || char === "]" || char === "}")) {
      depth = Math.max(0, depth - 1);
    }

    if (WHITE_SPACE.test(char) && !inQuotes && depth === 0) {
      if (current) {
        words.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    words.push(current);
  }

  return words;
};

// A quoted value's text, its escapes undone; the value as written otherwise.
const unquote: (value: string) => { value: string; quoted: boolean } = (
  value: string,
): { value: string; quoted: boolean } => {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return {
      value: value.slice(1, -1).replace(/\\(.)/g, "$1"),
      quoted: true,
    };
  }

  return { value, quoted: false };
};

// A term's value: a list, a range, a comparison, or one value.
const readValue: (text: string) => DatadogLogValue | undefined = (
  text: string,
): DatadogLogValue | undefined => {
  if (text.startsWith("(") && text.endsWith(")")) {
    const inner: Array<string> = splitWords(text.slice(1, -1));
    const values: Array<{ value: string; quoted: boolean }> = [];

    for (let index: number = 0; index < inner.length; index++) {
      const word: string = inner[index]!;

      if (index % 2 === 1) {
        // Between values: OR alone. AND, NOT or a nested list is no list.
        if (word !== "OR") {
          return undefined;
        }
        continue;
      }

      if (BOOLEAN_KEYWORDS.has(word) || OPENS_A_GROUP.test(word)) {
        return undefined;
      }

      values.push(unquote(word));
    }

    return values.length > 0 && inner.length % 2 === 1
      ? { kind: "Any", values }
      : undefined;
  }

  const range: RegExpMatchArray | null = text.match(RANGE);

  if (range) {
    return {
      kind: "Range",
      from: range[2] || "",
      to: range[3] || "",
      fromInclusive: range[1] === "[",
      toInclusive: range[4] === "]",
    };
  }

  const comparison: RegExpMatchArray | null = text.match(COMPARISON);

  if (comparison) {
    return {
      kind: "Compare",
      operator: comparison[1] as SearchTokenComparisonOperator,
      value: unquote(comparison[2] || "").value,
    };
  }

  if (!text || OPENS_A_GROUP.test(text)) {
    return undefined;
  }

  return { kind: "Exact", ...unquote(text) };
};

// One word of the search as a term.
const readTerm: (word: string) => DatadogLogTerm = (
  word: string,
): DatadogLogTerm => {
  let text: string = word;
  let negated: boolean = false;

  if (text.length > 1 && text.startsWith("-")) {
    negated = true;
    text = text.slice(1);
  }

  if (text.startsWith('"')) {
    const read: { value: string; quoted: boolean } = unquote(text);
    return read.quoted
      ? { kind: "Text", text: read.value, quoted: true, negated, raw: word }
      : { kind: "Unsupported", raw: word };
  }

  // A group of terms: what it combines no filter of OneUptime does.
  if (text.startsWith("(")) {
    return { kind: "Unsupported", raw: word };
  }

  // $host, $host.value: a template variable that takes a whole tag or its value.
  if (text.startsWith("$")) {
    return {
      kind: "Variable",
      name: text.slice(1).replace(/\.value$/, ""),
      key: undefined,
      negated,
      raw: word,
    };
  }

  // A key and its value, at the first colon that is not escaped.
  const colon: number = text.search(/(?<!\\):/);

  if (colon > 0) {
    const key: string = text.slice(0, colon);
    const rest: string = text.slice(colon + 1);

    // *:term searches every attribute, which no OneUptime filter does.
    if (!TERM_KEY.test(key) || key === "*") {
      return { kind: "Unsupported", raw: word };
    }

    if (rest.startsWith("$")) {
      return {
        kind: "Variable",
        name: rest.slice(1).replace(/\.value$/, ""),
        key: key.replace(/^@/, ""),
        negated,
        raw: word,
      };
    }

    const value: DatadogLogValue | undefined = readValue(rest);

    if (!value) {
      return { kind: "Unsupported", raw: word };
    }

    return { kind: "Field", key, value, negated, raw: word };
  }

  // A function such as CIDR(@network.client.ip, 10.0.0.0/8), a calculated field.
  if (FUNCTION_CALL_START.test(text) || text.startsWith("#")) {
    return { kind: "Unsupported", raw: word };
  }

  return { kind: "Text", text, quoted: false, negated, raw: word };
};

/*
 * The search's terms, all of which a log must match. Words OR joins, and
 * a NOT before a group, are one term of what no filter reads, as written.
 */
export const parseDatadogLogSearch: (query: string) => Array<DatadogLogTerm> = (
  query: string,
): Array<DatadogLogTerm> => {
  const words: Array<string> = splitWords((query || "").trim());
  const terms: Array<DatadogLogTerm> = [];
  let negateNext: boolean = false;

  for (let index: number = 0; index < words.length; index++) {
    const word: string = words[index]!;

    if (word === "AND") {
      continue;
    }

    if (word === "NOT") {
      negateNext = !negateNext;
      continue;
    }

    if (word === "OR") {
      const previous: DatadogLogTerm | undefined = terms.pop();
      const next: string = words[index + 1] || "";
      index++;
      terms.push({
        kind: "Unsupported",
        raw: [previous ? previous.raw : "", "OR", next]
          .filter((part: string): boolean => {
            return part.length > 0;
          })
          .join(" "),
      });
      negateNext = false;
      continue;
    }

    // `*` alone matches every log.
    if (word === "*") {
      continue;
    }

    const term: DatadogLogTerm = readTerm(word);

    if (negateNext) {
      negateNext = false;

      if (term.kind === "Unsupported") {
        terms.push({ kind: "Unsupported", raw: `NOT ${term.raw}` });
        continue;
      }

      terms.push({
        ...term,
        negated: !term.negated,
        raw: `NOT ${term.raw}`,
      });
      continue;
    }

    terms.push(term);
  }

  return terms;
};

// Whether a value holds a wildcard Datadog reads: `*` or `?`, not escaped.
const hasDatadogWildcard: (value: string) => boolean = (
  value: string,
): boolean => {
  return UNESCAPED_WILDCARD.test(value);
};

// A value's literal text: its escapes undone.
const literalOf: (value: string) => string = (value: string): string => {
  return value.replace(/\\(.)/g, "$1");
};

// One value of a list or a term in the log search's words.
const searchValueOf: (value: {
  value: string;
  quoted: boolean;
}) => string = (value: { value: string; quoted: boolean }): string => {
  return value.quoted || !hasDatadogWildcard(value.value)
    ? buildSearchTokenValue(value.quoted ? value.value : literalOf(value.value))
    : buildSearchTokenGlob(value.value);
};

/*
 * A term on an attribute as the log search's tokens, or undefined when the
 * log search cannot say it.
 */
const attributeSearchTokens: (data: {
  key: string;
  value: DatadogLogValue;
  negated: boolean;
}) => Array<string> | undefined = (data: {
  key: string;
  value: DatadogLogValue;
  negated: boolean;
}): Array<string> | undefined => {
  const prefix: string = `${data.negated ? "-" : ""}@${data.key}:`;
  const value: DatadogLogValue = data.value;

  switch (value.kind) {
    case "Exact":
      return [`${prefix}${searchValueOf(value)}`];
    case "Any":
      return [
        `${prefix}(${value.values
          .map((item: { value: string; quoted: boolean }): string => {
            return searchTokenListEntry(searchValueOf(item));
          })
          .join(" OR ")})`,
      ];
    case "Compare": {
      const token: string | null = buildSearchTokenComparison(
        value.operator,
        value.value,
      );
      return token ? [`${prefix}${token}`] : undefined;
    }
    case "Range": {
      // NOT (a TO b) is "below a OR above b": no AND of two tokens says it.
      if (data.negated) {
        return undefined;
      }

      const from: string | null =
        value.from === "*"
          ? ""
          : buildSearchTokenComparison(
              value.fromInclusive ? ">=" : ">",
              value.from,
            );
      const to: string | null =
        value.to === "*"
          ? ""
          : buildSearchTokenComparison(
              value.toInclusive ? "<=" : "<",
              value.to,
            );

      if (from === null || to === null) {
        return undefined;
      }

      return [from, to]
        .filter((token: string): boolean => {
          return token.length > 0;
        })
        .map((token: string): string => {
          return `${prefix}${token}`;
        });
    }
    default:
      return undefined;
  }
};

/*
 * `tags:canary` as the log search finds a keyless tag among the others it
 * was sent with, kept comma-joined (DatadogIntake): alone, first, last or
 * between two - never inside another tag's name.
 */
const keylessTagTokens: (data: {
  value: DatadogLogValue;
  negated: boolean;
}) => Array<string> | undefined = (data: {
  value: DatadogLogValue;
  negated: boolean;
}): Array<string> | undefined => {
  if (data.value.kind !== "Exact") {
    return undefined;
  }

  const glob: string = data.value.quoted
    ? escapeWildcards(data.value.value)
    : data.value.value;

  const placings: Array<string> = [
    glob,
    `${glob},*`,
    `*,${glob}`,
    `*,${glob},*`,
  ].map((placing: string): string => {
    return searchTokenListEntry(buildSearchTokenGlob(placing));
  });

  return [
    `${data.negated ? "-" : ""}@${DATADOG_KEYLESS_TAGS_ATTRIBUTE}:(${placings.join(" OR ")})`,
  ];
};

// The severities a status term names, and the Datadog statuses it names.
const readStatuses: (
  value: DatadogLogValue,
) => { statuses: Array<string>; severities: Array<LogSeverity> } | undefined = (
  value: DatadogLogValue,
): { statuses: Array<string>; severities: Array<LogSeverity> } | undefined => {
  const words: Array<string> =
    value.kind === "Exact"
      ? [value.value]
      : value.kind === "Any"
        ? value.values.map((item: { value: string }): string => {
            return item.value;
          })
        : [];

  if (words.length === 0) {
    return undefined;
  }

  const severities: Set<LogSeverity> = new Set<LogSeverity>();
  const statuses: Array<string> = [];

  for (const word of words) {
    const status: string = literalOf(word).toLowerCase();
    const mapped: Array<LogSeverity> | undefined =
      STATUS_SEVERITIES.get(status);

    if (!mapped) {
      return undefined;
    }

    statuses.push(status);

    for (const severity of mapped) {
      severities.add(severity);
    }
  }

  return { statuses, severities: Array.from(severities) };
};

/*
 * Whether the statuses named are all of those OneUptime keeps at their
 * severities: `error` alone also finds Datadog's critical and alert logs,
 * `alert OR critical OR error` finds just what it names.
 */
const namesEveryStatusOfItsSeverities: (statuses: Array<string>) => boolean = (
  statuses: Array<string>,
): boolean => {
  const named: Set<string> = new Set<string>(statuses.map(canonicalStatus));

  return SHARED_STATUSES.every((group: ReadonlyArray<string>): boolean => {
    return (
      group.every((status: string): boolean => {
        return named.has(status);
      }) ||
      !group.some((status: string): boolean => {
        return named.has(status);
      })
    );
  });
};

// A status spelled as Datadog names it in its list: crit as critical.
const canonicalStatus: (status: string) => string = (
  status: string,
): string => {
  switch (status) {
    case "crit":
      return "critical";
    case "err":
      return "error";
    case "emerg":
      return "emergency";
    case "warn":
      return "warning";
    case "informational":
      return "info";
    case "success":
      return "ok";
    default:
      return status;
  }
};

const ALL_SEVERITIES: ReadonlyArray<LogSeverity> = Object.values(LogSeverity);

/*
 * A Datadog log search as the filters a log widget or a Logs monitor reads,
 * what each cannot read left out and said in `notes`. `variablePrefixes`
 * names the tag each dashboard variable filters (none for a monitor).
 */
export const convertDatadogLogSearch: (data: {
  query: string;
  target: DatadogLogSearchTarget;
  notes: Array<ImportNote>;
  variablePrefixes?: ReadonlyMap<string, string> | undefined;
}) => DatadogLogFilters = (data: {
  query: string;
  target: DatadogLogSearchTarget;
  notes: Array<ImportNote>;
  variablePrefixes?: ReadonlyMap<string, string> | undefined;
}): DatadogLogFilters => {
  const isExact: boolean = data.target === DatadogLogSearchTarget.Exact;
  const searchTokens: Array<string> = [];
  const attributes: Record<string, string> = {};
  let bodyContains: string | undefined = undefined;
  let severities: Set<LogSeverity> | undefined = undefined;
  let sharesStatuses: boolean = false;

  const leaveOut: (text: string, term: string) => void = (
    text: string,
    term: string,
  ): void => {
    data.notes.push({
      kind: ImportNoteKind.Approximation,
      text,
      values: text === LOG_TEXT_LEFT_OUT ? { text: term } : { term },
    });
  };

  const narrowSeverities: (next: Array<LogSeverity>) => void = (
    next: Array<LogSeverity>,
  ): void => {
    severities = severities
      ? new Set<LogSeverity>(
          next.filter((severity: LogSeverity): boolean => {
            return Boolean(severities?.has(severity));
          }),
        )
      : new Set<LogSeverity>(next);
  };

  const addText: (text: string, raw: string) => void = (
    text: string,
    raw: string,
  ): void => {
    if (bodyContains === undefined) {
      bodyContains = text;
      return;
    }

    leaveOut(LOG_TEXT_LEFT_OUT, raw);
  };

  for (const term of parseDatadogLogSearch(data.query)) {
    if (term.kind === "Unsupported") {
      leaveOut(LOG_TERM_LEFT_OUT, term.raw);
      continue;
    }

    if (term.kind === "Variable") {
      const prefix: string | undefined =
        term.key || data.variablePrefixes?.get(term.name);

      if (!data.variablePrefixes) {
        leaveOut(LOG_TERM_LEFT_OUT, term.raw);
        continue;
      }

      /*
       * A variable on a tag narrows the widget itself, as it narrows every
       * log widget of the dashboard (LOGQL_VARIABLES_EVERYWHERE, said once
       * for the widget); one that takes a whole tag reads every log.
       */
      if (!prefix) {
        data.notes.push({
          kind: ImportNoteKind.Info,
          text: DATADOG_VARIABLE_WITHOUT_PREFIX,
          values: { name: term.name },
        });
      }
      continue;
    }

    if (term.kind === "Text") {
      // A word's wildcards at its ends say "contains": *timeout* is timeout.
      const text: string = term.quoted
        ? term.text
        : term.text.replace(/^\*+/, "").replace(/(?<!\\)\*+$/, "");

      if (term.negated || !text || (!term.quoted && hasDatadogWildcard(text))) {
        leaveOut(LOG_TERM_LEFT_OUT, term.raw);
        continue;
      }

      addText(term.quoted ? text : literalOf(text), term.raw);
      continue;
    }

    const target: DatadogLogFieldTarget = readDatadogLogField(
      term.key.replace(/^@/, ""),
    );

    if (target.field === DatadogLogField.Trace) {
      leaveOut(LOG_TERM_LEFT_OUT, term.raw);
      continue;
    }

    if (target.field === DatadogLogField.Message) {
      if (
        term.negated ||
        term.value.kind !== "Exact" ||
        hasDatadogWildcard(term.value.quoted ? "" : term.value.value)
      ) {
        leaveOut(LOG_TERM_LEFT_OUT, term.raw);
        continue;
      }

      addText(
        term.value.quoted ? term.value.value : literalOf(term.value.value),
        term.raw,
      );
      continue;
    }

    if (target.field === DatadogLogField.Severity) {
      const read:
        | { statuses: Array<string>; severities: Array<LogSeverity> }
        | undefined = readStatuses(term.value);

      if (!read) {
        leaveOut(LOG_TERM_LEFT_OUT, term.raw);
        continue;
      }

      if (!namesEveryStatusOfItsSeverities(read.statuses)) {
        sharesStatuses = true;
      }

      narrowSeverities(
        term.negated
          ? ALL_SEVERITIES.filter((severity: LogSeverity): boolean => {
              return !read.severities.includes(severity);
            })
          : read.severities,
      );
      continue;
    }

    // An attribute or a tag; `tags:x` is a keyless tag, kept comma-joined.
    const isKeylessTag: boolean = term.key === "tags";
    const key: string = isKeylessTag
      ? DATADOG_KEYLESS_TAGS_ATTRIBUTE
      : target.attributeKey || term.key;

    if (isExact) {
      const value: DatadogLogValue = term.value;

      if (
        term.negated ||
        isKeylessTag ||
        value.kind !== "Exact" ||
        (!value.quoted && hasDatadogWildcard(value.value)) ||
        attributes[key] !== undefined
      ) {
        leaveOut(LOG_TERM_NOT_EXACT, term.raw);
        continue;
      }

      attributes[key] = value.quoted ? value.value : literalOf(value.value);
      continue;
    }

    const tokens: Array<string> | undefined = isKeylessTag
      ? keylessTagTokens({ value: term.value, negated: term.negated })
      : attributeSearchTokens({
          key,
          value: term.value,
          negated: term.negated,
        });

    if (!tokens) {
      leaveOut(LOG_TERM_LEFT_OUT, term.raw);
      continue;
    }

    searchTokens.push(...tokens);
  }

  if (sharesStatuses) {
    data.notes.push({
      kind: ImportNoteKind.Approximation,
      text: LOG_STATUSES_SHARED,
    });
  }

  const finalSeverities: Array<LogSeverity> | undefined = severities
    ? ALL_SEVERITIES.filter((severity: LogSeverity): boolean => {
        return Boolean(
          (severities as Set<LogSeverity> | undefined)?.has(severity),
        );
      })
    : undefined;

  const exactTokens: Array<string> = Object.keys(attributes).map(
    (key: string): string => {
      return `@${key}:${buildSearchTokenValue(attributes[key] || "")}`;
    },
  );

  const severityTokens: Array<string> =
    finalSeverities && finalSeverities.length > 0
      ? [
          finalSeverities.length === 1
            ? `severity:${finalSeverities[0]}`
            : `severity:(${finalSeverities.join(" OR ")})`,
        ]
      : [];

  const textToken: Array<string> =
    bodyContains !== undefined
      ? [buildSearchTokenValue(bodyContains as string)]
      : [];

  return {
    attributeQuery: searchTokens.join(" "),
    attributes,
    bodyContains,
    severities: finalSeverities,
    searchText: [
      ...severityTokens,
      ...(isExact ? exactTokens : searchTokens),
      ...textToken,
    ].join(" "),
  };
};

// Whether a Log Stream can show these severities: one, or none to filter on.
export const readLogStreamSeverity: (data: {
  severities: Array<LogSeverity> | undefined;
  notes: Array<ImportNote>;
}) => LogSeverity | undefined = (data: {
  severities: Array<LogSeverity> | undefined;
  notes: Array<ImportNote>;
}): LogSeverity | undefined => {
  if (!data.severities) {
    return undefined;
  }

  if (data.severities.length === 1) {
    return data.severities[0];
  }

  data.notes.push({
    kind: ImportNoteKind.Approximation,
    text: LOG_ONE_SEVERITY,
  });

  return undefined;
};
