import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Permission from "../../../Types/Permission";
import {
  ApiKeyPermissionCopyRow,
  ApiKeyPermissionCopyToCreate,
  ApiKeyRoleCopyPlan,
  getApiKeyCopyLabels,
  isRolePermissionGivenToApiKeys,
  planApiKeyRoleCopies,
  RoleGivenToApiKey,
  RolePermissionRow,
} from "../../../Types/Team/CustomRoleCopyPlan";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * THE COPIES A CUSTOM ROLE GIVEN TO AN API KEY SHOULD BE, AND THE CHANGES
 * THAT MAKE THEM SO.
 *
 * A key given a role holds one copy of each of the role's permissions that
 * gives a key anything (CustomRoleSync writes what planApiKeyRoleCopies
 * works out). Held here to:
 *
 *   - exactness: after the plan, every key holds exactly one copy of each
 *     permission of each role it was given, with the role's permission and
 *     labels - and nothing else of those roles;
 *   - nothing owned: a permission the role limits to what its holder owns
 *     gives a key nothing, so a key never holds a copy of one, and a copy
 *     made before the role limited it goes;
 *   - restraint: a copy that is already right is never deleted and made
 *     again, and a plan over copies that are right is empty;
 *   - order of safety: what the plan deletes is all a key held that its
 *     roles no longer give, so deleting first never leaves a key holding
 *     more than its roles give;
 *   - the keys it reports changed are exactly the keys it changes.
 *
 * Deterministic cases first, then thousands of generated ones from a seed.
 */

const id: (prefix: string, index: number) => string = (
  prefix: string,
  index: number,
): string => {
  const hex: string = index.toString(16).padStart(12, "0");
  const marker: string = {
    key: "1",
    role: "2",
    given: "3",
    row: "4",
    copy: "5",
    label: "6",
  }[prefix]!;
  return `${marker}0000000-0000-4000-8000-${hex}`;
};

const KEY_A: string = id("key", 1);
const KEY_B: string = id("key", 2);
const ROLE_1: string = id("role", 1);
const ROLE_2: string = id("role", 2);
const PRODUCTION: string = id("label", 1);
const STAGING: string = id("label", 2);

const given: (
  index: number,
  apiKeyId: string,
  customRoleId: string,
) => RoleGivenToApiKey = (
  index: number,
  apiKeyId: string,
  customRoleId: string,
): RoleGivenToApiKey => {
  return { id: id("given", index), apiKeyId, customRoleId };
};

const rolePermission: (
  index: number,
  customRoleId: string,
  permission: Permission,
  scope?: PermissionScope,
  labelIds?: Array<string>,
) => RolePermissionRow = (
  index: number,
  customRoleId: string,
  permission: Permission,
  scope?: PermissionScope,
  labelIds: Array<string> = [],
): RolePermissionRow => {
  return {
    id: id("row", index),
    customRoleId,
    permission,
    scope,
    labelIds,
  };
};

// The copy a role's permission becomes on a key, as the database would hold it.
const copyOf: (
  index: number,
  roleGiven: RoleGivenToApiKey,
  row: RolePermissionRow,
) => ApiKeyPermissionCopyRow = (
  index: number,
  roleGiven: RoleGivenToApiKey,
  row: RolePermissionRow,
): ApiKeyPermissionCopyRow => {
  return {
    id: id("copy", index),
    apiKeyId: roleGiven.apiKeyId,
    customRoleId: roleGiven.customRoleId,
    apiKeyCustomRoleId: roleGiven.id,
    customRolePermissionId: row.id,
    permission: row.permission,
    labelIds: getApiKeyCopyLabels(row) || [],
    isBlockPermission: false,
  };
};

