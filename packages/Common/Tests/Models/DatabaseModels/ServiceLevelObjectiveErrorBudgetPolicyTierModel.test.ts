import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import ServiceLevelObjectiveErrorBudgetPolicyTier from "../../../Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import { SLO_RECORD_OUTPUT_RELATION_COLUMNS } from "../../../Utils/Slo/SloRecordOutputColumns";
import { describe, expect, it } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";

/*
 * The model of a tier of an SLO's error budget policy, and the SLO columns
 * that say which tier it is in: who may do what with each, that the outputs
 * are a burn rate rule's column for column, and that the database keeps one
 * tier per threshold.
 */

const model: ServiceLevelObjectiveErrorBudgetPolicyTier =
  new ServiceLevelObjectiveErrorBudgetPolicyTier();

const READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
];

// Every output column a burn rate rule has, which a tier shares by name.
const OUTPUT_COLUMNS: Array<string> = [
  "shouldCreateAlert",
  "shouldCreateIncident",
  "alertSeverity",
  "alertSeverityId",
  "alertTitleTemplate",
  "alertDescriptionTemplate",
  "alertRemediationNotes",
  "isAlertPrivate",
  "autoResolveAlert",
  "incidentSeverity",
  "incidentSeverityId",
  "incidentTitleTemplate",
  "incidentDescriptionTemplate",
  "incidentRemediationNotes",
  "isIncidentPrivate",
  "autoResolveIncident",
  "addSloOwnersAsOwners",
  ...SLO_RECORD_OUTPUT_RELATION_COLUMNS,
];

const LIFECYCLE_COLUMNS: Array<string> = [
  "lastAlertCreatedAt",
  "lastAlertResolvedAt",
  "lastIncidentCreatedAt",
  "lastIncidentResolvedAt",
];

