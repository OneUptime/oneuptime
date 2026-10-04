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
 * The verify-cname and certificates routes of dashboard custom domains,
 * held to what the status page routes are held to
 * (StatusPageDomainVerifyCnameAPI.test.ts).
 *
 * verify-cname is the domain's Check now button. It used to verify the
 * record and stop there - answering an empty body - while the free
 * certificate waited for an "Order Free SSL" button or the 15-minute order
 * sweep. Now, once the record is found, it orders the certificate straight
 * away (DashboardDomainService.orderCertOnceCnameIsVerified) and answers
 * with what happens to the certificate next. What this pins:
 *
 *   - the access check still uses the caller's own props, and a refused
 *     caller never reaches the CA;
 *   - a record that is not found orders nothing, and says which record to
 *     look for;
 *   - a record that is found orders through the shared order path - the
 *     name's lock, one on-demand order per domain per window, counted
 *     against the domain's own project (so the route reads projectId), never
 *     for an uploaded certificate - which keeps Check now and the sweeps
 *     from ordering one name twice (CustomDomainCertificateLifecycle.test.ts
 *     runs that end to end, for both kinds);
 *   - an order that fails does not turn a found record into an error;
 *   - Issued only for a certificate that is in the table and has not
 *     expired.
 *
 * The certificates route is what the Custom Domains page's Status column
 * reads: each domain's certificate expiry and last failed order.
 */

let mockCNameRecord: string = "dashboards.example.com";

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
 * A getter defined on the copy, not in an object literal: the compiled
 * spread copies a literal's getter once, as a value.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  const mocked: Record<string, unknown> = {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    __esModule: true,
  };

  Object.defineProperty(mocked, "DashboardCNameRecord", {
    get: (): string => {
      return mockCNameRecord;
    },
  });

  return mocked;
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
import DashboardDomainService, {
  Service as DashboardDomainServiceClass,
} from "../../../Server/Services/DashboardDomainService";
import CommonAPI from "../../../Server/API/CommonAPI";
import Response from "../../../Server/Utils/Response";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import CertificateOrder, {
  CertificateOrderOutcome,
  CustomDomainCertificateState,
} from "../../../Server/Utils/Greenlock/CertificateOrder";
import { CertificateOrderLockHandle } from "../../../Server/Utils/Greenlock/CertificateOrderLock";
import CustomDomainOrders from "../../../Server/Utils/Greenlock/CustomDomainOrders";
import GreenlockUtil from "../../../Server/Utils/Greenlock/Greenlock";
import AcmeCertificate from "../../../Models/DatabaseModels/AcmeCertificate";
import OneUptimeDate from "../../../Types/Date";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { CustomDomainCertificateStatus } from "../../../Types/CustomDomain/CustomDomainVerification";

type MockedFn = ReturnType<typeof jest.fn>;

const sendJsonObjectResponseMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;
const sendEmptySuccessResponseMock: MockedFn =
  Response.sendEmptySuccessResponse as unknown as MockedFn;
const sendErrorResponseMock: MockedFn =
  Response.sendErrorResponse as unknown as MockedFn;

const VERIFY_ROUTE: string = "/dashboard-domain/verify-cname/:id";
const CERTIFICATES_ROUTE: string =
  "/dashboard-domain/certificates/:dashboardId";

type DomainRow = {
  _id: string;
  id: ObjectID;
  fullDomain: string;
  projectId?: ObjectID;
  isCustomCertificate?: boolean;
  isSslOrdered?: boolean;
  isCnameVerified?: boolean;
};

const callerProps: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  tenantId: ObjectID.generate(),
} as DatabaseCommonInteractionProps;

let domainId: ObjectID;

function makeDomain(extra: Partial<DomainRow> = {}): DomainRow {
  return {
    _id: domainId.toString(),
    id: domainId,
    fullDomain: "dash.acme.com",
    isCustomCertificate: false,
    isSslOrdered: false,
    ...extra,
  };
}

