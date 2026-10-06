import { describe, expect, test } from "@jest/globals";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../Types/HeldPermissions";
import Permission, { UserPermission } from "../../Types/Permission";
import PermissionScope from "../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../Types/ObjectID";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";

/*
 * The one rule every "does the caller hold this?" check follows, on the
 * server and in the dashboard: an allow row grants, a block row never does,
 * a block with no labels on any permission an action accepts refuses it, a
 * block with labels only restricts the records carrying them, and an
 * operational resource's own list accepts its *AllOperationalResources
 * wildcard - unless the wildcard is blocked.
 */

const LABEL: ObjectID = new ObjectID("6f1d6c39-0a8e-4f4a-9e43-0d8d4fb0a001");

type RowFunction = (
  permission: Permission,
  options?: {
    isBlock?: boolean | undefined;
    labelled?: boolean | undefined;
    scope?: PermissionScope | undefined;
  },
) => UserPermission;

const row: RowFunction = (
  permission: Permission,
  options?: {
    isBlock?: boolean | undefined;
    labelled?: boolean | undefined;
    scope?: PermissionScope | undefined;
  },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: options?.labelled ? [LABEL] : [],
    isBlockPermission: Boolean(options?.isBlock),
    ...(options?.scope ? { scope: options.scope } : {}),
  };
};

type HeldFunction = (rows: Array<UserPermission>) => HeldPermissions;

const held: HeldFunction = (rows: Array<UserPermission>): HeldPermissions => {
  return HeldPermissionsUtil.fromRows({ rows: rows });
};

describe("HeldPermissionsUtil.isBlockRow", () => {
  test("a row is a block only when it says so", () => {
    expect(
      HeldPermissionsUtil.isBlockRow(
        row(Permission.ReadProjectMonitor, { isBlock: true }),
      ),
    ).toBe(true);
    expect(
      HeldPermissionsUtil.isBlockRow(row(Permission.ReadProjectMonitor)),
    ).toBe(false);

    const legacyRow: UserPermission = row(Permission.ReadProjectMonitor);
    delete (legacyRow as Partial<UserPermission>).isBlockPermission;

    expect(HeldPermissionsUtil.isBlockRow(legacyRow)).toBe(false);
    expect(HeldPermissionsUtil.isAllowRow(legacyRow)).toBe(true);
  });

  test("reads the flag the way the CRUD path splits the rows", () => {
    const projectId: ObjectID = ObjectID.generate();
    const rows: Array<UserPermission> = [
      row(Permission.ReadProjectMonitor),
      row(Permission.EditProjectMonitor, { isBlock: true }),
      row(Permission.DeleteProjectMonitor, { isBlock: true, labelled: true }),
    ];
    const props: DatabaseCommonInteractionProps = {
      tenantId: projectId,
      userTenantAccessPermission: {
        [projectId.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: projectId,
          permissions: rows,
        },
      },
    };

    const allows: Array<Permission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Allow,
      ).map((userPermission: UserPermission) => {
        return userPermission.permission;
      });

    const blocks: Array<Permission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Block,
      ).map((userPermission: UserPermission) => {
        return userPermission.permission;
      });

    const rule: HeldPermissions = held(rows);

    expect(allows).toContain(Permission.ReadProjectMonitor);
    expect(allows).not.toContain(Permission.EditProjectMonitor);
    expect(blocks.sort()).toEqual(
      [Permission.DeleteProjectMonitor, Permission.EditProjectMonitor].sort(),
    );
    expect(rule.allowed).toEqual([Permission.ReadProjectMonitor]);
    expect(rule.blocked).toEqual([Permission.EditProjectMonitor]);
    expect(rule.blockedForSomeLabels).toEqual([
      Permission.DeleteProjectMonitor,
    ]);
  });
});

