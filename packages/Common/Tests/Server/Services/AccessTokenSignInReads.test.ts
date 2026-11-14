import Label from "../../../Models/DatabaseModels/Label";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A SIGN-IN READS TWO THINGS, HOWEVER MANY PROJECTS THE PERSON IS IN.
 *
 * Every sign-in rebuilds the person's permission set in every project they
 * are in (AccessTokenService.refreshUserAllPermissions). It used to read
 * their memberships, then each project's memberships and permission rows in
 * turn, writing each project's set before reading the next: three
 * statements a project, one after another - 901 for someone in 300
 * projects, each waiting for a connection, so with the pool busy their
 * sign-in timed out. Now it reads their memberships once and every
 * permission row of their teams once, builds each project's set in memory,
 * and writes the sets together.
 *
 * Pinned here: the reads it makes, for one project, ten and three hundred;
 * that every set it writes is the set refreshUserTenantAccessPermission -
 * the per-project path, unchanged - builds for that project, for the role
 * and label combinations the permission suites cover (owners, members,
 * custom roles, label-limited rows, blocks, Owned rows, a person in several
 * teams of a project, teams of other projects); that the writes are sent
 * together and the announcement made once, after them; and the batch read a
 * request across projects makes (getUserTenantAccessPermissions), answered
 * as getUserTenantAccessPermission answers each project.
 *
 * Postgres and Redis are replaced at the module boundary by tables and a
 * key-value store kept in memory, which answer the queries the service
 * builds (QueryHelper.any included) and keep values as GlobalCache keeps
 * them. The real Postgres statement counts are SignInStatementsPostgres.
 */

interface Membership {
  userId: ObjectID;
  projectId: ObjectID;
  teamId: ObjectID;
  hasAcceptedInvitation: boolean;
}

interface PermissionRow {
  projectId: ObjectID;
  teamId: ObjectID;
  permission: Permission;
  isBlockPermission: boolean;
  scope: PermissionScope;
  labelIds: Array<ObjectID>;
  // Newest first, as findBy orders its rows by createdAt.
  createdAt: number;
}

const mockMemberships: Array<Membership> = [];
const mockPermissionRows: Array<PermissionRow> = [];
const mockStore: Map<string, string> = new Map<string, string>();

const mockReads: Array<string> = [];
const mockWrites: Array<{ kind: "set" | "delete"; key: string }> = [];
const mockAnnounce: jest.Mock = jest.fn();

// When set, every cache write waits for it: the writes in flight at once.
let mockHoldWrites: Promise<void> | null = null;

type ValuesOfFunction = (queryValue: unknown) => Array<string> | null;

/*
 * A query column is a plain value or QueryHelper.any(...), a TypeORM Raw
 * operator carrying its values as a named parameter. Null for no condition.
 */
const mockValuesOf: ValuesOfFunction = (
  queryValue: unknown,
): Array<string> | null => {
  if (queryValue === undefined) {
    return null;
  }

  const parameters: Record<string, unknown> | undefined = (
    queryValue as { objectLiteralParameters?: Record<string, unknown> }
  )?.objectLiteralParameters;

  if (parameters) {
    const values: Array<unknown> =
      (Object.values(parameters).find((parameter: unknown) => {
        return Array.isArray(parameter);
      }) as Array<unknown> | undefined) || [];

    return values.map((value: unknown) => {
      return String(value).toLowerCase();
    });
  }

  return [String(queryValue).toLowerCase()];
};

type MatchesFunction = (
  asked: Array<string> | null,
  value: ObjectID,
) => boolean;

const mockMatches: MatchesFunction = (
  asked: Array<string> | null,
  value: ObjectID,
): boolean => {
  return asked === null || asked.includes(value.toString().toLowerCase());
};

type FindMembersFunction = (
  kind: string,
) => (data: { query: Record<string, unknown> }) => Promise<Array<TeamMember>>;

const mockFindMembers: FindMembersFunction = (kind: string) => {
  return async (data: {
    query: Record<string, unknown>;
  }): Promise<Array<TeamMember>> => {
    mockReads.push(`TeamMember.${kind}`);

    const userIds: Array<string> | null = mockValuesOf(data.query["userId"]);
    const projectIds: Array<string> | null = mockValuesOf(
      data.query["projectId"],
    );
    const accepted: unknown = data.query["hasAcceptedInvitation"];

    return mockMemberships
      .filter((membership: Membership): boolean => {
        return (
          mockMatches(userIds, membership.userId) &&
          mockMatches(projectIds, membership.projectId) &&
          (accepted === undefined ||
            membership.hasAcceptedInvitation === accepted)
        );
      })
      .map((membership: Membership): TeamMember => {
        const row: TeamMember = new TeamMember();
        row.userId = membership.userId;
        row.projectId = membership.projectId;
        row.teamId = membership.teamId;
        return row;
      });
  };
};

