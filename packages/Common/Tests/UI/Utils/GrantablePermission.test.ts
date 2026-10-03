import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The dashboard's copy of the server's grant ceiling (UI/Utils
 * /GrantablePermission). Invite User preselects a team, and Create API Key
 * offers roles, only when the server would accept them - so this copy must
 * never say yes where the server says no. It is pinned three ways:
 *
 *   - the rule itself, case by case;
 *   - how the signed-in user's stored permissions are read into it;
 *   - side by side with the two server checks it stands in for
 *     (ApiKeyPermissionService and TeamPermissionService), on a matrix of
 *     callers and permissions: for a grant that reaches the whole project -
 *     the only kind a default makes - the answers are the same.
 */

/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under ts-jest
 * (Buffer vs BinaryLike) that breaks every suite whose import graph reaches
 * it. The server services below are imported only for their grant checks.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

let isMasterAdminForTest: boolean = false;
let projectPermissionsForTest: unknown = null;
let globalPermissionsForTest: unknown = null;

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

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return [];
      },
      getProjectPermissions: (): unknown => {
        return projectPermissionsForTest;
      },
      getGlobalPermissions: (): unknown => {
        return globalPermissionsForTest;
      },
    },
  };
});

import GrantablePermission, {
  PermissionRows,
  canGrantPermission,
  isUnrestrictedPermission,
  toPermissionRows,
} from "../../../UI/Utils/GrantablePermission";
import ApiKeyPermissionService from "../../../Server/Services/ApiKeyPermissionService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";

const PROJECT_ID: ObjectID = new ObjectID(
  "0a000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("0a000000-0000-4000-8000-000000000002");
const LABEL_ID: ObjectID = new ObjectID("0a000000-0000-4000-8000-000000000003");

interface RowSpec {
  permission: Permission;
  scope?: PermissionScope | undefined;
  labels?: Array<ObjectID> | undefined;
  isBlockPermission?: boolean | undefined;
}

function row(spec: RowSpec): UserPermission {
  const value: UserPermission = {
    permission: spec.permission,
    labelIds: spec.labels || [],
    isBlockPermission: spec.isBlockPermission || false,
    _type: "UserPermission",
  };

  if (spec.scope) {
    value.scope = spec.scope;
  }

  return value;
}

function tenant(rows: Array<UserPermission>): UserTenantAccessPermission {
  return {
    projectId: PROJECT_ID,
    permissions: rows,
    _type: "UserTenantAccessPermission",
  };
}

function global(permissions: Array<Permission>): UserGlobalAccessPermission {
  return {
    projectIds: [PROJECT_ID],
    globalPermissions: permissions,
    _type: "UserGlobalAccessPermission",
  };
}

function rowsOf(rows: Array<UserPermission>): PermissionRows {
  return toPermissionRows({
    projectPermissions: tenant(rows),
    globalPermissions: global([Permission.Public, Permission.User]),
  });
}

function canGrant(
  permission: Permission,
  rows: Array<UserPermission>,
): boolean {
  return canGrantPermission({ permission: permission, rows: rowsOf(rows) });
}

beforeEach(() => {
  isMasterAdminForTest = false;
  projectPermissionsForTest = null;
  globalPermissionsForTest = null;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a permission row that reaches the whole project", () => {
  test("scope All does, labels or not", () => {
    expect(
      isUnrestrictedPermission(
        row({
          permission: Permission.ProjectMember,
          scope: PermissionScope.All,
        }),
      ),
    ).toBe(true);
    expect(
      isUnrestrictedPermission(
        row({
          permission: Permission.ProjectMember,
          scope: PermissionScope.All,
          labels: [LABEL_ID],
        }),
      ),
    ).toBe(true);
  });

  test("Owned never does", () => {
    expect(
      isUnrestrictedPermission(
        row({
          permission: Permission.ProjectMember,
          scope: PermissionScope.Owned,
        }),
      ),
    ).toBe(false);
  });

  test("Labels, or a legacy row with no scope, does only with no labels", () => {
    expect(
      isUnrestrictedPermission(
        row({
          permission: Permission.ProjectMember,
          scope: PermissionScope.Labels,
        }),
      ),
    ).toBe(true);
    expect(
      isUnrestrictedPermission(
        row({
          permission: Permission.ProjectMember,
          scope: PermissionScope.Labels,
          labels: [LABEL_ID],
        }),
      ),
    ).toBe(false);
    expect(
      isUnrestrictedPermission(row({ permission: Permission.ProjectMember })),
    ).toBe(true);
    expect(
      isUnrestrictedPermission(
        row({ permission: Permission.ProjectMember, labels: [LABEL_ID] }),
      ),
    ).toBe(false);
  });
});

describe("what a user may hand on", () => {
  test("a project owner may hand on anything", () => {
    const owner: Array<UserPermission> = [
      row({ permission: Permission.ProjectOwner, scope: PermissionScope.All }),
    ];

    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentMember,
      Permission.DeleteProject,
    ]) {
      expect(canGrant(permission, owner)).toBe(true);
    }
  });

  test("an owner blocked from ProjectOwner is held to what they hold", () => {
    const rows: Array<UserPermission> = [
      row({ permission: Permission.ProjectOwner, scope: PermissionScope.All }),
      row({
        permission: Permission.ProjectOwner,
        isBlockPermission: true,
        labels: [LABEL_ID],
      }),
    ];

    expect(canGrant(Permission.ProjectMember, rows)).toBe(false);
  });

  test("an owner whose ProjectOwner is label-scoped is not a project owner here", () => {
    const rows: Array<UserPermission> = [
      row({
        permission: Permission.ProjectOwner,
        scope: PermissionScope.Labels,
        labels: [LABEL_ID],
      }),
    ];

    expect(canGrant(Permission.Viewer, rows)).toBe(false);
  });

  test("a project admin may hand on Project Admin, but not Project Member or Viewer", () => {
    const admin: Array<UserPermission> = [
      row({ permission: Permission.ProjectAdmin, scope: PermissionScope.All }),
    ];

    expect(canGrant(Permission.ProjectAdmin, admin)).toBe(true);
    expect(canGrant(Permission.ProjectMember, admin)).toBe(false);
    expect(canGrant(Permission.Viewer, admin)).toBe(false);
    expect(canGrant(Permission.ProjectOwner, admin)).toBe(false);
  });

  test("a project admin who is also in Members may hand on Project Member", () => {
    const rows: Array<UserPermission> = [
      row({ permission: Permission.ProjectAdmin, scope: PermissionScope.All }),
      row({ permission: Permission.ProjectMember, scope: PermissionScope.All }),
    ];

    expect(canGrant(Permission.ProjectMember, rows)).toBe(true);
  });

  test("a permission held only for owned resources or some labels is not handed on project-wide", () => {
    expect(
      canGrant(Permission.ProjectMember, [
        row({
          permission: Permission.ProjectMember,
          scope: PermissionScope.Owned,
        }),
      ]),
    ).toBe(false);

    expect(
      canGrant(Permission.ProjectMember, [
        row({
          permission: Permission.ProjectMember,
          scope: PermissionScope.Labels,
          labels: [LABEL_ID],
        }),
      ]),
    ).toBe(false);
  });

  test("any block on the permission, even a label-scoped one, takes it away", () => {
    expect(
      canGrant(Permission.ProjectMember, [
        row({
          permission: Permission.ProjectMember,
          scope: PermissionScope.All,
        }),
        row({
          permission: Permission.ProjectMember,
          isBlockPermission: true,
          labels: [LABEL_ID],
        }),
      ]),
    ).toBe(false);
  });

  test("nothing at all hands on nothing", () => {
    expect(canGrant(Permission.Viewer, [])).toBe(false);
  });
});

