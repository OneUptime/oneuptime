import fs from "fs";
import {
  OpenAPISpec,
  OpenAPIOperation,
  TerraformResource,
  TerraformDataSource,
  TerraformAttribute,
} from "./Types";
import { StringUtils } from "./StringUtils";

type OperationType = "create" | "read" | "update" | "delete" | "list";

/*
 * A property parsed from an OpenAPI schema, before it is merged into a
 * Terraform attribute. Tracks which operation schemas it appeared in so
 * Required/Optional/Computed can be derived from the spec instead of guessed.
 */
interface ParsedProperty {
  attribute: TerraformAttribute;
  requiredInCreate: boolean;
}

export class OpenAPIParser {
  public spec: OpenAPISpec | null = null;

  /*
   * Resources that were discovered but skipped, with the reason. Surfaced by
   * GenerateProvider so CI can fail loudly instead of silently shipping an
   * incomplete provider.
   */
  public warnings: string[] = [];

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

    for (const [resourceName, operations] of this.groupOperationsByResource()) {
      /*
       * A Terraform resource must be creatable. Models that only expose
       * list/count/read endpoints (log tables, insight tables, ...) are not
       * manageable infrastructure — they surface as data sources instead.
       */
      if (!operations.create) {
        continue;
      }

      const resource: TerraformResource = {
        name: resourceName,
        goTypeName: StringUtils.toPascalCase(resourceName),
        operations: operations,
        schema: {},
      };
      const resourceDescription: string | undefined =
        this.getTagDescriptions().get(resourceName);
      if (resourceDescription) {
        resource.description = resourceDescription;
      }

      resource.operationSchemas = this.generateOperationSpecificSchemas(
        operations,
        resourceName,
      );
      resource.schema = this.generateResourceSchema(resource.operationSchemas);

      const writableFields: string[] = Object.entries(
        resource.operationSchemas.create || {},
      )
        .filter(([name, attr]: [string, TerraformAttribute]) => {
          return name !== "id" && !attr.computed;
        })
        .map(([name]: [string, TerraformAttribute]) => {
          return name;
        });

      if (writableFields.length === 0) {
        this.warnings.push(
          `Skipped resource "${resourceName}": its create schema has no writable fields (all columns are computed or permission-filtered).`,
        );
        continue;
      }

      resources.push(resource);
    }

