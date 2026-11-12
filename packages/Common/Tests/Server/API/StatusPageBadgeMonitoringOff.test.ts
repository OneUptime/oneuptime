import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorGroupResource from "../../../Models/DatabaseModels/MonitorGroupResource";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import MonitorGroupService from "../../../Server/Services/MonitorGroupService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import { Gray500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  NOT_MONITORED_STATUS_COLOR,
  NOT_MONITORED_STATUS_NAME,
} from "../../../Utils/StatusPage/FrozenMonitorResources";
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

/*
 * THE EMBEDDED STATUS BADGE WITH MONITORING OFF (#6478).
 *
 * GET /status-page-api/badge/:statusPageId draws the page's overall status
 * for a README or a website. A monitor whose monitoring is off, or a
 * monitor group whose monitors all have it off, holds a frozen status: it
 * must not color the badge - and a page with nothing else on it has no
 * status to draw but "Not monitored", in the page's gray.
 *
 * Driven through its handler; every read is a stand-in.
 */

const BADGE_ROUTE: string = "/status-page/badge/:statusPageId";
const TOKEN: string = "badge-token";

function status(
  name: string,
  priority: number,
  color: string,
  isOperational: boolean = false,
): MonitorStatus {
  const model: MonitorStatus = new MonitorStatus();
  model._id = ObjectID.generate().toString();
  model.name = name;
  model.priority = priority;
  model.color = Color.fromString(color);
  model.isOperationalState = isOperational;
  return model;
}

const OPERATIONAL: MonitorStatus = status("Operational", 1, "#2ab57d", true);
const DEGRADED: MonitorStatus = status("Degraded", 2, "#f59e0b");
const OFFLINE: MonitorStatus = status("Offline", 3, "#ef4444");

function monitorOf(
  current: MonitorStatus,
  state: { isMonitoringOff?: boolean; isArchived?: boolean } = {},
): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = ObjectID.generate().toString();
  monitor.currentMonitorStatusId = new ObjectID(current._id!);
  monitor.isArchived = state.isArchived === true;
  monitor.disableActiveMonitoring = state.isMonitoringOff === true;
  return monitor;
}

function monitorResource(
  current: MonitorStatus,
  state: { isMonitoringOff?: boolean; isArchived?: boolean } = {},
): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = ObjectID.generate().toString();
  resource.monitor = monitorOf(current, state);
  resource.monitorId = new ObjectID(resource.monitor._id!);
  return resource;
}

function groupResource(monitorGroupId: ObjectID): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = ObjectID.generate().toString();
  resource.monitorGroupId = monitorGroupId;
  return resource;
}

function member(
  monitorGroupId: ObjectID,
  current: MonitorStatus,
  state: { isMonitoringOff?: boolean } = {},
): MonitorGroupResource {
  const row: MonitorGroupResource = new MonitorGroupResource();
  row.monitorGroupId = monitorGroupId;
  row.monitor = monitorOf(current, state);
  row.monitorId = new ObjectID(row.monitor._id!);
  return row;
}

let resourceReads: Array<JSONObject> = [];
let groupReads: Array<Array<string>> = [];

function mockPage(data: {
  resources: Array<StatusPageResource>;
  members?: Dictionary<Array<MonitorGroupResource>> | undefined;
}): void {
  const statusPage: StatusPage = new StatusPage();
  statusPage._id = ObjectID.generate().toString();
  statusPage.projectId = ObjectID.generate();

  jest
    .spyOn(StatusPageService, "findOneBy")
    .mockResolvedValue(statusPage as never);
  jest.spyOn(StatusPageResourceService, "findBy").mockImplementation((async (
    args: JSONObject,
  ) => {
    resourceReads.push(args);
    return data.resources;
  }) as never);
  jest
    .spyOn(MonitorStatusService, "findBy")
    .mockResolvedValue([OPERATIONAL, DEGRADED, OFFLINE] as never);
  jest
    .spyOn(MonitorGroupService, "getMonitorGroupResourcesByGroupIds")
    .mockImplementation((async (groupIds: Array<ObjectID>) => {
      groupReads.push(
        groupIds.map((groupId: ObjectID): string => {
          return groupId.toString();
        }),
      );

      const read: Dictionary<Array<MonitorGroupResource>> = {};

      for (const groupId of groupIds) {
        read[groupId.toString()] =
          (data.members || {})[groupId.toString()] || [];
      }

      return read;
    }) as never);
}

interface Badge {
  status: number;
  svg: string;
  name: string;
  color: string;
}

// The badge's status words, and the color of its status half.
const BADGE_NAME_PATTERN: RegExp = /<text x="100" y="14">([^<]*)<\/text>/;
const BADGE_COLOR_PATTERN: RegExp =
  /<path fill="([^"]*)" d="M50 0h100v20H50z"\/>/;

