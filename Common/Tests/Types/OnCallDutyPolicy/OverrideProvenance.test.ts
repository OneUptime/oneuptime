import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import ScheduleShiftUtil, {
  OnCallShift,
} from "../../../Types/OnCallDutyPolicy/ScheduleShiftUtil";
import UserOverrideUtil, {
  OverrideEventMeta,
  UserOverrideRecord,
} from "../../../Types/OnCallDutyPolicy/UserOverrideUtil";

/*
 * PROVENANCE: the two facts a screen needs before it can honestly describe a
 * substitution, and which the engine used to drop on the floor.
 *
 * 1. WHICH override produced a segment - global, or scoped to one policy.
 *    Without it a renderer can say "Bob is covering Alice" but not whether that
 *    holds for the policy the reader actually cares about. A scoped override
 *    re-routes exactly one policy's alerts; every OTHER policy escalating to
 *    the same schedule still pages Alice. Presenting the two identically is the
 *    difference between "you are covered" and "you are covered for one of your
 *    four policies".
 *
 * 2. That an override window stays its OWN shift. The default grouping folds
 *    consecutive segments of the same user together, and a shift inherits
 *    metadata only from its first segment - so a substitute who is also on the
 *    roster ends up with one merged block that either carries the wrong
 *    override or none. https://github.com/OneUptime/oneuptime
 */

const POLICY_ID: string = "policy-database-oncall";

function at(hours: number, minutes: number = 0): Date {
  return new Date(2026, 0, 1, hours, minutes, 0, 0);
}

function event(
  title: string,
  startHour: number,
  endHour: number,
): CalendarEvent {
  return {
    id: 1,
    title: title,
    allDay: false,
    start: at(startHour),
    end: at(endHour),
  };
}

function record(data: {
  from: string;
  to: string;
  startHour: number;
  endHour: number;
  policyId?: string | null | undefined;
}): UserOverrideRecord {
  return {
    overrideUserId: data.from,
    routeAlertsToUserId: data.to,
    startsAt: at(data.startHour),
    endsAt: at(data.endHour),
    onCallDutyPolicyId:
      data.policyId === undefined ? null : (data.policyId as string | null),
  };
}

function overriddenSegment(events: Array<CalendarEvent>): CalendarEvent {
  const found: CalendarEvent | undefined = events.find(
    (candidate: CalendarEvent) => {
      return UserOverrideUtil.getOverrideMeta(candidate) !== null;
    },
  );

  if (!found) {
    throw new Error("expected at least one override segment");
  }

  return found;
}

describe("OverrideEventMeta carries the override's policy scope", () => {
  test("a GLOBAL override stamps a null policy, not an absent key", () => {
    const events: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [event("A", 8, 14)],
        overrides: [record({ from: "A", to: "B", startHour: 9, endHour: 13 })],
      });

    const meta: OverrideEventMeta | null = UserOverrideUtil.getOverrideMeta(
      overriddenSegment(events),
    );

    expect(meta).not.toBeNull();
    /*
     * Explicitly null rather than undefined so a consumer tests ONE value for
     * "global". A key that is sometimes absent invites `meta.onCallDutyPolicyId
     * === null` checks that silently fail for the undefined case and render the
     * scoped wording for a global override.
     */
    expect(meta!.onCallDutyPolicyId).toBeNull();
  });

  test("a POLICY-SCOPED override stamps that policy's id", () => {
    const events: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [event("A", 8, 14)],
        overrides: [
          record({
            from: "A",
            to: "B",
            startHour: 9,
            endHour: 13,
            policyId: POLICY_ID,
          }),
        ],
        currentOnCallDutyPolicyId: POLICY_ID,
      });

    const meta: OverrideEventMeta | null = UserOverrideUtil.getOverrideMeta(
      overriddenSegment(events),
    );

    expect(meta!.onCallDutyPolicyId).toBe(POLICY_ID);
  });

  test("when a scoped and a global override compete, the meta names the one that actually won", () => {
    /*
     * applyOverridesToEvents sorts policy-scoped first so the scoped
     * substitution claims the window. The stamped scope has to agree with that
     * outcome: a segment routed by the scoped override that reported itself as
     * global would tell the reader the swap covers every policy when it covers
     * exactly one.
     */
    const events: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [event("A", 8, 14)],
        overrides: [
          record({ from: "A", to: "GLOBAL", startHour: 9, endHour: 13 }),
          record({
            from: "A",
            to: "SCOPED",
            startHour: 9,
            endHour: 13,
            policyId: POLICY_ID,
          }),
        ],
        currentOnCallDutyPolicyId: POLICY_ID,
      });

    const segment: CalendarEvent = overriddenSegment(events);
    expect(segment.title).toBe("SCOPED");
    expect(UserOverrideUtil.getOverrideMeta(segment)!.onCallDutyPolicyId).toBe(
      POLICY_ID,
    );
  });

  test("the segments OUTSIDE the override window carry no meta at all", () => {
    const events: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [event("A", 8, 14)],
        overrides: [record({ from: "A", to: "B", startHour: 9, endHour: 13 })],
      });

    const untouched: Array<CalendarEvent> = events.filter(
      (candidate: CalendarEvent) => {
        return UserOverrideUtil.getOverrideMeta(candidate) === null;
      },
    );

    // 08:00-09:00 and 13:00-14:00 are still plain A.
    expect(untouched).toHaveLength(2);
    for (const segment of untouched) {
      expect(segment.title).toBe("A");
    }
  });
});

