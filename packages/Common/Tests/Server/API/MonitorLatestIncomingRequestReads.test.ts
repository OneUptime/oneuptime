import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AN INCOMING REQUEST MONITOR'S LATEST REQUEST THROUGH THE READS PEOPLE
 * MAKE (#6402).
 *
 * The monitor keeps its latest request twice. Monitor.incomingMonitorRequest
 * is the copy people read, cut as the monitor's logs are: secrets masked,
 * and no headers or body when the monitor keeps no request content.
 * Monitor.incomingMonitorRequestAsReceived is the request as it came, for
 * the heartbeat job to judge again, and no role reads it.
 *
 * This drives the reads themselves with the table in memory: the API's
 * get-item (the monitor's overview) and get-list, as a Viewer and as an
 * Admin, and MonitorService's findBy, findOneBy and findOneById through
 * DatabaseService's whole read pipeline, permission checks included. Each
 * one a member makes gets the cut copy, and asking for the request as it
 * came is refused. OneUptime's own read gets both.
 *
 * The copy is cut when it is written, not on the way out, so MonitorService
 * overrides no read: realtime's shortcut for readers who read every
 * monitor of the project (readsEveryRecordInProject) still holds.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import CommonAPI from "../../../Server/API/CommonAPI";
import MonitorAPI from "../../../Server/API/MonitorAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import MonitorService from "../../../Server/Services/MonitorService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import LatestIncomingRequest, {
  LatestIncomingRequestColumns,
} from "../../../Server/Utils/Monitor/LatestIncomingRequest";
import Response from "../../../Server/Utils/Response";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "./CustomDomainCallers";
import {
  InMemoryTable,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

type MockedFn = ReturnType<typeof jest.fn>;

const REDACTED: string = "[REDACTED]";
const LIVE_TOKEN: string = "example-live-token-7f3a9c2b";

const PROJECT_ID: ObjectID = new ObjectID(
  "e6402000-0000-4000-8000-000000000001",
);
const DEPLOY_HOOK_ID: string = "e6402000-0000-4000-8000-000000000002";
const QUIET_HOOK_ID: string = "e6402000-0000-4000-8000-000000000003";

const GET_ITEM_ROUTE: string = "/monitor/:id/get-item";
const GET_LIST_ROUTE: string = "/monitor/get-list";

// What the monitor's overview asks for (Dashboard Monitor View).
const OVERVIEW_SELECT: JSONObject = {
  _id: true,
  name: true,
  monitorType: true,
  incomingRequestMonitorHeartbeatCheckedAt: true,
  incomingMonitorRequest: true,
};

const sendEntityResponseMock: MockedFn =
  Response.sendEntityResponse as unknown as MockedFn;
const sendEntityArrayResponseMock: MockedFn =
  Response.sendEntityArrayResponse as unknown as MockedFn;

// A deploy hook, as its sender sent it.
function deployHook(monitorId: string): IncomingMonitorRequest {
  return {
    projectId: PROJECT_ID,
    monitorId: new ObjectID(monitorId),
    requestMethod: HTTPMethod.POST,
    requestHeaders: {
      "content-type": "application/json",
      authorization: `Bearer ${LIVE_TOKEN}`,
    },
    requestBody: {
      status: "deployed",
      deployedBy: "jane@acme.example",
    },
    incomingRequestReceivedAt: new Date("2026-11-09T08:00:00.000Z"),
    checkedAt: new Date("2026-11-09T08:00:00.000Z"),
    onlyCheckForIncomingRequestReceivedAt: false,
  } as IncomingMonitorRequest;
}

// Both copies, as the ingest writes them (MonitorResource).
function columnsOf(
  monitorId: string,
  keepResponseContent: boolean,
): LatestIncomingRequestColumns {
  return LatestIncomingRequest.toColumns({
    request: deployHook(monitorId),
    keepResponseContent: keepResponseContent,
  });
}

function caller(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      permissions: permissions,
      projectId: PROJECT_ID,
    }),
    ...ON_HIGHEST_PLAN,
  };
}

