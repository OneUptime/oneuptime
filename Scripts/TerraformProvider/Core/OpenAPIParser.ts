import fs from "fs";
import {
  OpenAPISpec,
  OpenAPIOperation,
  TerraformResource,
  TerraformDataSource,
  TerraformAttribute,
} from "./Types";
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

  public getResources(): TerraformResource[] {
    if (!this.spec) {
      throw new Error("OpenAPI spec not loaded. Call parseOpenAPISpec first.");
    }

    const resources: TerraformResource[] = [];
    const resourceMap: Map<string, Partial<TerraformResource>> = new Map<
      string,
      Partial<TerraformResource>
    >();

    // Group operations by resource
    for (const [path, pathItem] of Object.entries(this.spec.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (
          !operation.operationId ||
          !operation.tags ||
          operation.tags.length === 0
        ) {
          continue;
        }

        const resourceName: string | null = this.extractResourceName(
          path,
          operation,
        );
        if (!resourceName) {
          continue;
        }

        if (!resourceMap.has(resourceName)) {
          resourceMap.set(resourceName, {
            name: resourceName,
            goTypeName: StringUtils.toPascalCase(resourceName),
            operations: {},
            schema: {},
          });
        }

        const resource: Partial<TerraformResource> =
          resourceMap.get(resourceName)!;
        const operationType:
          | "create"
          | "read"
          | "update"
          | "delete"
          | "list"
          | null = this.getOperationType(method, path, operation);

        if (operationType && resource.operations) {
          // Add method and path to operation for later use
          const enhancedOperation: OpenAPIOperation & {
            method: string;
            path: string;
          } = {
            ...operation,
            method: method,
            path: path,
          };
          resource.operations[operationType] = enhancedOperation;
        }
      }
    }

    // Convert to array and generate schemas
    for (const resource of resourceMap.values()) {
      if (resource.name && resource.goTypeName && resource.operations) {
        resource.schema = this.generateResourceSchema(
          resource.operations,
          resource.name,
        );
        resource.operationSchemas = this.generateOperationSpecificSchemas(
          resource.operations,
          resource.name,
        );
        resources.push(resource as TerraformResource);
      }
    }

    return resources;
  }

  public getDataSources(): TerraformDataSource[] {
    if (!this.spec) {
      throw new Error("OpenAPI spec not loaded. Call parseOpenAPISpec first.");
    }

    const dataSources: TerraformDataSource[] = [];
    const dataSourceMap: Map<string, Partial<TerraformDataSource>> = new Map<
      string,
      Partial<TerraformDataSource>
    >();

    // Look for GET operations that can be used as data sources
    for (const [path, pathItem] of Object.entries(this.spec.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (
          method !== "get" ||
          !operation.operationId ||
          !operation.tags ||
          operation.tags.length === 0
        ) {
          continue;
        }

        const resourceName: string | null = this.extractResourceName(
          path,
          operation,
        );
        if (!resourceName) {
          continue;
        }

        const dataSourceName: string = `${resourceName}_data`;

        if (!dataSourceMap.has(dataSourceName)) {
          dataSourceMap.set(dataSourceName, {
            name: dataSourceName,
            goTypeName: StringUtils.toPascalCase(dataSourceName),
            operations: {},
            schema: {},
          });
        }

        const dataSource: Partial<TerraformDataSource> =
          dataSourceMap.get(dataSourceName)!;
        const isListOperation: boolean = this.isListOperation(path, operation);

        if (dataSource.operations) {
          // Add method and path to operation for later use
          const enhancedOperation: OpenAPIOperation & {
            method: string;
            path: string;
          } = {
            ...operation,
            method: method,
            path: path,
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
        dataSource.schema = this.generateDataSourceSchema(
          dataSource.operations,
        );
        dataSources.push(dataSource as TerraformDataSource);
      }
    }

    return dataSources;
  }

  private extractResourceName(
    path: string,
    operation: OpenAPIOperation,
  ): string | null {
    // Try to extract from tags first
    if (operation.tags && operation.tags.length > 0 && operation.tags[0]) {
      return StringUtils.toSnakeCase(operation.tags[0]);
    }

    // Fallback to path analysis
    const pathSegments: string[] = path.split("/").filter((segment: string) => {
      return segment && !segment.startsWith("{");
    });
    if (pathSegments.length > 0) {
      const lastSegment: string | undefined =
        pathSegments[pathSegments.length - 1];
      if (lastSegment) {
        return StringUtils.toSnakeCase(lastSegment);
      }
    }

    return null;
  }

  private getOperationType(
    method: string,
    path: string,
    operation: OpenAPIOperation,
  ): "create" | "read" | "update" | "delete" | "list" | null {
    const lowerMethod: string = method.toLowerCase();
    const hasIdParam: boolean = path.includes("{id}");

    switch (lowerMethod) {
      case "post":
        if (hasIdParam) {
          // POST to /{resource}/{id} is usually a read operation in OneUptime API
          return "read";
        }
        // POST to /{resource} is create
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
    const hasIdParam: boolean =
      path.includes("{id}") || (path.includes("{") && path.endsWith("}"));
    return !hasIdParam;
  }

  private generateResourceSchema(
    operations: any,
    resourceName?: string,
  ): Record<string, TerraformAttribute> {
    const schema: Record<string, TerraformAttribute> = {};

    // Always add id field for resources
    schema["id"] = {
      type: "string",
      description: "Unique identifier for the resource",
      computed: true,
    };

    // First pass: Extract schema from create/update operations (input fields)
    // These define the required fields for the resource
    if (operations.create) {
      this.addSchemaFromOperation(
        schema,
        operations.create,
        false,
        `${resourceName}-create`,
      );
    }
    if (operations.update) {
      this.addSchemaFromOperation(
        schema,
        operations.update,
        false,
        `${resourceName}-update`,
      );
    }

    // Second pass: Extract schema from read operations (ensure all output fields are included)
    // But preserve the required status from create operations
    if (operations.read) {
      this.addSchemaFromOperation(
        schema,
        operations.read,
        true,
        `${resourceName}-read`,
      );
    }

    // Store the required fields from create/update operations AFTER all processing
    const requiredFields: Set<string> = new Set<string>();
    for (const [fieldName, attr] of Object.entries(schema)) {
      if ((attr as any).required) {
        requiredFields.add(fieldName);
      }
    }
    // Restore required status for fields that were required in create operations
    for (const fieldName of requiredFields) {
      if (schema[fieldName]) {
        // Only restore if the field isn't already set to required (to avoid overriding correct OpenAPI processing)
        if (schema[fieldName].required !== true) {
          schema[fieldName].required = true;
          schema[fieldName].computed = false;
        }
      }
    }

    return schema;
  }

  private generateOperationSpecificSchemas(
    operations: any,
    resourceName: string,
  ): {
    create?: Record<string, TerraformAttribute>;
    update?: Record<string, TerraformAttribute>;
    read?: Record<string, TerraformAttribute>;
  } {
    const operationSchemas: any = {};

    // Generate schema for create operation
    if (operations.create) {
      const createSchema: Record<string, TerraformAttribute> = {};
      this.addSchemaFromOperation(
        createSchema,
        operations.create,
        false,
        `${resourceName}-create-only`,
      );
      operationSchemas.create = createSchema;
    }

    // Generate schema for update operation
    if (operations.update) {
      const updateSchema: Record<string, TerraformAttribute> = {};
      this.addSchemaFromOperation(
        updateSchema,
        operations.update,
        false,
        `${resourceName}-update-only`,
      );
      operationSchemas.update = updateSchema;
    }

    // Generate schema for read operation
    if (operations.read) {
      const readSchema: Record<string, TerraformAttribute> = {};
      this.addSchemaFromOperation(
        readSchema,
        operations.read,
        true,
        `${resourceName}-read-only`,
      );
      operationSchemas.read = readSchema;
    }

    return operationSchemas;
  }

  private generateDataSourceSchema(
    operations: any,
  ): Record<string, TerraformAttribute> {
    const schema: Record<string, TerraformAttribute> = {};

    // Add filter fields for data sources
    schema["id"] = {
      type: "string",
      description: "Identifier to filter by",
      required: false,
    };

    schema["name"] = {
      type: "string",
      description: "Name to filter by",
      required: false,
    };

    // Extract schema from read operations
    if (operations.read) {
      this.addSchemaFromOperation(
        schema,
        operations.read,
        true,
        "datasource-read",
      );
    }
    if (operations.list) {
      this.addSchemaFromOperation(
        schema,
        operations.list,
        true,
        "datasource-list",
      );
    }

    return schema;
  }

  private addSchemaFromOperation(
    schema: Record<string, TerraformAttribute>,
    operation: OpenAPIOperation,
    computed: boolean,
    context?: string,
  ): void {
    // Add parameters as schema fields
    if (operation.parameters) {
      for (const param of operation.parameters) {
        if (param.in === "path" || param.name === "id") {
          continue;
        }

        schema[StringUtils.toSnakeCase(param.name)] = {
          type: this.mapOpenAPITypeToTerraform(param.schema?.type || "string"),
          description: param.description || "",
          required: computed ? false : param.required || false,
          computed: computed,
          apiFieldName: param.name, // Preserve original OpenAPI parameter name
        };
      }
    }

    // Add request body schema fields - look inside the data wrapper
    if (operation.requestBody && !computed) {
      const content: any = operation.requestBody.content?.["application/json"];
      if (content?.schema?.properties?.["data"]) {
        const dataSchema: any = content.schema.properties["data"];
        this.addSchemaFromOpenAPISchema(
          schema,
          dataSchema,
          computed,
          `${context}-requestBody`,
        );
      }
    }

    // Add response schema fields for read operations - look inside the data wrapper
    if (computed && operation.responses) {
      const successResponse: any =
        operation.responses["200"] || operation.responses["201"];
      if (
        successResponse?.content?.["application/json"]?.schema?.properties?.[
          "data"
        ]
      ) {
        const dataSchema: any =
          successResponse.content["application/json"].schema.properties["data"];
        this.addSchemaFromOpenAPISchema(
          schema,
          dataSchema,
          true,
          `${context}-response`,
        );
      }
    }
  }

  private addSchemaFromOpenAPISchema(
    schema: Record<string, TerraformAttribute>,
    openApiSchema: any,
    computed: boolean,
    context?: string,
  ): void {
    // Handle $ref schemas
    if (openApiSchema.$ref) {
      const resolvedSchema: any = this.resolveSchemaRef(openApiSchema.$ref);
      if (resolvedSchema) {
        this.addSchemaFromOpenAPISchema(
          schema,
          resolvedSchema,
          computed,
          `${context}-ref`,
        );
      }
      return;
    }

    // Check if this schema has properties defined
    const hasProperties: boolean =
      openApiSchema.properties &&
      Object.keys(openApiSchema.properties).length > 0;

    // If no properties are defined (empty CRUD schema), try to fallback to main model schema
    if (!hasProperties && openApiSchema.description) {
      const description: string = openApiSchema.description.toLowerCase();
      if (description.includes("schema for") && description.includes("model")) {
        // Extract model name from description like "Create schema for Label model. Create"
        const modelNameMatch: RegExpMatchArray | null = description.match(
          /schema for (\w+) model/,
        );
        if (modelNameMatch && modelNameMatch[1]) {
          const modelName: string = modelNameMatch[1]; // Keep original case from the description
          const mainModelSchema: any = this.resolveSchemaRef(
            `#/components/schemas/${modelName}`,
          );
          if (mainModelSchema && mainModelSchema.properties) {
            this.addSchemaFromOpenAPISchema(
              schema,
              mainModelSchema,
              computed,
              `${context}-fallback-${modelName}`,
            );
            return;
          }
        }
      }
    }

    if (openApiSchema.properties) {
      for (const [propName, propSchema] of Object.entries(
        openApiSchema.properties,
      )) {
        const terraformName: string = StringUtils.toSnakeCase(propName);
        if (terraformName === "id" || terraformName === "_id") {
          // Skip ID fields as they're handled separately
          continue;
        }

        const prop: any = propSchema as any;
        let propType: string = prop.type || "string";
        let description: string = prop.description || "";
        let example: any = prop.example;
        let defaultValue: any = prop.default;

        // Handle nested $ref
        if (prop.$ref) {
          const resolvedProp: any = this.resolveSchemaRef(prop.$ref);
          if (resolvedProp) {
            propType = resolvedProp.type || "string";
            description = resolvedProp.description || description;
            example = resolvedProp.example || example;
            defaultValue = resolvedProp.default || defaultValue;
          }
        }

        // Skip computed fields for create/update operations
        const isComputedField: boolean = [
          "createdAt",
          "updatedAt",
          "deletedAt",
          "version",
          "slug",
          "createdByUserId",
          "deletedByUserId",
        ].includes(propName);
        if (!computed && isComputedField) {
          continue;
        }

        // If field already exists and we're adding computed fields, don't override required status
        if (computed && schema[terraformName]) {
          // Update description if it's better in the read schema
          if (description && !schema[terraformName].description) {
            schema[terraformName].description = description;
          }
          // Keep the existing field but ensure it's available in responses
          // Don't overwrite fields that were defined in create/update operations
          continue;
        }

        // If field already exists and we're adding input fields, merge the properties
        if (
          !computed &&
          schema[terraformName] &&
          schema[terraformName].computed
        ) {
          // Update the existing computed field to also be an input field
          schema[terraformName] = {
            ...schema[terraformName],
            required: openApiSchema.required?.includes(propName) || false,
            computed: false, // This field can be both input and output
            apiFieldName: propName, // Preserve original OpenAPI property name
          };
          continue;
        }

        // Determine if this field should be required
        let fieldRequired: boolean = false;
        if (computed) {
          fieldRequired = false; // Computed fields are never required
        } else {
          // Check if it's explicitly required in the current schema
          const explicitlyRequired: boolean =
            openApiSchema.required?.includes(propName) || false;

          // If the field already exists and was previously marked as required, preserve that
          const existingField: TerraformAttribute | undefined =
            schema[terraformName];
          const previouslyRequired: boolean = existingField?.required || false;

          // Field is required if it's explicitly required OR was previously required
          fieldRequired = explicitlyRequired || previouslyRequired;
        }

        schema[terraformName] = {
          type: this.mapOpenAPITypeToTerraform(propType),
          description: description,
          required: fieldRequired,
          computed: computed || isComputedField,
          apiFieldName: propName, // Preserve original OpenAPI property name
          example: example, // Extract example from OpenAPI schema
          default: defaultValue, // Extract default value from OpenAPI schema
          isComplexObject: propType === "object", // Flag to indicate this string field is actually a complex object
        };
      }
    }
  }

  private resolveSchemaRef(ref: string): any {
    if (!this.spec || !ref.startsWith("#/components/schemas/")) {
      return null;
    }

    const schemaName: string = ref.replace("#/components/schemas/", "");
    return this.spec.components?.schemas?.[schemaName] || null;
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
        // For now, treat complex objects as JSON strings to handle nested structures
        // This allows users to pass complex nested objects that will be serialized to JSON
        return "string";
      default:
        return "string";
    }
  }
}
