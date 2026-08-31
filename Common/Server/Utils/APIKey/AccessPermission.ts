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
