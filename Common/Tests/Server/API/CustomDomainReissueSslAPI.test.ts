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
 *   - The route must be behind UserMiddleware and must check access with the
 *     CALLER'S props, not with isRoot. Every other read on this route runs as
 *     root (it has to - the row carries fields the caller may not read), so
 *     the one scoped query is the whole tenancy boundary. Lose it and the
 *     route reissues certificates for any domain id in the fleet.
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
import PositiveNumber from "../../../Types/PositiveNumber";

type MockedFn = ReturnType<typeof jest.fn>;

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
    },
  ],
];

describe.each(surfaces)("%s reissue-ssl", (_name: string, surface: Surface) => {
  const callerProps: DatabaseCommonInteractionProps = {
    userId: ObjectID.generate(),
    tenantId: ObjectID.generate(),
  } as DatabaseCommonInteractionProps;

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
    test("scopes the existence check to the caller's own props", async () => {
      const countSpy: MockedFn = jest
        .spyOn(surface.service, "countBy")
        .mockResolvedValue(new PositiveNumber(1)) as unknown as MockedFn;

      jest.spyOn(surface.service, "reissueCert").mockResolvedValue(undefined);

      await callRoute();

      expect(countSpy).toHaveBeenCalledTimes(1);

      const countArgs: { query: { _id: string }; props: unknown } = countSpy
        .mock.calls[0]![0] as { query: { _id: string }; props: unknown };

      expect(countArgs.query._id).toBe(domainId.toString());

      /*
       * The whole tenancy boundary. isRoot here would make every domain id in
       * the fleet reissuable by any signed-in user.
       */
      expect(countArgs.props).toBe(callerProps);
      expect((countArgs.props as { isRoot?: boolean }).isRoot).toBeFalsy();
    });

    test("a domain the caller cannot see is refused and never reaches the CA", async () => {
      jest
        .spyOn(surface.service, "countBy")
        .mockResolvedValue(new PositiveNumber(0));

      const reissueSpy: MockedFn = jest
        .spyOn(surface.service, "reissueCert")
        .mockResolvedValue(undefined) as unknown as MockedFn;

      await callRoute();

      expect(reissueSpy).not.toHaveBeenCalled();
      expect(sendErrorResponseMock).toHaveBeenCalled();
      expect(sendEmptySuccessResponseMock).not.toHaveBeenCalled();
    });

    test("the refusal does not say whether the domain exists", async () => {
      jest
        .spyOn(surface.service, "countBy")
        .mockResolvedValue(new PositiveNumber(0));
      jest.spyOn(surface.service, "reissueCert").mockResolvedValue(undefined);

      await callRoute();

      const error: Error = sendErrorResponseMock.mock
        .calls[0]![2] as unknown as Error;

      expect(error.message).toContain("does not exist or user does not have");
    });
  });

  describe("the happy path", () => {
    test("reissues the domain named in the url and answers success", async () => {
      jest
        .spyOn(surface.service, "countBy")
        .mockResolvedValue(new PositiveNumber(1));

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
      jest
        .spyOn(surface.service, "countBy")
        .mockResolvedValue(new PositiveNumber(1));

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
      jest
        .spyOn(surface.service, "countBy")
        .mockResolvedValue(new PositiveNumber(1));

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
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const freshService: { reissueCert: unknown; countBy: unknown } = require(
        disabled.serviceModulePath,
      ).default;
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const freshResponse: {
        sendErrorResponse: MockedFn;
        sendEmptySuccessResponse: MockedFn;
      } = require("../../../Server/Utils/Response").default;

      mockRouter.routes.length = 0;
      new FreshAPI();

      const reissueSpy: MockedFn = jest
        .spyOn(freshService as never, "reissueCert")
        .mockResolvedValue(undefined as never) as unknown as MockedFn;

      const countSpy: MockedFn = jest
        .spyOn(freshService as never, "countBy")
        .mockResolvedValue(
          new PositiveNumber(1) as never,
        ) as unknown as MockedFn;

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
      expect(countSpy).not.toHaveBeenCalled();

      jest.restoreAllMocks();
      jest.dontMock("../../../Server/EnvironmentConfig");
      jest.resetModules();
    },
  );
});
