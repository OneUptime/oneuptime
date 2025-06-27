#!/usr/bin/env npx ts-node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import DynamicToolGenerator from "./Utils/DynamicToolGenerator";
import OneUptimeApiService, { OneUptimeApiConfig } from "./Services/OneUptimeApiService";
import { McpToolInfo, OneUptimeToolCallArgs } from "./Types/McpTypes";
import OneUptimeOperation from "./Types/OneUptimeOperation";
import MCPLogger from "./Utils/MCPLogger";

// Load environment variables (suppress console output)
const originalConsoleLog = console.log;
console.log = () => {}; // Temporarily disable console.log
dotenv.config();
console.log = originalConsoleLog; // Restore console.log

MCPLogger.info("OneUptime MCP Server is starting...");

class OneUptimeMCPServer {
  private server: Server;
  private tools: McpToolInfo[] = [];

  constructor() {
    this.server = new Server(
      {
        name: "oneuptime-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.initializeServices();
    this.generateTools();
    this.setupHandlers();
  }

  private initializeServices(): void {
    // Initialize OneUptime API Service
    const apiKey = process.env['ONEUPTIME_API_KEY'];
    if (!apiKey) {
      throw new Error("OneUptime API key is required. Please set ONEUPTIME_API_KEY environment variable.");
    }

    const config: OneUptimeApiConfig = {
      url: process.env['ONEUPTIME_URL'] || "https://oneuptime.com",
      apiKey: apiKey,
    };

    OneUptimeApiService.initialize(config);
    MCPLogger.info("OneUptime API Service initialized");
  }

  private generateTools(): void {
    try {
      this.tools = DynamicToolGenerator.generateAllTools();
      MCPLogger.info(`Generated ${this.tools.length} OneUptime MCP tools`);
    } catch (error) {
      MCPLogger.error(`Failed to generate tools: ${error}`);
      throw error;
    }
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const mcpTools = this.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));

      MCPLogger.info(`Listing ${mcpTools.length} available tools`);
      return { tools: mcpTools };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        // Find the tool by name
        const tool = this.tools.find((t) => t.name === name);
        if (!tool) {
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${name}`
          );
        }

        MCPLogger.info(`Executing tool: ${name} for model: ${tool.modelName}`);

        // Execute the OneUptime operation
        const result = await OneUptimeApiService.executeOperation(
          tool.tableName,
          tool.operation,
          tool.modelType,
          tool.apiPath || "",
          args as OneUptimeToolCallArgs
        );

        // Format the response
        const responseText = this.formatToolResponse(tool, result, args as OneUptimeToolCallArgs);

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      } catch (error) {
        MCPLogger.error(`Error executing tool ${name}: ${error}`);
        
        if (error instanceof McpError) {
          throw error;
        }
        
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to execute ${name}: ${error}`
        );
      }
    });
  }

  private formatToolResponse(tool: McpToolInfo, result: any, args: OneUptimeToolCallArgs): string {
    const operation = tool.operation;
    const modelName = tool.singularName;
    const pluralName = tool.pluralName;

    switch (operation) {
      case OneUptimeOperation.Create:
        return `✅ Successfully created ${modelName}: ${JSON.stringify(result, null, 2)}`;
      
      case OneUptimeOperation.Read:
        if (result) {
          return `📋 Retrieved ${modelName} (ID: ${args.id}): ${JSON.stringify(result, null, 2)}`;
        } else {
          return `❌ ${modelName} not found with ID: ${args.id}`;
        }
      
      case OneUptimeOperation.List:
        const items = Array.isArray(result) ? result : result?.data || [];
        const count = items.length;
        const summary = `📊 Found ${count} ${count === 1 ? modelName : pluralName}`;
        
        if (count === 0) {
          return `${summary}. No items match the criteria.`;
        }
        
        const limitedItems = items.slice(0, 5); // Show first 5 items
        const itemsText = limitedItems.map((item: any, index: number) => 
          `${index + 1}. ${JSON.stringify(item, null, 2)}`
        ).join('\n');
        
        const hasMore = count > 5 ? `\n... and ${count - 5} more items` : '';
        return `${summary}:\n${itemsText}${hasMore}`;
      
      case OneUptimeOperation.Update:
        return `✅ Successfully updated ${modelName} (ID: ${args.id}): ${JSON.stringify(result, null, 2)}`;
      
      case OneUptimeOperation.Delete:
        return `🗑️ Successfully deleted ${modelName} (ID: ${args.id})`;
      
      case OneUptimeOperation.Count:
        const totalCount = result?.count || result || 0;
        return `📊 Total count of ${pluralName}: ${totalCount}`;
      
      default:
        return `✅ Operation ${operation} completed successfully: ${JSON.stringify(result, null, 2)}`;
    }
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    MCPLogger.info("OneUptime MCP Server is running!");
    MCPLogger.info(`Available tools: ${this.tools.length} total`);
    
    // Log some example tools
    const exampleTools = this.tools.slice(0, 5).map(t => t.name);
    MCPLogger.info(`Example tools: ${exampleTools.join(', ')}`);
  }
}

// Start the server
async function main(): Promise<void> {
  try {
    const mcpServer = new OneUptimeMCPServer();
    await mcpServer.run();
  } catch (error) {
    MCPLogger.error(`Failed to start MCP server: ${error}`);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  MCPLogger.info("Received SIGINT, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  MCPLogger.info("Received SIGTERM, shutting down gracefully...");
  process.exit(0);
});

// Start the server
main().catch((error) => {
  MCPLogger.error(`Unhandled error: ${error}`);
  process.exit(1);
});
