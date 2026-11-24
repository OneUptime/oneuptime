import { JSONObject } from "Common/Types/JSON";
import WorkingHours, {
  SimpleWorkingHours,
} from "Common/Types/OnCallDutyPolicy/WorkingHours";

/*
 * THE CASES THE PROVIDER'S ACTIVE HOURS ARE CHECKED AGAINST
 * (OneUptime/oneuptime#10822).
 *
 * A monitor criteria's active hours are kept as an on-call rule's working
 * hours are (RestrictionTimes): a weekly window a day, from one moment to
 * another, read on the clock of activeHoursTimezone. The provider takes them
 * as the dashboard's picker sets them - the same hours on the days picked,
 * active_hours - and converts them both ways in Go (StaticFiles/
 * monitorsteps.go). It has to convert them exactly as the server's
 * WorkingHours.fromSimpleHours and toSimpleHours do: if it writes other
 * moments, the server reads other hours; if it reads them otherwise, hours
 * set in the dashboard plan a change, or are dropped by the next apply.
 *
 * So the generator writes what the server's own code writes and reads for
 * each of these hours into the provider
 * (internal/provider/testdata/monitor_steps_active_hours.json), and the
 * provider's Go test converts every case and fails where it differs:
 *   - written: hours as a configuration writes them, the moments the server
 *     keeps for them, and the hours it reads back from those;
 *   - stored: hours as the dashboard, an on-call layer or an API caller may
 *     have kept them, and the hours the server reads from them - none, when
 *     they are not the same hours on each day.
 */

export interface ActiveHoursWrittenCase {
  name: string;
  days: Array<number>;
  from: string;
  to: string;
  timezone: string;
  // RestrictionTimes as WorkingHours.fromSimpleHours writes them.
  stored: JSONObject;
  // As WorkingHours.toSimpleHours reads them back.
  readBack: SimpleWorkingHours | null;
}

export interface ActiveHoursStoredCase {
  name: string;
  timezone: string;
  stored: JSONObject;
  readBack: SimpleWorkingHours | null;
}

export interface MonitorStepsActiveHoursCases {
  about: string;
  written: Array<ActiveHoursWrittenCase>;
  stored: Array<ActiveHoursStoredCase>;
}

// Hours a configuration writes: zones east and west, overnight, odd offsets.
const WRITTEN: Array<Omit<ActiveHoursWrittenCase, "stored" | "readBack">> = [
  {
    name: "weekdays in Oslo",
    days: [0, 1, 2, 3, 4],
    from: "08:00",
    to: "18:00",
    timezone: "Europe/Oslo",
  },
  {
    name: "overnight in New York, Friday to Sunday",
    days: [4, 5, 6],
    from: "22:00",
    to: "06:00",
    timezone: "America/New_York",
  },
  {
    name: "days written twice and out of order, in Kolkata",
    days: [6, 0, 3, 3],
    from: "09:30",
    to: "17:45",
    timezone: "Asia/Kolkata",
  },
  {
    name: "a quarter-hour offset, in Kathmandu",
    days: [1, 2],
    from: "09:00",
    to: "17:00",
    timezone: "Asia/Kathmandu",
  },
  {
    name: "Saturday in Sydney, on summer time in January",
    days: [5],
    from: "10:00",
    to: "11:00",
    timezone: "Australia/Sydney",
  },
  {
    name: "every day in Tokyo, all day but a minute",
    days: [0, 1, 2, 3, 4, 5, 6],
    from: "00:00",
    to: "23:59",
    timezone: "Asia/Tokyo",
  },
  {
    name: "the last hour of Sunday, ending at midnight",
    days: [6],
    from: "23:00",
    to: "00:00",
    timezone: "UTC",
  },
  {
    name: "an hour written with one digit",
    days: [0],
    from: "8:00",
    to: "9:30",
    timezone: "Europe/London",
  },
  {
    name: "a zone the server does not know is written on UTC's clock",
    days: [2],
    from: "10:00",
    to: "11:00",
    timezone: "Atlantis/Lost_City",
  },
];

const restrictionTimes: (value: JSONObject) => JSONObject = (
  value: JSONObject,
): JSONObject => {
  return { _type: "RestrictionTimes", value: value };
};

const moment: (iso: string) => JSONObject = (iso: string): JSONObject => {
  return { _type: "DateTime", value: iso };
};

