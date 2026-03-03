import OneUptimeOperation from "./OneUptimeOperation";
import ModelType from "./ModelType";
import { JSONObject } from "Common/Types/JSON";

// JSON Schema type for MCP tool input schemas
export interface JSONSchemaProperty {
  type: string;
  description?: string;
  enum?: Array<string | number | boolean>;
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  default?: unknown;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
  description?: string;
}

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  modelName: string;
  operation: OneUptimeOperation;
  modelType: ModelType;
  singularName: string;
  pluralName: string;
  tableName: string;
  apiPath?: string;
}

export interface ModelToolsResult {
  tools: McpToolInfo[];
  modelInfo: {
    tableName: string;
    singularName: string;
    pluralName: string;
    modelType: ModelType;
    apiPath?: string;
  };
}

// Sort direction type
export type SortDirection = 1 | -1;

// Sort object type
export type SortObject = Record<string, SortDirection>;

export interface OneUptimeToolCallArgs {
  id?: string;
  data?: JSONObject;
  query?: JSONObject;
  select?: JSONObject;
  skip?: number;
  limit?: number;
  sort?: SortObject;
}
