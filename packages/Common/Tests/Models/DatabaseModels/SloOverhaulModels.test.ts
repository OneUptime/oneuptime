import Models from "../../../Models/DatabaseModels/Index";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import ServiceLevelObjectiveFeed, {
  ServiceLevelObjectiveFeedEventType,
} from "../../../Models/DatabaseModels/ServiceLevelObjectiveFeed";
import ServiceLevelObjectiveMonitorRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RuleBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/RuleBaseModel";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Permission, {
  PermissionGroup,
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import RULE_CRITERIA_FIELDS_BY_MODEL from "../../../Types/Rules/RuleCriteriaFieldRegistry";
import SloMetricType from "../../../Types/ServiceLevelObjective/SloMetricType";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import type { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";

/*
 * Schema-level guarantees behind the SLO product overhaul: the two new models
 * (SLO Monitor Rule, SLO Feed), the archive columns, the richer burn-rate rule
 * options and the SLO affected-resource relation on alerts and incidents.
 *
 * None of these is visible to a service or worker test - they pass just as
 * happily against a model that is unreachable over the API, writable by the
 * wrong person, or defaulted so an upgrade quietly changes what every existing
 * rule does. Every name pinned here is also pinned by the migrations and by
 * other workstreams, so a rename has to fail somewhere cheap first.
 */

type ModelType = { new (): BaseModel };

type ModelClass = unknown;

const MODEL_TYPES: Array<ModelType> = Models as Array<ModelType>;

const PERMISSION_PROPS: Array<PermissionProps> =
  PermissionHelper.getAllPermissionProps();

type ColumnArgsFunction = (
  target: ModelClass,
  propertyName: string,
) => ColumnMetadataArgs | undefined;

const columnArgs: ColumnArgsFunction = (
  target: ModelClass,
  propertyName: string,
): ColumnMetadataArgs | undefined => {
  return getMetadataArgsStorage().columns.find(
    (column: ColumnMetadataArgs): boolean => {
      return column.target === target && column.propertyName === propertyName;
    },
  );
};

type JoinTableArgsFunction = (
  target: ModelClass,
  propertyName: string,
) => JoinTableMetadataArgs | undefined;

const joinTableArgs: JoinTableArgsFunction = (
  target: ModelClass,
  propertyName: string,
): JoinTableMetadataArgs | undefined => {
  return getMetadataArgsStorage().joinTables.find(
    (joinTable: JoinTableMetadataArgs): boolean => {
      return (
        joinTable.target === target && joinTable.propertyName === propertyName
      );
    },
  );
};

interface JoinTableShape {
  name: string | undefined;
  joinColumn: string | undefined;
  inverseJoinColumn: string | undefined;
}

type JoinTableShapeFunction = (
  target: ModelClass,
  propertyName: string,
) => JoinTableShape;

const joinTableShape: JoinTableShapeFunction = (
  target: ModelClass,
  propertyName: string,
): JoinTableShape => {
  const args: JoinTableMetadataArgs | undefined = joinTableArgs(
    target,
    propertyName,
  );

  return {
    name: args?.name,
    joinColumn: args?.joinColumns?.[0]?.name,
    inverseJoinColumn: args?.inverseJoinColumns?.[0]?.name,
  };
};

type PermissionPropsForFunction = (
  permission: Permission,
) => PermissionProps | undefined;

const permissionPropsFor: PermissionPropsForFunction = (
  permission: Permission,
): PermissionProps | undefined => {
  return PERMISSION_PROPS.find((props: PermissionProps): boolean => {
    return props.permission === permission;
  });
};

type AccessControlForFunction = (
  model: BaseModel,
  column: string,
) => ColumnAccessControl | undefined;

const accessControlFor: AccessControlForFunction = (
  model: BaseModel,
  column: string,
): ColumnAccessControl | undefined => {
  return model.getColumnAccessControlForAllColumns()[column];
};

describe("SLO overhaul models are registered and routable", () => {
  test.each([
    ["ServiceLevelObjectiveMonitorRule", ServiceLevelObjectiveMonitorRule],
    ["ServiceLevelObjectiveFeed", ServiceLevelObjectiveFeed],
  ])(
    "%s is in Models/Index.ts, so its table is created and its API mounted",
    (_name: string, modelType: ModelType) => {
      expect(MODEL_TYPES).toContain(modelType);
    },
  );

  test.each([
    [
      "ServiceLevelObjectiveMonitorRule",
      ServiceLevelObjectiveMonitorRule,
      "/service-level-objective-monitor-rule",
      "ServiceLevelObjectiveMonitorRule",
    ],
    [
      "ServiceLevelObjectiveFeed",
      ServiceLevelObjectiveFeed,
      "/service-level-objective-feed",
      "ServiceLevelObjectiveFeed",
    ],
  ])(
    "%s is served from its own CRUD route and table",
    (
      _name: string,
      modelType: ModelType,
      crudApiPath: string,
      tableName: string,
    ) => {
      const model: BaseModel = new modelType();

      expect(model.getCrudApiPath()?.toString()).toBe(crudApiPath);
      expect(model.tableName).toBe(tableName);

      // A duplicate route silently shadows another model's whole API.
      const claimants: Array<string> = MODEL_TYPES.filter(
        (candidate: ModelType): boolean => {
          return new candidate().getCrudApiPath()?.toString() === crudApiPath;
        },
      ).map((candidate: ModelType): string => {
        return candidate.name;
      });

      expect(claimants).toEqual([modelType.name]);
    },
  );

  test.each([
    ["ServiceLevelObjectiveMonitorRule", ServiceLevelObjectiveMonitorRule],
    ["ServiceLevelObjectiveFeed", ServiceLevelObjectiveFeed],
  ])(
    "%s is tenant-scoped and inherits access from its SLO",
    (_name: string, modelType: ModelType) => {
      const model: BaseModel = new modelType();

      expect(model.getTenantColumn()).toBe("projectId");

      /*
       * Without this, anyone holding the child permission could read rules or
       * history of SLOs they cannot see, which leaks the SLO's existence.
       */
      expect(model.canAccessIfCanReadOn).toBe("serviceLevelObjective");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ownedThrough: any = (model as any).ownedThrough;

      expect(ownedThrough).toBeTruthy();
      expect(ownedThrough.fkColumn).toBe("serviceLevelObjectiveId");
      expect(ownedThrough.parentModels).toEqual([ServiceLevelObjective]);
    },
  );
});

describe("ServiceLevelObjectiveMonitorRule", () => {
  const model: ServiceLevelObjectiveMonitorRule =
    new ServiceLevelObjectiveMonitorRule();

  test("is a RuleBaseModel, so it carries the versioned criteria column", () => {
    expect(model).toBeInstanceOf(RuleBaseModel);
    expect(model.getTableColumns().columns).toContain("criteria");
  });

  test("declares every column the rule form and engine use", () => {
    const columns: Array<string> = model.getTableColumns().columns;

    for (const column of [
      "projectId",
      "serviceLevelObjectiveId",
      "name",
      "description",
      "isEnabled",
      "monitorLabels",
      "monitorNamePattern",
      "monitorDescriptionPattern",
      "createdByUserId",
      "deletedByUserId",
    ]) {
      expect(columns).toContain(column);
    }
  });

  test("registers exactly the three legacy match fields for criteria", () => {
    expect(
      RULE_CRITERIA_FIELDS_BY_MODEL["ServiceLevelObjectiveMonitorRule"],
    ).toEqual([
      "monitorLabels",
      "monitorNamePattern",
      "monitorDescriptionPattern",
    ]);
  });

  test("gates CRUD on its own granular permissions plus the project admins", () => {
    expect(model.getCreatePermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveMonitorRule,
    ]);
    expect(model.getReadPermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveMonitorRule,
    ]);
    expect(model.getUpdatePermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveMonitorRule,
    ]);
    expect(model.getDeletePermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.DeleteServiceLevelObjectiveMonitorRule,
    ]);
  });

  test("cannot be re-pointed at another SLO or project after create", () => {
    expect(accessControlFor(model, "serviceLevelObjectiveId")?.update).toEqual(
      [],
    );
    expect(
      accessControlFor(model, "serviceLevelObjectiveId")?.create,
    ).toContain(Permission.CreateServiceLevelObjectiveMonitorRule);
    expect(accessControlFor(model, "projectId")?.update).toEqual([]);
  });

  test("lets the match criteria be edited on a saved rule", () => {
    for (const column of [
      "monitorLabels",
      "monitorNamePattern",
      "monitorDescriptionPattern",
      "isEnabled",
    ]) {
      expect(accessControlFor(model, column)?.update).toContain(
        Permission.EditServiceLevelObjectiveMonitorRule,
      );
    }
  });

  test("is enabled by default and NOT NULL, so a rule never sits in a third state", () => {
    const metadata: TableColumnMetadata =
      model.getTableColumnMetadata("isEnabled");

    expect(metadata.defaultValue).toBe(true);
    expect(
      columnArgs(ServiceLevelObjectiveMonitorRule, "isEnabled")?.options,
    ).toMatchObject({ nullable: false, default: true });
  });

  test("stores monitor labels in its own join table", () => {
    expect(
      joinTableShape(ServiceLevelObjectiveMonitorRule, "monitorLabels"),
    ).toEqual({
      name: "ServiceLevelObjectiveMonitorRuleMonitorLabel",
      joinColumn: "serviceLevelObjectiveMonitorRuleId",
      inverseJoinColumn: "labelId",
    });
  });

  test("keeps both patterns nullable, so a label-only rule is valid", () => {
    for (const column of ["monitorNamePattern", "monitorDescriptionPattern"]) {
      expect(
        columnArgs(ServiceLevelObjectiveMonitorRule, column)?.options.nullable,
      ).toBe(true);
    }
  });

  test("is workflow-enabled, so its service must be registered for the worker", () => {
    expect(model.enableWorkflowOn).toEqual({
      create: true,
      delete: true,
      update: true,
      read: true,
    });
  });

  test("is described with the SLO Monitor Rule display names", () => {
    expect(model.singularName).toBe("SLO Monitor Rule");
    expect(model.pluralName).toBe("SLO Monitor Rules");
  });
});