const READERS: Array<[string, Array<Permission>]> = [
  ["a Viewer", [Permission.Viewer]],
  ["a Monitor Viewer", [Permission.MonitorViewer]],
  ["a project member", [Permission.ProjectMember]],
  ["a Monitor Admin", [Permission.MonitorAdmin]],
  ["a project Admin", [Permission.ProjectAdmin]],
  ["a project Owner", [Permission.ProjectOwner]],
];

let props: DatabaseCommonInteractionProps;
let monitorsTable: InMemoryTable;

/*
 * The columns the last read asked the database for. The table in memory
 * hands back every column it holds whatever was asked, so what a read
 * returns is pinned by what it asks for; the Postgres suite reads what a
 * real select returns (App RedactLatestIncomingRequestsPostgres).
 */
function columnsAskedFor(): Array<string> {
  const calls: Array<Array<unknown>> = monitorsTable.repository.find.mock
    .calls as Array<Array<unknown>>;
  const options: { select?: Record<string, unknown> } = calls[
    calls.length - 1
  ]![0] as { select?: Record<string, unknown> };

  return Object.keys(options.select || {});
}

function expectCut(request: IncomingMonitorRequest | undefined): void {
  expect(request).toBeDefined();
  expect(request!.requestHeaders).toEqual({
    "content-type": "application/json",
    authorization: REDACTED,
  });
  expect(request!.requestBody).toEqual({
    status: "deployed",
    deployedBy: REDACTED,
  });
  expect(request!.isResponseContentOmitted).toBeUndefined();
  expect(JSON.stringify(request)).not.toContain(LIVE_TOKEN);
  expect(JSON.stringify(request)).not.toContain("jane@acme.example");
}

function expectOmitted(request: IncomingMonitorRequest | undefined): void {
  expect(request).toBeDefined();
  expect(request!.requestHeaders).toBeUndefined();
  expect(request!.requestBody).toBeUndefined();
  expect(request!.isResponseContentOmitted).toBe(true);
  expect(request!.requestMethod).toBe(HTTPMethod.POST);
}

async function callRoute(
  route: string,
  data: { body?: JSONObject; params?: Record<string, string> } = {},
): Promise<{ error: Error | undefined }> {
  const req: ExpressRequest = {
    params: data.params || {},
    query: {},
    headers: {},
    body: data.body || {},
  } as unknown as ExpressRequest;
  const next: MockedFn = jest.fn();

  await mockRouter
    .match("POST", route)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  return { error: next.mock.calls[0]?.[0] as Error | undefined };
}

async function getItem(
  id: string,
  select: JSONObject = OVERVIEW_SELECT,
): Promise<{ error: Error | undefined; monitor: Monitor | undefined }> {
  const { error } = await callRoute(GET_ITEM_ROUTE, {
    params: { id: id },
    body: { select: JSONFunctions.serialize(select) },
  });

  return {
    error: error,
    monitor: sendEntityResponseMock.mock.calls[0]?.[2] as Monitor | undefined,
  };
}

async function getList(
  select: JSONObject = OVERVIEW_SELECT,
): Promise<{ error: Error | undefined; monitors: Array<Monitor> }> {
  const { error } = await callRoute(GET_LIST_ROUTE, {
    body: {
      query: {},
      select: JSONFunctions.serialize(select),
      sort: JSONFunctions.serialize({ name: "ASC" }),
      limit: 10,
      skip: 0,
    },
  });

  return {
    error: error,
    monitors:
      (sendEntityArrayResponseMock.mock.calls[0]?.[2] as Array<Monitor>) || [],
  };
}

function monitorOf(monitors: Array<Monitor>, id: string): Monitor {
  return monitors.find((monitor: Monitor): boolean => {
    return monitor.id?.toString() === id;
  })!;
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new MonitorAPI();
});

