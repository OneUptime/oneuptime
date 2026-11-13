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
 * The routes behind DNS Setup and Add Custom Domain, for status page,
 * dashboard and form domains alike:
 *
 *   - check-dns, DNS Setup's Check now: the same check and the same order
 *     as verify-cname, answered either way with every record it looked up
 *     and what came back, so the dialog draws each with its own status;
 *   - verify-cname, which API callers rely on, still refuses a record that
 *     is not found - now in words that say what it found, in place of "We
 *     could not find a CNAME record" (#1521, #1664);
 *   - server-readiness, what a self-hosted server still needs before any
 *     custom domain can work, naming the setting for this kind of domain;
 *     on OneUptime Cloud it has no checks.
 *
 * DNS and the certificate issuer are stubbed at the service: nothing here
 * touches the network.
 */

let mockIsBillingEnabled: boolean = false;

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

  const mocked: Record<string, unknown> = {
    ...actual,
    __esModule: true,
    StatusPageCNameRecord: "statuspage.example.com",
    DashboardCNameRecord: "dashboards.example.com",
    FormCNameRecord: "statuspage.example.com",
  };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return mockIsBillingEnabled;
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
      setNoCacheHeaders: jest.fn(),
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
import FormDomainAPI from "../../../Server/API/FormDomainAPI";
import StatusPageDomainService from "../../../Server/Services/StatusPageDomainService";
import DashboardDomainService from "../../../Server/Services/DashboardDomainService";
import FormDomainService from "../../../Server/Services/FormDomainService";
import CommonAPI from "../../../Server/API/CommonAPI";
import CustomDomainRoutes from "../../../Server/API/CustomDomainRoutes";
import Response from "../../../Server/Utils/Response";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import CustomDomainServerReadiness from "../../../Server/Utils/CustomDomain/CustomDomainServerReadiness";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  DnsRecordCheck,
  DnsRecordCheckOutcome,
  DnsRecordType,
} from "../../../Types/CustomDomain/DnsRecordCheck";
import { CustomDomainCertificateStatus } from "../../../Types/CustomDomain/CustomDomainVerification";
import CustomDomainDnsCheckResultJSON, {
  CustomDomainDnsCheckResult,
} from "../../../Types/CustomDomain/CustomDomainDnsCheckResult";
import CustomDomainServerReadinessJSON, {
  CustomDomainReadinessCheckId,
  CustomDomainReadinessOutcome,
  CustomDomainServerReadinessResult,
} from "../../../Types/CustomDomain/CustomDomainServerReadiness";
import { JSONObject } from "../../../Types/JSON";
import { customDomainCaller } from "./CustomDomainCallers";

type MockedFn = ReturnType<typeof jest.fn>;

const sendJsonObjectResponseMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;
const sendErrorResponseMock: MockedFn =
  Response.sendErrorResponse as unknown as MockedFn;

interface KindCase {
  name: string;
  crudApiPath: string;
  parentColumn: string;
  service: {
    findOneBy: unknown;
    findBy: unknown;
    checkCname: unknown;
    orderCertOnceCnameIsVerified: unknown;
  };
  target: string;
  variable: string;
  helmValue: string;
  permissions: Array<Permission>;
}

const KINDS: Array<KindCase> = [
  {
    name: "status page",
    crudApiPath: "/status-page-domain",
    parentColumn: "statusPageId",
    service: StatusPageDomainService as never,
    target: "statuspage.example.com",
    variable: "STATUS_PAGE_CNAME_RECORD",
    helmValue: "statusPage.cnameRecord",
    permissions: [
      Permission.ReadProjectStatusPage,
      Permission.ReadStatusPageDomain,
      Permission.EditStatusPageDomain,
    ],
  },
  {
    name: "dashboard",
    crudApiPath: "/dashboard-domain",
    parentColumn: "dashboardId",
    service: DashboardDomainService as never,
    target: "dashboards.example.com",
    variable: "DASHBOARD_CNAME_RECORD",
    helmValue: "dashboard.cnameRecord",
    permissions: [
      Permission.ReadDashboard,
      Permission.ReadDashboardDomain,
      Permission.EditDashboardDomain,
    ],
  },
  /*
   * A form's domains use the status page CNAME record unless the
   * installation names one of its own: the setting named is the status
   * page one.
   */
  {
    name: "form",
    crudApiPath: "/form-domain",
    parentColumn: "formId",
    service: FormDomainService as never,
    target: "statuspage.example.com",
    variable: "STATUS_PAGE_CNAME_RECORD",
    helmValue: "statusPage.cnameRecord",
    permissions: [
      Permission.ReadForm,
      Permission.ReadFormDomain,
      Permission.EditFormDomain,
    ],
  },
];

let domainId: ObjectID;

