import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import IncidentService from "../../../Server/Services/IncidentService";
import MonitorGroupService from "../../../Server/Services/MonitorGroupService";
import StatusPageGroupService from "../../../Server/Services/StatusPageGroupService";
import StatusPageService, {
  INCIDENT_COUNT_STATUS_PAGE_SELECT,
  StatusPageReport,
  StatusPageReportItem,
} from "../../../Server/Services/StatusPageService";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import StatusPageReportPeriodType from "../../../Types/StatusPage/StatusPageReportPeriodType";
import { StatusPageReportGroupMetrics } from "../../../Types/StatusPage/StatusPageReport";
import StatusPageReportPeriodUtil, {
  StatusPageReportPeriod,
} from "../../../Utils/StatusPage/ReportPeriod";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * The incident counts in a status page's emailed report - the page total,
 * each resource and each group - count what the page shows. Through
 * IncidentStatusPageScope.countIncidentsForStatusPage, an incident limited
 * to other status pages is not counted on this one, a page that only shows
 * incidents limited to it counts only those, and (new with the scope) only
 * the project's incidents that are visible on status pages count.
 *
 * IncidentService.countBy is answered by a small in-memory database that
 * evaluates each query the way Postgres would: the monitors join, the
 * created-at window, project, visibility, privacy, and the scope split with
 * its IncidentStatusPage join. A private incident is counted on no page,
 * whatever its Visible on Status Page switch says (StatusPageVisibility).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000002",
);

const SITE_A: string = "b0000000-0000-4000-8000-00000000000a";
const SITE_B: string = "b0000000-0000-4000-8000-00000000000b";
// Only shows incidents limited to it.
const SITE_C: string = "b0000000-0000-4000-8000-00000000000c";

const SHARED_MONITOR: string = "c0000000-0000-4000-8000-000000000001";
const SECOND_MONITOR: string = "c0000000-0000-4000-8000-000000000002";
const UNLISTED_MONITOR: string = "c0000000-0000-4000-8000-000000000003";

const REGION_GROUP: string = "d0000000-0000-4000-8000-000000000001";

const HISTORY_DAYS: number = 14;

