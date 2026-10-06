import HeldPermissionsUtil from "../HeldPermissions";
import Permission, {
  PermissionHelper,
  UserTenantAccessPermission,
  instanceOfUserTenantAccessPermission,
} from "../Permission";

export default class ModelPermission {
  /*
   * Whether a caller holds one of `modelPermissions`.
   *
   * Given their permission rows in a project, the rows are read by the one
   * rule (HeldPermissionsUtil): an allow row grants, a block row never does,
   * and a block with no labels on any of `modelPermissions` refuses. Given a
   * flat list, the list is taken as the permissions they hold - the
   * dashboard's PermissionUtil.getAllPermissions, which already leaves out
   * what a block takes away.
   */
  public static hasPermissions(
    userProjectPermissions: UserTenantAccessPermission | Array<Permission>,
    modelPermissions: Array<Permission>,
  ): boolean {
    if (instanceOfUserTenantAccessPermission(userProjectPermissions)) {
      return HeldPermissionsUtil.holdsAnyOf(
        HeldPermissionsUtil.fromRows({
          rows: Array.isArray(userProjectPermissions.permissions)
            ? userProjectPermissions.permissions
            : [],
        }),
        modelPermissions || [],
      );
    }

    const userPermissions: Array<Permission> =
      userProjectPermissions as Array<Permission>;

    return Boolean(
      userPermissions &&
        PermissionHelper.doesPermissionsIntersect(
          modelPermissions,
          userPermissions,
        ),
    );
  }
}
