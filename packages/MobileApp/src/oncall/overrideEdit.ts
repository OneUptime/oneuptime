/*
 * WHAT AN EDIT OF A USER OVERRIDE MAY CHANGE, AS THE APP HOLDS IT (#7897).
 *
 * The app's copy of the server's rule (Common/Types/OnCallDutyPolicy/
 * UserOverrideEdit), because the app imports nothing from Common at run
 * time; overrideEdit.test.ts holds it to Common's case for case, and its
 * refusals to Common's word for word, so a change on either side fails
 * there. The phone checks an edit with it before anything is sent, and the
 * server checks it again (PUT /api/on-call-duty-policy-user-override/:id):
 *
 *   - Who covers: any time until it ends - somebody else, or nobody (the
 *     next person in the rotation takes each turn). Never the person away.
 *   - When it starts: until it starts, never to the past.
 *   - When it ends: until it ends, down to now. End Now ends it at the
 *     server's own now (POST .../:id/end-now).
 *   - Who is away, and its policy, never change.
 *   - An override that has ended is history.
 *
 * A time sent back as it is, to the minute, is no change.
 */

export const OVERRIDE_ENDED_REFUSAL: string =
  "This override has already ended, so it can't be changed. Add a new override instead.";

export const OVERRIDE_STARTED_REFUSAL: string =
  "This override has already started, so when it starts can't be changed. You can still change when it ends, or who covers.";

export const OVERRIDE_START_IN_PAST_REFUSAL: string =
  "An override can't be moved to start in the past. Pick a start from now on.";

export const OVERRIDE_END_IN_PAST_REFUSAL: string =
  "An override can't be moved to end in the past. To end it now, pick the current time.";

export const OVERRIDE_END_NOW_NOT_STARTED_REFUSAL: string =
  "This override hasn't started yet, so there is nothing to end. To call it off, delete it.";

export const OVERRIDE_END_NOW_ENDS_THIS_MINUTE_REFUSAL: string =
  "This override ends within the minute, so there is nothing left to end.";

// The server's own words for times out of order (OnCallDutyPolicyUserOverrideService).
export const OVERRIDE_ENDS_BEFORE_START_REFUSAL: string =
  "An override has to end after it starts. Pick an end time later than its start time.";

/*
 * What the server's refusal of an overlap ends with
 * (UserOverrideOverlap.USER_OVERRIDE_CONFLICT_WHAT_TO_DO): the app offers
 * to edit that override instead.
 */
export const OVERRIDE_CONFLICT_WHAT_TO_DO: string =
  "Change the times, or edit that override.";

// The override as it is saved.
export interface OverrideSavedTimes {
  startsAt: Date;
  endsAt: Date;
}

// What an edit sends: either time, or both, or neither.
export interface OverrideTimesChange {
  startsAt?: Date | undefined;
  endsAt?: Date | undefined;
}

const MINUTE_MS: number = 60 * 1000;

export function getStartOfMinute(date: Date): Date {
  return new Date(Math.floor(new Date(date).getTime() / MINUTE_MS) * MINUTE_MS);
}

// Over: nothing about it may change.
export function hasEnded(saved: OverrideSavedTimes, now: Date): boolean {
  return new Date(saved.endsAt).getTime() <= now.getTime();
}

// Under way, or over: when it starts is what happened.
export function hasStarted(saved: OverrideSavedTimes, now: Date): boolean {
  return new Date(saved.startsAt).getTime() <= now.getTime();
}

// Started, and not ended yet: in force right now.
export function isUnderWay(saved: OverrideSavedTimes, now: Date): boolean {
  return hasStarted(saved, now) && !hasEnded(saved, now);
}

// Two times in the same minute.
export function isSameMinute(a: Date, b: Date): boolean {
  return getStartOfMinute(a).getTime() === getStartOfMinute(b).getTime();
}

// The times `change` moves: each it sends that is not the saved one, to the minute.
export function getMovedTimes(
  saved: OverrideSavedTimes,
  change: OverrideTimesChange,
): OverrideTimesChange {
  const moved: OverrideTimesChange = {};

  if (change.startsAt && !isSameMinute(change.startsAt, saved.startsAt)) {
    moved.startsAt = new Date(change.startsAt);
  }

  if (change.endsAt && !isSameMinute(change.endsAt, saved.endsAt)) {
    moved.endsAt = new Date(change.endsAt);
  }

  return moved;
}

/*
 * Why `change` may not be made to the override as it is saved, at `now` -
 * or null when it may, as the server decides it (UserOverrideEdit.
 * getRefusal), then whether the times it leaves come in order.
 */
