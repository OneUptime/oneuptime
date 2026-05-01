import DashboardVariable from "../../Types/Dashboard/DashboardVariable";

const VARIABLE_PATTERN: RegExp = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

export default class DashboardVariableInterpolation {
  public static resolveValue(
    variable: DashboardVariable,
  ): string | Array<string> | null {
    if (variable.isMultiSelect) {
      const values: Array<string> | undefined = variable.selectedValues;
      if (values && values.length > 0) {
        return values;
      }
    }

    if (variable.selectedValue !== undefined && variable.selectedValue !== "") {
      return variable.selectedValue;
    }

    if (variable.defaultValue !== undefined && variable.defaultValue !== "") {
      return variable.defaultValue;
    }

    return null;
  }

  public static interpolateString(
    input: string,
    variables: Array<DashboardVariable>,
  ): string {
    if (!input || typeof input !== "string") {
      return input;
    }

    if (!variables || variables.length === 0) {
      return input;
    }

    return input.replace(
      VARIABLE_PATTERN,
      (match: string, name: string): string => {
        const variable: DashboardVariable | undefined = variables.find(
          (v: DashboardVariable) => {
            return v.name === name;
          },
        );

        if (!variable) {
          return match;
        }

        const value: string | Array<string> | null =
          this.resolveValue(variable);

        if (value === null) {
          return match;
        }

        if (Array.isArray(value)) {
          return value.join(",");
        }

        return value;
      },
    );
  }

  public static interpolateValue<T>(
    input: T,
    variables: Array<DashboardVariable>,
  ): T {
    if (input === null || input === undefined) {
      return input;
    }

    if (typeof input === "string") {
      return this.interpolateString(input, variables) as unknown as T;
    }

    if (Array.isArray(input)) {
      return input.map((item: unknown) => {
        return this.interpolateValue(item, variables);
      }) as unknown as T;
    }

    if (typeof input === "object") {
      const result: Record<string, unknown> = {};
      const source: Record<string, unknown> = input as Record<string, unknown>;
      for (const key of Object.keys(source)) {
        result[key] = this.interpolateValue(source[key], variables);
      }
      return result as unknown as T;
    }

    return input;
  }

  public static hasVariableReference(input: string): boolean {
    if (!input || typeof input !== "string") {
      return false;
    }
    VARIABLE_PATTERN.lastIndex = 0;
    return VARIABLE_PATTERN.test(input);
  }

  public static extractVariableNames(input: string): Array<string> {
    if (!input || typeof input !== "string") {
      return [];
    }

    const names: Array<string> = [];
    const matches: IterableIterator<RegExpMatchArray> =
      input.matchAll(VARIABLE_PATTERN);
    for (const match of matches) {
      if (match[1] && !names.includes(match[1])) {
        names.push(match[1]);
      }
    }
    return names;
  }
}