describe("HeldPermissionsUtil.fromRows", () => {
  test("global permissions are held across the whole project", () => {
    const result: HeldPermissions = HeldPermissionsUtil.fromRows({
      rows: [],
      globalPermissions: [Permission.Public, Permission.User],
    });

    expect(result.allowed).toEqual([Permission.Public, Permission.User]);
    expect(result.allowedProjectWide).toEqual([
      Permission.Public,
      Permission.User,
    ]);
    expect(result.blocked).toEqual([]);
  });

  test("an allow row grants; one limited to labels does not reach the whole project", () => {
    const result: HeldPermissions = held([
      row(Permission.ReadProjectMonitor),
      row(Permission.EditProjectMonitor, { labelled: true }),
      row(Permission.ReadProjectIncident, {
        labelled: true,
        scope: PermissionScope.All,
      }),
    ]);

    expect(result.allowed).toEqual([
      Permission.ReadProjectMonitor,
      Permission.EditProjectMonitor,
      Permission.ReadProjectIncident,
    ]);
    expect(result.allowedProjectWide).toEqual([
      Permission.ReadProjectMonitor,
      Permission.ReadProjectIncident,
    ]);
  });

  test("an Owned row reaches only owned records, unless the role cannot be scoped", () => {
    const result: HeldPermissions = held([
      row(Permission.EditProjectMonitor, { scope: PermissionScope.Owned }),
      row(Permission.ProjectAdmin, { scope: PermissionScope.Owned }),
    ]);

    expect(result.allowed).toEqual([
      Permission.EditProjectMonitor,
      Permission.ProjectAdmin,
    ]);
    expect(result.allowedProjectWide).toEqual([Permission.ProjectAdmin]);
  });

  test("a block row is never held, with or without labels", () => {
    const result: HeldPermissions = held([
      row(Permission.ProjectOwner, { isBlock: true }),
      row(Permission.EditProjectMonitor, { isBlock: true, labelled: true }),
    ]);

    expect(result.allowed).toEqual([]);
    expect(result.allowedProjectWide).toEqual([]);
    expect(result.blocked).toEqual([Permission.ProjectOwner]);
    expect(result.blockedForSomeLabels).toEqual([
      Permission.EditProjectMonitor,
    ]);
  });

  test("tolerates rows that are missing or malformed", () => {
    expect(HeldPermissionsUtil.fromRows({ rows: undefined })).toEqual({
      allowed: [],
      allowedProjectWide: [],
      blocked: [],
      blockedForSomeLabels: [],
    });

    expect(
      HeldPermissionsUtil.fromRows({
        rows: "not rows" as unknown as Array<UserPermission>,
      }).allowed,
    ).toEqual([]);

    expect(
      HeldPermissionsUtil.fromRows({
        rows: [
          null as unknown as UserPermission,
          row(Permission.ReadProjectMonitor),
          row(Permission.ReadProjectMonitor),
        ],
      }).allowed,
    ).toEqual([Permission.ReadProjectMonitor]);
  });

  test("a flat list is held as plain grants", () => {
    expect(
      HeldPermissionsUtil.fromPermissions([
        Permission.ReadProjectMonitor,
        Permission.ReadProjectMonitor,
      ]),
    ).toEqual({
      allowed: [Permission.ReadProjectMonitor],
      allowedProjectWide: [Permission.ReadProjectMonitor],
      blocked: [],
      blockedForSomeLabels: [],
    });
  });

  test("the unblocked list leaves out what a block with no labels takes away", () => {
    expect(
      HeldPermissionsUtil.getUnblockedPermissions(
        held([
          row(Permission.ReadProjectMonitor),
          row(Permission.EditProjectMonitor),
          row(Permission.DeleteProjectMonitor),
          row(Permission.EditProjectMonitor, { isBlock: true }),
          row(Permission.DeleteProjectMonitor, {
            isBlock: true,
            labelled: true,
          }),
        ]),
      ),
    ).toEqual([Permission.ReadProjectMonitor, Permission.DeleteProjectMonitor]);
  });
});

