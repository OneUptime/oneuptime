import {
  ConvertedQuery,
  ImportItemStatus,
  ImportNote,
  ImportNoteKind,
  ImportQueryLanguage,
  ImportStatusUtil,
} from "../../Types/ObservabilityImport/ObservabilityImport";
import { translationKey } from "../../Types/Translator";
import PromQLError from "../PromQL/PromQLError";
import {
  GRAFANA_MACRO_CHECK_VALUES,
  fillGrafanaIntervalMacros,
} from "../PromQL/PromQLGrafanaMacros";
import { parsePromQL } from "../PromQL/PromQLParser";
import { findPromQLMonitorExpressionProblem } from "../PromQL/PromQLMonitorExpression";

/*
 * A QUERY FROM GRAFANA, AS ONEUPTIME RUNS IT (issue #7697).
 *
 * A Grafana panel's PromQL runs over the project's metrics as it is: data
 * sent with Prometheus remote write keeps its names and labels, and
 * OpenTelemetry metrics answer to their Prometheus names. What Grafana
 * fills in before a query runs is put the way OneUptime fills it:
 *
 *   - a dashboard variable, written $node, ${node}, ${node:regex} or
 *     [[node]], is the dashboard's {{node}};
 *   - $__interval, $__rate_interval and $__range stay: the widget fills
 *     them as Grafana does (PromQLGrafanaMacros);
 *   - a variable the dashboard keeps no picker for (a data source, a
 *     constant) is written in as its value.
 *
 * The query is then parsed by the engine's own parser, with every
 * variable and macro filled with a value it could take. One that does not
 * parse is not converted: the parser's words say why, and OneUptime AI
 * may be asked to rewrite it.
 */

// $1 in a label_replace: a group of the regex, not a variable.
const DIGITS_ONLY: RegExp = /^[0-9]+$/;
// A sample value that is a duration: 5m, 30s.
const DURATION_START: RegExp = /^[0-9]+[smhdwy]/;
// A query that reads Grafana's interval: $__interval, $__rate_interval.
const READS_INTERVAL: RegExp = /\$__(rate_)?interval/;

export const QUERY_EMPTY: string = translationKey("It has no query.");

export const QUERY_DOES_NOT_PARSE: string = translationKey(
  "OneUptime's PromQL does not read this query: {{error}}",
);

export const QUERY_NAMES_UNKNOWN_VARIABLE: string = translationKey(
  "The query names ${{name}}, a variable this dashboard does not define.",
);

export const QUERY_USES_TIME_MACRO: string = translationKey(
  "The query reads Grafana's {{macro}}, which OneUptime does not fill.",
);

export const QUERY_VARIABLE_FORMAT: string = translationKey(
  "Grafana formats ${{name}} as {{format}}; OneUptime fills in its values as they are.",
);

export const QUERY_MIN_INTERVAL: string = translationKey(
  "Grafana's minimum interval of {{interval}} is not kept: $__interval follows the chart's step.",
);

export const QUERY_IS_RANGE_VECTOR: string = translationKey(
  "The query returns a range vector or text, which this cannot draw or compare.",
);

export const QUERY_CONVERTED_BY_AI: string = translationKey(
  "OneUptime AI converted this query. Check that it reads what you expect.",
);

// Grafana's variable formats that fill a value in as it is, or as a regex.
const PLAIN_FORMATS: ReadonlySet<string> = new Set<string>([
  "raw",
  "regex",
  "pipe",
  "text",
]);

// The interval macros the widgets fill (PromQLGrafanaMacros).
const FILLED_MACROS: ReadonlySet<string> = new Set<string>([
  "__interval",
  "__interval_ms",
  "__rate_interval",
  "__rate_interval_ms",
  "__range",
  "__range_s",
  "__range_ms",
]);

/*
 * A Grafana variable reference: ${name}, ${name:format}, [[name]],
 * [[name:format]] or $name.
 */
