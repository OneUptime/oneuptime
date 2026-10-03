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
 * The verify-cname and order-ssl routes of status page custom domains.
 *
 * verify-cname is the domain's Check now button. It used to verify the
 * record and stop there, and the free certificate waited for a separate
 * "Order Free SSL" button - or for the 15-minute order sweep, which placed
 * the order anyway. Now, once the record is found, it orders the
 * certificate straight away (StatusPageDomainService
 * .orderCertOnceCnameIsVerified) and answers with what happens to the
 * certificate next. What this pins:
 *
 *   - the access check still uses the caller's own props, and a refused
 *     caller never reaches the CA;
 *   - a record that is not found orders nothing, and says which record to
 *     look for;
 *   - a record that is found orders through the shared order path, which
 *     keeps Check now and the sweeps from ordering one name twice
 *     (StatusPageCustomDomainCertificateLifecycle.test.ts runs that end to
 *     end);
 *   - an order that fails does not turn a found record into an error.
 *
 * order-ssl has no button any more; it stays for API callers and orders the
 * same way: never twice for one name, and at most once per domain per
 * 15-minute window, the window Check now uses.
 *
 * Check now answers Issued only for a certificate that is in the table and
 * has not expired (review finding 6): isSslOrdered said Issued for a
 * certificate that had gone missing, and an expired row said it too.
 *
 * The certificates route is what the Custom Domains page's Status column
 * reads: each domain's certificate expiry and last failed order.
 */

const mockCNameRecord: string = "statuspage.example.com";

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
    StatusPageCNameRecord: mockCNameRecord,
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
import StatusPageDomainService from "../../../Server/Services/StatusPageDomainService";
import CommonAPI from "../../../Server/API/CommonAPI";
import Response from "../../../Server/Utils/Response";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import CertificateOrder, {
  CertificateOrderOutcome,
  CustomDomainCertificateState,
} from "../../../Server/Utils/Greenlock/CertificateOrder";
import GreenlockUtil from "../../../Server/Utils/Greenlock/Greenlock";
import AcmeCertificate from "../../../Models/DatabaseModels/AcmeCertificate";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
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
import { CustomDomainCertificateStatus } from "../../../Types/StatusPage/CustomDomainVerification";

type MockedFn = ReturnType<typeof jest.fn>;

const sendJsonObjectResponseMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;
const sendEmptySuccessResponseMock: MockedFn =
  Response.sendEmptySuccessResponse as unknown as MockedFn;
const sendErrorResponseMock: MockedFn =
  Response.sendErrorResponse as unknown as MockedFn;

const VERIFY_ROUTE: string = "/status-page-domain/verify-cname/:id";
const ORDER_ROUTE: string = "/status-page-domain/order-ssl/:id";
const CERTIFICATES_ROUTE: string =
  "/status-page-domain/certificates/:statusPageId";

