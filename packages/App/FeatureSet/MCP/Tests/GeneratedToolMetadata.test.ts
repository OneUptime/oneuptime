/**
 * Generated tool metadata tests.
 *
 * Verifies the tools/list metadata generated for real models:
 * - every tool carries a title and operation-appropriate annotations
 *   (readOnlyHint / destructiveHint / openWorldHint / idempotentHint): every
 *   write is destructive, and a write is open-world when what it changes is
 *   published - an incident's is, a label's is not - or when it points
 *   OneUptime at an address outside it, as making or changing a monitor does
 * - a resource with no field to change gets no update tool
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
import IncidentAlert from "Common/Models/DatabaseModels/IncidentAlert";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
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

    /*
     * An incident is shown on the status pages of what it affects and sent to
     * their subscribers, so each write to one reaches past the project.
     */
    it("marks the delete tool destructive, idempotent and open-world", () => {
      expect(findTool(tools, "delete_incident").annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
        idempotentHint: true,
      });
    });

    it("marks the create tool destructive, as creating an incident pages people, and open-world", () => {
      expect(findTool(tools, "create_incident").annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      });
    });

    it("marks the update tool destructive, as it overwrites, idempotent and open-world", () => {
      expect(findTool(tools, "update_incident").annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
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

    /*
     * As the API reads a sort (SortValidator) and the spec publishes it
     * (#8840): a direction, { direction, nulls }, or a relation's field.
     */
    it("takes any field in sort, with a direction, { direction, nulls }, or a related record's field", () => {
      const sort: JSONSchemaProperty | undefined = findTool(
        tools,
        "list_incidents",
      ).inputSchema.properties?.["sort"];

      expect(sort?.type).toBe("object");
      expect(sort?.properties).toBeUndefined();
      expect(sort?.description).toBe(
        'For example {"createdAt":"DESC"}, or a related record\'s field: {"<relation>":{"<field>":"ASC"}}.',
      );
      expect(sort?.additionalProperties).toEqual({
        anyOf: [
          { enum: ["ASC", "DESC"] },
          {
            type: "object",
            properties: {
              direction: { enum: ["ASC", "DESC"] },
              nulls: { enum: ["FIRST", "LAST"] },
            },
            additionalProperties: false,
          },
          {
            type: "object",
            additionalProperties: { enum: ["ASC", "DESC"] },
          },
        ],
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

  describe("database model tools whose writes stay in the project (Label)", () => {
    const tools: McpToolInfo[] = generateToolsForDatabaseModel(
      new Label(),
      Label,
    ).tools;

    it("marks the writes destructive and closed-world: a label is not published", () => {
      expect(findTool(tools, "create_label").annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      });

      for (const name of ["update_label", "delete_label"]) {
        expect(findTool(tools, name).annotations).toEqual({
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: false,
          idempotentHint: true,
        });
      }
    });
  });

  describe("database model tools for a resource that points OneUptime outside it (Monitor)", () => {
    const tools: McpToolInfo[] = generateToolsForDatabaseModel(
      new Monitor(),
      Monitor,
    ).tools;

    it("marks making and changing one open-world: a monitor checks the address it is given", () => {
      expect(findTool(tools, "create_monitor").annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      });
      expect(findTool(tools, "update_monitor").annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
        idempotentHint: true,
      });
    });

    it("leaves deleting one closed-world: that reaches nothing outside", () => {
      expect(findTool(tools, "delete_monitor").annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
        idempotentHint: true,
      });
    });
  });

  describe("database model tools for a resource with no field to change (Incident Alert)", () => {
    const tools: McpToolInfo[] = generateToolsForDatabaseModel(
      new IncidentAlert(),
      IncidentAlert,
    ).tools;

    it("generates every tool but update, which would take an id and change nothing", () => {
      expect(
        tools
          .map((tool: McpToolInfo) => {
            return tool.name;
          })
          .sort(),
      ).toEqual(
        [
          "count_incident_alerts",
          "create_incident_alert",
          "delete_incident_alert",
          "get_incident_alert",
          "list_incident_alerts",
        ].sort(),
      );
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
