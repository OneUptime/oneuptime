import PermissionScope from "../Database/AccessControl/PermissionScope";
import Permission from "../Permission";

/*
 * THE TEAM PERMISSION ROWS A CUSTOM ROLE SHOULD BE, AND WHAT TO DO TO GET
 * THERE.
 *
 * A team given a custom role holds a copy of each of the role's permissions
 * as an ordinary team permission row, marked with the role given to the team
 * (teamCustomRoleId) and the role's own row it copies
 * (customRolePermissionId). Every check that reads a team's permissions -
 * the cached permissions of its members, who may be invited to it, who owns
 * the project - reads the copies as it reads a permission given directly, so
 * a role gives exactly what giving the same permissions directly would.
 *
 * planRoleCopies works out, from what the database holds, the copies the
 * roles should have and the changes that make it so:
 *
 *   - one copy for each role given to a team and each permission of that
 *     role, with the role's permission, scope and labels;
 *   - every copy that no longer matches - its role was taken from the team,
 *     the permission was taken out of the role, the permission, scope or
 *     labels changed, or it is a second copy of the same one - is deleted,
 *     and a fresh one created where one is still wanted.
 *
 * Deletes are made before creates (CustomRoleSync), so a change never
 * passes through a moment where a team holds more than the role gives. Pure,
 * so it is tested on its own against every shape of change.
 */

// A role given to a team (TeamCustomRole).
export interface RoleGivenToTeam {
  id: string;
  teamId: string;
  customRoleId: string;
}

// One permission of a role (CustomRolePermission).
export interface RolePermissionRow {
  id: string;
  customRoleId: string;
  permission: Permission;
  scope?: PermissionScope | undefined;
  labelIds: ReadonlyArray<string>;
}

// A team permission row a role's sync looks at: a copy, or what claims to be one.
export interface TeamPermissionCopyRow {
  id: string;
  teamId: string;
  customRoleId?: string | null | undefined;
  teamCustomRoleId?: string | null | undefined;
  customRolePermissionId?: string | null | undefined;
  permission: Permission;
  scope?: PermissionScope | undefined;
  labelIds: ReadonlyArray<string>;
  isBlockPermission?: boolean | undefined;
}

// A copy to create.
export interface TeamPermissionCopyToCreate {
  teamId: string;
  customRoleId: string;
  teamCustomRoleId: string;
  customRolePermissionId: string;
  permission: Permission;
  scope: PermissionScope;
  labelIds: Array<string>;
}

export interface RoleCopyPlan {
  // Ids of the team permission rows to delete.
  toDelete: Array<string>;
  toCreate: Array<TeamPermissionCopyToCreate>;
  // Every team whose rows the plan changes, each once.
  changedTeamIds: Array<string>;
}

// Ids are compared as the database writes them: lower case, as text.
const idKey: (id: string | null | undefined) => string = (
  id: string | null | undefined,
): string => {
  return (id || "").toString().toLowerCase();
};

const sortedLabelKeys: (labelIds: ReadonlyArray<string>) => Array<string> = (
  labelIds: ReadonlyArray<string>,
): Array<string> => {
  return Array.from(
    new Set<string>(
      labelIds.map((labelId: string): string => {
        return idKey(labelId);
      }),
    ),
  ).sort();
};

/*
 * The scope and labels a copy of a role's permission is written with: the
 * role's scope (All when it has none), and the labels only with the scope
 * Labels - what the role's rules let it hold (Types/Team/CustomRole).
 */
export const getCopyScope: (row: RolePermissionRow) => {
  scope: PermissionScope;
  labelIds: Array<string>;
} = (
  row: RolePermissionRow,
): { scope: PermissionScope; labelIds: Array<string> } => {
  const scope: PermissionScope = row.scope || PermissionScope.All;

  return {
    scope: scope,
    labelIds:
      scope === PermissionScope.Labels ? sortedLabelKeys(row.labelIds) : [],
  };
};

const copyKey: (
  teamCustomRoleId: string,
  rolePermissionId: string,
) => string = (teamCustomRoleId: string, rolePermissionId: string): string => {
  return `${idKey(teamCustomRoleId)}|${idKey(rolePermissionId)}`;
};

