import {
  ADMIN_INVOICE_NOT_FOUND_MESSAGE,
  ADMIN_INVOICE_OF_ANOTHER_PROJECT_MESSAGE,
  BILLING_DISABLED_NO_INVOICES_MESSAGE,
  Service as BillingInvoiceService,
} from "../../../Server/Services/BillingInvoiceService";
import { Invoice } from "../../../Server/Services/BillingService";
import logger from "../../../Server/Utils/Logger";
import { InvoiceStatus } from "../../../Models/DatabaseModels/BillingInvoice";
import {
  AdminProjectInvoice,
  InvoiceBilledFor,
} from "../../../Types/Billing/AdminProjectInvoice";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The Admin Dashboard's Invoices page reads a project's invoices live from
 * the payment provider and voids one OneUptime staff waive. Voiding cannot be
 * undone and reaches money, so these tests are mostly about what must not
 * happen: voiding another customer's invoice through this project, voiding
 * one the provider would refuse, and failing a void that already happened
 * because a follow-up write did.
 */

let mockIsBillingEnabled: boolean = true;

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  );

  return {
    ...actual,
    get IsBillingEnabled(): boolean {
      return mockIsBillingEnabled;
    },
  };
});

const findOneByIdMock: jest.Mock = jest.fn();
const getInvoicesMock: jest.Mock = jest.fn();
const getInvoiceMock: jest.Mock = jest.fn();
const voidInvoiceMock: jest.Mock = jest.fn();

jest.mock("../../../Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>) => {
        return findOneByIdMock(...args);
      },
    },
  };
});