type FindPermissionsFunction = (
  kind: string,
) => (data: {
  query: Record<string, unknown>;
}) => Promise<Array<TeamPermission>>;

const mockFindPermissions: FindPermissionsFunction = (kind: string) => {
  return async (data: {
    query: Record<string, unknown>;
  }): Promise<Array<TeamPermission>> => {
    mockReads.push(`TeamPermission.${kind}`);

    const teamIds: Array<string> | null = mockValuesOf(data.query["teamId"]);
    const projectIds: Array<string> | null = mockValuesOf(
      data.query["projectId"],
    );

    return mockPermissionRows
      .filter((row: PermissionRow): boolean => {
        return (
          mockMatches(teamIds, row.teamId) &&
          mockMatches(projectIds, row.projectId)
        );
      })
      .sort((a: PermissionRow, b: PermissionRow): number => {
        return b.createdAt - a.createdAt;
      })
      .map((row: PermissionRow): TeamPermission => {
        const teamPermission: TeamPermission = new TeamPermission();
        teamPermission.projectId = row.projectId;
        teamPermission.teamId = row.teamId;
        teamPermission.permission = row.permission;
        teamPermission.isBlockPermission = row.isBlockPermission;
        teamPermission.scope = row.scope;
        teamPermission.labels = row.labelIds.map((labelId: ObjectID) => {
          const label: Label = new Label();
          label.id = labelId;
          return label;
        });
        return teamPermission;
      });
  };
};

type StoreKeyFunction = (namespace: string, key: string) => string;

const mockStoreKey: StoreKeyFunction = (
  namespace: string,
  key: string,
): string => {
  return `${namespace}-${key}`;
};

type ReadStoreFunction = (namespace: string, key: string) => JSONObject | null;

const mockReadStore: ReadStoreFunction = (
  namespace: string,
  key: string,
): JSONObject | null => {
  const raw: string | undefined = mockStore.get(mockStoreKey(namespace, key));

  return raw
    ? (JSONFunctions.deserialize(
        JSONFunctions.parse(raw) as JSONObject,
      ) as JSONObject | null)
    : null;
};

jest.mock("../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      setJSON: async (
        namespace: string,
        key: string,
        value: JSONObject,
      ): Promise<void> => {
        mockWrites.push({ kind: "set", key: mockStoreKey(namespace, key) });

        if (mockHoldWrites) {
          await mockHoldWrites;
        }

        mockStore.set(
          mockStoreKey(namespace, key),
          JSON.stringify(JSONFunctions.serialize(value)),
        );
      },
      deleteKey: async (namespace: string, key: string): Promise<void> => {
        mockWrites.push({ kind: "delete", key: mockStoreKey(namespace, key) });

        if (mockHoldWrites) {
          await mockHoldWrites;
        }

        mockStore.delete(mockStoreKey(namespace, key));
      },
      getJSONObject: async (
        namespace: string,
        key: string,
      ): Promise<JSONObject | null> => {
        mockReads.push("cache.get");
        return mockReadStore(namespace, key);
      },
      getJSONObjects: async (
        namespace: string,
        keys: Array<string>,
      ): Promise<Array<JSONObject | null>> => {
        mockReads.push("cache.mget");
        return keys.map((key: string) => {
          return mockReadStore(namespace, key);
        });
      },
    },
  };
});

jest.mock("../../../Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (data: { query: Record<string, unknown> }) => {
        return mockFindMembers("findBy")(data);
      },
      findAllBy: (data: { query: Record<string, unknown> }) => {
        return mockFindMembers("findAllBy")(data);
      },
    },
  };
});

jest.mock("../../../Server/Services/TeamPermissionService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (data: { query: Record<string, unknown> }) => {
        return mockFindPermissions("findBy")(data);
      },
      findAllBy: (data: { query: Record<string, unknown> }) => {
        return mockFindPermissions("findAllBy")(data);
      },
    },
  };
});

