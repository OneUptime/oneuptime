import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import GlobalCache from "../../Infrastructure/GlobalCache";
import { PERMISSION_ROWS_VERSION } from "../../Infrastructure/Postgres/PermissionRowMigrations";
import PermissionNamespace from "../../Types/Permission/PermissionNamespace";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * What a member's cached permission set holds beside its own fields: the
 * version of the permission rows it was built from (PermissionRowMigrations).
 */
export const PERMISSION_ROWS_VERSION_FIELD: string = "permissionRowsVersion";

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
    const key: string = this.buildTenantPermissionCacheKey(userId, projectId);
    const cached: JSONObject | null = await GlobalCache.getJSONObject(
      PermissionNamespace.ProjectPermission,
      key,
    );

    // Cached before a migration changed the rows it was built from: it goes.
    if (cached && !this.isCachedFromCurrentPermissionRows(cached)) {
      await this.forgetSetsCachedBeforePermissionRowsChanged([key]);
      return null;
    }

    return this.readCachedTenantAccessPermission(cached);
  }

  /*
   * getUserTenantAccessPermissionFromCache for several projects of one user,
   * in a single round trip to the cache (MGET): one entry per project, in
   * the order asked, each read as that method reads it.
   */
  @CaptureSpan()
  public static async getUserTenantAccessPermissionsFromCache(
    userId: ObjectID,
    projectIds: Array<ObjectID>,
  ): Promise<Array<UserTenantAccessPermission | null>> {
    if (projectIds.length === 0) {
      return [];
    }

    const keys: Array<string> = projectIds.map(
      (projectId: ObjectID): string => {
        return this.buildTenantPermissionCacheKey(userId, projectId);
      },
    );

    const cached: Array<JSONObject | null> = await GlobalCache.getJSONObjects(
      PermissionNamespace.ProjectPermission,
      keys,
    );

    const staleKeys: Array<string> = keys.filter(
      (_key: string, index: number): boolean => {
        const json: JSONObject | null = cached[index] || null;
        return Boolean(json) && !this.isCachedFromCurrentPermissionRows(json!);
      },
    );

    if (staleKeys.length > 0) {
      await this.forgetSetsCachedBeforePermissionRowsChanged(staleKeys);
    }

    return cached.map(
      (json: JSONObject | null): UserTenantAccessPermission | null => {
        if (json && !this.isCachedFromCurrentPermissionRows(json)) {
          return null;
        }

        return this.readCachedTenantAccessPermission(json);
      },
    );
  }

  /*
   * Deletes sets cached before a migration changed the permission rows they
   * were built from, the first time one is read: the caller rebuilds a
   * member's from the rows as they are now, and a set of someone who is no
   * longer a member is not left to be read, and rebuilt, until it expires.
   * A key that holds nothing is never deleted, so a plain miss costs no
   * write. Never throws: a set that stays is still never served.
   */
  private static async forgetSetsCachedBeforePermissionRowsChanged(
    keys: Array<string>,
  ): Promise<void> {
    try {
      await Promise.all(
        keys.map((key: string): Promise<void> => {
          return GlobalCache.deleteKey(
            PermissionNamespace.ProjectPermission,
            key,
          );
        }),
      );
    } catch (err) {
      logger.warn(
        "Could not delete permission sets cached before the permission rows changed; they are still never served.",
      );
      logger.warn(err);
    }
  }

  /*
   * Caches a member's permission set in a project, with the version of the
   * permission rows it was built from (PERMISSION_ROWS_VERSION), so it is
   * never served once a migration has changed those rows
   * (isCachedFromCurrentPermissionRows). Every write of a set goes through
   * here (AccessTokenService), with GlobalCache's expiry of 30 days.
   */
  @CaptureSpan()
  public static async cacheUserTenantAccessPermission(
    userId: ObjectID,
    projectId: ObjectID,
    permission: UserTenantAccessPermission,
  ): Promise<void> {
    await GlobalCache.setJSON(
      PermissionNamespace.ProjectPermission,
      this.buildTenantPermissionCacheKey(userId, projectId),
      this.toCachedTenantAccessPermission(permission),
    );
  }

  // A member's set as it is cached: a copy, with the version of its rows.
  public static toCachedTenantAccessPermission(
    permission: UserTenantAccessPermission,
  ): JSONObject {
    return {
      ...permission,
      [PERMISSION_ROWS_VERSION_FIELD]: PERMISSION_ROWS_VERSION,
    };
  }

  /*
   * Whether a cached set was built from the permission rows as they are now:
   * cached with PERMISSION_ROWS_VERSION, or with a newer one - by a server
   * of a newer release, while both run, from the rows a newer migration
   * left. One cached with an older version, or with none (every set cached
   * before sets carried one), was built before a migration that changed
   * permission rows ran, and may hold a row it took away: it is read as
   * missing, so the caller rebuilds it from the rows (PermissionRowMigrations).
   */
  public static isCachedFromCurrentPermissionRows(cached: JSONObject): boolean {
    const version: unknown = cached[PERMISSION_ROWS_VERSION_FIELD];

    return (
      typeof version === "number" &&
      Number.isFinite(version) &&
      version >= PERMISSION_ROWS_VERSION
    );
  }

  /*
   * A cached permission set as a request may use it, or null to rebuild it.
   * The callers have read a set cached before the permission rows changed as
   * missing already; it is refused here too, so no caller can serve one.
   */
  private static readCachedTenantAccessPermission(
    cached: JSONObject | null,
  ): UserTenantAccessPermission | null {
    if (!cached || !this.isCachedFromCurrentPermissionRows(cached)) {
      return null;
    }

    // The set itself, without the version it was cached with.
    const json: UserTenantAccessPermission = {
      ...cached,
    } as UserTenantAccessPermission;
    delete json[PERMISSION_ROWS_VERSION_FIELD];

    json._type = "UserTenantAccessPermission";

    if (!json.permissions) {
      json.permissions = [];
    }

    // Rebuilt from the memberships, as if nothing were cached. See the helper.
    if (this.hasRowWithoutTeam(json)) {
      return null;
    }

    return this.withProjectUserPermission(json);
  }

  /*
   * Whether a cached permission set was written before each row named the
   * team it is granted on (UserPermission.teamId): an Owned row of it would
   * reach only what the user owns, and not what the team granting it owns,
   * and any other allow row would reach no private incident, alert or
   * episode at all - each team's permission reaches the private records
   * that team owns (PrivateRecordPermission), and a row that names no team
   * only the ones the user owns. Such a set is read as missing, so the
   * caller rebuilds it from the memberships (AccessTokenService
   * .getUserTenantAccessPermission) rather than serve it until it expires,
   * 30 days later. Only the rows every member holds without a team
   * (TEAMLESS_PERMISSIONS) name none.
   */
  public static hasRowWithoutTeam(
    permission: UserTenantAccessPermission,
  ): boolean {
    return (permission.permissions || []).some(
      (userPermission: UserPermission): boolean => {
        return (
          Boolean(userPermission) &&
          userPermission.isBlockPermission !== true &&
          !userPermission.teamId &&
          !UserPermissionUtil.TEAMLESS_PERMISSIONS.includes(
            userPermission.permission,
          )
        );
      },
    );
  }

  /*
   * The permissions a member's set holds on no team's behalf: the defaults
   * every signed-in user holds (getDefaultUserTenantAccessPermission) and
   * the project membership itself (withProjectUserPermission).
   */
  public static readonly TEAMLESS_PERMISSIONS: ReadonlyArray<Permission> = [
    Permission.CurrentUser,
    Permission.UnAuthorizedSsoUser,
    Permission.ProjectUser,
  ];

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
