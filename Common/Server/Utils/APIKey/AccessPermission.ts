import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import ApiKeyPermissionService, {
  ApiKeyPermissionRow,
} from "../../Services/ApiKeyPermissionService";
import CaptureSpan from "../Telemetry/CaptureSpan";
import UserPermissionUtil from "../UserPermission/UserPermission";

/*
 * Permission.AuthenticatedRequest is a marker, not a capability. It says "some
 * authenticated principal made this call" - its own definition names API keys
 * first - and unlike every other entry in these lists it has no PermissionProps,
 * so it never appears in the admin picker and nobody can grant or revoke it per
 * key. File and FileModel are the only models that name it, which is what bounds
 * what including it here can widen.
 *
 * It is in the list because of TenantPermission.isAccessGrantedOnlyByCurrentUser.
 * That predicate asks whether the ONLY thing letting a caller through a model's
 * gate is the auto-granted CurrentUser - i.e. whether they are here as nothing
 * more than some logged-in user - and when it says yes the caller is held to
 * rows they own, which an API key can never satisfy because it has no userId.
 * Without AuthenticatedRequest an API key intersects File's create list down to
 * CurrentUser alone and answers yes to that question, which is simply the wrong
 * description of a key: it is not a user acting on their own rows.
 *
 * On File as it stands today the wrong answer is harmless - File declares no
 * user column, so the ownership branch returns before it can bite. The grant is
 * here so that stays a fact about File's schema rather than the only thing
 * holding API-key file access up.
 */
export default class APIKeyAccessPermission {
  @CaptureSpan()
  public static async getDefaultApiGlobalPermission(
    projectId: ObjectID,
  ): Promise<UserGlobalAccessPermission> {
    return {
      projectIds: [projectId],
      globalPermissions: [
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
        Permission.AuthenticatedRequest,
      ],
      _type: "UserGlobalAccessPermission",
    };
  }

  @CaptureSpan()
  public static async getMasterKeyApiGlobalPermission(
    projectId: ObjectID,
  ): Promise<UserGlobalAccessPermission> {
    return {
      projectIds: [projectId],
      globalPermissions: [
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
        Permission.AuthenticatedRequest,
        Permission.ProjectOwner,
      ],
      _type: "UserGlobalAccessPermission",
    };
  }

  @CaptureSpan()
  public static async getMasterApiTenantAccessPermission(
    projectId: ObjectID,
  ): Promise<UserTenantAccessPermission> {
    const userPermissions: Array<UserPermission> = [];

    userPermissions.push({
      permission: Permission.ProjectOwner,
      labelIds: [],
      _type: "UserPermission",
    });

    const permission: UserTenantAccessPermission =
      UserPermissionUtil.getDefaultUserTenantAccessPermission(projectId);

    permission.permissions = permission.permissions.concat(userPermissions);

    return permission;
  }

  @CaptureSpan()
  public static async getApiTenantAccessPermission(
    projectId: ObjectID,
    apiKeyId: ObjectID,
  ): Promise<UserTenantAccessPermission> {
    // get team permissions (cached — see ApiKeyPermissionService).
    const apiKeyPermissionRows: Array<ApiKeyPermissionRow> =
      await ApiKeyPermissionService.findPermissionsByApiKeyId(apiKeyId);

    const userPermissions: Array<UserPermission> = apiKeyPermissionRows.map(
      (row: ApiKeyPermissionRow): UserPermission => {
        return {
          permission: row.permission,
          labelIds: row.labelIds,
          isBlockPermission: row.isBlockPermission,
          _type: "UserPermission",
        };
      },
    );

    const permission: UserTenantAccessPermission =
      UserPermissionUtil.getDefaultUserTenantAccessPermission(projectId);

    permission.permissions = permission.permissions.concat(userPermissions);

    return permission;
  }
}
