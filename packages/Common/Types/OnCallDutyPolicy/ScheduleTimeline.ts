import OneUptimeDate from "../Date";
import BadDataException from "../Exception/BadDataException";
import { MaterializedShift } from "./MaterializedShift";

/*
 * The wire contract of the schedule timeline: every on-call schedule a caller
 * can read, side by side over one week or one month, with who is on call on
 * each (the "who is on call across my team / my whole org" view).
 *
 * The shifts come from the same pipeline as the calendar feeds, /my-shifts
 * and the shift reminders (OnCallShiftMaterializer through the schedule-level
 * cache), so the timeline can never disagree with the person who actually
 * gets paged. This file holds what both ends need: the route, the window
 * rules, the JSON shapes, the server-side projection of a MaterializedShift
 * and a defensive client-side parser.
 */

export const SCHEDULE_TIMELINE_ROUTE: string = "/on-call-schedule-timeline";

/*
 * How far back and ahead the timeline may look, in days. Past shifts are
 * recomputed from the CURRENT configuration (the engine does not keep
 * history), so looking back is useful for "who had last weekend" and not for
 * audits; the on-call time logs are the record of what actually happened.
 * Ahead is bounded because every distinct window is a fresh expansion of
 * every layer of every schedule.
 */
export const TIMELINE_MAX_PAST_DAYS: number = 180;
export const TIMELINE_MAX_FUTURE_DAYS: number = 365;

/*
 * The widest single request. A month view in any timezone spans at most 31
 * days plus a day of zone offset on each side; anything wider is a client
 * asking for more than it can draw.
 */
export const TIMELINE_MAX_SPAN_DAYS: number = 45;

// Span used when `to` is absent.
export const TIMELINE_DEFAULT_SPAN_DAYS: number = 7;

/*
 * The most schedules one response carries. Past this the response says how
 * many there were so the page can ask the reader to narrow by team.
 */
export const TIMELINE_MAX_SCHEDULES: number = 250;

const MILLISECONDS_PER_DAY: number = 24 * 60 * 60 * 1000;

export interface ScheduleTimelineOverrideJson {
  // The person whose shift this was before the override.
  originalUserId: string;
  originalUserName: string;
  overrideStartsAt: string;
  overrideEndsAt: string;
  // Set when the override is scoped to one on-call policy; null when global.
  onCallDutyPolicyId: string | null;
}

export interface ScheduleTimelineShiftJson {
  shiftKey: string;
  userId: string;
  userName: string;
  // ISO strings; `end` is exclusive.
  start: string;
  end: string;
  layerId: string | null;
  layerName: string | null;
  override: ScheduleTimelineOverrideJson | null;
}

export interface ScheduleTimelineScheduleJson {
  scheduleId: string;
  scheduleName: string;
  // The zone the schedule's rotations are authored in; null for legacy rows.
  scheduleTimezone: string | null;
  // Teams listed as owners of the schedule, for grouping and filtering.
  ownerTeamIds: Array<string>;
  // The caller is assigned to at least one of the schedule's layers.
  isCurrentUserOnRoster: boolean;
  // The rotation engine hit its iteration cap: shifts may be missing.
  truncated: boolean;
  shifts: Array<ScheduleTimelineShiftJson>;
}

export interface ScheduleTimelineTeamJson {
  teamId: string;
  teamName: string;
  isCurrentUserMember: boolean;
}

export interface ScheduleTimelineResponse {
  // The window actually served, after clamping. ISO strings.
  from: string;
  to: string;
  generatedAt: string;
  // Any schedule's expansion hit the iteration cap.
  truncated: boolean;
  // How many schedules matched before TIMELINE_MAX_SCHEDULES was applied.
  totalScheduleCount: number;
  schedulesTruncated: boolean;
  schedules: Array<ScheduleTimelineScheduleJson>;
  // Every team that owns at least one of the schedules above, by name.
  teams: Array<ScheduleTimelineTeamJson>;
}

export interface TimelineWindow {
  from: Date;
  to: Date;
}

