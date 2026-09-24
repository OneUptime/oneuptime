/*
 * The scheduled "Uptime Report" email for a status page.
 *
 * The report used to be a flat per-monitor table. Status pages arrange their
 * resources into a tree of groups (Corporate Unit's -> Region -> Market -> Unit)
 * and show a rolled up availability at every level, and the people this email is
 * addressed to usually have no OneUptime login - so a flat list of monitor names
 * left them with no way to tell which region or unit a monitor belonged to, and
 * no rolled up number at all.
 *
 * These tests build the report end to end (every database read spied - no
 * database is touched) and pin:
 *   - the nested group structure and the render order it flattens to,
 *   - the numbers rolled up onto each group,
 *   - the flat `resources` array custom templates written before groups still
 *     loop over,
 *   - every uptime and downtime figure measured over the whole window even
 *     when the page's timeline rows are cut off by the row cap: a single
 *     monitor from its day aggregate, and a monitor group, a status page
 *     group and the page from the time at least one of their monitors was
 *     down - an outage two monitors share counted once, and never cut short
 *     the way the old row merge cut it,
 *   - and the empty-status-page case.
 */

import StatusPageService from "../../../Server/Services/StatusPageService";
import { MergedDowntimeTotals } from "../../../Server/Services/MonitorStatusTimelineService";
import StatusPageGroupService from "../../../Server/Services/StatusPageGroupService";
import IncidentService from "../../../Server/Services/IncidentService";
import MonitorGroupService from "../../../Server/Services/MonitorGroupService";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import StatusPageReportPeriodType from "../../../Types/StatusPage/StatusPageReportPeriodType";
import StatusPageReportPeriodUtil, {
  StatusPageReportPeriod,
} from "../../../Utils/StatusPage/ReportPeriod";
import PositiveNumber from "../../../Types/PositiveNumber";
import Timezone from "../../../Types/Timezone";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import {
  MonitorUptimeDailyAggregate,
  UptimeDailyAggregate,
  UptimeDayBucket,
  UptimeStatusDuration,
} from "../../../Types/StatusPage/UptimeDailyAggregate";
import UptimeUtil from "../../../Utils/Uptime/UptimeUtil";
import { Green, Red } from "../../../Types/BrandColors";
import {
  StatusPageReport,
  StatusPageReportGroup,
  StatusPageReportItem,
  StatusPageReportRow,
} from "../../../Types/StatusPage/StatusPageReport";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);

const CORPORATE: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const REGION_ONE: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MARKET_ONE: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const UNIT_0660: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const ROUTER_MONITOR: ObjectID = new ObjectID(
  "aa000000-0000-4000-8000-000000000001",
);
const SWITCH_MONITOR: ObjectID = new ObjectID(
  "aa000000-0000-4000-8000-000000000002",
);
const WEBSITE_MONITOR: ObjectID = new ObjectID(
  "aa000000-0000-4000-8000-000000000003",
);

const HISTORY_DAYS: number = 14;

/*
 * The window under test: the rolling fourteen days the timeline below is built
 * around. Resolved through the same util the worker uses so these tests keep
 * exercising the real string formatting as well as the boundaries.
 */
function reportPeriod(): StatusPageReportPeriod {
  return StatusPageReportPeriodUtil.getReportPeriod({
    periodType: StatusPageReportPeriodType.Rolling,
    reportDataInDays: HISTORY_DAYS,
  });
}

const OPERATIONAL: MonitorStatus = new MonitorStatus();
OPERATIONAL.id = new ObjectID("bb000000-0000-4000-8000-000000000001");
OPERATIONAL.name = "Operational";
OPERATIONAL.priority = 1;
OPERATIONAL.color = Green;

const OFFLINE: MonitorStatus = new MonitorStatus();
OFFLINE.id = new ObjectID("bb000000-0000-4000-8000-000000000002");
OFFLINE.name = "Offline";
OFFLINE.priority = 2;
OFFLINE.color = Red;

function makeGroup(data: {
  id: ObjectID;
  name: string;
  parentId?: ObjectID | undefined;
  order?: number | undefined;
}): StatusPageGroup {
  const group: StatusPageGroup = new StatusPageGroup();
  group._id = data.id.toString();
  group.name = data.name;
  group.order = data.order === undefined ? 1 : data.order;

  if (data.parentId) {
    group.parentStatusPageGroupId = data.parentId;
  }

  return group;
}

function makeResource(data: {
  displayName: string;
  monitorId: ObjectID;
  groupId?: ObjectID | undefined;
  order: number;
}): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  resource.displayName = data.displayName;
  resource.monitorId = data.monitorId;
  resource.order = data.order;

  if (data.groupId) {
    resource.statusPageGroupId = data.groupId;
  }

  return resource;
}

function makeTimelineItem(data: {
  monitorId: ObjectID;
  monitorStatus: MonitorStatus;
  startsAt: Date;
  endsAt?: Date | undefined;
}): MonitorStatusTimeline {
  const item: MonitorStatusTimeline = new MonitorStatusTimeline();
  item.monitorId = data.monitorId;
  item.monitorStatus = data.monitorStatus;
  item.startsAt = data.startsAt;

  if (data.endsAt) {
    item.endsAt = data.endsAt;
  }

  return item;
}

/*
 * Router is offline for exactly two days inside a fourteen day window; every
 * other monitor is operational for the whole window. Two days out of fourteen is
 * 85.71% uptime after the report's two decimal rounding, which makes the rolled
 * up averages above it predictable.
 */
function makeTimeline(): Array<MonitorStatusTimeline> {
  const windowStart: Date = OneUptimeDate.getSomeDaysAgo(HISTORY_DAYS);
  const outageStart: Date = OneUptimeDate.getSomeDaysAgo(7);
  const outageEnd: Date = OneUptimeDate.getSomeDaysAgo(5);

  return [
    makeTimelineItem({
      monitorId: ROUTER_MONITOR,
      monitorStatus: OPERATIONAL,
      startsAt: windowStart,
      endsAt: outageStart,
    }),
    makeTimelineItem({
      monitorId: ROUTER_MONITOR,
      monitorStatus: OFFLINE,
      startsAt: outageStart,
      endsAt: outageEnd,
    }),
    makeTimelineItem({
      monitorId: ROUTER_MONITOR,
      monitorStatus: OPERATIONAL,
      startsAt: outageEnd,
    }),
    makeTimelineItem({
      monitorId: SWITCH_MONITOR,
      monitorStatus: OPERATIONAL,
      startsAt: windowStart,
    }),
    makeTimelineItem({
      monitorId: WEBSITE_MONITOR,
      monitorStatus: OPERATIONAL,
      startsAt: windowStart,
    }),
  ];
}

/*
 * Corporate Unit's
 *   Region 001
 *     Market 001
 *       Unit 0660
 *         Router
 *         Switch 01
 * (ungrouped) WBHQ website
 */