describe("ServiceLevelObjectiveErrorBudgetPolicyTier", () => {
  it("is registered, with its own table and API route", () => {
    expect(
      AllModelTypes.some((modelType: { new (): BaseModel }): boolean => {
        return modelType === ServiceLevelObjectiveErrorBudgetPolicyTier;
      }),
    ).toBe(true);
    expect(model.tableName).toBe("ServiceLevelObjectiveErrorBudgetPolicyTier");
    expect(model.singularName).toBe("SLO Error Budget Policy Tier");
    expect(model.getCrudApiPath()?.toString()).toBe(
      "/service-level-objective-error-budget-policy-tier",
    );
  });

  it("belongs to a project, and is read through its SLO", () => {
    expect(model.getTenantColumn()).toBe("projectId");
    expect(model.canAccessIfCanReadOn).toBe("serviceLevelObjective");
    expect(model.ownedThrough?.fkColumn).toBe("serviceLevelObjectiveId");
  });

  it("has a permission of its own for each action, assignable per project", () => {
    expect(model.createRecordPermissions).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ]);
    expect(model.readRecordPermissions).toEqual(READERS);
    expect(model.updateRecordPermissions).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ]);
    expect(model.deleteRecordPermissions).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.DeleteServiceLevelObjectiveErrorBudgetPolicyTier,
    ]);

    for (const permission of [
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
      Permission.DeleteServiceLevelObjectiveErrorBudgetPolicyTier,
    ]) {
      const all: Record<string, PermissionProps> =
        PermissionHelper.getAllPermissionPropsAsDictionary() as unknown as Record<
          string,
          PermissionProps
        >;
      const props: PermissionProps | undefined = all[permission];

      expect(props).toBeDefined();
      expect(props!.isAssignableToTenant).toBe(true);
      // In the SLO group, beside the burn rate rule permissions.
      expect(props!.group).toBe(
        all[Permission.ReadServiceLevelObjectiveBurnRateRule]!.group,
      );
      expect(props!.title).toMatch(/SLO Error Budget Policy Tier$/);
    }
  });

  it("people set its name, threshold, agreement, deploy gate and outputs; nobody moves it to another SLO", () => {
    for (const column of [
      "name",
      "thresholdPercentage",
      "whatWeDo",
      "freezesDeployments",
      "isEnabled",
      ...OUTPUT_COLUMNS,
    ]) {
      const access: ColumnAccessControl | null =
        model.getColumnAccessControlFor(column);

      expect({ column, read: access?.read }).toEqual({ column, read: READERS });
      expect({ column, update: access?.update }).toEqual({
        column,
        update: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
        ],
      });
    }

    for (const column of ["projectId", "serviceLevelObjectiveId"]) {
      expect(model.getColumnAccessControlFor(column)?.update).toEqual([]);
    }
  });

  it("only the worker writes the lifecycle stamps", () => {
    for (const column of LIFECYCLE_COLUMNS) {
      const access: ColumnAccessControl | null =
        model.getColumnAccessControlFor(column);

      expect({
        column,
        create: access?.create,
        update: access?.update,
      }).toEqual({ column, create: [], update: [] });
      expect(access?.read).toEqual(READERS);
    }
  });

  it("carries a burn rate rule's outputs column for column, of the same types", () => {
    const rule: ServiceLevelObjectiveBurnRateRule =
      new ServiceLevelObjectiveBurnRateRule();

    for (const column of [...OUTPUT_COLUMNS, ...LIFECYCLE_COLUMNS]) {
      expect({ column, isColumn: model.isTableColumn(column) }).toEqual({
        column,
        isColumn: true,
      });
      expect({
        column,
        type: model.getTableColumnMetadata(column).type,
      }).toEqual({ column, type: rule.getTableColumnMetadata(column).type });
    }
  });

  it("raises nothing by default, and resolves on recovery by default", () => {
    expect(model.getTableColumnMetadata("shouldCreateAlert").defaultValue).toBe(
      false,
    );
    expect(
      model.getTableColumnMetadata("shouldCreateIncident").defaultValue,
    ).toBe(false);
    expect(model.getTableColumnMetadata("autoResolveAlert").defaultValue).toBe(
      true,
    );
    expect(
      model.getTableColumnMetadata("autoResolveIncident").defaultValue,
    ).toBe(true);
    expect(model.getTableColumnMetadata("isEnabled").defaultValue).toBe(true);
  });

  it("freezes no deployments by default: Freeze Deployments, a switch that is off until someone turns it on", () => {
    const column: { title?: string; type?: unknown; required?: boolean } =
      model.getTableColumnMetadata("freezesDeployments");

    expect(column.title).toBe("Freeze Deployments");
    expect(column.type).toBe(TableColumnType.Boolean);
    expect(column.required).toBe(true);
    expect(
      model.getTableColumnMetadata("freezesDeployments").defaultValue,
    ).toBe(false);
    expect(
      model.getTableColumnMetadata("freezesDeployments").isDefaultValueColumn,
    ).toBe(true);
    expect(
      model.getColumnAccessControlFor("freezesDeployments")?.create,
    ).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ]);
    // Part of the agreement, not one of the outputs a burn rate rule shares.
    expect(OUTPUT_COLUMNS).not.toContain("freezesDeployments");
    expect(
      new ServiceLevelObjectiveBurnRateRule().isTableColumn(
        "freezesDeployments",
      ),
    ).toBe(false);
  });

  it("needs a name, a threshold and an agreement", () => {
    expect(model.getTableColumnMetadata("name").required).toBe(true);
    expect(model.getTableColumnMetadata("thresholdPercentage").required).toBe(
      true,
    );
    expect(model.getTableColumnMetadata("thresholdPercentage").type).toBe(
      TableColumnType.Number,
    );
    expect(model.getTableColumnMetadata("whatWeDo").required).toBe(true);
    expect(model.getTableColumnMetadata("whatWeDo").type).toBe(
      TableColumnType.Markdown,
    );
  });

  it("has no re-fire suppression and no burn windows: the hysteresis keeps a tier from flapping", () => {
    for (const column of [
      "refireSuppressionMinutes",
      "burnRateThreshold",
      "longWindowInMinutes",
      "shortWindowInMinutes",
    ]) {
      expect(model.isTableColumn(column)).toBe(false);
    }
  });

  it("keeps one tier per threshold on an SLO, in the database", () => {
    const unique: Array<IndexMetadataArgs> =
      getMetadataArgsStorage().indices.filter(
        (index: IndexMetadataArgs): boolean => {
          return (
            index.target === ServiceLevelObjectiveErrorBudgetPolicyTier &&
            index.unique === true
          );
        },
      );

    expect(
      unique.map((index: IndexMetadataArgs): unknown => {
        return index.columns;
      }),
    ).toEqual([["serviceLevelObjectiveId", "thresholdPercentage"]]);
  });

  it("keeps each list in a join table of its own, every name within Postgres' 63 bytes", () => {
    const joinTables: Array<JoinTableMetadataArgs> =
      getMetadataArgsStorage().joinTables.filter(
        (joinTable: JoinTableMetadataArgs): boolean => {
          return (
            joinTable.target === ServiceLevelObjectiveErrorBudgetPolicyTier
          );
        },
      );

    expect(
      joinTables
        .map((joinTable: JoinTableMetadataArgs): string => {
          return `${joinTable.name} ${joinTable.joinColumns?.[0]?.name} ${joinTable.inverseJoinColumns?.[0]?.name}`;
        })
        .sort(),
    ).toEqual(
      [
        "SloErrorBudgetPolicyTierAlertLabel serviceLevelObjectiveErrorBudgetPolicyTierId labelId",
        "SloErrorBudgetPolicyTierAlertOnCallDutyPolicy serviceLevelObjectiveErrorBudgetPolicyTierId onCallDutyPolicyId",
        "SloErrorBudgetPolicyTierAlertOwnerTeam serviceLevelObjectiveErrorBudgetPolicyTierId teamId",
        "SloErrorBudgetPolicyTierAlertOwnerUser serviceLevelObjectiveErrorBudgetPolicyTierId userId",
        "SloErrorBudgetPolicyTierIncidentLabel serviceLevelObjectiveErrorBudgetPolicyTierId labelId",
        "SloErrorBudgetPolicyTierIncidentOnCallDutyPolicy serviceLevelObjectiveErrorBudgetPolicyTierId onCallDutyPolicyId",
        "SloErrorBudgetPolicyTierIncidentOwnerTeam serviceLevelObjectiveErrorBudgetPolicyTierId teamId",
        "SloErrorBudgetPolicyTierIncidentOwnerUser serviceLevelObjectiveErrorBudgetPolicyTierId userId",
      ].sort(),
    );

    for (const joinTable of joinTables) {
      expect(Buffer.byteLength(joinTable.name || "")).toBeLessThanOrEqual(63);
    }
  });
});

