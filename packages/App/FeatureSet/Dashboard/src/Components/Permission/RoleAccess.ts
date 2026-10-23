import ApiKeyCustomRole from "Common/Models/DatabaseModels/ApiKeyCustomRole";
import ApiKeyPermission from "Common/Models/DatabaseModels/ApiKeyPermission";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TeamCustomRole from "Common/Models/DatabaseModels/TeamCustomRole";
import TeamPermission from "Common/Models/DatabaseModels/TeamPermission";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import GrantablePermission from "Common/UI/Utils/GrantablePermission";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { getRoleIcon, ROLE_CARD_SUMMARIES } from "./RoleCardSelectOptions";

/*
 * A NEW API KEY OR TEAM STARTS WITH THE ACCESS IT NEEDS.
 *
 * Both used to be created with no permissions at all. A key could do
 * nothing, and the people invited to a team could sign in and do nothing,
 * until someone found the key's or the team's page and picked from a grid of
 * some forty roles. Create API Key and Create Team now ask what the new key
 * or team may do, as one of four cards:
 *
 *   - Project Admin, Project Member or Viewer - the project-wide roles most
 *     keys and teams need (Terraform and other tools that manage your setup
 *     want Project Admin, a read-only agent or a team of auditors Viewer);
 *   - Choose permissions later - what a key or team always started with:
 *     nothing, until a role or permissions are added on its page, which is
 *     also where a narrower role (Incident Member, say) is picked.
 *
 * Choose permissions later is picked to start with. What a create request
 * that names no access gets from the server is no access: the form starts
 * from the same place, and handing out power - to a credential, or to every
 * member of a team - stays one deliberate click.
 *
 * The role is not sent with the key or the team. Once it exists the
 * dashboard adds the role as its first permission, through the same endpoint
 * its own Permissions card uses (POST /api-key-permission, POST
 * /team-permission), so the same checks decide: the create requests, the API
 * and Terraform are unchanged, and a role can never be given here that could
 * not be given there. A user only sees the roles the server would let them
 * hand on (GrantablePermission), and is not asked at all without the right
 * to add permissions to a key or a team.
 *
 * One list for both, so a role reads and looks the same wherever it is
 * picked (the cards' icons come from RoleCardSelectOptions). React-free, so
 * tests can read it without rendering a page.
 *
 * A team or a key can also start with one of the project's custom roles
 * ("Incident Responder"): Create Team and Create API Key list them after
 * the built-in roles, as the cards a team's or a key's Add Custom Role
 * shows, and only the ones the user could give - every permission in the
 * role being one they may hand on (GrantablePermission
 * .canCurrentUserGrantTeam, .canCurrentUserGrantApiKeyRole), and for a key
 * only a role with a permission that applies to a key (not every one
 * limited to what someone owns). The role is given once the team or key
 * exists, through POST /team-custom-role or /api-key-custom-role, the
 * endpoint its Custom Roles card uses.
 */

// Who the access is for: what the cards are offered on, and what they create.
export enum RoleAccessHolder {
  ApiKey = "ApiKey",
  Team = "Team",
}

// The form value that carries the pick. Not a column of the key or the team.
export const ROLE_ACCESS_FIELD_KEY: string = "access";

export const ROLE_ACCESS_LATER: string = "ChoosePermissionsLater";

/*
 * Past this many cards - a project with many custom roles - the Access
 * question gets a search box; a handful stays a plain list.
 */
export const ROLE_ACCESS_SEARCH_THRESHOLD: number = 8;

// What that search box says before anything is typed in it.
export const ROLE_ACCESS_SEARCH_PLACEHOLDER: string =
  translationKey("Search roles");

/*
 * The line under that search box while nothing is typed: how many cards
 * there are, and what a search reads - a role's name and what it allows.
 * The search box's own default is worded for monitor types.
 */
export const ROLE_ACCESS_SEARCH_HINT: PluralTemplate = {
  one: "{{count}} to choose from. Search by name or by what a role allows.",
  other: "{{count}} to choose from. Search by name or by what a role allows.",
};

