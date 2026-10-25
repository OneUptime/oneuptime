import { getRoleCardSelectOptions } from "@oneuptime/dashboard/Components/Permission/RoleCardSelectOptions";
import CustomRole from "Common/Models/DatabaseModels/CustomRole";
import CustomRolePermission from "Common/Models/DatabaseModels/CustomRolePermission";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import {
  CUSTOM_ROLE_NAME_MAX_LENGTH,
  getPermissionTitleForSentence,
  isPermissionAllowedInCustomRole,
  PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE,
} from "Common/Types/Team/CustomRole";
import {
  CardSelectOption,
  CardSelectOptionGroup,
} from "Common/UI/Components/CardSelect/CardSelect";
import {
  DropdownOption,
  DropdownOptionGroup,
} from "Common/UI/Components/Dropdown/Dropdown";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * CREATE CUSTOM ROLE: A NAME, THE ROLES IT STARTS WITH, AND THE REST FOLDED.
 *
 * A custom role is most often a few built-in roles under one name -
 * "Incident Responder" is Incident Member, Alert Member and On-Call Viewer -
 * so the form asks for exactly that:
 *
 *   - Name;
 *   - Permissions: the built-in roles it starts with, picked from the same
 *     groups the role list has - the whole project, then one per area, as
 *     Add Role's picker arranges them (Project Owner left out: no role
 *     holds it) - for every resource in the project. Optional - a role can
 *     start empty. A
 *     single permission, a scope of Owned or labels, are added on the role's
 *     page, where Add Permission and every scope are;
 *   - More fields, folded: the description.
 *
 * Three rows, so no steps. What is picked is not sent with the role: once the
 * role exists the page adds each one through the endpoint the role's own
 * Permissions card uses (POST /custom-role-permission,
 * addPermissionsToCustomRole), so the server's checks decide each of them -
 * nobody puts into a role what they could not give a team directly.
 * React-free, so tests read the fields without rendering the page.
 */

// The form value that carries the picked roles. Not a column of the role.
export const CUSTOM_ROLE_PERMISSIONS_FIELD_KEY: string = "startingPermissions";

export const CUSTOM_ROLE_PERMISSIONS_FIELD_DESCRIPTION: string = translationKey(
  "The built-in roles it bundles, for every resource in the project. Add single permissions on the role's page.",
);

/*
 * The same, when some built-in roles are left out because the user could
 * not put them into a role: says why the list is shorter than Add Role's.
 */
export const CUSTOM_ROLE_PERMISSIONS_FIELD_DESCRIPTION_SOME_LEFT_OUT: string =
  translationKey(
    "The built-in roles it bundles, for every resource in the project. Roles you don't hold yourself are not listed.",
  );

/*
 * Whether the user may put a built-in role into a role, for every resource
 * in the project: the server's grant ceiling (GrantablePermission).
 */
export type CanGrantRoleFunction = (permission: Permission) => boolean;

/*
 * The help under a role's Name and Description, on Create and on Edit. Each
 * field says its own: left without, a form shows the column's API
 * description instead, which is English only and written for the API.
 */
export const CUSTOM_ROLE_NAME_FIELD_DESCRIPTION: string = translationKey(
  "Shown on every team you give the role to.",
);

export const CUSTOM_ROLE_DESCRIPTION_FIELD_DESCRIPTION: string = translationKey(
  "What the role is for, in a sentence or two.",
);

/*
 * The built-in roles a new role can start with, in the role list's groups
 * and order (the whole project, then each area), without Project Owner. A
 * role's line says what it can do, so the option keeps it.
 *
 * With `canGrant`, only the roles the user could put into a role - each one
 * is for every resource in the project, where the dashboard's copy of the
 * grant ceiling says exactly what the server says - so a pick never comes
 * back refused. Groups left empty are left out.
 */