describe("HeldPermissionsUtil.holdsAnyOf", () => {
  const MANAGE_BILLING: Array<Permission> = [
    Permission.ProjectOwner,
    Permission.ManageProjectBilling,
  ];

  test("an allow row for one of the accepted permissions grants", () => {
    expect(
      HeldPermissionsUtil.holdsAnyOf(
        held([row(Permission.ManageProjectBilling)]),
        MANAGE_BILLING,
      ),
    ).toBe(true);
  });

  test("a block row alone is not a grant", () => {
    expect(
      HeldPermissionsUtil.holdsAnyOf(
        held([row(Permission.ManageProjectBilling, { isBlock: true })]),
        MANAGE_BILLING,
      ),
    ).toBe(false);
    expect(
      HeldPermissionsUtil.holdsAnyOf(
        held([
          row(Permission.ManageProjectBilling, {
            isBlock: true,
            labelled: true,
          }),
        ]),
        MANAGE_BILLING,
      ),
    ).toBe(false);
  });

  test("a block with no labels on another team takes the permission away", () => {
    expect(
      HeldPermissionsUtil.holdsAnyOf(
        held([
          row(Permission.ManageProjectBilling),
          row(Permission.ManageProjectBilling, { isBlock: true }),
        ]),
        MANAGE_BILLING,
      ),
    ).toBe(false);
  });

  test("a block with no labels on any accepted permission refuses, as the table check does", () => {
    expect(
      HeldPermissionsUtil.holdsAnyOf(
        held([
          row(Permission.ManageProjectBilling),
          row(Permission.ProjectOwner, { isBlock: true }),
        ]),
        MANAGE_BILLING,
      ),
    ).toBe(false);
  });

  test("a block on a permission the check does not accept changes nothing", () => {
    expect(
      HeldPermissionsUtil.holdsAnyOf(
        held([
          row(Permission.ManageProjectBilling),
          row(Permission.DeleteProject, { isBlock: true }),
        ]),
        MANAGE_BILLING,
      ),
    ).toBe(true);
  });

  test("a block with labels does not refuse a check that looks at no record", () => {
    const rows: Array<UserPermission> = [
      row(Permission.ManageProjectBilling),
      row(Permission.ManageProjectBilling, { isBlock: true, labelled: true }),
    ];

    expect(HeldPermissionsUtil.holdsAnyOf(held(rows), MANAGE_BILLING)).toBe(
      true,
    );
    expect(
      HeldPermissionsUtil.holdsAnyOf(held(rows), MANAGE_BILLING, {
        labelledBlocksRefuse: true,
      }),
    ).toBe(false);
  });

  test("both kinds of block together refuse", () => {
    expect(
      HeldPermissionsUtil.holdsAnyOf(
        held([
          row(Permission.ManageProjectBilling),
          row(Permission.ManageProjectBilling, {
            isBlock: true,
            labelled: true,
          }),
          row(Permission.ManageProjectBilling, { isBlock: true }),
        ]),
        MANAGE_BILLING,
      ),
    ).toBe(false);
  });

  test("projectWideOnly counts only grants that reach the whole project", () => {
    expect(
      HeldPermissionsUtil.holdsAnyOf(
        held([row(Permission.EditProjectMonitor, { labelled: true })]),
        [Permission.EditProjectMonitor],
        { projectWideOnly: true },
      ),
    ).toBe(false);
    expect(
      HeldPermissionsUtil.holdsAnyOf(
        held([row(Permission.EditProjectMonitor, { labelled: true })]),
        [Permission.EditProjectMonitor],
      ),
    ).toBe(true);
    expect(
      HeldPermissionsUtil.holdsAnyOf(
        held([row(Permission.EditProjectMonitor)]),
        [Permission.EditProjectMonitor],
        { projectWideOnly: true },
      ),
    ).toBe(true);
  });

  test("an empty list is held by nobody, wildcard or not", () => {
    expect(
      HeldPermissionsUtil.holdsAnyOf(
        held([
          row(Permission.ProjectOwner),
          row(Permission.EditAllOperationalResources),
        ]),
        [],
        { wildcard: Permission.EditAllOperationalResources },
      ),
    ).toBe(false);
  });

  describe("the operational-resource wildcard", () => {
    const READ_MONITOR: Array<Permission> = [
      Permission.ProjectOwner,
      Permission.ReadProjectMonitor,
    ];

    test("grants when it is passed for the list", () => {
      const rows: Array<UserPermission> = [
        row(Permission.ReadAllOperationalResources),
      ];

      expect(HeldPermissionsUtil.holdsAnyOf(held(rows), READ_MONITOR)).toBe(
        false,
      );
      expect(
        HeldPermissionsUtil.holdsAnyOf(held(rows), READ_MONITOR, {
          wildcard: Permission.ReadAllOperationalResources,
        }),
      ).toBe(true);
    });

    test("a block with no labels on the wildcard takes the wildcard away", () => {
      expect(
        HeldPermissionsUtil.holdsAnyOf(
          held([
            row(Permission.ReadAllOperationalResources),
            row(Permission.ReadAllOperationalResources, { isBlock: true }),
          ]),
          READ_MONITOR,
          { wildcard: Permission.ReadAllOperationalResources },
        ),
      ).toBe(false);
    });

    test("a block on the wildcard does not take away the model's own permission", () => {
      expect(
        HeldPermissionsUtil.holdsAnyOf(
          held([
            row(Permission.ReadProjectMonitor),
            row(Permission.ReadAllOperationalResources, { isBlock: true }),
          ]),
          READ_MONITOR,
          { wildcard: Permission.ReadAllOperationalResources },
        ),
      ).toBe(true);
    });

    test("a block on the model's own permission refuses the wildcard holder too", () => {
      expect(
        HeldPermissionsUtil.holdsAnyOf(
          held([
            row(Permission.ReadAllOperationalResources),
            row(Permission.ReadProjectMonitor, { isBlock: true }),
          ]),
          READ_MONITOR,
          { wildcard: Permission.ReadAllOperationalResources },
        ),
      ).toBe(false);
    });

    test("a block with labels on the wildcard refuses only when labelled blocks refuse", () => {
      const rows: Array<UserPermission> = [
        row(Permission.ReadAllOperationalResources),
        row(Permission.ReadAllOperationalResources, {
          isBlock: true,
          labelled: true,
        }),
      ];

      expect(
        HeldPermissionsUtil.holdsAnyOf(held(rows), READ_MONITOR, {
          wildcard: Permission.ReadAllOperationalResources,
        }),
      ).toBe(true);
      expect(
        HeldPermissionsUtil.holdsAnyOf(held(rows), READ_MONITOR, {
          wildcard: Permission.ReadAllOperationalResources,
          labelledBlocksRefuse: true,
        }),
      ).toBe(false);
    });
  });

  test("isGrantedAny is the allow half alone", () => {
    const rows: Array<UserPermission> = [
      row(Permission.EditProjectMonitor),
      row(Permission.EditProjectMonitor, { isBlock: true }),
    ];

    expect(
      HeldPermissionsUtil.isGrantedAny(held(rows), [
        Permission.EditProjectMonitor,
      ]),
    ).toBe(true);
    expect(
      HeldPermissionsUtil.isBlockedFromAny(held(rows), [
        Permission.EditProjectMonitor,
      ]),
    ).toBe(true);
    expect(
      HeldPermissionsUtil.holdsAnyOf(held(rows), [
        Permission.EditProjectMonitor,
      ]),
    ).toBe(false);
  });
});