jest.mock("../../../Server/Utils/Realtime/RealtimeAccessChanges", () => {
  return {
    __esModule: true,
    RealtimeAccessChangeKind: {
      PermissionsChanged: "PermissionsChanged",
    },
    default: {
      announce: (...args: Array<unknown>) => {
        return mockAnnounce(...args);
      },
    },
  };
});

import AccessTokenService from "../../../Server/Services/AccessTokenService";

const USER: ObjectID = new ObjectID("a1000000-0000-4000-8000-000000000001");
const OTHER_USER: ObjectID = new ObjectID(
  "a1000000-0000-4000-8000-000000000002",
);

let nextCreatedAt: number = 0;
let nextId: number = 0x1000;

type NewIdFunction = () => ObjectID;

const newId: NewIdFunction = (): ObjectID => {
  nextId++;
  return new ObjectID(
    `b2000000-0000-4000-8000-${nextId.toString(16).padStart(12, "0")}`,
  );
};

type GrantFunction = (data: {
  projectId: ObjectID;
  teamId: ObjectID;
  permission: Permission;
  isBlockPermission?: boolean;
  scope?: PermissionScope;
  labelIds?: Array<ObjectID>;
}) => void;

const grant: GrantFunction = (data: {
  projectId: ObjectID;
  teamId: ObjectID;
  permission: Permission;
  isBlockPermission?: boolean;
  scope?: PermissionScope;
  labelIds?: Array<ObjectID>;
}): void => {
  mockPermissionRows.push({
    projectId: data.projectId,
    teamId: data.teamId,
    permission: data.permission,
    isBlockPermission: data.isBlockPermission || false,
    scope: data.scope || PermissionScope.All,
    labelIds: data.labelIds || [],
    createdAt: nextCreatedAt++,
  });
};

type JoinFunction = (data: {
  userId?: ObjectID;
  projectId: ObjectID;
  teamId: ObjectID;
  hasAcceptedInvitation?: boolean;
}) => void;

const join: JoinFunction = (data: {
  userId?: ObjectID;
  projectId: ObjectID;
  teamId: ObjectID;
  hasAcceptedInvitation?: boolean;
}): void => {
  mockMemberships.push({
    userId: data.userId || USER,
    projectId: data.projectId,
    teamId: data.teamId,
    hasAcceptedInvitation: data.hasAcceptedInvitation ?? true,
  });
};

/*
 * A project as the permission suites set one up: its Owners and Members
 * teams with their roles, a custom role whose rows are limited to labels
 * and block another, an Owned-scope team - and a team of the person's they
 * are invited to and have not accepted.
 */
interface SeededProject {
  projectId: ObjectID;
  ownersTeamId: ObjectID;
  membersTeamId: ObjectID;
  customRoleTeamId: ObjectID;
  ownedScopeTeamId: ObjectID;
  pendingTeamId: ObjectID;
}

type SeedProjectFunction = () => SeededProject;

const seedProject: SeedProjectFunction = (): SeededProject => {
  const project: SeededProject = {
    projectId: newId(),
    ownersTeamId: newId(),
    membersTeamId: newId(),
    customRoleTeamId: newId(),
    ownedScopeTeamId: newId(),
    pendingTeamId: newId(),
  };

  const labelA: ObjectID = newId();
  const labelB: ObjectID = newId();

  grant({
    projectId: project.projectId,
    teamId: project.ownersTeamId,
    permission: Permission.ProjectOwner,
  });

  for (const permission of [
    Permission.ProjectMember,
    Permission.ReadProjectIncident,
    Permission.EditProjectIncident,
    Permission.CreateIncidentPublicNote,
  ]) {
    grant({
      projectId: project.projectId,
      teamId: project.membersTeamId,
      permission,
    });
  }

  grant({
    projectId: project.projectId,
    teamId: project.customRoleTeamId,
    permission: Permission.ReadProjectMonitor,
    scope: PermissionScope.Labels,
    labelIds: [labelA, labelB],
  });
  grant({
    projectId: project.projectId,
    teamId: project.customRoleTeamId,
    permission: Permission.EditProjectMonitor,
    scope: PermissionScope.Labels,
    labelIds: [labelB],
  });
  grant({
    projectId: project.projectId,
    teamId: project.customRoleTeamId,
    permission: Permission.DeleteProjectMonitor,
    isBlockPermission: true,
  });
  grant({
    projectId: project.projectId,
    teamId: project.ownedScopeTeamId,
    permission: Permission.EditProjectIncident,
    scope: PermissionScope.Owned,
  });
  grant({
    projectId: project.projectId,
    teamId: project.pendingTeamId,
    permission: Permission.ProjectAdmin,
  });

  return project;
};