function cnameCheck(
  kind: KindCase,
  outcome: DnsRecordCheckOutcome,
  foundValues: Array<string> = [],
): DnsRecordCheck {
  return {
    type: DnsRecordType.CNAME,
    name: "status.acme.com",
    expectedValue: kind.target,
    foundValues: foundValues,
    outcome: outcome,
    checkedAt: new Date(),
  };
}

interface Spies {
  findOneBy: MockedFn;
  checkCname: MockedFn;
  order: MockedFn;
}

function setUp(
  kind: KindCase,
  data: { canSee?: boolean; check?: DnsRecordCheck },
): Spies {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(customDomainCaller({ permissions: kind.permissions }));

  return {
    findOneBy: jest.spyOn(kind.service as never, "findOneBy").mockResolvedValue(
      (data.canSee === false
        ? null
        : {
            _id: domainId.toString(),
            id: domainId,
            fullDomain: "status.acme.com",
            isCustomCertificate: false,
            isSslOrdered: false,
          }) as never,
    ) as unknown as MockedFn,
    checkCname: jest
      .spyOn(kind.service as never, "checkCname")
      .mockResolvedValue(
        (data.check ||
          cnameCheck(kind, DnsRecordCheckOutcome.NotFound)) as never,
      ) as unknown as MockedFn,
    order: jest
      .spyOn(kind.service as never, "orderCertOnceCnameIsVerified")
      .mockResolvedValue({
        certificateStatus: CustomDomainCertificateStatus.Issuing,
      } as never) as unknown as MockedFn,
  };
}

