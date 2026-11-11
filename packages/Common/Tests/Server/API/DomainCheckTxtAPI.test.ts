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
 * check-txt on a project's domains: what Add Custom Domain calls to verify
 * a domain without leaving the status page, dashboard or form.
 *
 * Verifying a domain used to be an update that refused with "Verification
 * TXT record ... not found" and nothing about what was there. check-txt
 * answers what it looked up and what came back either way, and verifies the
 * domain when its record is found. It takes what an update takes - Edit
 * Project Domain, or a role with it - so somebody who may only read the
 * project's domains verifies nothing. DNS is stubbed.
 */

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

import DomainAPI, {
  DOMAIN_NOT_VERIFIABLE_MESSAGE,
} from "../../../Server/API/DomainAPI";
import DomainService from "../../../Server/Services/DomainService";
import CommonAPI from "../../../Server/API/CommonAPI";
import Response from "../../../Server/Utils/Response";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import CustomDomainDnsCheck from "../../../Server/Utils/CustomDomain/CustomDomainDnsCheck";
import DomainType from "../../../Server/Types/Domain";
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
import CustomDomainDnsCheckResultJSON, {
  CustomDomainDnsCheckResult,
} from "../../../Types/CustomDomain/CustomDomainDnsCheckResult";
import { JSONObject } from "../../../Types/JSON";
import { customDomainCaller } from "./CustomDomainCallers";

type MockedFn = ReturnType<typeof jest.fn>;

const ROUTE: string = "/domain/check-txt/:id";

const sendJsonObjectResponseMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;
const sendErrorResponseMock: MockedFn =
  Response.sendErrorResponse as unknown as MockedFn;

let domainId: ObjectID;

interface Row {
  domain: string;
  isVerified?: boolean;
  domainVerificationText?: string;
}

interface Spies {
  findOneBy: MockedFn;
  updateOneById: MockedFn;
  checkTxt: MockedFn;
}

function txtCheck(outcome: DnsRecordCheckOutcome): DnsRecordCheck {
  return {
    type: DnsRecordType.TXT,
    name: "acme.com",
    expectedValue: "oneuptime-verification-abc",
    foundValues:
      outcome === DnsRecordCheckOutcome.WrongValue ? ["v=spf1 -all"] : [],
    outcome,
    checkedAt: new Date(),
  };
}

function setUp(data: {
  permissions: Array<Permission>;
  row?: Row | null;
  outcome?: DnsRecordCheckOutcome;
}): Spies {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(customDomainCaller({ permissions: data.permissions }));

  const row: Row | null =
    data.row === undefined
      ? {
          domain: "acme.com",
          isVerified: false,
          domainVerificationText: "oneuptime-verification-abc",
        }
      : data.row;

  return {
    findOneBy: jest.spyOn(DomainService, "findOneBy").mockResolvedValue(
      (row
        ? {
            _id: domainId.toString(),
            id: domainId,
            domain: new DomainType(row.domain),
            isVerified: row.isVerified,
            domainVerificationText: row.domainVerificationText,
          }
        : null) as never,
    ) as unknown as MockedFn,
    updateOneById: jest
      .spyOn(DomainService, "updateOneById")
      .mockResolvedValue(undefined as never) as unknown as MockedFn,
    checkTxt: jest
      .spyOn(CustomDomainDnsCheck, "checkTxt")
      .mockResolvedValue(
        txtCheck(data.outcome || DnsRecordCheckOutcome.NotFound) as never,
      ) as unknown as MockedFn,
  };
}

