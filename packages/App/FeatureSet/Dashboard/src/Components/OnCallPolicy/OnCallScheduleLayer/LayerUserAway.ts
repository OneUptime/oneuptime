import UserOverrideUtil, {
  UserOverrideRecord,
} from "Common/Types/OnCallDutyPolicy/UserOverrideUtil";

/*
 * WHETHER SOMEBODY IN A LAYER IS AWAY - NOW, OR SOON.
 *
 * A person's row in a schedule layer says when they are away, so whoever
 * reads the rotation knows before they read the calendar why somebody else
 * has their turn: "Away until Fri, Mar 6, 12:00 PM" while a user override is
 * in force for them, "Away from Mon, Mar 9, 9:00 AM" when one is booked.
 *
 * React-free, so the rule is tested on its own.
 */

export interface LayerUserAway {
  startsAt: Date;
  endsAt: Date;
  // In force now; otherwise the next one booked.
  isNow: boolean;
  // Nobody named to cover: their turns go to the next person in the rotation.
  isSkip: boolean;
  // Who covers, when somebody is named.
  coverUserId: string | null;
}

/*
 * The override that decides for the person now - by the precedence the
 * schedules use (UserOverrideUtil.getPrecedence), the one ending last among
 * equals - or, when none is in force, the next one to start. Null when the
 * person has none in force or to come. `overrides` are the ones that apply
 * to the schedule (useScheduleUserOverrides).
 */
export function getLayerUserAway(data: {
  userId: string;
  overrides: Array<UserOverrideRecord>;
  now: Date;
}): LayerUserAway | null {
  const now: number = data.now.getTime();

  const theirs: Array<UserOverrideRecord> = data.overrides.filter(
    (record: UserOverrideRecord) => {
      return (
        record.overrideUserId === data.userId &&
        record.endsAt.getTime() > now &&
        record.endsAt.getTime() > record.startsAt.getTime()
      );
    },
  );

  const inForce: Array<UserOverrideRecord> = theirs
    .filter((record: UserOverrideRecord) => {
      return record.startsAt.getTime() <= now;
    })
    .sort((a: UserOverrideRecord, b: UserOverrideRecord) => {
      return (
        UserOverrideUtil.getPrecedence(a) - UserOverrideUtil.getPrecedence(b) ||
        b.endsAt.getTime() - a.endsAt.getTime()
      );
    });

  if (inForce.length > 0) {
    return toAway(inForce[0]!, true);
  }

  const upcoming: Array<UserOverrideRecord> = theirs.sort(
    (a: UserOverrideRecord, b: UserOverrideRecord) => {
      return a.startsAt.getTime() - b.startsAt.getTime();
    },
  );

  return upcoming.length > 0 ? toAway(upcoming[0]!, false) : null;
}

/*
 * True when every person of a layer is away right now - the layer has
 * nobody to put on call, so the layers below it decide.
 */
export function isEveryoneInLayerAway(data: {
  userIds: Array<string>;
  overrides: Array<UserOverrideRecord>;
  now: Date;
}): boolean {
  if (data.userIds.length === 0) {
    return false;
  }

  return data.userIds.every((userId: string) => {
    return (
      getLayerUserAway({
        userId,
        overrides: data.overrides,
        now: data.now,
      })?.isNow === true
    );
  });
}

function toAway(record: UserOverrideRecord, isNow: boolean): LayerUserAway {
  return {
    startsAt: record.startsAt,
    endsAt: record.endsAt,
    isNow,
    isSkip: UserOverrideUtil.isSkip(record),
    coverUserId: record.routeAlertsToUserId || null,
  };
}