type PermissionsOfFunction = (
  permission: UserTenantAccessPermission | null | undefined,
) => Array<UserPermission>;

// The rows of a set as they are kept in the cache: ids as their text.
const permissionsOf: PermissionsOfFunction = (
  permission: UserTenantAccessPermission | null | undefined,
): Array<UserPermission> => {
  if (!permission) {
    return [];
  }

  const rows: Array<UserPermission> = (
    JSON.parse(JSON.stringify(JSONFunctions.serialize(permission))) as {
      permissions?: Array<UserPermission>;
    }
  ).permissions as Array<UserPermission>;

  expect(Array.isArray(rows)).toBe(true);

  return rows;
};

type IdTextFunction = (id: unknown) => string;

// A serialised id ({ _type: "ObjectID", value }) or an id, as its text.
const idText: IdTextFunction = (id: unknown): string => {
  const value: unknown = (id as { value?: unknown } | null)?.value;
  return String(value !== undefined ? value : id);
};

type TenantKeyFunction = (userId: ObjectID, projectId: ObjectID) => string;

const tenantKey: TenantKeyFunction = (
  userId: ObjectID,
  projectId: ObjectID,
): string => {
  return mockStoreKey(
    "project-permissions",
    `${userId.toString()}:${projectId.toString()}`,
  );
};

type CachedSetFunction = (
  userId: ObjectID,
  projectId: ObjectID,
) => UserTenantAccessPermission | null;

const cachedSet: CachedSetFunction = (
  userId: ObjectID,
  projectId: ObjectID,
): UserTenantAccessPermission | null => {
  return mockReadStore(
    "project-permissions",
    `${userId.toString()}:${projectId.toString()}`,
  ) as UserTenantAccessPermission | null;
};

/*
 * What the per-project path builds for the project, unchanged by this work:
 * the set every sign-in used to write, project by project.
 */
type PerProjectSetFunction = (
  projectId: ObjectID,
) => Promise<UserTenantAccessPermission | null>;

const perProjectSet: PerProjectSetFunction = async (
  projectId: ObjectID,
): Promise<UserTenantAccessPermission | null> => {
  const saved: Map<string, string> = new Map(mockStore);

  try {
    return await AccessTokenService.refreshUserTenantAccessPermission(
      USER,
      projectId,
      { forgetLiveUpdateReaders: false },
    );
  } finally {
    mockStore.clear();

    for (const [key, value] of saved) {
      mockStore.set(key, value);
    }
  }
};

type JoinEveryTeamFunction = (project: SeededProject) => void;

// The person in every team of the project; the last one an invitation.
const joinEveryTeam: JoinEveryTeamFunction = (project: SeededProject): void => {
  join({ projectId: project.projectId, teamId: project.ownersTeamId });
  join({ projectId: project.projectId, teamId: project.membersTeamId });
  join({ projectId: project.projectId, teamId: project.customRoleTeamId });
  join({ projectId: project.projectId, teamId: project.ownedScopeTeamId });
  join({
    projectId: project.projectId,
    teamId: project.pendingTeamId,
    hasAcceptedInvitation: false,
  });
};

beforeEach(() => {
  mockMemberships.length = 0;
  mockPermissionRows.length = 0;
  mockStore.clear();
  mockReads.length = 0;
  mockWrites.length = 0;
  mockAnnounce.mockReset();
  mockHoldWrites = null;
  nextCreatedAt = 0;
});

