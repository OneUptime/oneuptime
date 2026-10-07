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
import PermissionNamespace from "../Types/Permission/PermissionNamespace";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class AccessTokenService extends BaseService {
  public constructor() {
    super();
  }

  @CaptureSpan()
  public async refreshUserAllPermissions(userId: ObjectID): Promise<void> {
    const userGlobalAccessPermission: UserGlobalAccessPermission =
      await this.refreshUserGlobalAccessPermission(userId);

    // every project the user belongs to.
    for (const projectId of userGlobalAccessPermission.projectIds) {
      await this.refreshUserTenantAccessPermission(userId, projectId);
    }
  }

  @CaptureSpan()
  public async refreshUserGlobalAccessPermission(
    userId: ObjectID,
  ): Promise<UserGlobalAccessPermission> {
    /*
     * Every project the user belongs to - all of them, not a first page.
     * getUserTenantAccessPermission only serves a cached permission set for a
     * project on this list, so a project cut off it would have its set rebuilt
     * on every request.
     */
    let teamMembers: Array<TeamMember> = await TeamMemberService.findAllBy({
      query: {
        userId: userId,
        hasAcceptedInvitation: true,
      },
      select: {
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!teamMembers) {
      teamMembers = [];
    }

    // One row per team, so a project comes back once for each team in it.
    const projectIds: Array<ObjectID> = [];
    const seenProjectIds: Set<string> = new Set<string>();

    for (const teamMember of teamMembers) {
      const projectId: ObjectID | undefined = teamMember.projectId;

      if (projectId && !seenProjectIds.has(projectId.toString())) {
        seenProjectIds.add(projectId.toString());
        projectIds.push(projectId);
      }
    }

    const permissionToStore: UserGlobalAccessPermission = {
      projectIds,
      globalPermissions: [
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
      ],
      _type: "UserGlobalAccessPermission",
    };

    await GlobalCache.setJSON("user", userId.toString(), permissionToStore);

    return permissionToStore;
  }

  @CaptureSpan()
  public async getUserGlobalAccessPermission(
    userId: ObjectID,
  ): Promise<UserGlobalAccessPermission | null> {
    const json: UserGlobalAccessPermission | null =
      await UserPermissionUtil.getUserGlobalAccessPermissionFromCache(userId);

    if (!json) {
      return await this.refreshUserGlobalAccessPermission(userId);
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

      return null;
    }

    // get team permissions.
    const teamPermissions: Array<TeamPermission> =
      await TeamPermissionService.findBy({
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
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const userPermissions: Array<UserPermission> = [];

    for (const teamPermission of teamPermissions) {
      if (!teamPermission.labels) {
        teamPermission.labels = [];
      }

      userPermissions.push({
        permission: teamPermission.permission!,
        labelIds: teamPermission.labels.map((label: Label) => {
          return label.id!;
        }),
        isBlockPermission: teamPermission.isBlockPermission,
        scope: teamPermission.scope,
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
     * teams carry - the empty-team case returned above. `ProjectUser` says
     * exactly that, and shared workspace resources - saved table views, labels,
     * teams, member rows - are read through it. Without it a user scoped to a
     * single domain (Monitor Viewer and nothing else) cannot load the tables
     * that role exists to give them.
     */
    const permission: UserTenantAccessPermission =
      UserPermissionUtil.withProjectUserPermission(defaultPermission);

    await GlobalCache.setJSON(
      PermissionNamespace.ProjectPermission,
      UserPermissionUtil.buildTenantPermissionCacheKey(userId, projectId),
      permission,
    );

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

    if (!json) {
      return await this.refreshUserTenantAccessPermission(userId, projectId, {
        clearCacheIfNotMember: false,
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
      await this.refreshUserTenantAccessPermission(userId, projectId);

    if (permission) {
      // Still a member: it was the global list that was out of date.
      await this.refreshUserGlobalAccessPermission(userId);
    }

    return permission;
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
  }
}

export default new AccessTokenService();
