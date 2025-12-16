import OneUptimeOperation from "../Types/OneUptimeOperation";
import ModelType from "../Types/ModelType";
import { OneUptimeToolCallArgs } from "../Types/McpTypes";
import MCPLogger from "../Utils/MCPLogger";
import API from "Common/Utils/API";
import URL from "Common/Types/API/URL";
import Route from "Common/Types/API/Route";
import Headers from "Common/Types/API/Headers";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import DatabaseModels from "Common/Models/DatabaseModels/Index";
import AnalyticsModels from "Common/Models/AnalyticsModels/Index";
import { ModelSchema } from "Common/Utils/Schema/ModelSchema";
import { AnalyticsModelSchema } from "Common/Utils/Schema/AnalyticsModelSchema";
import { getTableColumns } from "Common/Types/Database/TableColumn";
import Permission from "Common/Types/Permission";
import Protocol from "Common/Types/API/Protocol";
import Hostname from "Common/Types/API/Hostname";

export interface OneUptimeApiConfig {
  url: string;
  apiKey: string;
}

export default class OneUptimeApiService {
  private static api: API;
  private static config: OneUptimeApiConfig;

  public static initialize(config: OneUptimeApiConfig): void {
    if (!config.apiKey) {
      throw new Error(
        "OneUptime API key is required. Please set ONEUPTIME_API_KEY environment variable.",
      );
    }

    this.config = config;

    // Parse the URL to extract protocol, hostname, and path
    try {
      const url: URL = URL.fromString(config.url);
      const protocol: Protocol = url.protocol;
      const hostname: Hostname = url.hostname;

      // Initialize with no base route to avoid route accumulation
      this.api = new API(protocol, hostname, new Route("/"));
    } catch (error) {
      throw new Error(`Invalid URL format: ${config.url}. Error: ${error}`);
    }

    MCPLogger.info(`OneUptime API Service initialized with: ${config.url}`);
  }

  /**
   * Execute a OneUptime operation
   */
  public static async executeOperation(
    tableName: string,
    operation: OneUptimeOperation,
    modelType: ModelType,
    apiPath: string,
    args: OneUptimeToolCallArgs,
  ): Promise<any> {
    if (!this.api) {
      throw new Error(
        "OneUptime API Service not initialized. Please call initialize() first.",
      );
    }

    this.validateOperationArgs(operation, args);

    const route: any = this.buildApiRoute(apiPath, operation, args.id);
    const headers: any = this.getHeaders();
    const data: any = this.getRequestData(
      operation,
      args,
      tableName,
      modelType,
    );

    MCPLogger.info(
      `Executing ${operation} operation for ${tableName} at ${route.toString()}`,
    );

    try {
      let response: HTTPResponse<any> | HTTPErrorResponse;

      // Create a direct URL to avoid base route accumulation
      const url: URL = new URL(this.api.protocol, this.api.hostname, route);

      switch (operation) {
        case OneUptimeOperation.Create:
        case OneUptimeOperation.Count:
        case OneUptimeOperation.List:
        case OneUptimeOperation.Read:
          response = await API.post({
            url: url,
            data: data,
            headers: headers,
          });
          break;
        case OneUptimeOperation.Update:
          response = await API.put({
            url: url,
            data: data,
            headers: headers,
          });
          break;
        case OneUptimeOperation.Delete:
          response = await API.delete({
            url: url,
            data: data,
            headers: headers,
          });
          break;
        default:
          throw new Error(`Unsupported operation: ${operation}`);
      }

      if (response instanceof HTTPErrorResponse) {
        throw new Error(
          `API request failed: ${response.statusCode} - ${response.message}`,
        );
      }

      MCPLogger.info(
        `Successfully executed ${operation} operation for ${tableName}`,
      );
      return response.data;
    } catch (error) {
      MCPLogger.error(
        `Error executing ${operation} operation for ${tableName}: ${error}`,
      );
      throw error;
    }
  }

  private static buildApiRoute(
    apiPath: string,
    operation: OneUptimeOperation,
    id?: string,
  ): Route {
    // Start with the API base path
    let fullPath: string = `/api${apiPath}`;

    switch (operation) {
      case OneUptimeOperation.Read:
        if (id) {
          fullPath = `/api${apiPath}/${id}/get-item`;
        }
        break;
      case OneUptimeOperation.Update:
      case OneUptimeOperation.Delete:
        if (id) {
          fullPath = `/api${apiPath}/${id}/`;
        }
        break;
      case OneUptimeOperation.Count:
        fullPath = `/api${apiPath}/count`;
        break;
      case OneUptimeOperation.List:
        fullPath = `/api${apiPath}/get-list`;
        break;
      case OneUptimeOperation.Create:
      default:
        // Use the base API path
        fullPath = `/api${apiPath}`;
        break;
    }

    // Create a new route that is completely independent
    return new Route(fullPath);
  }

