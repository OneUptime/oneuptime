import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import StatusPageService from "../../../Server/Services/StatusPageService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { Green, Red, Yellow } from "../../../Types/BrandColors";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
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

// Avoid the unrelated PasswordHash TS5.9 Buffer/BinaryLike compile failure.
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
 * POST /status-page-api/uptime/:statusPageId WITH MONITORING OFF (#6478).
 *
 * The endpoint answers each resource's current status and each status page
 * group's, worked out over its subtree. A resource the page draws as Not
 * monitored (overview.notMonitoredResourceIds: a monitor whose monitoring
 * is off, a monitor group whose monitors all have it off) says so -
 * isMonitored false - and has no current status: the one its monitor holds
 * is frozen. A group takes its status from the resources beneath it that
 * are checked, and is not monitored when none is.
 *
 * Driven through its handler; every read is a stand-in.
 */

const UPTIME_ROUTE: string = "/status-page/uptime/:statusPageId";

function status(
  hex: string,
  name: string,
  priority: number,
  color: typeof Green,
): MonitorStatus {
  const model: MonitorStatus = new MonitorStatus();
  model.id = new ObjectID(
    `${hex.repeat(8)}-${hex.repeat(4)}-4${hex.repeat(3)}-8${hex.repeat(3)}-${hex.repeat(12)}`,
  );
  model.name = name;
  model.priority = priority;
  model.color = color;
  return model;
}

const OPERATIONAL: MonitorStatus = status("a", "Operational", 1, Green);
const DEGRADED: MonitorStatus = status("b", "Degraded", 2, Yellow);
const OFFLINE: MonitorStatus = status("c", "Offline", 3, Red);

function group(data: {
  name: string;
  parent?: StatusPageGroup | undefined;
  showCurrentStatus?: boolean | undefined;
}): StatusPageGroup {
  const model: StatusPageGroup = new StatusPageGroup();
  model._id = ObjectID.generate().toString();
  model.name = data.name;
  model.showCurrentStatus = data.showCurrentStatus ?? true;
  model.showUptimePercent = false;
  if (data.parent) {
    model.parentStatusPageGroupId = new ObjectID(data.parent._id!);
  }
  return model;
}

const CORE: StatusPageGroup = group({ name: "Core" });
const RETIRED: StatusPageGroup = group({ name: "Retired" });
const PLATFORM: StatusPageGroup = group({ name: "Platform" });
const LEGACY: StatusPageGroup = group({ name: "Legacy", parent: PLATFORM });
const EMPTY: StatusPageGroup = group({ name: "Empty" });

const MONITOR_GROUP_OFF: ObjectID = ObjectID.generate();
const MONITOR_GROUP_MIXED: ObjectID = ObjectID.generate();

function monitorResource(data: {
  name: string;
  status: MonitorStatus;
  group?: StatusPageGroup | undefined;
  isMonitoringOff?: boolean | undefined;
  showCurrentStatus?: boolean | undefined;
}): StatusPageResource {
  const monitor: Monitor = new Monitor();
  monitor._id = ObjectID.generate().toString();
  monitor.currentMonitorStatusId = data.status.id!;
  monitor.disableActiveMonitoring = data.isMonitoringOff === true;

  const resource: StatusPageResource = new StatusPageResource();
  resource._id = ObjectID.generate().toString();
  resource.displayName = data.name;
  resource.monitor = monitor;
  resource.monitorId = new ObjectID(monitor._id);
  resource.showCurrentStatus = data.showCurrentStatus ?? true;
  resource.showUptimePercent = false;
  if (data.group) {
    resource.statusPageGroupId = new ObjectID(data.group._id!);
  }
  return resource;
}

function monitorGroupResource(data: {
  name: string;
  monitorGroupId: ObjectID;
  group?: StatusPageGroup | undefined;
}): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = ObjectID.generate().toString();
  resource.displayName = data.name;
  resource.monitorGroupId = data.monitorGroupId;
  resource.showCurrentStatus = true;
  resource.showUptimePercent = false;
  if (data.group) {
    resource.statusPageGroupId = new ObjectID(data.group._id!);
  }
  return resource;
}

// Core: one monitor checked and Degraded, one off and left at Offline.
const CHECKOUT: StatusPageResource = monitorResource({
  name: "Checkout",
  status: DEGRADED,
  group: CORE,
});
const SEARCH: StatusPageResource = monitorResource({
  name: "Search",
  status: OFFLINE,
  group: CORE,
  isMonitoringOff: true,
});

