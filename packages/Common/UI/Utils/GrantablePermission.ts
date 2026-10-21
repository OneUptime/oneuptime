import PermissionScope from "../../Types/Database/AccessControl/PermissionScope";
import HeldPermissionsUtil from "../../Types/HeldPermissions";
import Permission, {
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "../../Types/Permission";
import PermissionUtil from "./Permission";
import User from "./User";

/*
 * WHAT A USER MAY HAND ON: the dashboard's copy of the server's grant
 * ceiling, for the defaults it offers.
 *
 * Giving someone a permission is delegation. Inviting a person to a team
 * hands them that team's permissions, and adding a role to an API key hands
 * the key that role, so the server allows either only when the person doing
 * it holds the permission themselves (TeamPermissionService
 * .assertCanGrantPermission, behind invitations, and ApiKeyPermissionService
 * .assertCallerCanGrantPermission):
 *
 *   - a project owner may hand on anything, unless something blocks their
 *     ProjectOwner;
 *   - anyone else only a permission they hold for the whole project (scope
 *     All, or no label restriction - never Owned), and not one they are
 *     blocked from.
 *
 * A form that preselects a team or offers a role uses this to offer only
 * what the server would accept, so a default never ends in "You cannot
 * grant ...". It covers grants that reach the whole project, the only kind
 * a default makes, and it is never looser than the server: what it says yes
 * to, the server accepts. A no only means the default is not offered - the
 * person can still pick the team or the role by hand, and the server
 * explains its own refusal. It splits the rows into allows and blocks as
 * the server does (HeldPermissionsUtil.isBlockRow: a row is a block only
 * when it says so).
 *
 * canGrantTeamPermission weighs one of a team's own rows at the scope and
 * labels it has, as the server does when someone is added to the team: the
 * single sign-on provider forms use it to say, before saving, which picked
 * teams the server would refuse (people who sign in with a provider join its
 * teams, so its teams meet the same ceiling - Server/Utils
 * /SsoProviderTeamGrant).
 */

export interface PermissionRows {
  allow: Array<UserPermission>;
  block: Array<UserPermission>;
}

type IsUnrestrictedFunction = (permission: UserPermission) => boolean;

/*
 * A row that reaches the whole project: scope All, or (Labels, or a legacy
 * row with no scope) with no labels on it. Owned never does: an owned-only
 * grant cannot be handed on as a project-wide one.
 */
export const isUnrestrictedPermission: IsUnrestrictedFunction = (
  permission: UserPermission,
): boolean => {
  if (permission.scope === PermissionScope.All) {
    return true;
  }

  /*
   * Owned never does, and neither does a scope this copy does not know: the
   * server counts only All, and Labels or no scope without labels.
   */
  if (permission.scope && permission.scope !== PermissionScope.Labels) {
    return false;
  }

  return (permission.labelIds || []).length === 0;
};

type HoldsUnblockedFunction = (data: {
  permission: Permission;
  rows: PermissionRows;
}) => boolean;

/*
 * Held for the whole project, and not blocked at all - a block with labels
 * still takes part of the project away from a project-wide grant.
 */
const holdsUnblocked: HoldsUnblockedFunction = (data: {
  permission: Permission;
  rows: PermissionRows;
}): boolean => {
  const isHeld: boolean = data.rows.allow.some(
    (row: UserPermission): boolean => {
      return (
        row.permission === data.permission && isUnrestrictedPermission(row)
      );
    },
  );

  if (!isHeld) {
    return false;
  }

  return !data.rows.block.some((row: UserPermission): boolean => {
    return row.permission === data.permission;
  });
};

type CanGrantPermissionFunction = (data: {
  permission: Permission;
  rows: PermissionRows;
}) => boolean;

/**
 * Whether someone holding `rows` may hand `permission` on to a team member or
 * an API key, for the whole project.
 */
export const canGrantPermission: CanGrantPermissionFunction = (data: {
  permission: Permission;
  rows: PermissionRows;
}): boolean => {
  if (
    holdsUnblocked({
      permission: Permission.ProjectOwner,
      rows: data.rows,
    })
  ) {
    return true;
  }

  return holdsUnblocked(data);
};

/*
 * One permission row of a team, as joining the team hands it on: the
 * permission, the scope it is held at, and the labels it is limited to.
 * Allow and block rows alike are handed on with the team, and both are
 * weighed the same way (TeamPermissionService.assertCanGrantTeamPermissions).
 */
export interface TeamPermissionGrant {
  permission: Permission;
  scope?: PermissionScope | undefined;
  labelIds?: Array<string> | undefined;
}

type CallerRowCoversFunction = (data: {
  callerRow: UserPermission;
  grant: TeamPermissionGrant;
}) => boolean;

/*
 * Whether one of the caller's allow rows reaches as far as the grant does:
 * a project-wide row reaches anything, and a label-limited row reaches a
 * grant limited to labels it holds every one of. Ids are compared as text,
 * as the server compares them (TeamPermissionService.permissionCoversGrant).
 */
const callerRowCovers: CallerRowCoversFunction = (data: {
  callerRow: UserPermission;
  grant: TeamPermissionGrant;
}): boolean => {
  if (isUnrestrictedPermission(data.callerRow)) {
    return true;
  }

  const grantLabelIds: Array<string> = data.grant.labelIds || [];

  if (
    !isLabelScopedGrant(data.grant) ||
    data.callerRow.scope === PermissionScope.Owned
  ) {
    return false;
  }

  const callerLabelIds: Set<string> = new Set<string>(
    (data.callerRow.labelIds || []).map((labelId: unknown): string => {
      return String(labelId);
    }),
  );

  return grantLabelIds.every((labelId: string): boolean => {
    return callerLabelIds.has(labelId);
  });
};

type IsLabelScopedGrantFunction = (grant: TeamPermissionGrant) => boolean;

// A grant limited to some labels: it carries labels, at a scope that uses them.
const isLabelScopedGrant: IsLabelScopedGrantFunction = (
  grant: TeamPermissionGrant,
): boolean => {
  return (
    (grant.labelIds || []).length > 0 &&
    grant.scope !== PermissionScope.All &&
    grant.scope !== PermissionScope.Owned
  );
};

type CanGrantTeamPermissionFunction = (data: {
  grant: TeamPermissionGrant;
  rows: PermissionRows;
}) => boolean;

/**
 * Whether someone holding `rows` may hand on one permission row of a team,
 * at the scope and labels the row has: the server's grant ceiling exactly
 * (TeamPermissionService.assertCanGrantPermission), where canGrantPermission
 * answers only for a grant to the whole project.
 *
 *   - a project owner may hand on anything, unless something blocks their
 *     ProjectOwner;
 *   - anyone else needs the same permission at an equal or broader reach -
 *     project-wide, or limited to every label the row is limited to - and no
 *     block on it that reaches what the row grants.
 */
export const canGrantTeamPermission: CanGrantTeamPermissionFunction = (data: {
  grant: TeamPermissionGrant;
  rows: PermissionRows;
}): boolean => {
  if (
    holdsUnblocked({
      permission: Permission.ProjectOwner,
      rows: data.rows,
    })
  ) {
    return true;
  }

  const isHeld: boolean = data.rows.allow.some(
    (row: UserPermission): boolean => {
      return (
        row.permission === data.grant.permission &&
        callerRowCovers({ callerRow: row, grant: data.grant })
      );
    },
  );

  if (!isHeld) {
    return false;
  }

  const grantLabelIds: Array<string> = data.grant.labelIds || [];
  const isLabelScoped: boolean = isLabelScopedGrant(data.grant);

  const isBlocked: boolean = data.rows.block.some(
    (row: UserPermission): boolean => {
      if (row.permission !== data.grant.permission) {
        return false;
      }

      const blockedLabelIds: Array<string> = (row.labelIds || []).map(
        (labelId: unknown): string => {
          return String(labelId);
        },
      );

      if (
        !isLabelScoped ||
        row.scope === PermissionScope.All ||
        row.scope === PermissionScope.Owned ||
        blockedLabelIds.length === 0
      ) {
        return true;
      }

      return blockedLabelIds.some((labelId: string): boolean => {
        return grantLabelIds.includes(labelId);
      });
    },
  );

  return !isBlocked;
};

type IsBlockedFromAnyFunction = (data: {
  permissions: Array<Permission>;
  rows: PermissionRows;
}) => boolean;

/*
 * Whether a block takes a whole table away: a block with no labels on ANY
 * permission a table accepts for an operation refuses that operation
 * outright, whatever else the user holds - the server's table-level block
 * check (TablePermission.checkTableLevelBlockPermissions), which every
 * create runs before it weighs a grant. PermissionGate weighs only what the
 * user is allowed, so a form that offers to add a permission asks this as
 * well: someone blocked from ProjectOwner may not add a permission to a team
 * at all, though they hold ProjectAdmin. A block with labels takes only part
 * of the table away, so it does not count here.
 */
export const isBlockedFromAny: IsBlockedFromAnyFunction = (data: {
  permissions: Array<Permission>;
  rows: PermissionRows;
}): boolean => {
  return data.rows.block.some((row: UserPermission): boolean => {
    return (
      data.permissions.includes(row.permission) &&
      (row.labelIds || []).length === 0
    );
  });
};

type ToPermissionRowsFunction = (data: {
  projectPermissions: UserTenantAccessPermission | null;
  globalPermissions: UserGlobalAccessPermission | null;
}) => PermissionRows;

/*
 * The signed-in user's permissions as the server reads them for a request in
 * this project: the global ones count as project-wide allows, and the
 * project's own rows split into allows and blocks.
 */
export const toPermissionRows: ToPermissionRowsFunction = (data: {
  projectPermissions: UserTenantAccessPermission | null;
  globalPermissions: UserGlobalAccessPermission | null;
}): PermissionRows => {
  const allow: Array<UserPermission> = (
    data.globalPermissions?.globalPermissions || []
  ).map((permission: Permission): UserPermission => {
    return {
      permission: permission,
      labelIds: [],
      isBlockPermission: false,
      _type: "UserPermission",
    };
  });

  const block: Array<UserPermission> = [];

  for (const row of data.projectPermissions?.permissions || []) {
    // A row is a block only when it says so, as the server reads it.
    if (HeldPermissionsUtil.isBlockRow(row)) {
      block.push(row);
    } else {
      allow.push(row);
    }
  }

  return { allow, block };
};

export default class GrantablePermission {
  public static getCurrentUserPermissionRows(): PermissionRows {
    return toPermissionRows({
      projectPermissions: PermissionUtil.getProjectPermissions(),
      globalPermissions: PermissionUtil.getGlobalPermissions(),
    });
  }

  /*
   * Whether the signed-in user may hand `permission` on. A master admin may
   * hand on anything, as on the server.
   */
  public static canCurrentUserGrant(permission: Permission): boolean {
    if (User.isMasterAdmin()) {
      return true;
    }

    return canGrantPermission({
      permission: permission,
      rows: this.getCurrentUserPermissionRows(),
    });
  }

  /*
   * Whether a block the signed-in user holds refuses them a table whose
   * operation accepts `permissions` (isBlockedFromAny). Never for a master
   * admin, as on the server.
   */
  public static isCurrentUserBlockedFromAny(
    permissions: Array<Permission>,
  ): boolean {
    if (User.isMasterAdmin()) {
      return false;
    }

    return isBlockedFromAny({
      permissions: permissions,
      rows: this.getCurrentUserPermissionRows(),
    });
  }

  /*
   * Whether the signed-in user may hand on every one of `permissions` - what
   * inviting someone to a team takes, for each row the team has.
   */
  public static canCurrentUserGrantAll(
    permissions: Array<Permission>,
  ): boolean {
    if (User.isMasterAdmin()) {
      return true;
    }

    const rows: PermissionRows = this.getCurrentUserPermissionRows();

    return permissions.every((permission: Permission): boolean => {
      return canGrantPermission({ permission: permission, rows: rows });
    });
  }

  /*
   * Whether the signed-in user may add someone to a team with these
   * permission rows, each at the scope and labels it has
   * (canGrantTeamPermission). A team with no rows is handed on by anyone; a
   * master admin may hand on any team, as on the server.
   */
  public static canCurrentUserGrantTeam(
    grants: Array<TeamPermissionGrant>,
  ): boolean {
    if (User.isMasterAdmin()) {
      return true;
    }

    const rows: PermissionRows = this.getCurrentUserPermissionRows();

    return grants.every((grant: TeamPermissionGrant): boolean => {
      return canGrantTeamPermission({ grant: grant, rows: rows });
    });
  }
}
