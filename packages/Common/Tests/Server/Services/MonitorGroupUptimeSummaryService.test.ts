/** @timezone UTC */

import MonitorGroupService from "../../../Server/Services/MonitorGroupService";
import MonitorGroupResourceService from "../../../Server/Services/MonitorGroupResourceService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../../Server/Services/MonitorStatusTimelineService";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorGroupResource from "../../../Models/DatabaseModels/MonitorGroupResource";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { MonitorGroupUptimeSummary } from "../../../Types/Monitor/MonitorGroupUptimeSummary";
import ObjectID from "../../../Types/ObjectID";
import {
  MonitorGroupUptimeDailyAggregate,
  UptimeDayBucket,
} from "../../../Types/StatusPage/UptimeDailyAggregate";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import MonitorGroupUptimeSummaryUtil from "../../../Utils/Monitor/MonitorGroupUptimeSummaryUtil";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * MonitorGroupService.getUptimeSummary: the Dashboard monitor group page's
 * Uptime Graph and its 90-day uptime, from the group's days as the database
 * measures them from every row (issue #6886) - the days a status page draws
 * the group with. The page used to merge the group's timeline rows, which
 * arrive under a 10,000 row cap, oldest first.
 *
 * The group's members and the project's statuses are spied at their
 * services, and the day statement at MonitorStatusTimelineService: its SQL
 * is checked against Postgres elsewhere (MonitorGroupDailyUptimePostgres,
 * MonitorStatusTimelineMonitoringOffPostgres).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "68861000-0000-4000-8000-000000000001",
);
const GROUP_ID: ObjectID = new ObjectID("68861000-0000-4000-8000-000000000002");
const MONITOR_A: ObjectID = new ObjectID(
  "68861000-0000-4000-8000-00000000000a",
);
const MONITOR_B: ObjectID = new ObjectID(
  "68861000-0000-4000-8000-00000000000b",
);
const ARCHIVED_MONITOR: ObjectID = new ObjectID(
  "68861000-0000-4000-8000-0000000000ac",
);

function status(data: {
  id: string;
  priority: number;
  isOperationalState: boolean;
}): MonitorStatus {
  const item: MonitorStatus = new MonitorStatus();
  item._id = data.id;
  item.priority = data.priority;
  item.isOperationalState = data.isOperationalState;
  return item;
}

const OPERATIONAL: MonitorStatus = status({
  id: "68862000-0000-4000-8000-000000000001",
  priority: 1,
  isOperationalState: true,
});
const DEGRADED: MonitorStatus = status({
  id: "68862000-0000-4000-8000-000000000002",
  priority: 2,
  isOperationalState: false,
});
const OFFLINE: MonitorStatus = status({
  id: "68862000-0000-4000-8000-000000000003",
  priority: 3,
  isOperationalState: false,
});
// A custom status above Offline that is operational: not down on the Dashboard.
const MAINTENANCE: MonitorStatus = status({
  id: "68862000-0000-4000-8000-000000000004",
  priority: 4,
  isOperationalState: true,
});

function member(
  monitorId: ObjectID,
  isArchived: boolean,
): MonitorGroupResource {
  const resource: MonitorGroupResource = new MonitorGroupResource();
  resource.monitorId = monitorId;
  resource.monitor = new Monitor();
  resource.monitor.isArchived = isArchived;
  return resource;
}

function day(data: {
  start: string;
  operational: number;
  offline?: number | undefined;
}): UptimeDayBucket {
  const bucketStart: Date = new Date(data.start);

  return {
    bucketStart: bucketStart,
    bucketEnd: new Date(bucketStart.getTime() + 86400 * 1000),
    daySeconds: 86400,
    coveredSeconds: data.operational + (data.offline || 0),
    statusDurations: [
      { monitorStatusId: OPERATIONAL.id!, seconds: data.operational },
      ...(data.offline
        ? [{ monitorStatusId: OFFLINE.id!, seconds: data.offline }]
        : []),
    ],
  };
}

interface AggregateRequest {
  monitorGroups: Array<{
    monitorGroupId: ObjectID;
    monitorIds: Array<ObjectID>;
  }>;
  rankedMonitorStatusIds: Array<ObjectID | string>;
  startDate: Date;
  endDate: Date;
  timezone?: string | undefined;
}

