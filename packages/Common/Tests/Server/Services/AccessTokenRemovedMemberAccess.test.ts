import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
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
 * A user removed from a project must lose access to it on their next request.
 *
 * Removing a membership refreshes the user's cached permissions, and the
 * refresh used to return early for a user with no team left in the project -
 * before its cache write, and without deleting anything. The entry kept
 * everything the user could do as a member, and the request middleware served
 * it for up to 30 days: a removed user could still read, acknowledge and
 * resolve incidents and post public status-page notes.
 *
 * Two changes close it, and both are pinned here:
 *   - the refresh deletes the entry when the user has no team in the project;
 *   - a cached entry is only served while the user's global permission still
 *     lists the project, which also catches entries left behind before the
 *     first change, and is verified against the memberships when it does not.
 *
 * Postgres and Redis are replaced at the module boundary by a membership table
 * and a key-value store kept in memory. The store serialises values the way
 * GlobalCache does, so what is read back has made the same round trip as in
 * Redis. AccessTokenService and UserPermissionUtil are real.
 */

interface Membership {
  userId: ObjectID;
  projectId: ObjectID;
  teamId: ObjectID;
  hasAcceptedInvitation: boolean;
}

const mockMemberships: Array<Membership> = [];
const mockTeamPermissions: Map<string, Array<Permission>> = new Map<
  string,
  Array<Permission>
>();
const mockStore: Map<string, string> = new Map<string, string>();

const mockSetJSON: jest.Mock = jest.fn();
const mockGetJSONObject: jest.Mock = jest.fn();
const mockDeleteKey: jest.Mock = jest.fn();
const mockTeamMemberFindBy: jest.Mock = jest.fn();
const mockTeamPermissionFindBy: jest.Mock = jest.fn();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the compiled
 * requires, so naming the mocks directly would capture them before their
 * initializers have run.
 */
jest.mock("../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      setJSON: (...args: Array<unknown>) => {
        return mockSetJSON(...args);
      },
      getJSONObject: (...args: Array<unknown>) => {
        return mockGetJSONObject(...args);
      },
      deleteKey: (...args: Array<unknown>) => {
        return mockDeleteKey(...args);
      },
    },
  };
});

// findAllBy pages through findBy; the in-memory table answers both in one go.
jest.mock("../../../Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (...args: Array<unknown>) => {
        return mockTeamMemberFindBy(...args);
      },
      findAllBy: (...args: Array<unknown>) => {
        return mockTeamMemberFindBy(...args);
      },
    },
  };
});

jest.mock("../../../Server/Services/TeamPermissionService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (...args: Array<unknown>) => {
        return mockTeamPermissionFindBy(...args);
      },
    },
  };
});

import AccessTokenService from "../../../Server/Services/AccessTokenService";
import UserPermissionUtil from "../../../Server/Utils/UserPermission/UserPermission";

const userId: ObjectID = ObjectID.generate();
const otherUserId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();
const otherProjectId: ObjectID = ObjectID.generate();
const membersTeamId: ObjectID = ObjectID.generate();
const ownersTeamId: ObjectID = ObjectID.generate();
const otherProjectTeamId: ObjectID = ObjectID.generate();

// What the default Members team gets: enough to acknowledge, resolve and post.
const MEMBER_ROLE: Array<Permission> = [
  Permission.ProjectMember,
  Permission.ReadProjectIncident,
  Permission.EditProjectIncident,
  Permission.CreateIncidentPublicNote,
];

const OWNER_ROLE: Array<Permission> = [Permission.ProjectOwner];

type StoreKeyFunction = (namespace: string, key: string) => string;

// The key shape GlobalCache uses in Redis.
const storeKey: StoreKeyFunction = (namespace: string, key: string): string => {
  return `${namespace}-${key}`;
};

type TenantKeyFunction = (userId: ObjectID, projectId: ObjectID) => string;

const tenantKey: TenantKeyFunction = (
  forUserId: ObjectID,
  forProjectId: ObjectID,
): string => {
  return storeKey(
    "project-permissions",
    `${forUserId.toString()}:${forProjectId.toString()}`,
  );
};

