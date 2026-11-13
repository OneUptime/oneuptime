/**
 * Helper tool tests.
 *
 * Verifies that oneuptime_list_resources derives tool names via
 * sanitizeToolName (matching ToolGenerator exactly) and only lists the
 * operations a resource actually has. Tests/DescribeResource covers
 * oneuptime_describe_resource.
 */

import { describe, it, expect } from "@jest/globals";
import {
  generateHelperTools,
  handleHelperTool,
  isHelperTool,
  RESOURCE_DESCRIPTIONS,
} from "../Tools/HelperTools";
import { McpToolInfo } from "../Types/McpTypes";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import ModelType from "../Types/ModelType";
import AnalyticsModels from "Common/Models/AnalyticsModels/Index";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import DatabaseModels from "Common/Models/DatabaseModels/Index";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

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
      expect(isHelperTool("oneuptime_describe_resource")).toBe(true);
      expect(isHelperTool("list_incidents")).toBe(false);
      expect(isHelperTool("oneuptime_whoami")).toBe(false);
    });
  });

  describe("generateHelperTools", () => {
    it("makes every helper tool, and isHelperTool knows each one", () => {
      const names: Array<string> = generateHelperTools().map(
        (tool: McpToolInfo): string => {
          return tool.name;
        },
      );

      expect(names).toEqual([
        "oneuptime_help",
        "oneuptime_list_resources",
        "oneuptime_describe_resource",
      ]);
      expect(names.every(isHelperTool)).toBe(true);
    });

    it("sends an agent to the resources rather than list them all in the help tool's description", () => {
      const help: McpToolInfo = generateHelperTools()[0] as McpToolInfo;

      expect(help.description).toContain("oneuptime_list_resources");
      expect(help.description).toContain("oneuptime_describe_resource");
      expect(help.description).not.toContain("AVAILABLE RESOURCES");
    });
  });

  describe("oneuptime_help", () => {
    it("tells an agent to read a resource's fields before filtering", () => {
      const response: { data: { quickStart: Array<string> } } = JSON.parse(
        handleHelperTool("oneuptime_help", {}, []),
      ) as { data: { quickStart: Array<string> } };

      expect(response.data.quickStart.join("\n")).toContain(
        "oneuptime_describe_resource",
      );
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

describe("what oneuptime_list_resources says a resource is", () => {
  /*
   * A description is looked up by its model's singularName, so a key no
   * model has is never shown: "Scheduled Maintenance" waited unused until
   * #6817 named the model "Maintenance Event".
   */
  it("is keyed by the singular name of a model the tools are made from", () => {
    const names: Set<string> = new Set<string>([
      ...DatabaseModels.map(
        (modelType: { new (): DatabaseBaseModel }): string => {
          return new modelType().singularName || "";
        },
      ),
      ...AnalyticsModels.map(
        (modelType: { new (): AnalyticsBaseModel }): string => {
          return new modelType().singularName || "";
        },
      ),
    ]);

    expect(
      Object.keys(RESOURCE_DESCRIPTIONS).filter((key: string): boolean => {
        return !names.has(key);
      }),
    ).toEqual([]);
    expect(RESOURCE_DESCRIPTIONS["Maintenance Event"]).toContain(
      "Planned downtime",
    );
  });
});
