import DashboardVariable from "../../Types/Dashboard/DashboardVariable";
import DashboardVariableInterpolation, {
  ResolvedVariableValue,
} from "../Dashboard/VariableInterpolation";

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
      const escapedName: string = variable.name.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      );
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

    return template.replace(
      /\{\{\s*([^}\s]+)\s*\}\}/g,
      (_match: string, key: string): string => {
        const value: string | undefined = attributes
          ? attributes[key]
          : undefined;
        return value === undefined || value === "" ? "(unset)" : value;
      },
    );
  }
}
