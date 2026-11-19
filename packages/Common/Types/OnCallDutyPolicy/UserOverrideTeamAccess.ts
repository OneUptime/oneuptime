import HeldPermissionsUtil, { HeldPermissions } from "../HeldPermissions";
import Permission from "../Permission";
import { translationKey } from "../Translator";

/*
 * USER OVERRIDES FOR THE PEOPLE OF ONE'S OWN TEAM (issue #9733).
 *
 * Adding, editing and deleting a user override took a permission that
 * reaches every person in the project: whoever could cover a teammate
 * could also mark someone of another team away and send their pages to
 * anyone. Manage On-Call Policy User Overrides for Own Team
 * (Permission.ManageTeamOnCallDutyPolicyUserOverride) adds, edits and
 * deletes overrides like Create, Edit and Delete On-Call Policy User
 * Override do, for the people of the team it is given to only: the person
 * who is away and the person who covers - when somebody does - must both
 * be accepted members of a team that gives it.
 *
 * "Their team" is the team that gives the permission, never every team the
 * person is in, as an Owned grant reaches what the team it is given to
 * owns (UserPermission.teamId). Teams here are permission groups as much as
 * groups of people: one big team that gives everybody a read permission
 * would otherwise widen the grant to the whole project, without anyone
 * having given it there. Given to Payments - on the team's Permissions page
 * or through a custom role given to the team - it lets Payments' members
 * arrange cover among Payments' members; given to several teams, each
 * team's people. Not the teams a person owns either: who owns a team is
 * optional, and the people a team covers for are its members.
 *
 * Its scope narrows it as it narrows the permissions beside it: limited to
 * labels, or to the policies the team owns, it reaches the overrides on
 * those policies only - and, like them, no global override, which takes a
 * grant over the whole project (GlobalUserOverrideAccess). An API key, or
 * a workflow, holds it through no team, so it reaches nobody. A grant that
 * reaches every person - Project Owner, Project Admin, Project Member,
 * On-Call Admin, On-Call Member, or Create, Edit or Delete On-Call Policy
 * User Override - is not narrowed by it: whoever holds one manages every
 * override they did before.
 *
 * The server holds every add, edit and delete to it, from the dashboard,
 * the API, Terraform and the mobile app alike, for each override a write
 * touches - the people it names as saved, and the ones an edit names
 * instead (OnCallDutyPolicyUserOverrideService). The dashboard's pickers
 * offer only those people, saying why, and the lists lock Edit, End Now
 * and Delete on an override that names anyone else
 * (Dashboard/Components/OnCallPolicy/UserOverrides/UserOverrideTeamLimit).
 *
 * The refusals are English, marked as keys of the Dashboard's locales (its
 * extractor reads this file): the server says them in English, the
 * dashboard in the reader's language.
 */

export const USER_OVERRIDE_TEAM_PERMISSION: Permission =
  Permission.ManageTeamOnCallDutyPolicyUserOverride;

// Adding an override for somebody outside the teams.
export const USER_OVERRIDE_TEAM_AWAY_REFUSAL: string = translationKey(
  "The person who is away is not in a team that lets you manage their user overrides. Pick someone from your team.",
);

// Adding or editing an override so that somebody outside the teams covers.
export const USER_OVERRIDE_TEAM_COVER_REFUSAL: string = translationKey(
  "The person who covers is not in a team that lets you manage their user overrides. Pick someone from your team, or leave it to the next person in the rotation.",
);

// Editing an override that names somebody outside the teams.
export const USER_OVERRIDE_TEAM_EDIT_REFUSAL: string = translationKey(
  "This user override names someone who is not in a team that lets you manage their user overrides, so you can't change it. Ask someone who can manage every user override.",
);

// Deleting one.
export const USER_OVERRIDE_TEAM_DELETE_REFUSAL: string = translationKey(
  "This user override names someone who is not in a team that lets you manage their user overrides, so you can't delete it. Ask someone who can manage every user override.",
);

