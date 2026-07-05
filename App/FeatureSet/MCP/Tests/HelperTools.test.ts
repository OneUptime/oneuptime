/**
 * Helper tool tests.
 *
 * Verifies that oneuptime_list_resources derives tool names via
 * sanitizeToolName (matching ToolGenerator exactly) and only lists the
 * operations a resource actually has.
 */

import { describe, it, expect } from "@jest/globals";
import { handleHelperTool, isHelperTool } from "../Tools/HelperTools";
import { McpToolInfo } from "../Types/McpTypes";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import ModelType from "../Types/ModelType";

function makeTool(
  operation: OneUptimeOperation,
  tableName: string,
  singularName: string,
  pluralName: string,
): McpToolInfo {
  return {
    name: `${operation}_${tableName.toLowerCase()}`,
    description: `${operation} ${singularName}`,
    inputSchema: { type: "object", properties: {} },
    modelName: tableName,
    operation,
    modelType: ModelType.Database,
    singularName,
    pluralName,
    tableName,
    apiPath: `/${tableName.toLowerCase()}`,
  };
}

interface ResourceEntry {
  name: string;
  operations: string[];
  tools: Record<string, string>;
}

describe("HelperTools", () => {
  describe("isHelperTool", () => {
    it("recognizes helper tools and rejects others", () => {
      expect(isHelperTool("oneuptime_help")).toBe(true);
      expect(isHelperTool("oneuptime_list_resources")).toBe(true);
      expect(isHelperTool("list_incidents")).toBe(false);
      expect(isHelperTool("oneuptime_whoami")).toBe(false);
    });
  });

  describe("oneuptime_list_resources", () => {
    // Monitor Log has list+count only; Incident has full CRUD.
    const resourceTools: McpToolInfo[] = [
      makeTool(
        OneUptimeOperation.List,
        "MonitorLog",
        "Monitor Log",
        "Monitor Logs",
      ),
      makeTool(
        OneUptimeOperation.Count,
        "MonitorLog",
        "Monitor Log",
        "Monitor Logs",
      ),
      makeTool(OneUptimeOperation.Create, "Incident", "Incident", "Incidents"),
      makeTool(OneUptimeOperation.Read, "Incident", "Incident", "Incidents"),
      makeTool(OneUptimeOperation.List, "Incident", "Incident", "Incidents"),
      makeTool(OneUptimeOperation.Update, "Incident", "Incident", "Incidents"),
      makeTool(OneUptimeOperation.Delete, "Incident", "Incident", "Incidents"),
      makeTool(OneUptimeOperation.Count, "Incident", "Incident", "Incidents"),
    ];

    const response: { resources: ResourceEntry[] } = JSON.parse(
      handleHelperTool("oneuptime_list_resources", {}, resourceTools),
    ) as { resources: ResourceEntry[] };

    function findResource(name: string): ResourceEntry {
      const resource: ResourceEntry | undefined = response.resources.find(
        (r: ResourceEntry) => {
          return r.name === name;
        },
      );
      if (!resource) {
        throw new Error(`Resource not found: ${name}`);
      }
      return resource;
    }

    it("only lists operations the resource actually has", () => {
      const monitorLog: ResourceEntry = findResource("MonitorLog");

      expect(Object.keys(monitorLog.tools).sort()).toEqual(["count", "list"]);
      expect(monitorLog.tools["list"]).toBe("list_monitor_logs");
      expect(monitorLog.tools["count"]).toBe("count_monitor_logs");
    });

    it("derives sanitized tool names for full-CRUD resources", () => {
      const incident: ResourceEntry = findResource("Incident");

      expect(incident.tools).toEqual({
        create: "create_incident",
        get: "get_incident",
        list: "list_incidents",
        update: "update_incident",
        delete: "delete_incident",
        count: "count_incidents",
      });
    });
  });
});
