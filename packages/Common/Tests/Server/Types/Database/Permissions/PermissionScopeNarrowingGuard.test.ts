import QueryUtil from "../../../../../Server/Types/Database/QueryUtil";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import PermissionScopeNarrowing, {
  NarrowedBy,
} from "../../../../../Types/Database/AccessControl/PermissionScopeNarrowing";
import Permission, { PermissionHelper } from "../../../../../Types/Permission";
import {
  ScopeNarrowingFromModels,
  getScopeNarrowingFromModels,
} from "./ScopeNarrowingFromModels";
import { beforeAll, describe, expect, jest, test } from "@jest/globals";

/*
 * WHAT THE DASHBOARD SAYS A SCOPE NARROWS IS WHAT THE SERVER NARROWS
 * (Types/Database/AccessControl/PermissionScopeNarrowing).
 *
 * The dashboard offers a permission's scope - "Only resources they own",
 * "Only resources with certain labels" - from lists written down for it,
 * as it carries no server code. This works the lists out again from every
 * model, by the server's own rules (ScopeNarrowingFromModels), so a model
 * or a permission that changes what a scope narrows fails here, naming the
 * lines to change - and a dialog never offers a scope that narrows
 * nothing, nor hides one that would.
 */

const LISTS: Record<NarrowedBy, ReadonlyArray<Permission>> = {
  [NarrowedBy.LabelsAndOwners]:
    PermissionScopeNarrowing.NARROWED_BY_LABELS_AND_OWNERS,
  [NarrowedBy.Labels]: PermissionScopeNarrowing.NARROWED_BY_LABELS,
  [NarrowedBy.Owners]: PermissionScopeNarrowing.NARROWED_BY_OWNERS,
};

const LIST_NAMES: Record<NarrowedBy, string> = {
  [NarrowedBy.LabelsAndOwners]: "NARROWED_BY_LABELS_AND_OWNERS",
  [NarrowedBy.Labels]: "NARROWED_BY_LABELS",
  [NarrowedBy.Owners]: "NARROWED_BY_OWNERS",
};

/*
 * A permission as the file names it: its key in the enum. A few keys are
 * not their value (CreateMonitorOwnerUser is "CreateMonitorOwner").
 */
const KEY_OF_PERMISSION: Map<string, string> = new Map<string, string>(
  Object.entries(Permission).map(
    ([key, value]: [string, string]): [string, string] => {
      return [value, key];
    },
  ),
);

const named: (permission: Permission) => string = (
  permission: Permission,
): string => {
  return `Permission.${KEY_OF_PERMISSION.get(permission) || permission}`;
};

let fromModels: ScopeNarrowingFromModels;

// What the models say narrows `permission`.
const narrowedByModels: (permission: Permission) => NarrowedBy | null = (
  permission: Permission,
): NarrowedBy | null => {
  const labels: boolean = fromModels.byLabels.has(permission);
  const owners: boolean = fromModels.byOwners.has(permission);

  if (labels && owners) {
    return NarrowedBy.LabelsAndOwners;
  }

  if (labels) {
    return NarrowedBy.Labels;
  }

  return owners ? NarrowedBy.Owners : null;
};

beforeAll(() => {
  /*
   * The names of the label join tables come from the database's metadata,
   * which a test has none of. Whether labels narrow a model does not
   * depend on them: any name does.
   */
  jest.spyOn(QueryUtil, "getManyToManyRelationMetadata").mockImplementation(
    (
      modelType: { new (): BaseModel },
      column: string,
    ): {
      joinTableName: string;
      ownerColumnName: string;
      relationColumnName: string;
    } => {
      return {
        joinTableName: `${new modelType().tableName}${column}`,
        ownerColumnName: "ownerId",
        relationColumnName: "relatedId",
      };
    },
  );

  fromModels = getScopeNarrowingFromModels();
});

