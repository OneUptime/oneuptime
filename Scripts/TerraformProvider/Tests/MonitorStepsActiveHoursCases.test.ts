/*
 * THE CASES THE PROVIDER'S ACTIVE HOURS ARE CHECKED AGAINST
 * (Core/MonitorStepsActiveHoursCases.ts, OneUptime/oneuptime#10822).
 *
 * The provider's Go test (StaticFiles/monitorsteps_recovery_activehours_test.go)
 * checks every case it is handed against its own conversions of a criteria's
 * active hours. These hold the cases to the server's own WorkingHours, to
 * the hours a person can check by eye, and to the generator writing them
 * where the Go test reads them.
 */

import fs from "fs";
import path from "path";
import {
  ActiveHoursStoredCase,
  ActiveHoursWrittenCase,
  MONITOR_STEPS_ACTIVE_HOURS_CASES_FILE,
  MonitorStepsActiveHoursCases,
  buildMonitorStepsActiveHoursCases,
  monitorStepsActiveHoursCasesFile,
} from "../Core/MonitorStepsActiveHoursCases";
import WorkingHours from "Common/Types/OnCallDutyPolicy/WorkingHours";
import { JSONObject } from "Common/Types/JSON";

const cases: MonitorStepsActiveHoursCases = buildMonitorStepsActiveHoursCases();

function written(name: string): ActiveHoursWrittenCase {
  const found: ActiveHoursWrittenCase | undefined = cases.written.find(
    (c: ActiveHoursWrittenCase): boolean => {
      return c.name === name;
    },
  );

  if (!found) {
    throw new Error(`No written case ${name}`);
  }

  return found;
}

function stored(name: string): ActiveHoursStoredCase {
  const found: ActiveHoursStoredCase | undefined = cases.stored.find(
    (c: ActiveHoursStoredCase): boolean => {
      return c.name === name;
    },
  );

  if (!found) {
    throw new Error(`No stored case ${name}`);
  }

  return found;
}

// The moments of a stored case's windows, "Monday 2026-01-12T07:00:00.000Z".
function moments(hours: JSONObject): Array<string> {
  const value: JSONObject = hours["value"] as JSONObject;

  return (value["weeklyRestrictionTimes"] as Array<JSONObject>).map(
    (window: JSONObject): string => {
      return `${window["startDay"]} ${(window["startTime"] as JSONObject)["value"]} - ${window["endDay"]} ${(window["endTime"] as JSONObject)["value"]}`;
    },
  );
}

describe("the active hours cases", () => {
  test("each written case is what the server writes and reads for it", () => {
    for (const c of cases.written) {
      const keeps: JSONObject = WorkingHours.fromSimpleHours({
        days: c.days,
        from: c.from,
        to: c.to,
        timezone: c.timezone,
      }).toJSON();

      expect(c.stored).toEqual(keeps);
      expect(c.readBack).toEqual(
        WorkingHours.toSimpleHours({ hours: keeps, timezone: c.timezone }),
      );
    }
  });

  test("weekdays from 08:00 to 18:00 in Oslo are kept on UTC's clock in the week no clock changes", () => {
    expect(moments(written("weekdays in Oslo").stored)).toEqual([
      "Monday 2026-01-12T07:00:00.000Z - Monday 2026-01-12T17:00:00.000Z",
      "Tuesday 2026-01-13T07:00:00.000Z - Tuesday 2026-01-13T17:00:00.000Z",
      "Wednesday 2026-01-14T07:00:00.000Z - Wednesday 2026-01-14T17:00:00.000Z",
      "Thursday 2026-01-15T07:00:00.000Z - Thursday 2026-01-15T17:00:00.000Z",
      "Friday 2026-01-16T07:00:00.000Z - Friday 2026-01-16T17:00:00.000Z",
    ]);
    expect(written("weekdays in Oslo").readBack).toEqual({
      days: [0, 1, 2, 3, 4],
      from: "08:00",
      to: "18:00",
    });
  });

  test("hours that end earlier than they begin end the next morning, Sunday's on Monday", () => {
    expect(
      moments(written("overnight in New York, Friday to Sunday").stored),
    ).toEqual([
      "Friday 2026-01-17T03:00:00.000Z - Saturday 2026-01-17T11:00:00.000Z",
      "Saturday 2026-01-18T03:00:00.000Z - Sunday 2026-01-18T11:00:00.000Z",
      "Sunday 2026-01-19T03:00:00.000Z - Monday 2026-01-19T11:00:00.000Z",
    ]);
  });

  test("days written twice or out of order are kept once, in week order", () => {
    expect(
      written("days written twice and out of order, in Kolkata").readBack,
    ).toEqual({ days: [0, 3, 6], from: "09:30", to: "17:45" });
  });

  test("an hour written with one digit reads back with two", () => {
    expect(written("an hour written with one digit").readBack).toEqual({
      days: [0],
      from: "08:00",
      to: "09:30",
    });
  });

  test("hours that are not the same on each day, or in a zone nobody knows, read as none", () => {
    expect(stored("different hours on two days").readBack).toBeNull();
    expect(
      stored("over a weekend, Friday evening to Monday morning").readBack,
    ).toBeNull();
    expect(stored("a window that ends when it starts").readBack).toBeNull();
    expect(stored("no windows at all").readBack).toBeNull();
    expect(stored("no restriction").readBack).toBeNull();
    expect(
      stored("weekday office hours read in a zone the server does not know")
        .readBack,
    ).toBeNull();
    expect(
      written("a zone the server does not know is written on UTC's clock")
        .readBack,
    ).toBeNull();
  });

  test("a daily window reads as every day, and moments kept as text are read", () => {
    expect(
      stored("a daily window, as an on-call layer keeps one").readBack,
    ).toEqual({ days: [0, 1, 2, 3, 4, 5, 6], from: "08:00", to: "16:00" });
    expect(
      stored("moments kept as their text, in another week").readBack,
    ).toEqual({ days: [2], from: "08:00", to: "16:00" });
  });
});

describe("the generator writes them where the provider's Go test reads them", () => {
  test("as JSON the Go test reads", () => {
    const file: MonitorStepsActiveHoursCases = JSON.parse(
      monitorStepsActiveHoursCasesFile(),
    ) as MonitorStepsActiveHoursCases;

    expect(file.written).toHaveLength(cases.written.length);
    expect(file.stored).toHaveLength(cases.stored.length);
    expect(MONITOR_STEPS_ACTIVE_HOURS_CASES_FILE).toBe(
      "monitor_steps_active_hours.json",
    );
  });

  test("into internal/provider/testdata, beside the Go test that reads them", () => {
    const generator: string = fs.readFileSync(
      path.join(__dirname, "..", "Core", "ResourceGenerator.ts"),
      "utf-8",
    );
    const goTest: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "StaticFiles",
        "monitorsteps_recovery_activehours_test.go",
      ),
      "utf-8",
    );

    expect(generator).toContain("MONITOR_STEPS_ACTIVE_HOURS_CASES_FILE,");
    expect(generator).toContain('"monitorsteps_recovery_activehours_test.go"');
    expect(goTest).toContain(
      `filepath.Join("testdata", "${MONITOR_STEPS_ACTIVE_HOURS_CASES_FILE}")`,
    );
  });
});