async function callRoute(
  route: string,
  params: Record<string, string>,
): Promise<{ next: MockedFn }> {
  const req: ExpressRequest = {
    params: params,
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

function answered(): JSONObject {
  expect(sendJsonObjectResponseMock).toHaveBeenCalledTimes(1);
  return sendJsonObjectResponseMock.mock.calls[0]![2] as JSONObject;
}

function refusal(): Error {
  expect(sendErrorResponseMock).toHaveBeenCalledTimes(1);
  return sendErrorResponseMock.mock.calls[0]![2] as unknown as Error;
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new StatusPageDomainAPI();
  new DashboardDomainAPI();
  new FormDomainAPI();
});

beforeEach(() => {
  jest.clearAllMocks();
  domainId = ObjectID.generate();
  mockIsBillingEnabled = false;
  CustomDomainServerReadiness.clearCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// One kind's routes. Its tests read the state each beforeEach sets.
const describeKind: (kind: KindCase) => void = (kind: KindCase): void => {
  const CHECK_DNS: string = `${kind.crudApiPath}/check-dns/:id`;
  const VERIFY: string = `${kind.crudApiPath}/verify-cname/:id`;
  const READINESS: string = `${kind.crudApiPath}/server-readiness`;

  describe(`check-dns (${kind.name} domains)`, () => {
    test("sits behind the user auth middleware", () => {
      expect(mockRouter.match("GET", CHECK_DNS).middlewares).toContain(
        UserMiddleware.getUserMiddleware,
      );
    });

    test("a domain outside the caller's update scope looks nothing up", async () => {
      const spies: Spies = setUp(kind, { canSee: false });

      await callRoute(CHECK_DNS, { id: domainId.toString() });

      expect(spies.checkCname).not.toHaveBeenCalled();
      expect(spies.order).not.toHaveBeenCalled();
      expect(refusal()).toBeInstanceOf(BadDataException);
    });

    test("a malformed id is refused before anything is read", async () => {
      const spies: Spies = setUp(kind, {});

      await callRoute(CHECK_DNS, { id: "nope" });

      expect(spies.findOneBy).not.toHaveBeenCalled();
      expect(refusal().message).toBe("The domain ID is not valid.");
    });

    test("a record not found is answered, not refused: what was looked up, and nothing ordered", async () => {
      const check: DnsRecordCheck = cnameCheck(
        kind,
        DnsRecordCheckOutcome.WrongValue,
        ["other.example.net"],
      );
      const spies: Spies = setUp(kind, { check });

      await callRoute(CHECK_DNS, { id: domainId.toString() });

      expect(spies.checkCname).toHaveBeenCalledWith("status.acme.com", {
        lookUpDnsEvenWhenReached: true,
      });
      expect(spies.order).not.toHaveBeenCalled();
      expect(sendErrorResponseMock).not.toHaveBeenCalled();

      const result: CustomDomainDnsCheckResult =
        CustomDomainDnsCheckResultJSON.fromJSON(answered());

      expect(result.isVerified).toBe(false);
      expect(result.records).toEqual([check]);
      expect(result.certificate).toBeUndefined();
    });

    test("a record found orders the certificate, and says what happens to it next", async () => {
      const check: DnsRecordCheck = cnameCheck(
        kind,
        DnsRecordCheckOutcome.Found,
        [kind.target],
      );
      const spies: Spies = setUp(kind, { check });

      spies.order.mockResolvedValue({
        certificateStatus: CustomDomainCertificateStatus.Failed,
        certificateError: "CAA record forbids letsencrypt.org",
      } as never);

      await callRoute(CHECK_DNS, { id: domainId.toString() });

      expect(spies.order).toHaveBeenCalledTimes(1);

      const result: CustomDomainDnsCheckResult =
        CustomDomainDnsCheckResultJSON.fromJSON(answered());

      expect(result).toEqual({
        isVerified: true,
        records: [check],
        certificate: {
          certificateStatus: CustomDomainCertificateStatus.Failed,
          certificateError: "CAA record forbids letsencrypt.org",
        },
      });
    });
  });

  describe(`verify-cname (${kind.name} domains)`, () => {
    test("a record not found is refused with what was looked up and what came back", async () => {
      const spies: Spies = setUp(kind, {
        check: cnameCheck(kind, DnsRecordCheckOutcome.WrongValue, [
          "other.example.net",
        ]),
      });

      await callRoute(VERIFY, { id: domainId.toString() });

      expect(spies.order).not.toHaveBeenCalled();

      const error: Error = refusal();

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(
        `We looked up the CNAME record of status.acme.com and got other.example.net, but expected ${kind.target}. Change the record's value to ${kind.target}. We keep checking every 15 minutes.`,
      );
    });

    test("a record found still answers what happens to the certificate, as before", async () => {
      setUp(kind, {
        check: cnameCheck(kind, DnsRecordCheckOutcome.Found, [kind.target]),
      });

      await callRoute(VERIFY, { id: domainId.toString() });

      expect(answered()).toEqual({
        certificateStatus: CustomDomainCertificateStatus.Issuing,
      });
    });
  });

  describe(`server-readiness (${kind.name} domains)`, () => {
    test("sits behind the user auth middleware", () => {
      expect(mockRouter.match("GET", READINESS).middlewares).toContain(
        UserMiddleware.getUserMiddleware,
      );
    });

    test("on a self-hosted server, checks this kind's target and names its setting", async () => {
      setUp(kind, {});
      jest
        .spyOn(kind.service as never, "findBy")
        .mockResolvedValue([] as never);

      const readiness: CustomDomainServerReadinessResult = {
        target: kind.target,
        checks: [
          {
            id: CustomDomainReadinessCheckId.Port80,
            outcome: CustomDomainReadinessOutcome.Fail,
            values: { target: kind.target },
          },
        ],
      };

      const check: MockedFn = jest
        .spyOn(CustomDomainServerReadiness, "check")
        .mockResolvedValue(readiness as never) as unknown as MockedFn;

      await callRoute(READINESS, {});

      expect(check).toHaveBeenCalledWith({
        target: kind.target,
        variable: kind.variable,
        helmValue: kind.helmValue,
      });
      expect(CustomDomainServerReadinessJSON.fromJSON(answered())).toEqual(
        readiness,
      );
    });

    test("on OneUptime Cloud there is nothing to check", async () => {
      mockIsBillingEnabled = true;
      setUp(kind, {});
      jest
        .spyOn(kind.service as never, "findBy")
        .mockResolvedValue([] as never);

      const check: MockedFn = jest.spyOn(
        CustomDomainServerReadiness,
        "check",
      ) as unknown as MockedFn;

      await callRoute(READINESS, {});

      expect(check).not.toHaveBeenCalled();
      expect(
        CustomDomainServerReadinessJSON.fromJSON(answered()).checks,
      ).toEqual([]);
    });

    test("somebody who may not read this kind's domains is refused, and nothing is checked", async () => {
      setUp(kind, {});
      jest
        .spyOn(kind.service as never, "findBy")
        .mockRejectedValue(
          new NotAuthorizedException("You do not have permission") as never,
        );

      const check: MockedFn = jest.spyOn(
        CustomDomainServerReadiness,
        "check",
      ) as unknown as MockedFn;

      await callRoute(READINESS, {});

      expect(check).not.toHaveBeenCalled();
      expect(refusal()).toBeInstanceOf(NotAuthorizedException);
    });
  });
};

for (const kind of KINDS) {
  describeKind(kind);
}

describe("the refusal's words", () => {
  test("say what was looked up, what came back, and when it is checked again", () => {
    const message: string = CustomDomainRoutes.getNotVerifiedMessage({
      type: DnsRecordType.CNAME,
      name: "status.acme.com",
      expectedValue: "statuspage.example.com",
      foundValues: [],
      outcome: DnsRecordCheckOutcome.NotFound,
      addresses: ["104.21.3.4"],
    });

    expect(message).toContain(
      "We looked up the CNAME record of status.acme.com and got nothing, but the name answers with the address 104.21.3.4.",
    );
    expect(message).toContain("statuspage.example.com");
    expect(message.endsWith("We keep checking every 15 minutes.")).toBe(true);
  });
});
