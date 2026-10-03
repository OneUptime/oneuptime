import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";

/*
 * Incidents → Settings → Incident Roles: what the page says, and the two
 * rules it shows about Incident Commander, the role every project has.
 *
 * The maintainer, on this page: "To make things simple, can we remove all
 * the roles except Incident Commander by default? People can add more roles
 * if they feel like. Please also remove multiple users column from modal
 * table (as this complicates the UI). We need to make the UI as easy to
 * understand as possible."
 *
 * So a new project's list holds only Incident Commander (ProjectService
 * seeds it), the card says more roles can be added, the table shows each
 * role's name and description and nothing else, and whether a role takes
 * more than one person is in its form, folded under Advanced.
 *
 * Kept in one React-free module so the page renders these exact strings and
 * App/Tests/Dashboard/IncidentRoleSettings checks that each has an entry in
 * all seventeen Dashboard locale files: the dashboard translates a string by
 * looking up its English text, so a string with no entry silently stays
 * English.
 */

export interface IncidentRoleSettingsCopyType {
  // The card's title and the sentence under it.
  title: string;
  description: string;
  noItemsMessage: string;
  // Why Incident Commander's Delete is locked (the server refuses it too).
  deleteLockedReason: string;
  // The create and edit form: two steps, then the fields on them.
  basicInfoStep: string;
  appearanceStep: string;
  nameFieldTitle: string;
  /*
   * A role name, shown as an example and kept as it is, like the names of
   * the roles themselves. Not Incident Commander, which every project
   * already has: the form is for the roles a team adds.
   */
  namePlaceholder: string;
  descriptionFieldTitle: string;
  descriptionPlaceholder: string;
  allowMultipleUsersTitle: string;
  allowMultipleUsersDescription: string;
  iconFieldTitle: string;
  iconPlaceholder: string;
  colorFieldTitle: string;
  colorPlaceholder: string;
}

export const IncidentRoleSettingsCopy: IncidentRoleSettingsCopyType = {
  title: "Incident Roles",
  description:
    "The roles people take on during an incident, such as Incident Commander. Add more if your team needs them.",
  noItemsMessage: "No incident roles found.",
  deleteLockedReason:
    "Every incident needs someone in charge, so this role can be renamed, but not deleted.",
  basicInfoStep: "Basic Info",
  appearanceStep: "Appearance",
  nameFieldTitle: "Name",
  namePlaceholder: "Responder",
  descriptionFieldTitle: "Description",
  descriptionPlaceholder: "Does the hands-on work to resolve the incident.",
  allowMultipleUsersTitle: "Allow Multiple Users",
  allowMultipleUsersDescription:
    "Enable this to allow multiple users to be assigned to this role for the same incident.",
  iconFieldTitle: "Role Icon",
  iconPlaceholder: "Select an icon for this role",
  colorFieldTitle: "Role Color",
  colorPlaceholder: "Please select color for this role.",
};

/**
 * Every string the page looks up in the locale files, for the locale checks.
 * The name placeholder is left out: it is a role name, kept as it is.
 */
export const getIncidentRoleSettingsStrings: () => Array<string> =
  (): Array<string> => {
    const strings: Set<string> = new Set<string>();

    for (const [key, value] of Object.entries(IncidentRoleSettingsCopy)) {
      if (key === "namePlaceholder") {
        continue;
      }

      strings.add(value);
    }

    return Array.from(strings);
  };

/**
 * Why a role's Delete is locked, or undefined when it can be deleted.
 *
 * Incident Commander is seeded with isDeleteable false, a flag nobody can
 * set or change through the API, and IncidentRoleService refuses to delete
 * a role that has it. The row says so before anyone tries, rather than
 * after a confirmation, and a bulk Delete skips it with the same reason.
 */
export const getIncidentRoleDeleteLockedReason: (
  role: IncidentRole,
) => string | undefined = (role: IncidentRole): string | undefined => {
  return role.isDeleteable === false
    ? IncidentRoleSettingsCopy.deleteLockedReason
    : undefined;
};

/**
 * The IDs of the primary roles among the roles the table fetched: the
 * Incident Commander every project has, under whatever name it was given.
 */
export const getPrimaryIncidentRoleIds: (
  roles: Array<IncidentRole>,
) => Set<string> = (roles: Array<IncidentRole>): Set<string> => {
  const ids: Set<string> = new Set<string>();

  for (const role of roles) {
    if (role.isPrimaryRole === true && role._id) {
      ids.add(role._id.toString());
    }
  }

  return ids;
};

/**
 * Whether the form offers Allow Multiple Users: on Create, and on Edit for
 * every role but a primary one. One person leads an incident, and
 * IncidentRoleService refuses a primary role that allows more than one, so
 * Incident Commander's form does not offer what it cannot save.
 */
export const canOfferAllowMultipleUsers: (data: {
  values: FormValues<IncidentRole>;
  primaryRoleIds: ReadonlySet<string>;
}) => boolean = (data: {
  values: FormValues<IncidentRole>;
  primaryRoleIds: ReadonlySet<string>;
}): boolean => {
  const roleId: unknown = (data.values as { _id?: unknown } | undefined)?._id;

  // A role being created is never the primary role.
  if (roleId === undefined || roleId === null || roleId === "") {
    return true;
  }

  return !data.primaryRoleIds.has(String(roleId));
};
