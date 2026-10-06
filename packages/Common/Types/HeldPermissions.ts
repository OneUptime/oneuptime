import PermissionScope from "./Database/AccessControl/PermissionScope";
import Permission, { PermissionHelper, UserPermission } from "./Permission";

/*
 * WHAT A CALLER HOLDS: the one rule behind every "may they do this?" check,
 * on the server and in the dashboard alike.
 *
 * A caller's permissions in a project are rows - one for each permission on
 * each of their teams, or on their API key - and every row is an allow or a
 * block, limited to some labels or not, granted at a scope. The CRUD path
 * reads them like this (TablePermission, AccessControlPermission), and so
 * does everything else that asks whether the caller holds something:
 *
 *   - Only an allow row grants. A block row (isBlockPermission true) names a
 *     permission in order to take it away, so holding one is never holding
 *     the permission. Every stored row says which it is; the CRUD path reads
 *     the flag the same way (DatabaseCommonInteractionPropsUtil
 *     .getUserPermissions).
 *   - A block with no labels takes the permission away outright: anything
 *     that accepts it is refused, whatever else the caller holds, and a
 *     block on one team wins over an allow on another.
 *   - A block with labels takes the permission away only for records that
 *     carry one of those labels. A check that looks at no record - a route
 *     guard, a button - is not refused by it: the records are checked when
 *     they are read or written. A check that decides about records whose
 *     labels it does not look at counts it as a refusal
 *     (labelledBlocksRefuse).
 *   - An operation on an operational resource (a monitor, an incident, a
 *     dashboard, ...) also accepts the matching *AllOperationalResources
 *     wildcard, as the CRUD path's table check does - unless the wildcard is
 *     blocked itself. The wildcard never opens an operation nobody may do
 *     (an empty list).
 *
 * The server reads the rows from the request (Server/Utils/Permission
 * /CallerPermission), the dashboard from its permission snapshot
 * (UI/Utils/PermissionGate). Both hand them to this file and nothing else
 * decides.
 */

export interface HeldPermissions {
  /*
   * Every permission an allow row grants, whatever its scope or labels, and
   * the caller's global ones.
   */
  allowed: Array<Permission>;
  /*
   * The part of `allowed` that reaches the whole project: granted at scope
   * All, or with no labels and not limited to owned records. A role that
   * cannot be scoped (Project Owner, Project Admin) reaches the whole project
   * whatever scope its row carries, as the read checks treat it.
   */
  allowedProjectWide: Array<Permission>;
  // What a block with no labels takes away outright.
  blocked: Array<Permission>;
  // What a block with labels takes away from the records carrying them.
  blockedForSomeLabels: Array<Permission>;
}

export interface HeldPermissionsOptions {
  /*
   * The *AllOperationalResources wildcard that is accepted as well. Pass it
   * only when the list is an operational resource's own list for the
   * operation (getOperationalWildcard / getColumnWildcard): a list somebody
   * chose by hand is exactly as wide as it says.
   */
  wildcard?: Permission | null | undefined;
  /*
   * Count only grants that reach the whole project: for an action that
   * touches every record of the project, which a grant limited to some
   * labels or to owned records does not reach.
   */
  projectWideOnly?: boolean | undefined;
  /*
   * Count a block with labels as a refusal too: for a check that decides
   * about records whose labels it does not look at.
   */
  labelledBlocksRefuse?: boolean | undefined;
}

// The four operations a list of permissions can stand for.
export type PermissionOperation = "create" | "read" | "update" | "delete";

export default class HeldPermissionsUtil {
  // A row takes a permission away only when it says it is a block.
  public static isBlockRow(row: UserPermission): boolean {
    return row.isBlockPermission === true;
  }

  // Every other row grants.
  public static isAllowRow(row: UserPermission): boolean {
    return !HeldPermissionsUtil.isBlockRow(row);
  }

