import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import MonitorGroupService from "../../../Server/Services/MonitorGroupService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import StatusPageGroupService from "../../../Server/Services/StatusPageGroupService";
import StatusPageHistoryChartBarColorRuleService from "../../../Server/Services/StatusPageHistoryChartBarColorRuleService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
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
 * StatusPageAPI overview response cache.
 *
 * The shared overview handler (POST + GET
 * /status-page/overview/:statusPageIdOrDomain) memoizes the post-auth payload
 * per resolved statusPageId for OVERVIEW_CACHE_TTL_MS, with in-flight promise
 * dedup, because the build is a pure function of the statusPageId — auth is a
 * binary gate re-checked on EVERY request, before any cache read.
 *
 * These tests pin the safety properties of that cache: auth-before-cache
 * ordering, per-page key isolation, TTL expiry, never caching failed builds,
 * cold-miss stampede collapse, one cache across both HTTP methods, and
 * no-store headers on hit and miss alike.
 *
 * All service reads are spied on — no database is touched.
 */

const OVERVIEW_ROUTE: string = "/status-page/overview/:statusPageIdOrDomain";

type OverviewSpies = {
  /*
   * The StatusPage row fetch that opens getStatusPageResourcesAndTimelines —
   * the first query of every rebuild, so its call count is the "did a rebuild
   * happen" probe.
   */
  buildFindOneBySpy: jest.SpyInstance;

  // The per-request auth gate query inside StatusPageService.hasReadAccess.
  authFindOneByIdSpy: jest.SpyInstance;
};

/*
 * Builds the EMPTY status page row served to the build path: no resources,
 * no groups, and every show* flag unset, so all downstream query blocks
 * short-circuit and the only interesting behavior left is the caching.
 */
function buildPageFor(findOneByArgs: unknown): StatusPage {
  const query: JSONObject = (findOneByArgs as { query: JSONObject }).query;
  const page: StatusPage = new StatusPage();
  page._id = String(query["_id"]);
  page.projectId = ObjectID.generate();
  return page;
}

