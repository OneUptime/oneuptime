export class StringUtils {
  public static toCamelCase(str: string): string {
    return str
      .replace(/(?:^\w|[A-Z]|\b\w)/g, (word: string, index: number) => {
        return index === 0 ? word.toLowerCase() : word.toUpperCase();
      })
      .replace(/\s+/g, "");
  }

  public static fromCamelCase(str: string): string {
    // Convert camelCase back to original parameter format (kebab-case or snake_case)
    return str
      .replace(/([a-z])([A-Z])/g, "$1-$2")
      .toLowerCase();
  }

  public static toPascalCase(str: string): string {
    return str
      .replace(/(?:^\w|[A-Z]|\b\w)/g, (word: string) => {
        return word.toUpperCase();
      })
      .replace(/\s+/g, "");
  }

  public static toKebabCase(str: string): string {
    return str
      .replace(/([a-z])([A-Z])/g, "$1-$2")
      .replace(/[\s_]+/g, "-")
      .toLowerCase();
  }

  public static toSnakeCase(str: string): string {
    return str
      .replace(/([a-z])([A-Z])/g, "$1_$2")
      .replace(/[\s-]+/g, "_")
      .toLowerCase();
  }

  public static toConstantCase(str: string): string {
    return this.toSnakeCase(str).toUpperCase();
  }

  public static capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  public static sanitizeDescription(description: string): string {
    return description
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
  }

  public static extractJsonSchema(schema: any): string {
    return JSON.stringify(schema, null, 2)
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n");
  }
}
