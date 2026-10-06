import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The dashboard's permission snapshot, read by the rule the server follows.
 * The snapshot is the real one - the rows the API's response headers leave
 * in storage (PermissionUtil.setProjectPermissions), allow and block alike -
 * so these tests read it exactly as a page does:
 *
 *   - PermissionUtil.getAllPermissions lists what is held: the allow rows
 *     and global permissions, less what a block with no labels takes away.
 *     A block row is never in it.
 *   - PermissionGate decides by that rule, and a locked action says which
 *     team block refuses it.
 */

let isMasterAdminForTest: boolean = false;

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdminForTest;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate, {
  BLOCKED_PERMISSION_TEMPLATE,
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import { HeldPermissions } from "../../../Types/HeldPermissions";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";

const PROJECT_ID: ObjectID = new ObjectID(
  "7c000000-0000-4000-8000-000000000001",
);
const LABEL_ID: ObjectID = new ObjectID("7c000000-0000-4000-8000-000000000002");

// What every signed-in member holds, whatever their teams say.
const GLOBAL_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

type RowFunction = (
  permission: Permission,
  options?: { isBlock?: boolean; labelled?: boolean },
) => UserPermission;

const row: RowFunction = (
  permission: Permission,
  options?: { isBlock?: boolean; labelled?: boolean },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: options?.labelled ? [LABEL_ID] : [],
    isBlockPermission: Boolean(options?.isBlock),
  };
};

type StoreFunction = (rows: Array<UserPermission>) => void;

// What the API's permission headers leave in storage for this project.
const store: StoreFunction = (rows: Array<UserPermission>): void => {
  PermissionUtil.setGlobalPermissions({
    _type: "UserGlobalAccessPermission",
    globalPermissions: GLOBAL_PERMISSIONS,
    projectIds: [PROJECT_ID],
  });
  PermissionUtil.setProjectPermissions({
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: rows,
  });
};

type BlockedSentenceFunction = (permissions: Array<Permission>) => string;

const blockedSentence: BlockedSentenceFunction = (
  permissions: Array<Permission>,
): string => {
  return BLOCKED_PERMISSION_TEMPLATE.replace(
    "{{permissions}}",
    PermissionGate.getPermissionTitles(permissions).join(", "),
  );
};

beforeEach(() => {
  isMasterAdminForTest = false;
  localStorage.clear();
  PermissionGate.clearPermissionPropsCache();
});

afterEach(() => {
  localStorage.clear();
});

describe("PermissionUtil.getAllPermissions", () => {
  test("is empty before the snapshot lands", () => {
    expect(PermissionUtil.getAllPermissions()).toEqual([]);
  });

  test("lists the allow rows and the global permissions", () => {
    store([
      row(Permission.ReadProjectMonitor),
      row(Permission.EditProjectMonitor),
    ]);

    expect(PermissionUtil.getAllPermissions().sort()).toEqual(
      [
        ...GLOBAL_PERMISSIONS,
        Permission.ReadProjectMonitor,
        Permission.EditProjectMonitor,
      ].sort(),
    );
  });

  test("never lists a permission that is only held as a block", () => {
    store([
      row(Permission.ReadProjectMonitor),
      row(Permission.DeleteProjectMonitor, { isBlock: true }),
      row(Permission.ProjectOwner, { isBlock: true, labelled: true }),
    ]);

    expect(PermissionUtil.getAllPermissions()).not.toContain(
      Permission.DeleteProjectMonitor,
    );
    expect(PermissionUtil.getAllPermissions()).not.toContain(
      Permission.ProjectOwner,
    );
  });

  test("leaves out what another team's block with no labels takes away", () => {
    store([
      row(Permission.EditProjectMonitor),
      row(Permission.EditProjectMonitor, { isBlock: true }),
    ]);

    expect(PermissionUtil.getAllPermissions()).not.toContain(
      Permission.EditProjectMonitor,
    );
  });

  test("keeps what a block with labels restricts: it takes away only labelled records", () => {
    store([
      row(Permission.EditProjectMonitor),
      row(Permission.EditProjectMonitor, { isBlock: true, labelled: true }),
    ]);

    expect(PermissionUtil.getAllPermissions()).toContain(
      Permission.EditProjectMonitor,
    );
  });

  test("getHeldPermissions says what is blocked, and how", () => {
    store([
      row(Permission.EditProjectMonitor),
      row(Permission.DeleteProjectMonitor, { isBlock: true }),
      row(Permission.EditProjectMonitor, { isBlock: true, labelled: true }),
    ]);

    const held: HeldPermissions = PermissionUtil.getHeldPermissions();

    expect(held.blocked).toEqual([Permission.DeleteProjectMonitor]);
    expect(held.blockedForSomeLabels).toEqual([Permission.EditProjectMonitor]);
  });
});