beforeEach(() => {
  jest.clearAllMocks();
  stubProjectDirectory({});

  const deployHookColumns: LatestIncomingRequestColumns = columnsOf(
    DEPLOY_HOOK_ID,
    true,
  );
  const quietHookColumns: LatestIncomingRequestColumns = columnsOf(
    QUIET_HOOK_ID,
    false,
  );

  monitorsTable = useInMemoryTable(MonitorService, [
    {
      _id: DEPLOY_HOOK_ID,
      projectId: PROJECT_ID.toString(),
      name: "Deploy hook",
      monitorType: MonitorType.IncomingRequest,
      keepResponseContent: true,
      incomingRequestMonitorHeartbeatCheckedAt: new Date(
        "2026-11-09T08:00:30.000Z",
      ),
      incomingMonitorRequest: deployHookColumns.incomingMonitorRequest,
      incomingMonitorRequestAsReceived:
        deployHookColumns.incomingMonitorRequestAsReceived,
      version: 1,
    },
    {
      _id: QUIET_HOOK_ID,
      projectId: PROJECT_ID.toString(),
      name: "Quiet hook",
      monitorType: MonitorType.IncomingRequest,
      keepResponseContent: false,
      incomingRequestMonitorHeartbeatCheckedAt: new Date(
        "2026-11-09T08:00:30.000Z",
      ),
      incomingMonitorRequest: quietHookColumns.incomingMonitorRequest,
      incomingMonitorRequestAsReceived:
        quietHookColumns.incomingMonitorRequestAsReceived,
      version: 1,
    },
  ]);

  props = caller([Permission.Viewer]);

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the API: what the monitor's overview reads", () => {
  test.each(READERS)(
    "%s opening the monitor (get-item) gets the request cut as its logs are",
    async (_who: string, permissions: Array<Permission>) => {
      props = caller(permissions);

      const { error, monitor } = await getItem(DEPLOY_HOOK_ID);

      expect(error).toBeUndefined();
      expectCut(monitor?.incomingMonitorRequest);
      expect(columnsAskedFor()).toContain("incomingMonitorRequest");
      expect(columnsAskedFor()).not.toContain(
        "incomingMonitorRequestAsReceived",
      );
    },
  );

  test.each(READERS)(
    "%s opening a monitor that keeps no request content gets no headers and no body",
    async (_who: string, permissions: Array<Permission>) => {
      props = caller(permissions);

      const { error, monitor } = await getItem(QUIET_HOOK_ID);

      expect(error).toBeUndefined();
      expectOmitted(monitor?.incomingMonitorRequest);
    },
  );

  test.each(READERS)(
    "%s listing the monitors (get-list) gets each request cut by its own monitor's switch",
    async (_who: string, permissions: Array<Permission>) => {
      props = caller(permissions);

      const { error, monitors } = await getList();

      expect(error).toBeUndefined();
      expect(monitors).toHaveLength(2);
      expectCut(monitorOf(monitors, DEPLOY_HOOK_ID).incomingMonitorRequest);
      expectOmitted(monitorOf(monitors, QUIET_HOOK_ID).incomingMonitorRequest);
    },
  );

  test.each(READERS)(
    "%s asking for the request as it came is refused, on get-item and on get-list",
    async (_who: string, permissions: Array<Permission>) => {
      props = caller(permissions);

      const asItCame: JSONObject = {
        _id: true,
        incomingMonitorRequestAsReceived: true,
      };

      const item: { error: Error | undefined } = await getItem(
        DEPLOY_HOOK_ID,
        asItCame,
      );

      expect(item.error).toBeInstanceOf(NotAuthorizedException);
      expect(sendEntityResponseMock).not.toHaveBeenCalled();

      const list: { error: Error | undefined } = await getList(asItCame);

      expect(list.error).toBeInstanceOf(NotAuthorizedException);
      expect(sendEntityArrayResponseMock).not.toHaveBeenCalled();
    },
  );
});

