import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import logger from "../../../Server/Utils/Logger";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The wiring behind "Remove from Project", "Leave team", deleting a team and
 * SCIM deprovisioning: each deletes TeamMember rows, and TeamMemberService's
 * delete hook refreshes the user's cached permissions. These drive the real
 * hook, the real refreshTokens and the real AccessTokenService, and check the
 * outcome the customer cares about - whether the removed user can still act
 * in the project on their next request.
 *
 * Postgres (the TeamMember and TeamPermission reads) and Redis (GlobalCache)
 * are replaced by in-memory stand-ins. The hook's unrelated side effects -
 * billing seats, on-call cleanup, notification settings - are stubbed; they
 * have suites of their own.
 */

interface Membership {
  id: ObjectID;
  userId: ObjectID;
  projectId: ObjectID;
  teamId: ObjectID;
  hasAcceptedInvitation: boolean;
}

const projectId: ObjectID = ObjectID.generate();
const aliceId: ObjectID = ObjectID.generate();
const bobId: ObjectID = ObjectID.generate();
const membersTeamId: ObjectID = ObjectID.generate();
const ownersTeamId: ObjectID = ObjectID.generate();

const MEMBER_ROLE: Array<Permission> = [
  Permission.ProjectMember,
  Permission.EditProjectIncident,
  Permission.CreateIncidentPublicNote,
];

const OWNER_ROLE: Array<Permission> = [Permission.ProjectOwner];

const memberships: Array<Membership> = [];
const teamPermissions: Map<string, Array<Permission>> = new Map<
  string,
  Array<Permission>
>([
  [membersTeamId.toString(), MEMBER_ROLE],
  [ownersTeamId.toString(), OWNER_ROLE],
]);
const store: Map<string, string> = new Map<string, string>();

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

type TenantKeyFunction = (userId: ObjectID) => string;

const tenantKey: TenantKeyFunction = (userId: ObjectID): string => {
  return `project-permissions-${userId.toString()}:${projectId.toString()}`;
};

type AddMembershipFunction = (data: {
  userId: ObjectID;
  teamId: ObjectID;
  hasAcceptedInvitation?: boolean;
}) => Membership;

const addMembership: AddMembershipFunction = (data: {
  userId: ObjectID;
  teamId: ObjectID;
  hasAcceptedInvitation?: boolean;
}): Membership => {
  const membership: Membership = {
    id: ObjectID.generate(),
    userId: data.userId,
    projectId: projectId,
    teamId: data.teamId,
    hasAcceptedInvitation: data.hasAcceptedInvitation ?? true,
  };

  memberships.push(membership);

  return membership;
};

type ToTeamMemberFunction = (membership: Membership) => TeamMember;

const toTeamMember: ToTeamMemberFunction = (
  membership: Membership,
): TeamMember => {
  const teamMember: TeamMember = new TeamMember();
  teamMember._id = membership.id.toString();
  teamMember.userId = membership.userId;
  teamMember.projectId = membership.projectId;
  teamMember.teamId = membership.teamId;
  teamMember.hasAcceptedInvitation = membership.hasAcceptedInvitation;
  return teamMember;
};

type DeleteThroughHookFunction = (deleted: Array<Membership>) => Promise<void>;

/*
 * TeamMemberService.deleteBy: onBeforeDelete reads the rows into carryForward,
 * the rows are deleted, then onDeleteSuccess runs with that carryForward.
 */
const deleteThroughHook: DeleteThroughHookFunction = async (
  deleted: Array<Membership>,
): Promise<void> => {
  for (const membership of deleted) {
    memberships.splice(memberships.indexOf(membership), 1);
  }

  await (TeamMemberService as any).onDeleteSuccess({
    deleteBy: { query: {}, props: { isRoot: true } },
    carryForward: deleted.map(toTeamMember),
  });
};

type LookUpFunction = (
  userId: ObjectID,
) => Promise<UserTenantAccessPermission | null>;

// The lookup the request middleware makes on every request that names the project.
const lookUp: LookUpFunction = async (
  userId: ObjectID,
): Promise<UserTenantAccessPermission | null> => {
  return await AccessTokenService.getUserTenantAccessPermission(
    userId,
    projectId,
  );
};

