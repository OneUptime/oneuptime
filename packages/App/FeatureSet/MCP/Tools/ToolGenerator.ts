/**
 * Tool Generator
 * Generates MCP tools for OneUptime models
 */

import DatabaseModels from "Common/Models/DatabaseModels/Index";
import AnalyticsModels from "Common/Models/AnalyticsModels/Index";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { ModelSchema, ModelSchemaType } from "Common/Utils/Schema/ModelSchema";
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
  withoutFieldDescriptions,
  ZodToJsonSchemaResult,
} from "./SchemaConverter";
import {
  DESCRIBE_RESOURCE_TOOL_NAME,
  generateHelperTools,
} from "./HelperTools";
import { generatePublicStatusPageTools } from "./PublicStatusPageTools";
import {
  readOnlyToolAnnotations,
  writeToolAnnotations,
} from "./ToolAnnotations";
import { generateWorkflowTools } from "./WorkflowTools";
import {
  getSelectableFieldsForModel,
  SelectableFieldsInfo,
} from "../Services/SelectFieldGenerator";
import { LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT } from "../Config/ServerConfig";
import {
  getApiPluralName,
  getApiSingularName,
} from "Common/Utils/ModelApiName";
import MCPLogger from "../Utils/MCPLogger";

/*
 * tools/list is one answer that many clients load whole, before anything is
 * asked, so what a tool says here is paid for on every connection and many
 * times over. A list and a count tool state how a filter is written and leave
 * the fields to oneuptime_describe_resource, which holds every field of a
 * resource and is asked only when it is needed. Tests/ToolListBudget holds the
 * answer to a size.
 */
const QUERY_DESCRIPTION: string = `A field's value, or an operator such as {"_type":"GreaterThan","value":...}. Fields and operators: ${DESCRIBE_RESOURCE_TOOL_NAME}.`;

const FIELD_DETAILS_HINT: string = `Fields: ${DESCRIBE_RESOURCE_TOOL_NAME}.`;

// Any field, so the fields are not listed tool by tool.
function buildQueryProperty(): JSONSchemaProperty {
  return {
    type: "object",
    description: QUERY_DESCRIPTION,
    additionalProperties: true,
  };
}

// Any sortable field, ascending or descending: the directions stay checkable.
function buildSortProperty(exampleField: string): JSONSchemaProperty {
  return {
    type: "object",
    description: `For example {"${exampleField}":"DESC"}.`,
    additionalProperties: {
      type: "string",
      enum: [SortOrder.Ascending, SortOrder.Descending],
    },
  };
}

/**
 * Annotations per operation type. Clients use readOnlyHint to auto-approve
 * safe calls and destructiveHint to require confirmation; every write is
 * destructive (see ToolAnnotations).
 */
function getAnnotationsForOperation(
  operation: OneUptimeOperation,
): ToolAnnotations {
  switch (operation) {
    case OneUptimeOperation.Read:
    case OneUptimeOperation.List:
    case OneUptimeOperation.Count:
      return readOnlyToolAnnotations();
    case OneUptimeOperation.Create:
      return writeToolAnnotations();
    case OneUptimeOperation.Update:
    case OneUptimeOperation.Delete:
      return writeToolAnnotations({ idempotent: true });
    default:
      // An operation this does not know is taken to write.
      return writeToolAnnotations();
  }
}

/**
 * Build the JSON schema property for the `select` parameter of read/list
 * tools, documenting available fields and which heavy fields are excluded
 * from the default response.
 */
function buildSelectProperty(
  selectInfo: SelectableFieldsInfo,
): JSONSchemaProperty {
  const description: string =
    selectInfo.heavyFields.length > 0
      ? `Omit for all but ${selectInfo.heavyFields.join(", ")}.`
      : "Omit for all.";

  return {
    type: "array",
    items: { type: "string" },
    description,
  };
}

/*
 * Server-side write policy. The advisory annotations (readOnlyHint /
 * destructiveHint) are honored by well-behaved clients only — many auto-approve
 * any non-read tool, so a broad API key could be used to modify or irreversibly
 * delete resources. These env switches let an operator hard-remove mutating
 * tools from the surface entirely:
 *   - MCP_READ_ONLY=true          → expose only read / list / count tools.
 *   - MCP_ALLOW_DESTRUCTIVE=false  → keep create/update but drop delete tools.
 * Defaults preserve today's behavior (every tool exposed).
 */