function reportPeriod(): StatusPageReportPeriod {
  return StatusPageReportPeriodUtil.getReportPeriod({
    periodType: StatusPageReportPeriodType.Rolling,
    reportDataInDays: HISTORY_DAYS,
  });
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

interface IncidentFixture {
  name: string;
  projectId: ObjectID;
  monitorIds: Array<string>;
  // null: not limited to any status page.
  scopedTo: Array<string> | null;
  isVisibleOnStatusPage: boolean;
  isPrivate?: boolean | undefined;
  createdAt: Date;
}

const INCIDENTS: Array<IncidentFixture> = [
  {
    name: "unscoped on the shared monitor",
    projectId: PROJECT_ID,
    monitorIds: [SHARED_MONITOR],
    scopedTo: null,
    isVisibleOnStatusPage: true,
    createdAt: daysAgo(2),
  },
  {
    name: "unscoped on the second monitor",
    projectId: PROJECT_ID,
    monitorIds: [SECOND_MONITOR],
    scopedTo: null,
    isVisibleOnStatusPage: true,
    createdAt: daysAgo(3),
  },
  {
    name: "limited to Site A",
    projectId: PROJECT_ID,
    monitorIds: [SHARED_MONITOR],
    scopedTo: [SITE_A],
    isVisibleOnStatusPage: true,
    createdAt: daysAgo(4),
  },
  {
    name: "limited to Sites A and C, on both monitors",
    projectId: PROJECT_ID,
    monitorIds: [SHARED_MONITOR, SECOND_MONITOR],
    scopedTo: [SITE_A, SITE_C],
    isVisibleOnStatusPage: true,
    createdAt: daysAgo(5),
  },
  {
    name: "limited to Site B",
    projectId: PROJECT_ID,
    monitorIds: [SHARED_MONITOR],
    scopedTo: [SITE_B],
    isVisibleOnStatusPage: true,
    createdAt: daysAgo(5),
  },
  {
    name: "limited to a deleted page",
    projectId: PROJECT_ID,
    monitorIds: [SHARED_MONITOR],
    scopedTo: [],
    isVisibleOnStatusPage: true,
    createdAt: daysAgo(6),
  },
  {
    name: "unscoped, hidden from status pages",
    projectId: PROJECT_ID,
    monitorIds: [SHARED_MONITOR],
    scopedTo: null,
    isVisibleOnStatusPage: false,
    createdAt: daysAgo(6),
  },
  {
    name: "limited to Site A, hidden from status pages",
    projectId: PROJECT_ID,
    monitorIds: [SHARED_MONITOR],
    scopedTo: [SITE_A],
    isVisibleOnStatusPage: false,
    createdAt: daysAgo(6),
  },
  {
    name: "another project's, on the shared monitor",
    projectId: OTHER_PROJECT_ID,
    monitorIds: [SHARED_MONITOR],
    scopedTo: null,
    isVisibleOnStatusPage: true,
    createdAt: daysAgo(2),
  },
  {
    name: "unscoped, before the window",
    projectId: PROJECT_ID,
    monitorIds: [SHARED_MONITOR],
    scopedTo: null,
    isVisibleOnStatusPage: true,
    createdAt: daysAgo(HISTORY_DAYS + 10),
  },
  {
    name: "unscoped, on a monitor the page does not list",
    projectId: PROJECT_ID,
    monitorIds: [UNLISTED_MONITOR],
    scopedTo: null,
    isVisibleOnStatusPage: true,
    createdAt: daysAgo(2),
  },
  {
    name: "unscoped and private, with Visible on Status Page still on",
    projectId: PROJECT_ID,
    monitorIds: [SHARED_MONITOR, SECOND_MONITOR],
    scopedTo: null,
    isVisibleOnStatusPage: true,
    isPrivate: true,
    createdAt: daysAgo(2),
  },
  {
    name: "limited to Sites A, B and C and private, with Visible on Status Page still on",
    projectId: PROJECT_ID,
    monitorIds: [SHARED_MONITOR, SECOND_MONITOR],
    scopedTo: [SITE_A, SITE_B, SITE_C],
    isVisibleOnStatusPage: true,
    isPrivate: true,
    createdAt: daysAgo(3),
  },
];

/*
 * The privacy clause the counts carry (StatusPageVisibilityQuery): the
 * privacy filters' anonymous form, `isPrivate IS NULL OR isPrivate =
 * FALSE`. Anything else on isPrivate is not what the status page code sends.
 */
function isNotPrivateClause(expected: unknown): boolean {
  const operator: FindOperator<unknown> = expected as FindOperator<unknown>;

  return (
    operator instanceof FindOperator &&
    Boolean(operator.getSql) &&
    operator.getSql!("private_column") ===
      "(private_column IS NULL OR private_column = FALSE)"
  );
}

function parametersOf(operator: unknown): Array<unknown> {
  return Object.values(
    (operator as { objectLiteralParameters?: Dictionary<unknown> })
      .objectLiteralParameters || {},
  );
}

function idList(value: unknown): Array<string> {
  return (value as Array<ObjectID | string>).map(
    (id: ObjectID | string): string => {
      return id.toString().toLowerCase();
    },
  );
}

function matches(
  incident: IncidentFixture,
  query: Dictionary<unknown>,
): boolean {
  return Object.entries(query).every(
    ([key, expected]: [string, unknown]): boolean => {
      switch (key) {
        case "projectId":
          return incident.projectId.toString() === String(expected);
        case "isVisibleOnStatusPage":
          return incident.isVisibleOnStatusPage === expected;
        case "isPrivate":
          if (!isNotPrivateClause(expected)) {
            throw new Error(
              `Unexpected isPrivate condition in an incident count query: ${String(expected)}`,
            );
          }
          return incident.isPrivate !== true;
        case "isScopedToStatusPages":
          return (incident.scopedTo !== null) === expected;
        case "monitors": {
          const monitorIds: Array<string> = idList(expected);
          return incident.monitorIds.some((id: string): boolean => {
            return monitorIds.includes(id);
          });
        }
        case "statusPages": {
          const statusPageIds: Array<string> = idList(expected);
          return (incident.scopedTo || []).some((id: string): boolean => {
            return statusPageIds.includes(id);
          });
        }
        case "createdAt": {
          const [start, end] = parametersOf(expected) as [Date, Date];
          const time: number = incident.createdAt.getTime();
          return start.getTime() <= time && time <= end.getTime();
        }
        default:
          throw new Error(`Unexpected incident count query key: ${key}`);
      }
    },
  );
}

type CountQuery = Dictionary<unknown>;

let countQueries: Array<CountQuery> = [];

function mockIncidentCounts(): void {
  countQueries = [];

  jest
    .spyOn(IncidentService, "countBy")
    .mockImplementation(async (args: any) => {
      const query: CountQuery = args.query as CountQuery;
      countQueries.push(query);
      return new PositiveNumber(
        INCIDENTS.filter((incident: IncidentFixture) => {
          return matches(incident, query);
        }).length,
      ) as never;
    });
}

function makePage(data: {
  id: string;
  onlyShowScopedIncidents?: boolean | undefined;
  projectId?: ObjectID | null | undefined;
}): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = data.id;

  if (data.projectId !== null) {
    page.projectId = data.projectId || PROJECT_ID;
  }

  if (data.onlyShowScopedIncidents !== undefined) {
    page.onlyShowScopedIncidents = data.onlyShowScopedIncidents;
  }

  return page;
}

