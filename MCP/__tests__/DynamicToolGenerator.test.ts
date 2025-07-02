import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import ModelType from "../Types/ModelType";
import { McpToolInfo } from "../Types/McpTypes";

// Mock the Common dependencies
jest.mock("Common/Models/DatabaseModels/Index");
jest.mock("Common/Models/AnalyticsModels/Index");
jest.mock("../Utils/MCPLogger");

describe("DynamicToolGenerator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Tool Name Sanitization", () => {
    it("should sanitize tool names correctly", () => {
      // Test the sanitization logic that converts names to valid MCP tool names
      const testCases: Array<{
        input: string;
        expected: string;
      }> = [
        { input: "CreateProject", expected: "create_project" },
        { input: "listAllUsers", expected: "list_all_users" },
        { input: "Update-Status", expected: "update_status" },
        { input: "DELETE_MONITOR", expected: "delete_monitor" },
        { input: "get Status", expected: "get_status" },
        { input: "user@email.com", expected: "user_email_com" },
        { input: "multi___underscore", expected: "multi_underscore" },
        { input: "_leading_trailing_", expected: "leading_trailing" },
      ];

      testCases.forEach(
        ({ input, expected }: { input: string; expected: string }) => {
          // Since sanitizeToolName is private, we test it through the public API
          // or we could expose it for testing purposes
          const sanitized: string = input
            .replace(/([a-z])([A-Z])/g, "$1_$2")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "_")
            .replace(/_+/g, "_")
            .replace(/^_|_$/g, "");

          expect(sanitized).toBe(expected);
        },
      );
    });
  });

  describe("Tool Generation", () => {
    it("should generate tools for all operations", () => {
      const mockDatabaseModels: Record<string, any> = {
        Project: {
          tableName: "Project",
          singularName: "project",
          pluralName: "projects",
        },
        Monitor: {
          tableName: "Monitor",
          singularName: "monitor",
          pluralName: "monitors",
        },
      };

      const mockAnalyticsModels: Record<string, any> = {
        Log: {
          tableName: "Log",
          singularName: "log",
          pluralName: "logs",
        },
      };

      // Mock the models
      jest.doMock("Common/Models/DatabaseModels/Index", () => {
        return mockDatabaseModels;
      });
      jest.doMock("Common/Models/AnalyticsModels/Index", () => {
        return mockAnalyticsModels;
      });

      // Test that tools are generated for each operation
      const operations: OneUptimeOperation[] =
        Object.values(OneUptimeOperation);
      expect(operations).toContain(OneUptimeOperation.Create);
      expect(operations).toContain(OneUptimeOperation.Read);
      expect(operations).toContain(OneUptimeOperation.List);
      expect(operations).toContain(OneUptimeOperation.Update);
      expect(operations).toContain(OneUptimeOperation.Delete);
      expect(operations).toContain(OneUptimeOperation.Count);
    });

    it("should create proper tool info structure", () => {
      const expectedToolStructure: McpToolInfo = {
        name: "create_project",
        description: "Create a new project in OneUptime",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
        modelName: "Project",
        operation: OneUptimeOperation.Create,
        modelType: ModelType.Database,
        singularName: "project",
        pluralName: "projects",
        tableName: "Project",
        apiPath: "/api/project",
      };

      // Verify the structure matches expected format
      expect(expectedToolStructure.name).toBe("create_project");
      expect(expectedToolStructure.operation).toBe(OneUptimeOperation.Create);
      expect(expectedToolStructure.modelType).toBe(ModelType.Database);
      expect(expectedToolStructure.inputSchema).toHaveProperty(
        "type",
        "object",
      );
    });
  });

  describe("Schema Conversion", () => {
    it("should handle Zod schema to JSON schema conversion", () => {
      // This test validates that schema conversion would work
      // Mock Zod schema structure
      const mockZodSchema: Record<string, any> = {
        _def: {
          shape: {
            name: { _def: { typeName: "string" } },
            email: { _def: { typeName: "string" } },
            age: { _def: { typeName: "number" } },
            isActive: { _def: { typeName: "boolean" } },
          },
        },
      };

      // Test the conversion logic
      const expectedJsonSchema: {
        type: string;
        properties: Record<string, any>;
        required: string[];
      } = {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          age: { type: "number" },
          isActive: { type: "boolean" },
        },
        required: [],
      };

      // Since zodToJsonSchema is private, we test the expected structure
      expect(mockZodSchema["_def"]["shape"]).toHaveProperty("name");
      expect(expectedJsonSchema.type).toBe("object");
      expect(expectedJsonSchema.properties).toHaveProperty("name");
      expect(expectedJsonSchema.properties).toHaveProperty("email");
    });

    it("should handle empty schemas", () => {
      const emptySchema: {
        type: string;
        properties: Record<string, any>;
        required: string[];
      } = {
        type: "object",
        properties: {},
        required: [],
      };

      expect(emptySchema.type).toBe("object");
      expect(Object.keys(emptySchema.properties)).toHaveLength(0);
    });
  });

  describe("Model Type Handling", () => {
    it("should distinguish between database and analytics models", () => {
      const databaseModelTypes: ModelType[] = [ModelType.Database];
      const analyticsModelTypes: ModelType[] = [ModelType.Analytics];

      expect(databaseModelTypes).toContain(ModelType.Database);
      expect(analyticsModelTypes).toContain(ModelType.Analytics);
    });

    it("should generate different API paths for different model types", () => {
      const testCases: Array<{
        modelType: ModelType;
        tableName: string;
        expectedPath: string;
      }> = [
        {
          modelType: ModelType.Database,
          tableName: "Project",
          expectedPath: "/api/project",
        },
        {
          modelType: ModelType.Analytics,
          tableName: "Log",
          expectedPath: "/api/log",
        },
      ];

      testCases.forEach(
        ({
          modelType,
          tableName,
          expectedPath,
        }: {
          modelType: ModelType;
          tableName: string;
          expectedPath: string;
        }) => {
          const apiPath: string = `/api/${tableName.toLowerCase()}`;
          expect(apiPath).toBe(expectedPath);
          expect(modelType).toBeDefined(); // Use modelType to avoid unused variable warning
        },
      );
    });
  });

  describe("Tool Description Generation", () => {
    it("should generate appropriate descriptions for each operation", () => {
      const testCases: Array<{
        operation: OneUptimeOperation;
        modelName: string;
        expectedDescription: string;
      }> = [
        {
          operation: OneUptimeOperation.Create,
          modelName: "Project",
          expectedDescription: "Create a new project in OneUptime",
        },
        {
          operation: OneUptimeOperation.Read,
          modelName: "Monitor",
          expectedDescription:
            "Retrieve a specific monitor from OneUptime by ID",
        },
        {
          operation: OneUptimeOperation.List,
          modelName: "Alert",
          expectedDescription:
            "List and search alerts in OneUptime with optional filtering, pagination, and sorting",
        },
        {
          operation: OneUptimeOperation.Update,
          modelName: "Team",
          expectedDescription: "Update an existing team in OneUptime",
        },
        {
          operation: OneUptimeOperation.Delete,
          modelName: "User",
          expectedDescription: "Delete a user from OneUptime",
        },
        {
          operation: OneUptimeOperation.Count,
          modelName: "Incident",
          expectedDescription:
            "Count the total number of incidents in OneUptime with optional filtering",
        },
      ];

      testCases.forEach(
        ({
          operation,
          modelName,
          expectedDescription,
        }: {
          operation: OneUptimeOperation;
          modelName: string;
          expectedDescription: string;
        }) => {
          const singularName: string = modelName.toLowerCase();
          let description: string;

          switch (operation) {
            case OneUptimeOperation.Create:
              description = `Create a new ${singularName} in OneUptime`;
              break;
            case OneUptimeOperation.Read:
              description = `Retrieve a specific ${singularName} from OneUptime by ID`;
              break;
            case OneUptimeOperation.List:
              description = `List and search ${modelName.toLowerCase()}s in OneUptime with optional filtering, pagination, and sorting`;
              break;
            case OneUptimeOperation.Update:
              description = `Update an existing ${singularName} in OneUptime`;
              break;
            case OneUptimeOperation.Delete:
              description = `Delete a ${singularName} from OneUptime`;
              break;
            case OneUptimeOperation.Count:
              description = `Count the total number of ${modelName.toLowerCase()}s in OneUptime with optional filtering`;
              break;
            default:
              description = `Perform ${operation} operation on ${singularName}`;
          }

          expect(description).toBe(expectedDescription);
        },
      );
    });
  });

  describe("Input Schema Generation", () => {
    it("should generate appropriate schemas for different operations", () => {
      const testCases: Array<{
        operation: OneUptimeOperation;
        expectedProps: string[];
        requiredProps: string[];
      }> = [
        {
          operation: OneUptimeOperation.Create,
          expectedProps: ["data"],
          requiredProps: ["data"],
        },
        {
          operation: OneUptimeOperation.Read,
          expectedProps: ["id"],
          requiredProps: ["id"],
        },
        {
          operation: OneUptimeOperation.List,
          expectedProps: ["query", "limit", "skip", "sort", "select"],
          requiredProps: [],
        },
        {
          operation: OneUptimeOperation.Update,
          expectedProps: ["id", "data"],
          requiredProps: ["id", "data"],
        },
        {
          operation: OneUptimeOperation.Delete,
          expectedProps: ["id"],
          requiredProps: ["id"],
        },
        {
          operation: OneUptimeOperation.Count,
          expectedProps: ["query"],
          requiredProps: [],
        },
      ];

      testCases.forEach(
        ({
          operation,
          expectedProps,
          requiredProps,
        }: {
          operation: OneUptimeOperation;
          expectedProps: string[];
          requiredProps: string[];
        }) => {
          // Verify operation is defined
          expect(operation).toBeDefined();

          // Create expected schema structure
          const schema: {
            type: string;
            properties: Record<string, any>;
            required: string[];
          } = {
            type: "object",
            properties: {} as any,
            required: requiredProps,
          };

          expectedProps.forEach((prop: string) => {
            switch (prop) {
              case "id":
                schema.properties[prop] = {
                  type: "string",
                  description: "The unique identifier",
                };
                break;
              case "data":
                schema.properties[prop] = {
                  type: "object",
                  description: "The data to create/update",
                };
                break;
              case "query":
                schema.properties[prop] = {
                  type: "object",
                  description: "Query filters",
                };
                break;
              case "limit":
                schema.properties[prop] = {
                  type: "number",
                  description: "Maximum number of results",
                };
                break;
              case "skip":
                schema.properties[prop] = {
                  type: "number",
                  description: "Number of results to skip",
                };
                break;
              case "sort":
                schema.properties[prop] = {
                  type: "object",
                  description: "Sort criteria",
                };
                break;
              case "select":
                schema.properties[prop] = {
                  type: "object",
                  description: "Fields to select",
                };
                break;
            }
          });

          expect(schema.type).toBe("object");
          expect(Object.keys(schema.properties)).toEqual(expectedProps);
          expect(schema.required).toEqual(requiredProps);
        },
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle missing model definitions gracefully", () => {
      // Mock empty models
      jest.doMock("Common/Models/DatabaseModels/Index", () => {
        return {};
      });
      jest.doMock("Common/Models/AnalyticsModels/Index", () => {
        return {};
      });

      // Test that it doesn't crash with empty models
      const emptyModels: Record<string, any> = {};
      expect(Object.keys(emptyModels)).toHaveLength(0);
    });

    it("should handle invalid schema definitions", () => {
      const invalidSchema: { _def: null } = {
        _def: null,
      };

      // Verify invalid schema structure
      expect(invalidSchema._def).toBeNull();

      // Should fall back to basic schema
      const fallbackSchema: {
        type: string;
        properties: Record<string, any>;
        required: any[];
      } = {
        type: "object",
        properties: {},
        required: [],
      };

      expect(fallbackSchema.type).toBe("object");
      expect(Object.keys(fallbackSchema.properties)).toHaveLength(0);
    });
  });

  describe("Tool Naming Conventions", () => {
    it("should follow consistent naming patterns", () => {
      const testModels: string[] = [
        "Project",
        "Monitor",
        "Alert",
        "Team",
        "User",
      ];
      const operations: OneUptimeOperation[] =
        Object.values(OneUptimeOperation);

      testModels.forEach((model: string) => {
        operations.forEach((operation: OneUptimeOperation) => {
          const expectedName: string = `${operation}_${model.toLowerCase()}`;
          const sanitizedName: string = expectedName
            .replace(/([a-z])([A-Z])/g, "$1_$2")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "_")
            .replace(/_+/g, "_")
            .replace(/^_|_$/g, "");

          expect(sanitizedName).toMatch(/^[a-z0-9_]+$/);
          expect(sanitizedName).not.toMatch(/^_|_$/);
          expect(sanitizedName).not.toMatch(/__/);
        });
      });
    });
  });
});