describe("ServiceLevelObjectiveFeed", () => {
  const model: ServiceLevelObjectiveFeed = new ServiceLevelObjectiveFeed();

  test("is append only", () => {
    expect(model.getUpdatePermissions()).toEqual([]);
    expect(model.getDeletePermissions()).toEqual([]);
    expect(model.getCreatePermissions()).toContain(
      Permission.CreateServiceLevelObjectiveFeed,
    );
    expect(model.getReadPermissions()).toContain(
      Permission.ReadServiceLevelObjectiveFeed,
    );
  });

  test("no column can be changed after the item is posted", () => {
    for (const column of model.getTableColumns().columns) {
      const accessControl: ColumnAccessControl | undefined = accessControlFor(
        model,
        column,
      );

      if (!accessControl) {
        continue;
      }

      expect({ column, update: accessControl.update }).toEqual({
        column,
        update: [],
      });
    }
  });

  test("records who acted, what happened, and when", () => {
    const columns: Array<string> = model.getTableColumns().columns;

    for (const column of [
      "projectId",
      "serviceLevelObjectiveId",
      "feedInfoInMarkdown",
      "moreInformationInMarkdown",
      "serviceLevelObjectiveFeedEventType",
      "displayColor",
      "userId",
      "postedAt",
    ]) {
      expect(columns).toContain(column);
    }
  });

  test("is not workflow-enabled, like every other resource feed", () => {
    expect(model.enableWorkflowOn).toBeFalsy();
  });

  test("indexes the feed page's query: one SLO's items by postedAt", () => {
    const index: IndexMetadataArgs | undefined =
      getMetadataArgsStorage().indices.find(
        (candidate: IndexMetadataArgs): boolean => {
          return (
            candidate.target === ServiceLevelObjectiveFeed &&
            Array.isArray(candidate.columns) &&
            candidate.columns.join(",") === "serviceLevelObjectiveId,postedAt"
          );
        },
      );

    expect(index).toBeDefined();
  });

  test("carries exactly the pinned event types, each value equal to its key", () => {
    expect(Object.keys(ServiceLevelObjectiveFeedEventType).sort()).toEqual(
      [
        "ServiceLevelObjectiveCreated",
        "ServiceLevelObjectiveUpdated",
        "ServiceLevelObjectiveEnabled",
        "ServiceLevelObjectiveDisabled",
        "ServiceLevelObjectiveArchived",
        "ServiceLevelObjectiveRestored",
        "StatusChanged",
        "BurnRateAlertRaised",
        "BurnRateAlertResolved",
        "BurnRateIncidentDeclared",
        "BurnRateIncidentResolved",
        "BurnRateRuleAdded",
        "BurnRateRuleChanged",
        "BurnRateRuleRemoved",
        "MonitorRuleAdded",
        "MonitorRuleChanged",
        "MonitorRuleRemoved",
        "MonitorsAttached",
        "MonitorsDetached",
        "OwnerUserAdded",
        "OwnerUserRemoved",
        "OwnerTeamAdded",
        "OwnerTeamRemoved",
      ].sort(),
    );

    /*
     * Values are stored verbatim in a ShortText column: a value that drifts
     * from its key orphans every row already written under the old one.
     */
    for (const [key, value] of Object.entries(
      ServiceLevelObjectiveFeedEventType,
    )) {
      expect(value).toBe(key);
    }
  });
});

