import Models from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RuleBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/RuleBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveLabelRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveLabelRule";
import ServiceLevelObjectiveOwnerRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerRule";
import ServiceLevelObjectiveOwnerTeam from "../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceLevelObjectiveOwnerUser from "../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import Services from "../../../Server/Services/Index";
import ServiceLevelObjectiveLabelRuleEngineService from "../../../Server/Services/ServiceLevelObjectiveLabelRuleEngineService";
import ServiceLevelObjectiveLabelRuleService from "../../../Server/Services/ServiceLevelObjectiveLabelRuleService";
import ServiceLevelObjectiveOwnerRuleEngineService from "../../../Server/Services/ServiceLevelObjectiveOwnerRuleEngineService";
import ServiceLevelObjectiveOwnerRuleService from "../../../Server/Services/ServiceLevelObjectiveOwnerRuleService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import RuleRunRegistry, {
  RuleRunDefinition,
} from "../../../Server/Utils/Rules/RuleRun/RuleRunRegistry";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Permission, {
  PermissionGroup,
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import {
  RuleRunAction,
  RuleRunType,
  RuleRunTypeUtil,
} from "../../../Types/Rules/RuleRun";
import RULE_CRITERIA_FIELDS_BY_MODEL, {
  getRuleCriteriaFieldsForModel,
} from "../../../Types/Rules/RuleCriteriaFieldRegistry";
import { LABEL_RULE_MODELS } from "../../../Utils/LabelRuleImportExport";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import type { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";

/*
 * SLO label rules and SLO owner rules, at the schema and registration level.
 *
 * Service and engine tests pass just as happily against a rule model nobody
 * can reach over the API, that the wrong role can write, whose join tables
 * drift from the migration, or that "Run now" never learned about. Every name
 * pinned here is also pinned by 1794100000000-AddSloLabelAndOwnerRules, the
 * dashboard pages and the criteria registry, so a rename fails here first.
 */

type ModelType = { new (): BaseModel };

const MODEL_TYPES: Array<ModelType> = Models as Array<ModelType>;
const PERMISSION_PROPS: Array<PermissionProps> =
  PermissionHelper.getAllPermissionProps();

const LEGACY_MATCH_FIELDS: Array<string> = [
  "serviceLevelObjectiveLabels",
  "serviceLevelObjectiveNamePattern",
  "serviceLevelObjectiveDescriptionPattern",
];

interface RuleModelCase {
  name: string;
  modelType: ModelType;
  route: string;
  singularName: string;
  pluralName: string;
  create: Permission;
  read: Permission;
  update: Permission;
  delete: Permission;
  labelJoinTable: string;
  ruleIdColumn: string;
}

const RULE_MODELS: Array<RuleModelCase> = [
  {
    name: "ServiceLevelObjectiveLabelRule",
    modelType: ServiceLevelObjectiveLabelRule,
    route: "/service-level-objective-label-rule",
    singularName: "SLO Label Rule",
    pluralName: "SLO Label Rules",
    create: Permission.CreateServiceLevelObjectiveLabelRule,
    read: Permission.ReadServiceLevelObjectiveLabelRule,
    update: Permission.EditServiceLevelObjectiveLabelRule,
    delete: Permission.DeleteServiceLevelObjectiveLabelRule,
    labelJoinTable: "ServiceLevelObjectiveLabelRuleServiceLevelObjectiveLabel",
    ruleIdColumn: "serviceLevelObjectiveLabelRuleId",
  },
  {
    name: "ServiceLevelObjectiveOwnerRule",
    modelType: ServiceLevelObjectiveOwnerRule,
    route: "/service-level-objective-owner-rule",
    singularName: "SLO Owner Rule",
    pluralName: "SLO Owner Rules",
    create: Permission.CreateServiceLevelObjectiveOwnerRule,
    read: Permission.ReadServiceLevelObjectiveOwnerRule,
    update: Permission.EditServiceLevelObjectiveOwnerRule,
    delete: Permission.DeleteServiceLevelObjectiveOwnerRule,
    labelJoinTable: "ServiceLevelObjectiveOwnerRuleServiceLevelObjectiveLabel",
    ruleIdColumn: "serviceLevelObjectiveOwnerRuleId",
  },
];

type JoinTableShapeFunction = (
  target: unknown,
  propertyName: string,
) => {
  name: string | undefined;
  joinColumn: string | undefined;
  inverseJoinColumn: string | undefined;
};

const joinTableShape: JoinTableShapeFunction = (
  target: unknown,
  propertyName: string,
): {
  name: string | undefined;
  joinColumn: string | undefined;
  inverseJoinColumn: string | undefined;
} => {
  const args: JoinTableMetadataArgs | undefined =
    getMetadataArgsStorage().joinTables.find(
      (joinTable: JoinTableMetadataArgs): boolean => {
        return (
          joinTable.target === target && joinTable.propertyName === propertyName
        );
      },
    );

  return {
    name: args?.name,
    joinColumn: args?.joinColumns?.[0]?.name,
    inverseJoinColumn: args?.inverseJoinColumns?.[0]?.name,
  };
};

describe.each(RULE_MODELS)("$name", (c: RuleModelCase) => {
  const model: BaseModel = new c.modelType();

  test("is in Models/Index.ts, so its table is created and its API mounted", () => {
    expect(MODEL_TYPES).toContain(c.modelType);
  });

  test("is served from its own CRUD route and table", () => {
    expect(model.getCrudApiPath()?.toString()).toBe(c.route);
    expect(model.tableName).toBe(c.name);
    expect(model.singularName).toBe(c.singularName);
    expect(model.pluralName).toBe(c.pluralName);

    // A duplicate route silently shadows another model's whole API.
    const claimants: Array<string> = MODEL_TYPES.filter(
      (candidate: ModelType): boolean => {
        return new candidate().getCrudApiPath()?.toString() === c.route;
      },
    ).map((candidate: ModelType): string => {
      return candidate.name;
    });

    expect(claimants).toEqual([c.name]);
  });

  test("is scoped to its project, not to one SLO", () => {
    expect(model.getTenantColumn()).toBe("projectId");
    // A project-wide rule decides which SLOs it reaches; it belongs to none.
    expect(model.getTableColumns().columns).not.toContain(
      "serviceLevelObjectiveId",
    );
  });

  test("is written only by owners, admins and its own permissions, and read like every rule", () => {
    expect(model.getCreatePermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      c.create,
    ]);
    expect(model.getUpdatePermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      c.update,
    ]);
    expect(model.getDeletePermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      c.delete,
    ]);
    expect(model.getReadPermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      c.read,
    ]);
  });

  test("has its four permissions, assignable to a team, in the SLO group", () => {
    for (const permission of [c.create, c.read, c.update, c.delete]) {
      const props: PermissionProps | undefined = PERMISSION_PROPS.find(
        (candidate: PermissionProps): boolean => {
          return candidate.permission === permission;
        },
      );

      expect(props).toBeDefined();
      expect(props!.group).toBe(PermissionGroup.SLO);
      expect(props!.isAssignableToTenant).toBe(true);
      expect(props!.isAccessControlPermission).toBe(false);
      expect(props!.title).toMatch(/^(Create|Read|Edit|Delete) SLO .* Rule$/);
      expect(props!.description.length).toBeGreaterThan(0);
    }
  });

  test("inherits the versioned criteria column, with the table's own access", () => {
    expect(model).toBeInstanceOf(RuleBaseModel);
    expect(model.getTableColumnMetadata("criteria").type).toBe(
      TableColumnType.JSON,
    );

    const criteriaAccess: ColumnAccessControl | undefined =
      model.getColumnAccessControlForAllColumns()["criteria"];

    expect(criteriaAccess?.create).toEqual(model.getCreatePermissions());
    expect(criteriaAccess?.read).toEqual(model.getReadPermissions());
    expect(criteriaAccess?.update).toEqual(model.getUpdatePermissions());
  });

  test("registers exactly its legacy match columns as criteria fields", () => {
    expect(getRuleCriteriaFieldsForModel(c.name)).toEqual(LEGACY_MATCH_FIELDS);

    for (const field of LEGACY_MATCH_FIELDS) {
      expect(model.getTableColumns().columns).toContain(field);
    }
  });

  test("matches on the SLO's labels through its own join table", () => {
    const metadata: TableColumnMetadata = model.getTableColumnMetadata(
      "serviceLevelObjectiveLabels",
    );

    expect(metadata.type).toBe(TableColumnType.EntityArray);
    expect(metadata.modelType).toBe(Label);
    expect(metadata.title).toBe("SLO Labels");
    expect(joinTableShape(c.modelType, "serviceLevelObjectiveLabels")).toEqual({
      name: c.labelJoinTable,
      joinColumn: c.ruleIdColumn,
      inverseJoinColumn: "labelId",
    });
    // Postgres truncates identifiers past 63 bytes.
    expect(c.labelJoinTable.length).toBeLessThanOrEqual(63);
  });

  test("matches on the SLO's name and description as long text patterns", () => {
    for (const [field, title] of [
      ["serviceLevelObjectiveNamePattern", "SLO Name Pattern"],
      ["serviceLevelObjectiveDescriptionPattern", "SLO Description Pattern"],
    ] as Array<[string, string]>) {
      const metadata: TableColumnMetadata = model.getTableColumnMetadata(field);

      expect(metadata.type).toBe(TableColumnType.LongText);
      expect(metadata.required).toBe(false);
      expect(metadata.title).toBe(title);
    }
  });

  test("is enabled by default", () => {
    expect(model.isDefaultValueColumn("isEnabled")).toBe(true);
    expect(model.getTableColumnMetadata("isEnabled").defaultValue).toBe(true);
  });

  test("can be run on existing SLOs", () => {
    const ruleType: RuleRunType | null = RuleRunTypeUtil.fromTableName(
      model.tableName,
    );

    expect(ruleType).toBe(c.name);
    expect(RuleRunTypeUtil.getMetadata(ruleType!)).toEqual({
      action:
        c.modelType === ServiceLevelObjectiveLabelRule
          ? RuleRunAction.AddLabels
          : RuleRunAction.AddOwners,
      resourceSingular: "SLO",
      resourcePlural: "SLOs",
    });
  });
});