  public static hasLabels(row: UserPermission): boolean {
    return Boolean(row.labelIds && row.labelIds.length > 0);
  }

  /*
   * Whether an allow row reaches every record of the project: scope All, or
   * Labels (or a legacy row without a scope) with no labels on it. An Owned
   * row reaches only owned records - except on a role that cannot be scoped,
   * which the read checks treat as project-wide whatever its row says.
   */
  public static isProjectWideRow(row: UserPermission): boolean {
    if (row.scope === PermissionScope.All) {
      return true;
    }

    if (row.scope === PermissionScope.Owned) {
      return !PermissionHelper.isScopeApplicable(row.permission);
    }

    return !HeldPermissionsUtil.hasLabels(row);
  }

  /*
   * What `rows` (a caller's permission rows in one project) and
   * `globalPermissions` (theirs everywhere, held without labels or scope)
   * hold.
   */
  public static fromRows(data: {
    rows?: ReadonlyArray<UserPermission> | null | undefined;
    globalPermissions?: ReadonlyArray<Permission> | null | undefined;
  }): HeldPermissions {
    const held: HeldPermissions = {
      allowed: [],
      allowedProjectWide: [],
      blocked: [],
      blockedForSomeLabels: [],
    };

    const add: (list: Array<Permission>, permission: Permission) => void = (
      list: Array<Permission>,
      permission: Permission,
    ): void => {
      if (!list.includes(permission)) {
        list.push(permission);
      }
    };

    for (const permission of data.globalPermissions || []) {
      add(held.allowed, permission);
      add(held.allowedProjectWide, permission);
    }

    // Rows straight from a request or a stored snapshot: anything else is none.
    const rows: ReadonlyArray<UserPermission> = Array.isArray(data.rows)
      ? data.rows
      : [];

    for (const row of rows) {
      if (!row || !row.permission) {
        continue;
      }

      if (HeldPermissionsUtil.isBlockRow(row)) {
        add(
          HeldPermissionsUtil.hasLabels(row)
            ? held.blockedForSomeLabels
            : held.blocked,
          row.permission,
        );
        continue;
      }

      add(held.allowed, row.permission);

      if (HeldPermissionsUtil.isProjectWideRow(row)) {
        add(held.allowedProjectWide, row.permission);
      }
    }

    return held;
  }

  /*
   * A flat list of permissions taken as held - grants that reach the whole
   * project, nothing blocked. For a caller that was handed the list rather
   * than the rows (PermissionUtil.getAllPermissions, which already leaves
   * out what a block takes away).
   */
  public static fromPermissions(
    permissions: ReadonlyArray<Permission> | null | undefined,
  ): HeldPermissions {
    const allowed: Array<Permission> = [...new Set(permissions || [])];

    return {
      allowed: allowed,
      allowedProjectWide: [...allowed],
      blocked: [],
      blockedForSomeLabels: [],
    };
  }

  /*
   * Held as plain grants: what the allow rows give, less what a block with
   * no labels takes away. For a caller that only has a flat list of
   * permissions to compare against (PermissionUtil.getAllPermissions).
   */
  public static getUnblockedPermissions(
    held: HeldPermissions,
  ): Array<Permission> {
    return held.allowed.filter((permission: Permission): boolean => {
      return !held.blocked.includes(permission);
    });
  }

  // The blocks that refuse, given the options.
  public static getRefusingBlocks(
    held: HeldPermissions,
    options?: HeldPermissionsOptions | undefined,
  ): Array<Permission> {
    if (!options?.labelledBlocksRefuse) {
      return held.blocked;
    }

    return [...held.blocked, ...held.blockedForSomeLabels];
  }

