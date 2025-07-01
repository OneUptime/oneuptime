export class StringUtils {
  public static toPascalCase(str: string): string {
    return str
      .replace(/['`]/g, "") // Remove apostrophes and backticks
      .replace(/[-_\s]+(.)?/g, (_: string, char: string) => {
        return char ? char.toUpperCase() : "";
      })
      .replace(/^[a-z]/, (char: string) => {
        return char.toUpperCase();
      });
  }

  public static toCamelCase(str: string): string {
    const pascalCase: string = this.toPascalCase(str);
    return pascalCase.charAt(0).toLowerCase() + pascalCase.slice(1);
  }

  public static toSnakeCase(str: string): string {
    return (
      str
        .replace(/['`]/g, "") // Remove apostrophes and backticks
        // Handle consecutive uppercase letters (like "API" -> "api" instead of "a_p_i")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2") // APIKey -> API_Key
        .replace(/([a-z\d])([A-Z])/g, "$1_$2") // camelCase -> camel_Case
        .toLowerCase()
        .replace(/^_/, "")
        .replace(/[-\s]+/g, "_")
        .replace(/_+/g, "_") // Replace multiple underscores with single underscore
    );
  }

  public static toKebabCase(str: string): string {
    return this.toSnakeCase(str).replace(/_/g, "-");
  }

  public static toConstantCase(str: string): string {
    return this.toSnakeCase(str).toUpperCase();
  }

  public static capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  public static sanitizeGoIdentifier(str: string): string {
    // Remove special characters including apostrophes and ensure it starts with a letter
    const sanitized: string = str.replace(/[^a-zA-Z0-9_]/g, "");
    // prettier-ignore
    return (/^[a-zA-Z]/).test(sanitized) ? sanitized : `_${sanitized}`;
  }

  public static escapeGoString(str: string): string {
    return str
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
  }

  public static pluralize(str: string): string {
    if (str.endsWith("y")) {
      return str.slice(0, -1) + "ies";
    }
    if (
      str.endsWith("s") ||
      str.endsWith("sh") ||
      str.endsWith("ch") ||
      str.endsWith("x") ||
      str.endsWith("z")
    ) {
      return str + "es";
    }
    return str + "s";
  }

  public static singularize(str: string): string {
    if (str.endsWith("ies")) {
      return str.slice(0, -3) + "y";
    }
    if (str.endsWith("es")) {
      return str.slice(0, -2);
    }
    if (str.endsWith("s") && !str.endsWith("ss")) {
      return str.slice(0, -1);
    }
    return str;
  }
}