describe("ServiceLevelObjective archive columns", () => {
  const model: ServiceLevelObjective = new ServiceLevelObjective();

  test("isArchived is creatable, readable and editable with the SLO permissions", () => {
    const accessControl: ColumnAccessControl | undefined = accessControlFor(
      model,
      "isArchived",
    );

    expect(accessControl?.create).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjective,
    ]);
    expect(accessControl?.read).toContain(Permission.ReadServiceLevelObjective);
    expect(accessControl?.read).toContain(Permission.Viewer);
    expect(accessControl?.update).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjective,
    ]);
  });

  test("isArchived is NOT NULL and defaults to false, so every existing SLO stays live", () => {
    /*
     * A nullable flag would leave pre-upgrade SLOs neither archived nor not,
     * and the list's `isArchived: false` filter would hide all of them.
     */
    expect(
      columnArgs(ServiceLevelObjective, "isArchived")?.options,
    ).toMatchObject({ nullable: false, default: false });
    expect(model.getTableColumnMetadata("isArchived").defaultValue).toBe(false);
    expect(model.getTableColumnMetadata("isArchived").description).toBe(
      "Archived SLOs are hidden from lists and are not evaluated.",
    );
  });

  test.each(["archivedAt", "archivedByUser", "archivedByUserId"])(
    "%s is server-stamped: readable, never client-writable",
    (column: string) => {
      const accessControl: ColumnAccessControl | undefined = accessControlFor(
        model,
        column,
      );

      expect(accessControl?.create).toEqual([]);
      expect(accessControl?.update).toEqual([]);
      expect(accessControl?.read).toContain(
        Permission.ReadServiceLevelObjective,
      );
    },
  );

  test("the archiving user relation is SET NULL, so deleting a user keeps the SLO", () => {
    const relation: { options: { onDelete?: string } } | undefined =
      getMetadataArgsStorage().relations.find(
        (candidate: { target: ModelClass; propertyName: string }): boolean => {
          return (
            candidate.target === ServiceLevelObjective &&
            candidate.propertyName === "archivedByUser"
          );
        },
      ) as { options: { onDelete?: string } } | undefined;

    expect(relation?.options.onDelete).toBe("SET NULL");
  });

  test("DatabaseService can stamp the audit fields, because both columns exist", () => {
    expect(model.hasColumn("archivedAt")).toBe(true);
    expect(model.hasColumn("archivedByUserId")).toBe(true);
  });

  test("the list query (projectId, isArchived) is indexed", () => {
    const index: IndexMetadataArgs | undefined =
      getMetadataArgsStorage().indices.find(
        (candidate: IndexMetadataArgs): boolean => {
          return (
            candidate.target === ServiceLevelObjective &&
            Array.isArray(candidate.columns) &&
            candidate.columns.join(",") === "projectId,isArchived"
          );
        },
      );

    expect(index).toBeDefined();
  });

  test("monitorLabels is kept but marked deprecated in favour of monitor rules", () => {
    expect(model.getTableColumns().columns).toContain("monitorLabels");
    expect(model.getTableColumnMetadata("monitorLabels").description).toMatch(
      /^Deprecated: superseded by SLO Monitor Rules/,
    );
    expect(model.getTableColumnMetadata("monitorLabels").description).toContain(
      "no longer read by the SLO engine",
    );
    /*
     * A write of the column is still acted on (ServiceLevelObjectiveService
     * converts it into a rule, or ignores it once rules exist), so the API
     * reference must say so rather than read as a dead field.
     */
    expect(model.getTableColumnMetadata("monitorLabels").description).toContain(
      "labels written here to an SLO with no monitor rules are turned into that rule, and are ignored once the SLO has monitor rules",
    );
  });
});