describe("the SLO's current tier", () => {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();

  const SLO_READERS: Array<Permission> = [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.ReadServiceLevelObjective,
  ];

  it.each([
    "currentErrorBudgetPolicyTierId",
    "currentErrorBudgetPolicyTierName",
    "currentErrorBudgetPolicyTierEnteredAt",
  ])(
    "%s is read with the SLO's own read permission, and only the worker writes it",
    (column: string) => {
      const access: ColumnAccessControl | null =
        slo.getColumnAccessControlFor(column);

      expect(access).toEqual({
        create: [],
        read: SLO_READERS,
        update: [],
      });
      expect(slo.getTableColumnMetadata(column).required).toBeFalsy();
    },
  );

  it.each(["deploymentsAllowed", "deploymentsFrozenAt"])(
    "the deploy gate's %s is read with the SLO's own read permission, and only the worker writes it",
    (column: string) => {
      const access: ColumnAccessControl | null =
        slo.getColumnAccessControlFor(column);

      expect(access).toEqual({
        create: [],
        read: SLO_READERS,
        update: [],
      });
    },
  );

  it("the deploy gate answers allowed until a tier says otherwise", () => {
    const allowed: {
      type?: unknown;
      required?: boolean;
      defaultValue?: unknown;
      isDefaultValueColumn?: boolean;
      title?: string;
    } = slo.getTableColumnMetadata("deploymentsAllowed");

    expect(allowed.type).toBe(TableColumnType.Boolean);
    expect(allowed.required).toBe(true);
    expect(allowed.defaultValue).toBe(true);
    expect(allowed.isDefaultValueColumn).toBe(true);
    expect(allowed.title).toBe("Deployments Allowed");

    const frozenAt: { type?: unknown; required?: boolean } =
      slo.getTableColumnMetadata("deploymentsFrozenAt");

    expect(frozenAt.type).toBe(TableColumnType.Date);
    expect(frozenAt.required).toBeFalsy();
  });

  it("is a snapshot - an id, a name and an entry time - not a relation", () => {
    expect(
      slo.getTableColumnMetadata("currentErrorBudgetPolicyTierId").type,
    ).toBe(TableColumnType.ObjectID);
    expect(
      slo.getTableColumnMetadata("currentErrorBudgetPolicyTierName").type,
    ).toBe(TableColumnType.ShortText);
    expect(
      slo.getTableColumnMetadata("currentErrorBudgetPolicyTierEnteredAt").type,
    ).toBe(TableColumnType.Date);
    expect(slo.isTableColumn("currentErrorBudgetPolicyTier")).toBe(false);
  });
});
