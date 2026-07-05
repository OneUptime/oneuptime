/**
 * Tool Generator
 * Generates MCP tools for OneUptime models
 */

import DatabaseModels from "Common/Models/DatabaseModels/Index";
import AnalyticsModels from "Common/Models/AnalyticsModels/Index";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import { ModelSchema, ModelSchemaType } from "Common/Utils/Schema/ModelSchema";
import {
  AnalyticsModelSchema,
  AnalyticsModelSchemaType,
} from "Common/Utils/Schema/AnalyticsModelSchema";
import {
  McpToolInfo,
  ModelToolsResult,
  ToolAnnotations,
  JSONSchemaProperty,
} from "../Types/McpTypes";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import ModelType from "../Types/ModelType";
import {
  zodToJsonSchema,
  sanitizeToolName,
  ZodToJsonSchemaResult,
} from "./SchemaConverter";
import { generateHelperTools } from "./HelperTools";
import { generatePublicStatusPageTools } from "./PublicStatusPageTools";
import { generateWorkflowTools } from "./WorkflowTools";
import {
  getSelectableFieldsForModel,
  SelectableFieldsInfo,
} from "../Services/SelectFieldGenerator";
import { LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT } from "../Config/ServerConfig";
import MCPLogger from "../Utils/MCPLogger";

/*
 * Guidance appended to query parameter descriptions so agents can discover
 * the operator syntax the OneUptime API accepts.
 */
const QUERY_OPERATOR_HINT: string =
  'Each field accepts a direct value (exact match) or an operator object {"_type": "<Operator>", "value": ...}. ' +
  "Operators: EqualTo, NotEqual, IsNull, NotNull, EqualToOrNull, GreaterThan, LessThan, GreaterThanOrEqual, LessThanOrEqual, InBetween (numbers/dates), Search (partial text), Includes (array of values). " +
  'Example — items from the last 24 hours: {"createdAt": {"_type": "GreaterThan", "value": "2026-01-01T00:00:00.000Z"}}.';

/**
 * Annotations per operation type. Clients use readOnlyHint to auto-approve
 * safe calls and destructiveHint to require confirmation.
 */
function getAnnotationsForOperation(
  operation: OneUptimeOperation,
): ToolAnnotations {
  switch (operation) {
    case OneUptimeOperation.Read:
    case OneUptimeOperation.List:
    case OneUptimeOperation.Count:
      return { readOnlyHint: true };
    case OneUptimeOperation.Create:
      return { readOnlyHint: false, destructiveHint: false };
    case OneUptimeOperation.Update:
      return {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      };
    case OneUptimeOperation.Delete:
      return {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      };
    default:
      return {};
  }
}

/**
 * Build the JSON schema property for the `select` parameter of read/list
 * tools, documenting available fields and which heavy fields are excluded
 * from the default response.
 */
function buildSelectProperty(
  selectInfo: SelectableFieldsInfo,
  singularName: string,
): JSONSchemaProperty {
  let description: string = `Optional: field names to return for each ${singularName} (e.g. ["_id", "name"]). Omit to get all readable fields.`;

  if (selectInfo.heavyFields.length > 0) {
    description += ` Large fields excluded by default (request explicitly if needed): ${selectInfo.heavyFields.join(", ")}.`;
  }

  return {
    type: "array",
    items: { type: "string" },
    description,
  };
}

/**
 * Generate all MCP tools for all OneUptime models
 */
