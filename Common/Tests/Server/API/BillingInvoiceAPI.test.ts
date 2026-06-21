import BillingInvoiceAPI from "../../../Server/API/BillingInvoiceAPI";
import BillingInvoiceService from "../../../Server/Services/BillingInvoiceService";
import BillingService from "../../../Server/Services/BillingService";
import ProjectService from "../../../Server/Services/ProjectService";
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
import Permission, { UserPermission } from "../../../Types/Permission";
import BillingInvoice from "../../../Models/DatabaseModels/BillingInvoice";
import Project from "../../../Models/DatabaseModels/Project";

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

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    IsBillingEnabled: true,
  };
});

jest.mock("../../../Server/Services/BillingInvoiceService");
jest.mock("../../../Server/Services/BillingService");
jest.mock("../../../Server/Services/ProjectService");

describe("BillingInvoiceAPI", () => {
  let mockRequest: OneUptimeRequest;
  let mockResponse: OneUptimeResponse;
  let nextFunction: NextFunction;

  const projectId: ObjectID = ObjectID.generate();
  const projectCustomerId: string = "cus_own_project";
  const invoiceId: string = "in_123";

  let project: Project;

  beforeEach(() => {
    new BillingInvoiceAPI();

    project = new Project();
    project.id = projectId;
    project.paymentProviderCustomerId = projectCustomerId;
    project.paymentProviderSubscriptionId = "sub_123";

    jest
      .spyOn(BillingInvoiceAPI.prototype, "getPermissionsForTenant")
      .mockResolvedValue([
        {
          permission: Permission.EditInvoices,
        } as UserPermission,
      ]);

    ProjectService.findOneById = jest.fn().mockResolvedValue(project);
    BillingInvoiceService.findOneBy = jest
      .fn()
      .mockResolvedValue(new BillingInvoice());
    BillingInvoiceService.updateOneBy = jest.fn().mockResolvedValue(undefined);
    BillingInvoiceService.refreshSubscriptionStatus = jest
      .fn()
      .mockResolvedValue(undefined);
    BillingService.payInvoice = jest.fn().mockResolvedValue({
      id: invoiceId,
      status: "paid",
    });

    mockRequest = {
      tenantId: projectId,
      body: {
        data: {
          paymentProviderInvoiceId: invoiceId,
          paymentProviderCustomerId: projectCustomerId,
        },
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

  describe("POST /billing-invoices/pay", () => {
    it("should reject a customer id that does not belong to the project", async () => {
      mockRequest.body["data"] = {
        paymentProviderInvoiceId: invoiceId,
        paymentProviderCustomerId: "cus_victim_tenant",
      };

      await mockRouter
        .match("post", "/billing-invoices/pay")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(
        new BadDataException("Customer ID does not belong to this project"),
      );
      expect(BillingService.payInvoice).not.toHaveBeenCalled();
      expect(BillingInvoiceService.updateOneBy).not.toHaveBeenCalled();
    });

    it("should reject an invoice that does not belong to the project", async () => {
      BillingInvoiceService.findOneBy = jest.fn().mockResolvedValue(null);

      await mockRouter
        .match("post", "/billing-invoices/pay")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(BillingInvoiceService.findOneBy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            projectId: projectId,
            paymentProviderInvoiceId: invoiceId,
          },
          /*
           * ignoreHooks is required: BillingInvoiceService.onBeforeFind
           * throws without props.tenantId and would re-sync all invoices
           * from Stripe on every pay attempt.
           */
          props: expect.objectContaining({
            ignoreHooks: true,
          }),
        }),
      );
      expect(nextFunction).toHaveBeenCalledWith(
        new BadDataException("Invoice not found for this project"),
      );
      expect(BillingService.payInvoice).not.toHaveBeenCalled();
      expect(BillingInvoiceService.updateOneBy).not.toHaveBeenCalled();
    });

    it("should pay with the project's own customer id and scope the status update to the project", async () => {
      // body omits the customer id — the project's own customer is charged.
      mockRequest.body["data"] = {
        paymentProviderInvoiceId: invoiceId,
      };

      await mockRouter
        .match("post", "/billing-invoices/pay")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(BillingService.payInvoice).toHaveBeenCalledWith(
        projectCustomerId,
        invoiceId,
      );
      expect(BillingInvoiceService.updateOneBy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            projectId: projectId,
            paymentProviderInvoiceId: invoiceId,
          },
        }),
      );
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
      );
    });
  });
});