type PermissionNamesFunction = (
  permission: UserTenantAccessPermission | null,
) => Array<Permission>;

const permissionNames: PermissionNamesFunction = (
  permission: UserTenantAccessPermission | null,
): Array<Permission> => {
  return (permission?.permissions || []).map((row: UserPermission) => {
    return row.permission;
  });
};

type SignInFunction = (userId: ObjectID) => Promise<void>;

// Warms both cache entries, as a login or the first request does.
const signIn: SignInFunction = async (userId: ObjectID): Promise<void> => {
  await AccessTokenService.refreshUserAllPermissions(userId);
};

describe("TeamMemberService - removing a membership revokes the cached project access", () => {
  beforeEach(() => {
    memberships.length = 0;
    store.clear();

    jest
      .spyOn(GlobalCache, "setJSON")
      .mockImplementation(
        async (
          namespace: string,
          key: string,
          value: JSONObject,
        ): Promise<void> => {
          store.set(
            `${namespace}-${key}`,
            JSON.stringify(JSONFunctions.serialize(value)),
          );
        },
      );

    jest
      .spyOn(GlobalCache, "getJSONObject")
      .mockImplementation(
        async (namespace: string, key: string): Promise<JSONObject | null> => {
          const raw: string | undefined = store.get(`${namespace}-${key}`);

          if (!raw) {
            return null;
          }

          return JSONFunctions.deserialize(
            JSONFunctions.parse(raw) as JSONObject,
          );
        },
      );

    jest
      .spyOn(GlobalCache, "deleteKey")
      .mockImplementation(
        async (namespace: string, key: string): Promise<void> => {
          store.delete(`${namespace}-${key}`);
        },
      );

    // Pages like Postgres does, so findAllBy's batching runs for real.
    jest.spyOn(TeamMemberService, "findBy").mockImplementation((async (data: {
      query: {
        _id?: unknown;
        userId?: ObjectID;
        projectId?: ObjectID;
        hasAcceptedInvitation?: boolean;
      };
      skip?: number;
      limit?: number;
    }): Promise<Array<TeamMember>> => {
      const ids: Array<string> | null =
        data.query._id === undefined ? null : valuesOf(data.query._id);
      const skip: number = Number(data.skip || 0);

      return memberships
        .filter((membership: Membership) => {
          return (
            (ids === null || ids.includes(membership.id.toString())) &&
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
        .slice(skip, data.limit === undefined ? undefined : skip + data.limit)
        .map(toTeamMember);
    }) as never);

    jest
      .spyOn(TeamPermissionService, "findBy")
      .mockImplementation((async (data: {
        query: { teamId: unknown };
      }): Promise<Array<TeamPermission>> => {
        const rows: Array<TeamPermission> = [];

        for (const teamId of valuesOf(data.query.teamId)) {
          for (const permission of teamPermissions.get(teamId) || []) {
            const teamPermission: TeamPermission = new TeamPermission();
            teamPermission.permission = permission;
            teamPermission.labels = [];
            teamPermission.isBlockPermission = false;
            rows.push(teamPermission);
          }
        }

        return rows;
      }) as never);

    jest
      .spyOn(
        TeamMemberService,
        "updateSubscriptionSeatsByUniqueTeamMembersInProject",
      )
      .mockResolvedValue(undefined);
    jest
      .spyOn(TeamMemberService, "cleanupOnCallAssignmentsIfUserLeftProject")
      .mockResolvedValue(null);
    jest
      .spyOn(
        UserNotificationSettingService,
        "removeDefaultNotificationSettingsForUser",
      )
      .mockResolvedValue(undefined);
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Users > "Remove from Project": every membership of the user in one deleteBy.
  test("after Remove from Project the user has no permission in the project", async () => {
    const asMember: Membership = addMembership({
      userId: aliceId,
      teamId: membersTeamId,
    });
    const asOwner: Membership = addMembership({
      userId: aliceId,
      teamId: ownersTeamId,
    });
    await signIn(aliceId);

    expect(permissionNames(await lookUp(aliceId))).toEqual(
      expect.arrayContaining([...MEMBER_ROLE, ...OWNER_ROLE]),
    );

    await deleteThroughHook([asMember, asOwner]);

    expect(store.has(tenantKey(aliceId))).toBe(false);
    expect(await lookUp(aliceId)).toBeNull();
  });

  // Teams > a team > Members > delete, or "Leave team", on the user's last team.
  test("removing the user from their last team revokes the project", async () => {
    const membership: Membership = addMembership({
      userId: aliceId,
      teamId: membersTeamId,
    });
    await signIn(aliceId);

    await deleteThroughHook([membership]);

    expect(await lookUp(aliceId)).toBeNull();
  });

  test("removing the user from one of their teams keeps the rest of their role", async () => {
    addMembership({ userId: aliceId, teamId: membersTeamId });
    const asOwner: Membership = addMembership({
      userId: aliceId,
      teamId: ownersTeamId,
    });
    await signIn(aliceId);

    await deleteThroughHook([asOwner]);

    const remaining: Array<Permission> = permissionNames(await lookUp(aliceId));

    expect(remaining).toEqual(expect.arrayContaining(MEMBER_ROLE));
    expect(remaining).not.toContain(Permission.ProjectOwner);
  });

  // Deleting a team removes all its memberships through TeamMemberService first.
  test("deleting a team revokes the members for whom it was the only team, and only them", async () => {
    const alicesOnlyTeam: Membership = addMembership({
      userId: aliceId,
      teamId: ownersTeamId,
    });
    addMembership({ userId: bobId, teamId: membersTeamId });
    const bobInOwners: Membership = addMembership({
      userId: bobId,
      teamId: ownersTeamId,
    });
    await signIn(aliceId);
    await signIn(bobId);

    await deleteThroughHook([alicesOnlyTeam, bobInOwners]);

    expect(await lookUp(aliceId)).toBeNull();

    const bobsRole: Array<Permission> = permissionNames(await lookUp(bobId));

    expect(bobsRole).toEqual(expect.arrayContaining(MEMBER_ROLE));
    expect(bobsRole).not.toContain(Permission.ProjectOwner);
  });

  test("removing one member does not disturb another member's access", async () => {
    const alice: Membership = addMembership({
      userId: aliceId,
      teamId: membersTeamId,
    });
    addMembership({ userId: bobId, teamId: membersTeamId });
    await signIn(aliceId);
    await signIn(bobId);

    await deleteThroughHook([alice]);

    expect(await lookUp(aliceId)).toBeNull();
    expect(permissionNames(await lookUp(bobId))).toEqual(
      expect.arrayContaining(MEMBER_ROLE),
    );
  });

  /*
   * Root and master admins can flip an accepted membership back to pending.
   * The update hook refreshes the same way; a pending membership grants
   * nothing, so the entry has to go.
   */
  test("setting an accepted membership back to pending revokes the project", async () => {
    const membership: Membership = addMembership({
      userId: aliceId,
      teamId: membersTeamId,
    });
    await signIn(aliceId);

    membership.hasAcceptedInvitation = false;

    await (TeamMemberService as any).onUpdateSuccess(
      {
        updateBy: {
          query: { _id: membership.id },
          data: { hasAcceptedInvitation: false },
          props: { isRoot: true },
        },
        carryForward: null,
      },
      [membership.id],
    );

    expect(store.has(tenantKey(aliceId))).toBe(false);
    expect(await lookUp(aliceId)).toBeNull();
  });

  /*
   * The same user, signed in the whole time, across a removal: the request
   * before it is served the role, the request after it is refused.
   */
  test("a signed-in user is refused on the first request after their removal", async () => {
    const membership: Membership = addMembership({
      userId: aliceId,
      teamId: membersTeamId,
    });
    await signIn(aliceId);

    expect(await lookUp(aliceId)).not.toBeNull();
    expect(await lookUp(aliceId)).not.toBeNull();

    await deleteThroughHook([membership]);

    expect(await lookUp(aliceId)).toBeNull();
    expect(await lookUp(aliceId)).toBeNull();
  });

  /*
   * A delete can cover several users - deleting a team, a SCIM group - and
   * the hook's cleanup can fail part way. Every user's permissions must still
   * be revoked, and the failure still reported.
   */
  describe("when part of the cleanup fails", () => {
    test("a failing cleanup for one user does not leave a later user with their old role", async () => {
      const alice: Membership = addMembership({
        userId: aliceId,
        teamId: ownersTeamId,
      });
      const bob: Membership = addMembership({
        userId: bobId,
        teamId: ownersTeamId,
      });
      await signIn(aliceId);
      await signIn(bobId);

      const settingsError: Error = new Error("statement timeout");
      jest
        .spyOn(
          UserNotificationSettingService,
          "removeDefaultNotificationSettingsForUser",
        )
        .mockRejectedValueOnce(settingsError);

      await expect(deleteThroughHook([alice, bob])).rejects.toBe(settingsError);

      expect(await lookUp(aliceId)).toBeNull();
      expect(await lookUp(bobId)).toBeNull();
    });

    test("a failing refresh for one user still revokes the others, clears that user's entries, and is reported", async () => {
      const alice: Membership = addMembership({
        userId: aliceId,
        teamId: ownersTeamId,
      });
      const bob: Membership = addMembership({
        userId: bobId,
        teamId: ownersTeamId,
      });
      await signIn(aliceId);
      await signIn(bobId);

      const refreshError: Error = new Error("connection reset");
      const realRefreshTokens: (
        userId: ObjectID,
        projectId: ObjectID,
      ) => Promise<void> =
        TeamMemberService.refreshTokens.bind(TeamMemberService);
      jest
        .spyOn(TeamMemberService, "refreshTokens")
        .mockImplementation(
          async (userId: ObjectID, forProjectId: ObjectID): Promise<void> => {
            if (userId.toString() === aliceId.toString()) {
              throw refreshError;
            }

            return await realRefreshTokens(userId, forProjectId);
          },
        );

      await expect(deleteThroughHook([alice, bob])).rejects.toBe(refreshError);

      // Alice's refresh failed, so her entries were dropped instead of rewritten.
      expect(store.has(tenantKey(aliceId))).toBe(false);
      expect(store.has(`user-${aliceId.toString()}`)).toBe(false);
      expect(await lookUp(aliceId)).toBeNull();

      expect(await lookUp(bobId)).toBeNull();

      // The rest of the cleanup still ran for both.
      expect(
        UserNotificationSettingService.removeDefaultNotificationSettingsForUser,
      ).toHaveBeenCalledTimes(2);
    });

    test("the refresh runs once per user and project, however many of their rows were deleted", async () => {
      const asMember: Membership = addMembership({
        userId: aliceId,
        teamId: membersTeamId,
      });
      const asOwner: Membership = addMembership({
        userId: aliceId,
        teamId: ownersTeamId,
      });
      const bob: Membership = addMembership({
        userId: bobId,
        teamId: ownersTeamId,
      });
      await signIn(aliceId);
      await signIn(bobId);

      const refreshTokens: any = jest.spyOn(TeamMemberService, "refreshTokens");

      await deleteThroughHook([asMember, asOwner, bob]);

      expect(refreshTokens).toHaveBeenCalledTimes(2);
      expect(
        refreshTokens.mock.calls.map((call: Array<ObjectID>) => {
          return call[0]!.toString();
        }),
      ).toEqual([aliceId.toString(), bobId.toString()]);
    });
  });

  /*
   * getUserTenantAccessPermission serves a cached permission set only for a
   * project on the user's global list, so that list must hold every project
   * - not the first page of their memberships.
   */
  describe("the global project list", () => {
    test("lists every project of a user with more memberships than one page", async () => {
      const otherProjectId: ObjectID = ObjectID.generate();

      // 10,000 memberships in one project, then one in another: past LIMIT_MAX.
      for (let i: number = 0; i < 10000; i++) {
        memberships.push({
          id: ObjectID.generate(),
          userId: aliceId,
          projectId: projectId,
          teamId: ObjectID.generate(),
          hasAcceptedInvitation: true,
        });
      }
      memberships.push({
        id: ObjectID.generate(),
        userId: aliceId,
        projectId: otherProjectId,
        teamId: membersTeamId,
        hasAcceptedInvitation: true,
      });

      const projectIds: Array<string> = (
        await AccessTokenService.refreshUserGlobalAccessPermission(aliceId)
      ).projectIds.map((id: ObjectID) => {
        return id.toString();
      });

      expect(projectIds).toEqual([
        projectId.toString(),
        otherProjectId.toString(),
      ]);
    });
  });
});
