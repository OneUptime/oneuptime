/**
 * Generated tool metadata tests.
 *
 * Verifies the tools/list metadata generated for real models:
 * - every tool carries a title and operation-appropriate annotations
 *   (readOnlyHint / destructiveHint / idempotentHint)
 * - database list/get tools expose a `select` array parameter
 * - the list tool's sort schema carries the ASC/DESC enum
 * - analytics (telemetry) models generate ONLY list and count tools
 */

import { describe, it, expect, jest } from "@jest/globals";

jest.mock("../Utils/MCPLogger");

import {
  generateToolsForDatabaseModel,
  generateToolsForAnalyticsModel,
} from "../Tools/ToolGenerator";
import Incident from "Common/Models/DatabaseModels/Incident";
import Log from "Common/Models/AnalyticsModels/Log";
import {
  McpToolInfo,
  ModelToolsResult,
  JSONSchemaProperty,
} from "../Types/McpTypes";

function findTool(tools: McpToolInfo[], name: string): McpToolInfo {
  const tool: McpToolInfo | undefined = tools.find((t: McpToolInfo) => {
    return t.name === name;
  });
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }
  return tool;
}

describe("Generated tool metadata", () => {
  describe("database model tools (Incident)", () => {
    const result: ModelToolsResult = generateToolsForDatabaseModel(
      new Incident(),
      Incident,
    );
    const tools: McpToolInfo[] = result.tools;

    it("generates all six CRUD tools", () => {
      expect(
        tools
          .map((tool: McpToolInfo) => {
            return tool.name;
          })
          .sort(),
      ).toEqual(
        [
          "count_incidents",
          "create_incident",
          "delete_incident",
          "get_incident",
          "list_incidents",
          "update_incident",
        ].sort(),
      );
    });

    it("gives every tool a title and annotations", () => {
      tools.forEach((tool: McpToolInfo) => {
        expect(typeof tool.title).toBe("string");
        expect((tool.title as string).length).toBeGreaterThan(0);
        expect(tool.annotations).toBeDefined();
      });

      expect(findTool(tools, "list_incidents").title).toBe("List Incidents");
      expect(findTool(tools, "delete_incident").title).toBe("Delete Incident");
    });

    it("marks get/list/count tools read-only", () => {
      ["get_incident", "list_incidents", "count_incidents"].forEach(
        (name: string) => {
          expect(findTool(tools, name).annotations).toEqual({
            readOnlyHint: true,
          });
        },
      );
    });

    it("marks the delete tool destructive and idempotent", () => {
      expect(findTool(tools, "delete_incident").annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      });
    });

    it("marks the create tool non-destructive and not read-only", () => {
      expect(findTool(tools, "create_incident").annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
      });
    });

    it("marks the update tool idempotent", () => {
      expect(findTool(tools, "update_incident").annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      });
    });

    it("exposes a select array parameter on the list tool", () => {
      const select: JSONSchemaProperty | undefined = findTool(
        tools,
        "list_incidents",
      ).inputSchema.properties?.["select"];

      expect(select?.type).toBe("array");
      expect(select?.items?.type).toBe("string");
    });

    it("exposes a select array parameter on the get tool", () => {
      const select: JSONSchemaProperty | undefined = findTool(
        tools,
        "get_incident",
      ).inputSchema.properties?.["select"];

      expect(select?.type).toBe("array");
    });

    it("carries the ASC/DESC enum on sortable fields like createdAt", () => {
      const sort: JSONSchemaProperty | undefined = findTool(
        tools,
        "list_incidents",
      ).inputSchema.properties?.["sort"];
      const createdAt: JSONSchemaProperty | undefined =
        sort?.properties?.["createdAt"];

      expect(createdAt).toBeDefined();
      expect(createdAt?.enum).toEqual(["ASC", "DESC"]);
    });
  });

  describe("analytics model tools (Log)", () => {
    const result: ModelToolsResult = generateToolsForAnalyticsModel(
      new Log(),
      Log,
    );
    const tools: McpToolInfo[] = result.tools;

    it("generates ONLY list and count tools (telemetry is read-only)", () => {
      expect(
        tools
          .map((tool: McpToolInfo) => {
            return tool.name;
          })
          .sort(),
      ).toEqual(["count_logs", "list_logs"]);
    });

    it("marks both tools read-only", () => {
      tools.forEach((tool: McpToolInfo) => {
        expect(tool.annotations).toEqual({ readOnlyHint: true });
        expect(typeof tool.title).toBe("string");
      });
    });
  });
});