function nestedGroups(): Array<StatusPageGroup> {
  return [
    makeGroup({ id: CORPORATE, name: "Corporate Unit's" }),
    makeGroup({ id: REGION_ONE, name: "Region 001", parentId: CORPORATE }),
    makeGroup({ id: MARKET_ONE, name: "Market 001", parentId: REGION_ONE }),
    makeGroup({ id: UNIT_0660, name: "Unit 0660", parentId: MARKET_ONE }),
  ];
}

function nestedResources(): Array<StatusPageResource> {
  return [
    makeResource({
      displayName: "Router",
      monitorId: ROUTER_MONITOR,
      groupId: UNIT_0660,
      order: 1,
    }),
    makeResource({
      displayName: "WBHQ website",
      monitorId: WEBSITE_MONITOR,
      order: 2,
    }),
    makeResource({
      displayName: "Switch 01",
      monitorId: SWITCH_MONITOR,
      groupId: UNIT_0660,
      order: 3,
    }),
  ];
}

const DAY_IN_MILLISECONDS: number = 24 * 60 * 60 * 1000;

type AggregateRequest = {
  monitorIds: Array<ObjectID>;
  startDate: Date;
  endDate: Date;
  timezone?: string | undefined;
};

/*
 * What MonitorStatusTimelineService.getDailyUptimeAggregate returns for these
 * rows, without a database: a row runs to its endsAt or, while open, to the
 * next row's start or now; it is clipped to the window and its seconds summed
 * per day and status. Days are cut at UTC midnight here - the totals the
 * report reads do not depend on where the cut falls.
 */
function aggregateFromTimeline(data: {
  timeline: Array<MonitorStatusTimeline>;
  request: AggregateRequest;
}): UptimeDailyAggregate {
  const windowStart: number = data.request.startDate.getTime();
  const windowEnd: number = Math.min(
    data.request.endDate.getTime(),
    Date.now(),
  );

  const monitors: Array<MonitorUptimeDailyAggregate> = [];

  for (const monitorId of data.request.monitorIds) {
    const rows: Array<MonitorStatusTimeline> = data.timeline
      .filter((row: MonitorStatusTimeline) => {
        return row.monitorId?.toString() === monitorId.toString();
      })
      .sort((a: MonitorStatusTimeline, b: MonitorStatusTimeline) => {
        return a.startsAt!.getTime() - b.startsAt!.getTime();
      });

    const buckets: Array<UptimeDayBucket> = [];

    for (
      let dayStart: number =
        Math.floor(windowStart / DAY_IN_MILLISECONDS) * DAY_IN_MILLISECONDS;
      dayStart < windowEnd;
      dayStart += DAY_IN_MILLISECONDS
    ) {
      const bucketStart: number = Math.max(dayStart, windowStart);
      const bucketEnd: number = Math.min(
        dayStart + DAY_IN_MILLISECONDS,
        windowEnd,
      );

      const secondsByStatus: Dictionary<number> = {};

      rows.forEach((row: MonitorStatusTimeline, index: number) => {
        const rowEnd: number = row.endsAt
          ? row.endsAt.getTime()
          : rows[index + 1]?.startsAt?.getTime() || windowEnd;

        const overlap: number =
          Math.min(rowEnd, bucketEnd) -
          Math.max(row.startsAt!.getTime(), bucketStart);

        if (overlap > 0) {
          const statusId: string = row.monitorStatus!.id!.toString();
          secondsByStatus[statusId] =
            (secondsByStatus[statusId] || 0) + overlap / 1000;
        }
      });

      const statusDurations: Array<UptimeStatusDuration> = Object.keys(
        secondsByStatus,
      ).map((statusId: string): UptimeStatusDuration => {
        return {
          monitorStatusId: new ObjectID(statusId),
          seconds: secondsByStatus[statusId]!,
        };
      });

      buckets.push({
        bucketStart: new Date(bucketStart),
        bucketEnd: new Date(bucketEnd),
        daySeconds: (bucketEnd - bucketStart) / 1000,
        coveredSeconds: statusDurations.reduce(
          (total: number, duration: UptimeStatusDuration) => {
            return total + duration.seconds;
          },
          0,
        ),
        statusDurations: statusDurations,
      });
    }

    monitors.push({ monitorId: monitorId, buckets: buckets });
  }

  return { monitors: monitors, isComplete: true, completeFrom: null };
}

type MergedDowntimeRequest = {
  monitorIds: Array<ObjectID>;
  downtimeMonitorStatusIds: Array<ObjectID | string>;
  startDate: Date;
  endDate: Date;
};

// seconds covered by the union of [start, end) periods, in milliseconds.
function unionSeconds(periods: Array<[number, number]>): number {
  let total: number = 0;
  let reach: number = -Infinity;

  for (const [start, end] of [...periods].sort(
    (a: [number, number], b: [number, number]) => {
      return a[0] - b[0];
    },
  )) {
    total += Math.max(0, end - Math.max(start, reach));
    reach = Math.max(reach, end);
  }

  return total / 1000;
}

/*
 * What MonitorStatusTimelineService.getMergedDowntimeSeconds returns for
 * these rows, without a database: every row ended and clipped as in
 * aggregateFromTimeline above, then the union across the monitors - the
 * time at least one of them was recorded, and at least one was down.
 */
function mergedFromTimeline(data: {
  timeline: Array<MonitorStatusTimeline>;
  request: MergedDowntimeRequest;
}): MergedDowntimeTotals {
  const windowStart: number = data.request.startDate.getTime();
  const windowEnd: number = Math.min(
    data.request.endDate.getTime(),
    Date.now(),
  );

  const downtimeIds: Set<string> = new Set<string>(
    data.request.downtimeMonitorStatusIds.map(
      (id: ObjectID | string): string => {
        return id.toString();
      },
    ),
  );

  const covered: Array<[number, number]> = [];
  const down: Array<[number, number]> = [];

  for (const monitorId of data.request.monitorIds) {
    const rows: Array<MonitorStatusTimeline> = data.timeline
      .filter((row: MonitorStatusTimeline) => {
        return row.monitorId?.toString() === monitorId.toString();
      })
      .sort((a: MonitorStatusTimeline, b: MonitorStatusTimeline) => {
        return a.startsAt!.getTime() - b.startsAt!.getTime();
      });

    rows.forEach((row: MonitorStatusTimeline, index: number) => {
      const rowEnd: number = row.endsAt
        ? row.endsAt.getTime()
        : rows[index + 1]?.startsAt?.getTime() || windowEnd;

      const start: number = Math.max(row.startsAt!.getTime(), windowStart);
      const end: number = Math.min(rowEnd, windowEnd);

      if (end <= start) {
        return;
      }

      covered.push([start, end]);

      if (downtimeIds.has(row.monitorStatus!.id!.toString())) {
        down.push([start, end]);
      }
    });
  }

  return {
    coveredSeconds: unionSeconds(covered),
    downtimeSeconds: unionSeconds(down),
  };
}

