import GlobalCache from "../Infrastructure/GlobalCache";
import QueryHelper from "../Types/Database/QueryHelper";
import BaseService from "./BaseService";
import TeamMemberService from "./TeamMemberService";
import TeamPermissionService from "./TeamPermissionService";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "../../Types/Permission";
import Label from "../../Models/DatabaseModels/Label";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../Models/DatabaseModels/TeamPermission";
import UserPermissionUtil from "../Utils/UserPermission/UserPermission";
import RealtimeAccessChanges, {
  RealtimeAccessChangeKind,
} from "../Utils/Realtime/RealtimeAccessChanges";
import PermissionNamespace from "../Types/Permission/PermissionNamespace";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * A user's accepted memberships, as the permission sets are built from them:
 * the projects they name, in the order read, and the teams the user is in
 * within each.
 */
interface UserMemberships {
  projectIds: Array<ObjectID>;
  // By project id, lower-cased: the user's teams in it, by lower-cased id.
  teamIdsByProject: Map<string, Map<string, ObjectID>>;
}

// How a project's id keys the maps here, whatever case it was written in.
const keyOf: (id: ObjectID) => string = (id: ObjectID): string => {
  return id.toString().toLowerCase();
};

export class AccessTokenService extends BaseService {
  public constructor() {
    super();
  }

  /*
   * EVERY SIGN-IN REBUILDS THE PERSON'S PERMISSIONS IN EVERY PROJECT, FROM
   * TWO READS HOWEVER MANY PROJECTS THEY ARE IN.
   *
   * Their accepted memberships, read once, give the global permission (the
   * projects they are in) and the teams they are in within each project;
   * every permission row of those teams is read once more, and each
   * project's set is built from its own teams' rows in memory - the set
   * refreshUserTenantAccessPermission builds, row for row. Every set is
   * then written to the cache at once, the writes sent together on the one
   * connection rather than one after another.
   *
   * This used to read the memberships again and the permission rows of each
   * project in turn, and write its set before reading the next: three
   * statements a project, one after another, each waiting for a connection.
   * Someone in 300 projects cost 901 statements to sign in, and with the
   * pool busy their sign-in timed out.
   */
  @CaptureSpan()
  public async refreshUserAllPermissions(userId: ObjectID): Promise<void> {
    const memberships: UserMemberships = await this.readUserMemberships(userId);

    const tenantPermissions: Map<string, UserTenantAccessPermission> =
      await this.buildUserTenantAccessPermissions(memberships);

    const userGlobalAccessPermission: UserGlobalAccessPermission =
      this.buildUserGlobalAccessPermission(memberships.projectIds);

    await Promise.all([
      GlobalCache.setJSON(
        "user",
        userId.toString(),
        userGlobalAccessPermission,
      ),
      ...memberships.projectIds.map(
        async (projectId: ObjectID): Promise<void> => {
          const permission: UserTenantAccessPermission | undefined =
            tenantPermissions.get(keyOf(projectId));

          const cacheKey: string =
            UserPermissionUtil.buildTenantPermissionCacheKey(
              userId,
              projectId,
            );

          /*
           * A project named by a membership with no team in it holds no
           * permission set: its entry is cleared, as
           * refreshUserTenantAccessPermission clears a non-member's.
           */
          if (!permission) {
            await GlobalCache.deleteKey(
              PermissionNamespace.ProjectPermission,
              cacheKey,
            );
            return;
          }

          await GlobalCache.setJSON(
            PermissionNamespace.ProjectPermission,
            cacheKey,
            permission,
          );
        },
      ),
    ]);

    /*
     * Their open live updates read every project again, on every server:
     * one announcement, made once every set above is rebuilt, however many
     * projects they are in (this runs on every sign-in).
     */
    RealtimeAccessChanges.announce({
      kind: RealtimeAccessChangeKind.PermissionsChanged,
      userId: userId.toString(),
    });
  }