export function getEditRefusal(data: {
  saved: OverrideSavedTimes;
  change: OverrideTimesChange;
  now: Date;
}): string | null {
  if (hasEnded(data.saved, data.now)) {
    return OVERRIDE_ENDED_REFUSAL;
  }

  const moved: OverrideTimesChange = getMovedTimes(data.saved, data.change);

  // A time a picker can still choose: this minute, or later.
  const earliest: number = getStartOfMinute(data.now).getTime();

  if (moved.startsAt) {
    if (hasStarted(data.saved, data.now)) {
      return OVERRIDE_STARTED_REFUSAL;
    }

    if (moved.startsAt.getTime() < earliest) {
      return OVERRIDE_START_IN_PAST_REFUSAL;
    }
  }

  if (moved.endsAt && moved.endsAt.getTime() < earliest) {
    return OVERRIDE_END_IN_PAST_REFUSAL;
  }

  // With the time the edit leaves as it is, as the server holds it.
  const startsAt: Date = data.change.startsAt || data.saved.startsAt;
  const endsAt: Date = data.change.endsAt || data.saved.endsAt;

  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return OVERRIDE_ENDS_BEFORE_START_REFUSAL;
  }

  return null;
}

/*
 * Why End Now has nothing to do for the override as it is saved, at `now`,
 * or null when it does (UserOverrideEdit.getEndNowRefusal).
 */
export function getEndNowRefusal(
  saved: OverrideSavedTimes,
  now: Date,
): string | null {
  if (hasEnded(saved, now)) {
    return OVERRIDE_ENDED_REFUSAL;
  }

  if (!hasStarted(saved, now)) {
    return OVERRIDE_END_NOW_NOT_STARTED_REFUSAL;
  }

  if (isSameMinute(saved.endsAt, now)) {
    return OVERRIDE_END_NOW_ENDS_THIS_MINUTE_REFUSAL;
  }

  return null;
}

/*
 * The end End Now gives an override under way, as the server works it out
 * (UserOverrideEdit.getEndNow): the start of this minute, or now itself for
 * one that started in it. Only an older server, without End Now, is sent
 * it, from the phone's clock.
 */
export function getEndNow(saved: OverrideSavedTimes, now: Date): Date | null {
  if (getEndNowRefusal(saved, now)) {
    return null;
  }

  const minute: Date = getStartOfMinute(now);

  if (minute.getTime() > new Date(saved.startsAt).getTime()) {
    return minute;
  }

  return new Date(now);
}

// Whether the server refused an add or an edit for an overlap: it ends with what to do.
export function isOverlapRefusal(message: string): boolean {
  return message.indexOf(OVERRIDE_CONFLICT_WHAT_TO_DO) !== -1;
}

// An override as the conflict it may be is weighed (UserOverrideOverlap).
export interface OverrideScopeTimes {
  id?: string | null | undefined;
  overrideUserId: string;
  routeAlertsToUserId?: string | null | undefined;
  onCallDutyPolicyId?: string | null | undefined;
  startsAt: Date;
  endsAt: Date;
  createdAt?: Date | null | undefined;
}

const sameId: (
  a: string | null | undefined,
  b: string | null | undefined,
) => boolean = (
  a: string | null | undefined,
  b: string | null | undefined,
): boolean => {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
};

// Both on the same policy, or both global.
function isSameScope(a: OverrideScopeTimes, b: OverrideScopeTimes): boolean {
  if (!a.onCallDutyPolicyId || !b.onCallDutyPolicyId) {
    return !a.onCallDutyPolicyId && !b.onCallDutyPolicyId;
  }

  return sameId(a.onCallDutyPolicyId, b.onCallDutyPolicyId);
}

// A policy's own over a global one; one that names who covers over a skip.
function getPrecedence(override: OverrideScopeTimes): number {
  return (
    (override.onCallDutyPolicyId ? 0 : 2) +
    (override.routeAlertsToUserId ? 0 : 1)
  );
}

// Of two that overlap, which decides while both apply (UserOverrideOverlap.compareUse).
function compareUse(a: OverrideScopeTimes, b: OverrideScopeTimes): number {
  return (
    getPrecedence(a) - getPrecedence(b) ||
    new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime() ||
    (a.createdAt ? new Date(a.createdAt).getTime() : 0) -
      (b.createdAt ? new Date(b.createdAt).getTime() : 0) ||
    (a.id || "").toLowerCase().localeCompare((b.id || "").toLowerCase())
  );
}

/*
 * The override among `others` the server names when it refuses `candidate`
 * for an overlap: another of the same person, in the same scope, at the same
 * time - the one used first where they overlap. Null when none is.
 */
export function pickConflict<T extends OverrideScopeTimes>(
  candidate: OverrideScopeTimes,
  others: Array<T>,
): T | null {
  const conflicts: Array<T> = others.filter((other: T): boolean => {
    return (
      !sameId(candidate.id, other.id) &&
      sameId(candidate.overrideUserId, other.overrideUserId) &&
      isSameScope(candidate, other) &&
      new Date(candidate.startsAt).getTime() <
        new Date(other.endsAt).getTime() &&
      new Date(other.startsAt).getTime() < new Date(candidate.endsAt).getTime()
    );
  });

  return conflicts.sort(compareUse)[0] || null;
}