function isEnvFlagTrue(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const normalized: string = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

export interface WritePolicy {
  // MCP_READ_ONLY: only the tools that change nothing.
  readOnly: boolean;
  // MCP_ALLOW_DESTRUCTIVE: false takes the delete tools away.
  allowDestructive: boolean;
}

export function getWritePolicy(
  env: Record<string, string | undefined>,
): WritePolicy {
  return {
    readOnly: isEnvFlagTrue(env["MCP_READ_ONLY"]),
    allowDestructive:
      env["MCP_ALLOW_DESTRUCTIVE"] === undefined
        ? true
        : isEnvFlagTrue(env["MCP_ALLOW_DESTRUCTIVE"]),
  };
}

const WRITE_POLICY: WritePolicy = getWritePolicy(process.env);

const WRITE_OPERATIONS: ReadonlySet<OneUptimeOperation> = new Set([
  OneUptimeOperation.Create,
  OneUptimeOperation.Update,
  OneUptimeOperation.Delete,
]);

export function applyWritePolicy(
  tools: McpToolInfo[],
  policy: WritePolicy,
): McpToolInfo[] {
  // Fast path: default policy exposes everything.
  if (!policy.readOnly && policy.allowDestructive) {
    return tools;
  }

  const kept: McpToolInfo[] = tools.filter((tool: McpToolInfo) => {
    const isWrite: boolean =
      WRITE_OPERATIONS.has(tool.operation) ||
      tool.annotations?.readOnlyHint === false;
    /*
     * The delete tools, and not every tool whose destructiveHint is true:
     * every write says it is destructive (ToolAnnotations), and this setting
     * has always kept the create and update tools.
     */
    const deletes: boolean = tool.operation === OneUptimeOperation.Delete;

    if (policy.readOnly && isWrite) {
      return false;
    }
    if (!policy.allowDestructive && deletes) {
      return false;
    }
    return true;
  });

  const removed: number = tools.length - kept.length;
  if (removed > 0) {
    MCPLogger.info(
      `MCP write policy active (readOnly=${policy.readOnly}, allowDestructive=${policy.allowDestructive}): removed ${removed} mutating tool(s) from the surface.`,
    );
  }
  return kept;
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
  const helperTools: McpToolInfo[] = generateHelperTools();
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

  const policedTools: McpToolInfo[] = applyWritePolicy(
    uniqueTools,
    WRITE_POLICY,
  );

  MCPLogger.info(
    `Generated ${policedTools.length} MCP tools for OneUptime models (including ${workflowTools.length} workflow tools, ${helperTools.length} helper tools and ${publicStatusPageTools.length} public status page tools)`,
  );
  return policedTools;
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
    createListTool(modelName, singularName, pluralName, apiPath, selectInfo),
    createUpdateTool(
      modelName,
      singularName,
      pluralName,
      apiPath,
      updateSchema,
    ),
    createDeleteTool(modelName, singularName, pluralName, apiPath),
    createCountTool(modelName, singularName, pluralName, apiPath),
  ];

  return {
    tools: tools.map((tool: McpToolInfo): McpToolInfo => {
      return withKeptToolName(tool, model);
    }),
    modelInfo,
  };
}

// What each operation's tool name starts with, before the model's name.
const TOOL_NAME_PREFIXES: Readonly<Record<OneUptimeOperation, string>> = {
  [OneUptimeOperation.Create]: "create",
  [OneUptimeOperation.Read]: "get",
  [OneUptimeOperation.List]: "list",
  [OneUptimeOperation.Update]: "update",
  [OneUptimeOperation.Delete]: "delete",
  [OneUptimeOperation.Count]: "count",
};

/*
 * A tool is named by the names the API keeps (Common/Utils/ModelApiName): a
 * model renamed on screen (#6817: On-Call Duty Policies are On-Call
 * Policies) keeps the names agents and their allowed tools call
 * (list_on_call_duty_policies), while the tool's title and description say
 * what it is called now. A model never renamed is named as it always was.
 */
