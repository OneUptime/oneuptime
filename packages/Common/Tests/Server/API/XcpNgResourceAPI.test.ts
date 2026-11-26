import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import XcpNgResourceAPI from "../../../Server/API/XcpNgResourceAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import XcpNgResourceService, {
  XcpNgInventorySummary,
} from "../../../Server/Services/XcpNgResourceService";
import XcpNgPoolService from "../../../Server/Services/XcpNgPoolService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import XcpNgResource from "../../../Models/DatabaseModels/XcpNgResource";
import XcpNgPool from "../../../Models/DatabaseModels/XcpNgPool";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * POST /xcp-ng-resource/inventory-summary/:poolId
 *
 * The one custom route the XCP-ng inventory API adds on top of the generic
 * CRUD router. A pool's pages post an empty body to it and read back its
 * counts: hosts (running, disabled), VMs (running; control domains left
 * out), storage repositories, virtual disks and storage capacity in use.
 *
 * The route runs behind UserMiddleware only, so it has to prove its own
 * authorisation: it reads the pool through XcpNgPoolService with the
 * caller's DatabaseCommonInteractionProps, so the XcpNgPool model's ACL
 * (Permission.ReadXcpNgPool and friends, narrowed by labels and owners)
 * decides whether the pool is visible at all. A pool that is missing and
 * one the caller may not read both answer the same NotFound: the route
 * never lets a caller find out which ids exist.
 *
 * The services are stubbed at their public seams; what is under test is
 * the wiring: which id is read, which service is asked, with which props,
 * and what is written back.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

const INVENTORY_SUMMARY_ROUTE: string =
  "/xcp-ng-resource/inventory-summary/:poolId";

const SUMMARY: XcpNgInventorySummary = {
  hostCount: 3,
  runningHostCount: 2,
  disabledHostCount: 1,
  vmCount: 42,
  runningVmCount: 37,
  storageRepositoryCount: 4,
  vdiCount: 61,
  storageCapacityBytes: 8796093022208,
  storageUsedBytes: 3298534883328,
};

interface RouteCall {
  thrown: unknown;
  nextCallCount: number;
}