describe("ServiceLevelObjectiveBurnRateRule output options", () => {
  const model: ServiceLevelObjectiveBurnRateRule =
    new ServiceLevelObjectiveBurnRateRule();

  /*
   * The defaults are the whole upgrade story: every rule that already exists,
   * and the two seeded on SLO create, must keep raising exactly the alert they
   * always did - auto-resolving, public, owned by nobody extra.
   */
  test.each([
    ["autoResolveAlert", true],
    ["autoResolveIncident", true],
    ["isAlertPrivate", false],
    ["isIncidentPrivate", false],
    ["addSloOwnersAsOwners", false],
  ])(
    "%s is a NOT NULL boolean defaulting to %s",
    (column: string, expectedDefault: boolean) => {
      const metadata: TableColumnMetadata =
        model.getTableColumnMetadata(column);

      expect(metadata.type).toBe(TableColumnType.Boolean);
      expect(metadata.defaultValue).toBe(expectedDefault);
      expect(metadata.isDefaultValueColumn).toBe(true);
      expect(
        columnArgs(ServiceLevelObjectiveBurnRateRule, column)?.options,
      ).toMatchObject({ nullable: false, default: expectedDefault });
    },
  );

  test.each([
    ["alertTitleTemplate", TableColumnType.LongText],
    ["alertDescriptionTemplate", TableColumnType.Markdown],
    ["alertRemediationNotes", TableColumnType.Markdown],
    ["incidentTitleTemplate", TableColumnType.LongText],
    ["incidentDescriptionTemplate", TableColumnType.Markdown],
    ["incidentRemediationNotes", TableColumnType.Markdown],
  ])(
    "%s is a nullable %s, so a blank template falls back to the built-in text",
    (column: string, type: TableColumnType) => {
      expect(model.getTableColumnMetadata(column).type).toBe(type);
      expect(model.getTableColumnMetadata(column).required).toBeFalsy();
      expect(
        columnArgs(ServiceLevelObjectiveBurnRateRule, column)?.options.nullable,
      ).toBe(true);
    },
  );

  test.each([
    [
      "alertLabels",
      "ServiceLevelObjectiveBurnRateRuleAlertLabel",
      "labelId",
      "Label",
    ],
    [
      "alertOwnerTeams",
      "ServiceLevelObjectiveBurnRateRuleAlertOwnerTeam",
      "teamId",
      "Team",
    ],
    [
      "alertOwnerUsers",
      "ServiceLevelObjectiveBurnRateRuleAlertOwnerUser",
      "userId",
      "User",
    ],
    [
      "incidentLabels",
      "ServiceLevelObjectiveBurnRateRuleIncidentLabel",
      "labelId",
      "Label",
    ],
    [
      "incidentOwnerTeams",
      "ServiceLevelObjectiveBurnRateRuleIncidentOwnerTeam",
      "teamId",
      "Team",
    ],
    [
      "incidentOwnerUsers",
      "ServiceLevelObjectiveBurnRateRuleIncidentOwnerUser",
      "userId",
      "User",
    ],
  ])(
    "%s is an EntityArray stored in %s",
    (
      column: string,
      joinTableName: string,
      inverseJoinColumn: string,
      relatedModelName: string,
    ) => {
      const metadata: TableColumnMetadata =
        model.getTableColumnMetadata(column);

      expect(metadata.type).toBe(TableColumnType.EntityArray);
      expect((metadata.modelType as unknown as { name: string }).name).toBe(
        relatedModelName,
      );
      expect(joinTableShape(ServiceLevelObjectiveBurnRateRule, column)).toEqual(
        {
          name: joinTableName,
          joinColumn: "serviceLevelObjectiveBurnRateRuleId",
          inverseJoinColumn,
        },
      );
    },
  );

  test("every new option uses the burn rate rule's own permissions", () => {
    for (const column of [
      "alertTitleTemplate",
      "alertDescriptionTemplate",
      "alertRemediationNotes",
      "isAlertPrivate",
      "autoResolveAlert",
      "alertLabels",
      "alertOwnerTeams",
      "alertOwnerUsers",
      "incidentTitleTemplate",
      "incidentDescriptionTemplate",
      "incidentRemediationNotes",
      "isIncidentPrivate",
      "autoResolveIncident",
      "incidentLabels",
      "incidentOwnerTeams",
      "incidentOwnerUsers",
      "addSloOwnersAsOwners",
    ]) {
      const accessControl: ColumnAccessControl | undefined = accessControlFor(
        model,
        column,
      );

      expect({ column, create: accessControl?.create }).toEqual({
        column,
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.CreateServiceLevelObjectiveBurnRateRule,
        ],
      });
      expect({ column, update: accessControl?.update }).toEqual({
        column,
        update: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.EditServiceLevelObjectiveBurnRateRule,
        ],
      });
      expect(accessControl?.read).toContain(
        Permission.ReadServiceLevelObjectiveBurnRateRule,
      );
    }
  });

  test("keeps the existing on-call columns and their public API names", () => {
    const columns: Array<string> = model.getTableColumns().columns;

    expect(columns).toContain("onCallDutyPolicies");
    expect(columns).toContain("incidentOnCallDutyPolicies");
  });

  test("offers no status page or monitor status option for burn rate incidents", () => {
    const columns: Array<string> = model.getTableColumns().columns;

    expect(columns).not.toContain("showIncidentOnStatusPage");
    expect(columns).not.toContain("changeMonitorStatusToId");
  });
});