describe("ServiceLevelObjectiveLabelRule's action", () => {
  test("attaches labels through its own join table", () => {
    const metadata: TableColumnMetadata =
      new ServiceLevelObjectiveLabelRule().getTableColumnMetadata(
        "labelsToAdd",
      );

    expect(metadata.type).toBe(TableColumnType.EntityArray);
    expect(metadata.modelType).toBe(Label);
    expect(
      joinTableShape(ServiceLevelObjectiveLabelRule, "labelsToAdd"),
    ).toEqual({
      name: "ServiceLevelObjectiveLabelRuleLabelToAdd",
      joinColumn: "serviceLevelObjectiveLabelRuleId",
      inverseJoinColumn: "labelId",
    });
  });

  test("can be exported and imported like every other label rule", () => {
    expect(LABEL_RULE_MODELS).toContain(ServiceLevelObjectiveLabelRule);
    // Only label rules travel as portable files.
    expect(LABEL_RULE_MODELS).not.toContain(ServiceLevelObjectiveOwnerRule);
  });
});

describe("ServiceLevelObjectiveOwnerRule's action", () => {
  const model: ServiceLevelObjectiveOwnerRule =
    new ServiceLevelObjectiveOwnerRule();

  test.each([
    ["ownerUsers", User, "ServiceLevelObjectiveOwnerRuleOwnerUser", "userId"],
    ["ownerTeams", Team, "ServiceLevelObjectiveOwnerRuleOwnerTeam", "teamId"],
  ])(
    "adds %s through its own join table",
    (
      column: string,
      relatedModel: unknown,
      joinTable: string,
      inverseJoinColumn: string,
    ) => {
      const metadata: TableColumnMetadata =
        model.getTableColumnMetadata(column);

      expect(metadata.type).toBe(TableColumnType.EntityArray);
      expect(metadata.modelType).toBe(relatedModel);
      expect(joinTableShape(ServiceLevelObjectiveOwnerRule, column)).toEqual({
        name: joinTable,
        joinColumn: "serviceLevelObjectiveOwnerRuleId",
        inverseJoinColumn: inverseJoinColumn,
      });
    },
  );

  // Owners added by a rule are notified unless the rule says otherwise.
  test("notifies the owners it adds by default", () => {
    expect(model.isDefaultValueColumn("notifyOwners")).toBe(true);
    expect(model.getTableColumnMetadata("notifyOwners").defaultValue).toBe(
      true,
    );
  });
});

