import moment from "moment-timezone";
import User from "../../../Models/DatabaseModels/User";
import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import MaterializedShiftUtil, {
  MaterializedShift,
  MaterializedShiftPolicy,
} from "../../../Types/OnCallDutyPolicy/MaterializedShift";
import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import { OnCallShift } from "../../../Types/OnCallDutyPolicy/ScheduleShiftUtil";

/*
 * Shared fixtures for the on-call calendar feed suites. Everything is built
 * from explicit IANA zones and fixed ISO instants (the tzInstant / hhmm idiom
 * from LayerUtilTimezone.test.ts) so the results do not depend on the zone
 * the test process happens to run in.
 */

export function user(id: string): User {
  return {
    id: {
      toString: (): string => {
        return id;
      },
    } as any,
  } as User;
}

export function rotation(
  intervalType: EventInterval,
  intervalCount: number,
): Recurring {
  return Recurring.fromJSON({
    _type: "Recurring",
    value: {
      intervalType: intervalType,
      intervalCount: { _type: "PositiveNumber", value: intervalCount },
    },
  } as any);
}

export function noRestriction(): RestrictionTimes {
  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restictionType = RestrictionType.None;
  restrictionTimes.dayRestrictionTimes = null;
  return restrictionTimes;
}

// An absolute instant that is `iso` ("YYYY-MM-DD HH:mm") wall-clock in `tz`.
export function tzInstant(iso: string, tz: string): Date {
  return moment.tz(iso, tz).toDate();
}

// Wall-clock "HH:mm" of an instant AS SEEN IN `tz`.
export function hhmm(date: Date, tz: string): string {
  return moment.tz(date, tz).format("HH:mm");
}

export function at(iso: string): Date {
  return OneUptimeDate.fromString(iso);
}

/*
 * Daily HH:mm-HH:mm restriction authored in `tz`. LayerUtil only reads the
 * wall-clock time of the two instants (keepTimeButMoveDay), so the date part
 * is irrelevant.
 */
export function dailyRestriction(
  startHHmm: string,
  endHHmm: string,
  tz: string,
): RestrictionTimes {
  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restictionType = RestrictionType.Daily;
  restrictionTimes.dayRestrictionTimes = {
    startTime: tzInstant(`2026-01-05 ${startHHmm}`, tz),
    endTime: tzInstant(`2026-01-05 ${endHHmm}`, tz),
  };
  return restrictionTimes;
}

/*
 * Office hours, Mon-Fri 09:00-17:00 in `tz`, authored as five weekday windows
 * on the week of Monday 2026-01-05. The engine derives the enforced weekday
 * from each instant's weekday in `tz`.
 */
export function businessHoursRestriction(tz: string): RestrictionTimes {
  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restictionType = RestrictionType.Weekly;
  restrictionTimes.weeklyRestrictionTimes = [
    "2026-01-05",
    "2026-01-06",
    "2026-01-07",
    "2026-01-08",
    "2026-01-09",
  ].map((day: string): WeeklyResctriction => {
    const startTime: Date = tzInstant(`${day} 09:00`, tz);
    const endTime: Date = tzInstant(`${day} 17:00`, tz);
    return {
      startDay: OneUptimeDate.getDayOfWeek(startTime, tz),
      endDay: OneUptimeDate.getDayOfWeek(endTime, tz),
      startTime,
      endTime,
    };
  });
  return restrictionTimes;
}

export const DEFAULT_POLICY: MaterializedShiftPolicy = {
  policyId: "pol-1",
  policyName: "Payments Policy",
  ruleId: "rule-1",
  ruleName: "Primary",
  ruleOrder: 1,
};

export const DEFAULT_LAST_MODIFIED: Date = at("2026-08-01T10:00:00Z");

export const DASHBOARD_URL: string = "https://oneuptime.example.com/dashboard";

export type ShiftOverrides = Omit<
  Partial<MaterializedShift>,
  "scheduleTimezone"
> & {
  start: Date;
  end: Date;
  // Pass an explicit undefined to build a legacy shift with no timezone.
  scheduleTimezone?: string | undefined;
};

/*
 * A MaterializedShift with sensible defaults: Alice on the "Payments"
 * schedule (Europe/Stockholm) attached to one policy. Optional fields are only
 * added when the caller supplies them, so key presence matches what the
 * materializer would produce.
 */
