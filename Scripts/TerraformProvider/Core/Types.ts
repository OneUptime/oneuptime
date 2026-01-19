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

export interface TerraformResource {
  name: string;
  goTypeName: string;
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
  goTypeName: string;
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
  isDefaultValueColumn?: boolean; // Field has server-side default injection, needs UseStateForUnknown() plan modifier
}

export interface GoType {
  name: string;
  type: string;
  jsonTag?: string;
  description?: string;
  required?: boolean;
}
