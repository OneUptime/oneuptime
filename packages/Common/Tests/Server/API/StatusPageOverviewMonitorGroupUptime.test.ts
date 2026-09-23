import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MonitorGroupResource from "../../../Models/DatabaseModels/MonitorGroupResource";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import MonitorGroupService from "../../../Server/Services/MonitorGroupService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import StatusPageGroupService from "../../../Server/Services/StatusPageGroupService";
import StatusPageHistoryChartBarColorRuleService from "../../../Server/Services/StatusPageHistoryChartBarColorRuleService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import StatusPageService, {
  Service as StatusPageServiceType,
} from "../../../Server/Services/StatusPageService";
import { Green, Red } from "../../../Types/BrandColors";
import Dictionary from "../../../Types/Dictionary";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import { MergedDowntimeTotals } from "../../../Types/StatusPage/MergedDowntimeTotals";
import { UptimeDailyAggregate } from "../../../Types/StatusPage/UptimeDailyAggregate";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import MonitorGroupMergedDowntimeUtil from "../../../Utils/StatusPage/MonitorGroupMergedDowntimeUtil";
import StatusPageResourceUptimeUtil from "../../../Utils/StatusPage/ResourceUptime";
import UptimeUtil from "../../../Utils/Uptime/UptimeUtil";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under ts-jest
 * (Buffer vs BinaryLike) that breaks every suite whose import graph reaches
 * it. Nothing here touches password hashing; stub the module before the
 * service import graph drags it into compilation.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

/*
 * The overview payload's monitorGroupMergedDowntime.
 *
 * The browser used to compute a monitor-group resource's uptime percentage
 * from monitorStatusTimelines. Those rows arrive under one 10,000 row cap
 * across every monitor on the page, newest first, so on a page with a
 * flapping monitor the percentage covered only the last few days. The
 * overview now ships each such group's merged downtime - the union of its
 * monitors' downtime and coverage, measured by the database from every row -
 * and the browser reads the percentage from that.
 *
 * These tests pin what the build ships, how often it asks the database, and
 * that what it ships is what the browser reads. All reads are spied on - no
 * database is touched.
 */

const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "40000000-0000-4000-8000-000000000001",
);

const DAY_SECONDS: number = 86400;
const DAY_MS: number = DAY_SECONDS * 1000;
const HISTORY_DAYS: number = 30;

const MONITOR_A: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_B: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MONITOR_C: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const MONITOR_D: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const MONITOR_E: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

// monitors A and B.
const EDGE: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-000000000001");
// B and A: the same set as EDGE, in another order.
const EDGE_MIRROR: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-000000000002",
);
// monitor C.
const PAYMENTS: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-000000000003");
// monitor D; its resource draws the history chart but hides its uptime.
const HIDDEN: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-000000000004");

const MONITORS_BY_GROUP: Dictionary<Array<ObjectID>> = {
  [EDGE.toString()]: [MONITOR_A, MONITOR_B],
  [EDGE_MIRROR.toString()]: [MONITOR_B, MONITOR_A],
  [PAYMENTS.toString()]: [MONITOR_C],
  [HIDDEN.toString()]: [MONITOR_D],
};

const OPERATIONAL: MonitorStatus = new MonitorStatus();
OPERATIONAL.id = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-000000000001");
OPERATIONAL.name = "Operational";
OPERATIONAL.priority = 1;
OPERATIONAL.color = Green;
OPERATIONAL.isOperationalState = true;

const OFFLINE: MonitorStatus = new MonitorStatus();
OFFLINE.id = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-000000000002");
OFFLINE.name = "Offline";
OFFLINE.priority = 2;
OFFLINE.color = Red;

/*
 * What the database says for each set of monitors, as the SQL returns it:
 * double precision, never rounded. Edge was down for two hours of its thirty
 * covered days; Payments has been watched for twelve days and never down.
 */
const MERGED_BY_MONITOR_SET: Dictionary<MergedDowntimeTotals> = {
  [StatusPageServiceType.getMonitorSetKey([MONITOR_A, MONITOR_B])]: {
    coveredSeconds: HISTORY_DAYS * DAY_SECONDS,
    downtimeSeconds: 7200.5,
  },
  [StatusPageServiceType.getMonitorSetKey([MONITOR_C])]: {
    coveredSeconds: 12 * DAY_SECONDS + 0.25,
    downtimeSeconds: 0,
  },
};