describe("HeldPermissionsUtil wildcards", () => {
  test("each operation has its wildcard", () => {
    expect(HeldPermissionsUtil.getOperationalWildcard("create")).toBe(
      Permission.CreateAllOperationalResources,
    );
    expect(HeldPermissionsUtil.getOperationalWildcard("read")).toBe(
      Permission.ReadAllOperationalResources,
    );
    expect(HeldPermissionsUtil.getOperationalWildcard("update")).toBe(
      Permission.EditAllOperationalResources,
    );
    expect(HeldPermissionsUtil.getOperationalWildcard("delete")).toBe(
      Permission.DeleteAllOperationalResources,
    );
    expect(HeldPermissionsUtil.getOperationalWildcard("archive")).toBeNull();
  });

  test("only an operational resource accepts one", () => {
    expect(
      HeldPermissionsUtil.getModelWildcard({
        isOperationalResource: true,
        operation: "update",
      }),
    ).toBe(Permission.EditAllOperationalResources);
    expect(
      HeldPermissionsUtil.getModelWildcard({
        isOperationalResource: false,
        operation: "update",
      }),
    ).toBeNull();
    expect(
      HeldPermissionsUtil.getModelWildcard({
        isOperationalResource: undefined,
        operation: "read",
      }),
    ).toBeNull();
  });

  test("a column accepts it only when it lets in everyone its table does", () => {
    const table: Array<Permission> = [
      Permission.ProjectOwner,
      Permission.ReadProjectMonitor,
    ];

    expect(
      HeldPermissionsUtil.getColumnWildcard({
        isOperationalResource: true,
        operation: "read",
        tablePermissions: table,
        columnPermissions: [...table, Permission.ProjectAdmin],
      }),
    ).toBe(Permission.ReadAllOperationalResources);

    // A secret only editors read keeps exactly its own list.
    expect(
      HeldPermissionsUtil.getColumnWildcard({
        isOperationalResource: true,
        operation: "read",
        tablePermissions: table,
        columnPermissions: [
          Permission.ProjectOwner,
          Permission.EditProjectMonitor,
        ],
      }),
    ).toBeNull();

    // An operation nobody may do stays closed.
    expect(
      HeldPermissionsUtil.getColumnWildcard({
        isOperationalResource: true,
        operation: "update",
        tablePermissions: [],
        columnPermissions: [],
      }),
    ).toBeNull();

    expect(
      HeldPermissionsUtil.getColumnWildcard({
        isOperationalResource: false,
        operation: "read",
        tablePermissions: table,
        columnPermissions: table,
      }),
    ).toBeNull();
  });
});

