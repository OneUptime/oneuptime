/**
 * Tool Handler
 * Handles MCP tool execution and response formatting
 */

import {
  CallToolRequestSchema,
  CallToolRequest,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  McpToolInfo,
  OneUptimeToolCallArgs,
  JSONSchema,
  ToolAnnotations,
} from "../Types/McpTypes";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import OneUptimeApiService, {
  OneUptimeApiError,
} from "../Services/OneUptimeApiService";
import { LIST_DEFAULT_LIMIT } from "../Config/ServerConfig";
import { isHelperTool, handleHelperTool } from "../Tools/HelperTools";
import {
  isPublicStatusPageTool,
  handlePublicStatusPageTool,
} from "../Tools/PublicStatusPageTools";
import { isWorkflowTool, handleWorkflowTool } from "../Tools/WorkflowTools";
import { sanitizeToolName } from "../Tools/SchemaConverter";
import RequestGate, { McpToolAccess } from "../OAuth/RequestGate";
import McpCredentialUtil, {
  McpCredential,
  McpCredentialInput,
} from "../Types/McpCredential";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";

/*
 * Result shape for MCP tools/call responses. The index signature keeps the
 * type assignable to the SDK's ServerResult union.
 */
export interface ToolCallResult {
  [key: string]: unknown;
  content: Array<{ type: string; text: string }>;
  structuredContent?: JSONObject;
  isError?: boolean;
}

// Tool shape for MCP tools/list responses
interface ListedTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  title?: string;
  annotations?: ToolAnnotations;
}

/**
 * Register tool handlers on the MCP server.
 *
 * `credential` is what the request that created this (stateless) server
 * instance arrived with: an API key (a bare string, as it has always been) or
 * the credential of a client that signed in with OAuth. The call-tool handler
 * closes over it so each request uses its own — avoiding the race condition
 * that a process-global "current API key" would create under concurrent
 * requests.
 */
export function registerToolHandlers(
  mcpServer: McpServer,
  tools: McpToolInfo[],
  credential: McpCredentialInput,
): void {
  // Register list tools handler
  mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => {
    return handleListTools(tools);
  });

  // Register call tool handler
  mcpServer.server.setRequestHandler(
    CallToolRequestSchema,
    async (request: CallToolRequest) => {
      return handleCallTool(request, tools, McpCredentialUtil.from(credential));
    },
  );

  logger.debug(`Registered handlers for ${tools.length} tools`);
}

/**
 * Handle list tools request
 */
function handleListTools(tools: McpToolInfo[]): {
  tools: ListedTool[];
} {
  const mcpTools: ListedTool[] = tools.map((tool: McpToolInfo): ListedTool => {
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      ...(tool.title ? { title: tool.title } : {}),
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
    };
  });

  logger.debug(`Listing ${mcpTools.length} available tools`);
  return { tools: mcpTools };
}

/**
 * Wrap a response envelope as an MCP tool result: compact JSON text for
 * every client plus structuredContent for clients that consume it.
 */
function toToolResult(envelope: JSONObject): ToolCallResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(envelope),
      },
    ],
    structuredContent: envelope,
  };
}

/**
 * Wrap raw JSON text (from helper/public tools) as an MCP tool result.
 */
function textToToolResult(responseText: string): ToolCallResult {
  let structured: JSONObject | undefined = undefined;
  try {
    const parsed: unknown = JSON.parse(responseText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      structured = parsed as JSONObject;
    }
  } catch {
    // Not JSON — return text only
  }

  return {
    content: [
      {
        type: "text",
        text: responseText,
      },
    ],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

/**
 * Build an isError tool result so the calling agent sees the failure text
 * and can self-correct (per MCP spec, execution errors should be in-band
 * results, not JSON-RPC protocol errors).
 */
function buildErrorResult(
  toolName: string,
  error: unknown,
  credential?: McpCredential | undefined,
  // What to try next, when the default for this kind of error would mislead.
  suggestion?: string | undefined,
): ToolCallResult {
  const payload: JSONObject = {
    success: false,
    tool: toolName,
    error: error instanceof Error ? error.message : String(error),
  };

  if (error instanceof OneUptimeApiError) {
    payload["statusCode"] = error.statusCode;
    if (error.details !== undefined && error.details !== null) {
      payload["details"] = error.details as JSONValue;
    }
    payload["suggestion"] = getSuggestionForStatusCode(
      error.statusCode,
      McpCredentialUtil.isOAuth(credential),
    );
  } else {
    payload["suggestion"] =
      suggestion ||
      "Check the tool's input schema for required parameters. Use 'oneuptime_help' for guidance.";
  }

  const result: ToolCallResult = {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload),
      },
    ],
    structuredContent: payload,
    isError: true,
  };
  return result;
}