describe("PermissionGate reads the stored snapshot by the server's rule", () => {
  test("a grant", () => {
    store([row(Permission.EditProjectMonitor)]);

    expect(PermissionGate.check(new Monitor(), ModelAction.Update)).toEqual({
      isAllowed: true,
    });
  });

  test("a grantee whose only row is a block with no labels is locked, and told why", () => {
    store([row(Permission.EditProjectMonitor, { isBlock: true })]);

    const result: PermissionGateResult = PermissionGate.check(
      new Monitor(),
      ModelAction.Update,
    );

    expect(result.isAllowed).toBe(false);
    expect(result.disabledReason).toContain(
      blockedSentence([Permission.EditProjectMonitor]),
    );
  });

  test("a grantee whose only row is a block with labels is locked: a block is never a grant", () => {
    store([
      row(Permission.EditProjectMonitor, { isBlock: true, labelled: true }),
    ]);

    const result: PermissionGateResult = PermissionGate.check(
      new Monitor(),
      ModelAction.Update,
    );

    expect(result.isAllowed).toBe(false);
    expect(result.disabledReason).toContain(
      "You do not have permission to update this Monitor.",
    );
  });

  test("a grant and another team's block with no labels: locked, naming the block", () => {
    store([
      row(Permission.EditProjectMonitor),
      row(Permission.EditProjectMonitor, { isBlock: true }),
    ]);

    const result: PermissionGateResult = PermissionGate.check(
      new Monitor(),
      ModelAction.Update,
    );

    expect(result.isAllowed).toBe(false);
    expect(result.disabledReason).toBe(
      `You do not have permission to update this Monitor. ${blockedSentence([
        Permission.EditProjectMonitor,
      ])}`,
    );
  });

  test("a block with no labels on another permission the action accepts locks it too", () => {
    store([
      row(Permission.EditProjectMonitor),
      row(Permission.ProjectMember, { isBlock: true }),
    ]);

    expect(
      PermissionGate.check(new Monitor(), ModelAction.Update).isAllowed,
    ).toBe(false);
  });

  test("a grant and a block with labels: allowed, the server leaves the labelled records out", () => {
    store([
      row(Permission.EditProjectMonitor),
      row(Permission.EditProjectMonitor, { isBlock: true, labelled: true }),
    ]);

    expect(
      PermissionGate.check(new Monitor(), ModelAction.Update).isAllowed,
    ).toBe(true);
  });

  test("a grant and both kinds of block: locked", () => {
    store([
      row(Permission.EditProjectMonitor),
      row(Permission.EditProjectMonitor, { isBlock: true, labelled: true }),
      row(Permission.EditProjectMonitor, { isBlock: true }),
    ]);

    expect(
      PermissionGate.check(new Monitor(), ModelAction.Update).isAllowed,
    ).toBe(false);
  });

  test("a block on another operation changes nothing", () => {
    store([
      row(Permission.EditProjectMonitor),
      row(Permission.DeleteProjectMonitor, { isBlock: true }),
    ]);

    expect(
      PermissionGate.check(new Monitor(), ModelAction.Update).isAllowed,
    ).toBe(true);
    expect(
      PermissionGate.check(new Monitor(), ModelAction.Delete).isAllowed,
    ).toBe(false);
  });

  test("a master admin is never blocked", () => {
    isMasterAdminForTest = true;
    store([row(Permission.EditProjectMonitor, { isBlock: true })]);

    expect(
      PermissionGate.check(new Monitor(), ModelAction.Update).isAllowed,
    ).toBe(true);
  });

  test("snapshotAllows reads the same rule without the master-admin short circuit", () => {
    isMasterAdminForTest = true;
    store([
      row(Permission.DeleteProjectMonitor),
      row(Permission.DeleteProjectMonitor, { isBlock: true }),
    ]);

    expect(
      PermissionGate.snapshotAllows(new Monitor(), ModelAction.Delete),
    ).toBe(false);
  });
});

