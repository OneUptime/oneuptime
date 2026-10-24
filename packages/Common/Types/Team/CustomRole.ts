import PermissionScope from "../Database/AccessControl/PermissionScope";
import Permission, { PermissionHelper, PermissionProps } from "../Permission";

/*
 * WHAT A CUSTOM ROLE MAY HOLD, AND WHAT ITS NAME MAY BE.
 *
 * A custom role ("Incident Responder", "Team Lead") is a set of permissions
 * named once and given to teams and API keys. The server holds every role
 * to these rules (CustomRoleService, CustomRolePermissionService) and the
 * Dashboard offers only what they allow, so the two never disagree.
 * React-free and server-free: both read it.
 *
 *   - A role holds what a team may be given (PermissionHelper's tenant
 *     permissions), allow only: a team's blocks stay on the team.
 *   - Never Project Owner. Owning the project is what the Owners team is
 *     for; a role that bundled it with anything would be Project Owner and
 *     nothing more.
 *   - Each permission has a scope, as on a team: All, Owned or Labels. The
 *     roles that reach the whole project by definition (Project Admin, the
 *     Settings and Billing roles) are All only, labels go only with the
 *     scope Labels, and the scope Labels needs at least one.
 *   - A name is given, is not the name of a built-in role ("Project Admin"
 *     would read as the built-in one wherever a team's access is shown),
 *     and is unique in the project, whatever its case and spacing.
 */

// Never part of a custom role.
export const PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
];

// The longest name a role may have: what the database column holds.
export const CUSTOM_ROLE_NAME_MAX_LENGTH: number = 100;

export const CUSTOM_ROLE_NAME_REQUIRED_MESSAGE: string =
  "Give the role a name.";

export const PROJECT_OWNER_NOT_IN_A_CUSTOM_ROLE_MESSAGE: string =
  "Project Owner can't be part of a custom role. Add people to the Owners team to make them project owners.";

export const LABELS_NEED_THE_LABELS_SCOPE_MESSAGE: string =
  "Labels limit a permission only with the scope Labels. Pick the scope Labels, or leave the labels out.";

export const LABELS_SCOPE_NEEDS_A_LABEL_MESSAGE: string =
  "Pick at least one label for the scope Labels, or pick All.";

export const UNKNOWN_SCOPE_MESSAGE: string =
  "The scope of a permission is All, Owned or Labels.";

/*
 * The permissions a role may hold, as the pickers list them: every
 * permission a team may be given, but Project Owner.
 */
export const getPermissionPropsAllowedInCustomRole: () => Array<PermissionProps> =
  (): Array<PermissionProps> => {
    return PermissionHelper.getTenantPermissionProps().filter(
      (props: PermissionProps): boolean => {
        return !PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE.includes(props.permission);
      },
    );
  };

// Whether `permission` may be part of a custom role.
export const isPermissionAllowedInCustomRole: (
  permission: Permission | string | undefined | null,
) => boolean = (
  permission: Permission | string | undefined | null,
): boolean => {
  if (!permission) {
    return false;
  }

  return getPermissionPropsAllowedInCustomRole().some(
    (props: PermissionProps): boolean => {
      return props.permission === permission;
    },
  );
};

/*
 * A permission's title for a sentence: "Incident Member" for
 * IncidentMember, or the value as it was sent when it names no permission.
 */
export const getPermissionTitleForSentence: (
  permission: Permission | string,
) => string = (permission: Permission | string): string => {
  const props: PermissionProps | undefined =
    PermissionHelper.getAllPermissionProps().find(
      (item: PermissionProps): boolean => {
        return item.permission === permission;
      },
    );

  return props?.title || String(permission);
};

export interface CustomRolePermissionShape {
  permission: Permission | string | undefined | null;
  scope?: PermissionScope | string | undefined | null;
  labelIds?: ReadonlyArray<unknown> | undefined;
}

/*
 * Why a permission may not be part of a role as it is written, in the
 * words the server refuses it with - or null when it may.
 */
export const getCustomRolePermissionProblem: (
  data: CustomRolePermissionShape,
) => string | null = (data: CustomRolePermissionShape): string | null => {
  if (!data.permission) {
    return "Pick a permission.";
  }

  if (
    PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE.includes(data.permission as Permission)
  ) {
    return PROJECT_OWNER_NOT_IN_A_CUSTOM_ROLE_MESSAGE;
  }

  if (!isPermissionAllowedInCustomRole(data.permission)) {
    return `${getPermissionTitleForSentence(data.permission)} can't be given to a team, so it can't be part of a custom role.`;
  }

  const scope: PermissionScope = (data.scope ||
    PermissionScope.All) as PermissionScope;

  if (!Object.values(PermissionScope).includes(scope)) {
    return UNKNOWN_SCOPE_MESSAGE;
  }

  if (
    scope !== PermissionScope.All &&
    !PermissionHelper.isScopeApplicable(data.permission as Permission)
  ) {
    return `${getPermissionTitleForSentence(data.permission)} reaches the whole project and can't be limited. Pick the scope All.`;
  }

  const labelCount: number = (data.labelIds || []).length;

  if (scope !== PermissionScope.Labels && labelCount > 0) {
    return LABELS_NEED_THE_LABELS_SCOPE_MESSAGE;
  }

  if (scope === PermissionScope.Labels && labelCount === 0) {
    return LABELS_SCOPE_NEEDS_A_LABEL_MESSAGE;
  }

  return null;
};

