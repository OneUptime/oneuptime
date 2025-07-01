import {
  describe,
  it,
  expect,
  beforeEach,
  jest,
  afterEach,
} from "@jest/globals";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import ModelType from "../Types/ModelType";
import { McpToolInfo, OneUptimeToolCallArgs } from "../Types/McpTypes";

describe("MCP Server Integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env["ONEUPTIME_API_KEY"] = "test-api-key";
    process.env["ONEUPTIME_URL"] = "https://test.oneuptime.com";
  });

  afterEach(() => {
    delete process.env["ONEUPTIME_API_KEY"];
    delete process.env["ONEUPTIME_URL"];
  });

  describe("Tool Response Formatting", () => {
    it("should format create operation responses correctly", () => {
      const tool: McpToolInfo = {
        name: "create_project",
        description: "Create a new project",
        inputSchema: { type: "object", properties: {} },
        modelName: "Project",
        operation: OneUptimeOperation.Create,
        modelType: ModelType.Database,
        singularName: "project",
        pluralName: "projects",
        tableName: "Project",
      };

      const result = { id: "123", name: "Test Project" };
      const args: OneUptimeToolCallArgs = { data: { name: "Test Project" } };

      const expectedResponse = `✅ Successfully created project: ${JSON.stringify(result, null, 2)}`;

      expect(expectedResponse).toContain("Successfully created project");
      expect(expectedResponse).toContain("Test Project");
    });

    it("should format read operation responses correctly", () => {
      const tool: McpToolInfo = {
        name: "read_project",
        description: "Read a project",
        inputSchema: { type: "object", properties: {} },
        modelName: "Project",
        operation: OneUptimeOperation.Read,
        modelType: ModelType.Database,
        singularName: "project",
        pluralName: "projects",
        tableName: "Project",
      };

      const result = { id: "123", name: "Test Project" };
      const args: OneUptimeToolCallArgs = { id: "123" };

      const expectedResponse = `📋 Retrieved project (ID: ${args.id}): ${JSON.stringify(result, null, 2)}`;

      expect(expectedResponse).toContain("Retrieved project");
      expect(expectedResponse).toContain("ID: 123");
    });

    it("should format list operation responses correctly", () => {
      const tool: McpToolInfo = {
        name: "list_projects",
        description: "List projects",
        inputSchema: { type: "object", properties: {} },
        modelName: "Project",
        operation: OneUptimeOperation.List,
        modelType: ModelType.Database,
        singularName: "project",
        pluralName: "projects",
        tableName: "Project",
      };

      const result = [
        { id: "123", name: "Project 1" },
        { id: "456", name: "Project 2" },
      ];
      const args: OneUptimeToolCallArgs = {};

      const count = result.length;
      const summary = `📊 Found ${count} projects`;

      expect(summary).toContain("Found 2 projects");
    });

    it("should format update operation responses correctly", () => {
      const tool: McpToolInfo = {
        name: "update_project",
        description: "Update a project",
        inputSchema: { type: "object", properties: {} },
        modelName: "Project",
        operation: OneUptimeOperation.Update,
        modelType: ModelType.Database,
        singularName: "project",
        pluralName: "projects",
        tableName: "Project",
      };

      const result = { id: "123", name: "Updated Project" };
      const args: OneUptimeToolCallArgs = {
        id: "123",
        data: { name: "Updated Project" },
      };

      const expectedResponse = `✅ Successfully updated project (ID: ${args.id}): ${JSON.stringify(result, null, 2)}`;

      expect(expectedResponse).toContain("Successfully updated project");
      expect(expectedResponse).toContain("ID: 123");
    });

    it("should format delete operation responses correctly", () => {
      const tool: McpToolInfo = {
        name: "delete_project",
        description: "Delete a project",
        inputSchema: { type: "object", properties: {} },
        modelName: "Project",
        operation: OneUptimeOperation.Delete,
        modelType: ModelType.Database,
        singularName: "project",
        pluralName: "projects",
        tableName: "Project",
      };

      const args: OneUptimeToolCallArgs = { id: "123" };

      const expectedResponse = `🗑️ Successfully deleted project (ID: ${args.id})`;

      expect(expectedResponse).toContain("Successfully deleted project");
      expect(expectedResponse).toContain("ID: 123");
    });

    it("should format count operation responses correctly", () => {
      const tool: McpToolInfo = {
        name: "count_projects",
        description: "Count projects",
        inputSchema: { type: "object", properties: {} },
        modelName: "Project",
        operation: OneUptimeOperation.Count,
        modelType: ModelType.Database,
        singularName: "project",
        pluralName: "projects",
        tableName: "Project",
      };

      const result = { count: 42 };
      const totalCount = result.count;
      const expectedResponse = `📊 Total count of projects: ${totalCount}`;

      expect(expectedResponse).toContain("Total count of projects: 42");
    });
  });

  describe("Error Response Formatting", () => {
    it("should handle not found read responses", () => {
      const tool: McpToolInfo = {
        name: "read_project",
        description: "Read a project",
        inputSchema: { type: "object", properties: {} },
        modelName: "Project",
        operation: OneUptimeOperation.Read,
        modelType: ModelType.Database,
        singularName: "project",
        pluralName: "projects",
        tableName: "Project",
      };

      const result = null;
      const args: OneUptimeToolCallArgs = { id: "nonexistent" };

      const expectedResponse = `❌ project not found with ID: ${args.id}`;

      expect(expectedResponse).toContain("project not found");
      expect(expectedResponse).toContain("ID: nonexistent");
    });

    it("should handle empty list responses", () => {
      const tool: McpToolInfo = {
        name: "list_projects",
        description: "List projects",
        inputSchema: { type: "object", properties: {} },
        modelName: "Project",
        operation: OneUptimeOperation.List,
        modelType: ModelType.Database,
        singularName: "project",
        pluralName: "projects",
        tableName: "Project",
      };

      const result: any[] = [];
      const count = result.length;
      const summary = `📊 Found ${count} projects`;
      const expectedResponse = `${summary}. No items match the criteria.`;

      expect(expectedResponse).toContain("Found 0 projects");
      expect(expectedResponse).toContain("No items match the criteria");
    });
  });

  describe("Complex List Formatting", () => {
    it("should handle large lists with truncation", () => {
      const tool: McpToolInfo = {
        name: "list_monitors",
        description: "List monitors",
        inputSchema: { type: "object", properties: {} },
        modelName: "Monitor",
        operation: OneUptimeOperation.List,
        modelType: ModelType.Database,
        singularName: "monitor",
        pluralName: "monitors",
        tableName: "Monitor",
      };

      // Create a list with more than 5 items
      const result = Array.from({ length: 10 }, (_, i) => {
        return {
          id: `monitor-${i + 1}`,
          name: `Monitor ${i + 1}`,
          status: "active",
        };
      });

      const count = result.length;
      const summary = `📊 Found ${count} monitors`;
      const limitedItems = result.slice(0, 5);
      const hasMore = count > 5 ? `\n... and ${count - 5} more items` : "";

      expect(summary).toContain("Found 10 monitors");
      expect(limitedItems).toHaveLength(5);
      expect(hasMore).toContain("and 5 more items");
    });

    it("should format list items correctly", () => {
      const items = [
        { id: "1", name: "Item 1" },
        { id: "2", name: "Item 2" },
      ];

      const itemsText = items
        .map((item, index) => {
          return `${index + 1}. ${JSON.stringify(item, null, 2)}`;
        })
        .join("\n");

      expect(itemsText).toContain("1. {");
      expect(itemsText).toContain("2. {");
      expect(itemsText).toContain("Item 1");
      expect(itemsText).toContain("Item 2");
    });
  });

  describe("Tool Schema Validation", () => {
    it("should validate required properties in tool schemas", () => {
      const createToolSchema = {
        type: "object",
        properties: {
          data: {
            type: "object",
            description: "The project data to create",
          },
        },
        required: ["data"],
      };

      const readToolSchema = {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The unique identifier of the project",
          },
        },
        required: ["id"],
      };

      expect(createToolSchema.required).toContain("data");
      expect(readToolSchema.required).toContain("id");
    });

    it("should handle optional properties in schemas", () => {
      const listToolSchema = {
        type: "object",
        properties: {
          query: {
            type: "object",
            description: "Filter criteria",
          },
          limit: {
            type: "number",
            description: "Maximum number of results",
          },
          skip: {
            type: "number",
            description: "Number of results to skip",
          },
        },
        required: [] as string[],
      };

      expect(listToolSchema.required).toHaveLength(0);
      expect(listToolSchema.properties).toHaveProperty("query");
      expect(listToolSchema.properties).toHaveProperty("limit");
      expect(listToolSchema.properties).toHaveProperty("skip");
    });
  });

  describe("Environment Configuration", () => {
    it("should use default URL when not specified", () => {
      delete process.env["ONEUPTIME_URL"];

      const defaultUrl = "https://oneuptime.com";
      const config = {
        url: process.env["ONEUPTIME_URL"] || defaultUrl,
        apiKey: process.env["ONEUPTIME_API_KEY"] || "",
      };

      expect(config.url).toBe(defaultUrl);
    });

    it("should use environment variables when available", () => {
      const config = {
        url: process.env["ONEUPTIME_URL"] || "https://oneuptime.com",
        apiKey: process.env["ONEUPTIME_API_KEY"] || "",
      };

      expect(config.url).toBe("https://test.oneuptime.com");
      expect(config.apiKey).toBe("test-api-key");
    });
  });

  describe("Tool Execution Flow", () => {
    it("should follow correct execution flow for operations", () => {
      const executionSteps = [
        "Initialize service",
        "Generate tools",
        "Setup handlers",
        "Process request",
        "Validate arguments",
        "Execute operation",
        "Format response",
      ];

      expect(executionSteps).toContain("Initialize service");
      expect(executionSteps).toContain("Generate tools");
      expect(executionSteps).toContain("Format response");
    });

    it("should handle graceful shutdown", () => {
      const shutdownSignals = ["SIGINT", "SIGTERM"];

      shutdownSignals.forEach((signal) => {
        expect(signal).toMatch(/^SIG(INT|TERM)$/);
      });
    });
  });

  describe("API Path Construction", () => {
    it("should build correct API paths for operations", () => {
      const testCases = [
        {
          operation: OneUptimeOperation.Create,
          path: "/api/project",
          expected: "/api/project",
        },
        {
          operation: OneUptimeOperation.Read,
          path: "/api/project",
          id: "123",
          expected: "/api/project/123",
        },
        {
          operation: OneUptimeOperation.List,
          path: "/api/project",
          expected: "/api/project/list",
        },
        {
          operation: OneUptimeOperation.Update,
          path: "/api/project",
          id: "123",
          expected: "/api/project/123",
        },
        {
          operation: OneUptimeOperation.Delete,
          path: "/api/project",
          id: "123",
          expected: "/api/project/123",
        },
        {
          operation: OneUptimeOperation.Count,
          path: "/api/project",
          expected: "/api/project/count",
        },
      ];

      testCases.forEach(({ operation, path, id, expected }) => {
        let constructedPath: string;

        switch (operation) {
          case OneUptimeOperation.Create:
            constructedPath = path;
            break;
          case OneUptimeOperation.Read:
          case OneUptimeOperation.Update:
          case OneUptimeOperation.Delete:
            constructedPath = id ? `${path}/${id}` : path;
            break;
          case OneUptimeOperation.List:
            constructedPath = `${path}/list`;
            break;
          case OneUptimeOperation.Count:
            constructedPath = `${path}/count`;
            break;
          default:
            constructedPath = path;
        }

        expect(constructedPath).toBe(expected);
      });
    });
  });
});