type DomainRow = {
  _id: string;
  id: ObjectID;
  fullDomain: string;
  isCustomCertificate?: boolean;
  isSslOrdered?: boolean;
  isCnameVerified?: boolean;
  isSslProvisioned?: boolean;
  cnameVerificationToken?: string;
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
    fullDomain: "status.acme.com",
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
      .spyOn(StatusPageDomainService, "updateBy")
      .mockResolvedValue(1 as never) as unknown as MockedFn,
    countBy: jest
      .spyOn(StatusPageDomainService, "countBy")
      .mockResolvedValue(
        new PositiveNumber(data.canSee === false ? 0 : 1),
      ) as unknown as MockedFn,
    findOneBy: jest
      .spyOn(StatusPageDomainService, "findOneBy")
      .mockResolvedValue(
        (data.domain === undefined ? makeDomain() : data.domain) as never,
      ) as unknown as MockedFn,
    isCnameValid: jest
      .spyOn(StatusPageDomainService, "isCnameValid")
      .mockResolvedValue(data.cnameValid ?? true) as unknown as MockedFn,
    orderCertIfMissing: jest
      .spyOn(StatusPageDomainService, "orderCertIfMissing")
      .mockImplementation(
        (data.order ||
          (async (): Promise<CertificateOrderOutcome> => {
            return CertificateOrderOutcome.Ordered;
          })) as never,
      ) as unknown as MockedFn,
    // The order without the first-order checks: nothing here may call it.
    orderCert: jest
      .spyOn(StatusPageDomainService, "orderCert")
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

beforeAll(() => {
  mockRouter.routes.length = 0;
  new StatusPageDomainAPI();
});

beforeEach(() => {
  jest.clearAllMocks();
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

  // No certificate yet, unless a test says otherwise.
  withCertificate(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("verify-cname (Check now)", () => {
  test("sits behind the user auth middleware", () => {
    expect(mockRouter.match("GET", VERIFY_ROUTE).middlewares).toContain(
      UserMiddleware.getUserMiddleware,
    );
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

  test("a record that is not found yet orders nothing, and says which record to look for", async () => {
    const spies: Spies = setUp({ cnameValid: false });

    await callRoute(VERIFY_ROUTE);

    expect(spies.isCnameValid).toHaveBeenCalledWith("status.acme.com");
    expect(spies.orderCertIfMissing).not.toHaveBeenCalled();
    expect(sendJsonObjectResponseMock).not.toHaveBeenCalled();

    const error: Error = sendErrorResponseMock.mock
      .calls[0]![2] as unknown as Error;

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toContain("status.acme.com");
    expect(error.message).toContain(mockCNameRecord);
    expect(error.message).toContain("every 15 minutes");
  });

  test("reads what decides the certificate's next step along with the domain", async () => {
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
    ).toBe("status.acme.com");
    /*
     * An order on demand, for a record the route found a moment ago - the
     * order does not check it again (review finding 3) - and for an expired
     * certificate too.
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

  test("an order already running for the name answers Issuing, without a second order", async () => {
    setUp({
      order: async (): Promise<CertificateOrderOutcome> => {
        return CertificateOrderOutcome.NotOrderedNow;
      },
    });

    await callRoute(VERIFY_ROUTE);

    expect(answered()).toEqual({
      certificateStatus: CustomDomainCertificateStatus.Issuing,
    });
  });

  test("a domain on an uploaded certificate orders nothing, and answers Uploaded", async () => {
    const spies: Spies = setUp({
      domain: makeDomain({ isCustomCertificate: true }),
    });

    await callRoute(VERIFY_ROUTE);

    expect(spies.orderCertIfMissing).not.toHaveBeenCalled();
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

  /*
   * Regression (review finding 6): isSslOrdered alone answered Issued - for
   * a certificate that had gone missing since, and Check now did nothing.
   */
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

  /*
   * Regression (review finding 6): an expired certificate row answered
   * Issued - "already has its free SSL certificate" - while the domain
   * served a dead one. Now Check now renews it, once per window.
   */
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

  /*
   * The record was found; that is what Check now asked. A failed order is
   * reported with it, and the sweeps order again.
   */
  test("an order that fails is reported, not turned into an error", async () => {
    setUp({
      order: async (): Promise<CertificateOrderOutcome> => {
        throw new BadDataException("Cname is not valid for domain");
      },
    });

    const { next } = await callRoute(VERIFY_ROUTE);

    expect(next).not.toHaveBeenCalled();
    expect(sendErrorResponseMock).not.toHaveBeenCalled();
    expect(answered()).toEqual({
      certificateStatus: CustomDomainCertificateStatus.Failed,
      certificateError: "Cname is not valid for domain",
    });
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

describe("order-ssl (API callers)", () => {
  test("still exists, behind the user auth middleware", () => {
    expect(mockRouter.match("GET", ORDER_ROUTE).middlewares).toContain(
      UserMiddleware.getUserMiddleware,
    );
  });

  test("orders through orderCertIfMissing, so a name is never ordered twice", async () => {
    const spies: Spies = setUp({
      domain: makeDomain({
        isCnameVerified: true,
        cnameVerificationToken: "token",
      }),
    });

    await callRoute(ORDER_ROUTE);

    expect(spies.orderCertIfMissing).toHaveBeenCalledTimes(1);
    expect(spies.orderCertIfMissing.mock.calls[0]![1]).toEqual({
      onDemand: true,
    });
    expect(spies.orderCert).not.toHaveBeenCalled();
    expect(sendEmptySuccessResponseMock).toHaveBeenCalled();
  });

  /*
   * Regression (review finding 1): an order that fails leaves the domain
   * unordered, so a script calling order-ssl in a loop placed an order on
   * every call. It shares Check now's window now.
   */
  test("orders at most once per domain per window: within it, it refuses with the last order's error", async () => {
    const spies: Spies = setUp({
      domain: makeDomain({
        isCnameVerified: true,
        cnameVerificationToken: "token",
      }),
    });

    const claim: MockedFn = jest
      .spyOn(CertificateOrder, "claimOnDemandOrder")
      .mockResolvedValue({
        mayOrder: false,
        lastError: "CAA record forbids letsencrypt.org.",
      }) as unknown as MockedFn;

    await callRoute(ORDER_ROUTE);

    expect(claim).toHaveBeenCalledWith("status.acme.com");
    expect(spies.orderCertIfMissing).not.toHaveBeenCalled();

    const error: Error = sendErrorResponseMock.mock
      .calls[0]![2] as unknown as Error;

    expect(error).toBeInstanceOf(TooManyRequestsException);
    expect(error.message).toContain("less than 15 minutes ago");
    expect(error.message).toContain("CAA record forbids letsencrypt.org.");
  });

  test("an order that fails is remembered for the window, and reported", async () => {
    setUp({
      domain: makeDomain({
        isCnameVerified: true,
        cnameVerificationToken: "token",
      }),
      order: async (): Promise<CertificateOrderOutcome> => {
        throw new BadDataException("Unable to order certificate.");
      },
    });

    const { next } = await callRoute(ORDER_ROUTE);

    expect(CertificateOrder.recordOnDemandOrderFailure).toHaveBeenCalledWith(
      "status.acme.com",
      "Unable to order certificate.",
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(sendEmptySuccessResponseMock).not.toHaveBeenCalled();
  });

  test.each([
    [CertificateOrderOutcome.NotOrderedNow, "being ordered right now"],
    [CertificateOrderOutcome.LimitReached, "used up"],
  ])(
    "nothing ordered (%s) is not reported as a success, and gives the window back",
    async (outcome: CertificateOrderOutcome, message: string) => {
      setUp({
        domain: makeDomain({
          isCnameVerified: true,
          cnameVerificationToken: "token",
        }),
        order: async (): Promise<CertificateOrderOutcome> => {
          return outcome;
        },
      });

      const release: MockedFn = jest
        .spyOn(CertificateOrder, "releaseOnDemandOrder")
        .mockResolvedValue(undefined) as unknown as MockedFn;

      await callRoute(ORDER_ROUTE);

      expect(sendEmptySuccessResponseMock).not.toHaveBeenCalled();

      const error: Error = sendErrorResponseMock.mock
        .calls[0]![2] as unknown as Error;

      expect(error).toBeInstanceOf(TooManyRequestsException);
      expect(error.message).toContain(message);

      // Review: the retry it asks for must not meet "ordered less than 15 minutes ago".
      expect(release).toHaveBeenCalledWith("status.acme.com");
    },
  );

  test("reads whose on-demand orders the order counts against", async () => {
    const spies: Spies = setUp({
      domain: makeDomain({
        isCnameVerified: true,
        cnameVerificationToken: "token",
      }),
    });

    await callRoute(ORDER_ROUTE);

    expect(
      (spies.findOneBy.mock.calls[0]![0] as { select: Record<string, unknown> })
        .select["projectId"],
    ).toBe(true);
  });

  test("refuses a domain on an uploaded certificate, which the sweeps never order for either", async () => {
    const spies: Spies = setUp({
      domain: makeDomain({
        isCnameVerified: true,
        isCustomCertificate: true,
        cnameVerificationToken: "token",
      }),
    });

    await callRoute(ORDER_ROUTE);

    expect(spies.orderCertIfMissing).not.toHaveBeenCalled();
    expect(spies.orderCert).not.toHaveBeenCalled();

    const error: Error = sendErrorResponseMock.mock
      .calls[0]![2] as unknown as Error;

    expect(error.message).toContain("uses a certificate you uploaded");
  });

  test("still refuses a domain whose CNAME is not verified, before any order", async () => {
    const spies: Spies = setUp({
      domain: makeDomain({
        isCnameVerified: false,
        cnameVerificationToken: "token",
      }),
    });

    await callRoute(ORDER_ROUTE);

    expect(spies.orderCertIfMissing).not.toHaveBeenCalled();
    expect(sendErrorResponseMock).toHaveBeenCalled();
  });
});

describe("certificates (the Status column)", () => {
  test("sits behind the user auth middleware", () => {
    expect(mockRouter.match("GET", CERTIFICATES_ROUTE).middlewares).toContain(
      UserMiddleware.getUserMiddleware,
    );
  });

  test("reads the status page's domains with the caller's own props, and answers each one's certificate", async () => {
    const statusPageId: ObjectID = ObjectID.generate();
    const failingId: ObjectID = ObjectID.generate();
    const issuedId: ObjectID = ObjectID.generate();
    const expiresAt: Date = new Date("2026-12-30T00:00:00.000Z");
    const failedAt: Date = new Date("2026-10-03T11:00:00.000Z");

    const findBy: MockedFn = jest
      .spyOn(StatusPageDomainService, "findBy")
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
      statusPageId: statusPageId.toString(),
    });

    const findArgs: {
      query: { statusPageId: ObjectID };
      select: Record<string, unknown>;
      props: unknown;
    } = findBy.mock.calls[0]![0] as {
      query: { statusPageId: ObjectID };
      select: Record<string, unknown>;
      props: unknown;
    };

    expect(findArgs.query.statusPageId.toString()).toBe(
      statusPageId.toString(),
    );
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

  test("a caller who may not read the domains gets the refusal, and nothing is looked up", async () => {
    jest
      .spyOn(StatusPageDomainService, "findBy")
      .mockRejectedValue(new BadDataException("Not allowed") as never);
    const states: MockedFn = jest.spyOn(
      CertificateOrder,
      "getCertificateStates",
    ) as unknown as MockedFn;

    const { next } = await callRoute(CERTIFICATES_ROUTE, {
      statusPageId: ObjectID.generate().toString(),
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(states).not.toHaveBeenCalled();
    expect(sendJsonObjectResponseMock).not.toHaveBeenCalled();
  });
});

describe("StatusPageDomainService.orderCertOnceCnameIsVerified", () => {
  test("answers Issuing once its wait is over, and the order carries on to finish", async () => {
    let finishOrder: (
      outcome: CertificateOrderOutcome,
    ) => void = (): void => {};
    let orderFinished: boolean = false;

    jest
      .spyOn(StatusPageDomainService, "orderCertIfMissing")
      .mockImplementation((async (): Promise<CertificateOrderOutcome> => {
        const outcome: CertificateOrderOutcome =
          await new Promise<CertificateOrderOutcome>(
            (resolve: (outcome: CertificateOrderOutcome) => void) => {
              finishOrder = resolve;
            },
          );
        orderFinished = true;
        return outcome;
      }) as never);

    const startedAt: number = Date.now();

    const result: { certificateStatus: CustomDomainCertificateStatus } =
      await StatusPageDomainService.orderCertOnceCnameIsVerified(
        makeDomain() as never,
        { waitInMs: 20 },
      );

    expect(result.certificateStatus).toBe(
      CustomDomainCertificateStatus.Issuing,
    );
    expect(Date.now() - startedAt).toBeLessThan(5000);
    expect(orderFinished).toBe(false);

    finishOrder(CertificateOrderOutcome.Ordered);
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });

    expect(orderFinished).toBe(true);
  });

  test("an order that fails after the wait is over is logged, not thrown at anyone", async () => {
    let failOrder: (err: Error) => void = (): void => {};

    jest
      .spyOn(StatusPageDomainService, "orderCertIfMissing")
      .mockImplementation(((): Promise<CertificateOrderOutcome> => {
        return new Promise<CertificateOrderOutcome>(
          (
            _resolve: (outcome: CertificateOrderOutcome) => void,
            reject: (err: Error) => void,
          ) => {
            failOrder = reject;
          },
        );
      }) as never);

    const unhandled: Array<unknown> = [];
    const onUnhandled: (reason: unknown) => void = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const result: { certificateStatus: CustomDomainCertificateStatus } =
        await StatusPageDomainService.orderCertOnceCnameIsVerified(
          makeDomain() as never,
          { waitInMs: 10 },
        );

      expect(result.certificateStatus).toBe(
        CustomDomainCertificateStatus.Issuing,
      );

      failOrder(new Error("CA refused the order"));

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 20);
      });

      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  /*
   * Regression (review): a failed order leaves the domain unordered, so
   * every click used to order again. One on-demand order per domain per
   * window; within it, a click reports the last order's error.
   */
  test("a click within the window orders nothing and reports the last order's error", async () => {
    const claim: MockedFn = jest
      .spyOn(CertificateOrder, "claimOnDemandOrder")
      .mockResolvedValue({
        mayOrder: false,
        lastError: "CAA record forbids letsencrypt.org",
      }) as unknown as MockedFn;
    const orderSpy: MockedFn = jest
      .spyOn(StatusPageDomainService, "orderCertIfMissing")
      .mockResolvedValue(
        CertificateOrderOutcome.Ordered as never,
      ) as unknown as MockedFn;

    const result: {
      certificateStatus: CustomDomainCertificateStatus;
      certificateError?: string | undefined;
    } = await StatusPageDomainService.orderCertOnceCnameIsVerified(
      makeDomain() as never,
    );

    expect(claim).toHaveBeenCalledWith("status.acme.com");
    expect(orderSpy).not.toHaveBeenCalled();
    expect(result).toEqual({
      certificateStatus: CustomDomainCertificateStatus.Failed,
      certificateError: "CAA record forbids letsencrypt.org",
    });
  });

  test("a click within the window of an order that did not fail answers Issuing, without ordering", async () => {
    jest
      .spyOn(CertificateOrder, "claimOnDemandOrder")
      .mockResolvedValue({ mayOrder: false });
    const orderSpy: MockedFn = jest
      .spyOn(StatusPageDomainService, "orderCertIfMissing")
      .mockResolvedValue(
        CertificateOrderOutcome.Ordered as never,
      ) as unknown as MockedFn;

    const result: { certificateStatus: CustomDomainCertificateStatus } =
      await StatusPageDomainService.orderCertOnceCnameIsVerified(
        makeDomain() as never,
      );

    expect(orderSpy).not.toHaveBeenCalled();
    expect(result.certificateStatus).toBe(
      CustomDomainCertificateStatus.Issuing,
    );
  });

  /*
   * Review: an order that never happened - another order of the name
   * running, the window's orders used up - kept the domain's window, so the
   * next click within 15 minutes only said "Issuing" again.
   */
  test.each([
    [CertificateOrderOutcome.NotOrderedNow],
    [CertificateOrderOutcome.LimitReached],
  ])(
    "an order that was not placed (%s) answers Issuing, and gives the window back",
    async (outcome: CertificateOrderOutcome) => {
      const release: MockedFn = jest
        .spyOn(CertificateOrder, "releaseOnDemandOrder")
        .mockResolvedValue(undefined) as unknown as MockedFn;
      jest
        .spyOn(StatusPageDomainService, "orderCertIfMissing")
        .mockResolvedValue(outcome as never);

      const result: { certificateStatus: CustomDomainCertificateStatus } =
        await StatusPageDomainService.orderCertOnceCnameIsVerified(
          makeDomain() as never,
        );

      expect(result.certificateStatus).toBe(
        CustomDomainCertificateStatus.Issuing,
      );
      expect(release).toHaveBeenCalledWith("status.acme.com");
    },
  );

  test("an order that was placed keeps the window", async () => {
    const release: MockedFn = jest
      .spyOn(CertificateOrder, "releaseOnDemandOrder")
      .mockResolvedValue(undefined) as unknown as MockedFn;
    jest
      .spyOn(StatusPageDomainService, "orderCertIfMissing")
      .mockResolvedValue(CertificateOrderOutcome.Ordered as never);

    await StatusPageDomainService.orderCertOnceCnameIsVerified(
      makeDomain() as never,
    );

    expect(release).not.toHaveBeenCalled();
  });

  test("a failed order is remembered for the rest of the window", async () => {
    const record: MockedFn = jest
      .spyOn(CertificateOrder, "recordOnDemandOrderFailure")
      .mockResolvedValue(undefined) as unknown as MockedFn;
    jest
      .spyOn(StatusPageDomainService, "orderCertIfMissing")
      .mockRejectedValue(
        new BadDataException("Cname is not valid for domain") as never,
      );

    await StatusPageDomainService.orderCertOnceCnameIsVerified(
      makeDomain() as never,
    );

    expect(record).toHaveBeenCalledWith(
      "status.acme.com",
      "Cname is not valid for domain",
    );
  });

  test("an order that finishes within the wait answers at once, without waiting it out", async () => {
    jest
      .spyOn(StatusPageDomainService, "orderCertIfMissing")
      .mockResolvedValue(CertificateOrderOutcome.Ordered as never);

    const startedAt: number = Date.now();

    const result: { certificateStatus: CustomDomainCertificateStatus } =
      await StatusPageDomainService.orderCertOnceCnameIsVerified(
        makeDomain() as never,
        { waitInMs: 60_000 },
      );

    expect(result.certificateStatus).toBe(
      CustomDomainCertificateStatus.Issuing,
    );
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });
});