describe("HeldPermissionsUtil.holdsModelPermission", () => {
  const MONITOR_UPDATE: Array<Permission> = [
    Permission.ProjectOwner,
    Permission.EditProjectMonitor,
  ];

  test("the model's own permission grants, and on an operational resource its wildcard does too", () => {
    expect(
      HeldPermissionsUtil.holdsModelPermission(
        held([row(Permission.EditProjectMonitor)]),
        {
          isOperationalResource: true,
          operation: "update",
          modelPermissions: MONITOR_UPDATE,
        },
      ),
    ).toBe(true);

    expect(
      HeldPermissionsUtil.holdsModelPermission(
        held([row(Permission.EditAllOperationalResources)]),
        {
          isOperationalResource: true,
          operation: "update",
          modelPermissions: MONITOR_UPDATE,
        },
      ),
    ).toBe(true);

    expect(
      HeldPermissionsUtil.holdsModelPermission(
        held([row(Permission.EditAllOperationalResources)]),
        {
          isOperationalResource: false,
          operation: "update",
          modelPermissions: MONITOR_UPDATE,
        },
      ),
    ).toBe(false);
  });

  test("a block with no labels on the model's list refuses the wildcard holder", () => {
    expect(
      HeldPermissionsUtil.holdsModelPermission(
        held([
          row(Permission.EditAllOperationalResources),
          row(Permission.EditProjectMonitor, { isBlock: true }),
        ]),
        {
          isOperationalResource: true,
          operation: "update",
          modelPermissions: MONITOR_UPDATE,
        },
      ),
    ).toBe(false);
  });

  test("options reach the rule: a labelled block refuses where the check asks it to", () => {
    const rows: HeldPermissions = held([
      row(Permission.EditProjectMonitor),
      row(Permission.EditProjectMonitor, { isBlock: true, labelled: true }),
    ]);

    expect(
      HeldPermissionsUtil.holdsModelPermission(rows, {
        isOperationalResource: true,
        operation: "update",
        modelPermissions: MONITOR_UPDATE,
      }),
    ).toBe(true);
    expect(
      HeldPermissionsUtil.holdsModelPermission(
        rows,
        {
          isOperationalResource: true,
          operation: "update",
          modelPermissions: MONITOR_UPDATE,
        },
        { labelledBlocksRefuse: true },
      ),
    ).toBe(false);
  });
});

describe("HeldPermissionsUtil.holdsColumnPermission", () => {
  const TABLE_READ: Array<Permission> = [
    Permission.ProjectOwner,
    Permission.ReadProjectMonitor,
  ];

  type ColumnFunction = (
    rows: HeldPermissions,
    columnPermissions: Array<Permission>,
  ) => boolean;

  const readColumn: ColumnFunction = (
    rows: HeldPermissions,
    columnPermissions: Array<Permission>,
  ): boolean => {
    return HeldPermissionsUtil.holdsColumnPermission(rows, {
      isOperationalResource: true,
      operation: "read",
      tablePermissions: TABLE_READ,
      columnPermissions: columnPermissions,
    });
  };

  test("one of the column's permissions grants it", () => {
    expect(
      readColumn(held([row(Permission.ReadProjectMonitor)]), TABLE_READ),
    ).toBe(true);
    expect(readColumn(held([row(Permission.ProjectMember)]), TABLE_READ)).toBe(
      false,
    );
  });

  test("Public counts for everyone, held or not, as the server adds it", () => {
    expect(readColumn(held([]), [Permission.Public])).toBe(true);
    expect(
      readColumn(HeldPermissionsUtil.fromPermissions([Permission.Public]), [
        Permission.Public,
      ]),
    ).toBe(true);
  });

  test("a column that names no permission is closed to everyone", () => {
    expect(readColumn(held([row(Permission.ProjectOwner)]), [])).toBe(false);
  });

  test("a block with no labels on any of the column's permissions takes it away", () => {
    expect(
      readColumn(
        held([
          row(Permission.ProjectOwner),
          row(Permission.ReadProjectMonitor, { isBlock: true }),
        ]),
        TABLE_READ,
      ),
    ).toBe(false);
  });

  test("the wildcard opens a column that lets in everyone its table does, and no narrower one", () => {
    const wildcardHolder: HeldPermissions = held([
      row(Permission.ReadAllOperationalResources),
    ]);

    expect(
      readColumn(wildcardHolder, [...TABLE_READ, Permission.ProjectAdmin]),
    ).toBe(true);
    expect(
      readColumn(wildcardHolder, [
        Permission.ProjectOwner,
        Permission.EditProjectMonitor,
      ]),
    ).toBe(false);
  });
});

