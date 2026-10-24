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
 *
 * An API key given a custom role (ApiKeyCustomRole) holds copies the same
 * way, as ordinary API key permission rows marked with the role given to
 * the key (apiKeyCustomRoleId) and the role's row they copy, and
 * planApiKeyRoleCopies works them out the same way - with one difference: a
 * permission the role limits to what its holder owns gives a key nothing.
 * Ownership is a person's or a team's, a key is neither and owns nothing,
 * so no copy of it is made (getApiKeyCopyLabels), and a key's copy holds
 * the role's permission with its labels: for the whole project, or for the
 * resources carrying one of the labels.
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

/*
 * Whether a permission of a role, at this scope, gives an API key given the
 * role anything: every scope but Owned. A key owns nothing - ownership is a
 * person's or a team's - so a permission limited to what its holder owns
 * would reach nothing of a key's, and no copy of it is made.
 */
export const isRolePermissionGivenToApiKeys: (
  scope: PermissionScope | string | undefined | null,
) => boolean = (
  scope: PermissionScope | string | undefined | null,
): boolean => {
  return (scope || PermissionScope.All) !== PermissionScope.Owned;
};

/*
 * The labels an API key's copy of a role's permission is written with -
 * none for the whole project, or the role's labels for the scope Labels -
 * or null when the permission gives a key nothing
 * (isRolePermissionGivenToApiKeys) and no copy is made.
 */
export const getApiKeyCopyLabels: (
  row: RolePermissionRow,
) => Array<string> | null = (row: RolePermissionRow): Array<string> | null => {
  if (!isRolePermissionGivenToApiKeys(row.scope)) {
    return null;
  }

  return getCopyScope(row).labelIds;
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

// A role given to an API key (ApiKeyCustomRole).
export interface RoleGivenToApiKey {
  id: string;
  apiKeyId: string;
  customRoleId: string;
}

// An API key permission row a role's sync looks at: a copy, or what claims to be one.
export interface ApiKeyPermissionCopyRow {
  id: string;
  apiKeyId: string;
  customRoleId?: string | null | undefined;
  apiKeyCustomRoleId?: string | null | undefined;
  customRolePermissionId?: string | null | undefined;
  permission: Permission;
  labelIds: ReadonlyArray<string>;
  isBlockPermission?: boolean | undefined;
}

// A copy to create on an API key.
export interface ApiKeyPermissionCopyToCreate {
  apiKeyId: string;
  customRoleId: string;
  apiKeyCustomRoleId: string;
  customRolePermissionId: string;
  permission: Permission;
  labelIds: Array<string>;
}

export interface ApiKeyRoleCopyPlan {
  // Ids of the API key permission rows to delete.
  toDelete: Array<string>;
  toCreate: Array<ApiKeyPermissionCopyToCreate>;
  // Every API key whose rows the plan changes, each once.
  changedApiKeyIds: Array<string>;
}

const isSameApiKeyCopy: (
  existing: ApiKeyPermissionCopyRow,
  wanted: ApiKeyPermissionCopyToCreate,
) => boolean = (
  existing: ApiKeyPermissionCopyRow,
  wanted: ApiKeyPermissionCopyToCreate,
): boolean => {
  if (existing.isBlockPermission) {
    return false;
  }

  if (idKey(existing.apiKeyId) !== idKey(wanted.apiKeyId)) {
    return false;
  }

  if (idKey(existing.customRoleId) !== idKey(wanted.customRoleId)) {
    return false;
  }

  if (existing.permission !== wanted.permission) {
    return false;
  }

  /*
   * The wanted labels are empty for the whole project, so labels left on a
   * copy that should have none make it a different one too.
   */
  return (
    sortedLabelKeys(existing.labelIds).join(",") === wanted.labelIds.join(",")
  );
};

/*
 * The copies the roles given to API keys should be, and the changes that
 * make it so - as planRoleCopies does for teams:
 *
 *   - one copy for each role given to a key and each permission of that
 *     role that gives a key anything (getApiKeyCopyLabels), with the role's
 *     permission and labels;
 *   - every copy that no longer matches - its role was taken from the key,
 *     the permission was taken out of the role or limited to what is owned,
 *     the permission or its labels changed, or it is a second copy of the
 *     same one - is deleted, and a fresh one created where one is still
 *     wanted.
 */
export const planApiKeyRoleCopies: (data: {
  // The roles given to API keys, of the roles being looked at.
  rolesGivenToApiKeys: ReadonlyArray<RoleGivenToApiKey>;
  // The permissions of the roles being looked at.
  rolePermissions: ReadonlyArray<RolePermissionRow>;
  // Every API key permission row that is a copy of one of those roles' permissions.
  copies: ReadonlyArray<ApiKeyPermissionCopyRow>;
}) => ApiKeyRoleCopyPlan = (data: {
  rolesGivenToApiKeys: ReadonlyArray<RoleGivenToApiKey>;
  rolePermissions: ReadonlyArray<RolePermissionRow>;
  copies: ReadonlyArray<ApiKeyPermissionCopyRow>;
}): ApiKeyRoleCopyPlan => {
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

  // Every copy that should exist, by the role given to the key and the role's row.
  const wanted: Map<string, ApiKeyPermissionCopyToCreate> = new Map<
    string,
    ApiKeyPermissionCopyToCreate
  >();

  for (const given of data.rolesGivenToApiKeys) {
    for (const row of permissionsByRole.get(idKey(given.customRoleId)) || []) {
      const labelIds: Array<string> | null = getApiKeyCopyLabels(row);

      if (labelIds === null) {
        continue;
      }

      wanted.set(copyKey(given.id, row.id), {
        apiKeyId: given.apiKeyId,
        customRoleId: given.customRoleId,
        apiKeyCustomRoleId: given.id,
        customRolePermissionId: row.id,
        permission: row.permission,
        labelIds: labelIds,
      });
    }
  }

  const toDelete: Array<string> = [];
  const kept: Set<string> = new Set<string>();
  const changedApiKeyIds: Map<string, string> = new Map<string, string>();

  for (const copy of data.copies) {
    const key: string = copyKey(
      copy.apiKeyCustomRoleId || "",
      copy.customRolePermissionId || "",
    );
    const wantedCopy: ApiKeyPermissionCopyToCreate | undefined =
      wanted.get(key);

    if (
      copy.apiKeyCustomRoleId &&
      copy.customRolePermissionId &&
      wantedCopy &&
      !kept.has(key) &&
      isSameApiKeyCopy(copy, wantedCopy)
    ) {
      kept.add(key);
      continue;
    }

    toDelete.push(copy.id);
    changedApiKeyIds.set(idKey(copy.apiKeyId), copy.apiKeyId);
  }

  const toCreate: Array<ApiKeyPermissionCopyToCreate> = [];

  for (const [key, wantedCopy] of wanted) {
    if (kept.has(key)) {
      continue;
    }

    toCreate.push(wantedCopy);
    changedApiKeyIds.set(idKey(wantedCopy.apiKeyId), wantedCopy.apiKeyId);
  }

  return {
    toDelete: toDelete,
    toCreate: toCreate,
    changedApiKeyIds: Array.from(changedApiKeyIds.values()),
  };
};
