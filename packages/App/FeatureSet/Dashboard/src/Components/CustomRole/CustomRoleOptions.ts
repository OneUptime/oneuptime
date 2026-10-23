import {
  ApiKeyRoleCoverage,
  getCustomRoleCardDescription,
} from "./CustomRoleCopy";
import ApiKeyCustomRole from "Common/Models/DatabaseModels/ApiKeyCustomRole";
import CustomRole from "Common/Models/DatabaseModels/CustomRole";
import CustomRolePermission from "Common/Models/DatabaseModels/CustomRolePermission";
import Label from "Common/Models/DatabaseModels/Label";
import Team from "Common/Models/DatabaseModels/Team";
import TeamCustomRole from "Common/Models/DatabaseModels/TeamCustomRole";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import { isRolePermissionGivenToApiKeys } from "Common/Types/Team/CustomRoleCopyPlan";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import { TeamPermissionGrant } from "Common/UI/Utils/GrantablePermission";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * A PROJECT'S CUSTOM ROLES AS THE PICKERS OFFER THEM: a team's and an API
 * key's Add Custom Role, and Create Team's and Create API Key's Access. One
 * card per role - its name, its own description or none, and how many
 * permissions it holds ("Incident Responder - Custom role: 6
 * permissions.") - in name order, drawn as written
 * (CardSelectOption.isUserContent). And who has which role already, so a
 * picker offers only what is not given yet. React-free.
 */

export const CUSTOM_ROLE_ICON: IconProp = IconProp.Identification;

export interface CustomRoleSummary {
  id: string;
  name: string;
  description: string;
  permissionCount: number;
}

// Every custom role of the project, by name.
export const loadCustomRoles: (data: {
  projectId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
}) => Promise<Array<CustomRoleSummary>> = async (data: {
  projectId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
}): Promise<Array<CustomRoleSummary>> => {
  const modelAPI: typeof ModelAPI = data.modelAPI || ModelAPI;

  const roles: ListResult<CustomRole> = await modelAPI.getList({
    modelType: CustomRole,
    query: {
      projectId: data.projectId,
    },
    select: {
      _id: true,
      name: true,
      description: true,
      permissionCount: true,
    },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    sort: {
      name: SortOrder.Ascending,
    },
  });

  return roles.data.map((role: CustomRole): CustomRoleSummary => {
    return {
      id: role.id?.toString() || "",
      name: role.name || "",
      description: role.description || "",
      permissionCount: role.permissionCount || 0,
    };
  });
};

export const getCustomRoleCardSelectOption: (
  translator: Translator,
  role: CustomRoleSummary,
  options?: {
    // The value the card stands for; the role's id when left out.
    value?: string | undefined;
    // Among built-in roles, the card says it is a custom one.
    saysItIsCustom?: boolean | undefined;
    /*
     * What to say of the role's permissions instead of their count: an API
     * key's picker says how many apply to a key.
     */
    permissionsText?: string | undefined;
  },
) => CardSelectOption = (
  translator: Translator,
  role: CustomRoleSummary,
  options?: {
    value?: string | undefined;
    saysItIsCustom?: boolean | undefined;
    permissionsText?: string | undefined;
  },
): CardSelectOption => {
  return {
    value: options?.value || role.id,
    title: role.name,
    description: getCustomRoleCardDescription(translator, {
      description: role.description,
      permissionCount: role.permissionCount,
      saysItIsCustom: options?.saysItIsCustom,
      permissionsText: options?.permissionsText,
    }),
    icon: CUSTOM_ROLE_ICON,
    /*
     * The role's name as it was typed, and a description already in the
     * reader's language: a role called "Incident Responder" is never shown
     * as the Dashboard's word for it.
     */
    isUserContent: true,
  };
};

// The custom roles a team has, by id.
export const loadCustomRoleIdsOfTeam: (data: {
  teamId: ObjectID;
  projectId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
}) => Promise<Set<string>> = async (data: {
  teamId: ObjectID;
  projectId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
}): Promise<Set<string>> => {
  const modelAPI: typeof ModelAPI = data.modelAPI || ModelAPI;

  const given: ListResult<TeamCustomRole> = await modelAPI.getList({
    modelType: TeamCustomRole,
    query: {
      teamId: data.teamId,
      projectId: data.projectId,
    },
    select: {
      customRoleId: true,
    },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    sort: {},
  });

  return new Set<string>(
    given.data
      .map((row: TeamCustomRole): string => {
        return row.customRoleId?.toString().toLowerCase() || "";
      })
      .filter((id: string): boolean => {
        return Boolean(id);
      }),
  );
};

/*
 * Whether a team can be given a custom role: not Owners or Admin, whose
 * permissions can't be changed - the server refuses them every role
 * (TEAM_NOT_EDITABLE_FOR_ROLES_MESSAGE). A team that can't be read is
 * offered its card: the server still decides.
 */
export const canTeamTakeCustomRoles: (data: {
  teamId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
}) => Promise<boolean> = async (data: {
  teamId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
}): Promise<boolean> => {
  const modelAPI: typeof ModelAPI = data.modelAPI || ModelAPI;

  try {
    const team: Team | null = await modelAPI.getItem<Team>({
      modelType: Team,
      id: data.teamId,
      select: {
        isPermissionsEditable: true,
      },
    });

    return team?.isPermissionsEditable !== false;
  } catch {
    return true;
  }
};

// The custom roles an API key has, by id.
export const loadCustomRoleIdsOfApiKey: (data: {
  apiKeyId: ObjectID;
  projectId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
}) => Promise<Set<string>> = async (data: {
  apiKeyId: ObjectID;
  projectId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
}): Promise<Set<string>> => {
  const modelAPI: typeof ModelAPI = data.modelAPI || ModelAPI;

  const given: ListResult<ApiKeyCustomRole> = await modelAPI.getList({
    modelType: ApiKeyCustomRole,
    query: {
      apiKeyId: data.apiKeyId,
      projectId: data.projectId,
    },
    select: {
      customRoleId: true,
    },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    sort: {},
  });

  return new Set<string>(
    given.data
      .map((row: ApiKeyCustomRole): string => {
        return row.customRoleId?.toString().toLowerCase() || "";
      })
      .filter((id: string): boolean => {
        return Boolean(id);
      }),
  );
};

// The API keys a custom role is given to, by id.
export const loadApiKeyIdsGivenCustomRole: (data: {
  customRoleId: ObjectID;
  projectId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
}) => Promise<Set<string>> = async (data: {
  customRoleId: ObjectID;
  projectId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
}): Promise<Set<string>> => {
  const modelAPI: typeof ModelAPI = data.modelAPI || ModelAPI;

  const given: ListResult<ApiKeyCustomRole> = await modelAPI.getList({
    modelType: ApiKeyCustomRole,
    query: {
      customRoleId: data.customRoleId,
      projectId: data.projectId,
    },
    select: {
      apiKeyId: true,
    },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    sort: {},
  });

  return new Set<string>(
    given.data
      .map((row: ApiKeyCustomRole): string => {
        return row.apiKeyId?.toString().toLowerCase() || "";
      })
      .filter((id: string): boolean => {
        return Boolean(id);
      }),
  );
};

/*
 * How many of each role's permissions give an API key nothing - those
 * limited to what someone owns - by role id, from loadCustomRoleGrants.
 */
export const getOwnedPermissionCounts: (
  grants: Map<string, Array<TeamPermissionGrant>>,
) => Map<string, number> = (
  grants: Map<string, Array<TeamPermissionGrant>>,
): Map<string, number> => {
  const counts: Map<string, number> = new Map<string, number>();

  for (const [roleId, roleGrants] of grants) {
    counts.set(
      roleId.toLowerCase(),
      roleGrants.filter((grant: TeamPermissionGrant): boolean => {
        return !isRolePermissionGivenToApiKeys(grant.scope);
      }).length,
    );
  }

  return counts;
};

/*
 * Of a role's permissions (loadCustomRoleGrants), the ones an API key given
 * the role holds: every one but those limited to what someone owns - a key
 * owns nothing (Types/Team/CustomRoleCopyPlan).
 */
export const getApiKeyRoleGrants: (
  grants: ReadonlyArray<TeamPermissionGrant>,
) => Array<TeamPermissionGrant> = (
  grants: ReadonlyArray<TeamPermissionGrant>,
): Array<TeamPermissionGrant> => {
  return grants.filter((grant: TeamPermissionGrant): boolean => {
    return isRolePermissionGivenToApiKeys(grant.scope);
  });
};

/*
 * How much of one role a key given it holds, from that role's permissions
 * (loadCustomRoleGrants): what a role's API Keys card and its Give to an
 * API Key dialog say the keys get.
 */
export const getApiKeyRoleCoverage: (
  grants: ReadonlyArray<TeamPermissionGrant>,
) => ApiKeyRoleCoverage = (
  grants: ReadonlyArray<TeamPermissionGrant>,
): ApiKeyRoleCoverage => {
  return {
    permissionCount: grants.length,
    ownedCount: grants.length - getApiKeyRoleGrants(grants).length,
  };
};

// The teams a custom role is given to, by id.
export const loadTeamIdsGivenCustomRole: (data: {
  customRoleId: ObjectID;
  projectId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
}) => Promise<Set<string>> = async (data: {
  customRoleId: ObjectID;
  projectId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
}): Promise<Set<string>> => {
  const modelAPI: typeof ModelAPI = data.modelAPI || ModelAPI;

  const given: ListResult<TeamCustomRole> = await modelAPI.getList({
    modelType: TeamCustomRole,
    query: {
      customRoleId: data.customRoleId,
      projectId: data.projectId,
    },
    select: {
      teamId: true,
    },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    sort: {},
  });

  return new Set<string>(
    given.data
      .map((row: TeamCustomRole): string => {
        return row.teamId?.toString().toLowerCase() || "";
      })
      .filter((id: string): boolean => {
        return Boolean(id);
      }),
  );
};

/*
 * Every role's permissions, by role, in the shape the grant ceiling weighs
 * a team's rows in (GrantablePermission.canCurrentUserGrantTeam): Create
 * Team offers only the roles the user could give. With a customRoleId,
 * that one role's only - a role's page asks what its keys get.
 */
export const loadCustomRoleGrants: (data: {
  projectId: ObjectID;
  customRoleId?: ObjectID | undefined;
  modelAPI?: typeof ModelAPI | undefined;
}) => Promise<Map<string, Array<TeamPermissionGrant>>> = async (data: {
  projectId: ObjectID;
  customRoleId?: ObjectID | undefined;
  modelAPI?: typeof ModelAPI | undefined;
}): Promise<Map<string, Array<TeamPermissionGrant>>> => {
  const modelAPI: typeof ModelAPI = data.modelAPI || ModelAPI;

  const query: Query<CustomRolePermission> = {
    projectId: data.projectId,
  };

  if (data.customRoleId) {
    query.customRoleId = data.customRoleId;
  }

  const rows: ListResult<CustomRolePermission> = await modelAPI.getList({
    modelType: CustomRolePermission,
    query: query,
    select: {
      customRoleId: true,
      permission: true,
      scope: true,
      labels: {
        _id: true,
      },
    },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    sort: {},
  });

  const grants: Map<string, Array<TeamPermissionGrant>> = new Map<
    string,
    Array<TeamPermissionGrant>
  >();

  for (const row of rows.data) {
    const roleId: string = row.customRoleId?.toString() || "";

    if (!roleId || !row.permission) {
      continue;
    }

    const roleGrants: Array<TeamPermissionGrant> = grants.get(roleId) || [];

    roleGrants.push({
      permission: row.permission as Permission,
      scope: (row.scope as PermissionScope | undefined) || PermissionScope.All,
      labelIds: (row.labels || [])
        .map((label: Label): string => {
          return label.id?.toString() || "";
        })
        .filter((labelId: string): boolean => {
          return Boolean(labelId);
        }),
    });

    grants.set(roleId, roleGrants);
  }

  return grants;
};
