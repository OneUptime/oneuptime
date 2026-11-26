import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE INCIDENT ROLE A POLICY GIVES THE PEOPLE IT PAGES, IN THE DASHBOARD
 * (OnCallDutyPolicy.incidentRoleId; what it does is in Common/Server/Utils/
 * OnCall/OnCallPolicyIncidentRole).
 *
 * One pick, folded away under More settings on the policy's Escalation
 * Rules page beside the Acknowledgement Timeout: most policies give no
 * role, and the page works fully without it. More settings names it, and
 * the role it gives while it gives one.
 *
 * Its card asks one thing: which of the project's incident roles everybody
 * the policy pages is given on the incident or episode - or none, what
 * every policy gives until somebody picks one. Archived roles are not
 * offered (ArchivedValuePicker, through the form's dropdown).
 *
 * Kept free of React, so App/Tests can read it.
 */

// The policy's column the pick writes, and the relation it is read through.
export const PAGED_PEOPLE_INCIDENT_ROLE_COLUMN: string = "incidentRoleId";

export const PAGED_PEOPLE_INCIDENT_ROLE_RELATION: string = "incidentRole";

// data-testid prefix of the card and its detail.
export const PAGED_PEOPLE_INCIDENT_ROLE_TEST_ID: string =
  "paged-people-incident-role";

export const PagedPeopleIncidentRoleCopy: {
  cardTitle: string;
  cardDescription: string;
  dialogTitle: string;
  fieldTitle: string;
  fieldDescription: string;
  noRole: string;
  rowTitle: string;
} = {
  cardTitle: translationKey("Incident Role"),
  cardDescription: translationKey(
    "Gives everybody this policy pages a role on the incident or episode.",
  ),
  dialogTitle: translationKey("Edit Incident Role"),
  fieldTitle: translationKey("Role"),
  fieldDescription: translationKey(
    "Everybody this policy pages is listed under this role in the incident's Incident Roles. Observers are not.",
  ),
  // Empty: the policy gives nobody a role, as every policy does at first.
  noRole: translationKey("No role"),
  rowTitle: translationKey("Role of the people it pages"),
};

/*
 * The name of the role a stored policy gives, as read with its relation, or
 * null while it gives none: what More settings says while it is folded.
 */
export const getPagedPeopleIncidentRoleName: (
  item: unknown,
) => string | null = (item: unknown): string | null => {
  if (!item || typeof item !== "object") {
    return null;
  }

  const values: Record<string, unknown> = item as Record<string, unknown>;
  const roleId: unknown = values[PAGED_PEOPLE_INCIDENT_ROLE_COLUMN];
  const role: unknown = values[PAGED_PEOPLE_INCIDENT_ROLE_RELATION];

  const name: unknown =
    role && typeof role === "object"
      ? (role as Record<string, unknown>)["name"]
      : undefined;

  if (typeof name === "string" && name.trim()) {
    return name.trim();
  }

  /*
   * A role picked but not read with its name - one the reader may not
   * see: set, with no name to show.
   */
  if (roleId || (role && typeof role === "object")) {
    return "";
  }

  return null;
};
