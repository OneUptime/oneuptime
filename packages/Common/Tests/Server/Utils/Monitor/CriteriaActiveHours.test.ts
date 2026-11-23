import CriteriaActiveHours from "../../../../Server/Utils/Monitor/CriteriaActiveHours";
import logger from "../../../../Server/Utils/Logger";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../Types/JSON";
import { CheckOn, FilterType } from "../../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance, {
  MonitorCriteriaInstanceType,
} from "../../../../Types/Monitor/MonitorCriteriaInstance";
import WorkingHours from "../../../../Types/OnCallDutyPolicy/WorkingHours";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A criteria judged only on some days and at some times (#10355): its
 * active hours read on its own time zone's clock, across zones and across
 * the days the clocks change.
 */

const WEEKDAYS: Array<number> = [0, 1, 2, 3, 4];
const EVERY_DAY: Array<number> = [0, 1, 2, 3, 4, 5, 6];

function criteriaWith(input: {
  days: Array<number>;
  from: string;
  to: string;
  timezone: string;
}): MonitorCriteriaInstanceType {
  return {
    id: "Unstable during business hours",
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: [
      { checkOn: CheckOn.IsOnline, filterType: FilterType.False, value: undefined },
    ],
    incidents: [],
    alerts: [],
    name: "Unstable during business hours",
    description: "",
    activeHours: WorkingHours.fromSimpleHours({
      days: input.days,
      from: input.from,
      to: input.to,
      timezone: input.timezone,
    }).toJSON(),
    activeHoursTimezone: input.timezone,
  };
}

function isActiveAt(
  criteria: MonitorCriteriaInstanceType,
  utc: string,
): boolean {
  return CriteriaActiveHours.isActive({ criteria: criteria, at: new Date(utc) });
}

describe("CriteriaActiveHours.isActive", () => {
  beforeEach(() => {
    jest.spyOn(logger, "debug").mockImplementation(() => {
      return undefined as never;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a criteria with no active hours is judged at every check", () => {
    const criteria: MonitorCriteriaInstanceType = criteriaWith({
      days: WEEKDAYS,
      from: "08:00",
      to: "18:00",
      timezone: "Europe/Oslo",
    });
    delete criteria.activeHours;

    expect(isActiveAt(criteria, "2026-11-22T03:00:00Z")).toBe(true);
    expect(CriteriaActiveHours.isActive({ criteria: undefined })).toBe(true);
  });

  test("business hours in Oslo: Monday to Friday, 08:00 to 18:00 on Oslo's clock", () => {
    const criteria: MonitorCriteriaInstanceType = criteriaWith({
      days: WEEKDAYS,
      from: "08:00",
      to: "18:00",
      timezone: "Europe/Oslo",
    });

    // Monday 23 November 2026, Oslo is UTC+1.
    expect(isActiveAt(criteria, "2026-11-23T06:59:00Z")).toBe(false);
    expect(isActiveAt(criteria, "2026-11-23T07:00:00Z")).toBe(true);
    expect(isActiveAt(criteria, "2026-11-23T16:59:00Z")).toBe(true);
    expect(isActiveAt(criteria, "2026-11-23T17:00:00Z")).toBe(false);
    // Saturday and Sunday are off.
    expect(isActiveAt(criteria, "2026-11-21T10:00:00Z")).toBe(false);
    expect(isActiveAt(criteria, "2026-11-22T10:00:00Z")).toBe(false);
  });

  test("the same moment is inside one zone's hours and outside another's", () => {
    const hours: { days: Array<number>; from: string; to: string } = {
      days: WEEKDAYS,
      from: "08:00",
      to: "18:00",
    };

    // 07:30 UTC on a Monday: 08:30 in Oslo, 02:30 in New York, 16:30 in Tokyo.
    const at: string = "2026-11-23T07:30:00Z";

    expect(
      isActiveAt(criteriaWith({ ...hours, timezone: "Europe/Oslo" }), at),
    ).toBe(true);
    expect(
      isActiveAt(criteriaWith({ ...hours, timezone: "America/New_York" }), at),
    ).toBe(false);
    expect(
      isActiveAt(criteriaWith({ ...hours, timezone: "Asia/Tokyo" }), at),
    ).toBe(true);
  });

  test("08:00 in Oslo stays 08:00 on the Monday after the clocks spring forward", () => {
    const criteria: MonitorCriteriaInstanceType = criteriaWith({
      days: WEEKDAYS,
      from: "08:00",
      to: "18:00",
      timezone: "Europe/Oslo",
    });

    // Friday 27 March 2026, before the change: Oslo is UTC+1.
    expect(isActiveAt(criteria, "2026-03-27T06:59:00Z")).toBe(false);
    expect(isActiveAt(criteria, "2026-03-27T07:00:00Z")).toBe(true);
    // Monday 30 March 2026, after it: Oslo is UTC+2.
    expect(isActiveAt(criteria, "2026-03-30T05:59:00Z")).toBe(false);
    expect(isActiveAt(criteria, "2026-03-30T06:00:00Z")).toBe(true);
    expect(isActiveAt(criteria, "2026-03-30T15:59:00Z")).toBe(true);
    expect(isActiveAt(criteria, "2026-03-30T16:00:00Z")).toBe(false);
  });

  test("09:00 in New York holds across the change of March 8 and the one of November 1", () => {
    const criteria: MonitorCriteriaInstanceType = criteriaWith({
      days: EVERY_DAY,
      from: "09:00",
      to: "17:00",
      timezone: "America/New_York",
    });

    // Saturday 7 March 2026: EST, UTC-5.
    expect(isActiveAt(criteria, "2026-03-07T13:59:00Z")).toBe(false);
    expect(isActiveAt(criteria, "2026-03-07T14:00:00Z")).toBe(true);
    // Monday 9 March 2026: EDT, UTC-4.
    expect(isActiveAt(criteria, "2026-03-09T12:59:00Z")).toBe(false);
    expect(isActiveAt(criteria, "2026-03-09T13:00:00Z")).toBe(true);
    // Monday 2 November 2026: back on EST.
    expect(isActiveAt(criteria, "2026-11-02T13:59:00Z")).toBe(false);
    expect(isActiveAt(criteria, "2026-11-02T14:00:00Z")).toBe(true);
  });

  test("hours that end earlier than they start run into the next morning", () => {
    const criteria: MonitorCriteriaInstanceType = criteriaWith({
      days: EVERY_DAY,
      from: "22:00",
      to: "06:00",
      timezone: "UTC",
    });

    expect(isActiveAt(criteria, "2026-11-23T21:59:00Z")).toBe(false);
    expect(isActiveAt(criteria, "2026-11-23T22:00:00Z")).toBe(true);
    expect(isActiveAt(criteria, "2026-11-24T05:59:00Z")).toBe(true);
    expect(isActiveAt(criteria, "2026-11-24T06:00:00Z")).toBe(false);
  });

  test("hours that cannot be read never silence the criteria: it is judged at every check", () => {
    const unknownZone: MonitorCriteriaInstanceType = {
      ...criteriaWith({
        days: WEEKDAYS,
        from: "08:00",
        to: "18:00",
        timezone: "UTC",
      }),
      activeHoursTimezone: "Mars/Olympus_Mons",
    };

    expect(isActiveAt(unknownZone, "2026-11-22T03:00:00Z")).toBe(true);

    // ... and a save refuses them.
    expect(MonitorCriteriaInstance.getActiveHoursError(unknownZone)).toBe(
      'Active hours of criteria "Unstable during business hours": choose the time zone the hours are in.',
    );
  });

  test("active hours survive a round trip through the criteria's JSON", () => {
    const criteria: MonitorCriteriaInstanceType = criteriaWith({
      days: WEEKDAYS,
      from: "08:00",
      to: "18:00",
      timezone: "Europe/Oslo",
    });

    const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
    instance.data = criteria;

    const json: JSONObject = JSON.parse(JSON.stringify(instance.toJSON()));
    const read: MonitorCriteriaInstance = MonitorCriteriaInstance.fromJSON(json);

    expect(read.data?.activeHoursTimezone).toBe("Europe/Oslo");
    expect(isActiveAt(read.data!, "2026-11-23T07:00:00Z")).toBe(true);
    expect(isActiveAt(read.data!, "2026-11-23T06:59:00Z")).toBe(false);
    expect(MonitorCriteriaInstance.getActiveHoursError(read.data)).toBeNull();
  });
});