const VARIABLE_REFERENCE: RegExp =
  /\$\{([A-Za-z0-9_]+)(?::([A-Za-z0-9_]+))?\}|\[\[([A-Za-z0-9_]+)(?::([A-Za-z0-9_]+))?\]\]|\$([A-Za-z_][A-Za-z0-9_]*)/g;

export interface GrafanaQueryVariables {
  // The variables the dashboard keeps, by name: written as {{name}}.
  dashboardVariables: ReadonlySet<string>;
  // A value a variable may take, to check a query with (its first).
  sampleValues: ReadonlyMap<string, string>;
  // Variables written in as a value: a data source's, a constant's.
  constants: ReadonlyMap<string, string>;
}

export const NO_GRAFANA_VARIABLES: GrafanaQueryVariables = {
  dashboardVariables: new Set<string>(),
  sampleValues: new Map<string, string>(),
  constants: new Map<string, string>(),
};

export interface VariableFillResult {
  text: string;
  notes: Array<ImportNote>;
  // A problem that keeps the query from being converted.
  problem?: ImportNote | undefined;
}

/*
 * A Grafana query's variables in OneUptime's {{name}}, its macros kept,
 * its constants written in.
 */
export const fillGrafanaVariables: (
  text: string,
  variables: GrafanaQueryVariables,
) => VariableFillResult = (
  text: string,
  variables: GrafanaQueryVariables,
): VariableFillResult => {
  const notes: Array<ImportNote> = [];
  let problem: ImportNote | undefined = undefined;
  const notedFormats: Set<string> = new Set<string>();

  const filled: string = text.replace(
    VARIABLE_REFERENCE,
    (
      match: string,
      bracedName: string | undefined,
      bracedFormat: string | undefined,
      bracketName: string | undefined,
      bracketFormat: string | undefined,
      bareName: string | undefined,
    ): string => {
      const name: string = bracedName || bracketName || bareName || "";
      const format: string = (bracedFormat || bracketFormat || "").trim();

      if (name.startsWith("__")) {
        if (FILLED_MACROS.has(name)) {
          return `$${name}`;
        }

        problem = problem || {
          kind: ImportNoteKind.Reason,
          text: QUERY_USES_TIME_MACRO,
          values: { macro: `$${name}` },
        };
        return match;
      }

      if (variables.constants.has(name)) {
        return variables.constants.get(name) || "";
      }

      if (variables.dashboardVariables.has(name)) {
        if (format && !PLAIN_FORMATS.has(format) && !notedFormats.has(name)) {
          notedFormats.add(name);
          notes.push({
            kind: ImportNoteKind.Approximation,
            text: QUERY_VARIABLE_FORMAT,
            values: { name, format },
          });
        }

        return `{{${name}}}`;
      }

      // `$1` in a label_replace, or a regex's `$`: not a variable.
      if (DIGITS_ONLY.test(name)) {
        return match;
      }

      problem = problem || {
        kind: ImportNoteKind.Reason,
        text: QUERY_NAMES_UNKNOWN_VARIABLE,
        values: { name },
      };
      return match;
    },
  );

  return { text: filled, notes, problem };
};

/*
 * The query with each {{name}} that stands outside a string filled with a
 * value it could take, so the parser reads it as it will run: a duration
 * in brackets (`[{{interval}}]`), a number elsewhere. Inside a string a
 * token is the string's text, as the parser reads it.
 */
const withSampleValues: (
  text: string,
  sampleValues: ReadonlyMap<string, string>,
) => string = (
  text: string,
  sampleValues: ReadonlyMap<string, string>,
): string => {
  let result: string = "";
  let quote: string | null = null;

  for (let index: number = 0; index < text.length; index++) {
    const char: string = text.charAt(index);

    if (quote) {
      result += char;

      if (char === "\\" && quote !== "`") {
        result += text.charAt(index + 1);
        index++;
      } else if (char === quote) {
        quote = null;
      }

      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      result += char;
      continue;
    }

    if (char === "{" && text.charAt(index + 1) === "{") {
      const end: number = text.indexOf("}}", index + 2);

      if (end !== -1) {
        const name: string = text.slice(index + 2, end).trim();
        const before: string = result.trimEnd();
        const sample: string | undefined = sampleValues.get(name);
        const inBrackets: boolean =
          before.endsWith("[") || before.endsWith(":");
        result +=
          sample && (!inBrackets || DURATION_START.test(sample))
            ? sample
            : inBrackets
              ? "5m"
              : "1";
        index = end + 1;
        continue;
      }
    }

    result += char;
  }

  return result;
};

