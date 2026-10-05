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
 * The order-ssl route of dashboard custom domains - the Custom Domains
 * page's Order Free SSL - held to what the status page route was held to:
 *
 *   - it never orders for a domain served with an uploaded certificate (the
 *     sweeps never do either);
 *   - it orders through orderCertIfMissing: the name's lock and a look at the
 *     certificate table under it, so a click and a sweep never order one
 *     name twice;
 *   - it orders at most once per domain per 15-minute window, and a click
 *     within it gets the last order's error: an order that fails leaves the
 *     domain unordered, so every click on a failing domain used to place
 *     another order against the account the whole installation shares;
 *   - nothing ordered is never reported as a success;
 *   - ordering is a change, so it takes what editing the domain takes
 *     (CustomDomainRoutes.getChangeRefusal; the permission matrix is
 *     CustomDomainChangePermission.test.ts).
 */

const mockCNameRecord: string = "dashboards.example.com";

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

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
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

import DashboardDomainAPI from "../../../Server/API/DashboardDomainAPI";
import DashboardDomainService from "../../../Server/Services/DashboardDomainService";
import CommonAPI from "../../../Server/API/CommonAPI";
import Response from "../../../Server/Utils/Response";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import CertificateOrder, {
  CertificateOrderOutcome,
} from "../../../Server/Utils/Greenlock/CertificateOrder";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { DOMAIN_NOT_CHANGEABLE_MESSAGE } from "../../../Server/API/CustomDomainRoutes";
import { customDomainCaller } from "./CustomDomainCallers";

type MockedFn = ReturnType<typeof jest.fn>;

const sendEmptySuccessResponseMock: MockedFn =
  Response.sendEmptySuccessResponse as unknown as MockedFn;
const sendErrorResponseMock: MockedFn =
  Response.sendErrorResponse as unknown as MockedFn;

const ORDER_ROUTE: string = "/dashboard-domain/order-ssl/:id";

// Somebody who may read and edit the project's dashboard domains.
const callerProps: DatabaseCommonInteractionProps = customDomainCaller({
  permissions: [Permission.ReadDashboardDomain, Permission.EditDashboardDomain],
});

let domainId: ObjectID;

type DomainRow = {
  _id: string;
  id: ObjectID;
  fullDomain: string;
  cnameVerificationToken: string;
  isCnameVerified: boolean;
  isSslProvisioned: boolean;
  isCustomCertificate: boolean;
};

function makeDomain(extra: Partial<DomainRow> = {}): DomainRow {
  return {
    _id: domainId.toString(),
    id: domainId,
    fullDomain: "dash.acme.com",
    cnameVerificationToken: "token",
    isCnameVerified: true,
    isSslProvisioned: false,
    isCustomCertificate: false,
    ...extra,
  };
}

type Spies = {
  findOneBy: MockedFn;
  orderCertIfMissing: MockedFn;
  orderCert: MockedFn;
  claim: MockedFn;
  recordFailure: MockedFn;
};

function setUp(data: {
  canSee?: boolean;
  domain?: DomainRow;
  order?: () => Promise<CertificateOrderOutcome>;
  claim?: { mayOrder: boolean; lastError?: string };
}): Spies {
  return {
    /*
     * The one lookup the route makes: the domain, read on the query the
     * update check narrowed to the caller's scope - nothing when the domain
     * is outside it.
     */
    findOneBy: jest
      .spyOn(DashboardDomainService, "findOneBy")
      .mockResolvedValue(
        (data.canSee === false ? null : data.domain || makeDomain()) as never,
      ) as unknown as MockedFn,
    orderCertIfMissing: jest
      .spyOn(DashboardDomainService, "orderCertIfMissing")
      .mockImplementation(
        (data.order ||
          (async (): Promise<CertificateOrderOutcome> => {
            return CertificateOrderOutcome.Ordered;
          })) as never,
      ) as unknown as MockedFn,
    // The order without the first-order checks: nothing here may call it.
    orderCert: jest
      .spyOn(DashboardDomainService, "orderCert")
      .mockResolvedValue(
        CertificateOrderOutcome.Ordered as never,
      ) as unknown as MockedFn,
    claim: jest
      .spyOn(CertificateOrder, "claimOnDemandOrder")
      .mockResolvedValue(
        data.claim || { mayOrder: true },
      ) as unknown as MockedFn,
    recordFailure: jest
      .spyOn(CertificateOrder, "recordOnDemandOrderFailure")
      .mockResolvedValue(undefined) as unknown as MockedFn,
  };
}

async function callRoute(): Promise<{ next: MockedFn }> {
  const req: ExpressRequest = {
    params: { id: domainId.toString() },
    query: {},
    body: {},
    headers: {},
  } as unknown as ExpressRequest;

  const next: MockedFn = jest.fn();

  await mockRouter
    .match("GET", ORDER_ROUTE)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  return { next };
}