describe("reading the signed-in user's permissions", () => {
  test("global permissions count as project-wide allows", () => {
    const rows: PermissionRows = toPermissionRows({
      projectPermissions: null,
      globalPermissions: global([Permission.ProjectOwner]),
    });

    expect(rows.block).toEqual([]);
    expect(
      canGrantPermission({ permission: Permission.ProjectMember, rows: rows }),
    ).toBe(true);
  });

  test("project rows split into allows and blocks", () => {
    const rows: PermissionRows = toPermissionRows({
      projectPermissions: tenant([
        row({ permission: Permission.ProjectMember }),
        row({ permission: Permission.Viewer, isBlockPermission: true }),
      ]),
      globalPermissions: null,
    });

    expect(
      rows.allow.map((value: UserPermission): Permission => {
        return value.permission;
      }),
    ).toEqual([Permission.ProjectMember]);
    expect(
      rows.block.map((value: UserPermission): Permission => {
        return value.permission;
      }),
    ).toEqual([Permission.Viewer]);
  });

  test("a row that does not say what it is counts as a block, never as an allow", () => {
    const unknownKind: UserPermission = row({
      permission: Permission.ProjectOwner,
    });
    delete unknownKind.isBlockPermission;

    const rows: PermissionRows = toPermissionRows({
      projectPermissions: tenant([unknownKind]),
      globalPermissions: null,
    });

    expect(rows.allow).toEqual([]);
    expect(
      canGrantPermission({ permission: Permission.ProjectMember, rows: rows }),
    ).toBe(false);
  });

  test("nothing stored yet hands on nothing", () => {
    expect(GrantablePermission.canCurrentUserGrant(Permission.Viewer)).toBe(
      false,
    );
    expect(
      GrantablePermission.canCurrentUserGrantAll([Permission.Viewer]),
    ).toBe(false);
  });

  test("reads the stored project and global permissions", () => {
    projectPermissionsForTest = tenant([
      row({ permission: Permission.ProjectMember, scope: PermissionScope.All }),
    ]);
    globalPermissionsForTest = global([Permission.Public]);

    expect(
      GrantablePermission.canCurrentUserGrant(Permission.ProjectMember),
    ).toBe(true);
    expect(GrantablePermission.canCurrentUserGrant(Permission.Viewer)).toBe(
      false,
    );
    expect(
      GrantablePermission.canCurrentUserGrantAll([
        Permission.ProjectMember,
        Permission.Viewer,
      ]),
    ).toBe(false);
  });

  test("a team with no permissions is handed on by anyone", () => {
    expect(GrantablePermission.canCurrentUserGrantAll([])).toBe(true);
  });

  test("a master admin may hand on anything, as on the server", () => {
    isMasterAdminForTest = true;

    expect(
      GrantablePermission.canCurrentUserGrant(Permission.ProjectOwner),
    ).toBe(true);
    expect(
      GrantablePermission.canCurrentUserGrantAll([
        Permission.ProjectOwner,
        Permission.DeleteProject,
      ]),
    ).toBe(true);
  });
});