// Holding the permission through no team: an API key, a workflow.
export const USER_OVERRIDE_TEAM_NO_TEAM_REFUSAL: string = translationKey(
  "Your permission to manage user overrides covers only the people in the teams it is given to, and no team gives it to you. An API key is in no team: give it Create, Edit and Delete On-Call Policy User Override instead.",
);

// What a picker says above a list kept to the teams' people.
export const USER_OVERRIDE_TEAM_PICKER_HINT: string = translationKey(
  "Only people in {{teams}} are listed: the teams that let you manage user overrides.",
);

export default class UserOverrideTeamAccess {
  /*
   * The permissions of a write's own list (the table's create, update or
   * delete list) that reach every person: all but the team one.
   */
  public static getEveryonePermissions(
    modelPermissions: ReadonlyArray<Permission>,
  ): Array<Permission> {
    return modelPermissions.filter((permission: Permission): boolean => {
      return permission !== USER_OVERRIDE_TEAM_PERMISSION;
    });
  }

  // Whether `held` grants the team permission, with no block taking it away.
  public static holdsTeamPermission(held: HeldPermissions): boolean {
    return HeldPermissionsUtil.holdsAnyOf(held, [
      USER_OVERRIDE_TEAM_PERMISSION,
    ]);
  }

  /*
   * Whether `held` names anyone in an override it writes: a permission of
   * the write's list that reaches every person, held over the whole
   * project, and no block with no labels on any of them. As before the
   * team permission, nothing more is asked of them.
   */
  public static reachesEveryone(
    held: HeldPermissions,
    modelPermissions: ReadonlyArray<Permission>,
  ): boolean {
    return HeldPermissionsUtil.holdsAnyOf(
      held,
      UserOverrideTeamAccess.getEveryonePermissions(modelPermissions),
      { projectWideOnly: true },
    );
  }

  /*
   * Whether `held` grants a permission of the write's list that reaches
   * every person at all, however its labels or owners narrow it: whether
   * it may reach some overrides without the team permission.
   */
  public static holdsEveryonePermission(
    held: HeldPermissions,
    modelPermissions: ReadonlyArray<Permission>,
  ): boolean {
    return HeldPermissionsUtil.isGrantedAny(
      held,
      UserOverrideTeamAccess.getEveryonePermissions(modelPermissions),
    );
  }

  /*
   * WHETHER A PICKER OFFERS ONLY THE PEOPLE OF THE READER'S TEAMS, for an
   * override of the write's list - global, or on a policy. As the dashboard
   * can tell it from the permission snapshot: the reader holds the team
   * permission and nothing that reaches every person over the whole
   * project. A global override takes a grant over the whole project, so a
   * narrower one that reaches every person cannot make it, and the picker
   * is limited. On a policy, only the server knows whether such a grant
   * reaches the policy (its labels, its owners), so the picker offers
   * everyone and the server decides on save - a picker never hides someone
   * the save would let through.
   */
  public static isLimitedToTeams(data: {
    held: HeldPermissions;
    modelPermissions: ReadonlyArray<Permission>;
    isGlobal: boolean;
  }): boolean {
    if (!UserOverrideTeamAccess.holdsTeamPermission(data.held)) {
      return false;
    }

    if (
      UserOverrideTeamAccess.reachesEveryone(data.held, data.modelPermissions)
    ) {
      return false;
    }

    if (data.isGlobal) {
      return true;
    }

    return !UserOverrideTeamAccess.holdsEveryonePermission(
      data.held,
      data.modelPermissions,
    );
  }

  // Whether a server's refusal is about the person who is away.
  public static isAwayRefusal(message: string): boolean {
    return message.indexOf(USER_OVERRIDE_TEAM_AWAY_REFUSAL) !== -1;
  }

  // Whether a server's refusal is about the person who covers.
  public static isCoverRefusal(message: string): boolean {
    return message.indexOf(USER_OVERRIDE_TEAM_COVER_REFUSAL) !== -1;
  }
}
