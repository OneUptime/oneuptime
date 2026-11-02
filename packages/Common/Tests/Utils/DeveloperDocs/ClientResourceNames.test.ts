import { describe, expect, test } from "@jest/globals";
import AIAgentOwnerTeam from "../../../Models/DatabaseModels/AIAgentOwnerTeam";
import Models from "../../../Models/DatabaseModels/Index";
import { DatabaseBaseModelType } from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorOwnerTeam from "../../../Models/DatabaseModels/MonitorOwnerTeam";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import ProbeOwnerTeam from "../../../Models/DatabaseModels/ProbeOwnerTeam";
import {
  CLIENT_RESOURCE_NAMES,
  getClientResourceName,
} from "../../../Utils/DeveloperDocs/ClientResourceNames";
import { getTerraformTypeName } from "../../../Utils/DeveloperDocs/TerraformSchema";

/*
 * The names the published clients give the models whose own singular name
 * reads poorly as a resource's (ClientResourceNames.ts): the person, team
 * and schedule an escalation rule pages sit beside oneuptime_escalation_rule
 * as oneuptime_escalation_rule_user, _team and _schedule, and the two owner
 * teams not named <thing>_team_owner are. The dashboard's Terraform pages
 * name them so too; the provider keeps their old names as deprecated
 * aliases.
 */

describe("client resource names", () => {
  test("an escalation rule's person, team and schedule sit beside the rule", () => {
    expect(getTerraformTypeName(OnCallDutyPolicyEscalationRuleUser)).toBe(
      "oneuptime_escalation_rule_user",
    );
    expect(getTerraformTypeName(OnCallDutyPolicyEscalationRuleTeam)).toBe(
      "oneuptime_escalation_rule_team",
    );
    expect(getTerraformTypeName(OnCallDutyPolicyEscalationRuleSchedule)).toBe(
      "oneuptime_escalation_rule_schedule",
    );
  });

  test("every owner team is <thing>_team_owner", () => {
    expect(getTerraformTypeName(AIAgentOwnerTeam)).toBe(
      "oneuptime_ai_agent_team_owner",
    );
    expect(getTerraformTypeName(ProbeOwnerTeam)).toBe(
      "oneuptime_probe_team_owner",
    );
    expect(getTerraformTypeName(MonitorOwnerTeam)).toBe(
      "oneuptime_monitor_team_owner",
    );

    /*
     * Across every model: an owner team's resource ends in _team_owner, and
     * an owner user's in _user_owner.
     */
    const misnamed: Array<string> = [];
    for (const modelType of Models as Array<DatabaseBaseModelType>) {
      const table: string = new modelType().tableName || "";
      const name: string | null = getTerraformTypeName(modelType);
      if (!name) {
        continue;
      }
      if (table.endsWith("OwnerTeam") && !name.endsWith("_team_owner")) {
        misnamed.push(`${table}: ${name}`);
      }
      if (table.endsWith("OwnerUser") && !name.endsWith("_user_owner")) {
        misnamed.push(`${table}: ${name}`);
      }
    }
    expect(misnamed).toEqual([]);
  });

  test("every listed model exists, and every other keeps its singular name", () => {
    const tables: Set<string> = new Set(
      (Models as Array<DatabaseBaseModelType>).map(
        (modelType: DatabaseBaseModelType): string => {
          return new modelType().tableName || "";
        },
      ),
    );
    for (const table of Object.keys(CLIENT_RESOURCE_NAMES)) {
      expect({ table, exists: tables.has(table) }).toEqual({
        table,
        exists: true,
      });
    }

    expect(getClientResourceName("Monitor", "Monitor")).toBe("Monitor");
    expect(getTerraformTypeName(Monitor)).toBe("oneuptime_monitor");
  });

  test("no two models share a client name", () => {
    const seen: Map<string, string> = new Map();
    const shared: Array<string> = [];
    for (const modelType of Models as Array<DatabaseBaseModelType>) {
      const name: string | null = getTerraformTypeName(modelType);
      if (!name) {
        continue;
      }
      const table: string = new modelType().tableName || "";
      if (seen.has(name)) {
        shared.push(`${name}: ${seen.get(name)} and ${table}`);
      }
      seen.set(name, table);
    }
    expect(shared).toEqual([]);
  });
});
