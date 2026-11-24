import { mockRouter } from "./Helpers";
import { countRefusals, withoutRefusals } from "./RouteRefusals";
import CommonAPI from "../../../Server/API/CommonAPI";
import KubernetesResourceAPI from "../../../Server/API/KubernetesResourceAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import KubernetesClusterCompliance from "../../../Server/Utils/Kubernetes/KubernetesClusterCompliance";
import KubernetesClusterComplianceSummary from "../../../Server/Utils/Kubernetes/KubernetesClusterComplianceSummary";
import ServerProductRoutes from "../../../Server/Utils/ServerProducts/ServerProductRoutes";
import ServerProducts from "../../../Server/Utils/ServerProducts/ServerProducts";
import ProductSwitchedOffException from "../../../Types/Exception/ProductSwitchedOffException";
import ProductKey from "../../../Types/Product/ProductKey";
import { ServerProductOffReason } from "../../../Types/Product/ServerProducts";
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
import {
  KubernetesComplianceResponse,
  getKubernetesComplianceRoute,
} from "../../../Types/Kubernetes/Compliance/KubernetesComplianceApiTypes";
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
 * POST /kubernetes-resource/compliance/:clusterId (#9627)
 *
 * How a cluster itself stands against the Pod Security Standards and the
 * CIS Kubernetes Benchmark, for its Compliance page. Behind UserMiddleware,
 * like the cluster's other reads beside it: the cluster is resolved with
 * the caller's props, so whoever may read the cluster may read its
 * compliance, and a cluster that is missing and one the caller may not
 * read answer the same NotFound, before anything about it is read. Unlike
 * them it sets Kubernetes to work, scoring the cluster on request, so it
 * is refused while the server has switched Kubernetes off.
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
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

const ROUTE: string = "/kubernetes-resource/compliance/:clusterId";

interface RouteCall {
  thrown: unknown;
  nextCallCount: number;
}

describe("KubernetesResourceAPI compliance", () => {
  let clusterId: ObjectID;
  let projectId: ObjectID;
  let props: DatabaseCommonInteractionProps;
  let mockResponse: ExpressResponse;
  let nextFunction: NextFunction;
  let findOneById: jest.SpyInstance;
  let readCompliance: jest.SpyInstance;
  let storeSummary: jest.SpyInstance;
  let answer: KubernetesComplianceResponse;

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
    answer = {
      clusterId: clusterId.toString(),
      kubernetesVersion: "1.31",
      standardVersion: "1.31",
      provider: "EKS",
      isManagedControlPlane: true,
      podCount: 0,
      podsRead: 0,
      hasPolicyObjects: false,
      policyEngine: null,
      isTruncated: false,
      namespaces: [],
      frameworks: [],
    };

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(props);
    findOneById = jest.spyOn(KubernetesClusterService, "findOneById");
    readCompliance = jest
      .spyOn(KubernetesClusterCompliance, "readCompliance")
      .mockResolvedValue(answer);
    storeSummary = jest
      .spyOn(KubernetesClusterComplianceSummary, "storeQuietly")
      .mockResolvedValue(undefined);

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

  function cluster(data: Partial<KubernetesCluster> = {}): KubernetesCluster {
    const model: KubernetesCluster = new KubernetesCluster();
    model.id = clusterId;
    model.projectId = projectId;
    Object.assign(model, data);
    return model;
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
      .match("post", ROUTE)
      .handlerFunction(request, mockResponse, nextFunction);

    const calls: Array<Array<unknown>> = (nextFunction as jest.Mock).mock
      .calls as Array<Array<unknown>>;

    return { thrown: calls[0]?.[0], nextCallCount: calls.length };
  }

  test("is mounted as POST behind UserMiddleware and one refusal, where the Dashboard asks", () => {
    const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
      "post",
      ROUTE,
    );

    expect(route.method).toBe("POST");
    expect(withoutRefusals(route.middlewares)).toEqual([
      UserMiddleware.getUserMiddleware,
    ]);
    // The refusal reads who is asking first, as every route's does.
    expect(countRefusals(route.middlewares)).toBe(1);
    expect(ServerProductRoutes.isRefusal(route.middlewares[1])).toBe(true);
    expect(getKubernetesComplianceRoute(":clusterId")).toBe(ROUTE);
  });

  /*
   * Scoring sets Kubernetes to work, so the route is refused while the
   * server has switched Kubernetes off (#7479), before anything about the
   * cluster is read, and answered as before while it is on.
   */
  async function runRefusal(): Promise<Array<unknown>> {
    const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
      "post",
      ROUTE,
    );
    const refusal: (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ) => Promise<void> = route.middlewares.find((middleware: unknown) => {
      return ServerProductRoutes.isRefusal(middleware);
    }) as never;
    const handedOn: Array<unknown> = [];

    await refusal(
      {
        body: {},
        params: { clusterId: clusterId.toString() },
      } as unknown as ExpressRequest,
      mockResponse,
      ((err?: unknown): void => {
        handedOn.push(err);
      }) as NextFunction,
    );

    return handedOn;
  }

  test("is refused while the server has switched Kubernetes off, before the cluster is read", async () => {
    jest.spyOn(ServerProducts, "getOff").mockResolvedValue({
      [ProductKey.Kubernetes]: ServerProductOffReason.SwitchedOff,
    });

    const handedOn: Array<unknown> = await runRefusal();

    expect(handedOn).toHaveLength(1);
    expect(handedOn[0]).toBeInstanceOf(ProductSwitchedOffException);
    expect((handedOn[0] as ProductSwitchedOffException).message).toContain(
      "Kubernetes is switched off on this server.",
    );
    expect(findOneById).not.toHaveBeenCalled();
    expect(readCompliance).not.toHaveBeenCalled();
    // Nor is a summary kept (#9876).
    expect(storeSummary).not.toHaveBeenCalled();
  });

  test("goes on to score the cluster while Kubernetes is on, whatever else is off", async () => {
    jest.spyOn(ServerProducts, "getOff").mockResolvedValue({
      [ProductKey.Code]: ServerProductOffReason.SwitchedOff,
    });

    const handedOn: Array<unknown> = await runRefusal();

    // next() with nothing: on to the handler.
    expect(handedOn).toEqual([undefined]);
  });

  test("rejects a missing cluster id before reading anything", async () => {
    const call: RouteCall = await callRoute(undefined);

    expect(call.thrown).toBeInstanceOf(BadDataException);
    expect(findOneById).not.toHaveBeenCalled();
    expect(readCompliance).not.toHaveBeenCalled();
  });

  test("answers NotFound for a cluster that is missing or that the caller may not read, reading nothing of it", async () => {
    findOneById.mockResolvedValue(null);

    const call: RouteCall = await callRoute(clusterId.toString());

    expect(call.thrown).toBeInstanceOf(NotFoundException);
    expect(readCompliance).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("resolves the cluster with the caller's props first, then reads that cluster's compliance in its own project", async () => {
    findOneById
      .mockResolvedValueOnce(cluster())
      .mockResolvedValueOnce(cluster({ name: "prod-eu", provider: "EKS" }));

    const call: RouteCall = await callRoute(clusterId.toString());

    expect(call.nextCallCount).toBe(0);
    const firstRead: JSONObject = findOneById.mock.calls[0]![0] as JSONObject;
    expect(firstRead["props"]).toBe(props);
    expect(readCompliance).toHaveBeenCalledTimes(1);

    const args: {
      projectId: ObjectID;
      cluster: { id: ObjectID; name: string; provider: string | null };
    } = readCompliance.mock.calls[0]![0] as never;

    expect(args.projectId.toString()).toBe(projectId.toString());
    expect(args.cluster.id.toString()).toBe(clusterId.toString());
    expect(args.cluster.name).toBe("prod-eu");
    expect(args.cluster.provider).toBe("EKS");

    const sent: Array<Array<unknown>> = (
      Response.sendJsonObjectResponse as jest.Mock
    ).mock.calls as Array<Array<unknown>>;

    expect(sent[0]![2]).toEqual(answer);
  });

  test("names a cluster with no name by its identifier", async () => {
    findOneById
      .mockResolvedValueOnce(cluster())
      .mockResolvedValueOnce(cluster({ clusterIdentifier: "arn:eks:prod" }));

    await callRoute(clusterId.toString());

    expect(
      (readCompliance.mock.calls[0]![0] as { cluster: { name: string } })
        .cluster.name,
    ).toBe("arn:eks:prod");
  });

  test("passes a read that fails on to the error handler, keeping no summary", async () => {
    findOneById.mockResolvedValue(cluster());
    readCompliance.mockRejectedValue(new Error("database is down"));

    const call: RouteCall = await callRoute(clusterId.toString());

    expect(call.nextCallCount).toBe(1);
    expect((call.thrown as Error).message).toBe("database is down");
    expect(storeSummary).not.toHaveBeenCalled();
  });

  /*
   * #9876: the answer just worked out is the cluster's summary now, so
   * Kubernetes' Compliance page shows a switch just flipped, or a finding
   * just accepted, without waiting for the next refresh.
   */
  test("keeps the answer it read as the cluster's compliance summary, then answers", async () => {
    findOneById.mockResolvedValue(cluster());

    const before: number = Date.now();
    const call: RouteCall = await callRoute(clusterId.toString());

    expect(call.nextCallCount).toBe(0);
    expect(storeSummary).toHaveBeenCalledTimes(1);

    const stored: {
      clusterId: ObjectID;
      compliance: KubernetesComplianceResponse;
      refreshedAt: Date;
    } = storeSummary.mock.calls[0]![0] as never;

    expect(stored.clusterId.toString()).toBe(clusterId.toString());
    expect(stored.compliance).toBe(answer);
    expect(stored.refreshedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(
      (Response.sendJsonObjectResponse as jest.Mock).mock.calls[0]![2],
    ).toEqual(answer);
  });
});
