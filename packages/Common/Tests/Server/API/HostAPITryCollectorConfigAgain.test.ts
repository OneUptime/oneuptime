import { mockRouter } from "./Helpers";
import { countRefusals, withoutRefusals } from "./RouteRefusals";
import CommonAPI from "../../../Server/API/CommonAPI";
import HostAPI from "../../../Server/API/HostAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import HostService from "../../../Server/Services/HostService";
import ServerProductRoutes from "../../../Server/Utils/ServerProducts/ServerProductRoutes";
import ServerProducts from "../../../Server/Utils/ServerProducts/ServerProducts";
import ServerSetColumns from "../../../Server/Utils/Database/ServerSetColumns";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ProductSwitchedOffException from "../../../Types/Exception/ProductSwitchedOffException";
import ObjectID from "../../../Types/ObjectID";
import ProductKey from "../../../Types/Product/ProductKey";
import { ServerProductOffReason } from "../../../Types/Product/ServerProducts";
import { TRY_COLLECTOR_CONFIG_AGAIN_ROUTE } from "../../../Types/HostCollector/HostCollectorRoutes";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * POST /host/:id/try-collector-config-again (#10053)
 *
 * Try again on a host's collector card sends the host the config that
 * failed on it again, by clearing the failed config's hash as OneUptime's
 * value. It changes a host, so it is refused while the server has
 * switched Hosts off - by its own refusal, before anything is read, as
 * every product's own route is (ServerProductRoutes, held to it by
 * ProductCustomRoutesGuard) - and answered as before while Hosts is on.
 * What it writes, and to whom it is refused, is pinned over HTTP by
 * ColumnsOnlyOneUptimeWritesOverHttp.
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
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

const ROUTE: string = `/host/:id/${TRY_COLLECTOR_CONFIG_AGAIN_ROUTE}`;

describe("HostAPI try-collector-config-again", () => {
  let hostId: ObjectID;
  let props: DatabaseCommonInteractionProps;
  let response: ExpressResponse;
  let updateOneById: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new HostAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    hostId = ObjectID.generate();
    props = {
      isRoot: false,
      userId: ObjectID.generate(),
      tenantId: ObjectID.generate(),
    } as DatabaseCommonInteractionProps;

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(props);
    jest.spyOn(ServerProducts, "assertRecordTableIsOn").mockResolvedValue();
    updateOneById = jest
      .spyOn(HostService, "updateOneById")
      .mockResolvedValue(1);

    response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      send: jest.fn(),
    } as unknown as ExpressResponse;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The route's refusal of a product switched off, run on its own.
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
        params: { id: hostId.toString() },
      } as unknown as ExpressRequest,
      response,
      ((err?: unknown): void => {
        handedOn.push(err);
      }) as NextFunction,
    );

    return handedOn;
  }

  test("is a POST behind UserMiddleware and one refusal, which reads who is asking first", () => {
    const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
      "post",
      ROUTE,
    );

    expect(route.method).toBe("POST");
    expect(withoutRefusals(route.middlewares)).toEqual([
      UserMiddleware.getUserMiddleware,
    ]);
    expect(countRefusals(route.middlewares)).toBe(1);
    expect(ServerProductRoutes.isRefusal(route.middlewares[1])).toBe(true);
  });

  test("is refused while the server has switched Hosts off, before the host is read or written", async () => {
    jest.spyOn(ServerProducts, "getOff").mockResolvedValue({
      [ProductKey.Hosts]: ServerProductOffReason.SwitchedOff,
    });

    const handedOn: Array<unknown> = await runRefusal();

    expect(handedOn).toHaveLength(1);
    expect(handedOn[0]).toBeInstanceOf(ProductSwitchedOffException);
    expect((handedOn[0] as ProductSwitchedOffException).message).toContain(
      "is switched off on this server.",
    );
    expect(updateOneById).not.toHaveBeenCalled();
  });

  test("goes on to its handler while Hosts is on, whatever else is off", async () => {
    jest.spyOn(ServerProducts, "getOff").mockResolvedValue({
      [ProductKey.Kubernetes]: ServerProductOffReason.SwitchedOff,
    });

    // next() with nothing: on to the handler.
    expect(await runRefusal()).toEqual([undefined]);
  });

  test("the handler clears the failed config's hash as OneUptime's value, as the caller", async () => {
    const next: jest.Mock = jest.fn();

    await mockRouter.match("post", ROUTE).handlerFunction(
      {
        params: { id: hostId.toString() },
        body: {},
        query: {},
        headers: {},
      } as unknown as ExpressRequest,
      response,
      next as unknown as NextFunction,
    );

    expect(next).not.toHaveBeenCalled();
    expect(updateOneById).toHaveBeenCalledTimes(1);

    const call: {
      id: ObjectID;
      data: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = updateOneById.mock.calls[0]![0] as never;

    expect(call.id.toString()).toBe(hostId.toString());
    expect(call.data).toEqual({ collectorFailedConfigHash: null });
    expect(
      ServerSetColumns.isMarked(call.data, "collectorFailedConfigHash"),
    ).toBe(true);
    expect(call.props).toBe(props);
    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
  });
});
