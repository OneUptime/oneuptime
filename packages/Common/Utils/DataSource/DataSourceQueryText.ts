import DashboardVariable from "../../Types/Dashboard/DashboardVariable";
import { ProjectMetricsDataSourceUtil } from "../../Types/DataSource/ProjectMetricsDataSource";
import DashboardVariableInterpolation, {
  ResolvedVariableValue,
} from "../Dashboard/VariableInterpolation";
import escapeRegExp from "../RegExpEscape";

/*
 * A PromQL label matcher whose value is a string: the label, the operator
 * and the quoted value, in any of PromQL's three quotes.
 */
const PROMQL_MATCHER_PATTERN: RegExp =
  /([A-Za-z_][A-Za-z0-9_]*)(\s*)(=~|!~|!=|=)(\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)/g;

// A {{ name }} token, as applyVariables reads one.
const VARIABLE_TOKEN_PATTERN: RegExp = /\{\{\s*([^{}\s]+)\s*\}\}/g;

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
 * Client-side only — the server never interpolates variables (it receives
 * the final query text).
 */
export default class DataSourceQueryText {
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

    /*
     * Each "{{ key }}" as the pattern /\{\{\s*([^}\s]+)\s*\}\}/g found it:
     * "{{", white space, a key of characters other than "}" and white
     * space, white space, "}}" - each run read whole. Where none starts at
     * a "{{", the next that can start is two characters before the key's
     * end at the earliest: one that starts inside the key reads the rest of
     * the same key, and fails at the same place. (The pattern tried every
     * "{{" in that key again, each time reading the key to its end - on
     * "{{{{{{..." a time that grew with the square of the template's
     * length.)
     */
    const parts: Array<string> = [];
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
        const key: string = template.slice(keyStart, keyEnd);
        const value: string | undefined = attributes
          ? attributes[key]
          : undefined;

        parts.push(
          template.slice(copied, open),
          value === undefined || value === "" ? "(unset)" : value,
        );
        copied = closeAt + 2;
        from = copied;
        continue;
      }

      from = Math.max(open + 1, keyEnd - 2);
    }

    if (parts.length === 0) {
      return template;
    }

    parts.push(template.slice(copied));

    return parts.join("");
  }
}
