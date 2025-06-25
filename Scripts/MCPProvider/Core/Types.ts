export interface MCPServerConfig {
  outputDir: string;
  serverName: string;
  serverVersion: string;
  npmPackageName: string;
  description: string;
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
  description?: string;
  example?: any;
  items?: OpenAPISchema;
  properties?: Record<string, OpenAPISchema>;
  required?: string[];
  $ref?: string;
  allOf?: OpenAPISchema[];
  oneOf?: OpenAPISchema[];
  anyOf?: OpenAPISchema[];
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
  components: {
    schemas: Record<string, OpenAPISchema>;
    securitySchemes?: Record<string, any>;
  };
}

export interface MCPTool {
  name: string;
  description: string;
  operation: OpenAPIOperation;
  inputSchema: any;
  outputSchema?: any;
}

export interface MCPResource {
  name: string;
  description: string;
  uri: string;
  mimeType: string;
}

export interface MCPToolParameter {
  name: string;
  type: string;
  description?: string;
  required: boolean;
  example?: any;
}
