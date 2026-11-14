import { describe, expect, test } from "@jest/globals";
import DatabaseModels from "../../Models/DatabaseModels/Index";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRuleSchedule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicyExecutionLog from "../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyPolicyFeed from "../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import OnCallDutyPolicyOwnerTeam from "../../Models/DatabaseModels/OnCallDutyPolicyOwnerTeam";
import OnCallDutyPolicyOwnerUser from "../../Models/DatabaseModels/OnCallDutyPolicyOwnerUser";
import OnCallDutyPolicySchedule from "../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyTimeLog from "../../Models/DatabaseModels/OnCallDutyPolicyTimeLog";
import Monitor from "../../Models/DatabaseModels/Monitor";
import TelemetryIngestionKey from "../../Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyRefusal from "../../Models/DatabaseModels/TelemetryIngestionKeyRefusal";
import ScheduledMaintenance from "../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceInternalNote from "../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenancePublicNote from "../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import {
  getApiPluralName,
  getApiSingularName,
  getScreenSingularName,
  KEPT_SINGULAR_NAMES,
} from "../../Utils/ModelApiName";
import { getCliResourceName } from "../../Utils/DeveloperDocs/CliCommands";
import { getMcpToolNames } from "../../Utils/DeveloperDocs/AiAssistantExamples";
import { getTerraformTypeName } from "../../Utils/DeveloperDocs/TerraformSchema";
import { findRetiredNames } from "../../Types/Docs/RetiredNames";
import OnCallDutyPolicyScheduleLayerUser from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import {
  getResourceTypeLabel,
  RESOURCE_META,
} from "../../../App/FeatureSet/Dashboard/src/Components/AuditLogs/AuditLogsTableUtils";

/*
 * A MODEL RENAMED ON SCREEN KEEPS ITS NAMES OUTSIDE (#6817).
 *
 * #6817 gave one thing one name: On-Call Duty Policies are On-Call
 * Policies, an On-Call Policy Schedule is an On-Call Schedule, a Telemetry
 * Ingestion Key is an Ingestion Key. Terraform,
 * the CLI, the MCP server and the audit log name a model after its
 * singular and plural names, so each renamed model says what it was called
 * in apiSingularName and apiPluralName (Common/Utils/ModelApiName), and
 * every name below - written down before the rename - must not move. A
 * Terraform configuration, a script and an agent's allowed tools keep
 * working; the screens say the new words.
 */

interface KeptNames {
  model: DatabaseBaseModelType;
  // What a person reads now.
  singularName: string;
  pluralName: string;
  // What the API, Terraform, the CLI and MCP go on calling it.
  terraform: string | null;
  cli: string;
  mcpList: string | null;
  mcpGet: string | null;
}

