import APIKeyPermission from "../../../Models/DatabaseModels/ApiKeyPermission";
import Label from "../../../Models/DatabaseModels/Label";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import ApiKeyPermissionService from "../../Services/ApiKeyPermissionService";
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
    // get team permissions.
    const apiKeyPermission: Array<APIKeyPermission> =
      await ApiKeyPermissionService.findBy({
        query: {
          apiKeyId: apiKeyId,
        },
        select: {
          permission: true,
          labels: {
            _id: true,
          },
          isBlockPermission: true,
        },

        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const userPermissions: Array<UserPermission> = [];

    for (const apiPermission of apiKeyPermission) {
      if (!apiPermission.labels) {
        apiPermission.labels = [];
      }

      userPermissions.push({
        permission: apiPermission.permission!,
        labelIds: apiPermission.labels.map((label: Label) => {
          return label.id!;
        }),
        isBlockPermission: apiPermission.isBlockPermission,
        _type: "UserPermission",
      });
    }

    const permission: UserTenantAccessPermission =
      UserPermissionUtil.getDefaultUserTenantAccessPermission(projectId);

    permission.permissions = permission.permissions.concat(userPermissions);

    return permission;
  }
}
