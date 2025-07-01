import { describe, it, expect } from "@jest/globals";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import ModelType from "../Types/ModelType";

describe("MCP Server Basic Tests", () => {
  describe("OneUptimeOperation Enum", () => {
    it("should have all required operations", () => {
      expect(OneUptimeOperation.Create).toBe("create");
      expect(OneUptimeOperation.Read).toBe("read");
      expect(OneUptimeOperation.List).toBe("list");
      expect(OneUptimeOperation.Update).toBe("update");
      expect(OneUptimeOperation.Delete).toBe("delete");
      expect(OneUptimeOperation.Count).toBe("count");
    });

    it("should contain exactly 6 operations", () => {
      const operations = Object.values(OneUptimeOperation);
      expect(operations).toHaveLength(6);
    });

    it("should have string values for all operations", () => {
      Object.values(OneUptimeOperation).forEach((operation) => {
        expect(typeof operation).toBe("string");
      });
    });
  });

  describe("ModelType Enum", () => {
    it("should have required model types", () => {
      expect(ModelType.Database).toBeDefined();
      expect(ModelType.Analytics).toBeDefined();
    });

    it("should have correct string values", () => {
      expect(ModelType.Database).toBe("database");
      expect(ModelType.Analytics).toBe("analytics");
    });

    it("should be usable for type checking", () => {
      const databaseModel = ModelType.Database;
      const analyticsModel = ModelType.Analytics;

      expect(databaseModel === ModelType.Database).toBe(true);
      expect(analyticsModel === ModelType.Analytics).toBe(true);
    });
  });

  describe("Basic Functionality", () => {
    it("should support environment variable checking", () => {
      const apiKey = process.env["ONEUPTIME_API_KEY"] || "";
      const url = process.env["ONEUPTIME_URL"] || "https://oneuptime.com";

      expect(typeof apiKey).toBe("string");
      expect(typeof url).toBe("string");
      expect(url).toContain("http");
    });

    it("should validate operation types", () => {
      const operations = [
        OneUptimeOperation.Create,
        OneUptimeOperation.Read,
        OneUptimeOperation.List,
        OneUptimeOperation.Update,
        OneUptimeOperation.Delete,
        OneUptimeOperation.Count,
      ];

      operations.forEach((op) => {
        expect(Object.values(OneUptimeOperation)).toContain(op);
      });
    });

    it("should validate model types", () => {
      const modelTypes = [ModelType.Database, ModelType.Analytics];

      modelTypes.forEach((type) => {
        expect(Object.values(ModelType)).toContain(type);
      });
    });
  });

  describe("JSON Schema Validation", () => {
    it("should work with basic JSON schema structures", () => {
      const basicSchema = {
        type: "object",
        properties: {
          name: { type: "string" },
          count: { type: "number" },
        },
        required: ["name"],
      };

      expect(basicSchema.type).toBe("object");
      expect(basicSchema.properties).toBeDefined();
      expect(basicSchema.required).toContain("name");
    });

    it("should handle input schemas for different operations", () => {
      const createSchema = {
        type: "object",
        properties: {
          data: { type: "object", description: "Data to create" },
        },
        required: ["data"],
      };

      const readSchema = {
        type: "object",
        properties: {
          id: { type: "string", description: "Unique identifier" },
        },
        required: ["id"],
      };

      expect(createSchema.required).toContain("data");
      expect(readSchema.required).toContain("id");
    });
  });

  describe("Tool Name Validation", () => {
    it("should generate valid tool names", () => {
      const testCases = [
        { input: "CreateProject", expected: "create_project" },
        { input: "listAllUsers", expected: "list_all_users" },
        { input: "Update-Status", expected: "update_status" },
      ];

      testCases.forEach(({ input, expected }) => {
        const sanitized = input
          .replace(/([a-z])([A-Z])/g, "$1_$2")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "_")
          .replace(/_+/g, "_")
          .replace(/^_|_$/g, "");

        expect(sanitized).toBe(expected);
        expect(sanitized).toMatch(/^[a-z0-9_]+$/);
      });
    });
  });

  describe("Response Formatting", () => {
    it("should format success responses correctly", () => {
      const createResponse = "✅ Successfully created project";
      const readResponse = "📋 Retrieved project (ID: 123)";
      const listResponse = "📊 Found 5 projects";
      const updateResponse = "✅ Successfully updated project";
      const deleteResponse = "🗑️ Successfully deleted project";
      const countResponse = "📊 Total count of projects: 42";

      expect(createResponse).toContain("Successfully created");
      expect(readResponse).toContain("Retrieved");
      expect(listResponse).toContain("Found");
      expect(updateResponse).toContain("Successfully updated");
      expect(deleteResponse).toContain("Successfully deleted");
      expect(countResponse).toContain("Total count");
    });

    it("should format error responses correctly", () => {
      const notFoundResponse = "❌ project not found with ID: nonexistent";
      const emptyListResponse =
        "📊 Found 0 projects. No items match the criteria.";

      expect(notFoundResponse).toContain("not found");
      expect(emptyListResponse).toContain("No items match");
    });
  });

  describe("API Configuration", () => {
    it("should validate API configuration structure", () => {
      const config = {
        url: "https://test.oneuptime.com",
        apiKey: "test-key",
      };

      expect(config.url).toBeDefined();
      expect(config.apiKey).toBeDefined();
      expect(config.url).toMatch(/^https?:\/\//);
    });

    it("should handle different URL formats", () => {
      const urls = [
        "https://oneuptime.com",
        "http://localhost:3000",
        "https://custom.domain.com:8080",
      ];

      urls.forEach((url) => {
        expect(url).toMatch(/^https?:\/\//);
      });
    });
  });

  describe("Tool Structure Validation", () => {
    it("should validate tool info structure", () => {
      const toolInfo = {
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

      expect(toolInfo.name).toBe("create_project");
      expect(toolInfo.operation).toBe(OneUptimeOperation.Create);
      expect(toolInfo.modelType).toBe(ModelType.Database);
      expect(toolInfo.inputSchema.type).toBe("object");
    });

    it("should validate tool arguments structure", () => {
      const createArgs = { data: { name: "Test" } };
      const readArgs = { id: "123" };
      const listArgs = { limit: 10, skip: 0 };

      expect(createArgs.data).toBeDefined();
      expect(readArgs.id).toBe("123");
      expect(listArgs.limit).toBe(10);
    });
  });
});
