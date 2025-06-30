import DatabaseModels from "Common/Models/DatabaseModels/Index";
import AnalyticsModels from "Common/Models/AnalyticsModels/Index";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import ModelType from "../Types/ModelType";
import { McpToolInfo, ModelToolsResult } from "../Types/McpTypes";
import { ModelSchema, ModelSchemaType } from "Common/Utils/Schema/ModelSchema";
import { AnalyticsModelSchema, AnalyticsModelSchemaType } from "Common/Utils/Schema/AnalyticsModelSchema";
import MCPLogger from "./MCPLogger";

export default class DynamicToolGenerator {
  
  /**
   * Sanitize a name to be valid for MCP tool names
   * MCP tool names can only contain [a-z0-9_-]
   */
  private static sanitizeToolName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_')  // Replace invalid characters with underscores
      .replace(/_+/g, '_')           // Replace multiple underscores with single underscore
      .replace(/^_|_$/g, '');        // Remove leading/trailing underscores
  }

  /**
   * Convert a Zod schema to JSON Schema format for MCP tools
   * This is a simple converter that extracts the OpenAPI specification from Zod schemas
   */
  private static zodToJsonSchema(zodSchema: ModelSchemaType | AnalyticsModelSchemaType): any {
    try {
      // The Zod schemas in this project are extended with OpenAPI metadata
      // We can extract the shape and create a basic JSON schema
      const shape = (zodSchema as any)._def?.shape;

      if (!shape) {

       
        return {
          type: "object",
          properties: {},
          additionalProperties: false
        };
      }

      const properties: any = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape())) {
        const zodField = value as any;
        
        // Extract OpenAPI metadata if available
        const openApiConfig = zodField._def?.openapi;
        
        if (openApiConfig) {
          properties[key] = {
            type: openApiConfig.type || "string",
            description: openApiConfig.description || `${key} field`,
            ...(openApiConfig.example && { example: openApiConfig.example }),
            ...(openApiConfig.format && { format: openApiConfig.format }),
            ...(openApiConfig.default !== undefined && { default: openApiConfig.default })
          };
        } else {
          // Fallback for fields without OpenAPI metadata
          properties[key] = {
            type: "string",
            description: `${key} field`
          };
        }

        // Check if field is required (not optional)
        if (!zodField._def?.typeName || zodField._def.typeName !== 'ZodOptional') {
          required.push(key);
        }
      }

      return {
        type: "object",
        properties,
        required: required.length > 0 ? required : undefined,
        additionalProperties: false
      };
    } catch (error) {
      
      return {
        type: "object",
        properties: {},
        additionalProperties: false
      };
    }
  }
  
  /**
   * Generate all MCP tools for all OneUptime models
   */
  public static generateAllTools(): McpToolInfo[] {
    const allTools: McpToolInfo[] = [];
    
    // Generate tools for Database Models
    for (const ModelClass of DatabaseModels) {
      try {
        const model: DatabaseBaseModel = new ModelClass();
        const tools = this.generateToolsForDatabaseModel(model, ModelClass);
        allTools.push(...tools.tools);
      } catch (error) {
        MCPLogger.error(`Error generating tools for database model ${ModelClass.name}: ${error}`);
      }
    }
    
    // Generate tools for Analytics Models  
    for (const ModelClass of AnalyticsModels) {
      try {
        const model: AnalyticsBaseModel = new ModelClass();
        const tools = this.generateToolsForAnalyticsModel(model, ModelClass);
        allTools.push(...tools.tools);
      } catch (error) {
        MCPLogger.error(`Error generating tools for analytics model ${ModelClass.name}: ${error}`);
      }
    }
    
    MCPLogger.info(`Generated ${allTools.length} MCP tools for OneUptime models`);
    return allTools;
  }

  /**
   * Generate MCP tools for a specific database model
   */
  public static generateToolsForDatabaseModel(
    model: DatabaseBaseModel,
    ModelClass: { new (): DatabaseBaseModel }
  ): ModelToolsResult {
    const tools: McpToolInfo[] = [];
    const modelName = model.tableName || ModelClass.name;
    const singularName = model.singularName || modelName;
    const pluralName = model.pluralName || `${singularName}s`;
    const apiPath = model.crudApiPath?.toString();

    // Skip if model doesn't have required properties or documentation is disabled
    if (!modelName || !model.enableDocumentation || !apiPath) {
      return {
        tools: [],
        modelInfo: {
          tableName: modelName,
          singularName,
          pluralName,
          modelType: ModelType.Database,
          ...(apiPath && { apiPath })
        }
      };
    }

    // Generate schemas using ModelSchema
    const createSchema: ModelSchemaType = ModelSchema.getCreateModelSchema({ modelType: ModelClass, disableOpenApiSchema: true });
    const updateSchema: ModelSchemaType = ModelSchema.getUpdateModelSchema({ modelType: ModelClass, disableOpenApiSchema: true });
    const querySchema: ModelSchemaType = ModelSchema.getQueryModelSchema({ modelType: ModelClass, disableOpenApiSchema: true });
    const sortSchema: ModelSchemaType = ModelSchema.getSortModelSchema({ modelType: ModelClass, disableOpenApiSchema: true });

    // CREATE Tool
    const createSchemaProperties = this.zodToJsonSchema(createSchema);
    tools.push({
      name: `create_${this.sanitizeToolName(singularName)}`,
      description: `Create a new ${singularName} in OneUptime`,
      inputSchema: {
        type: "object",
        properties: createSchemaProperties.properties || {},
        required: createSchemaProperties.required || [],
        additionalProperties: false
      },
      modelName,
      operation: OneUptimeOperation.Create,
      modelType: ModelType.Database,
      singularName,
      pluralName,
      tableName: modelName,
      apiPath
    });

    // READ Tool  
    tools.push({
      name: `get_${this.sanitizeToolName(singularName)}`,
      description: `Retrieve a single ${singularName} by ID from OneUptime`,
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: `ID of the ${singularName} to retrieve`,
          }
        },
        required: ["id"],
        additionalProperties: false
      },
      modelName,
      operation: OneUptimeOperation.Read,
      modelType: ModelType.Database,
      singularName,
      pluralName,
      tableName: modelName,
      apiPath
    });

    // LIST Tool
    tools.push({
      name: `list_${this.sanitizeToolName(pluralName)}`,
      description: `List all ${pluralName} from OneUptime`,
      inputSchema: {
        type: "object",
        properties: {
          query: this.zodToJsonSchema(querySchema),
          skip: {
            type: "number",
            description: "Number of records to skip. This can be used for pagination.",
          },
          limit: {
            type: "number",
            description: "Maximum number of records to return. This can be used for pagination. Maximum value is 100.",
          },
          sort: this.zodToJsonSchema(sortSchema)
        },
        additionalProperties: false
      },
      modelName,
      operation: OneUptimeOperation.List,
      modelType: ModelType.Database,
      singularName,
      pluralName,
      tableName: modelName,
      apiPath
    });

    // UPDATE Tool
    const updateSchemaProperties = this.zodToJsonSchema(updateSchema);
    tools.push({
      name: `update_${this.sanitizeToolName(singularName)}`,
      description: `Update an existing ${singularName} in OneUptime`,
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: `ID of the ${singularName} to update`,
          },
          ...updateSchemaProperties.properties || {}
        },
        required: ["id"],
        additionalProperties: false
      },
      modelName,
      operation: OneUptimeOperation.Update,
      modelType: ModelType.Database,
      singularName,
      pluralName,
      tableName: modelName,
      apiPath
    });

    // DELETE Tool
    tools.push({
      name: `delete_${this.sanitizeToolName(singularName)}`,
      description: `Delete a ${singularName} from OneUptime`,
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: `ID of the ${singularName} to delete`,
          }
        },
        required: ["id"],
        additionalProperties: false
      },
      modelName,
      operation: OneUptimeOperation.Delete,
      modelType: ModelType.Database,
      singularName,
      pluralName,
      tableName: modelName,
      apiPath
    });

    // COUNT Tool
    tools.push({
      name: `count_${this.sanitizeToolName(pluralName)}`,
      description: `Count the number of ${pluralName} in OneUptime`,
      inputSchema: {
        type: "object",
        properties: {
          query: this.zodToJsonSchema(querySchema)
        },
        additionalProperties: false
      },
      modelName,
      operation: OneUptimeOperation.Count,
      modelType: ModelType.Database,
      singularName,
      pluralName,
      tableName: modelName,
      apiPath
    });

    return {
      tools,
      modelInfo: {
        tableName: modelName,
        singularName,
        pluralName,
        modelType: ModelType.Database,
        apiPath
      }
    };
  }

  /**
   * Generate MCP tools for a specific analytics model
   */
  public static generateToolsForAnalyticsModel(
    model: AnalyticsBaseModel,
    ModelClass: { new (): AnalyticsBaseModel }
  ): ModelToolsResult {
    const tools: McpToolInfo[] = [];
    const modelName = model.tableName || ModelClass.name;
    const singularName = model.singularName || modelName;
    const pluralName = model.pluralName || `${singularName}s`;
    const apiPath = model.crudApiPath?.toString();

    // Skip if model doesn't have required properties
    if (!modelName || !apiPath) {
      return {
        tools: [],
        modelInfo: {
          tableName: modelName,
          singularName,
          pluralName,
          modelType: ModelType.Analytics,
          apiPath
        }
      };
    }

    // Generate schemas using AnalyticsModelSchema
    const createSchema: AnalyticsModelSchemaType = AnalyticsModelSchema.getCreateModelSchema({ modelType: ModelClass, disableOpenApiSchema: true });
    const querySchema: AnalyticsModelSchemaType = AnalyticsModelSchema.getQueryModelSchema({ modelType: ModelClass, disableOpenApiSchema: true });
    const selectSchema: AnalyticsModelSchemaType = AnalyticsModelSchema.getSelectModelSchema({ modelType: ModelClass });
    const sortSchema: AnalyticsModelSchemaType = AnalyticsModelSchema.getSortModelSchema({ modelType: ModelClass, disableOpenApiSchema: true });

    // CREATE Tool for Analytics
    const analyticsCreateSchemaProperties = this.zodToJsonSchema(createSchema);
    tools.push({
      name: `create_${this.sanitizeToolName(singularName)}`,
      description: `Create a new ${singularName} analytics record in OneUptime`,
      inputSchema: {
        type: "object",
        properties: analyticsCreateSchemaProperties.properties || {},
        required: analyticsCreateSchemaProperties.required || [],
        additionalProperties: false
      },
      modelName,
      operation: OneUptimeOperation.Create,
      modelType: ModelType.Analytics,
      singularName,
      pluralName,
      tableName: modelName,
      apiPath
    });

    // LIST Tool for Analytics (most common operation)
    tools.push({
      name: `list_${this.sanitizeToolName(pluralName)}`,
      description: `Query ${pluralName} analytics data from OneUptime`,
      inputSchema: {
        type: "object",
        properties: {
          query: this.zodToJsonSchema(querySchema),
          select: this.zodToJsonSchema(selectSchema),
          skip: {
            type: "number",
            description: "Number of records to skip",
          },
          limit: {
            type: "number",
            description: "Maximum number of records to return",
          },
          sort: this.zodToJsonSchema(sortSchema)
        },
        additionalProperties: false
      },
      modelName,
      operation: OneUptimeOperation.List,
      modelType: ModelType.Analytics,
      singularName,
      pluralName,
      tableName: modelName,
      apiPath
    });

    // COUNT Tool for Analytics
    tools.push({
      name: `count_${this.sanitizeToolName(pluralName)}`,
      description: `Count ${pluralName} analytics records in OneUptime`,
      inputSchema: {
        type: "object",
        properties: {
          query: this.zodToJsonSchema(querySchema)
        },
        additionalProperties: false
      },
      modelName,
      operation: OneUptimeOperation.Count,
      modelType: ModelType.Analytics,
      singularName,
      pluralName,
      tableName: modelName,
      apiPath
    });

    return {
      tools,
      modelInfo: {
        tableName: modelName,
        singularName,
        pluralName,
        modelType: ModelType.Analytics,
        apiPath
      }
    };
  }
}
