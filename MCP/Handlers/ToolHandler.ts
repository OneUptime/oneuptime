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
import { McpToolInfo, OneUptimeToolCallArgs, JSONSchema } from "../Types/McpTypes";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import OneUptimeApiService from "../Services/OneUptimeApiService";
import SessionManager from "../Server/SessionManager";
import { LIST_PREVIEW_LIMIT } from "../Config/ServerConfig";
import logger from "Common/Server/Utils/Logger";

/**
 * Register tool handlers on the MCP server
 */
export function registerToolHandlers(mcpServer: McpServer, tools: McpToolInfo[]): void {
    // Register list tools handler
    mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => {
        return handleListTools(tools);
    });

    // Register call tool handler
    mcpServer.server.setRequestHandler(
        CallToolRequestSchema,
        async (request: CallToolRequest) => {
            return handleCallTool(request, tools);
        }
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
    }> = tools.map((tool: McpToolInfo) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
    }));

    logger.info(`Listing ${mcpTools.length} available tools`);
    return { tools: mcpTools };
}

/**
 * Handle tool call request
 */
async function handleCallTool(
    request: CallToolRequest,
    tools: McpToolInfo[]
): Promise<{ content: Array<{ type: string; text: string }> }> {
    const { name, arguments: args } = request.params;

    try {
        // Find the tool by name
        const tool: McpToolInfo | undefined = tools.find(
            (t: McpToolInfo) => t.name === name
        );

        if (!tool) {
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }

        logger.info(`Executing tool: ${name} for model: ${tool.modelName}`);

        // Validate API key is available for this session
        const apiKey: string = SessionManager.getCurrentApiKey();
        if (!apiKey) {
            throw new McpError(
                ErrorCode.InvalidRequest,
                "API key is required. Please provide x-api-key header in your request."
            );
        }

        // Execute the OneUptime operation with the session's API key
        const result: unknown = await OneUptimeApiService.executeOperation(
            tool.tableName,
            tool.operation,
            tool.modelType,
            tool.apiPath || "",
            args as OneUptimeToolCallArgs,
            apiKey
        );

        // Format the response
        const responseText: string = formatToolResponse(
            tool,
            result,
            args as OneUptimeToolCallArgs
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
            `Failed to execute ${name}: ${error}`
        );
    }
}

/**
 * Format tool response based on operation type
 */
export function formatToolResponse(
    tool: McpToolInfo,
    result: unknown,
    args: OneUptimeToolCallArgs
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
    return `Successfully created ${modelName}: ${JSON.stringify(result, null, 2)}`;
}

function formatReadResponse(
    modelName: string,
    result: unknown,
    id: string | undefined
): string {
    if (result) {
        return `Retrieved ${modelName} (ID: ${id}): ${JSON.stringify(result, null, 2)}`;
    }
    return `${modelName} not found with ID: ${id}`;
}

function formatListResponse(
    modelName: string,
    pluralName: string,
    result: unknown
): string {
    const items: Array<unknown> = Array.isArray(result)
        ? result
        : (result as { data?: Array<unknown> })?.data || [];
    const count: number = items.length;
    const summary: string = `Found ${count} ${count === 1 ? modelName : pluralName}`;

    if (count === 0) {
        return `${summary}. No items match the criteria.`;
    }

    const limitedItems: Array<unknown> = items.slice(0, LIST_PREVIEW_LIMIT);
    const itemsText: string = limitedItems
        .map((item: unknown, index: number) => `${index + 1}. ${JSON.stringify(item, null, 2)}`)
        .join("\n");

    const hasMore: string =
        count > LIST_PREVIEW_LIMIT ? `\n... and ${count - LIST_PREVIEW_LIMIT} more items` : "";
    return `${summary}:\n${itemsText}${hasMore}`;
}

function formatUpdateResponse(
    modelName: string,
    result: unknown,
    id: string | undefined
): string {
    return `Successfully updated ${modelName} (ID: ${id}): ${JSON.stringify(result, null, 2)}`;
}

function formatDeleteResponse(modelName: string, id: string | undefined): string {
    return `Successfully deleted ${modelName} (ID: ${id})`;
}

function formatCountResponse(pluralName: string, result: unknown): string {
    const totalCount: number =
        (result as { count?: number })?.count || (result as number) || 0;
    return `Total count of ${pluralName}: ${totalCount}`;
}
