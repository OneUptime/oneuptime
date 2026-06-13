import ResellerPlanAPI from "../../../Server/API/ResellerPlanAPI";
import ProjectService from "../../../Server/Services/ProjectService";
import ResellerPlanService from "../../../Server/Services/ResellerPlanService";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import { describe, expect, it } from "@jest/globals";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Project from "../../../Models/DatabaseModels/Project";
import ResellerPlan from "../../../Models/DatabaseModels/ResellerPlan";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

jest.mock("../../../Server/Services/ResellerPlanService");
jest.mock("../../../Server/Services/ProjectService");
jest.mock("../../../Server/Services/BillingService");
jest.mock("../../../Server/Services/PromoCodeService");

describe("ResellerPlanAPI", () => {
  let mockRequest: OneUptimeRequest;
  let mockResponse: OneUptimeResponse;
  let nextFunction: NextFunction;

  const resellerExternalId: string = "reseller_a";
  const resellerObjectId: ObjectID = ObjectID.generate();
  const resellerPlanObjectId: ObjectID = ObjectID.generate();
  const projectObjectId: ObjectID = ObjectID.generate();
  const licenseKey: string = "license_123";

  const mockResellerPlan: ResellerPlan = {
    id: resellerPlanObjectId,
    planId: "plan_basic",
    reseller: {
      id: resellerObjectId,
      resellerId: resellerExternalId,
    },
    monitorLimit: 10,
    teamMemberLimit: 5,
  } as unknown as ResellerPlan;

  beforeEach(() => {
    new ResellerPlanAPI();

    ResellerPlanService.findOneBy = jest
      .fn()
      .mockResolvedValue(mockResellerPlan);
    ProjectService.findOneBy = jest.fn().mockResolvedValue(null);
    ProjectService.updateOneById = jest.fn().mockResolvedValue(undefined);
    ProjectService.deleteOneBy = jest.fn().mockResolvedValue(undefined);

    mockRequest = {
      params: { resellerId: resellerExternalId },
      bearerTokenData: { resellerId: resellerExternalId },
      body: {
        action: "enhance_tier",
        plan_id: "plan_basic",
        uuid: licenseKey,
        activation_email: "customer@example.com",
      },
    } as unknown as OneUptimeRequest;
    mockResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as OneUptimeResponse;
    nextFunction = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("POST /reseller-plan/action/:resellerId", () => {
    it("should scope the project lookup to the authenticated reseller on tier change", async () => {
      await mockRouter
        .match("post", "/reseller-plan/action/:resellerId")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(ProjectService.findOneBy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            resellerLicenseId: licenseKey,
            resellerId: resellerObjectId,
          },
        }),
      );
      // license key belongs to another reseller -> scoped lookup finds nothing.
      expect(nextFunction).toHaveBeenCalledWith(
        new BadDataException("Project not found with this license key"),
      );
      expect(ProjectService.updateOneById).not.toHaveBeenCalled();
    });

    it("should not delete another reseller's project on refund", async () => {
      mockRequest.body["action"] = "refund";

      await mockRouter
        .match("post", "/reseller-plan/action/:resellerId")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(ProjectService.findOneBy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            resellerLicenseId: licenseKey,
            resellerId: resellerObjectId,
          },
        }),
      );
      expect(ProjectService.deleteOneBy).not.toHaveBeenCalled();
      // refund is idempotent: respond as refunded without deleting anything.
      expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        {
          message: "product refunded",
        },
      );
    });

    it("should update limits for the owning reseller's project", async () => {
      ProjectService.findOneBy = jest.fn().mockResolvedValue({
        id: projectObjectId,
      } as Project);

      await mockRouter
        .match("post", "/reseller-plan/action/:resellerId")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(ProjectService.updateOneById).toHaveBeenCalledWith(
        expect.objectContaining({
          id: projectObjectId,
          data: {
            activeMonitorsLimit: 10,
            seatLimit: 5,
            resellerPlanId: resellerPlanObjectId,
          },
        }),
      );
      expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        {
          message: "product enhanced",
        },
      );
    });

    it("should delete the owning reseller's project on refund with a reseller-scoped query", async () => {
      mockRequest.body["action"] = "refund";
      ProjectService.findOneBy = jest.fn().mockResolvedValue({
        id: projectObjectId,
      } as Project);

      await mockRouter
        .match("post", "/reseller-plan/action/:resellerId")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(ProjectService.deleteOneBy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            resellerLicenseId: licenseKey,
            resellerId: resellerObjectId,
            _id: projectObjectId.toString(),
          },
        }),
      );
      expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        {
          message: "product refunded",
        },
      );
    });
  });
});
