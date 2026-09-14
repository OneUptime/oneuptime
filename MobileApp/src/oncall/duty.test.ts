import { describe, expect, test } from "@jest/globals";
import {
  isOverrideActive,
  isOverrideExpired,
  summarizeDuty,
  toShiftsForUser,
  type OnCallDutySummary,
} from "./duty";
import type {
  OnCallAssignmentType,
  OnCallShift,
  ProjectOnCallAssignments,
  ProjectOnCallScheduleItem,
} from "../api/types";

/*
 * The rules this module exists to hold:
 *
 *   - a shift belongs to the signed-in user only if the roster names THEM;
 *   - a schedule can hand somebody both a current and a next shift;
 *   - a standing (direct or team) assignment is on-call with NO handoff, and
 *     must never borrow a handoff time from a schedule.
 *
 * Every one of those, gotten wrong, produces a screen that confidently tells a
 * responder the wrong thing about their own evening.
 */

const ME: string = "user-me";
const SOMEBODY_ELSE: string = "user-other";

function schedule(
  overrides: Partial<ProjectOnCallScheduleItem["item"]> & { _id: string },
  project: { projectId: string; projectName: string } = {
    projectId: "project-1",
    projectName: "Acme",
  },
): ProjectOnCallScheduleItem {
  return {
    projectId: project.projectId,
    projectName: project.projectName,
    item: {
      name: "Primary",
      currentUserOnRoster: null,
      nextUserOnRoster: null,
      rosterStartAt: null,
      rosterHandoffAt: null,
      rosterNextStartAt: null,
      rosterNextHandoffAt: null,
      ...overrides,
    },
  };
}

function assignments(
  types: Array<OnCallAssignmentType>,
): ProjectOnCallAssignments[] {
  return [
    {
      projectId: "project-1",
      projectName: "Acme",
      assignments: types.map((type: OnCallAssignmentType, index: number) => {
        return {
          projectId: "project-1",
          projectName: "Acme",
          policyId: `policy-${index}`,
          policyName: `Policy ${index}`,
          escalationRuleName: "Rule 1",
          assignmentType: type,
          assignmentDetail: "detail",
        };
      }),
    },
  ];
}

describe("toShiftsForUser", () => {
  test("claims the current roster slot when it names this user", () => {
    const shifts: OnCallShift[] = toShiftsForUser(
      [
        schedule({
          _id: "schedule-1",
          name: "Primary",
          currentUserOnRoster: { _id: ME, name: "Ada" },
          rosterStartAt: "2026-03-03T09:00:00.000Z",
          rosterHandoffAt: "2026-03-04T09:00:00.000Z",
        }),
      ],
      ME,
    );

    expect(shifts).toHaveLength(1);
    expect(shifts[0]).toMatchObject({
      scheduleId: "schedule-1",
      scheduleName: "Primary",
      projectName: "Acme",
      status: "active",
      startsAt: "2026-03-03T09:00:00.000Z",
      endsAt: "2026-03-04T09:00:00.000Z",
    });
  });

  test("ignores a roster slot that names somebody else", () => {
    /*
     * The whole roster is readable - the app fetches every schedule in the
     * project to build the "who's on call" list - so the filtering happens
     * here. Skipping it would show a responder somebody else's shift as their
     * own.
     */
    const shifts: OnCallShift[] = toShiftsForUser(
      [
        schedule({
          _id: "schedule-1",
          currentUserOnRoster: { _id: SOMEBODY_ELSE, name: "Priya" },
          nextUserOnRoster: { _id: SOMEBODY_ELSE, name: "Priya" },
        }),
      ],
      ME,
    );

    expect(shifts).toEqual([]);
  });

  test("returns both shifts when the same schedule has this user on now and next", () => {
    // Back-to-back rotations are normal; only reporting the first is a bug.
    const shifts: OnCallShift[] = toShiftsForUser(
      [
        schedule({
          _id: "schedule-1",
          currentUserOnRoster: { _id: ME },
          nextUserOnRoster: { _id: ME },
          rosterHandoffAt: "2026-03-04T09:00:00.000Z",
          rosterNextStartAt: "2026-03-10T09:00:00.000Z",
        }),
      ],
      ME,
    );

    expect(
      shifts.map((shift: OnCallShift) => {
        return shift.status;
      }),
    ).toEqual(["active", "upcoming"]);
  });

  test("carries the project through so a multi-project responder can tell them apart", () => {
    const shifts: OnCallShift[] = toShiftsForUser(
      [
        schedule(
          { _id: "schedule-1", currentUserOnRoster: { _id: ME } },
          { projectId: "project-2", projectName: "Globex" },
        ),
      ],
      ME,
    );

    expect(shifts[0]?.projectId).toBe("project-2");
    expect(shifts[0]?.projectName).toBe("Globex");
  });

  test("returns nothing when the signed-in user is unknown", () => {
    /*
     * A null user id must produce NO shifts rather than every shift. The
     * screen renders "not on call", which is honest; matching everything would
     * tell an unidentified session it is on call for the whole company.
     */
    const shifts: OnCallShift[] = toShiftsForUser(
      [schedule({ _id: "schedule-1", currentUserOnRoster: { _id: ME } })],
      null,
    );

    expect(shifts).toEqual([]);
  });

  test("skips schedules with an empty roster", () => {
    const shifts: OnCallShift[] = toShiftsForUser(
      [schedule({ _id: "schedule-1" })],
      ME,
    );

    expect(shifts).toEqual([]);
  });
});