describe("Incident and Alert serviceLevelObjectives relation", () => {
  test.each([
    ["Incident", Incident, "IncidentServiceLevelObjective", "incidentId"],
    ["Alert", Alert, "AlertServiceLevelObjective", "alertId"],
  ])(
    "%s.serviceLevelObjectives is an EntityArray of SLOs in %s",
    (
      _name: string,
      modelType: ModelType,
      joinTableName: string,
      joinColumn: string,
    ) => {
      const model: BaseModel = new modelType();
      const metadata: TableColumnMetadata = model.getTableColumnMetadata(
        "serviceLevelObjectives",
      );

      expect(metadata.type).toBe(TableColumnType.EntityArray);
      expect(metadata.modelType).toBe(ServiceLevelObjective);
      expect(metadata.title).toBe("Service Level Objectives");
      expect(metadata.required).toBeFalsy();
      expect(joinTableShape(modelType, "serviceLevelObjectives")).toEqual({
        name: joinTableName,
        joinColumn,
        inverseJoinColumn: "serviceLevelObjectiveId",
      });
    },
  );

  test.each([
    ["Incident", Incident],
    ["Alert", Alert],
  ])(
    "%s.serviceLevelObjectives has exactly the services column's access control",
    (_name: string, modelType: ModelType) => {
      /*
       * An incident-only role can already see which services an incident
       * affects; seeing its SLOs must need exactly the same grant, no more
       * and no less.
       */
      const model: BaseModel = new modelType();

      expect(accessControlFor(model, "serviceLevelObjectives")).toEqual(
        accessControlFor(model, "services"),
      );
    },
  );
});