export const getCustomRoleStartingRoleOptions: (
  canGrant?: CanGrantRoleFunction,
) => Array<DropdownOptionGroup> = (
  canGrant?: CanGrantRoleFunction,
): Array<DropdownOptionGroup> => {
  return getRoleCardSelectOptions({
    excludeRoles: PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE,
  })
    .map((group: CardSelectOptionGroup): DropdownOptionGroup => {
      return {
        label: group.label,
        options: group.options
          .filter((option: CardSelectOption): boolean => {
            return !canGrant || canGrant(option.value as Permission);
          })
          .map((option: CardSelectOption): DropdownOption => {
            return {
              value: option.value,
              label: option.title,
              description: option.description,
            };
          }),
      };
    })
    .filter((group: DropdownOptionGroup): boolean => {
      return group.options.length > 0;
    });
};

// How many roles a group list offers.
const countRoleOptions: (groups: Array<DropdownOptionGroup>) => number = (
  groups: Array<DropdownOptionGroup>,
): number => {
  return groups.reduce((count: number, group: DropdownOptionGroup): number => {
    return count + group.options.length;
  }, 0);
};

export interface CustomRoleCreateFormOptions {
  /*
   * Whether the user may put a built-in role into a role. Left out, every
   * built-in role but Project Owner is offered.
   */
  canGrant?: CanGrantRoleFunction | undefined;
}

export const getCustomRoleCreateFormFields: (
  options?: CustomRoleCreateFormOptions,
) => Array<ModelField<CustomRole>> = (
  options?: CustomRoleCreateFormOptions,
): Array<ModelField<CustomRole>> => {
  const advanced: FormFieldCollapsibleSection<CustomRole> =
    getAdvancedFormSection<CustomRole>();

  const startingRoles: Array<DropdownOptionGroup> =
    getCustomRoleStartingRoleOptions(options?.canGrant);

  const offeredCount: number = countRoleOptions(startingRoles);
  const isAnyLeftOut: boolean =
    offeredCount < countRoleOptions(getCustomRoleStartingRoleOptions());

  return [
    {
      field: {
        name: true,
      },
      title: "Name",
      description: CUSTOM_ROLE_NAME_FIELD_DESCRIPTION,
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "Incident Responder",
      validation: {
        minLength: 2,
        maxLength: CUSTOM_ROLE_NAME_MAX_LENGTH,
      },
    },
    /*
     * Not a column of the role: the page adds each pick once the role
     * exists (addPermissionsToCustomRole), so nothing of it is sent with
     * the role. Left out when the user could put no built-in role into
     * one: the role starts empty, as it may.
     */
    ...(offeredCount > 0
      ? [
          {
            overrideField: {
              [CUSTOM_ROLE_PERMISSIONS_FIELD_KEY]: true,
            },
            overrideFieldKey: CUSTOM_ROLE_PERMISSIONS_FIELD_KEY,
            formOnly: true,
            showEvenIfPermissionDoesNotExist: true,
            title: "Permissions",
            description: isAnyLeftOut
              ? CUSTOM_ROLE_PERMISSIONS_FIELD_DESCRIPTION_SOME_LEFT_OUT
              : CUSTOM_ROLE_PERMISSIONS_FIELD_DESCRIPTION,
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownOptions: startingRoles,
            required: false,
            placeholder: "Search roles, such as Incident Member",
            dataTestId: "custom-role-starting-permissions",
          } as ModelField<CustomRole>,
        ]
      : []),
    {
      field: {
        description: true,
      },
      title: "Description",
      description: CUSTOM_ROLE_DESCRIPTION_FIELD_DESCRIPTION,
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "Declares, works and resolves incidents and alerts.",
      collapsibleSection: advanced,
    },
  ];
};

/*
 * A role's Name and Description on its page, where Edit changes them: the
 * create form's two fields, with the same help, and nothing folded - two
 * rows need no fold.
 */
export const getCustomRoleEditFormFields: () => Array<
  ModelField<CustomRole>
