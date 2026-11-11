import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import { Green, Red } from "../../../Types/BrandColors";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import { MergedDowntimeTotals } from "../../../Types/StatusPage/MergedDowntimeTotals";
import {
  MonitorGroupUptimeDailyAggregate,
  UptimeDayBucket,
} from "../../../Types/StatusPage/UptimeDailyAggregate";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import StatusPageResourceUptimeUtil from "../../../Utils/StatusPage/ResourceUptime";
import { describe, expect, test } from "@jest/globals";

/*
 * A monitor-group resource's uptime on a status page, from the group's own
 * day buckets (the overview's monitorGroupUptimeDailyAggregate, issue
 * #6697): the same buckets its bars are painted from, so the percentage
 * beside its name is the sum of its days.
 *
 * The group's merged downtime, then its rows, are what is left when it has
 * no buckets - a server that predates them, or days nothing was recorded on.
 */

const DAY_SECONDS: number = 86400;

const MONITOR_A: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_B: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MONITOR_GROUP: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const OTHER_GROUP: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

const OPERATIONAL: MonitorStatus = new MonitorStatus();
OPERATIONAL.id = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-000000000001");
OPERATIONAL.name = "Operational";
OPERATIONAL.priority = 1;
OPERATIONAL.color = Green;

const OFFLINE: MonitorStatus = new MonitorStatus();
OFFLINE.id = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-000000000003");
OFFLINE.name = "Offline";
OFFLINE.priority = 3;
OFFLINE.color = Red;

const WINDOW: { startDate: Date; endDate: Date } = {
  startDate: new Date("2026-09-11T00:00:00.000Z"),
  endDate: new Date("2026-11-10T00:00:00.000Z"),
};

function groupResource(groupId: ObjectID = MONITOR_GROUP): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = ObjectID.generate().toString();
  resource.monitorGroupId = groupId;
  resource.showUptimePercent = true;
  resource.showStatusHistoryChart = true;
  resource.uptimePercentPrecision = UptimePrecision.TWO_DECIMAL;
  return resource;
}

function day(
  index: number,
  durations: Array<[MonitorStatus, number]>,
): UptimeDayBucket {
  const start: Date = new Date(
    WINDOW.startDate.getTime() + index * DAY_SECONDS * 1000,
  );

  return {
    bucketStart: start,
    bucketEnd: new Date(start.getTime() + DAY_SECONDS * 1000),
    daySeconds: DAY_SECONDS,
    coveredSeconds: durations.reduce(
      (sum: number, [, seconds]: [MonitorStatus, number]) => {
        return sum + seconds;
      },
      0,
    ),
    statusDurations: durations.map(
      ([status, seconds]: [MonitorStatus, number]) => {
        return { monitorStatusId: status.id!, seconds: seconds };
      },
    ),
  };
}

// thirty days: one of them down for six hours, the rest up.
function groupDays(): Array<UptimeDayBucket> {
  const days: Array<UptimeDayBucket> = [];

  for (let index: number = 0; index < 30; index++) {
    days.push(
      index === 7
        ? day(index, [
            [OPERATIONAL, DAY_SECONDS - 6 * 3600],
            [OFFLINE, 6 * 3600],
          ])
        : day(index, [[OPERATIONAL, DAY_SECONDS]]),
    );
  }

  return days;
}

function groupAggregate(
  buckets: Array<UptimeDayBucket>,
): MonitorGroupUptimeDailyAggregate {
  return {
    monitorGroups: [{ monitorGroupId: MONITOR_GROUP, buckets: buckets }],
    timezone: "Asia/Shanghai",
  };
}

const MONITORS_IN_GROUP: Dictionary<Array<ObjectID>> = {
  [MONITOR_GROUP.toString()]: [MONITOR_A, MONITOR_B],
  [OTHER_GROUP.toString()]: [MONITOR_B],
};

// the rows say the group was up: what the cap left.
function cappedRows(): Array<MonitorStatusTimeline> {
  const row: MonitorStatusTimeline = new MonitorStatusTimeline();
  row.monitorId = MONITOR_A;
  row.monitorStatusId = OPERATIONAL.id!;
  row.monitorStatus = OPERATIONAL;
  row.startsAt = new Date(WINDOW.endDate.getTime() - DAY_SECONDS * 1000);
  return [row];
}

function uptimeOf(data: {
  resource?: StatusPageResource | undefined;
  monitorGroupUptimeDailyAggregate?:
    | MonitorGroupUptimeDailyAggregate
    | null
    | undefined;
  monitorGroupMergedDowntime?: Dictionary<MergedDowntimeTotals> | undefined;
}): number | null {
  return StatusPageResourceUptimeUtil.calculateUptimePercentOfResource({
    statusPageResource: data.resource || groupResource(),
    monitorStatusTimelines: cappedRows(),
    precision: UptimePrecision.TWO_DECIMAL,
    downtimeMonitorStatuses: [OFFLINE],
    monitorsInGroup: MONITORS_IN_GROUP,
    uptimeWindow: WINDOW,
    monitorGroupUptimeDailyAggregate: data.monitorGroupUptimeDailyAggregate,
    monitorGroupMergedDowntime: data.monitorGroupMergedDowntime,
  });
}

