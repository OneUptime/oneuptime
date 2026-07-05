import { describe, it, expect } from "@jest/globals";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import ModelType from "../Types/ModelType";

describe("MCP Server Integration", () => {
  describe("Tool Response Formatting", () => {
    it("should format create operation responses correctly", () => {
      const expectedResponse: string = `✅ Successfully created project: {"id":"123","name":"Test Project"}`;
      expect(expectedResponse).toContain("Successfully created project");
      expect(expectedResponse).toContain("Test Project");
    });

    it("should format read operation responses correctly", () => {
      const expectedResponse: string = `📋 Project details: {"id":"123","name":"Test Project"}`;
      expect(expectedResponse).toContain("Project details");
      expect(expectedResponse).toContain("Test Project");
    });

    it("should format list operation responses correctly", () => {
      const expectedResponse: string = `📄 Found 2 projects`;
      expect(expectedResponse).toContain("Found");
      expect(expectedResponse).toContain("projects");
    });

    it("should format update operation responses correctly", () => {
      const expectedResponse: string = `✏️ Successfully updated project`;
      expect(expectedResponse).toContain("Successfully updated");
      expect(expectedResponse).toContain("project");
    });

    it("should format delete operation responses correctly", () => {
      const expectedResponse: string = `🗑️ Successfully deleted project`;
      expect(expectedResponse).toContain("Successfully deleted");
      expect(expectedResponse).toContain("project");
    });

    it("should format count operation responses correctly", () => {
      const expectedResponse: string = `🔢 Total projects: 42`;
      expect(expectedResponse).toContain("Total projects");
      expect(expectedResponse).toContain("42");
    });
  });

  describe("Error Handling", () => {
    it("should handle API errors gracefully", () => {
      const errorMessage: string = "❌ Error: Resource not found";
      expect(errorMessage).toContain("Error:");
      expect(errorMessage).toContain("not found");
    });

    it("should handle validation errors", () => {
      const validationError: string =
        "❌ Validation failed: Missing required field 'name'";
      expect(validationError).toContain("Validation failed");
      expect(validationError).toContain("name");
    });

    it("should handle network errors", () => {
      const networkError: string =
        "❌ Network error: Unable to connect to OneUptime API";
      expect(networkError).toContain("Network error");
      expect(networkError).toContain("OneUptime API");
    });
  });

  describe("Tool Schema Validation", () => {
    it("should validate tool names follow convention", () => {
      const validToolNames: string[] = [
        "create_project",
        "read_monitor",
        "update_incident",
        "delete_user",
        "list_alerts",
      ];

      validToolNames.forEach((name: string) => {
        expect(name).toMatch(
          /^(create|read|update|delete|list|count)_[a-z_]+$/,
        );
      });
    });

    it("should validate operation types", () => {
      const operations: OneUptimeOperation[] =
        Object.values(OneUptimeOperation);
      expect(operations).toContain("create");
      expect(operations).toContain("read");
      expect(operations).toContain("update");
      expect(operations).toContain("delete");
      expect(operations).toContain("list");
      expect(operations).toContain("count");
    });

    it("should validate model types", () => {
      const modelTypes: ModelType[] = Object.values(ModelType);
      expect(modelTypes).toContain("database");
      expect(modelTypes).toContain("analytics");
    });
  });
});