    return resources;
  }

  public getDataSources(): TerraformDataSource[] {
    if (!this.spec) {
      throw new Error("OpenAPI spec not loaded. Call parseOpenAPISpec first.");
    }

    const dataSources: TerraformDataSource[] = [];

    for (const [resourceName, operations] of this.groupOperationsByResource()) {
      // A data source needs a way to read: a get-item and/or a list endpoint.
      if (!operations.read && !operations.list) {
        continue;
      }

      /*
       * Data sources intentionally share the resource's type name
       * (data "oneuptime_monitor" ...) — resource and data source namespaces
       * are separate in Terraform, and this matches every mainstream provider.
       */
      const dataSourceOperations: TerraformDataSource["operations"] = {};
      if (operations.read) {
        dataSourceOperations.read = operations.read;
      }
      if (operations.list) {
        dataSourceOperations.list = operations.list;
      }

      const dataSource: TerraformDataSource = {
        name: resourceName,
        goTypeName: StringUtils.toPascalCase(resourceName),
        operations: dataSourceOperations,
        schema: {},
      };
      const dataSourceDescription: string | undefined =
        this.getTagDescriptions().get(resourceName);
      if (dataSourceDescription) {
        dataSource.description = dataSourceDescription;
      }

      dataSource.schema = this.generateDataSourceSchema(dataSource.operations);
      dataSources.push(dataSource);
    }

    return dataSources;
  }

  /*
   * Groups every operation in the spec by resource (tag), classified by
   * operationId prefix. Count operations are dropped — POST /count is not a
   * CRUD operation and misclassifying it as "create" was the source of
   * resources that stored null ids.
   */
  private groupOperationsByResource(): Map<
    string,
    TerraformResource["operations"]
  > {
    const resourceMap: Map<string, TerraformResource["operations"]> = new Map<
      string,
      TerraformResource["operations"]
    >();

    for (const [path, pathItem] of Object.entries(this.spec!.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (
          !operation.operationId ||
          !operation.tags ||
          operation.tags.length === 0
        ) {
          this.warnings.push(
            `Skipped operation ${method.toUpperCase()} ${path}: missing operationId or tags.`,
          );
          continue;
        }

        const resourceName: string | null = this.extractResourceName(operation);
        if (!resourceName) {
          continue;
        }

        const operationType: OperationType | null = this.getOperationType(
          method,
          path,
          operation,
        );
        if (!operationType) {
          continue;
        }

        if (!resourceMap.has(resourceName)) {
          resourceMap.set(resourceName, {});
        }

        const operations: TerraformResource["operations"] =
          resourceMap.get(resourceName)!;
        operations[operationType] = {
          ...operation,
          method: method,
          path: path,
        };
      }
    }

    return resourceMap;
  }

  /*
   * Tag descriptions carry the model's tableDescription — the best available
   * human summary for a resource ("Monitors track the health of ...").
   */
  private getTagDescriptions(): Map<string, string> {
    const map: Map<string, string> = new Map<string, string>();
    for (const tag of this.spec?.tags || []) {
      if (tag.name && tag.description) {
        map.set(StringUtils.toSnakeCase(tag.name), tag.description);
      }
    }
    return map;
  }

  /*
   * Column descriptions in the spec end with an appended
   * "Permissions - Create: [...], Read: [...], Update: [...]" clause. That is
   * API-reference material, not Terraform documentation — strip it so schema
   * descriptions read like prose.
   */
  private cleanDescription(description: string): string {
    return description
      .replace(/\.?\s*Permissions - Create: \[[\s\S]*$/, ".")
      .replace(/\s+$/, "")
      .replace(/^\.$/, "");
  }

  private extractResourceName(operation: OpenAPIOperation): string | null {
    if (operation.tags && operation.tags.length > 0 && operation.tags[0]) {
      return StringUtils.toSnakeCase(operation.tags[0]);
    }
    return null;
  }

  /*
   * The spec generator (Common/Server/Utils/OpenAPI.ts) emits deterministic
   * operationIds: create<Table>, get<Table>, update<Table>, delete<Table>,
   * list<Table>, count<Table>. Classify by prefix — never by substring
   * heuristics, which misfiled POST /count as the create operation.
   */
  private getOperationType(
    method: string,
    path: string,
    operation: OpenAPIOperation,
  ): OperationType | null {
    const operationId: string = operation.operationId || "";

    if (/^create/i.test(operationId)) {
      return "create";
    }
    if (/^get/i.test(operationId)) {
      return "read";
    }
    if (/^update/i.test(operationId)) {
      return "update";
    }
    if (/^delete/i.test(operationId)) {
      return "delete";
    }
    if (/^list/i.test(operationId)) {
      return "list";
    }
    if (/^count/i.test(operationId)) {
      // Count endpoints are not CRUD operations.
      return null;
    }

    // Fallback for operations with non-conforming ids: classify by method.
    const lowerMethod: string = method.toLowerCase();
    const hasIdParam: boolean = path.includes("{id}");
    switch (lowerMethod) {
      case "get":
        return hasIdParam ? "read" : "list";
      case "put":
      case "patch":
        return "update";
      case "delete":
        return "delete";
      case "post":
        /*
         * POST on an item path is a read in the OneUptime API; a bare
         * collection POST is a create. /count and /get-list are handled by
         * the prefixes above for conforming specs; guard anyway.
         */
        if (path.endsWith("/count")) {
          return null;
        }
        if (path.endsWith("/get-list")) {
          return "list";
        }
        if (hasIdParam) {
          return "read";
        }
        return "create";
      default:
        return null;
    }
  }

  /*
   * Merges the per-operation schemas into the resource schema. The spec is
   * the source of truth:
   *   - fields in the create/update request schemas are writable
   *   - `required` on the create schema is the only source of Required
   *   - fields only in response schemas are Computed
   *   - optional writable fields that the server also returns are
   *     Optional+Computed (the server may fill defaults)
   *   - fields writable at create but absent from the update schema are
   *     immutable -> RequiresReplace
   */
  private generateResourceSchema(operationSchemas: {
    create?: Record<string, TerraformAttribute>;
    update?: Record<string, TerraformAttribute>;
    read?: Record<string, TerraformAttribute>;
  }): Record<string, TerraformAttribute> {
    const schema: Record<string, TerraformAttribute> = {};

    schema["id"] = {
      type: "string",
      description: "Unique identifier for the resource",
      computed: true,
    };

    const createSchema: Record<string, TerraformAttribute> =
      operationSchemas.create || {};
    const updateSchema: Record<string, TerraformAttribute> =
      operationSchemas.update || {};
    const readSchema: Record<string, TerraformAttribute> =
      operationSchemas.read || {};
    const hasUpdateOperation: boolean = Boolean(operationSchemas.update);

    const allFieldNames: Set<string> = new Set<string>([
      ...Object.keys(createSchema),
      ...Object.keys(updateSchema),
      ...Object.keys(readSchema),
    ]);

    for (const name of allFieldNames) {
      if (name === "id") {
        continue;
      }

      const inCreate: boolean = Object.prototype.hasOwnProperty.call(
        createSchema,
        name,
      );
      const inUpdate: boolean = Object.prototype.hasOwnProperty.call(
        updateSchema,
        name,
      );
      const inRead: boolean = Object.prototype.hasOwnProperty.call(
        readSchema,
        name,
      );

      // Prefer the writable definition for type metadata; fall back to read.
      const source: TerraformAttribute = (
        inCreate
          ? createSchema[name]
          : inUpdate
            ? updateSchema[name]
            : readSchema[name]
      ) as TerraformAttribute;

      if (!inCreate && !inUpdate) {
        // Server-managed: only ever appears in responses.
        schema[name] = {
          ...source,
          required: false,
          optional: false,
          computed: true,
        };
        continue;
      }

      const required: boolean = Boolean(
        inCreate && createSchema[name]?.required,
      );

      schema[name] = {
        ...source,
        required: required,
        /*
         * Optional writable fields are also Computed when the server returns
         * them: the server may fill defaults, and Optional+Computed (plus
         * UseStateForUnknown) is how the framework models that without
         * "inconsistent result after apply".
         */
        optional: !required,
        computed: !required && inRead,
        forceNew: inCreate && hasUpdateOperation && !inUpdate,
      };
    }

    return schema;
  }

  private generateOperationSpecificSchemas(
    operations: TerraformResource["operations"],
    resourceName: string,
  ): {
    create?: Record<string, TerraformAttribute>;
    update?: Record<string, TerraformAttribute>;
    read?: Record<string, TerraformAttribute>;
  } {
    const operationSchemas: {
      create?: Record<string, TerraformAttribute>;
      update?: Record<string, TerraformAttribute>;
      read?: Record<string, TerraformAttribute>;
    } = {};

    if (operations.create) {
      operationSchemas.create = this.extractRequestSchema(
        operations.create,
        `${resourceName}-create`,
      );
    }
    if (operations.update) {
      operationSchemas.update = this.extractRequestSchema(
        operations.update,
        `${resourceName}-update`,
      );
    }

    /*
     * The read schema is the union of every response the API can return for
     * this model: the get-item response, plus the create/update responses
     * (some models, e.g. File, have no read endpoint — server-populated
     * fields only ever appear in the create response).
     */
    const readSchema: Record<string, TerraformAttribute> = {};
    for (const operation of [
      operations.read,
      operations.create,
      operations.update,
    ]) {
      if (operation) {
        this.addResponseProperties(readSchema, operation);
      }
    }
    if (Object.keys(readSchema).length > 0) {
      operationSchemas.read = readSchema;
    }

    return operationSchemas;
  }

  private generateDataSourceSchema(
    operations: TerraformDataSource["operations"],
  ): Record<string, TerraformAttribute> {
    const schema: Record<string, TerraformAttribute> = {};

    const outputFields: Record<string, TerraformAttribute> = {};
    for (const operation of [operations.read, operations.list]) {
      if (operation) {
        this.addResponseProperties(outputFields, operation);
      }
    }

    /*
     * id and name are the lookup keys (exactly one must be set); everything
     * else is read-only output.
     */
    schema["id"] = {
      type: "string",
      description:
        "Look up by unique identifier. Exactly one of `id` or `name` must be set.",
      required: false,
      optional: true,
      computed: true,
      apiFieldName: "_id",
    };
    schema["name"] = {
      type: "string",
      description:
        "Look up by name. Exactly one of `id` or `name` must be set. Fails if the name does not match exactly one item.",
      required: false,
      optional: true,
      computed: true,
      apiFieldName: "name",
    };

    for (const [name, attr] of Object.entries(outputFields)) {
      if (name === "id" || name === "name") {
        continue;
      }
      schema[name] = {
        ...attr,
        required: false,
        optional: false,
        computed: true,
      };
    }

    return schema;
  }

  /*
   * Extracts the writable fields of a create/update operation from its
   * request body ({data: <Schema>}).
   */
  private extractRequestSchema(
    operation: OpenAPIOperation,
    context: string,
  ): Record<string, TerraformAttribute> {
    const schema: Record<string, TerraformAttribute> = {};

    const content: any = (operation.requestBody as any)?.content?.[
      "application/json"
    ];
    const dataSchema: any = content?.schema?.properties?.["data"];
    if (dataSchema) {
      this.addPropertiesFromSchema(schema, dataSchema, false, context);
    }

    return schema;
  }

  private addResponseProperties(
    schema: Record<string, TerraformAttribute>,
    operation: OpenAPIOperation,
  ): void {
    const responses: any = operation.responses;
    if (!responses) {
      return;
    }
    const successResponse: any = responses["200"] || responses["201"];
    const dataSchema: any =
      successResponse?.content?.["application/json"]?.schema?.properties?.[
        "data"
      ];
    if (dataSchema) {
      this.addPropertiesFromSchema(schema, dataSchema, true, "response");
    }
  }

  private addPropertiesFromSchema(
    schema: Record<string, TerraformAttribute>,
    openApiSchema: any,
    computed: boolean,
    context: string,
  ): void {
    const resolved: any = this.resolveSchema(openApiSchema);
    if (!resolved || !resolved.properties) {
      return;
    }

    for (const [propName, propSchema] of Object.entries(resolved.properties)) {
      const terraformName: string = StringUtils.toSnakeCase(propName);
      if (terraformName === "id" || terraformName === "_id") {
        continue;
      }

      if (schema[terraformName]) {
        // First definition wins; later passes only fill a missing description.
        const existing: TerraformAttribute = schema[terraformName]!;
        if (!existing.description) {
          const prop: any = this.resolveSchema(propSchema);
          if (prop?.description) {
            existing.description = prop.description;
          }
        }
        continue;
      }

      const attribute: ParsedProperty | null = this.parseProperty(
        propName,
        propSchema,
        resolved.required || [],
        computed,
      );
      if (attribute) {
        schema[terraformName] = attribute.attribute;
      }
    }

    void context;
  }

  /*
   * Converts one OpenAPI property into a Terraform attribute, preserving the
   * semantic signals the spec now carries: DateTime wrappers, enum values,
   * password format, array element shape, ordered-ness.
   */
  private parseProperty(
    propName: string,
    propSchema: any,
    requiredList: string[],
    computed: boolean,
  ): ParsedProperty | null {
    const prop: any = this.resolveSchema(propSchema);
    if (!prop) {
      return null;
    }

    const description: string = this.cleanDescription(prop.description || "");
    const example: any = prop.example;
    const defaultValue: any = prop.default;
    const ordered: boolean = Boolean(prop["x-ordered"]);
    const format: string | undefined = prop.format;
    const required: boolean = requiredList.includes(propName);

    const base: TerraformAttribute = {
      type: "string",
      description: description,
      required: !computed && required,
      computed: computed,
      apiFieldName: propName,
      example: example,
      default: defaultValue,
      ...(format ? { format } : {}),
    };

    /*
     * MonitorSteps wrappers become a typed nested attribute backed by the
     * hand-written monitorsteps.go module instead of a JSON string.
     */
    if (prop["x-oneuptime-type"] === "MonitorSteps") {
      return {
        attribute: { ...base, type: "monitor_steps", isMonitorSteps: true },
        requiredInCreate: required,
      };
    }

    // RFC3339 timestamps: the spec marks the DateTime wrapper explicitly.
    if (this.isDateTimeSchema(prop)) {
      return {
        attribute: { ...base, type: "string", isDateTime: true },
        requiredInCreate: required,
      };
    }

    const propType: string = prop.type || "string";

    switch (propType) {
      case "integer":
      case "number":
        return {
          attribute: { ...base, type: "number" },
          requiredInCreate: required,
        };
      case "boolean":
        return {
          attribute: { ...base, type: "bool" },
          requiredInCreate: required,
        };
      case "array": {
        const items: any = this.resolveSchema(prop.items) || {};
        const isEntityArray: boolean =
          items.type === "object" &&
          Boolean(items.properties?.["_id"] || items.properties?.["id"]);
        return {
          attribute: {
            ...base,
            type: ordered ? "list" : "set",
            elementKind: isEntityArray ? "entity" : "scalar",
            elementType: isEntityArray ? "string" : items.type || "string",
          },
          requiredInCreate: required,
        };
      }
      case "object":
        // Complex nested objects are JSON strings with subset semantic equality.
        return {
          attribute: { ...base, type: "string", isComplexObject: true },
          requiredInCreate: required,
        };
      default: {
        const attribute: TerraformAttribute = { ...base, type: "string" };
        if (Array.isArray(prop.enum) && prop.enum.length > 0) {
          attribute.enumValues = prop.enum.map((value: any) => {
            return String(value);
          });
        }
        if (format === "password") {
          attribute.sensitive = true;
        }
        return { attribute, requiredInCreate: required };
      }
    }
  }

  private isDateTimeSchema(prop: any): boolean {
    if (!prop) {
      return false;
    }
    if (prop["x-oneuptime-type"] === "DateTime") {
      return true;
    }
    if (prop.format === "date-time") {
      return true;
    }
    // Structural fallback: {_type: "DateTime", value: string} wrapper.
    const typeProp: any = prop.properties?.["_type"];
    if (typeProp) {
      const literalValues: any[] = Array.isArray(typeProp.enum)
        ? typeProp.enum
        : [];
      if (
        literalValues.includes("DateTime") ||
        typeProp.example === "DateTime"
      ) {
        return true;
      }
    }
    return false;
  }

  /*
   * Resolves $ref schemas (one level deep is enough for the generated spec;
   * nested refs are resolved recursively as they are encountered).
   */
  private resolveSchema(schema: any): any {
    if (!schema) {
      return null;
    }
    if (schema.$ref) {
      const resolved: any = this.resolveSchemaRef(schema.$ref);
      return resolved || null;
    }
    return schema;
  }

  private resolveSchemaRef(ref: string): any {
    if (!this.spec || !ref.startsWith("#/components/schemas/")) {
      return null;
    }

    const schemaName: string = ref.replace("#/components/schemas/", "");
    return this.spec.components?.schemas?.[schemaName] || null;
  }
}
