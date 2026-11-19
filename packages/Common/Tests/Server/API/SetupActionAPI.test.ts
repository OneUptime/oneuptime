import { mockRouter } from "./Helpers";
import "../../../Server/API/SetupActionAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import SetupActionRunner from "../../../Server/Utils/AI/Toolbox/SetupActionRunner";
import ProductsOfRequest from "../../../Server/Utils/ServerProducts/ProductsOfRequest";
import ServerProductRoutes from "../../../Server/Utils/ServerProducts/ServerProductRoutes";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import {
  SETUP_ACTIONS_RUN_OUTSIDE_CHAT,
  SETUP_ACTION_RUN_ROUTE,
  SetupActionRunResult,
} from "../../../Types/AI/AISetupActions";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ProductKey from "../../../Types/Product/ProductKey";
import { customDomainCaller } from "./CustomDomainCallers";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
  };
});

/*
 * POST /api/setup-actions/run (#7241): the MCP server's outcome-level
 * tools reach Ask AI's setup actions here, one call each.
 *
 *   - Signed in (a member, or a project API key, which the runner then
 *     refuses a setup action): never anonymous.
 *   - Refused while a product the action belongs to is switched off on
 *     the server, before anything is read: the products of the action the
 *     body names (ProductsOfRequest.setupAction).
 *   - The handler hands the runner the action, its arguments and the
 *     caller's props in their own project, and answers with what it made;
 *     a refusal is the runner's error, with its status.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);

const props: DatabaseCommonInteractionProps = customDomainCaller({
  permissions: [Permission.ProjectOwner],
  projectId: PROJECT_ID,
});

const MADE: SetupActionRunResult = {
  action: "set_up_website_monitoring",
  title: "Set up monitoring for example.com",
  details: ["A website monitor checks https://example.com every minute."],
  message: 'Created the Website monitor "example.com".',
  record: { type: "MonitorView", params: { monitorId: "m-1" } },
};

async function callRoute(body: unknown): Promise<jest.Mock> {
  const req: ExpressRequest = { body } as unknown as ExpressRequest;
  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("post", SETUP_ACTION_RUN_ROUTE)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  return next;
}

describe("POST /setup-actions/run", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(props);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("is under the API's base, signed in, and refused while its action's product is off", () => {
    expect(SETUP_ACTION_RUN_ROUTE).toBe("/setup-actions/run");

    const route: {
      middlewares: Array<unknown>;
    } = mockRouter.match("post", SETUP_ACTION_RUN_ROUTE) as unknown as {
      middlewares: Array<unknown>;
    };

    expect(route.middlewares[0]).toBe(UserMiddleware.getUserMiddleware);
    expect(ServerProductRoutes.isRefusal(route.middlewares[1])).toBe(true);
  });

  it("runs the action as the caller, in their project, and answers with what it made", async () => {
    const run: jest.SpiedFunction<typeof SetupActionRunner.run> = jest
      .spyOn(SetupActionRunner, "run")
      .mockResolvedValue(MADE);

    const next: jest.Mock = await callRoute({
      action: " set_up_website_monitoring ",
      arguments: { address: "example.com", checkEveryMinutes: 1 },
    });

    expect(next).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith({
      action: "set_up_website_monitoring",
      args: { address: "example.com", checkEveryMinutes: 1 },
      ctx: { projectId: PROJECT_ID, props: props },
    });
    expect(
      (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
        .calls[0]![2],
    ).toEqual(MADE);
  });

  it("an action with no arguments runs with none", async () => {
    const run: jest.SpiedFunction<typeof SetupActionRunner.run> = jest
      .spyOn(SetupActionRunner, "run")
      .mockResolvedValue({ ...MADE, action: "set_up_paging" });

    await callRoute({ action: "set_up_paging" });

    expect(run.mock.calls[0]![0].args).toEqual({});
  });

  it("no action named: 400, and nothing runs", async () => {
    const run: jest.SpiedFunction<typeof SetupActionRunner.run> = jest.spyOn(
      SetupActionRunner,
      "run",
    );

    for (const body of [{}, { action: "" }, { action: 7 }, null]) {
      const next: jest.Mock = await callRoute(body);

      expect(next.mock.calls[0]![0]).toBeInstanceOf(BadDataException);
    }

    expect(run).not.toHaveBeenCalled();
  });

  it("a refusal is the runner's own error, passed on with its status", async () => {
    const refusal: ForbiddenException = new ForbiddenException(
      "Error: the current user does not have permission to use set_up_paging.",
    );
    jest.spyOn(SetupActionRunner, "run").mockRejectedValue(refusal);

    const next: jest.Mock = await callRoute({ action: "set_up_paging" });

    expect(next).toHaveBeenCalledWith(refusal);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  it("an anonymous caller is refused before anything runs", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue({} as DatabaseCommonInteractionProps);
    const run: jest.SpiedFunction<typeof SetupActionRunner.run> = jest.spyOn(
      SetupActionRunner,
      "run",
    );

    const next: jest.Mock = await callRoute({
      action: "set_up_website_monitoring",
      arguments: { address: "example.com" },
    });

    expect(next.mock.calls[0]![0]).toBeInstanceOf(Error);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("ProductsOfRequest.setupAction", () => {
  function productsOf(body: unknown): Array<ProductKey> {
    return ProductsOfRequest.setupAction({
      body,
      params: {},
    } as unknown as ExpressRequest);
  }

  it("names the products of the action the body names, as Ask AI's tool does", () => {
    expect(productsOf({ action: "set_up_website_monitoring" })).toEqual([
      ProductKey.Monitors,
    ]);
    expect(productsOf({ action: "set_up_paging" })).toEqual([
      ProductKey.OnCall,
    ]);
    expect(productsOf({ action: "publish_status_page" })).toEqual([
      ProductKey.StatusPages,
    ]);
    expect(productsOf({ action: "add_monitors_to_status_page" })).toEqual([
      ProductKey.StatusPages,
    ]);
    expect(productsOf({ action: "who_is_told" })).toEqual([
      ProductKey.Monitors,
    ]);
  });

  it("every action it runs names a product", () => {
    for (const action of SETUP_ACTIONS_RUN_OUTSIDE_CHAT) {
      expect([action, productsOf({ action }).length > 0]).toEqual([
        action,
        true,
      ]);
    }
  });

  it("names none for an action it does not run, or a body that names none", () => {
    expect(productsOf({ action: "create_incident" })).toEqual([]);
    expect(productsOf({ action: "set_how_to_reach_me" })).toEqual([]);
    expect(productsOf({})).toEqual([]);
    expect(productsOf(null)).toEqual([]);
    expect(
      productsOf({ action: { toString: "set_up_paging" } } as JSONObject),
    ).toEqual([]);
  });
});