  /*
   * The user's accepted memberships - in every project, or only in
   * `projectIds` - read in one statement (pages of LIMIT_MAX rows, as
   * findAllBy reads; one for anyone in fewer than 10,000 teams).
   */
  private async readUserMemberships(
    userId: ObjectID,
    projectIds?: Array<ObjectID> | undefined,
  ): Promise<UserMemberships> {
    const teamMembers: Array<TeamMember> =
      (await TeamMemberService.findAllBy({
        query: {
          userId: userId,
          hasAcceptedInvitation: true,
          ...(projectIds
            ? {
                projectId: QueryHelper.any(projectIds),
              }
            : {}),
        },
        select: {
          projectId: true,
          teamId: true,
        },
        props: {
          isRoot: true,
        },
      })) || [];

    const memberships: UserMemberships = {
      projectIds: [],
      teamIdsByProject: new Map<string, Map<string, ObjectID>>(),
    };

    // One row per team, so a project comes back once for each team in it.
    for (const teamMember of teamMembers) {
      const projectId: ObjectID | undefined = teamMember.projectId;

      if (!projectId) {
        continue;
      }

      let teamIds: Map<string, ObjectID> | undefined =
        memberships.teamIdsByProject.get(keyOf(projectId));

      if (!teamIds) {
        teamIds = new Map<string, ObjectID>();
        memberships.teamIdsByProject.set(keyOf(projectId), teamIds);
        memberships.projectIds.push(projectId);
      }

      if (teamMember.teamId) {
        teamIds.set(keyOf(teamMember.teamId), teamMember.teamId);
      }
    }

    return memberships;
  }

