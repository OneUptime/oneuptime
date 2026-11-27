import { mockRouter } from "./Helpers";
import { countRefusals, withoutRefusals } from "./RouteRefusals";
import { customDomainCaller } from "./CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import CloudCostGroupAPI from "../../../Server/API/CloudCostGroupAPI";
import CloudCostViewAPI from "../../../Server/API/CloudCostViewAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import CloudCostViewService from "../../../Server/Services/CloudCostViewService";
import CloudCostAllocation from "../../../Server/Utils/CloudCost/CloudCostAllocation";
import CloudCostViewSync from "../../../Server/Utils/CloudCost/CloudCostViewSync";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import ServerProductRoutes from "../../../Server/Utils/ServerProducts/ServerProductRoutes";
import ServerProducts from "../../../Server/Utils/ServerProducts/ServerProducts";
import CloudCostGroup from "../../../Models/DatabaseModels/CloudCostGroup";
import CloudCostView from "../../../Models/DatabaseModels/CloudCostView";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { CloudCostAllocationResult } from "../../../Types/Cloud/CloudCostAllocation";
import ProductSwitchedOffException from "../../../Types/Exception/ProductSwitchedOffException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ProductKey from "../../../Types/Product/ProductKey";
import {
  ServerProductOffReason,
  getProductOffMessage,
} from "../../../Types/Product/ServerProducts";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";

