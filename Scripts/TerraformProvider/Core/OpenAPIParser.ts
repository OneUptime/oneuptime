import fs from "fs";
import { OpenAPISpec, OpenAPIOperation, TerraformResource, TerraformDataSource, TerraformAttribute } from "./Types";
import { StringUtils } from "./StringUtils";

export class OpenAPIParser {
  public spec: OpenAPISpec | null = null;

  async parseOpenAPISpec(filePath: string): Promise<OpenAPISpec> {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      this.spec = JSON.parse(content) as OpenAPISpec;
      return this.spec;
    } catch (error) {
      throw new Error(`Failed to parse OpenAPI spec: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  setSpec(spec: OpenAPISpec): void {
    this.spec = spec;
  }

  getResources(): TerraformResource[] {
    if (!this.spec) {
      throw new Error("OpenAPI spec not loaded. Call parseOpenAPISpec first.");
    }

    const resources: TerraformResource[] = [];
    const resourceMap = new Map<string, Partial<TerraformResource>>();

    // Group operations by resource
    for (const [path, pathItem] of Object.entries(this.spec.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!operation.operationId || !operation.tags || operation.tags.length === 0) {
          continue;
        }

        const resourceName = this.extractResourceName(path, operation);
        if (!resourceName) continue;

        if (!resourceMap.has(resourceName)) {
          resourceMap.set(resourceName, {
            name: resourceName,
            goTypeName: StringUtils.toPascalCase(resourceName),
            operations: {},
            schema: {}
          });
        }

        const resource = resourceMap.get(resourceName)!;
        const operationType = this.getOperationType(method, path, operation);

        if (operationType && resource.operations) {
          // Add method and path to operation for later use
          const enhancedOperation = {
            ...operation,
            method: method,
            path: path
          };
          resource.operations[operationType] = enhancedOperation;
        }
      }
    }

    // Convert to array and generate schemas
    for (const resource of resourceMap.values()) {
      if (resource.name && resource.goTypeName && resource.operations) {
        resource.schema = this.generateResourceSchema(resource.operations);
        resources.push(resource as TerraformResource);
      }
    }

    return resources;
  }

  getDataSources(): TerraformDataSource[] {
    if (!this.spec) {
      throw new Error("OpenAPI spec not loaded. Call parseOpenAPISpec first.");
    }

    const dataSources: TerraformDataSource[] = [];
    const dataSourceMap = new Map<string, Partial<TerraformDataSource>>();

    // Look for GET operations that can be used as data sources
    for (const [path, pathItem] of Object.entries(this.spec.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (method !== "get" || !operation.operationId || !operation.tags || operation.tags.length === 0) {
          continue;
        }

        const resourceName = this.extractResourceName(path, operation);
        if (!resourceName) continue;

        const dataSourceName = `${resourceName}_data`;
        
        if (!dataSourceMap.has(dataSourceName)) {
          dataSourceMap.set(dataSourceName, {
            name: dataSourceName,
            goTypeName: StringUtils.toPascalCase(dataSourceName),
            operations: {},
            schema: {}
          });
        }

        const dataSource = dataSourceMap.get(dataSourceName)!;
        const isListOperation = this.isListOperation(path, operation);

        if (dataSource.operations) {
          // Add method and path to operation for later use
          const enhancedOperation = {
            ...operation,
            method: method,
            path: path
          };
          
          if (isListOperation) {
            dataSource.operations.list = enhancedOperation;
          } else {
            dataSource.operations.read = enhancedOperation;
          }
        }
      }
    }

    // Convert to array and generate schemas
    for (const dataSource of dataSourceMap.values()) {
      if (dataSource.name && dataSource.goTypeName && dataSource.operations) {
        dataSource.schema = this.generateDataSourceSchema(dataSource.operations);
        dataSources.push(dataSource as TerraformDataSource);
      }
    }

    return dataSources;
  }

  private extractResourceName(path: string, operation: OpenAPIOperation): string | null {
    // Try to extract from tags first
    if (operation.tags && operation.tags.length > 0 && operation.tags[0]) {
      return StringUtils.toSnakeCase(operation.tags[0]);
    }

    // Fallback to path analysis
    const pathSegments = path.split("/").filter(segment => segment && !segment.startsWith("{"));
    if (pathSegments.length > 0) {
      const lastSegment = pathSegments[pathSegments.length - 1];
      if (lastSegment) {
        return StringUtils.toSnakeCase(lastSegment);
      }
    }

    return null;
  }

  private getOperationType(method: string, path: string, operation: OpenAPIOperation): 
    "create" | "read" | "update" | "delete" | "list" | null {
    const lowerMethod = method.toLowerCase();
    
    switch (lowerMethod) {
      case "post":
        return "create";
      case "get":
        return this.isListOperation(path, operation) ? "list" : "read";
      case "put":
      case "patch":
        return "update";
      case "delete":
        return "delete";
      default:
        return null;
    }
  }

  private isListOperation(path: string, _operation: OpenAPIOperation): boolean {
    // Check if path ends with collection (not individual resource)
    const hasIdParam = path.includes("{id}") || path.includes("{") && path.endsWith("}");
    return !hasIdParam;
  }

  private generateResourceSchema(operations: any): Record<string, TerraformAttribute> {
    const schema: Record<string, TerraformAttribute> = {};

    // Always add id field for resources
    schema["id"] = {
      type: "string",
      description: "Unique identifier for the resource",
      computed: true
    };

    // Extract schema from operations
    if (operations.create) {
      this.addSchemaFromOperation(schema, operations.create, false);
    }
    if (operations.update) {
      this.addSchemaFromOperation(schema, operations.update, false);
    }
    if (operations.read) {
      this.addSchemaFromOperation(schema, operations.read, true);
    }

    return schema;
  }

  private generateDataSourceSchema(operations: any): Record<string, TerraformAttribute> {
    const schema: Record<string, TerraformAttribute> = {};

    // Add filter fields for data sources
    schema["id"] = {
      type: "string",
      description: "Identifier to filter by",
      required: false
    };

    schema["name"] = {
      type: "string",
      description: "Name to filter by",
      required: false
    };

    // Extract schema from read operations
    if (operations.read) {
      this.addSchemaFromOperation(schema, operations.read, true);
    }
    if (operations.list) {
      this.addSchemaFromOperation(schema, operations.list, true);
    }

    return schema;
  }

  private addSchemaFromOperation(schema: Record<string, TerraformAttribute>, operation: OpenAPIOperation, computed: boolean): void {
    // Add parameters as schema fields
    if (operation.parameters) {
      for (const param of operation.parameters) {
        if (param.in === "path" || param.name === "id") continue;
        
        schema[StringUtils.toSnakeCase(param.name)] = {
          type: this.mapOpenAPITypeToTerraform(param.schema.type || "string"),
          description: param.description || "",
          required: computed ? false : param.required || false,
          computed: computed
        };
      }
    }

    // Add request body schema fields
    if (operation.requestBody && !computed) {
      const content = operation.requestBody.content["application/json"];
      if (content && content.schema) {
        this.addSchemaFromOpenAPISchema(schema, content.schema, computed);
      }
    }

    // Add response schema fields for read operations
    if (computed && operation.responses) {
      const successResponse = operation.responses["200"] || operation.responses["201"];
      if (successResponse && successResponse.content) {
        const content = successResponse.content["application/json"];
        if (content && content.schema) {
          this.addSchemaFromOpenAPISchema(schema, content.schema, true);
        }
      }
    }
  }

  private addSchemaFromOpenAPISchema(schema: Record<string, TerraformAttribute>, openApiSchema: any, computed: boolean): void {
    if (openApiSchema.properties) {
      for (const [propName, propSchema] of Object.entries(openApiSchema.properties)) {
        const terraformName = StringUtils.toSnakeCase(propName);
        if (terraformName === "id") continue; // Already handled
        
        const prop = propSchema as any;
        schema[terraformName] = {
          type: this.mapOpenAPITypeToTerraform(prop.type || "string"),
          description: prop.description || "",
          required: computed ? false : (openApiSchema.required?.includes(propName) || false),
          computed: computed
        };
      }
    }
  }

  private mapOpenAPITypeToTerraform(openApiType: string): string {
    switch (openApiType) {
      case "integer":
      case "number":
        return "number";
      case "boolean":
        return "bool";
      case "array":
        return "list";
      case "object":
        return "map";
      default:
        return "string";
    }
  }
}