export function withKeptToolName(
  tool: McpToolInfo,
  model: DatabaseBaseModel,
): McpToolInfo {
  const apiSingularName: string = getApiSingularName(model);
  const apiPluralName: string = getApiPluralName(model);
  const isPlural: boolean =
    tool.operation === OneUptimeOperation.List ||
    tool.operation === OneUptimeOperation.Count;
  const name: string = isPlural ? apiPluralName : apiSingularName;

  return {
    ...tool,
    name: `${TOOL_NAME_PREFIXES[tool.operation]}_${sanitizeToolName(name)}`,
    // What the help tools and suggestions name its tools by.
    ...(apiSingularName !== tool.singularName ? { apiSingularName } : {}),
    ...(apiPluralName !== tool.pluralName ? { apiPluralName } : {}),
  };
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
  const timeColumn: string = model.defaultSortColumn;

  const tools: McpToolInfo[] = [
    createAnalyticsListTool(
      modelName,
      singularName,
      pluralName,
      apiPath,
      timeColumn,
    ),
    createAnalyticsCountTool(
      modelName,
      singularName,
      pluralName,
      apiPath,
      timeColumn,
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
    description: `Create a ${singularName}. projectId comes from your credentials. ${FIELD_DETAILS_HINT}`,
    inputSchema: {
      type: "object",
      // Only the fields a call cannot leave out say what they mean.
      properties: withoutFieldDescriptions(
        schemaProperties.properties || {},
        schemaProperties.required || [],
      ),
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
    description: `Get one ${singularName} by ID.`,
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "ID.",
        },
        select: buildSelectProperty(selectInfo),
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
  selectInfo: SelectableFieldsInfo,
): McpToolInfo {
  return {
    name: `list_${sanitizeToolName(pluralName)}`,
    title: `List ${pluralName}`,
    description: `List ${pluralName}, with the total count.`,
    inputSchema: {
      type: "object",
      properties: {
        query: buildQueryProperty(),
        select: buildSelectProperty(selectInfo),
        skip: {
          type: "number",
        },
        limit: {
          type: "number",
          description: `Default: ${LIST_DEFAULT_LIMIT}, maximum: ${LIST_MAX_LIMIT}.`,
        },
        sort: buildSortProperty("createdAt"),
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
    description: `Update one ${singularName} by ID: only the fields sent change. ${FIELD_DETAILS_HINT}`,
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "ID.",
        },
        ...withoutFieldDescriptions(schemaProperties.properties || {}),
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
    description: `Permanently delete one ${singularName} by ID.`,
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "ID.",
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
): McpToolInfo {
  return {
    name: `count_${sanitizeToolName(pluralName)}`,
    title: `Count ${pluralName}`,
    description: `Count ${pluralName}, all or those a filter matches.`,
    inputSchema: {
      type: "object",
      properties: {
        query: buildQueryProperty(),
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
  timeColumn: string,
): McpToolInfo {
  return {
    name: `list_${sanitizeToolName(pluralName)}`,
    title: `List ${pluralName}`,
    description: `Query ${pluralName} telemetry. Telemetry tables are large: always filter on ${timeColumn} and keep limit small (10-50).`,
    inputSchema: {
      type: "object",
      properties: {
        query: buildQueryProperty(),
        select: {
          type: "array",
          items: { type: "string" },
          description:
            "Field names to return. Select only what you need: telemetry rows can be large.",
        },
        skip: {
          type: "number",
        },
        limit: {
          type: "number",
          description: `Default: ${LIST_DEFAULT_LIMIT}, maximum: ${LIST_MAX_LIMIT}.`,
        },
        sort: buildSortProperty(timeColumn),
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
  timeColumn: string,
): McpToolInfo {
  return {
    name: `count_${sanitizeToolName(pluralName)}`,
    title: `Count ${pluralName}`,
    description: `Count ${pluralName} telemetry, all of it or what a filter matches. Prefer to filter on ${timeColumn}.`,
    inputSchema: {
      type: "object",
      properties: {
        query: buildQueryProperty(),
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