  /*
   * The permission set of every project the memberships name a team in, by
   * lower-cased project id: one read of every permission row of those teams
   * (page by page, as refreshUserTenantAccessPermission reads one project's),
   * each row given to the project it is granted in, among those of its team.
   * Rows come out in the order read, so each project's set holds its rows as
   * a read of that project alone would.
   */
  private async buildUserTenantAccessPermissions(
    memberships: UserMemberships,
  ): Promise<Map<string, UserTenantAccessPermission>> {
    const permissions: Map<string, UserTenantAccessPermission> = new Map<
      string,
      UserTenantAccessPermission
    >();

    // The projects each team is in, as the memberships name it.
    const projectKeysByTeam: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();
    const teamIds: Array<ObjectID> = [];
    const projectIdsWithTeams: Array<ObjectID> = [];

    for (const projectId of memberships.projectIds) {
      const projectTeamIds: Map<string, ObjectID> =
        memberships.teamIdsByProject.get(keyOf(projectId)) ||
        new Map<string, ObjectID>();

      if (projectTeamIds.size === 0) {
        continue;
      }

      projectIdsWithTeams.push(projectId);

      for (const [teamKey, teamId] of projectTeamIds) {
        const projectKeys: Array<string> | undefined =
          projectKeysByTeam.get(teamKey);

        if (projectKeys) {
          projectKeys.push(keyOf(projectId));
          continue;
        }

        projectKeysByTeam.set(teamKey, [keyOf(projectId)]);
        teamIds.push(teamId);
      }
    }

    if (teamIds.length === 0) {
      return permissions;
    }

    /*
     * Every permission row of their teams, read page by page: one read
     * stops at LIMIT_MAX rows, newest first, and a person whose teams were
     * given a few broad custom roles (each a copy of every permission of
     * the role) could pass it - losing the oldest rows, often the blocks
     * set up first.
     */
    const teamPermissions: Array<TeamPermission> =
      await TeamPermissionService.findAllBy({
        query: {
          teamId: QueryHelper.any(teamIds),
          projectId: QueryHelper.any(projectIdsWithTeams),
        },
        select: {
          permission: true,
          labels: {
            _id: true,
          },
          isBlockPermission: true,
          scope: true,
          teamId: true,
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      });

    const rowsByProject: Map<string, Array<TeamPermission>> = new Map<
      string,
      Array<TeamPermission>
    >();

    for (const teamPermission of teamPermissions) {
      if (!teamPermission.teamId) {
        continue;
      }

      const grantedIn: string | undefined = teamPermission.projectId
        ? keyOf(teamPermission.projectId)
        : undefined;

      for (const projectKey of projectKeysByTeam.get(
        keyOf(teamPermission.teamId),
      ) || []) {
        // A row counts in the project it is granted in, as a read of one project asks.
        if (grantedIn && grantedIn !== projectKey) {
          continue;
        }

        const rows: Array<TeamPermission> = rowsByProject.get(projectKey) || [];
        rows.push(teamPermission);
        rowsByProject.set(projectKey, rows);
      }
    }

    for (const projectId of projectIdsWithTeams) {
      permissions.set(
        keyOf(projectId),
        this.buildUserTenantAccessPermission(
          projectId,
          rowsByProject.get(keyOf(projectId)) || [],
        ),
      );
    }

    return permissions;
  }

  /*
   * A member's permission set in a project, from the permission rows of
   * their teams in it.
   */
  private buildUserTenantAccessPermission(
    projectId: ObjectID,
    teamPermissions: Array<TeamPermission>,
  ): UserTenantAccessPermission {
    const userPermissions: Array<UserPermission> = [];

    for (const teamPermission of teamPermissions) {
      userPermissions.push({
        permission: teamPermission.permission!,
        labelIds: (teamPermission.labels || []).map((label: Label) => {
          return label.id!;
        }),
        isBlockPermission: teamPermission.isBlockPermission,
        scope: teamPermission.scope,
        /*
         * The team the row is granted on: an Owned row reaches what this
         * team owns, not what the member's other teams own.
         */
        teamId: teamPermission.teamId,
        _type: "UserPermission",
      });
    }

    const defaultPermission: UserTenantAccessPermission =
      UserPermissionUtil.getDefaultUserTenantAccessPermission(projectId);

    defaultPermission.permissions =
      defaultPermission.permissions.concat(userPermissions);

    /*
     * Reaching here means the user holds an accepted membership in at least one
     * team of this project, so they are a project member whatever roles those
     * teams carry. `ProjectUser` says exactly that, and shared workspace
     * resources - saved table views, labels, teams, member rows - are read
     * through it. Without it a user scoped to a single domain (Monitor Viewer
     * and nothing else) cannot load the tables that role exists to give them.
     */
    return UserPermissionUtil.withProjectUserPermission(defaultPermission);
  }

  // The global permission of someone who is a member of these projects.
  private buildUserGlobalAccessPermission(
    projectIds: Array<ObjectID>,
  ): UserGlobalAccessPermission {
    return {
      projectIds,
      globalPermissions: [
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
      ],
      _type: "UserGlobalAccessPermission",
    };
  }

  @CaptureSpan()
  public async refreshUserGlobalAccessPermission(
    userId: ObjectID,
    options?: {
      /*
       * Whether the person's open live updates read their permissions again,
       * on every server (RealtimeAccessChanges). Default true. False when the
       * refresh only fills a cache that had nothing - nothing changed, and
       * the lookup may be the one building their live-update entry.
       */
      forgetLiveUpdateReaders?: boolean | undefined;
    },
  ): Promise<UserGlobalAccessPermission> {
    /*
     * Every project the user belongs to - all of them, not a first page.
     * getUserTenantAccessPermission only serves a cached permission set for a
     * project on this list, so a project cut off it would have its set rebuilt
     * on every request.
     */
    const memberships: UserMemberships = await this.readUserMemberships(userId);

    const permissionToStore: UserGlobalAccessPermission =
      this.buildUserGlobalAccessPermission(memberships.projectIds);

    await GlobalCache.setJSON("user", userId.toString(), permissionToStore);

    /*
     * The person's open live updates read their projects again, on every
     * server (RealtimeAccessChanges), so one they have left stops at once.
     */
    if (options?.forgetLiveUpdateReaders !== false) {
      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.PermissionsChanged,
        userId: userId.toString(),
      });
    }