describe("PermissionScopeNarrowing holds what the server narrows", () => {
  test("every permission is listed under what narrows it, and nothing else is listed", () => {
    const changes: Array<string> = [];

    const everyPermission: Set<Permission> = new Set<Permission>([
      ...fromModels.byLabels,
      ...fromModels.byOwners,
      ...LISTS[NarrowedBy.LabelsAndOwners],
      ...LISTS[NarrowedBy.Labels],
      ...LISTS[NarrowedBy.Owners],
    ]);

    for (const permission of everyPermission) {
      const listed: NarrowedBy | null =
        PermissionScopeNarrowing.getNarrowedBy(permission);
      const actual: NarrowedBy | null = narrowedByModels(permission);

      if (listed === actual) {
        continue;
      }

      if (!actual) {
        changes.push(
          `remove ${named(permission)} from ${LIST_NAMES[listed!]}: no scope narrows it`,
        );
      } else if (!listed) {
        changes.push(`add ${named(permission)} to ${LIST_NAMES[actual]}`);
      } else {
        changes.push(
          `move ${named(permission)} from ${LIST_NAMES[listed]} to ${LIST_NAMES[actual]}`,
        );
      }
    }

    // Each line names one change to Types/Database/AccessControl/PermissionScopeNarrowing.ts.
    expect(changes.sort()).toEqual([]);
  });

  test("no permission is listed twice, within a list or across them", () => {
    const seen: Map<Permission, string> = new Map<Permission, string>();
    const twice: Array<string> = [];

    for (const narrowedBy of Object.values(NarrowedBy)) {
      for (const permission of LISTS[narrowedBy]) {
        const before: string | undefined = seen.get(permission);

        if (before) {
          twice.push(
            `${named(permission)} in ${before} and ${LIST_NAMES[narrowedBy]}`,
          );
        }

        seen.set(permission, LIST_NAMES[narrowedBy]);
      }
    }

    expect(twice).toEqual([]);
  });

  test.each(Object.values(NarrowedBy))(
    "%s is in alphabetical order, so a new line has one place to go",
    (narrowedBy: NarrowedBy) => {
      const list: Array<string> = LISTS[narrowedBy].map(named);

      expect(list).toEqual(
        [...list].sort((a: string, b: string): number => {
          return a.localeCompare(b, "en");
        }),
      );
    },
  );

  test("only what a team, a custom role or an API key can be given, and can be scoped, is listed", () => {
    const tenantPermissions: Set<Permission> = new Set<Permission>(
      PermissionHelper.getTenantPermissionProps().map(
        (props: { permission: Permission }): Permission => {
          return props.permission;
        },
      ),
    );

    for (const narrowedBy of Object.values(NarrowedBy)) {
      for (const permission of LISTS[narrowedBy]) {
        expect({
          permission,
          canBeGiven: tenantPermissions.has(permission),
          canBeScoped: PermissionHelper.isScopeApplicable(permission),
        }).toEqual({ permission, canBeGiven: true, canBeScoped: true });
      }
    }
  });
});

describe("the permissions issue #5602 was about", () => {
  test("Create Workflow, the permission the issue tried to scope, is narrowed by labels and by owners", () => {
    expect(narrowedByModels(Permission.CreateWorkflow)).toBe(
      NarrowedBy.LabelsAndOwners,
    );
    expect(
      PermissionScopeNarrowing.getScopes(Permission.CreateWorkflow),
    ).toEqual([
      PermissionScope.All,
      PermissionScope.Owned,
      PermissionScope.Labels,
    ]);
  });

  test.each([
    Permission.CreateOnCallDutyPolicyUserOverride,
    Permission.ReadOnCallDutyPolicyUserOverride,
    Permission.EditOnCallDutyPolicyUserOverride,
    Permission.DeleteOnCallDutyPolicyUserOverride,
  ])(
    "%s follows its policy: its labels and its owners narrow it (issue #5617)",
    (permission: Permission) => {
      expect(narrowedByModels(permission)).toBe(NarrowedBy.LabelsAndOwners);
      expect(PermissionScopeNarrowing.getNarrowedBy(permission)).toBe(
        NarrowedBy.LabelsAndOwners,
      );
    },
  );

  test("hundreds of permissions the server narrows were never offered a scope by the flag the dialog read", () => {
    const narrowedButUnflagged: Array<Permission> = Array.from(
      new Set<Permission>([...fromModels.byLabels, ...fromModels.byOwners]),
    ).filter((permission: Permission): boolean => {
      return (
        !PermissionHelper.getRolePermissionProps().some(
          (props: { permission: Permission }): boolean => {
            return props.permission === permission;
          },
        ) && !PermissionHelper.isAccessControlPermission(permission)
      );
    });

    expect(narrowedButUnflagged).toContain(Permission.CreateWorkflow);
    expect(narrowedButUnflagged.length).toBeGreaterThan(500);
  });

  test("a permission on what everyone shares - a team, a label - is narrowed by no scope", () => {
    for (const permission of [
      Permission.CreateProjectTeam,
      Permission.EditProjectTeam,
      Permission.CreateProjectLabel,
      Permission.ReadProjectLabel,
    ]) {
      expect({
        permission,
        narrowedBy: narrowedByModels(permission),
      }).toEqual({ permission, narrowedBy: null });
      expect(PermissionScopeNarrowing.getScopes(permission)).toEqual([
        PermissionScope.All,
      ]);
    }
  });

  test("a network site type, which the flag marked, carries no labels and has no owners: no scope narrows it", () => {
    expect(
      PermissionHelper.isAccessControlPermission(
        Permission.ReadNetworkSiteType,
      ),
    ).toBe(true);
    expect(narrowedByModels(Permission.ReadNetworkSiteType)).toBeNull();
    expect(
      PermissionScopeNarrowing.isNarrowedByAnyScope(
        Permission.ReadNetworkSiteType,
      ),
    ).toBe(false);
  });

  test("the roles that reach the whole project by definition are listed nowhere, though every model names them", () => {
    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SettingsAdmin,
      Permission.BillingAdmin,
    ]) {
      expect(PermissionScopeNarrowing.getNarrowedBy(permission)).toBeNull();
    }
  });

  test("an operational resource's wildcard is narrowed as the resources it opens are", () => {
    expect(
      PermissionScopeNarrowing.getNarrowedBy(
        Permission.ReadAllOperationalResources,
      ),
    ).toBe(NarrowedBy.LabelsAndOwners);
  });
});
