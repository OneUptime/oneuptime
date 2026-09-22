import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { Green, Red } from "../../../Types/BrandColors";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  UptimeDailyAggregate,
  UptimeDayBucket,
} from "../../../Types/StatusPage/UptimeDailyAggregate";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
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
 * POST /status-page-api/uptime/:statusPageId, driven through its handler.
 *
 * The page's timeline rows arrive under one 10,000 row cap across every
 * monitor on the page, newest first. On a page with a flapping monitor that
 * is the last few days of the range, so a monitor resource is measured from
 * the uncapped day aggregate instead. These tests pin that the handler hands
 * the aggregate on: the util it calls has its own tests, but they cannot see
 * whether the endpoint passes the aggregate at all.
 *
 * All reads are spied on - no database is touched.
 */

const UPTIME_ROUTE: string = "/status-page/uptime/:statusPageId";

const DAY_SECONDS: number = 86400;

const START_DATE: string = "2026-06-02T00:00:00.000Z";
const END_DATE: string = "2026-08-01T00:00:00.000Z";

const MONITOR: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const GROUP_MONITOR: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const UNRECORDED_MONITOR: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
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

/*
 * Sixty days of buckets, five minutes Offline a day for the first 55 and one
 * minute a day for the last five: 99.6759...% up.
 */
function bucketsForSixtyDays(): Array<UptimeDayBucket> {
  const buckets: Array<UptimeDayBucket> = [];

  for (let index: number = 0; index < 60; index++) {
    const offline: number = index < 55 ? 300 : 60;
    const bucketStart: Date = new Date(
      new Date(START_DATE).getTime() + index * DAY_SECONDS * 1000,
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

  return buckets;
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
 * What survives the cap for a monitor: its last minute-long outage and the
 * open row after it. Measured alone, that is 60 s down in the 43,200 s from
 * the outage to the end of the range: 99.86%.
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

function monitorResource(data: {
  name: string;
  monitorId: ObjectID;
  showUptimePercent?: boolean | undefined;
}): StatusPageResource {
  const monitor: Monitor = new Monitor();
  monitor._id = data.monitorId.toString();
  monitor.currentMonitorStatusId = OPERATIONAL.id!;

  const resource: StatusPageResource = new StatusPageResource();
  resource._id = ObjectID.generate().toString();
  resource.displayName = data.name;
  resource.monitor = monitor;
  resource.monitorId = data.monitorId;
  resource.showUptimePercent = data.showUptimePercent ?? true;
  resource.uptimePercentPrecision = UptimePrecision.TWO_DECIMAL;
  return resource;
}

function monitorGroupResource(): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = ObjectID.generate().toString();
  resource.displayName = "Edge";
  resource.monitorGroupId = MONITOR_GROUP;
  resource.showUptimePercent = true;
  resource.uptimePercentPrecision = UptimePrecision.TWO_DECIMAL;
  return resource;
}

function mockPage(): void {
  const statusPage: StatusPage = new StatusPage();
  statusPage.downtimeMonitorStatuses = [OFFLINE];

  const uptimeDailyAggregate: UptimeDailyAggregate = {
    monitors: [
      { monitorId: MONITOR, buckets: bucketsForSixtyDays() },
      { monitorId: GROUP_MONITOR, buckets: bucketsForSixtyDays() },
    ],
    isComplete: true,
    completeFrom: null,
    timezone: "UTC",
  };

  jest
    .spyOn(StatusPageAPI.prototype, "checkHasReadAccess")
    .mockResolvedValue(undefined);

  jest
    .spyOn(StatusPageAPI.prototype, "getStatusPageResourcesAndTimelines")
    .mockResolvedValue({
      statusPageResources: [
        monitorResource({ name: "lp.chainflip.io", monitorId: MONITOR }),
        monitorGroupResource(),
        monitorResource({
          name: "New monitor",
          monitorId: UNRECORDED_MONITOR,
        }),
        monitorResource({
          name: "Hidden uptime",
          monitorId: MONITOR,
          showUptimePercent: false,
        }),
      ],
      monitorStatuses: [OPERATIONAL, OFFLINE],
      monitorStatusTimelines: [
        ...cappedRows(MONITOR),
        ...cappedRows(GROUP_MONITOR),
        ...cappedRows(UNRECORDED_MONITOR),
      ],
      uptimeDailyAggregate: uptimeDailyAggregate,
      monitorGroupCurrentStatuses: {},
      statusPageGroups: [],
      statusPage: statusPage,
      monitorsOnStatusPage: [MONITOR, GROUP_MONITOR, UNRECORDED_MONITOR],
      monitorsInGroup: {
        [MONITOR_GROUP.toString()]: [GROUP_MONITOR],
      },
      startDateForMonitorTimeline: new Date(START_DATE),
      endDateForMonitorTimeline: new Date(END_DATE),
    });
}

async function uptimeByResourceName(): Promise<Record<string, number | null>> {
  const req: ExpressRequest = {
    params: {
      statusPageId: ObjectID.generate().toString(),
    },
    body: {
      startDate: START_DATE,
      endDate: END_DATE,
    },
    query: {},
    cookies: {},
    headers: {},
    socket: {},
    ips: [],
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await mockRouter.match("post", UPTIME_ROUTE).handlerFunction(req, res, next);

  expect(next).not.toHaveBeenCalled();

  const calls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as unknown as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  expect(calls).toHaveLength(1);

  const payload: JSONObject = calls[0]![2] as JSONObject;

  const uptimes: Record<string, number | null> = {};

  for (const resourceUptime of payload[
    "statusPageResourceUptimes"
  ] as Array<JSONObject>) {
    uptimes[resourceUptime["statusPageResourceName"] as string] =
      resourceUptime["uptimePercent"] as number | null;
  }

  return uptimes;
}

describe("POST /status-page-api/uptime/:statusPageId", () => {
  beforeAll(() => {
    mockRouter.routes.length = 0;
    new StatusPageAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockPage();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("measures a monitor resource over the whole range, not the rows the cap left", async () => {
    const uptimes: Record<string, number | null> = await uptimeByResourceName();

    // the capped rows alone say 99.86%.
    expect(uptimes["lp.chainflip.io"]).toBe(99.67);
  });

  it("keeps a monitor group on the rows, even with its monitor's buckets to hand", async () => {
    const uptimes: Record<string, number | null> = await uptimeByResourceName();

    expect(uptimes["Edge"]).toBe(99.86);
  });

  it("falls back to the rows for a monitor the aggregate has nothing for", async () => {
    const uptimes: Record<string, number | null> = await uptimeByResourceName();

    expect(uptimes["New monitor"]).toBe(99.86);
  });

  it("still sends no uptime for a resource that hides it", async () => {
    const uptimes: Record<string, number | null> = await uptimeByResourceName();

    expect(uptimes["Hidden uptime"]).toBeNull();
  });
});