describe("SLO overhaul permissions", () => {
  test.each([
    Permission.CreateServiceLevelObjectiveMonitorRule,
    Permission.ReadServiceLevelObjectiveMonitorRule,
    Permission.EditServiceLevelObjectiveMonitorRule,
    Permission.DeleteServiceLevelObjectiveMonitorRule,
    Permission.CreateServiceLevelObjectiveFeed,
    Permission.ReadServiceLevelObjectiveFeed,
    Permission.EditServiceLevelObjectiveFeed,
  ])(
    "%s is in the catalogue under SLO, so it can be granted",
    (permission: Permission) => {
      const props: PermissionProps | undefined = permissionPropsFor(permission);

      expect(props).toBeDefined();
      expect(props!.group).toBe(PermissionGroup.SLO);
      expect(props!.isAssignableToTenant).toBe(true);
      expect(props!.isRolePermission).toBe(false);
      expect(props!.title.length).toBeGreaterThan(0);
    },
  );

  test.each([
    "CreateServiceLevelObjectiveMonitorRule",
    "ReadServiceLevelObjectiveMonitorRule",
    "EditServiceLevelObjectiveMonitorRule",
    "DeleteServiceLevelObjectiveMonitorRule",
    "CreateServiceLevelObjectiveFeed",
    "ReadServiceLevelObjectiveFeed",
    "EditServiceLevelObjectiveFeed",
  ])("the %s enum value equals its key", (key: string) => {
    expect((Permission as unknown as Record<string, string>)[key]).toBe(key);
  });
});

describe("SloMetricType", () => {
  test("pins every metric name exactly - they are stored in ClickHouse", () => {
    expect({ ...SloMetricType }).toEqual({
      SliPercent: "oneuptime.slo.sli.percent",
      TargetPercent: "oneuptime.slo.target.percent",
      ErrorBudgetRemainingPercent:
        "oneuptime.slo.error.budget.remaining.percent",
      ErrorBudgetRemainingSeconds:
        "oneuptime.slo.error.budget.remaining.seconds",
      BurnRate: "oneuptime.slo.burn.rate",
      Status: "oneuptime.slo.status",
    });
  });

  test("every metric lives under the oneuptime.slo. namespace", () => {
    for (const value of Object.values(SloMetricType)) {
      expect(value.startsWith("oneuptime.slo.")).toBe(true);
    }
  });

  test("no two metrics share a name", () => {
    const values: Array<string> = Object.values(SloMetricType);

    expect(new Set(values).size).toBe(values.length);
  });
});
