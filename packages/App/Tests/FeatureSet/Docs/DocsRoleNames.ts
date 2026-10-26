import { PermissionHelper, PermissionProps } from "Common/Types/Permission";
import { drawnDashboardLabel } from "./DocsDashboardLabels";

/*
 * THE BUILT-IN ROLES' NAMES, IN EVERY DOCS LANGUAGE.
 *
 * The Dashboard draws a built-in role's name in the reader's language: each
 * name is a key of its own (Components/Permission/RoleCardSelectOptions
 * ROLE_NAMES), and the role picker, the Built-in Roles card, the team and
 * API key permission tables and the "You need one of these permissions"
 * refusals all look it up. So a translated docs page names a role the way
 * its Dashboard draws it (drawnDashboardLabel) - Project Owner, Incident
 * Viewer and the rest are no longer kept in English the way a permission's
 * own title is ("Create Incident", "Manage Billing").
 *
 * The roles are the permissions Common/Types/Permission marks as role
 * permissions, so a new built-in role is a name here at once.
 */
export const BUILT_IN_ROLE_NAMES: ReadonlyArray<string> =
  PermissionHelper.getRolePermissionProps().map(
    (props: PermissionProps): string => {
      return props.title;
    },
  );

// Whether a bold name is a built-in role's name.
export function isBuiltInRoleName(name: string): boolean {
  return BUILT_IN_ROLE_NAMES.includes(name);
}

/*
 * A role's or a permission's title as a page in a language writes it: a
 * built-in role's name as that language's Dashboard draws it, a
 * permission's own title as it is ("Edit LLM", "Manage Billing").
 */
export function writtenPermissionTitle(
  language: string,
  title: string,
): string {
  return isBuiltInRoleName(title)
    ? drawnDashboardLabel(language, title)
    : title;
}

/*
 * Whether a bold name is a permission's own title - which every language
 * keeps in English, as the permission picker draws it - and not a built-in
 * role's name, which reads in the page's language.
 */
export function isPermissionTitleKeptInEnglish(name: string): boolean {
  return (
    !isBuiltInRoleName(name) &&
    PermissionHelper.getAllPermissionProps().some(
      (props: PermissionProps): boolean => {
        return props.title === name;
      },
    )
  );
}
