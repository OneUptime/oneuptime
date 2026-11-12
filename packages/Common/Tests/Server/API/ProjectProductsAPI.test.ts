import { mockRouter } from "./Helpers";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

import CommonAPI from "../../../Server/API/CommonAPI";
import ProjectProductsAPI from "../../../Server/API/ProjectProductsAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ProjectProductsService from "../../../Server/Services/ProjectProductsService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import ProductKey from "../../../Types/Product/ProductKey";
import {
  PROJECT_PRODUCTS_PINS_ROUTE,
  PROJECT_PRODUCTS_ROUTE,
  PROJECT_PRODUCTS_VISIBILITY_ROUTE,
  ProjectProductsAnswer,
  getEmptyProjectProductsAnswer,
} from "../../../Types/Product/ProjectProductsAnswer";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A project's products over HTTP (issue #6814), run through the real
 * handlers and guards with the service answered here: who may read, who may
 * show and hide a product, that pins are the caller's own, and that every
 * route answers with the products as they now stand.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

interface RegisteredRoute {
  method: string;
  uri: string;
  middlewares: Array<RouterFunction>;
  handlerFunction: RouterFunction;
}

function memberProps(
  permissions: Array<Permission>,
  overrides?: Partial<DatabaseCommonInteractionProps>,
): DatabaseCommonInteractionProps {
  const tenant: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
      } as UserPermission;
    }),
  };

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: { [PROJECT_ID.toString()]: tenant },
    ...overrides,
  };
}

function routeFor(method: string, uri: string): RegisteredRoute {
  const route: RegisteredRoute | undefined = (
    mockRouter.routes as unknown as Array<RegisteredRoute>
  ).find((candidate: RegisteredRoute): boolean => {
    return candidate.method === method && candidate.uri === uri;
  });

  if (!route) {
    throw new Error(`No ${method} route for ${uri}`);
  }

  return route;
}

const ANSWER: ProjectProductsAnswer = {
  ...getEmptyProjectProductsAnswer(),
  hidden: [ProductKey.Kubernetes],
  pinned: [ProductKey.Logs],
  canChooseProducts: true,
};

let props: DatabaseCommonInteractionProps;
let getAnswer: jest.SpyInstance;
let setShown: jest.SpyInstance;
let showAll: jest.SpyInstance;
let setPins: jest.SpyInstance;
let sendJson: jest.SpyInstance;

beforeEach(() => {
  props = memberProps([Permission.ProjectOwner]);

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });

  getAnswer = jest
    .spyOn(ProjectProductsService, "getAnswer")
    .mockResolvedValue(ANSWER);
  setShown = jest
    .spyOn(ProjectProductsService, "setProductShown")
    .mockResolvedValue(undefined);
  showAll = jest
    .spyOn(ProjectProductsService, "showEveryProduct")
    .mockResolvedValue(undefined);
  setPins = jest
    .spyOn(ProjectProductsService, "setPinnedProducts")
    .mockResolvedValue([]);
  sendJson = jest
    .spyOn(Response, "sendJsonObjectResponse")
    .mockImplementation((() => {}) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function call(
  method: string,
  uri: string,
  body?: unknown,
): Promise<unknown> {
  const next: jest.Mock = jest.fn();

  await routeFor(method, uri).handlerFunction(
    { query: {}, params: {}, headers: {}, body: body } as never,
    {} as never,
    next as unknown as NextFunction,
  );

  return next.mock.calls[0]?.[0];
}

describe("the routes", () => {
  test("are one bare router: a read and two changes, each behind the user middleware", () => {
    expect(ProjectProductsAPI).toBe(mockRouter);

    expect(routeFor("GET", PROJECT_PRODUCTS_ROUTE).middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
    ]);

    for (const uri of [
      PROJECT_PRODUCTS_VISIBILITY_ROUTE,
      PROJECT_PRODUCTS_PINS_ROUTE,
    ]) {
      expect(routeFor("POST", uri).middlewares).toEqual([
        UserMiddleware.getUserMiddleware,
      ]);
    }
  });
});