describe("a sign-in reads the person's memberships once and their teams' permission rows once", () => {
  for (const projectCount of [1, 10, 300]) {
    test(`in ${projectCount} project(s): two reads, and a set written for every project`, async () => {
      const projects: Array<SeededProject> = [];

      for (let i: number = 0; i < projectCount; i++) {
        const project: SeededProject = seedProject();
        joinEveryTeam(project);
        projects.push(project);
      }

      // Someone else, in one of the same projects: none of theirs is read.
      join({
        userId: OTHER_USER,
        projectId: projects[0]!.projectId,
        teamId: projects[0]!.ownersTeamId,
      });

      await AccessTokenService.refreshUserAllPermissions(USER);

      expect(mockReads).toEqual([
        "TeamMember.findAllBy",
        "TeamPermission.findAllBy",
      ]);

      const global: UserGlobalAccessPermission = mockReadStore(
        "user",
        USER.toString(),
      ) as UserGlobalAccessPermission;

      expect(
        global.projectIds.map((projectId: ObjectID) => {
          return projectId.toString();
        }),
      ).toEqual(
        projects.map((project: SeededProject) => {
          return project.projectId.toString();
        }),
      );

      // The global set and one per project.
      expect(mockWrites).toHaveLength(projectCount + 1);

      for (const project of projects) {
        expect(cachedSet(USER, project.projectId)).not.toBeNull();
      }

      expect(cachedSet(OTHER_USER, projects[0]!.projectId)).toBeNull();
    });
  }

  test("main issued three reads a project: the per-project path still does, one project at a time", async () => {
    const project: SeededProject = seedProject();
    joinEveryTeam(project);

    await AccessTokenService.refreshUserTenantAccessPermission(
      USER,
      project.projectId,
    );

    // Its memberships, and the permission rows of its teams.
    expect(mockReads).toEqual([
      "TeamMember.findBy",
      "TeamPermission.findAllBy",
    ]);
  });

  test("someone in no project: their global set lists none, and no permission row is read", async () => {
    await AccessTokenService.refreshUserAllPermissions(USER);

    expect(mockReads).toEqual(["TeamMember.findAllBy"]);
    expect(
      (mockReadStore("user", USER.toString()) as UserGlobalAccessPermission)
        .projectIds,
    ).toEqual([]);
    expect(mockAnnounce).toHaveBeenCalledTimes(1);
  });

  test("someone only invited, never accepted: in no project, as before", async () => {
    const project: SeededProject = seedProject();
    join({
      projectId: project.projectId,
      teamId: project.ownersTeamId,
      hasAcceptedInvitation: false,
    });

    await AccessTokenService.refreshUserAllPermissions(USER);

    expect(
      (mockReadStore("user", USER.toString()) as UserGlobalAccessPermission)
        .projectIds,
    ).toEqual([]);
    expect(cachedSet(USER, project.projectId)).toBeNull();
  });
});