export default class ScheduleTimelineUtil {
  /*
   * The range a timeline request may address at `now`:
   * [now - TIMELINE_MAX_PAST_DAYS, now + TIMELINE_MAX_FUTURE_DAYS]. The
   * dashboard uses the same numbers to stop the reader navigating somewhere
   * the server would refuse to draw.
   */
  public static getAddressableRange(now: Date): TimelineWindow {
    return {
      from: OneUptimeDate.addRemoveDays(now, -TIMELINE_MAX_PAST_DAYS),
      to: OneUptimeDate.addRemoveDays(now, TIMELINE_MAX_FUTURE_DAYS),
    };
  }

  /*
   * Validate and clamp a requested window. Garbage is refused (400); a window
   * that is merely too wide or too far away is pulled back in rather than
   * refused, so a client that is a release ahead still gets an answer.
   *
   *   - `from` is required; `to` defaults to from + TIMELINE_DEFAULT_SPAN_DAYS.
   *   - `to` must be after `from`.
   *   - the span is capped at TIMELINE_MAX_SPAN_DAYS by moving `to` in;
   *   - both edges are clamped into the addressable range. A window that lies
   *     wholly outside it collapses onto the nearest edge day, never to an
   *     empty or inverted window.
   */
  public static clampWindow(data: {
    from: unknown;
    to: unknown;
    now: Date;
  }): TimelineWindow {
    const from: Date = ScheduleTimelineUtil.readDate(data.from, "from", true)!;

    let to: Date =
      ScheduleTimelineUtil.readDate(data.to, "to", false) ||
      OneUptimeDate.addRemoveDays(from, TIMELINE_DEFAULT_SPAN_DAYS);

    if (to.getTime() <= from.getTime()) {
      throw new BadDataException("to must be after from.");
    }

    const spanCap: Date = OneUptimeDate.addRemoveDays(
      from,
      TIMELINE_MAX_SPAN_DAYS,
    );

    if (to.getTime() > spanCap.getTime()) {
      to = spanCap;
    }

    const addressable: TimelineWindow =
      ScheduleTimelineUtil.getAddressableRange(data.now);

    let clampedFrom: Date = from;
    let clampedTo: Date = to;

    if (clampedFrom.getTime() < addressable.from.getTime()) {
      clampedFrom = addressable.from;
    }

    if (clampedTo.getTime() > addressable.to.getTime()) {
      clampedTo = addressable.to;
    }

    /*
     * Entirely before the addressable range, or entirely after it: serve the
     * one day at that edge. The page shades everything outside the served
     * window, so the reader sees WHY there is nothing there.
     */
    if (clampedTo.getTime() <= clampedFrom.getTime()) {
      if (to.getTime() <= addressable.from.getTime()) {
        clampedFrom = addressable.from;
        clampedTo = OneUptimeDate.addRemoveDays(addressable.from, 1);
      } else {
        clampedTo = addressable.to;
        clampedFrom = OneUptimeDate.addRemoveDays(addressable.to, -1);
      }
    }

    return { from: clampedFrom, to: clampedTo };
  }

  /*
   * The window handed to the schedule-level cache: widened to whole UTC days,
   * exactly like /my-shifts does, so a timeline and a feed that cover the
   * same days share one expansion per schedule.
   */
  public static getCacheWindow(window: TimelineWindow): {
    windowStart: Date;
    windowEnd: Date;
  } {
    const windowStart: Date = new Date(
      ScheduleTimelineUtil.startOfUtcDay(window.from),
    );

    const endDayStart: number = ScheduleTimelineUtil.startOfUtcDay(window.to);

    const windowEnd: Date = new Date(
      window.to.getTime() > endDayStart
        ? endDayStart + MILLISECONDS_PER_DAY
        : endDayStart,
    );

    return { windowStart, windowEnd };
  }