const isSameCopy: (
  existing: TeamPermissionCopyRow,
  wanted: TeamPermissionCopyToCreate,
) => boolean = (
  existing: TeamPermissionCopyRow,
  wanted: TeamPermissionCopyToCreate,
): boolean => {
  if (existing.isBlockPermission) {
    return false;
  }

  if (idKey(existing.teamId) !== idKey(wanted.teamId)) {
    return false;
  }

  if (idKey(existing.customRoleId) !== idKey(wanted.customRoleId)) {
    return false;
  }

  if (existing.permission !== wanted.permission) {
    return false;
  }

  if ((existing.scope || PermissionScope.All) !== wanted.scope) {
    return false;
  }

  /*
   * The wanted labels are empty unless the scope is Labels, so labels left
   * on a copy that should have none make it a different one too.
   */
  return (
    sortedLabelKeys(existing.labelIds).join(",") === wanted.labelIds.join(",")
  );
};

export const planRoleCopies: (data: {
  // The roles given to teams, of the roles being looked at.
  rolesGivenToTeams: ReadonlyArray<RoleGivenToTeam>;
  // The permissions of the roles being looked at.
  rolePermissions: ReadonlyArray<RolePermissionRow>;
  // Every team permission row that is a copy of one of those roles' permissions.
  copies: ReadonlyArray<TeamPermissionCopyRow>;
}) => RoleCopyPlan = (data: {
  rolesGivenToTeams: ReadonlyArray<RoleGivenToTeam>;
  rolePermissions: ReadonlyArray<RolePermissionRow>;
  copies: ReadonlyArray<TeamPermissionCopyRow>;
}): RoleCopyPlan => {
  const permissionsByRole: Map<string, Array<RolePermissionRow>> = new Map<
    string,
    Array<RolePermissionRow>
  >();

  for (const row of data.rolePermissions) {
    const roleKey: string = idKey(row.customRoleId);
    const rows: Array<RolePermissionRow> = permissionsByRole.get(roleKey) || [];
    rows.push(row);
    permissionsByRole.set(roleKey, rows);
  }

  // Every copy that should exist, by the role given to the team and the role's row.
  const wanted: Map<string, TeamPermissionCopyToCreate> = new Map<
    string,
    TeamPermissionCopyToCreate
  >();

  for (const given of data.rolesGivenToTeams) {
    for (const row of permissionsByRole.get(idKey(given.customRoleId)) || []) {
      const { scope, labelIds } = getCopyScope(row);

      wanted.set(copyKey(given.id, row.id), {
        teamId: given.teamId,
        customRoleId: given.customRoleId,
        teamCustomRoleId: given.id,
        customRolePermissionId: row.id,
        permission: row.permission,
        scope: scope,
        labelIds: labelIds,
      });
    }
  }

  const toDelete: Array<string> = [];
  const kept: Set<string> = new Set<string>();
  const changedTeamIds: Map<string, string> = new Map<string, string>();

  for (const copy of data.copies) {
    const key: string = copyKey(
      copy.teamCustomRoleId || "",
      copy.customRolePermissionId || "",
    );
    const wantedCopy: TeamPermissionCopyToCreate | undefined = wanted.get(key);

    if (
      copy.teamCustomRoleId &&
      copy.customRolePermissionId &&
      wantedCopy &&
      !kept.has(key) &&
      isSameCopy(copy, wantedCopy)
    ) {
      kept.add(key);
      continue;
    }

    toDelete.push(copy.id);
    changedTeamIds.set(idKey(copy.teamId), copy.teamId);
  }

  const toCreate: Array<TeamPermissionCopyToCreate> = [];

  for (const [key, wantedCopy] of wanted) {
    if (kept.has(key)) {
      continue;
    }

    toCreate.push(wantedCopy);
    changedTeamIds.set(idKey(wantedCopy.teamId), wantedCopy.teamId);
  }

  return {
    toDelete: toDelete,
    toCreate: toCreate,
    changedTeamIds: Array.from(changedTeamIds.values()),
  };
};