  private static getRequestData(
    operation: OneUptimeOperation,
    args: OneUptimeToolCallArgs,
    tableName: string,
    modelType: ModelType,
  ): JSONObject | undefined {
    MCPLogger.info(
      `Preparing request data for operation: ${operation}, tableName: ${tableName}`,
    );

    switch (operation) {
      case OneUptimeOperation.Create: {
        // For create operations, all properties except reserved ones are part of the data
        const createData: JSONObject = {};
        for (const [key, value] of Object.entries(args)) {
          if (
            !["id", "query", "select", "skip", "limit", "sort"].includes(key)
          ) {
            createData[key] = value;
          }
        }
        return { data: createData } as JSONObject;
      }
      case OneUptimeOperation.Update: {
        // For update operations, all properties except reserved ones are part of the data
        const updateData: JSONObject = {};
        for (const [key, value] of Object.entries(args)) {
          if (
            !["id", "query", "select", "skip", "limit", "sort"].includes(key)
          ) {
            updateData[key] = value;
          }
        }
        return { data: updateData } as JSONObject;
      }
      case OneUptimeOperation.List:
      case OneUptimeOperation.Count: {
        const generatedSelect: any =
          args.select || this.generateAllFieldsSelect(tableName, modelType);
        const requestData: JSONObject = {
          query: args.query || {},
          select: generatedSelect,
          skip: args.skip,
          limit: args.limit,
          sort: args.sort,
        } as JSONObject;

        MCPLogger.info(
          `Request data for ${operation}: ${JSON.stringify(requestData, null, 2)}`,
        );
        return requestData;
      }
      case OneUptimeOperation.Read: {
        const readSelect: any =
          args.select || this.generateAllFieldsSelect(tableName, modelType);
        const readRequestData: JSONObject = {
          select: readSelect,
        } as JSONObject;

        MCPLogger.info(
          `Request data for Read: ${JSON.stringify(readRequestData, null, 2)}`,
        );
        return readRequestData;
      }
      case OneUptimeOperation.Delete:
      default:
        return undefined;
    }
  }

