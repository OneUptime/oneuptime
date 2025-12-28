/**
 * OneUptime API Service
 * Handles communication with the OneUptime API
 */

import OneUptimeOperation from "../Types/OneUptimeOperation";
import ModelType from "../Types/ModelType";
import { OneUptimeToolCallArgs } from "../Types/McpTypes";
import { generateAllFieldsSelect } from "./SelectFieldGenerator";
import MCPLogger from "../Utils/MCPLogger";
import API from "Common/Utils/API";
import URL from "Common/Types/API/URL";
import Route from "Common/Types/API/Route";
import Headers from "Common/Types/API/Headers";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import Protocol from "Common/Types/API/Protocol";
import Hostname from "Common/Types/API/Hostname";

export interface OneUptimeApiConfig {
  url: string;
  apiKey?: string;
}

export default class OneUptimeApiService {
  private static api: API;

  /**
   * Initialize the API service with configuration
   */
  public static initialize(config: OneUptimeApiConfig): void {
    try {
      const url: URL = URL.fromString(config.url);
      const protocol: Protocol = url.protocol;
      const hostname: Hostname = url.hostname;

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
    apiKey: string,
  ): Promise<JSONValue> {
    this.validateInitialization();
    this.validateApiKey(apiKey);
    this.validateOperationArgs(operation, args);

    const route: Route = this.buildApiRoute(apiPath, operation, args.id);
    const headers: Headers = this.buildHeaders(apiKey);
    const data: JSONObject | undefined = this.buildRequestData(
      operation,
      args,
      tableName,
      modelType,
    );

    MCPLogger.info(
      `Executing ${operation} operation for ${tableName} at ${route.toString()}`,
    );

    try {
      const response: JSONValue = await this.makeApiRequest(
        operation,
        route,
        headers,
        data,
      );
      MCPLogger.info(
        `Successfully executed ${operation} operation for ${tableName}`,
      );
      return response;
    } catch (error) {
      MCPLogger.error(
        `Error executing ${operation} operation for ${tableName}: ${error}`,
      );
      throw error;
    }
  }

  /**
   * Make the actual API request
   */
  private static async makeApiRequest(
    operation: OneUptimeOperation,
    route: Route,
    headers: Headers,
    data: JSONObject | undefined,
  ): Promise<JSONValue> {
    const url: URL = new URL(this.api.protocol, this.api.hostname, route);
    const baseOptions: { url: URL; headers: Headers } = { url, headers };

    let response: HTTPResponse<JSONObject> | HTTPErrorResponse;

    switch (operation) {
      case OneUptimeOperation.Create:
      case OneUptimeOperation.Count:
      case OneUptimeOperation.List:
      case OneUptimeOperation.Read:
        response = await API.post(
          data ? { ...baseOptions, data } : baseOptions,
        );
        break;
      case OneUptimeOperation.Update:
        response = await API.put(data ? { ...baseOptions, data } : baseOptions);
        break;
      case OneUptimeOperation.Delete:
        response = await API.delete(
          data ? { ...baseOptions, data } : baseOptions,
        );
        break;
      default:
        throw new Error(`Unsupported operation: ${operation}`);
    }

    if (response instanceof HTTPErrorResponse) {
      throw new Error(
        `API request failed: ${response.statusCode} - ${response.message}`,
      );
    }

    return response.data;
  }

  /**
   * Build the API route for an operation
   */
  private static buildApiRoute(
    apiPath: string,
    operation: OneUptimeOperation,
    id?: string,
  ): Route {
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
        fullPath = `/api${apiPath}`;
        break;
    }

    return new Route(fullPath);
  }

  /**
   * Build request data based on operation type
   */
  private static buildRequestData(
    operation: OneUptimeOperation,
    args: OneUptimeToolCallArgs,
    tableName: string,
    modelType: ModelType,
  ): JSONObject | undefined {
    MCPLogger.info(
      `Preparing request data for operation: ${operation}, tableName: ${tableName}`,
    );

    switch (operation) {
      case OneUptimeOperation.Create:
        return this.buildCreateData(args);

      case OneUptimeOperation.Update:
        return this.buildUpdateData(args);

      case OneUptimeOperation.List:
      case OneUptimeOperation.Count:
        return this.buildQueryData(args, tableName, modelType);

      case OneUptimeOperation.Read:
        return this.buildReadData(args, tableName, modelType);

      case OneUptimeOperation.Delete:
      default:
        return undefined;
    }
  }

