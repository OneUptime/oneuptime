import { isBuiltInRolePermission } from "@oneuptime/dashboard/Components/Permission/RoleCardSelectOptions";
import Permission from "Common/Types/Permission";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE TWO WAYS A PERMISSION GOES INTO A CUSTOM ROLE, on the role's page
 * (CustomRolePermissionTable): Add Role picks a built-in role from the role
 * picker (Permission/RolePicker), Add Permission one permission from the
 * full list. Each dialog is named for the button that opened it, and Edit
 * opens the picker a row was added with, so its current pick is the one
 * shown. React-free, so tests read it without rendering a page.
 */

export enum CustomRolePermissionPickerType {
  // The role picker, behind Add Role.
  Role = "Role",
  // The full list of permissions, behind Add Permission.
  SinglePermission = "SinglePermission",
}

/*
 * The picker a permission is edited with: the role picker for a built-in
 * role, the full list for anything else - the one it was added with.
 */
export const getCustomRolePermissionPickerType: (
  permission: Permission | string | undefined | null,
) => CustomRolePermissionPickerType = (
  permission: Permission | string | undefined | null,
): CustomRolePermissionPickerType => {
  return isBuiltInRolePermission(permission)
    ? CustomRolePermissionPickerType.Role
    : CustomRolePermissionPickerType.SinglePermission;
};

// The help under a single permission's picker, in place of the API's words.
export const SINGLE_PERMISSION_FIELD_DESCRIPTION: string = translationKey(
  "A single permission, for exactly what the role needs.",
);

/*
 * What the Add dialog is called, and its button: what it adds, and to which
 * role ("Add a Role to Incident Responder" / "Add Role"). The English to
 * look up - the template's role is filled where it is drawn.
 */
export interface CustomRolePermissionDialogWords {
  // A sentence with {{role}}, for when the role's name is known.
  titleWithRole: string;
  // The same without the name, while it is still being read.
  title: string;
  submitButtonText: string;
}

export const CUSTOM_ROLE_PERMISSION_DIALOG_WORDS: Record<
  CustomRolePermissionPickerType,
  CustomRolePermissionDialogWords
> = {
  [CustomRolePermissionPickerType.Role]: {
    titleWithRole: translationKey("Add a Role to {{role}}"),
    title: translationKey("Add a Role"),
    submitButtonText: translationKey("Add Role"),
  },
  [CustomRolePermissionPickerType.SinglePermission]: {
    titleWithRole: translationKey("Add a Permission to {{role}}"),
    title: translationKey("Add a Permission"),
    submitButtonText: translationKey("Add Permission"),
  },
};