async function callRoute(id: string): Promise<void> {
  await mockRouter.match("GET", ROUTE).handlerFunction(
    {
      params: { id },
      query: {},
      body: {},
      headers: {},
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    jest.fn() as unknown as NextFunction,
  );
}

function answer(): CustomDomainDnsCheckResult {
  expect(sendJsonObjectResponseMock).toHaveBeenCalledTimes(1);
  return CustomDomainDnsCheckResultJSON.fromJSON(
    sendJsonObjectResponseMock.mock.calls[0]![2] as JSONObject,
  );
}

const MAY_VERIFY: Array<Permission> = [
  Permission.ReadProjectDomain,
  Permission.EditProjectDomain,
];

beforeAll(() => {
  mockRouter.routes.length = 0;
  new DomainAPI();
});

beforeEach(() => {
  jest.clearAllMocks();
  domainId = ObjectID.generate();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("check-txt", () => {
  test("sits behind the user auth middleware", () => {
    expect(mockRouter.match("GET", ROUTE).middlewares).toContain(
      UserMiddleware.getUserMiddleware,
    );
  });

  test("the CRUD routes of /domain are still there", () => {
    expect(() => {
      return mockRouter.match("POST", "/domain/get-list");
    }).not.toThrow();
    expect(() => {
      return mockRouter.match("PUT", "/domain/:id");
    }).not.toThrow();
  });

  test("a malformed id is refused before anything is read", async () => {
    const spies: Spies = setUp({ permissions: MAY_VERIFY });

    await callRoute("not-an-id");

    expect(spies.findOneBy).not.toHaveBeenCalled();
    expect(
      (sendErrorResponseMock.mock.calls[0]![2] as unknown as Error).message,
    ).toBe("The domain ID is not valid.");
  });

  test("a record found verifies the domain, and says what was found", async () => {
    const spies: Spies = setUp({
      permissions: MAY_VERIFY,
      outcome: DnsRecordCheckOutcome.Found,
    });

    await callRoute(domainId.toString());

    expect(spies.checkTxt).toHaveBeenCalledWith({
      domain: "acme.com",
      expectedValue: "oneuptime-verification-abc",
    });
    expect(spies.updateOneById).toHaveBeenCalledWith({
      id: domainId,
      data: { isVerified: true },
      props: { isRoot: true },
    });

    const result: CustomDomainDnsCheckResult = answer();

    expect(result.isVerified).toBe(true);
    expect(result.records[0]?.outcome).toBe(DnsRecordCheckOutcome.Found);
  });

  test("a record not found verifies nothing, and is answered with what came back", async () => {
    const spies: Spies = setUp({
      permissions: MAY_VERIFY,
      outcome: DnsRecordCheckOutcome.WrongValue,
    });

    await callRoute(domainId.toString());

    expect(spies.updateOneById).not.toHaveBeenCalled();
    expect(sendErrorResponseMock).not.toHaveBeenCalled();

    const result: CustomDomainDnsCheckResult = answer();

    expect(result.isVerified).toBe(false);
    expect(result.records[0]).toEqual(
      expect.objectContaining({
        type: DnsRecordType.TXT,
        outcome: DnsRecordCheckOutcome.WrongValue,
        foundValues: ["v=spf1 -all"],
      }),
    );
  });

  test("a domain verified already is found, with nothing looked up or written", async () => {
    const spies: Spies = setUp({
      permissions: MAY_VERIFY,
      row: {
        domain: "acme.com",
        isVerified: true,
        domainVerificationText: "oneuptime-verification-abc",
      },
    });

    await callRoute(domainId.toString());

    expect(spies.checkTxt).not.toHaveBeenCalled();
    expect(spies.updateOneById).not.toHaveBeenCalled();
    expect(answer().isVerified).toBe(true);
  });

  test("a reserved test domain is verified without DNS, as DomainService does", async () => {
    const spies: Spies = setUp({
      permissions: MAY_VERIFY,
      row: {
        domain: "acme.test",
        isVerified: false,
        domainVerificationText: "oneuptime-verification-abc",
      },
    });

    await callRoute(domainId.toString());

    expect(spies.checkTxt).not.toHaveBeenCalled();
    expect(spies.updateOneById).toHaveBeenCalledTimes(1);
    expect(answer().isVerified).toBe(true);
  });

  test("somebody who may only read the project's domains verifies nothing", async () => {
    const spies: Spies = setUp({
      permissions: [Permission.ReadProjectDomain],
    });

    await callRoute(domainId.toString());

    expect(spies.checkTxt).not.toHaveBeenCalled();
    expect(spies.updateOneById).not.toHaveBeenCalled();
    expect(sendErrorResponseMock.mock.calls[0]![2]).toBeInstanceOf(
      NotAuthorizedException,
    );
  });

  test("a domain outside the caller's project gets the one answer that says neither", async () => {
    const spies: Spies = setUp({ permissions: MAY_VERIFY, row: null });

    await callRoute(domainId.toString());

    expect(spies.checkTxt).not.toHaveBeenCalled();

    const error: Error = sendErrorResponseMock.mock
      .calls[0]![2] as unknown as Error;

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(DOMAIN_NOT_VERIFIABLE_MESSAGE);
  });

  test("a domain with no verification text says to add it again, and looks nothing up", async () => {
    const spies: Spies = setUp({
      permissions: MAY_VERIFY,
      row: { domain: "acme.com", isVerified: false },
    });

    await callRoute(domainId.toString());

    expect(spies.checkTxt).not.toHaveBeenCalled();
    expect(
      (sendErrorResponseMock.mock.calls[0]![2] as unknown as Error).message,
    ).toContain("Delete it and add it again");
  });
});