describe("StatusPageResourceUptimeUtil: a monitor group, from its own days", () => {
  test("is the sum of its days: six hours down in thirty covered days", () => {
    // (30 * 86400 - 21600) / (30 * 86400) = 99.1666...%
    expect(
      uptimeOf({
        monitorGroupUptimeDailyAggregate: groupAggregate(groupDays()),
      }),
    ).toBe(99.16);
  });

  test("reads its days before its merged downtime, which says the same over the same window", () => {
    expect(
      uptimeOf({
        monitorGroupUptimeDailyAggregate: groupAggregate(groupDays()),
        // a stale figure from another window: the days win.
        monitorGroupMergedDowntime: {
          [MONITOR_GROUP.toString()]: {
            coveredSeconds: 30 * DAY_SECONDS,
            downtimeSeconds: 0,
          },
        },
      }),
    ).toBe(99.16);
  });

  test("with days nothing was recorded on, falls back to its merged downtime, then its rows", () => {
    const empty: MonitorGroupUptimeDailyAggregate = groupAggregate([
      day(0, []),
      day(1, []),
    ]);

    expect(
      uptimeOf({
        monitorGroupUptimeDailyAggregate: empty,
        monitorGroupMergedDowntime: {
          [MONITOR_GROUP.toString()]: {
            coveredSeconds: 10 * DAY_SECONDS,
            downtimeSeconds: DAY_SECONDS,
          },
        },
      }),
    ).toBe(90);

    // nothing merged either: the rows, which say up.
    expect(uptimeOf({ monitorGroupUptimeDailyAggregate: empty })).toBe(100);
  });

  test("a group the aggregate has no days for is measured as before", () => {
    expect(
      uptimeOf({
        resource: groupResource(OTHER_GROUP),
        monitorGroupUptimeDailyAggregate: groupAggregate(groupDays()),
        monitorGroupMergedDowntime: {
          [OTHER_GROUP.toString()]: {
            coveredSeconds: 4 * DAY_SECONDS,
            downtimeSeconds: DAY_SECONDS,
          },
        },
      }),
    ).toBe(75);
  });

  test("a resource that names a monitor as well is that monitor's, not the group's", () => {
    const resource: StatusPageResource = groupResource();
    resource.monitorId = MONITOR_A;

    // no monitor buckets given, so the rows: up.
    expect(
      uptimeOf({
        resource,
        monitorGroupUptimeDailyAggregate: groupAggregate(groupDays()),
      }),
    ).toBe(100);
  });

  test("hides nothing it was not asked to show", () => {
    const resource: StatusPageResource = groupResource();
    resource.showUptimePercent = false;

    expect(
      uptimeOf({
        resource,
        monitorGroupUptimeDailyAggregate: groupAggregate(groupDays()),
      }),
    ).toBeNull();
  });

  test("a status page group rolls its monitor groups up from their days", () => {
    const statusPageGroup: StatusPageGroup = new StatusPageGroup();
    statusPageGroup._id = ObjectID.generate().toString();
    statusPageGroup.showUptimePercent = true;
    statusPageGroup.uptimePercentPrecision = UptimePrecision.TWO_DECIMAL;

    const resource: StatusPageResource = groupResource();
    resource.statusPageGroupId = new ObjectID(statusPageGroup._id);

    expect(
      StatusPageResourceUptimeUtil.calculateAvgUptimePercentOfStatusPageGroup({
        statusPageGroup: statusPageGroup,
        monitorStatusTimelines: cappedRows(),
        precision: UptimePrecision.TWO_DECIMAL,
        downtimeMonitorStatuses: [OFFLINE],
        statusPageResources: [resource],
        monitorsInGroup: MONITORS_IN_GROUP,
        uptimeWindow: WINDOW,
        monitorGroupUptimeDailyAggregate: groupAggregate(groupDays()),
      }),
    ).toBe(99.16);

    // and the page's overall figure does too.
    expect(
      StatusPageResourceUptimeUtil.calculateAvgUptimePercentageOfAllResources({
        monitorStatusTimelines: cappedRows(),
        precision: UptimePrecision.TWO_DECIMAL,
        downtimeMonitorStatuses: [OFFLINE],
        statusPageResources: [groupResource()],
        resourceGroups: [],
        monitorsInGroup: MONITORS_IN_GROUP,
        uptimeWindow: WINDOW,
        monitorGroupUptimeDailyAggregate: groupAggregate(groupDays()),
      }),
    ).toBe(99.16);
  });
});
