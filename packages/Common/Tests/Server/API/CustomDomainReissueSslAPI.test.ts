import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The reissue-ssl route on both custom-domain APIs.
 *
 * The service owns the throttle; what this file protects is the layer above
 * it, which is where the two mistakes that matter live:
 *
 *   - The route must be behind UserMiddleware and must ask, with the
 *     CALLER'S props, what an update of the domain asks: reissuing replaces
 *     the domain's certificate, a change, so it takes the domain's edit
 *     permissions and the domain must be inside the caller's update scope
 *     (CustomDomainRoutes.getChangeRefusal; the permission matrix is
 *     CustomDomainChangePermission.test.ts). Every other read on this route
 *     runs as root, so that scoped query is the whole tenancy boundary.
 *   - A caller who is refused must never reach the CA. Anything that spends
 *     the shared Let's Encrypt allowance before the access check is a way for
 *     a stranger to spend it.
 */

const mockCNameRecord: string = "oneuptime.example.com";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

/*
 * Custom domains ON. The routes read these at import time, so the value is
 * fixed for the whole file; the "custom domains are switched off" case needs
 * a fresh module graph and gets one at the bottom of this file.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    StatusPageCNameRecord: mockCNameRecord,
    DashboardCNameRecord: mockCNameRecord,
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import StatusPageDomainAPI from "../../../Server/API/StatusPageDomainAPI";
import DashboardDomainAPI from "../../../Server/API/DashboardDomainAPI";
import StatusPageDomainService from "../../../Server/Services/StatusPageDomainService";
import DashboardDomainService from "../../../Server/Services/DashboardDomainService";
import CommonAPI from "../../../Server/API/CommonAPI";
import Response from "../../../Server/Utils/Response";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { DOMAIN_NOT_CHANGEABLE_MESSAGE } from "../../../Server/API/CustomDomainRoutes";
import { customDomainCaller } from "./CustomDomainCallers";

type MockedFn = ReturnType<typeof jest.fn>;

type ResponseModule = {
  sendErrorResponse: MockedFn;
  sendEmptySuccessResponse: MockedFn;
};

const sendEmptySuccessResponseMock: MockedFn =
  Response.sendEmptySuccessResponse as unknown as MockedFn;
const sendErrorResponseMock: MockedFn =
  Response.sendErrorResponse as unknown as MockedFn;

type Surface = {
  name: string;
  buildApi: () => void;
  route: string;
  service: typeof StatusPageDomainService | typeof DashboardDomainService;
  // Module path re-required by the "custom domains switched off" case below.
  apiModulePath: string;
  // What somebody who may read and edit this kind of domain holds.
  editorPermissions: Array<Permission>;
};

const surfaces: Array<[string, Surface]> = [
  [
    "StatusPageDomainAPI",
    {
      name: "StatusPageDomainAPI",
      buildApi: (): void => {
        new StatusPageDomainAPI();
      },
      route: "/status-page-domain/reissue-ssl/:id",
      service: StatusPageDomainService,
      apiModulePath: "../../../Server/API/StatusPageDomainAPI",
      // The domains are read through their status page: reading it is asked too.
      editorPermissions: [
        Permission.ReadProjectStatusPage,
        Permission.ReadStatusPageDomain,
        Permission.EditStatusPageDomain,
      ],
    },
  ],
  [
    "DashboardDomainAPI",
    {
      name: "DashboardDomainAPI",
      buildApi: (): void => {
        new DashboardDomainAPI();
      },
      route: "/dashboard-domain/reissue-ssl/:id",
      service: DashboardDomainService,
      apiModulePath: "../../../Server/API/DashboardDomainAPI",
      // The domains are read through their dashboard: reading it is asked too.
      editorPermissions: [
        Permission.ReadDashboard,
        Permission.ReadDashboardDomain,
        Permission.EditDashboardDomain,
      ],
    },
  ],
];

describe.each(surfaces)("%s reissue-ssl", (_name: string, surface: Surface) => {
  const callerProps: DatabaseCommonInteractionProps = customDomainCaller({
    permissions: surface.editorPermissions,
  });

  let domainId: ObjectID;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    surface.buildApi();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    domainId = ObjectID.generate();

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(callerProps);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The one lookup the route makes: the domain, read as root on the query
   * the update check narrowed to the caller's scope.
   */
  const inScope: () => MockedFn = (): MockedFn => {
    return jest.spyOn(surface.service, "findOneBy").mockResolvedValue({
      _id: domainId.toString(),
      id: domainId,
    } as never) as unknown as MockedFn;
  };

  // The same lookup for a domain outside the caller's scope: nothing.
  const outOfScope: () => MockedFn = (): MockedFn => {
    return jest
      .spyOn(surface.service, "findOneBy")
      .mockResolvedValue(null as never) as unknown as MockedFn;
  };

  type CallRouteResult = {
    next: MockedFn;
  };

  type CallRouteFunction = (data?: { id?: string }) => Promise<CallRouteResult>;

  const callRoute: CallRouteFunction = async (
    data: {
      id?: string;
    } = {},
  ): Promise<CallRouteResult> => {
    const req: ExpressRequest = {
      params: { id: data.id ?? domainId.toString() },
      query: {},
      body: {},
      headers: {},
    } as unknown as ExpressRequest;

    const res: ExpressResponse = {} as ExpressResponse;
    const next: MockedFn = jest.fn();

    await mockRouter
      .match("GET", surface.route)
      .handlerFunction(req, res, next as unknown as NextFunction);

    return { next };
  };

  describe("wiring", () => {
    test("the route exists", () => {
      expect(() => {
        return mockRouter.match("GET", surface.route);
      }).not.toThrow();
    });

    /*
     * Without the auth middleware the handler still runs, and
     * getDatabaseCommonInteractionProps would resolve for an unauthenticated
     * caller - so the access check below would be checking nothing.
     */
    test("it sits behind the user auth middleware", () => {
      expect(mockRouter.match("GET", surface.route).middlewares).toContain(
        UserMiddleware.getUserMiddleware,
      );
    });
  });

  describe("access control", () => {
    test("looks for the domain inside the caller's update scope", async () => {
      const findSpy: MockedFn = inScope();

      jest.spyOn(surface.service, "reissueCert").mockResolvedValue(undefined);

      await callRoute();

      expect(findSpy).toHaveBeenCalledTimes(1);

      const lookup: {
        query: Record<string, unknown>;
        props: Record<string, unknown>;
      } = findSpy.mock.calls[0]![0] as {
        query: Record<string, unknown>;
        props: Record<string, unknown>;
      };

      expect(lookup.query["_id"]).toBe(domainId.toString());

      /*
       * The whole tenancy boundary: the lookup runs as root on a query the
       * caller's own props narrowed to their project, as an update of the
       * domain would be narrowed.
       */
      expect(JSON.stringify(lookup.query["projectId"])).toContain(
        callerProps.tenantId!.toString(),
      );
      expect(lookup.props).toEqual({ isRoot: true });
    });

    test("a domain the caller cannot see is refused and never reaches the CA", async () => {
      outOfScope();

      const reissueSpy: MockedFn = jest
        .spyOn(surface.service, "reissueCert")
        .mockResolvedValue(undefined) as unknown as MockedFn;

      await callRoute();

      expect(reissueSpy).not.toHaveBeenCalled();
      expect(sendErrorResponseMock).toHaveBeenCalled();
      expect(sendEmptySuccessResponseMock).not.toHaveBeenCalled();
    });

    test("the refusal does not say whether the domain exists", async () => {
      outOfScope();
      jest.spyOn(surface.service, "reissueCert").mockResolvedValue(undefined);

      await callRoute();

      const error: Error = sendErrorResponseMock.mock
        .calls[0]![2] as unknown as Error;

      expect(error.message).toBe(DOMAIN_NOT_CHANGEABLE_MESSAGE);
    });
  });

  describe("the happy path", () => {
    test("reissues the domain named in the url and answers success", async () => {
      inScope();

      const reissueSpy: MockedFn = jest
        .spyOn(surface.service, "reissueCert")
        .mockResolvedValue(undefined) as unknown as MockedFn;

      await callRoute();

      expect(reissueSpy).toHaveBeenCalledTimes(1);
      expect((reissueSpy.mock.calls[0]![0] as ObjectID).toString()).toBe(
        domainId.toString(),
      );

      expect(sendEmptySuccessResponseMock).toHaveBeenCalled();
      expect(sendErrorResponseMock).not.toHaveBeenCalled();
    });
  });

  describe("refusals from the service", () => {
    /*
     * The cooldown is a 429 raised inside the service. It has to reach the
     * error handler intact: the message is the countdown the dashboard shows
     * the customer, so swallowing it or replacing it with a generic 500 turns
     * "try again in 3 hours" into "Server Error. Please try again".
     */
    test("a cooldown refusal is passed on with its message", async () => {
      inScope();

      const cooldown: TooManyRequestsException = new TooManyRequestsException(
        "Please try again in 3 hours.",
      );

      jest
        .spyOn(surface.service, "reissueCert")
        .mockRejectedValue(cooldown as never);

      const { next } = await callRoute();

      expect(next).toHaveBeenCalledWith(cooldown);
      expect(sendEmptySuccessResponseMock).not.toHaveBeenCalled();
    });

    test("a failed order is not reported to the customer as a success", async () => {
      inScope();

      jest
        .spyOn(surface.service, "reissueCert")
        .mockRejectedValue(new Error("CA refused the order") as never);

      const { next } = await callRoute();

      expect(next).toHaveBeenCalled();
      expect(sendEmptySuccessResponseMock).not.toHaveBeenCalled();
    });
  });
});