// Any run of white space inside a name.
const WHITE_SPACE_RUN: RegExp = /\s+/u;

// A role's name as it is kept: trimmed, inner runs of space made one.
export const normalizeCustomRoleName: (
  name: string | undefined | null,
) => string = (name: string | undefined | null): string => {
  return (name || "").trim().split(WHITE_SPACE_RUN).join(" ");
};

// The form two names are compared in: normalized, and in lower case.
export const getCustomRoleNameKey: (
  name: string | undefined | null,
) => string = (name: string | undefined | null): string => {
  return normalizeCustomRoleName(name).toLowerCase();
};

/*
 * The built-in role a name would read as, when it is one's ("project
 * admin" for Project Admin): null for a name of its own.
 */
export const getBuiltInRoleNamed: (
  name: string | undefined | null,
) => PermissionProps | null = (
  name: string | undefined | null,
): PermissionProps | null => {
  const key: string = getCustomRoleNameKey(name);

  if (!key) {
    return null;
  }

  return (
    PermissionHelper.getRolePermissionProps().find(
      (props: PermissionProps): boolean => {
        return getCustomRoleNameKey(props.title) === key;
      },
    ) || null
  );
};

/*
 * Why a name may not be a role's, other roles of the project aside - or
 * null when it may.
 */
export const getCustomRoleNameProblem: (
  name: string | undefined | null,
) => string | null = (name: string | undefined | null): string | null => {
  const normalized: string = normalizeCustomRoleName(name);

  if (!normalized) {
    return CUSTOM_ROLE_NAME_REQUIRED_MESSAGE;
  }

  if (normalized.length > CUSTOM_ROLE_NAME_MAX_LENGTH) {
    return `A role's name can be at most ${CUSTOM_ROLE_NAME_MAX_LENGTH} characters long.`;
  }

  const builtIn: PermissionProps | null = getBuiltInRoleNamed(normalized);

  if (builtIn) {
    return `${builtIn.title} is a built-in role. Pick another name for your role.`;
  }

  return null;
};

export const getCustomRoleNameTakenMessage: (name: string) => string = (
  name: string,
): string => {
  return `There is already a role called ${normalizeCustomRoleName(name)} in this project. Pick another name.`;
};

export const getCustomRoleDuplicatePermissionMessage: (data: {
  roleName: string;
  permission: Permission | string;
}) => string = (data: {
  roleName: string;
  permission: Permission | string;
}): string => {
  return `${data.roleName} already has ${getPermissionTitleForSentence(data.permission)}.`;
};

/*
 * Why a role may not be given by someone: one of its permissions is not
 * theirs to give (TeamPermissionService.assertCanGrantPermission).
 */
export const getCustomRoleGrantRefusedMessage: (data: {
  roleName: string;
  permission: Permission | string;
}) => string = (data: {
  roleName: string;
  permission: Permission | string;
}): string => {
  return `You can't give ${data.roleName}: it has ${getPermissionTitleForSentence(data.permission)}, and your own access doesn't include that permission at the same or a broader scope.`;
};

/*
 * Why a team's copy of a role's permission is not changed or removed on
 * its own: it is the role's.
 */
export const getRoleCopyChangeRefusedMessage: (data: {
  roleName?: string | undefined;
  permission: Permission | string;
}) => string = (data: {
  roleName?: string | undefined;
  permission: Permission | string;
}): string => {
  const title: string = getPermissionTitleForSentence(data.permission);

  if (!data.roleName) {
    return `${title} comes with a custom role. Change the role, or take the role away from the team.`;
  }

  return `${title} comes with the custom role ${data.roleName}. Change the role, or take the role away from the team.`;
};

/*
 * Why an API key's copy of a role's permission is not changed or removed
 * on its own: it is the role's.
 */
export const getApiKeyRoleCopyChangeRefusedMessage: (data: {
  roleName?: string | undefined;
  permission: Permission | string;
}) => string = (data: {
  roleName?: string | undefined;
  permission: Permission | string;
}): string => {
  const title: string = getPermissionTitleForSentence(data.permission);

  if (!data.roleName) {
    return `${title} comes with a custom role. Change the role, or take the role away from the API key.`;
  }

  return `${title} comes with the custom role ${data.roleName}. Change the role, or take the role away from the API key.`;
};

export const API_KEY_ALREADY_HAS_ROLE_MESSAGE: string =
  "This API key already has this role.";

/*
 * Why someone may not give a role to an API key: they may change what a
 * key can do, but not read the project's custom roles.
 */
export const CUSTOM_ROLE_NOT_READABLE_MESSAGE: string =
  "You can't give a custom role you can't see. Ask someone who can read the project's custom roles, such as a Project Admin.";

export const TEAM_NOT_EDITABLE_FOR_ROLES_MESSAGE: string =
  "This team's permissions can't be changed, so it can't be given a custom role. Create a team of your own and give the role to it.";

export const TEAM_ALREADY_HAS_ROLE_MESSAGE: string =
  "This team already has this role.";
