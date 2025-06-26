import fs from "fs";
import { OpenAPISpec, OpenAPIOperation, MCPTool, OpenAPISchema } from "./Types";
import { StringUtils } from "./StringUtils";

export class OpenAPIParser {
  public spec: OpenAPISpec | null = null;

  public async parseOpenAPISpec(filePath: string): Promise<OpenAPISpec> {
    try {
      const content: string = fs.readFileSync(filePath, "utf-8");
      this.spec = JSON.parse(content) as OpenAPISpec;
      return this.spec;
    } catch (error) {
      throw new Error(
        `Failed to parse OpenAPI spec: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  public setSpec(spec: OpenAPISpec): void {
    this.spec = spec;
  }

  public getMCPTools(): MCPTool[] {
    if (!this.spec) {
      throw new Error("OpenAPI spec not loaded. Call parseOpenAPISpec first.");
    }

    const tools: MCPTool[] = [];

    // Group operations by resource/tag
    for (const [path, pathItem] of Object.entries(this.spec.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (
          !operation.operationId ||
          !operation.tags ||
          operation.tags.length === 0
        ) {
          continue;
        }

        const tool: MCPTool = this.createMCPTool(path, method, operation);
        tools.push(tool);
      }
    }

    return tools;
  }

  private createMCPTool(
    path: string,
    method: string,
    operation: OpenAPIOperation,
  ): MCPTool {
    const toolName: string = this.generateToolName(operation);
    const description: string =
      operation.description ||
      operation.summary ||
      `${method.toUpperCase()} ${path}`;

    const inputSchema: any = this.generateInputSchema(operation);

    return {
      name: toolName,
      description: description,
      operation: {
        ...operation,
        method,
        path,
      },
      inputSchema: inputSchema,
    };
  }

  private generateToolName(operation: OpenAPIOperation): string {
    if (operation.operationId) {
      return StringUtils.toCamelCase(operation.operationId);
    }

    // Fallback to tag + summary
    const tag = operation.tags?.[0] || "api";
    const summary = operation.summary || "operation";
    return StringUtils.toCamelCase(`${tag}_${summary}`);
  }

  private generateInputSchema(operation: OpenAPIOperation): any {
    const properties: any = {};
    const required: string[] = [];

    // Add path parameters
    if (operation.parameters) {
      for (const param of operation.parameters) {
        if (
          param.in === "path" ||
          param.in === "query" ||
          param.in === "header"
        ) {
          const paramName = StringUtils.toCamelCase(param.name);
          properties[paramName] = this.convertOpenAPISchemaToJsonSchema(
            param.schema,
          );
          properties[paramName].description = param.description || "";

          if (param.required || param.in === "path") {
            required.push(paramName);
          }
        }
      }
    }

    // Add request body
    if (operation.requestBody) {
      const content = operation.requestBody.content;
      const jsonContent = content["application/json"];

      if (jsonContent && jsonContent.schema) {
        if (jsonContent.schema.properties) {
          // Flatten the request body properties into the main properties
          Object.assign(
            properties,
            this.convertOpenAPISchemaToJsonSchema(jsonContent.schema)
              .properties,
          );
          if (jsonContent.schema.required) {
            required.push(...jsonContent.schema.required);
          }
        } else {
          // If it's a reference or complex schema, add as 'data' property
          properties.data = this.convertOpenAPISchemaToJsonSchema(
            jsonContent.schema,
          );
          if (operation.requestBody.required) {
            required.push("data");
          }
        }
      }
    }

    return {
      type: "object",
      properties: properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  private convertOpenAPISchemaToJsonSchema(schema: OpenAPISchema): any {
    if (schema.$ref) {
      const resolvedSchema = this.resolveSchemaRef(schema.$ref);
      return this.convertOpenAPISchemaToJsonSchema(resolvedSchema);
    }

    const jsonSchema: any = {
      type: schema.type || "string",
    };

    if (schema.description) {
      jsonSchema.description = schema.description;
    }

    if (schema.example !== undefined) {
      jsonSchema.example = schema.example;
    }

    if (schema.format) {
      jsonSchema.format = schema.format;
    }

    if (schema.type === "array" && schema.items) {
      jsonSchema.items = this.convertOpenAPISchemaToJsonSchema(schema.items);
    }

    if (schema.properties) {
      jsonSchema.properties = {};
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        jsonSchema.properties[propName] =
          this.convertOpenAPISchemaToJsonSchema(propSchema);
      }
    }

    if (schema.required) {
      jsonSchema.required = schema.required;
    }

    return jsonSchema;
  }

  private resolveSchemaRef(ref: string): OpenAPISchema {
    if (!this.spec) {
      throw new Error("OpenAPI spec not loaded");
    }

    // Handle #/components/schemas/SchemeName format
    const refParts = ref.split("/");
    if (
      refParts[0] === "#" &&
      refParts[1] === "components" &&
      refParts[2] === "schemas"
    ) {
      const schemaName = refParts[3];
      if (schemaName && this.spec.components?.schemas?.[schemaName]) {
        return this.spec.components.schemas[schemaName];
      }
    }

    throw new Error(`Could not resolve schema reference: ${ref}`);
  }

  public getResourceTags(): string[] {
    if (!this.spec) {
      return [];
    }

    const tags = new Set<string>();

    for (const [, pathItem] of Object.entries(this.spec.paths)) {
      for (const [, operation] of Object.entries(pathItem)) {
        if (operation.tags) {
          operation.tags.forEach((tag) => {
            return tags.add(tag);
          });
        }
      }
    }

    return Array.from(tags);
  }
}