describe("summarizeDuty", () => {
  test("reports on call with the soonest handoff when a shift is running", () => {
    const summary: OnCallDutySummary = summarizeDuty({
      shifts: [
        {
          scheduleId: "s1",
          scheduleName: "Later",
          projectId: "p",
          projectName: "Acme",
          status: "active",
          startsAt: null,
          endsAt: "2026-03-04T18:00:00.000Z",
        },
        {
          scheduleId: "s2",
          scheduleName: "Sooner",
          projectId: "p",
          projectName: "Acme",
          status: "active",
          startsAt: null,
          endsAt: "2026-03-04T09:00:00.000Z",
        },
      ],
      assignmentsByProject: assignments(["schedule", "schedule"]),
    });

    expect(summary.isOnCall).toBe(true);
    expect(summary.nextHandoffAt).toBe("2026-03-04T09:00:00.000Z");
    expect(
      summary.activeShifts.map((shift: OnCallShift) => {
        return shift.scheduleName;
      }),
    ).toEqual(["Sooner", "Later"]);
  });

  test("a standing assignment is on call with no handoff", () => {
    /*
     * The most important case in this file. A direct escalation-rule
     * assignment has no window at all; if a handoff appeared here the status
     * card would tell somebody they stop carrying the phone at a time that
     * means nothing.
     */
    const summary: OnCallDutySummary = summarizeDuty({
      shifts: [],
      assignmentsByProject: assignments(["user"]),
    });

    expect(summary.isOnCall).toBe(true);
    expect(summary.nextHandoffAt).toBeNull();
    expect(summary.standingAssignmentCount).toBe(1);
    expect(summary.scheduleAssignmentCount).toBe(0);
  });

  test("counts direct and team assignments as standing, schedules separately", () => {
    const summary: OnCallDutySummary = summarizeDuty({
      shifts: [],
      assignmentsByProject: assignments(["user", "team", "schedule"]),
    });

    expect(summary.standingAssignmentCount).toBe(2);
    expect(summary.scheduleAssignmentCount).toBe(1);
  });

  test("off call with an upcoming shift reports when it starts", () => {
    const summary: OnCallDutySummary = summarizeDuty({
      shifts: [
        {
          scheduleId: "s1",
          scheduleName: "Primary",
          projectId: "p",
          projectName: "Acme",
          status: "upcoming",
          startsAt: "2026-03-10T09:00:00.000Z",
          endsAt: "2026-03-11T09:00:00.000Z",
        },
      ],
      assignmentsByProject: [],
    });

    expect(summary.isOnCall).toBe(false);
    expect(summary.nextShiftStartsAt).toBe("2026-03-10T09:00:00.000Z");
    expect(summary.nextHandoffAt).toBeNull();
  });

  test("an active shift with no computed handoff still counts as on call", () => {
    const summary: OnCallDutySummary = summarizeDuty({
      shifts: [
        {
          scheduleId: "s1",
          scheduleName: "Primary",
          projectId: "p",
          projectName: "Acme",
          status: "active",
          startsAt: null,
          endsAt: null,
        },
      ],
      assignmentsByProject: [],
    });

    expect(summary.isOnCall).toBe(true);
    expect(summary.nextHandoffAt).toBeNull();
  });

  test("a shift with no boundary sorts after ones that have one", () => {
    // An unknown handoff is not an imminent handoff.
    const summary: OnCallDutySummary = summarizeDuty({
      shifts: [
        {
          scheduleId: "s1",
          scheduleName: "Unknown end",
          projectId: "p",
          projectName: "Acme",
          status: "active",
          startsAt: null,
          endsAt: null,
        },
        {
          scheduleId: "s2",
          scheduleName: "Known end",
          projectId: "p",
          projectName: "Acme",
          status: "active",
          startsAt: null,
          endsAt: "2026-03-04T09:00:00.000Z",
        },
      ],
      assignmentsByProject: [],
    });

    expect(
      summary.activeShifts.map((shift: OnCallShift) => {
        return shift.scheduleName;
      }),
    ).toEqual(["Known end", "Unknown end"]);
    expect(summary.nextHandoffAt).toBe("2026-03-04T09:00:00.000Z");
  });

  test("nothing at all is off call", () => {
    const summary: OnCallDutySummary = summarizeDuty({
      shifts: [],
      assignmentsByProject: [],
    });

    expect(summary).toEqual({
      isOnCall: false,
      activeShifts: [],
      upcomingShifts: [],
      nextHandoffAt: null,
      nextShiftStartsAt: null,
      standingAssignmentCount: 0,
      scheduleAssignmentCount: 0,
    });
  });

  test("ignores an unparseable boundary rather than picking it as earliest", () => {
    const summary: OnCallDutySummary = summarizeDuty({
      shifts: [
        {
          scheduleId: "s1",
          scheduleName: "Broken",
          projectId: "p",
          projectName: "Acme",
          status: "active",
          startsAt: null,
          endsAt: "not-a-date",
        },
        {
          scheduleId: "s2",
          scheduleName: "Real",
          projectId: "p",
          projectName: "Acme",
          status: "active",
          startsAt: null,
          endsAt: "2026-03-04T09:00:00.000Z",
        },
      ],
      assignmentsByProject: [],
    });

    expect(summary.nextHandoffAt).toBe("2026-03-04T09:00:00.000Z");
  });
});

