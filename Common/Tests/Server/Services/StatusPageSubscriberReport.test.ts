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
 *   - and the empty-status-page case.
 */

import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageGroupService from "../../../Server/Services/StatusPageGroupService";
import IncidentService from "../../../Server/Services/IncidentService";
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

/*
 * Wires up every read getReportByStatusPage makes. Incident counts come back as
 * "one incident per monitor asked about", which makes it visible whether a group
 * asked about its whole subtree.
 */
function mockReads(data: {
  statusPageResources: Array<StatusPageResource>;
  statusPageGroups: Array<StatusPageGroup>;
  timeline: Array<MonitorStatusTimeline>;
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
    .spyOn(StatusPageService, "getMonitorStatusTimelineForStatusPage")
    .mockResolvedValue(data.timeline as never);

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