// What a custom role's card stands for under Access: the prefix and the role's id.
export const CUSTOM_ROLE_ACCESS_PREFIX: string = "customRole:";

export const getCustomRoleAccessValue: (customRoleId: string) => string = (
  customRoleId: string,
): string => {
  return `${CUSTOM_ROLE_ACCESS_PREFIX}${customRoleId}`;
};

// The roles a new key or team can start with, widest first.
export const ROLE_ACCESS_ROLES: Array<Permission> = [
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
];

/*
 * What each role means, short enough to compare at a glance, in words that
 * fit a key and a team alike: each role's one line on every role card
 * (ROLE_CARD_SUMMARIES), so a role reads the same in Access and in Add Role.
 */
const ROLE_OPTIONS: Array<CardSelectOption> = [
  {
    value: Permission.ProjectAdmin,
    title: "Project Admin",
    description: ROLE_CARD_SUMMARIES[Permission.ProjectAdmin] as string,
    icon: getRoleIcon(Permission.ProjectAdmin),
  },
  {
    value: Permission.ProjectMember,
    title: "Project Member",
    description: ROLE_CARD_SUMMARIES[Permission.ProjectMember] as string,
    icon: getRoleIcon(Permission.ProjectMember),
  },
  {
    value: Permission.Viewer,
    title: "Viewer",
    description: ROLE_CARD_SUMMARIES[Permission.Viewer] as string,
    icon: getRoleIcon(Permission.Viewer),
  },
];

/*
 * Choose permissions later, for each: it says where the narrower roles are
 * added, which is the key's page or the team's.
 */
export const API_KEY_ACCESS_LATER_OPTION: CardSelectOption = {
  value: ROLE_ACCESS_LATER,
  title: "Choose permissions later",
  description:
    "No access yet. Add a narrower role, such as Incident Member, or single permissions on the key's page.",
  icon: IconProp.Clock,
};

export const TEAM_ACCESS_LATER_OPTION: CardSelectOption = {
  value: ROLE_ACCESS_LATER,
  title: "Choose permissions later",
  description:
    "No access yet. Add a narrower role, such as Incident Member, or single permissions on the team's page.",
  icon: IconProp.Clock,
};

// The line under Access, for each.
export const API_KEY_ACCESS_DESCRIPTION: string = translationKey(
  "What this key can do. You can change it on the key's page at any time.",
);

export const TEAM_ACCESS_DESCRIPTION: string = translationKey(
  "What the team's members can do. You can change it on the team's page at any time.",
);

interface RoleAccessHolderSpec {
  // The rows a role becomes: the permission checked, and the row created.
  permissionModel: () => ApiKeyPermission | TeamPermission;
  laterOption: CardSelectOption;
  description: string;
  dataTestId: string;
}

const HOLDERS: Record<RoleAccessHolder, RoleAccessHolderSpec> = {
  [RoleAccessHolder.ApiKey]: {
    permissionModel: (): ApiKeyPermission => {
      return new ApiKeyPermission();
    },
    laterOption: API_KEY_ACCESS_LATER_OPTION,
    description: API_KEY_ACCESS_DESCRIPTION,
    dataTestId: "api-key-access",
  },
  [RoleAccessHolder.Team]: {
    permissionModel: (): TeamPermission => {
      return new TeamPermission();
    },
    laterOption: TEAM_ACCESS_LATER_OPTION,
    description: TEAM_ACCESS_DESCRIPTION,
    dataTestId: "team-access",
  },
};

export const getRoleAccessLaterOption: (
  holder: RoleAccessHolder,
) => CardSelectOption = (holder: RoleAccessHolder): CardSelectOption => {
  return HOLDERS[holder].laterOption;
};