describe("every set a sign-in writes is the set the per-project path builds", () => {
  test("in every project, row for row and in the same order", async () => {
    const projects: Array<SeededProject> = [];

    for (let i: number = 0; i < 12; i++) {
      projects.push(seedProject());
    }

    // A different mix of teams in each project.
    projects.forEach((project: SeededProject, index: number): void => {
      if (index % 2 === 0) {
        join({ projectId: project.projectId, teamId: project.ownersTeamId });
      }

      if (index % 3 !== 0) {
        join({ projectId: project.projectId, teamId: project.membersTeamId });
      }

      if (index % 4 === 1) {
        join({
          projectId: project.projectId,
          teamId: project.customRoleTeamId,
        });
      }

      if (index % 5 === 2) {
        join({
          projectId: project.projectId,
          teamId: project.ownedScopeTeamId,
        });
      }

      // The custom role only, or nothing accepted at all.
      if (index === 9) {
        join({
          projectId: project.projectId,
          teamId: project.customRoleTeamId,
        });
      }

      join({
        projectId: project.projectId,
        teamId: project.pendingTeamId,
        hasAcceptedInvitation: false,
      });
    });

    const expected: Map<string, UserTenantAccessPermission | null> = new Map();

    for (const project of projects) {
      expected.set(
        project.projectId.toString(),
        await perProjectSet(project.projectId),
      );
    }

    await AccessTokenService.refreshUserAllPermissions(USER);

    for (const project of projects) {
      const before: UserTenantAccessPermission | null =
        expected.get(project.projectId.toString()) || null;

      expect(permissionsOf(cachedSet(USER, project.projectId))).toEqual(
        permissionsOf(before),
      );
    }

    // Some project of each kind was seen: labels, blocks, Owned rows, several teams.
    const allRows: Array<UserPermission> = projects.flatMap(
      (project: SeededProject) => {
        return permissionsOf(cachedSet(USER, project.projectId));
      },
    );

    expect(
      allRows.some((row: UserPermission) => {
        return row.labelIds.length === 2;
      }),
    ).toBe(true);
    expect(
      allRows.some((row: UserPermission) => {
        return row.isBlockPermission === true;
      }),
    ).toBe(true);
    expect(
      allRows.some((row: UserPermission) => {
        return row.scope === PermissionScope.Owned;
      }),
    ).toBe(true);
  });

  test("each set carries ProjectUser and the defaults, and each row names the team it is granted on", async () => {
    const project: SeededProject = seedProject();
    join({ projectId: project.projectId, teamId: project.customRoleTeamId });

    await AccessTokenService.refreshUserAllPermissions(USER);

    const rows: Array<UserPermission> = permissionsOf(
      cachedSet(USER, project.projectId),
    );

    expect(
      rows.map((row: UserPermission) => {
        return row.permission;
      }),
    ).toEqual([
      Permission.CurrentUser,
      Permission.UnAuthorizedSsoUser,
      Permission.DeleteProjectMonitor,
      Permission.EditProjectMonitor,
      Permission.ReadProjectMonitor,
      Permission.ProjectUser,
    ]);

    for (const row of rows.slice(2, 5)) {
      expect(idText(row.teamId)).toBe(project.customRoleTeamId.toString());
    }

    expect(
      rows[4]!.labelIds.map((labelId: unknown) => {
        return idText(labelId);
      }),
    ).toHaveLength(2);
  });

  test("a row granted in another project than its team's is not counted, as a read of one project would not count it", async () => {
    const project: SeededProject = seedProject();
    const other: SeededProject = seedProject();

    join({ projectId: project.projectId, teamId: project.ownersTeamId });
    join({ projectId: other.projectId, teamId: other.membersTeamId });

    // A row of the owners team, written into the other project.
    grant({
      projectId: other.projectId,
      teamId: project.ownersTeamId,
      permission: Permission.ProjectAdmin,
    });

    const expectedProject: UserTenantAccessPermission | null =
      await perProjectSet(project.projectId);
    const expectedOther: UserTenantAccessPermission | null =
      await perProjectSet(other.projectId);

    await AccessTokenService.refreshUserAllPermissions(USER);

    expect(permissionsOf(cachedSet(USER, project.projectId))).toEqual(
      permissionsOf(expectedProject),
    );
    expect(permissionsOf(cachedSet(USER, other.projectId))).toEqual(
      permissionsOf(expectedOther),
    );
    expect(
      permissionsOf(cachedSet(USER, other.projectId)).some(
        (row: UserPermission) => {
          return row.permission === Permission.ProjectAdmin;
        },
      ),
    ).toBe(false);
  });

  test("a project left since the last sign-in keeps its old entry for the read path to refuse, as before", async () => {
    const project: SeededProject = seedProject();
    const left: SeededProject = seedProject();
    join({ projectId: project.projectId, teamId: project.ownersTeamId });

    mockStore.set(
      tenantKey(USER, left.projectId),
      JSON.stringify({ _type: "UserTenantAccessPermission", permissions: [] }),
    );

    await AccessTokenService.refreshUserAllPermissions(USER);

    // Not listed: getUserTenantAccessPermission refuses and clears it.
    expect(
      (
        mockReadStore("user", USER.toString()) as UserGlobalAccessPermission
      ).projectIds.map((projectId: ObjectID) => {
        return projectId.toString();
      }),
    ).toEqual([project.projectId.toString()]);
    expect(
      await AccessTokenService.getUserTenantAccessPermission(
        USER,
        left.projectId,
      ),
    ).toBeNull();
    expect(mockStore.has(tenantKey(USER, left.projectId))).toBe(false);
  });
});