describe("GET /project-products", () => {
  test("answers a member with the products for them and their project", async () => {
    props = memberProps([Permission.Viewer]);

    expect(await call("GET", PROJECT_PRODUCTS_ROUTE)).toBeUndefined();

    expect(getAnswer).toHaveBeenCalledTimes(1);
    expect(getAnswer.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      userId: USER_ID,
      props: props,
    });

    const body: JSONObject = sendJson.mock.calls[0]![2] as JSONObject;

    expect(body["hidden"]).toEqual([ProductKey.Kubernetes]);
    expect(body["pinned"]).toEqual([ProductKey.Logs]);
    expect(body["canChooseProducts"]).toBe(true);
  });

  test("an expired session is a 401, so the browser refreshes it and sends again", async () => {
    props = {
      tenantId: PROJECT_ID,
      userType: UserType.Public,
    } as DatabaseCommonInteractionProps;

    expect(await call("GET", PROJECT_PRODUCTS_ROUTE)).toBeInstanceOf(
      NotAuthenticatedException,
    );
    expect(getAnswer).not.toHaveBeenCalled();
  });

  test("somebody who is not a member of the project in the header is refused", async () => {
    props = memberProps([Permission.ProjectOwner], {
      tenantId: OTHER_PROJECT_ID,
    });

    expect(await call("GET", PROJECT_PRODUCTS_ROUTE)).toBeInstanceOf(
      NotAuthorizedException,
    );
    expect(getAnswer).not.toHaveBeenCalled();
  });

  test("without a project there is nothing to answer", async () => {
    props = memberProps([Permission.ProjectOwner], { tenantId: undefined });

    expect(await call("GET", PROJECT_PRODUCTS_ROUTE)).toBeInstanceOf(
      BadDataException,
    );
  });
});

describe("POST /project-products/visibility", () => {
  test("an Owner hides a product, and gets the products that follow", async () => {
    expect(
      await call("POST", PROJECT_PRODUCTS_VISIBILITY_ROUTE, {
        product: "kubernetes",
        isShown: false,
      }),
    ).toBeUndefined();

    expect(setShown).toHaveBeenCalledTimes(1);
    expect(setShown.mock.calls[0]![1]).toEqual({
      product: "kubernetes",
      isShown: false,
    });
    expect(getAnswer).toHaveBeenCalledTimes(1);
    expect(sendJson).toHaveBeenCalledTimes(1);
  });

  test("showAll shows every product", async () => {
    expect(
      await call("POST", PROJECT_PRODUCTS_VISIBILITY_ROUTE, { showAll: true }),
    ).toBeUndefined();

    expect(showAll).toHaveBeenCalledTimes(1);
    expect(setShown).not.toHaveBeenCalled();
  });

  test.each([[Permission.ProjectAdmin], [Permission.EditProject]])(
    "%s may too",
    async (permission: Permission) => {
      props = memberProps([permission]);

      expect(
        await call("POST", PROJECT_PRODUCTS_VISIBILITY_ROUTE, {
          product: "kubernetes",
          isShown: true,
        }),
      ).toBeUndefined();
      expect(setShown).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    [Permission.ProjectMember],
    [Permission.Viewer],
    [Permission.CreateProjectMonitor],
  ])("%s may not", async (permission: Permission) => {
    props = memberProps([permission]);

    expect(
      await call("POST", PROJECT_PRODUCTS_VISIBILITY_ROUTE, {
        product: "kubernetes",
        isShown: false,
      }),
    ).toBeInstanceOf(NotAuthorizedException);
    expect(
      await call("POST", PROJECT_PRODUCTS_VISIBILITY_ROUTE, { showAll: true }),
    ).toBeInstanceOf(NotAuthorizedException);
    expect(setShown).not.toHaveBeenCalled();
    expect(showAll).not.toHaveBeenCalled();
  });

  test("a body that is not an object reaches the service as nothing", async () => {
    await call("POST", PROJECT_PRODUCTS_VISIBILITY_ROUTE, ["kubernetes"]);

    expect(setShown.mock.calls[0]![1]).toEqual({
      product: undefined,
      isShown: undefined,
    });
  });
});

describe("POST /project-products/pins", () => {
  test("any member keeps their own pins", async () => {
    props = memberProps([Permission.Viewer]);

    expect(
      await call("POST", PROJECT_PRODUCTS_PINS_ROUTE, {
        pinned: ["logs", "monitors"],
      }),
    ).toBeUndefined();

    expect(setPins).toHaveBeenCalledTimes(1);
    expect((setPins.mock.calls[0]![0] as { userId: ObjectID }).userId).toEqual(
      USER_ID,
    );
    expect(setPins.mock.calls[0]![1]).toEqual(["logs", "monitors"]);
    expect(sendJson).toHaveBeenCalledTimes(1);
  });

  test("an expired session pins nothing", async () => {
    props = {
      tenantId: PROJECT_ID,
      userType: UserType.Public,
    } as DatabaseCommonInteractionProps;

    expect(
      await call("POST", PROJECT_PRODUCTS_PINS_ROUTE, { pinned: ["logs"] }),
    ).toBeInstanceOf(NotAuthenticatedException);
    expect(setPins).not.toHaveBeenCalled();
  });

  test("the service's refusal is passed on", async () => {
    setPins.mockRejectedValue(new BadDataException("You can pin up to 5."));

    expect(
      await call("POST", PROJECT_PRODUCTS_PINS_ROUTE, { pinned: "logs" }),
    ).toBeInstanceOf(BadDataException);
    expect(sendJson).not.toHaveBeenCalled();
  });
});
