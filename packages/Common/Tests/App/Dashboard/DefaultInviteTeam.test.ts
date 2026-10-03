import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Which team Invite User starts on (Dashboard/src/Utils/DefaultInviteTeam):
 *
 *   1. a team holding ProjectMember for the whole project, not blocking it -
 *      "Members" first, then the oldest;
 *   2. with none, the team called Members;
 *   3. otherwise none;
 *
 * and only a team the inviter may invite to, since the server refuses an
 * invitation that hands on permissions the inviter does not hold. The
 * lookup reads two lists, and never fails or keeps the dialog waiting.
 */

let isMasterAdminForTest: boolean = false;
let projectPermissionsForTest: unknown = null;

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
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

import {
  DEFAULT_INVITE_TEAM_LOOKUP_TIMEOUT_MS,
  InviteTeam,
  InviteTeamPermissionRow,
  MEMBERS_TEAM_NAME,
  fetchDefaultInviteTeam,
  findDefaultInviteTeam,
  pickDefaultInviteTeam,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/DefaultInviteTeam";
import Team from "../../../Models/DatabaseModels/Team";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

const PROJECT_ID: ObjectID = new ObjectID(
  "0b000000-0000-4000-8000-000000000001",
);

const OWNERS: InviteTeam = { id: "team-owners", name: "Owners" };
const ADMIN: InviteTeam = { id: "team-admin", name: "Admin" };
const MEMBERS: InviteTeam = { id: "team-members", name: "Members" };

// What a new project starts with (ProjectService.addDefaultProjectTeams).
const STARTING_TEAMS: Array<InviteTeam> = [OWNERS, ADMIN, MEMBERS];

function rowOf(
  team: InviteTeam,
  permission: Permission,
  extra: Partial<InviteTeamPermissionRow> = {},
): InviteTeamPermissionRow {
  return {
    teamId: team.id,
    permission: permission,
    isBlockPermission: false,
    scope: PermissionScope.All,
    ...extra,
  };
}

const STARTING_ROWS: Array<InviteTeamPermissionRow> = [
  rowOf(OWNERS, Permission.ProjectOwner),
  rowOf(ADMIN, Permission.ProjectAdmin),
  rowOf(MEMBERS, Permission.ProjectMember),
];

const anyone: (permissions: Array<Permission>) => boolean = (): boolean => {
  return true;
};

function pick(
  teams: Array<InviteTeam>,
  rows: Array<InviteTeamPermissionRow>,
  canGrantAll: (permissions: Array<Permission>) => boolean = anyone,
): InviteTeam | null {
  return pickDefaultInviteTeam({
    teams: teams,
    permissionRows: rows,
    canGrantAll: canGrantAll,
  });
}

describe("the team Invite User starts on", () => {
  test("a new project's Members team", () => {
    expect(pick(STARTING_TEAMS, STARTING_ROWS)).toEqual(MEMBERS);
  });

  test("the team holding ProjectMember, whatever it is called now", () => {
    const engineering: InviteTeam = { id: "team-eng", name: "Engineering" };

    expect(
      pick(
        [OWNERS, ADMIN, engineering],
        [
          rowOf(OWNERS, Permission.ProjectOwner),
          rowOf(ADMIN, Permission.ProjectAdmin),
          rowOf(engineering, Permission.ProjectMember),
        ],
      ),
    ).toEqual(engineering);
  });

  test("among several, the one called Members first", () => {
    const support: InviteTeam = { id: "team-support", name: "Support" };

    expect(
      pick(
        [OWNERS, support, MEMBERS],
        [
          rowOf(support, Permission.ProjectMember),
          rowOf(MEMBERS, Permission.ProjectMember),
        ],
      ),
    ).toEqual(MEMBERS);
  });

  test("the name is matched without regard to case or spaces", () => {
    const members: InviteTeam = { id: "team-m", name: "  members " };
    const support: InviteTeam = { id: "team-support", name: "Support" };

    expect(
      pick(
        [support, members],
        [
          rowOf(support, Permission.ProjectMember),
          rowOf(members, Permission.ProjectMember),
        ],
      ),
    ).toEqual(members);
  });

  test("otherwise the oldest of them: the one a project starts with", () => {
    const first: InviteTeam = { id: "team-first", name: "Engineering" };
    const second: InviteTeam = { id: "team-second", name: "Support" };

    expect(
      pick(
        [first, second],
        [
          rowOf(second, Permission.ProjectMember),
          rowOf(first, Permission.ProjectMember),
        ],
      ),
    ).toEqual(first);
  });

  test("a team holding ProjectMember for owned resources or some labels only is not it", () => {
    const contractors: InviteTeam = { id: "team-c", name: "Contractors" };
    const auditors: InviteTeam = { id: "team-a", name: "Auditors" };

    expect(
      pick(
        [contractors, auditors],
        [
          rowOf(contractors, Permission.ProjectMember, {
            scope: PermissionScope.Owned,
          }),
          rowOf(auditors, Permission.ProjectMember, {
            scope: PermissionScope.Labels,
          }),
        ],
      ),
    ).toBeNull();
  });

  test("a team blocking ProjectMember is not a members team", () => {
    const support: InviteTeam = { id: "team-support", name: "Support" };

    // Another team that holds it plainly comes first, Members or not.
    expect(
      pick(
        [...STARTING_TEAMS, support],
        [
          ...STARTING_ROWS,
          rowOf(MEMBERS, Permission.ProjectMember, { isBlockPermission: true }),
          rowOf(support, Permission.ProjectMember),
        ],
      ),
    ).toEqual(support);

    const engineering: InviteTeam = { id: "team-eng", name: "Engineering" };

    expect(
      pick(
        [OWNERS, engineering],
        [
          rowOf(engineering, Permission.ProjectMember),
          rowOf(engineering, Permission.ProjectMember, {
            isBlockPermission: true,
          }),
        ],
      ),
    ).toBeNull();
  });

  test("a block row of ProjectMember does not make a team a members team", () => {
    const team: InviteTeam = { id: "team-x", name: "Restricted" };

    expect(
      pick(
        [team],
        [rowOf(team, Permission.ProjectMember, { isBlockPermission: true })],
      ),
    ).toBeNull();
  });

  test("with no team holding ProjectMember, the team called Members", () => {
    expect(
      pick(STARTING_TEAMS, [
        rowOf(OWNERS, Permission.ProjectOwner),
        rowOf(ADMIN, Permission.ProjectAdmin),
        rowOf(MEMBERS, Permission.Viewer),
      ]),
    ).toEqual(MEMBERS);

    // Even one with no permissions left at all.
    expect(
      pick(STARTING_TEAMS, [
        rowOf(OWNERS, Permission.ProjectOwner),
        rowOf(ADMIN, Permission.ProjectAdmin),
      ]),
    ).toEqual(MEMBERS);
  });

  test("with neither, nothing: the inviter picks", () => {
    expect(
      pick(
        [OWNERS, ADMIN],
        [
          rowOf(OWNERS, Permission.ProjectOwner),
          rowOf(ADMIN, Permission.ProjectAdmin),
        ],
      ),
    ).toBeNull();
    expect(pick([], [])).toBeNull();
  });

  test("never the Owners or Admin team, whatever else is missing", () => {
    for (const rows of [
      [] as Array<InviteTeamPermissionRow>,
      [
        rowOf(OWNERS, Permission.ProjectOwner),
        rowOf(ADMIN, Permission.ProjectAdmin),
      ],
    ]) {
      expect(pick([OWNERS, ADMIN], rows)).toBeNull();
    }
  });
});

describe("only a team the inviter may invite to", () => {
  test("hands the inviter every permission row of the team, allow and block", () => {
    const asked: Array<Array<Permission>> = [];

    pick(
      STARTING_TEAMS,
      [
        ...STARTING_ROWS,
        rowOf(MEMBERS, Permission.TelemetryAdmin),
        rowOf(MEMBERS, Permission.DeleteProjectMonitor, {
          isBlockPermission: true,
        }),
      ],
      (permissions: Array<Permission>): boolean => {
        asked.push(permissions);
        return true;
      },
    );

    expect(asked).toEqual([
      [
        Permission.ProjectMember,
        Permission.TelemetryAdmin,
        Permission.DeleteProjectMonitor,
      ],
    ]);
  });

  test("a Project Admin outside Members gets no team picked, rather than one the server refuses", () => {
    const projectAdmin: (permissions: Array<Permission>) => boolean = (
      permissions: Array<Permission>,
    ): boolean => {
      return permissions.every((permission: Permission): boolean => {
        return permission === Permission.ProjectAdmin;
      });
    };

    expect(pick(STARTING_TEAMS, STARTING_ROWS, projectAdmin)).toBeNull();
  });

  test("the next members team is picked when the first cannot be invited to", () => {
    const support: InviteTeam = { id: "team-support", name: "Support" };

    expect(
      pick(
        [OWNERS, MEMBERS, support],
        [
          rowOf(MEMBERS, Permission.ProjectMember),
          rowOf(MEMBERS, Permission.TelemetryAdmin),
          rowOf(support, Permission.ProjectMember),
        ],
        (permissions: Array<Permission>): boolean => {
          return !permissions.includes(Permission.TelemetryAdmin);
        },
      ),
    ).toEqual(support);
  });

  test("the Members team found by name is checked too", () => {
    expect(
      pick(STARTING_TEAMS, [rowOf(MEMBERS, Permission.Viewer)], (): boolean => {
        return false;
      }),
    ).toBeNull();
  });
});

/*
 * A stand-in for ModelAPI that answers the two lists the lookup reads and
 * remembers how it was asked.
 */
interface ListCall {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
  limit: number;
}

function team(id: string, name: string): Team {
  const value: Team = new Team();
  value._id = id;
  value.name = name;
  return value;
}

function teamPermission(
  teamId: string,
  permission: Permission,
  extra: { isBlockPermission?: boolean; scope?: PermissionScope } = {},
): TeamPermission {
  const value: TeamPermission = new TeamPermission();
  value._id = ObjectID.generate().toString();
  value.teamId = new ObjectID(teamId);
  value.permission = permission;
  value.isBlockPermission = extra.isBlockPermission || false;
  value.scope = extra.scope || PermissionScope.All;
  return value;
}

const OWNERS_ID: string = "0b000000-0000-4000-8000-0000000000a1";
const ADMIN_ID: string = "0b000000-0000-4000-8000-0000000000a2";
const MEMBERS_ID: string = "0b000000-0000-4000-8000-0000000000a3";

function fakeModelAPI(data: {
  teams?: Array<Team>;
  permissions?: Array<TeamPermission>;
  fail?: boolean;
  never?: boolean;
  calls: Array<ListCall>;
}): typeof ModelAPI {
  return {
    getList: async (args: ListCall): Promise<unknown> => {
      data.calls.push(args);

      if (data.never) {
        return await new Promise<never>(() => {});
      }

      if (data.fail) {
        throw new Error("You do not have permission to read this Team.");
      }

      const rows: Array<unknown> =
        args.modelType === Team ? data.teams || [] : data.permissions || [];

      return { data: rows, count: rows.length, skip: 0, limit: 10000 };
    },
  } as unknown as typeof ModelAPI;
}

function ownerPermissions(): unknown {
  const rows: Array<UserPermission> = [
    {
      permission: Permission.ProjectOwner,
      labelIds: [],
      isBlockPermission: false,
      scope: PermissionScope.All,
      _type: "UserPermission",
    },
  ];

  return {
    projectId: PROJECT_ID,
    permissions: rows,
    _type: "UserTenantAccessPermission",
  };
}

beforeEach(() => {
  isMasterAdminForTest = false;
  projectPermissionsForTest = ownerPermissions();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("looking the team up", () => {
  test("reads the project's teams, oldest first, and their permission rows", async () => {
    const calls: Array<ListCall> = [];

    const found: InviteTeam | null = await fetchDefaultInviteTeam({
      projectId: PROJECT_ID,
      modelAPI: fakeModelAPI({
        teams: [
          team(OWNERS_ID, "Owners"),
          team(ADMIN_ID, "Admin"),
          team(MEMBERS_ID, "Members"),
        ],
        permissions: [
          teamPermission(OWNERS_ID, Permission.ProjectOwner),
          teamPermission(ADMIN_ID, Permission.ProjectAdmin),
          teamPermission(MEMBERS_ID, Permission.ProjectMember),
        ],
        calls: calls,
      }),
    });

    expect(found).toEqual({ id: MEMBERS_ID, name: MEMBERS_TEAM_NAME });

    expect(calls).toHaveLength(2);

    const teamCall: ListCall = calls.find((call: ListCall): boolean => {
      return call.modelType === Team;
    })!;
    const permissionCall: ListCall = calls.find((call: ListCall): boolean => {
      return call.modelType === TeamPermission;
    })!;

    expect(teamCall.query).toEqual({ projectId: PROJECT_ID });
    expect(teamCall.sort).toEqual({ createdAt: SortOrder.Ascending });
    expect(teamCall.select).toEqual({ _id: true, name: true, createdAt: true });

    expect(permissionCall.query).toEqual({ projectId: PROJECT_ID });
    expect(permissionCall.select).toEqual({
      _id: true,
      teamId: true,
      permission: true,
      isBlockPermission: true,
      scope: true,
    });
  });

  test("asks the signed-in user's permissions whether the team may be invited to", async () => {
    projectPermissionsForTest = {
      projectId: PROJECT_ID,
      permissions: [
        {
          permission: Permission.ProjectAdmin,
          labelIds: [],
          isBlockPermission: false,
          scope: PermissionScope.All,
          _type: "UserPermission",
        },
      ],
      _type: "UserTenantAccessPermission",
    };

    const found: InviteTeam | null = await fetchDefaultInviteTeam({
      projectId: PROJECT_ID,
      modelAPI: fakeModelAPI({
        teams: [team(ADMIN_ID, "Admin"), team(MEMBERS_ID, "Members")],
        permissions: [
          teamPermission(ADMIN_ID, Permission.ProjectAdmin),
          teamPermission(MEMBERS_ID, Permission.ProjectMember),
        ],
        calls: [],
      }),
    });

    expect(found).toBeNull();
  });

  test("a master admin may invite to any team", async () => {
    isMasterAdminForTest = true;
    projectPermissionsForTest = null;

    const found: InviteTeam | null = await fetchDefaultInviteTeam({
      projectId: PROJECT_ID,
      modelAPI: fakeModelAPI({
        teams: [team(MEMBERS_ID, "Members")],
        permissions: [teamPermission(MEMBERS_ID, Permission.ProjectMember)],
        calls: [],
      }),
    });

    expect(found).toEqual({ id: MEMBERS_ID, name: "Members" });
  });

  test("a list that cannot be read makes the lookup fail, and finding the team answer none", async () => {
    await expect(
      fetchDefaultInviteTeam({
        projectId: PROJECT_ID,
        modelAPI: fakeModelAPI({ fail: true, calls: [] }),
      }),
    ).rejects.toThrow("You do not have permission to read this Team.");

    await expect(
      findDefaultInviteTeam({
        projectId: PROJECT_ID,
        modelAPI: fakeModelAPI({ fail: true, calls: [] }),
      }),
    ).resolves.toBeNull();
  });

  test("a slow server does not keep the dialog waiting", async () => {
    jest.useFakeTimers();

    const calls: Array<ListCall> = [];
    const pending: Promise<InviteTeam | null> = findDefaultInviteTeam({
      projectId: PROJECT_ID,
      modelAPI: fakeModelAPI({ never: true, calls: calls }),
    });

    jest.advanceTimersByTime(DEFAULT_INVITE_TEAM_LOOKUP_TIMEOUT_MS);

    await expect(pending).resolves.toBeNull();
    expect(calls).toHaveLength(2);
  });

  test("gives up after three seconds by default", () => {
    expect(DEFAULT_INVITE_TEAM_LOOKUP_TIMEOUT_MS).toBe(3000);
  });

  test("with no project, asks nothing", async () => {
    const calls: Array<ListCall> = [];

    await expect(
      findDefaultInviteTeam({
        projectId: null,
        modelAPI: fakeModelAPI({ calls: calls }),
      }),
    ).resolves.toBeNull();
    expect(calls).toEqual([]);
  });

  test("answers as soon as the lists arrive", async () => {
    const found: InviteTeam | null = await findDefaultInviteTeam({
      projectId: PROJECT_ID,
      timeoutInMs: 60000,
      modelAPI: fakeModelAPI({
        teams: [team(MEMBERS_ID, "Members")],
        permissions: [teamPermission(MEMBERS_ID, Permission.ProjectMember)],
        calls: [],
      }),
    });

    expect(found).toEqual({ id: MEMBERS_ID, name: "Members" });
  });
});
