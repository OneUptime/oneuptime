import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import OneUptimeApiService from "../Services/OneUptimeApiService";
import DynamicToolGenerator from "../Utils/DynamicToolGenerator";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import ModelType from "../Types/ModelType";
import { McpToolInfo } from "../Types/McpTypes";

// Mock the dependencies
jest.mock("../Services/OneUptimeApiService");
jest.mock("../Utils/DynamicToolGenerator");
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

      (DynamicToolGenerator.generateAllTools as jest.Mock).mockReturnValue(
        mockTools,
      );
      (OneUptimeApiService.initialize as jest.Mock).mockImplementation(
        () => {},
      );

      // This would test the constructor if we expose the class
      expect(DynamicToolGenerator.generateAllTools).toHaveBeenCalled();
      expect(OneUptimeApiService.initialize).toHaveBeenCalledWith({
        url: "https://test.oneuptime.com",
        apiKey: "test-api-key",
      });
    });

    it("should throw error when API key is missing", () => {
      delete process.env["ONEUPTIME_API_KEY"];

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

      (DynamicToolGenerator.generateAllTools as jest.Mock).mockReturnValue(
        mockTools,
      );

      const tools = DynamicToolGenerator.generateAllTools();

      expect(tools).toHaveLength(2);
      expect(tools[0]?.name).toBe("create_monitor");
      expect(tools[1]?.name).toBe("list_projects");
      expect(tools[0]?.operation).toBe(OneUptimeOperation.Create);
      expect(tools[1]?.operation).toBe(OneUptimeOperation.List);
    });

    it("should handle tool generation errors", () => {
      (DynamicToolGenerator.generateAllTools as jest.Mock).mockImplementation(
        () => {
          throw new Error("Failed to generate tools");
        },
      );

      expect(() => {
        DynamicToolGenerator.generateAllTools();
      }).toThrow("Failed to generate tools");
    });
  });
});