describe("the writes", () => {
  test("are all sent before any is answered, and the one announcement follows them", async () => {
    const projects: Array<SeededProject> = [
      seedProject(),
      seedProject(),
      seedProject(),
    ];

    for (const project of projects) {
      join({ projectId: project.projectId, teamId: project.membersTeamId });
    }

    let release: () => void = () => {};
    mockHoldWrites = new Promise<void>((resolve: () => void) => {
      release = resolve;
    });

    const signIn: Promise<void> =
      AccessTokenService.refreshUserAllPermissions(USER);

    for (let tick: number = 0; tick < 50 && mockWrites.length < 4; tick++) {
      await Promise.resolve();
    }

    // Every write in flight at once, none answered, nothing announced yet.
    expect(mockWrites).toHaveLength(4);
    expect(mockAnnounce).not.toHaveBeenCalled();

    release();
    await signIn;

    expect(mockAnnounce).toHaveBeenCalledTimes(1);
    expect(mockAnnounce).toHaveBeenCalledWith({
      kind: "PermissionsChanged",
      userId: USER.toString(),
    });
  });

  test("the global set comes first, then each project in the order the global set lists it", async () => {
    const first: SeededProject = seedProject();
    const second: SeededProject = seedProject();
    join({ projectId: first.projectId, teamId: first.membersTeamId });
    join({ projectId: second.projectId, teamId: second.membersTeamId });

    await AccessTokenService.refreshUserAllPermissions(USER);

    expect(
      mockWrites.map((write: { key: string }) => {
        return write.key;
      }),
    ).toEqual([
      mockStoreKey("user", USER.toString()),
      tenantKey(USER, first.projectId),
      tenantKey(USER, second.projectId),
    ]);
  });

  test("a write that fails fails the sign-in, and nothing is announced", async () => {
    const project: SeededProject = seedProject();
    join({ projectId: project.projectId, teamId: project.membersTeamId });

    mockHoldWrites = Promise.reject(new Error("cache unavailable"));
    mockHoldWrites.catch(() => {
      return undefined;
    });

    await expect(
      AccessTokenService.refreshUserAllPermissions(USER),
    ).rejects.toThrow("cache unavailable");
    expect(mockAnnounce).not.toHaveBeenCalled();
  });
});