function refusal(): Error {
  expect(sendErrorResponseMock).toHaveBeenCalledTimes(1);
  return sendErrorResponseMock.mock.calls[0]![2] as unknown as Error;
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new DashboardDomainAPI();
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

describe("dashboard order-ssl", () => {
  test("sits behind the user auth middleware", () => {
    expect(mockRouter.match("GET", ORDER_ROUTE).middlewares).toContain(
      UserMiddleware.getUserMiddleware,
    );
  });

  test("looks for the domain inside the caller's update scope, and a domain outside it orders nothing", async () => {
    const spies: Spies = setUp({ canSee: false });

    await callRoute();

    // One lookup: the domain, as root, on the query the update check narrowed.
    expect(spies.findOneBy).toHaveBeenCalledTimes(1);

    const lookup: {
      query: Record<string, unknown>;
      props: Record<string, unknown>;
    } = spies.findOneBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      props: Record<string, unknown>;
    };

    expect(lookup.query["_id"]).toBe(domainId.toString());
    expect(JSON.stringify(lookup.query["projectId"])).toContain(
      callerProps.tenantId!.toString(),
    );
    expect(lookup.props).toEqual({ isRoot: true });
    expect(spies.claim).not.toHaveBeenCalled();
    expect(spies.orderCertIfMissing).not.toHaveBeenCalled();

    const error: Error = sendErrorResponseMock.mock
      .calls[0]![2] as unknown as Error;

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(DOMAIN_NOT_CHANGEABLE_MESSAGE);
  });

  test("orders through orderCertIfMissing, on demand, so a click and a sweep never order one name twice", async () => {
    const spies: Spies = setUp({});

    await callRoute();

    expect(spies.claim).toHaveBeenCalledWith("dash.acme.com");
    expect(spies.orderCertIfMissing).toHaveBeenCalledTimes(1);
    expect(spies.orderCertIfMissing.mock.calls[0]![1]).toEqual({
      onDemand: true,
    });
    expect(spies.orderCert).not.toHaveBeenCalled();
    expect(sendEmptySuccessResponseMock).toHaveBeenCalledTimes(1);
  });

  test("reads whether the domain serves an uploaded certificate, and whose on-demand orders it counts against", async () => {
    const spies: Spies = setUp({});

    await callRoute();

    const select: Record<string, unknown> = (
      spies.findOneBy.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;

    expect(select["isCustomCertificate"]).toBe(true);
    expect(select["projectId"]).toBe(true);
  });

  test("refuses a domain served with an uploaded certificate, and orders nothing", async () => {
    const spies: Spies = setUp({
      domain: makeDomain({ isCustomCertificate: true }),
    });

    await callRoute();

    expect(spies.claim).not.toHaveBeenCalled();
    expect(spies.orderCertIfMissing).not.toHaveBeenCalled();
    expect(refusal().message).toContain("uses a certificate you uploaded");
  });

  test("still refuses a domain whose CNAME is not verified, before any order", async () => {
    const spies: Spies = setUp({
      domain: makeDomain({ isCnameVerified: false }),
    });

    await callRoute();

    expect(spies.orderCertIfMissing).not.toHaveBeenCalled();
    expect(refusal()).toBeInstanceOf(BadDataException);
  });

  test("within the window of the last order, it refuses with that order's error and orders nothing", async () => {
    const spies: Spies = setUp({
      claim: {
        mayOrder: false,
        lastError: "Unable to order certificate for dash.acme.com.",
      },
    });

    await callRoute();

    expect(spies.orderCertIfMissing).not.toHaveBeenCalled();

    const error: Error = refusal();

    expect(error).toBeInstanceOf(TooManyRequestsException);
    expect(error.message).toContain("less than 15 minutes ago");
    expect(error.message).toContain(
      "Unable to order certificate for dash.acme.com.",
    );
  });

  test("an order that fails is remembered for the window, and reported", async () => {
    const spies: Spies = setUp({
      order: async (): Promise<CertificateOrderOutcome> => {
        throw new BadDataException("Unable to order certificate.");
      },
    });

    const { next } = await callRoute();

    expect(spies.recordFailure).toHaveBeenCalledWith(
      "dash.acme.com",
      "Unable to order certificate.",
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(sendEmptySuccessResponseMock).not.toHaveBeenCalled();
  });

  test.each([
    [CertificateOrderOutcome.NotOrderedNow, "being ordered right now"],
    [CertificateOrderOutcome.LimitReached, "used up"],
  ])(
    "nothing ordered (%s) is refused with a 429, not reported as a success, and gives the window back",
    async (outcome: CertificateOrderOutcome, message: string) => {
      setUp({
        order: async (): Promise<CertificateOrderOutcome> => {
          return outcome;
        },
      });

      const release: MockedFn = jest
        .spyOn(CertificateOrder, "releaseOnDemandOrder")
        .mockResolvedValue(undefined) as unknown as MockedFn;

      await callRoute();

      expect(release).toHaveBeenCalledWith("dash.acme.com");

      expect(sendEmptySuccessResponseMock).not.toHaveBeenCalled();

      const error: Error = refusal();

      expect(error).toBeInstanceOf(TooManyRequestsException);
      expect(error.message).toContain(message);
    },
  );
});