  /*
   * Project one materialized shift onto the timeline's wire shape, or null
   * when it does not belong on the timeline:
   *
   *   - policy-variant shifts are dropped. They exist only for one
   *     escalation policy's view of a schedule attached to several, and they
   *     overlap the base shift for the same interval; a row can only show one
   *     person at a time, and the base resolution is the one the schedule's
   *     own roster (and its page) shows.
   *   - shifts that do not overlap the served window are dropped (the cache
   *     window is day-aligned and therefore a little wider).
   */
  public static toTimelineShift(
    shift: MaterializedShift,
    window: TimelineWindow,
  ): ScheduleTimelineShiftJson | null {
    if (shift.policyVariantOf) {
      return null;
    }

    if (
      shift.end.getTime() <= window.from.getTime() ||
      shift.start.getTime() >= window.to.getTime()
    ) {
      return null;
    }

    return {
      shiftKey: shift.shiftKey,
      userId: shift.userId,
      userName: shift.userName,
      start: shift.start.toISOString(),
      end: shift.end.toISOString(),
      layerId: shift.layerId ?? null,
      layerName: shift.layerName ?? null,
      override: shift.override
        ? {
            originalUserId: shift.override.originalUserId,
            originalUserName: shift.override.originalUserName,
            overrideStartsAt: shift.override.overrideStartsAt.toISOString(),
            overrideEndsAt: shift.override.overrideEndsAt.toISOString(),
            onCallDutyPolicyId: shift.override.onCallDutyPolicyId ?? null,
          }
        : null,
    };
  }

  /*
   * Parse a response on the dashboard. DEFENSIVE by design, like the other
   * on-call wire parsers: the dashboard is routinely a release ahead of or
   * behind the API during a rolling upgrade, so a missing field reads as its
   * empty value, a malformed shift is skipped (never thrown on), and only a
   * body that is not an object at all is an error.
   */
  public static parseResponse(value: unknown): ScheduleTimelineResponse {
    if (!ScheduleTimelineUtil.isObject(value)) {
      throw new BadDataException("Invalid schedule timeline response.");
    }

    const schedules: Array<ScheduleTimelineScheduleJson> = [];

    for (const item of ScheduleTimelineUtil.readArray(value["schedules"])) {
      const schedule: ScheduleTimelineScheduleJson | null =
        ScheduleTimelineUtil.parseSchedule(item);

      if (schedule) {
        schedules.push(schedule);
      }
    }

    const teams: Array<ScheduleTimelineTeamJson> = [];

    for (const item of ScheduleTimelineUtil.readArray(value["teams"])) {
      if (!ScheduleTimelineUtil.isObject(item)) {
        continue;
      }

      const teamId: string | null = ScheduleTimelineUtil.readString(
        item["teamId"],
      );

      if (!teamId) {
        continue;
      }

      teams.push({
        teamId,
        teamName:
          ScheduleTimelineUtil.readString(item["teamName"]) || "Unnamed team",
        isCurrentUserMember: item["isCurrentUserMember"] === true,
      });
    }

    const totalScheduleCount: number =
      typeof value["totalScheduleCount"] === "number" &&
      Number.isFinite(value["totalScheduleCount"])
        ? (value["totalScheduleCount"] as number)
        : schedules.length;

    return {
      from: ScheduleTimelineUtil.readString(value["from"]) || "",
      to: ScheduleTimelineUtil.readString(value["to"]) || "",
      generatedAt: ScheduleTimelineUtil.readString(value["generatedAt"]) || "",
      truncated: value["truncated"] === true,
      totalScheduleCount,
      schedulesTruncated: value["schedulesTruncated"] === true,
      schedules,
      teams,
    };
  }

  // -- Internals ----------------------------------------------------------

