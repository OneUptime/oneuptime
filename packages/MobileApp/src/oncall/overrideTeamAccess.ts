import {
  hasLabels,
  isBlockRow,
  isProjectWideRow,
  readId,
  USER_OVERRIDE_CREATE_PERMISSIONS,
  type ProjectPermissionRow,
} from "./globalOverrideAccess";

/*
 * USER OVERRIDES FOR THE PEOPLE OF ONE'S OWN TEAM, AS THE APP SHOWS THEM
 * (issue #9883): the app's copy of the rule the server holds every add,
 * edit, end and delete of a user override to (Common/Types/OnCallDutyPolicy
 * /UserOverrideTeamAccess, enforced in OnCallDutyPolicyUserOverrideService)
 * and the Dashboard shows (Dashboard/src/Components/OnCallPolicy
 * /UserOverrides/UserOverrideTeamLimit).
 *
 * Someone whose only permission to manage user overrides is Manage On-Call
 * Policy User Overrides for Own Team may name, as away or covering, only
 * accepted members of the teams that give them that permission. So for
 * them the app offers only those teams' people to pick, saying why above
 * the list, and locks Edit, End now and Cancel on an override that names
 * anybody else, saying why - in the server's own words, so the phone says
 * what a save would have been refused with. Anyone whose permission reaches
 * everyone, and a master admin, see the app as before.
 *
 * What the person holds is the server's own word: the rows of the
 * `project-permissions` header every answer about the project carries
 * (api/projectPermissions), each with the team it is granted on.
 *
 * The app is built without Common's runtime code, so it keeps this copy,
 * and it imports nothing but the app's copy of how the server reads a row
 * (./globalOverrideAccess): Common/Tests/Types/OnCallDutyPolicy
 * /UserOverrideTeamAccessMobileParity compiles both as they are and asks
 * them and the Dashboard's rule the same questions over thousands of
 * generated permission rows, so neither can change alone.
 */

// Manage On-Call Policy User Overrides for Own Team.
export const USER_OVERRIDE_TEAM_PERMISSION: string =
  "ManageTeamOnCallDutyPolicyUserOverride";

// The permissions that edit a user override (its table's update list).
export const USER_OVERRIDE_UPDATE_PERMISSIONS: ReadonlyArray<string> = [
  "ProjectOwner",
  "ProjectAdmin",
  "ProjectMember",
  "OnCallAdmin",
  "OnCallMember",
  "EditOnCallDutyPolicyUserOverride",
  "ManageTeamOnCallDutyPolicyUserOverride",
];

// The permissions that delete one (its table's delete list).
export const USER_OVERRIDE_DELETE_PERMISSIONS: ReadonlyArray<string> = [
  "ProjectOwner",
  "ProjectAdmin",
  "ProjectMember",
  "OnCallAdmin",
  "OnCallMember",
  "DeleteOnCallDutyPolicyUserOverride",
  "ManageTeamOnCallDutyPolicyUserOverride",
];

// What is done to an override: added, edited (End now too), or deleted (Cancel).
export type OverrideTeamAction = "create" | "update" | "delete";

// The server's refusals, word for word (UserOverrideTeamAccess).
export const OVERRIDE_TEAM_AWAY_REFUSAL: string =
  "The person who is away is not in a team that lets you manage their user overrides. Pick someone from your team.";

export const OVERRIDE_TEAM_COVER_REFUSAL: string =
  "The person who covers is not in a team that lets you manage their user overrides. Pick someone from your team, or leave it to the next person in the rotation.";

export const OVERRIDE_TEAM_EDIT_REFUSAL: string =
  "This user override names someone who is not in a team that lets you manage their user overrides, so you can't change it. Ask someone who can manage every user override.";

export const OVERRIDE_TEAM_DELETE_REFUSAL: string =
  "This user override names someone who is not in a team that lets you manage their user overrides, so you can't delete it. Ask someone who can manage every user override.";

// What a picker kept to the teams says above its list, and with nobody in it.
export const OVERRIDE_TEAM_PICKER_HINT: string =
  "Only people in {{teams}} are listed: the teams that let you manage user overrides.";

export const OVERRIDE_TEAM_PICKER_EMPTY_TEXT: string =
  "No one in these teams can be picked.";

// The teams whose people the person may name, lower-cased: none names nobody.
export interface OverrideTeamLimit {
  teamIds: Array<string>;
}