export function generateAllTools(): McpToolInfo[] {
  const allTools: McpToolInfo[] = [];

  // Generate tools for Database Models
  const databaseTools: McpToolInfo[] = generateDatabaseModelTools();
  allTools.push(...databaseTools);

  // Generate tools for Analytics Models
  const analyticsTools: McpToolInfo[] = generateAnalyticsModelTools();
  allTools.push(...analyticsTools);

  // Generate workflow tools (acknowledge/resolve/notes/whoami)
  const workflowTools: McpToolInfo[] = generateWorkflowTools();
  allTools.push(...workflowTools);

  // Generate helper tools for discovery and guidance
  const helperTools: McpToolInfo[] = generateHelperTools(allTools);
  allTools.push(...helperTools);

  // Generate public status page tools (no API key required)
  const publicStatusPageTools: McpToolInfo[] = generatePublicStatusPageTools();
  allTools.push(...publicStatusPageTools);

  /*
   * Guard against silent tool-name collisions: a duplicate name would make
   * the later tool unreachable and misroute calls to the wrong table.
   */
  const uniqueTools: McpToolInfo[] = [];
  const seenNames: Set<string> = new Set();
  for (const tool of allTools) {
    if (seenNames.has(tool.name)) {
      MCPLogger.error(
        `Duplicate MCP tool name '${tool.name}' (table ${tool.tableName}) — skipping. Rename the model's singular/plural name to resolve the collision.`,
      );
      continue;
    }
    seenNames.add(tool.name);
    uniqueTools.push(tool);
  }

  MCPLogger.info(
    `Generated ${uniqueTools.length} MCP tools for OneUptime models (including ${workflowTools.length} workflow tools, ${helperTools.length} helper tools and ${publicStatusPageTools.length} public status page tools)`,
  );
  return uniqueTools;
}

/**
 * Generate tools for all database models
 */
function generateDatabaseModelTools(): McpToolInfo[] {
  const tools: McpToolInfo[] = [];

  for (const ModelClass of DatabaseModels) {
    try {
      const model: DatabaseBaseModel = new ModelClass();
      const result: ModelToolsResult = generateToolsForDatabaseModel(
        model,
        ModelClass,
      );
      tools.push(...result.tools);
    } catch (error) {
      MCPLogger.error(
        `Error generating tools for database model ${ModelClass.name}: ${error}`,
      );
    }
  }

  return tools;
}

/**
 * Generate tools for all analytics models
 */
function generateAnalyticsModelTools(): McpToolInfo[] {
  const tools: McpToolInfo[] = [];

  for (const ModelClass of AnalyticsModels) {
    try {
      const model: AnalyticsBaseModel = new ModelClass();
      const result: ModelToolsResult = generateToolsForAnalyticsModel(
        model,
        ModelClass,
      );
      tools.push(...result.tools);
    } catch (error) {
      MCPLogger.error(
        `Error generating tools for analytics model ${ModelClass.name}: ${error}`,
      );
    }
  }

  return tools;
}

/**
 * Generate MCP tools for a specific database model
 */
export function generateToolsForDatabaseModel(
  model: DatabaseBaseModel,
  ModelClass: { new (): DatabaseBaseModel },
): ModelToolsResult {
  const modelName: string = model.tableName || ModelClass.name;
  const singularName: string = model.singularName || modelName;
  const pluralName: string = model.pluralName || `${singularName}s`;
  const apiPath: string | undefined = model.crudApiPath?.toString();

  const modelInfo: ModelToolsResult["modelInfo"] = {
    tableName: modelName,
    singularName,
    pluralName,
    modelType: ModelType.Database,
    ...(apiPath !== undefined ? { apiPath } : {}),
  };

  // Skip if model doesn't have required properties or MCP is disabled
  if (!modelName || !model.enableMCP || !apiPath) {
    return { tools: [], modelInfo };
  }

  // Generate schemas using ModelSchema
  const createSchema: ModelSchemaType = ModelSchema.getCreateModelSchema({
    modelType: ModelClass,
  });
  const updateSchema: ModelSchemaType = ModelSchema.getUpdateModelSchema({
    modelType: ModelClass,
  });
  const querySchema: ModelSchemaType = ModelSchema.getQueryModelSchema({
    modelType: ModelClass,
  });
  const sortSchema: ModelSchemaType = ModelSchema.getSortModelSchema({
    modelType: ModelClass,
  });

  const selectInfo: SelectableFieldsInfo = getSelectableFieldsForModel(model);

  const tools: McpToolInfo[] = [
    createCreateTool(
      modelName,
      singularName,
      pluralName,
      apiPath,
      createSchema,
    ),
    createReadTool(modelName, singularName, pluralName, apiPath, selectInfo),
    createListTool(
      modelName,
      singularName,
      pluralName,
      apiPath,
      querySchema,
      sortSchema,
      selectInfo,
    ),
    createUpdateTool(
      modelName,
      singularName,
      pluralName,
      apiPath,
      updateSchema,
    ),
    createDeleteTool(modelName, singularName, pluralName, apiPath),
    createCountTool(modelName, singularName, pluralName, apiPath, querySchema),
  ];

  return { tools, modelInfo };
}