describe("override windows", () => {
  const now: number = new Date("2026-03-03T12:00:00.000Z").getTime();

  test("an override spanning now is active", () => {
    expect(
      isOverrideActive(
        {
          startsAt: "2026-03-03T09:00:00.000Z",
          endsAt: "2026-03-03T18:00:00.000Z",
        },
        now,
      ),
    ).toBe(true);
  });

  test("an override that has not started is neither active nor expired", () => {
    const override: { startsAt: string; endsAt: string } = {
      startsAt: "2026-03-04T09:00:00.000Z",
      endsAt: "2026-03-04T18:00:00.000Z",
    };

    expect(isOverrideActive(override, now)).toBe(false);
    expect(isOverrideExpired(override, now)).toBe(false);
  });

  test("an override that has ended is expired, not active", () => {
    const override: { startsAt: string; endsAt: string } = {
      startsAt: "2026-03-02T09:00:00.000Z",
      endsAt: "2026-03-02T18:00:00.000Z",
    };

    expect(isOverrideActive(override, now)).toBe(false);
    expect(isOverrideExpired(override, now)).toBe(true);
  });

  test("the instant it ends it is no longer in effect", () => {
    /*
     * Exclusive end. An override shown as "in effect" a millisecond after it
     * stopped routing pages is the one lie this screen cannot afford.
     */
    const override: { startsAt: string; endsAt: string } = {
      startsAt: "2026-03-03T09:00:00.000Z",
      endsAt: "2026-03-03T12:00:00.000Z",
    };

    expect(isOverrideActive(override, now)).toBe(false);
    expect(isOverrideExpired(override, now)).toBe(true);
  });

  test("an override missing a boundary is not claimed to be active", () => {
    expect(
      isOverrideActive({ startsAt: null, endsAt: "2026-03-03T18:00:00Z" }, now),
    ).toBe(false);
    expect(
      isOverrideActive({ startsAt: "2026-03-03T09:00:00Z", endsAt: null }, now),
    ).toBe(false);
  });
});
