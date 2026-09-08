import BillingAPI from "../../../Server/API/BillingAPI";
import PayAsYouGoBillingService from "../../../Server/Services/PayAsYouGoBillingService";
import { NextFunction, OneUptimeRequest, OneUptimeResponse } from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { mockRouter } from "./Helpers";

jest.mock("../../../Server/Services/BillingService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../Server/Services/ProjectService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../Server/API/CommonAPI", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../Server/Middleware/UserAuthorization", () => {
  return { __esModule: true, default: { getUserMiddleware: jest.fn() } };
});
jest.mock("../../../Server/Utils/Express", () => {
  return { getRouter: () => { return mockRouter; } };
});
jest.mock("../../../Server/Services/PayAsYouGoBillingService", () => {
  return { __esModule: true, default: { canUsePayAsYouGo: jest.fn() } };
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
    await mockRouter.match("get", "/billing/pay-as-you-go-status")
      .handlerFunction(req, res, next);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    new BillingAPI();
    req = { tenantId: projectId } as OneUptimeRequest;
    res = {} as OneUptimeResponse;
    next = jest.fn();
    jest.spyOn(BillingAPI.prototype, "getPermissionsForTenant").mockResolvedValue([
      { permission: Permission.ProjectMember } as UserPermission,
    ]);
  });

  afterEach(() => { jest.restoreAllMocks(); });

  it.each([true, false])("returns only the feature eligibility (%s) to a project member", async (isAllowed: boolean) => {
    jest.mocked(PayAsYouGoBillingService.canUsePayAsYouGo).mockResolvedValue(isAllowed);
    await requestStatus();
    expect(PayAsYouGoBillingService.canUsePayAsYouGo).toHaveBeenCalledWith(projectId);
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(req, res, { isAllowed });
    expect(next).not.toHaveBeenCalled();
  });

  it("requires a selected project", async () => {
    req = {} as OneUptimeRequest;
    await requestStatus();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: "Project ID is required" }));
    expect(PayAsYouGoBillingService.canUsePayAsYouGo).not.toHaveBeenCalled();
  });

  it("requires project membership", async () => {
    jest.spyOn(BillingAPI.prototype, "getPermissionsForTenant").mockResolvedValue([]);
    await requestStatus();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: "You do not have access to this project" }));
    expect(PayAsYouGoBillingService.canUsePayAsYouGo).not.toHaveBeenCalled();
  });

  it("propagates provider failures instead of incorrectly granting access", async () => {
    const error: Error = new Error("Billing unavailable");
    jest.mocked(PayAsYouGoBillingService.canUsePayAsYouGo).mockRejectedValue(error);
    await requestStatus();
    expect(next).toHaveBeenCalledWith(error);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
