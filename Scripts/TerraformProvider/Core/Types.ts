export interface TerraformProviderConfig {
  outputDir: string;
  providerName: string;
  providerVersion: string;
  goModuleName: string;
}

export interface OpenAPIOperation {
  operationId: string;
  method: string;
  path: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenAPIParameter[];
  requestBody?: OpenAPIRequestBody;
  responses?: Record<string, OpenAPIResponse>;
}

export interface OpenAPIParameter {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  required?: boolean;
  schema: OpenAPISchema;
  description?: string;
}

export interface OpenAPIRequestBody {
  content: Record<string, OpenAPIMediaType>;
  required?: boolean;
  description?: string;
}

export interface OpenAPIResponse {
  description: string;
  content?: Record<string, OpenAPIMediaType>;
}

export interface OpenAPIMediaType {
  schema: OpenAPISchema;
}

export interface OpenAPISchema {
  type?: string;
  format?: string;
  properties?: Record<string, OpenAPISchema>;
  items?: OpenAPISchema;
  required?: string[];
  description?: string;
  example?: any;
  enum?: any[];
  $ref?: string;
}

export interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers: Array<{
    url: string;
    description?: string;
  }>;
  paths: Record<string, Record<string, OpenAPIOperation>>;
  components?: {
    schemas?: Record<string, OpenAPISchema>;
    securitySchemes?: Record<string, any>;
  };
  tags?: Array<{
    name: string;
    description?: string;
  }>;
}

/*
 * The resource or data source a relation attribute points at, from the
 * spec's x-oneuptime-relation: `name` is its Terraform name (without the
 * provider prefix).
 */
export interface TerraformRelation {
  name: string;
  isList: boolean;
}

export interface TerraformResource {
  name: string;
  /*
   * The name this resource had before type names kept mixed-case words whole
   * (io_t_fleet for iot_fleet). Still registered, as a deprecated alias, so
   * configurations that use it keep working.
   */
  legacyName?: string | undefined;
  goTypeName: string;
  description?: string; // Human description from the spec's tag (model tableDescription)
  operations: {
    create?: OpenAPIOperation;
    read?: OpenAPIOperation;
    update?: OpenAPIOperation;
    delete?: OpenAPIOperation;
    list?: OpenAPIOperation;
  };
  schema: Record<string, TerraformAttribute>;
  operationSchemas?: {
    create?: Record<string, TerraformAttribute>;
    update?: Record<string, TerraformAttribute>;
    read?: Record<string, TerraformAttribute>;
  };
}

export interface TerraformDataSource {
  name: string;
  // See TerraformResource.legacyName.
  legacyName?: string | undefined;
  goTypeName: string;
  description?: string; // Human description from the spec's tag (model tableDescription)
  operations: {
    read?: OpenAPIOperation;
    list?: OpenAPIOperation;
  };
  schema: Record<string, TerraformAttribute>;
}

export interface TerraformAttribute {
  type: string;
  description?: string;
  required?: boolean;
  computed?: boolean;
  optional?: boolean; // Explicitly mark as optional (useful for optional+computed fields)
  sensitive?: boolean;
  forceNew?: boolean;
  default?: any;
  apiFieldName?: string; // Original OpenAPI field name for API requests
  example?: any; // Example value from OpenAPI spec
  isComplexObject?: boolean; // Flag to indicate this string field is actually a complex object
  format?: string; // OpenAPI format information (e.g., "binary", "date-time", etc.)
  isDateTime?: boolean; // RFC3339 timestamp (spec DateTime wrapper) — uses semantic instant equality
  isMonitorSteps?: boolean; // MonitorSteps wrapper — emitted as a typed nested attribute (monitorsteps.go)
  enumValues?: string[]; // Allowed values from the spec's enum — emitted as a OneOf validator
  /*
   * For list/set attributes: how elements are shaped on the wire.
   * "entity" = array of entity references ({_id: "..."}), "scalar" = plain values.
   */
  elementKind?: "entity" | "scalar";
  elementType?: string; // OpenAPI type of scalar elements ("string" | "number" | ...)
  /*
   * What a relation id (or a list of them) points at, when the spec says.
   * Set by the parser once every resource and data source is known.
   */
  relationTag?: string | undefined;
  relation?: TerraformRelation | undefined;
  /*
   * Data sources: a lookup argument. Set in configuration, it filters the
   * list the data source must find exactly one match in.
   */
  isLookupFilter?: boolean;
}

export interface GoType {
  name: string;
  type: string;
  jsonTag?: string;
  description?: string;
  required?: boolean;
}
