import Dictionary from "../../../Types/Dictionary";
import HeldPermissionsUtil, {
  HeldPermissions,
  HeldPermissionsOptions,
  PermissionOperation,
} from "../../../Types/HeldPermissions";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";

/*
 * Whether the caller of a request holds a permission in a project: the
 * server's one reader of a caller's permission rows for that question.
 *
 * Route guards, custom endpoints and service checks that ask "may the caller
 * do X?" outside the CRUD path ask here, so a block row is never read as a
 * grant and a block with no labels takes its permission away - the rule in
 * Types/HeldPermissions, which the CRUD path's table check and the
 * dashboard's PermissionGate follow too. Tests/Server/Utils/Permission
 * /CallerPermissionGuard keeps other server code from reading the rows to
 * decide a grant.
 *
 * Root and master-admin callers are the caller's business: this reads only
 * the permission rows, so a guard that lets them through says so itself.
 */

/*
 * What the caller's permissions are carried on: a request
 * (OneUptimeRequest) or the props built from one
 * (DatabaseCommonInteractionProps) - both name them the same way.
 */
export interface PermissionCarrier {
  tenantId?: ObjectID | null | undefined;
  userTenantAccessPermission?:
    | Dictionary<UserTenantAccessPermission>
    | undefined;
  userGlobalAccessPermission?: UserGlobalAccessPermission | undefined;
}

export interface CallerPermissionOptions extends HeldPermissionsOptions {
  /*
   * The project to read the caller's rows for, when it is not the request's
   * own (the tenant): a route that names its project in the body.
   */
  projectId?: ObjectID | null | undefined;
}

// A model whose own list for an operation is asked about.
export interface PermissionListModel {
  isOperationalResource?: boolean | undefined;
  getCreatePermissions: () => Array<Permission>;
  getReadPermissions: () => Array<Permission>;
  getUpdatePermissions: () => Array<Permission>;
  getDeletePermissions: () => Array<Permission>;
}

export default class CallerPermission {
  /*
   * The caller's permission rows in the project (none when not a member).
   * Private: they are only ever read through the rule (getHeld).
   */
  private static getRows(
    carrier: PermissionCarrier,
    projectId?: ObjectID | null | undefined,
  ): Array<UserPermission> {
    const project: ObjectID | null | undefined = projectId || carrier.tenantId;

    if (!project) {
      return [];
    }

    return (
      carrier.userTenantAccessPermission?.[project.toString()]?.permissions ||
      []
    );
  }

  /*
   * Whether the request was authorized for the project at all: a member who
   * accepted an invitation, or the project's own API key. Holding nothing in
   * particular - for what every member may see.
   */
  public static isProjectMember(
    carrier: PermissionCarrier,
    projectId?: ObjectID | null | undefined,
  ): boolean {
    const project: ObjectID | null | undefined = projectId || carrier.tenantId;

    return Boolean(
      project && carrier.userTenantAccessPermission?.[project.toString()],
    );
  }

  // What the caller holds in the project, by the one rule.
  public static getHeld(
    carrier: PermissionCarrier,
    projectId?: ObjectID | null | undefined,
  ): HeldPermissions {
    return HeldPermissionsUtil.fromRows({
      rows: CallerPermission.getRows(carrier, projectId),
      globalPermissions:
        carrier.userGlobalAccessPermission?.globalPermissions || [],
    });
  }

  /*
   * Whether the caller holds one of `permissions` in the project: an allow
   * row for one of them (or for the wildcard, when one is given) and no
   * block on any of them.
   */
  public static holdsAnyOf(
    carrier: PermissionCarrier,
    permissions: ReadonlyArray<Permission>,
    options?: CallerPermissionOptions | undefined,
  ): boolean {
    return HeldPermissionsUtil.holdsAnyOf(
      CallerPermission.getHeld(carrier, options?.projectId),
      permissions,
      options,
    );
  }

  /*
   * The allow half of holdsAnyOf alone, for a check that refuses blocks in a
   * step of its own with a message that names the block
   * (TablePermission.checkTableLevelBlockPermissions). Anything else asks
   * holdsAnyOf.
   */
  public static isGrantedAny(
    carrier: PermissionCarrier,
    permissions: ReadonlyArray<Permission>,
    options?: CallerPermissionOptions | undefined,
  ): boolean {
    return HeldPermissionsUtil.isGrantedAny(
      CallerPermission.getHeld(carrier, options?.projectId),
      permissions,
      options,
    );
  }

  /*
   * Whether the caller holds one of a model's own permissions for an
   * operation - the table half of what the CRUD path asks, wildcard
   * included. Labels and owned scope are about records, so a route that
   * reads or writes records still does that with the caller's props.
   */
  public static holdsModelPermission(
    carrier: PermissionCarrier,
    data: {
      model: PermissionListModel;
      operation: PermissionOperation;
    },
    options?: CallerPermissionOptions | undefined,
  ): boolean {
    return CallerPermission.holdsAnyOf(
      carrier,
      CallerPermission.getModelPermissions(data.model, data.operation),
      {
        ...options,
        wildcard: HeldPermissionsUtil.getModelWildcard({
          isOperationalResource: data.model.isOperationalResource,
          operation: data.operation,
        }),
      },
    );
  }

  public static getModelPermissions(
    model: PermissionListModel,
    operation: PermissionOperation,
  ): Array<Permission> {
    switch (operation) {
      case "create":
        return model.getCreatePermissions() || [];
      case "read":
        return model.getReadPermissions() || [];
      case "update":
        return model.getUpdatePermissions() || [];
      case "delete":
        return model.getDeletePermissions() || [];
      default:
        return [];
    }
  }
}
