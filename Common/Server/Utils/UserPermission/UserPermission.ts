import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import GlobalCache from "../../Infrastructure/GlobalCache";
import PermissionNamespace from "../../Types/Permission/PermissionNamespace";

export default class UserPermissionUtil {
  public static async getUserTenantAccessPermissionFromCache(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<UserTenantAccessPermission | null> {
    const json: UserTenantAccessPermission | null =
      (await GlobalCache.getJSONObject(
        PermissionNamespace.ProjectPermission,
        userId.toString() + projectId.toString(),
      )) as UserTenantAccessPermission;

    if (json) {
      json._type = "UserTenantAccessPermission";
    }

    if (!json) {
      return null;
    }

    return json;
  }

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
