import StatusPageResourceUptimeUtil from "../../../Utils/StatusPage/ResourceUptime";
import { Green, Red } from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import {
  UptimeDailyAggregate,
  UptimeDayBucket,
} from "../../../Types/StatusPage/UptimeDailyAggregate";
import { UptimeWindow } from "../../../Utils/Uptime/UptimeUtil";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import { describe, expect, test } from "@jest/globals";

/*
 * calculateUptimePercentOfResource with the day aggregate - what
 * POST /status-page-api/uptime/:statusPageId measures a monitor resource by.
 *
 * The endpoint also receives the page's timeline rows, but those come back
 * under one 10,000 row cap across every monitor on the page, newest first.
 * On a page with a flapping monitor they are the last few days of the range,
 * and a percentage taken from them is a percentage of those days.
 */

const DAY_SECONDS: number = 86400;

const MONITOR: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const GROUP_MONITOR: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MONITOR_GROUP: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);

const OPERATIONAL: MonitorStatus = new MonitorStatus();
OPERATIONAL.id = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
OPERATIONAL.name = "Operational";
OPERATIONAL.priority = 1;
OPERATIONAL.color = Green;

const OFFLINE: MonitorStatus = new MonitorStatus();
OFFLINE.id = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
OFFLINE.name = "Offline";
OFFLINE.priority = 2;
OFFLINE.color = Red;

const WINDOW: UptimeWindow = {
  startDate: new Date("2026-06-02T00:00:00.000Z"),
  endDate: new Date("2026-08-01T00:00:00.000Z"),
};

/*
 * Sixty days of buckets for `monitorId`, five minutes Offline a day for the
 * first 55 and one minute a day for the last five: 99.6759...% up.
 */
function aggregateFor(monitorId: ObjectID): UptimeDailyAggregate {
  const buckets: Array<UptimeDayBucket> = [];

  for (let index: number = 0; index < 60; index++) {
    const offline: number = index < 55 ? 300 : 60;
    const bucketStart: Date = new Date(
      WINDOW.startDate.getTime() + index * DAY_SECONDS * 1000,
    );

    buckets.push({
      bucketStart: bucketStart,
      bucketEnd: new Date(bucketStart.getTime() + DAY_SECONDS * 1000),
      daySeconds: DAY_SECONDS,
      coveredSeconds: DAY_SECONDS,
      statusDurations: [
        { monitorStatusId: OPERATIONAL.id!, seconds: DAY_SECONDS - offline },
        { monitorStatusId: OFFLINE.id!, seconds: offline },
      ],
    });
  }

  return {
    monitors: [{ monitorId: monitorId, buckets: buckets }],
    isComplete: true,
    completeFrom: null,
  };
}

function row(data: {
  monitorId: ObjectID;
  status: MonitorStatus;
  startsAt: string;
  endsAt?: string | undefined;
}): MonitorStatusTimeline {
  const item: MonitorStatusTimeline = new MonitorStatusTimeline();
  item.monitorId = data.monitorId;
  item.monitorStatus = data.status;
  item.startsAt = new Date(data.startsAt);

  if (data.endsAt) {
    item.endsAt = new Date(data.endsAt);
  }

  return item;
}

/*
 * What survives the cap for the monitor: its last minute-long outage and
 * the open row after it. Measured alone, that is 60 s down in the 43,200 s
 * from the outage to the end of the range: 99.86%.
 */
function cappedRows(monitorId: ObjectID): Array<MonitorStatusTimeline> {
  return [
    row({
      monitorId: monitorId,
      status: OFFLINE,
      startsAt: "2026-07-31T12:00:00.000Z",
      endsAt: "2026-07-31T12:01:00.000Z",
    }),
    row({
      monitorId: monitorId,
      status: OPERATIONAL,
      startsAt: "2026-07-31T12:01:00.000Z",
    }),
  ];
}

function monitorResource(monitorId: ObjectID): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  resource.monitorId = monitorId;
  resource.showUptimePercent = true;
  return resource;
}

describe("StatusPageResourceUptimeUtil.calculateUptimePercentOfResource with the day aggregate", () => {
  test("measures a monitor over the whole range, not the rows the cap left", () => {
    const fromRows: number | null =
      StatusPageResourceUptimeUtil.calculateUptimePercentOfResource({
        statusPageResource: monitorResource(MONITOR),
        monitorStatusTimelines: cappedRows(MONITOR),
        precision: UptimePrecision.TWO_DECIMAL,
        downtimeMonitorStatuses: [OFFLINE],
        monitorsInGroup: {},
        uptimeWindow: WINDOW,
      });

    const fromBuckets: number | null =
      StatusPageResourceUptimeUtil.calculateUptimePercentOfResource({
        statusPageResource: monitorResource(MONITOR),
        monitorStatusTimelines: cappedRows(MONITOR),
        precision: UptimePrecision.TWO_DECIMAL,
        downtimeMonitorStatuses: [OFFLINE],
        monitorsInGroup: {},
        uptimeWindow: WINDOW,
        uptimeDailyAggregate: aggregateFor(MONITOR),
      });

    // the premise: half a day of rows, one minute of it down.
    expect(fromRows).toBe(99.86);
    expect(fromBuckets).toBe(99.67);
  });

  test("falls back to the rows when the monitor's buckets cover nothing", () => {
    const uptime: number | null =
      StatusPageResourceUptimeUtil.calculateUptimePercentOfResource({
        statusPageResource: monitorResource(MONITOR),
        monitorStatusTimelines: cappedRows(MONITOR),
        precision: UptimePrecision.TWO_DECIMAL,
        downtimeMonitorStatuses: [OFFLINE],
        monitorsInGroup: {},
        uptimeWindow: WINDOW,
        // buckets for some other monitor only.
        uptimeDailyAggregate: aggregateFor(GROUP_MONITOR),
      });

    expect(uptime).toBe(99.86);
  });

  test("keeps a monitor group on the rows", () => {
    const resource: StatusPageResource = new StatusPageResource();
    resource.monitorGroupId = MONITOR_GROUP;
    resource.showUptimePercent = true;

    /*
     * A group is down whenever its worst monitor is, which per-monitor day
     * sums cannot express - even with its monitor's buckets to hand.
     */
    const uptime: number | null =
      StatusPageResourceUptimeUtil.calculateUptimePercentOfResource({
        statusPageResource: resource,
        monitorStatusTimelines: cappedRows(GROUP_MONITOR),
        precision: UptimePrecision.TWO_DECIMAL,
        downtimeMonitorStatuses: [OFFLINE],
        monitorsInGroup: {
          [MONITOR_GROUP.toString()]: [GROUP_MONITOR],
        },
        uptimeWindow: WINDOW,
        uptimeDailyAggregate: aggregateFor(GROUP_MONITOR),
      });

    expect(uptime).toBe(99.86);
  });

  test("is still null for a resource that does not show its uptime", () => {
    const resource: StatusPageResource = monitorResource(MONITOR);
    resource.showUptimePercent = false;

    expect(
      StatusPageResourceUptimeUtil.calculateUptimePercentOfResource({
        statusPageResource: resource,
        monitorStatusTimelines: cappedRows(MONITOR),
        precision: UptimePrecision.TWO_DECIMAL,
        downtimeMonitorStatuses: [OFFLINE],
        monitorsInGroup: {},
        uptimeWindow: WINDOW,
        uptimeDailyAggregate: aggregateFor(MONITOR),
      }),
    ).toBeNull();
  });
});
