import HeldPermissionsUtil, {
  HeldPermissions,
  HeldPermissionsOptions,
} from "../HeldPermissions";
import Permission from "../Permission";

/*
 * WHO MAY ADD OR REMOVE A GLOBAL USER OVERRIDE.
 *
 * A user override on an on-call policy follows its policy. A permission to
 * add overrides that is limited to the policies a team owns, or to the ones
 * carrying some labels, adds them to those policies only - the server holds
 * the override to the policy it names (CreateScopePermission, the record
 * rule through @OwnedThrough and the policy's labels).
 *
 * A global override names no policy: it applies to every on-call policy in
 * the project, another team's as much as one's own. Adding one with a
 * permission limited to labels went through all the same - a record that
 * names no labelled record was read as about none of them - so a member
 * limited to their own team's policies could mark a member of another team
 * away on that team's policies too, and remove another team's global
 * override as easily (issue #5617). Limited to owned policies, they could do
 * neither: a record of no policy belongs to no owner.
 *
 * So adding a global override, editing one or deleting one, takes a
 * permission to add (to edit, to delete) user overrides that reaches the
 * whole project
 * (HeldPermissionsUtil, projectWideOnly): not one limited to labels or to
 * owned policies, and not one a team's block with labels takes away from
 * some policies, which the override would reach as well
 * (labelledBlocksRefuse). Overrides on a policy are untouched by this: a
 * team scoped to its own policies keeps adding them there, from each
 * policy's own User Overrides page.
 *
 * The server holds every add, edit and delete of the table to it
 * (OnCallDutyPolicyUserOverrideService), and the dashboard locks Add, Edit
 * and Delete on the Global User Overrides page by it, with these words
 * (UserOverrideTable). Both read the caller's rows by the one rule
 * (HeldPermissions).
 */

export const GLOBAL_USER_OVERRIDE_HELD_OPTIONS: Readonly<HeldPermissionsOptions> =
  {
    projectWideOnly: true,
    labelledBlocksRefuse: true,
  };

/*
 * Marks an English sentence as a key of the Dashboard's locales - the same
 * marker as Common/UI/Utils/TranslateTemplate's translationKey, kept here so
 * this file stays free of the UI. It returns the text unchanged. The
 * Dashboard's locale extractor reads this file for what it marks (a "keys"
 * root of App/FeatureSet/Dashboard/scripts/i18n/ExtractStrings.ts).
 */
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

/*
 * Why a global override is not added or deleted. The server answers in
 * English; the dashboard looks each up in the reader's language.
 */
export const GLOBAL_USER_OVERRIDE_ADD_REFUSAL: string = translationKey(
  "A global user override applies to every on-call policy in the project, and your permission to add user overrides covers only some of them. Add the override on the policy's own User Overrides page instead.",
);

export const GLOBAL_USER_OVERRIDE_DELETE_REFUSAL: string = translationKey(
  "A global user override applies to every on-call policy in the project, and your permission to delete user overrides covers only some of them. Someone whose permission covers every policy can delete it.",
);

export const GLOBAL_USER_OVERRIDE_EDIT_REFUSAL: string = translationKey(
  "A global user override applies to every on-call policy in the project, and your permission to edit user overrides covers only some of them. Someone whose permission covers every policy can edit it.",
);

export default class GlobalUserOverrideAccess {
  /*
   * Whether `held` adds - or, given the table's update or delete
   * permissions, edits or deletes - a global user override: one of
   * `permissions` held over the whole project, and no block on any of them,
   * with labels or without.
   */
  public static mayChange(
    held: HeldPermissions,
    permissions: ReadonlyArray<Permission>,
  ): boolean {
    return HeldPermissionsUtil.holdsAnyOf(
      held,
      permissions,
      GLOBAL_USER_OVERRIDE_HELD_OPTIONS,
    );
  }
}