    return permissionToStore;
  }

  @CaptureSpan()
  public async getUserGlobalAccessPermission(
    userId: ObjectID,
  ): Promise<UserGlobalAccessPermission | null> {
    const json: UserGlobalAccessPermission | null =
      await UserPermissionUtil.getUserGlobalAccessPermissionFromCache(userId);

    if (!json) {
      // Filling an empty cache changes nothing about what they may read.
      return await this.refreshUserGlobalAccessPermission(userId, {
        forgetLiveUpdateReaders: false,
      });
    }

    return json;
  }

  @CaptureSpan()
  public async refreshUserTenantAccessPermission(
    userId: ObjectID,
    projectId: ObjectID,
    options?: {
      /*
       * Whether to clear the cached entry when the user turns out not to be a
       * member. Default true. False only when the caller has just seen there
       * is no entry, so a non-member probing a project costs no cache write.
       */
      clearCacheIfNotMember?: boolean | undefined;
      /*
       * Whether the person's open live updates of the project read their
       * permissions again, on every server (RealtimeAccessChanges). Default
       * true. False when the refresh only fills or corrects the cache as it
       * is read - nothing changed, and the lookup may be the one building
       * their live-update entry, which would otherwise be dropped as it is
       * made.
       */
      forgetLiveUpdateReaders?: boolean | undefined;
    },
  ): Promise<UserTenantAccessPermission | null> {
    // query for all projects user belongs to.
    const teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        userId: userId,
        projectId: projectId,
        hasAcceptedInvitation: true,
      },
      select: {
        teamId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const teamIds: Array<ObjectID> = teamMembers.map(
      (teamMember: TeamMember) => {
        return teamMember.teamId!;
      },
    );

    if (teamIds.length === 0) {
      /*
       * Not a member of this project. Clear the cached entry rather than just
       * returning: when the user's last membership has just been removed, it
       * still holds everything they could do as a member, and nothing else
       * ever overwrites it - the request middleware would keep serving it
       * until it expired, 30 days later.
       */
      if (options?.clearCacheIfNotMember !== false) {
        await GlobalCache.deleteKey(
          PermissionNamespace.ProjectPermission,
          UserPermissionUtil.buildTenantPermissionCacheKey(userId, projectId),
        );
      }

      // Their open live updates of the project stop at once, on every server.
      if (options?.forgetLiveUpdateReaders !== false) {
        RealtimeAccessChanges.announce({
          kind: RealtimeAccessChangeKind.PermissionsChanged,
          userId: userId.toString(),
          projectId: projectId.toString(),
        });
      }

      return null;
    }

    /*
     * Every permission row of their teams, read page by page: one read stops
     * at LIMIT_MAX rows, newest first, and a person whose teams were given a
     * few broad custom roles (each a copy of every permission of the role)
     * could pass it - losing the oldest rows, often the blocks set up first.
     */
    const teamPermissions: Array<TeamPermission> =
      await TeamPermissionService.findAllBy({
        query: {
          teamId: QueryHelper.any(teamIds),
          projectId: projectId,
        },
        select: {
          permission: true,
          labels: {
            _id: true,
          },
          isBlockPermission: true,
          scope: true,
          teamId: true,
        },
        props: {
          isRoot: true,
        },
      });

    // A member, whatever roles their teams carry: the empty-team case returned above.
    const permission: UserTenantAccessPermission =
      this.buildUserTenantAccessPermission(projectId, teamPermissions);

    await GlobalCache.setJSON(
      PermissionNamespace.ProjectPermission,
      UserPermissionUtil.buildTenantPermissionCacheKey(userId, projectId),
      permission,
    );

    /*
     * Their open live updates of the project follow the new permissions at
     * once, on every server (RealtimeAccessChanges).
     */
    if (options?.forgetLiveUpdateReaders !== false) {
      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.PermissionsChanged,
        userId: userId.toString(),
        projectId: projectId.toString(),
      });
    }

    return permission;
  }

  @CaptureSpan()
  public async getDatabaseCommonInteractionPropsByUserAndProject(data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<DatabaseCommonInteractionProps> {
    const { userId, projectId } = data;

    const userGlobalAccessPermission: UserGlobalAccessPermission | null =
      await this.getUserGlobalAccessPermission(userId);

    return {
      userId: userId,
      userGlobalAccessPermission: userGlobalAccessPermission || undefined,
      userTenantAccessPermission: {
        [projectId.toString()]: (await this.getUserTenantAccessPermission(
          userId,
          projectId,
          { userGlobalAccessPermission },
        ))!,
      },
      tenantId: projectId,
    };
  }

  /*
   * The user's permission set in one project, or null if they are not a member
   * of it.
   *
   * A cached set is only served while the user's global permission still lists
   * the project. The two are written together whenever a membership changes, so
   * they disagree only when the cached set is left over from a membership that
   * has since been removed - or, the other way round, when the global list is
   * the stale one. The memberships decide which: the set is rebuilt from them,
   * which also clears it if the user is not a member.
   *
   * Pass `userGlobalAccessPermission` when the caller already has it, or is
   * already fetching it, to save a second read of the same cache key.
   */
  @CaptureSpan()
  public async getUserTenantAccessPermission(
    userId: ObjectID,
    projectId: ObjectID,
    options?: {
      userGlobalAccessPermission?:
        | UserGlobalAccessPermission
        | null
        | Promise<UserGlobalAccessPermission | null>
        | undefined;
    },
  ): Promise<UserTenantAccessPermission | null> {
    const [json, userGlobalAccessPermission]: [
      UserTenantAccessPermission | null,
      UserGlobalAccessPermission | null,
    ] = await Promise.all([
      UserPermissionUtil.getUserTenantAccessPermissionFromCache(
        userId,
        projectId,
      ),
      options?.userGlobalAccessPermission !== undefined
        ? options.userGlobalAccessPermission
        : this.getUserGlobalAccessPermission(userId),
    ]);

    /*
     * The refreshes below only fill or correct the cache as it is read:
     * nothing about what the person may do changed here, so their open live
     * updates keep their entries (see forgetLiveUpdateReaders).
     */
    if (!json) {
      return await this.refreshUserTenantAccessPermission(userId, projectId, {
        clearCacheIfNotMember: false,
        forgetLiveUpdateReaders: false,
      });
    }

    if (
      UserPermissionUtil.isProjectInGlobalAccessPermission(
        userGlobalAccessPermission,
        projectId,
      )
    ) {
      return json;
    }

    const permission: UserTenantAccessPermission | null =
      await this.refreshUserTenantAccessPermission(userId, projectId, {
        forgetLiveUpdateReaders: false,
      });

    if (permission) {
      // Still a member: it was the global list that was out of date.
      await this.refreshUserGlobalAccessPermission(userId, {
        forgetLiveUpdateReaders: false,
      });
    }

    return permission;
  }

  /*
   * getUserTenantAccessPermission for several projects at once - a request
   * across the person's projects - in a bounded number of reads however
   * many projects there are: one read of the cache for every project, and,
   * for the projects it holds no usable set for, one read of their
   * memberships and one of their teams' permission rows (two statements, as
   * a sign-in rebuilds them), not three statements for each.
   *
   * Each project is answered as getUserTenantAccessPermission answers it: a
   * cached set the global permission lists is served; one missing is
   * rebuilt from the memberships, and kept if they are a member; one the
   * global permission does not list is rebuilt too - cleared if they are
   * not a member, and if they are, the global permission is rebuilt with it.
   * Null for a project they are not a member of. Keyed by the project id,
   * lower-cased.
   */
  @CaptureSpan()
  public async getUserTenantAccessPermissions(
    userId: ObjectID,
    projectIds: Array<ObjectID>,
    options?: {
      userGlobalAccessPermission?:
        | UserGlobalAccessPermission
        | null
        | Promise<UserGlobalAccessPermission | null>
        | undefined;
    },
  ): Promise<Map<string, UserTenantAccessPermission | null>> {
    const result: Map<string, UserTenantAccessPermission | null> = new Map<
      string,
      UserTenantAccessPermission | null
    >();

    if (projectIds.length === 0) {
      return result;
    }

    const [cached, userGlobalAccessPermission]: [
      Array<UserTenantAccessPermission | null>,
      UserGlobalAccessPermission | null,
    ] = await Promise.all([
      UserPermissionUtil.getUserTenantAccessPermissionsFromCache(
        userId,
        projectIds,
      ),
      options?.userGlobalAccessPermission !== undefined
        ? options.userGlobalAccessPermission
        : this.getUserGlobalAccessPermission(userId),
    ]);

    // Not cached, or cached for a project the global permission does not list.
    const toRebuild: Array<ObjectID> = [];
    const unlisted: Set<string> = new Set<string>();

    projectIds.forEach((projectId: ObjectID, index: number): void => {
      const key: string = keyOf(projectId);

      if (result.has(key) || unlisted.has(key)) {
        return;
      }

      const json: UserTenantAccessPermission | null = cached[index] || null;

      if (!json) {
        result.set(key, null);
        toRebuild.push(projectId);
        return;
      }

      if (
        UserPermissionUtil.isProjectInGlobalAccessPermission(
          userGlobalAccessPermission,
          projectId,
        )
      ) {
        result.set(key, json);
        return;
      }

      unlisted.add(key);
      result.set(key, null);
      toRebuild.push(projectId);
    });

    if (toRebuild.length === 0) {
      return result;
    }

    /*
     * Rebuilt only to fill or correct the cache as it is read: nothing about
     * what the person may do changed, so nobody's live updates are told
     * (see refreshUserTenantAccessPermission's forgetLiveUpdateReaders).
     */
    const rebuilt: Map<string, UserTenantAccessPermission> =
      await this.buildUserTenantAccessPermissions(
        await this.readUserMemberships(userId, toRebuild),
      );

    let isUnlistedProjectStillJoined: boolean = false;

    await Promise.all(
      toRebuild.map(async (projectId: ObjectID): Promise<void> => {
        const key: string = keyOf(projectId);
        const permission: UserTenantAccessPermission | undefined =
          rebuilt.get(key);
        const cacheKey: string =
          UserPermissionUtil.buildTenantPermissionCacheKey(userId, projectId);

        if (permission) {
          result.set(key, permission);

          if (unlisted.has(key)) {
            isUnlistedProjectStillJoined = true;
          }

          await GlobalCache.setJSON(
            PermissionNamespace.ProjectPermission,
            cacheKey,
            permission,
          );
          return;
        }

        /*
         * Not a member. A set cached for a project the global permission no
         * longer lists is left over from a membership since removed, and is
         * cleared (refreshUserTenantAccessPermission says why); where nothing
         * was cached, nothing is written.
         */
        if (unlisted.has(key)) {
          await GlobalCache.deleteKey(
            PermissionNamespace.ProjectPermission,
            cacheKey,
          );
        }
      }),
    );

    if (isUnlistedProjectStillJoined) {
      // Still a member: it was the global list that was out of date.
      await this.refreshUserGlobalAccessPermission(userId, {
        forgetLiveUpdateReaders: false,
      });
    }

    return result;
  }

  /*
   * Drops the user's cached global permission and their cached permission set
   * in one project, so both are rebuilt from their memberships the next time
   * they are read. The fallback for when refreshing them has failed.
   */
  @CaptureSpan()
  public async clearCachedPermissions(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<void> {
    await Promise.all([
      GlobalCache.deleteKey("user", userId.toString()),
      GlobalCache.deleteKey(
        PermissionNamespace.ProjectPermission,
        UserPermissionUtil.buildTenantPermissionCacheKey(userId, projectId),
      ),
    ]);

    // Their open live updates read the permissions again too, on every server.
    RealtimeAccessChanges.announce({
      kind: RealtimeAccessChangeKind.PermissionsChanged,
      userId: userId.toString(),
      projectId: projectId.toString(),
    });
  }
}

export default new AccessTokenService();