> = (): Array<ModelField<CustomRole>> => {
  return [
    {
      field: {
        name: true,
      },
      title: "Name",
      description: CUSTOM_ROLE_NAME_FIELD_DESCRIPTION,
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "Incident Responder",
      validation: {
        minLength: 2,
        maxLength: CUSTOM_ROLE_NAME_MAX_LENGTH,
      },
    },
    {
      field: {
        description: true,
      },
      title: "Description",
      description: CUSTOM_ROLE_DESCRIPTION_FIELD_DESCRIPTION,
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "Declares, works and resolves incidents and alerts.",
    },
  ];
};

/*
 * The permissions a submitted Permissions value asks for, each once, in the
 * order picked - leaving out anything a role may not hold.
 */
export const getPickedRolePermissions: (value: unknown) => Array<Permission> = (
  value: unknown,
): Array<Permission> => {
  const values: Array<unknown> = Array.isArray(value)
    ? value
    : value
      ? [value]
      : [];
  const picked: Array<Permission> = [];

  for (const item of values) {
    const permission: unknown =
      item && typeof item === "object" && "value" in item
        ? (item as { value: unknown }).value
        : item;

    if (
      typeof permission === "string" &&
      isPermissionAllowedInCustomRole(permission) &&
      !picked.includes(permission as Permission)
    ) {
      picked.push(permission as Permission);
    }
  }

  return picked;
};

// A permission row of a role: the whole project, as picked on Create.
export const buildCustomRolePermission: (data: {
  customRoleId: ObjectID;
  projectId: ObjectID;
  permission: Permission;
}) => CustomRolePermission = (data: {
  customRoleId: ObjectID;
  projectId: ObjectID;
  permission: Permission;
}): CustomRolePermission => {
  const row: CustomRolePermission = new CustomRolePermission();
  row.customRoleId = data.customRoleId;
  row.projectId = data.projectId;
  row.permission = data.permission;
  row.scope = PermissionScope.All;

  return row;
};

export interface PermissionNotAdded {
  permission: Permission;
  error: string;
}

/*
 * Why one pick is missing from a new role, as the notice above the list
 * says it: the server's words, which name the permission themselves ("You
 * cannot grant Alert Member because ..."), or the permission's name then
 * the server's words when they don't ("Alert Member: Network error.").
 */
export const getPermissionNotAddedReason: (
  translator: Translator,
  item: PermissionNotAdded,
) => string = (translator: Translator, item: PermissionNotAdded): string => {
  const title: string = getPermissionTitleForSentence(item.permission);

  if (item.error.includes(title)) {
    return item.error;
  }

  return translator.translateTemplate("{{permission}}: {{reason}}", {
    permission: translator.translateText(title) || title,
    reason: item.error,
  });
};

/*
 * Adds the picked permissions to a new role, one request each, through the
 * endpoint the role's Permissions card uses. One the server refuses does not
 * stop the others; every refusal is handed back, with the server's words,
 * for the page to show. The role exists either way.
 */
export const addPermissionsToCustomRole: (data: {
  customRoleId: ObjectID;
  projectId: ObjectID;
  permissions: Array<Permission>;
  modelAPI?: typeof ModelAPI | undefined;
}) => Promise<Array<PermissionNotAdded>> = async (data: {
  customRoleId: ObjectID;
  projectId: ObjectID;
  permissions: Array<Permission>;
  modelAPI?: typeof ModelAPI | undefined;
}): Promise<Array<PermissionNotAdded>> => {
  const modelAPI: typeof ModelAPI = data.modelAPI || ModelAPI;
  const notAdded: Array<PermissionNotAdded> = [];

  for (const permission of data.permissions) {
    try {
      await modelAPI.create<CustomRolePermission>({
        model: buildCustomRolePermission({
          customRoleId: data.customRoleId,
          projectId: data.projectId,
          permission: permission,
        }),
        modelType: CustomRolePermission,
      });
    } catch (err) {
      notAdded.push({
        permission: permission,
        error: API.getFriendlyMessage(err),
      });
    }
  }

  return notAdded;
};