/**
 * Generate MCP tools for a specific analytics model
 */
export function generateToolsForAnalyticsModel(
  model: AnalyticsBaseModel,
  ModelClass: { new (): AnalyticsBaseModel },
): ModelToolsResult {
  const modelName: string = model.tableName || ModelClass.name;
  const singularName: string = model.singularName || modelName;
  const pluralName: string = model.pluralName || `${singularName}s`;
  const apiPath: string | undefined = model.crudApiPath?.toString();

  const modelInfo: ModelToolsResult["modelInfo"] = {
    tableName: modelName,
    singularName,
    pluralName,
    modelType: ModelType.Analytics,
    ...(apiPath !== undefined ? { apiPath } : {}),
  };

  // Skip if model doesn't have required properties or MCP is disabled
  if (!modelName || !model.enableMCP || !apiPath) {
    return { tools: [], modelInfo };
  }

  /*
   * Analytics (telemetry) models are read-only over MCP: logs, metrics,
   * spans, and exceptions are ingested via OpenTelemetry, not created by
   * agents. Generate list and count tools only.
   */
  const querySchema: AnalyticsModelSchemaType =
    AnalyticsModelSchema.getQueryModelSchema({
      modelType: ModelClass,
      disableOpenApiSchema: true,
    });
  const selectSchema: AnalyticsModelSchemaType =
    AnalyticsModelSchema.getSelectModelSchema({
      modelType: ModelClass,
    });
  const sortSchema: AnalyticsModelSchemaType =
    AnalyticsModelSchema.getSortModelSchema({
      modelType: ModelClass,
      disableOpenApiSchema: true,
    });

  const tools: McpToolInfo[] = [
    createAnalyticsListTool(
      modelName,
      singularName,
      pluralName,
      apiPath,
      querySchema,
      selectSchema,
      sortSchema,
    ),
    createAnalyticsCountTool(
      modelName,
      singularName,
      pluralName,
      apiPath,
      querySchema,
    ),
  ];

  return { tools, modelInfo };
}

// Database Model Tool Creators

function createCreateTool(
  modelName: string,
  singularName: string,
  pluralName: string,
  apiPath: string,
  createSchema: ModelSchemaType,
): McpToolInfo {
  const schemaProperties: ZodToJsonSchemaResult = zodToJsonSchema(createSchema);

  return {
    name: `create_${sanitizeToolName(singularName)}`,
    title: `Create ${singularName}`,
    description: `Create a new ${singularName} in OneUptime. Returns the created ${singularName} object with its ID. Use this to add new ${pluralName} to your project. Note: projectId is inferred from your API key — you do not need to provide it.`,
    inputSchema: {
      type: "object",
      properties: schemaProperties.properties || {},
      required: schemaProperties.required || [],
      additionalProperties: false,
    },
    annotations: getAnnotationsForOperation(OneUptimeOperation.Create),
    modelName,
    operation: OneUptimeOperation.Create,
    modelType: ModelType.Database,
    singularName,
    pluralName,
    tableName: modelName,
    apiPath,
  };
}