  private static buildCreateData(args: OneUptimeToolCallArgs): JSONObject {
    const createData: JSONObject = {};
    const reservedFields: string[] = [
      "id",
      "query",
      "select",
      "skip",
      "limit",
      "sort",
    ];

    for (const [key, value] of Object.entries(args)) {
      if (!reservedFields.includes(key)) {
        createData[key] = value as JSONValue;
      }
    }

    return { data: createData } as JSONObject;
  }

  private static buildUpdateData(args: OneUptimeToolCallArgs): JSONObject {
    const updateData: JSONObject = {};
    const reservedFields: string[] = [
      "id",
      "query",
      "select",
      "skip",
      "limit",
      "sort",
    ];

    for (const [key, value] of Object.entries(args)) {
      if (!reservedFields.includes(key)) {
        updateData[key] = value as JSONValue;
      }
    }

    return { data: updateData } as JSONObject;
  }

  private static buildQueryData(
    args: OneUptimeToolCallArgs,
    tableName: string,
    modelType: ModelType,
  ): JSONObject {
    const generatedSelect: JSONObject =
      args.select || generateAllFieldsSelect(tableName, modelType);

    const requestData: JSONObject = {
      query: args.query || {},
      select: generatedSelect,
      skip: args.skip,
      limit: args.limit,
      sort: args.sort,
    } as JSONObject;

    MCPLogger.info(`Request data: ${JSON.stringify(requestData, null, 2)}`);
    return requestData;
  }

  private static buildReadData(
    args: OneUptimeToolCallArgs,
    tableName: string,
    modelType: ModelType,
  ): JSONObject {
    const readSelect: JSONObject =
      args.select || generateAllFieldsSelect(tableName, modelType);

    const readRequestData: JSONObject = {
      select: readSelect,
    } as JSONObject;

    MCPLogger.info(
      `Request data for Read: ${JSON.stringify(readRequestData, null, 2)}`,
    );
    return readRequestData;
  }

  /**
   * Build headers for API request
   */
  private static buildHeaders(apiKey: string): Headers {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      APIKey: apiKey,
    };
  }

  /**
   * Validate that the service is initialized
   */
  private static validateInitialization(): void {
    if (!this.api) {
      throw new Error(
        "OneUptime API Service not initialized. Please call initialize() first.",
      );
    }
  }

  /**
   * Validate that an API key is provided
   */
  private static validateApiKey(apiKey: string): void {
    if (!apiKey) {
      throw new Error(
        "API key is required. Please provide x-api-key header in your request.",
      );
    }
  }

  /**
   * Validate arguments for a specific operation
   */
  public static validateOperationArgs(
    operation: OneUptimeOperation,
    args: OneUptimeToolCallArgs,
  ): void {
    const reservedFields: string[] = [
      "id",
      "query",
      "select",
      "skip",
      "limit",
      "sort",
    ];

    switch (operation) {
      case OneUptimeOperation.Create: {
        const createDataFields: string[] = Object.keys(args).filter(
          (key: string) => {
            return !reservedFields.includes(key);
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
      case OneUptimeOperation.Delete:
        if (!args.id) {
          throw new Error(`ID is required for ${operation} operation`);
        }
        break;
      case OneUptimeOperation.Update: {
        if (!args.id) {
          throw new Error(`ID is required for ${operation} operation`);
        }
        const updateDataFields: string[] = Object.keys(args).filter(
          (key: string) => {
            return !reservedFields.includes(key);
          },
        );
        if (updateDataFields.length === 0) {
          throw new Error(
            "At least one data field is required for update operation",
          );
        }
        break;
      }
      case OneUptimeOperation.List:
      case OneUptimeOperation.Count:
        // No required arguments for list/count operations
        break;
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }
}
