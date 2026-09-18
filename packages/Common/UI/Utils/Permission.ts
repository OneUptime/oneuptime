import {
  DropdownOption,
  DropdownOptionGroup,
} from "../Components/Dropdown/Dropdown";
import LocalStorage from "./LocalStorage";
import { JSONObject } from "../../Types/JSON";
import Permission, {
  PermissionGroup,
  PermissionHelper,
  PermissionProps,
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "../../Types/Permission";

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

  public static getAllPermissions(): Array<Permission> {
    let permissions: Array<Permission> = [];

    const globalPermissions: UserGlobalAccessPermission | null =
      this.getGlobalPermissions();

    if (globalPermissions) {
      permissions = [...globalPermissions.globalPermissions];
    }

    const projectPermissions: UserTenantAccessPermission | null =
      this.getProjectPermissions();

    if (projectPermissions) {
      permissions = [
        ...permissions,
        ...projectPermissions.permissions.map((i: UserPermission) => {
          return i.permission;
        }),
      ];
    }

    return permissions;
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
