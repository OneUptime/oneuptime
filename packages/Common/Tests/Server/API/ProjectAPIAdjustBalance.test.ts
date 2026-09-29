import ProjectAPI from "../../../Server/API/ProjectAPI";
import MasterAdminAuthorization from "../../../Server/Middleware/MasterAdminAuthorization";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import ProjectService from "../../../Server/Services/ProjectService";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import { describe, expect, it } from "@jest/globals";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import BadDataException from "../../../Types/Exception/BadDataException";
import ProjectBalanceType from "../../../Types/Billing/ProjectBalanceType";
import BalanceAdjustmentType from "../../../Types/Billing/BalanceAdjustmentType";

/*
 * The adjust-balance endpoint hands out (or claws back) paid service with no
 * payment behind it. Two properties are load-bearing and asserted here: it is
 * reachable only by a master admin session, and nothing that fails to parse
 * cleanly into a whole number of cents ever reaches the service.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    IsBillingEnabled: true,
  };
});

jest.mock("../../../Server/Services/BillingService");

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
  };
});

jest.mock("../../../Server/Services/TeamMemberService");
jest.mock("../../../Server/Services/ProjectService");

const ROUTE: string = "/project/:id/adjust-balance";

describe("PUT /project/:id/adjust-balance", () => {
  const projectId: ObjectID = ObjectID.generate();

  let mockRequest: OneUptimeRequest;
  let mockResponse: OneUptimeResponse;
  let nextFunction: NextFunction;

  function validBody(overrides?: Record<string, unknown>): {
    data: Record<string, unknown>;
  } {
    return {
      data: {
        balanceType: ProjectBalanceType.SmsOrCall,
        adjustmentType: BalanceAdjustmentType.Add,
        amountInUSD: 20,
        reason: "Goodwill credit agreed on ticket 4821",
        ...overrides,
      },
    };
  }

  async function callRoute(): Promise<void> {
    await mockRouter
      .match("put", ROUTE)
      .handlerFunction(mockRequest, mockResponse, nextFunction);
  }

  beforeEach(() => {
    new ProjectAPI();
    mockRequest = {} as OneUptimeRequest;
    mockResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as OneUptimeResponse;
    nextFunction = jest.fn();

    mockRequest.params = { id: projectId.toString() };

    ProjectService.adjustBalance = jest.fn().mockResolvedValue({
      previousBalanceInUSDCents: 5000,
      newBalanceInUSDCents: 7000,
    });

    /*
     * Response is module-mocked once for the whole file, so its call log would
     * otherwise carry over between tests.
     */
    (Response.sendJsonObjectResponse as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("authorization", () => {
    it("sits behind the master admin middleware", () => {
      /*
       * Moving a balance must not be reachable with project-level billing
       * permissions - a project owner could otherwise credit themselves - and
       * not with the static master API key either, only a master admin
       * session.
       */
      expect(mockRouter.match("put", ROUTE).middleware).toBe(
        MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      );
    });

    it("does not require a tenant id, since master admins act across projects", async () => {
      mockRequest.body = validBody();
      delete (mockRequest as { tenantId?: ObjectID }).tenantId;

      await callRoute();

      expect(nextFunction).not.toHaveBeenCalled();
      expect(ProjectService.adjustBalance).toHaveBeenCalled();
    });
  });

  describe("the happy path", () => {
    it("passes the adjustment through to the service in cents", async () => {
      mockRequest.body = validBody();

      await callRoute();

      expect(nextFunction).not.toHaveBeenCalled();
      expect(ProjectService.adjustBalance).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: projectId,
          balanceType: ProjectBalanceType.SmsOrCall,
          adjustmentType: BalanceAdjustmentType.Add,
          amountInUSDCents: 2000,
          reason: "Goodwill credit agreed on ticket 4821",
        }),
      );
    });

    it("responds with the balance before and after", async () => {
      mockRequest.body = validBody();

      await callRoute();

      expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        {
          previousBalanceInUSDCents: 5000,
          newBalanceInUSDCents: 7000,
        },
      );
    });

    it.each([[ProjectBalanceType.SmsOrCall], [ProjectBalanceType.AI]])(
      "accepts the %s balance",
      async (balanceType: ProjectBalanceType) => {
        mockRequest.body = validBody({ balanceType });

        await callRoute();

        expect(nextFunction).not.toHaveBeenCalled();
        expect(ProjectService.adjustBalance).toHaveBeenCalledWith(
          expect.objectContaining({ balanceType }),
        );
      },
    );

    it.each([
      [BalanceAdjustmentType.Add],
      [BalanceAdjustmentType.Deduct],
      [BalanceAdjustmentType.Set],
    ])(
      "accepts the %s adjustment",
      async (adjustmentType: BalanceAdjustmentType) => {
        mockRequest.body = validBody({ adjustmentType });

        await callRoute();

        expect(nextFunction).not.toHaveBeenCalled();
        expect(ProjectService.adjustBalance).toHaveBeenCalledWith(
          expect.objectContaining({ adjustmentType }),
        );
      },
    );

    it("lets a Set of zero through, unlike an Add of zero", async () => {
      /*
       * "This project should have no balance" is a real instruction, so the
       * route must not treat the amount as missing. The service owns the rule
       * that Add and Deduct need a positive amount.
       */
      mockRequest.body = validBody({
        adjustmentType: BalanceAdjustmentType.Set,
        amountInUSD: 0,
      });

      await callRoute();

      expect(nextFunction).not.toHaveBeenCalled();
      expect(ProjectService.adjustBalance).toHaveBeenCalledWith(
        expect.objectContaining({ amountInUSDCents: 0 }),
      );
    });
  });

  describe("dollars to cents", () => {
    it.each([
      [20, 2000],
      [20.15, 2015],
      [0.01, 1],
      [1234.56, 123456],
      [99.99, 9999],
    ])(
      "converts %s USD to %s cents without floating point drift",
      async (amountInUSD: number, expectedCents: number) => {
        /*
         * 20.15 * 100 is 2014.9999999999998 in binary floating point. Left
         * untouched that truncates to 2014 - a cent short on every such
         * adjustment.
         */
        mockRequest.body = validBody({ amountInUSD });

        await callRoute();

        expect(ProjectService.adjustBalance).toHaveBeenCalledWith(
          expect.objectContaining({ amountInUSDCents: expectedCents }),
        );
      },
    );

    it("accepts a numeric string, since JSON bodies carry one", async () => {
      mockRequest.body = validBody({ amountInUSD: "20.15" });

      await callRoute();

      expect(nextFunction).not.toHaveBeenCalled();
      expect(ProjectService.adjustBalance).toHaveBeenCalledWith(
        expect.objectContaining({ amountInUSDCents: 2015 }),
      );
    });
  });

  describe("balance type validation", () => {
    it.each([
      ["missing", undefined],
      ["an unknown value", "Bitcoin"],
      ["an empty string", ""],
      ["a number", 1],
      ["an object", { type: "AI" }],
      ["an array", ["AI"]],
      ["a lowercase near-miss", "ai"],
    ])(
      "rejects a balance type that is %s",
      async (_label: string, balanceType: unknown) => {
        mockRequest.body = validBody({ balanceType });

        await callRoute();

        expect(nextFunction).toHaveBeenCalledWith(
          new BadDataException("Balance type must be one of: SmsOrCall, AI"),
        );
        expect(ProjectService.adjustBalance).not.toHaveBeenCalled();
      },
    );
  });

  describe("adjustment type validation", () => {
    it.each([
      ["missing", undefined],
      ["an unknown value", "Multiply"],
      ["an empty string", ""],
      ["a number", 1],
      ["an object", { type: "Add" }],
      ["a lowercase near-miss", "add"],
    ])(
      "rejects an adjustment type that is %s",
      async (_label: string, adjustmentType: unknown) => {
        mockRequest.body = validBody({ adjustmentType });

        await callRoute();

        expect(nextFunction).toHaveBeenCalledWith(
          new BadDataException(
            "Adjustment type must be one of: Add, Deduct, Set",
          ),
        );
        expect(ProjectService.adjustBalance).not.toHaveBeenCalled();
      },
    );
  });

  describe("amount validation", () => {
    it.each([
      ["missing", undefined],
      ["null", null],
      ["a boolean", true],
      ["an object", { amount: 20 }],
      ["an array", [20]],
    ])(
      "rejects an amount that is %s",
      async (_label: string, amountInUSD: unknown) => {
        /*
         * Number([]) is 0 and Number([20]) is 20 - a bare Number() coercion
         * would read these as real instructions, so the type is checked first.
         */
        mockRequest.body = validBody({ amountInUSD });

        await callRoute();

        expect(nextFunction).toHaveBeenCalledWith(
          new BadDataException("Amount is not a valid number"),
        );
        expect(ProjectService.adjustBalance).not.toHaveBeenCalled();
      },
    );

    it.each([
      ["an empty string", ""],
      ["whitespace only", "   "],
      ["not numeric", "twenty"],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
    ])(
      "rejects an amount that is %s",
      async (_label: string, amountInUSD: unknown) => {
        mockRequest.body = validBody({ amountInUSD });

        await callRoute();

        expect(nextFunction).toHaveBeenCalledWith(
          new BadDataException("Amount is not a valid number"),
        );
        expect(ProjectService.adjustBalance).not.toHaveBeenCalled();
      },
    );
  });

  describe("reason validation", () => {
    it.each([
      ["missing", undefined],
      ["empty", ""],
      ["whitespace only", "   "],
      ["a number", 42],
      ["an object", { reason: "because" }],
    ])(
      "rejects a reason that is %s",
      async (_label: string, reason: unknown) => {
        // The reason is the entire audit trail for the adjustment.
        mockRequest.body = validBody({ reason });

        await callRoute();

        expect(nextFunction).toHaveBeenCalledWith(
          new BadDataException("A reason is required to adjust the balance"),
        );
        expect(ProjectService.adjustBalance).not.toHaveBeenCalled();
      },
    );
  });

  describe("the request body", () => {
    it("rejects a body with no data object", async () => {
      mockRequest.body = {};

      await callRoute();

      expect(nextFunction).toHaveBeenCalledWith(
        new BadDataException("Balance type must be one of: SmsOrCall, AI"),
      );
      expect(ProjectService.adjustBalance).not.toHaveBeenCalled();
    });

    it("rejects an entirely absent body", async () => {
      mockRequest.body = undefined as unknown as JSON;

      await callRoute();

      expect(nextFunction).toHaveBeenCalledWith(
        new BadDataException("Balance type must be one of: SmsOrCall, AI"),
      );
      expect(ProjectService.adjustBalance).not.toHaveBeenCalled();
    });
  });

  describe("audit trail", () => {
    it("records which master admin moved the balance", async () => {
      const adminUserId: ObjectID = ObjectID.generate();

      jest
        .spyOn(UserMiddleware, "getAccessTokenFromExpressRequest")
        .mockReturnValue("a-master-admin-token");
      jest.spyOn(JSONWebToken, "decode").mockReturnValue({
        userId: adminUserId,
      } as JSONWebTokenData);

      mockRequest.body = validBody();

      await callRoute();

      expect(ProjectService.adjustBalance).toHaveBeenCalledWith(
        expect.objectContaining({ adjustedByUserId: adminUserId }),
      );
    });

    it("still adjusts when the acting admin cannot be resolved", async () => {
      /*
       * The identity is only used for the audit log line - the middleware has
       * already authorized the request, so a decode failure must not block it.
       */
      jest
        .spyOn(UserMiddleware, "getAccessTokenFromExpressRequest")
        .mockImplementation(() => {
          throw new Error("no cookie on this request");
        });

      mockRequest.body = validBody();

      await callRoute();

      expect(nextFunction).not.toHaveBeenCalled();
      expect(ProjectService.adjustBalance).toHaveBeenCalledWith(
        expect.objectContaining({ adjustedByUserId: undefined }),
      );
    });
  });

  describe("service errors", () => {
    it("forwards them to next and sends no response", async () => {
      const serviceError: BadDataException = new BadDataException(
        "Cannot deduct 50.01 USD - the balance is only 50 USD",
      );

      ProjectService.adjustBalance = jest.fn().mockRejectedValue(serviceError);

      mockRequest.body = validBody();

      await callRoute();

      expect(nextFunction).toHaveBeenCalledWith(serviceError);
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });
  });
});
