import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT THE ADD DIALOGS OF A TEAM'S AND AN API KEY'S PERMISSIONS ARE CALLED.
 *
 * A team's Permissions card (Components/Team/TeamPermissionTable) and an API
 * key's (Components/ApiKey/ApiKeyPermissionTable) each add from two buttons,
 * Add Role and Add Permission. The dialog either one opened was named after
 * the table's model - "Create New Team Permission" with a "Create Team
 * Permission" button, "Add New Permission" behind Add Role - so the button
 * a person pressed and the dialog it opened said different things. The
 * dialog now says what the button said, as a custom role's Permissions card
 * already does ("Add a Role to Incident Responder", Components/CustomRole/
 * CustomRolePermissionPicker): "Add a Role" with an "Add Role" button, "Add
 * a Permission" with an "Add Permission" one.
 *
 * The same English as the custom role's words, so every language already
 * words them. Kept free of React so App/Tests read these exact strings.
 */

export enum AddPermissionDialogKind {
  // Add Role: a ready-made set of permissions, from the role cards.
  Role = "Role",
  // Add Permission: one permission, from the full list.
  SinglePermission = "SinglePermission",
}

export interface AddPermissionDialogWords {
  title: string;
  submitButtonText: string;
}

export const ADD_PERMISSION_DIALOG_WORDS: Readonly<
  Record<AddPermissionDialogKind, AddPermissionDialogWords>
> = {
  [AddPermissionDialogKind.Role]: {
    title: translationKey("Add a Role"),
    submitButtonText: translationKey("Add Role"),
  },
  [AddPermissionDialogKind.SinglePermission]: {
    title: translationKey("Add a Permission"),
    submitButtonText: translationKey("Add Permission"),
  },
};