type GetRoleAccessOptionsFunction = (data: {
  holder: RoleAccessHolder;
  // Whether the user may hand this role on (the server's grant ceiling).
  canGrant: (permission: Permission) => boolean;
  // Whether the user may add permissions to a key or a team at all.
  canAddPermissions: boolean;
  /*
   * The project's custom roles the user could give the team or the key, as
   * cards whose values are getCustomRoleAccessValue(id).
   */
  customRoleOptions?: Array<CardSelectOption> | undefined;
  /*
   * The custom roles are still being read. A form gives a field its
   * default only when it opens (BasicForm), so the question is asked from
   * the start - Choose permissions later picked - even before a role is
   * known to be offered, and it is there, answered, when the roles arrive.
   */
  areCustomRolesLoading?: boolean | undefined;
}) => Array<CardSelectOption>;

/*
 * The cards a create form offers this user: the roles they may hand on,
 * then Choose permissions later. Empty when there is nothing to choose - no
 * right to add permissions, or no role they may give - and the form then
 * does not ask.
 */
export const getRoleAccessOptions: GetRoleAccessOptionsFunction = (data: {
  holder: RoleAccessHolder;
  canGrant: (permission: Permission) => boolean;
  canAddPermissions: boolean;
  customRoleOptions?: Array<CardSelectOption> | undefined;
  areCustomRolesLoading?: boolean | undefined;
}): Array<CardSelectOption> => {
  if (!data.canAddPermissions) {
    return [];
  }

  const roles: Array<CardSelectOption> = ROLE_OPTIONS.filter(
    (option: CardSelectOption): boolean => {
      return data.canGrant(option.value as Permission);
    },
  );

  const customRoles: Array<CardSelectOption> = (
    data.customRoleOptions || []
  ).filter((option: CardSelectOption): boolean => {
    return String(option.value).startsWith(CUSTOM_ROLE_ACCESS_PREFIX);
  });

  const mayStillOfferCustomRoles: boolean = Boolean(data.areCustomRolesLoading);

  if (
    roles.length === 0 &&
    customRoles.length === 0 &&
    !mayStillOfferCustomRoles
  ) {
    return [];
  }

  return [...roles, ...customRoles, getRoleAccessLaterOption(data.holder)];
};

/*
 * The same, for the signed-in user: what they may hand on, and whether they
 * may add a permission to a key (or a team) at all - which someone who may
 * create keys (or teams) need not be allowed, and which a block can take
 * away whatever else they hold, as on the server (isBlockedFromAny).
 */
export const getRoleAccessOptionsForCurrentUser: (
  holder: RoleAccessHolder,
  /*
   * The project's custom roles the user could give the team or the key - or
   * null while they are being read.
   */
  customRoleOptions?: Array<CardSelectOption> | null | undefined,
) => Array<CardSelectOption> = (
  holder: RoleAccessHolder,
  customRoleOptions?: Array<CardSelectOption> | null | undefined,
): Array<CardSelectOption> => {
  const permissionModel: ApiKeyPermission | TeamPermission =
    HOLDERS[holder].permissionModel();

  return getRoleAccessOptions({
    holder: holder,
    canGrant: (permission: Permission): boolean => {
      return GrantablePermission.canCurrentUserGrant(permission);
    },
    canAddPermissions:
      PermissionGate.check(permissionModel, ModelAction.Create).isAllowed &&
      !GrantablePermission.isCurrentUserBlockedFromAny(
        permissionModel.getCreatePermissions(),
      ),
    customRoleOptions: customRoleOptions || [],
    areCustomRolesLoading: customRoleOptions === null,
  });
};

/*
 * The role a submitted Access value asks for, or null for Choose permissions
 * later - and for anything that is not one of the roles offered.
 */
export const getRoleAccessRole: (value: unknown) => Permission | null = (
  value: unknown,
): Permission | null => {
  return (
    ROLE_ACCESS_ROLES.find((role: Permission): boolean => {
      return role === value;
    }) || null
  );
};

/*
 * The custom role a submitted Access value asks for - its id - or null for
 * anything else.
 */
