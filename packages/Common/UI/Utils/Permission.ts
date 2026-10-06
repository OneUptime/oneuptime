import {
  DropdownOption,
  DropdownOptionGroup,
} from "../Components/Dropdown/Dropdown";
import LocalStorage from "./LocalStorage";
import { JSONObject } from "../../Types/JSON";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../Types/HeldPermissions";
import Permission, {
  PermissionGroup,
  PermissionHelper,
  PermissionProps,
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../Types/Permission";

/*
 * The signed-in user's permission snapshot, as the API's permission headers
 * leave it in storage: their global permissions and their rows in the
 * current project.
 *
 * Whether the user may do something is decided by PermissionGate
 * (holdsAnyOf, check, canReadColumn), which reads this snapshot by the rule
 * the server follows (Types/HeldPermissions). Nothing else decides from the
 * raw rows (Tests/UI/Utils/PermissionGateGuard).
 */
export default class PermissionUtil {
  public static getGlobalPermissions(): UserGlobalAccessPermission | null {
    if (!LocalStorage.getItem("global_permissions")) {
      return null;
    }
    const globalPermissions: JSONObject = LocalStorage.getItem(
      "global_permissions",
    ) as JSONObject;

    return globalPermissions as UserGlobalAccessPermission;
  }

  /*
   * What the user holds, read by the one rule (HeldPermissionsUtil): their
   * global permissions, every allow row, and what their blocks take away.
   */
  public static getHeldPermissions(): HeldPermissions {
    return HeldPermissionsUtil.fromRows({
      rows: this.getProjectPermissions()?.permissions || [],
      globalPermissions: this.getGlobalPermissions()?.globalPermissions || [],
    });
  }

  /*
   * The permissions the user holds, as a flat list: what their allow rows
   * (and global permissions) grant, less what a block with no labels takes
   * away. A block row is never in it. Empty until the snapshot has loaded.
   */
  public static getAllPermissions(): Array<Permission> {
    return HeldPermissionsUtil.getUnblockedPermissions(
      this.getHeldPermissions(),
    );
  }

  public static getProjectPermissions(): UserTenantAccessPermission | null {
    if (!LocalStorage.getItem("project_permissions")) {
      return null;
    }
    const permissions: JSONObject = LocalStorage.getItem(
      "project_permissions",
    ) as JSONObject;

    const userTenantAccessPermission: UserTenantAccessPermission =
      permissions as UserTenantAccessPermission;
    userTenantAccessPermission._type = "UserTenantAccessPermission";
    return userTenantAccessPermission;
  }

  public static projectPermissionsAsDropdownOptions(): Array<DropdownOptionGroup> {
    const permissions: Array<PermissionProps> =
      PermissionHelper.getTenantPermissionProps();

    const groupMap: Map<PermissionGroup, Array<DropdownOption>> = new Map();

    for (const permissionProp of permissions) {
      const group: PermissionGroup = permissionProp.group;

      if (!groupMap.has(group)) {
        groupMap.set(group, []);
      }

      groupMap.get(group)!.push({
        value: permissionProp.permission,
        label: permissionProp.title,
      });
    }

    const groups: Array<DropdownOptionGroup> = [];

    for (const [group, options] of groupMap) {
      groups.push({
        label: group,
        options,
      });
    }

    return groups;
  }

  public static setGlobalPermissions(
    permissions: UserGlobalAccessPermission,
  ): void {
    LocalStorage.setItem("global_permissions", permissions);
  }

  public static setProjectPermissions(
    permissions: UserTenantAccessPermission,
  ): void {
    LocalStorage.setItem("project_permissions", permissions);
  }

  public static clearProjectPermissions(): void {
    LocalStorage.setItem("project_permissions", null);
  }
}