// Hours kept in other ways than a configuration writes them.
const STORED: Array<Omit<ActiveHoursStoredCase, "readBack">> = [
  {
    name: "different hours on two days",
    timezone: "UTC",
    stored: restrictionTimes({
      restictionType: "Weekly",
      dayRestrictionTimes: null,
      weeklyRestrictionTimes: [
        {
          startDay: "Monday",
          endDay: "Monday",
          startTime: moment("2026-01-12T08:00:00.000Z"),
          endTime: moment("2026-01-12T16:00:00.000Z"),
        },
        {
          startDay: "Tuesday",
          endDay: "Tuesday",
          startTime: moment("2026-01-13T09:00:00.000Z"),
          endTime: moment("2026-01-13T12:00:00.000Z"),
        },
      ],
    }),
  },
  {
    name: "a daily window, as an on-call layer keeps one",
    timezone: "Europe/Berlin",
    stored: restrictionTimes({
      restictionType: "Daily",
      dayRestrictionTimes: {
        startTime: moment("2026-03-02T07:00:00.000Z"),
        endTime: moment("2026-03-02T15:00:00.000Z"),
      },
      weeklyRestrictionTimes: [],
    }),
  },
  {
    name: "over a weekend, Friday evening to Monday morning",
    timezone: "UTC",
    stored: restrictionTimes({
      restictionType: "Weekly",
      dayRestrictionTimes: null,
      weeklyRestrictionTimes: [
        {
          startDay: "Friday",
          endDay: "Monday",
          startTime: moment("2026-01-16T17:00:00.000Z"),
          endTime: moment("2026-01-19T09:00:00.000Z"),
        },
      ],
    }),
  },
  {
    name: "moments kept as their text, in another week",
    timezone: "America/Chicago",
    stored: restrictionTimes({
      restictionType: "Weekly",
      dayRestrictionTimes: null,
      weeklyRestrictionTimes: [
        {
          startDay: "Wednesday",
          endDay: "Wednesday",
          startTime: "2026-07-15T13:00:00.000Z",
          endTime: "2026-07-15T21:00:00.000Z",
        },
      ],
    }),
  },
  {
    name: "a window that ends when it starts",
    timezone: "UTC",
    stored: restrictionTimes({
      restictionType: "Weekly",
      dayRestrictionTimes: null,
      weeklyRestrictionTimes: [
        {
          startDay: "Monday",
          endDay: "Monday",
          startTime: moment("2026-01-12T08:00:00.000Z"),
          endTime: moment("2026-01-12T08:00:00.000Z"),
        },
      ],
    }),
  },
  {
    name: "no windows at all",
    timezone: "UTC",
    stored: restrictionTimes({
      restictionType: "Weekly",
      dayRestrictionTimes: null,
      weeklyRestrictionTimes: [],
    }),
  },
  {
    name: "no restriction",
    timezone: "UTC",
    stored: restrictionTimes({
      restictionType: "None",
      dayRestrictionTimes: null,
      weeklyRestrictionTimes: [],
    }),
  },
  {
    name: "weekday office hours read in a zone the server does not know",
    timezone: "Atlantis/Lost_City",
    stored: WorkingHours.fromSimpleHours({
      days: [0, 1, 2, 3, 4],
      from: "08:00",
      to: "18:00",
      timezone: "UTC",
    }).toJSON(),
  },
];

const readBack: (data: {
  stored: JSONObject;
  timezone: string;
}) => SimpleWorkingHours | null = (data: {
  stored: JSONObject;
  timezone: string;
}): SimpleWorkingHours | null => {
  return WorkingHours.toSimpleHours({
    hours: data.stored,
    timezone: data.timezone,
  });
};

export function buildMonitorStepsActiveHoursCases(): MonitorStepsActiveHoursCases {
  return {
    about:
      "Written by Scripts/TerraformProvider/Core/MonitorStepsActiveHoursCases.ts from the server's own WorkingHours.fromSimpleHours and toSimpleHours (OneUptime/oneuptime#10822). Do not edit.",
    written: WRITTEN.map(
      (
        written: Omit<ActiveHoursWrittenCase, "stored" | "readBack">,
      ): ActiveHoursWrittenCase => {
        const stored: JSONObject = WorkingHours.fromSimpleHours({
          days: written.days,
          from: written.from,
          to: written.to,
          timezone: written.timezone,
        }).toJSON();

        return {
          ...written,
          stored: stored,
          readBack: readBack({ stored: stored, timezone: written.timezone }),
        };
      },
    ),
    stored: STORED.map(
      (
        stored: Omit<ActiveHoursStoredCase, "readBack">,
      ): ActiveHoursStoredCase => {
        return { ...stored, readBack: readBack(stored) };
      },
    ),
  };
}

// The file's name, in the provider's internal/provider/testdata.
export const MONITOR_STEPS_ACTIVE_HOURS_CASES_FILE: string =
  "monitor_steps_active_hours.json";

// The file the provider's Go test reads, as the generator writes it.
export function monitorStepsActiveHoursCasesFile(): string {
  return `${JSON.stringify(buildMonitorStepsActiveHoursCases(), null, 2)}\n`;
}
