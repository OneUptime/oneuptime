import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import KubernetesResourceAPI from "../../../Server/API/KubernetesResourceAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import KubernetesResourceService, {
  KubernetesNeedsAttention,
} from "../../../Server/Services/KubernetesResourceService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import { KubernetesHealthSeverity } from "../../../Types/Kubernetes/KubernetesHealth";
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
 * POST /kubernetes-resource/needs-attention/:clusterId
 *
 * What a cluster's Overview reads for its Needs attention card and its
 * health pill. Behind UserMiddleware only, so it proves its own
 * authorisation as the inventory summary beside it does: it resolves the
 * cluster with the caller's props, so the KubernetesCluster model ACL
 * decides whether the cluster is visible at all, and a cluster that is
 * missing and one the caller may not read answer the same NotFound.
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

const NEEDS_ATTENTION_ROUTE: string =
  "/kubernetes-resource/needs-attention/:clusterId";

const RESULT: KubernetesNeedsAttention = {
  findings: [
    {
      key: "Deployment:payments/checkout",
      kind: "Deployment",
      namespace: "payments",
      name: "checkout",
      severity: KubernetesHealthSeverity.Critical,
      reasons: [
        {
          text: "{{available}} of {{desired}} available",
          values: { available: "1", desired: "3" },
        },
        { text: "{{reason}}", values: { reason: "CrashLoopBackOff" } },
      ],
      message: "back-off restarting failed container",
      podCount: 2,
    },
  ],
  isTruncated: false,
};

interface RouteCall {
  thrown: unknown;
  nextCallCount: number;
}

describe("KubernetesResourceAPI needs-attention", () => {
  let clusterId: ObjectID;
  let projectId: ObjectID;
  let props: DatabaseCommonInteractionProps;
  let mockResponse: ExpressResponse;
  let nextFunction: NextFunction;
  let findOneById: jest.SpyInstance;
  let getNeedsAttention: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new KubernetesResourceAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    clusterId = ObjectID.generate();
    projectId = ObjectID.generate();
    props = {
      isRoot: false,
      userId: ObjectID.generate(),
      tenantId: projectId,
    } as DatabaseCommonInteractionProps;

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(props);

    findOneById = jest.spyOn(KubernetesClusterService, "findOneById");
    getNeedsAttention = jest
      .spyOn(KubernetesResourceService, "getNeedsAttention")
      .mockResolvedValue(RESULT);

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

  function readableCluster(): KubernetesCluster {
    const cluster: KubernetesCluster = new KubernetesCluster();
    cluster.id = clusterId;
    cluster.projectId = projectId;
    return cluster;
  }

  async function callRoute(
    clusterIdParam: string | undefined,
  ): Promise<RouteCall> {
    const request: ExpressRequest = {
      params: clusterIdParam === undefined ? {} : { clusterId: clusterIdParam },
      body: {},
      query: {},
      cookies: {},
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;

    await mockRouter
      .match("post", NEEDS_ATTENTION_ROUTE)
      .handlerFunction(request, mockResponse, nextFunction);

    const calls: Array<Array<unknown>> = (nextFunction as jest.Mock).mock
      .calls as Array<Array<unknown>>;

    return { thrown: calls[0]?.[0], nextCallCount: calls.length };
  }

  test("is mounted as POST behind UserMiddleware only, beside the inventory summary", () => {
    const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
      "post",
      NEEDS_ATTENTION_ROUTE,
    );
    expect(route.method).toBe("POST");
    expect(route.middlewares).toEqual([UserMiddleware.getUserMiddleware]);
    expect(() => {
      return mockRouter.match("get", NEEDS_ATTENTION_ROUTE);
    }).toThrow();
    expect(
      mockRouter.match(
        "post",
        "/kubernetes-resource/inventory-summary/:clusterId",
      ).method,
    ).toBe("POST");
  });

  test("rejects a missing cluster id before touching any service", async () => {
    const call: RouteCall = await callRoute(undefined);

    expect(call.thrown).toBeInstanceOf(BadDataException);
    expect((call.thrown as BadDataException).message).toBe(
      "Cluster ID is required",
    );
    expect(findOneById).not.toHaveBeenCalled();
    expect(getNeedsAttention).not.toHaveBeenCalled();
  });

  test("resolves the cluster with the caller's props, never as root", async () => {
    findOneById.mockResolvedValue(readableCluster());

    await callRoute(clusterId.toString());

    const findArgs: JSONObject = findOneById.mock.calls[0]![0] as JSONObject;
    expect((findArgs["id"] as ObjectID).toString()).toBe(clusterId.toString());
    expect(findArgs["props"]).toBe(props);
    expect((findArgs["props"] as DatabaseCommonInteractionProps).isRoot).toBe(
      false,
    );
    expect(findArgs["select"]).toEqual({ _id: true, projectId: true });
  });

  test("answers NotFound for a cluster that is missing or that the caller may not read", async () => {
    findOneById.mockResolvedValue(null);

    const call: RouteCall = await callRoute(clusterId.toString());

    expect(call.thrown).toBeInstanceOf(NotFoundException);
    expect((call.thrown as NotFoundException).message).toBe(
      "Kubernetes Cluster not found",
    );
    expect(getNeedsAttention).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("reads the findings of that cluster in its own project, and sends them as they are", async () => {
    findOneById.mockResolvedValue(readableCluster());

    const call: RouteCall = await callRoute(clusterId.toString());

    expect(call.nextCallCount).toBe(0);
    expect(getNeedsAttention).toHaveBeenCalledTimes(1);
    const args: JSONObject = getNeedsAttention.mock.calls[0]![0] as JSONObject;
    expect((args["projectId"] as ObjectID).toString()).toBe(
      projectId.toString(),
    );
    expect((args["kubernetesClusterId"] as ObjectID).toString()).toBe(
      clusterId.toString(),
    );

    const calls: Array<Array<unknown>> = (
      Response.sendJsonObjectResponse as jest.Mock
    ).mock.calls as Array<Array<unknown>>;
    expect(calls).toHaveLength(1);
    expect(calls[0]![2]).toEqual({
      findings: RESULT.findings,
      isTruncated: false,
    });
  });

  test("passes a read that fails on to the error handler", async () => {
    findOneById.mockResolvedValue(readableCluster());
    getNeedsAttention.mockRejectedValue(new Error("database is down"));

    const call: RouteCall = await callRoute(clusterId.toString());

    expect(call.nextCallCount).toBe(1);
    expect((call.thrown as Error).message).toBe("database is down");
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