describe("SLO label and owner rules are wired into Run Now", () => {
  test.each([
    [
      RuleRunType.ServiceLevelObjectiveLabelRule,
      ServiceLevelObjectiveLabelRule,
      ServiceLevelObjectiveLabelRuleService,
      ServiceLevelObjectiveLabelRuleEngineService,
      undefined,
    ],
    [
      RuleRunType.ServiceLevelObjectiveOwnerRule,
      ServiceLevelObjectiveOwnerRule,
      ServiceLevelObjectiveOwnerRuleService,
      ServiceLevelObjectiveOwnerRuleEngineService,
      [ServiceLevelObjectiveOwnerUser, ServiceLevelObjectiveOwnerTeam],
    ],
  ])(
    "%s walks the project's SLOs with its own engine",
    (
      ruleType: RuleRunType,
      ruleModelType: unknown,
      ruleService: unknown,
      engine: unknown,
      ownerModelTypes: unknown,
    ) => {
      const definition: RuleRunDefinition | null =
        RuleRunRegistry.getDefinition(ruleType);

      expect(definition).not.toBeNull();
      expect(definition!.ruleModelType).toBe(ruleModelType);
      expect(definition!.resourceModelType).toBe(ServiceLevelObjective);
      expect(definition!.ruleService).toBe(ruleService);
      expect(definition!.resourceService).toBe(ServiceLevelObjectiveService);
      expect(definition!.engine).toBe(engine);
      expect(definition!.ownerModelTypes).toEqual(ownerModelTypes);
      // Unlike the SLO monitor rule, these walk resources, not one SLO.
      expect(RuleRunRegistry.isSyncRuleRunType(ruleType)).toBe(false);
    },
  );

  test("both rule services are registered, so their APIs and jobs see them", () => {
    expect(Services).toContain(ServiceLevelObjectiveLabelRuleService);
    expect(Services).toContain(ServiceLevelObjectiveOwnerRuleService);
  });

  test("the criteria registry knows both rule models", () => {
    expect(Object.keys(RULE_CRITERIA_FIELDS_BY_MODEL)).toEqual(
      expect.arrayContaining([
        "ServiceLevelObjectiveLabelRule",
        "ServiceLevelObjectiveOwnerRule",
      ]),
    );
  });
});