// The copies a key holds after the plan is carried out: deletes, then creates.
const applyPlan: (
  copies: ReadonlyArray<ApiKeyPermissionCopyRow>,
  plan: ApiKeyRoleCopyPlan,
  nextIndex: number,
) => Array<ApiKeyPermissionCopyRow> = (
  copies: ReadonlyArray<ApiKeyPermissionCopyRow>,
  plan: ApiKeyRoleCopyPlan,
  nextIndex: number,
): Array<ApiKeyPermissionCopyRow> => {
  const deleted: Set<string> = new Set<string>(plan.toDelete);
  const kept: Array<ApiKeyPermissionCopyRow> = copies.filter(
    (copy: ApiKeyPermissionCopyRow): boolean => {
      return !deleted.has(copy.id);
    },
  );

  return [
    ...kept,
    ...plan.toCreate.map(
      (
        created: ApiKeyPermissionCopyToCreate,
        index: number,
      ): ApiKeyPermissionCopyRow => {
        return {
          id: id("copy", nextIndex + index),
          apiKeyId: created.apiKeyId,
          customRoleId: created.customRoleId,
          apiKeyCustomRoleId: created.apiKeyCustomRoleId,
          customRolePermissionId: created.customRolePermissionId,
          permission: created.permission,
          labelIds: created.labelIds,
          isBlockPermission: false,
        };
      },
    ),
  ];
};

// What a set of copies gives, as one comparable line per copy.
const describeCopies: (
  copies: ReadonlyArray<ApiKeyPermissionCopyRow>,
) => Array<string> = (
  copies: ReadonlyArray<ApiKeyPermissionCopyRow>,
): Array<string> => {
  return copies
    .map((copy: ApiKeyPermissionCopyRow): string => {
      // As the database compares them: ids in any case.
      return [
        (copy.apiKeyId || "").toLowerCase(),
        (copy.customRoleId || "").toLowerCase(),
        (copy.apiKeyCustomRoleId || "").toLowerCase(),
        (copy.customRolePermissionId || "").toLowerCase(),
        copy.permission,
        copy.labelIds
          .map((labelId: string): string => {
            return labelId.toLowerCase();
          })
          .sort()
          .join("+"),
        copy.isBlockPermission ? "block" : "allow",
      ].join("|");
    })
    .sort();
};

/*
 * What the roles call for: one line per (role given to a key) x (permission
 * of that role that gives a key anything).
 */
const describeWanted: (
  rolesGivenToApiKeys: ReadonlyArray<RoleGivenToApiKey>,
  rolePermissions: ReadonlyArray<RolePermissionRow>,
) => Array<string> = (
  rolesGivenToApiKeys: ReadonlyArray<RoleGivenToApiKey>,
  rolePermissions: ReadonlyArray<RolePermissionRow>,
): Array<string> => {
  const wanted: Array<ApiKeyPermissionCopyRow> = [];

  for (const roleGiven of rolesGivenToApiKeys) {
    for (const row of rolePermissions) {
      if (
        row.customRoleId === roleGiven.customRoleId &&
        row.scope !== PermissionScope.Owned
      ) {
        wanted.push(copyOf(0, roleGiven, row));
      }
    }
  }

  return describeCopies(wanted);
};

describe("which permissions of a role an API key holds", () => {
  test("every scope but Owned gives a key something", () => {
    expect(isRolePermissionGivenToApiKeys(PermissionScope.All)).toBe(true);
    expect(isRolePermissionGivenToApiKeys(PermissionScope.Labels)).toBe(true);
    expect(isRolePermissionGivenToApiKeys(undefined)).toBe(true);
    expect(isRolePermissionGivenToApiKeys(null)).toBe(true);
    expect(isRolePermissionGivenToApiKeys("")).toBe(true);
    expect(isRolePermissionGivenToApiKeys(PermissionScope.Owned)).toBe(false);
    expect(isRolePermissionGivenToApiKeys("Owned")).toBe(false);
  });

  test("a copy has no labels for the whole project, the role's for Labels, and is not made for Owned", () => {
    expect(
      getApiKeyCopyLabels(
        rolePermission(
          1,
          ROLE_1,
          Permission.IncidentMember,
          PermissionScope.All,
        ),
      ),
    ).toEqual([]);
    expect(
      getApiKeyCopyLabels(
        rolePermission(2, ROLE_1, Permission.IncidentMember, undefined),
      ),
    ).toEqual([]);
    expect(
      getApiKeyCopyLabels(
        rolePermission(
          3,
          ROLE_1,
          Permission.MonitorViewer,
          PermissionScope.Labels,
          [STAGING.toUpperCase(), PRODUCTION, PRODUCTION],
        ),
      ),
    ).toEqual([PRODUCTION, STAGING].sort());
    // Labels left on a row whose scope is not Labels never reach a copy.
    expect(
      getApiKeyCopyLabels(
        rolePermission(
          4,
          ROLE_1,
          Permission.MonitorViewer,
          PermissionScope.All,
          [PRODUCTION],
        ),
      ),
    ).toEqual([]);
    expect(
      getApiKeyCopyLabels(
        rolePermission(
          5,
          ROLE_1,
          Permission.AlertMember,
          PermissionScope.Owned,
          [PRODUCTION],
        ),
      ),
    ).toBeNull();
  });
});