function mockOverviewServices(): OverviewSpies {
  // Per-request auth gate: a PUBLIC page grants access to anonymous viewers.
  const authFindOneByIdSpy: jest.SpyInstance = (
    jest.spyOn(StatusPageService, "findOneById") as unknown as jest.SpyInstance
  ).mockImplementation(() => {
    const page: StatusPage = new StatusPage();
    page.isPublicStatusPage = true;
    return Promise.resolve(page);
  });

  const buildFindOneBySpy: jest.SpyInstance = (
    jest.spyOn(StatusPageService, "findOneBy") as unknown as jest.SpyInstance
  ).mockImplementation((args: unknown) => {
    return Promise.resolve(buildPageFor(args));
  });

  (
    jest.spyOn(MonitorStatusService, "findBy") as unknown as jest.SpyInstance
  ).mockResolvedValue([] as never);

  (
    jest.spyOn(StatusPageGroupService, "findBy") as unknown as jest.SpyInstance
  ).mockResolvedValue([] as never);

  (
    jest.spyOn(
      StatusPageResourceService,
      "findBy",
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue([] as never);

  (
    jest.spyOn(
      MonitorGroupService,
      "getMonitorGroupResourcesByGroupIds",
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue({} as never);

  (
    jest.spyOn(
      MonitorGroupService,
      "getCurrentStatusesForMonitorGroups",
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue({} as never);

  (
    jest.spyOn(
      StatusPageService,
      "getMonitorStatusTimelineForStatusPage",
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue([] as never);

  (
    jest.spyOn(
      StatusPageHistoryChartBarColorRuleService,
      "findBy",
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue([] as never);

  return { buildFindOneBySpy, authFindOneByIdSpy };
}

function makeOverviewRequest(statusPageIdOrDomain: string): ExpressRequest {
  return {
    params: {
      statusPageIdOrDomain: statusPageIdOrDomain,
    },
    body: {},
    query: {},
    cookies: {},
    headers: {},
    socket: {},
    ips: [],
  } as unknown as ExpressRequest;
}

function makeOverviewResponse(): ExpressResponse {
  return {
    send: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;
}

/*
 * The handler fills the cache on a detached .then/.catch/.finally chain;
 * drain it so the next request observes the settled cache state. A macrotask
 * (setTimeout 0) is used because the jsdom test environment has no
 * setImmediate; it drains all pending microtasks first either way.
 */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
}

type InvocationResult = {
  req: ExpressRequest;
  res: ExpressResponse;
  next: NextFunction;
};

async function invokeOverview(data: {
  statusPageIdOrDomain: string;
  method?: "post" | "get";
}): Promise<InvocationResult> {
  const req: ExpressRequest = makeOverviewRequest(data.statusPageIdOrDomain);
  const res: ExpressResponse = makeOverviewResponse();
  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await mockRouter
    .match(data.method || "post", OVERVIEW_ROUTE)
    .handlerFunction(req, res, next);
  await flushMicrotasks();

  return { req, res, next };
}

function sentPayloads(): Array<JSONObject> {
  return (
    Response.sendJsonObjectResponse as unknown as jest.Mock
  ).mock.calls.map((call: Array<unknown>) => {
    return call[2] as JSONObject;
  });
}

describe("StatusPageAPI overview response cache", () => {
  beforeAll(() => {
    mockRouter.routes.length = 0;
    new StatusPageAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    StatusPageAPI.clearOverviewResponseCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("serves a repeat request within the TTL from cache: no rebuild, per-request auth, identical payload object", async () => {
    const spies: OverviewSpies = mockOverviewServices();
    const statusPageId: string = ObjectID.generate().toString();

    const first: InvocationResult = await invokeOverview({
      statusPageIdOrDomain: statusPageId,
    });
    const second: InvocationResult = await invokeOverview({
      statusPageIdOrDomain: statusPageId,
    });

    expect(first.next).not.toHaveBeenCalled();
    expect(second.next).not.toHaveBeenCalled();

    // The build ran exactly once; the auth gate ran on BOTH requests.
    expect(spies.buildFindOneBySpy).toHaveBeenCalledTimes(1);
    expect(spies.authFindOneByIdSpy).toHaveBeenCalledTimes(2);

    const payloads: Array<JSONObject> = sentPayloads();
    expect(payloads).toHaveLength(2);
    // The very same object, not a rebuilt lookalike.
    expect(payloads[1]).toBe(payloads[0]);

    // projectId is stripped INSIDE the build, so the cached object is final.
    const statusPageJson: JSONObject = payloads[0]!["statusPage"] as JSONObject;
    expect(statusPageJson["_id"]).toBe(statusPageId);
    expect("projectId" in statusPageJson).toBe(false);
  });

  it("still enforces authorization on a warm cache: a page gone private is rejected before any cache read", async () => {
    const spies: OverviewSpies = mockOverviewServices();
    const statusPageId: string = ObjectID.generate().toString();

    await invokeOverview({ statusPageIdOrDomain: statusPageId });
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);

    // The page goes private; the anonymous viewer carries no cookie.
    spies.authFindOneByIdSpy.mockImplementation(() => {
      const page: StatusPage = new StatusPage();
      page.isPublicStatusPage = false;
      return Promise.resolve(page);
    });

    const denied: InvocationResult = await invokeOverview({
      statusPageIdOrDomain: statusPageId,
    });

    expect(denied.next).toHaveBeenCalledTimes(1);
    const error: unknown = (denied.next as jest.Mock).mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(NotAuthenticatedException);

    // The warm cache entry must NOT have been served to the rejected viewer.
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  });

  it("isolates cache entries per statusPageId", async () => {
    const spies: OverviewSpies = mockOverviewServices();
    const statusPageIdA: string = ObjectID.generate().toString();
    const statusPageIdB: string = ObjectID.generate().toString();

    await invokeOverview({ statusPageIdOrDomain: statusPageIdA });
    await invokeOverview({ statusPageIdOrDomain: statusPageIdB });

    // Two different pages, two independent builds.
    expect(spies.buildFindOneBySpy).toHaveBeenCalledTimes(2);

    const payloads: Array<JSONObject> = sentPayloads();
    expect(payloads).toHaveLength(2);
    expect(payloads[1]).not.toBe(payloads[0]);
    expect((payloads[0]!["statusPage"] as JSONObject)["_id"]).toBe(
      statusPageIdA,
    );
    expect((payloads[1]!["statusPage"] as JSONObject)["_id"]).toBe(
      statusPageIdB,
    );

    // Each entry is now warm on its own key.
    await invokeOverview({ statusPageIdOrDomain: statusPageIdA });
    expect(spies.buildFindOneBySpy).toHaveBeenCalledTimes(2);
  });

  it("rebuilds after the 15s TTL expires", async () => {
    const spies: OverviewSpies = mockOverviewServices();
    const statusPageId: string = ObjectID.generate().toString();

    const startedAt: number = Date.now();
    const nowSpy: jest.SpyInstance = (
      jest.spyOn(Date, "now") as unknown as jest.SpyInstance
    ).mockReturnValue(startedAt);

    await invokeOverview({ statusPageIdOrDomain: statusPageId });
    expect(spies.buildFindOneBySpy).toHaveBeenCalledTimes(1);

    // One ms past the TTL — InMemoryTTLCache expires on read.
    nowSpy.mockReturnValue(startedAt + 15_000 + 1);

    await invokeOverview({ statusPageIdOrDomain: statusPageId });
    expect(spies.buildFindOneBySpy).toHaveBeenCalledTimes(2);

    const payloads: Array<JSONObject> = sentPayloads();
    expect(payloads).toHaveLength(2);
    // A fresh snapshot, not the expired object.
    expect(payloads[1]).not.toBe(payloads[0]);
  });

  it("never caches a failed build: the next request rebuilds and succeeds", async () => {
    const spies: OverviewSpies = mockOverviewServices();
    const statusPageId: string = ObjectID.generate().toString();

    // First build throws (status page row gone mid-flight).
    spies.buildFindOneBySpy.mockResolvedValueOnce(null as never);

    const failed: InvocationResult = await invokeOverview({
      statusPageIdOrDomain: statusPageId,
    });

    expect(failed.next).toHaveBeenCalledTimes(1);
    expect((failed.next as jest.Mock).mock.calls[0]?.[0]).toBeInstanceOf(
      BadDataException,
    );
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();

    // The error was not cached: a fresh build runs and succeeds.
    const recovered: InvocationResult = await invokeOverview({
      statusPageIdOrDomain: statusPageId,
    });

    expect(recovered.next).not.toHaveBeenCalled();
    expect(spies.buildFindOneBySpy).toHaveBeenCalledTimes(2);
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  });

  it("collapses concurrent cold-cache requests into one in-flight build", async () => {
    const spies: OverviewSpies = mockOverviewServices();
    const statusPageId: string = ObjectID.generate().toString();

    let releaseBuild: () => void = () => {
      return;
    };
    const gate: Promise<void> = new Promise<void>((resolve: () => void) => {
      releaseBuild = resolve;
    });

    spies.buildFindOneBySpy.mockImplementation(async (args: unknown) => {
      await gate;
      return buildPageFor(args);
    });

    const reqA: ExpressRequest = makeOverviewRequest(statusPageId);
    const resA: ExpressResponse = makeOverviewResponse();
    const nextA: NextFunction = jest.fn() as unknown as NextFunction;
    const reqB: ExpressRequest = makeOverviewRequest(statusPageId);
    const resB: ExpressResponse = makeOverviewResponse();
    const nextB: NextFunction = jest.fn() as unknown as NextFunction;

    const handlerPromiseA: void | Promise<void> = mockRouter
      .match("post", OVERVIEW_ROUTE)
      .handlerFunction(reqA, resA, nextA);
    const handlerPromiseB: void | Promise<void> = mockRouter
      .match("post", OVERVIEW_ROUTE)
      .handlerFunction(reqB, resB, nextB);

    // Both requests are parked on the same gated build...
    await flushMicrotasks();
    expect(spies.buildFindOneBySpy).toHaveBeenCalledTimes(1);
    // ...after each passed its own auth check.
    expect(spies.authFindOneByIdSpy).toHaveBeenCalledTimes(2);

    releaseBuild();
    await handlerPromiseA;
    await handlerPromiseB;
    await flushMicrotasks();

    expect(nextA).not.toHaveBeenCalled();
    expect(nextB).not.toHaveBeenCalled();

    // Exactly one build ran; both requests received the same payload object.
    expect(spies.buildFindOneBySpy).toHaveBeenCalledTimes(1);
    const payloads: Array<JSONObject> = sentPayloads();
    expect(payloads).toHaveLength(2);
    expect(payloads[1]).toBe(payloads[0]);
  });

  it("shares one cache between the POST and GET routes", async () => {
    const spies: OverviewSpies = mockOverviewServices();
    const statusPageId: string = ObjectID.generate().toString();

    await invokeOverview({
      statusPageIdOrDomain: statusPageId,
      method: "post",
    });
    expect(spies.buildFindOneBySpy).toHaveBeenCalledTimes(1);

    const viaGet: InvocationResult = await invokeOverview({
      statusPageIdOrDomain: statusPageId,
      method: "get",
    });

    expect(viaGet.next).not.toHaveBeenCalled();
    // The GET route served the POST-warmed entry without rebuilding.
    expect(spies.buildFindOneBySpy).toHaveBeenCalledTimes(1);

    const payloads: Array<JSONObject> = sentPayloads();
    expect(payloads).toHaveLength(2);
    expect(payloads[1]).toBe(payloads[0]);
  });

  it("sets no-store headers on the miss AND the hit path", async () => {
    const spies: OverviewSpies = mockOverviewServices();
    const statusPageId: string = ObjectID.generate().toString();

    const miss: InvocationResult = await invokeOverview({
      statusPageIdOrDomain: statusPageId,
    });
    expect(Response.setNoCacheHeaders).toHaveBeenCalledTimes(1);
    expect(Response.setNoCacheHeaders).toHaveBeenLastCalledWith(miss.res);

    const hit: InvocationResult = await invokeOverview({
      statusPageIdOrDomain: statusPageId,
    });
    // Confirm this second request really was a cache hit...
    expect(spies.buildFindOneBySpy).toHaveBeenCalledTimes(1);
    // ...and it still told HTTP caches not to store the response.
    expect(Response.setNoCacheHeaders).toHaveBeenCalledTimes(2);
    expect(Response.setNoCacheHeaders).toHaveBeenLastCalledWith(hit.res);
  });
});
