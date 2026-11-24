/**
 * OneUptime API Service
 * Handles communication with the OneUptime API
 */

import OneUptimeOperation from "../Types/OneUptimeOperation";
import ModelType from "../Types/ModelType";
import { OneUptimeToolCallArgs } from "../Types/McpTypes";
import McpCredentialUtil, { McpCredentialInput } from "../Types/McpCredential";
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
import ObjectID from "Common/Types/ObjectID";
import {
  OWNER_TEAMS_ON_CREATE_KEY,
  OWNER_USERS_ON_CREATE_KEY,
  takesOwnersOnCreate,
} from "Common/Types/Database/OwnersOnCreate";
import { readDeleteChoices } from "Common/Utils/DeveloperDocs/DeleteChoices";

export interface OneUptimeApiConfig {
  url: string;
  apiKey?: string;
}

/**
 * Error thrown when the OneUptime API returns a failure response. Carries the
 * HTTP status code and the raw response body so tool results can surface
 * actionable detail to the calling agent.
 */
export class OneUptimeApiError extends Error {
  public statusCode: number;
  public details: JSONValue | undefined;

  public constructor(message: string, statusCode: number, details?: JSONValue) {
    super(message);
    this.name = "OneUptimeApiError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

/*
 * When a scoped API key cannot read one of the columns in the default
 * "all fields" select, the API rejects the whole request with a message like
 * "You do not have permissions to select on - <column>.". We drop the named
 * column and retry so least-privilege keys still get results.
 */
const SELECT_PERMISSION_ERROR_REGEX: RegExp =
  /permissions to select on\s*-\s*([A-Za-z0-9_]+)/;

const MAX_SELECT_PERMISSION_RETRIES: number = 10;

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
    /*
     * An API key (a bare string, as it has always been) or the credential of
     * a client that signed in with OAuth. See Types/McpCredential.
     */
    credential: McpCredentialInput,
    /*
     * Handed the headers of the answer: a create says in one which fields
     * it left out because only OneUptime writes them
     * (Common/Types/API/FieldsLeftOut, #10136).
     */
    onAnswerHeaders?: ((headers: Headers) => void) | undefined,
  ): Promise<JSONValue> {
    /*
     * `arguments` is optional in the MCP CallToolRequest — normalize here so
     * parameterless list/count calls work and validation errors stay clean.
     */
    args = args || {};

    this.validateInitialization();
    this.validateCredential(credential);
    this.validateOperationArgs(operation, args);

    const route: Route = this.buildApiRoute(apiPath, operation, args.id);
    const headers: Headers = this.buildHeaders(credential);
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
      const response: JSONValue = await this.makeApiRequestWithSelectRetry(
        operation,
        route,
        headers,
        data,
        onAnswerHeaders,
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
   * Make an arbitrary authenticated call to the OneUptime API. Used by
   * hand-written workflow tools (acknowledge/resolve/note/whoami) that
   * compose multiple API operations.
   */
  public static async makeAuthenticatedApiCall(data: {
    method: "POST" | "PUT" | "DELETE";
    path: string;
    body?: JSONObject | undefined;
    credential: McpCredentialInput;
  }): Promise<JSONValue> {
    this.validateInitialization();
    this.validateCredential(data.credential);

    const route: Route = new Route(data.path);
    const headers: Headers = this.buildHeaders(data.credential);
    const url: URL = new URL(this.api.protocol, this.api.hostname, route);
    const options: { url: URL; headers: Headers; data?: JSONObject } = {
      url,
      headers,
      ...(data.body ? { data: data.body } : {}),
    };

    let response: HTTPResponse<JSONObject> | HTTPErrorResponse;
    switch (data.method) {
      case "PUT":
        response = await API.put(options);
        break;
      case "DELETE":
        response = await API.delete(options);
        break;
      case "POST":
      default:
        response = await API.post(options);
        break;
    }

    if (response instanceof HTTPErrorResponse) {
      throw new OneUptimeApiError(
        `API request failed: ${response.statusCode} - ${response.message}`,
        response.statusCode,
        response.data as JSONValue,
      );
    }

    return response.data;
  }

  /**
   * Execute the request, transparently dropping columns the API key is not
   * permitted to read from the generated select and retrying.
   */
  private static async makeApiRequestWithSelectRetry(
    operation: OneUptimeOperation,
    route: Route,
    headers: Headers,
    data: JSONObject | undefined,
    onAnswerHeaders?: ((headers: Headers) => void) | undefined,
  ): Promise<JSONValue> {
    let attempt: number = 0;

    for (;;) {
      try {
        return await this.makeApiRequest(
          operation,
          route,
          headers,
          data,
          onAnswerHeaders,
        );
      } catch (error) {
        const select: JSONObject | undefined = data?.["select"] as
          | JSONObject
          | undefined;

        if (
          !(error instanceof OneUptimeApiError) ||
          !select ||
          attempt >= MAX_SELECT_PERMISSION_RETRIES
        ) {
          throw error;
        }

        const match: RegExpMatchArray | null = error.message.match(
          SELECT_PERMISSION_ERROR_REGEX,
        );
        const deniedColumn: string | undefined = match?.[1];

        if (!deniedColumn || !(deniedColumn in select)) {
          throw error;
        }

        delete select[deniedColumn];
        attempt++;
        MCPLogger.warn(
          `API key lacks read permission on column '${deniedColumn}'; retrying without it (attempt ${attempt})`,
        );
      }
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
    onAnswerHeaders?: ((headers: Headers) => void) | undefined,
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
      throw new OneUptimeApiError(
        `API request failed: ${response.statusCode} - ${response.message}`,
        response.statusCode,
        response.data as JSONValue,
      );
    }

    onAnswerHeaders?.(response.headers || {});

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
    // IDs are interpolated into the URL path — only accept UUIDs.
    if (id && !ObjectID.isValidUUID(id)) {
      throw new Error(
        `Invalid id '${id}': expected a UUID like "550e8400-e29b-41d4-a716-446655440000". Use the list tool to find valid IDs.`,
      );
    }

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
        return this.buildCreateData(args, tableName);

      case OneUptimeOperation.Update:
        return this.buildUpdateData(args);

      case OneUptimeOperation.List:
      case OneUptimeOperation.Count:
        return this.buildQueryData(args, tableName, modelType);

      case OneUptimeOperation.Read:
        return this.buildReadData(args, tableName, modelType);

      case OneUptimeOperation.Delete:
        return this.buildDeleteData(args, tableName);

      default:
        return undefined;
    }
  }

  /*
   * What a delete says besides the record (Common/Utils/DeveloperDocs
   * /DeleteChoices.ts, #9949), from its tool's inputs, as the API takes it:
   * what the workflows that run as a deleted custom role run as instead.
   * Checked before anything is sent, as the CLI checks its flags, so what
   * the server would refuse - Project Owner, a value it does not take, half
   * of a pair, the role being deleted - never reaches it, and is refused in
   * the inputs' own names. A delete that says nothing sends no body, as it
   * always did.
   */
  private static buildDeleteData(
    args: OneUptimeToolCallArgs,
    tableName: string,
  ): JSONObject | undefined {
    const miscDataProps: JSONObject = readDeleteChoices({
      tableName,
      given: args as Record<string, unknown>,
      deletedId: args.id,
      nameOf: (key: string): string => {
        return key;
      },
    });

    return Object.keys(miscDataProps).length > 0
      ? { miscDataProps: miscDataProps }
      : undefined;
  }

  private static buildCreateData(
    args: OneUptimeToolCallArgs,
    tableName: string,
  ): JSONObject {
    const createData: JSONObject = {};
    const miscDataProps: JSONObject = {};
    const reservedFields: string[] = [
      "id",
      "query",
      "select",
      "skip",
      "limit",
      "sort",
    ];

    /*
     * An incident's or an alert's owners go beside its fields, as the
     * create's misc data, which its route asks about before anything is
     * saved (Types/Database/OwnersOnCreate, #8198).
     */
    const ownerKeys: Array<string> = takesOwnersOnCreate(tableName)
      ? [OWNER_USERS_ON_CREATE_KEY, OWNER_TEAMS_ON_CREATE_KEY]
      : [];

    for (const [key, value] of Object.entries(args)) {
      if (reservedFields.includes(key)) {
        continue;
      }

      if (ownerKeys.includes(key)) {
        const ids: Array<string> = this.readOwnerIds(key, value);

        if (ids.length > 0) {
          miscDataProps[key] = ids;
        }

        continue;
      }

      createData[key] = value as JSONValue;
    }

    return (
      Object.keys(miscDataProps).length > 0
        ? { data: createData, miscDataProps: miscDataProps }
        : { data: createData }
    ) as JSONObject;
  }

  /*
   * The ids of an owner input: a list of user or team IDs, each once. One
   * that is not an ID is refused before any request is made, in words that
   * say where to find one, rather than adding none of the owners.
   */
  private static readOwnerIds(key: string, value: unknown): Array<string> {
    if (value === undefined || value === null) {
      return [];
    }

    const values: Array<unknown> = Array.isArray(value) ? value : [value];
    const ids: Array<string> = [];

    for (const each of values) {
      const id: string = typeof each === "string" ? each.trim() : "";

      if (!ObjectID.isValidUUID(id)) {
        throw new Error(
          key === OWNER_TEAMS_ON_CREATE_KEY
            ? `Invalid ${key} entry '${String(each)}': expected the ID of a team of this project, a UUID like "550e8400-e29b-41d4-a716-446655440000". Use the list_teams tool to find one.`
            : `Invalid ${key} entry '${String(each)}': expected the ID of a user of this project, a UUID like "550e8400-e29b-41d4-a716-446655440000".`,
        );
      }

      if (
        !ids.some((known: string): boolean => {
          return known.toLowerCase() === id.toLowerCase();
        })
      ) {
        ids.push(id);
      }
    }

    return ids;
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

  /**
   * Normalize a caller-provided select (array of field names or select
   * object) into the API's { field: true } shape, falling back to the
   * generated default select.
   */
  private static resolveSelect(
    select: JSONObject | string[] | undefined,
    tableName: string,
    modelType: ModelType,
  ): JSONObject {
    if (Array.isArray(select)) {
      const selectObject: JSONObject = {};
      for (const field of select) {
        if (typeof field === "string" && field.length > 0) {
          selectObject[field] = true;
        }
      }
      if (Object.keys(selectObject).length > 0) {
        return selectObject;
      }
    } else if (
      select &&
      typeof select === "object" &&
      Object.keys(select).length > 0
    ) {
      return select;
    }

    return generateAllFieldsSelect(tableName, modelType);
  }

  private static buildQueryData(
    args: OneUptimeToolCallArgs,
    tableName: string,
    modelType: ModelType,
  ): JSONObject {
    const requestData: JSONObject = {
      query: args.query || {},
      select: this.resolveSelect(args.select, tableName, modelType),
      skip: args.skip,
      limit: args.limit,
      sort: args.sort,
    } as JSONObject;

    MCPLogger.debug(`Request data: ${JSON.stringify(requestData)}`);
    return requestData;
  }

  private static buildReadData(
    args: OneUptimeToolCallArgs,
    tableName: string,
    modelType: ModelType,
  ): JSONObject {
    const readRequestData: JSONObject = {
      select: this.resolveSelect(args.select, tableName, modelType),
    } as JSONObject;

    MCPLogger.debug(
      `Request data for Read: ${JSON.stringify(readRequestData)}`,
    );
    return readRequestData;
  }

  /**
   * Build headers for API request. An API key is forwarded as it came; an
   * OAuth credential is presented as a freshly minted delegation token (see
   * Types/McpCredential), never as the client's own access token.
   */
  private static buildHeaders(credential: McpCredentialInput): Headers {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...McpCredentialUtil.getApiHeaders(credential),
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
   * Validate that the caller presented a credential: an API key, or an OAuth
   * sign-in. The MCP endpoint normally refuses an unauthenticated call before
   * it gets this far (OAuth/RequestGate); this is what such a call meets when
   * OAuth is switched off, or when it arrives some other way.
   */
  private static validateCredential(credential: McpCredentialInput): void {
    if (!McpCredentialUtil.isPresent(credential)) {
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