function createReadTool(
  modelName: string,
  singularName: string,
  pluralName: string,
  apiPath: string,
  selectInfo: SelectableFieldsInfo,
): McpToolInfo {
  return {
    name: `get_${sanitizeToolName(singularName)}`,
    title: `Get ${singularName}`,
    description: `Retrieve a single ${singularName} by its unique ID from OneUptime. Use list_${sanitizeToolName(pluralName)} first if you need to find the ID.`,
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: `The unique identifier (UUID) of the ${singularName} to retrieve. Example: "550e8400-e29b-41d4-a716-446655440000"`,
        },
        select: buildSelectProperty(selectInfo, singularName),
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: getAnnotationsForOperation(OneUptimeOperation.Read),
    modelName,
    operation: OneUptimeOperation.Read,
    modelType: ModelType.Database,
    singularName,
    pluralName,
    tableName: modelName,
    apiPath,
  };
}

function createListTool(
  modelName: string,
  singularName: string,
  pluralName: string,
  apiPath: string,
  querySchema: ModelSchemaType,
  sortSchema: ModelSchemaType,
  selectInfo: SelectableFieldsInfo,
): McpToolInfo {
  return {
    name: `list_${sanitizeToolName(pluralName)}`,
    title: `List ${pluralName}`,
    description: `List and search ${pluralName} from OneUptime with optional filtering, pagination, and sorting. Returns an array of ${singularName} objects plus the total matching count.`,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          ...zodToJsonSchema(querySchema),
          description: `Filter criteria for ${pluralName}. ${QUERY_OPERATOR_HINT}`,
        },
        select: buildSelectProperty(selectInfo, singularName),
        skip: {
          type: "number",
          description:
            "Number of records to skip for pagination. Default: 0. Example: skip=10 to start from the 11th record.",
        },
        limit: {
          type: "number",
          description: `Maximum number of records to return. Default: ${LIST_DEFAULT_LIMIT}, Maximum: ${LIST_MAX_LIMIT}.`,
        },
        sort: {
          ...zodToJsonSchema(sortSchema),
          description: `Sort order for results. Use "ASC" for ascending or "DESC" for descending. Example: {"createdAt": "DESC"} to sort by newest first.`,
        },
      },
      additionalProperties: false,
    },
    annotations: getAnnotationsForOperation(OneUptimeOperation.List),
    modelName,
    operation: OneUptimeOperation.List,
    modelType: ModelType.Database,
    singularName,
    pluralName,
    tableName: modelName,
    apiPath,
  };
}

function createUpdateTool(
  modelName: string,
  singularName: string,
  pluralName: string,
  apiPath: string,
  updateSchema: ModelSchemaType,
): McpToolInfo {
  const schemaProperties: ZodToJsonSchemaResult = zodToJsonSchema(updateSchema);

  return {
    name: `update_${sanitizeToolName(singularName)}`,
    title: `Update ${singularName}`,
    description: `Update an existing ${singularName} in OneUptime. Only include the fields you want to change - unspecified fields will remain unchanged. Use get_${sanitizeToolName(singularName)} afterwards to see the updated record.`,
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: `The unique identifier (UUID) of the ${singularName} to update. Required. Use list_${sanitizeToolName(pluralName)} to find IDs.`,
        },
        ...(schemaProperties.properties || {}),
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: getAnnotationsForOperation(OneUptimeOperation.Update),
    modelName,
    operation: OneUptimeOperation.Update,
    modelType: ModelType.Database,
    singularName,
    pluralName,
    tableName: modelName,
    apiPath,
  };
}

function createDeleteTool(
  modelName: string,
  singularName: string,
  pluralName: string,
  apiPath: string,
): McpToolInfo {
  return {
    name: `delete_${sanitizeToolName(singularName)}`,
    title: `Delete ${singularName}`,
    description: `Permanently delete a ${singularName} from OneUptime. This action cannot be undone. Returns a confirmation message upon successful deletion.`,
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: `The unique identifier (UUID) of the ${singularName} to delete. This action is irreversible.`,
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: getAnnotationsForOperation(OneUptimeOperation.Delete),
    modelName,
    operation: OneUptimeOperation.Delete,
    modelType: ModelType.Database,
    singularName,
    pluralName,
    tableName: modelName,
    apiPath,
  };
}

