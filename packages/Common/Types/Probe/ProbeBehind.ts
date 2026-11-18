/*
 * WHETHER A PROBE IS BEHIND: ITS MONITORS ARE CHECKED LATER THAN THEIR
 * INTERVAL (OneUptime issue #9488).
 *
 * A probe that cannot keep up does not stop: it checks what it can, the
 * oldest first, and the rest wait. Every page went on saying its monitors
 * were checked every minute while each was checked every two. So once a
 * minute OneUptime reads, for every connected probe, how long its oldest
 * waiting check has waited past its check time (Workers' Probe:UpdateBehind,
 * by the claim's own rule of what may be checked), and keeps two times on
 * the probe:
 *
 *   - checksLateSince: the first reading of this spell that found a check
 *     waiting more than CHECK_LATE_AFTER_MS;
 *   - checksLastLateAt: the latest reading that found one.
 *
 * A probe is behind once checks have been found late at readings at least
 * BEHIND_AFTER_MS apart - a probe that has just restarted, or a monitor
 * created just after the probe last asked, waits one reading at most - and
 * stays behind until no check has been late for ON_TIME_AFTER_MS, so a
 * probe that keeps falling behind does not flicker between the two. Both
 * times are cleared then, and while the probe is not connected:
 * Disconnected says more.
 *
 * A probe that keeps up asks for monitors at least once a minute and is
 * handed every one that is due, so none waits a minute past its time. Pure,
 * so the job, the Dashboard, the Admin Dashboard and OneUptime Health read
 * the same rules.
 */

// A check that has waited this long past its check time is late.
export const CHECK_LATE_AFTER_MS: number = 60 * 1000;

/*
 * Late at readings this far apart: behind. A reading comes every minute,
 * give or take the few seconds a worker takes to pick its job up.
 */
export const BEHIND_AFTER_MS: number = 55 * 1000;

// No check late for this long: on time again.
export const ON_TIME_AFTER_MS: number = 2 * 60 * 1000;

// What OneUptime keeps on the probe.
export interface ProbeLateChecks {
  checksLateSince: Date | null;
  checksLastLateAt: Date | null;
}

// The same, as a page or the API reads it: dates, or their strings.
export interface ProbeLateChecksRead {
  checksLateSince?: Date | string | null | undefined;
  checksLastLateAt?: Date | string | null | undefined;
}

const toDate: (value: Date | string | null | undefined) => Date | null = (
  value: Date | string | null | undefined,
): Date | null => {
  if (!value) {
    return null;
  }

  const date: Date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
};

export default class ProbeBehindUtil {
  /*
   * Whether a reading finds a late check: the oldest check waiting for the
   * probe was due more than CHECK_LATE_AFTER_MS before `now`. Null: no
   * check waits.
   */
  public static isCheckLate(data: {
    oldestDueAt: Date | string | null | undefined;
    now: Date;
  }): boolean {
    const oldestDueAt: Date | null = toDate(data.oldestDueAt);

    if (!oldestDueAt) {
      return false;
    }

    return data.now.getTime() - oldestDueAt.getTime() > CHECK_LATE_AFTER_MS;
  }

  // What to keep after a reading at `now` that found a late check or none.
  public static next(data: {
    state: ProbeLateChecksRead;
    isLate: boolean;
    now: Date;
  }): ProbeLateChecks {
    const lateSince: Date | null = toDate(data.state.checksLateSince);
    const lastLateAt: Date | null = toDate(data.state.checksLastLateAt);

    if (data.isLate) {
      return {
        checksLateSince: lateSince || data.now,
        checksLastLateAt: data.now,
      };
    }

    // On time, but not yet for long enough: the spell goes on.
    if (
      lateSince &&
      lastLateAt &&
      data.now.getTime() - lastLateAt.getTime() < ON_TIME_AFTER_MS
    ) {
      return { checksLateSince: lateSince, checksLastLateAt: lastLateAt };
    }

    return { checksLateSince: null, checksLastLateAt: null };
  }

  // What to keep for a probe that is not connected: nothing.
  public static cleared(): ProbeLateChecks {
    return { checksLateSince: null, checksLastLateAt: null };
  }

  // Whether two states differ, so the job writes only what changed.
  public static hasChanged(
    before: ProbeLateChecksRead,
    after: ProbeLateChecks,
  ): boolean {
    const same: (
      a: Date | string | null | undefined,
      b: Date | null,
    ) => boolean = (
      a: Date | string | null | undefined,
      b: Date | null,
    ): boolean => {
      return (toDate(a)?.getTime() ?? null) === (b?.getTime() ?? null);
    };

    return !(
      same(before.checksLateSince, after.checksLateSince) &&
      same(before.checksLastLateAt, after.checksLastLateAt)
    );
  }

  /*
   * Since when the probe is behind, or null when it is not: checks found
   * late at readings at least BEHIND_AFTER_MS apart. Read from what is kept
   * alone, never a clock, so a browser and the server agree.
   */
  public static getBehindSince(state: ProbeLateChecksRead): Date | null {
    const lateSince: Date | null = toDate(state.checksLateSince);
    const lastLateAt: Date | null = toDate(state.checksLastLateAt);

    if (!lateSince || !lastLateAt) {
      return null;
    }

    return lastLateAt.getTime() - lateSince.getTime() >= BEHIND_AFTER_MS
      ? lateSince
      : null;
  }

  public static isBehind(state: ProbeLateChecksRead): boolean {
    return ProbeBehindUtil.getBehindSince(state) !== null;
  }
}
