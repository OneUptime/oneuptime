import OneUptimeDate from "../Date";
import { translationKey } from "../Translator";

/*
 * WHAT AN EDIT OF A USER OVERRIDE MAY CHANGE (issue #7631).
 *
 * An override used to be fixed once saved: to change who covers, or to
 * end someone's time away early, it was deleted and added again - losing
 * the record of what it had been, and leaving a moment with no override at
 * all. Now its times and who covers can be changed, as far as that does
 * not rewrite what already happened:
 *
 *   - Who covers: any time until it ends - somebody else, or nobody (the
 *     next person in the rotation takes each turn), or somebody named for
 *     a skip. Never the person who is away.
 *   - When it starts: until it starts. Once it has started, its start is
 *     what happened: pages already went by it.
 *   - When it ends: until it ends - later, to extend it, or sooner, down
 *     to now, to end it now.
 *   - A moved time is never in the past: a start or an end before the
 *     current minute would say the override did, or did not, apply at a
 *     time that is over.
 *   - An override that has ended is history: nothing about it changes. A
 *     new one is added instead.
 *
 * Who is away, and which policy it is on (or none, for a global one), are
 * never changed: that would be another override, and is added as one.
 *
 * A time sent back as it is, to the minute, is no change: the dashboard's
 * pickers hold minutes (#7593), so an override saved to the second - from
 * the API, or before - comes back from its form at the start of its minute.
 *
 * Pure, so the server (OnCallDutyPolicyUserOverrideService) and the
 * dashboard's Edit dialog decide by one rule. The refusals are English,
 * marked as keys of the Dashboard's locales (its extractor reads this
 * file): the server says them in English, the dashboard in the reader's
 * language.
 */

export const USER_OVERRIDE_ENDED_REFUSAL: string = translationKey(
  "This override has already ended, so it can't be changed. Add a new override instead.",
);

export const USER_OVERRIDE_STARTED_REFUSAL: string = translationKey(
  "This override has already started, so when it starts can't be changed. You can still change when it ends, or who covers.",
);

export const USER_OVERRIDE_START_IN_PAST_REFUSAL: string = translationKey(
  "An override can't be moved to start in the past. Pick a start from now on.",
);

export const USER_OVERRIDE_END_IN_PAST_REFUSAL: string = translationKey(
  "An override can't be moved to end in the past. To end it now, pick the current time.",
);

// The override as it is saved.
export interface UserOverrideSavedTimes {
  startsAt: Date;
  endsAt: Date;
}

// What an edit sends: either time, or both, or neither.
export interface UserOverrideTimesChange {
  startsAt?: Date | undefined;
  endsAt?: Date | undefined;
}

export default class UserOverrideEdit {
  // Over: nothing about it may change.
  public static hasEnded(saved: UserOverrideSavedTimes, now: Date): boolean {
    return new Date(saved.endsAt).getTime() <= now.getTime();
  }

  // Under way, or over: when it starts is what happened.
  public static hasStarted(saved: UserOverrideSavedTimes, now: Date): boolean {
    return new Date(saved.startsAt).getTime() <= now.getTime();
  }

  // Two times in the same minute.
  public static isSameMinute(a: Date, b: Date): boolean {
    return (
      OneUptimeDate.getStartOfMinute(new Date(a)).getTime() ===
      OneUptimeDate.getStartOfMinute(new Date(b)).getTime()
    );
  }

  /*
   * The times `change` moves: each it sends that is not the saved one, to
   * the minute.
   */
  public static getMovedTimes(
    saved: UserOverrideSavedTimes,
    change: UserOverrideTimesChange,
  ): UserOverrideTimesChange {
    const moved: UserOverrideTimesChange = {};

    if (
      change.startsAt &&
      !UserOverrideEdit.isSameMinute(change.startsAt, saved.startsAt)
    ) {
      moved.startsAt = new Date(change.startsAt);
    }

    if (
      change.endsAt &&
      !UserOverrideEdit.isSameMinute(change.endsAt, saved.endsAt)
    ) {
      moved.endsAt = new Date(change.endsAt);
    }

    return moved;
  }

  /*
   * Why the change may not be made to the override as it is saved, at
   * `now` - or null when it may. Whether the new start comes before the new
   * end is asked with the override's other values, where the edit is
   * written.
   */
  public static getRefusal(data: {
    saved: UserOverrideSavedTimes;
    change: UserOverrideTimesChange;
    now: Date;
  }): string | null {
    if (UserOverrideEdit.hasEnded(data.saved, data.now)) {
      return USER_OVERRIDE_ENDED_REFUSAL;
    }

    const moved: UserOverrideTimesChange = UserOverrideEdit.getMovedTimes(
      data.saved,
      data.change,
    );

    // A time a picker can still choose: this minute, or later.
    const earliest: number = OneUptimeDate.getStartOfMinute(data.now).getTime();

    if (moved.startsAt) {
      if (UserOverrideEdit.hasStarted(data.saved, data.now)) {
        return USER_OVERRIDE_STARTED_REFUSAL;
      }

      if (moved.startsAt.getTime() < earliest) {
        return USER_OVERRIDE_START_IN_PAST_REFUSAL;
      }
    }

    if (moved.endsAt && moved.endsAt.getTime() < earliest) {
      return USER_OVERRIDE_END_IN_PAST_REFUSAL;
    }

    return null;
  }
}