function monitorGroupResource(data: {
  name: string;
  monitorGroupId: ObjectID;
  showUptimePercent?: boolean | undefined;
}): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = ObjectID.generate().toString();
  resource.displayName = data.name;
  resource.monitorGroupId = data.monitorGroupId;
  resource.showUptimePercent = data.showUptimePercent ?? true;
  resource.showStatusHistoryChart = true;
  resource.uptimePercentPrecision = UptimePrecision.TWO_DECIMAL;
  return resource;
}

function monitorResource(data: {
  name: string;
  monitorId: ObjectID;
}): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = ObjectID.generate().toString();
  resource.displayName = data.name;
  resource.monitorId = data.monitorId;
  resource.showUptimePercent = true;
  resource.showStatusHistoryChart = true;
  resource.uptimePercentPrecision = UptimePrecision.TWO_DECIMAL;
  return resource;
}

// every kind of resource the build has to tell apart.
function everyKindOfResource(): Array<StatusPageResource> {
  return [
    monitorGroupResource({ name: "Edge", monitorGroupId: EDGE }),
    // an older page can list the same monitor group twice.
    monitorGroupResource({ name: "Edge again", monitorGroupId: EDGE }),
    monitorGroupResource({ name: "Edge mirror", monitorGroupId: EDGE_MIRROR }),
    monitorGroupResource({ name: "Payments", monitorGroupId: PAYMENTS }),
    monitorGroupResource({
      name: "Hidden",
      monitorGroupId: HIDDEN,
      showUptimePercent: false,
    }),
    monitorResource({ name: "API", monitorId: MONITOR_E }),
  ];
}

// what the cap left of Edge: two quiet days, Operational throughout.
function cappedRowsForEdge(): Array<MonitorStatusTimeline> {
  return [MONITOR_A, MONITOR_B].map(
    (monitorId: ObjectID): MonitorStatusTimeline => {
      const row: MonitorStatusTimeline = new MonitorStatusTimeline();
      row._id = ObjectID.generate().toString();
      row.monitorId = monitorId;
      row.monitorStatusId = OPERATIONAL.id!;
      row.monitorStatus = OPERATIONAL;
      row.startsAt = new Date(Date.now() - 2 * DAY_MS);
      return row;
    },
  );
}

type Spies = {
  mergedSpy: jest.SpyInstance;
  aggregateSpy: jest.SpyInstance;
  timelineSpy: jest.SpyInstance;
};

type WindowArgs = {
  monitorIds: Array<ObjectID>;
  startDate: Date;
  endDate: Date;
};

type MergedArgs = WindowArgs & {
  downtimeMonitorStatusIds: Array<ObjectID | string>;
};

