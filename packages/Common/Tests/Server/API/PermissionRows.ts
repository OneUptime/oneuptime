import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";

/*
 * A caller's permission rows as a request carries them
 * (`userTenantAccessPermission`, keyed by project id), for route tests. A
 * route reads them by the rule every permission check follows
 * (Server/Utils/Permission/CallerPermission), so a test hands it rows - allow
 * and block alike - rather than stubbing what the route sees.
 */

export interface PermissionRowOptions {
  isBlock?: boolean | undefined;
  // A row limited to some labels (one generated label).
  labelled?: boolean | undefined;
}

export function permissionRow(
  permission: Permission,
  options?: PermissionRowOptions | undefined,
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: options?.labelled ? [ObjectID.generate()] : [],
    isBlockPermission: Boolean(options?.isBlock),
  };
}

// The rows for one project: a permission alone stands for its allow row.
export function tenantPermissionsFor(
  projectId: ObjectID,
  rows: Array<UserPermission | Permission>,
): Dictionary<UserTenantAccessPermission> {
  return {
    [projectId.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: projectId,
      permissions: rows.map(
        (entry: UserPermission | Permission): UserPermission => {
          return typeof entry === "string" ? permissionRow(entry) : entry;
        },
      ),
    },
  };
}