  /**
   * Generate a select object that includes all fields from the select schema
   */
  private static generateAllFieldsSelect(
    tableName: string,
    modelType: ModelType,
  ): JSONObject {
    MCPLogger.info(
      `Generating select for tableName: ${tableName}, modelType: ${modelType}`,
    );

    try {
      let ModelClass: any = null;

      // Find the model class by table name
      if (modelType === ModelType.Database) {
        MCPLogger.info(`Searching DatabaseModels for tableName: ${tableName}`);
        ModelClass = DatabaseModels.find((Model: any) => {
          try {
            const instance: any = new Model();
            const instanceTableName: string = instance.tableName;
            MCPLogger.info(
              `Checking model ${Model.name} with tableName: ${instanceTableName}`,
            );
            return instanceTableName === tableName;
          } catch (error) {
            MCPLogger.warn(`Error instantiating model ${Model.name}: ${error}`);
            return false;
          }
        });
      } else if (modelType === ModelType.Analytics) {
        MCPLogger.info(`Searching AnalyticsModels for tableName: ${tableName}`);
        ModelClass = AnalyticsModels.find((Model: any) => {
          try {
            const instance: any = new Model();
            return instance.tableName === tableName;
          } catch (error) {
            MCPLogger.warn(
              `Error instantiating analytics model ${Model.name}: ${error}`,
            );
            return false;
          }
        });
      }

      if (!ModelClass) {
        MCPLogger.warn(
          `Model class not found for ${tableName}, using empty select`,
        );
        return {};
      }

      MCPLogger.info(
        `Found ModelClass: ${ModelClass.name} for tableName: ${tableName}`,
      );

      // Try to get raw table columns first (most reliable approach)
      try {
        const modelInstance: any = new ModelClass();
        const tableColumns: any = getTableColumns(modelInstance);
        const columnNames: string[] = Object.keys(tableColumns);

        MCPLogger.info(
          `Raw table columns (${columnNames.length}): ${columnNames.slice(0, 10).join(", ")}`,
        );

        if (columnNames.length > 0) {
          // Get access control information to filter out restricted fields
          const accessControlForColumns: any =
            modelInstance.getColumnAccessControlForAllColumns();
          const selectObject: JSONObject = {};
          let filteredCount: number = 0;

          for (const columnName of columnNames) {
            const accessControl: any = accessControlForColumns[columnName];

            /*
             * Include the field if:
             * 1. No access control defined (open access)
             * 2. Has read permissions that are not empty
             * 3. Read permissions don't only contain Permission.CurrentUser
             */
            if (
              !accessControl ||
              (accessControl.read &&
                accessControl.read.length > 0 &&
                !(
                  accessControl.read.length === 1 &&
                  accessControl.read[0] === Permission.CurrentUser
                ))
            ) {
              selectObject[columnName] = true;
            } else {
              filteredCount++;
              MCPLogger.info(`Filtered out restricted field: ${columnName}`);
            }
          }

          MCPLogger.info(
            `Generated select from table columns for ${tableName} with ${Object.keys(selectObject).length} fields (filtered out ${filteredCount} restricted fields)`,
          );

          // Ensure we have at least some basic fields
          if (Object.keys(selectObject).length === 0) {
            MCPLogger.warn(
              `All fields were filtered out, adding safe basic fields`,
            );
            selectObject["_id"] = true;
            selectObject["createdAt"] = true;
            selectObject["updatedAt"] = true;
          }

          return selectObject;
        }
      } catch (tableColumnError) {
        MCPLogger.warn(
          `Failed to get table columns for ${tableName}: ${tableColumnError}`,
        );
      }

      // Fallback to schema approach if table columns fail
      let selectSchema: any;
      if (modelType === ModelType.Database) {
        MCPLogger.info(
          `Generating select schema for database model: ${ModelClass.name}`,
        );
        selectSchema = ModelSchema.getSelectModelSchema({
          modelType: ModelClass,
        });
      } else {
        MCPLogger.info(
          `Generating schema for analytics model: ${ModelClass.name}`,
        );
        // For analytics models, use the general model schema
        selectSchema = AnalyticsModelSchema.getModelSchema({
          modelType: ModelClass,
        });
      }

      // Extract field names from the schema
      const selectObject: JSONObject = {};
      const shape: any = selectSchema._def?.shape;

      MCPLogger.info(
        `Schema shape keys: ${shape ? Object.keys(shape).length : 0}`,
      );

      if (shape) {
        const fieldNames: string[] = Object.keys(shape);
        MCPLogger.info(
          `Available fields: ${fieldNames.slice(0, 10).join(", ")}${fieldNames.length > 10 ? "..." : ""}`,
        );

        for (const fieldName of fieldNames) {
          selectObject[fieldName] = true;
        }
      }

      MCPLogger.info(
        `Generated select for ${tableName} with ${Object.keys(selectObject).length} fields`,
      );

      // Force include some basic fields if select is empty
      if (Object.keys(selectObject).length === 0) {
        MCPLogger.warn(`No fields found, adding basic fields for ${tableName}`);
        selectObject["_id"] = true;
        selectObject["createdAt"] = true;
        selectObject["updatedAt"] = true;
      }

      return selectObject;
    } catch (error) {
      MCPLogger.error(`Error generating select for ${tableName}: ${error}`);
      // Return some basic fields as fallback
      return {
        _id: true,
        createdAt: true,
        updatedAt: true,
      };
    }
  }

  private static getHeaders(): Headers {
    const headers: Headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (this.config.apiKey) {
      headers["APIKey"] = this.config.apiKey;
    }

    return headers;
  }

  /**
   * Validate arguments for a specific operation
   */
  public static validateOperationArgs(
    operation: OneUptimeOperation,
    args: OneUptimeToolCallArgs,
  ): void {
    switch (operation) {
      case OneUptimeOperation.Create: {
        // For create operations, we need at least one data field (excluding reserved fields)
        const createDataFields: string[] = Object.keys(args).filter(
          (key: string) => {
            return !["id", "query", "select", "skip", "limit", "sort"].includes(
              key,
            );
          },
        );
        if (createDataFields.length === 0) {
          throw new Error(
            "At least one data field is required for create operation",
          );
        }
        break;
      }
      case OneUptimeOperation.Read:
      case OneUptimeOperation.Update:
      case OneUptimeOperation.Delete:
        if (!args.id) {
          throw new Error(`ID is required for ${operation} operation`);
        }
        if (operation === OneUptimeOperation.Update) {
          // For update operations, we need at least one data field (excluding reserved fields)
          const updateDataFields: string[] = Object.keys(args).filter(
            (key: string) => {
              return ![
                "id",
                "query",
                "select",
                "skip",
                "limit",
                "sort",
              ].includes(key);
            },
          );
          if (updateDataFields.length === 0) {
            throw new Error(
              "At least one data field is required for update operation",
            );
          }
        }
        break;
      case OneUptimeOperation.List:
      case OneUptimeOperation.Count:
        // No required arguments for list/count operations
        break;
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }
}