export const getRoleAccessCustomRoleId: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  if (
    typeof value !== "string" ||
    !value.startsWith(CUSTOM_ROLE_ACCESS_PREFIX)
  ) {
    return null;
  }

  const customRoleId: string = value.slice(CUSTOM_ROLE_ACCESS_PREFIX.length);

  return ObjectID.isValidUUID(customRoleId) ? customRoleId : null;
};

/*
 * The Access question of a create form: one card per choice, Choose
 * permissions later picked. Not a column of the key or the team - the page
 * adds the role once the record exists (giveRoleAccess) - so nothing of it
 * is sent with the record.
 */
export const getRoleAccessFormField: <TBaseModel extends BaseModel>(data: {
  holder: RoleAccessHolder;
  accessOptions: Array<CardSelectOption>;
}) => ModelField<TBaseModel> = <TBaseModel extends BaseModel>(data: {
  holder: RoleAccessHolder;
  accessOptions: Array<CardSelectOption>;
}): ModelField<TBaseModel> => {
  return {
    overrideField: {
      [ROLE_ACCESS_FIELD_KEY]: true,
    },
    overrideFieldKey: ROLE_ACCESS_FIELD_KEY,
    formOnly: true,
    // Shown although no column's permission covers it: the page decides.
    showEvenIfPermissionDoesNotExist: true,
    title: "Access",
    description: HOLDERS[data.holder].description,
    fieldType: FormFieldSchemaType.CardSelect,
    cardSelectOptions: data.accessOptions,
    cardSelectSingleColumn: true,
    // A long list - a project with many custom roles - gets a search box.
    ...(data.accessOptions.length > ROLE_ACCESS_SEARCH_THRESHOLD
      ? {
          cardSelectSearchable: true,
          cardSelectSearchPlaceholder: ROLE_ACCESS_SEARCH_PLACEHOLDER,
          cardSelectSearchHint: ROLE_ACCESS_SEARCH_HINT,
        }
      : {}),
    required: true,
    defaultValue: ROLE_ACCESS_LATER,
    dataTestId: HOLDERS[data.holder].dataTestId,
  } as ModelField<TBaseModel>;
};

/*
 * The row a role becomes on a new key: an allow row for the whole project,
 * exactly what Add Role on the key's page creates.
 */
export const buildApiKeyAccessPermission: (data: {
  apiKeyId: ObjectID;
  projectId: ObjectID;
  role: Permission;
}) => ApiKeyPermission = (data: {
  apiKeyId: ObjectID;
  projectId: ObjectID;
  role: Permission;
}): ApiKeyPermission => {
  const permission: ApiKeyPermission = new ApiKeyPermission();
  permission.apiKeyId = data.apiKeyId;
  permission.projectId = data.projectId;
  permission.permission = data.role;
  permission.isBlockPermission = false;

  return permission;
};

/*
 * The row a role becomes on a new team: an allow row scoped to every
 * resource in the project, exactly what Add Role on the team's Permissions
 * page creates with its Scope left on All.
 */
export const buildTeamAccessPermission: (data: {
  teamId: ObjectID;
  projectId: ObjectID;
  role: Permission;
}) => TeamPermission = (data: {
  teamId: ObjectID;
  projectId: ObjectID;
  role: Permission;
}): TeamPermission => {
  const permission: TeamPermission = new TeamPermission();
  permission.teamId = data.teamId;
  permission.projectId = data.projectId;
  permission.permission = data.role;
  permission.isBlockPermission = false;
  permission.scope = PermissionScope.All;

  return permission;
};

type GiveRoleAccessFunction = (data: {
  holder: RoleAccessHolder;
  // The new key's or team's id.
  holderId: ObjectID;
  projectId: ObjectID;
  role: Permission;
  modelAPI?: typeof ModelAPI | undefined;
}) => Promise<void>;

/*
 * The row a custom role becomes on a new team: the role given to the team,
 * exactly what Add Custom Role on the team's Permissions page creates.
 */
