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
import { McpToolInfo, ModelToolsResult } from "../Types/McpTypes";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import ModelType from "../Types/ModelType";
import { zodToJsonSchema, sanitizeToolName, ZodToJsonSchemaResult } from "./SchemaConverter";
import { generateHelperTools } from "./HelperTools";
import MCPLogger from "../Utils/MCPLogger";

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

    // Generate helper tools for discovery and guidance
    const helperTools: McpToolInfo[] = generateHelperTools(allTools);
    allTools.push(...helperTools);

    MCPLogger.info(`Generated ${allTools.length} MCP tools for OneUptime models (including ${helperTools.length} helper tools)`);
    return allTools;
}

/**
 * Generate tools for all database models
 */
function generateDatabaseModelTools(): McpToolInfo[] {
    const tools: McpToolInfo[] = [];

    for (const ModelClass of DatabaseModels) {
        try {
            const model: DatabaseBaseModel = new ModelClass();
            const result: ModelToolsResult = generateToolsForDatabaseModel(model, ModelClass);
            tools.push(...result.tools);
        } catch (error) {
            MCPLogger.error(
                `Error generating tools for database model ${ModelClass.name}: ${error}`
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
            const result: ModelToolsResult = generateToolsForAnalyticsModel(model, ModelClass);
            tools.push(...result.tools);
        } catch (error) {
            MCPLogger.error(
                `Error generating tools for analytics model ${ModelClass.name}: ${error}`
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
    ModelClass: { new (): DatabaseBaseModel }
): ModelToolsResult {
    const modelName: string = model.tableName || ModelClass.name;
    const singularName: string = model.singularName || modelName;
    const pluralName: string = model.pluralName || `${singularName}s`;
    const apiPath: string | undefined = model.crudApiPath?.toString();

    const modelInfo = {
        tableName: modelName,
        singularName,
        pluralName,
        modelType: ModelType.Database,
        ...(apiPath && { apiPath }),
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

    const tools: McpToolInfo[] = [
        createCreateTool(modelName, singularName, pluralName, apiPath, createSchema),
        createReadTool(modelName, singularName, pluralName, apiPath),
        createListTool(modelName, singularName, pluralName, apiPath, querySchema, sortSchema),
        createUpdateTool(modelName, singularName, pluralName, apiPath, updateSchema),
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
    ModelClass: { new (): AnalyticsBaseModel }
): ModelToolsResult {
    const modelName: string = model.tableName || ModelClass.name;
    const singularName: string = model.singularName || modelName;
    const pluralName: string = model.pluralName || `${singularName}s`;
    const apiPath: string | undefined = model.crudApiPath?.toString();

    const modelInfo = {
        tableName: modelName,
        singularName,
        pluralName,
        modelType: ModelType.Analytics,
        apiPath,
    };

    // Skip if model doesn't have required properties or MCP is disabled
    if (!modelName || !model.enableMCP || !apiPath) {
        return { tools: [], modelInfo };
    }

    // Generate schemas using AnalyticsModelSchema
    const createSchema: AnalyticsModelSchemaType = AnalyticsModelSchema.getCreateModelSchema({
        modelType: ModelClass,
        disableOpenApiSchema: true,
    });
    const querySchema: AnalyticsModelSchemaType = AnalyticsModelSchema.getQueryModelSchema({
        modelType: ModelClass,
        disableOpenApiSchema: true,
    });
    const selectSchema: AnalyticsModelSchemaType = AnalyticsModelSchema.getSelectModelSchema({
        modelType: ModelClass,
    });
    const sortSchema: AnalyticsModelSchemaType = AnalyticsModelSchema.getSortModelSchema({
        modelType: ModelClass,
        disableOpenApiSchema: true,
    });

    const tools: McpToolInfo[] = [
        createAnalyticsCreateTool(modelName, singularName, pluralName, apiPath, createSchema),
        createAnalyticsListTool(
            modelName,
            singularName,
            pluralName,
            apiPath,
            querySchema,
            selectSchema,
            sortSchema
        ),
        createAnalyticsCountTool(modelName, singularName, pluralName, apiPath, querySchema),
    ];

    return { tools, modelInfo };
}

// Database Model Tool Creators

function createCreateTool(
    modelName: string,
    singularName: string,
    pluralName: string,
    apiPath: string,
    createSchema: ModelSchemaType
): McpToolInfo {
    const schemaProperties: ZodToJsonSchemaResult = zodToJsonSchema(createSchema);

    return {
        name: `create_${sanitizeToolName(singularName)}`,
        description: `Create a new ${singularName} in OneUptime. Returns the created ${singularName} object with its ID and all fields. Use this to add new ${pluralName} to your project.`,
        inputSchema: {
            type: "object",
            properties: schemaProperties.properties || {},
            required: schemaProperties.required || [],
            additionalProperties: false,
        },
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
    apiPath: string
): McpToolInfo {
    return {
        name: `get_${sanitizeToolName(singularName)}`,
        description: `Retrieve a single ${singularName} by its unique ID from OneUptime. Returns the complete ${singularName} object with all its fields. Use list_${sanitizeToolName(pluralName)} first if you need to find the ID.`,
        inputSchema: {
            type: "object",
            properties: {
                id: {
                    type: "string",
                    description: `The unique identifier (UUID) of the ${singularName} to retrieve. Example: "550e8400-e29b-41d4-a716-446655440000"`,
                },
            },
            required: ["id"],
            additionalProperties: false,
        },
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
    sortSchema: ModelSchemaType
): McpToolInfo {
    return {
        name: `list_${sanitizeToolName(pluralName)}`,
        description: `List and search ${pluralName} from OneUptime with optional filtering, pagination, and sorting. Returns an array of ${singularName} objects. Use the 'query' parameter to filter results by specific field values. Supports pagination via 'skip' and 'limit' parameters.`,
        inputSchema: {
            type: "object",
            properties: {
                query: {
                    ...zodToJsonSchema(querySchema),
                    description: `Filter criteria for ${pluralName}. Each field can be used to filter results. Example: {"title": "My ${singularName}"} to find by title.`,
                },
                skip: {
                    type: "number",
                    description: "Number of records to skip for pagination. Default: 0. Example: skip=10 to start from the 11th record.",
                },
                limit: {
                    type: "number",
                    description: "Maximum number of records to return. Default: 10, Maximum: 100. Example: limit=25 to get 25 records.",
                },
                sort: {
                    ...zodToJsonSchema(sortSchema),
                    description: `Sort order for results. Use 1 for ascending, -1 for descending. Example: {"createdAt": -1} to sort by newest first.`,
                },
            },
            additionalProperties: false,
        },
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
    updateSchema: ModelSchemaType
): McpToolInfo {
    const schemaProperties: ZodToJsonSchemaResult = zodToJsonSchema(updateSchema);

    return {
        name: `update_${sanitizeToolName(singularName)}`,
        description: `Update an existing ${singularName} in OneUptime. Only include the fields you want to change - unspecified fields will remain unchanged. Returns the updated ${singularName} object.`,
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
    apiPath: string
): McpToolInfo {
    return {
        name: `delete_${sanitizeToolName(singularName)}`,
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
    querySchema: ModelSchemaType
): McpToolInfo {
    return {
        name: `count_${sanitizeToolName(pluralName)}`,
        description: `Count the total number of ${pluralName} in OneUptime, optionally filtered by query criteria. Returns a single number. Useful for dashboards, reports, or checking if records exist before listing.`,
        inputSchema: {
            type: "object",
            properties: {
                query: {
                    ...zodToJsonSchema(querySchema),
                    description: `Optional filter criteria. If omitted, counts all ${pluralName}. Example: {"currentIncidentStateId": "..."} to count incidents in a specific state.`,
                },
            },
            additionalProperties: false,
        },
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

function createAnalyticsCreateTool(
    modelName: string,
    singularName: string,
    pluralName: string,
    apiPath: string,
    createSchema: AnalyticsModelSchemaType
): McpToolInfo {
    const schemaProperties: ZodToJsonSchemaResult = zodToJsonSchema(createSchema);

    return {
        name: `create_${sanitizeToolName(singularName)}`,
        description: `Create a new ${singularName} analytics record in OneUptime`,
        inputSchema: {
            type: "object",
            properties: schemaProperties.properties || {},
            required: schemaProperties.required || [],
            additionalProperties: false,
        },
        modelName,
        operation: OneUptimeOperation.Create,
        modelType: ModelType.Analytics,
        singularName,
        pluralName,
        tableName: modelName,
        apiPath,
    };
}

function createAnalyticsListTool(
    modelName: string,
    singularName: string,
    pluralName: string,
    apiPath: string,
    querySchema: AnalyticsModelSchemaType,
    selectSchema: AnalyticsModelSchemaType,
    sortSchema: AnalyticsModelSchemaType
): McpToolInfo {
    return {
        name: `list_${sanitizeToolName(pluralName)}`,
        description: `Query ${pluralName} analytics data from OneUptime`,
        inputSchema: {
            type: "object",
            properties: {
                query: zodToJsonSchema(querySchema),
                select: zodToJsonSchema(selectSchema),
                skip: {
                    type: "number",
                    description: "Number of records to skip",
                },
                limit: {
                    type: "number",
                    description: "Maximum number of records to return",
                },
                sort: zodToJsonSchema(sortSchema),
            },
            additionalProperties: false,
        },
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
    querySchema: AnalyticsModelSchemaType
): McpToolInfo {
    return {
        name: `count_${sanitizeToolName(pluralName)}`,
        description: `Count ${pluralName} analytics records in OneUptime`,
        inputSchema: {
            type: "object",
            properties: {
                query: zodToJsonSchema(querySchema),
            },
            additionalProperties: false,
        },
        modelName,
        operation: OneUptimeOperation.Count,
        modelType: ModelType.Analytics,
        singularName,
        pluralName,
        tableName: modelName,
        apiPath,
    };
}
