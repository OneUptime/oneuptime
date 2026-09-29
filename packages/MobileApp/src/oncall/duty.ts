import type {
  OnCallAssignmentItem,
  OnCallShift,
  ProjectOnCallAssignments,
  ProjectOnCallScheduleItem,
} from "../api/types";

/*
 * The on-call model the screens render from.
 *
 * All of it is pure, and all of it takes `now` as an argument, because the
 * only thing the on-call tab is really for is answering three questions
 * correctly at a glance:
 *
 *   - am I on call right this second?
 *   - when do I get to stop?
 *   - when does it start again?
 *
 * Two DIFFERENT things make somebody on call in OneUptime and they behave
 * nothing alike, which is why they are counted separately below:
 *
 *   - a SCHEDULE puts you on for a window, and the window has an end. That is
 *     a shift, and it is what a countdown can be drawn from.
 *   - a DIRECT or TEAM assignment on an escalation rule has no window at all.
 *     You are on it permanently. A countdown there would be a lie, so the UI
 *     has to say "standing assignment" instead of inventing a handoff.
 *
 * Conflating the two is how an on-call app ends up telling someone their shift
 * ends at 6pm when nothing of the sort is true.
 */

export interface OnCallDutySummary {
  /* On call by either route - a live shift, or a standing assignment. */
  isOnCall: boolean;

  /* Shifts that have started and not yet handed off. */
  activeShifts: OnCallShift[];

  /* Shifts this user is next up for. */
  upcomingShifts: OnCallShift[];

  /* Earliest handoff among the active shifts, or null when none is known. */
  nextHandoffAt: string | null;

  /* Earliest start among the upcoming shifts. */
  nextShiftStartsAt: string | null;

  /*
   * Escalation rules that name this user (or a team they are in) directly.
   * These have no end - see the note above.
   */
  standingAssignmentCount: number;

  /* Escalation rules that reach this user through a schedule. */
  scheduleAssignmentCount: number;
}

function sameUser(
  candidate: { _id: string } | null,
  userId: string | null,
): boolean {
  if (!candidate || !userId) {
    return false;
  }

  return candidate._id === userId;
}

function earliest(values: Array<string | null>): string | null {
  let best: string | null = null;
  let bestTime: number = Number.POSITIVE_INFINITY;

  values.forEach((value: string | null) => {
    if (!value) {
      return;
    }

    const time: number = new Date(value).getTime();

    if (!Number.isFinite(time) || time >= bestTime) {
      return;
    }

    best = value;
    bestTime = time;
  });

  return best;
}

/**
 * Every shift the given user holds across every project, derived from the
 * persisted roster on each schedule.
 *
 * A schedule can produce BOTH an active and an upcoming shift for the same
 * person - back-to-back rotations are normal, and a responder who is on now
 * and on again next week needs to see both, not the first one the loop found.
 */
export function toShiftsForUser(
  projectSchedules: ProjectOnCallScheduleItem[],
  userId: string | null,
): OnCallShift[] {
  if (!userId) {
    return [];
  }

  const shifts: OnCallShift[] = [];

  projectSchedules.forEach((entry: ProjectOnCallScheduleItem) => {
    const schedule: ProjectOnCallScheduleItem["item"] = entry.item;

    if (sameUser(schedule.currentUserOnRoster, userId)) {
      shifts.push({
        scheduleId: schedule._id,
        scheduleName: schedule.name,
        projectId: entry.projectId,
        projectName: entry.projectName,
        status: "active",
        startsAt: schedule.rosterStartAt,
        endsAt: schedule.rosterHandoffAt,
      });
    }

    if (sameUser(schedule.nextUserOnRoster, userId)) {
      shifts.push({
        scheduleId: schedule._id,
        scheduleName: schedule.name,
        projectId: entry.projectId,
        projectName: entry.projectName,
        status: "upcoming",
        startsAt: schedule.rosterNextStartAt,
        endsAt: schedule.rosterNextHandoffAt,
      });
    }
  });

  return shifts;
}

