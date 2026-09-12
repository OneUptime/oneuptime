import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import UserOverrideUtil, {
  OverrideEventMeta,
  UserOverrideRecord,
  OVERRIDE_META_KEY,
} from "../../../Types/OnCallDutyPolicy/UserOverrideUtil";

function at(
  hours: number,
  minutes: number = 0,
  seconds: number = 0,
  ms: number = 0,
): Date {
  return new Date(2026, 0, 1, hours, minutes, seconds, ms);
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

function resolvedAt(events: Array<CalendarEvent>, t: Date): string | null {
  for (const e of events) {
    if (t.getTime() >= e.start.getTime() && t.getTime() < e.end.getTime()) {
      return e.title;
    }
  }
  return null;
}

describe("UserOverrideUtil M-4: overrides are non-transitive", () => {
  const base: CalendarEvent = event("A", 8, 14);

  const g1: UserOverrideRecord = {
    overrideUserId: "A",
    routeAlertsToUserId: "B",
    startsAt: at(9),
    endsAt: at(13),
    onCallDutyPolicyId: null,
  };
  const g2: UserOverrideRecord = {
    overrideUserId: "B",
    routeAlertsToUserId: "C",
    startsAt: at(10),
    endsAt: at(12),
    onCallDutyPolicyId: null,
  };

  test("chain A->B then B->C does NOT double-substitute (stays B)", () => {
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [base],
        overrides: [g1, g2],
      });
    // At 11:00 the override result of A->B must remain B, not become C.
    expect(resolvedAt(result, at(11))).toBe("B");
    // Segments outside the override window remain A.
    expect(resolvedAt(result, at(8, 30))).toBe("A");
    expect(resolvedAt(result, at(13, 30))).toBe("A");
  });

  test("result is independent of override ordering", () => {
    const forward: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [event("A", 8, 14)],
        overrides: [g1, g2],
      });
    const reverse: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [event("A", 8, 14)],
        overrides: [g2, g1],
      });
    expect(resolvedAt(forward, at(11))).toBe(resolvedAt(reverse, at(11)));
    expect(resolvedAt(reverse, at(11))).toBe("B");
  });
});

describe("UserOverrideUtil INFO-1: consistent second-precision boundary handling", () => {
  test("override starting exactly at event end does not substitute", () => {
    const base: CalendarEvent = event("A", 8, 12); // ends 12:00:00.000
    const override: UserOverrideRecord = {
      overrideUserId: "A",
      routeAlertsToUserId: "B",
      startsAt: at(12), // exactly event end
      endsAt: at(13),
      onCallDutyPolicyId: null,
    };
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [base],
        overrides: [override],
      });
    expect(result.length).toBe(1);
    expect(result[0]!.title).toBe("A");
  });

  test("sub-second offset at the boundary does not create an inverted segment", () => {
    const base: CalendarEvent = event("A", 8, 12); // ends 12:00:00.000
    const override: UserOverrideRecord = {
      overrideUserId: "A",
      routeAlertsToUserId: "B",
      startsAt: at(12, 0, 0, 500), // 12:00:00.500 — same second as event end
      endsAt: at(13),
      onCallDutyPolicyId: null,
    };
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [base],
        overrides: [override],
      });
    // No inverted/negative-length segment; event returned unchanged.
    expect(result.length).toBe(1);
    expect(result[0]!.title).toBe("A");
    for (const e of result) {
      expect(e.end.getTime()).toBeGreaterThan(e.start.getTime());
    }
  });
});

describe("UserOverrideUtil: baseline substitution still works", () => {
  test("A->B within the event window splits into A | B | A", () => {
    const base: CalendarEvent = event("A", 8, 14);
    const override: UserOverrideRecord = {
      overrideUserId: "A",
      routeAlertsToUserId: "B",
      startsAt: at(10),
      endsAt: at(12),
      onCallDutyPolicyId: null,
    };
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [base],
        overrides: [override],
      });
    expect(resolvedAt(result, at(9))).toBe("A");
    expect(resolvedAt(result, at(11))).toBe("B");
    expect(resolvedAt(result, at(13))).toBe("A");
  });

  test("policy-scoped override wins over global for the same user/window", () => {
    const base: CalendarEvent = event("A", 8, 14);
    const globalOverride: UserOverrideRecord = {
      overrideUserId: "A",
      routeAlertsToUserId: "B",
      startsAt: at(9),
      endsAt: at(13),
      onCallDutyPolicyId: null,
    };
    const policyOverride: UserOverrideRecord = {
      overrideUserId: "A",
      routeAlertsToUserId: "C",
      startsAt: at(9),
      endsAt: at(13),
      onCallDutyPolicyId: "policy-1",
    };
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [base],
        overrides: [globalOverride, policyOverride],
        currentOnCallDutyPolicyId: "policy-1",
      });
    // Policy-scoped C wins over global B.
    expect(resolvedAt(result, at(11))).toBe("C");
  });
});