function mockOverview(data: {
  resources: Array<StatusPageResource>;
  rows?: Array<MonitorStatusTimeline> | undefined;
}): Spies {
  const statusPage: StatusPage = new StatusPage();
  statusPage._id = STATUS_PAGE_ID.toString();
  statusPage.projectId = ObjectID.generate();
  statusPage.showUptimeHistoryInDays = HISTORY_DAYS;
  statusPage.downtimeMonitorStatuses = [OFFLINE];

  (
    jest.spyOn(StatusPageService, "findOneBy") as unknown as jest.SpyInstance
  ).mockResolvedValue(statusPage as never);

  (
    jest.spyOn(MonitorStatusService, "findBy") as unknown as jest.SpyInstance
  ).mockResolvedValue([OPERATIONAL, OFFLINE] as never);

  (
    jest.spyOn(StatusPageGroupService, "findBy") as unknown as jest.SpyInstance
  ).mockResolvedValue([] as never);

  (
    jest.spyOn(
      StatusPageResourceService,
      "findBy",
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue(data.resources as never);

  (
    jest.spyOn(
      MonitorGroupService,
      "getMonitorGroupResourcesByGroupIds",
    ) as unknown as jest.SpyInstance
  ).mockImplementation((monitorGroupIds: unknown) => {
    const resourcesByGroupId: Dictionary<Array<MonitorGroupResource>> = {};

    for (const monitorGroupId of monitorGroupIds as Array<ObjectID>) {
      resourcesByGroupId[monitorGroupId.toString()] = (
        MONITORS_BY_GROUP[monitorGroupId.toString()] || []
      ).map((monitorId: ObjectID): MonitorGroupResource => {
        const groupResource: MonitorGroupResource = new MonitorGroupResource();
        groupResource.monitorGroupId = monitorGroupId;
        groupResource.monitorId = monitorId;
        return groupResource;
      });
    }

    return Promise.resolve(resourcesByGroupId);
  });

  (
    jest.spyOn(
      MonitorGroupService,
      "getCurrentStatusesForMonitorGroups",
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue({} as never);

  const timelineSpy: jest.SpyInstance = (
    jest.spyOn(
      StatusPageService,
      "getMonitorStatusTimelineForStatusPage",
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue((data.rows || []) as never);

  const emptyAggregate: UptimeDailyAggregate = {
    monitors: [],
    isComplete: true,
    completeFrom: null,
    timezone: "UTC",
  };

  const aggregateSpy: jest.SpyInstance = (
    jest.spyOn(
      StatusPageService,
      "getUptimeDailyAggregateForStatusPage",
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue(emptyAggregate as never);

  const mergedSpy: jest.SpyInstance = (
    jest.spyOn(
      StatusPageService,
      "getMergedDowntimeForStatusPage",
    ) as unknown as jest.SpyInstance
  ).mockImplementation((args: unknown) => {
    const monitorSetKey: string = StatusPageServiceType.getMonitorSetKey(
      (args as MergedArgs).monitorIds,
    );

    return Promise.resolve(
      MERGED_BY_MONITOR_SET[monitorSetKey] || {
        coveredSeconds: 0,
        downtimeSeconds: 0,
      },
    );
  });

  (
    jest.spyOn(
      IncidentStateService,
      "getUnresolvedIncidentStates",
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue([] as never);

  (
    jest.spyOn(
      StatusPageHistoryChartBarColorRuleService,
      "findBy",
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue([] as never);

  return { mergedSpy, aggregateSpy, timelineSpy };
}

function mergedRequests(mergedSpy: jest.SpyInstance): Array<MergedArgs> {
  return mergedSpy.mock.calls.map((call: Array<unknown>): MergedArgs => {
    return call[0] as MergedArgs;
  });
}

describe("StatusPageAPI overview: monitorGroupMergedDowntime", () => {
  let api: StatusPageAPI;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    api = new StatusPageAPI();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("ships each monitor group's merged downtime as two plain numbers, keyed by monitor group id", async () => {
    mockOverview({ resources: everyKindOfResource() });

    const payload: JSONObject = await api.buildOverviewResponse(STATUS_PAGE_ID);

    /*
     * Edge and its mirror share one figure; nothing for the group that hides
     * its uptime, and nothing for a single monitor, which has its buckets.
     */
    expect(payload["monitorGroupMergedDowntime"]).toEqual({
      [EDGE.toString()]: {
        coveredSeconds: HISTORY_DAYS * DAY_SECONDS,
        downtimeSeconds: 7200.5,
      },
      [EDGE_MIRROR.toString()]: {
        coveredSeconds: HISTORY_DAYS * DAY_SECONDS,
        downtimeSeconds: 7200.5,
      },
      [PAYMENTS.toString()]: {
        coveredSeconds: 12 * DAY_SECONDS + 0.25,
        downtimeSeconds: 0,
      },
    });

    // plain JSON, none of the typed envelopes the rest of the payload carries.
    expect(JSON.stringify(payload["monitorGroupMergedDowntime"])).not.toContain(
      "_type",
    );
  });

  it("asks the database once per distinct set of monitors, over the aggregate's window and the page's downtime statuses", async () => {
    const spies: Spies = mockOverview({ resources: everyKindOfResource() });

    await api.buildOverviewResponse(STATUS_PAGE_ID);

    const requests: Array<MergedArgs> = mergedRequests(spies.mergedSpy);

    // Edge, Edge again and Edge mirror are one set; Hidden asks nothing.
    expect(
      requests.map((request: MergedArgs): string => {
        return StatusPageServiceType.getMonitorSetKey(request.monitorIds);
      }),
    ).toEqual([
      StatusPageServiceType.getMonitorSetKey([MONITOR_A, MONITOR_B]),
      StatusPageServiceType.getMonitorSetKey([MONITOR_C]),
    ]);

    expect(spies.aggregateSpy).toHaveBeenCalledTimes(1);

    const aggregateRequest: WindowArgs = spies.aggregateSpy.mock
      .calls[0]![0] as WindowArgs;

    // the page's own history, ending now.
    expect(
      (aggregateRequest.endDate.getTime() -
        aggregateRequest.startDate.getTime()) /
        DAY_MS,
    ).toBeCloseTo(HISTORY_DAYS, 2);

    for (const request of requests) {
      expect(
        request.downtimeMonitorStatusIds.map(
          (statusId: ObjectID | string): string => {
            return statusId.toString();
          },
        ),
      ).toEqual([OFFLINE.id!.toString()]);

      // the very window the bars' buckets were cut over.
      expect(request.startDate).toBe(aggregateRequest.startDate);
      expect(request.endDate).toBe(aggregateRequest.endDate);
    }
  });

  it("asks nothing and ships an empty object when no monitor group shows its uptime", async () => {
    const spies: Spies = mockOverview({
      resources: [
        monitorGroupResource({
          name: "Hidden",
          monitorGroupId: HIDDEN,
          showUptimePercent: false,
        }),
        monitorResource({ name: "API", monitorId: MONITOR_E }),
      ],
    });

    const payload: JSONObject = await api.buildOverviewResponse(STATUS_PAGE_ID);

    expect(spies.mergedSpy).not.toHaveBeenCalled();
    expect(payload["monitorGroupMergedDowntime"]).toEqual({});
  });

  it("is what the browser reads a monitor group's uptime from, rather than the rows the cap left", async () => {
    mockOverview({
      resources: everyKindOfResource(),
      rows: cappedRowsForEdge(),
    });

    const payload: JSONObject = await api.buildOverviewResponse(STATUS_PAGE_ID);

    // what the browser receives.
    const wire: JSONObject = JSON.parse(JSON.stringify(payload)) as JSONObject;

    const resources: Array<StatusPageResource> = BaseModel.fromJSONArray(
      wire["statusPageResources"] as JSONArray,
      StatusPageResource,
    );
    const edge: StatusPageResource = resources.find(
      (resource: StatusPageResource) => {
        return resource.displayName === "Edge";
      },
    )!;
    const rows: Array<MonitorStatusTimeline> = BaseModel.fromJSONArray(
      wire["monitorStatusTimelines"] as JSONArray,
      MonitorStatusTimeline,
    );
    const monitorsInGroup: Dictionary<Array<ObjectID>> =
      JSONFunctions.deserialize(
        wire["monitorsInGroup"] as JSONObject,
      ) as Dictionary<Array<ObjectID>>;
    const downtimeMonitorStatuses: Array<MonitorStatus> =
      BaseModel.fromJSONObject(wire["statusPage"] as JSONObject, StatusPage)
        .downtimeMonitorStatuses || [];

    const uptimeOfEdge: (
      monitorGroupMergedDowntime?: Dictionary<MergedDowntimeTotals> | undefined,
    ) => number | null = (
      monitorGroupMergedDowntime?: Dictionary<MergedDowntimeTotals> | undefined,
    ): number | null => {
      return StatusPageResourceUptimeUtil.calculateUptimePercentOfResource({
        statusPageResource: edge,
        monitorStatusTimelines: rows,
        precision: UptimePrecision.TWO_DECIMAL,
        downtimeMonitorStatuses: downtimeMonitorStatuses,
        monitorsInGroup: monitorsInGroup,
        uptimeWindow: {
          startDate: new Date(Date.now() - HISTORY_DAYS * DAY_MS),
          endDate: new Date(),
        },
        monitorGroupMergedDowntime: monitorGroupMergedDowntime,
      });
    };

    // two hours of thirty days: 99.72%. The rows the cap left say 100%.
    expect(
      UptimeUtil.calculateUptimePercentOfCoveredSeconds({
        coveredSeconds: HISTORY_DAYS * DAY_SECONDS,
        downtimeSeconds: 7200.5,
        precision: UptimePrecision.TWO_DECIMAL,
      }),
    ).toBe(99.72);
    expect(uptimeOfEdge()).toBe(100);

    expect(
      uptimeOfEdge(
        MonitorGroupMergedDowntimeUtil.fromJSON(
          wire["monitorGroupMergedDowntime"] as JSONObject,
        ),
      ),
    ).toBe(99.72);
  });
});