/*
 * What to try next, worded for the credential in use. An agent that signed in
 * with OAuth has no key to fix: it acts as a person, so a refusal is about
 * that person's permissions in the project.
 */
function getSuggestionForStatusCode(
  statusCode: number,
  isOAuth: boolean,
): string {
  switch (statusCode) {
    case 400:
      return "The request was invalid. Check required parameters and value formats against the tool's input schema; the details field usually names the offending field.";
    case 401:
      return isOAuth
        ? "The sign-in was not accepted for this request. The user may have left the project or been blocked; ask them to connect this MCP client again."
        : "The API key was rejected. Verify the key is correct and not expired (sent via the x-api-key header).";
    /*
     * The project's plan does not include what was asked - for an API key,
     * possibly the key itself: below the plan that sells API keys, every
     * request made with one is refused (Common/Types/Billing/
     * PlanCutoffCredentials). The error names the plan; retrying cannot help.
     */
    case 402:
      return "The project's plan does not include this; the error names the plan it needs. Do not retry: ask a project owner to upgrade the project in Project Settings > Billing.";
    case 403:
      return isOAuth
        ? "The signed-in user lacks permission for this operation in this project. Ask a project admin to grant their team the relevant permission."
        : "The API key lacks permission for this operation. Ask a project admin to grant the relevant permission to the key.";
    case 404:
      return "The resource was not found. Use the corresponding list tool to find valid IDs.";
    case 429:
      return "Rate limited. Wait a moment and retry.";
    default:
      return "Use 'oneuptime_help' for guidance on available tools and workflows.";
  }
}

/**
 * Handle tool call request
 */
