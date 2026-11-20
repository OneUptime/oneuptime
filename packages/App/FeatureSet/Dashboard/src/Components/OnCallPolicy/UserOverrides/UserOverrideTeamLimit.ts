import OnCallDutyPolicyUserOverride from "Common/Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import { HeldPermissions, TeamGrants } from "Common/Types/HeldPermissions";
import UserOverrideTeamAccess, {
  USER_OVERRIDE_TEAM_AWAY_REFUSAL,
  USER_OVERRIDE_TEAM_DELETE_REFUSAL,
  USER_OVERRIDE_TEAM_EDIT_REFUSAL,
  USER_OVERRIDE_TEAM_PERMISSION,
  USER_OVERRIDE_TEAM_PICKER_HINT,
} from "Common/Types/OnCallDutyPolicy/UserOverrideTeamAccess";
import Permission from "Common/Types/Permission";
import { formatList } from "Common/Types/Translator";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import User from "Common/UI/Utils/User";

/*
 * USER OVERRIDES FOR THE PEOPLE OF ONE'S OWN TEAM, AS THE DASHBOARD SHOWS
 * THEM (issue #9733, Common/Types/OnCallDutyPolicy/UserOverrideTeamAccess).
 *
 * Someone whose permission to manage user overrides reaches the people of
 * the team that gives it - Manage On-Call Policy User Overrides for Own
 * Team - and nobody else, is refused by the server for any override that
 * names somebody outside those teams. So the dashboard:
 *
 *   - offers only those teams' people in "Who is away?" and "Who covers?",
 *     in the Add and Edit dialogs and in "Skip until...", with a line above
 *     each list saying why (getUserOverrideTeamHint), and says under the
 *     field what is wrong with a person it holds who is outside them;
 *   - locks Edit, End Now and Delete on an override that names somebody
 *     outside them, on the User Overrides pages and on a schedule's active
 *     overrides card, saying why (getUserOverrideTeamLock);
 *   - locks "Skip until..." beside somebody outside them on a schedule's
 *     layers, saying why (getUserOverrideTeamAwayLock, issue #9884).
 *
 * Read from the permission snapshot (PermissionGate), never guessed: on a
 * global override, only a grant over the whole project reaches anyone, so
 * the limit is the server's. On a policy, a grant that reaches everyone
 * but is narrowed to labels or owned policies may reach that policy, which
 * only the server can tell - there the pickers offer everyone, as before,
 * and the server decides on save. A picker never hides somebody the save
 * would let through, and a lock never locks what the server would allow.
 *
 * React-free, so its tests hand it the snapshot they mean.
 */

export type UserOverrideTeamAction =
  | ModelAction.Create
  | ModelAction.Update
  | ModelAction.Delete;

export interface UserOverrideTeamLimit {
  // The teams whose people the reader may name, lower-cased: none names nobody.
  teamIds: Array<string>;
}

export interface UserOverrideTeamLimitOptions {
  // The permission snapshot to read; the stored one when left out.
  held?: HeldPermissions | undefined;
  // The teams that give the reader the team permission; the stored ones when left out.
  grants?: TeamGrants | undefined;
}

// The table's permissions for an action.
const getActionPermissions: (
  action: UserOverrideTeamAction,
) => Array<Permission> = (
  action: UserOverrideTeamAction,
): Array<Permission> => {
  const model: OnCallDutyPolicyUserOverride =
    new OnCallDutyPolicyUserOverride();

  if (action === ModelAction.Create) {
    return model.getCreatePermissions() || [];
  }

  if (action === ModelAction.Update) {
    return model.getUpdatePermissions() || [];
  }

  return model.getDeletePermissions() || [];
};

/*
 * The teams whose people the reader may name in an override of `action` -
 * a global one, or one on a policy - or null when the reader is not
 * limited to any: a master admin, a permission that reaches everyone, no
 * team permission at all, or one on a policy that a narrowed permission
 * may reach (see above). A global override is reached only by the teams
 * whose grant reaches the whole project.
 */