  private static parseSchedule(
    value: unknown,
  ): ScheduleTimelineScheduleJson | null {
    if (!ScheduleTimelineUtil.isObject(value)) {
      return null;
    }

    const scheduleId: string | null = ScheduleTimelineUtil.readString(
      value["scheduleId"],
    );

    if (!scheduleId) {
      return null;
    }

    const shifts: Array<ScheduleTimelineShiftJson> = [];

    for (const item of ScheduleTimelineUtil.readArray(value["shifts"])) {
      const shift: ScheduleTimelineShiftJson | null =
        ScheduleTimelineUtil.parseShift(item);

      if (shift) {
        shifts.push(shift);
      }
    }

    shifts.sort(
      (a: ScheduleTimelineShiftJson, b: ScheduleTimelineShiftJson): number => {
        return Date.parse(a.start) - Date.parse(b.start);
      },
    );

    return {
      scheduleId,
      scheduleName:
        ScheduleTimelineUtil.readString(value["scheduleName"]) ||
        "Unnamed schedule",
      scheduleTimezone: ScheduleTimelineUtil.readString(
        value["scheduleTimezone"],
      ),
      ownerTeamIds: ScheduleTimelineUtil.readArray(value["ownerTeamIds"])
        .map((id: unknown) => {
          return ScheduleTimelineUtil.readString(id);
        })
        .filter((id: string | null): id is string => {
          return Boolean(id);
        }),
      isCurrentUserOnRoster: value["isCurrentUserOnRoster"] === true,
      truncated: value["truncated"] === true,
      shifts,
    };
  }

  private static parseShift(value: unknown): ScheduleTimelineShiftJson | null {
    if (!ScheduleTimelineUtil.isObject(value)) {
      return null;
    }

    const userId: string | null = ScheduleTimelineUtil.readString(
      value["userId"],
    );
    const start: string | null = ScheduleTimelineUtil.readString(
      value["start"],
    );
    const end: string | null = ScheduleTimelineUtil.readString(value["end"]);

    if (!userId || !start || !end) {
      return null;
    }

    const startMs: number = Date.parse(start);
    const endMs: number = Date.parse(end);

    // An unparseable or empty interval cannot be drawn.
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return null;
    }

    if (endMs <= startMs) {
      return null;
    }

    let override: ScheduleTimelineOverrideJson | null = null;

    if (ScheduleTimelineUtil.isObject(value["override"])) {
      const raw: Record<string, unknown> = value["override"];
      const originalUserId: string | null = ScheduleTimelineUtil.readString(
        raw["originalUserId"],
      );

      if (originalUserId) {
        override = {
          originalUserId,
          originalUserName:
            ScheduleTimelineUtil.readString(raw["originalUserName"]) ||
            "Unknown user",
          overrideStartsAt:
            ScheduleTimelineUtil.readString(raw["overrideStartsAt"]) || start,
          overrideEndsAt:
            ScheduleTimelineUtil.readString(raw["overrideEndsAt"]) || end,
          onCallDutyPolicyId: ScheduleTimelineUtil.readString(
            raw["onCallDutyPolicyId"],
          ),
        };
      }
    }

    return {
      shiftKey:
        ScheduleTimelineUtil.readString(value["shiftKey"]) ||
        `${userId}:${start}`,
      userId,
      userName:
        ScheduleTimelineUtil.readString(value["userName"]) || "Unknown user",
      start,
      end,
      layerId: ScheduleTimelineUtil.readString(value["layerId"]),
      layerName: ScheduleTimelineUtil.readString(value["layerName"]),
      override,
    };
  }

  private static readDate(
    value: unknown,
    name: string,
    required: boolean,
  ): Date | null {
    if (value === undefined || value === null || value === "") {
      if (required) {
        throw new BadDataException(`${name} is required.`);
      }

      return null;
    }

    if (typeof value !== "string" || !value.trim()) {
      throw new BadDataException(`${name} must be an ISO 8601 date.`);
    }

    const trimmed: string = value.trim();

    if (!OneUptimeDate.isValidDateString(trimmed)) {
      throw new BadDataException(`${name} must be an ISO 8601 date.`);
    }

    const date: Date = OneUptimeDate.fromString(trimmed);

    if (Number.isNaN(date.getTime())) {
      throw new BadDataException(`${name} must be an ISO 8601 date.`);
    }

    return date;
  }

  private static startOfUtcDay(date: Date): number {
    return Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
    );
  }

  private static isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  private static readArray(value: unknown): Array<unknown> {
    return Array.isArray(value) ? value : [];
  }

  private static readString(value: unknown): string | null {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }

    return null;
  }
}
