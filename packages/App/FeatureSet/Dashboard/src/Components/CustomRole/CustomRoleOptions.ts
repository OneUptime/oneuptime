import { getCustomRoleCardDescription } from "./CustomRoleCopy";
import CustomRole from "Common/Models/DatabaseModels/CustomRole";
import CustomRolePermission from "Common/Models/DatabaseModels/CustomRolePermission";
import Label from "Common/Models/DatabaseModels/Label";
import TeamCustomRole from "Common/Models/DatabaseModels/TeamCustomRole";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import { TeamPermissionGrant } from "Common/UI/Utils/GrantablePermission";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * A PROJECT'S CUSTOM ROLES AS THE PICKERS OFFER THEM: a team's Add Custom
 * Role and Create Team's Access. One card per role - its name, its own
 * description or none, and how many permissions it holds ("Incident
 * Responder - Custom role: 6 permissions.") - in name order. And who has
 * which role already, so a picker offers only what is not given yet.
 * React-free.
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
  },
) => CardSelectOption = (
  translator: Translator,
  role: CustomRoleSummary,
  options?: {
    value?: string | undefined;
    saysItIsCustom?: boolean | undefined;
  },
): CardSelectOption => {
  return {
    value: options?.value || role.id,
    title: role.name,
    description: getCustomRoleCardDescription(translator, {
      description: role.description,
      permissionCount: role.permissionCount,
      saysItIsCustom: options?.saysItIsCustom,
    }),
    icon: CUSTOM_ROLE_ICON,
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
 * Team offers only the roles the user could give.
 */
export const loadCustomRoleGrants: (data: {
  projectId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
}) => Promise<Map<string, Array<TeamPermissionGrant>>> = async (data: {
  projectId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
}): Promise<Map<string, Array<TeamPermissionGrant>>> => {
  const modelAPI: typeof ModelAPI = data.modelAPI || ModelAPI;

  const rows: ListResult<CustomRolePermission> = await modelAPI.getList({
    modelType: CustomRolePermission,
    query: {
      projectId: data.projectId,
    },
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