// The people an override names, by user id: nobody covers a skip.
export interface OverrideTeamPeople {
  awayUserId: string | null | undefined;
  coverUserId: string | null | undefined;
}

// The table's permissions for an action.
function getActionPermissions(
  action: OverrideTeamAction,
): ReadonlyArray<string> {
  if (action === "create") {
    return USER_OVERRIDE_CREATE_PERMISSIONS;
  }

  if (action === "update") {
    return USER_OVERRIDE_UPDATE_PERMISSIONS;
  }

  return USER_OVERRIDE_DELETE_PERMISSIONS;
}

/*
 * What the rows hold, as HeldPermissionsUtil.fromRows reads them: what an
 * allow row grants, what reaches the whole project, and what a block with
 * no labels takes away outright.
 */
interface HeldRows {
  allowed: Set<string>;
  allowedProjectWide: Set<string>;
  blocked: Set<string>;
}

function readHeld(rows: ReadonlyArray<ProjectPermissionRow>): HeldRows {
  const held: HeldRows = {
    allowed: new Set<string>(),
    allowedProjectWide: new Set<string>(),
    blocked: new Set<string>(),
  };

  for (const row of rows) {
    if (!row || !row.permission) {
      continue;
    }

    if (isBlockRow(row)) {
      if (!hasLabels(row)) {
        held.blocked.add(row.permission);
      }

      continue;
    }

    held.allowed.add(row.permission);

    if (isProjectWideRow(row)) {
      held.allowedProjectWide.add(row.permission);
    }
  }

  return held;
}

// HeldPermissionsUtil.isGrantedAny: an allow row for one of `accepted`.
function isGrantedAny(
  held: HeldRows,
  accepted: ReadonlyArray<string>,
  projectWideOnly: boolean,
): boolean {
  const grants: Set<string> = projectWideOnly
    ? held.allowedProjectWide
    : held.allowed;

  return accepted.some((permission: string): boolean => {
    return grants.has(permission);
  });
}

// HeldPermissionsUtil.holdsAnyOf: granted, and no block with no labels on any of them.
function holdsAnyOf(
  held: HeldRows,
  accepted: ReadonlyArray<string>,
  projectWideOnly: boolean,
): boolean {
  if (
    accepted.some((permission: string): boolean => {
      return held.blocked.has(permission);
    })
  ) {
    return false;
  }

  return isGrantedAny(held, accepted, projectWideOnly);
}

/*
 * UserOverrideTeamAccess.isLimitedToTeams: whether the person holds the
 * team permission and nothing of the action's list that reaches every
 * person over the whole project. A global override takes a grant over the
 * whole project, so a narrower one that reaches everyone cannot make it.
 * On a policy only the server knows whether such a grant reaches it, so
 * the app offers everyone there and the server decides.
 */
function isLimitedToTeams(
  held: HeldRows,
  action: OverrideTeamAction,
  isGlobal: boolean,
): boolean {
  const everyone: Array<string> = getActionPermissions(action).filter(
    (permission: string): boolean => {
      return permission !== USER_OVERRIDE_TEAM_PERMISSION;
    },
  );

  if (!holdsAnyOf(held, [USER_OVERRIDE_TEAM_PERMISSION], false)) {
    return false;
  }

  if (holdsAnyOf(held, everyone, true)) {
    return false;
  }

  if (isGlobal) {
    return true;
  }

  return !isGrantedAny(held, everyone, false);
}

/*
 * HeldPermissionsUtil.getTeamGrants: the teams whose allow rows give the
 * team permission, each once, in the order the rows name them, with
 * whether one of its rows reaches the whole project.
 */
function getTeamGrants(
  rows: ReadonlyArray<ProjectPermissionRow>,
): Array<{ teamId: string; isProjectWide: boolean }> {
  const grants: Array<{ teamId: string; isProjectWide: boolean }> = [];

  for (const row of rows) {
    if (
      !row ||
      row.permission !== USER_OVERRIDE_TEAM_PERMISSION ||
      isBlockRow(row)
    ) {
      continue;
    }

    const teamId: string = readId(row.teamId);

    if (!teamId) {
      continue;
    }

    const known: { teamId: string; isProjectWide: boolean } | undefined =
      grants.find((grant: { teamId: string }): boolean => {
        return grant.teamId === teamId;
      });

    if (known) {
      known.isProjectWide = known.isProjectWide || isProjectWideRow(row);
      continue;
    }

    grants.push({ teamId: teamId, isProjectWide: isProjectWideRow(row) });
  }

  return grants;
}

