import ProjectAPI from "../../../Server/API/ProjectAPI";
import MasterAdminAuthorization from "../../../Server/Middleware/MasterAdminAuthorization";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import ProjectService from "../../../Server/Services/ProjectService";
import Errors from "../../../Server/Utils/Errors";
import logger from "../../../Server/Utils/Logger";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";
import Project from "../../../Models/DatabaseModels/Project";
import BadDataException from "../../../Types/Exception/BadDataException";
import { isErrorSentence } from "../../../Types/Exception/ErrorMessageRule";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";

/*
 * PUT /project/:id/admin-change-plan: a master admin moves a project to
 * another plan from the Admin Dashboard (issue #6771).
 *
 * What is load-bearing, and held here: only a master admin session reaches
 * it (not a project's billing permissions, not the static master API key);
 * it needs no tenant, since staff act on projects they are not members of;
 * nothing reaches the plan change but a plan this server offers, for a
 * project that exists, that is not the plan the project is already on; the
 * move itself is ProjectService.changePlan - the customer's own; a project
 * with no payment method is explained to the admin in the admin's words;
 * and who moved the project is written to the log.
 */

/*
 * Whether billing is on, read when the route runs. On globalThis, as the
 * other billing route suites keep it: the mock factory below runs before
 * this file's own variables exist.
 */
type MockBillingGlobal = typeof globalThis & {
  __adminChangePlanBillingEnabled: boolean;
};

function setBillingEnabled(isEnabled: boolean): void {
  (globalThis as MockBillingGlobal).__adminChangePlanBillingEnabled = isEnabled;
}

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: MockBillingGlobal = globalThis as MockBillingGlobal;
  mockGlobal.__adminChangePlanBillingEnabled = true;

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__adminChangePlanBillingEnabled;
    },
  });

  return mocked;
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

const ROUTE: string = "/project/:id/admin-change-plan";

// As configured on OneUptime cloud: Free costs nothing either way.
const PLAN_ENV: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

