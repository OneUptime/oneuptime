import OneUptimeOperation from "./OneUptimeOperation";
import ModelType from "./ModelType";

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: any;
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

export interface OneUptimeToolCallArgs {
  id?: string;
  data?: any;
  query?: any;
  select?: any;
  skip?: number;
  limit?: number;
  sort?: any;
}