async function badge(): Promise<Badge> {
  const req: ExpressRequest = {
    params: {
      statusPageId: ObjectID.generate().toString(),
    },
    query: { token: TOKEN },
    body: {},
    headers: {},
  } as unknown as ExpressRequest;

  let statusCode: number = 200;
  let sent: string = "";

  const res: ExpressResponse = {
    setHeader: jest.fn(),
    status: jest.fn().mockImplementation((code: unknown) => {
      statusCode = code as number;
      return res;
    }),
    send: jest.fn().mockImplementation((body: unknown) => {
      sent = String(body);
      return res;
    }),
  } as unknown as ExpressResponse;

  await mockRouter
    .match("get", BADGE_ROUTE)
    .handlerFunction(req, res, jest.fn() as never);

  return {
    status: statusCode,
    svg: sent,
    name: BADGE_NAME_PATTERN.exec(sent)?.[1] || "",
    color: BADGE_COLOR_PATTERN.exec(sent)?.[1] || "",
  };
}

describe("GET /status-page-api/badge/:statusPageId and monitoring off", () => {
  beforeAll(() => {
    mockRouter.routes.length = 0;
    new StatusPageAPI();
  });

  beforeEach(() => {
    resourceReads = [];
    groupReads = [];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads whether each monitor's monitoring is off, with the resources", async () => {
    mockPage({ resources: [monitorResource(OPERATIONAL)] });

    await badge();

    expect(resourceReads).toHaveLength(1);
    const select: JSONObject = resourceReads[0]!["select"] as JSONObject;
    expect((select["monitor"] as JSONObject)["disableActiveMonitoring"]).toBe(
      true,
    );
  });

  it("a monitor whose monitoring is off does not color the badge", async () => {
    mockPage({
      resources: [
        monitorResource(OPERATIONAL),
        monitorResource(OFFLINE, { isMonitoringOff: true }),
      ],
    });

    const drawn: Badge = await badge();

    expect(drawn.status).toBe(200);
    expect(drawn.name).toBe("Operational");
    expect(drawn.color).toBe("#2ab57d");
  });

  it("the worst of the monitors still checked colors it", async () => {
    mockPage({
      resources: [
        monitorResource(DEGRADED),
        monitorResource(OFFLINE, { isMonitoringOff: true }),
      ],
    });

    expect((await badge()).name).toBe("Degraded");
  });

  it("a monitor group's monitors that are off decide nothing: its status is its checked monitors'", async () => {
    const mixed: ObjectID = ObjectID.generate();

    mockPage({
      resources: [groupResource(mixed)],
      members: {
        [mixed.toString()]: [
          member(mixed, OFFLINE, { isMonitoringOff: true }),
          member(mixed, DEGRADED),
        ],
      },
    });

    expect((await badge()).name).toBe("Degraded");
  });

  it("reads the monitor groups' members once, for the groups on the page", async () => {
    const first: ObjectID = ObjectID.generate();
    const second: ObjectID = ObjectID.generate();

    mockPage({
      resources: [
        groupResource(first),
        groupResource(second),
        monitorResource(OPERATIONAL),
      ],
      members: {
        [first.toString()]: [member(first, OPERATIONAL)],
        [second.toString()]: [member(second, OPERATIONAL)],
      },
    });

    await badge();

    expect(groupReads).toEqual([[first.toString(), second.toString()]]);
  });

  it("a page nothing on which is monitored draws Not monitored, in gray", async () => {
    const allOff: ObjectID = ObjectID.generate();

    mockPage({
      resources: [
        monitorResource(OFFLINE, { isMonitoringOff: true }),
        groupResource(allOff),
      ],
      members: {
        [allOff.toString()]: [
          member(allOff, OFFLINE, { isMonitoringOff: true }),
          member(allOff, DEGRADED, { isMonitoringOff: true }),
        ],
      },
    });

    const drawn: Badge = await badge();

    expect(drawn.status).toBe(200);
    expect(drawn.name).toBe(NOT_MONITORED_STATUS_NAME);
    expect(drawn.name).toBe("Not monitored");
    expect(drawn.color).toBe(NOT_MONITORED_STATUS_COLOR.toString());
    expect(drawn.color).toBe(Gray500.toString());
    expect(drawn.svg).not.toContain("Offline");
  });

  it("an archived monitor is not on the page: a page of it and an off monitor is not monitored", async () => {
    mockPage({
      resources: [
        monitorResource(OFFLINE, { isArchived: true }),
        monitorResource(DEGRADED, { isMonitoringOff: true }),
      ],
    });

    expect((await badge()).name).toBe("Not monitored");
  });

  it("an empty page draws what it always did", async () => {
    mockPage({ resources: [] });

    expect((await badge()).name).toBe("Operational");
  });

  it("a page with every monitor checked draws its worst status, as before", async () => {
    mockPage({
      resources: [monitorResource(OPERATIONAL), monitorResource(OFFLINE)],
    });

    const drawn: Badge = await badge();

    expect(drawn.name).toBe("Offline");
    expect(drawn.color).toBe("#ef4444");
  });
});
