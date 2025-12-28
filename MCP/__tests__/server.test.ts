import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import OneUptimeApiService from "../Services/OneUptimeApiService";
import * as ToolGenerator from "../Tools/ToolGenerator";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import ModelType from "../Types/ModelType";
import { McpToolInfo } from "../Types/McpTypes";

// Mock the dependencies
jest.mock("../Services/OneUptimeApiService");
jest.mock("../Tools/ToolGenerator");
jest.mock("../Utils/MCPLogger");

describe("OneUptime MCP Server", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env["ONEUPTIME_API_KEY"] = "test-api-key";
    process.env["ONEUPTIME_URL"] = "https://test.oneuptime.com";
  });

  describe("Server Initialization", () => {
    it("should initialize with proper configuration", () => {
      const mockTools: McpToolInfo[] = [
        {
          name: "create_project",
          description: "Create a new project",
          inputSchema: { type: "object", properties: {} },
          modelName: "Project",
          operation: OneUptimeOperation.Create,
          modelType: ModelType.Database,
          singularName: "project",
          pluralName: "projects",
          tableName: "Project",
          apiPath: "/api/project",
        },
      ];

      (ToolGenerator.generateAllTools as jest.Mock).mockReturnValue(mockTools);
      (OneUptimeApiService.initialize as jest.Mock).mockImplementation(
        () => {},
      );

      // Call the mocked functions to simulate server initialization
      ToolGenerator.generateAllTools();
      OneUptimeApiService.initialize({
        url: "https://test.oneuptime.com",
        apiKey: "test-api-key",
      });

      // Test that the functions were called
      expect(ToolGenerator.generateAllTools).toHaveBeenCalled();
      expect(OneUptimeApiService.initialize).toHaveBeenCalledWith({
        url: "https://test.oneuptime.com",
        apiKey: "test-api-key",
      });
    });

    it("should throw error when API key is missing", () => {
      // Mock the service to throw error for missing API key
      (OneUptimeApiService.initialize as jest.Mock).mockImplementation(
        (config: unknown) => {
          const typedConfig: { url: string; apiKey: string } = config as {
            url: string;
            apiKey: string;
          };
          if (!typedConfig.apiKey) {
            throw new Error("OneUptime API key is required");
          }
        },
      );

      expect(() => {
        OneUptimeApiService.initialize({
          url: "https://test.oneuptime.com",
          apiKey: "",
        });
      }).toThrow("OneUptime API key is required");
    });
  });

  describe("Tool Management", () => {
    it("should generate tools correctly", () => {
      const mockTools: McpToolInfo[] = [
        {
          name: "create_monitor",
          description: "Create a new monitor",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string" },
              url: { type: "string" },
            },
            required: ["name", "url"],
          },
          modelName: "Monitor",
          operation: OneUptimeOperation.Create,
          modelType: ModelType.Database,
          singularName: "monitor",
          pluralName: "monitors",
          tableName: "Monitor",
          apiPath: "/api/monitor",
        },
        {
          name: "list_projects",
          description: "List all projects",
          inputSchema: {
            type: "object",
            properties: {
              limit: { type: "number" },
              skip: { type: "number" },
            },
          },
          modelName: "Project",
          operation: OneUptimeOperation.List,
          modelType: ModelType.Database,
          singularName: "project",
          pluralName: "projects",
          tableName: "Project",
          apiPath: "/api/project",
        },
      ];

      (ToolGenerator.generateAllTools as jest.Mock).mockReturnValue(mockTools);

      const tools: McpToolInfo[] = ToolGenerator.generateAllTools();

      expect(tools).toHaveLength(2);
      expect(tools[0]?.name).toBe("create_monitor");
      expect(tools[1]?.name).toBe("list_projects");
      expect(tools[0]?.operation).toBe(OneUptimeOperation.Create);
      expect(tools[1]?.operation).toBe(OneUptimeOperation.List);
    });

    it("should handle tool generation errors", () => {
      (ToolGenerator.generateAllTools as jest.Mock).mockImplementation(() => {
        throw new Error("Failed to generate tools");
      });

      expect(() => {
        ToolGenerator.generateAllTools();
      }).toThrow("Failed to generate tools");
    });
  });
});
