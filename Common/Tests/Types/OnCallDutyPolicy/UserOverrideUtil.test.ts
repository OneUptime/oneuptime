import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import UserOverrideUtil, {
  UserOverrideRecord,
} from "../../../Types/OnCallDutyPolicy/UserOverrideUtil";

function event(data: { title: string; start: Date; end: Date }): CalendarEvent {
  return {
    id: 1,
    title: data.title,
    start: data.start,
    end: data.end,
  };
}

function override(data: {
  overrideUserId?: string;
  routeAlertsToUserId: string;
  startsAt: Date;
  endsAt: Date;
  onCallDutyPolicyId?: string | null;
}): UserOverrideRecord {
  return {
    overrideUserId: data.overrideUserId || "user-a",
    routeAlertsToUserId: data.routeAlertsToUserId,
    startsAt: data.startsAt,
    endsAt: data.endsAt,
    onCallDutyPolicyId: data.onCallDutyPolicyId || null,
  };
}

describe("UserOverrideUtil", () => {
  test("filters policy-specific overrides to the active policy", () => {
    const startsAt: Date = new Date("2026-01-01T00:00:00.000Z");
    const endsAt: Date = new Date("2026-01-02T00:00:00.000Z");

    const globalOverride: UserOverrideRecord = override({
      routeAlertsToUserId: "global-substitute",
      startsAt,
      endsAt,
    });
    const policyAOverride: UserOverrideRecord = override({
      routeAlertsToUserId: "policy-a-substitute",
      startsAt,
      endsAt,
      onCallDutyPolicyId: "policy-a",
    });
    const policyBOverride: UserOverrideRecord = override({
      routeAlertsToUserId: "policy-b-substitute",
      startsAt,
      endsAt,
      onCallDutyPolicyId: "policy-b",
    });

    const policyBOverrides: Array<UserOverrideRecord> =
      UserOverrideUtil.getOverridesForPolicy({
        overrides: [globalOverride, policyAOverride, policyBOverride],
        onCallDutyPolicyId: "policy-b",
      });

    expect(policyBOverrides).toEqual([globalOverride, policyBOverride]);

    const scheduleOnlyOverrides: Array<UserOverrideRecord> =
      UserOverrideUtil.getOverridesForPolicy({
        overrides: [globalOverride, policyAOverride, policyBOverride],
      });

    expect(scheduleOnlyOverrides).toEqual([globalOverride]);
  });

  test("does not apply another policy's user override to schedule events", () => {
    const startsAt: Date = new Date("2026-01-01T00:00:00.000Z");
    const endsAt: Date = new Date("2026-01-02T00:00:00.000Z");
    const events: Array<CalendarEvent> = [
      event({
        title: "user-a",
        start: startsAt,
        end: endsAt,
      }),
    ];

    const policyAOverride: UserOverrideRecord = override({
      routeAlertsToUserId: "policy-a-substitute",
      startsAt,
      endsAt,
      onCallDutyPolicyId: "policy-a",
    });

    const policyBOverrides: Array<UserOverrideRecord> =
      UserOverrideUtil.getOverridesForPolicy({
        overrides: [policyAOverride],
        onCallDutyPolicyId: "policy-b",
      });

    const overriddenEvents: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events,
        overrides: policyBOverrides,
      });

    expect(overriddenEvents).toHaveLength(1);
    expect(overriddenEvents[0]!.title).toBe("user-a");
  });

  test("lets policy-specific override take precedence over global override", () => {
    const startsAt: Date = new Date("2026-01-01T00:00:00.000Z");
    const localStartsAt: Date = new Date("2026-01-01T12:00:00.000Z");
    const localEndsAt: Date = new Date("2026-01-01T13:00:00.000Z");
    const endsAt: Date = new Date("2026-01-02T00:00:00.000Z");
    const events: Array<CalendarEvent> = [
      event({
        title: "user-a",
        start: startsAt,
        end: endsAt,
      }),
    ];

    const globalOverride: UserOverrideRecord = override({
      routeAlertsToUserId: "global-substitute",
      startsAt,
      endsAt,
    });
    const policyOverride: UserOverrideRecord = override({
      routeAlertsToUserId: "policy-substitute",
      startsAt: localStartsAt,
      endsAt: localEndsAt,
      onCallDutyPolicyId: "policy-a",
    });

    const policyOverrides: Array<UserOverrideRecord> =
      UserOverrideUtil.getOverridesForPolicy({
        overrides: [policyOverride, globalOverride],
        onCallDutyPolicyId: "policy-a",
      });

    const overriddenEvents: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events,
        overrides: policyOverrides,
      });

    expect(
      overriddenEvents.map((item: CalendarEvent) => {
        return item.title;
      }),
    ).toEqual(["global-substitute", "policy-substitute", "global-substitute"]);
    expect(overriddenEvents[1]!.start).toEqual(localStartsAt);
    expect(overriddenEvents[1]!.end).toEqual(localEndsAt);
  });
});
