import Permission, {
  PermissionHelper,
  UserPermission,
  UserTenantAccessPermission,
  instanceOfUserTenantAccessPermission,
} from "../Permission";

export default class ModelPermission {
  public static hasPermissions(
    userProjectPermissions: UserTenantAccessPermission | Array<Permission>,
    modelPermissions: Array<Permission>,
  ): boolean {
    let userPermissions: Array<Permission> = [];

    if (
      instanceOfUserTenantAccessPermission(userProjectPermissions) &&
      userProjectPermissions.permissions &&
      Array.isArray(userProjectPermissions.permissions)
    ) {
      userPermissions = userProjectPermissions.permissions.map(
        (item: UserPermission) => {
          return item.permission;
        },
      );
    } else {
      userPermissions = userProjectPermissions as Array<Permission>;
    }

    return Boolean(
      userPermissions &&
        PermissionHelper.doesPermissionsIntersect(
          modelPermissions,
          userPermissions,
        ),
    );
  }
}