type GlobalKeyFunction = (userId: ObjectID) => string;

const globalKey: GlobalKeyFunction = (forUserId: ObjectID): string => {
  return storeKey("user", forUserId.toString());
};

type ValuesOfFunction = (queryValue: unknown) => Array<string>;

/*
 * A query column is either a plain value or QueryHelper.any(...), a TypeORM
 * Raw operator that carries its values as a named parameter.
 */
const valuesOf: ValuesOfFunction = (queryValue: unknown): Array<string> => {
  const parameters: Record<string, unknown> | undefined = (
    queryValue as { objectLiteralParameters?: Record<string, unknown> }
  )?.objectLiteralParameters;

  const values: Array<unknown> | undefined = Object.values(
    parameters || {},
  ).find((parameter: unknown) => {
    return Array.isArray(parameter);
  }) as Array<unknown> | undefined;

  return (values || [queryValue]).map((value: unknown) => {
    return String(value);
  });
};

type AddMembershipFunction = (data: {
  userId?: ObjectID;
  projectId?: ObjectID;
  teamId: ObjectID;
  hasAcceptedInvitation?: boolean;
}) => void;

const addMembership: AddMembershipFunction = (data: {
  userId?: ObjectID;
  projectId?: ObjectID;
  teamId: ObjectID;
  hasAcceptedInvitation?: boolean;
}): void => {
  mockMemberships.push({
    userId: data.userId || userId,
    projectId: data.projectId || projectId,
    teamId: data.teamId,
    hasAcceptedInvitation: data.hasAcceptedInvitation ?? true,
  });
};

type RemoveMembershipsFunction = (data: {
  userId?: ObjectID;
  projectId?: ObjectID;
  teamId?: ObjectID;
}) => void;

// Deletes the matching rows, as TeamMemberService.deleteBy does before its hook.
const removeMemberships: RemoveMembershipsFunction = (data: {
  userId?: ObjectID;
  projectId?: ObjectID;
  teamId?: ObjectID;
}): void => {
  const forUserId: ObjectID = data.userId || userId;
  const forProjectId: ObjectID = data.projectId || projectId;

  for (let i: number = mockMemberships.length - 1; i >= 0; i--) {
    const membership: Membership = mockMemberships[i]!;

    if (
      membership.userId.toString() === forUserId.toString() &&
      membership.projectId.toString() === forProjectId.toString() &&
      (!data.teamId || membership.teamId.toString() === data.teamId.toString())
    ) {
      mockMemberships.splice(i, 1);
    }
  }
};

type RefreshTokensFunction = (
  userId?: ObjectID,
  projectId?: ObjectID,
) => Promise<void>;

// What TeamMemberService.refreshTokens runs after any membership change.
const refreshTokens: RefreshTokensFunction = async (
  forUserId: ObjectID = userId,
  forProjectId: ObjectID = projectId,
): Promise<void> => {
  await AccessTokenService.refreshUserGlobalAccessPermission(forUserId);
  await AccessTokenService.refreshUserTenantAccessPermission(
    forUserId,
    forProjectId,
  );
};

type SeedStoreFunction = (key: string, value: JSONObject) => void;

const seedStore: SeedStoreFunction = (key: string, value: JSONObject): void => {
  mockStore.set(key, JSON.stringify(JSONFunctions.serialize(value)));
};

type PermissionNamesFunction = (
  permission: UserTenantAccessPermission | null | undefined,
) => Array<Permission>;

const permissionNames: PermissionNamesFunction = (
  permission: UserTenantAccessPermission | null | undefined,
): Array<Permission> => {
  return (permission?.permissions || []).map((row: UserPermission) => {
    return row.permission;
  });
};

type ProjectIdStringsFunction = (
  permission: UserGlobalAccessPermission | null,
) => Array<string>;

const projectIdStrings: ProjectIdStringsFunction = (
  permission: UserGlobalAccessPermission | null,
): Array<string> => {
  return (permission?.projectIds || []).map((id: ObjectID) => {
    return id.toString();
  });
};