async function handleCallTool(
  request: CallToolRequest,
  tools: McpToolInfo[],
  credential: McpCredential,
): Promise<ToolCallResult> {
  const { name } = request.params;
  // `arguments` is optional in the MCP CallToolRequest — normalize once here.
  const args: Record<string, unknown> = (request.params.arguments ||
    {}) as Record<string, unknown>;

  try {
    /*
     * A client that signed in read-only calling a tool that changes things.
     * The HTTP layer refuses this with a 403 challenge before the SDK runs
     * (OAuth/RequestGate), which is what lets the client ask its user for
     * more access; this is the same rule held a second time, so that no path
     * to a tool handler - whatever it is - skips it.
     */
    if (
      RequestGate.getToolAccess(name, tools) === McpToolAccess.Write &&
      !McpCredentialUtil.canWrite(credential)
    ) {
      return buildErrorResult(
        name,
        new Error(
          "This connection was authorized as read-only, and this tool makes changes. The user must authorize read and write access to use it.",
        ),
        credential,
        // Nothing is wrong with the arguments, so the default would mislead.
        "Do not retry this tool. Ask the user to connect this MCP client again and choose read and write access. The get, list and count tools still work.",
      );
    }

    // Check if this is a helper tool (doesn't require API key)
    if (isHelperTool(name)) {
      logger.debug(`Executing helper tool: ${name}`);
      const responseText: string = handleHelperTool(
        name,
        args,
        tools.filter((t: McpToolInfo) => {
          return (
            !isHelperTool(t.name) &&
            !isPublicStatusPageTool(t.name) &&
            !isWorkflowTool(t.name)
          );
        }),
      );
      return textToToolResult(responseText);
    }

    // Check if this is a public status page tool (doesn't require API key)
    if (isPublicStatusPageTool(name)) {
      logger.debug(`Executing public status page tool: ${name}`);
      const responseText: string = await handlePublicStatusPageTool(name, args);
      return textToToolResult(responseText);
    }

    // Workflow tools (acknowledge/resolve/notes/whoami) require an API key or a sign-in
    if (isWorkflowTool(name)) {
      logger.debug(`Executing workflow tool: ${name}`);
      if (!McpCredentialUtil.isPresent(credential)) {
        return buildErrorResult(
          name,
          new Error(
            "API key is required. Please provide the x-api-key header in your MCP server configuration.",
          ),
        );
      }
      const envelope: JSONObject = await handleWorkflowTool(
        name,
        args,
        credential,
      );
      return toToolResult(envelope);
    }

    // Find the tool by name
    const tool: McpToolInfo | undefined = tools.find((t: McpToolInfo) => {
      return t.name === name;
    });

    if (!tool) {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${name}. Use 'oneuptime_help' to see available tools.`,
      );
    }

    logger.debug(`Executing tool: ${name} for model: ${tool.modelName}`);

    // Validate a credential is available for this request
    if (!McpCredentialUtil.isPresent(credential)) {
      return buildErrorResult(
        name,
        new Error(
          "API key is required. Please provide the x-api-key header in your MCP server configuration. Use 'oneuptime_help' to learn more.",
        ),
      );
    }

    // Execute the OneUptime operation with this request's credential
    const result: unknown = await OneUptimeApiService.executeOperation(
      tool.tableName,
      tool.operation,
      tool.modelType,
      tool.apiPath || "",
      args as OneUptimeToolCallArgs,
      credential,
    );

    // Format the response
    const envelope: JSONObject = formatToolResponse(
      tool,
      result,
      args as OneUptimeToolCallArgs,
    );

    return toToolResult(envelope);
  } catch (error) {
    logger.error(`Error executing tool ${name}: ${error}`);

    // Protocol errors (unknown tool) stay protocol errors
    if (error instanceof McpError) {
      throw error;
    }

    // Execution errors are returned in-band so the agent can self-correct
    return buildErrorResult(name, error, credential);
  }
}

/**
 * Format tool response based on operation type
 */
export function formatToolResponse(
  tool: McpToolInfo,
  result: unknown,
  args: OneUptimeToolCallArgs,
): JSONObject {
  const operation: OneUptimeOperation = tool.operation;
  const modelName: string = tool.singularName;
  const pluralName: string = tool.pluralName;

  switch (operation) {
    case OneUptimeOperation.Create:
      return formatCreateResponse(modelName, result);

    case OneUptimeOperation.Read:
      return formatReadResponse(tool, result, args.id);

    case OneUptimeOperation.List:
      return formatListResponse(modelName, pluralName, result, args);

    case OneUptimeOperation.Update:
      return formatUpdateResponse(tool, args.id);

    case OneUptimeOperation.Delete:
      return formatDeleteResponse(modelName, args.id);

    case OneUptimeOperation.Count:
      return formatCountResponse(pluralName, result);

    default:
      return {
        success: true,
        operation: operation,
        data: result as JSONValue,
      } as JSONObject;
  }
}

function formatCreateResponse(modelName: string, result: unknown): JSONObject {
  return {
    success: true,
    operation: "create",
    resourceType: modelName,
    message: `Successfully created ${modelName}`,
    data: result as JSONValue,
  } as JSONObject;
}

function formatReadResponse(
  tool: McpToolInfo,
  result: unknown,
  id: string | undefined,
): JSONObject {
  const modelName: string = tool.singularName;

  if (result) {
    return {
      success: true,
      operation: "read",
      resourceType: modelName,
      resourceId: id ?? null,
      data: result as JSONValue,
    } as JSONObject;
  }

  return {
    success: false,
    operation: "read",
    resourceType: modelName,
    resourceId: id ?? null,
    error: `${modelName} not found with ID: ${id}`,
    suggestion: `Use list_${sanitizeToolName(tool.pluralName)} to find valid IDs`,
  } as JSONObject;
}

function formatListResponse(
  modelName: string,
  pluralName: string,
  result: unknown,
  args: OneUptimeToolCallArgs,
): JSONObject {
  /*
   * BaseAPI get-list returns { data: [...], count: <total matching rows>,
   * skip, limit } — but the echoed skip/limit reflect the query string only,
   * so pagination math must use our own request args plus the total count.
   */
  const resultObject: { data?: Array<unknown>; count?: number } | null =
    result && typeof result === "object"
      ? (result as { data?: Array<unknown>; count?: number })
      : null;

  const items: Array<unknown> = Array.isArray(result)
    ? result
    : resultObject?.data || [];

  const skipUsed: number = typeof args.skip === "number" ? args.skip : 0;
  const limitUsed: number =
    typeof args.limit === "number" ? args.limit : LIST_DEFAULT_LIMIT;

  const totalCount: number | undefined =
    typeof resultObject?.count === "number" ? resultObject.count : undefined;

  const hasMore: boolean =
    totalCount !== undefined
      ? skipUsed + items.length < totalCount
      : items.length >= limitUsed;

  const response: JSONObject = {
    success: true,
    operation: "list",
    resourceType: pluralName,
    returnedCount: items.length,
    totalCount: totalCount ?? null,
    skip: skipUsed,
    limit: limitUsed,
    hasMore,
    message:
      items.length === 0
        ? `No ${pluralName} found matching the criteria`
        : `Returning ${items.length} of ${totalCount ?? "unknown"} matching ${
            items.length === 1 ? modelName : pluralName
          }`,
    data: items as JSONValue,
  } as JSONObject;

  if (hasMore) {
    response["note"] =
      `More results available. Repeat the call with skip=${skipUsed + items.length} to get the next page.`;
  }

  return response;
}

function formatUpdateResponse(
  tool: McpToolInfo,
  id: string | undefined,
): JSONObject {
  // The OneUptime API returns an empty body on update — don't fabricate data.
  return {
    success: true,
    operation: "update",
    resourceType: tool.singularName,
    resourceId: id ?? null,
    message: `Successfully updated ${tool.singularName} (ID: ${id}).`,
    note: `Use get_${sanitizeToolName(tool.singularName)} with this id to see the updated record.`,
  } as JSONObject;
}

function formatDeleteResponse(
  modelName: string,
  id: string | undefined,
): JSONObject {
  return {
    success: true,
    operation: "delete",
    resourceType: modelName,
    resourceId: id ?? null,
    message: `Successfully deleted ${modelName} (ID: ${id})`,
  } as JSONObject;
}

function formatCountResponse(pluralName: string, result: unknown): JSONObject {
  let totalCount: number = 0;

  if (result !== null && result !== undefined) {
    if (typeof result === "number") {
      totalCount = result;
    } else if (typeof result === "object") {
      const resultObj: Record<string, unknown> = result as Record<
        string,
        unknown
      >;

      // Handle { count: number } format
      if ("count" in resultObj) {
        const countValue: unknown = resultObj["count"];
        if (typeof countValue === "number") {
          totalCount = countValue;
        } else if (typeof countValue === "object" && countValue !== null) {
          // Handle PositiveNumber or other objects with value/toNumber
          const countObj: Record<string, unknown> = countValue as Record<
            string,
            unknown
          >;
          if (typeof countObj["value"] === "number") {
            totalCount = countObj["value"];
          } else if (
            typeof (countObj as { toNumber?: () => number }).toNumber ===
            "function"
          ) {
            totalCount = (countObj as { toNumber: () => number }).toNumber();
          }
        }
      }
      // Handle { data: { count: number } } format
      else if (
        "data" in resultObj &&
        typeof resultObj["data"] === "object" &&
        resultObj["data"] !== null
      ) {
        const dataObj: Record<string, unknown> = resultObj["data"] as Record<
          string,
          unknown
        >;
        if ("count" in dataObj && typeof dataObj["count"] === "number") {
          totalCount = dataObj["count"];
        }
      }
    }
  }

  return {
    success: true,
    operation: "count",
    resourceType: pluralName,
    count: totalCount,
    message: `Total count of ${pluralName}: ${totalCount}`,
  } as JSONObject;
}
