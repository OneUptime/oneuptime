import Models from "../../../Models/DatabaseModels/Index";
import AIInvestigationRule from "../../../Models/DatabaseModels/AIInvestigationRule";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import Project from "../../../Models/DatabaseModels/Project";
import RuleBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/RuleBaseModel";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import TableColumnType from "../../../Types/Database/TableColumnType";
import AIInvestigationRuleTriggerEntity from "../../../Types/AI/AIInvestigationRuleTriggerEntity";
import AutoRemediationAction from "../../../Types/AutoRemediation/AutoRemediationAction";
import Permission from "../../../Types/Permission";
import { describe, expect, it } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import type { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";

/*
 * The schema behind "Fix new incidents automatically" and the rules that
 * narrow what OneUptime AI does with incidents and alerts:
 *
 *   - Project.enableAutomaticIncidentRemediation and
 *     enableAutomaticAlertRemediation: Boolean, off by default, changed by
 *     a Project Owner or Admin like every other AI switch;
 *   - AutoRemediationRule.remediationAction: what a rule fixes with;
 *   - AIInvestigationRule: which new incidents and alerts are investigated,
 *     a project-scoped rule with the same conditions as the auto
 *     remediation rules, changed by a Project Owner or Admin.
 */

const OWNER_OR_ADMIN: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

describe("the automatic-fix switches on Project", () => {
  const project: Project = new Project();

  it.each([
    [
      "enableAutomaticIncidentRemediation",
      "Enable Automatic Incident Remediation",
    ],
    ["enableAutomaticAlertRemediation", "Enable Automatic Alert Remediation"],
  ])(
    "%s is a required Boolean that starts off",
    (column: string, title: string) => {
      const metadata: ReturnType<Project["getTableColumnMetadata"]> =
        project.getTableColumnMetadata(column);

      expect(metadata.type).toBe(TableColumnType.Boolean);
      expect(metadata.title).toBe(title);
      expect(metadata.defaultValue).toBe(false);
      expect(metadata.required).toBe(true);
      expect(metadata.isDefaultValueColumn).toBe(true);
      expect(metadata.description).toContain("Off by default");
    },
  );

  it.each([
    ["enableAutomaticIncidentRemediation"],
    ["enableAutomaticAlertRemediation"],
  ])(
    "%s may be read by the project's members, and changed only by an owner or admin",
    (column: string) => {
      const accessControl: ColumnAccessControl | undefined =
        project.getColumnAccessControlFor(column);

      expect(accessControl?.update).toEqual(OWNER_OR_ADMIN);
      expect(accessControl?.read).toEqual(
        expect.arrayContaining([
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
        ]),
      );
      // The creator of a project may set it on the create request.
      expect(accessControl?.create).toEqual([Permission.User]);
    },
  );
});

describe("AutoRemediationRule.remediationAction", () => {
  const model: AutoRemediationRule = new AutoRemediationRule();

  it("says what a rule fixes with, OneUptime AI unless it says Runbooks", () => {
    const metadata: ReturnType<AutoRemediationRule["getTableColumnMetadata"]> =
      model.getTableColumnMetadata("remediationAction");

    expect(metadata.title).toBe("Fix With");
    expect(metadata.type).toBe(TableColumnType.ShortText);
    expect(metadata.defaultValue).toBe(AutoRemediationAction.OneUptimeAI);
    expect(Object.values(AutoRemediationAction)).toEqual([
      "OneUptimeAI",
      "Runbooks",
    ]);
  });

  it("is written by whoever may write the rule's execution mode", () => {
    expect(model.getColumnAccessControlFor("remediationAction")).toEqual(
      model.getColumnAccessControlFor("executionMode"),
    );
  });

  it("is described for what it now decides", () => {
    expect(model.getTableColumnMetadata("executionMode").description).toContain(
      "Suggest asks before fixing",
    );
  });
});

describe("AIInvestigationRule", () => {
  const model: AIInvestigationRule = new AIInvestigationRule();

  it("is a rule with the shared conditions, registered so its table is created", () => {
    expect(model).toBeInstanceOf(RuleBaseModel);
    expect(
      Models.some((registered: { new (): BaseModel }) => {
        return registered === AIInvestigationRule;
      }),
    ).toBe(true);
  });

  it("is scoped to a project, and served from its own endpoint", () => {
    expect(model.getTenantColumn()).toBe("projectId");
    expect(model.getCrudApiPath()?.toString()).toBe("/ai-investigation-rule");
  });

  it("is changed by a Project Owner or Admin, and read by the project's members", () => {
    expect(model.getCreatePermissions()).toEqual(OWNER_OR_ADMIN);
    expect(model.getUpdatePermissions()).toEqual(OWNER_OR_ADMIN);
    expect(model.getDeletePermissions()).toEqual(OWNER_OR_ADMIN);
    expect(model.getReadPermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ]);
  });

  it("holds a name, a switch, the kind of signal, and the conditions", () => {
    const columns: Array<string> = model.getTableColumns().columns;

    for (const column of [
      "name",
      "description",
      "isEnabled",
      "triggerEntityType",
      "criteria",
      "monitors",
      "incidentSeverities",
      "alertSeverities",
      "labels",
      "monitorLabels",
      "titlePattern",
      "descriptionPattern",
    ]) {
      expect(columns).toContain(column);
    }

    expect(model.getTableColumnMetadata("isEnabled").defaultValue).toBe(true);
  });

  it("is for one kind of signal for good: the trigger is set on create only", () => {
    const accessControl: ColumnAccessControl | undefined =
      model.getColumnAccessControlFor("triggerEntityType");

    expect(accessControl?.update).toEqual([]);
    expect(accessControl?.create).toEqual(OWNER_OR_ADMIN);
    expect(Object.values(AIInvestigationRuleTriggerEntity)).toEqual([
      "Incident",
      "Alert",
    ]);
  });

  it("keeps each condition list in a join table of its own", () => {
    const joinTables: Array<JoinTableMetadataArgs> =
      getMetadataArgsStorage().joinTables.filter(
        (joinTable: JoinTableMetadataArgs): boolean => {
          return joinTable.target === AIInvestigationRule;
        },
      );

    expect(
      joinTables
        .map((joinTable: JoinTableMetadataArgs): string => {
          return `${joinTable.name} ${joinTable.joinColumns?.[0]?.name} ${joinTable.inverseJoinColumns?.[0]?.name}`;
        })
        .sort(),
    ).toEqual([
      "AIInvestigationRuleAlertSeverity aiInvestigationRuleId alertSeverityId",
      "AIInvestigationRuleIncidentSeverity aiInvestigationRuleId incidentSeverityId",
      "AIInvestigationRuleLabel aiInvestigationRuleId labelId",
      "AIInvestigationRuleMonitor aiInvestigationRuleId monitorId",
      "AIInvestigationRuleMonitorLabel aiInvestigationRuleId labelId",
    ]);
  });
});
