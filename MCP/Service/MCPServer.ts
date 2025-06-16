import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import DynamicMCPGenerator, { MCPTool } from "./DynamicMCPGenerator";

export default class MCP {
  private server: Server;
  private tools: MCPTool[] = [];

  public constructor() {
    this.server = new Server(
      {
        name: "oneuptime-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private async setupHandlers(): Promise<void> {
    // Initialize the dynamic generator and load tools
    await this.loadTools();

    // List tools handler
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: this.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      };
    });

    // Call tool handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      const tool = this.tools.find(t => t.name === name);
      if (!tool) {
        throw new Error(`Unknown tool: ${name}`);
      }

      try {
        const result = await tool.handler(args as any || {});
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        throw new Error(`Tool execution failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  private async loadTools(): Promise<void> {
    try {
      // Generate all tools dynamically from OpenAPI spec and models
      this.tools = await DynamicMCPGenerator.generateAllTools();
      
      // Add some additional utility tools
      this.tools.push(...this.getUtilityTools());
      
      console.error(`Loaded ${this.tools.length} tools for OneUptime MCP server`);
      
      // Log available models for debugging
      const models = DynamicMCPGenerator.getAvailableModels();
      console.error(`Available models: ${models.map(m => m.name).join(", ")}`);
    } catch (error) {
      console.error("Failed to load tools:", error);
      this.tools = this.getUtilityTools(); // Fallback to utility tools only
    }
  }

  private getUtilityTools(): MCPTool[] {
    return [
      {
        name: "list_available_models",
        description: "List all available OneUptime models that can be managed",
        inputSchema: {
          type: "object",
          properties: {},
        },
        handler: async () => {
          const models = DynamicMCPGenerator.getAvailableModels();
          return {
            models: models.map(model => ({
              name: model.name,
              description: model.description,
              endpoints: model.endpoints,
            })),
            total: models.length,
          };
        },
      },
      {
        name: "get_model_schema",
        description: "Get the schema definition for a specific model",
        inputSchema: {
          type: "object",
          properties: {
            modelName: {
              type: "string",
              description: "The name of the model to get schema for",
            },
          },
          required: ["modelName"],
        },
        handler: async (args) => {
          const modelName = args["modelName"] as string;
          const schema = DynamicMCPGenerator.getModelSchema(modelName);
          
          if (!schema) {
            return {
              error: `Schema not found for model: ${modelName}`,
              availableModels: DynamicMCPGenerator.getAvailableModels().map(m => m.name),
            };
          }
          
          return {
            modelName,
            schema,
          };
        },
      },
      {
        name: "get_openapi_endpoints",
        description: "Get all available OpenAPI endpoints",
        inputSchema: {
          type: "object",
          properties: {
            filter: {
              type: "string",
              description: "Optional filter to search for specific endpoints",
            },
          },
        },
        handler: async (args) => {
          const endpoints = DynamicMCPGenerator.getOpenApiEndpoints();
          const filter = args["filter"] as string;
          
          if (filter) {
            const filteredEndpoints: Record<string, any> = {};
            for (const [path, config] of Object.entries(endpoints)) {
              if (path.toLowerCase().includes(filter.toLowerCase())) {
                filteredEndpoints[path] = config;
              }
            }
            return {
              filter,
              endpoints: filteredEndpoints,
              total: Object.keys(filteredEndpoints).length,
            };
          }
          
          return {
            endpoints,
            total: Object.keys(endpoints).length,
          };
        },
      },
    ];
  }

  public async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("OneUptime MCP server running on stdio");
  }
}