describe("HeldPermissionsUtil.getGrantingPermissions", () => {
  const MONITOR_READ: Array<Permission> = [
    Permission.ProjectOwner,
    Permission.ReadProjectMonitor,
  ];

  test("the model's own list, and the wildcard of an operational resource", () => {
    expect(
      HeldPermissionsUtil.getGrantingPermissions(held([]), {
        modelPermissions: MONITOR_READ,
        wildcard: Permission.ReadAllOperationalResources,
      }),
    ).toEqual([...MONITOR_READ, Permission.ReadAllOperationalResources]);

    expect(
      HeldPermissionsUtil.getGrantingPermissions(held([]), {
        modelPermissions: MONITOR_READ,
        wildcard: null,
      }),
    ).toEqual(MONITOR_READ);
  });

  test("no wildcard when a block with no labels takes it away, or nobody may do the operation", () => {
    expect(
      HeldPermissionsUtil.getGrantingPermissions(
        held([row(Permission.ReadAllOperationalResources, { isBlock: true })]),
        {
          modelPermissions: MONITOR_READ,
          wildcard: Permission.ReadAllOperationalResources,
        },
      ),
    ).toEqual(MONITOR_READ);

    expect(
      HeldPermissionsUtil.getGrantingPermissions(held([]), {
        modelPermissions: [],
        wildcard: Permission.ReadAllOperationalResources,
      }),
    ).toEqual([]);
  });
});

describe("HeldPermissionsUtil.isLoaded", () => {
  test("a snapshot with anything in it, a block included, is loaded", () => {
    expect(HeldPermissionsUtil.isLoaded(held([]))).toBe(false);
    expect(
      HeldPermissionsUtil.isLoaded(held([row(Permission.ProjectMember)])),
    ).toBe(true);
    expect(
      HeldPermissionsUtil.isLoaded(
        held([row(Permission.ProjectMember, { isBlock: true })]),
      ),
    ).toBe(true);
    expect(
      HeldPermissionsUtil.isLoaded(
        held([
          row(Permission.ProjectMember, { isBlock: true, labelled: true }),
        ]),
      ),
    ).toBe(true);
  });
});

describe("DatabaseCommonInteractionPropsUtil.getPermissionRows", () => {
  test("the allow rows (globals among them) and the block rows, together", () => {
    const projectId: ObjectID = ObjectID.generate();
    const props: DatabaseCommonInteractionProps = {
      tenantId: projectId,
      userId: ObjectID.generate(),
      userTenantAccessPermission: {
        [projectId.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: projectId,
          permissions: [
            row(Permission.ReadProjectMonitor),
            row(Permission.EditProjectMonitor, { isBlock: true }),
          ],
        },
      },
    };

    const rows: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getPermissionRows(props);

    expect(
      rows
        .filter((value: UserPermission): boolean => {
          return HeldPermissionsUtil.isBlockRow(value);
        })
        .map((value: UserPermission): Permission => {
          return value.permission;
        }),
    ).toEqual([Permission.EditProjectMonitor]);
    expect(
      rows.map((value: UserPermission): Permission => {
        return value.permission;
      }),
    ).toEqual(
      expect.arrayContaining([
        Permission.Public,
        Permission.ReadProjectMonitor,
        Permission.EditProjectMonitor,
      ]),
    );
    expect(rows).toHaveLength(
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Allow,
      ).length + 1,
    );
  });
});
