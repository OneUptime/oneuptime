import DatabaseModels from "Common/Models/DatabaseModels/Index";
import AnalyticsModels from "Common/Models/AnalyticsModels/Index";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import ModelType from "../Types/ModelType";
import { McpToolInfo, ModelToolsResult } from "../Types/McpTypes";
import Logger from "Common/Server/Utils/Logger";

export default class DynamicToolGenerator {
  
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
        Logger.error(`Error generating tools for database model ${ModelClass.name}: ${error}`);
      }
    }
    
    // Generate tools for Analytics Models  
    for (const ModelClass of AnalyticsModels) {
      try {
        const model: AnalyticsBaseModel = new ModelClass();
        const tools = this.generateToolsForAnalyticsModel(model, ModelClass);
        allTools.push(...tools.tools);
      } catch (error) {
        Logger.error(`Error generating tools for analytics model ${ModelClass.name}: ${error}`);
      }
    }
    
    Logger.info(`Generated ${allTools.length} MCP tools for OneUptime models`);
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

    
    // CREATE Tool
    tools.push({
      name: `oneuptime_create${singularName.replace(/\s+/g, '')}`,
      description: `Create a new ${singularName} in OneUptime`,
      inputSchema: {
        type: "object",
        properties: {
          data: {
            type: "object",
            description: `${singularName} data to create`,
          }
        },
        required: ["data"]
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
      name: `oneuptime_get${singularName.replace(/\s+/g, '')}`,
      description: `Retrieve a single ${singularName} by ID from OneUptime`,
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: `ID of the ${singularName} to retrieve`,
          }
        },
        required: ["id"]
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
      name: `oneuptime_list${pluralName.replace(/\s+/g, '')}`,
      description: `List all ${pluralName} from OneUptime`,
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "object",
            description: `Query filters for ${pluralName}`,
          },
          select: {
            type: "object", 
            description: "Fields to select",
          },
          skip: {
            type: "number",
            description: "Number of records to skip",
          },
          limit: {
            type: "number",
            description: "Maximum number of records to return",
          },
          sort: {
            type: "object",
            description: "Sort order",
          }
        }
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
    tools.push({
      name: `oneuptime_update${singularName.replace(/\s+/g, '')}`,
      description: `Update an existing ${singularName} in OneUptime`,
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: `ID of the ${singularName} to update`,
          },
          data: {
            type: "object",
            description: `Updated ${singularName} data`,
          }
        },
        required: ["id", "data"]
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
      name: `oneuptime_delete${singularName.replace(/\s+/g, '')}`,
      description: `Delete a ${singularName} from OneUptime`,
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: `ID of the ${singularName} to delete`,
          }
        },
        required: ["id"]
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
      name: `oneuptime_count${pluralName.replace(/\s+/g, '')}`,
      description: `Count the number of ${pluralName} in OneUptime`,
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "object",
            description: `Query filters for counting ${pluralName}`,
          }
        }
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


    // CREATE Tool for Analytics
    tools.push({
      name: `oneuptime_create${singularName.replace(/\s+/g, '')}`,
      description: `Create a new ${singularName} analytics record in OneUptime`,
      inputSchema: {
        type: "object",
        properties: {
          data: {
            type: "object",
            description: `${singularName} analytics data to create`,
          }
        },
        required: ["data"]
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
      name: `oneuptime_list${pluralName.replace(/\s+/g, '')}`,
      description: `Query ${pluralName} analytics data from OneUptime`,
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "object",
            description: `Query filters for ${pluralName} analytics data`,
          },
          select: {
            type: "object", 
            description: "Fields to select",
          },
          skip: {
            type: "number",
            description: "Number of records to skip",
          },
          limit: {
            type: "number",
            description: "Maximum number of records to return",
          },
          sort: {
            type: "object",
            description: "Sort order",
          }
        }
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
      name: `oneuptime_count${pluralName.replace(/\s+/g, '')}`,
      description: `Count ${pluralName} analytics records in OneUptime`,
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "object",
            description: `Query filters for counting ${pluralName} analytics data`,
          }
        }
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