describe("PUT /project/:id/admin-change-plan", () => {
  const projectId: ObjectID = ObjectID.generate();

  let mockRequest: OneUptimeRequest;
  let mockResponse: OneUptimeResponse;
  let nextFunction: NextFunction;

  // The plan the project is on, as its row says.
  let currentPlanId: string | undefined;

  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const [key, value] of Object.entries(PLAN_ENV)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }
  });

  afterAll(() => {
    for (const key of Object.keys(PLAN_ENV)) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  async function callRoute(): Promise<void> {
    await mockRouter
      .match("put", ROUTE)
      .handlerFunction(mockRequest, mockResponse, nextFunction);
  }

  // What the route answered with, when it refused.
  function refusal(): Error | undefined {
    return (nextFunction as unknown as jest.Mock).mock.calls[0]?.[0] as
      | Error
      | undefined;
  }

  beforeEach(() => {
    new ProjectAPI();
    setBillingEnabled(true);
    currentPlanId = "price_free_month";

    mockRequest = {} as OneUptimeRequest;
    mockResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as OneUptimeResponse;
    nextFunction = jest.fn();

    mockRequest.params = { id: projectId.toString() };
    mockRequest.body = { data: { paymentProviderPlanId: "price_growth_year" } };

    ProjectService.findOneById = jest
      .fn()
      .mockImplementation(async (): Promise<Project> => {
        const project: Project = new Project();
        project._id = projectId.toString();

        if (currentPlanId) {
          project.paymentProviderPlanId = currentPlanId;
        }

        return project;
      }) as typeof ProjectService.findOneById;

    ProjectService.changePlan = jest
      .fn()
      .mockResolvedValue(undefined) as typeof ProjectService.changePlan;

    /*
     * Response is module-mocked once for the whole file, so its call log
     * would otherwise carry over between tests.
     */
    (Response.sendEmptySuccessResponse as jest.Mock).mockClear();

    // The audit line, kept off the test output; the audit tests read it.
    jest.spyOn(logger, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("who may call it", () => {
    it("sits behind the master admin middleware, and nothing else", () => {
      /*
       * Moving a project to another plan changes what its customer is
       * billed: not reachable with a project's billing permissions, and not
       * with the static master API key either - only a master admin session.
       */
      expect(mockRouter.match("put", ROUTE).middlewares).toEqual([
        MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      ]);
    });

    it("needs no tenant, since master admins act on projects they are not in", async () => {
      delete (mockRequest as { tenantId?: ObjectID }).tenantId;

      await callRoute();

      expect(nextFunction).not.toHaveBeenCalled();
      expect(ProjectService.changePlan).toHaveBeenCalled();
    });
  });

  describe("the move", () => {
    it("moves the project to the plan picked, as the customer's own plan change does", async () => {
      await callRoute();

      expect(nextFunction).not.toHaveBeenCalled();
      expect(ProjectService.changePlan).toHaveBeenCalledTimes(1);
      expect(ProjectService.changePlan).toHaveBeenCalledWith({
        projectId: projectId,
        paymentProviderPlanId: "price_growth_year",
        requirePaymentMethod: false,
      });
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
      );
    });

    it("reads the project it moves as OneUptime, not as the admin", async () => {
      await callRoute();

      expect(ProjectService.findOneById).toHaveBeenCalledWith({
        id: projectId,
        select: { paymentProviderPlanId: true },
        props: { isRoot: true },
      });
    });

    it("takes the plan id as sent, without the spaces around it", async () => {
      mockRequest.body = {
        data: { paymentProviderPlanId: "  price_scale_month  " },
      };

      await callRoute();

      expect(ProjectService.changePlan).toHaveBeenCalledWith({
        projectId: projectId,
        paymentProviderPlanId: "price_scale_month",
        requirePaymentMethod: false,
      });
    });

    it("can move a project to the custom-priced plan, which only staff set", async () => {
      mockRequest.body = {
        data: { paymentProviderPlanId: "price_enterprise_month" },
      };

      await callRoute();

      expect(nextFunction).not.toHaveBeenCalled();
      expect(ProjectService.changePlan).toHaveBeenCalledWith({
        projectId: projectId,
        paymentProviderPlanId: "price_enterprise_month",
        requirePaymentMethod: false,
      });
    });

    it("can move a paid project down to Free", async () => {
      currentPlanId = "price_scale_year";
      mockRequest.body = {
        data: { paymentProviderPlanId: "price_free_month" },
      };

      await callRoute();

      expect(nextFunction).not.toHaveBeenCalled();
      expect(ProjectService.changePlan).toHaveBeenCalledWith({
        projectId: projectId,
        paymentProviderPlanId: "price_free_month",
        requirePaymentMethod: false,
      });
    });

    it("can move a project that has no plan yet", async () => {
      currentPlanId = undefined;

      await callRoute();

      expect(nextFunction).not.toHaveBeenCalled();
      expect(ProjectService.changePlan).toHaveBeenCalled();
    });

    it("moves a paid plan to its other billing period: that is a change", async () => {
      currentPlanId = "price_growth_month";
      mockRequest.body = {
        data: { paymentProviderPlanId: "price_growth_year" },
      };

      await callRoute();

      expect(nextFunction).not.toHaveBeenCalled();
      expect(ProjectService.changePlan).toHaveBeenCalledWith({
        projectId: projectId,
        paymentProviderPlanId: "price_growth_year",
        requirePaymentMethod: false,
      });
    });
  });

  describe("what it refuses, before anything is changed", () => {
    it("everything, when billing is off: there is no plan to change", async () => {
      setBillingEnabled(false);

      await callRoute();

      expect(refusal()).toEqual(
        new BadDataException(
          "Billing is not enabled on this server, so projects have no plan to change.",
        ),
      );
      expect(ProjectService.findOneById).not.toHaveBeenCalled();
      expect(ProjectService.changePlan).not.toHaveBeenCalled();
    });

    it.each([["not-a-project-id"], [""], ['\'; DROP TABLE "Project"; --']])(
      "a project id that is not one: %p",
      async (id: string) => {
        mockRequest.params = { id: id };

        await callRoute();

        expect(refusal()).toEqual(
          new BadDataException(
            "The project ID in the address is not valid. Open the project from the Projects list, then try again.",
          ),
        );
        expect(ProjectService.findOneById).not.toHaveBeenCalled();
        expect(ProjectService.changePlan).not.toHaveBeenCalled();
      },
    );

    it.each([
      ["no data", {}],
      ["no plan", { data: {} }],
      ["an empty plan", { data: { paymentProviderPlanId: "" } }],
      ["a blank plan", { data: { paymentProviderPlanId: "   " } }],
      ["a number", { data: { paymentProviderPlanId: 42 } }],
      ["an object", { data: { paymentProviderPlanId: { id: "price" } } }],
      ["a list", { data: { paymentProviderPlanId: ["price_growth_year"] } }],
      ["null", { data: { paymentProviderPlanId: null } }],
    ])("%s as the plan", async (_name: string, body: unknown) => {
      mockRequest.body = body as OneUptimeRequest["body"];

      await callRoute();

      expect(refusal()).toEqual(
        new BadDataException("Choose the plan to move this project to."),
      );
      expect(ProjectService.changePlan).not.toHaveBeenCalled();
    });

    it("a plan this server does not offer", async () => {
      mockRequest.body = { data: { paymentProviderPlanId: "price_unknown" } };

      await callRoute();

      expect(refusal()).toEqual(
        new BadDataException(
          "That plan is not one this server offers. Choose one of the plans shown, then try again.",
        ),
      );
      expect(ProjectService.findOneById).not.toHaveBeenCalled();
      expect(ProjectService.changePlan).not.toHaveBeenCalled();
    });

    it("a project that does not exist", async () => {
      ProjectService.findOneById = jest
        .fn()
        .mockResolvedValue(null) as typeof ProjectService.findOneById;

      await callRoute();

      expect(refusal()).toEqual(
        new BadDataException(
          "This project no longer exists. It may have been deleted.",
        ),
      );
      expect(ProjectService.changePlan).not.toHaveBeenCalled();
    });

    it.each([
      ["the very plan it is on", "price_growth_year", "price_growth_year"],
      // Free costs nothing either way, so its other period is no change.
      [
        "Free at the other billing period",
        "price_free_month",
        "price_free_year",
      ],
    ])(
      "%s",
      async (_name: string, current: string, picked: string): Promise<void> => {
        currentPlanId = current;
        mockRequest.body = { data: { paymentProviderPlanId: picked } };

        await callRoute();

        expect(refusal()).toEqual(
          new BadDataException(
            "This project is already on that plan. Choose another plan to move it to.",
          ),
        );
        expect(ProjectService.changePlan).not.toHaveBeenCalled();
      },
    );
  });

  describe("when the plan change fails", () => {
    it("never asks the customer for a payment method: staff move the project whatever is on file", async () => {
      await callRoute();

      expect(ProjectService.changePlan).toHaveBeenCalledWith(
        expect.objectContaining({ requirePaymentMethod: false }),
      );
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalled();
    });

    it("hands a payment provider's refusal on as it came", async () => {
      const failure: BadDataException = new BadDataException(
        Errors.BillingService.NO_PAYMENTS_METHODS,
      );

      ProjectService.changePlan = jest
        .fn()
        .mockRejectedValue(failure) as typeof ProjectService.changePlan;

      await callRoute();

      expect(refusal()).toBe(failure);
      expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
    });

    it("hands any other failure on as it came", async () => {
      const failure: BadDataException = new BadDataException(
        "Payment Provider subscription not found",
      );

      ProjectService.changePlan = jest
        .fn()
        .mockRejectedValue(failure) as typeof ProjectService.changePlan;

      await callRoute();

      expect(refusal()).toBe(failure);
      expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
    });

    it("hands on an unexpected error too, rather than reporting a change", async () => {
      const failure: Error = new Error("Stripe is unreachable");

      ProjectService.changePlan = jest
        .fn()
        .mockRejectedValue(failure) as typeof ProjectService.changePlan;

      await callRoute();

      expect(refusal()).toBe(failure);
      expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
    });
  });

  describe("the audit trail", () => {
    it("logs which master admin moved the project, from which plan to which", async () => {
      const adminUserId: ObjectID = ObjectID.generate();
      const info: jest.SpyInstance = jest
        .spyOn(logger, "info")
        .mockImplementation(() => {});

      jest
        .spyOn(UserMiddleware, "getAccessTokenFromExpressRequest")
        .mockReturnValue("a-master-admin-token");
      jest.spyOn(JSONWebToken, "decode").mockReturnValue({
        userId: adminUserId,
      } as JSONWebTokenData);

      await callRoute();

      expect(info).toHaveBeenCalledWith(
        `Plan for project ${projectId.toString()} changed from price_free_month to price_growth_year by master admin ${adminUserId.toString()}`,
      );
    });

    it("still moves the project when the acting admin cannot be read", async () => {
      const info: jest.SpyInstance = jest
        .spyOn(logger, "info")
        .mockImplementation(() => {});

      jest
        .spyOn(UserMiddleware, "getAccessTokenFromExpressRequest")
        .mockImplementation(() => {
          throw new Error("no cookie on this request");
        });

      await callRoute();

      expect(nextFunction).not.toHaveBeenCalled();
      expect(ProjectService.changePlan).toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith(
        `Plan for project ${projectId.toString()} changed from price_free_month to price_growth_year by master admin unknown`,
      );
    });

    it("logs nothing when the plan was not changed", async () => {
      const info: jest.SpyInstance = jest
        .spyOn(logger, "info")
        .mockImplementation(() => {});

      ProjectService.changePlan = jest
        .fn()
        .mockRejectedValue(
          new BadDataException("Payment Provider subscription not found"),
        ) as typeof ProjectService.changePlan;

      await callRoute();

      expect(info).not.toHaveBeenCalledWith(
        expect.stringContaining("Plan for project"),
      );
    });
  });

  // UX rule: an error says what happened and what to do next, as a sentence.
  it("says every refusal of its own as a sentence", () => {
    for (const message of [
      "Billing is not enabled on this server, so projects have no plan to change.",
      "The project ID in the address is not valid. Open the project from the Projects list, then try again.",
      "Choose the plan to move this project to.",
      "That plan is not one this server offers. Choose one of the plans shown, then try again.",
      "This project no longer exists. It may have been deleted.",
      "This project is already on that plan. Choose another plan to move it to.",
    ]) {
      expect({ message, isSentence: isErrorSentence(message) }).toEqual({
        message,
        isSentence: true,
      });
    }
  });
});