export const getUserOverrideTeamLimit: (
  data: {
    action: UserOverrideTeamAction;
    isGlobal: boolean;
  } & UserOverrideTeamLimitOptions,
) => UserOverrideTeamLimit | null = (
  data: {
    action: UserOverrideTeamAction;
    isGlobal: boolean;
  } & UserOverrideTeamLimitOptions,
): UserOverrideTeamLimit | null => {
  if (User.isMasterAdmin()) {
    return null;
  }

  const held: HeldPermissions = PermissionGate.getHeldPermissions({
    held: data.held,
  });

  if (
    !UserOverrideTeamAccess.isLimitedToTeams({
      held: held,
      modelPermissions: getActionPermissions(data.action),
      isGlobal: data.isGlobal,
    })
  ) {
    return null;
  }

  const grants: TeamGrants =
    data.grants || PermissionGate.getTeamGrants(USER_OVERRIDE_TEAM_PERMISSION);

  return {
    teamIds: grants.teams
      .filter((grant: { isProjectWide: boolean }): boolean => {
        return !data.isGlobal || grant.isProjectWide;
      })
      .map((grant: { teamId: string }): string => {
        return grant.teamId;
      }),
  };
};

// The people an override names, by user id: none who covers for a skip.
export interface UserOverrideTeamPeople {
  awayUserId: string | null | undefined;
  coverUserId: string | null | undefined;
}

// Whether `userId` names somebody who is not among `memberIds`.
const isOutside: (
  userId: string | null | undefined,
  memberIds: ReadonlySet<string>,
) => boolean = (
  userId: string | null | undefined,
  memberIds: ReadonlySet<string>,
): boolean => {
  const id: string = (userId || "").trim().toLowerCase();

  return Boolean(id) && !memberIds.has(id);
};

/*
 * Why Edit (with End Now) or Delete is locked on an override for the
 * reader, in English for the shared components to translate: it names
 * somebody who is not among the people of their teams - or null, when it
 * is not locked for this reason: the reader is not limited, or who is in
 * the teams is not known yet (the server decides then).
 */
export const getUserOverrideTeamLock: (data: {
  action: ModelAction.Update | ModelAction.Delete;
  limit: UserOverrideTeamLimit | null;
  // The teams' accepted members, lower-cased user ids; null while not known.
  memberIds: ReadonlySet<string> | null;
  people: UserOverrideTeamPeople;
}) => string | null = (data: {
  action: ModelAction.Update | ModelAction.Delete;
  limit: UserOverrideTeamLimit | null;
  memberIds: ReadonlySet<string> | null;
  people: UserOverrideTeamPeople;
}): string | null => {
  if (!data.limit || !data.memberIds) {
    return null;
  }

  if (
    !isOutside(data.people.awayUserId, data.memberIds) &&
    !isOutside(data.people.coverUserId, data.memberIds)
  ) {
    return null;
  }

  return data.action === ModelAction.Update
    ? USER_OVERRIDE_TEAM_EDIT_REFUSAL
    : USER_OVERRIDE_TEAM_DELETE_REFUSAL;
};

/*
 * Why the reader may not add time away for `awayUserId` - "Skip until..."
 * beside them on a schedule's layers (issue #9884) - in English for the
 * shared components to translate: they are not among the people of the
 * reader's teams, so the server would refuse the skip with these words.
 * Null when it is not locked for this reason: the reader is not limited,
 * or who is in the teams is not known yet (the server decides then).
 */
export const getUserOverrideTeamAwayLock: (data: {
  // The reader's limit for adding an override (ModelAction.Create).
  limit: UserOverrideTeamLimit | null;
  // The teams' accepted members, lower-cased user ids; null while not known.
  memberIds: ReadonlySet<string> | null;
  awayUserId: string | null | undefined;
}) => string | null = (data: {
  limit: UserOverrideTeamLimit | null;
  memberIds: ReadonlySet<string> | null;
  awayUserId: string | null | undefined;
}): string | null => {
  if (!data.limit || !data.memberIds) {
    return null;
  }

  return isOutside(data.awayUserId, data.memberIds)
    ? USER_OVERRIDE_TEAM_AWAY_REFUSAL
    : null;
};

/*
 * The line above a picker's list saying why it offers whom it does, in
 * `translator`'s language: the teams by name, as the project calls them.
 * Null with no team named.
 */
export const getUserOverrideTeamHint: (data: {
  translator: Translator;
  teamNames: Array<string>;
}) => string | null = (data: {
  translator: Translator;
  teamNames: Array<string>;
}): string | null => {
  if (data.teamNames.length === 0) {
    return null;
  }

  return data.translator.translateTemplate(USER_OVERRIDE_TEAM_PICKER_HINT, {
    teams: formatList(data.teamNames, data.translator),
  });
};
