import CalendarEvent from "../Calendar/CalendarEvent";
import ScheduleShiftUtil, { TimelineShift } from "./ScheduleShiftUtil";

/*
 * A SCHEDULE'S ROSTER: WHO IS ON CALL NOW, SINCE AND UNTIL WHEN, AND WHO IS
 * NEXT - READ FROM THE SHIFTS THE SCHEDULE TIMELINE SHOWS (#11268, #11270).
 *
 * The roster is what every place that states somebody's on-call shift
 * reads (OnCallDutyPolicySchedule's rosterStartAt, rosterHandoffAt,
 * nextUserIdOnRoster, rosterNextStartAt, rosterNextHandoffAt): the "You are
 * now on-call" email and the others of a hand-off, the mobile app's on-call
 * tab, Slack's and Microsoft Teams' on-call answers, the AI's on-call
 * tools and the schedules list. It used to be the first two of the
 * engine's raw segments, and the engine splits a window of active hours
 * that runs past midnight there: a 17:00 to 07:00 shift was stated as
 * ending at 11:59 PM, while the timeline - which folds the segments into
 * shifts - showed 07:00 the next morning. Both now read the same shifts
 * (ScheduleShiftUtil.getTimelineShifts), in every time zone and across
 * daylight saving time, as the engine resolves the windows on the
 * schedule's own clock.
 *
 * A turn of a layer with active hours is several shifts: one person's
 * windows in one rotation turn (or one override's), with nobody else on
 * call between them. The roster says which turn each shift is part of
 * (turnKey) and when the turn's last window ends (turnEndsAt), and keeps
 * the turn it is in across the hours between its windows (getRosterTurnKey):
 * a person is told they are on call when their turn starts, not again at
 * every window of it, and that they are no longer on call when it ends, not
 * every morning (#11270). Their on-call time logs still start and end with
 * each window: those are the record of when they were on call.
 */

export interface RosterShift {
  userId: string;
  start: Date;
  end: Date;
  // The rotation turn the shift is part of (TimelineShift.turnKey).
  turnKey: string;
  /*
   * When the turn's last window ends, when more windows of it follow this
   * shift with nobody else on call between them; null when this shift is
   * the turn's last, or the windows run past what was resolved.
   */
  turnEndsAt: Date | null;
}

export interface ScheduleRosterState {
  // The shift on call at `now`, if anyone is.
  current: RosterShift | null;
  // The next shift after it, or after `now` when nobody is on call.
  next: RosterShift | null;
}

export default class ScheduleRoster {
  /*
   * The roster at `now`, from the resolved segments of a window that holds
   * it: starting at least a rotation period earlier, so the shift on call is
   * not cut at its start, and ending far enough ahead to hold the next one.
   * A shift that reaches `windowEnd` may go on past it: its end is the
   * window's, and the turn it is part of is not said to end.
   */
  public static getRoster(data: {
    segments: Array<CalendarEvent>;
    now: Date;
    windowEnd?: Date | undefined;
  }): ScheduleRosterState {
    const shifts: Array<TimelineShift> = ScheduleShiftUtil.getTimelineShifts(
      data.segments,
    );

    const now: number = data.now.getTime();

    const currentIndex: number = shifts.findIndex(
      (shift: TimelineShift): boolean => {
        return shift.start.getTime() <= now && shift.end.getTime() > now;
      },
    );

    const from: number =
      currentIndex >= 0 ? shifts[currentIndex]!.end.getTime() : now;

    const nextIndex: number = shifts.findIndex(
      (shift: TimelineShift, index: number): boolean => {
        if (index === currentIndex) {
          return false;
        }

        return currentIndex >= 0
          ? index > currentIndex && shift.start.getTime() >= from
          : shift.start.getTime() > from;
      },
    );

    return {
      current:
        currentIndex >= 0
          ? ScheduleRoster.toRosterShift(shifts, currentIndex, data.windowEnd)
          : null,
      next:
        nextIndex >= 0
          ? ScheduleRoster.toRosterShift(shifts, nextIndex, data.windowEnd)
          : null,
    };
  }

  /*
   * THE TURN THE ROSTER IS IN, AS STORED (OnCallDutyPolicySchedule
   * .rosterTurnKey).
   *
   *   - somebody on call: the turn of their shift;
   *   - nobody on call, between two windows of the turn it was in - the
   *     next shift is of that turn: still that turn;
   *   - nobody on call otherwise: none.
   *
   * It is kept only while it holds: a change made between two windows - a
   * layer edited, an override, someone else's turn coming first - makes the
   * next shift another turn's, and the turn kept is dropped, so whoever's
   * shift comes next is told as at any start of a turn. A turn never stored,
   * as before this was kept, is none: everyone is told as before.
   */
  public static getRosterTurnKey(data: {
    previousTurnKey: string | null | undefined;
    current: Pick<RosterShift, "turnKey"> | null | undefined;
    next: Pick<RosterShift, "turnKey"> | null | undefined;
  }): string | null {
    if (data.current) {
      return data.current.turnKey || null;
    }

    if (
      data.previousTurnKey &&
      data.next &&
      data.next.turnKey === data.previousTurnKey
    ) {
      return data.previousTurnKey;
    }

    return null;
  }

  /*
   * Whether the person on call now is resuming the turn they were on call
   * for before a window of its active hours closed: nobody was on call
   * since, and the turn kept between its windows is theirs. Then they are
   * not told "You are now on-call" again (#11270).
   */
  public static isTurnResuming(data: {
    previousUserId: string | null | undefined;
    previousTurnKey: string | null | undefined;
    current: Pick<RosterShift, "turnKey"> | null | undefined;
  }): boolean {
    return Boolean(
      !data.previousUserId &&
        data.previousTurnKey &&
        data.current &&
        data.current.turnKey === data.previousTurnKey,
    );
  }

  /*
   * Whether the person who was on call is only between two windows of
   * their turn: nobody is on call now, and the next shift is of the turn
   * theirs was. Then they are not told "You are no longer on-call" (#11270).
   */
  public static isTurnPausing(data: {
    previousUserId: string | null | undefined;
    previousTurnKey: string | null | undefined;
    current: Pick<RosterShift, "turnKey"> | null | undefined;
    next: Pick<RosterShift, "turnKey"> | null | undefined;
  }): boolean {
    return Boolean(
      data.previousUserId &&
        data.previousTurnKey &&
        !data.current &&
        data.next &&
        data.next.turnKey === data.previousTurnKey,
    );
  }

  private static toRosterShift(
    shifts: Array<TimelineShift>,
    index: number,
    windowEnd: Date | undefined,
  ): RosterShift {
    const shift: TimelineShift = shifts[index]!;

    // The shifts after it of the same turn, with nobody else's between.
    let last: number = index;

    while (
      last + 1 < shifts.length &&
      shifts[last + 1]!.turnKey === shift.turnKey
    ) {
      last++;
    }

    const turnEnd: Date = shifts[last]!.end;
    const runsPastWindow: boolean = Boolean(
      windowEnd && turnEnd.getTime() >= windowEnd.getTime(),
    );

    return {
      userId: shift.userId,
      start: shift.start,
      end: shift.end,
      turnKey: shift.turnKey,
      turnEndsAt: last > index && !runsPastWindow ? turnEnd : null,
    };
  }
}
