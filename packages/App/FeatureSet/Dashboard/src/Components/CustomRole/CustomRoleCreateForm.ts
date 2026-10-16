import { getRoleCardSelectOptions } from "../Permission/RoleCardSelectOptions";
import CustomRole from "Common/Models/DatabaseModels/CustomRole";
import CustomRolePermission from "Common/Models/DatabaseModels/CustomRolePermission";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import {
  CUSTOM_ROLE_NAME_MAX_LENGTH,
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
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * CREATE CUSTOM ROLE: A NAME, THE ROLES IT STARTS WITH, AND THE REST FOLDED.
 *
 * A custom role is most often a few built-in roles under one name -
 * "Incident Responder" is Incident Member, Alert Member and On-Call Viewer -
 * so the form asks for exactly that:
 *
 *   - Name;
 *   - Permissions: the built-in roles it starts with, picked from the same
 *     groups Add Role shows (Project Owner left out: no role holds it), for
 *     every resource in the project. Optional - a role can start empty. A
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
  "The built-in roles this role bundles, for every resource in the project. Add single permissions, or limit one to owned or labelled resources, on the role's page.",
);

/*
 * The built-in roles a new role can start with, in Add Role's groups and
 * order, without Project Owner. A card's description says what the role can
 * do, so the option keeps it.
 */
export const getCustomRoleStartingRoleOptions: () => Array<DropdownOptionGroup> =
  (): Array<DropdownOptionGroup> => {
    return getRoleCardSelectOptions({
      excludeRoles: PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE,
    }).map((group: CardSelectOptionGroup): DropdownOptionGroup => {
      return {
        label: group.label,
        options: group.options.map(
          (option: CardSelectOption): DropdownOption => {
            return {
              value: option.value,
              label: option.title,
              description: option.description,
            };
          },
        ),
      };
    });
  };

export const getCustomRoleCreateFormFields: () => Array<
  ModelField<CustomRole>
> = (): Array<ModelField<CustomRole>> => {
  const advanced: FormFieldCollapsibleSection<CustomRole> =
    getAdvancedFormSection<CustomRole>();

  return [
    {
      field: {
        name: true,
      },
      title: "Name",
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
     * exists (addPermissionsToCustomRole), so nothing of it is sent with the
     * role.
     */
    {
      overrideField: {
        [CUSTOM_ROLE_PERMISSIONS_FIELD_KEY]: true,
      },
      overrideFieldKey: CUSTOM_ROLE_PERMISSIONS_FIELD_KEY,
      formOnly: true,
      showEvenIfPermissionDoesNotExist: true,
      title: "Permissions",
      description: CUSTOM_ROLE_PERMISSIONS_FIELD_DESCRIPTION,
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownOptions: getCustomRoleStartingRoleOptions(),
      required: false,
      placeholder: "Search roles, such as Incident Member",
      dataTestId: "custom-role-starting-permissions",
    } as ModelField<CustomRole>,
    {
      field: {
        description: true,
      },
      title: "Description",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "Declares, works and resolves incidents and alerts.",
      collapsibleSection: advanced,
    },
  ];
};

/*
 * The permissions a submitted Permissions value asks for, each once, in the
 * order picked - leaving out anything a role may not hold.
 */
export const getPickedRolePermissions: (value: unknown) => Array<Permission> =
  (value: unknown): Array<Permission> => {
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
