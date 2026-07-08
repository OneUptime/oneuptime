import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import UserOverrideUtil, {
  UserOverrideRecord,
} from "../../../Types/OnCallDutyPolicy/UserOverrideUtil";

function at(h: number, m: number = 0, s: number = 0, ms: number = 0): Date {
  return new Date(2026, 0, 1, h, m, s, ms);
}

function event(title: string, startHour: number, endHour: number): CalendarEvent {
  return { id: 1, title, allDay: false, start: at(startHour), end: at(endHour) };
}

function resolvedAt(events: Array<CalendarEvent>, t: Date): string | null {
  for (const e of events) {
    if (t.getTime() >= e.start.getTime() && t.getTime() < e.end.getTime()) {
      return e.title;
    }
  }
  return null;
}

describe("Override lens audit", () => {
  test("REPRO: applyOverridesToEvents is non-transitive (roster stores B for chain A->B, B->C)", () => {
    // User A is on-call. A->B (A on vacation, route to B). B->C (B also busy, route to C).
    const base: CalendarEvent = event("A", 8, 14);
    const aToB: UserOverrideRecord = {
      overrideUserId: "A",
      routeAlertsToUserId: "B",
      startsAt: at(9),
      endsAt: at(13),
      onCallDutyPolicyId: null,
    };
    const bToC: UserOverrideRecord = {
      overrideUserId: "B",
      routeAlertsToUserId: "C",
      startsAt: at(9),
      endsAt: at(13),
      onCallDutyPolicyId: null,
    };
    const result: Array<CalendarEvent> = UserOverrideUtil.applyOverridesToEvents({
      events: [base],
      overrides: [aToB, bToC],
    });
    // Non-transitive: schedule resolution (roster + dashboard) reports B, NOT C.
    expect(resolvedAt(result, at(11))).toBe("B");
    // The escalation paging path would then run getRouteAlertToUserId("B"),
    // find the B->C override, and page C -> divergence from the roster (B).
  });

  test("REPRO: swap pair A->B and B->A resolves to B (roster), escalation would route B->A", () => {
    const base: CalendarEvent = event("A", 8, 14);
    const aToB: UserOverrideRecord = {
      overrideUserId: "A",
      routeAlertsToUserId: "B",
      startsAt: at(9),
      endsAt: at(13),
      onCallDutyPolicyId: null,
    };
    const bToA: UserOverrideRecord = {
      overrideUserId: "B",
      routeAlertsToUserId: "A",
      startsAt: at(9),
      endsAt: at(13),
      onCallDutyPolicyId: null,
    };
    const result: Array<CalendarEvent> = UserOverrideUtil.applyOverridesToEvents({
      events: [base],
      overrides: [aToB, bToA],
    });
    // Roster resolves to B. getRouteAlertToUserId("B") would map B->A and page A.
    expect(resolvedAt(result, at(11))).toBe("B");
  });

  test("EDGE: self-override A->A blocks a legit overlapping override A->B", () => {
    const base: CalendarEvent = event("A", 8, 14);
    const selfOverride: UserOverrideRecord = {
      overrideUserId: "A",
      routeAlertsToUserId: "A", // self, no-op substitution
      startsAt: at(10),
      endsAt: at(12),
      onCallDutyPolicyId: null,
    };
    const aToB: UserOverrideRecord = {
      overrideUserId: "A",
      routeAlertsToUserId: "B",
      startsAt: at(9),
      endsAt: at(13),
      onCallDutyPolicyId: null,
    };
    const result: Array<CalendarEvent> = UserOverrideUtil.applyOverridesToEvents({
      events: [base],
      overrides: [selfOverride, aToB],
    });
    // At 11:00 the real override A->B is expected, but the self-override marked
    // [10,12] first, so it is skipped and A stays on-call.
    // eslint-disable-next-line no-console
    console.log("self-override case @11:00 =>", resolvedAt(result, at(11)));
  });
});
