import Models from "../../../Models/DatabaseModels/Index";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import Label from "../../../Models/DatabaseModels/Label";
import Service from "../../../Models/DatabaseModels/Service";
import Project from "../../../Models/DatabaseModels/Project";
import RuleBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/RuleBaseModel";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import TableColumnType from "../../../Types/Database/TableColumnType";
import AutoRemediationAction from "../../../Types/AutoRemediation/AutoRemediationAction";
import AutoRemediationTriggerEntity from "../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
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
 *   - AutoRemediationRule.codeRepositories: the code repositories
 *     OneUptime AI may use for what a rule matches (none named: all of
 *     them);
 *   - AutoRemediationRule is the AI rule: which new incidents and alerts
 *     are investigated (investigates, onlyIfOpenAfterMinutes) and which are
 *     fixed (fixes) - the investigation rules moved into it, and their own
 *     table's model is gone.
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

/*
 * "Should incident investigation rule and remediation rule be the same
 * entity - we can call it Incident AI rules ... Since its not possible to
 * remediate without investigation" - the maintainer. One AI rule, in the
 * table the auto remediation rules had: the investigation rules moved in
 * (MergeInvestigationRulesIntoAiRules).
 */
describe("the AI rule", () => {
  const model: AutoRemediationRule = new AutoRemediationRule();

  it("is a rule with the shared conditions, registered so its table is created", () => {
    expect(model).toBeInstanceOf(RuleBaseModel);
    expect(
      Models.some((registered: { new (): BaseModel }) => {
        return registered === AutoRemediationRule;
      }),
    ).toBe(true);
  });

  it("is the one model of its kind: the investigation rules' model is gone", () => {
    const tableNames: Array<string> = Models.map(
      (registered: { new (): BaseModel }): string => {
        return new registered().tableName || "";
      },
    );

    expect(tableNames).toContain("AutoRemediationRule");
    expect(tableNames).not.toContain("AIInvestigationRule");
  });

  it("is scoped to a project, and served from the endpoint the auto remediation rules had", () => {
    expect(model.getTenantColumn()).toBe("projectId");
    expect(model.getCrudApiPath()?.toString()).toBe("/auto-remediation-rule");
  });

  it("is named an AI rule, and says what it was", () => {
    expect(model.singularName).toBe("AI Rule");
    expect(model.pluralName).toBe("AI Rules");
    expect(model.formerSingularName).toBe("Auto Remediation Rule");
  });

  it("is changed by a Project Owner or Admin or the AI rule permissions, and read by the project's members", () => {
    expect(model.getCreatePermissions()).toEqual([
      ...OWNER_OR_ADMIN,
      Permission.CreateAutoRemediationRule,
    ]);
    expect(model.getUpdatePermissions()).toEqual([
      ...OWNER_OR_ADMIN,
      Permission.EditAutoRemediationRule,
    ]);
    expect(model.getDeletePermissions()).toEqual([
      ...OWNER_OR_ADMIN,
      Permission.DeleteAutoRemediationRule,
    ]);
    expect(model.getReadPermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadAutoRemediationRule,
    ]);
  });

  it("holds a name, a switch, the kind of signal, the conditions, and what it does", () => {
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
      "investigates",
      "onlyIfOpenAfterMinutes",
      "fixes",
      "executionMode",
    ]) {
      expect(columns).toContain(column);
    }

    expect(model.getTableColumnMetadata("isEnabled").defaultValue).toBe(true);
  });

  /*
   * An auto remediation rule an older API or Terraform client creates says
   * nothing of either: it fixes, and does not decide which incidents are
   * investigated - what it always did.
   */
  it.each([
    ["investigates", "Investigates", false],
    ["fixes", "Fixes", true],
  ])(
    "%s is a required Boolean that starts %s",
    (column: string, title: string, defaultValue: boolean) => {
      const metadata: ReturnType<
        AutoRemediationRule["getTableColumnMetadata"]
      > = model.getTableColumnMetadata(column);

      expect(metadata.type).toBe(TableColumnType.Boolean);
      expect(metadata.title).toBe(title);
      expect(metadata.defaultValue).toBe(defaultValue);
      expect(metadata.required).toBe(true);
      expect(metadata.isDefaultValueColumn).toBe(true);
    },
  );

  it("waits, when it does, a number of minutes it may leave empty", () => {
    const metadata: ReturnType<AutoRemediationRule["getTableColumnMetadata"]> =
      model.getTableColumnMetadata("onlyIfOpenAfterMinutes");

    expect(metadata.type).toBe(TableColumnType.Number);
    expect(metadata.title).toBe("Only If Open After (Minutes)");
    expect(metadata.required).toBe(false);
  });

  it.each([["investigates"], ["fixes"], ["onlyIfOpenAfterMinutes"]])(
    "%s is written by whoever may write the rule's execution mode",
    (column: string) => {
      expect(model.getColumnAccessControlFor(column)).toEqual(
        model.getColumnAccessControlFor("executionMode"),
      );
    },
  );

  it("is for one kind of signal for good: the trigger is set on create only", () => {
    const accessControl: ColumnAccessControl | null =
      model.getColumnAccessControlFor("triggerEntityType");

    expect(accessControl?.update).toEqual([]);
    expect(accessControl?.create).toEqual([
      ...OWNER_OR_ADMIN,
      Permission.CreateAutoRemediationRule,
    ]);
    /*
     * Incidents and alerts, the slow code a service's profiles show, the
     * slow and failing operations its traces show, its new and rising
     * exceptions, and the problems its metrics show.
     */
    expect(Object.values(AutoRemediationTriggerEntity)).toEqual([
      "Incident",
      "Alert",
      "Profile",
      "Trace",
      "Exception",
      "Metric",
    ]);
  });

  /*
   * And the runbooks, Runners, MCP servers and code repositories OneUptime AI
   * may use for what the rule matches (allow-lists under More fields, not
   * conditions): join tables too.
   */
  it("keeps each list in a join table of its own", () => {
    const joinTables: Array<JoinTableMetadataArgs> =
      getMetadataArgsStorage().joinTables.filter(
        (joinTable: JoinTableMetadataArgs): boolean => {
          return joinTable.target === AutoRemediationRule;
        },
      );

    expect(
      joinTables
        .map((joinTable: JoinTableMetadataArgs): string => {
          return `${joinTable.name} ${joinTable.joinColumns?.[0]?.name} ${joinTable.inverseJoinColumns?.[0]?.name}`;
        })
        .sort(),
    ).toEqual([
      "AutoRemediationRuleAlertSeverity autoRemediationRuleId alertSeverityId",
      "AutoRemediationRuleCodeRepository autoRemediationRuleId codeRepositoryId",
      "AutoRemediationRuleExternalMcpServer autoRemediationRuleId externalMcpServerId",
      "AutoRemediationRuleIncidentSeverity autoRemediationRuleId incidentSeverityId",
      "AutoRemediationRuleLabel autoRemediationRuleId labelId",
      "AutoRemediationRuleMonitor autoRemediationRuleId monitorId",
      "AutoRemediationRuleMonitorLabel autoRemediationRuleId labelId",
      "AutoRemediationRuleRunbook autoRemediationRuleId runbookId",
      "AutoRemediationRuleRunner autoRemediationRuleId runnerId",
      // What a profile AI rule matches on: the service, and its labels.
      "AutoRemediationRuleService autoRemediationRuleId serviceId",
      "AutoRemediationRuleServiceLabel autoRemediationRuleId labelId",
    ]);
  });

  it("matches a profile AI rule on the service: picked, labelled or named", () => {
    for (const column of ["services", "serviceLabels", "serviceNamePattern"]) {
      expect(model.getTableColumnMetadata(column)).toBeTruthy();
      expect(model.getTableColumnMetadata(column)?.required).toBe(false);
      expect(model.getColumnAccessControlFor(column)).toEqual(
        model.getColumnAccessControlFor("labels"),
      );
    }

    expect(model.getTableColumnMetadata("services")?.modelType).toBe(Service);
    expect(model.getTableColumnMetadata("serviceLabels")?.modelType).toBe(
      Label,
    );
    expect(
      model.getTableColumnMetadata("triggerEntityType")?.description,
    ).toContain("Profile");
  });
});