jest.mock("../../../Server/Services/BillingService", () => {
  return {
    __esModule: true,
    default: {
      getInvoices: (...args: Array<unknown>) => {
        return getInvoicesMock(...args);
      },
      getInvoice: (...args: Array<unknown>) => {
        return getInvoiceMock(...args);
      },
      voidInvoice: (...args: Array<unknown>) => {
        return voidInvoiceMock(...args);
      },
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CUSTOMER_ID: string = "cus_acme";
const SUBSCRIPTION_ID: string = "sub_plan";
const METERED_SUBSCRIPTION_ID: string = "sub_usage";
const ADMIN_USER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

function invoiceOf(overrides?: Partial<Invoice>): Invoice {
  return {
    id: "in_plan_nov",
    amount: 2200,
    currencyCode: "usd",
    subscriptionId: SUBSCRIPTION_ID,
    status: InvoiceStatus.Open,
    downloadableLink: "https://pay.stripe.com/invoice/in_plan_nov/pdf",
    customerId: CUSTOMER_ID,
    invoiceDate: new Date("2026-11-13T20:31:00.000Z"),
    invoiceNumber: "ACME-0007",
    ...overrides,
  };
}

describe("BillingInvoiceService for the Admin Dashboard", () => {
  let service: BillingInvoiceService;
  let updateOneBySpy: jest.SpyInstance;
  let refreshSpy: jest.SpyInstance;
  let infoSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockIsBillingEnabled = true;
    jest.clearAllMocks();

    service = new BillingInvoiceService();

    findOneByIdMock.mockResolvedValue({
      id: PROJECT_ID,
      paymentProviderCustomerId: CUSTOMER_ID,
      paymentProviderSubscriptionId: SUBSCRIPTION_ID,
      paymentProviderMeteredSubscriptionId: METERED_SUBSCRIPTION_ID,
    });
    getInvoiceMock.mockResolvedValue(invoiceOf());
    voidInvoiceMock.mockResolvedValue({ id: "in_plan_nov", status: "void" });

    updateOneBySpy = getJestSpyOn(service, "updateOneBy").mockResolvedValue(
      1 as never,
    );
    refreshSpy = getJestSpyOn(
      service,
      "refreshSubscriptionStatus",
    ).mockResolvedValue(undefined as never);
    infoSpy = getJestSpyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });
    errorSpy = getJestSpyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getInvoicesForAdmin", () => {
    it("lists the project's invoices newest first, whatever order the provider gave", async () => {
      getInvoicesMock.mockResolvedValue([
        invoiceOf({
          id: "in_sep",
          invoiceDate: new Date("2026-09-01T00:00:00.000Z"),
        }),
        invoiceOf({
          id: "in_nov",
          invoiceDate: new Date("2026-11-13T00:00:00.000Z"),
        }),
        invoiceOf({
          id: "in_oct",
          invoiceDate: new Date("2026-10-01T00:00:00.000Z"),
        }),
      ]);

      const invoices: Array<AdminProjectInvoice> =
        await service.getInvoicesForAdmin(PROJECT_ID);

      expect(getInvoicesMock).toHaveBeenCalledWith(CUSTOMER_ID);
      expect(
        invoices.map((invoice: AdminProjectInvoice): string => {
          return invoice.id;
        }),
      ).toEqual(["in_nov", "in_oct", "in_sep"]);
    });

    it("says which of the project's subscriptions raised each invoice", async () => {
      getInvoicesMock.mockResolvedValue([
        invoiceOf({ id: "in_plan", subscriptionId: SUBSCRIPTION_ID }),
        invoiceOf({ id: "in_usage", subscriptionId: METERED_SUBSCRIPTION_ID }),
        invoiceOf({ id: "in_replaced", subscriptionId: "sub_old_plan" }),
        invoiceOf({ id: "in_one_off", subscriptionId: undefined }),
      ]);

      const invoices: Array<AdminProjectInvoice> =
        await service.getInvoicesForAdmin(PROJECT_ID);

      const billedFor: Record<string, InvoiceBilledFor | undefined> = {};

      for (const invoice of invoices) {
        billedFor[invoice.id] = invoice.billedFor;
      }

      expect(billedFor).toEqual({
        in_plan: InvoiceBilledFor.Plan,
        in_usage: InvoiceBilledFor.Usage,
        in_replaced: undefined,
        in_one_off: undefined,
      });
    });

    it("hands the page each invoice's number, date, amount, status and download link", async () => {
      getInvoicesMock.mockResolvedValue([invoiceOf()]);

      expect(await service.getInvoicesForAdmin(PROJECT_ID)).toEqual([
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
      ]);
    });

    it("lists nothing for a project the provider has no customer for", async () => {
      findOneByIdMock.mockResolvedValue({ id: PROJECT_ID });

      expect(await service.getInvoicesForAdmin(PROJECT_ID)).toEqual([]);
      expect(getInvoicesMock).not.toHaveBeenCalled();
    });

    it("refuses a project that no longer exists", async () => {
      findOneByIdMock.mockResolvedValue(null);

      await expect(service.getInvoicesForAdmin(PROJECT_ID)).rejects.toThrow(
        "This project no longer exists. It may have been deleted.",
      );
    });

    it("refuses on a server without billing", async () => {
      mockIsBillingEnabled = false;

      await expect(service.getInvoicesForAdmin(PROJECT_ID)).rejects.toThrow(
        BILLING_DISABLED_NO_INVOICES_MESSAGE,
      );
      expect(findOneByIdMock).not.toHaveBeenCalled();
    });
  });

  describe("voidInvoiceForProject", () => {
    const voidPlanInvoice: () => Promise<void> = async (): Promise<void> => {
      await service.voidInvoiceForProject({
        projectId: PROJECT_ID,
        paymentProviderInvoiceId: "in_plan_nov",
        voidedByUserId: ADMIN_USER_ID,
      });
    };

    it("voids an open invoice of the project's own customer", async () => {
      await voidPlanInvoice();

      expect(getInvoiceMock).toHaveBeenCalledWith(CUSTOMER_ID, "in_plan_nov");
      expect(voidInvoiceMock).toHaveBeenCalledTimes(1);
      expect(voidInvoiceMock).toHaveBeenCalledWith("in_plan_nov");
    });

    it("voids an uncollectible invoice too", async () => {
      getInvoiceMock.mockResolvedValue(
        invoiceOf({ status: InvoiceStatus.Uncollectible }),
      );

      await voidPlanInvoice();

      expect(voidInvoiceMock).toHaveBeenCalledWith("in_plan_nov");
    });

    it("marks the customer's copy void and brings the project's statuses up to date", async () => {
      await voidPlanInvoice();

      expect(updateOneBySpy).toHaveBeenCalledWith({
        query: {
          projectId: PROJECT_ID,
          paymentProviderInvoiceId: "in_plan_nov",
        },
        data: {
          status: InvoiceStatus.Void,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
      expect(refreshSpy).toHaveBeenCalledWith({ projectId: PROJECT_ID });
    });

    it("writes which master admin voided which invoice of which project", async () => {
      await voidPlanInvoice();

      expect(infoSpy).toHaveBeenCalledWith(
        `Invoice in_plan_nov of project ${PROJECT_ID.toString()} voided by master admin ${ADMIN_USER_ID.toString()}`,
      );
    });

    it("refuses an invoice of another customer, and voids nothing", async () => {
      /*
       * The provider fetches an invoice by its id alone, across every
       * customer: a crafted id must not void someone else's invoice.
       */
      getInvoiceMock.mockResolvedValue(
        invoiceOf({ customerId: "cus_someone_else" }),
      );

      await expect(voidPlanInvoice()).rejects.toThrow(
        ADMIN_INVOICE_OF_ANOTHER_PROJECT_MESSAGE,
      );
      expect(voidInvoiceMock).not.toHaveBeenCalled();
      expect(updateOneBySpy).not.toHaveBeenCalled();
    });

    it.each([
      InvoiceStatus.Paid,
      InvoiceStatus.Void,
      InvoiceStatus.Draft,
      InvoiceStatus.Deleted,
    ])(
      "refuses a %p invoice, saying why, and voids nothing",
      async (status: InvoiceStatus) => {
        getInvoiceMock.mockResolvedValue(invoiceOf({ status: status }));

        await expect(voidPlanInvoice()).rejects.toThrow(
          `Only an open or uncollectible invoice can be voided. This one is ${status}.`,
        );
        expect(voidInvoiceMock).not.toHaveBeenCalled();
      },
    );

    it("says the invoice is gone when the provider has no invoice by that id", async () => {
      getInvoiceMock.mockRejectedValue(
        Object.assign(new Error("No such invoice: 'in_gone'"), {
          type: "StripeInvalidRequestError",
          code: "resource_missing",
        }),
      );

      await expect(voidPlanInvoice()).rejects.toThrow(
        new BadDataException(ADMIN_INVOICE_NOT_FOUND_MESSAGE),
      );
      expect(voidInvoiceMock).not.toHaveBeenCalled();
    });

    it("passes any other provider error on as it is: it says nothing about the invoice", async () => {
      const rateLimited: Error = Object.assign(new Error("Too many requests"), {
        type: "StripeRateLimitError",
        code: "rate_limit",
      });

      getInvoiceMock.mockRejectedValue(rateLimited);

      await expect(voidPlanInvoice()).rejects.toBe(rateLimited);
      expect(voidInvoiceMock).not.toHaveBeenCalled();
    });

    it("passes on the provider's refusal to void, and writes nothing", async () => {
      voidInvoiceMock.mockRejectedValue(new Error("Stripe refused the void"));

      await expect(voidPlanInvoice()).rejects.toThrow(
        "Stripe refused the void",
      );
      expect(updateOneBySpy).not.toHaveBeenCalled();
      expect(refreshSpy).not.toHaveBeenCalled();
    });

    it("still succeeds when the customer's copy cannot be updated: the invoice is already void", async () => {
      updateOneBySpy.mockRejectedValue(new Error("database is down") as never);

      await expect(voidPlanInvoice()).resolves.toBeUndefined();
      expect(refreshSpy).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });

    it("still succeeds when the project's statuses cannot be refreshed", async () => {
      refreshSpy.mockRejectedValue(new Error("Stripe is slow") as never);

      await expect(voidPlanInvoice()).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
    });

    it("refuses a project the provider has no customer for", async () => {
      findOneByIdMock.mockResolvedValue({ id: PROJECT_ID });

      await expect(voidPlanInvoice()).rejects.toThrow(
        "This project has no customer at the payment provider, so it has no invoices to void.",
      );
      expect(getInvoiceMock).not.toHaveBeenCalled();
    });

    it("refuses a project that no longer exists", async () => {
      findOneByIdMock.mockResolvedValue(null);

      await expect(voidPlanInvoice()).rejects.toThrow(
        "This project no longer exists. It may have been deleted.",
      );
      expect(voidInvoiceMock).not.toHaveBeenCalled();
    });

    it("refuses on a server without billing, before reading anything", async () => {
      mockIsBillingEnabled = false;

      await expect(voidPlanInvoice()).rejects.toThrow(
        BILLING_DISABLED_NO_INVOICES_MESSAGE,
      );
      expect(findOneByIdMock).not.toHaveBeenCalled();
      expect(voidInvoiceMock).not.toHaveBeenCalled();
    });
  });
});
