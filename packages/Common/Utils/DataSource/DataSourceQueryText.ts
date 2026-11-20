import DashboardVariable from "../../Types/Dashboard/DashboardVariable";
import { ProjectMetricsDataSourceUtil } from "../../Types/DataSource/ProjectMetricsDataSource";
import DashboardVariableInterpolation, {
  ResolvedVariableValue,
} from "../Dashboard/VariableInterpolation";
import escapeRegExp from "../RegExpEscape";
import { applyGrafanaIntervalMacros } from "../PromQL/PromQLGrafanaMacros";
import {
  PromQLToken,
  PromQLTokenType,
  tokenizePromQL,
} from "../PromQL/PromQLLexer";

/*
 * A PromQL label matcher whose value is a string: the label, the operator
 * and the quoted value, in any of PromQL's three quotes.
 */
const PROMQL_MATCHER_PATTERN: RegExp =
  /([A-Za-z_][A-Za-z0-9_]*)(\s*)(=~|!~|!=|=)(\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)/g;

// A {{ name }} token, as applyVariables reads one.
const VARIABLE_TOKEN_PATTERN: RegExp = /\{\{\s*([^{}\s]+)\s*\}\}/g;

// The operators a label matcher compares its label with.
const MATCHER_OPERATOR_TOKENS: ReadonlyArray<PromQLTokenType> = [
  PromQLTokenType.Assign,
  PromQLTokenType.Neq,
  PromQLTokenType.RegexMatch,
  PromQLTokenType.RegexNoMatch,
];

/*
 * A window to fill Grafana's interval macros for, where only the shape of
 * a query matters: what they become is a duration, whatever the window.
 */
const SHAPE_MACRO_WINDOW: { startDate: Date; endDate: Date } = {
  startDate: new Date(0),
  endDate: new Date(60 * 60 * 1000),
};

