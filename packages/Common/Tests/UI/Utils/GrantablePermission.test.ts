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
  TeamPermissionGrant,
  canGrantPermission,
  canGrantTeamPermission,
  isBlockedFromAny,
  isUnrestrictedPermission,
  toPermissionRows,
} from "../../../UI/Utils/GrantablePermission";
import ApiKeyPermission from "../../../Models/DatabaseModels/ApiKeyPermission";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import ApiKeyPermissionService from "../../../Server/Services/ApiKeyPermissionService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
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

/*
 * A block that takes a whole table away. The server refuses a create on a
 * table when the user holds a block with no labels on any permission the
 * table's create accepts (TablePermission.checkTableLevelBlockPermissions),
 * before it weighs any grant. Create Team's and Create API Key's Access ask
 * this too, so they never offer a role whose row the server would refuse.
 */
describe("a block that takes a whole table away", () => {
  const TEAM_PERMISSION_CREATE: Array<Permission> =
    new TeamPermission().getCreatePermissions();

  test("a block with no labels on a permission the table accepts does", () => {
    expect(
      isBlockedFromAny({
        permissions: TEAM_PERMISSION_CREATE,
        rows: rowsOf([
          row({
            permission: Permission.ProjectAdmin,
            scope: PermissionScope.All,
          }),
          row({ permission: Permission.ProjectOwner, isBlockPermission: true }),
        ]),
      }),
    ).toBe(true);
  });

  test("a block with labels takes only part of it, so it does not", () => {
    expect(
      isBlockedFromAny({
        permissions: TEAM_PERMISSION_CREATE,
        rows: rowsOf([
          row({
            permission: Permission.ProjectAdmin,
            scope: PermissionScope.All,
          }),
          row({
            permission: Permission.ProjectOwner,
            isBlockPermission: true,
            labels: [LABEL_ID],
          }),
        ]),
      }),
    ).toBe(false);
  });

  test("a block on a permission the table does not accept does not", () => {
    expect(
      isBlockedFromAny({
        permissions: TEAM_PERMISSION_CREATE,
        rows: rowsOf([
          row({
            permission: Permission.ProjectAdmin,
            scope: PermissionScope.All,
          }),
          row({
            permission: Permission.AuthorizeMcpClient,
            isBlockPermission: true,
          }),
        ]),
      }),
    ).toBe(false);
  });

  test("allows alone never do", () => {
    expect(
      isBlockedFromAny({
        permissions: TEAM_PERMISSION_CREATE,
        rows: rowsOf([
          row({
            permission: Permission.ProjectOwner,
            scope: PermissionScope.All,
          }),
        ]),
      }),
    ).toBe(false);
  });

  test("reads the signed-in user's stored rows, and never holds back a master admin", () => {
    projectPermissionsForTest = tenant([
      row({ permission: Permission.ProjectAdmin, scope: PermissionScope.All }),
      row({ permission: Permission.ProjectOwner, isBlockPermission: true }),
    ]);
    globalPermissionsForTest = global([Permission.Public, Permission.User]);

    expect(
      GrantablePermission.isCurrentUserBlockedFromAny(TEAM_PERMISSION_CREATE),
    ).toBe(true);
    expect(
      GrantablePermission.isCurrentUserBlockedFromAny([
        Permission.CreateProjectMonitor,
      ]),
    ).toBe(false);

    isMasterAdminForTest = true;

    expect(
      GrantablePermission.isCurrentUserBlockedFromAny(TEAM_PERMISSION_CREATE),
    ).toBe(false);
  });

  const BLOCK_CALLERS: Array<{ name: string; rows: Array<UserPermission> }> = [
    ...CALLERS,
    {
      name: "an admin blocked from ProjectOwner",
      rows: [
        row({
          permission: Permission.ProjectAdmin,
          scope: PermissionScope.All,
        }),
        row({ permission: Permission.ProjectOwner, isBlockPermission: true }),
      ],
    },
    {
      name: "an admin blocked from ProjectOwner on some labels",
      rows: [
        row({
          permission: Permission.ProjectAdmin,
          scope: PermissionScope.All,
        }),
        row({
          permission: Permission.ProjectOwner,
          isBlockPermission: true,
          labels: [LABEL_ID],
        }),
      ],
    },
    {
      name: "an editor blocked from editing team permissions",
      rows: [
        row({
          permission: Permission.ProjectAdmin,
          scope: PermissionScope.All,
        }),
        row({
          permission: Permission.EditProjectTeamPermissions,
          isBlockPermission: true,
        }),
      ],
    },
  ];

  for (const model of [new TeamPermission(), new ApiKeyPermission()]) {
    for (const caller of BLOCK_CALLERS) {
      test(`${caller.name}, adding a ${model.singularName}: the same answer as the server's block check`, () => {
        let serverRefuses: boolean = false;

        try {
          TablePermission.checkTableLevelBlockPermissions(
            model.constructor as typeof TeamPermission,
            serverProps(caller.rows),
            DatabaseRequestType.Create,
          );
        } catch {
          serverRefuses = true;
        }

        expect(
          isBlockedFromAny({
            permissions: model.getCreatePermissions(),
            rows: rowsOf(caller.rows),
          }),
        ).toBe(serverRefuses);
      });
    }
  }
});

