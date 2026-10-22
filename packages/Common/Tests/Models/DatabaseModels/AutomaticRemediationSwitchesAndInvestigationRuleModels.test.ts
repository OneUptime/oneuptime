import Models from "../../../Models/DatabaseModels/Index";
import AIInvestigationRule from "../../../Models/DatabaseModels/AIInvestigationRule";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
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
 *   - AutoRemediationRule.openCodeFixPullRequests and
 *     openTelemetryPullRequests: the two pull requests fixing opens, on by
 *     default, per rule - the project's own switches for them are gone;
 *   - AutoRemediationRule.codeRepositories and
 *     AIInvestigationRule.codeRepositories: the code repositories OneUptime
 *     AI may use for what a rule matches (none named: all of them);
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
      const accessControl: ColumnAccessControl | null =
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

describe("the project's fix pull request switches are gone", () => {
  it.each([
    ["enableAutomaticIncidentCodeFixes"],
    ["enableIncidentInstrumentationFixTasks"],
    ["enableAutomaticAlertCodeFixes"],
    ["enableAlertInstrumentationFixTasks"],
  ])("Project has no %s column", (column: string) => {
    expect(new Project().hasColumn(column)).toBe(false);
  });
});

/*
 * "Both of these toggles should be inside of Remediation Rule, inside of
 * More, and they should be checked by default. They should be true by
 * default" - the maintainer.
 */
describe("AutoRemediationRule's pull requests", () => {
  const model: AutoRemediationRule = new AutoRemediationRule();

  it.each([
    ["openCodeFixPullRequests", "Open Fix Pull Requests"],
    ["openTelemetryPullRequests", "Open Telemetry Pull Requests"],
  ])(
    "%s is a required Boolean that starts on",
    (column: string, title: string) => {
      const metadata: ReturnType<
        AutoRemediationRule["getTableColumnMetadata"]
      > = model.getTableColumnMetadata(column);

      expect(metadata.type).toBe(TableColumnType.Boolean);
      expect(metadata.title).toBe(title);
      expect(metadata.defaultValue).toBe(true);
      expect(metadata.required).toBe(true);
      expect(metadata.isDefaultValueColumn).toBe(true);
    },
  );

  it.each([["openCodeFixPullRequests"], ["openTelemetryPullRequests"]])(
    "%s is written by whoever may write the rule's execution mode",
    (column: string) => {
      expect(model.getColumnAccessControlFor(column)).toEqual(
        model.getColumnAccessControlFor("executionMode"),
      );
    },
  );
});

/*
 * "There should be a dropdown here to select the code repo for remediation
 * and also investigation rules, if no code repo is selected - it should be
 * able to read and investigate all the repos that are connected" - the
 * maintainer. A list on each rule, kept in a join table of its own.
 */
describe("the code repositories a rule names", () => {
  function joinTableOf(target: { new (): BaseModel }, name: string): string {
    const joinTable: JoinTableMetadataArgs | undefined =
      getMetadataArgsStorage().joinTables.find(
        (candidate: JoinTableMetadataArgs): boolean => {
          return candidate.target === target && candidate.name === name;
        },
      );

    return `${joinTable?.name} ${joinTable?.joinColumns?.[0]?.name} ${joinTable?.inverseJoinColumns?.[0]?.name}`;
  }

  it.each([
    [
      "AutoRemediationRule",
      new AutoRemediationRule() as BaseModel,
      AutoRemediationRule as unknown as { new (): BaseModel },
      "AutoRemediationRuleCodeRepository autoRemediationRuleId codeRepositoryId",
    ],
    [
      "AIInvestigationRule",
      new AIInvestigationRule() as BaseModel,
      AIInvestigationRule as unknown as { new (): BaseModel },
      "AIInvestigationRuleCodeRepository aiInvestigationRuleId codeRepositoryId",
    ],
  ])(
    "%s.codeRepositories is an optional list of the project's code repositories",
    (
      _name: string,
      model: BaseModel,
      type: { new (): BaseModel },
      joinTable: string,
    ) => {
      const metadata: ReturnType<BaseModel["getTableColumnMetadata"]> =
        model.getTableColumnMetadata("codeRepositories");

      expect(metadata.type).toBe(TableColumnType.EntityArray);
      expect(metadata.modelType).toBe(CodeRepository);
      expect(metadata.title).toBe("Code Repositories");
      expect(metadata.required).toBe(false);
      expect(joinTableOf(type, joinTable.split(" ")[0]!)).toBe(joinTable);
      // Written by whoever may write the rule's other allow-list.
      expect(model.getColumnAccessControlFor("codeRepositories")).toEqual(
        model.getColumnAccessControlFor("externalMcpServers"),
      );
      expect(
        model.getColumnAccessControlFor("codeRepositories")?.update,
      ).toEqual(expect.arrayContaining(OWNER_OR_ADMIN));
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
    const accessControl: ColumnAccessControl | null =
      model.getColumnAccessControlFor("triggerEntityType");

    expect(accessControl?.update).toEqual([]);
    expect(accessControl?.create).toEqual(OWNER_OR_ADMIN);
    expect(Object.values(AIInvestigationRuleTriggerEntity)).toEqual([
      "Incident",
      "Alert",
    ]);
  });

  /*
   * And the MCP servers and code repositories OneUptime AI may use for what
   * the rule matches (allow-lists under More fields, not conditions): join
   * tables too.
   */
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
      "AIInvestigationRuleCodeRepository aiInvestigationRuleId codeRepositoryId",
      "AIInvestigationRuleExternalMcpServer aiInvestigationRuleId externalMcpServerId",
      "AIInvestigationRuleIncidentSeverity aiInvestigationRuleId incidentSeverityId",
      "AIInvestigationRuleLabel aiInvestigationRuleId labelId",
      "AIInvestigationRuleMonitor aiInvestigationRuleId monitorId",
      "AIInvestigationRuleMonitorLabel aiInvestigationRuleId labelId",
    ]);
  });
});
