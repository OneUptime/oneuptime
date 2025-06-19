import { StringUtils } from "./StringUtils";

export class GoCodeGenerator {
  static generateStruct(name: string, fields: Array<{ name: string; type: string; tag?: string; comment?: string }>): string {
    const structFields = fields.map(field => {
      let line = `    ${field.name} ${field.type}`;
      if (field.tag) {
        line += ` \`${field.tag}\``;
      }
      if (field.comment) {
        line += ` // ${field.comment}`;
      }
      return line;
    }).join("\n");

    return `type ${name} struct {
${structFields}
}`;
  }

  static generateFunction(
    name: string, 
    params: Array<{ name: string; type: string }>,
    returnType: string,
    body: string,
    comment?: string
  ): string {
    const paramList = params.map(p => `${p.name} ${p.type}`).join(", ");
    const funcComment = comment ? `// ${comment}\n` : "";
    
    return `${funcComment}func ${name}(${paramList}) ${returnType} {
${body}
}`;
  }

  static generateMethod(
    receiver: { name: string; type: string },
    name: string,
    params: Array<{ name: string; type: string }>,
    returnType: string,
    body: string,
    comment?: string
  ): string {
    const paramList = params.map(p => `${p.name} ${p.type}`).join(", ");
    const funcComment = comment ? `// ${comment}\n` : "";
    
    return `${funcComment}func (${receiver.name} ${receiver.type}) ${name}(${paramList}) ${returnType} {
${body}
}`;
  }

  static generateMapAccess(mapVar: string, key: string, targetType: string, targetVar: string): string {
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

  static generateImports(imports: string[]): string {
    if (imports.length === 0) return "";
    
    if (imports.length === 1) {
      return `import "${imports[0]}"`;
    }

    const importList = imports.map(imp => `    "${imp}"`).join("\n");
    return `import (
${importList}
)`;
  }

  static generatePackageDeclaration(packageName: string): string {
    return `package ${packageName}`;
  }

  static generateFileHeader(packageName: string, imports: string[], comment?: string): string {
    const header = comment ? `// ${comment}\n\n` : "";
    const pkg = this.generatePackageDeclaration(packageName);
    const imp = this.generateImports(imports);
    
    return `${header}${pkg}\n\n${imp}\n\n`;
  }

  static escapeString(str: string): string {
    return str
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
  }

  static formatGoCode(code: string): string {
    // Basic Go code formatting
    const lines = code.split("\n");
    let indentLevel = 0;
    const formattedLines: string[] = [];

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      if (trimmedLine === "") {
        formattedLines.push("");
        continue;
      }

      // Decrease indent for closing braces
      if (trimmedLine === "}" || trimmedLine.endsWith("})")) {
        indentLevel = Math.max(0, indentLevel - 1);
      }

      // Add the line with proper indentation
      const indent = "    ".repeat(indentLevel);
      formattedLines.push(indent + trimmedLine);

      // Increase indent for opening braces
      if (trimmedLine.endsWith("{") && !trimmedLine.includes("}")) {
        indentLevel++;
      }
    }

    return formattedLines.join("\n");
  }

  static generateConstant(name: string, value: string, type?: string): string {
    const typeDecl = type ? ` ${type}` : "";
    return `const ${name}${typeDecl} = ${value}`;
  }

  static generateVariable(name: string, type: string, value?: string): string {
    const assignment = value ? ` = ${value}` : "";
    return `var ${name} ${type}${assignment}`;
  }

  static generateInterface(name: string, methods: Array<{ name: string; params: string; returns: string; comment?: string }>): string {
    const methodList = methods.map(method => {
      const comment = method.comment ? `    // ${method.comment}\n` : "";
      return `${comment}    ${method.name}(${method.params}) ${method.returns}`;
    }).join("\n");

    return `type ${name} interface {
${methodList}
}`;
  }

  static generateErrorCheck(errVar: string = "err", customMessage?: string): string {
    const message = customMessage || "an error occurred";
    return `if ${errVar} != nil {
        return fmt.Errorf("${message}: %w", ${errVar})
    }`;
  }

  static generateNilCheck(variable: string, action: string): string {
    return `if ${variable} == nil {
        ${action}
    }`;
  }

  static generateTypeAssertion(variable: string, targetType: string, okVar: string = "ok"): string {
    return `${variable}, ${okVar} := ${variable}.(${targetType})`;
  }

  static sanitizeGoIdentifier(name: string): string {
    return StringUtils.sanitizeGoIdentifier(name);
  }
}
