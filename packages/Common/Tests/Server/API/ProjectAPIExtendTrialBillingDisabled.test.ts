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
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";

/*
 * The self-hosted path. ProjectAPI.test.ts module-mocks IsBillingEnabled to
 * true for its whole file, so the billing-disabled behaviour needs its own
 * module registry - hence a separate test file rather than another describe.
 *
 * Self-hosted installs have no payment provider and no trials, so both the
 * route and the service must refuse rather than half-apply anything.
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

describe("Extend trial when billing is disabled", () => {
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

    ProjectService.extendTrial = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("PUT /project/:id/extend-trial", () => {
    it("should reject the request", async () => {
      mockRequest.params = { id: ObjectID.generate().toString() };
      mockRequest.body = { data: { trialEndsAt: "2027-01-15T00:00:00.000Z" } };

      await mockRouter
        .match("put", "/project/:id/extend-trial")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(billingDisabledError);
    });

    it("should not reach the service", async () => {
      mockRequest.params = { id: ObjectID.generate().toString() };
      mockRequest.body = { data: { trialEndsAt: "2027-01-15T00:00:00.000Z" } };

      await mockRouter
        .match("put", "/project/:id/extend-trial")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(ProjectService.extendTrial).not.toHaveBeenCalled();
    });

    it("should reject before validating the request body", async () => {
      /*
       * A self-hosted admin poking the endpoint should be told billing is off,
       * not that their date is malformed.
       */
      mockRequest.params = { id: ObjectID.generate().toString() };
      mockRequest.body = {};

      await mockRouter
        .match("put", "/project/:id/extend-trial")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(billingDisabledError);
    });
  });

  describe("ProjectService.extendTrial", () => {
    it("should refuse to extend a trial", async () => {
      /*
       * The real service, not the auto-mock: this asserts the guard inside
       * ProjectService itself, so the endpoint is not the only thing standing
       * between a self-hosted install and a payment-provider call.
       */
      const realProjectService: typeof ProjectService = (
        jest.requireActual("../../../Server/Services/ProjectService") as {
          default: typeof ProjectService;
        }
      ).default;

      await expect(
        realProjectService.extendTrial({
          projectId: ObjectID.generate(),
          trialEndsAt: OneUptimeDate.getSomeDaysAfter(30),
        }),
      ).rejects.toThrow("Billing is not enabled for this server");
    });
  });
});
