import BillingAPI from "../../../Server/API/BillingAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import PayAsYouGoBillingService, {
  Service,
} from "../../../Server/Services/PayAsYouGoBillingService";
import BillingService from "../../../Server/Services/BillingService";
import ProjectService from "../../../Server/Services/ProjectService";
import Project from "../../../Models/DatabaseModels/Project";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import { mockRouter } from "./Helpers";

jest.mock("../../../Server/Services/BillingService", () => {
  return {
    __esModule: true,
    default: { isBillingEnabled: jest.fn(), hasPaymentMethods: jest.fn() },
  };
});
jest.mock("../../../Server/Services/ProjectService", () => {
  return { __esModule: true, default: { findOneById: jest.fn() } };
});
jest.mock("../../../Server/Services/PromoCodeService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});
jest.mock("../../../Server/API/CommonAPI", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
      requireUserAuthentication: jest.fn(),
    },
  };
});
jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});
jest.mock("../../../Server/Utils/Response", () => {
  return { __esModule: true, default: { sendJsonObjectResponse: jest.fn() } };
});

describe("GET /billing/pay-as-you-go-status", () => {
  const projectId: ObjectID = ObjectID.generate();
  let req: OneUptimeRequest;
  let res: OneUptimeResponse;
  let next: NextFunction;

  const requestStatus: () => Promise<void> = async (): Promise<void> => {
    await mockRouter
      .match("get", "/billing/pay-as-you-go-status")
      .handlerFunction(req, res, next);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    new BillingAPI();
    req = { tenantId: projectId } as OneUptimeRequest;
    res = {} as OneUptimeResponse;
    next = jest.fn();
    jest
      .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
      .mockResolvedValue(false);
    jest
      .spyOn(BillingAPI.prototype, "getPermissionsForTenant")
      .mockResolvedValue([
        { permission: Permission.ProjectMember } as UserPermission,
      ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * A Dashboard tab left open past the access-token lifetime asks for these
   * with no session at all (the cookie expires with the token), and
   * getUserMiddleware lets that request through as Public.
   * requireUserAuthentication is what answers it with the 401 that makes the
   * browser client refresh the session and retry, instead of the handler's
   * "You do not have access to this project" 400.
   */
  it.each(["/billing/pay-as-you-go-status", "/billing/customer-balance"])(
    "registers %s behind the user middleware and the authentication guard",
    (uri: string) => {
      expect(mockRouter.match("get", uri).middlewares).toStrictEqual([
        UserMiddleware.getUserMiddleware,
        UserMiddleware.requireUserAuthentication,
      ]);
    },
  );

  it.each([true, false])(
    "returns only the feature eligibility (%s) to a project member",
    async (isAllowed: boolean) => {
      jest
        .mocked(PayAsYouGoBillingService.canUsePayAsYouGo)
        .mockResolvedValue(isAllowed);
      await requestStatus();
      expect(PayAsYouGoBillingService.canUsePayAsYouGo).toHaveBeenCalledWith(
        projectId,
      );
      expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(req, res, {
        isAllowed,
      });
      expect(next).not.toHaveBeenCalled();
    },
  );

  it.each([
    PlanType.Free,
    PlanType.Growth,
    PlanType.Scale,
    PlanType.Enterprise,
  ])(
    "returns the real %s plan eligibility without a payment method",
    async (plan: PlanType) => {
      const service: Service = new Service();
      jest.mocked(BillingService.isBillingEnabled).mockReturnValue(true);
      jest.mocked(BillingService.hasPaymentMethods).mockResolvedValue(false);
      jest.mocked(ProjectService.findOneById).mockResolvedValue(
        Object.assign(new Project(), {
          paymentProviderPlanId: plan,
          paymentProviderCustomerId: "cus_status_project",
        }),
      );
      jest
        .spyOn(SubscriptionPlan, "getSubscriptionPlanById")
        .mockReturnValue(
          new SubscriptionPlan(plan, `${plan}_yearly`, plan, 0, 0, 0, 0),
        );
      jest
        .mocked(PayAsYouGoBillingService.canUsePayAsYouGo)
        .mockImplementation((id: ObjectID): Promise<boolean> => {
          return service.canUsePayAsYouGo(id);
        });

      await requestStatus();

      expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(req, res, {
        isAllowed: plan !== PlanType.Free,
      });
      expect(ProjectService.findOneById).toHaveBeenCalledWith(
        expect.objectContaining({ id: projectId }),
      );
      expect(next).not.toHaveBeenCalled();
      if (plan === PlanType.Free) {
        expect(BillingService.hasPaymentMethods).toHaveBeenCalledWith(
          "cus_status_project",
        );
      } else {
        expect(BillingService.hasPaymentMethods).not.toHaveBeenCalled();
      }
    },
  );

  it("requires a selected project", async () => {
    req = {} as OneUptimeRequest;
    await requestStatus();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Project ID is required" }),
    );
    expect(PayAsYouGoBillingService.canUsePayAsYouGo).not.toHaveBeenCalled();
  });

  it("requires project membership", async () => {
    jest
      .spyOn(BillingAPI.prototype, "getPermissionsForTenant")
      .mockResolvedValue([]);
    await requestStatus();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "You do not have access to this project",
      }),
    );
    expect(PayAsYouGoBillingService.canUsePayAsYouGo).not.toHaveBeenCalled();
  });

  it("propagates provider failures instead of incorrectly granting access", async () => {
    const error: Error = new Error("Billing unavailable");
    jest
      .mocked(PayAsYouGoBillingService.canUsePayAsYouGo)
      .mockRejectedValue(error);
    await requestStatus();
    expect(next).toHaveBeenCalledWith(error);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
