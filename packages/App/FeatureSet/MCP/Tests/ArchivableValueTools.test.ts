/**
 * Archiving over MCP.
 *
 * An AI agent manages a project's states, severities, monitor statuses and
 * labels with the same tools as any other record. These read the tools
 * generated for the real models: an agent archives and unarchives a value by
 * updating isArchived, can list only the values that are still live, and
 * never says when or by whom a value was archived - OneUptime stamps those
 * from the switch. Postmortem statuses too: an agent moves a postmortem to a
 * live one. And a project's security case statuses and priorities, which an
 * agent sets on a case. Incident roles are not on MCP at all.
 */

import { describe, expect, it, jest } from "@jest/globals";

jest.mock("../Utils/MCPLogger");

import { generateToolsForDatabaseModel } from "../Tools/ToolGenerator";
import { JSONSchema, JSONSchemaProperty, McpToolInfo } from "../Types/McpTypes";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentPostmortemStatus from "Common/Models/DatabaseModels/IncidentPostmortemStatus";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Label from "Common/Models/DatabaseModels/Label";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
import {
  ARCHIVABLE_VALUE_DEFINITIONS,
  ArchivableValueDefinition,
} from "Common/Utils/ArchivableValues";

interface ArchivableValueTools {
  table: string;
  modelType: DatabaseBaseModelType;
  update: string;
  create: string;
  list: string;
}

const VALUES: Array<ArchivableValueTools> = [
  {
    table: "IncidentState",
    modelType: IncidentState,
    update: "update_incident_state",
    create: "create_incident_state",
    list: "list_incident_states",
  },
  {
    table: "IncidentSeverity",
    modelType: IncidentSeverity,
    update: "update_incident_severity",
    create: "create_incident_severity",
    list: "list_incident_severities",
  },
  {
    table: "AlertState",
    modelType: AlertState,
    update: "update_alert_state",
    create: "create_alert_state",
    list: "list_alert_states",
  },
  {
    table: "AlertSeverity",
    modelType: AlertSeverity,
    update: "update_alert_severity",
    create: "create_alert_severity",
    list: "list_alert_severities",
  },
  {
    table: "MonitorStatus",
    modelType: MonitorStatus,
    update: "update_monitor_status",
    create: "create_monitor_status",
    list: "list_monitor_statuses",
  },
  {
    table: "ScheduledMaintenanceState",
    modelType: ScheduledMaintenanceState,
    update: "update_scheduled_maintenance_state",
    create: "create_scheduled_maintenance_state",
    list: "list_scheduled_maintenance_states",
  },
  {
    table: "Label",
    modelType: Label,
    update: "update_label",
    create: "create_label",
    list: "list_labels",
  },
  {
    table: "IncidentPostmortemStatus",
    modelType: IncidentPostmortemStatus,
    update: "update_postmortem_status",
    create: "create_postmortem_status",
    list: "list_postmortem_statuses",
  },
  {
    table: "SecurityCaseStatus",
    modelType: SecurityCaseStatus,
    update: "update_security_case_status",
    create: "create_security_case_status",
    list: "list_security_case_statuses",
  },
  {
    table: "SecurityCasePriority",
    modelType: SecurityCasePriority,
    update: "update_security_case_priority",
    create: "create_security_case_priority",
    list: "list_security_case_priorities",
  },
];

// Values with no MCP tools at all: nothing an agent could pick them with.
const NOT_ON_MCP: Array<{ table: string; modelType: DatabaseBaseModelType }> = [
  { table: "IncidentRole", modelType: IncidentRole },
];

// Stamped by OneUptime from the switch, under both names.
const STAMPED: Array<string> = [
  "archivedAt",
  "archivedByUserId",
  "archivedByUser",
];

function toolsOf(value: ArchivableValueTools): Array<McpToolInfo> {
  return generateToolsForDatabaseModel(new value.modelType(), value.modelType)
    .tools;
}

function tool(tools: Array<McpToolInfo>, name: string): McpToolInfo {
  const found: McpToolInfo | undefined = tools.find(
    (candidate: McpToolInfo): boolean => {
      return candidate.name === name;
    },
  );

  if (!found) {
    throw new Error(`No tool named ${name}.`);
  }

  return found;
}

function propertiesOf(
  schema: JSONSchema | JSONSchemaProperty | undefined,
): Record<string, JSONSchemaProperty> {
  return schema?.properties || {};
}

describe("archiving over MCP", () => {
  it("covers every value that can be archived", () => {
    expect(
      [...VALUES, ...NOT_ON_MCP]
        .map((value: { table: string }): string => {
          return value.table;
        })
        .sort(),
    ).toEqual(
      ARCHIVABLE_VALUE_DEFINITIONS.map(
        (definition: ArchivableValueDefinition): string => {
          return definition.tableName;
        },
      ).sort(),
    );
  });

  it.each(NOT_ON_MCP)(
    "$table has no tools to archive, pick or set one",
    (value: { table: string; modelType: DatabaseBaseModelType }) => {
      expect(
        generateToolsForDatabaseModel(new value.modelType(), value.modelType)
          .tools,
      ).toEqual([]);
    },
  );

  describe.each(VALUES)("$table", (value: ArchivableValueTools) => {
    const tools: Array<McpToolInfo> = toolsOf(value);

    it("is archived and unarchived by updating isArchived", () => {
      const update: McpToolInfo = tool(tools, value.update);
      const properties: Record<string, JSONSchemaProperty> = propertiesOf(
        update.inputSchema,
      );

      expect(properties["isArchived"]).toBeDefined();
      expect(properties["isArchived"]?.type).toBe("boolean");
      expect(update.inputSchema.required).toEqual(["id"]);
    });

    it("never takes when or by whom from an agent", () => {
      for (const name of [value.update, value.create]) {
        const properties: Record<string, JSONSchemaProperty> = propertiesOf(
          tool(tools, name).inputSchema,
        );

        for (const column of STAMPED) {
          expect(properties[column]).toBeUndefined();
        }
      }
    });

    it("creates a value live unless the agent says otherwise", () => {
      const create: McpToolInfo = tool(tools, value.create);

      expect(create.inputSchema.required || []).not.toContain("isArchived");
    });

    it("lists only the live values when asked", () => {
      const list: McpToolInfo = tool(tools, value.list);
      const query: JSONSchemaProperty | undefined = propertiesOf(
        list.inputSchema,
      )["query"];

      expect(propertiesOf(query)["isArchived"]).toBeDefined();
    });
  });
});