type Spies = {
  countBy: MockedFn;
  findOneBy: MockedFn;
  isCnameValid: MockedFn;
  orderCertIfMissing: MockedFn;
  orderCert: MockedFn;
  // The one write that records a domain with a good certificate as ordered.
  updateBy: MockedFn;
};

/*
 * The certificate table, for the name Check now asks about: the days left on
 * its certificate, negative when it has expired, or none.
 */
function withCertificate(expiresInDays: number | null): MockedFn {
  return jest
    .spyOn(GreenlockUtil, "findCertificatesByDomain")
    .mockImplementation((async (
      domains: Array<string>,
    ): Promise<Map<string, AcmeCertificate>> => {
      const found: Map<string, AcmeCertificate> = new Map();

      if (expiresInDays !== null) {
        for (const domain of domains) {
          found.set(domain, {
            domain: domain,
            expiresAt: OneUptimeDate.addRemoveDays(
              OneUptimeDate.getCurrentDate(),
              expiresInDays,
            ),
          } as AcmeCertificate);
        }
      }

      return found;
    }) as never) as unknown as MockedFn;
}

function setUp(data: {
  canSee?: boolean;
  domain?: DomainRow | null;
  cnameValid?: boolean;
  order?: () => Promise<CertificateOrderOutcome>;
  certificateExpiresInDays?: number | null;
}): Spies {
  withCertificate(
    data.certificateExpiresInDays === undefined
      ? null
      : data.certificateExpiresInDays,
  );

  return {
    updateBy: jest
      .spyOn(DashboardDomainService, "updateBy")
      .mockResolvedValue(1 as never) as unknown as MockedFn,
    countBy: jest
      .spyOn(DashboardDomainService, "countBy")
      .mockResolvedValue(
        new PositiveNumber(data.canSee === false ? 0 : 1),
      ) as unknown as MockedFn,
    findOneBy: jest
      .spyOn(DashboardDomainService, "findOneBy")
      .mockResolvedValue(
        (data.domain === undefined ? makeDomain() : data.domain) as never,
      ) as unknown as MockedFn,
    isCnameValid: jest
      .spyOn(DashboardDomainService, "isCnameValid")
      .mockResolvedValue(data.cnameValid ?? true) as unknown as MockedFn,
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
  };
}

async function callRoute(
  route: string,
  params?: Record<string, string>,
): Promise<{ next: MockedFn }> {
  const req: ExpressRequest = {
    params: params || { id: domainId.toString() },
    query: {},
    body: {},
    headers: {},
  } as unknown as ExpressRequest;

  const next: MockedFn = jest.fn();

  await mockRouter
    .match("GET", route)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  return { next };
}

