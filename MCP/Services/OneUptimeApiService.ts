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

export interface OneUptimeApiConfig {
  url: string;
  apiKey: string;
}

export default class OneUptimeApiService {
  private static api: API;
  private static config: OneUptimeApiConfig;

  public static initialize(config: OneUptimeApiConfig): void {
    if (!config.apiKey) {
      throw new Error("OneUptime API key is required. Please set ONEUPTIME_API_KEY environment variable.");
    }

    this.config = config;
    
    // Parse the URL to extract protocol, hostname, and path
    const url = URL.fromString(config.url);
    const protocol = url.protocol;
    const hostname = url.hostname;
    
    // Initialize with no base route to avoid route accumulation
    this.api = new API(protocol, hostname, new Route("/"));
    
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
    args: OneUptimeToolCallArgs
  ): Promise<any> {
    if (!this.api) {
      throw new Error("OneUptime API Service not initialized. Please call initialize() first.");
    }

    this.validateOperationArgs(operation, args);

    const route = this.buildApiRoute(apiPath, operation, args.id);
    const headers = this.getHeaders();
    const data = this.getRequestData(operation, args, tableName, modelType);

    MCPLogger.info(`Executing ${operation} operation for ${tableName} at ${route.toString()}`);

    try {
      let response: HTTPResponse<any> | HTTPErrorResponse;

      // Create a direct URL to avoid base route accumulation
      const url = new URL(this.api.protocol, this.api.hostname, route);

      switch (operation) {
        case OneUptimeOperation.Create:
        case OneUptimeOperation.Count:
        case OneUptimeOperation.List:
        case OneUptimeOperation.Read:
          response = await API.post(url, data, headers);
          break;
        case OneUptimeOperation.Update:
          response = await API.put(url, data, headers);
          break;
        case OneUptimeOperation.Delete:
          response = await API.delete(url, data, headers);
          break;
        default:
          throw new Error(`Unsupported operation: ${operation}`);
      }

      if (response instanceof HTTPErrorResponse) {
        throw new Error(`API request failed: ${response.statusCode} - ${response.message}`);
      }

      MCPLogger.info(`Successfully executed ${operation} operation for ${tableName}`);
      return response.data;
    } catch (error) {
      MCPLogger.error(`Error executing ${operation} operation for ${tableName}: ${error}`);
      throw error;
    }
  }

  private static buildApiRoute(apiPath: string, operation: OneUptimeOperation, id?: string): Route {
    // Start with the API base path
    let fullPath = `/api${apiPath}`;
    
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

  private static getRequestData(operation: OneUptimeOperation, args: OneUptimeToolCallArgs, tableName: string, modelType: ModelType): JSONObject | undefined {
    switch (operation) {
      case OneUptimeOperation.Create:
        return { data: args.data } as JSONObject;
      case OneUptimeOperation.Update:
        return { data: args.data } as JSONObject;
      case OneUptimeOperation.List:
      case OneUptimeOperation.Count:
        return {
          query: args.query || {},
          select: args.select || this.generateAllFieldsSelect(tableName, modelType),
          skip: args.skip,
          limit: args.limit,
          sort: args.sort,
        } as JSONObject;
      case OneUptimeOperation.Read:
        return {
          select: args.select || this.generateAllFieldsSelect(tableName, modelType),
        } as JSONObject;
      case OneUptimeOperation.Delete:
      default:
        return undefined;
    }
  }

  /**
   * Generate a select object that includes all fields from the select schema
   */
  private static generateAllFieldsSelect(tableName: string, modelType: ModelType): JSONObject {
    try {
      let ModelClass: any = null;
      
      // Find the model class by table name
      if (modelType === ModelType.Database) {
        ModelClass = DatabaseModels.find((Model: any) => {
          const instance = new Model();
          return instance.tableName === tableName;
        });
      } else if (modelType === ModelType.Analytics) {
        ModelClass = AnalyticsModels.find((Model: any) => {
          const instance = new Model();
          return instance.tableName === tableName;
        });
      }

      if (!ModelClass) {
        MCPLogger.warn(`Model class not found for ${tableName}, using empty select`);
        return {};
      }

      // Generate the select schema to get all available fields (not read schema which has permission restrictions)
      let selectSchema: any;
      if (modelType === ModelType.Database) {
        selectSchema = ModelSchema.getSelectModelSchema({ modelType: ModelClass });
      } else {
        // For analytics models, use the general model schema
        selectSchema = AnalyticsModelSchema.getModelSchema({ modelType: ModelClass });
      }

      // Extract field names from the schema
      const selectObject: JSONObject = {};
      const shape = selectSchema._def?.shape;
      
      if (shape) {
        for (const fieldName of Object.keys(shape)) {
          selectObject[fieldName] = true;
        }
      }

      MCPLogger.info(`Generated select for ${tableName} with ${Object.keys(selectObject).length} fields`);
      return selectObject;
    } catch (error) {
      MCPLogger.error(`Error generating select for ${tableName}: ${error}`);
      return {};
    }
  }

  private static getHeaders(): Headers {
    const headers: Headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (this.config.apiKey) {
      headers['APIKey'] = this.config.apiKey;
    }

    return headers;
  }

  /**
   * Validate arguments for a specific operation
   */
  public static validateOperationArgs(operation: OneUptimeOperation, args: OneUptimeToolCallArgs): void {
    switch (operation) {
      case OneUptimeOperation.Create:
        if (!args.data) {
          throw new Error('Data is required for create operation');
        }
        break;
      case OneUptimeOperation.Read:
      case OneUptimeOperation.Update:
      case OneUptimeOperation.Delete:
        if (!args.id) {
          throw new Error(`ID is required for ${operation} operation`);
        }
        if (operation === OneUptimeOperation.Update && !args.data) {
          throw new Error('Data is required for update operation');
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