describe("MonitorGroupService.getUptimeSummary (issue #6886)", () => {
  let resourceFindBy: jest.SpyInstance;
  let statusFindBy: jest.SpyInstance;
  let aggregateSpy: jest.SpyInstance;
  let groupBuckets: Array<UptimeDayBucket>;

  beforeEach(() => {
    groupBuckets = [
      day({ start: "2026-09-19T04:00:00.000Z", operational: 86400 }),
      day({
        start: "2026-09-20T04:00:00.000Z",
        operational: 86400 - 7200,
        offline: 7200,
      }),
    ];

    resourceFindBy = jest
      .spyOn(MonitorGroupResourceService, "findBy")
      .mockResolvedValue([
        member(MONITOR_A, false),
        member(ARCHIVED_MONITOR, true),
        member(MONITOR_B, false),
      ]);
    statusFindBy = jest
      .spyOn(MonitorStatusService, "findBy")
      .mockResolvedValue([OPERATIONAL, DEGRADED, OFFLINE, MAINTENANCE]);
    aggregateSpy = jest
      .spyOn(
        MonitorStatusTimelineService,
        "getMonitorGroupDailyUptimeAggregate",
      )
      .mockImplementation(
        async (
          request: AggregateRequest,
        ): Promise<MonitorGroupUptimeDailyAggregate> => {
          return {
            monitorGroups: request.monitorGroups.map(
              (group: { monitorGroupId: ObjectID }) => {
                return {
                  monitorGroupId: group.monitorGroupId,
                  buckets: groupBuckets,
                };
              },
            ),
            timezone: request.timezone,
          };
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function request(): AggregateRequest {
    expect(aggregateSpy).toHaveBeenCalledTimes(1);
    return aggregateSpy.mock.calls[0]![0] as AggregateRequest;
  }

  async function summary(data?: {
    timezone?: string | undefined;
    now?: Date | undefined;
  }): Promise<MonitorGroupUptimeSummary> {
    return await MonitorGroupService.getUptimeSummary({
      monitorGroupId: GROUP_ID,
      projectId: PROJECT_ID,
      timezone: data?.timezone || "America/New_York",
      // 23:30 on 20 September in New York.
      now: data?.now || new Date("2026-09-21T03:30:00.000Z"),
    });
  }

  it("asks for the group's days over the monitor page's 90 bars: from local midnight 89 days back to now, in the zone", async () => {
    const now: Date = new Date("2026-09-21T03:30:00.000Z");

    const result: MonitorGroupUptimeSummary = await summary({ now });

    // 23 June in New York, at midnight EDT.
    expect(request().startDate.toISOString()).toBe("2026-06-23T04:00:00.000Z");
    expect(request().endDate).toBe(now);
    expect(request().timezone).toBe("America/New_York");

    expect(result.startDate.toISOString()).toBe("2026-06-23T04:00:00.000Z");
    expect(result.endDate).toBe(now);
    expect(result.generatedAt).toBe(now);
    expect(result.timezone).toBe("America/New_York");
  });

  it("counts days on the calendar across a DST change, not in 24 hour steps", async () => {
    // 1 December in New York (EST); 89 days back is 3 September (EDT).
    await summary({ now: new Date("2026-12-01T15:00:00.000Z") });

    expect(request().startDate.toISOString()).toBe("2026-09-03T04:00:00.000Z");
  });

  it("measures the group's monitors but an archived one, read as root by the group and the project", async () => {
    await summary();

    expect(request().monitorGroups).toHaveLength(1);
    expect(request().monitorGroups[0]!.monitorGroupId).toBe(GROUP_ID);
    expect(
      request().monitorGroups[0]!.monitorIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([MONITOR_A.toString(), MONITOR_B.toString()]);

    const read: {
      query: { monitorGroupId: ObjectID; projectId: ObjectID };
      select: unknown;
      props: unknown;
      limit: number;
    } = resourceFindBy.mock.calls[0]![0] as {
      query: { monitorGroupId: ObjectID; projectId: ObjectID };
      select: unknown;
      props: unknown;
      limit: number;
    };

    expect(read.query.monitorGroupId).toBe(GROUP_ID);
    expect(read.query.projectId).toBe(PROJECT_ID);
    expect(read.select).toEqual({
      monitorId: true,
      monitor: { isArchived: true },
    });
    expect(read.props).toEqual({ isRoot: true });
    expect(read.limit).toBe(LIMIT_PER_PROJECT);
  });

  it("ranks the project's statuses with every status that is not operational as downtime, the worst last", async () => {
    await summary();

    expect(
      request().rankedMonitorStatusIds.map((id: ObjectID | string) => {
        return id.toString();
      }),
    ).toEqual([
      // Operational ones first, by priority - the custom Maintenance among them...
      OPERATIONAL.id!.toString(),
      MAINTENANCE.id!.toString(),
      // ...then the downtime ones, so one monitor down makes the group down.
      DEGRADED.id!.toString(),
      OFFLINE.id!.toString(),
    ]);

    const read: {
      query: { projectId: ObjectID };
      sort: unknown;
      props: unknown;
    } = statusFindBy.mock.calls[0]![0] as {
      query: { projectId: ObjectID };
      sort: unknown;
      props: unknown;
    };

    expect(read.query.projectId).toBe(PROJECT_ID);
    expect(read.sort).toEqual({ priority: SortOrder.Ascending });
    expect(read.props).toEqual({ isRoot: true });
  });

  it("hands back the group's days, and its totals summed from them", async () => {
    const result: MonitorGroupUptimeSummary = await summary();

    expect(result.monitorGroupId).toBe(GROUP_ID);
    expect(result.buckets).toBe(groupBuckets);
    expect(result.coveredSeconds).toBe(2 * 86400);
    expect(result.downtimeSeconds).toBe(7200);

    // (172800 - 7200) / 172800 = 95.833...%
    expect(
      MonitorGroupUptimeSummaryUtil.getUptimePercent({
        summary: result,
        precision: UptimePrecision.THREE_DECIMAL,
      }),
    ).toBe(95.833);
  });

  it("a group with no monitors, or only archived ones, still gets its days: every one with no data", async () => {
    resourceFindBy.mockResolvedValue([member(ARCHIVED_MONITOR, true)]);
    groupBuckets = [
      {
        bucketStart: new Date("2026-09-20T04:00:00.000Z"),
        bucketEnd: new Date("2026-09-21T03:30:00.000Z"),
        daySeconds: 84600,
        coveredSeconds: 0,
        statusDurations: [],
      },
    ];

    const result: MonitorGroupUptimeSummary = await summary();

    expect(request().monitorGroups[0]!.monitorIds).toEqual([]);
    expect(result.coveredSeconds).toBe(0);
    expect(result.downtimeSeconds).toBe(0);
    expect(
      MonitorGroupUptimeSummaryUtil.getUptimePercent({
        summary: result,
        precision: UptimePrecision.THREE_DECIMAL,
      }),
    ).toBeNull();
  });
});