function answered(): Record<string, unknown> {
  expect(sendJsonObjectResponseMock).toHaveBeenCalledTimes(1);
  return sendJsonObjectResponseMock.mock.calls[0]![2] as Record<
    string,
    unknown
  >;
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
  mockCNameRecord = "dashboards.example.com";
  domainId = ObjectID.generate();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(callerProps);

  // This window's on-demand order is free; the window is tested below.
  jest
    .spyOn(CertificateOrder, "claimOnDemandOrder")
    .mockResolvedValue({ mayOrder: true });
  jest
    .spyOn(CertificateOrder, "recordOnDemandOrderFailure")
    .mockResolvedValue(undefined);
  jest
    .spyOn(CertificateOrder, "releaseOnDemandOrder")
    .mockResolvedValue(undefined);

  // No certificate yet, unless a test says otherwise.
  withCertificate(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("dashboard verify-cname (Check now)", () => {
  test("sits behind the user auth middleware", () => {
    expect(mockRouter.match("GET", VERIFY_ROUTE).middlewares).toContain(
      UserMiddleware.getUserMiddleware,
    );
  });

  /*
   * Review: a malformed id reached the uuid column and came back as a
   * database error, a 500. It is the caller's mistake: a 400.
   */
  test("a malformed id is refused as bad data, before anything is read", async () => {
    const spies: Spies = setUp({});

    await callRoute(VERIFY_ROUTE, { id: "not-a-uuid" });

    expect(spies.countBy).not.toHaveBeenCalled();
    expect(spies.findOneBy).not.toHaveBeenCalled();
    expect(spies.orderCertIfMissing).not.toHaveBeenCalled();

    const error: Error = sendErrorResponseMock.mock
      .calls[0]![2] as unknown as Error;

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe("The domain ID is not valid.");
  });

  test("checks access with the caller's own props, and a domain they cannot see orders nothing", async () => {
    const spies: Spies = setUp({ canSee: false });

    await callRoute(VERIFY_ROUTE);

    const countArgs: { query: { _id: string }; props: unknown } = spies.countBy
      .mock.calls[0]![0] as { query: { _id: string }; props: unknown };

    expect(countArgs.query._id).toBe(domainId.toString());
    expect(countArgs.props).toBe(callerProps);
    expect(spies.isCnameValid).not.toHaveBeenCalled();
    expect(spies.orderCertIfMissing).not.toHaveBeenCalled();
    expect(sendErrorResponseMock).toHaveBeenCalled();
  });

  test("without DASHBOARD_CNAME_RECORD it is refused, before anything is read or ordered", async () => {
    mockCNameRecord = "";
    const spies: Spies = setUp({});

    await callRoute(VERIFY_ROUTE);

    expect(spies.countBy).not.toHaveBeenCalled();
    expect(spies.orderCertIfMissing).not.toHaveBeenCalled();
    expect(refusal().message).toContain("Custom Domains not enabled");
  });

  test("a record that is not found yet orders nothing, and says which record to look for", async () => {
    const spies: Spies = setUp({ cnameValid: false });

    await callRoute(VERIFY_ROUTE);

    expect(spies.isCnameValid).toHaveBeenCalledWith("dash.acme.com");
    expect(spies.orderCertIfMissing).not.toHaveBeenCalled();
    expect(sendJsonObjectResponseMock).not.toHaveBeenCalled();

    const error: Error = refusal();

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toContain("dash.acme.com");
    expect(error.message).toContain("dashboards.example.com");
    expect(error.message).toContain("every 15 minutes");
  });

  /*
   * Whose on-demand budget the order counts against is the domain's
   * project: without projectId every project's clicks shared one budget.
   */
  test("reads what decides the certificate's next step, and whose on-demand orders it counts against", async () => {
    const spies: Spies = setUp({});

    await callRoute(VERIFY_ROUTE);

    const findArgs: { select: Record<string, unknown>; props: unknown } = spies
      .findOneBy.mock.calls[0]![0] as {
      select: Record<string, unknown>;
      props: unknown;
    };

    expect(findArgs.select).toEqual(
      expect.objectContaining({
        _id: true,
        fullDomain: true,
        isCustomCertificate: true,
        isSslOrdered: true,
        projectId: true,
      }),
    );
  });

  /*
   * The point of the change: the record is live, so the certificate is
   * ordered now rather than at the next sweep - and through
   * orderCertIfMissing, never the unguarded orderCert.
   */
  test("a found record orders the domain's certificate straight away, and answers Issuing", async () => {
    const spies: Spies = setUp({});

    await callRoute(VERIFY_ROUTE);

    expect(spies.orderCertIfMissing).toHaveBeenCalledTimes(1);
    expect(
      (spies.orderCertIfMissing.mock.calls[0]![0] as DomainRow).fullDomain,
    ).toBe("dash.acme.com");
    /*
     * An order on demand, for a record the route found a moment ago - the
     * order does not check it again - and for an expired certificate too.
     */
    expect(spies.orderCertIfMissing.mock.calls[0]![1]).toEqual({
      onDemand: true,
      cnameVerifiedJustNow: true,
      renewIfExpired: true,
    });
    expect(spies.isCnameValid).toHaveBeenCalledTimes(1);
    expect(spies.orderCert).not.toHaveBeenCalled();

    expect(answered()).toEqual({
      certificateStatus: CustomDomainCertificateStatus.Issuing,
    });
    expect(sendErrorResponseMock).not.toHaveBeenCalled();
    // It used to answer an empty body.
    expect(sendEmptySuccessResponseMock).not.toHaveBeenCalled();
  });

  test("a domain that still had its certificate answers Issued", async () => {
    setUp({
      order: async (): Promise<CertificateOrderOutcome> => {
        return CertificateOrderOutcome.AlreadyIssued;
      },
    });

    await callRoute(VERIFY_ROUTE);

    expect(answered()).toEqual({
      certificateStatus: CustomDomainCertificateStatus.Issued,
    });
  });

  test("an order already running for the name answers Issuing, without a second order, and gives the window back", async () => {
    setUp({
      order: async (): Promise<CertificateOrderOutcome> => {
        return CertificateOrderOutcome.NotOrderedNow;
      },
    });

    await callRoute(VERIFY_ROUTE);

    expect(answered()).toEqual({
      certificateStatus: CustomDomainCertificateStatus.Issuing,
    });
    expect(CertificateOrder.releaseOnDemandOrder).toHaveBeenCalledWith(
      "dash.acme.com",
    );
  });

  test("a domain on an uploaded certificate orders nothing, and answers Uploaded", async () => {
    const spies: Spies = setUp({
      domain: makeDomain({ isCustomCertificate: true }),
    });

    await callRoute(VERIFY_ROUTE);

    expect(spies.orderCertIfMissing).not.toHaveBeenCalled();
    expect(CertificateOrder.claimOnDemandOrder).not.toHaveBeenCalled();
    expect(answered()).toEqual({
      certificateStatus: CustomDomainCertificateStatus.Uploaded,
    });
  });

  test("a domain whose certificate is in place orders nothing more, and answers Issued", async () => {
    const spies: Spies = setUp({
      domain: makeDomain({ isSslOrdered: true }),
      certificateExpiresInDays: 60,
    });

    await callRoute(VERIFY_ROUTE);

    expect(spies.orderCertIfMissing).not.toHaveBeenCalled();
    // Already recorded as ordered: nothing to write.
    expect(spies.updateBy).not.toHaveBeenCalled();
    expect(answered()).toEqual({
      certificateStatus: CustomDomainCertificateStatus.Issued,
    });
  });

  test("a domain verified again whose certificate is still good is recorded as ordered, in one conditional write", async () => {
    const spies: Spies = setUp({
      domain: makeDomain({ isSslOrdered: false }),
      certificateExpiresInDays: 45,
    });

    await callRoute(VERIFY_ROUTE);

    expect(spies.orderCertIfMissing).not.toHaveBeenCalled();
    expect(spies.updateBy).toHaveBeenCalledTimes(1);

    const write: {
      query: Record<string, unknown>;
      data: Record<string, unknown>;
    } = spies.updateBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      data: Record<string, unknown>;
    };

    expect(write.query["isCnameVerified"]).toBe(true);
    expect(write.query["isSslOrdered"]).toBe(false);
    expect(write.data).toEqual({ isSslOrdered: true });
    expect(answered()).toEqual({
      certificateStatus: CustomDomainCertificateStatus.Issued,
    });
  });

  test("a domain marked ordered whose certificate is gone orders one, and does not say Issued", async () => {
    const spies: Spies = setUp({
      domain: makeDomain({ isSslOrdered: true }),
      certificateExpiresInDays: null,
    });

    await callRoute(VERIFY_ROUTE);

    expect(spies.orderCertIfMissing).toHaveBeenCalledTimes(1);
    expect(answered()).toEqual({
      certificateStatus: CustomDomainCertificateStatus.Issuing,
    });
  });

  test("a domain whose certificate has expired is renewed now, and does not say Issued", async () => {
    const spies: Spies = setUp({
      domain: makeDomain({ isSslOrdered: true }),
      certificateExpiresInDays: -3,
    });

    await callRoute(VERIFY_ROUTE);

    expect(spies.orderCertIfMissing).toHaveBeenCalledTimes(1);
    expect(spies.orderCertIfMissing.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ renewIfExpired: true }),
    );
    expect(answered()).toEqual({
      certificateStatus: CustomDomainCertificateStatus.Issuing,
    });
  });

  test("within the window of a failed order it orders nothing, and shows why that order failed", async () => {
    const spies: Spies = setUp({});

    jest.spyOn(CertificateOrder, "claimOnDemandOrder").mockResolvedValue({
      mayOrder: false,
      lastError: "CAA record forbids letsencrypt.org.",
    });

    await callRoute(VERIFY_ROUTE);

    expect(CertificateOrder.claimOnDemandOrder).toHaveBeenCalledWith(
      "dash.acme.com",
    );
    expect(spies.orderCertIfMissing).not.toHaveBeenCalled();
    expect(answered()).toEqual({
      certificateStatus: CustomDomainCertificateStatus.Failed,
      certificateError: "CAA record forbids letsencrypt.org.",
    });
  });

  /*
   * The record was found; that is what Check now asked. A failed order is
   * reported with it, remembered for the window, and the sweeps order again.
   */
  test("an order that fails is reported and remembered, not turned into an error", async () => {
    setUp({
      order: async (): Promise<CertificateOrderOutcome> => {
        throw new BadDataException("Unable to order certificate.");
      },
    });

    const { next } = await callRoute(VERIFY_ROUTE);

    expect(next).not.toHaveBeenCalled();
    expect(sendErrorResponseMock).not.toHaveBeenCalled();
    expect(answered()).toEqual({
      certificateStatus: CustomDomainCertificateStatus.Failed,
      certificateError: "Unable to order certificate.",
    });
    expect(CertificateOrder.recordOnDemandOrderFailure).toHaveBeenCalledWith(
      "dash.acme.com",
      "Unable to order certificate.",
    );
  });

  test("an unexpected error in an order is reported in plain words, not as its internals", async () => {
    setUp({
      order: async (): Promise<CertificateOrderOutcome> => {
        throw new TypeError("Cannot read properties of undefined");
      },
    });

    await callRoute(VERIFY_ROUTE);

    expect(answered()).toEqual({
      certificateStatus: CustomDomainCertificateStatus.Failed,
      certificateError:
        "We could not order an SSL certificate for this domain.",
    });
  });
});