// Retired: nothing beneath it is checked.
const PAYMENTS: StatusPageResource = monitorGroupResource({
  name: "Payments",
  monitorGroupId: MONITOR_GROUP_OFF,
  group: RETIRED,
});
const BILLING: StatusPageResource = monitorResource({
  name: "Billing",
  status: OFFLINE,
  group: RETIRED,
  isMonitoringOff: true,
});

// Platform holds one checked monitor; its child Legacy holds one that is off.
const STATUS_API: StatusPageResource = monitorResource({
  name: "Status API",
  status: OPERATIONAL,
  group: PLATFORM,
});
const OLD_API: StatusPageResource = monitorResource({
  name: "Old API",
  status: OFFLINE,
  group: LEGACY,
  isMonitoringOff: true,
});

// Outside any group.
const EDGE: StatusPageResource = monitorGroupResource({
  name: "Edge",
  monitorGroupId: MONITOR_GROUP_MIXED,
});
const DOCS: StatusPageResource = monitorResource({
  name: "Docs",
  status: OPERATIONAL,
  showCurrentStatus: false,
});

const NOT_MONITORED: Array<StatusPageResource> = [
  SEARCH,
  PAYMENTS,
  BILLING,
  OLD_API,
];

function mockPage(data: {
  resources: Array<StatusPageResource>;
  groups: Array<StatusPageGroup>;
  notMonitored: Array<StatusPageResource>;
  monitorGroupCurrentStatuses?: Dictionary<ObjectID> | undefined;
}): void {
  const statusPage: StatusPage = new StatusPage();
  statusPage.downtimeMonitorStatuses = [OFFLINE];

  jest
    .spyOn(StatusPageAPI.prototype, "checkHasReadAccess")
    .mockResolvedValue(undefined);

  jest
    .spyOn(StatusPageAPI.prototype, "getStatusPageResourcesAndTimelines")
    .mockResolvedValue({
      statusPageResources: data.resources,
      monitorStatuses: [OPERATIONAL, DEGRADED, OFFLINE],
      monitorStatusTimelines: [],
      uptimeDailyAggregate: {
        monitors: [],
        isComplete: true,
        completeFrom: null,
        timezone: "UTC",
      },
      monitorGroupCurrentStatuses: data.monitorGroupCurrentStatuses || {
        // The mixed group's status, from its checked monitor alone.
        [MONITOR_GROUP_MIXED.toString()]: OPERATIONAL.id!,
      },
      notMonitoredResourceIds: data.notMonitored.map(
        (resource: StatusPageResource): string => {
          return resource._id!.toString();
        },
      ),
      statusPageGroups: data.groups,
      statusPage: statusPage,
      monitorsOnStatusPage: [],
      monitorsOnStatusPageForTimeline: [],
      monitorsInGroup: {},
      startDateForMonitorTimeline: new Date("2026-10-01T00:00:00.000Z"),
      endDateForMonitorTimeline: new Date("2026-10-31T00:00:00.000Z"),
    });

  jest
    .spyOn(StatusPageService, "getMergedDowntimeForStatusPage")
    .mockResolvedValue({ coveredSeconds: 0, downtimeSeconds: 0 });
}

function mockDepartmentPage(): void {
  mockPage({
    resources: [
      CHECKOUT,
      SEARCH,
      PAYMENTS,
      BILLING,
      STATUS_API,
      OLD_API,
      EDGE,
      DOCS,
    ],
    groups: [CORE, RETIRED, PLATFORM, LEGACY, EMPTY],
    notMonitored: NOT_MONITORED,
  });
}

