import ProjectAPI from "../../../Server/API/ProjectAPI";
import ProjectService from "../../../Server/Services/ProjectService";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import { mockRouter } from "./Helpers";
import { describe, expect, it } from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";
import BadDataException from "../../../Types/Exception/BadDataException";
import ProjectBalanceType from "../../../Types/Billing/ProjectBalanceType";
import BalanceAdjustmentType from "../../../Types/Billing/BalanceAdjustmentType";

/*
 * The self-hosted path. ProjectAPIAdjustBalance.test.ts module-mocks
 * IsBillingEnabled to true for its whole file, so the billing-disabled
 * behaviour needs its own module registry - hence a separate test file rather
 * than another describe.
 *
 * Self-hosted installs have no prepaid balances to correct: nothing meters
 * against them and nothing recharges them, so the whole feature is hidden in
 * the UI. The API must refuse too rather than trust that.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    IsBillingEnabled: false,
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

describe("Adjust balance when billing is disabled", () => {
  const billingDisabledError: BadDataException = new BadDataException(
    "Billing is not enabled for this server",
  );

  let mockRequest: OneUptimeRequest;
  let mockResponse: OneUptimeResponse;
  let nextFunction: NextFunction;

  beforeEach(() => {
    new ProjectAPI();
    mockRequest = {} as OneUptimeRequest;
    mockResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as OneUptimeResponse;
    nextFunction = jest.fn();

    mockRequest.params = { id: ObjectID.generate().toString() };
    mockRequest.body = {
      data: {
        balanceType: ProjectBalanceType.SmsOrCall,
        adjustmentType: BalanceAdjustmentType.Add,
        amountInUSD: 20,
        reason: "Goodwill credit",
      },
    };

    ProjectService.adjustBalance = jest.fn().mockResolvedValue({
      previousBalanceInUSDCents: 0,
      newBalanceInUSDCents: 2000,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("PUT /project/:id/adjust-balance", () => {
    it("rejects the request", async () => {
      await mockRouter
        .match("put", ROUTE)
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(billingDisabledError);
    });

    it("does not reach the service", async () => {
      await mockRouter
        .match("put", ROUTE)
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(ProjectService.adjustBalance).not.toHaveBeenCalled();
    });

    it("rejects before validating the request body", async () => {
      /*
       * A self-hosted admin poking the endpoint should be told billing is off,
       * not that their balance type is unrecognised.
       */
      mockRequest.body = {};

      await mockRouter
        .match("put", ROUTE)
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(billingDisabledError);
    });
  });

  describe("ProjectService.adjustBalance", () => {
    it("refuses to move a balance", async () => {
      /*
       * The real service, not the auto-mock: this asserts the guard inside
       * ProjectService itself, so the endpoint is not the only thing standing
       * between a self-hosted install and a balance write.
       */
      const realProjectService: typeof ProjectService = (
        jest.requireActual("../../../Server/Services/ProjectService") as {
          default: typeof ProjectService;
        }
      ).default;

      await expect(
        realProjectService.adjustBalance({
          projectId: ObjectID.generate(),
          balanceType: ProjectBalanceType.SmsOrCall,
          adjustmentType: BalanceAdjustmentType.Add,
          amountInUSDCents: 2000,
          reason: "Goodwill credit",
        }),
      ).rejects.toThrow("Billing is not enabled for this server");
    });

    it("refuses before it reads the project", async () => {
      const realProjectService: typeof ProjectService = (
        jest.requireActual("../../../Server/Services/ProjectService") as {
          default: typeof ProjectService;
        }
      ).default;

      const findOneById: jest.SpyInstance = jest.spyOn(
        realProjectService,
        "findOneById",
      );

      await expect(
        realProjectService.adjustBalance({
          projectId: ObjectID.generate(),
          balanceType: ProjectBalanceType.AI,
          adjustmentType: BalanceAdjustmentType.Set,
          amountInUSDCents: 0,
          reason: "Zeroing out",
        }),
      ).rejects.toThrow("Billing is not enabled for this server");

      expect(findOneById).not.toHaveBeenCalled();
    });
  });
});