function createCountTool(
  modelName: string,
  singularName: string,
  pluralName: string,
  apiPath: string,
  querySchema: ModelSchemaType,
): McpToolInfo {
  return {
    name: `count_${sanitizeToolName(pluralName)}`,
    title: `Count ${pluralName}`,
    description: `Count the total number of ${pluralName} in OneUptime, optionally filtered by query criteria. Returns a single number. Useful for dashboards, reports, or checking if records exist before listing.`,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          ...zodToJsonSchema(querySchema),
          description: `Optional filter criteria. If omitted, counts all ${pluralName}. ${QUERY_OPERATOR_HINT}`,
        },
      },
      additionalProperties: false,
    },
    annotations: getAnnotationsForOperation(OneUptimeOperation.Count),
    modelName,
    operation: OneUptimeOperation.Count,
    modelType: ModelType.Database,
    singularName,
    pluralName,
    tableName: modelName,
    apiPath,
  };
}

// Analytics Model Tool Creators

function createAnalyticsListTool(
  modelName: string,
  singularName: string,
  pluralName: string,
  apiPath: string,
  querySchema: AnalyticsModelSchemaType,
  selectSchema: AnalyticsModelSchemaType,
  sortSchema: AnalyticsModelSchemaType,
): McpToolInfo {
  return {
    name: `list_${sanitizeToolName(pluralName)}`,
    title: `List ${pluralName}`,
    description: `Query ${pluralName} telemetry data from OneUptime. IMPORTANT: telemetry tables are large — always filter by a time range and keep limits small (e.g. 10-50). ${QUERY_OPERATOR_HINT}`,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          ...zodToJsonSchema(querySchema),
          description: `Filter criteria for ${pluralName}. Always include a time-range filter. ${QUERY_OPERATOR_HINT}`,
        },
        select: {
          ...zodToJsonSchema(selectSchema),
          description: `Fields to return, as an object of field names to true (e.g. {"time": true, "body": true}). Select only the fields you need — telemetry rows can be large.`,
        },
        skip: {
          type: "number",
          description: "Number of records to skip. Default: 0.",
        },
        limit: {
          type: "number",
          description: `Maximum number of records to return. Default: ${LIST_DEFAULT_LIMIT}, Maximum: ${LIST_MAX_LIMIT}. Keep small for telemetry queries.`,
        },
        sort: {
          ...zodToJsonSchema(sortSchema),
          description: `Sort order. Use "ASC" or "DESC". Example: {"time": "DESC"} for most recent first.`,
        },
      },
      additionalProperties: false,
    },
    annotations: getAnnotationsForOperation(OneUptimeOperation.List),
    modelName,
    operation: OneUptimeOperation.List,
    modelType: ModelType.Analytics,
    singularName,
    pluralName,
    tableName: modelName,
    apiPath,
  };
}

function createAnalyticsCountTool(
  modelName: string,
  singularName: string,
  pluralName: string,
  apiPath: string,
  querySchema: AnalyticsModelSchemaType,
): McpToolInfo {
  return {
    name: `count_${sanitizeToolName(pluralName)}`,
    title: `Count ${pluralName}`,
    description: `Count ${pluralName} telemetry records in OneUptime, optionally filtered. Prefer counting with a time-range filter.`,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          ...zodToJsonSchema(querySchema),
          description: `Optional filter criteria. ${QUERY_OPERATOR_HINT}`,
        },
      },
      additionalProperties: false,
    },
    annotations: getAnnotationsForOperation(OneUptimeOperation.Count),
    modelName,
    operation: OneUptimeOperation.Count,
    modelType: ModelType.Analytics,
    singularName,
    pluralName,
    tableName: modelName,
    apiPath,
  };
}
