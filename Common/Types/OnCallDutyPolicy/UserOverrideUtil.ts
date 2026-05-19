import CalendarEvent from "../Calendar/CalendarEvent";
import OneUptimeDate from "../Date";

export interface UserOverrideRecord {
  overrideUserId: string;
  routeAlertsToUserId: string;
  startsAt: Date;
  endsAt: Date;
  // null/undefined means global override (applies to all on-call duty policies)
  onCallDutyPolicyId?: string | null | undefined;
}

export interface OverrideEventMeta {
  isOverride: true;
  originalUserId: string;
  overrideUserId: string;
  overrideStartsAt: Date;
  overrideEndsAt: Date;
}

/*
 * CalendarEvent extends JSONObject so it accepts string-indexed metadata.
 * We attach the override info under a known key so downstream consumers can
 * detect and render the substitution distinctly.
 */
export const OVERRIDE_META_KEY: string = "_override";

export default class UserOverrideUtil {
  /**
   * Returns overrides that can apply in the supplied policy context.
   * A missing policy context means the schedule is being rendered outside any
   * policy, so only global overrides are valid.
   */
  public static getOverridesForPolicy(data: {
    overrides: Array<UserOverrideRecord>;
    onCallDutyPolicyId?: string | null | undefined;
  }): Array<UserOverrideRecord> {
    const onCallDutyPolicyId: string | null = data.onCallDutyPolicyId || null;

    return data.overrides
      .filter((override: UserOverrideRecord) => {
        const overridePolicyId: string | null =
          override.onCallDutyPolicyId || null;

        if (!onCallDutyPolicyId) {
          return !overridePolicyId;
        }

        return !overridePolicyId || overridePolicyId === onCallDutyPolicyId;
      })
      .sort((a: UserOverrideRecord, b: UserOverrideRecord) => {
        const specificityDiff: number =
          UserOverrideUtil.getOverrideSpecificity(a) -
          UserOverrideUtil.getOverrideSpecificity(b);

        if (specificityDiff !== 0) {
          return specificityDiff;
        }

        return a.startsAt.getTime() - b.startsAt.getTime();
      });
  }

  public static applyOverridesToEvents(data: {
    events: Array<CalendarEvent>;
    overrides: Array<UserOverrideRecord>;
  }): Array<CalendarEvent> {
    const applicable: Array<UserOverrideRecord> = [...data.overrides].sort(
      (a: UserOverrideRecord, b: UserOverrideRecord) => {
        const specificityDiff: number =
          UserOverrideUtil.getOverrideSpecificity(a) -
          UserOverrideUtil.getOverrideSpecificity(b);

        if (specificityDiff !== 0) {
          return specificityDiff;
        }

        return a.startsAt.getTime() - b.startsAt.getTime();
      },
    );

    if (applicable.length === 0) {
      return data.events;
    }

    let working: Array<CalendarEvent> = data.events;

    for (const override of applicable) {
      const next: Array<CalendarEvent> = [];
      for (const event of working) {
        next.push(...UserOverrideUtil.splitEventByOverride(event, override));
      }
      working = next;
    }

    return UserOverrideUtil.reassignEventIds(working);
  }

  private static splitEventByOverride(
    event: CalendarEvent,
    override: UserOverrideRecord,
  ): Array<CalendarEvent> {
    const existingOverrideMeta: OverrideEventMeta | null =
      UserOverrideUtil.getOverrideMeta(event);
    const originalUserId: string =
      existingOverrideMeta?.originalUserId || event.title;

    if (originalUserId !== override.overrideUserId) {
      return [event];
    }

    // Override window doesn't overlap event window at all.
    if (
      OneUptimeDate.isAfter(override.startsAt, event.end) ||
      OneUptimeDate.isSame(override.startsAt, event.end) ||
      OneUptimeDate.isBefore(override.endsAt, event.start) ||
      OneUptimeDate.isSame(override.endsAt, event.start)
    ) {
      return [event];
    }

    const overrideStart: Date = OneUptimeDate.isAfter(
      override.startsAt,
      event.start,
    )
      ? override.startsAt
      : event.start;

    const overrideEnd: Date = OneUptimeDate.isBefore(override.endsAt, event.end)
      ? override.endsAt
      : event.end;

    const segments: Array<CalendarEvent> = [];

    // Segment before the override window — original user remains on call.
    if (OneUptimeDate.isBefore(event.start, overrideStart)) {
      segments.push({
        ...event,
        end: overrideStart,
      });
    }

    // Override window — substitute user takes over.
    const meta: OverrideEventMeta = {
      isOverride: true,
      originalUserId: originalUserId,
      overrideUserId: override.routeAlertsToUserId,
      overrideStartsAt: override.startsAt,
      overrideEndsAt: override.endsAt,
    };

    segments.push({
      ...event,
      start: overrideStart,
      end: overrideEnd,
      title: override.routeAlertsToUserId,
      [OVERRIDE_META_KEY]: meta as unknown as never,
    });

    // Segment after the override window — original user resumes.
    if (OneUptimeDate.isAfter(event.end, overrideEnd)) {
      segments.push({
        ...event,
        start: overrideEnd,
      });
    }

    return segments;
  }

  private static getOverrideSpecificity(override: UserOverrideRecord): number {
    return override.onCallDutyPolicyId ? 1 : 0;
  }

  private static reassignEventIds(
    events: Array<CalendarEvent>,
  ): Array<CalendarEvent> {
    let id: number = 1;
    return events.map((event: CalendarEvent) => {
      return { ...event, id: id++ };
    });
  }

  public static getOverrideMeta(
    event: CalendarEvent,
  ): OverrideEventMeta | null {
    const meta: unknown = (event as unknown as Record<string, unknown>)[
      OVERRIDE_META_KEY
    ];
    if (
      meta &&
      typeof meta === "object" &&
      (meta as { isOverride?: boolean }).isOverride === true
    ) {
      return meta as OverrideEventMeta;
    }
    return null;
  }
}