describe("XcpNgResourceAPI", () => {
  let poolId: ObjectID;
  let projectId: ObjectID;
  let props: DatabaseCommonInteractionProps;
  let mockResponse: ExpressResponse;
  let nextFunction: NextFunction;
  let findOneById: jest.SpyInstance;
  let getInventorySummary: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new XcpNgResourceAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    poolId = ObjectID.generate();
    projectId = ObjectID.generate();
    props = {
      isRoot: false,
      userId: ObjectID.generate(),
      tenantId: projectId,
    } as DatabaseCommonInteractionProps;

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(props);

    findOneById = jest.spyOn(XcpNgPoolService, "findOneById");
    getInventorySummary = jest
      .spyOn(XcpNgResourceService, "getInventorySummary")
      .mockResolvedValue(SUMMARY);

    mockResponse = {
      cookie: jest.fn(),
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;
    nextFunction = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function readablePool(): XcpNgPool {
    const pool: XcpNgPool = new XcpNgPool();
    pool.id = poolId;
    pool.projectId = projectId;
    return pool;
  }

  async function callRoute(
    poolIdParam: string | undefined,
  ): Promise<RouteCall> {
    const request: ExpressRequest = {
      params: poolIdParam === undefined ? {} : { poolId: poolIdParam },
      body: {},
      query: {},
      cookies: {},
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;

    await mockRouter
      .match("post", INVENTORY_SUMMARY_ROUTE)
      .handlerFunction(request, mockResponse, nextFunction);

    const calls: Array<Array<unknown>> = (nextFunction as jest.Mock).mock
      .calls as Array<Array<unknown>>;

    return {
      thrown: calls[0]?.[0],
      nextCallCount: calls.length,
    };
  }

  function sentBody(): JSONObject {
    const calls: Array<Array<unknown>> = (
      Response.sendJsonObjectResponse as jest.Mock
    ).mock.calls as Array<Array<unknown>>;
    expect(calls.length).toBe(1);
    return calls[0]![2] as JSONObject;
  }

  describe("registration", () => {
    test("derives the route from the model's CRUD path and mounts it as POST", () => {
      expect(new XcpNgResource().getCrudApiPath()?.toString()).toBe(
        "/xcp-ng-resource",
      );

      const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
        "post",
        INVENTORY_SUMMARY_ROUTE,
      );
      expect(route.method).toBe("POST");

      // Not a GET: the pages post an empty body through ModelAPI's headers.
      expect(() => {
        return mockRouter.match("get", INVENTORY_SUMMARY_ROUTE);
      }).toThrow();
    });

    test("is mounted behind UserMiddleware.getUserMiddleware only", () => {
      const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
        "post",
        INVENTORY_SUMMARY_ROUTE,
      );
      expect(route.middlewares).toEqual([UserMiddleware.getUserMiddleware]);
    });

    test("keeps no route of the product it was cloned from", () => {
      for (const cloned of [
        "/xcp-ng-resource/inventory-summary/:clusterId",
        "/xcp-ng-resource/remove-node/:clusterId",
        "/proxmox-resource/inventory-summary/:clusterId",
        "/xcp-ng-pool/inventory-summary/:poolId",
      ]) {
        expect(() => {
          return mockRouter.match("post", cloned);
        }).toThrow();
      }
    });
  });

  describe("pool id validation", () => {
    test("refuses a missing id before touching any service", async () => {
      const call: RouteCall = await callRoute(undefined);

      expect(call.nextCallCount).toBe(1);
      expect(call.thrown).toBeInstanceOf(BadDataException);
      expect((call.thrown as BadDataException).message).toBe(
        "The request names no XCP-ng pool. Put the pool's ID at the end of the address.",
      );
      expect(findOneById).not.toHaveBeenCalled();
      expect(getInventorySummary).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });

    test("refuses an empty id", async () => {
      const call: RouteCall = await callRoute("");

      expect(call.thrown).toBeInstanceOf(BadDataException);
      expect((call.thrown as BadDataException).message).toBe(
        "The request names no XCP-ng pool. Put the pool's ID at the end of the address.",
      );
      expect(findOneById).not.toHaveBeenCalled();
    });

    test("reads a malformed id with the caller's props and answers NotFound", async () => {
      /*
       * ObjectID takes any string, so a malformed id cannot be refused up
       * front; what matters is that it never reaches the summary's query,
       * and that the read that refuses it runs as the caller, never as root.
       */
      for (const malformed of ["not-an-id", "1", "' OR 1=1 --"]) {
        jest.clearAllMocks();
        findOneById.mockResolvedValue(null);

        const call: RouteCall = await callRoute(malformed);

        expect(call.nextCallCount).toBe(1);
        expect(call.thrown).toBeInstanceOf(NotFoundException);
        expect(findOneById).toHaveBeenCalledTimes(1);
        const findArgs: JSONObject = findOneById.mock
          .calls[0]![0] as JSONObject;
        expect((findArgs["id"] as ObjectID).toString()).toBe(malformed);
        expect(findArgs["props"]).toBe(props);
        expect(getInventorySummary).not.toHaveBeenCalled();
        expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
      }
    });
  });

  describe("authorisation", () => {
    test("reads the pool with the caller's props so the model's ACL applies", async () => {
      findOneById.mockResolvedValue(readablePool());

      await callRoute(poolId.toString());

      expect(CommonAPI.getDatabaseCommonInteractionProps).toHaveBeenCalledTimes(
        1,
      );
      expect(findOneById).toHaveBeenCalledTimes(1);
      const findArgs: JSONObject = findOneById.mock.calls[0]![0] as JSONObject;
      expect((findArgs["id"] as ObjectID).toString()).toBe(poolId.toString());
      expect(findArgs["props"]).toBe(props);
      expect((findArgs["props"] as DatabaseCommonInteractionProps).isRoot).toBe(
        false,
      );
      // Only what scopes the summary is read.
      expect(findArgs["select"]).toEqual({ _id: true, projectId: true });
    });

    test("answers NotFound for a pool that does not exist", async () => {
      findOneById.mockResolvedValue(null);

      const call: RouteCall = await callRoute(poolId.toString());

      expect(call.nextCallCount).toBe(1);
      expect(call.thrown).toBeInstanceOf(NotFoundException);
      expect((call.thrown as NotFoundException).message).toBe(
        "No XCP-ng pool with this ID is in this project. Check the ID, and that you can see the pool.",
      );
      expect(getInventorySummary).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });

    test("answers the same NotFound for a pool the caller may not read", async () => {
      // The ACL leaves an unreadable pool out of the read: the same answer.
      findOneById.mockResolvedValue(null);
      const unreadable: RouteCall = await callRoute(poolId.toString());

      jest.clearAllMocks();
      findOneById.mockResolvedValue(null);
      const missing: RouteCall = await callRoute(
        ObjectID.generate().toString(),
      );

      expect(unreadable.thrown).toBeInstanceOf(NotFoundException);
      expect(missing.thrown).toBeInstanceOf(NotFoundException);
      expect((unreadable.thrown as NotFoundException).message).toBe(
        (missing.thrown as NotFoundException).message,
      );
    });

    test("answers NotFound when the row came back without a project", async () => {
      const orphan: XcpNgPool = new XcpNgPool();
      orphan.id = poolId;
      findOneById.mockResolvedValue(orphan);

      const call: RouteCall = await callRoute(poolId.toString());

      expect(call.thrown).toBeInstanceOf(NotFoundException);
      expect(getInventorySummary).not.toHaveBeenCalled();
    });

    test("a failing read is passed on, and nothing is sent", async () => {
      findOneById.mockRejectedValue(new Error("postgres is down"));

      const call: RouteCall = await callRoute(poolId.toString());

      expect(call.nextCallCount).toBe(1);
      expect((call.thrown as Error).message).toBe("postgres is down");
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });
  });

  describe("summary", () => {
    test("is the pool's own project's, never one the caller names", async () => {
      findOneById.mockResolvedValue(readablePool());

      await callRoute(poolId.toString());

      expect(getInventorySummary).toHaveBeenCalledTimes(1);
      const summaryArgs: JSONObject = getInventorySummary.mock
        .calls[0]![0] as JSONObject;
      expect((summaryArgs["projectId"] as ObjectID).toString()).toBe(
        projectId.toString(),
      );
      expect((summaryArgs["xcpNgPoolId"] as ObjectID).toString()).toBe(
        poolId.toString(),
      );
      expect(Object.keys(summaryArgs).sort()).toEqual([
        "projectId",
        "xcpNgPoolId",
      ]);
    });

    test("sends every count the pool's pages read, as the inventory says", async () => {
      findOneById.mockResolvedValue(readablePool());

      const call: RouteCall = await callRoute(poolId.toString());

      expect(call.nextCallCount).toBe(0);
      expect(sentBody()).toEqual({
        hostCount: 3,
        runningHostCount: 2,
        disabledHostCount: 1,
        vmCount: 42,
        runningVmCount: 37,
        storageRepositoryCount: 4,
        vdiCount: 61,
        storageCapacityBytes: 8796093022208,
        storageUsedBytes: 3298534883328,
      });
    });

    test("an empty pool is zeros, not absent fields", async () => {
      findOneById.mockResolvedValue(readablePool());
      getInventorySummary.mockResolvedValue({
        hostCount: 0,
        runningHostCount: 0,
        disabledHostCount: 0,
        vmCount: 0,
        runningVmCount: 0,
        storageRepositoryCount: 0,
        vdiCount: 0,
        storageCapacityBytes: 0,
        storageUsedBytes: 0,
      });

      await callRoute(poolId.toString());

      const body: JSONObject = sentBody();
      for (const field of Object.keys(SUMMARY)) {
        expect({ field, value: body[field] }).toEqual({ field, value: 0 });
      }
    });

    test("sends exactly the summary's fields, nothing of the pool row", async () => {
      findOneById.mockResolvedValue(readablePool());

      await callRoute(poolId.toString());

      expect(Object.keys(sentBody()).sort()).toEqual(
        Object.keys(SUMMARY).sort(),
      );
    });
  });
});
