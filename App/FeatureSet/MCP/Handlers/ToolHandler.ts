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
} from "../Types/McpTypes";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import OneUptimeApiService from "../Services/OneUptimeApiService";
import SessionManager from "../Server/SessionManager";
import { LIST_PREVIEW_LIMIT } from "../Config/ServerConfig";
import { isHelperTool, handleHelperTool } from "../Tools/HelperTools";
import {
  isPublicStatusPageTool,
  handlePublicStatusPageTool,
} from "../Tools/PublicStatusPageTools";
import logger from "Common/Server/Utils/Logger";

/**
 * Register tool handlers on the MCP server
 */
export function registerToolHandlers(
  mcpServer: McpServer,
  tools: McpToolInfo[],
): void {
  // Register list tools handler
  mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => {
    return handleListTools(tools);
  });

  // Register call tool handler
  mcpServer.server.setRequestHandler(
    CallToolRequestSchema,
    async (request: CallToolRequest) => {
      return handleCallTool(request, tools);
    },
  );

  logger.info(`Registered handlers for ${tools.length} tools`);
}

/**
 * Handle list tools request
 */
function handleListTools(tools: McpToolInfo[]): {
  tools: Array<{ name: string; description: string; inputSchema: JSONSchema }>;
} {
  const mcpTools: Array<{
    name: string;
    description: string;
    inputSchema: JSONSchema;
  }> = tools.map((tool: McpToolInfo) => {
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    };
  });

  logger.info(`Listing ${mcpTools.length} available tools`);
  return { tools: mcpTools };
}

/**
 * Handle tool call request
 */
async function handleCallTool(
  request: CallToolRequest,
  tools: McpToolInfo[],
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { name, arguments: args } = request.params;

  try {
    // Check if this is a helper tool (doesn't require API key)
    if (isHelperTool(name)) {
      logger.info(`Executing helper tool: ${name}`);
      const responseText: string = handleHelperTool(
        name,
        (args || {}) as Record<string, unknown>,
        tools.filter((t: McpToolInfo) => {
          return !isHelperTool(t.name) && !isPublicStatusPageTool(t.name);
        }),
      );
      return {
        content: [
          {
            type: "text",
            text: responseText,
          },
        ],
      };
    }

    // Check if this is a public status page tool (doesn't require API key)
    if (isPublicStatusPageTool(name)) {
      logger.info(`Executing public status page tool: ${name}`);
      const responseText: string = await handlePublicStatusPageTool(
        name,
        (args || {}) as Record<string, unknown>,
      );
      return {
        content: [
          {
            type: "text",
            text: responseText,
          },
        ],
      };
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

    logger.info(`Executing tool: ${name} for model: ${tool.modelName}`);

    // Validate API key is available for this session
    const apiKey: string = SessionManager.getCurrentApiKey();
    if (!apiKey) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "API key is required. Please provide x-api-key header in your request. Use 'oneuptime_help' to learn more.",
      );
    }

    // Execute the OneUptime operation with the session's API key
    const result: unknown = await OneUptimeApiService.executeOperation(
      tool.tableName,
      tool.operation,
      tool.modelType,
      tool.apiPath || "",
      args as OneUptimeToolCallArgs,
      apiKey,
    );

    // Format the response
    const responseText: string = formatToolResponse(
      tool,
      result,
      args as OneUptimeToolCallArgs,
    );

    return {
      content: [
        {
          type: "text",
          text: responseText,
        },
      ],
    };
  } catch (error) {
    logger.error(`Error executing tool ${name}: ${error}`);

    if (error instanceof McpError) {
      throw error;
    }

    throw new McpError(
      ErrorCode.InternalError,
      `Failed to execute ${name}: ${error}. Use 'oneuptime_help' for guidance.`,
    );
  }
}

/**
 * Format tool response based on operation type
 */
export function formatToolResponse(
  tool: McpToolInfo,
  result: unknown,
  args: OneUptimeToolCallArgs,
): string {
  const operation: OneUptimeOperation = tool.operation;
  const modelName: string = tool.singularName;
  const pluralName: string = tool.pluralName;

  switch (operation) {
    case OneUptimeOperation.Create:
      return formatCreateResponse(modelName, result);

    case OneUptimeOperation.Read:
      return formatReadResponse(modelName, result, args.id);

    case OneUptimeOperation.List:
      return formatListResponse(modelName, pluralName, result);

    case OneUptimeOperation.Update:
      return formatUpdateResponse(modelName, result, args.id);

    case OneUptimeOperation.Delete:
      return formatDeleteResponse(modelName, args.id);

    case OneUptimeOperation.Count:
      return formatCountResponse(pluralName, result);

    default:
      return `Operation ${operation} completed successfully: ${JSON.stringify(result, null, 2)}`;
  }
}

function formatCreateResponse(modelName: string, result: unknown): string {
  const response: Record<string, unknown> = {
    success: true,
    operation: "create",
    resourceType: modelName,
    message: `Successfully created ${modelName}`,
    data: result,
  };
  return JSON.stringify(response, null, 2);
}

function formatReadResponse(
  modelName: string,
  result: unknown,
  id: string | undefined,
): string {
  if (result) {
    const response: Record<string, unknown> = {
      success: true,
      operation: "read",
      resourceType: modelName,
      resourceId: id,
      data: result,
    };
    return JSON.stringify(response, null, 2);
  }
  const response: Record<string, unknown> = {
    success: false,
    operation: "read",
    resourceType: modelName,
    resourceId: id,
    error: `${modelName} not found with ID: ${id}`,
    suggestion: `Use list_${modelName.toLowerCase().replace(/\s+/g, "_")}s to find valid IDs`,
  };
  return JSON.stringify(response, null, 2);
}

function formatListResponse(
  modelName: string,
  pluralName: string,
  result: unknown,
): string {
  const items: Array<unknown> = Array.isArray(result)
    ? result
    : (result as { data?: Array<unknown> })?.data || [];
  const count: number = items.length;

  const response: Record<string, unknown> = {
    success: true,
    operation: "list",
    resourceType: pluralName,
    totalReturned: count,
    hasMore: count >= LIST_PREVIEW_LIMIT,
    message:
      count === 0
        ? `No ${pluralName} found matching the criteria`
        : `Found ${count} ${count === 1 ? modelName : pluralName}`,
    data: items.slice(0, LIST_PREVIEW_LIMIT),
  };

  if (count > LIST_PREVIEW_LIMIT) {
    response["note"] =
      `Showing first ${LIST_PREVIEW_LIMIT} results. Use 'skip' parameter to paginate.`;
  }

  return JSON.stringify(response, null, 2);
}

function formatUpdateResponse(
  modelName: string,
  result: unknown,
  id: string | undefined,
): string {
  const response: Record<string, unknown> = {
    success: true,
    operation: "update",
    resourceType: modelName,
    resourceId: id,
    message: `Successfully updated ${modelName}`,
    data: result,
  };
  return JSON.stringify(response, null, 2);
}

function formatDeleteResponse(
  modelName: string,
  id: string | undefined,
): string {
  const response: Record<string, unknown> = {
    success: true,
    operation: "delete",
    resourceType: modelName,
    resourceId: id,
    message: `Successfully deleted ${modelName} (ID: ${id})`,
  };
  return JSON.stringify(response, null, 2);
}

function formatCountResponse(pluralName: string, result: unknown): string {
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

  const response: Record<string, unknown> = {
    success: true,
    operation: "count",
    resourceType: pluralName,
    count: totalCount,
    message: `Total count of ${pluralName}: ${totalCount}`,
  };
  return JSON.stringify(response, null, 2);
}