function countAssignments(
  projects: ProjectOnCallAssignments[],
  predicate: (assignment: OnCallAssignmentItem) => boolean,
): number {
  return projects.reduce((total: number, project: ProjectOnCallAssignments) => {
    return (
      total +
      project.assignments.filter((assignment: OnCallAssignmentItem) => {
        return predicate(assignment);
      }).length
    );
  }, 0);
}

/**
 * Fold the shifts and the escalation-rule assignments into the single object
 * the status card renders.
 *
 * Shifts are sorted by the boundary the reader cares about: active shifts by
 * the soonest handoff (the one you are counting down to), upcoming shifts by
 * the soonest start. A shift with no known boundary sorts last rather than
 * first - an unknown handoff is not an imminent one.
 */
export function summarizeDuty(input: {
  shifts: OnCallShift[];
  assignmentsByProject: ProjectOnCallAssignments[];
}): OnCallDutySummary {
  const activeShifts: OnCallShift[] = input.shifts
    .filter((shift: OnCallShift) => {
      return shift.status === "active";
    })
    .sort(byBoundary("endsAt"));

  const upcomingShifts: OnCallShift[] = input.shifts
    .filter((shift: OnCallShift) => {
      return shift.status === "upcoming";
    })
    .sort(byBoundary("startsAt"));

  const standingAssignmentCount: number = countAssignments(
    input.assignmentsByProject,
    (assignment: OnCallAssignmentItem) => {
      return (
        assignment.assignmentType === "user" ||
        assignment.assignmentType === "team"
      );
    },
  );

  const scheduleAssignmentCount: number = countAssignments(
    input.assignmentsByProject,
    (assignment: OnCallAssignmentItem) => {
      return assignment.assignmentType === "schedule";
    },
  );

  return {
    isOnCall:
      activeShifts.length > 0 ||
      standingAssignmentCount > 0 ||
      scheduleAssignmentCount > 0,
    activeShifts,
    upcomingShifts,
    nextHandoffAt: earliest(
      activeShifts.map((shift: OnCallShift) => {
        return shift.endsAt;
      }),
    ),
    nextShiftStartsAt: earliest(
      upcomingShifts.map((shift: OnCallShift) => {
        return shift.startsAt;
      }),
    ),
    standingAssignmentCount,
    scheduleAssignmentCount,
  };
}

function byBoundary(
  field: "startsAt" | "endsAt",
): (a: OnCallShift, b: OnCallShift) => number {
  return (a: OnCallShift, b: OnCallShift): number => {
    const aTime: number = a[field]
      ? new Date(a[field] as string).getTime()
      : Number.POSITIVE_INFINITY;
    const bTime: number = b[field]
      ? new Date(b[field] as string).getTime()
      : Number.POSITIVE_INFINITY;

    const aSortable: number = Number.isFinite(aTime)
      ? aTime
      : Number.POSITIVE_INFINITY;
    const bSortable: number = Number.isFinite(bTime)
      ? bTime
      : Number.POSITIVE_INFINITY;

    if (aSortable === bSortable) {
      return a.scheduleName.localeCompare(b.scheduleName);
    }

    return aSortable - bSortable;
  };
}

/**
 * True when an override is in force at `now`. Used to separate "covering
 * today" from "booked for next week", which are two different rows on the
 * overrides screen and two different things to worry about.
 */
export function isOverrideActive(
  override: { startsAt: string | null; endsAt: string | null },
  now: number,
): boolean {
  const start: number | null = override.startsAt
    ? new Date(override.startsAt).getTime()
    : null;
  const end: number | null = override.endsAt
    ? new Date(override.endsAt).getTime()
    : null;

  if (start === null || end === null) {
    return false;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return false;
  }

  return start <= now && end > now;
}

/**
 * An override that has already finished. Kept out of the active and upcoming
 * lists so the screen does not imply cover that has expired.
 */
export function isOverrideExpired(
  override: { endsAt: string | null },
  now: number,
): boolean {
  const end: number | null = override.endsAt
    ? new Date(override.endsAt).getTime()
    : null;

  if (end === null || !Number.isFinite(end)) {
    return false;
  }

  return end <= now;
}