function count(page: StatusPage, monitorIds: Array<string>): Promise<number> {
  const period: StatusPageReportPeriod = reportPeriod();

  return StatusPageService.getIncidentCountByMonitorIds({
    statusPage: page,
    monitorIds: monitorIds.map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    startDate: period.startDate,
    endDate: period.endDate,
  });
}

describe("StatusPageService report incident counts", () => {
  beforeEach(() => {
    mockIncidentCounts();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getIncidentCountByMonitorIds", () => {
    test("counts on a page the unscoped incidents and those limited to it, visible and in its project", async () => {
      /*
       * unscoped on the shared monitor, limited to Site A, limited to Sites A
       * and C. Not: limited to B, limited to a deleted page, the two hidden
       * ones, the other project's, the one before the window.
       */
      expect(
        await count(makePage({ id: SITE_A, onlyShowScopedIncidents: false }), [
          SHARED_MONITOR,
        ]),
      ).toBe(3);

      // unscoped on the shared monitor, limited to Site B.
      expect(
        await count(makePage({ id: SITE_B, onlyShowScopedIncidents: false }), [
          SHARED_MONITOR,
        ]),
      ).toBe(2);
    });

    test("counts over every monitor asked about, in one count", async () => {
      expect(
        await count(makePage({ id: SITE_A, onlyShowScopedIncidents: false }), [
          SHARED_MONITOR,
          SECOND_MONITOR,
        ]),
      ).toBe(4);
    });

    test("a page that only shows incidents limited to it counts only those", async () => {
      expect(
        await count(makePage({ id: SITE_C, onlyShowScopedIncidents: true }), [
          SHARED_MONITOR,
          SECOND_MONITOR,
        ]),
      ).toBe(1);

      // It never asks about unscoped incidents.
      expect(
        countQueries.map((query: CountQuery) => {
          return query["isScopedToStatusPages"];
        }),
      ).toEqual([true]);
    });

    test("a page whose onlyShowScopedIncidents was not loaded counts only scoped incidents (fails closed)", async () => {
      expect(await count(makePage({ id: SITE_A }), [SHARED_MONITOR])).toBe(2);
    });

    test("asks in two disjoint halves, each on the project's visible incidents in the window", async () => {
      const page: StatusPage = makePage({
        id: SITE_A,
        onlyShowScopedIncidents: false,
      });

      await count(page, [SHARED_MONITOR]);

      expect(countQueries).toHaveLength(2);

      for (const query of countQueries) {
        expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
        expect(query["isVisibleOnStatusPage"]).toBe(true);
        // And not private, as anyone outside the project reads it.
        expect(isNotPrivateClause(query["isPrivate"])).toBe(true);
        expect(idList(query["monitors"])).toEqual([SHARED_MONITOR]);
        expect(parametersOf(query["createdAt"])).toHaveLength(2);
      }

      expect(countQueries[0]!["isScopedToStatusPages"]).toBe(false);
      expect(countQueries[0]).not.toHaveProperty("statusPages");
      expect(countQueries[1]!["isScopedToStatusPages"]).toBe(true);
      expect(countQueries[1]!["statusPages"]).toEqual([SITE_A]);
    });

    test("counts nothing, and asks nothing, for no monitors", async () => {
      expect(
        await count(
          makePage({ id: SITE_A, onlyShowScopedIncidents: false }),
          [],
        ),
      ).toBe(0);
      expect(countQueries).toEqual([]);
    });

    test("refuses a page without its project rather than counting every project", async () => {
      await expect(
        count(
          makePage({
            id: SITE_A,
            onlyShowScopedIncidents: false,
            projectId: null,
          }),
          [SHARED_MONITOR],
        ),
      ).rejects.toBeInstanceOf(BadDataException);
      expect(countQueries).toEqual([]);
    });
  });

  describe("getIncidentCountOnStatusPage", () => {
    test("counts over every monitor on the page, scoped to it", async () => {
      jest
        .spyOn(StatusPageService, "getMonitorIdsOnStatusPage")
        .mockResolvedValue({
          monitorsOnStatusPage: [
            new ObjectID(SHARED_MONITOR),
            new ObjectID(SECOND_MONITOR),
          ],
          monitorsInGroup: {},
        });

      const period: StatusPageReportPeriod = reportPeriod();

      expect(
        await StatusPageService.getIncidentCountOnStatusPage({
          statusPage: makePage({ id: SITE_B, onlyShowScopedIncidents: false }),
          startDate: period.startDate,
          endDate: period.endDate,
        }),
      ).toBe(3);

      expect(StatusPageService.getMonitorIdsOnStatusPage).toHaveBeenCalledWith({
        statusPageId: new ObjectID(SITE_B),
      });
    });
  });

  describe("getReportGroupMetrics", () => {
    test("counts a group's incidents scoped to the page", async () => {
      const group: StatusPageGroup = new StatusPageGroup();
      group._id = REGION_GROUP;
      group.name = "Region";

      const resources: Array<StatusPageResource> = [
        SHARED_MONITOR,
        SECOND_MONITOR,
      ].map((monitorId: string): StatusPageResource => {
        const resource: StatusPageResource = new StatusPageResource();
        resource.monitorId = new ObjectID(monitorId);
        resource.statusPageGroupId = new ObjectID(REGION_GROUP);
        return resource;
      });

      jest
        .spyOn(StatusPageService, "getMergedDowntimeForStatusPage")
        .mockResolvedValue({ coveredSeconds: 0, downtimeSeconds: 0 });

      const period: StatusPageReportPeriod = reportPeriod();

      const metricsFor: (
        page: StatusPage,
      ) => Promise<Dictionary<StatusPageReportGroupMetrics>> = (
        page: StatusPage,
      ) => {
        return StatusPageService.getReportGroupMetrics({
          statusPage: page,
          statusPageGroups: [group],
          entries: resources.map((resource: StatusPageResource) => {
            return {
              statusPageResource: resource,
              reportItem: {
                resourceName: "",
                totalIncidentCount: 0,
                uptimePercent: 100,
                uptimePercentAsString: "100%",
                downtimeInHoursAndMinutes: "0",
              } as StatusPageReportItem,
            };
          }),
          monitorIdsByResourceIndex: resources.map(
            (resource: StatusPageResource) => {
              return [resource.monitorId!];
            },
          ),
          downtimeMonitorStatusIds: [],
          reportWindow: {
            startDate: period.startDate,
            endDate: period.endDate,
          },
        });
      };

      expect(
        (
          await metricsFor(
            makePage({ id: SITE_A, onlyShowScopedIncidents: false }),
          )
        )[REGION_GROUP]!.totalIncidentCount,
      ).toBe(4);

      expect(
        (
          await metricsFor(
            makePage({ id: SITE_C, onlyShowScopedIncidents: true }),
          )
        )[REGION_GROUP]!.totalIncidentCount,
      ).toBe(1);
    });
  });

  describe("getReportByStatusPage", () => {
    function mockReport(page: StatusPage): void {
      const resources: Array<StatusPageResource> = [
        SHARED_MONITOR,
        SECOND_MONITOR,
      ].map((monitorId: string, index: number): StatusPageResource => {
        const resource: StatusPageResource = new StatusPageResource();
        resource._id = `e0000000-0000-4000-8000-00000000000${index}`;
        resource.monitorId = new ObjectID(monitorId);
        resource.displayName =
          monitorId === SHARED_MONITOR ? "Checkout" : "Payments";
        return resource;
      });

      jest
        .spyOn(StatusPageService, "findOneById")
        .mockResolvedValue(page as never);
      jest
        .spyOn(StatusPageService, "getStatusPageResources")
        .mockResolvedValue(resources as never);
      jest.spyOn(StatusPageGroupService, "findBy").mockResolvedValue([]);
      jest
        .spyOn(MonitorGroupService, "getMonitorIdsInMonitorGroups")
        .mockResolvedValue({});
      jest
        .spyOn(StatusPageService, "getUptimeDailyAggregateForStatusPage")
        .mockResolvedValue({
          monitors: [],
          isComplete: true,
          completeFrom: null,
        } as never);
      jest
        .spyOn(StatusPageService, "getMergedDowntimeForStatusPage")
        .mockResolvedValue({ coveredSeconds: 0, downtimeSeconds: 0 });
    }

    function resourceCounts(report: StatusPageReport): Dictionary<number> {
      const counts: Dictionary<number> = {};

      for (const item of report.resources) {
        counts[item.resourceName] = item.totalIncidentCount;
      }

      return counts;
    }

    test("loads what the counts are scoped by with the page", async () => {
      mockReport(makePage({ id: SITE_A, onlyShowScopedIncidents: false }));

      await StatusPageService.getReportByStatusPage({
        statusPageId: new ObjectID(SITE_A),
        reportPeriod: reportPeriod(),
      });

      const select: Dictionary<unknown> = (
        (StatusPageService.findOneById as unknown as jest.Mock).mock
          .calls[0]![0] as { select: Dictionary<unknown> }
      ).select;

      expect(INCIDENT_COUNT_STATUS_PAGE_SELECT).toEqual({
        _id: true,
        projectId: true,
        onlyShowScopedIncidents: true,
      });
      expect(select).toEqual(
        expect.objectContaining({
          _id: true,
          projectId: true,
          onlyShowScopedIncidents: true,
          downtimeMonitorStatuses: true,
        }),
      );
    });

    test("reports on a page the incidents it shows, in total and per resource", async () => {
      mockReport(makePage({ id: SITE_A, onlyShowScopedIncidents: false }));

      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: new ObjectID(SITE_A),
          reportPeriod: reportPeriod(),
        });

      expect(report.totalIncidents).toBe(4);
      expect(resourceCounts(report)).toEqual({
        Checkout: 3,
        Payments: 2,
      });
    });

    test("reports on another page sharing the monitors only what that page shows", async () => {
      mockReport(makePage({ id: SITE_B, onlyShowScopedIncidents: false }));

      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: new ObjectID(SITE_B),
          reportPeriod: reportPeriod(),
        });

      expect(report.totalIncidents).toBe(3);
      expect(resourceCounts(report)).toEqual({
        Checkout: 2,
        Payments: 1,
      });
    });

    test("reports on a page that only shows incidents limited to it only those", async () => {
      mockReport(makePage({ id: SITE_C, onlyShowScopedIncidents: true }));

      const report: StatusPageReport =
        await StatusPageService.getReportByStatusPage({
          statusPageId: new ObjectID(SITE_C),
          reportPeriod: reportPeriod(),
        });

      expect(report.totalIncidents).toBe(1);
      expect(resourceCounts(report)).toEqual({
        Checkout: 1,
        Payments: 1,
      });
    });
  });
});