async function askUptime(): Promise<JSONObject> {
  const req: ExpressRequest = {
    params: {
      statusPageId: ObjectID.generate().toString(),
    },
    body: {
      startDate: "2026-10-01T00:00:00.000Z",
      endDate: "2026-10-31T00:00:00.000Z",
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

  return calls[0]![2] as JSONObject;
}

interface Answer {
  isMonitored: unknown;
  currentStatus: string | null;
}

function answerOf(item: JSONObject): Answer {
  const current: MonitorStatus | null =
    (item["currentStatus"] as MonitorStatus | null) || null;

  return {
    isMonitored: item["isMonitored"],
    currentStatus: current ? current.name || null : null,
  };
}

// Every resource's answer, by name, wherever it sits.
function resourcesByName(payload: JSONObject): Record<string, Answer> {
  const answers: Record<string, Answer> = {};

  const lists: Array<Array<JSONObject>> = [
    payload["statusPageResourceUptimes"] as Array<JSONObject>,
    ...(payload["groupUptimes"] as Array<JSONObject>).map(
      (groupUptime: JSONObject): Array<JSONObject> => {
        return groupUptime["statusPageResourceUptimes"] as Array<JSONObject>;
      },
    ),
  ];

  for (const list of lists) {
    for (const item of list) {
      answers[item["statusPageResourceName"] as string] = answerOf(item);
    }
  }

  return answers;
}

function groupsByName(payload: JSONObject): Record<string, Answer> {
  const answers: Record<string, Answer> = {};

  for (const groupUptime of payload["groupUptimes"] as Array<JSONObject>) {
    answers[groupUptime["statusPageGroupName"] as string] =
      answerOf(groupUptime);
  }

  return answers;
}

describe("POST /status-page-api/uptime/:statusPageId and monitoring off", () => {
  beforeAll(() => {
    mockRouter.routes.length = 0;
    new StatusPageAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("says a resource nothing checks is not monitored, with no status - never the one it was left at", async () => {
    mockDepartmentPage();

    const resources: Record<string, Answer> = resourcesByName(
      await askUptime(),
    );

    expect(resources["Search"]).toEqual({
      isMonitored: false,
      currentStatus: null,
    });
    expect(resources["Billing"]).toEqual({
      isMonitored: false,
      currentStatus: null,
    });
    expect(resources["Old API"]).toEqual({
      isMonitored: false,
      currentStatus: null,
    });
  });

  it("says a monitor group whose monitors all have monitoring off is not monitored", async () => {
    mockDepartmentPage();

    const resources: Record<string, Answer> = resourcesByName(
      await askUptime(),
    );

    expect(resources["Payments"]).toEqual({
      isMonitored: false,
      currentStatus: null,
    });
  });

  it("says every other resource is monitored, with its status as before", async () => {
    mockDepartmentPage();

    const resources: Record<string, Answer> = resourcesByName(
      await askUptime(),
    );

    expect(resources["Checkout"]).toEqual({
      isMonitored: true,
      currentStatus: "Degraded",
    });
    expect(resources["Status API"]).toEqual({
      isMonitored: true,
      currentStatus: "Operational",
    });
    expect(resources["Edge"]).toEqual({
      isMonitored: true,
      currentStatus: "Operational",
    });
    // A hidden status is still hidden, and hiding it is not turning monitoring off.
    expect(resources["Docs"]).toEqual({
      isMonitored: true,
      currentStatus: null,
    });
  });

  it("a group takes its status from the resources beneath it that are checked", async () => {
    mockDepartmentPage();

    const groups: Record<string, Answer> = groupsByName(await askUptime());

    // Search's frozen Offline is not Core's.
    expect(groups["Core"]).toEqual({
      isMonitored: true,
      currentStatus: "Degraded",
    });
    // Old API, in Legacy beneath it, is off: Platform is its own Status API.
    expect(groups["Platform"]).toEqual({
      isMonitored: true,
      currentStatus: "Operational",
    });
  });

  it("a group nothing beneath which is checked is not monitored, and has no status", async () => {
    mockDepartmentPage();

    const groups: Record<string, Answer> = groupsByName(await askUptime());

    expect(groups["Retired"]).toEqual({
      isMonitored: false,
      currentStatus: null,
    });
    expect(groups["Legacy"]).toEqual({
      isMonitored: false,
      currentStatus: null,
    });
  });

  it("an empty group is not one nothing checks", async () => {
    mockDepartmentPage();

    const groups: Record<string, Answer> = groupsByName(await askUptime());

    expect(groups["Empty"]?.isMonitored).toBe(true);
  });

  it("a page with nothing off says every resource and group is monitored", async () => {
    mockPage({
      resources: [CHECKOUT, STATUS_API, EDGE],
      groups: [CORE, PLATFORM],
      notMonitored: [],
    });

    const payload: JSONObject = await askUptime();
    const resources: Record<string, Answer> = resourcesByName(payload);
    const groups: Record<string, Answer> = groupsByName(payload);

    for (const name of ["Checkout", "Status API", "Edge"]) {
      expect({ name, isMonitored: resources[name]?.isMonitored }).toEqual({
        name,
        isMonitored: true,
      });
    }

    expect(groups["Core"]).toEqual({
      isMonitored: true,
      currentStatus: "Degraded",
    });
  });

  it("a group whose status is hidden still says whether anything beneath it is checked", async () => {
    const hidden: StatusPageGroup = group({
      name: "Hidden",
      showCurrentStatus: false,
    });
    const off: StatusPageResource = monitorResource({
      name: "Archive search",
      status: OFFLINE,
      group: hidden,
      isMonitoringOff: true,
    });

    mockPage({
      resources: [off],
      groups: [hidden],
      notMonitored: [off],
    });

    const groups: Record<string, Answer> = groupsByName(await askUptime());

    expect(groups["Hidden"]).toEqual({
      isMonitored: false,
      currentStatus: null,
    });
  });
});
