import fs from "fs";
import path from "path";

export class TypeConflictResolver {
  private static getResourceNameFromFileName(fileName: string): string {
    // Extract resource name from filename like "alert_resource_gen.go" -> "Alert"
    const baseName = path.basename(fileName, ".go");
    const resourceName = baseName.replace(/_resource_gen$|_data_source_gen$/, "");
    
    // Convert to PascalCase
    return resourceName
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join("");
  }

  private static findTypeDefinitions(content: string): string[] {
    const typeRegex = /^type\s+(\w+Type)\s+struct/gm;
    const types: string[] = [];
    let match;

    while ((match = typeRegex.exec(content)) !== null) {
      if (match[1]) {
        types.push(match[1]);
      }
    }

    return types;
  }

  private static findNewValueFunctions(content: string): string[] {
    const funcRegex = /^func\s+(New\w+(?:Value|Type)(?:Null|Unknown|Must)?)\s*\(/gm;
    const functions: string[] = [];
    let match;

    while ((match = funcRegex.exec(content)) !== null) {
      if (match[1]) {
        functions.push(match[1]);
      }
    }

    return functions;
  }

  private static findValueTypes(content: string): string[] {
    const typeRegex = /^type\s+(\w+Value)\s+struct/gm;
    const types: string[] = [];
    let match;

    while ((match = typeRegex.exec(content)) !== null) {
      if (match[1]) {
        types.push(match[1]);
      }
    }

    return types;
  }

  public static resolveTypeConflicts(providerPath: string): void {
    const files = fs
      .readdirSync(providerPath)
      .filter((file) => file.endsWith("_resource_gen.go") || file.endsWith("_data_source_gen.go"))
      .filter((file) => !file.includes("provider_gen.go"));

    // Track all type conflicts
    const typeUsageMap = new Map<string, string[]>();
    const fileContents = new Map<string, string>();

    // First pass: identify all types and their usage
    for (const file of files) {
      const filePath = path.join(providerPath, file);
      const content = fs.readFileSync(filePath, "utf8");
      fileContents.set(file, content);

      const types = [
        ...this.findTypeDefinitions(content),
        ...this.findNewValueFunctions(content),
        ...this.findValueTypes(content),
      ];

      for (const typeName of types) {
        if (!typeUsageMap.has(typeName)) {
          typeUsageMap.set(typeName, []);
        }
        typeUsageMap.get(typeName)!.push(file);
      }
    }

    // Identify conflicts (types used in multiple files)
    const conflicts = new Map<string, string[]>();
    for (const [typeName, fileList] of typeUsageMap) {
      if (fileList.length > 1) {
        conflicts.set(typeName, fileList);
      }
    }

    if (conflicts.size === 0) {
      console.log("✅ No type conflicts found!");
      return;
    }

    console.log(`🔧 Found ${conflicts.size} type conflicts, resolving...`);

    // Resolve conflicts by prefixing with resource name
    for (const [conflictingType, fileList] of conflicts) {
      for (const fileName of fileList) {
        const resourceName = this.getResourceNameFromFileName(fileName);
        const newTypeName = `${resourceName}${conflictingType}`;
        
        console.log(`  📝 ${fileName}: ${conflictingType} -> ${newTypeName}`);

        let content = fileContents.get(fileName)!;

        // Replace type definitions
        content = content.replace(
          new RegExp(`^type\\s+${conflictingType}\\s+struct`, "gm"),
          `type ${newTypeName} struct`
        );

        // Replace function definitions
        content = content.replace(
          new RegExp(`^func\\s+${conflictingType}\\s*\\(`, "gm"),
          `func ${newTypeName}(`
        );

        // Replace function return types
        content = content.replace(
          new RegExp(`\\)\\s+${conflictingType}\\s*{`, "g"),
          `) ${newTypeName} {`
        );

        // Replace all usages of the type name
        content = content.replace(
          new RegExp(`\\b${conflictingType}\\b`, "g"),
          newTypeName
        );

        fileContents.set(fileName, content);
      }
    }

    // Write updated content back to files
    for (const [fileName, content] of fileContents) {
      const filePath = path.join(providerPath, fileName);
      fs.writeFileSync(filePath, content, "utf8");
    }

    console.log("✅ Type conflicts resolved successfully!");
  }
}
