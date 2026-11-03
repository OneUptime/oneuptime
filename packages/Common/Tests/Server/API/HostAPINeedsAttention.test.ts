import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import HostAPI from "../../../Server/API/HostAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import HostService, {
  HostsThatMayNeedAttention,
} from "../../../Server/Services/HostService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import Host from "../../../Models/DatabaseModels/Host";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "../../../Types/JSON";
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
 * POST /host/needs-attention
 *
 * The Hosts list's Needs attention card: the project's hosts that may need
 * attention, which the Dashboard then judges by HostHealth's rules. It runs
 * behind UserMiddleware and reads as the caller - their project from the
 * tenant header, their permissions and label access - by handing their
 * props to HostService.findHostsThatMayNeedAttention, whose own suites pin
 * the reads and run them on Postgres. The service is stubbed here.
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

const ROUTE: string = "/host/needs-attention";

describe("HostAPI needs-attention", () => {
  let props: DatabaseCommonInteractionProps;
  let response: ExpressResponse;
  let next: NextFunction;
  let find: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new HostAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    props = {
      isRoot: false,
      userId: ObjectID.generate(),
      tenantId: new ObjectID("33333333-3333-4333-8333-333333333333"),
    } as DatabaseCommonInteractionProps;

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
        return props;
      });

    find = jest
      .spyOn(HostService, "findHostsThatMayNeedAttention")
      .mockResolvedValue({ hosts: [], isTruncated: false });

    response = {
      cookie: jest.fn(),
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;
    next = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function request(): ExpressRequest {
    return {
      params: {},
      body: {},
      query: {},
      cookies: {},
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;
  }

  async function call(): Promise<unknown> {
    await mockRouter
      .match("post", ROUTE)
      .handlerFunction(request(), response, next);
    const calls: Array<Array<unknown>> = (next as jest.Mock).mock
      .calls as Array<Array<unknown>>;
    return calls[0]?.[0];
  }

  function sentBody(): JSONObject {
    const calls: Array<Array<unknown>> = (
      Response.sendJsonObjectResponse as jest.Mock
    ).mock.calls as Array<Array<unknown>>;
    expect(calls).toHaveLength(1);
    return calls[0]![2] as JSONObject;
  }

  describe("registration", () => {
    test("is a POST on the hosts' CRUD path, behind UserMiddleware only", () => {
      expect(new Host().getCrudApiPath()?.toString()).toBe("/host");
      const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
        "post",
        ROUTE,
      );
      expect(route.method).toBe("POST");
      expect(route.middlewares).toEqual([UserMiddleware.getUserMiddleware]);
      for (const method of ["get", "put", "delete"]) {
        expect(() => {
          return mockRouter.match(method, ROUTE);
        }).toThrow();
      }
    });

    test("keeps every route the hosts' CRUD router has, and does not collide with them", () => {
      const postRoutes: Array<string> = mockRouter.routes
        .filter((route: { method: string }): boolean => {
          return route.method === "POST";
        })
        .map((route: { uri: string }): string => {
          return route.uri;
        });
      for (const uri of [
        "/host",
        "/host/get-list",
        "/host/count",
        "/host/:id/get-item",
        "/host/:id/update-item",
        "/host/:id/delete-item",
      ]) {
        expect(postRoutes).toContain(uri);
      }
      expect(
        postRoutes.filter((uri: string): boolean => {
          return uri === ROUTE;
        }),
      ).toHaveLength(1);
    });
  });

  describe("the read", () => {
    test("reads the caller's project as the caller", async () => {
      await call();

      expect(find).toHaveBeenCalledTimes(1);
      expect(find.mock.calls[0]![0]).toEqual({
        projectId: props.tenantId,
        props: props,
      });
    });

    test("answers the hosts found and whether the list was cut short", async () => {
      const host: Host = new Host();
      host._id = "44444444-4444-4444-8444-444444444444";
      host.name = "db-01";
      host.otelCollectorStatus = "disconnected";
      host.latestDiskPercent = 96.4;
      host.latestDiskMountpoint = "/var";
      const found: HostsThatMayNeedAttention = {
        hosts: [host],
        isTruncated: true,
      };
      find.mockResolvedValue(found);

      await call();

      const body: JSONObject = sentBody();
      expect(body["isTruncated"]).toBe(true);
      const hosts: JSONArray = body["hosts"] as JSONArray;
      expect(hosts).toHaveLength(1);
      expect(hosts[0]).toEqual(
        expect.objectContaining({
          _id: "44444444-4444-4444-8444-444444444444",
          name: "db-01",
          otelCollectorStatus: "disconnected",
          latestDiskPercent: 96.4,
          latestDiskMountpoint: "/var",
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    test("an answer with nothing to look at is an empty list, not an error", async () => {
      await call();

      expect(sentBody()).toEqual({ hosts: [], isTruncated: false });
    });

    test("a request without a project is refused, and nothing is read", async () => {
      props = { isRoot: false, userId: ObjectID.generate() };

      const thrown: unknown = await call();

      expect(thrown).toBeInstanceOf(BadDataException);
      expect((thrown as BadDataException).message).toBe(
        "Project ID is required",
      );
      expect(find).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });

    test("a read that fails is passed on to the error handler, never answered as an all-clear", async () => {
      find.mockRejectedValue(new Error("permission denied"));

      const thrown: unknown = await call();

      expect((thrown as Error).message).toBe("permission denied");
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });
  });
});
