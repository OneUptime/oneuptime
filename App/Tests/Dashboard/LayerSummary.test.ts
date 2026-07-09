import {
  summarizeRotation,
  summarizeRestriction,
  summarizeHandOff,
  summarizeStartsAt,
} from "../../FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerSummary";
import Recurring from "Common/Types/Events/Recurring";
import EventInterval from "Common/Types/Events/EventInterval";
import PositiveNumber from "Common/Types/PositiveNumber";
import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "Common/Types/OnCallDutyPolicy/RestrictionTimes";
import DayOfWeek from "Common/Types/Day/DayOfWeek";
import OneUptimeDate from "Common/Types/Date";

function rotation(intervalType: EventInterval, count: number): Recurring {
  const r: Recurring = new Recurring();
  r.intervalType = intervalType;
  r.intervalCount = new PositiveNumber(count);
  return r;
}

const NY: string = "America/New_York";

// An instant that reads y-mo(0-based)-d h:mi in the given timezone.
function tzInstant(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  tz: string,
): Date {
  return OneUptimeDate.getInstantFromLocalWallClockInTimezone(
    new Date(y, mo, d, h, mi, 0),
    tz,
  );
}

describe("LayerSummary.summarizeRotation", () => {
  test("singular adjective for count <= 1 across interval types", () => {
    expect(summarizeRotation(rotation(EventInterval.Hour, 1))).toBe(
      "Rotates hourly",
    );
    expect(summarizeRotation(rotation(EventInterval.Day, 1))).toBe(
      "Rotates daily",
    );
    expect(summarizeRotation(rotation(EventInterval.Week, 1))).toBe(
      "Rotates weekly",
    );
    expect(summarizeRotation(rotation(EventInterval.Month, 1))).toBe(
      "Rotates monthly",
    );
    expect(summarizeRotation(rotation(EventInterval.Year, 1))).toBe(
      "Rotates yearly",
    );
  });

  test("plural for count > 1", () => {
    expect(summarizeRotation(rotation(EventInterval.Day, 2))).toBe(
      "Rotates every 2 days",
    );
    expect(summarizeRotation(rotation(EventInterval.Hour, 3))).toBe(
      "Rotates every 3 hours",
    );
    expect(summarizeRotation(rotation(EventInterval.Week, 4))).toBe(
      "Rotates every 4 weeks",
    );
  });

  test("undefined rotation", () => {
    expect(summarizeRotation(undefined)).toBe("No rotation");
  });
});

describe("LayerSummary.summarizeRestriction", () => {
  test("undefined / None => 24/7", () => {
    expect(summarizeRestriction(undefined)).toBe("On call 24/7");
    const none: RestrictionTimes = new RestrictionTimes();
    none.restictionType = RestrictionType.None;
    expect(summarizeRestriction(none)).toBe("On call 24/7");
  });

  test("Daily without timezone uses local wall-clock and no tz suffix", () => {
    const r: RestrictionTimes = new RestrictionTimes();
    r.restictionType = RestrictionType.Daily;
    r.dayRestrictionTimes = {
      startTime: new Date(2025, 0, 6, 9, 0, 0),
      endTime: new Date(2025, 0, 6, 17, 0, 0),
    };
    const out: string = summarizeRestriction(r, undefined);
    expect(out.startsWith("Daily ")).toBe(true);
    expect(out).not.toContain("(");
  });

  test("Daily WITH timezone renders in the schedule tz and appends the tz suffix (F10)", () => {
    const r: RestrictionTimes = new RestrictionTimes();
    r.restictionType = RestrictionType.Daily;
    r.dayRestrictionTimes = {
      startTime: tzInstant(2025, 0, 6, 9, 0, NY),
      endTime: tzInstant(2025, 0, 6, 17, 0, NY),
    };
    const out: string = summarizeRestriction(r, NY);
    expect(out).toContain(`(${NY})`);
    // Hours reflect NY wall-clock (09/17 in 24h, or 9/5 in 12h).
    expect(out).toMatch(/(09|9).*(17|5)/);
  });

  test("Weekly single window derives the weekday from the timestamp, not the enum (H5)", () => {
    const r: RestrictionTimes = new RestrictionTimes();
    r.restictionType = RestrictionType.Weekly;
    /*
     * Enum claims Friday, but the timestamp is a WEDNESDAY (2025-01-08). The
     * engine uses the timestamp's weekday, so the summary must say Wednesday.
     */
    const w: WeeklyResctriction = {
      startDay: DayOfWeek.Friday,
      endDay: DayOfWeek.Friday,
      startTime: tzInstant(2025, 0, 8, 9, 0, NY), // Wednesday
      endTime: tzInstant(2025, 0, 8, 17, 0, NY), // Wednesday
    };
    r.weeklyRestrictionTimes = [w];
    const out: string = summarizeRestriction(r, NY);
    expect(out).toContain("Wednesday");
    expect(out).not.toContain("Friday");
    expect(out).toContain(`(${NY})`);
  });

  test("Weekly with matching enum + timestamp shows that day", () => {
    const r: RestrictionTimes = new RestrictionTimes();
    r.restictionType = RestrictionType.Weekly;
    const w: WeeklyResctriction = {
      startDay: DayOfWeek.Monday,
      endDay: DayOfWeek.Friday,
      startTime: tzInstant(2025, 0, 6, 9, 0, NY), // Monday
      endTime: tzInstant(2025, 0, 10, 17, 0, NY), // Friday
    };
    r.weeklyRestrictionTimes = [w];
    const out: string = summarizeRestriction(r, NY);
    expect(out).toContain("Monday");
    expect(out).toContain("Friday");
  });

  test("Weekly with multiple windows summarizes the count", () => {
    const r: RestrictionTimes = new RestrictionTimes();
    r.restictionType = RestrictionType.Weekly;
    r.weeklyRestrictionTimes = [
      RestrictionTimes.getDefaultWeeklyRestrictionTIme(),
      RestrictionTimes.getDefaultWeeklyRestrictionTIme(),
    ];
    expect(summarizeRestriction(r, NY)).toBe("2 weekly time windows");
  });

  test("Weekly with no windows", () => {
    const r: RestrictionTimes = new RestrictionTimes();
    r.restictionType = RestrictionType.Weekly;
    r.weeklyRestrictionTimes = [];
    expect(summarizeRestriction(r, NY)).toBe(
      "Restricted to specific times each week",
    );
  });
});

describe("LayerSummary.summarizeHandOff / summarizeStartsAt", () => {
  test("handoff null / set", () => {
    expect(summarizeHandOff(undefined)).toBeNull();
    expect(summarizeHandOff(new Date(2025, 0, 6, 9, 0, 0))).toContain(
      "Hands off at",
    );
  });

  test("startsAt not set / set", () => {
    expect(summarizeStartsAt(undefined)).toBe("Start time not set");
    expect(summarizeStartsAt(new Date(2025, 0, 6, 9, 0, 0))).toContain(
      "Starts",
    );
  });
});