/*
 * Custom domains switched off — a self-hosted installation that never set
 * STATUS_PAGE_CNAME_RECORD / DASHBOARD_CNAME_RECORD.
 *
 * The routes read those values at import time, so this needs its own module
 * graph rather than a value flipped at runtime: re-mocking and re-requiring is
 * the only way to observe the branch the deployed binary would actually take.
 * Without the guard the route would happily order a certificate for a domain
 * that cannot possibly point at this cluster, spending a validation attempt
 * against the shared Let's Encrypt account to do it.
 */
describe("reissue-ssl with custom domains switched off", () => {
  type DisabledSurface = {
    label: string;
    apiModulePath: string;
    serviceModulePath: string;
    route: string;
  };

  const disabledSurfaces: Array<[string, DisabledSurface]> = [
    [
      "StatusPageDomainAPI",
      {
        label: "StatusPageDomainAPI",
        apiModulePath: "../../../Server/API/StatusPageDomainAPI",
        serviceModulePath: "../../../Server/Services/StatusPageDomainService",
        route: "/status-page-domain/reissue-ssl/:id",
      },
    ],
    [
      "DashboardDomainAPI",
      {
        label: "DashboardDomainAPI",
        apiModulePath: "../../../Server/API/DashboardDomainAPI",
        serviceModulePath: "../../../Server/Services/DashboardDomainService",
        route: "/dashboard-domain/reissue-ssl/:id",
      },
    ],
  ];

  test.each(disabledSurfaces)(
    "%s refuses without touching the CA",
    async (_label: string, disabled: DisabledSurface) => {
      jest.resetModules();

      jest.doMock("../../../Server/EnvironmentConfig", () => {
        const actual: Record<string, unknown> = jest.requireActual(
          "../../../Server/EnvironmentConfig",
        ) as Record<string, unknown>;

        return {
          ...actual,
          __esModule: true,
          StatusPageCNameRecord: "",
          DashboardCNameRecord: "",
        };
      });

      /*
       * resetModules gives every module below a fresh instance, so the
       * response spy and the service must be re-read from the same fresh
       * graph the freshly built API is wired to.
       */
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const FreshAPI: new () => unknown = require(
        disabled.apiModulePath,
      ).default;
      type FreshService = { reissueCert: unknown; findOneBy: unknown };
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const freshService: FreshService = require(
        disabled.serviceModulePath,
      ).default;
      const responseModulePath: string = "../../../Server/Utils/Response";
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const freshResponse: ResponseModule = require(responseModulePath).default;

      mockRouter.routes.length = 0;
      new FreshAPI();

      const reissueSpy: MockedFn = jest
        .spyOn(freshService as never, "reissueCert")
        .mockResolvedValue(undefined as never) as unknown as MockedFn;

      const findSpy: MockedFn = jest
        .spyOn(freshService as never, "findOneBy")
        .mockResolvedValue({ _id: "row" } as never) as unknown as MockedFn;

      freshResponse.sendErrorResponse.mockClear();
      freshResponse.sendEmptySuccessResponse.mockClear();

      const req: ExpressRequest = {
        params: { id: ObjectID.generate().toString() },
        query: {},
        body: {},
        headers: {},
      } as unknown as ExpressRequest;

      await mockRouter
        .match("GET", disabled.route)
        .handlerFunction(
          req,
          {} as ExpressResponse,
          jest.fn() as unknown as NextFunction,
        );

      expect(freshResponse.sendErrorResponse).toHaveBeenCalled();
      expect(freshResponse.sendEmptySuccessResponse).not.toHaveBeenCalled();
      expect(reissueSpy).not.toHaveBeenCalled();

      /*
       * Refused before the row is even looked up — the switch is off for the
       * whole installation, so there is nothing about this domain to check.
       */
      expect(findSpy).not.toHaveBeenCalled();

      jest.restoreAllMocks();
      jest.dontMock("../../../Server/EnvironmentConfig");
      jest.resetModules();
    },
  );
});