describe("dashboard certificates (the Status column)", () => {
  test("sits behind the user auth middleware", () => {
    expect(mockRouter.match("GET", CERTIFICATES_ROUTE).middlewares).toContain(
      UserMiddleware.getUserMiddleware,
    );
  });

  test("reads the dashboard's domains with the caller's own props, and answers each one's certificate", async () => {
    const dashboardId: ObjectID = ObjectID.generate();
    const failingId: ObjectID = ObjectID.generate();
    const issuedId: ObjectID = ObjectID.generate();
    const expiresAt: Date = new Date("2026-12-30T00:00:00.000Z");
    const failedAt: Date = new Date("2026-10-03T11:00:00.000Z");

    const findBy: MockedFn = jest
      .spyOn(DashboardDomainService, "findBy")
      .mockResolvedValue([
        { id: failingId, fullDomain: "Failing.Acme.com" },
        { id: issuedId, fullDomain: "issued.acme.com" },
      ] as never) as unknown as MockedFn;

    const states: MockedFn = jest
      .spyOn(CertificateOrder, "getCertificateStates")
      .mockResolvedValue(
        new Map<string, CustomDomainCertificateState>([
          [
            "failing.acme.com",
            {
              lastOrderError: "Unable to order certificate.",
              lastOrderFailedAt: failedAt,
            },
          ],
          ["issued.acme.com", { certificateExpiresAt: expiresAt }],
        ]) as never,
      ) as unknown as MockedFn;

    await callRoute(CERTIFICATES_ROUTE, {
      dashboardId: dashboardId.toString(),
    });

    const findArgs: {
      query: { dashboardId: ObjectID };
      select: Record<string, unknown>;
      props: unknown;
    } = findBy.mock.calls[0]![0] as {
      query: { dashboardId: ObjectID };
      select: Record<string, unknown>;
      props: unknown;
    };

    expect(Object.keys(findArgs.query)).toEqual(["dashboardId"]);
    expect(findArgs.query.dashboardId.toString()).toBe(dashboardId.toString());
    expect(findArgs.props).toBe(callerProps);
    expect(findArgs.select).toEqual({ _id: true, fullDomain: true });
    expect(states).toHaveBeenCalledWith([
      "Failing.Acme.com",
      "issued.acme.com",
    ]);

    expect(answered()).toEqual({
      domains: [
        {
          domainId: failingId.toString(),
          lastOrderError: "Unable to order certificate.",
          lastOrderFailedAt: failedAt.toISOString(),
        },
        {
          domainId: issuedId.toString(),
          expiresAt: expiresAt.toISOString(),
        },
      ],
    });
  });

  test("a malformed id is refused as bad data, and nothing is looked up", async () => {
    const findBy: MockedFn = jest.spyOn(
      DashboardDomainService,
      "findBy",
    ) as unknown as MockedFn;

    const { next } = await callRoute(CERTIFICATES_ROUTE, {
      dashboardId: "not-a-uuid",
    });

    expect(next).not.toHaveBeenCalled();
    expect(findBy).not.toHaveBeenCalled();

    const error: Error = sendErrorResponseMock.mock
      .calls[0]![2] as unknown as Error;

    expect(error).toBeInstanceOf(BadDataException);
  });

  test("a caller who may not read the domains gets the refusal, and nothing is looked up", async () => {
    jest
      .spyOn(DashboardDomainService, "findBy")
      .mockRejectedValue(new BadDataException("Not allowed") as never);
    const states: MockedFn = jest.spyOn(
      CertificateOrder,
      "getCertificateStates",
    ) as unknown as MockedFn;

    const { next } = await callRoute(CERTIFICATES_ROUTE, {
      dashboardId: ObjectID.generate().toString(),
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(states).not.toHaveBeenCalled();
    expect(sendJsonObjectResponseMock).not.toHaveBeenCalled();
  });

  test("a dashboard without domains answers an empty list", async () => {
    jest.spyOn(DashboardDomainService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(CertificateOrder, "getCertificateStates")
      .mockResolvedValue(new Map() as never);

    await callRoute(CERTIFICATES_ROUTE, {
      dashboardId: ObjectID.generate().toString(),
    });

    expect(answered()).toEqual({ domains: [] });
  });
});

/*
 * The service's own wiring of the shared steps: Check now hands in the
 * dashboard table's own writes and first-order door, and that door orders
 * for an expired certificate too when Check now asks it to.
 */
describe("DashboardDomainService, wired to the shared steps", () => {
  test("Check now is the shared step, with this table's own write and first-order door", async () => {
    const shared: MockedFn = jest
      .spyOn(CustomDomainOrders, "orderOnceCnameIsVerified")
      .mockResolvedValue({
        certificateStatus: CustomDomainCertificateStatus.Issuing,
      }) as unknown as MockedFn;
    const updateBy: MockedFn = jest
      .spyOn(DashboardDomainService, "updateBy")
      .mockResolvedValue(1 as never) as unknown as MockedFn;
    const orderCertIfMissing: MockedFn = jest
      .spyOn(DashboardDomainService, "orderCertIfMissing")
      .mockResolvedValue(
        CertificateOrderOutcome.Ordered as never,
      ) as unknown as MockedFn;

    const domain: DomainRow = makeDomain();

    await DashboardDomainService.orderCertOnceCnameIsVerified(domain as never, {
      waitInMs: 1234,
    });

    const call: {
      domain: unknown;
      waitInMs: number;
      recordAsOrdered: () => Promise<void>;
      orderIfMissing: () => Promise<CertificateOrderOutcome>;
    } = shared.mock.calls[0]![0] as {
      domain: unknown;
      waitInMs: number;
      recordAsOrdered: () => Promise<void>;
      orderIfMissing: () => Promise<CertificateOrderOutcome>;
    };

    expect(call.domain).toBe(domain);
    expect(call.waitInMs).toBe(1234);

    await call.recordAsOrdered();

    expect(updateBy).toHaveBeenCalledTimes(1);
    expect(
      (updateBy.mock.calls[0]![0] as { data: Record<string, unknown> }).data,
    ).toEqual({ isSslOrdered: true });

    expect(await call.orderIfMissing()).toBe(CertificateOrderOutcome.Ordered);
    expect(orderCertIfMissing).toHaveBeenCalledWith(domain, {
      onDemand: true,
      cnameVerifiedJustNow: true,
      renewIfExpired: true,
    });
  });

  test("the Status column's certificates are the shared read", async () => {
    const shared: MockedFn = jest
      .spyOn(CustomDomainOrders, "getCertificates")
      .mockResolvedValue([] as never) as unknown as MockedFn;

    const domains: Array<DomainRow> = [makeDomain()];

    await DashboardDomainService.getCertificates(domains as never);

    expect(shared).toHaveBeenCalledWith(domains);
  });

  test.each([
    [true, true],
    [undefined, undefined],
  ])(
    "orderCertIfMissing passes renewIfExpired (%s) to the name's first-order door",
    async (
      renewIfExpired: boolean | undefined,
      expected: boolean | undefined,
    ) => {
      const orderIfMissing: MockedFn = jest
        .spyOn(CertificateOrder, "orderIfMissing")
        .mockResolvedValue(
          CertificateOrderOutcome.Ordered as never,
        ) as unknown as MockedFn;

      await DashboardDomainService.orderCertIfMissing(
        makeDomain({ projectId: ObjectID.generate() }) as never,
        { onDemand: true, renewIfExpired: renewIfExpired },
      );

      const call: { domain: string; renewIfExpired?: boolean } = orderIfMissing
        .mock.calls[0]![0] as { domain: string; renewIfExpired?: boolean };

      expect(call.domain).toBe("dash.acme.com");
      expect(call.renewIfExpired).toBe(expected);
    },
  );

  test("an on-demand order counts against the domain's own project", async () => {
    const projectId: ObjectID = ObjectID.generate();

    jest
      .spyOn(CertificateOrder, "orderIfMissing")
      .mockImplementation((async (data: {
        order: (
          lock: CertificateOrderLockHandle,
        ) => Promise<CertificateOrderOutcome>;
      }): Promise<CertificateOrderOutcome> => {
        return await data.order({} as CertificateOrderLockHandle);
      }) as never);

    const share: MockedFn = jest.spyOn(
      CertificateOrder,
      "getOrderShare",
    ) as unknown as MockedFn;
    const orderCert: MockedFn = jest
      .spyOn(DashboardDomainService, "orderCert")
      .mockResolvedValue(
        CertificateOrderOutcome.Ordered as never,
      ) as unknown as MockedFn;

    await DashboardDomainService.orderCertIfMissing(
      makeDomain({ projectId: projectId }) as never,
      { onDemand: true, cnameVerifiedJustNow: true },
    );

    expect(share).toHaveBeenCalledWith({
      sweep: undefined,
      onDemand: { projectId: projectId.toString() },
    });
    expect(orderCert.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ cnameVerifiedJustNow: true }),
    );
  });

  test("never orders for a domain on an uploaded certificate", async () => {
    const orderIfMissing: MockedFn = jest.spyOn(
      CertificateOrder,
      "orderIfMissing",
    ) as unknown as MockedFn;

    await expect(
      DashboardDomainService.orderCertIfMissing(
        makeDomain({ isCustomCertificate: true }) as never,
        { onDemand: true },
      ),
    ).rejects.toThrow("uses a certificate you uploaded");

    expect(orderIfMissing).not.toHaveBeenCalled();
  });

  test("Check now and the sweeps keep the dashboard's own budget names and limits", () => {
    expect(DashboardDomainServiceClass.SWEEP_ORDER_BUDGET).toBe(
      "DashboardDomainSweeps",
    );
    expect(DashboardDomainServiceClass.ORDER_MAX_PER_RUN).toBe(5);
  });
});