/*
 * One of a team's own rows, at the scope and labels it has: what joining
 * the team hands on. The single sign-on provider forms weigh a team's rows
 * this way to say which picked teams the server would refuse (a provider's
 * teams meet the invitation's ceiling, Server/Utils/SsoProviderTeamGrant),
 * so it must agree with TeamPermissionService.assertCanGrantPermission for
 * label-limited rows too - never a yes where the server says no, and never
 * a no where it says yes, or the form would warn about a team it saves.
 */
describe("handing on one of a team's rows", () => {
  const OTHER_LABEL_ID: ObjectID = new ObjectID(
    "0a000000-0000-4000-8000-000000000004",
  );

  interface GrantSpec {
    name: string;
    grant: TeamPermissionGrant;
  }

  const GRANTS: Array<GrantSpec> = [
    {
      name: "Project Member for the whole project",
      grant: {
        permission: Permission.ProjectMember,
        scope: PermissionScope.All,
      },
    },
    {
      name: "Project Member on a legacy row with no scope",
      grant: { permission: Permission.ProjectMember },
    },
    {
      name: "Project Member for one label",
      grant: {
        permission: Permission.ProjectMember,
        scope: PermissionScope.Labels,
        labelIds: [LABEL_ID.toString()],
      },
    },
    {
      name: "Project Member for two labels",
      grant: {
        permission: Permission.ProjectMember,
        scope: PermissionScope.Labels,
        labelIds: [LABEL_ID.toString(), OTHER_LABEL_ID.toString()],
      },
    },
    {
      name: "Project Member for what one owns",
      grant: {
        permission: Permission.ProjectMember,
        scope: PermissionScope.Owned,
      },
    },
    {
      name: "Project Member at All that also names a label",
      grant: {
        permission: Permission.ProjectMember,
        scope: PermissionScope.All,
        labelIds: [LABEL_ID.toString()],
      },
    },
    {
      name: "Project Owner",
      grant: {
        permission: Permission.ProjectOwner,
        scope: PermissionScope.All,
      },
    },
    {
      name: "Project Admin",
      grant: {
        permission: Permission.ProjectAdmin,
        scope: PermissionScope.All,
      },
    },
  ];

  const ROW_CALLERS: Array<{ name: string; rows: Array<UserPermission> }> = [
    ...CALLERS,
    {
      name: "a member on both labels",
      rows: [
        row({
          permission: Permission.ProjectMember,
          scope: PermissionScope.Labels,
          labels: [LABEL_ID, OTHER_LABEL_ID],
        }),
      ],
    },
    {
      name: "a member blocked on the other label",
      rows: [
        row({
          permission: Permission.ProjectMember,
          scope: PermissionScope.All,
        }),
        row({
          permission: Permission.ProjectMember,
          isBlockPermission: true,
          labels: [OTHER_LABEL_ID],
        }),
      ],
    },
    {
      name: "a member blocked from what they own",
      rows: [
        row({
          permission: Permission.ProjectMember,
          scope: PermissionScope.All,
        }),
        row({
          permission: Permission.ProjectMember,
          isBlockPermission: true,
          scope: PermissionScope.Owned,
        }),
      ],
    },
    {
      name: "a member on some labels, blocked on one of them",
      rows: [
        row({
          permission: Permission.ProjectMember,
          scope: PermissionScope.Labels,
          labels: [LABEL_ID, OTHER_LABEL_ID],
        }),
        row({
          permission: Permission.ProjectMember,
          isBlockPermission: true,
          labels: [LABEL_ID],
        }),
      ],
    },
  ];

  function teamRowServerAllows(
    grant: TeamPermissionGrant,
    rows: Array<UserPermission>,
  ): boolean {
    try {
      TeamPermissionService.assertCanGrantPermission({
        permission: grant.permission,
        labelIds: (grant.labelIds || []).map((labelId: string): ObjectID => {
          return new ObjectID(labelId);
        }),
        scope: grant.scope,
        props: serverProps(rows),
      });
      return true;
    } catch {
      return false;
    }
  }

  for (const caller of ROW_CALLERS) {
    for (const spec of GRANTS) {
      test(`${caller.name} handing on ${spec.name}: the server's answer`, () => {
        expect(
          canGrantTeamPermission({
            grant: spec.grant,
            rows: rowsOf(caller.rows),
          }),
        ).toBe(teamRowServerAllows(spec.grant, caller.rows));
      });
    }
  }

  test("the matrix holds both answers for label-limited rows, so it really compares something", () => {
    const answers: Set<boolean> = new Set<boolean>();

    for (const caller of ROW_CALLERS) {
      answers.add(
        canGrantTeamPermission({
          grant: GRANTS[2]!.grant,
          rows: rowsOf(caller.rows),
        }),
      );
    }

    expect(answers).toEqual(new Set<boolean>([true, false]));
  });

  test("for a row that reaches the whole project, it answers as canGrantPermission does", () => {
    for (const caller of ROW_CALLERS) {
      for (const permission of TARGETS) {
        expect({
          caller: caller.name,
          permission,
          answer: canGrantTeamPermission({
            grant: { permission: permission, scope: PermissionScope.All },
            rows: rowsOf(caller.rows),
          }),
        }).toEqual({
          caller: caller.name,
          permission,
          answer: canGrant(permission, caller.rows),
        });
      }
    }
  });

  test("a label-limited row is handed on by someone holding every one of its labels", () => {
    const rows: PermissionRows = rowsOf([
      row({
        permission: Permission.ProjectMember,
        scope: PermissionScope.Labels,
        labels: [LABEL_ID],
      }),
    ]);

    expect(
      canGrantTeamPermission({ grant: GRANTS[2]!.grant, rows: rows }),
    ).toBe(true);
    // Not one with a label they do not hold, and not the whole project.
    expect(
      canGrantTeamPermission({ grant: GRANTS[3]!.grant, rows: rows }),
    ).toBe(false);
    expect(
      canGrantTeamPermission({ grant: GRANTS[0]!.grant, rows: rows }),
    ).toBe(false);
  });

  test("a scope this copy does not know never reaches the whole project", () => {
    expect(
      isUnrestrictedPermission({
        ...row({ permission: Permission.ProjectMember }),
        scope: "Everything" as PermissionScope,
      }),
    ).toBe(false);
  });

  test("the signed-in user: a team with no rows is anyone's, a master admin may hand on any team", () => {
    projectPermissionsForTest = tenant([
      row({
        permission: Permission.ProjectMember,
        scope: PermissionScope.Labels,
        labels: [LABEL_ID],
      }),
    ]);
    globalPermissionsForTest = global([Permission.Public]);

    expect(GrantablePermission.canCurrentUserGrantTeam([])).toBe(true);
    expect(
      GrantablePermission.canCurrentUserGrantTeam([GRANTS[2]!.grant]),
    ).toBe(true);
    expect(
      GrantablePermission.canCurrentUserGrantTeam([
        GRANTS[2]!.grant,
        GRANTS[0]!.grant,
      ]),
    ).toBe(false);

    isMasterAdminForTest = true;

    expect(
      GrantablePermission.canCurrentUserGrantTeam([
        GRANTS[6]!.grant,
        GRANTS[0]!.grant,
      ]),
    ).toBe(true);
  });
});