export const buildTeamCustomRoleAccess: (data: {
  teamId: ObjectID;
  projectId: ObjectID;
  customRoleId: ObjectID;
}) => TeamCustomRole = (data: {
  teamId: ObjectID;
  projectId: ObjectID;
  customRoleId: ObjectID;
}): TeamCustomRole => {
  const given: TeamCustomRole = new TeamCustomRole();
  given.teamId = data.teamId;
  given.projectId = data.projectId;
  given.customRoleId = data.customRoleId;

  return given;
};

/*
 * Gives a new team the custom role picked under Access, through the endpoint
 * its Custom Roles card uses. A refusal is thrown for the page to show: the
 * team exists either way.
 */
export const giveCustomRoleAccess: (data: {
  teamId: ObjectID;
  projectId: ObjectID;
  customRoleId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
}) => Promise<void> = async (data: {
  teamId: ObjectID;
  projectId: ObjectID;
  customRoleId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
}): Promise<void> => {
  const modelAPI: typeof ModelAPI = data.modelAPI || ModelAPI;

  await modelAPI.create<TeamCustomRole>({
    model: buildTeamCustomRoleAccess({
      teamId: data.teamId,
      projectId: data.projectId,
      customRoleId: data.customRoleId,
    }),
    modelType: TeamCustomRole,
  });
};

/*
 * The row a custom role becomes on a new API key: the role given to the
 * key, exactly what Add Custom Role on the key's page creates.
 */
export const buildApiKeyCustomRoleAccess: (data: {
  apiKeyId: ObjectID;
  projectId: ObjectID;
  customRoleId: ObjectID;
}) => ApiKeyCustomRole = (data: {
  apiKeyId: ObjectID;
  projectId: ObjectID;
  customRoleId: ObjectID;
}): ApiKeyCustomRole => {
  const given: ApiKeyCustomRole = new ApiKeyCustomRole();
  given.apiKeyId = data.apiKeyId;
  given.projectId = data.projectId;
  given.customRoleId = data.customRoleId;

  return given;
};

/*
 * Gives a new API key the custom role picked under Access, through the
 * endpoint its Custom Roles card uses. A refusal is thrown for the page to
 * show: the key exists either way.
 */
export const giveApiKeyCustomRoleAccess: (data: {
  apiKeyId: ObjectID;
  projectId: ObjectID;
  customRoleId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
}) => Promise<void> = async (data: {
  apiKeyId: ObjectID;
  projectId: ObjectID;
  customRoleId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
}): Promise<void> => {
  const modelAPI: typeof ModelAPI = data.modelAPI || ModelAPI;

  await modelAPI.create<ApiKeyCustomRole>({
    model: buildApiKeyCustomRoleAccess({
      apiKeyId: data.apiKeyId,
      projectId: data.projectId,
      customRoleId: data.customRoleId,
    }),
    modelType: ApiKeyCustomRole,
  });
};

/*
 * Adds the role as the new key's or team's first permission, through the
 * endpoint its Permissions card uses. A refusal is thrown for the page to
 * show: the key or the team exists either way.
 */
export const giveRoleAccess: GiveRoleAccessFunction = async (data: {
  holder: RoleAccessHolder;
  holderId: ObjectID;
  projectId: ObjectID;
  role: Permission;
  modelAPI?: typeof ModelAPI | undefined;
}): Promise<void> => {
  const modelAPI: typeof ModelAPI = data.modelAPI || ModelAPI;

  if (data.holder === RoleAccessHolder.ApiKey) {
    await modelAPI.create<ApiKeyPermission>({
      model: buildApiKeyAccessPermission({
        apiKeyId: data.holderId,
        projectId: data.projectId,
        role: data.role,
      }),
      modelType: ApiKeyPermission,
    });

    return;
  }

  await modelAPI.create<TeamPermission>({
    model: buildTeamAccessPermission({
      teamId: data.holderId,
      projectId: data.projectId,
      role: data.role,
    }),
    modelType: TeamPermission,
  });
};
