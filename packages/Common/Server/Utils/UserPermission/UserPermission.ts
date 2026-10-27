import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import GlobalCache from "../../Infrastructure/GlobalCache";
import PermissionNamespace from "../../Types/Permission/PermissionNamespace";
import CaptureSpan from "../Telemetry/CaptureSpan";

export default class UserPermissionUtil {
  /*
   * Build the cache key for a (user, project) tenant-permission entry.
   * The previous shape was `userId.toString() + projectId.toString()`
   * with no separator — two distinct ObjectID pairs could in principle
   * collide because plain concatenation has no boundary marker. Use a
   * delimiter so the namespace is unambiguous, and route both the GET
   * (here) and the SET (in `AccessTokenService.refreshUserTenant
   * AccessPermission`) through this helper so they can't drift.
   */
  public static buildTenantPermissionCacheKey(
    userId: ObjectID,
    projectId: ObjectID,
  ): string {
    return `${userId.toString()}:${projectId.toString()}`;
  }

  /*
   * Adds the implicit `ProjectUser` grant to a member's permission set.
   *
   * `ProjectUser` is not stored on any TeamPermission row - it is what being a
   * member of the project means, and it is what shared workspace resources
   * (saved table views, labels, teams, member profiles) are read through. A
   * user whose teams only grant a domain role such as `MonitorViewer` holds no
   * project-wide role, so without this the dashboard refuses to render the very
   * pages that role exists to give them.
   *
   * Applied on the way out of the cache as well as at refresh time. A snapshot
   * written before this existed would otherwise keep a signed-in member locked
   * out until something invalidated it, and the cache entry lives for 30 days
   * (GlobalCache.setString's default) unless a team or membership change
   * rewrites it first.
   *
   * Deliberately NOT part of `getDefaultUserTenantAccessPermission`: that is
   * also the permission set handed to a user who has not satisfied a project's
   * SSO requirement, and such a user is not yet a member for this purpose.
   */
  public static withProjectUserPermission(
    permission: UserTenantAccessPermission,
  ): UserTenantAccessPermission {
    const alreadyGranted: boolean = permission.permissions.some(
      (userPermission: UserPermission) => {
        return userPermission.permission === Permission.ProjectUser;
      },
    );

    if (alreadyGranted) {
      return permission;
    }

    /*
     * A new object rather than a push. The caller may be holding a snapshot
     * that came out of a cache and is shared with something else; appending in
     * place would grow that array once per read.
     */
    return {
      ...permission,
      permissions: [
        ...permission.permissions,
        {
          permission: Permission.ProjectUser,
          labelIds: [],
          isBlockPermission: false,
          _type: "UserPermission",
        },
      ],
    };
  }

  /*
   * Whether the user's global permission lists the project among the ones they
   * are an accepted member of. No global permission, or one without a project
   * list, answers no.
   */
  public static isProjectInGlobalAccessPermission(
    userGlobalAccessPermission: UserGlobalAccessPermission | null | undefined,
    projectId: ObjectID,
  ): boolean {
    return (userGlobalAccessPermission?.projectIds || []).some(
      (memberProjectId: ObjectID) => {
        return memberProjectId.toString() === projectId.toString();
      },
    );
  }

  @CaptureSpan()
  public static async getUserTenantAccessPermissionFromCache(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<UserTenantAccessPermission | null> {
    const json: UserTenantAccessPermission | null =
      (await GlobalCache.getJSONObject(
        PermissionNamespace.ProjectPermission,
        this.buildTenantPermissionCacheKey(userId, projectId),
      )) as UserTenantAccessPermission;

    if (json) {
      json._type = "UserTenantAccessPermission";
    }

    if (!json) {
      return null;
    }

    if (!json.permissions) {
      json.permissions = [];
    }

    // Rebuilt from the memberships, as if nothing were cached. See the helper.
    if (this.hasOwnedRowWithoutTeam(json)) {
      return null;
    }

    return this.withProjectUserPermission(json);
  }

  /*
   * Whether a cached permission set was written before each row named the
   * team it is granted on (UserPermission.teamId): an Owned row of it would
   * reach only what the user owns, and not what the team granting it owns.
   * Such a set is read as missing, so the caller rebuilds it from the
   * memberships (AccessTokenService.getUserTenantAccessPermission) rather
   * than serve it until it expires, 30 days later.
   */
  public static hasOwnedRowWithoutTeam(
    permission: UserTenantAccessPermission,
  ): boolean {
    return (permission.permissions || []).some(
      (userPermission: UserPermission): boolean => {
        return (
          Boolean(userPermission) &&
          userPermission.scope === PermissionScope.Owned &&
          userPermission.isBlockPermission !== true &&
          !userPermission.teamId
        );
      },
    );
  }

  @CaptureSpan()
  public static async getUserGlobalAccessPermissionFromCache(
    userId: ObjectID,
  ): Promise<UserGlobalAccessPermission | null> {
    const json: JSONObject | null = await GlobalCache.getJSONObject(
      "user",
      userId.toString(),
    );

    if (!json) {
      return null;
    }

    const accessPermission: UserGlobalAccessPermission =
      json as UserGlobalAccessPermission;

    accessPermission._type = "UserGlobalAccessPermission";

    return accessPermission;
  }

  @CaptureSpan()
  public static getDefaultUserTenantAccessPermission(
    projectId: ObjectID,
  ): UserTenantAccessPermission {
    const userPermissions: Array<UserPermission> = [];

    userPermissions.push({
      permission: Permission.CurrentUser,
      labelIds: [],
      isBlockPermission: false,
      _type: "UserPermission",
    });

    userPermissions.push({
      permission: Permission.UnAuthorizedSsoUser,
      labelIds: [],
      isBlockPermission: false,
      _type: "UserPermission",
    });

    const permission: UserTenantAccessPermission = {
      projectId,
      permissions: userPermissions,
      isBlockPermission: false,
      _type: "UserTenantAccessPermission",
    };

    return permission;
  }
}
