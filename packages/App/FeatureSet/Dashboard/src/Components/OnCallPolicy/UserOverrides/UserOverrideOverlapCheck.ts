import OneUptimeDate from "Common/Types/Date";
import UserOverrideEdit, {
  UserOverrideSavedTimes,
} from "Common/Types/OnCallDutyPolicy/UserOverrideEdit";
import UserOverrideOverlap, {
  UserOverrideTimes,
} from "Common/Types/OnCallDutyPolicy/UserOverrideOverlap";
import {
  USER_OVERRIDE_ENDS_KEY,
  USER_OVERRIDE_STARTS_KEY,
  readUserOverridePeople,
  toUserOverrideTime,
} from "./UserOverrideForm";

/*
 * WHAT THE TIMES PICKED IN AN OVERRIDE'S DIALOG WOULD OVERLAP (issue #7630).
 *
 * The server refuses an override - added, or with its times moved - that
 * overlaps another override of the same person in the same scope (both on
 * one policy, or both global), naming the one it overlaps
 * (UserOverrideOverlap). The Add and Edit dialog says so as soon as who is
 * away and both times are picked, with a way to edit that override instead
 * (UserOverrideOverlapNotice), and holds the form back while it is so: the
 * server would refuse it.
 *
 * What it asks about is the override the form would save: the person away,
 * the scope it is added in - or the edited one's own - who covers, and the
 * times, to the minute the pickers hold. An edit that leaves both times as
 * they are saved asks nothing, as the server asks nothing of it: changing
 * who covers in an override that overlaps another, saved before the rule,
 * is allowed.
 *
 * React-free, so its tests read it without a page.
 */

// The dialog's override: one being added in a scope, or one being edited.
export interface UserOverrideDialogTarget {
  // The override being edited; none for an add.
  id?: string | null | undefined;
  // Its policy, or the page's for an add: null for a global one.
  onCallDutyPolicyId: string | null;
  // An edit's times as they are saved.
  saved?: UserOverrideSavedTimes | undefined;
}

/*
 * The override the form's values would save, to ask what it overlaps - or
 * null while that cannot be asked: who is away or a time not picked yet,
 * the times out of order (Ends says so), or an edit that moves neither.
 */
export const getUserOverrideOverlapCandidate: (data: {
  values: unknown;
  target: UserOverrideDialogTarget;
}) => UserOverrideTimes | null = (data: {
  values: unknown;
  target: UserOverrideDialogTarget;
}): UserOverrideTimes | null => {
  const record: Record<string, unknown> =
    data.values && typeof data.values === "object"
      ? (data.values as Record<string, unknown>)
      : {};
  const people: {
    awayUserId: string | null;
    coverUserId: string | null;
  } = readUserOverridePeople(record);
  const startsAt: Date | null = toUserOverrideTime(
    record[USER_OVERRIDE_STARTS_KEY],
  );
  const endsAt: Date | null = toUserOverrideTime(
    record[USER_OVERRIDE_ENDS_KEY],
  );

  if (!people.awayUserId || !startsAt || !endsAt) {
    return null;
  }

  if (endsAt.getTime() <= startsAt.getTime()) {
    return null;
  }

  if (
    data.target.saved &&
    Object.keys(
      UserOverrideEdit.getMovedTimes(data.target.saved, {
        startsAt: startsAt,
        endsAt: endsAt,
      }),
    ).length === 0
  ) {
    return null;
  }

  return {
    id: data.target.id || null,
    overrideUserId: people.awayUserId,
    onCallDutyPolicyId: data.target.onCallDutyPolicyId || null,
    routeAlertsToUserId: people.coverUserId,
    startsAt: startsAt,
    endsAt: endsAt,
  };
};

/*
 * One key per question: the same override, person, scope and minutes ask
 * the same thing, whoever covers.
 */
export const getUserOverrideOverlapKey: (
  candidate: UserOverrideTimes,
) => string = (candidate: UserOverrideTimes): string => {
  return [
    (candidate.id || "").toLowerCase(),
    candidate.overrideUserId.toLowerCase(),
    (candidate.onCallDutyPolicyId || "").toLowerCase(),
    OneUptimeDate.getStartOfMinute(new Date(candidate.startsAt)).getTime(),
    OneUptimeDate.getStartOfMinute(new Date(candidate.endsAt)).getTime(),
  ].join("|");
};

// What a candidate overlaps, of the overrides read for it.
export interface UserOverrideOverlapAnswer<T extends UserOverrideTimes> {
  // The same person's, in its scope, that keep it from being saved: the one used first, first.
  conflicts: Array<T>;
  // The same person's, of the other scope, that the rule allows, earliest first.
  otherScope: Array<T>;
}

export const getUserOverrideOverlapAnswer: <T extends UserOverrideTimes>(
  candidate: UserOverrideTimes,
  overrides: Array<T>,
) => UserOverrideOverlapAnswer<T> = <T extends UserOverrideTimes>(
  candidate: UserOverrideTimes,
  overrides: Array<T>,
): UserOverrideOverlapAnswer<T> => {
  return {
    conflicts: UserOverrideOverlap.getConflicts(candidate, overrides),
    otherScope: UserOverrideOverlap.getOtherScopeOverlaps(candidate, overrides),
  };
};