/*
 * The teams whose people the person may name in an override of `action` -
 * a global one, or one on a policy - or null when they are not limited to
 * any: a master admin, a permission that reaches everyone, no team
 * permission at all, nothing said by the server yet, or an override on a
 * policy that a narrower permission may reach. A global override is
 * reached only by the teams whose grant reaches the whole project.
 */
export function getOverrideTeamLimit(data: {
  rows: ReadonlyArray<ProjectPermissionRow> | null;
  isMasterAdmin: boolean;
  action: OverrideTeamAction;
  isGlobal: boolean;
}): OverrideTeamLimit | null {
  if (data.isMasterAdmin || !data.rows) {
    return null;
  }

  if (!isLimitedToTeams(readHeld(data.rows), data.action, data.isGlobal)) {
    return null;
  }

  return {
    teamIds: getTeamGrants(data.rows)
      .filter((grant: { isProjectWide: boolean }): boolean => {
        return !data.isGlobal || grant.isProjectWide;
      })
      .map((grant: { teamId: string }): string => {
        return grant.teamId;
      }),
  };
}

// Whether `userId` names somebody who is not among `memberIds`.
function isOutside(
  userId: string | null | undefined,
  memberIds: ReadonlySet<string>,
): boolean {
  const id: string = (userId || "").trim().toLowerCase();

  return Boolean(id) && !memberIds.has(id);
}

/*
 * Why Edit and End now (an update) or Cancel (a delete) is locked on an
 * override for the person: it names somebody who is not among the people
 * of their teams - or null, when it is not locked for this reason: they
 * are not limited, or who is in the teams is not known yet (the server
 * decides then).
 */
export function getOverrideTeamLock(data: {
  action: "update" | "delete";
  limit: OverrideTeamLimit | null;
  // The teams' accepted members, lower-cased user ids; null while not known.
  memberIds: ReadonlySet<string> | null;
  people: OverrideTeamPeople;
}): string | null {
  if (!data.limit || !data.memberIds) {
    return null;
  }

  if (
    !isOutside(data.people.awayUserId, data.memberIds) &&
    !isOutside(data.people.coverUserId, data.memberIds)
  ) {
    return null;
  }

  return data.action === "update"
    ? OVERRIDE_TEAM_EDIT_REFUSAL
    : OVERRIDE_TEAM_DELETE_REFUSAL;
}

/*
 * What the server would refuse a person picked as `role` with, before
 * anything is sent: somebody outside the teams' accepted members - or null
 * for nobody, somebody in them, or members not known yet.
 */
export function getOverrideTeamPersonRefusal(data: {
  role: "away" | "cover";
  limit: OverrideTeamLimit | null;
  memberIds: ReadonlySet<string> | null;
  userId: string | null | undefined;
}): string | null {
  if (
    !data.limit ||
    !data.memberIds ||
    !isOutside(data.userId, data.memberIds)
  ) {
    return null;
  }

  return data.role === "away"
    ? OVERRIDE_TEAM_AWAY_REFUSAL
    : OVERRIDE_TEAM_COVER_REFUSAL;
}

/*
 * The accepted members of `teamIds`, lower-cased user ids, from who is in
 * which team - or null while that is not known.
 */
export function getMemberIdsOfTeams(
  membersByTeam: ReadonlyMap<string, ReadonlySet<string>> | null,
  teamIds: ReadonlyArray<string>,
): ReadonlySet<string> | null {
  if (!membersByTeam) {
    return null;
  }

  const memberIds: Set<string> = new Set<string>();

  for (const teamId of teamIds) {
    for (const userId of membersByTeam.get(teamId.trim().toLowerCase()) || []) {
      memberIds.add(userId);
    }
  }

  return memberIds;
}

/*
 * The line above a picker's list kept to the teams, naming them as the
 * project calls them, listed as the Dashboard lists them in English - or
 * null with no team named.
 */
export function getOverrideTeamHint(
  teamNames: ReadonlyArray<string>,
): string | null {
  const names: Array<string> = teamNames.filter((name: string): boolean => {
    return Boolean(name && name.trim());
  });

  if (names.length === 0) {
    return null;
  }

  // A function, so a name with "$&" in it is written as it is.
  return OVERRIDE_TEAM_PICKER_HINT.replace("{{teams}}", (): string => {
    return names.join(", ");
  });
}
