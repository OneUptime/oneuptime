import { describe, expect, test } from "@jest/globals";
import { getZoomedWindowLabel } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MetricMonitor/MetricMonitorPreview";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";

/*
 * The metric monitor preview's header names the window a zoom shows (issue
 * #4105). It used the full date on both ends - "Sep 29 2026, 05:12:00 AM
 * GMT - Sep 29 2026, 05:34:00 AM GMT" - which wrapped the card's
 * description onto a second line at 1280px and moved the chart down 23px on
 * every zoom, and back up on every reset. It now names the window the way
 * the explorers' time pickers name a custom range.
 */

function window(start: string, end: string): InBetween<Date> {
  return new InBetween<Date>(new Date(start), new Date(end));
}

describe("getZoomedWindowLabel", () => {
  test("a zoom within one day names the day once", () => {
    const zoom: InBetween<Date> = window(
      "2026-09-29T12:12:00.000Z",
      "2026-09-29T12:34:00.000Z",
    );

    const label: string = getZoomedWindowLabel(zoom);

    expect(label).toBe(
      `${OneUptimeDate.getDateAsLocalShortDateTimeString(zoom.startValue)} - ${OneUptimeDate.getLocalTimeString(
        zoom.endValue,
        { use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat() },
      )}`,
    );
    // The day appears once, not twice.
    const day: string = OneUptimeDate.getDateAsLocalShortDateTimeString(
      zoom.startValue,
    ).split(",")[0]!;
    expect(label.split(day)).toHaveLength(2);
  });

  test("a zoom across midnight names both days", () => {
    const zoom: InBetween<Date> = window(
      "2026-09-28T12:00:00.000Z",
      "2026-09-30T12:00:00.000Z",
    );

    expect(getZoomedWindowLabel(zoom)).toBe(
      `${OneUptimeDate.getDateAsLocalShortDateTimeString(zoom.startValue)} - ${OneUptimeDate.getDateAsLocalShortDateTimeString(zoom.endValue)}`,
    );
  });

  test("it is far shorter than the full date on both ends", () => {
    const zoom: InBetween<Date> = window(
      "2026-09-29T12:12:00.000Z",
      "2026-09-29T12:34:00.000Z",
    );
    const fullDates: string = `${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
      zoom.startValue,
      false,
      true,
    )} - ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
      zoom.endValue,
      false,
      true,
    )}`;

    expect(getZoomedWindowLabel(zoom).length).toBeLessThan(
      fullDates.length * 0.6,
    );
    expect(getZoomedWindowLabel(zoom)).not.toMatch(/\d{4}/);
  });
});
