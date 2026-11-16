import ProjectAPI, {
  ADMIN_INVOICE_ID_NOT_VALID_MESSAGE,
  ADMIN_PROJECT_ID_NOT_VALID_MESSAGE,
} from "../../../Server/API/ProjectAPI";
import MasterAdminAuthorization from "../../../Server/Middleware/MasterAdminAuthorization";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import BillingInvoiceService from "../../../Server/Services/BillingInvoiceService";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import { InvoiceStatus } from "../../../Models/DatabaseModels/BillingInvoice";
import {
  AdminProjectInvoice,
  InvoiceBilledFor,
} from "../../../Types/Billing/AdminProjectInvoice";
import BadDataException from "../../../Types/Exception/BadDataException";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The Admin Dashboard's Invoices page: list a project's invoices, and void
 * one. Both are master-admin only - voiding waives what a customer owes, so
 * project-level billing permissions must not reach it - and both take the
 * project from the address and nothing else, refusing an id that is not one.
 */

// The server without billing is ProjectAPIAdminInvoicesBillingDisabled.test.ts.
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    IsBillingEnabled: true,
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

const LIST_ROUTE: string = "/project/:id/admin-invoices";
const VOID_ROUTE: string = "/project/:id/admin-void-invoice";

describe("ProjectAPI's admin invoice routes", () => {
  let mockRequest: OneUptimeRequest;
  let mockResponse: OneUptimeResponse;
  let nextFunction: jest.Mock;
  const projectId: ObjectID = ObjectID.generate();

  beforeEach(() => {
    new ProjectAPI();

    mockRequest = {
      params: { id: projectId.toString() },
    } as unknown as OneUptimeRequest;
    mockResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as OneUptimeResponse;
    nextFunction = jest.fn();

    (Response.sendJsonObjectResponse as jest.Mock).mockClear();
    (Response.sendEmptySuccessResponse as jest.Mock).mockClear();

    BillingInvoiceService.getInvoicesForAdmin = jest
      .fn()
      .mockResolvedValue([]) as never;
    BillingInvoiceService.voidInvoiceForProject = jest
      .fn()
      .mockResolvedValue(undefined) as never;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  type RunFunction = (method: "get" | "put", route: string) => Promise<void>;

  const run: RunFunction = async (
    method: "get" | "put",
    route: string,
  ): Promise<void> => {
    await mockRouter
      .match(method, route)
      .handlerFunction(mockRequest, mockResponse, nextFunction as NextFunction);
  };

  describe("GET /project/:id/admin-invoices", () => {
    it("sits behind the master admin middleware", () => {
      expect(mockRouter.match("get", LIST_ROUTE).middleware).toBe(
        MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      );
    });

    it("answers the project's invoices as the page reads them", async () => {
      const invoices: Array<AdminProjectInvoice> = [
        {
          id: "in_plan_nov",
          invoiceNumber: "ACME-0007",
          invoiceDate: "2026-11-13T20:31:00.000Z",
          amount: 2200,
          currencyCode: "usd",
          status: InvoiceStatus.Open,
          downloadableLink: "https://pay.stripe.com/invoice/in_plan_nov/pdf",
          billedFor: InvoiceBilledFor.Plan,
        },
        {
          id: "in_draft",
          invoiceDate: "2026-11-14T00:00:00.000Z",
          amount: 0,
          currencyCode: "usd",
          status: InvoiceStatus.Draft,
        },
      ];

      BillingInvoiceService.getInvoicesForAdmin = jest
        .fn()
        .mockResolvedValue(invoices) as never;

      await run("get", LIST_ROUTE);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(BillingInvoiceService.getInvoicesForAdmin).toHaveBeenCalledWith(
        projectId,
      );
      expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        {
          invoices: [
            {
              id: "in_plan_nov",
              invoiceNumber: "ACME-0007",
              invoiceDate: "2026-11-13T20:31:00.000Z",
              amount: 2200,
              currencyCode: "usd",
              status: InvoiceStatus.Open,
              downloadableLink:
                "https://pay.stripe.com/invoice/in_plan_nov/pdf",
              billedFor: InvoiceBilledFor.Plan,
            },
            {
              id: "in_draft",
              invoiceDate: "2026-11-14T00:00:00.000Z",
              amount: 0,
              currencyCode: "usd",
              status: InvoiceStatus.Draft,
            },
          ],
        },
      );
    });

    it.each(["not-a-project", "", "123"])(
      "refuses the project id %p in the address",
      async (id: string) => {
        mockRequest.params = { id: id };

        await run("get", LIST_ROUTE);

        expect(nextFunction).toHaveBeenCalledWith(
          new BadDataException(ADMIN_PROJECT_ID_NOT_VALID_MESSAGE),
        );
        expect(
          BillingInvoiceService.getInvoicesForAdmin,
        ).not.toHaveBeenCalled();
      },
    );

    it("passes the service's errors on", async () => {
      const serviceError: Error = new Error("Stripe is down");

      BillingInvoiceService.getInvoicesForAdmin = jest
        .fn()
        .mockRejectedValue(serviceError) as never;

      await run("get", LIST_ROUTE);

      expect(nextFunction).toHaveBeenCalledWith(serviceError);
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });
  });

  describe("PUT /project/:id/admin-void-invoice", () => {
    it("sits behind the master admin middleware", () => {
      expect(mockRouter.match("put", VOID_ROUTE).middleware).toBe(
        MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      );
    });

    it("voids the invoice it names, of the project in the address", async () => {
      mockRequest.body = {
        data: { paymentProviderInvoiceId: " in_plan_nov " },
      };

      await run("put", VOID_ROUTE);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(BillingInvoiceService.voidInvoiceForProject).toHaveBeenCalledWith({
        projectId: projectId,
        paymentProviderInvoiceId: "in_plan_nov",
        voidedByUserId: undefined,
      });
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
      );
    });

    it("records which master admin voided it", async () => {
      const adminUserId: ObjectID = ObjectID.generate();

      jest
        .spyOn(UserMiddleware, "getAccessTokenFromExpressRequest")
        .mockReturnValue("a-master-admin-token");
      jest.spyOn(JSONWebToken, "decode").mockReturnValue({
        userId: adminUserId,
      } as JSONWebTokenData);

      mockRequest.body = { data: { paymentProviderInvoiceId: "in_plan_nov" } };

      await run("put", VOID_ROUTE);

      expect(BillingInvoiceService.voidInvoiceForProject).toHaveBeenCalledWith(
        expect.objectContaining({ voidedByUserId: adminUserId }),
      );
    });

    it("still voids when the acting admin cannot be read: the middleware already let them in", async () => {
      jest
        .spyOn(UserMiddleware, "getAccessTokenFromExpressRequest")
        .mockImplementation(() => {
          throw new Error("no cookie on this request");
        });

      mockRequest.body = { data: { paymentProviderInvoiceId: "in_plan_nov" } };

      await run("put", VOID_ROUTE);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(BillingInvoiceService.voidInvoiceForProject).toHaveBeenCalled();
    });

    it.each([
      [{ data: {} }],
      [{}],
      [{ data: { paymentProviderInvoiceId: "   " } }],
      [{ data: { paymentProviderInvoiceId: 42 } }],
      [{ data: { paymentProviderInvoiceId: ["in_plan_nov"] } }],
    ])(
      "asks for the invoice when the body %j names none",
      async (body: Record<string, unknown>) => {
        mockRequest.body = body;

        await run("put", VOID_ROUTE);

        expect(nextFunction).toHaveBeenCalledWith(
          new BadDataException("Choose the invoice to void."),
        );
        expect(
          BillingInvoiceService.voidInvoiceForProject,
        ).not.toHaveBeenCalled();
      },
    );

    it.each([
      "in_1/../../customers/cus_other",
      "in_1?expand[]=customer",
      "in 1",
      "in_1%2F",
      "a".repeat(256),
    ])("refuses %p, which is no invoice id", async (invoiceId: string) => {
      mockRequest.body = { data: { paymentProviderInvoiceId: invoiceId } };

      await run("put", VOID_ROUTE);

      expect(nextFunction).toHaveBeenCalledWith(
        new BadDataException(ADMIN_INVOICE_ID_NOT_VALID_MESSAGE),
      );
      expect(
        BillingInvoiceService.voidInvoiceForProject,
      ).not.toHaveBeenCalled();
    });

    it("refuses a project id that is not one", async () => {
      mockRequest.params = { id: "not-a-project" };
      mockRequest.body = { data: { paymentProviderInvoiceId: "in_plan_nov" } };

      await run("put", VOID_ROUTE);

      expect(nextFunction).toHaveBeenCalledWith(
        new BadDataException(ADMIN_PROJECT_ID_NOT_VALID_MESSAGE),
      );
      expect(
        BillingInvoiceService.voidInvoiceForProject,
      ).not.toHaveBeenCalled();
    });

    it("passes the service's refusal on, and says nothing went through", async () => {
      const refusal: BadDataException = new BadDataException(
        "This invoice does not belong to this project.",
      );

      BillingInvoiceService.voidInvoiceForProject = jest
        .fn()
        .mockRejectedValue(refusal) as never;
      mockRequest.body = { data: { paymentProviderInvoiceId: "in_other" } };

      await run("put", VOID_ROUTE);

      expect(nextFunction).toHaveBeenCalledWith(refusal);
      expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
    });
  });
});
