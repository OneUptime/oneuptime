import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OwnerTableRegistry from "../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import TEAM_OWNED_RULE_SERVICES from "../../../Server/Utils/Rules/TeamOwnedRuleServices";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { UniqueColumnsTogetherMetadata } from "../../../Types/Database/UniqueColumnsTogether";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import TeamOwnedRuleKinds, {
  ACTING_ON_EVERY_TEAM_OWNED_RULE,
  TEAM_OWNED_RULE_KINDS,
  TeamOwnedRuleKind,
} from "../../../Types/TeamOwnedRule/TeamOwnedRuleKinds";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";

/*
 * EVERY KIND OF RULE A TEAM CAN OWN, AS THE MODELS HAVE IT.
 *
 * The write rule (TeamOwnedRulePermission), the rule forms (RuleOwningTeams)
 * and the dashboard's locks read who owns a rule from TEAM_OWNED_RULE_KINDS
 * alone: a <Rule>OwningTeam table left out of it would hold nothing - its
 * rule changed by every team as if nobody owned it. This sweeps every model
 * and holds the list to them:
 *
 *   - every <Rule>OwningTeam model is a kind, and every kind's tables are
 *     models: the rule, and its owning teams naming it by the kind's key;
 *   - the owning-team rows are read through their rule, one team at most
 *     once per rule (in the database and before the write), and the team
 *     and the rule must be the project's (a ProjectReferencesService);
 *   - each kind has its four permissions, each described, in the group of
 *     its rule's own;
 *   - who may change an owning team is who may change the rule, plus the
 *     owning-team permissions;
 *   - none is an owner table of the Owned scope (OwnerTableRegistry).
 */

type ModelType = { new (): BaseModel };

const MODEL_TYPES: Array<ModelType> = AllModelTypes as Array<ModelType>;

const OWNING_TEAM_TABLE_NAME: RegExp = /^(.+)OwningTeam$/;

function modelNamed(name: string): ModelType | undefined {
  return MODEL_TYPES.find((modelType: ModelType): boolean => {
    return new modelType().tableName === name;
  });
}

const OWNING_TEAM_MODELS: Array<ModelType> = MODEL_TYPES.filter(
  (modelType: ModelType): boolean => {
    return OWNING_TEAM_TABLE_NAME.test(new modelType().tableName || "");
  },
);

const KINDS: Array<[string, TeamOwnedRuleKind]> = TEAM_OWNED_RULE_KINDS.map(
  (kind: TeamOwnedRuleKind): [string, TeamOwnedRuleKind] => {
    return [kind.tableName, kind];
  },
);

function permissionProps(permission: Permission): PermissionProps | undefined {
  return PermissionHelper.getAllPermissionProps().find(
    (props: PermissionProps): boolean => {
      return props.permission === permission;
    },
  );
}

describe("TEAM_OWNED_RULE_KINDS", () => {
  test("lists every owning-team model, and nothing else", () => {
    expect(OWNING_TEAM_MODELS.length).toBeGreaterThanOrEqual(6);

    expect(
      OWNING_TEAM_MODELS.map((modelType: ModelType): string => {
        return new modelType().tableName!;
      }).sort(),
    ).toEqual(
      TEAM_OWNED_RULE_KINDS.map((kind: TeamOwnedRuleKind): string => {
        return kind.owningTeamTable;
      }).sort(),
    );
  });

  test("names each kind once, with the scope's people acting on every rule", () => {
    const names: Array<string> = TEAM_OWNED_RULE_KINDS.map(
      (kind: TeamOwnedRuleKind): string => {
        return kind.tableName;
      },
    );

    expect(new Set(names).size).toBe(names.length);
    expect([...ACTING_ON_EVERY_TEAM_OWNED_RULE].sort()).toEqual(
      [Permission.ProjectAdmin, Permission.ProjectOwner].sort(),
    );
  });

  test("finds a kind by its rule's table and by its owning teams' table", () => {
    for (const kind of TEAM_OWNED_RULE_KINDS) {
      expect(TeamOwnedRuleKinds.getKindOfRule(kind.tableName)).toBe(kind);
      expect(
        TeamOwnedRuleKinds.getKindOfOwningTeams(kind.owningTeamTable),
      ).toBe(kind);
      expect(TeamOwnedRuleKinds.getKindOfRule(kind.owningTeamTable)).toBeNull();
    }

    expect(TeamOwnedRuleKinds.getKindOfRule("Incident")).toBeNull();
    expect(TeamOwnedRuleKinds.getKindOfRule(undefined)).toBeNull();
    expect(TeamOwnedRuleKinds.getKindOfOwningTeams(null)).toBeNull();
  });

  test("leaves the Owned scope's owner tables alone", () => {
    for (const kind of TEAM_OWNED_RULE_KINDS) {
      expect([kind.tableName, OwnerTableRegistry.has(kind.tableName)]).toEqual([
        kind.tableName,
        false,
      ]);
    }
  });
});

