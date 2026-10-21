import DashboardVariable from "../../Types/Dashboard/DashboardVariable";
import DashboardVariableInterpolation, {
  ResolvedVariableValue,
} from "../Dashboard/VariableInterpolation";
import escapeRegExp from "../RegExpEscape";

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