/*
 * Why a converted query does not run, or null when it does: parsed with
 * every variable and macro filled with a value it could take.
 */
export const findPromQLImportProblem: (data: {
  promQL: string;
  sampleValues?: ReadonlyMap<string, string> | undefined;
}) => ImportNote | null = (data: {
  promQL: string;
  sampleValues?: ReadonlyMap<string, string> | undefined;
}): ImportNote | null => {
  const check: string = fillGrafanaIntervalMacros(
    withSampleValues(data.promQL, data.sampleValues || new Map()),
    GRAFANA_MACRO_CHECK_VALUES,
  );

  try {
    parsePromQL(check);
  } catch (error) {
    return {
      kind: ImportNoteKind.Reason,
      text: QUERY_DOES_NOT_PARSE,
      values: {
        error:
          error instanceof PromQLError || error instanceof Error
            ? error.message
            : String(error),
      },
    };
  }

  // A widget draws, and a monitor compares, numbers: not a range or text.
  if (findPromQLMonitorExpressionProblem(check)) {
    return {
      kind: ImportNoteKind.Reason,
      text: QUERY_IS_RANGE_VECTOR,
    };
  }

  return null;
};

/*
 * A Grafana target's PromQL, converted: variables put as the dashboard
 * keeps them, checked by the parser. `minInterval` is the panel's or the
 * target's minimum interval, noted when the query reads $__interval.
 */
export const convertGrafanaPromQL: (data: {
  expr: string;
  variables: GrafanaQueryVariables;
  minInterval?: string | undefined;
  // A query OneUptime AI wrote: checked the same way, and said so.
  isFromAi?: boolean | undefined;
}) => ConvertedQuery = (data: {
  expr: string;
  variables: GrafanaQueryVariables;
  minInterval?: string | undefined;
  isFromAi?: boolean | undefined;
}): ConvertedQuery => {
  const expr: string = (data.expr || "").trim();

  if (!expr) {
    return {
      status: ImportItemStatus.NotConverted,
      promQL: "",
      notes: [{ kind: ImportNoteKind.Reason, text: QUERY_EMPTY }],
    };
  }

  const filled: VariableFillResult = fillGrafanaVariables(expr, data.variables);
  const notes: Array<ImportNote> = [...filled.notes];

  if (data.isFromAi) {
    notes.push({
      kind: ImportNoteKind.Approximation,
      text: QUERY_CONVERTED_BY_AI,
    });
  }

  if (filled.problem) {
    return {
      status: ImportItemStatus.NotConverted,
      promQL: filled.text,
      notes: [...notes, filled.problem],
    };
  }

  const problem: ImportNote | null = findPromQLImportProblem({
    promQL: filled.text,
    sampleValues: data.variables.sampleValues,
  });

  if (problem) {
    return {
      status: ImportItemStatus.NotConverted,
      promQL: filled.text,
      notes: [...notes, problem],
      aiCandidate: {
        language: ImportQueryLanguage.PromQL,
        query: filled.text,
        variableNames: Array.from(data.variables.dashboardVariables),
      },
    };
  }

  const minInterval: string = (data.minInterval || "").trim();

  if (
    minInterval &&
    !minInterval.startsWith("$") &&
    READS_INTERVAL.test(filled.text)
  ) {
    notes.push({
      kind: ImportNoteKind.Approximation,
      text: QUERY_MIN_INTERVAL,
      values: { interval: minInterval },
    });
  }

  return {
    status: ImportStatusUtil.fromNotes(notes),
    promQL: filled.text,
    notes,
  };
};
