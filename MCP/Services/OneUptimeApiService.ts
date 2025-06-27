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
   * Execute a OneUptime API operation
   */
  public static async executeOperation(
    modelName: string,
    operation: OneUptimeOperation,
    _modelType: ModelType,
    apiPath: string,
    args: OneUptimeToolCallArgs
  ): Promise<any> {
    if (!this.api) {
      throw new Error("OneUptime API Service not initialized. Please call initialize() first.");
    }

    this.validateOperationArgs(operation, args);

    const route = this.buildApiRoute(apiPath, operation, args.id);
    const headers = this.getHeaders();
    const data = this.getRequestData(operation, args);

    MCPLogger.info(`Executing ${operation} operation for ${modelName} at ${route.toString()}`);

    try {
      let response: HTTPResponse<any> | HTTPErrorResponse;

      switch (operation) {
        case OneUptimeOperation.Create:
        case OneUptimeOperation.Count:
        case OneUptimeOperation.List:
        case OneUptimeOperation.Read:
          response = await this.api.post(route, data, headers);
          break;
        case OneUptimeOperation.Update:
          response = await this.api.put(route, data, headers);
          break;
        case OneUptimeOperation.Delete:
          response = await this.api.delete(route, data, headers);
          break;
        default:
          throw new Error(`Unsupported operation: ${operation}`);
      }

      if (response instanceof HTTPErrorResponse) {
        throw new Error(`API request failed: ${response.statusCode} - ${response.message}`);
      }

      MCPLogger.info(`Successfully executed ${operation} operation for ${modelName}`);
      return response.data;
    } catch (error) {
      MCPLogger.error(`Error executing ${operation} operation for ${modelName}: ${error}`);
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

    // Create an absolute route that won't be concatenated with the base route
    return Route.fromString(fullPath);
  }

  private static getRequestData(operation: OneUptimeOperation, args: OneUptimeToolCallArgs): JSONObject | undefined {
    switch (operation) {
      case OneUptimeOperation.Create:
        return { data: args.data } as JSONObject;
      case OneUptimeOperation.Update:
        return { data: args.data } as JSONObject;
      case OneUptimeOperation.List:
      case OneUptimeOperation.Count:
        return {
          query: args.query || {},
          select: args.select,
          skip: args.skip,
          limit: args.limit,
          sort: args.sort,
        } as JSONObject;
      case OneUptimeOperation.Read:
        return {
          select: args.select,
        } as JSONObject;
      case OneUptimeOperation.Delete:
      default:
        return undefined;
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