type CountReadsFunction = (namespace: string) => number;

const countReads: CountReadsFunction = (namespace: string): number => {
  return mockGetJSONObject.mock.calls.filter((call: Array<unknown>) => {
    return call[0] === namespace;
  }).length;
};

describe("AccessTokenService - a user removed from a project loses access", () => {
  beforeEach(() => {
    mockMemberships.length = 0;
    mockTeamPermissions.clear();
    mockStore.clear();

    mockTeamPermissions.set(membersTeamId.toString(), MEMBER_ROLE);
    mockTeamPermissions.set(ownersTeamId.toString(), OWNER_ROLE);
    mockTeamPermissions.set(otherProjectTeamId.toString(), MEMBER_ROLE);

    for (const mock of [
      mockSetJSON,
      mockGetJSONObject,
      mockDeleteKey,
      mockTeamMemberFindBy,
      mockTeamPermissionFindBy,
    ]) {
      mock.mockReset();
    }

    mockSetJSON.mockImplementation(((
      namespace: string,
      key: string,
      value: JSONObject,
    ): Promise<void> => {
      seedStore(storeKey(namespace, key), value);
      return Promise.resolve();
    }) as never);

    mockGetJSONObject.mockImplementation(((
      namespace: string,
      key: string,
    ): Promise<JSONObject | null> => {
      const raw: string | undefined = mockStore.get(storeKey(namespace, key));

      if (!raw) {
        return Promise.resolve(null);
      }

      return Promise.resolve(
        JSONFunctions.deserialize(JSONFunctions.parse(raw) as JSONObject),
      );
    }) as never);

    mockDeleteKey.mockImplementation(((
      namespace: string,
      key: string,
    ): Promise<void> => {
      mockStore.delete(storeKey(namespace, key));
      return Promise.resolve();
    }) as never);

    mockTeamMemberFindBy.mockImplementation(((data: {
      query: {
        userId?: ObjectID;
        projectId?: ObjectID;
        hasAcceptedInvitation?: boolean;
      };
    }): Promise<Array<TeamMember>> => {
      const rows: Array<TeamMember> = mockMemberships
        .filter((membership: Membership) => {
          return (
            (data.query.userId === undefined ||
              membership.userId.toString() === data.query.userId.toString()) &&
            (data.query.projectId === undefined ||
              membership.projectId.toString() ===
                data.query.projectId.toString()) &&
            (data.query.hasAcceptedInvitation === undefined ||
              membership.hasAcceptedInvitation ===
                data.query.hasAcceptedInvitation)
          );
        })
        .map((membership: Membership) => {
          const teamMember: TeamMember = new TeamMember();
          teamMember.userId = membership.userId;
          teamMember.projectId = membership.projectId;
          teamMember.teamId = membership.teamId;
          teamMember.hasAcceptedInvitation = membership.hasAcceptedInvitation;
          return teamMember;
        });

      return Promise.resolve(rows);
    }) as never);

    mockTeamPermissionFindBy.mockImplementation(((data: {
      query: { teamId: unknown };
    }): Promise<Array<TeamPermission>> => {
      const rows: Array<TeamPermission> = [];

      for (const teamId of valuesOf(data.query.teamId)) {
        for (const permission of mockTeamPermissions.get(teamId) || []) {
          const teamPermission: TeamPermission = new TeamPermission();
          teamPermission.permission = permission;
          teamPermission.labels = [];
          teamPermission.isBlockPermission = false;
          rows.push(teamPermission);
        }
      }

      return Promise.resolve(rows);
    }) as never);
  });

  describe("removing a member", () => {
    /*
     * The customer's report: a member of the Members team is removed with
     * "Remove from Project" and can still acknowledge, resolve and post public
     * notes.
     */
    test("removing the last membership clears the cached permission, and the next lookup refuses the project", async () => {
      addMembership({ teamId: membersTeamId });
      await refreshTokens();

      const asMember: UserTenantAccessPermission | null =
        await AccessTokenService.getUserTenantAccessPermission(
          userId,
          projectId,
        );

      expect(permissionNames(asMember)).toEqual(
        expect.arrayContaining(MEMBER_ROLE),
      );
      expect(mockStore.has(tenantKey(userId, projectId))).toBe(true);

      removeMemberships({});
      await refreshTokens();

      expect(mockStore.has(tenantKey(userId, projectId))).toBe(false);
      expect(mockDeleteKey).toHaveBeenCalledWith(
        "project-permissions",
        `${userId.toString()}:${projectId.toString()}`,
      );

      const afterRemoval: UserTenantAccessPermission | null =
        await AccessTokenService.getUserTenantAccessPermission(
          userId,
          projectId,
        );

      expect(afterRemoval).toBeNull();
    });

    test("the removed user's global permission no longer lists the project", async () => {
      addMembership({ teamId: membersTeamId });
      await refreshTokens();

      expect(
        projectIdStrings(
          await AccessTokenService.getUserGlobalAccessPermission(userId),
        ),
      ).toEqual([projectId.toString()]);

      removeMemberships({});
      await refreshTokens();

      expect(
        projectIdStrings(
          await AccessTokenService.getUserGlobalAccessPermission(userId),
        ),
      ).toEqual([]);
    });

    test("a removed owner loses the owner role, not just the member one", async () => {
      addMembership({ teamId: ownersTeamId });
      await refreshTokens();

      expect(
        permissionNames(
          await AccessTokenService.getUserTenantAccessPermission(
            userId,
            projectId,
          ),
        ),
      ).toContain(Permission.ProjectOwner);

      removeMemberships({});
      await refreshTokens();

      expect(
        await AccessTokenService.getUserTenantAccessPermission(
          userId,
          projectId,
        ),
      ).toBeNull();
    });

    /*
     * Leaving one team is not leaving the project: the entry is rewritten from
     * the teams that are left rather than deleted.
     */
    test("removing one of two teams keeps the other team's role and drops the removed one", async () => {
      addMembership({ teamId: membersTeamId });
      addMembership({ teamId: ownersTeamId });
      await refreshTokens();

      expect(
        permissionNames(
          await AccessTokenService.getUserTenantAccessPermission(
            userId,
            projectId,
          ),
        ),
      ).toEqual(expect.arrayContaining([...MEMBER_ROLE, ...OWNER_ROLE]));

      removeMemberships({ teamId: ownersTeamId });
      mockDeleteKey.mockClear();
      await refreshTokens();

      expect(mockDeleteKey).not.toHaveBeenCalled();
      expect(mockStore.has(tenantKey(userId, projectId))).toBe(true);

      const remaining: Array<Permission> = permissionNames(
        await AccessTokenService.getUserTenantAccessPermission(
          userId,
          projectId,
        ),
      );

      expect(remaining).toEqual(expect.arrayContaining(MEMBER_ROLE));
      expect(remaining).not.toContain(Permission.ProjectOwner);
    });

    test("leaving one project does not touch the user's access to another", async () => {
      addMembership({ teamId: membersTeamId });
      addMembership({ projectId: otherProjectId, teamId: otherProjectTeamId });
      await refreshTokens(userId, projectId);
      await refreshTokens(userId, otherProjectId);

      removeMemberships({});
      await refreshTokens(userId, projectId);

      expect(
        await AccessTokenService.getUserTenantAccessPermission(
          userId,
          projectId,
        ),
      ).toBeNull();
      expect(
        permissionNames(
          await AccessTokenService.getUserTenantAccessPermission(
            userId,
            otherProjectId,
          ),
        ),
      ).toEqual(expect.arrayContaining(MEMBER_ROLE));
      expect(
        projectIdStrings(
          await AccessTokenService.getUserGlobalAccessPermission(userId),
        ),
      ).toEqual([otherProjectId.toString()]);
    });

    test("removing one user leaves another member of the same project alone", async () => {
      addMembership({ teamId: membersTeamId });
      addMembership({ userId: otherUserId, teamId: membersTeamId });
      await refreshTokens(userId, projectId);
      await refreshTokens(otherUserId, projectId);

      removeMemberships({});
      await refreshTokens(userId, projectId);

      expect(mockStore.has(tenantKey(otherUserId, projectId))).toBe(true);
      expect(
        permissionNames(
          await AccessTokenService.getUserTenantAccessPermission(
            otherUserId,
            projectId,
          ),
        ),
      ).toEqual(expect.arrayContaining(MEMBER_ROLE));
    });

    /*
     * Re-inviting an ex-member creates a pending row. A pending invitee has no
     * role until they accept - the old entry must not lend them their previous
     * one while the Users page says "Invitation Sent".
     */
    test("a re-invited ex-member whose invitation is still pending gets nothing", async () => {
      addMembership({ teamId: ownersTeamId });
      await refreshTokens();

      removeMemberships({});
      await refreshTokens();

      addMembership({ teamId: membersTeamId, hasAcceptedInvitation: false });
      await refreshTokens();

      expect(
        await AccessTokenService.getUserTenantAccessPermission(
          userId,
          projectId,
        ),
      ).toBeNull();
    });

    test("an ex-member who is added back gets the role of the team they rejoined, not their old one", async () => {
      addMembership({ teamId: ownersTeamId });
      await refreshTokens();

      removeMemberships({});
      await refreshTokens();

      addMembership({ teamId: membersTeamId });
      await refreshTokens();

      const rejoined: Array<Permission> = permissionNames(
        await AccessTokenService.getUserTenantAccessPermission(
          userId,
          projectId,
        ),
      );

      expect(rejoined).toEqual(expect.arrayContaining(MEMBER_ROLE));
      expect(rejoined).not.toContain(Permission.ProjectOwner);
    });

    /*
     * A non-member's lookup finds no entry and nothing to clear, so it must not
     * pay a cache write on top of the membership query.
     */
    test("a non-member's lookup of a project sends no cache delete", async () => {
      addMembership({ projectId: otherProjectId, teamId: otherProjectTeamId });
      await refreshTokens(userId, otherProjectId);
      mockDeleteKey.mockClear();
      mockSetJSON.mockClear();

      expect(
        await AccessTokenService.getUserTenantAccessPermission(
          userId,
          projectId,
        ),
      ).toBeNull();
      expect(mockDeleteKey).not.toHaveBeenCalled();
      expect(mockSetJSON).not.toHaveBeenCalled();
    });

    test("the global permission lists a project once, however many of its teams the user is in", async () => {
      addMembership({ teamId: membersTeamId });
      addMembership({ teamId: ownersTeamId });
      addMembership({ projectId: otherProjectId, teamId: otherProjectTeamId });

      expect(
        projectIdStrings(
          await AccessTokenService.refreshUserGlobalAccessPermission(userId),
        ),
      ).toEqual([projectId.toString(), otherProjectId.toString()]);
    });

    test("signing in refreshes each of the user's projects once", async () => {
      addMembership({ teamId: membersTeamId });
      addMembership({ teamId: ownersTeamId });
      addMembership({ projectId: otherProjectId, teamId: otherProjectTeamId });

      await AccessTokenService.refreshUserAllPermissions(userId);

      const tenantWrites: Array<unknown> = mockSetJSON.mock.calls
        .filter((call: Array<unknown>) => {
          return call[0] === "project-permissions";
        })
        .map((call: Array<unknown>) => {
          return call[1];
        });

      expect(tenantWrites).toEqual([
        `${userId.toString()}:${projectId.toString()}`,
        `${userId.toString()}:${otherProjectId.toString()}`,
      ]);
      expect(
        permissionNames(
          await AccessTokenService.getUserTenantAccessPermission(
            userId,
            projectId,
          ),
        ),
      ).toEqual(expect.arrayContaining([...MEMBER_ROLE, ...OWNER_ROLE]));
    });

    test("refreshing a user who was never a member is harmless", async () => {
      const permission: UserTenantAccessPermission | null =
        await AccessTokenService.refreshUserTenantAccessPermission(
          userId,
          projectId,
        );

      expect(permission).toBeNull();
      expect(mockSetJSON).not.toHaveBeenCalled();
      expect(mockStore.size).toBe(0);
    });
  });

  /*
   * Everyone removed before this fix still has an entry in Redis - and so does
   * anyone whose entry is written back by a lookup that raced their removal.
   * Nothing rewrites those entries, so they are caught where they are read.
   */
  describe("entries left behind by an earlier removal", () => {
    type LeaveStaleEntryFunction = () => Promise<void>;

    // A removal as the code used to run it: memberships and global list updated, tenant entry left as it was.
    const leaveStaleEntry: LeaveStaleEntryFunction =
      async (): Promise<void> => {
        addMembership({ teamId: membersTeamId });
        await refreshTokens();

        removeMemberships({});
        await AccessTokenService.refreshUserGlobalAccessPermission(userId);

        expect(mockStore.has(tenantKey(userId, projectId))).toBe(true);
      };

    test("a cached permission for a project the user has left is refused and cleared", async () => {
      await leaveStaleEntry();

      const permission: UserTenantAccessPermission | null =
        await AccessTokenService.getUserTenantAccessPermission(
          userId,
          projectId,
        );

      expect(permission).toBeNull();
      expect(mockStore.has(tenantKey(userId, projectId))).toBe(false);
    });

    test("once cleared, later lookups keep refusing it", async () => {
      await leaveStaleEntry();
      mockSetJSON.mockClear();

      await AccessTokenService.getUserTenantAccessPermission(userId, projectId);

      expect(
        await AccessTokenService.getUserTenantAccessPermission(
          userId,
          projectId,
        ),
      ).toBeNull();
      expect(mockSetJSON).not.toHaveBeenCalledWith(
        "project-permissions",
        expect.anything(),
        expect.anything(),
      );
    });

    test("it is refused even if the global entry has expired in the meantime", async () => {
      await leaveStaleEntry();
      mockStore.delete(globalKey(userId));

      expect(
        await AccessTokenService.getUserTenantAccessPermission(
          userId,
          projectId,
        ),
      ).toBeNull();
    });

    // Slack and Microsoft Teams actions build their props through this helper.
    test("the props built for a removed user carry no permission in the project", async () => {
      await leaveStaleEntry();

      const props: DatabaseCommonInteractionProps =
        await AccessTokenService.getDatabaseCommonInteractionPropsByUserAndProject(
          { userId, projectId },
        );

      expect(
        props.userTenantAccessPermission?.[projectId.toString()],
      ).toBeFalsy();
      expect(
        projectIdStrings(props.userGlobalAccessPermission || null),
      ).toEqual([]);
    });
  });

  /*
   * The new check must never lock out a real member. A disagreement between
   * the two entries is settled by the memberships, not by either cache.
   */
  describe("members keep their access", () => {
    test("a member whose global entry is out of date keeps access, and the global entry is repaired", async () => {
      addMembership({ teamId: membersTeamId });
      await refreshTokens();

      // A global entry written before this membership existed.
      seedStore(globalKey(userId), {
        projectIds: [],
        globalPermissions: [
          Permission.Public,
          Permission.User,
          Permission.CurrentUser,
        ],
        _type: "UserGlobalAccessPermission",
      } as unknown as JSONObject);

      const permission: UserTenantAccessPermission | null =
        await AccessTokenService.getUserTenantAccessPermission(
          userId,
          projectId,
        );

      expect(permissionNames(permission)).toEqual(
        expect.arrayContaining(MEMBER_ROLE),
      );
      expect(
        projectIdStrings(
          await AccessTokenService.getUserGlobalAccessPermission(userId),
        ),
      ).toEqual([projectId.toString()]);
    });

    test("a member with no global entry cached keeps access", async () => {
      addMembership({ teamId: membersTeamId });
      await refreshTokens();
      mockStore.delete(globalKey(userId));

      expect(
        permissionNames(
          await AccessTokenService.getUserTenantAccessPermission(
            userId,
            projectId,
          ),
        ),
      ).toEqual(expect.arrayContaining(MEMBER_ROLE));
    });

    test("a member with no tenant entry cached gets it rebuilt from their memberships", async () => {
      addMembership({ teamId: membersTeamId });
      await AccessTokenService.refreshUserGlobalAccessPermission(userId);

      expect(mockStore.has(tenantKey(userId, projectId))).toBe(false);

      expect(
        permissionNames(
          await AccessTokenService.getUserTenantAccessPermission(
            userId,
            projectId,
          ),
        ),
      ).toEqual(expect.arrayContaining(MEMBER_ROLE));
      expect(mockStore.has(tenantKey(userId, projectId))).toBe(true);
    });

    // The multi-tenant path hands over the global permission its project list came from.
    test("a member looked up with their global permission supplied keeps access", async () => {
      addMembership({ teamId: membersTeamId });
      await refreshTokens();

      const userGlobalAccessPermission: UserGlobalAccessPermission | null =
        await AccessTokenService.getUserGlobalAccessPermission(userId);

      expect(
        permissionNames(
          await AccessTokenService.getUserTenantAccessPermission(
            userId,
            projectId,
            { userGlobalAccessPermission },
          ),
        ),
      ).toEqual(expect.arrayContaining(MEMBER_ROLE));
    });

    test("a supplied null global permission is checked against the memberships rather than trusted", async () => {
      addMembership({ teamId: membersTeamId });
      await refreshTokens();

      expect(
        permissionNames(
          await AccessTokenService.getUserTenantAccessPermission(
            userId,
            projectId,
            { userGlobalAccessPermission: null },
          ),
        ),
      ).toEqual(expect.arrayContaining(MEMBER_ROLE));
    });
  });

  /*
   * Every authenticated request makes this lookup. For a member it must stay a
   * pair of cache reads - no database query, and no second read of the global
   * entry when the caller already has it.
   */
  describe("the per-request cost", () => {
    beforeEach(async () => {
      addMembership({ teamId: membersTeamId });
      await refreshTokens();

      mockTeamMemberFindBy.mockClear();
      mockTeamPermissionFindBy.mockClear();
      mockGetJSONObject.mockClear();
      mockSetJSON.mockClear();
      mockDeleteKey.mockClear();
    });

    test("a member's cached permission is served without reading their memberships", async () => {
      await AccessTokenService.getUserTenantAccessPermission(userId, projectId);

      expect(mockTeamMemberFindBy).not.toHaveBeenCalled();
      expect(mockTeamPermissionFindBy).not.toHaveBeenCalled();
      expect(mockSetJSON).not.toHaveBeenCalled();
      expect(mockDeleteKey).not.toHaveBeenCalled();
      expect(countReads("project-permissions")).toBe(1);
      expect(countReads("user")).toBe(1);
    });

    test("a supplied global permission is used instead of being read again", async () => {
      const userGlobalAccessPermission: UserGlobalAccessPermission | null =
        await AccessTokenService.getUserGlobalAccessPermission(userId);
      mockGetJSONObject.mockClear();

      await AccessTokenService.getUserTenantAccessPermission(
        userId,
        projectId,
        { userGlobalAccessPermission },
      );

      expect(countReads("user")).toBe(0);
      expect(countReads("project-permissions")).toBe(1);
      expect(mockTeamMemberFindBy).not.toHaveBeenCalled();
    });

    // The request middleware passes the promise it is already awaiting.
    test("a supplied promise of the global permission is awaited, not re-read", async () => {
      const userGlobalAccessPermission: Promise<UserGlobalAccessPermission | null> =
        AccessTokenService.getUserGlobalAccessPermission(userId);
      await userGlobalAccessPermission;
      mockGetJSONObject.mockClear();

      const permission: UserTenantAccessPermission | null =
        await AccessTokenService.getUserTenantAccessPermission(
          userId,
          projectId,
          { userGlobalAccessPermission },
        );

      expect(permissionNames(permission)).toEqual(
        expect.arrayContaining(MEMBER_ROLE),
      );
      expect(countReads("user")).toBe(0);
      expect(mockTeamMemberFindBy).not.toHaveBeenCalled();
    });
  });

  // The fallback TeamMemberService uses when refreshing a removed user fails.
  describe("clearCachedPermissions", () => {
    test("drops both entries, and a member's next lookup rebuilds them from their memberships", async () => {
      addMembership({ teamId: membersTeamId });
      await refreshTokens();

      await AccessTokenService.clearCachedPermissions(userId, projectId);

      expect(mockStore.has(globalKey(userId))).toBe(false);
      expect(mockStore.has(tenantKey(userId, projectId))).toBe(false);
      expect(
        permissionNames(
          await AccessTokenService.getUserTenantAccessPermission(
            userId,
            projectId,
          ),
        ),
      ).toEqual(expect.arrayContaining(MEMBER_ROLE));
      expect(
        projectIdStrings(
          await AccessTokenService.getUserGlobalAccessPermission(userId),
        ),
      ).toEqual([projectId.toString()]);
    });

    test("after it, a user whose membership is gone is refused", async () => {
      addMembership({ teamId: membersTeamId });
      await refreshTokens();
      removeMemberships({});

      await AccessTokenService.clearCachedPermissions(userId, projectId);

      expect(
        await AccessTokenService.getUserTenantAccessPermission(
          userId,
          projectId,
        ),
      ).toBeNull();
    });

    test("leaves the user's other projects cached", async () => {
      addMembership({ teamId: membersTeamId });
      addMembership({ projectId: otherProjectId, teamId: otherProjectTeamId });
      await refreshTokens(userId, projectId);
      await refreshTokens(userId, otherProjectId);

      await AccessTokenService.clearCachedPermissions(userId, projectId);

      expect(mockStore.has(tenantKey(userId, otherProjectId))).toBe(true);
    });
  });
});