describe("UserOverrideUtil edge cases", () => {
  test("override fully covering the event replaces the whole event", () => {
    const base: CalendarEvent = event("A", 10, 12);
    const override: UserOverrideRecord = {
      overrideUserId: "A",
      routeAlertsToUserId: "B",
      startsAt: at(8), // starts before
      endsAt: at(14), // ends after
      onCallDutyPolicyId: null,
    };
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [base],
        overrides: [override],
      });
    expect(result.length).toBe(1);
    expect(result[0]!.title).toBe("B");
    // Segment is clamped to the event window, not the override window.
    expect(result[0]!.start.getTime()).toBe(at(10).getTime());
    expect(result[0]!.end.getTime()).toBe(at(12).getTime());
  });

  test("one override spans two separate events for the same user", () => {
    const e1: CalendarEvent = event("A", 8, 10);
    const e2: CalendarEvent = { ...event("A", 12, 14), id: 2 };
    const override: UserOverrideRecord = {
      overrideUserId: "A",
      routeAlertsToUserId: "B",
      startsAt: at(9),
      endsAt: at(13),
      onCallDutyPolicyId: null,
    };
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [e1, e2],
        overrides: [override],
      });
    // Both events are partially substituted.
    expect(resolvedAt(result, at(8, 30))).toBe("A"); // before override in e1
    expect(resolvedAt(result, at(9, 30))).toBe("B"); // override in e1
    expect(resolvedAt(result, at(12, 30))).toBe("B"); // override in e2
    expect(resolvedAt(result, at(13, 30))).toBe("A"); // after override in e2
  });

  test("two overrides on different original users both apply", () => {
    const e1: CalendarEvent = event("A", 8, 12);
    const e2: CalendarEvent = { ...event("B", 12, 16), id: 2 };
    const overrideA: UserOverrideRecord = {
      overrideUserId: "A",
      routeAlertsToUserId: "X",
      startsAt: at(9),
      endsAt: at(11),
      onCallDutyPolicyId: null,
    };
    const overrideB: UserOverrideRecord = {
      overrideUserId: "B",
      routeAlertsToUserId: "Y",
      startsAt: at(13),
      endsAt: at(15),
      onCallDutyPolicyId: null,
    };
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [e1, e2],
        overrides: [overrideA, overrideB],
      });
    expect(resolvedAt(result, at(10))).toBe("X"); // A -> X
    expect(resolvedAt(result, at(14))).toBe("Y"); // B -> Y
    expect(resolvedAt(result, at(8, 30))).toBe("A"); // untouched
    expect(resolvedAt(result, at(12, 30))).toBe("B"); // untouched
  });

  test("no overrides returns the events unchanged", () => {
    const base: CalendarEvent = event("A", 8, 14);
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [base],
        overrides: [],
      });
    expect(result).toEqual([base]);
  });
});

/*
 * isOverrideApplicable decides whether an override participates at all for a
 * given policy context. The suites above only exercise it indirectly through
 * applyOverridesToEvents, so cover the public method directly here.
 */
describe("UserOverrideUtil.isOverrideApplicable", () => {
  const makeOverride: (
    onCallDutyPolicyId?: string | null | undefined,
  ) => UserOverrideRecord = (
    onCallDutyPolicyId?: string | null | undefined,
  ): UserOverrideRecord => {
    return {
      overrideUserId: "A",
      routeAlertsToUserId: "B",
      startsAt: at(9),
      endsAt: at(11),
      onCallDutyPolicyId: onCallDutyPolicyId,
    };
  };

  test("a global override (no policy id) always applies", () => {
    expect(
      UserOverrideUtil.isOverrideApplicable(makeOverride(null), "policy-1"),
    ).toBe(true);
    expect(
      UserOverrideUtil.isOverrideApplicable(makeOverride(undefined), undefined),
    ).toBe(true);
  });

  test("a policy-scoped override applies only to its own policy", () => {
    expect(
      UserOverrideUtil.isOverrideApplicable(
        makeOverride("policy-1"),
        "policy-1",
      ),
    ).toBe(true);
    expect(
      UserOverrideUtil.isOverrideApplicable(
        makeOverride("policy-1"),
        "policy-2",
      ),
    ).toBe(false);
  });

  test("a policy-scoped override does not apply without policy context", () => {
    expect(
      UserOverrideUtil.isOverrideApplicable(
        makeOverride("policy-1"),
        undefined,
      ),
    ).toBe(false);
  });
});

/*
 * getOverrideMeta is how downstream consumers detect a substituted segment and
 * render it distinctly. Cover the public method directly.
 */
describe("UserOverrideUtil.getOverrideMeta", () => {
  test("returns null for a plain event", () => {
    expect(UserOverrideUtil.getOverrideMeta(event("A", 8, 10))).toBeNull();
  });

  test("returns the meta for a segment produced by a substitution", () => {
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [event("A", 8, 12)],
        overrides: [
          {
            overrideUserId: "A",
            routeAlertsToUserId: "B",
            startsAt: at(9),
            endsAt: at(11),
          },
        ],
      });

    const substituted: CalendarEvent | undefined = result.find(
      (e: CalendarEvent): boolean => {
        return e.title === "B";
      },
    );
    expect(substituted).toBeDefined();

    const meta: OverrideEventMeta | null = UserOverrideUtil.getOverrideMeta(
      substituted as CalendarEvent,
    );
    expect(meta).not.toBeNull();
    expect((meta as OverrideEventMeta).originalUserId).toBe("A");
    expect((meta as OverrideEventMeta).overrideUserId).toBe("B");
  });

  test("returns null when the marker is present but is not a real override", () => {
    const plain: CalendarEvent = {
      ...event("A", 8, 10),
      [OVERRIDE_META_KEY]: { isOverride: false } as unknown as never,
    };

    expect(UserOverrideUtil.getOverrideMeta(plain)).toBeNull();
  });
});