export function shift(overrides: ShiftOverrides): MaterializedShift {
  const scheduleId: string = overrides.scheduleId ?? "sched-1";
  const policyVariantOf: MaterializedShift["policyVariantOf"] =
    overrides.policyVariantOf;

  const base: MaterializedShift = {
    shiftKey:
      overrides.shiftKey ??
      MaterializedShiftUtil.buildShiftKey({
        scheduleId,
        start: overrides.start,
        policyId: policyVariantOf?.policyId,
      }),
    contentHash: overrides.contentHash ?? "hash",
    projectId: overrides.projectId ?? "proj-1",
    scheduleId,
    scheduleName: overrides.scheduleName ?? "Payments",
    userId: overrides.userId ?? "user-a",
    userName: overrides.userName ?? "Alice Andersson",
    start: overrides.start,
    end: overrides.end,
    coverageSeconds:
      overrides.coverageSeconds ??
      Math.round((overrides.end.getTime() - overrides.start.getTime()) / 1000),
    policies: overrides.policies ?? [{ ...DEFAULT_POLICY }],
    isPast: overrides.isPast ?? false,
    lastModifiedAt: overrides.lastModifiedAt ?? DEFAULT_LAST_MODIFIED,
    shiftConfigVersion: overrides.shiftConfigVersion ?? 3,
  };

  if ("scheduleTimezone" in overrides) {
    if (overrides.scheduleTimezone !== undefined) {
      base.scheduleTimezone = overrides.scheduleTimezone;
    }
  } else {
    base.scheduleTimezone = "Europe/Stockholm";
  }

  if (overrides.projectName !== undefined) {
    base.projectName = overrides.projectName;
  }

  if (overrides.layerId !== undefined) {
    base.layerId = overrides.layerId;
  }

  if (overrides.layerName !== undefined) {
    base.layerName = overrides.layerName;
  }

  if (overrides.override !== undefined) {
    base.override = overrides.override;
  }

  if (policyVariantOf !== undefined) {
    base.policyVariantOf = policyVariantOf;
  }

  return base;
}

// Turn engine-derived OnCallShifts into MaterializedShifts on one schedule.
export function materialize(
  shifts: Array<OnCallShift>,
  overrides?: Partial<MaterializedShift> | undefined,
): Array<MaterializedShift> {
  return shifts.map((onCallShift: OnCallShift) => {
    const extra: Partial<MaterializedShift> = { ...(overrides ?? {}) };

    if (onCallShift.override) {
      extra.override = {
        originalUserId: onCallShift.override.originalUserId,
        originalUserName: `Name of ${onCallShift.override.originalUserId}`,
        overrideStartsAt: onCallShift.override.overrideStartsAt,
        overrideEndsAt: onCallShift.override.overrideEndsAt,
      };
    }

    if (onCallShift.layerId !== undefined) {
      extra.layerId = onCallShift.layerId;
    }

    if (onCallShift.layerName !== undefined) {
      extra.layerName = onCallShift.layerName;
    }

    return shift({
      ...extra,
      start: onCallShift.start,
      end: onCallShift.end,
      userId: onCallShift.userId,
      userName: `Name of ${onCallShift.userId}`,
      coverageSeconds: onCallShift.coverageSeconds,
    });
  });
}

// Physical lines of a serialized calendar (CRLF separated, no folding undone).
export function physicalLines(body: string): Array<string> {
  const lines: Array<string> = body.split("\r\n");
  // A well-formed body ends with CRLF, leaving one empty trailing element.
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

// Logical (unfolded) lines of a serialized calendar.
export function logicalLines(body: string): Array<string> {
  return physicalLines(body.replace(/\r\n[ \t]/g, ""));
}

// The value of the first logical line starting with `NAME:` / `NAME;`.
export function property(body: string, name: string): string | undefined {
  const line: string | undefined = logicalLines(body).find((entry: string) => {
    return entry.startsWith(`${name}:`) || entry.startsWith(`${name};`);
  });

  if (line === undefined) {
    return undefined;
  }

  return line.slice(line.indexOf(":") + 1);
}

// Every value of a repeated property (e.g. every UID in the body).
export function properties(body: string, name: string): Array<string> {
  return logicalLines(body)
    .filter((entry: string) => {
      return entry.startsWith(`${name}:`) || entry.startsWith(`${name};`);
    })
    .map((entry: string) => {
      return entry.slice(entry.indexOf(":") + 1);
    });
}

// The logical lines of each VEVENT block, in document order.
export function eventBlocks(body: string): Array<Array<string>> {
  const blocks: Array<Array<string>> = [];
  let current: Array<string> | null = null;

  for (const line of logicalLines(body)) {
    if (line === "BEGIN:VEVENT") {
      current = [];
      continue;
    }
    if (line === "END:VEVENT") {
      if (current) {
        blocks.push(current);
      }
      current = null;
      continue;
    }
    if (current) {
      current.push(line);
    }
  }

  return blocks;
}

export function blockProperty(
  block: Array<string>,
  name: string,
): string | undefined {
  const line: string | undefined = block.find((entry: string) => {
    return entry.startsWith(`${name}:`) || entry.startsWith(`${name};`);
  });
  return line === undefined ? undefined : line.slice(line.indexOf(":") + 1);
}
