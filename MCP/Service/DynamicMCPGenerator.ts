import fs from "fs";
import path from "path";
import { JSONObject, JSONValue } from "../../Common/Types/JSON";

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: JSONObject;
  handler: (args: JSONObject) => Promise<JSONValue>;
}

export interface ModelInfo {
  name: string;
  description: string;
  endpoints: string[];
}

export default class DynamicMCPGenerator {
  private static openApiSpec: JSONObject = {};
  private static models: ModelInfo[] = [];

  public static async initialize(): Promise<void> {
    // Load OpenAPI spec
    await this.loadOpenApiSpec();
    
    // Extract model information from OpenAPI spec
    this.extractModelsFromOpenAPI();
  }

  private static async loadOpenApiSpec(): Promise<void> {
    try {
      const specPath = path.join(__dirname, "../../openapi.json");
      
      if (fs.existsSync(specPath)) {
        const specContent = fs.readFileSync(specPath, "utf8");
        this.openApiSpec = JSON.parse(specContent);
      }
    } catch (error) {
      console.warn("Could not load OpenAPI spec:", error);
    }
  }

  private static extractModelsFromOpenAPI(): void {
    const paths = this.openApiSpec["paths"] as JSONObject;
    if (!paths) return;

    const modelMap = new Map<string, ModelInfo>();

    // Extract models from API paths
    for (const [pathKey, pathValue] of Object.entries(paths)) {
      const pathStr = pathKey as string;
      const pathObj = pathValue as JSONObject;

      // Extract model name from path (e.g., "/monitor/get-list" -> "Monitor")
      const pathParts = pathStr.split("/").filter(Boolean);
      if (pathParts.length > 0 && pathParts[0]) {
        const modelName = this.capitalizeFirst(pathParts[0]);
        
        if (!modelMap.has(modelName)) {
          modelMap.set(modelName, {
            name: modelName,
            description: `Manage ${modelName} resources`,
            endpoints: [],
          });
        }

        const model = modelMap.get(modelName)!;
        model.endpoints.push(pathStr);

        // Extract description from operations
        const operations = ["get", "post", "put", "delete", "patch"];
        for (const operation of operations) {
          if (pathObj[operation]) {
            const opObj = pathObj[operation] as JSONObject;
            if (opObj["summary"] && !model.description.includes("Manage")) {
              model.description = opObj["summary"] as string;
            }
          }
        }
      }
    }

    this.models = Array.from(modelMap.values());
  }

  private static capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  public static generateToolsForModel(modelName: string): MCPTool[] {
    const model = this.models.find(m => m.name.toLowerCase() === modelName.toLowerCase());
    if (!model) {
      return [];
    }

    const tools: MCPTool[] = [];

    // Generate common CRUD operations
    const operations = [
      { suffix: "list", description: `List ${model.name} items`, operation: "list" },
      { suffix: "get", description: `Get a specific ${model.name} by ID`, operation: "get" },
      { suffix: "create", description: `Create a new ${model.name}`, operation: "create" },
      { suffix: "update", description: `Update an existing ${model.name}`, operation: "update" },
      { suffix: "delete", description: `Delete a ${model.name}`, operation: "delete" },
    ];

    for (const op of operations) {
      tools.push(this.generateTool(model, op.suffix, op.description, op.operation));
    }

    return tools;
  }

  private static generateTool(
    model: ModelInfo,
    _suffix: string,
    description: string,
    operation: string
  ): MCPTool {
    const toolName = `${operation}_${model.name.toLowerCase()}`;
    
    let inputSchema: JSONObject;

    switch (operation) {
      case "list":
        inputSchema = {
          type: "object",
          properties: {
            limit: {
              type: "integer",
              description: "Maximum number of items to return",
              minimum: 1,
              maximum: 100,
              default: 10,
            },
            skip: {
              type: "integer",
              description: "Number of items to skip",
              minimum: 0,
              default: 0,
            },
            query: {
              type: "object",
              description: "Filter criteria",
              properties: {},
            },
            select: {
              type: "object",
              description: "Fields to select",
              properties: {},
            },
            sort: {
              type: "object",
              description: "Sort criteria",
              properties: {},
            },
          },
        };
        break;

      case "get":
        inputSchema = {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: `The ID of the ${model.name} to retrieve`,
            },
            select: {
              type: "object",
              description: "Fields to select",
              properties: {},
            },
          },
          required: ["id"],
        };
        break;

      case "create":
        inputSchema = {
          type: "object",
          properties: {
            data: {
              type: "object",
              description: `The ${model.name} data to create`,
              properties: {},
            },
          },
          required: ["data"],
        };
        break;

      case "update":
        inputSchema = {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: `The ID of the ${model.name} to update`,
            },
            data: {
              type: "object",
              description: `The ${model.name} data to update`,
              properties: {},
            },
          },
          required: ["id", "data"],
        };
        break;

      case "delete":
        inputSchema = {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: `The ID of the ${model.name} to delete`,
            },
          },
          required: ["id"],
        };
        break;

      default:
        inputSchema = {
          type: "object",
          properties: {},
        };
    }

    return {
      name: toolName,
      description: `${description}. ${model.description}`,
      inputSchema,
      handler: async (args: JSONObject) => {
        try {
          // Here we would make the actual API call
          // For now, return a placeholder response
          return {
            model: model.name,
            operation,
            args,
            message: `${operation} operation for ${model.name} would be executed with the provided arguments`,
            endpoints: model.endpoints,
          };
        } catch (error) {
          return {
            error: `Failed to execute ${operation} on ${model.name}`,
            details: error instanceof Error ? error.message : String(error),
          };
        }
      },
    };
  }

  public static async generateAllTools(): Promise<MCPTool[]> {
    await this.initialize();
    
    const allTools: MCPTool[] = [];
    
    // Generate tools for each model
    for (const model of this.models) {
      const tools = this.generateToolsForModel(model.name);
      allTools.push(...tools);
    }

    return allTools;
  }

  public static getAvailableModels(): ModelInfo[] {
    return this.models;
  }

  public static getOpenApiEndpoints(): JSONObject {
    return this.openApiSpec["paths"] as JSONObject || {};
  }

  public static getModelSchema(modelName: string): JSONObject | null {
    const schemas = this.openApiSpec["components"] as JSONObject;
    if (!schemas || !schemas["schemas"]) return null;

    const schemaName = `${modelName}Schema`;
    const schemasObj = schemas["schemas"] as JSONObject;
    return schemasObj[schemaName] as JSONObject || null;
  }
}
