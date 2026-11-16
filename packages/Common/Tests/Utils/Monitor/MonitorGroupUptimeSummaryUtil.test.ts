import { JSONObject } from "../../../Types/JSON";
import { MonitorGroupUptimeSummary } from "../../../Types/Monitor/MonitorGroupUptimeSummary";
import ObjectID from "../../../Types/ObjectID";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import MonitorGroupUptimeSummaryUtil from "../../../Utils/Monitor/MonitorGroupUptimeSummaryUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * A monitor group's uptime history on the wire (issue #6886): what
 * GET /monitor-group/uptime-summary/:monitorGroupId sends the Dashboard's
 * monitor group page, and how the page reads it and its percentage.
 */

const GROUP_ID: string = "68863000-0000-4000-8000-000000000001";
const OPERATIONAL_ID: string = "68863000-0000-4000-8000-0000000000a1";
const OFFLINE_ID: string = "68863000-0000-4000-8000-0000000000a3";

function summary(
  overrides?: Partial<MonitorGroupUptimeSummary>,
): MonitorGroupUptimeSummary {
  return {
    monitorGroupId: new ObjectID(GROUP_ID),
    timezone: "Asia/Kolkata",
    generatedAt: new Date("2026-09-21T06:30:00.000Z"),
    startDate: new Date("2026-06-23T18:30:00.000Z"),
    endDate: new Date("2026-09-21T06:30:00.000Z"),
    buckets: [
      {
        bucketStart: new Date("2026-09-19T18:30:00.000Z"),
        bucketEnd: new Date("2026-09-20T18:30:00.000Z"),
        daySeconds: 86400,
        coveredSeconds: 86400,
        statusDurations: [
          { monitorStatusId: new ObjectID(OPERATIONAL_ID), seconds: 82800 },
          { monitorStatusId: new ObjectID(OFFLINE_ID), seconds: 3600 },
        ],
      },
      {
        bucketStart: new Date("2026-09-20T18:30:00.000Z"),
        bucketEnd: new Date("2026-09-21T06:30:00.000Z"),
        daySeconds: 43200,
        coveredSeconds: 0,
        statusDurations: [],
        monitoringOffSeconds: 43200,
      },
    ],
    coveredSeconds: 86400,
    downtimeSeconds: 3600,
    ...overrides,
  };
}

describe("MonitorGroupUptimeSummaryUtil", () => {
  test("round-trips through the wire format: plain ISO and id strings, the time with monitoring off kept", () => {
    const json: JSONObject = MonitorGroupUptimeSummaryUtil.toJSON(summary());

    expect(json["monitorGroupId"]).toBe(GROUP_ID);
    expect(json["startDate"]).toBe("2026-06-23T18:30:00.000Z");
    expect(json["timezone"]).toBe("Asia/Kolkata");
    expect(json["coveredSeconds"]).toBe(86400);
    expect(json["downtimeSeconds"]).toBe(3600);

    const parsed: MonitorGroupUptimeSummary | null =
      MonitorGroupUptimeSummaryUtil.fromJSON(
        JSON.parse(JSON.stringify(json)) as JSONObject,
      );

    expect(parsed).toEqual(summary());
  });

  test.each([
    ["nothing", null],
    ["an array", [] as unknown as JSONObject],
    ["no group id", { startDate: "2026-06-23T18:30:00.000Z" } as JSONObject],
    [
      "no window",
      { monitorGroupId: GROUP_ID, buckets: [] } as unknown as JSONObject,
    ],
    [
      "no buckets",
      {
        monitorGroupId: GROUP_ID,
        startDate: "2026-06-23T18:30:00.000Z",
        endDate: "2026-09-21T06:30:00.000Z",
      } as JSONObject,
    ],
  ])(
    "reads %s as no summary, so the page draws from the group's rows",
    (_name: string, json: JSONObject | null) => {
      expect(MonitorGroupUptimeSummaryUtil.fromJSON(json)).toBeNull();
    },
  );

  test("reads a total that is not a positive number as none, a missing zone as UTC, and skips a malformed bucket", () => {
    const parsed: MonitorGroupUptimeSummary | null =
      MonitorGroupUptimeSummaryUtil.fromJSON({
        monitorGroupId: GROUP_ID,
        startDate: "2026-06-23T18:30:00.000Z",
        endDate: "2026-09-21T06:30:00.000Z",
        buckets: [{ bucketStart: "not a date" }],
        coveredSeconds: "not a number",
        downtimeSeconds: -5,
      } as unknown as JSONObject);

    expect(parsed?.timezone).toBe("UTC");
    expect(parsed?.buckets).toEqual([]);
    expect(parsed?.coveredSeconds).toBe(0);
    expect(parsed?.downtimeSeconds).toBe(0);
    // generatedAt falls back to the window's end.
    expect(parsed?.generatedAt.toISOString()).toBe("2026-09-21T06:30:00.000Z");
  });

  test("its percentage is the uptime of the time measured, rounded down to the precision", () => {
    // (86400 - 3600) / 86400 = 95.8333...%
    expect(
      MonitorGroupUptimeSummaryUtil.getUptimePercent({
        summary: summary(),
        precision: UptimePrecision.THREE_DECIMAL,
      }),
    ).toBe(95.833);
    expect(
      MonitorGroupUptimeSummaryUtil.getUptimePercent({
        summary: summary(),
        precision: UptimePrecision.NO_DECIMAL,
      }),
    ).toBe(95);
  });

  test("nothing measured is no percentage, not 100%; downtime never counts for more than was measured", () => {
    expect(
      MonitorGroupUptimeSummaryUtil.getUptimePercent({
        summary: summary({ coveredSeconds: 0, downtimeSeconds: 0 }),
        precision: UptimePrecision.THREE_DECIMAL,
      }),
    ).toBeNull();

    expect(
      MonitorGroupUptimeSummaryUtil.getUptimePercent({
        summary: summary({ coveredSeconds: 3600, downtimeSeconds: 7200 }),
        precision: UptimePrecision.THREE_DECIMAL,
      }),
    ).toBe(0);
  });
});