/*
 * The row fetch as the database serves it: newest first, cut off after
 * `limit` rows across every monitor on the page.
 */
function newestRows(
  timeline: Array<MonitorStatusTimeline>,
  limit: number,
): Array<MonitorStatusTimeline> {
  return [...timeline]
    .sort((a: MonitorStatusTimeline, b: MonitorStatusTimeline) => {
      return b.startsAt!.getTime() - a.startsAt!.getTime();
    })
    .slice(0, limit);
}

/*
 * Wires up every read getReportByStatusPage makes. Incident counts come back as
 * "one incident per monitor asked about", which makes it visible whether a group
 * asked about its whole subtree.
 *
 * The day aggregate and the merged downtime are built from the WHOLE
 * timeline, as the real ones are. The row fetch returns the whole timeline
 * too unless `rowCap` is set, in which case it returns only the newest
 * `rowCap` rows - the real fetch's LIMIT_MAX.
 */
function mockReads(data: {
  statusPageResources: Array<StatusPageResource>;
  statusPageGroups: Array<StatusPageGroup>;
  timeline: Array<MonitorStatusTimeline>;
  rowCap?: number | undefined;
  monitorsInGroup?: Dictionary<Array<ObjectID>> | undefined;
}): void {
  const statusPage: StatusPage = new StatusPage();
  statusPage.downtimeMonitorStatuses = [OFFLINE];

  jest
    .spyOn(StatusPageService, "findOneById")
    .mockResolvedValue(statusPage as never);

  jest
    .spyOn(StatusPageService, "getStatusPageResources")
    .mockResolvedValue(data.statusPageResources as never);

  jest
    .spyOn(StatusPageGroupService, "findBy")
    .mockResolvedValue(data.statusPageGroups as never);

  jest
    .spyOn(MonitorGroupService, "getMonitorIdsInMonitorGroups")
    .mockResolvedValue((data.monitorsInGroup || {}) as never);

  jest
    .spyOn(StatusPageService, "getMonitorStatusTimelineForStatusPage")
    .mockResolvedValue(
      (data.rowCap === undefined
        ? data.timeline
        : newestRows(data.timeline, data.rowCap)) as never,
    );

  jest
    .spyOn(StatusPageService, "getUptimeDailyAggregateForStatusPage")
    .mockImplementation(async (request: AggregateRequest) => {
      return aggregateFromTimeline({
        timeline: data.timeline,
        request: request,
      });
    });

  jest
    .spyOn(StatusPageService, "getMergedDowntimeForStatusPage")
    .mockImplementation(async (request: MergedDowntimeRequest) => {
      return mergedFromTimeline({
        timeline: data.timeline,
        request: request,
      });
    });

  jest
    .spyOn(IncidentService, "countBy")
    .mockImplementation(async (findBy: any) => {
      const monitorIds: Array<ObjectID> = (findBy?.query?.monitors ||
        []) as Array<ObjectID>;
      return new PositiveNumber(monitorIds.length) as never;
    });
}

function rowNames(rows: Array<StatusPageReportRow>): Array<string> {
  return rows.map((row: StatusPageReportRow) => {
    return row.name;
  });
}