describe("planApiKeyRoleCopies", () => {
  test("a role given to a key becomes one copy of each of its permissions a key can hold", () => {
    const roleGiven: RoleGivenToApiKey = given(1, KEY_A, ROLE_1);
    const rows: Array<RolePermissionRow> = [
      rolePermission(1, ROLE_1, Permission.IncidentMember, PermissionScope.All),
      rolePermission(
        2,
        ROLE_1,
        Permission.MonitorViewer,
        PermissionScope.Labels,
        [PRODUCTION],
      ),
      rolePermission(3, ROLE_1, Permission.AlertMember, PermissionScope.Owned),
    ];

    const plan: ApiKeyRoleCopyPlan = planApiKeyRoleCopies({
      rolesGivenToApiKeys: [roleGiven],
      rolePermissions: rows,
      copies: [],
    });

    expect(plan.toDelete).toEqual([]);
    expect(plan.toCreate).toEqual([
      {
        apiKeyId: KEY_A,
        customRoleId: ROLE_1,
        apiKeyCustomRoleId: roleGiven.id,
        customRolePermissionId: rows[0]!.id,
        permission: Permission.IncidentMember,
        labelIds: [],
      },
      {
        apiKeyId: KEY_A,
        customRoleId: ROLE_1,
        apiKeyCustomRoleId: roleGiven.id,
        customRolePermissionId: rows[1]!.id,
        permission: Permission.MonitorViewer,
        labelIds: [PRODUCTION],
      },
    ]);
    expect(plan.changedApiKeyIds).toEqual([KEY_A]);
  });

  test("a role made only of permissions limited to what is owned gives a key nothing", () => {
    const plan: ApiKeyRoleCopyPlan = planApiKeyRoleCopies({
      rolesGivenToApiKeys: [given(1, KEY_A, ROLE_1)],
      rolePermissions: [
        rolePermission(
          1,
          ROLE_1,
          Permission.IncidentMember,
          PermissionScope.Owned,
        ),
        rolePermission(
          2,
          ROLE_1,
          Permission.AlertMember,
          PermissionScope.Owned,
        ),
      ],
      copies: [],
    });

    expect(plan).toEqual({ toDelete: [], toCreate: [], changedApiKeyIds: [] });
  });

  test("copies that are right are left alone, and the plan is empty", () => {
    const roleGiven: RoleGivenToApiKey = given(1, KEY_A, ROLE_1);
    const rows: Array<RolePermissionRow> = [
      rolePermission(1, ROLE_1, Permission.IncidentMember, PermissionScope.All),
      rolePermission(
        2,
        ROLE_1,
        Permission.MonitorViewer,
        PermissionScope.Labels,
        [PRODUCTION, STAGING],
      ),
    ];

    expect(
      planApiKeyRoleCopies({
        rolesGivenToApiKeys: [roleGiven],
        rolePermissions: rows,
        copies: [
          copyOf(1, roleGiven, rows[0]!),
          copyOf(2, roleGiven, rows[1]!),
        ],
      }),
    ).toEqual({ toDelete: [], toCreate: [], changedApiKeyIds: [] });
  });

  test("a role taken from a key takes its copies with it, and only from that key", () => {
    const fromA: RoleGivenToApiKey = given(1, KEY_A, ROLE_1);
    const fromB: RoleGivenToApiKey = given(2, KEY_B, ROLE_1);
    const row: RolePermissionRow = rolePermission(
      1,
      ROLE_1,
      Permission.IncidentMember,
    );

    // Key A's hold of the role is gone; its copy is still there.
    const plan: ApiKeyRoleCopyPlan = planApiKeyRoleCopies({
      rolesGivenToApiKeys: [fromB],
      rolePermissions: [row],
      copies: [copyOf(1, fromA, row), copyOf(2, fromB, row)],
    });

    expect(plan.toDelete).toEqual([id("copy", 1)]);
    expect(plan.toCreate).toEqual([]);
    expect(plan.changedApiKeyIds).toEqual([KEY_A]);
  });

  test("a permission the role comes to limit to what is owned is taken from every key", () => {
    const roleGiven: RoleGivenToApiKey = given(1, KEY_A, ROLE_1);
    const before: RolePermissionRow = rolePermission(
      1,
      ROLE_1,
      Permission.IncidentMember,
      PermissionScope.All,
    );
    const after: RolePermissionRow = {
      ...before,
      scope: PermissionScope.Owned,
    };

    const plan: ApiKeyRoleCopyPlan = planApiKeyRoleCopies({
      rolesGivenToApiKeys: [roleGiven],
      rolePermissions: [after],
      copies: [copyOf(1, roleGiven, before)],
    });

    expect(plan.toDelete).toEqual([id("copy", 1)]);
    expect(plan.toCreate).toEqual([]);
    expect(plan.changedApiKeyIds).toEqual([KEY_A]);
  });

  test("a permission the role no longer limits to what is owned reaches every key", () => {
    const roleGiven: RoleGivenToApiKey = given(1, KEY_A, ROLE_1);
    const row: RolePermissionRow = rolePermission(
      1,
      ROLE_1,
      Permission.IncidentMember,
      PermissionScope.All,
    );

    const plan: ApiKeyRoleCopyPlan = planApiKeyRoleCopies({
      rolesGivenToApiKeys: [roleGiven],
      rolePermissions: [row],
      copies: [],
    });

    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0]!.permission).toBe(Permission.IncidentMember);
    expect(plan.toCreate[0]!.labelIds).toEqual([]);
  });

  test("a changed label list or permission is deleted and made again", () => {
    const roleGiven: RoleGivenToApiKey = given(1, KEY_A, ROLE_1);
    const before: RolePermissionRow = rolePermission(
      1,
      ROLE_1,
      Permission.MonitorViewer,
      PermissionScope.Labels,
      [PRODUCTION],
    );

    // Labels changed.
    const relabelled: RolePermissionRow = {
      ...before,
      labelIds: [STAGING],
    };
    const relabelPlan: ApiKeyRoleCopyPlan = planApiKeyRoleCopies({
      rolesGivenToApiKeys: [roleGiven],
      rolePermissions: [relabelled],
      copies: [copyOf(1, roleGiven, before)],
    });
    expect(relabelPlan.toDelete).toEqual([id("copy", 1)]);
    expect(relabelPlan.toCreate).toEqual([
      expect.objectContaining({
        permission: Permission.MonitorViewer,
        labelIds: [STAGING],
      }),
    ]);

    // Widened to the whole project.
    const widened: RolePermissionRow = {
      ...before,
      scope: PermissionScope.All,
      labelIds: [],
    };
    const widenPlan: ApiKeyRoleCopyPlan = planApiKeyRoleCopies({
      rolesGivenToApiKeys: [roleGiven],
      rolePermissions: [widened],
      copies: [copyOf(1, roleGiven, before)],
    });
    expect(widenPlan.toDelete).toEqual([id("copy", 1)]);
    expect(widenPlan.toCreate).toEqual([
      expect.objectContaining({
        permission: Permission.MonitorViewer,
        labelIds: [],
      }),
    ]);

    // Another permission.
    const changed: RolePermissionRow = {
      ...before,
      permission: Permission.MonitorAdmin,
    };
    const changePlan: ApiKeyRoleCopyPlan = planApiKeyRoleCopies({
      rolesGivenToApiKeys: [roleGiven],
      rolePermissions: [changed],
      copies: [copyOf(1, roleGiven, before)],
    });
    expect(changePlan.toDelete).toEqual([id("copy", 1)]);
    expect(changePlan.toCreate).toEqual([
      expect.objectContaining({
        permission: Permission.MonitorAdmin,
        labelIds: [PRODUCTION],
      }),
    ]);
  });

  test("labels in another order, or another case, are the same labels", () => {
    const roleGiven: RoleGivenToApiKey = given(1, KEY_A, ROLE_1);
    const row: RolePermissionRow = rolePermission(
      1,
      ROLE_1,
      Permission.MonitorViewer,
      PermissionScope.Labels,
      [PRODUCTION, STAGING],
    );
    const copy: ApiKeyPermissionCopyRow = {
      ...copyOf(1, roleGiven, row),
      labelIds: [STAGING.toUpperCase(), PRODUCTION],
    };

    expect(
      planApiKeyRoleCopies({
        rolesGivenToApiKeys: [roleGiven],
        rolePermissions: [row],
        copies: [copy],
      }),
    ).toEqual({ toDelete: [], toCreate: [], changedApiKeyIds: [] });
  });

  test("labels left on a copy that should have none make it another copy", () => {
    const roleGiven: RoleGivenToApiKey = given(1, KEY_A, ROLE_1);
    const row: RolePermissionRow = rolePermission(
      1,
      ROLE_1,
      Permission.MonitorViewer,
      PermissionScope.All,
    );
    const copy: ApiKeyPermissionCopyRow = {
      ...copyOf(1, roleGiven, row),
      labelIds: [PRODUCTION],
    };

    const plan: ApiKeyRoleCopyPlan = planApiKeyRoleCopies({
      rolesGivenToApiKeys: [roleGiven],
      rolePermissions: [row],
      copies: [copy],
    });

    expect(plan.toDelete).toEqual([copy.id]);
    expect(plan.toCreate).toEqual([expect.objectContaining({ labelIds: [] })]);
  });

  test("a second copy of the same one goes, and the first stays", () => {
    const roleGiven: RoleGivenToApiKey = given(1, KEY_A, ROLE_1);
    const row: RolePermissionRow = rolePermission(
      1,
      ROLE_1,
      Permission.IncidentMember,
    );

    const plan: ApiKeyRoleCopyPlan = planApiKeyRoleCopies({
      rolesGivenToApiKeys: [roleGiven],
      rolePermissions: [row],
      copies: [copyOf(1, roleGiven, row), copyOf(2, roleGiven, row)],
    });

    expect(plan.toDelete).toEqual([id("copy", 2)]);
    expect(plan.toCreate).toEqual([]);
    expect(plan.changedApiKeyIds).toEqual([KEY_A]);
  });

  test("a copy that is a block, or names no role given to a key, or no permission of the role, is never kept", () => {
    const roleGiven: RoleGivenToApiKey = given(1, KEY_A, ROLE_1);
    const row: RolePermissionRow = rolePermission(
      1,
      ROLE_1,
      Permission.IncidentMember,
    );

    const asBlock: ApiKeyPermissionCopyRow = {
      ...copyOf(1, roleGiven, row),
      isBlockPermission: true,
    };
    const noGrant: ApiKeyPermissionCopyRow = {
      ...copyOf(2, roleGiven, row),
      apiKeyCustomRoleId: null,
    };
    const noRow: ApiKeyPermissionCopyRow = {
      ...copyOf(3, roleGiven, row),
      customRolePermissionId: id("row", 99),
    };
    const otherKey: ApiKeyPermissionCopyRow = {
      ...copyOf(4, roleGiven, row),
      apiKeyId: KEY_B,
    };
    const otherRole: ApiKeyPermissionCopyRow = {
      ...copyOf(5, roleGiven, row),
      customRoleId: ROLE_2,
    };

    const plan: ApiKeyRoleCopyPlan = planApiKeyRoleCopies({
      rolesGivenToApiKeys: [roleGiven],
      rolePermissions: [row],
      copies: [asBlock, noGrant, noRow, otherKey, otherRole],
    });

    expect(plan.toDelete.sort()).toEqual(
      [asBlock.id, noGrant.id, noRow.id, otherKey.id, otherRole.id].sort(),
    );
    // The one right copy is made afresh.
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.changedApiKeyIds.sort()).toEqual([KEY_A, KEY_B].sort());
  });

  test("a role with no permissions gives nothing, and takes what its copies were", () => {
    const roleGiven: RoleGivenToApiKey = given(1, KEY_A, ROLE_1);
    const row: RolePermissionRow = rolePermission(
      1,
      ROLE_1,
      Permission.IncidentMember,
    );

    const plan: ApiKeyRoleCopyPlan = planApiKeyRoleCopies({
      rolesGivenToApiKeys: [roleGiven],
      rolePermissions: [],
      copies: [copyOf(1, roleGiven, row)],
    });

    expect(plan.toDelete).toEqual([id("copy", 1)]);
    expect(plan.toCreate).toEqual([]);
  });

  test("two roles on one key are kept apart, even when they hold the same permission", () => {
    const first: RoleGivenToApiKey = given(1, KEY_A, ROLE_1);
    const second: RoleGivenToApiKey = given(2, KEY_A, ROLE_2);
    const rowOfFirst: RolePermissionRow = rolePermission(
      1,
      ROLE_1,
      Permission.IncidentMember,
    );
    const rowOfSecond: RolePermissionRow = rolePermission(
      2,
      ROLE_2,
      Permission.IncidentMember,
    );

    const plan: ApiKeyRoleCopyPlan = planApiKeyRoleCopies({
      rolesGivenToApiKeys: [first, second],
      rolePermissions: [rowOfFirst, rowOfSecond],
      copies: [copyOf(1, first, rowOfFirst)],
    });

    expect(plan.toDelete).toEqual([]);
    expect(plan.toCreate).toEqual([
      expect.objectContaining({
        apiKeyCustomRoleId: second.id,
        customRolePermissionId: rowOfSecond.id,
        permission: Permission.IncidentMember,
      }),
    ]);
  });

  test("ids are compared as text in any case", () => {
    const roleGiven: RoleGivenToApiKey = given(1, KEY_A, ROLE_1);
    const row: RolePermissionRow = rolePermission(
      1,
      ROLE_1,
      Permission.IncidentMember,
    );
    const copy: ApiKeyPermissionCopyRow = {
      ...copyOf(1, roleGiven, row),
      apiKeyId: KEY_A.toUpperCase(),
      customRoleId: ROLE_1.toUpperCase(),
      apiKeyCustomRoleId: roleGiven.id.toUpperCase(),
      customRolePermissionId: row.id.toUpperCase(),
    };

    expect(
      planApiKeyRoleCopies({
        rolesGivenToApiKeys: [roleGiven],
        rolePermissions: [row],
        copies: [copy],
      }),
    ).toEqual({ toDelete: [], toCreate: [], changedApiKeyIds: [] });
  });

  describe("on generated roles, keys and copies", () => {
    const PERMISSIONS: Array<Permission> = [
      Permission.IncidentMember,
      Permission.AlertViewer,
      Permission.MonitorViewer,
      Permission.ReadProjectIncident,
      Permission.ProjectAdmin,
    ];
    const SCOPES: Array<PermissionScope | undefined> = [
      PermissionScope.All,
      PermissionScope.Owned,
      PermissionScope.Labels,
      undefined,
    ];
    const LABELS: Array<string> = [1, 2, 3].map((index: number): string => {
      return id("label", index);
    });

    interface World {
      rolesGivenToApiKeys: Array<RoleGivenToApiKey>;
      rolePermissions: Array<RolePermissionRow>;
      copies: Array<ApiKeyPermissionCopyRow>;
    }

    const pick: <T>(items: ReadonlyArray<T>, random: SeededRandom) => T = <T>(
      items: ReadonlyArray<T>,
      random: SeededRandom,
    ): T => {
      return items[random(items.length)]!;
    };

    const someLabels: (random: SeededRandom) => Array<string> = (
      random: SeededRandom,
    ): Array<string> => {
      return LABELS.filter((): boolean => {
        return random() < 0.5;
      });
    };

    // A world as the database could hold it: roles given, rows, and copies right, stale or stray.
    const generateWorld: (random: SeededRandom) => World = (
      random: SeededRandom,
    ): World => {
      const keys: Array<string> = [1, 2, 3, 4].map((index: number): string => {
        return id("key", index);
      });
      const roles: Array<string> = [1, 2, 3].map((index: number): string => {
        return id("role", index);
      });

      const rolesGivenToApiKeys: Array<RoleGivenToApiKey> = [];
      let givenIndex: number = 0;

      for (const key of keys) {
        for (const role of roles) {
          if (random() < 0.45) {
            givenIndex += 1;
            rolesGivenToApiKeys.push(given(givenIndex, key, role));
          }
        }
      }

      const rolePermissions: Array<RolePermissionRow> = [];
      let rowIndex: number = 0;

      for (const role of roles) {
        const count: number = random(4);

        for (let index: number = 0; index < count; index++) {
          rowIndex += 1;
          const scope: PermissionScope | undefined = pick(SCOPES, random);
          rolePermissions.push(
            rolePermission(
              rowIndex,
              role,
              pick(PERMISSIONS, random),
              scope,
              scope === PermissionScope.Labels
                ? [pick(LABELS, random), ...someLabels(random)]
                : random() < 0.2
                  ? someLabels(random)
                  : [],
            ),
          );
        }
      }

      const copies: Array<ApiKeyPermissionCopyRow> = [];
      let copyIndex: number = 0;

      // Right copies, some of them twice, some missing - and some of Owned ones, made before.
      for (const roleGiven of rolesGivenToApiKeys) {
        for (const row of rolePermissions) {
          if (row.customRoleId !== roleGiven.customRoleId) {
            continue;
          }

          const times: number = pick([0, 1, 1, 1, 2], random);

          for (let index: number = 0; index < times; index++) {
            copyIndex += 1;
            copies.push(copyOf(copyIndex, roleGiven, row));
          }
        }
      }

      // Stale and stray ones: other labels, a role taken away, a block.
      const strays: number = random(5);

      for (let index: number = 0; index < strays; index++) {
        copyIndex += 1;
        const row: RolePermissionRow | undefined =
          rolePermissions.length > 0
            ? pick(rolePermissions, random)
            : undefined;
        const roleGiven: RoleGivenToApiKey =
          rolesGivenToApiKeys.length > 0 && random() < 0.7
            ? pick(rolesGivenToApiKeys, random)
            : given(900 + index, pick(keys, random), pick(roles, random));

        copies.push({
          id: id("copy", copyIndex),
          apiKeyId: roleGiven.apiKeyId,
          customRoleId: roleGiven.customRoleId,
          apiKeyCustomRoleId: roleGiven.id,
          customRolePermissionId: row ? row.id : id("row", 800 + index),
          permission: pick(PERMISSIONS, random),
          labelIds: someLabels(random),
          isBlockPermission: random() < 0.15,
        });
      }

      return { rolesGivenToApiKeys, rolePermissions, copies };
    };

    test("after the plan every key holds exactly what its roles give it, and a second plan is empty", () => {
      const random: SeededRandom = seededRandom(14142);

      for (let run: number = 0; run < 2000; run++) {
        const world: World = generateWorld(random);
        const plan: ApiKeyRoleCopyPlan = planApiKeyRoleCopies(world);
        const after: Array<ApiKeyPermissionCopyRow> = applyPlan(
          world.copies,
          plan,
          10000,
        );

        // Exactly what the roles call for, once each.
        expect(describeCopies(after)).toEqual(
          describeWanted(world.rolesGivenToApiKeys, world.rolePermissions),
        );

        // Nothing deleted twice, and only rows that were there.
        const copyIds: Set<string> = new Set<string>(
          world.copies.map((copy: ApiKeyPermissionCopyRow): string => {
            return copy.id;
          }),
        );
        expect(new Set<string>(plan.toDelete).size).toBe(plan.toDelete.length);
        for (const deleted of plan.toDelete) {
          expect(copyIds.has(deleted)).toBe(true);
        }

        // Done: planning again changes nothing.
        expect(
          planApiKeyRoleCopies({
            rolesGivenToApiKeys: world.rolesGivenToApiKeys,
            rolePermissions: world.rolePermissions,
            copies: after,
          }),
        ).toEqual({ toDelete: [], toCreate: [], changedApiKeyIds: [] });
      }
    });

    test("no key ever holds a copy of a permission limited to what is owned", () => {
      const random: SeededRandom = seededRandom(17320);

      for (let run: number = 0; run < 2000; run++) {
        const world: World = generateWorld(random);
        const plan: ApiKeyRoleCopyPlan = planApiKeyRoleCopies(world);
        const ownedRowIds: Set<string> = new Set<string>(
          world.rolePermissions
            .filter((row: RolePermissionRow): boolean => {
              return row.scope === PermissionScope.Owned;
            })
            .map((row: RolePermissionRow): string => {
              return row.id;
            }),
        );

        for (const created of plan.toCreate) {
          expect(ownedRowIds.has(created.customRolePermissionId)).toBe(false);
        }

        for (const copy of applyPlan(world.copies, plan, 10000)) {
          expect(ownedRowIds.has(copy.customRolePermissionId || "")).toBe(
            false,
          );
        }
      }
    });

    test("a copy that is already right is never deleted", () => {
      const random: SeededRandom = seededRandom(22360);

      for (let run: number = 0; run < 2000; run++) {
        const world: World = generateWorld(random);
        const plan: ApiKeyRoleCopyPlan = planApiKeyRoleCopies(world);
        const deleted: Set<string> = new Set<string>(plan.toDelete);
        const wanted: Set<string> = new Set<string>(
          describeWanted(world.rolesGivenToApiKeys, world.rolePermissions),
        );
        const keptOnce: Set<string> = new Set<string>();

        for (const copy of world.copies) {
          const line: string = describeCopies([copy])[0]!;

          if (wanted.has(line) && !keptOnce.has(line)) {
            // The first right copy of each is kept.
            keptOnce.add(line);
            expect(deleted.has(copy.id)).toBe(false);
          }
        }

        // And nothing is made that a kept copy already gives.
        for (const created of plan.toCreate) {
          const line: string = describeCopies([
            {
              id: "new",
              ...created,
              isBlockPermission: false,
            },
          ])[0]!;
          expect(keptOnce.has(line)).toBe(false);
        }
      }
    });

    test("the keys reported changed are exactly the keys whose rows the plan touches", () => {
      const random: SeededRandom = seededRandom(26457);

      for (let run: number = 0; run < 2000; run++) {
        const world: World = generateWorld(random);
        const plan: ApiKeyRoleCopyPlan = planApiKeyRoleCopies(world);
        const deleted: Set<string> = new Set<string>(plan.toDelete);

        const touched: Set<string> = new Set<string>([
          ...world.copies
            .filter((copy: ApiKeyPermissionCopyRow): boolean => {
              return deleted.has(copy.id);
            })
            .map((copy: ApiKeyPermissionCopyRow): string => {
              return copy.apiKeyId.toLowerCase();
            }),
          ...plan.toCreate.map(
            (created: ApiKeyPermissionCopyToCreate): string => {
              return created.apiKeyId.toLowerCase();
            },
          ),
        ]);

        expect(
          plan.changedApiKeyIds
            .map((apiKeyId: string): string => {
              return apiKeyId.toLowerCase();
            })
            .sort(),
        ).toEqual(Array.from(touched).sort());
      }
    });

    test("deleting first never leaves a key holding more than its roles give", () => {
      const random: SeededRandom = seededRandom(31622);

      for (let run: number = 0; run < 2000; run++) {
        const world: World = generateWorld(random);
        const plan: ApiKeyRoleCopyPlan = planApiKeyRoleCopies(world);
        const deleted: Set<string> = new Set<string>(plan.toDelete);
        const wanted: Set<string> = new Set<string>(
          describeWanted(world.rolesGivenToApiKeys, world.rolePermissions),
        );

        // What is left between the deletes and the creates gives only what is wanted.
        for (const copy of world.copies) {
          if (!deleted.has(copy.id)) {
            expect(wanted.has(describeCopies([copy])[0]!)).toBe(true);
          }
        }
      }
    });
  });
});
