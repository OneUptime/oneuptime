/**
 * Generated tool metadata tests.
 *
 * Verifies the tools/list metadata generated for real models:
 * - every tool carries a title and operation-appropriate annotations
 *   (readOnlyHint / destructiveHint / openWorldHint / idempotentHint): every
 *   write is destructive, and no tool reaches past the caller's project
 * - database list/get tools expose a `select` array parameter
 * - the list tool's sort schema takes any field, ASC or DESC
 * - analytics (telemetry) models generate ONLY list and count tools, and they
 *   take `select` as the database tools do
 */

import { describe, it, expect, jest } from "@jest/globals";

jest.mock("../Utils/MCPLogger");

import {
  generateToolsForDatabaseModel,
  generateToolsForAnalyticsModel,
} from "../Tools/ToolGenerator";
import Incident from "Common/Models/DatabaseModels/Incident";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
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
            destructiveHint: false,
            openWorldHint: false,
          });
        },
      );
    });

    it("marks the delete tool destructive and idempotent", () => {
      expect(findTool(tools, "delete_incident").annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
        idempotentHint: true,
      });
    });

    it("marks the create tool destructive: creating an incident pages people", () => {
      expect(findTool(tools, "create_incident").annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      });
    });

    it("marks the update tool destructive, as it overwrites, and idempotent", () => {
      expect(findTool(tools, "update_incident").annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
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

    it("takes any field in sort, and only ASC or DESC for it", () => {
      const sort: JSONSchemaProperty | undefined = findTool(
        tools,
        "list_incidents",
      ).inputSchema.properties?.["sort"];

      expect(sort?.type).toBe("object");
      expect(sort?.properties).toBeUndefined();
      expect(sort?.additionalProperties).toEqual({
        type: "string",
        enum: ["ASC", "DESC"],
      });
    });

    it("names the helper on the tools that leave a resource's fields to it", () => {
      for (const name of ["create_incident", "update_incident"]) {
        expect(findTool(tools, name).description).toContain(
          "oneuptime_describe_resource",
        );
      }

      for (const name of ["list_incidents", "count_incidents"]) {
        expect(
          findTool(tools, name).inputSchema.properties?.["query"]?.description,
        ).toContain("oneuptime_describe_resource");
      }
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
        expect(tool.annotations).toEqual({
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        });
        expect(typeof tool.title).toBe("string");
      });
    });

    it("takes select as an array of field names, as the database tools do", () => {
      const select: JSONSchemaProperty | undefined = findTool(
        tools,
        "list_logs",
      ).inputSchema.properties?.["select"];

      expect(select?.type).toBe("array");
      expect(select?.items?.type).toBe("string");
    });

    it("names the time column to filter and sort on, and the column is the table's own", () => {
      const list: McpToolInfo = findTool(tools, "list_logs");

      expect(list.description).toContain("always filter on time");
      expect(list.inputSchema.properties?.["sort"]?.description).toContain(
        '{"time":"DESC"}',
      );

      const spanList: McpToolInfo = findTool(
        generateToolsForAnalyticsModel(new Span(), Span).tools,
        "list_spans",
      );

      expect(spanList.description).toContain("always filter on startTime");
      expect(spanList.inputSchema.properties?.["sort"]?.description).toContain(
        '{"startTime":"DESC"}',
      );
    });
  });
});