  /*
   * Whether a block refuses an operation that accepts `accepted`: a block
   * (with no labels, or any block with labelledBlocksRefuse) on any one of
   * them. The wildcard is not in this list, as on the CRUD path: a block on
   * the wildcard takes away the wildcard, not the operation.
   */
  public static isBlockedFromAny(
    held: HeldPermissions,
    accepted: ReadonlyArray<Permission>,
    options?: HeldPermissionsOptions | undefined,
  ): boolean {
    const blocks: Array<Permission> = HeldPermissionsUtil.getRefusingBlocks(
      held,
      options,
    );

    return accepted.some((permission: Permission): boolean => {
      return blocks.includes(permission);
    });
  }

  /*
   * The allow half alone: an allow row for one of `accepted`, or for the
   * wildcard when one is given, the list is not empty and the wildcard is
   * not blocked itself. For the table check, which refuses blocks in a step
   * of its own (TablePermission.checkTableLevelBlockPermissions).
   */
  public static isGrantedAny(
    held: HeldPermissions,
    accepted: ReadonlyArray<Permission>,
    options?: HeldPermissionsOptions | undefined,
  ): boolean {
    if (accepted.length === 0) {
      return false;
    }

    const grants: Array<Permission> = options?.projectWideOnly
      ? held.allowedProjectWide
      : held.allowed;

    if (
      accepted.some((permission: Permission): boolean => {
        return grants.includes(permission);
      })
    ) {
      return true;
    }

    const wildcard: Permission | null | undefined = options?.wildcard;

    return Boolean(
      wildcard &&
        grants.includes(wildcard) &&
        !HeldPermissionsUtil.getRefusingBlocks(held, options).includes(
          wildcard,
        ),
    );
  }

  /*
   * THE RULE: whether the caller holds one of `accepted` - an allow row for
   * one of them (or for the wildcard), and no block on any of them. An empty
   * list is held by nobody.
   */
  public static holdsAnyOf(
    held: HeldPermissions,
    accepted: ReadonlyArray<Permission>,
    options?: HeldPermissionsOptions | undefined,
  ): boolean {
    if (HeldPermissionsUtil.isBlockedFromAny(held, accepted, options)) {
      return false;
    }

    return HeldPermissionsUtil.isGrantedAny(held, accepted, options);
  }

  // The *AllOperationalResources wildcard for an operation.
  public static getOperationalWildcard(
    operation: PermissionOperation | string,
  ): Permission | null {
    switch (operation) {
      case "create":
        return Permission.CreateAllOperationalResources;
      case "read":
        return Permission.ReadAllOperationalResources;
      case "update":
        return Permission.EditAllOperationalResources;
      case "delete":
        return Permission.DeleteAllOperationalResources;
      default:
        return null;
    }
  }

  /*
   * The wildcard an operation on a model accepts: its operation's wildcard
   * when the model is an operational resource, else none.
   */
  public static getModelWildcard(data: {
    isOperationalResource: boolean | undefined;
    operation: PermissionOperation | string;
  }): Permission | null {
    if (!data.isOperationalResource) {
      return null;
    }

    return HeldPermissionsUtil.getOperationalWildcard(data.operation);
  }

  /*
   * The wildcard a COLUMN of a model accepts: the model's, when the column
   * lets in everyone the table does for the operation - every permission of
   * the table's list is on the column's. A column that is narrower than its
   * table on purpose (a secret only editors read, a value the server alone
   * writes) keeps exactly the list it names.
   */
  public static getColumnWildcard(data: {
    isOperationalResource: boolean | undefined;
    operation: PermissionOperation | string;
    tablePermissions: ReadonlyArray<Permission>;
    columnPermissions: ReadonlyArray<Permission>;
  }): Permission | null {
    if (data.tablePermissions.length === 0) {
      return null;
    }

    const coversTable: boolean = data.tablePermissions.every(
      (permission: Permission): boolean => {
        return data.columnPermissions.includes(permission);
      },
    );

    if (!coversTable) {
      return null;
    }

    return HeldPermissionsUtil.getModelWildcard({
      isOperationalResource: data.isOperationalResource,
      operation: data.operation,
    });
  }
}