// What a value is inside a PromQL string of this quote.
const escapeForPromQLString: (value: string, quote: string) => string = (
  value: string,
  quote: string,
): string => {
  if (quote === "`") {
    // A raw string holds everything but its own quote.
    return value.replace(/`/g, "");
  }

  return value.replace(/\\/g, "\\\\").split(quote).join(`\\${quote}`);
};

// White space, as \s reads it, from the place lastIndex is set to.
const WHITE_SPACE_RUN: RegExp = /\s*/y;

// A legend key's characters: anything but "}" and white space.
const LEGEND_KEY_RUN: RegExp = /[^}\s]*/y;

type RunEndFunction = (pattern: RegExp, text: string, start: number) => number;

const runEnd: RunEndFunction = (
  pattern: RegExp,
  text: string,
  start: number,
): number => {
  pattern.lastIndex = start;

  const run: RegExpExecArray | null = pattern.exec(text);

  return start + (run ? run[0].length : 0);
};

/*
 * Pure text utilities for external Data Source queries: dashboard-variable
 * interpolation into query text, and legend templates for series naming.
 * A signed-in dashboard fills its variables in on the client and sends the
 * final query text. A public dashboard sends none (issue #10226): its
 * PromQL route fills a stored query here, on the server, with the values a
 * visitor may pick (PublicDashboardPromQLPolicy).
 */
export default class DataSourceQueryText {
  /*
   * The names of the variables a PromQL query names anywhere but inside a
   * label matcher's value - in its code (`[{{range}}]`, `by ({{label}})`,
   * a metric's name), in a function's string argument, in a comment -
   * where applyVariablesToPromQL writes a value as it is, not as a string,
   * so a value could change what the query reads. Inside a matcher's value
   * a value is always written as a string (fillPromQLMatcher), and can
   * only pick which values of that label match.
   *
   * A matcher's value counts only where the PromQL lexer reads one too: a
   * string right after a label's name and a matcher's operator, at the very
   * place the matcher pattern fills. A query that does not lex - and so
   * would not run - is read as naming every variable outside a matcher.
   */
  public static getVariableNamesOutsidePromQLMatchers(
    queryText: string,
  ): Set<string> {
    const names: Set<string> = new Set<string>();

    if (!queryText) {
      return names;
    }

    // Grafana's macros as the durations they become, as the query runs.
    const text: string = applyGrafanaIntervalMacros(
      queryText,
      SHAPE_MACRO_WINDOW,
    );

    // The strings the lexer reads as a matcher's value, by where they are.
    const lexedMatcherValues: Set<string> = new Set<string>();

    try {
      const tokens: Array<PromQLToken> = tokenizePromQL(text);

      for (let index: number = 2; index < tokens.length; index++) {
        const value: PromQLToken = tokens[index]!;
        const operator: PromQLToken = tokens[index - 1]!;
        const label: PromQLToken = tokens[index - 2]!;

        if (
          value.type === PromQLTokenType.String &&
          MATCHER_OPERATOR_TOKENS.includes(operator.type) &&
          label.type === PromQLTokenType.Identifier
        ) {
          lexedMatcherValues.add(`${value.start}:${value.end}`);
        }
      }
    } catch {
      // Does not lex: no place in it is a matcher's value.
    }

    // The quoted values the matcher pattern fills, where the lexer agrees.
    const matcherValues: Array<{ start: number; end: number }> = [];

    for (const found of text.matchAll(PROMQL_MATCHER_PATTERN)) {
      const quoted: string = found[5] || "";
      const end: number = (found.index || 0) + found[0].length;
      const start: number = end - quoted.length;

      if (lexedMatcherValues.has(`${start}:${end}`)) {
        matcherValues.push({ start, end });
      }
    }

    for (const found of text.matchAll(VARIABLE_TOKEN_PATTERN)) {
      const start: number = found.index || 0;
      const end: number = start + found[0].length;

      const isInsideAMatcherValue: boolean = matcherValues.some(
        (span: { start: number; end: number }): boolean => {
          return start > span.start && end < span.end;
        },
      );

      if (!isInsideAMatcherValue && found[1]) {
        names.add(found[1]);
      }
    }

    return names;
  }

  /*
   * Replace {{variableName}} tokens with the variable's current value.
   * Multi-select values join with "|" — regex alternation, which drops
   * straight into PromQL/LogQL label matchers (the dominant use). SQL
   * users needing IN-lists can bind single-select variables. Unresolved
   * variables leave the token untouched so the connector's error names
   * the real problem instead of silently querying "".
   */
  public static applyVariables(
    queryText: string,
    variables: Array<DashboardVariable> | undefined,
  ): string {
    if (!queryText || !variables || variables.length === 0) {
      return queryText;
    }

    let result: string = queryText;

    for (const variable of variables) {
      if (!variable.name) {
        continue;
      }

      const resolved: ResolvedVariableValue | undefined =
        DashboardVariableInterpolation.resolveValue(variable);

      if (!resolved) {
        continue;
      }

      const replacement: string =
        resolved.multi && resolved.multi.length > 0
          ? resolved.multi.join("|")
          : resolved.scalar || "";

      if (!replacement) {
        continue;
      }

      /*
       * {{ name }} with optional inner whitespace. Variable names come
       * from user config — escape regex metacharacters.
       */
      const escapedName: string = escapeRegExp(variable.name);
      const token: RegExp = new RegExp(
        `\\{\\{\\s*${escapedName}\\s*\\}\\}`,
        "g",
      );
      result = result.replace(token, replacement);
    }

    return result;
  }

  /*
   * The variables filled into a widget's query the way its source reads
   * them: PromQL over the project's own metrics as Grafana's Prometheus
   * data source fills its variables (applyVariablesToPromQL), any other
   * source as applyVariables does.
   */
  public static applyVariablesForSource(data: {
    dataSourceId: string | undefined;
    queryText: string;
    variables: Array<DashboardVariable> | undefined;
  }): string {
    if (ProjectMetricsDataSourceUtil.isProjectMetrics(data.dataSourceId)) {
      return DataSourceQueryText.applyVariablesToPromQL(
        data.queryText,
        data.variables,
      );
    }

    return DataSourceQueryText.applyVariables(data.queryText, data.variables);
  }

  /*
   * A PromQL query's variables, filled the way Grafana's Prometheus data
   * source fills them, so a dashboard brought over from Grafana reads what
   * it read there (issue #7697). In a label matcher:
   *
   *   - several values picked match any one of them, each read as written:
   *     `=~"(a|b)"`, an `=` or `!=` matcher becoming `=~` or `!~` to say so;
   *   - a value picked of a variable that can take several is read as
   *     written too (`a\.b`), as Grafana escapes it;
   *   - a variable on All - nothing picked and no default - matches every
   *     value: its token is `.*`, in a matcher made a regex matcher if it
   *     was not one, as Grafana's All does with the value `.*`. The token
   *     left as it was matched only series labelled "{{node}}": none.
   *
   * Anywhere else in the query a token is filled as applyVariables fills
   * it, and one no variable answers is left as it is.
   */
  public static applyVariablesToPromQL(
    queryText: string,
    variables: Array<DashboardVariable> | undefined,
  ): string {
    if (!queryText || !variables || variables.length === 0) {
      return queryText;
    }

    // By name, the first of a name winning, as applyVariables reads them.
    const byName: Map<string, DashboardVariable> = new Map<
      string,
      DashboardVariable
    >();

    for (const variable of variables) {
      if (variable.name && !byName.has(variable.name)) {
        byName.set(variable.name, variable);
      }
    }

    const rewritten: string = queryText.replace(
      PROMQL_MATCHER_PATTERN,
      (
        match: string,
        label: string,
        spaceBefore: string,
        operator: string,
        spaceAfter: string,
        quoted: string,
      ): string => {
        return DataSourceQueryText.fillPromQLMatcher({
          match,
          label,
          spaceBefore,
          operator,
          spaceAfter,
          quoted,
          byName,
        });
      },
    );

    return DataSourceQueryText.applyVariables(rewritten, variables);
  }

  // One label matcher, filled (applyVariablesToPromQL).
  private static fillPromQLMatcher(data: {
    match: string;
    label: string;
    spaceBefore: string;
    operator: string;
    spaceAfter: string;
    quoted: string;
    byName: Map<string, DashboardVariable>;
  }): string {
    const quote: string = data.quoted.charAt(0);
    const inner: string = data.quoted.slice(1, -1);

    type Part =
      | { text: string }
      | {
          variable: DashboardVariable;
          resolved: ResolvedVariableValue | undefined;
        };

    const parts: Array<Part> = [];
    let copied: number = 0;
    let namesAVariable: boolean = false;

    VARIABLE_TOKEN_PATTERN.lastIndex = 0;

    for (;;) {
      const found: RegExpExecArray | null = VARIABLE_TOKEN_PATTERN.exec(inner);

      if (!found) {
        break;
      }

      const variable: DashboardVariable | undefined = data.byName.get(
        found[1] || "",
      );

      if (!variable) {
        continue;
      }

      namesAVariable = true;
      parts.push({ text: inner.slice(copied, found.index) });
      parts.push({
        variable,
        resolved: DashboardVariableInterpolation.resolveValue(variable),
      });
      copied = found.index + found[0].length;
    }

    if (!namesAVariable) {
      return data.match;
    }

    parts.push({ text: inner.slice(copied) });

    const isRegexMatcher: boolean =
      data.operator === "=~" || data.operator === "!~";

    // A matcher becomes a regex matcher for several values, or for All.
    const needsRegex: boolean = parts.some((part: Part): boolean => {
      return (
        "variable" in part &&
        (!part.resolved || (part.resolved.multi || []).length > 1)
      );
    });

    const asRegex: boolean = isRegexMatcher || needsRegex;

    // A string's content, its own quote and backslashes read back.
    const unescape: (text: string) => string = (text: string): string => {
      if (quote === "`") {
        return text;
      }

      return text.replace(/\\(.)/g, (escaped: string, char: string): string => {
        return char === quote || char === "\\" ? char : escaped;
      });
    };

    const value: string = parts
      .map((part: Part): string => {
        if ("text" in part) {
          const text: string = unescape(part.text);
          // Literal text of an `=` matcher made a regex is read as written.
          return asRegex && !isRegexMatcher ? escapeRegExp(text) : text;
        }

        if (!part.resolved) {
          return ".*";
        }

        const values: Array<string> =
          part.resolved.multi && part.resolved.multi.length > 0
            ? part.resolved.multi
            : [part.resolved.scalar || ""];

        if (values.length > 1) {
          return `(${values.map(escapeRegExp).join("|")})`;
        }

        const one: string = values[0] || "";

        return asRegex && (!isRegexMatcher || part.variable.isMultiSelect)
          ? escapeRegExp(one)
          : one;
      })
      .join("");

    const operator: string = asRegex
      ? data.operator.startsWith("!")
        ? "!~"
        : "=~"
      : data.operator;

    return `${data.label}${data.spaceBefore}${operator}${data.spaceAfter}${quote}${escapeForPromQLString(value, quote)}${quote}`;
  }

  /*
   * Render a legend template against one series' attribute set:
   * "{{instance}} ({{job}})" + { instance: "a:9090", job: "api" } →
   * "a:9090 (api)". Unknown keys render as "(unset)". Returns the
   * template untouched when it has no placeholders.
   */
  public static applyLegendTemplate(
    template: string,
    attributes: Record<string, string> | undefined,
  ): string {
    if (!template) {
      return template;
    }

    const parts: Array<LegendTemplatePart> =
      DataSourceQueryText.readLegendTemplate(template);

    if (
      !parts.some((part: LegendTemplatePart): boolean => {
        return "key" in part;
      })
    ) {
      return template;
    }

    return parts
      .map((part: LegendTemplatePart): string => {
        if ("text" in part) {
          return part.text;
        }

        /*
         * A label's own value: never one every object inherits, so a
         * template that names {{constructor}} reads "(unset)", not the
         * code of a function.
         */
        const value: unknown =
          attributes &&
          Object.prototype.hasOwnProperty.call(attributes, part.key)
            ? attributes[part.key]
            : undefined;

        if (value === undefined || value === "") {
          return "(unset)";
        }

        // A column's number or a null, written as they always were.
        return value === null ? "" : String(value);
      })
      .join("");
  }

  /*
   * The labels a legend template names, in the order it names them, each
   * once: what a series drawn by it shows of its labels. A public
   * dashboard's chart is sent only these (issue #10226): its series are
   * told apart by the names the template gives them, so no other label is
   * drawn.
   */
  public static getLegendTemplateKeys(template: string): Array<string> {
    const keys: Array<string> = [];

    if (!template) {
      return keys;
    }

    for (const part of DataSourceQueryText.readLegendTemplate(template)) {
      if ("key" in part && !keys.includes(part.key)) {
        keys.push(part.key);
      }
    }

    return keys;
  }

  /*
   * A legend template's parts, in order: text as written, and each
   * "{{ key }}" as the pattern /\{\{\s*([^}\s]+)\s*\}\}/g found it: "{{",
   * white space, a key of characters other than "}" and white space, white
   * space, "}}" - each run read whole. Where none starts at a "{{", the next
   * that can start is two characters before the key's end at the earliest:
   * one that starts inside the key reads the rest of the same key, and
   * fails at the same place. (The pattern tried every "{{" in that key
   * again, each time reading the key to its end - on "{{{{{{..." a time
   * that grew with the square of the template's length.)
   */
  private static readLegendTemplate(
    template: string,
  ): Array<LegendTemplatePart> {
    const parts: Array<LegendTemplatePart> = [];
    let copied: number = 0;
    let from: number = 0;

    for (;;) {
      const open: number = template.indexOf("{{", from);

      if (open === -1) {
        break;
      }

      const keyStart: number = runEnd(WHITE_SPACE_RUN, template, open + 2);
      const keyEnd: number = runEnd(LEGEND_KEY_RUN, template, keyStart);
      const closeAt: number = runEnd(WHITE_SPACE_RUN, template, keyEnd);

      if (keyEnd > keyStart && template.startsWith("}}", closeAt)) {
        parts.push(
          { text: template.slice(copied, open) },
          { key: template.slice(keyStart, keyEnd) },
        );
        copied = closeAt + 2;
        from = copied;
        continue;
      }

      from = Math.max(open + 1, keyEnd - 2);
    }

    parts.push({ text: template.slice(copied) });

    return parts;
  }
}

// One part of a legend template: text as written, or a label to fill.
type LegendTemplatePart = { text: string } | { key: string };
