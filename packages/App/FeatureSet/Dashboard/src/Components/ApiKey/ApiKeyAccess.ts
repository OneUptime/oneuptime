import ApiKeyPermission from "Common/Models/DatabaseModels/ApiKeyPermission";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import GrantablePermission from "Common/UI/Utils/GrantablePermission";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import { getRoleIcon } from "../Permission/RoleCardSelectOptions";

/*
 * A NEW API KEY CAN START WITH THE ACCESS IT NEEDS.
 *
 * A key used to be created with no permissions at all: it could do nothing
 * until someone found its page and searched a picker of several hundred
 * permissions. Create API Key now asks what the key may do, as one of four
 * cards:
 *
 *   - Project Admin, Project Member or Viewer - the project-wide roles a
 *     team can hold, the ones most integrations need (Terraform and other
 *     tools that manage your setup want Project Admin, a read-only agent
 *     wants Viewer);
 *   - Choose permissions later - what a key always started with: nothing,
 *     until a role or permissions are added on its page, which is also where
 *     a narrower role (Incident Member, say) is picked.
 *
 * Choose permissions later is picked to start with. A key is a credential,
 * and what a request that names no access gets from the server is no access:
 * the form starts from the same place, and giving a key power stays one
 * deliberate click.
 *
 * The role is not sent with the key. Once the key exists the dashboard adds
 * it as the key's first permission, through the same endpoint the key's own
 * Permissions card uses (POST /api-key-permission), so the same checks
 * decide: the key's create request, its API and Terraform are unchanged, and
 * a role can never be given here that could not be given there. A user only
 * sees the roles the server would let them hand on (GrantablePermission) and
 * is not asked at all without the right to give keys permissions.
 */

export const API_KEY_ACCESS_FIELD_KEY: string = "access";

export const API_KEY_ACCESS_LATER: string = "ChoosePermissionsLater";

// The roles a new key can start with, widest first.
export const API_KEY_ACCESS_ROLES: Array<Permission> = [
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
];

/*
 * What each choice means for a key, in the key's terms rather than a
 * person's, short enough to compare at a glance. Written out one by one so
 * the extractor finds every sentence (src/Locales/README.md).
 */
const ROLE_OPTIONS: Array<CardSelectOption> = [
  {
    value: Permission.ProjectAdmin,
    title: "Project Admin",
    description:
      "Create, change and delete anything, settings included. Billing and deleting the project are left out.",
    icon: getRoleIcon(Permission.ProjectAdmin),
  },
  {
    value: Permission.ProjectMember,
    title: "Project Member",
    description:
      "Create, change and delete monitors, incidents, status pages and other resources.",
    icon: getRoleIcon(Permission.ProjectMember),
  },
  {
    value: Permission.Viewer,
    title: "Viewer",
    description: "Read everything in the project. Change nothing.",
    icon: getRoleIcon(Permission.Viewer),
  },
];

export const API_KEY_ACCESS_LATER_OPTION: CardSelectOption = {
  value: API_KEY_ACCESS_LATER,
  title: "Choose permissions later",
  description:
    "No access yet. Add a narrower role, such as Incident Member, or single permissions on the key's page.",
  icon: IconProp.Clock,
};

type GetApiKeyAccessOptionsFunction = (data: {
  // Whether the user may hand this role on (the server's grant ceiling).
  canGrant: (permission: Permission) => boolean;
  // Whether the user may add permissions to a key at all.
  canAddKeyPermissions: boolean;
}) => Array<CardSelectOption>;

/*
 * The cards Create API Key offers this user: the roles they may hand on,
 * then Choose permissions later. Empty when there is nothing to choose - no
 * right to add permissions to a key, or no role they may give - and the
 * form then does not ask.
 */
export const getApiKeyAccessOptions: GetApiKeyAccessOptionsFunction = (data: {
  canGrant: (permission: Permission) => boolean;
  canAddKeyPermissions: boolean;
}): Array<CardSelectOption> => {
  if (!data.canAddKeyPermissions) {
    return [];
  }

  const roles: Array<CardSelectOption> = ROLE_OPTIONS.filter(
    (option: CardSelectOption): boolean => {
      return data.canGrant(option.value as Permission);
    },
  );

  if (roles.length === 0) {
    return [];
  }

  return [...roles, API_KEY_ACCESS_LATER_OPTION];
};

// The same, for the signed-in user.
export const getApiKeyAccessOptionsForCurrentUser: () => Array<CardSelectOption> =
  (): Array<CardSelectOption> => {
    return getApiKeyAccessOptions({
      canGrant: (permission: Permission): boolean => {
        return GrantablePermission.canCurrentUserGrant(permission);
      },
      canAddKeyPermissions: PermissionGate.check(
        new ApiKeyPermission(),
        ModelAction.Create,
      ).isAllowed,
    });
  };

/*
 * The role a submitted Access value asks for, or null for Choose permissions
 * later - and for anything that is not one of the roles offered.
 */
export const getApiKeyAccessRole: (value: unknown) => Permission | null = (
  value: unknown,
): Permission | null => {
  return (
    API_KEY_ACCESS_ROLES.find((role: Permission): boolean => {
      return role === value;
    }) || null
  );
};

type GiveApiKeyAccessFunction = (data: {
  apiKeyId: ObjectID;
  projectId: ObjectID;
  role: Permission;
  modelAPI?: typeof ModelAPI | undefined;
}) => Promise<void>;

/*
 * Adds the role as the key's first permission: an allow row for the whole
 * project, exactly what Add Role on the key's page creates.
 */
export const giveApiKeyAccess: GiveApiKeyAccessFunction = async (data: {
  apiKeyId: ObjectID;
  projectId: ObjectID;
  role: Permission;
  modelAPI?: typeof ModelAPI | undefined;
}): Promise<void> => {
  const permission: ApiKeyPermission = new ApiKeyPermission();
  permission.apiKeyId = data.apiKeyId;
  permission.projectId = data.projectId;
  permission.permission = data.role;
  permission.isBlockPermission = false;

  await (data.modelAPI || ModelAPI).create<ApiKeyPermission>({
    model: permission,
    modelType: ApiKeyPermission,
  });
};