/*
 * The server checks, called the way an API key permission and a team
 * invitation call them, for a grant to the whole project.
 */
function serverProps(
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userGlobalAccessPermission: global([Permission.Public, Permission.User]),
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenant(rows),
    },
  };
}

type ApiKeyGrantCheck = {
  assertCallerCanGrantPermission: (data: {
    permission: Permission;
    labels: Array<unknown> | undefined;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }) => void;
};

function apiKeyServerAllows(
  permission: Permission,
  rows: Array<UserPermission>,
): boolean {
  try {
    (
      ApiKeyPermissionService as unknown as ApiKeyGrantCheck
    ).assertCallerCanGrantPermission({
      permission: permission,
      labels: [],
      projectId: PROJECT_ID,
      props: serverProps(rows),
    });
    return true;
  } catch {
    return false;
  }
}

function teamServerAllows(
  permission: Permission,
  rows: Array<UserPermission>,
  targetScope: PermissionScope | undefined,
): boolean {
  try {
    TeamPermissionService.assertCanGrantPermission({
      permission: permission,
      labelIds: [],
      scope: targetScope,
      props: serverProps(rows),
    });
    return true;
  } catch {
    return false;
  }
}

const CALLERS: Array<{ name: string; rows: Array<UserPermission> }> = [
  { name: "nobody", rows: [] },
  {
    name: "a project owner",
    rows: [
      row({ permission: Permission.ProjectOwner, scope: PermissionScope.All }),
    ],
  },
  {
    name: "a legacy project owner row",
    rows: [row({ permission: Permission.ProjectOwner })],
  },
  {
    name: "an owner blocked from ProjectOwner",
    rows: [
      row({ permission: Permission.ProjectOwner, scope: PermissionScope.All }),
      row({ permission: Permission.ProjectOwner, isBlockPermission: true }),
    ],
  },
  {
    name: "an owner scoped to owned resources",
    rows: [
      row({
        permission: Permission.ProjectOwner,
        scope: PermissionScope.Owned,
      }),
    ],
  },
  {
    name: "a project admin",
    rows: [
      row({ permission: Permission.ProjectAdmin, scope: PermissionScope.All }),
    ],
  },
  {
    name: "a project admin in Members too",
    rows: [
      row({ permission: Permission.ProjectAdmin, scope: PermissionScope.All }),
      row({ permission: Permission.ProjectMember, scope: PermissionScope.All }),
    ],
  },
  {
    name: "a member",
    rows: [
      row({ permission: Permission.ProjectMember, scope: PermissionScope.All }),
    ],
  },
  {
    name: "a member blocked on some labels",
    rows: [
      row({ permission: Permission.ProjectMember, scope: PermissionScope.All }),
      row({
        permission: Permission.ProjectMember,
        isBlockPermission: true,
        labels: [LABEL_ID],
      }),
    ],
  },
  {
    name: "a member on some labels only",
    rows: [
      row({
        permission: Permission.ProjectMember,
        scope: PermissionScope.Labels,
        labels: [LABEL_ID],
      }),
    ],
  },
  {
    name: "a member of owned resources only",
    rows: [
      row({
        permission: Permission.ProjectMember,
        scope: PermissionScope.Owned,
      }),
    ],
  },
  {
    name: "a viewer",
    rows: [row({ permission: Permission.Viewer, scope: PermissionScope.All })],
  },
  {
    name: "a key-permission editor",
    rows: [
      row({
        permission: Permission.EditProjectApiKeyPermissions,
        scope: PermissionScope.All,
      }),
    ],
  },
];

const TARGETS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.IncidentMember,
];

describe("side by side with the server, for grants to the whole project", () => {
  for (const caller of CALLERS) {
    for (const target of TARGETS) {
      test(`${caller.name} handing on ${target}`, () => {
        const client: boolean = canGrant(target, caller.rows);

        expect(client).toBe(apiKeyServerAllows(target, caller.rows));
        expect(client).toBe(
          teamServerAllows(target, caller.rows, PermissionScope.All),
        );
        expect(client).toBe(teamServerAllows(target, caller.rows, undefined));
      });
    }
  }

  test("the matrix holds both answers, so it really compares something", () => {
    const answers: Set<boolean> = new Set<boolean>();

    for (const caller of CALLERS) {
      for (const target of TARGETS) {
        answers.add(canGrant(target, caller.rows));
      }
    }

    expect(answers).toEqual(new Set<boolean>([true, false]));
  });
});
