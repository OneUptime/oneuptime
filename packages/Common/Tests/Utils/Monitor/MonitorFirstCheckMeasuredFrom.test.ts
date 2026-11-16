import MonitorFirstCheck, {
  MeasuredFrom,
} from "../../../Utils/Monitor/MonitorFirstCheck";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { describe, expect, test } from "@jest/globals";

/*
 * WHEN A MONITOR'S TIME STARTS TO COUNT (issue #9031).
 *
 * MonitorFirstCheck.getMeasuredFrom is the rule
 * MonitorStatusTimelineService.getMeasuredFromCte writes in SQL for the
 * status pages and the Dashboard (issue #8960), for an SLO, which measures
 * its monitors' rows itself:
 *
 *   CASE WHEN monitorType IS NULL OR monitorType = 'Manual'
 *          OR the history migration has not run THEN '-infinity'
 *        ELSE COALESCE(firstMeasuredAt, 'infinity') END
 *
 * '-infinity' is "from the start" (undefined), 'infinity' is "never" (null).
 */
describe("MonitorFirstCheck.getMeasuredFrom", () => {
  const FIRST_CHECK: Date = new Date("2026-11-10T08:30:00.000Z");

  function measuredFrom(
    monitor: {
      monitorType?: MonitorType | string | null | undefined;
      firstMeasuredAt?: Date | string | null | undefined;
    } | null,
    isUptimeHistoryReady: boolean = true,
  ): MeasuredFrom {
    return MonitorFirstCheck.getMeasuredFrom({
      monitor: monitor,
      isUptimeHistoryReady: isUptimeHistoryReady,
    });
  }

  test("a monitor something has checked counts from its first check", () => {
    expect(
      measuredFrom({
        monitorType: MonitorType.Website,
        firstMeasuredAt: FIRST_CHECK,
      }),
    ).toEqual(FIRST_CHECK);
  });

  test("a first check read as text, as JSON holds it, is read as that instant", () => {
    expect(
      measuredFrom({
        monitorType: MonitorType.API,
        firstMeasuredAt: "2026-11-10T08:30:00.000Z",
      }),
    ).toEqual(FIRST_CHECK);
  });

  test("a monitor nothing has checked yet counts never", () => {
    for (const monitorType of [
      MonitorType.Website,
      MonitorType.IncomingRequest,
      MonitorType.Server,
      MonitorType.ProbeStatus,
      MonitorType.Logs,
    ]) {
      expect(
        measuredFrom({ monitorType: monitorType, firstMeasuredAt: null }),
      ).toBeNull();
    }
  });

  test("a monitor of a type this build does not know is cut as the SQL cuts it", () => {
    expect(
      measuredFrom({ monitorType: "Some Future Type", firstMeasuredAt: null }),
    ).toBeNull();
  });

  test("a manual monitor counts from the start: its status is the one a person sets", () => {
    expect(
      measuredFrom({ monitorType: MonitorType.Manual, firstMeasuredAt: null }),
    ).toBeUndefined();
    expect(
      measuredFrom({
        monitorType: MonitorType.Manual,
        firstMeasuredAt: FIRST_CHECK,
      }),
    ).toBeUndefined();
  });

  test("a monitor of no type, one read without the column, and one not found count from the start", () => {
    expect(
      measuredFrom({ monitorType: null, firstMeasuredAt: null }),
    ).toBeUndefined();
    expect(measuredFrom({ firstMeasuredAt: FIRST_CHECK })).toBeUndefined();
    expect(measuredFrom({ monitorType: MonitorType.Ping })).toBeUndefined();
    expect(measuredFrom(null)).toBeUndefined();
  });

  test("every monitor counts from the start until the upgrade has put its history right", () => {
    expect(
      measuredFrom(
        { monitorType: MonitorType.Website, firstMeasuredAt: null },
        false,
      ),
    ).toBeUndefined();
    expect(
      measuredFrom(
        { monitorType: MonitorType.Website, firstMeasuredAt: FIRST_CHECK },
        false,
      ),
    ).toBeUndefined();
  });

  test("a first check that cannot be read counts from the start", () => {
    expect(
      measuredFrom({
        monitorType: MonitorType.Website,
        firstMeasuredAt: "not a date",
      }),
    ).toBeUndefined();
  });
});