const RENAMED: Array<KeptNames> = [
  {
    model: OnCallDutyPolicy,
    singularName: "On-Call Policy",
    pluralName: "On-Call Policies",
    terraform: "oneuptime_on_call_policy",
    cli: "on-call-policy",
    mcpList: "list_on_call_duty_policies",
    mcpGet: "get_on_call_policy",
  },
  {
    model: OnCallDutyPolicySchedule,
    singularName: "On-Call Schedule",
    pluralName: "On-Call Schedules",
    terraform: "oneuptime_on_call_policy_schedule",
    cli: "on-call-policy-schedule",
    mcpList: null,
    mcpGet: null,
  },
  {
    model: OnCallDutyPolicyEscalationRuleUser,
    singularName: "Escalation Rule User",
    pluralName: "Escalation Rule Users",
    terraform: "oneuptime_escalation_rule_user",
    cli: "escalation-rule-user",
    mcpList: null,
    mcpGet: null,
  },
  {
    model: OnCallDutyPolicyEscalationRuleTeam,
    singularName: "Escalation Rule Team",
    pluralName: "Escalation Rule Teams",
    terraform: "oneuptime_escalation_rule_team",
    cli: "escalation-rule-team",
    mcpList: null,
    mcpGet: null,
  },
  {
    model: OnCallDutyPolicyEscalationRuleSchedule,
    singularName: "Escalation Rule Schedule",
    pluralName: "Escalation Rule Schedules",
    terraform: "oneuptime_escalation_rule_schedule",
    cli: "escalation-rule-schedule",
    mcpList: null,
    mcpGet: null,
  },
  {
    model: OnCallDutyPolicyExecutionLog,
    singularName: "On-Call Policy Execution Log",
    pluralName: "On-Call Policy Execution Logs",
    terraform: "oneuptime_on_call_duty_execution_log",
    cli: "on-call-duty-execution-log",
    mcpList: null,
    mcpGet: null,
  },
  {
    model: OnCallDutyPolicyExecutionLogTimeline,
    singularName: "On-Call Policy Execution Log Timeline",
    pluralName: "On-Call Policy Execution Log Timeline",
    terraform: "oneuptime_on_call_duty_execution_log_timeline",
    cli: "on-call-duty-execution-log-timeline",
    mcpList: null,
    mcpGet: null,
  },
  {
    model: OnCallDutyPolicyFeed,
    singularName: "On-Call Policy Feed",
    pluralName: "On-Call Policy Feeds",
    terraform: "oneuptime_on_call_duty_policy_feed",
    cli: "on-call-duty-policy-feed",
    mcpList: null,
    mcpGet: null,
  },
  {
    model: OnCallDutyPolicyTimeLog,
    singularName: "On-Call Time Log",
    pluralName: "On-Call Time Logs",
    terraform: "oneuptime_on_call_time_log",
    cli: "on-call-time-log",
    mcpList: null,
    mcpGet: null,
  },
  {
    model: OnCallDutyPolicyOwnerUser,
    singularName: "On-Call Policy User Owner",
    pluralName: "On-Call Policy User Owners",
    terraform: "oneuptime_on_call_duty_policy_user_owner",
    cli: "on-call-duty-policy-user-owner",
    mcpList: null,
    mcpGet: null,
  },
  {
    model: OnCallDutyPolicyOwnerTeam,
    singularName: "On-Call Policy Team Owner",
    pluralName: "On-Call Policy Team Owners",
    terraform: "oneuptime_on_call_duty_policy_team_owner",
    cli: "on-call-duty-policy-team-owner",
    mcpList: null,
    mcpGet: null,
  },
  // Part 2: a Telemetry Ingestion Key is an Ingestion Key.
  {
    model: TelemetryIngestionKey,
    singularName: "Ingestion Key",
    pluralName: "Ingestion Keys",
    terraform: "oneuptime_telemetry_ingestion_key",
    cli: "telemetry-ingestion-key",
    mcpList: null,
    mcpGet: null,
  },
  {
    model: TelemetryIngestionKeyRefusal,
    singularName: "Ingestion Key Refusal",
    pluralName: "Ingestion Key Refusals",
    terraform: null,
    cli: "telemetry-ingestion-key-refusal",
    mcpList: null,
    mcpGet: null,
  },
  // Part 3: a Scheduled Maintenance Event is a Maintenance Event.
  {
    model: ScheduledMaintenance,
    singularName: "Maintenance Event",
    pluralName: "Maintenance Events",
    terraform: "oneuptime_scheduled_maintenance_event",
    cli: "scheduled-maintenance-event",
    mcpList: "list_scheduled_maintenance_events",
    mcpGet: "get_scheduled_maintenance_event",
  },
  {
    model: ScheduledMaintenanceInternalNote,
    singularName: "Maintenance Event Internal Note",
    pluralName: "Maintenance Event Internal Notes",
    terraform: null,
    cli: "scheduled-event-internal-note",
    mcpList: null,
    mcpGet: null,
  },
  {
    model: ScheduledMaintenancePublicNote,
    singularName: "Maintenance Event Public Note",
    pluralName: "Maintenance Event Public Notes",
    terraform: "oneuptime_scheduled_event_public_note",
    cli: "scheduled-event-public-note",
    mcpList: null,
    mcpGet: null,
  },
];

