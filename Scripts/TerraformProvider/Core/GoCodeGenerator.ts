import { StringUtils } from "./StringUtils";

export class GoCodeGenerator {
  public static generateStruct(
    name: string,
    fields: Array<{
      name: string;
      type: string;
      tag?: string;
      comment?: string;
    }>,
  ): string {
    const structFields: string = fields
      .map((field: any) => {
        let line: string = `    ${field.name} ${field.type}`;
        if (field.tag) {
          line += ` \`${field.tag}\``;
        }
        if (field.comment) {
          line += ` // ${field.comment}`;
        }
        return line;
      })
      .join("\n");

    return `type ${name} struct {
${structFields}
}`;
  }

  public static generateFunction(
    name: string,
    params: Array<{ name: string; type: string }>,
    returnType: string,
    body: string,
    comment?: string,
  ): string {
    const paramList: string = params
      .map((p: { name: string; type: string }) => {
        return `${p.name} ${p.type}`;
      })
      .join(", ");
    const funcComment: string = comment ? `// ${comment}\n` : "";

    return `${funcComment}func ${name}(${paramList}) ${returnType} {
${body}
}`;
  }

  public static generateMethod(
    receiver: { name: string; type: string },
    name: string,
    params: Array<{ name: string; type: string }>,
    returnType: string,
    body: string,
    comment?: string,
  ): string {
    const paramList: string = params
      .map((p: { name: string; type: string }) => {
        return `${p.name} ${p.type}`;
      })
      .join(", ");
    const funcComment: string = comment ? `// ${comment}\n` : "";

    return `${funcComment}func (${receiver.name} ${receiver.type}) ${name}(${paramList}) ${returnType} {
${body}
}`;
  }

  public static generateMapAccess(
    mapVar: string,
    key: string,
    targetType: string,
    targetVar: string,
  ): string {
    switch (targetType) {
      case "string":
        return `if val, ok := ${mapVar}["${key}"].(string); ok {
        ${targetVar} = types.StringValue(val)
    }`;
      case "int":
      case "int64":
      case "float64":
        return `if val, ok := ${mapVar}["${key}"].(float64); ok {
        ${targetVar} = types.NumberValue(big.NewFloat(val))
    }`;
      case "bool":
        return `if val, ok := ${mapVar}["${key}"].(bool); ok {
        ${targetVar} = types.BoolValue(val)
    }`;
      default:
        return `if val, ok := ${mapVar}["${key}"].(string); ok {
        ${targetVar} = types.StringValue(val)
    }`;
    }
  }

  public static generateImports(imports: string[]): string {
    if (imports.length === 0) {
      return "";
    }

    if (imports.length === 1) {
      return `import "${imports[0]}"`;
    }

    const importList: string = imports
      .map((imp: string) => {
        return `    "${imp}"`;
      })
      .join("\n");
    return `import (
${importList}
)`;
  }

  public static generatePackageDeclaration(packageName: string): string {
    return `package ${packageName}`;
  }

  public static generateFileHeader(
    packageName: string,
    imports: string[],
    comment?: string,
  ): string {
    const header: string = comment ? `// ${comment}\n\n` : "";
    const pkg: string = this.generatePackageDeclaration(packageName);
    const imp: string = this.generateImports(imports);

    return `${header}${pkg}\n\n${imp}\n\n`;
  }

  public static escapeString(str: string): string {
    return str
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
  }

  public static formatGoCode(code: string): string {
    // Basic Go code formatting
    const lines: string[] = code.split("\n");
    let indentLevel: number = 0;
    const formattedLines: string[] = [];

    for (const line of lines) {
      const trimmedLine: string = line.trim();

      if (trimmedLine === "") {
        formattedLines.push("");
        continue;
      }

      // Decrease indent for closing braces
      if (trimmedLine === "}" || trimmedLine.endsWith("})")) {
        indentLevel = Math.max(0, indentLevel - 1);
      }

      // Add the line with proper indentation
      const indent: string = "    ".repeat(indentLevel);
      formattedLines.push(indent + trimmedLine);

      // Increase indent for opening braces
      if (trimmedLine.endsWith("{") && !trimmedLine.includes("}")) {
        indentLevel++;
      }
    }

    return formattedLines.join("\n");
  }

  public static generateConstant(
    name: string,
    value: string,
    type?: string,
  ): string {
    const typeDecl: string = type ? ` ${type}` : "";
    return `const ${name}${typeDecl} = ${value}`;
  }

  public static generateVariable(
    name: string,
    type: string,
    value?: string,
  ): string {
    const assignment: string = value ? ` = ${value}` : "";
    return `var ${name} ${type}${assignment}`;
  }

  public static generateInterface(
    name: string,
    methods: Array<{
      name: string;
      params: string;
      returns: string;
      comment?: string;
    }>,
  ): string {
    const methodList: string = methods
      .map((method: any) => {
        const comment: string = method.comment
          ? `    // ${method.comment}\n`
          : "";
        return `${comment}    ${method.name}(${method.params}) ${method.returns}`;
      })
      .join("\n");

    return `type ${name} interface {
${methodList}
}`;
  }

  public static generateErrorCheck(
    errVar: string = "err",
    customMessage?: string,
  ): string {
    const message: string = customMessage || "an error occurred";
    return `if ${errVar} != nil {
        return fmt.Errorf("${message}: %w", ${errVar})
    }`;
  }

  public static generateNilCheck(variable: string, action: string): string {
    return `if ${variable} == nil {
        ${action}
    }`;
  }

  public static generateTypeAssertion(
    variable: string,
    targetType: string,
    okVar: string = "ok",
  ): string {
    return `${variable}, ${okVar} := ${variable}.(${targetType})`;
  }

  public static sanitizeGoIdentifier(name: string): string {
    return StringUtils.sanitizeGoIdentifier(name);
  }
}
