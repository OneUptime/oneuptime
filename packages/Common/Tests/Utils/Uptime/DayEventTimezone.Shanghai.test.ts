/**
 * @timezone Asia/Shanghai
 */
import OneUptimeDate from "../../../Types/Date";
import DayUptimeGraphUtil from "../../../Utils/Uptime/DayUptimeGraphUtil";
import UptimeMaintenanceUtil, {
  MaintenanceWindowText,
} from "../../../Utils/Uptime/UptimeMaintenanceUtil";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A bar's day and what it lists speak one zone (issue #6697).
 *
 * A status page's bar was a UTC day, labelled "(UTC)", while its tooltip
 * listed the day's incidents on the visitor's clock: in Shanghai an
 * incident at 02:00 CST on 7 November sat under the bar of 6 November (UTC)
 * and read as the wrong day. The page now asks for its days in the
 * visitor's zone; when a bar is still drawn in another - the server could
 * not cut days in theirs - its incidents and maintenance are listed on that
 * zone's clock, named.
 */

// 07:36 UTC on 6 November is 15:36 in Shanghai.
const INCIDENT_AT: Date = new Date("2026-11-06T07:36:00.000Z");

describe("DayUptimeGraphUtil.isViewersClock", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the viewer here reads Shanghai's clock", () => {
    expect(OneUptimeDate.getCurrentTimezone()).toBe("Asia/Shanghai");
  });

  test.each([
    ["no zone of its own", undefined, true],
    ["the viewer's zone", "Asia/Shanghai", true],
    ["another zone of the same clock", "Asia/Singapore", true],
    ["UTC", "UTC", false],
    ["New York", "America/New_York", false],
    ["a name no zone has", "Mars/Olympus_Mons", true],
  ])(
    "a bar drawn in %s",
    (_: string, timezone: string | undefined, expected: boolean) => {
      expect(
        DayUptimeGraphUtil.isViewersClock({ date: INCIDENT_AT, timezone }),
      ).toBe(expected);
    },
  );

  test("follows the zone the user picked over the browser's", () => {
    jest
      .spyOn(OneUptimeDate, "getCurrentTimezone")
      .mockReturnValue("America/New_York" as never);

    expect(
      DayUptimeGraphUtil.isViewersClock({
        date: INCIDENT_AT,
        timezone: "America/New_York",
      }),
    ).toBe(true);
    expect(
      DayUptimeGraphUtil.isViewersClock({
        date: INCIDENT_AT,
        timezone: "Asia/Shanghai",
      }),
    ).toBe(false);
  });
});

describe("DayUptimeGraphUtil.formatEventTime", () => {
  test("on the viewer's clock it is the page's usual local time, with its zone", () => {
    expect(
      DayUptimeGraphUtil.formatEventTime({
        date: INCIDENT_AT,
        timezone: "Asia/Shanghai",
      }),
    ).toBe(
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        INCIDENT_AT,
        false,
      ),
    );
    expect(DayUptimeGraphUtil.formatEventTime({ date: INCIDENT_AT })).toBe(
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        INCIDENT_AT,
        false,
      ),
    );
    expect(DayUptimeGraphUtil.formatEventTime({ date: INCIDENT_AT })).toContain(
      "CST",
    );
  });

  test("on a UTC bar it is the UTC time, named - the day the bar stands for", () => {
    const text: string = DayUptimeGraphUtil.formatEventTime({
      date: INCIDENT_AT,
      timezone: "UTC",
    });

    expect(text).toBe(
      OneUptimeDate.getDateAsFormattedStringInTimezone({
        date: INCIDENT_AT,
        timezone: "UTC",
      }),
    );
    expect(text).toContain("Nov 6, 2026");
    expect(text).toContain("UTC");
    expect(text).not.toContain("CST");
  });

  test("an incident at 02:00 CST on 7 November reads as 18:00 on 6 November on a UTC bar", () => {
    const text: string = DayUptimeGraphUtil.formatEventTime({
      date: new Date("2026-11-06T18:00:00.000Z"),
      timezone: "UTC",
    });

    expect(text).toContain("Nov 6, 2026");
    expect(text).toMatch(/(18:00|6:00 PM) UTC/);
  });
});

describe("UptimeMaintenanceUtil.getWindowText in a bar's zone", () => {
  const STARTS_AT: Date = new Date("2026-11-06T18:00:00.000Z");
  const ENDS_AT: Date = new Date("2026-11-06T20:00:00.000Z");

  test("on the viewer's clock it is the window it always was", () => {
    expect(
      UptimeMaintenanceUtil.getWindowText({
        startsAt: STARTS_AT,
        endsAt: ENDS_AT,
        timezone: "Asia/Shanghai",
      }),
    ).toEqual(
      UptimeMaintenanceUtil.getWindowText({
        startsAt: STARTS_AT,
        endsAt: ENDS_AT,
      }),
    );
  });

  test("on a UTC bar the window is on the UTC clock, named: 18:00 to 20:00 UTC on 6 November", () => {
    const text: MaintenanceWindowText | null =
      UptimeMaintenanceUtil.getWindowText({
        startsAt: STARTS_AT,
        endsAt: ENDS_AT,
        timezone: "UTC",
      });

    expect(text).not.toBeNull();
    expect(text!.start).toMatch(/^Nov 6, (18:00|6:00 PM)$/);
    expect(text!.end).toMatch(/^(20:00|8:00 PM) UTC$/);

    // on the viewer's clock it would cross into 7 November.
    expect(
      UptimeMaintenanceUtil.getWindowText({
        startsAt: STARTS_AT,
        endsAt: ENDS_AT,
      })!.start,
    ).toContain("Nov 7");
  });

  test("a window that runs into the next UTC day says both dates", () => {
    const text: MaintenanceWindowText | null =
      UptimeMaintenanceUtil.getWindowText({
        startsAt: new Date("2026-11-06T22:00:00.000Z"),
        endsAt: new Date("2026-11-07T02:00:00.000Z"),
        timezone: "UTC",
      });

    expect(text!.start).toMatch(/^Nov 6, (22:00|10:00 PM)$/);
    expect(text!.end).toMatch(/^Nov 7, (02:00|2:00 AM) UTC$/);
  });

  test("names each end's zone when the window crosses a change of clocks", () => {
    // New York leaves daylight saving at 06:00 UTC on 1 November.
    const text: MaintenanceWindowText | null =
      UptimeMaintenanceUtil.getWindowText({
        startsAt: new Date("2026-11-01T04:00:00.000Z"),
        endsAt: new Date("2026-11-01T08:00:00.000Z"),
        timezone: "America/New_York",
      });

    expect(text!.start).toMatch(/EDT$/);
    expect(text!.end).toMatch(/EST$/);
  });

  test("formatWindow joins the two ends on the bar's clock too", () => {
    expect(
      UptimeMaintenanceUtil.formatWindow({
        startsAt: STARTS_AT,
        endsAt: ENDS_AT,
        timezone: "UTC",
      }),
    ).toMatch(/UTC$/);
  });
});
