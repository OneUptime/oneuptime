import APIKeyPermission from "../../../Models/DatabaseModels/ApiKeyPermission";
import Label from "../../../Models/DatabaseModels/Label";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import ApiKeyPermissionService from "../../Services/ApiKeyPermissionService";
import UserPermissionUtil from "../UserPermission/UserPermission";

export default class AccessPermission {
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