describe("ScheduleShiftUtil.groupKeyByUserAndOverride", () => {
  test("keeps a substitute's own shift separate from the one they are covering", () => {
    /*
     * The regression this exists for. B is rostered 14:00-18:00 in their own
     * right and is ALSO covering A from 12:00-14:00. The two segments touch and
     * belong to the same user, so the default grouping merges them into one
     * 12:00-18:00 block - and since a shift inherits metadata from its first
     * segment only, the merged block claims to be four hours of cover when half
     * of it is B's ordinary turn.
     */
    const events: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [event("A", 8, 14), { ...event("B", 14, 18), id: 2 }],
        overrides: [record({ from: "A", to: "B", startHour: 12, endHour: 14 })],
      });

    const merged: Array<OnCallShift> =
      ScheduleShiftUtil.groupEventsIntoShifts(events);
    const split: Array<OnCallShift> = ScheduleShiftUtil.groupEventsIntoShifts(
      events,
      { groupKey: ScheduleShiftUtil.groupKeyByUserAndOverride },
    );

    // The default grouping folds B's cover into B's own turn: one block.
    const mergedB: Array<OnCallShift> = merged.filter((s: OnCallShift) => {
      return s.userId === "B";
    });
    expect(mergedB).toHaveLength(1);
    expect(mergedB[0]!.end).toEqual(at(18));

    // The override-aware grouping keeps them apart.
    const splitB: Array<OnCallShift> = split.filter((s: OnCallShift) => {
      return s.userId === "B";
    });
    expect(splitB).toHaveLength(2);

    const cover: OnCallShift = splitB[0]!;
    const ownTurn: OnCallShift = splitB[1]!;

    expect(cover.start).toEqual(at(12));
    expect(cover.end).toEqual(at(14));
    expect(cover.override).toBeDefined();
    expect(cover.override!.originalUserId).toBe("A");

    expect(ownTurn.start).toEqual(at(14));
    expect(ownTurn.end).toEqual(at(18));
    expect(ownTurn.override).toBeUndefined();
  });

  test("two consecutive windows covering DIFFERENT people stay two shifts", () => {
    const events: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [event("A", 8, 12), { ...event("C", 12, 16), id: 2 }],
        overrides: [
          record({ from: "A", to: "B", startHour: 8, endHour: 12 }),
          record({ from: "C", to: "B", startHour: 12, endHour: 16 }),
        ],
      });

    const shifts: Array<OnCallShift> = ScheduleShiftUtil.groupEventsIntoShifts(
      events,
      { groupKey: ScheduleShiftUtil.groupKeyByUserAndOverride },
    );

    expect(shifts).toHaveLength(2);
    expect(shifts[0]!.override!.originalUserId).toBe("A");
    expect(shifts[1]!.override!.originalUserId).toBe("C");
  });

  test("an ordinary rotation is grouped exactly as the default key groups it", () => {
    /*
     * The new key must not fragment schedules that have no overrides at all -
     * every "upcoming hand-offs" list in the dashboard is built from it, and a
     * key that split on something invisible would show hand-offs that are not
     * hand-offs.
     */
    const events: Array<CalendarEvent> = [
      event("A", 8, 12),
      { ...event("A", 12, 16), id: 2 },
      { ...event("B", 16, 20), id: 3 },
    ];

    const withDefault: Array<OnCallShift> =
      ScheduleShiftUtil.groupEventsIntoShifts(events);
    const withOverrideKey: Array<OnCallShift> =
      ScheduleShiftUtil.groupEventsIntoShifts(events, {
        groupKey: ScheduleShiftUtil.groupKeyByUserAndOverride,
      });

    expect(withOverrideKey).toEqual(withDefault);
    expect(withOverrideKey).toHaveLength(2);
  });

  test("one override spanning a rotation boundary stays a single shift", () => {
    /*
     * Unlike groupKeyByUserOverrideAndLayer, this key deliberately ignores the
     * rotation period: a person covering across a hand-over is doing one
     * continuous stretch of cover, and splitting it would invent a hand-off the
     * reader cannot act on.
     */
    const events: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [event("A", 8, 12), { ...event("C", 12, 16), id: 2 }],
        overrides: [record({ from: "A", to: "B", startHour: 8, endHour: 12 })],
      });

    const shifts: Array<OnCallShift> = ScheduleShiftUtil.groupEventsIntoShifts(
      events,
      { groupKey: ScheduleShiftUtil.groupKeyByUserAndOverride },
    );

    const bShifts: Array<OnCallShift> = shifts.filter((s: OnCallShift) => {
      return s.userId === "B";
    });
    expect(bShifts).toHaveLength(1);
    expect(bShifts[0]!.start).toEqual(at(8));
    expect(bShifts[0]!.end).toEqual(at(12));
  });
});