describe("a request across projects reads every project's set at once (getUserTenantAccessPermissions)", () => {
  type ListedFunction = (projects: Array<SeededProject>) => void;

  // The global set as a sign-in writes it.
  const listed: ListedFunction = (projects: Array<SeededProject>): void => {
    mockStore.set(
      mockStoreKey("user", USER.toString()),
      JSON.stringify(
        JSONFunctions.serialize({
          _type: "UserGlobalAccessPermission",
          projectIds: projects.map((project: SeededProject) => {
            return project.projectId;
          }),
          globalPermissions: [],
        }),
      ),
    );
  };

  test("with every set cached: one read of the cache, nothing from the database", async () => {
    const projects: Array<SeededProject> = [];

    for (let i: number = 0; i < 300; i++) {
      const project: SeededProject = seedProject();
      join({ projectId: project.projectId, teamId: project.membersTeamId });
      projects.push(project);
    }

    await AccessTokenService.refreshUserAllPermissions(USER);
    mockReads.length = 0;
    mockWrites.length = 0;

    const sets: Map<string, UserTenantAccessPermission | null> =
      await AccessTokenService.getUserTenantAccessPermissions(
        USER,
        projects.map((project: SeededProject) => {
          return project.projectId;
        }),
      );

    expect(mockReads).toEqual(["cache.mget", "cache.get"]);
    expect(mockWrites).toEqual([]);
    expect(sets.size).toBe(300);

    for (const project of projects) {
      expect(
        permissionsOf(sets.get(project.projectId.toString().toLowerCase())),
      ).toEqual(permissionsOf(cachedSet(USER, project.projectId)));
    }
  });

  test("with nothing cached: two reads from the database for all of them, and each set kept", async () => {
    const projects: Array<SeededProject> = [];

    for (let i: number = 0; i < 300; i++) {
      const project: SeededProject = seedProject();
      joinEveryTeam(project);
      projects.push(project);
    }

    listed(projects);

    const expected: Map<string, UserTenantAccessPermission | null> = new Map();

    for (const project of projects.slice(0, 5)) {
      expected.set(
        project.projectId.toString(),
        await perProjectSet(project.projectId),
      );
    }

    mockReads.length = 0;

    const sets: Map<string, UserTenantAccessPermission | null> =
      await AccessTokenService.getUserTenantAccessPermissions(
        USER,
        projects.map((project: SeededProject) => {
          return project.projectId;
        }),
      );

    expect(mockReads).toEqual([
      "cache.mget",
      "cache.get",
      "TeamMember.findAllBy",
      "TeamPermission.findAllBy",
    ]);

    for (const project of projects) {
      expect(cachedSet(USER, project.projectId)).not.toBeNull();
    }

    for (const project of projects.slice(0, 5)) {
      expect(
        permissionsOf(sets.get(project.projectId.toString().toLowerCase())),
      ).toEqual(permissionsOf(expected.get(project.projectId.toString())));
    }
  });

  test("each project is answered as getUserTenantAccessPermission answers it", async () => {
    // Cached and listed; missing; cached but unlisted, still a member; cached but unlisted, gone; missing, not a member.
    const cachedListed: SeededProject = seedProject();
    const missing: SeededProject = seedProject();
    const unlistedMember: SeededProject = seedProject();
    const unlistedGone: SeededProject = seedProject();
    const missingNonMember: SeededProject = seedProject();

    for (const project of [cachedListed, missing, unlistedMember]) {
      join({ projectId: project.projectId, teamId: project.membersTeamId });
    }

    const stale: string = JSON.stringify(
      JSONFunctions.serialize({
        _type: "UserTenantAccessPermission",
        projectId: unlistedGone.projectId,
        permissions: [
          {
            _type: "UserPermission",
            permission: Permission.ProjectOwner,
            labelIds: [],
            isBlockPermission: false,
            teamId: unlistedGone.ownersTeamId,
          },
        ],
      }),
    );

    type ScenarioFunction = () => Promise<void>;

    const setUp: ScenarioFunction = async (): Promise<void> => {
      mockStore.clear();
      await AccessTokenService.refreshUserAllPermissions(USER);
      listed([cachedListed, missing]);
      mockStore.delete(tenantKey(USER, missing.projectId));
      mockStore.set(
        tenantKey(USER, unlistedMember.projectId),
        mockStore.get(tenantKey(USER, cachedListed.projectId))!,
      );
      mockStore.set(tenantKey(USER, unlistedGone.projectId), stale);
    };

    const asked: Array<ObjectID> = [
      cachedListed.projectId,
      missing.projectId,
      unlistedMember.projectId,
      unlistedGone.projectId,
      missingNonMember.projectId,
    ];

    // One project at a time, as before.
    await setUp();

    const one: Map<string, UserTenantAccessPermission | null> = new Map();

    for (const projectId of asked) {
      one.set(
        projectId.toString().toLowerCase(),
        await AccessTokenService.getUserTenantAccessPermission(USER, projectId),
      );
    }

    const storeAfterOne: Map<string, string> = new Map(mockStore);

    // All at once.
    await setUp();

    const all: Map<string, UserTenantAccessPermission | null> =
      await AccessTokenService.getUserTenantAccessPermissions(USER, asked);

    for (const projectId of asked) {
      const key: string = projectId.toString().toLowerCase();
      expect(Boolean(all.get(key))).toBe(Boolean(one.get(key)));
      expect(permissionsOf(all.get(key))).toEqual(permissionsOf(one.get(key)));
    }

    expect(all.get(unlistedGone.projectId.toString().toLowerCase())).toBe(null);
    expect(all.get(missingNonMember.projectId.toString().toLowerCase())).toBe(
      null,
    );

    // The cache is left as the per-project path leaves it: the stale set cleared, the global list repaired.
    expect(new Set(mockStore.keys())).toEqual(new Set(storeAfterOne.keys()));
    expect(mockStore.has(tenantKey(USER, unlistedGone.projectId))).toBe(false);
    expect(
      (
        mockReadStore("user", USER.toString()) as UserGlobalAccessPermission
      ).projectIds.map((projectId: ObjectID) => {
        return projectId.toString();
      }),
    ).toContain(unlistedMember.projectId.toString());
  });

  test("a project asked twice is read and answered once", async () => {
    const project: SeededProject = seedProject();
    join({ projectId: project.projectId, teamId: project.membersTeamId });
    listed([project]);

    const sets: Map<string, UserTenantAccessPermission | null> =
      await AccessTokenService.getUserTenantAccessPermissions(USER, [
        project.projectId,
        new ObjectID(project.projectId.toString().toUpperCase()),
      ]);

    expect(sets.size).toBe(1);
    expect(
      mockWrites.filter((write: { key: string }) => {
        return write.key.startsWith("project-permissions-");
      }),
    ).toHaveLength(1);
  });

  test("no projects: nothing is read", async () => {
    expect(
      (await AccessTokenService.getUserTenantAccessPermissions(USER, [])).size,
    ).toBe(0);
    expect(mockReads).toEqual([]);
  });

  test("a supplied global permission is used, not read again", async () => {
    const project: SeededProject = seedProject();
    join({ projectId: project.projectId, teamId: project.membersTeamId });
    await AccessTokenService.refreshUserAllPermissions(USER);
    mockReads.length = 0;

    await AccessTokenService.getUserTenantAccessPermissions(
      USER,
      [project.projectId],
      {
        userGlobalAccessPermission: mockReadStore(
          "user",
          USER.toString(),
        ) as UserGlobalAccessPermission,
      },
    );

    expect(mockReads).toEqual(["cache.mget"]);
  });
});