describe("PermissionGate and the operational-resource wildcard", () => {
  test("Edit All Operational Resources edits a monitor and a workflow, not a project", () => {
    store([row(Permission.EditAllOperationalResources)]);

    expect(
      PermissionGate.check(new Monitor(), ModelAction.Update).isAllowed,
    ).toBe(true);
    expect(
      PermissionGate.check(new Workflow(), ModelAction.Update).isAllowed,
    ).toBe(true);
    expect(
      PermissionGate.check(new Project(), ModelAction.Update).isAllowed,
    ).toBe(false);
  });

  test("a block with no labels on the wildcard takes it away", () => {
    store([
      row(Permission.EditAllOperationalResources),
      row(Permission.EditAllOperationalResources, { isBlock: true }),
    ]);

    expect(
      PermissionGate.check(new Monitor(), ModelAction.Update).isAllowed,
    ).toBe(false);
  });

  test("a block on the monitor's own permission refuses the wildcard holder", () => {
    store([
      row(Permission.EditAllOperationalResources),
      row(Permission.EditProjectMonitor, { isBlock: true }),
    ]);

    expect(
      PermissionGate.check(new Monitor(), ModelAction.Update).isAllowed,
    ).toBe(false);
  });
});

describe("PermissionGate.holdsAnyOf", () => {
  const BILLING: Array<Permission> = [
    Permission.ProjectOwner,
    Permission.ManageProjectBilling,
  ];

  test.each([
    ["a grant", [row(Permission.ManageProjectBilling)], true],
    [
      "a block with no labels only",
      [row(Permission.ManageProjectBilling, { isBlock: true })],
      false,
    ],
    [
      "a block with labels only",
      [row(Permission.ManageProjectBilling, { isBlock: true, labelled: true })],
      false,
    ],
    [
      "a grant and a block with no labels",
      [
        row(Permission.ManageProjectBilling),
        row(Permission.ManageProjectBilling, { isBlock: true }),
      ],
      false,
    ],
    [
      "a grant and a block with labels",
      [
        row(Permission.ManageProjectBilling),
        row(Permission.ManageProjectBilling, { isBlock: true, labelled: true }),
      ],
      true,
    ],
  ])("%s", (_label: string, rows: Array<UserPermission>, expected: boolean) => {
    store(rows);

    expect(PermissionGate.holdsAnyOf(BILLING)).toBe(expected);
  });

  test("labelledBlocksRefuse counts a block with labels as a refusal", () => {
    store([
      row(Permission.ManageProjectBilling),
      row(Permission.ManageProjectBilling, { isBlock: true, labelled: true }),
    ]);

    expect(
      PermissionGate.holdsAnyOf(BILLING, { labelledBlocksRefuse: true }),
    ).toBe(false);
  });

  test("nobody holds anything before the snapshot lands", () => {
    expect(PermissionGate.holdsAnyOf(BILLING)).toBe(false);
    expect(PermissionGate.hasPermissionSnapshot()).toBe(false);
  });

  test("a snapshot whose every row is a block has landed", () => {
    localStorage.clear();
    PermissionUtil.setProjectPermissions({
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: [row(Permission.ManageProjectBilling, { isBlock: true })],
    });

    expect(PermissionGate.hasPermissionSnapshot()).toBe(true);
    expect(PermissionGate.holdsAnyOf(BILLING)).toBe(false);
  });
});

describe("PermissionGate.holdsColumnPermission", () => {
  test("a column is read by the rule its table is", () => {
    store([row(Permission.ReadProjectMonitor)]);

    expect(
      PermissionGate.holdsColumnPermission(new Monitor(), "name", "read"),
    ).toBe(true);
  });

  test("a block with no labels on the column's permission takes the column away", () => {
    store([
      row(Permission.ReadProjectMonitor),
      row(Permission.ReadProjectMonitor, { isBlock: true }),
    ]);

    expect(
      PermissionGate.holdsColumnPermission(new Monitor(), "name", "read"),
    ).toBe(false);
  });

  test("Read All Operational Resources reads a column that admits everyone its table does", () => {
    store([row(Permission.ReadAllOperationalResources)]);

    expect(
      PermissionGate.holdsColumnPermission(new Monitor(), "name", "read"),
    ).toBe(true);
  });

  test("a column nobody may write stays closed", () => {
    store([row(Permission.ProjectOwner)]);

    expect(
      PermissionGate.holdsColumnPermission(
        new Monitor(),
        "not-a-column",
        "update",
      ),
    ).toBe(false);
  });
});
