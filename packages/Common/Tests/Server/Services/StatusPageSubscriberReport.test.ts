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
 *   - a single monitor's uptime and downtime measured over the whole window
 *     even when the page's timeline rows are cut off by the row cap,
 *   - and the empty-status-page case.
 */

import StatusPageService from "../../../Server/Services/StatusPageService";
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
 * The day aggregate is built from the WHOLE timeline, as the real one is. The
 * row fetch returns the whole timeline too unless `rowCap` is set, in which
 * case it returns only the newest `rowCap` rows - the real fetch's LIMIT_MAX.
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
   * day aggregate.
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

      // (99.67 + 98.33 + Edge's 0 from the rows + 100 for the new monitor) / 4
      expect(report.averageUptimePercent).toBe("74.50%");
    });

    test("asks for the day aggregate of single monitors, over the report window, in the report's timezone", async () => {
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
      expect(request.timezone).toBe("America/New_York");
    });

    test("cuts days in UTC for a zone Postgres would refuse, rather than failing the report", async () => {
      /*
       * Still offered in the report settings, but dropped from tzdata in
       * 2020: `AT TIME ZONE 'US/Pacific-New'` is an error in Postgres.
       */
      const period: StatusPageReportPeriod = {
        ...sixtyDayPeriod(),
        timezone: Timezone.USPacificNew,
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
    });

    test("keeps a monitor group on the timeline rows", async () => {
      const period: StatusPageReportPeriod = sixtyDayPeriod();

      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: STATUS_PAGE_ID,
          reportPeriod: period,
        });

      /*
       * A group is down whenever its worst monitor is, which per-monitor day
       * sums cannot express - so it is measured from the rows the page
       * fetched, cap and all. Here only the Offline row survives the cap.
       */
      const edgeRows: Array<MonitorStatusTimeline> = newestRows(
        timeline(),
        ROW_CAP,
      ).filter((row: MonitorStatusTimeline) => {
        return row.monitorId?.toString() === EDGE_MONITOR.toString();
      });

      const fromRows: number = UptimeUtil.calculateUptimePercentage(
        edgeRows,
        UptimePrecision.TWO_DECIMAL,
        [OFFLINE],
        { startDate: period.startDate, endDate: period.endDate },
      );

      expect(itemsByName(report)["Edge"]!.uptimePercentAsString).toBe(
        `${fromRows}%`,
      );
      expect(fromRows).toBe(0);
    });

    test("falls back to the rows for a monitor with nothing recorded, rather than printing null", async () => {
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