describe("the names a model keeps outside its screens", () => {
  test("a model never renamed is known by its own names everywhere", () => {
    const monitor: DatabaseBaseModel = new Monitor();

    expect(getApiSingularName(monitor)).toBe("Monitor");
    expect(getApiPluralName(monitor)).toBe("Monitors");
  });

  test("a kept name wins over the name on screen, singular and plural apart", () => {
    expect(
      getApiSingularName({
        tableName: "Thing",
        singularName: "New Thing",
        pluralName: "New Things",
        apiSingularName: "Old Thing",
        apiPluralName: "Old Things",
      }),
    ).toBe("Old Thing");
    expect(
      getApiPluralName({
        tableName: "Thing",
        singularName: "New Thing",
        pluralName: "New Things",
        apiPluralName: "Old Things",
      }),
    ).toBe("Old Things");
    expect(
      getApiSingularName({
        tableName: "Thing",
        singularName: "New Thing",
        apiPluralName: "Old Things",
      }),
    ).toBe("New Thing");
  });

  test("with no names at all, the table's name, and an s for the plural", () => {
    expect(getApiSingularName({ tableName: "Thing" })).toBe("Thing");
    expect(getApiPluralName({ tableName: "Thing" })).toBe("Things");
  });

  test("a model whose singular name changed keeps its plural too", () => {
    for (const modelType of DatabaseModels) {
      const model: DatabaseBaseModel = new modelType();

      if (model.apiSingularName) {
        expect({
          table: model.tableName,
          apiPluralName: Boolean(model.apiPluralName),
        }).toEqual({ table: model.tableName, apiPluralName: true });
      }
    }
  });

  test("a kept name is a name the model no longer shows", () => {
    for (const modelType of DatabaseModels) {
      const model: DatabaseBaseModel = new modelType();

      if (model.apiSingularName) {
        expect(model.apiSingularName).not.toBe(model.singularName);
      }

      if (model.apiPluralName) {
        expect(model.apiPluralName).not.toBe(model.pluralName);
      }
    }
  });
});

describe("the models #6817 renamed", () => {
  test.each(RENAMED)(
    "$singularName is read on screen, and keeps its Terraform, CLI and MCP names",
    (kept: KeptNames) => {
      const model: DatabaseBaseModel = new kept.model();

      expect(model.singularName).toBe(kept.singularName);
      expect(model.pluralName).toBe(kept.pluralName);
      expect(getTerraformTypeName(kept.model)).toBe(kept.terraform);
      expect(getCliResourceName(model)).toBe(kept.cli);

      const tools: ReturnType<typeof getMcpToolNames> = getMcpToolNames(
        kept.model,
      );

      expect(tools?.list ?? null).toBe(kept.mcpList);
      expect(tools?.get ?? null).toBe(kept.mcpGet);
    },
  );

  /*
   * The audit log stores an entry's resource type by the kept name, so last
   * year's entries and today's are one type; the audit page shows the type
   * by the name on screen.
   */
  test("the audit log shows every kept type by the name on screen", () => {
    const kept: Array<string> = [];

    for (const modelType of DatabaseModels) {
      const model: DatabaseBaseModel = new modelType();

      if (!model.apiSingularName) {
        continue;
      }

      kept.push(model.apiSingularName);
      expect({
        table: model.tableName,
        shown: getResourceTypeLabel(model.apiSingularName),
        screen: getScreenSingularName(model.apiSingularName),
      }).toEqual({
        table: model.tableName,
        shown: model.singularName,
        screen: model.singularName,
      });
    }

    // Its table knows no kept name a model does not keep.
    expect([...KEPT_SINGULAR_NAMES].sort()).toEqual(kept.sort());

    expect(getResourceTypeLabel("On-Call Policy Schedule")).toBe(
      "On-Call Schedule",
    );
    expect(getResourceTypeLabel("Telemetry Ingestion Key")).toBe(
      "Ingestion Key",
    );
    expect(getResourceTypeLabel("Monitor")).toBe("Monitor");
    expect(getScreenSingularName("Monitor")).toBe("Monitor");
    expect(getResourceTypeLabel(undefined)).toBe("Resource");
    expect(RESOURCE_META["Telemetry Ingestion Key"]).toBeUndefined();
  });

  test("an entry rolls up to its root by the root's kept name too", () => {
    const layerUser: DatabaseBaseModel =
      new OnCallDutyPolicyScheduleLayerUser();

    expect(layerUser.enableAuditLogOn?.rootResource?.resourceType).toBe(
      "On-Call Policy Schedule",
    );
  });

  test("no name a person reads on these models is a retired one", () => {
    for (const kept of RENAMED) {
      const model: DatabaseBaseModel = new kept.model();

      expect({
        table: model.tableName,
        retired: findRetiredNames(
          [model.singularName, model.pluralName, model.tableDescription].join(
            " | ",
          ),
        ).map((retired: { name: string }): string => {
          return retired.name;
        }),
      }).toEqual({ table: model.tableName, retired: [] });
    }
  });
});