describe.each(KINDS)("%s", (_name: string, kind: TeamOwnedRuleKind) => {
  const ruleModelType: ModelType | undefined = modelNamed(kind.tableName);
  const owningTeamModelType: ModelType | undefined = modelNamed(
    kind.owningTeamTable,
  );

  test("its rule and its owning teams are models", () => {
    expect(ruleModelType).toBeDefined();
    expect(owningTeamModelType).toBeDefined();
  });

  test("its owning teams name the rule by the kind's key, and are read through it", () => {
    const owningTeam: BaseModel = new owningTeamModelType!();

    const relation: string | undefined = owningTeam
      .getTableColumns()
      .columns.find((column: string): boolean => {
        const metadata: TableColumnMetadata | undefined =
          owningTeam.getTableColumnMetadata(column);

        return Boolean(
          metadata &&
            metadata.type === TableColumnType.Entity &&
            metadata.modelType === ruleModelType,
        );
      });

    expect(relation).toBeDefined();
    expect(
      owningTeam.getTableColumnMetadata(relation!).manyToOneRelationColumn,
    ).toBe(kind.ruleKey);
    expect(owningTeam.getTableColumnMetadata(kind.ruleKey)?.type).toBe(
      TableColumnType.ObjectID,
    );
    expect(owningTeam.getTableColumnMetadata(kind.ruleKey)?.required).toBe(
      true,
    );
    expect(owningTeam.canAccessIfCanReadOn).toBe(relation);

    // The team, and the project the rows are tenants of.
    expect(owningTeam.getTableColumnMetadata("teamId")?.required).toBe(true);
    expect(owningTeam.getTenantColumn()).toBe("projectId");
  });

  test("holds a team to owning a rule once", () => {
    const columns: Array<string> = [kind.ruleKey, "teamId", "projectId"];

    const index: IndexMetadataArgs | undefined = getMetadataArgsStorage()
      .indices.filter((args: IndexMetadataArgs): boolean => {
        return args.target === owningTeamModelType;
      })
      .find((args: IndexMetadataArgs): boolean => {
        return (
          Boolean(args.unique) &&
          JSON.stringify(args.columns) === JSON.stringify(columns)
        );
      });

    expect(index).toBeDefined();

    const constraints: Array<UniqueColumnsTogetherMetadata> =
      new owningTeamModelType!().getUniqueColumnsTogether();

    expect(
      constraints.some((constraint: UniqueColumnsTogetherMetadata): boolean => {
        return (
          JSON.stringify(constraint.columnNames) === JSON.stringify(columns) &&
          constraint.errorMessage.length > 0
        );
      }),
    ).toBe(true);
  });

  test("keeps its owning teams with a service that checks the project's records", () => {
    const service: unknown = TEAM_OWNED_RULE_SERVICES[kind.owningTeamTable];

    expect(service).toBeDefined();
    expect(
      (service as { modelType: ModelType }).modelType === owningTeamModelType,
    ).toBe(true);
    expect(
      Object.getPrototypeOf(Object.getPrototypeOf(service)).constructor.name,
    ).toBe("ProjectReferencesService");
  });

  test("has its four permissions, described, in its rule's group", () => {
    const ruleRead: PermissionProps | undefined = permissionProps(
      `Read${kind.tableName}` as Permission,
    );

    expect(ruleRead).toBeDefined();

    for (const operation of ["Create", "Delete", "Edit", "Read"]) {
      const permission: Permission =
        `${operation}${kind.owningTeamTable}` as Permission;

      expect(Object.values(Permission)).toContain(permission);

      const props: PermissionProps | undefined = permissionProps(permission);

      expect([permission, Boolean(props)]).toEqual([permission, true]);
      expect(props!.title.length).toBeGreaterThan(10);
      expect(props!.description.length).toBeGreaterThan(30);
      expect(props!.group).toBe(ruleRead!.group);
      expect(props!.isAssignableToTenant).toBe(true);
    }
  });

  test("is changed by who may change the rule, and read by who may read it", () => {
    const rule: BaseModel = new ruleModelType!();
    const owningTeam: BaseModel = new owningTeamModelType!();

    const roles: (permissions: Array<Permission>) => Array<Permission> = (
      permissions: Array<Permission>,
    ): Array<Permission> => {
      // The roles, without the kind's own permissions.
      return permissions
        .filter((permission: Permission): boolean => {
          return !permission.toString().endsWith(kind.tableName);
        })
        .sort();
    };

    for (const [list, own] of [
      [owningTeam.createRecordPermissions, `Create${kind.owningTeamTable}`],
      [owningTeam.deleteRecordPermissions, `Delete${kind.owningTeamTable}`],
      [owningTeam.updateRecordPermissions, `Edit${kind.owningTeamTable}`],
    ] as Array<[Array<Permission>, string]>) {
      expect(list).toContain(own as Permission);
      expect(
        roles(
          list.filter((permission: Permission): boolean => {
            return permission !== own;
          }),
        ),
      ).toEqual(roles(rule.updateRecordPermissions));
    }

    expect(owningTeam.readRecordPermissions).toContain(
      `Read${kind.owningTeamTable}` as Permission,
    );
    expect(
      roles(
        owningTeam.readRecordPermissions.filter(
          (permission: Permission): boolean => {
            return permission !== `Read${kind.owningTeamTable}`;
          },
        ),
      ),
    ).toEqual(roles(rule.readRecordPermissions));
  });
});
