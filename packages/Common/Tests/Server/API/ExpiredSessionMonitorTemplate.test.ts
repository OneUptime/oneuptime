import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import MonitorTemplateAPI from "../../../Server/API/MonitorTemplateAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import MonitorTemplateService from "../../../Server/Services/MonitorTemplateService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";

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
    sendEntityArrayResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

/*
 * The monitor-template actions (sync to all linked monitors, sync to one,
 * link, unlink) sit on the template's own page, where an editor may leave a
 * tab open long past the access-token lifetime. The access-token cookie
 * expires with the JWT inside it, so the next click arrives with no
 * credentials; getUserMiddleware passes it on as Public with the page's
 * tenantid header, and the service's own permission check used to answer
 * "You do not have permissions to ..." (422). The browser client refreshes
 * the session and replays only on a 401, so the editor saw an error instead.
 *
 * Each route goes through CommonAPI.assertTenantScoped, which now asks for
 * credentials first. The routes are automatable, so a project API key - a
 * credential with no user - is still admitted to the service, whose
 * permission check decides what the key may do.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const TEMPLATE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

type ServiceMethod =
  | "syncLinkedMonitors"
  | "syncToMonitor"
  | "linkMonitor"
  | "unlinkMonitor";

type TemplateRoute = {
  uri: string;
  params: Dictionary<string>;
  serviceMethod: ServiceMethod;
};

const TEMPLATE_ROUTES: Array<TemplateRoute> = [
  {
    uri: "/monitor-template/:monitorTemplateId/sync-to-linked-monitors",
    params: { monitorTemplateId: TEMPLATE_ID.toString() },
    serviceMethod: "syncLinkedMonitors",
  },
  {
    uri: "/monitor-template/:monitorTemplateId/sync-to-monitor/:monitorId",
    params: {
      monitorTemplateId: TEMPLATE_ID.toString(),
      monitorId: MONITOR_ID.toString(),
    },
    serviceMethod: "syncToMonitor",
  },
  {
    uri: "/monitor-template/:monitorTemplateId/link-monitor/:monitorId",
    params: {
      monitorTemplateId: TEMPLATE_ID.toString(),
      monitorId: MONITOR_ID.toString(),
    },
    serviceMethod: "linkMonitor",
  },
  {
    uri: "/monitor-template/:monitorTemplateId/unlink-monitor/:monitorId",
    params: {
      monitorTemplateId: TEMPLATE_ID.toString(),
      monitorId: MONITOR_ID.toString(),
    },
    serviceMethod: "unlinkMonitor",
  },
];

function withProps(props: DatabaseCommonInteractionProps): void {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(props);
}

type RouteCall = {
  thrown: unknown;
  nextCallCount: number;
};

async function callRoute(route: TemplateRoute): Promise<RouteCall> {
  const req: ExpressRequest = {
    params: route.params,
    query: {},
    body: {},
    headers: {},
  } as unknown as ExpressRequest;

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("post", route.uri)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  return {
    thrown: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
  };
}

let serviceSpies: Record<ServiceMethod, jest.SpyInstance>;

beforeAll(() => {
  new MonitorTemplateAPI();
});

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();

  serviceSpies = {
    syncLinkedMonitors: jest
      .spyOn(MonitorTemplateService, "syncLinkedMonitors")
      .mockResolvedValue({} as never),
    syncToMonitor: jest
      .spyOn(MonitorTemplateService, "syncToMonitor")
      .mockResolvedValue(undefined as never),
    linkMonitor: jest
      .spyOn(MonitorTemplateService, "linkMonitor")
      .mockResolvedValue(undefined as never),
    unlinkMonitor: jest
      .spyOn(MonitorTemplateService, "unlinkMonitor")
      .mockResolvedValue(undefined as never),
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

function expectNothingChanged(): void {
  for (const method of Object.keys(serviceSpies) as Array<ServiceMethod>) {
    expect({ [method]: serviceSpies[method].mock.calls.length }).toEqual({
      [method]: 0,
    });
  }

  expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
}

function expectAuthenticationRequired(call: RouteCall): void {
  expect(call.nextCallCount).toBe(1);
  expect(call.thrown).toBeInstanceOf(NotAuthenticatedException);
  expect(call.thrown).not.toBeInstanceOf(NotAuthorizedException);
  expect(call.thrown).not.toBeInstanceOf(BadDataException);
  expect((call.thrown as NotAuthenticatedException).code).toBe(
    ExceptionCode.NotAuthenticatedException,
  );
  expect((call.thrown as NotAuthenticatedException).message).toBe(
    CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE,
  );
}

describe("the table covers every custom monitor-template action", () => {
  test("every POST /monitor-template/:monitorTemplateId/* route is in the table", () => {
    const registered: Array<string> = mockRouter.routes
      .filter((route: { method: string; uri: string }) => {
        return (
          route.method === "POST" &&
          route.uri.startsWith("/monitor-template/:monitorTemplateId/")
        );
      })
      .map((route: { uri: string }) => {
        return route.uri;
      })
      .sort();

    const covered: Array<string> = TEMPLATE_ROUTES.map(
      (route: TemplateRoute) => {
        return route.uri;
      },
    ).sort();

    expect(registered).toEqual(covered);
  });
});

describe.each(TEMPLATE_ROUTES)(
  "POST $uri with an expired session",
  (route: TemplateRoute) => {
    test("is mounted behind getUserMiddleware only, so the handler is the gate", () => {
      expect(mockRouter.match("post", route.uri).middlewares).toEqual([
        UserMiddleware.getUserMiddleware,
      ]);
    });

    test("answers a caller with no credentials (only a tenantid header) with 401 and changes nothing", async () => {
      withProps({ tenantId: PROJECT_ID, userType: UserType.Public });

      const call: RouteCall = await callRoute(route);

      expectAuthenticationRequired(call);
      expectNothingChanged();
    });

    test("answers a caller with no credentials and no tenantid header with 401, not the missing-project 400", async () => {
      withProps({ userType: UserType.Public });

      const call: RouteCall = await callRoute(route);

      expectAuthenticationRequired(call);
      expectNothingChanged();
    });

    test("answers a caller getUserMiddleware left unclassified with 401", async () => {
      withProps({ tenantId: PROJECT_ID });

      const call: RouteCall = await callRoute(route);

      expectAuthenticationRequired(call);
      expectNothingChanged();
    });

    test("admits a project API key to the service, which applies the key's own permissions", async () => {
      const props: DatabaseCommonInteractionProps = {
        tenantId: PROJECT_ID,
        userType: UserType.API,
      };
      withProps(props);

      const call: RouteCall = await callRoute(route);

      expect(call.nextCallCount).toBe(0);
      expect(serviceSpies[route.serviceMethod]).toHaveBeenCalledTimes(1);
      expect(serviceSpies[route.serviceMethod]).toHaveBeenCalledWith(
        expect.objectContaining({ props: props }),
      );
    });

    test("a project API key without a tenant is scoped out with 400, not treated as anonymous", async () => {
      withProps({ userType: UserType.API });

      const call: RouteCall = await callRoute(route);

      expect(call.thrown).toBeInstanceOf(BadDataException);
      expect(call.thrown).not.toBeInstanceOf(NotAuthenticatedException);
      expectNothingChanged();
    });

    test("admits a signed-in user as before", async () => {
      withProps({
        tenantId: PROJECT_ID,
        userType: UserType.User,
        userId: ObjectID.generate(),
      });

      const call: RouteCall = await callRoute(route);

      expect(call.nextCallCount).toBe(0);
      expect(serviceSpies[route.serviceMethod]).toHaveBeenCalledTimes(1);
    });

    /*
     * An authenticated caller the service refuses keeps that refusal: the
     * 401 is only for a caller with no credentials at all.
     */
    test("a signed-in user the service refuses still gets the service's 422", async () => {
      withProps({
        tenantId: PROJECT_ID,
        userType: UserType.User,
        userId: ObjectID.generate(),
      });
      serviceSpies[route.serviceMethod].mockRejectedValue(
        new NotAuthorizedException("You do not have permission to do this."),
      );

      const call: RouteCall = await callRoute(route);

      expect(call.thrown).toBeInstanceOf(NotAuthorizedException);
      expect((call.thrown as NotAuthorizedException).code).toBe(
        ExceptionCode.NotAuthorizedException,
      );
    });
  },
);
