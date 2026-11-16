import ProjectAPI from "../../../Server/API/ProjectAPI";
import BillingInvoiceService, {
  BILLING_DISABLED_NO_INVOICES_MESSAGE,
} from "../../../Server/Services/BillingInvoiceService";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The self-hosted path of the Admin Dashboard's invoice routes. A server
 * without billing has no payment provider and no invoices, so both routes
 * refuse before reading or voiding anything. IsBillingEnabled is
 * module-mocked per file, so this is a file of its own
 * (ProjectAPIAdminInvoices.test.ts has billing on).
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    IsBillingEnabled: false,
  };
});

jest.mock("../../../Server/Services/BillingService");
jest.mock("../../../Server/Services/BillingInvoiceService");
jest.mock("../../../Server/Services/TeamMemberService");
jest.mock("../../../Server/Services/ProjectService");

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

describe("ProjectAPI's admin invoice routes without billing", () => {
  let mockRequest: OneUptimeRequest;
  let mockResponse: OneUptimeResponse;
  let nextFunction: jest.Mock;

  beforeEach(() => {
    new ProjectAPI();

    mockRequest = {
      params: { id: ObjectID.generate().toString() },
      body: { data: { paymentProviderInvoiceId: "in_plan_nov" } },
    } as unknown as OneUptimeRequest;
    mockResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as OneUptimeResponse;
    nextFunction = jest.fn();

    BillingInvoiceService.getInvoicesForAdmin = jest.fn() as never;
    BillingInvoiceService.voidInvoiceForProject = jest.fn() as never;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("lists no invoices: there are none to list", async () => {
    await mockRouter
      .match("get", "/project/:id/admin-invoices")
      .handlerFunction(mockRequest, mockResponse, nextFunction as NextFunction);

    expect(nextFunction).toHaveBeenCalledWith(
      new BadDataException(BILLING_DISABLED_NO_INVOICES_MESSAGE),
    );
    expect(BillingInvoiceService.getInvoicesForAdmin).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  it("voids nothing", async () => {
    await mockRouter
      .match("put", "/project/:id/admin-void-invoice")
      .handlerFunction(mockRequest, mockResponse, nextFunction as NextFunction);

    expect(nextFunction).toHaveBeenCalledWith(
      new BadDataException(BILLING_DISABLED_NO_INVOICES_MESSAGE),
    );
    expect(BillingInvoiceService.voidInvoiceForProject).not.toHaveBeenCalled();
    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  });
});