describe("UserPermissionUtil.isProjectInGlobalAccessPermission", () => {
  type GlobalPermissionFunction = (
    projectIds: Array<ObjectID>,
  ) => UserGlobalAccessPermission;

  const globalPermission: GlobalPermissionFunction = (
    projectIds: Array<ObjectID>,
  ): UserGlobalAccessPermission => {
    return {
      projectIds,
      globalPermissions: [],
      _type: "UserGlobalAccessPermission",
    };
  };

  test("a listed project answers yes", () => {
    expect(
      UserPermissionUtil.isProjectInGlobalAccessPermission(
        globalPermission([otherProjectId, projectId]),
        projectId,
      ),
    ).toBe(true);
  });

  test("matches by value, not by ObjectID instance", () => {
    expect(
      UserPermissionUtil.isProjectInGlobalAccessPermission(
        globalPermission([new ObjectID(projectId.toString())]),
        new ObjectID(projectId.toString()),
      ),
    ).toBe(true);
  });

  test("an unlisted project answers no", () => {
    expect(
      UserPermissionUtil.isProjectInGlobalAccessPermission(
        globalPermission([otherProjectId]),
        projectId,
      ),
    ).toBe(false);
  });

  test("an empty project list answers no", () => {
    expect(
      UserPermissionUtil.isProjectInGlobalAccessPermission(
        globalPermission([]),
        projectId,
      ),
    ).toBe(false);
  });

  test("no global permission answers no", () => {
    expect(
      UserPermissionUtil.isProjectInGlobalAccessPermission(null, projectId),
    ).toBe(false);
    expect(
      UserPermissionUtil.isProjectInGlobalAccessPermission(
        undefined,
        projectId,
      ),
    ).toBe(false);
  });

  test("a global permission without a project list answers no", () => {
    expect(
      UserPermissionUtil.isProjectInGlobalAccessPermission(
        {
          globalPermissions: [],
          _type: "UserGlobalAccessPermission",
        } as unknown as UserGlobalAccessPermission,
        projectId,
      ),
    ).toBe(false);
  });
});