/*
 * A COST VIEW'S AND A COST GROUP'S OWN ROUTES, WHILE THE SERVER HAS
 * SWITCHED CLOUD OFF (#7479, #11006).
 *
 *   POST /cloud-cost-view/:viewId/make-groups
 *     makes the groups a view per tag value or owner team is missing, as
 *     the server (CloudCostViewSync), so no write refusal stands in its
 *     way: it names Cloud, and is refused while Cloud is off, before the
 *     view is read or a group made - as a cloud connection's Read Now is;
 *   POST /cloud-cost-view/:viewId/allocation
 *   POST /cloud-cost-group/:groupId/spend
 *     only read, and are left alone: products that stay on show records
 *     of others, and switching Cloud on again loses nothing.
 *
 * ProductCustomRoutesGuard holds both files to these decisions.
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

jest.mock("../../../Server/Utils/Logger");

const VIEW_PATH: string = new CloudCostView().getCrudApiPath()!.toString();
const GROUP_PATH: string = new CloudCostGroup().getCrudApiPath()!.toString();
const MAKE_GROUPS_ROUTE: string = `${VIEW_PATH}/:viewId/make-groups`;
const ALLOCATION_ROUTE: string = `${VIEW_PATH}/:viewId/allocation`;
const SPEND_ROUTE: string = `${GROUP_PATH}/:groupId/spend`;

const PROJECT_ID: ObjectID = new ObjectID(
  "11006000-0000-4000-8000-0000000000c1",
);
const VIEW_ID: ObjectID = new ObjectID("11006000-0000-4000-8000-0000000000c2");

type Route = ReturnType<typeof mockRouter.match>;

type RouteMiddleware = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

describe("a cost view's and a cost group's own routes, while Cloud is switched off", () => {
  let response: ExpressResponse;
  let readView: SpyInstance<typeof CloudCostViewService.findOneBy>;
  let makeGroups: SpyInstance<typeof CloudCostViewSync.makeGroupsForView>;
  let readAllocation: SpyInstance<typeof CloudCostAllocation.read>;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new CloudCostViewAPI();
    new CloudCostGroupAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    const caller: DatabaseCommonInteractionProps = {
      ...customDomainCaller({
        permissions: [Permission.ProjectAdmin],
        projectId: PROJECT_ID,
      }),
      ...ON_HIGHEST_PLAN,
    };

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(caller);
    readView = jest
      .spyOn(CloudCostViewService, "findOneBy")
      .mockResolvedValue(new CloudCostView(VIEW_ID));
    makeGroups = jest
      .spyOn(CloudCostViewSync, "makeGroupsForView")
      .mockResolvedValue(2);
    readAllocation = jest
      .spyOn(CloudCostAllocation, "read")
      .mockResolvedValue({} as CloudCostAllocationResult);

    response = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function switchedOff(product: ProductKey): void {
    jest.spyOn(ServerProducts, "getOff").mockResolvedValue({
      [product]: ServerProductOffReason.SwitchedOff,
    });
  }

  function request(): ExpressRequest {
    return {
      params: { viewId: VIEW_ID.toString() },
      query: {},
      headers: {},
      body: {
        startDate: "2026-11-01",
        endDate: "2026-11-25",
      },
    } as unknown as ExpressRequest;
  }

  // What the route's refusal hands on: an error, or nothing to go on.
  async function runRefusal(route: Route): Promise<Array<unknown>> {
    const refusal: RouteMiddleware = route.middlewares.find(
      (middleware: unknown): boolean => {
        return ServerProductRoutes.isRefusal(middleware);
      },
    ) as never;
    const handedOn: Array<unknown> = [];

    await refusal(request(), response, ((error?: unknown): void => {
      handedOn.push(error);
    }) as NextFunction);

    return handedOn;
  }

  // The route's handler, after its middlewares: what it handed to next, if anything.
  async function runHandler(route: Route): Promise<Array<unknown>> {
    const handedOn: Array<unknown> = [];

    await route.handlerFunction(request(), response, ((
      error?: unknown,
    ): void => {
      handedOn.push(error);
    }) as NextFunction);

    return handedOn;
  }

  test("Make Groups is mounted as POST behind UserMiddleware, then one refusal, before its handler", () => {
    const route: Route = mockRouter.match("post", MAKE_GROUPS_ROUTE);

    expect(route.method).toBe("POST");
    expect(MAKE_GROUPS_ROUTE).toBe("/cloud-cost-view/:viewId/make-groups");
    expect(withoutRefusals(route.middlewares)).toEqual([
      UserMiddleware.getUserMiddleware,
    ]);
    expect(countRefusals(route.middlewares)).toBe(1);
    // The refusal reads who is asking first, as every route's does.
    expect(ServerProductRoutes.isRefusal(route.middlewares[1])).toBe(true);
  });

  test("Make Groups is refused while the server has switched Cloud off, before the view is read or a group made", async () => {
    switchedOff(ProductKey.Cloud);

    const handedOn: Array<unknown> = await runRefusal(
      mockRouter.match("post", MAKE_GROUPS_ROUTE),
    );

    expect(handedOn).toHaveLength(1);
    expect(handedOn[0]).toBeInstanceOf(ProductSwitchedOffException);
    expect((handedOn[0] as ProductSwitchedOffException).product).toBe(
      ProductKey.Cloud,
    );
    // What happened, and who can switch it on.
    expect((handedOn[0] as ProductSwitchedOffException).message).toBe(
      getProductOffMessage({
        product: ProductKey.Cloud,
        reason: ServerProductOffReason.SwitchedOff,
      }),
    );
    expect(readView).not.toHaveBeenCalled();
    expect(makeGroups).not.toHaveBeenCalled();
  });

  test("Make Groups goes on to make the view's groups while Cloud is on, whatever else is off", async () => {
    switchedOff(ProductKey.Code);

    const route: Route = mockRouter.match("post", MAKE_GROUPS_ROUTE);

    // next() with nothing: on to the handler.
    expect(await runRefusal(route)).toEqual([undefined]);
    expect(await runHandler(route)).toEqual([]);

    // The view read in the caller's project, its groups made as the server.
    expect(readView).toHaveBeenCalledTimes(1);
    expect(readView.mock.calls[0]![0]).toMatchObject({
      query: { _id: VIEW_ID, projectId: PROJECT_ID },
    });
    expect(makeGroups).toHaveBeenCalledTimes(1);
    expect(makeGroups.mock.calls[0]![0].toString()).toBe(VIEW_ID.toString());
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
      expect.anything(),
      response,
      { made: 2 },
    );
  });

  test("a view's allocation and a group's spend only read: no refusal stands in front of either", () => {
    for (const path of [ALLOCATION_ROUTE, SPEND_ROUTE]) {
      const route: Route = mockRouter.match("post", path);

      expect(route.method).toBe("POST");
      expect(countRefusals(route.middlewares)).toBe(0);
      expect(route.middlewares).toEqual([UserMiddleware.getUserMiddleware]);
    }

    expect(ALLOCATION_ROUTE).toBe("/cloud-cost-view/:viewId/allocation");
    expect(SPEND_ROUTE).toBe("/cloud-cost-group/:groupId/spend");
  });

  test("a view's allocation is still read while Cloud is off: switching it on again loses nothing", async () => {
    switchedOff(ProductKey.Cloud);

    expect(
      await runHandler(mockRouter.match("post", ALLOCATION_ROUTE)),
    ).toEqual([]);
    expect(readAllocation).toHaveBeenCalledTimes(1);
    expect(readAllocation.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      viewId: VIEW_ID,
    });
  });
});