describe("MonitorService's reads, as a member makes them", () => {
  test.each(READERS)(
    "%s listing them (findBy) gets each request cut",
    async (_who: string, permissions: Array<Permission>) => {
      const monitors: Array<Monitor> = await MonitorService.findBy({
        query: {},
        select: { _id: true, incomingMonitorRequest: true },
        limit: 10,
        skip: 0,
        props: caller(permissions),
      });

      expectCut(monitorOf(monitors, DEPLOY_HOOK_ID).incomingMonitorRequest);
      expectOmitted(monitorOf(monitors, QUIET_HOOK_ID).incomingMonitorRequest);
    },
  );

  test.each(READERS)(
    "%s reading one monitor (findOneById, findOneBy) gets it cut",
    async (_who: string, permissions: Array<Permission>) => {
      const byId: Monitor | null = await MonitorService.findOneById({
        id: new ObjectID(DEPLOY_HOOK_ID),
        select: { incomingMonitorRequest: true },
        props: caller(permissions),
      });

      expectCut(byId?.incomingMonitorRequest);

      const byQuery: Monitor | null = await MonitorService.findOneBy({
        query: { name: "Deploy hook" },
        select: { _id: true, incomingMonitorRequest: true },
        props: caller(permissions),
      });

      expectCut(byQuery?.incomingMonitorRequest);
    },
  );

  test.each(READERS)(
    "%s selecting the request as it came is refused",
    async (_who: string, permissions: Array<Permission>) => {
      await expect(
        MonitorService.findOneById({
          id: new ObjectID(DEPLOY_HOOK_ID),
          select: { incomingMonitorRequestAsReceived: true },
          props: caller(permissions),
        }),
      ).rejects.toBeInstanceOf(NotAuthorizedException);

      await expect(
        MonitorService.findBy({
          query: {},
          select: { _id: true, incomingMonitorRequestAsReceived: true },
          limit: 10,
          skip: 0,
          props: caller(permissions),
        }),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    },
  );

  test("a read that names no column asks for the id alone, never the request as it came", async () => {
    await MonitorService.findOneById({
      id: new ObjectID(DEPLOY_HOOK_ID),
      select: {},
      props: caller([Permission.ProjectOwner]),
    });

    expect(columnsAskedFor()).not.toContain("incomingMonitorRequestAsReceived");
    expect(columnsAskedFor()).not.toContain("incomingMonitorRequest");
  });

  test.each(READERS)(
    "%s filtering on the request as it came is refused: what it holds is not to be guessed at",
    async (_who: string, permissions: Array<Permission>) => {
      await expect(
        MonitorService.findBy({
          query: {
            incomingMonitorRequestAsReceived: { requestMethod: "POST" },
          } as never,
          select: { _id: true },
          limit: 10,
          skip: 0,
          props: caller(permissions),
        }),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    },
  );

  test("OneUptime's own read gets both: the heartbeat judges the request as it came", async () => {
    const monitor: Monitor | null = await MonitorService.findOneById({
      id: new ObjectID(DEPLOY_HOOK_ID),
      select: {
        incomingMonitorRequest: true,
        incomingMonitorRequestAsReceived: true,
      },
      props: { isRoot: true },
    });

    expectCut(monitor?.incomingMonitorRequest);
    expect(monitor?.incomingMonitorRequestAsReceived?.requestHeaders).toEqual({
      "content-type": "application/json",
      authorization: `Bearer ${LIVE_TOKEN}`,
    });
    expect(monitor?.incomingMonitorRequestAsReceived?.requestBody).toEqual({
      status: "deployed",
      deployedBy: "jane@acme.example",
    });
  });
});

describe("realtime", () => {
  test("MonitorService overrides no read, so nothing is cut on the way out", () => {
    const service: Record<string, unknown> =
      MonitorService as unknown as Record<string, unknown>;
    const base: Record<string, unknown> =
      DatabaseService.prototype as unknown as Record<string, unknown>;

    for (const method of [
      "findBy",
      "findOneBy",
      "findOneById",
      "onFindSuccess",
    ]) {
      expect(service[method]).toBe(base[method]);
    }
  });

  test.each([
    ["a Viewer", [Permission.Viewer]],
    ["a Monitor Viewer", [Permission.MonitorViewer]],
    ["a project Owner", [Permission.ProjectOwner]],
  ] as Array<[string, Array<Permission>]>)(
    "%s still reads every monitor of the project: realtime's shortcut holds",
    async (_who: string, permissions: Array<Permission>) => {
      await expect(
        MonitorService.readsEveryRecordInProject(caller(permissions)),
      ).resolves.toBe(true);
    },
  );
});