describe("StatusPageService.getReportByStatusPage", () => {
  beforeEach(() => {
    mockReads({
      statusPageResources: nestedResources(),
      statusPageGroups: nestedGroups(),
      timeline: makeTimeline(),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the nested group hierarchy", () => {
    test("reports the status page's groups instead of a flat list of monitors", async () => {
      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: STATUS_PAGE_ID,
          reportPeriod: reportPeriod(),
        });

      expect(report.hasGroups).toBe(true);
      expect(report.groups).toHaveLength(1);
      expect(report.groups[0]!.groupName).toBe("Corporate Unit's");
      expect(report.groups[0]!.subGroups[0]!.groupName).toBe("Region 001");
      expect(report.groups[0]!.subGroups[0]!.subGroups[0]!.groupName).toBe(
        "Market 001",
      );
      expect(
        report.groups[0]!.subGroups[0]!.subGroups[0]!.subGroups[0]!.groupName,
      ).toBe("Unit 0660");
    });

    test("flattens the hierarchy into the order the live page renders it", async () => {
      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: STATUS_PAGE_ID,
          reportPeriod: reportPeriod(),
        });

      expect(rowNames(report.rows)).toEqual([
        "WBHQ website",
        "Corporate Unit's",
        "Region 001",
        "Market 001",
        "Unit 0660",
        "Router",
        "Switch 01",
      ]);
    });

    test("puts the monitors under the group they belong to", async () => {
      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: STATUS_PAGE_ID,
          reportPeriod: reportPeriod(),
        });

      const unit: StatusPageReportGroup =
        report.groups[0]!.subGroups[0]!.subGroups[0]!.subGroups[0]!;

      expect(
        unit.resources.map((resource: StatusPageReportItem) => {
          return resource.resourceName;
        }),
      ).toEqual(["Router", "Switch 01"]);

      expect(
        report.ungroupedResources.map((resource: StatusPageReportItem) => {
          return resource.resourceName;
        }),
      ).toEqual(["WBHQ website"]);
    });

    test("tells every resource its full group path", async () => {
      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: STATUS_PAGE_ID,
          reportPeriod: reportPeriod(),
        });

      const pathByName: Dictionary<string> = {};

      for (const resource of report.resources) {
        pathByName[resource.resourceName] = resource.groupPath;
      }

      expect(pathByName["Router"]).toBe(
        "Corporate Unit's / Region 001 / Market 001 / Unit 0660",
      );
      expect(pathByName["Switch 01"]).toBe(
        "Corporate Unit's / Region 001 / Market 001 / Unit 0660",
      );
      expect(pathByName["WBHQ website"]).toBe("");
    });
  });

  describe("rolled up numbers", () => {
    test("reports each resource's own uptime", async () => {
      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: STATUS_PAGE_ID,
          reportPeriod: reportPeriod(),
        });

      const uptimeByName: Dictionary<string> = {};

      for (const resource of report.resources) {
        uptimeByName[resource.resourceName] = resource.uptimePercentAsString;
      }

      // two days offline out of a fourteen day window.
      expect(uptimeByName["Router"]).toBe("85.71%");
      expect(uptimeByName["Switch 01"]).toBe("100%");
      expect(uptimeByName["WBHQ website"]).toBe("100%");
    });

    test("averages the subtree onto every level of the hierarchy", async () => {
      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: STATUS_PAGE_ID,
          reportPeriod: reportPeriod(),
        });

      const corporate: StatusPageReportGroup = report.groups[0]!;
      const unit: StatusPageReportGroup =
        corporate.subGroups[0]!.subGroups[0]!.subGroups[0]!;

      // (85.71 + 100) / 2, rounded the way the report rounds.
      expect(unit.uptimePercentAsString).toBe("92.85%");
      // every level above the unit rolls up the same two resources.
      expect(corporate.uptimePercentAsString).toBe("92.85%");
      expect(corporate.subGroups[0]!.uptimePercentAsString).toBe("92.85%");
    });

    test("counts a group's downtime over every monitor beneath it", async () => {
      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: STATUS_PAGE_ID,
          reportPeriod: reportPeriod(),
        });

      const corporate: StatusPageReportGroup = report.groups[0]!;

      expect(corporate.downtimeInHoursAndMinutes).toContain("2 days");
      expect(report.totalDowntimeInHoursAndMinutes).toContain("2 days");
    });

    test("counts a group's incidents over every monitor beneath it", async () => {
      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: STATUS_PAGE_ID,
          reportPeriod: reportPeriod(),
        });

      const corporate: StatusPageReportGroup = report.groups[0]!;

      /*
       * The stub returns one incident per monitor queried, so this is the size
       * of the monitor set the group asked about: Router and Switch 01.
       */
      expect(corporate.totalIncidentCount).toBe(2);
      expect(corporate.totalResources).toBe(2);
    });

    test("asks the database once for a chain of levels that covers the same monitors", async () => {
      const countBy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        IncidentService,
        "countBy",
      ) as ReturnType<typeof jest.spyOn>;

      countBy.mockClear();

      await StatusPageService.getReportByStatusPage({
        statusPageId: STATUS_PAGE_ID,
        reportPeriod: reportPeriod(),
      });

      /*
       * One for the page total, one per resource, and ONE for all four levels
       * of the hierarchy - Corporate / Region / Market / Unit all roll up the
       * same two monitors, so they must not issue four identical queries.
       */
      expect(countBy).toHaveBeenCalledTimes(5);
    });

    test("merges downtime once per distinct set of monitors", async () => {
      await StatusPageService.getReportByStatusPage({
        statusPageId: STATUS_PAGE_ID,
        reportPeriod: reportPeriod(),
      });

      const mergedSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        StatusPageService,
        "getMergedDowntimeForStatusPage",
      ) as ReturnType<typeof jest.spyOn>;

      const monitorSets: Array<Array<string>> = mergedSpy.mock.calls.map(
        (call: Array<unknown>): Array<string> => {
          return (call[0] as MergedDowntimeRequest).monitorIds
            .map((monitorId: ObjectID) => {
              return monitorId.toString();
            })
            .sort();
        },
      );

      /*
       * The page, and ONE set for all four levels of the hierarchy. Single
       * monitors read their day aggregate instead.
       */
      expect(monitorSets).toHaveLength(2);
      expect(monitorSets).toContainEqual(
        [ROUTER_MONITOR, SWITCH_MONITOR, WEBSITE_MONITOR]
          .map((monitorId: ObjectID) => {
            return monitorId.toString();
          })
          .sort(),
      );
      expect(monitorSets).toContainEqual(
        [ROUTER_MONITOR, SWITCH_MONITOR]
          .map((monitorId: ObjectID) => {
            return monitorId.toString();
          })
          .sort(),
      );
    });

    test("keeps reporting page level totals", async () => {
      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: STATUS_PAGE_ID,
          reportPeriod: reportPeriod(),
        });

      expect(report.totalResources).toBe(3);
      // (85.71 + 100 + 100) / 3
      expect(report.averageUptimePercent).toBe("95.24%");
      expect(report.reportDates).toContain("14 days");
    });
  });

  describe("a group whose monitors were down at different times", () => {
    /*
     * Router down 7 -> 5 days ago, Switch 01 down 12 -> 11 days ago. Every
     * row is built from one instant, so the outages are whole days to the
     * millisecond and the minute ceiling cannot tip either figure over.
     */
    function staggeredTimeline(): Array<MonitorStatusTimeline> {
      const now: number = OneUptimeDate.getCurrentDate().getTime();

      function daysAgo(days: number): Date {
        return new Date(now - days * DAY_IN_MILLISECONDS);
      }

      return [
        makeTimelineItem({
          monitorId: ROUTER_MONITOR,
          monitorStatus: OPERATIONAL,
          startsAt: daysAgo(HISTORY_DAYS),
          endsAt: daysAgo(7),
        }),
        makeTimelineItem({
          monitorId: ROUTER_MONITOR,
          monitorStatus: OFFLINE,
          startsAt: daysAgo(7),
          endsAt: daysAgo(5),
        }),
        makeTimelineItem({
          monitorId: ROUTER_MONITOR,
          monitorStatus: OPERATIONAL,
          startsAt: daysAgo(5),
        }),
        makeTimelineItem({
          monitorId: SWITCH_MONITOR,
          monitorStatus: OPERATIONAL,
          startsAt: daysAgo(HISTORY_DAYS),
          endsAt: daysAgo(12),
        }),
        makeTimelineItem({
          monitorId: SWITCH_MONITOR,
          monitorStatus: OFFLINE,
          startsAt: daysAgo(12),
          endsAt: daysAgo(11),
        }),
        makeTimelineItem({
          monitorId: SWITCH_MONITOR,
          monitorStatus: OPERATIONAL,
          startsAt: daysAgo(11),
        }),
        makeTimelineItem({
          monitorId: WEBSITE_MONITOR,
          monitorStatus: OPERATIONAL,
          startsAt: daysAgo(HISTORY_DAYS),
        }),
      ];
    }

    beforeEach(() => {
      jest.restoreAllMocks();
      mockReads({
        statusPageResources: nestedResources(),
        statusPageGroups: nestedGroups(),
        timeline: staggeredTimeline(),
      });
    });

    test("adds up downtime that no single resource holds", async () => {
      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: STATUS_PAGE_ID,
          reportPeriod: reportPeriod(),
        });

      const downtimeByName: Dictionary<string> = {};

      for (const resource of report.resources) {
        downtimeByName[resource.resourceName] =
          resource.downtimeInHoursAndMinutes;
      }

      expect(downtimeByName["Router"]).toBe("2 days, 0 minutes");
      expect(downtimeByName["Switch 01"]).toBe("1 days, 0 minutes");

      /*
       * Neither resource was down for three days, so only the merged
       * downtime can say so - the floor at the largest resource must not
       * replace it.
       */
      const corporate: StatusPageReportGroup = report.groups[0]!;
      const unit: StatusPageReportGroup =
        corporate.subGroups[0]!.subGroups[0]!.subGroups[0]!;

      expect(unit.downtimeInHoursAndMinutes).toBe("3 days, 0 minutes");
      expect(corporate.downtimeInHoursAndMinutes).toBe("3 days, 0 minutes");
      expect(report.totalDowntimeInHoursAndMinutes).toBe("3 days, 0 minutes");
    });

    test("never prints a group below one of its own resources", async () => {
      /*
       * A union counts an overlap between two rows of the SAME monitor once
       * and the day aggregate twice; deleting a row from the middle of a
       * timeline leaves such an overlap. Stood in for here by a merge that
       * reads a day, below Router's own two.
       */
      jest
        .spyOn(StatusPageService, "getMergedDowntimeForStatusPage")
        .mockResolvedValue({
          coveredSeconds: HISTORY_DAYS * 86400,
          downtimeSeconds: 86400,
        });

      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: STATUS_PAGE_ID,
          reportPeriod: reportPeriod(),
        });

      const unit: StatusPageReportGroup =
        report.groups[0]!.subGroups[0]!.subGroups[0]!.subGroups[0]!;

      expect(unit.downtimeInHoursAndMinutes).toBe("2 days, 0 minutes");
      expect(report.totalDowntimeInHoursAndMinutes).toBe("2 days, 0 minutes");
    });
  });

  /*
   * Router down 7 -> 5 days ago and Switch 01 down 6.5 -> 4 days ago. At
   * least one of them was down from 7 days ago to 4 days ago: three days.
   */
  describe("a group whose monitors' outages overlap", () => {
    function overlappingTimeline(): Array<MonitorStatusTimeline> {
      const now: number = OneUptimeDate.getCurrentDate().getTime();

      function daysAgo(days: number): Date {
        return new Date(now - days * DAY_IN_MILLISECONDS);
      }

      return [
        makeTimelineItem({
          monitorId: ROUTER_MONITOR,
          monitorStatus: OPERATIONAL,
          startsAt: daysAgo(HISTORY_DAYS),
          endsAt: daysAgo(7),
        }),
        makeTimelineItem({
          monitorId: ROUTER_MONITOR,
          monitorStatus: OFFLINE,
          startsAt: daysAgo(7),
          endsAt: daysAgo(5),
        }),
        makeTimelineItem({
          monitorId: ROUTER_MONITOR,
          monitorStatus: OPERATIONAL,
          startsAt: daysAgo(5),
        }),
        makeTimelineItem({
          monitorId: SWITCH_MONITOR,
          monitorStatus: OPERATIONAL,
          startsAt: daysAgo(HISTORY_DAYS),
          endsAt: daysAgo(6.5),
        }),
        makeTimelineItem({
          monitorId: SWITCH_MONITOR,
          monitorStatus: OFFLINE,
          startsAt: daysAgo(6.5),
          endsAt: daysAgo(4),
        }),
        makeTimelineItem({
          monitorId: SWITCH_MONITOR,
          monitorStatus: OPERATIONAL,
          startsAt: daysAgo(4),
        }),
        makeTimelineItem({
          monitorId: WEBSITE_MONITOR,
          monitorStatus: OPERATIONAL,
          startsAt: daysAgo(HISTORY_DAYS),
        }),
      ];
    }

    beforeEach(() => {
      jest.restoreAllMocks();
      mockReads({
        statusPageResources: nestedResources(),
        statusPageGroups: nestedGroups(),
        timeline: overlappingTimeline(),
      });
    });

    test("the old row merge cut the outage short", () => {
      const period: StatusPageReportPeriod = reportPeriod();

      const groupRows: Array<MonitorStatusTimeline> =
        overlappingTimeline().filter((row: MonitorStatusTimeline) => {
          return row.monitorId?.toString() !== WEBSITE_MONITOR.toString();
        });

      /*
       * The premise. UptimeUtil.getNonOverlappingMonitorEvents keeps one
       * event at a time: a row of another monitor that starts later and runs
       * longer ends the current one. Switch 01's Offline row ends Router's
       * half a day in, and Router's Operational row ends Switch 01's a day
       * early - two days of a three day outage, with no row cap involved.
       */
      expect(
        UptimeUtil.getTotalDowntimeInSeconds(groupRows, [OFFLINE], {
          startDate: period.startDate,
          endDate: period.endDate,
        }).totalDowntimeInSeconds,
      ).toBe(2 * 86400);
    });

    test("counts the time at least one monitor was down, once", async () => {
      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: STATUS_PAGE_ID,
          reportPeriod: reportPeriod(),
        });

      const downtimeByName: Dictionary<string> = {};

      for (const resource of report.resources) {
        downtimeByName[resource.resourceName] =
          resource.downtimeInHoursAndMinutes;
      }

      expect(downtimeByName["Router"]).toBe("2 days, 0 minutes");
      expect(downtimeByName["Switch 01"]).toBe("2 days, 12 hours, 0 minutes");

      /*
       * Not the old merge's two days, not the largest resource's two and a
       * half it was floored at, and not the four and a half the two
       * resources add up to.
       */
      const corporate: StatusPageReportGroup = report.groups[0]!;
      const unit: StatusPageReportGroup =
        corporate.subGroups[0]!.subGroups[0]!.subGroups[0]!;

      expect(unit.downtimeInHoursAndMinutes).toBe("3 days, 0 minutes");
      expect(corporate.downtimeInHoursAndMinutes).toBe("3 days, 0 minutes");
      expect(report.totalDowntimeInHoursAndMinutes).toBe("3 days, 0 minutes");
    });
  });

  describe("backwards compatibility", () => {
    test("still exposes the flat resource list custom templates loop over", async () => {
      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: STATUS_PAGE_ID,
          reportPeriod: reportPeriod(),
        });

      expect(
        report.resources.map((resource: StatusPageReportItem) => {
          return resource.resourceName;
        }),
      ).toEqual(["Router", "WBHQ website", "Switch 01"]);

      for (const resource of report.resources) {
        expect(typeof resource.uptimePercentAsString).toBe("string");
        expect(typeof resource.downtimeInHoursAndMinutes).toBe("string");
        expect(typeof resource.totalIncidentCount).toBe("number");
      }
    });
  });

  describe("a status page without groups", () => {
    beforeEach(() => {
      jest.restoreAllMocks();
      mockReads({
        statusPageResources: [
          makeResource({
            displayName: "Router",
            monitorId: ROUTER_MONITOR,
            order: 1,
          }),
          makeResource({
            displayName: "WBHQ website",
            monitorId: WEBSITE_MONITOR,
            order: 2,
          }),
        ],
        statusPageGroups: [],
        timeline: makeTimeline(),
      });
    });

    test("reports a flat list and says so", async () => {
      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: STATUS_PAGE_ID,
          reportPeriod: reportPeriod(),
        });

      expect(report.hasGroups).toBe(false);
      expect(report.groups).toEqual([]);
      expect(rowNames(report.rows)).toEqual(["Router", "WBHQ website"]);
      expect(
        report.rows.every((row: StatusPageReportRow) => {
          return !row.isGroup && row.indentInPixels === 0;
        }),
      ).toBe(true);
    });
  });

  /*
   * The bug this pins: the report measured every resource from timeline rows
   * fetched under one LIMIT_MAX (10,000) across the whole page, newest first.
   * A flapping monitor fills that in days - status.chainflip.io matched
   * 255,733 rows in 60 days - so every figure covered only the newest days of
   * the window, and lp.chainflip.io reported 99.876% for a window it was up
   * 99.667% of. A single-monitor resource is now measured from the uncapped
   * day aggregate, and a monitor group, a status page group and the page from
   * the uncapped merged downtime.
   */
  describe("a page whose timeline rows are cut off by the row cap", () => {
    const SENT_AT: Date = new Date("2026-08-01T00:00:00.000Z");
    const WINDOW_DAYS: number = 60;
    const DAY: number = DAY_IN_MILLISECONDS;

    /*
     * Stands in for LIMIT_MAX. Newest first, 11 rows is the flapping
     * monitor's last five days and the edge monitor's latest row - which is
     * all the capped fetch hands back.
     */
    const ROW_CAP: number = 11;

    const FLAPPING_MONITOR: ObjectID = new ObjectID(
      "aa000000-0000-4000-8000-000000000011",
    );
    const QUIET_MONITOR: ObjectID = new ObjectID(
      "aa000000-0000-4000-8000-000000000012",
    );
    const EDGE_MONITOR: ObjectID = new ObjectID(
      "aa000000-0000-4000-8000-000000000013",
    );
    const UNRECORDED_MONITOR: ObjectID = new ObjectID(
      "aa000000-0000-4000-8000-000000000014",
    );
    const EDGE_MONITOR_GROUP: ObjectID = new ObjectID(
      "cc000000-0000-4000-8000-000000000001",
    );

    // June 2 - August 1: no daylight saving change anywhere in it.
    function sixtyDayPeriod(): StatusPageReportPeriod {
      return StatusPageReportPeriodUtil.getReportPeriod({
        periodType: StatusPageReportPeriodType.Rolling,
        reportDataInDays: WINDOW_DAYS,
        timezone: Timezone.AmericaNew_York,
        sentAt: SENT_AT,
      });
    }

    function at(offsetInMilliseconds: number): Date {
      return new Date(
        sixtyDayPeriod().startDate.getTime() + offsetInMilliseconds,
      );
    }

    /*
     * Offline for a moment at noon every day: five minutes a day for the
     * first 55 days, one minute a day for the last five. Recently quiet, so
     * the newest rows alone make it look healthier than it was.
     */
    function flappingTimeline(): Array<MonitorStatusTimeline> {
      const rows: Array<MonitorStatusTimeline> = [];
      let operationalSince: Date = at(-DAY);

      for (let dayIndex: number = 0; dayIndex < WINDOW_DAYS; dayIndex++) {
        const offlineStart: Date = at(dayIndex * DAY + DAY / 2);
        const offlineEnd: Date = new Date(
          offlineStart.getTime() + (dayIndex < 55 ? 300 : 60) * 1000,
        );

        rows.push(
          makeTimelineItem({
            monitorId: FLAPPING_MONITOR,
            monitorStatus: OPERATIONAL,
            startsAt: operationalSince,
            endsAt: offlineStart,
          }),
          makeTimelineItem({
            monitorId: FLAPPING_MONITOR,
            monitorStatus: OFFLINE,
            startsAt: offlineStart,
            endsAt: offlineEnd,
          }),
        );

        operationalSince = offlineEnd;
      }

      rows.push(
        makeTimelineItem({
          monitorId: FLAPPING_MONITOR,
          monitorStatus: OPERATIONAL,
          startsAt: operationalSince,
        }),
      );

      return rows;
    }

    function timeline(): Array<MonitorStatusTimeline> {
      return [
        ...flappingTimeline(),
        /*
         * Down for one whole day early in the window, fine since. Its rows
         * are old, so under a newest-first cap a noisy neighbour pushes every
         * one of them out.
         */
        makeTimelineItem({
          monitorId: QUIET_MONITOR,
          monitorStatus: OPERATIONAL,
          startsAt: at(-30 * DAY),
          endsAt: at(10 * DAY),
        }),
        makeTimelineItem({
          monitorId: QUIET_MONITOR,
          monitorStatus: OFFLINE,
          startsAt: at(10 * DAY),
          endsAt: at(11 * DAY),
        }),
        makeTimelineItem({
          monitorId: QUIET_MONITOR,
          monitorStatus: OPERATIONAL,
          startsAt: at(11 * DAY),
        }),
        // behind a monitor group; offline for the last six hours.
        makeTimelineItem({
          monitorId: EDGE_MONITOR,
          monitorStatus: OPERATIONAL,
          startsAt: at(-DAY),
          endsAt: at(WINDOW_DAYS * DAY - DAY / 4),
        }),
        makeTimelineItem({
          monitorId: EDGE_MONITOR,
          monitorStatus: OFFLINE,
          startsAt: at(WINDOW_DAYS * DAY - DAY / 4),
        }),
      ];
    }

    function resources(): Array<StatusPageResource> {
      const edge: StatusPageResource = new StatusPageResource();
      edge.displayName = "Edge";
      edge.monitorGroupId = EDGE_MONITOR_GROUP;
      edge.order = 3;

      return [
        makeResource({
          displayName: "lp.chainflip.io",
          monitorId: FLAPPING_MONITOR,
          order: 1,
        }),
        makeResource({
          displayName: "Status API",
          monitorId: QUIET_MONITOR,
          order: 2,
        }),
        edge,
        makeResource({
          displayName: "New monitor",
          monitorId: UNRECORDED_MONITOR,
          order: 4,
        }),
      ];
    }

    function itemsByName(
      report: StatusPageReport,
    ): Dictionary<StatusPageReportItem> {
      const items: Dictionary<StatusPageReportItem> = {};

      for (const item of report.resources) {
        items[item.resourceName] = item;
      }

      return items;
    }

    beforeEach(() => {
      jest.restoreAllMocks();
      mockReads({
        statusPageResources: resources(),
        statusPageGroups: [],
        timeline: timeline(),
        rowCap: ROW_CAP,
        monitorsInGroup: {
          [EDGE_MONITOR_GROUP.toString()]: [EDGE_MONITOR],
        },
      });
    });

    test("the capped rows really do lose most of the window", () => {
      const period: StatusPageReportPeriod = sixtyDayPeriod();
      const cappedRows: Array<MonitorStatusTimeline> = newestRows(
        timeline(),
        ROW_CAP,
      ).filter((row: MonitorStatusTimeline) => {
        return row.monitorId?.toString() === FLAPPING_MONITOR.toString();
      });

      // the premise of every test below: the rows alone say 99.92%.
      expect(
        UptimeUtil.calculateUptimePercentage(
          cappedRows,
          UptimePrecision.TWO_DECIMAL,
          [OFFLINE],
          { startDate: period.startDate, endDate: period.endDate },
        ),
      ).toBe(99.92);
    });

    test("measures a flapping monitor's uptime over the whole window", async () => {
      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: STATUS_PAGE_ID,
          reportPeriod: sixtyDayPeriod(),
        });

      /*
       * 55 x 5 minutes + 5 x 1 minute = 280 minutes down in 60 days:
       * 99.6759...%, rounded down to the report's two decimals.
       */
      expect(
        itemsByName(report)["lp.chainflip.io"]!.uptimePercentAsString,
      ).toBe("99.67%");
    });

    test("reads the downtime beside it from the same seconds", async () => {
      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: STATUS_PAGE_ID,
          reportPeriod: sixtyDayPeriod(),
        });

      // not the 5 minutes the capped rows hold.
      expect(
        itemsByName(report)["lp.chainflip.io"]!.downtimeInHoursAndMinutes,
      ).toBe("4 hours, 40 minutes");
    });

    test("keeps a quiet monitor's history when a noisy one fills the cap", async () => {
      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: STATUS_PAGE_ID,
          reportPeriod: sixtyDayPeriod(),
        });

      const quiet: StatusPageReportItem = itemsByName(report)["Status API"]!;

      // one day down in sixty, although none of its rows survive the cap.
      expect(quiet.uptimePercentAsString).toBe("98.33%");
      expect(quiet.downtimeInHoursAndMinutes).toBe("1 days, 0 minutes");
    });

    test("averages the page over the corrected figures", async () => {
      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: STATUS_PAGE_ID,
          reportPeriod: sixtyDayPeriod(),
        });

      /*
       * (99.67 + 98.33 + 99.58 for Edge + 100 for the new monitor) / 4. Edge
       * read 0% from the capped rows, which made this 74.50%.
       */
      expect(report.averageUptimePercent).toBe("99.39%");
    });

    test("asks for the day aggregate of single monitors, over the report window, cut in UTC", async () => {
      const period: StatusPageReportPeriod = sixtyDayPeriod();

      await StatusPageService.getReportByStatusPage({
        statusPageId: STATUS_PAGE_ID,
        reportPeriod: period,
      });

      const aggregateSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        StatusPageService,
        "getUptimeDailyAggregateForStatusPage",
      ) as ReturnType<typeof jest.spyOn>;

      expect(aggregateSpy).toHaveBeenCalledTimes(1);

      const request: AggregateRequest = aggregateSpy.mock
        .calls[0]![0] as AggregateRequest;

      expect(
        request.monitorIds.map((monitorId: ObjectID) => {
          return monitorId.toString();
        }),
      ).toEqual([
        FLAPPING_MONITOR.toString(),
        QUIET_MONITOR.toString(),
        UNRECORDED_MONITOR.toString(),
      ]);
      expect(request.startDate).toEqual(period.startDate);
      expect(request.endDate).toEqual(period.endDate);
      // not the report's America/New_York: only window totals are read.
      expect(request.timezone).toBe("UTC");
    });

    /*
     * Postgres reads the OS tzdata, and the images OneUptime ships (Debian
     * trixie, no tzdata-legacy) reject these link names in `AT TIME ZONE`,
     * although moment knows all but US/Pacific-New. The report settings no
     * longer offer them, but rows saved before that and API callers still
     * hold them. Handed to the aggregate, any of them would fail the query
     * and with it the whole report.
     */
    test.each([
      Timezone.USEastern,
      Timezone.AsiaCalcutta,
      Timezone.GB,
      Timezone.USPacificNew,
    ])(
      "never hands the report's timezone (%s) to the aggregate",
      async (timezone: Timezone) => {
        const period: StatusPageReportPeriod = {
          ...sixtyDayPeriod(),
          timezone: timezone,
        };

        const report: StatusPageReport =
          await StatusPageService.getReportByStatusPage({
            statusPageId: STATUS_PAGE_ID,
            reportPeriod: period,
          });

        const aggregateSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
          StatusPageService,
          "getUptimeDailyAggregateForStatusPage",
        ) as ReturnType<typeof jest.spyOn>;

        expect(
          (aggregateSpy.mock.calls[0]![0] as AggregateRequest).timezone,
        ).toBe("UTC");

        // the totals do not depend on where the days are cut.
        expect(
          itemsByName(report)["lp.chainflip.io"]!.uptimePercentAsString,
        ).toBe("99.67%");
        expect(report.reportTimezone).toBe(timezone);
      },
    );

    test("merges the page's downtime over the whole window, not the rows the cap left", async () => {
      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: STATUS_PAGE_ID,
          reportPeriod: sixtyDayPeriod(),
        });

      /*
       * The capped rows hold 6 hours and 5 minutes of downtime, and the page
       * used to print "Status API"'s one day it was floored at. At least one
       * monitor was down for 280 minutes of flapping, the quiet monitor's day
       * - which swallows one five minute flap - and Edge's last six hours:
       * 280 - 5 + 1440 + 360 = 2075 minutes.
       */
      expect(report.totalDowntimeInHoursAndMinutes).toBe(
        "1 days, 10 hours, 35 minutes",
      );
    });

    test("never reads the capped rows", async () => {
      const rowFetch: ReturnType<typeof jest.spyOn> = jest.spyOn(
        StatusPageService,
        "getMonitorStatusTimelineForStatusPage",
      ) as ReturnType<typeof jest.spyOn>;

      rowFetch.mockClear();

      await StatusPageService.getReportByStatusPage({
        statusPageId: STATUS_PAGE_ID,
        reportPeriod: sixtyDayPeriod(),
      });

      expect(rowFetch).not.toHaveBeenCalled();
    });

    test("asks for merged downtime over the report window and the page's downtime statuses", async () => {
      const period: StatusPageReportPeriod = sixtyDayPeriod();

      await StatusPageService.getReportByStatusPage({
        statusPageId: STATUS_PAGE_ID,
        reportPeriod: period,
      });

      const mergedSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        StatusPageService,
        "getMergedDowntimeForStatusPage",
      ) as ReturnType<typeof jest.spyOn>;

      // Edge's monitor, then the page.
      expect(mergedSpy).toHaveBeenCalledTimes(2);

      const requests: Array<MergedDowntimeRequest> = mergedSpy.mock.calls.map(
        (call: Array<unknown>): MergedDowntimeRequest => {
          return call[0] as MergedDowntimeRequest;
        },
      );

      expect(
        requests.map((request: MergedDowntimeRequest) => {
          return request.monitorIds
            .map((monitorId: ObjectID) => {
              return monitorId.toString();
            })
            .sort();
        }),
      ).toEqual([
        [EDGE_MONITOR.toString()],
        [
          FLAPPING_MONITOR.toString(),
          QUIET_MONITOR.toString(),
          EDGE_MONITOR.toString(),
          UNRECORDED_MONITOR.toString(),
        ].sort(),
      ]);

      for (const request of requests) {
        expect(request.startDate).toEqual(period.startDate);
        expect(request.endDate).toEqual(period.endDate);
        expect(
          request.downtimeMonitorStatusIds.map((id: ObjectID | string) => {
            return id.toString();
          }),
        ).toEqual([OFFLINE.id!.toString()]);
      }
    });

    test("merges a group's downtime over its monitors, not the rows the cap left", async () => {
      const GROUP: ObjectID = new ObjectID(
        "dd000000-0000-4000-8000-000000000001",
      );

      jest.restoreAllMocks();
      mockReads({
        statusPageResources: [
          makeResource({
            displayName: "lp.chainflip.io",
            monitorId: FLAPPING_MONITOR,
            groupId: GROUP,
            order: 1,
          }),
          makeResource({
            displayName: "Status API",
            monitorId: QUIET_MONITOR,
            groupId: GROUP,
            order: 2,
          }),
        ],
        statusPageGroups: [makeGroup({ id: GROUP, name: "APIs" })],
        timeline: timeline(),
        rowCap: ROW_CAP,
      });

      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: STATUS_PAGE_ID,
          reportPeriod: sixtyDayPeriod(),
        });

      const group: StatusPageReportGroup = report.groups[0]!;

      // (99.67 + 98.33) / 2: the group's uptime averages corrected figures.
      expect(group.uptimePercentAsString).toBe("99%");

      /*
       * Its capped rows hold only the flapping monitor's last five minutes
       * down, and it used to print "Status API"'s one day it was floored at.
       * Merged: 280 minutes of flapping and the quiet monitor's day, which
       * swallows one five minute flap - 1715 minutes.
       */
      expect(group.downtimeInHoursAndMinutes).toBe(
        "1 days, 4 hours, 35 minutes",
      );
      expect(report.totalDowntimeInHoursAndMinutes).toBe(
        "1 days, 4 hours, 35 minutes",
      );
    });

    test("measures a monitor group over the whole window, not the rows the cap left", async () => {
      const period: StatusPageReportPeriod = sixtyDayPeriod();

      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: STATUS_PAGE_ID,
          reportPeriod: period,
        });

      /*
       * The premise: only Edge's Offline row survives the cap, so the rows
       * alone say it was down the whole time.
       */
      const edgeRows: Array<MonitorStatusTimeline> = newestRows(
        timeline(),
        ROW_CAP,
      ).filter((row: MonitorStatusTimeline) => {
        return row.monitorId?.toString() === EDGE_MONITOR.toString();
      });

      expect(
        UptimeUtil.calculateUptimePercentage(
          edgeRows,
          UptimePrecision.TWO_DECIMAL,
          [OFFLINE],
          { startDate: period.startDate, endDate: period.endDate },
        ),
      ).toBe(0);

      /*
       * Merged over its monitor for the whole window: six hours down in
       * sixty days, 99.5833...%, and the six hours beside it.
       */
      const edge: StatusPageReportItem = itemsByName(report)["Edge"]!;

      expect(edge.uptimePercentAsString).toBe("99.58%");
      expect(edge.downtimeInHoursAndMinutes).toBe("6 hours, 0 minutes");
    });

    test("prints 100% and no downtime for a monitor with nothing recorded, rather than null", async () => {
      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: STATUS_PAGE_ID,
          reportPeriod: sixtyDayPeriod(),
        });

      const unrecorded: StatusPageReportItem =
        itemsByName(report)["New monitor"]!;

      expect(unrecorded.uptimePercent).toBe(100);
      expect(unrecorded.uptimePercentAsString).toBe("100%");
      expect(unrecorded.downtimeInHoursAndMinutes).toBe("0 minutes");
    });

    test("prints the same for a monitor group with nothing recorded", async () => {
      const EMPTY_MONITOR_GROUP: ObjectID = new ObjectID(
        "cc000000-0000-4000-8000-000000000002",
      );

      const empty: StatusPageResource = new StatusPageResource();
      empty.displayName = "Empty group";
      empty.monitorGroupId = EMPTY_MONITOR_GROUP;
      empty.order = 1;

      jest.restoreAllMocks();
      mockReads({
        statusPageResources: [empty],
        statusPageGroups: [],
        timeline: timeline(),
        rowCap: ROW_CAP,
        monitorsInGroup: {
          [EMPTY_MONITOR_GROUP.toString()]: [UNRECORDED_MONITOR],
        },
      });

      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: STATUS_PAGE_ID,
          reportPeriod: sixtyDayPeriod(),
        });

      const item: StatusPageReportItem = itemsByName(report)["Empty group"]!;

      expect(item.uptimePercent).toBe(100);
      expect(item.uptimePercentAsString).toBe("100%");
      expect(item.downtimeInHoursAndMinutes).toBe("0 minutes");
      expect(report.totalDowntimeInHoursAndMinutes).toBe("0 minutes");
    });
  });

  describe("downtime from the day aggregate", () => {
    beforeEach(() => {
      jest.restoreAllMocks();
      mockReads({
        statusPageResources: [
          makeResource({
            displayName: "Router",
            monitorId: ROUTER_MONITOR,
            order: 1,
          }),
        ],
        statusPageGroups: [],
        timeline: makeTimeline(),
      });
    });

    test("does not round a sum of fractional seconds up by a minute", async () => {
      /*
       * The aggregate's seconds are double precision sums, and adding these
       * three in JavaScript gives 7200.000000000001. Rounded straight up to
       * the minute that would read "2 hours, 1 minutes".
       */
      const offlineSecondsByDay: Array<number> = [
        3190.800103, 2559.918649, 1449.281248,
      ];

      const buckets: Array<UptimeDayBucket> = offlineSecondsByDay.map(
        (offlineSeconds: number, index: number): UptimeDayBucket => {
          const bucketStart: Date = new Date(
            reportPeriod().startDate.getTime() + index * DAY_IN_MILLISECONDS,
          );

          return {
            bucketStart: bucketStart,
            bucketEnd: new Date(bucketStart.getTime() + DAY_IN_MILLISECONDS),
            daySeconds: 86400,
            coveredSeconds: 86400,
            statusDurations: [
              {
                monitorStatusId: OPERATIONAL.id!,
                seconds: 86400 - offlineSeconds,
              },
              { monitorStatusId: OFFLINE.id!, seconds: offlineSeconds },
            ],
          };
        },
      );

      jest
        .spyOn(StatusPageService, "getUptimeDailyAggregateForStatusPage")
        .mockResolvedValue({
          monitors: [{ monitorId: ROUTER_MONITOR, buckets: buckets }],
          isComplete: true,
          completeFrom: null,
          timezone: "UTC",
        });

      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: STATUS_PAGE_ID,
          reportPeriod: reportPeriod(),
        });

      const router: StatusPageReportItem = report.resources[0]!;

      // two hours down in three covered days.
      expect(router.uptimePercentAsString).toBe("97.22%");
      expect(router.downtimeInHoursAndMinutes).toBe("2 hours, 0 minutes");
    });
  });

  describe("a status page with no resources", () => {
    beforeEach(() => {
      jest.restoreAllMocks();
      mockReads({
        statusPageResources: [],
        statusPageGroups: nestedGroups(),
        timeline: [],
      });
    });

    test("reports nothing rather than throwing", async () => {
      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: STATUS_PAGE_ID,
          reportPeriod: reportPeriod(),
        });

      expect(report.totalResources).toBe(0);
      expect(report.resources).toEqual([]);
      expect(report.groups).toEqual([]);
      expect(report.rows).toEqual([]);
      expect(report.ungroupedResources).toEqual([]);
      expect(report.hasGroups).toBe(false);
    });
  });
});
