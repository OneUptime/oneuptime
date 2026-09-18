import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it } from "@jest/globals";
import Invoices from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/Invoices";
import BillingInvoice, {
  InvoiceStatus,
} from "../../../Models/DatabaseModels/BillingInvoice";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * The affected customer pressed "Pay Invoice" while the September debit on
 * their old India-issued card was still processing. The page confirmed that
 * processing PaymentIntent in the browser against whichever saved card was
 * listed first, showed Stripe's "A processing error occurred.", and left the
 * page spinner running because the loader was never reset.
 */

const postMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const confirmCardPaymentMock: MockFunction = getJestMockFunction();
const loadStripeMock: MockFunction = getJestMockFunction();
const projectId: ObjectID = ObjectID.generate();

const CUSTOMER_ID: string = "cus_stale_card_customer";
const INVOICE_ID: string = "in_stale_card_invoice";
const CLIENT_SECRET: string = "pi_stale_card_invoice_secret_abc";
const PROCESSING_MESSAGE: string =
  "Your bank is still processing a payment for this invoice. Some banks (for example cards issued in India) take up to 2 days to confirm recurring card payments. You do not need to pay again - the invoice will update automatically once the bank confirms.";

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown) => {
        return (error as Error).message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getItem: async () => {
        return null;
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock(
  "@stripe/stripe-js/pure",
  () => {
    return {
      loadStripe: (...args: Array<unknown>) => {
        return loadStripeMock(...args);
      },
    };
  },
  { virtual: true },
);

type ColumnProps = {
  title: string;
  getElement?: (item: BillingInvoice) => ReactElement;
};

/*
 * The table's data fetching is a test boundary. It renders only the Actions
 * cell of one open invoice, which is where the page wires Pay Invoice.
 */
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: { columns: Array<ColumnProps> }): ReactElement => {
      const invoice: BillingInvoice = new BillingInvoice();
      invoice.status = "open" as InvoiceStatus;
      invoice.paymentProviderCustomerId = "cus_stale_card_customer";
      invoice.paymentProviderInvoiceId = "in_stale_card_invoice";

      const actions: ColumnProps | undefined = props.columns.find(
        (column: ColumnProps) => {
          return column.title === "Actions";
        },
      );

      return (
        <div data-testid="invoices-table">
          {actions?.getElement ? actions.getElement(invoice) : <></>}
        </div>
      );
    },
  };
});

jest.mock("../../../UI/Components/ComponentLoader/ComponentLoader", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <div data-testid="invoices-loader">Loading</div>;
    },
  };
});

jest.mock("../../../UI/Components/Modal/Modal", () => {
  return {
    __esModule: true,
    default: (props: {
      title: string;
      children: ReactNode;
      submitButtonText: string;
      onSubmit: () => void;
    }): ReactElement => {
      return (
        <section role="dialog" aria-label={props.title}>
          <h2>{props.title}</h2>
          {props.children}
          <button onClick={props.onSubmit}>{props.submitButtonText}</button>
        </section>
      );
    },
  };
});

type ApiResponseFunction = (jsonData: Record<string, unknown>) => {
  isFailure: () => boolean;
  jsonData: Record<string, unknown>;
};

const apiResponse: ApiResponseFunction = (
  jsonData: Record<string, unknown>,
): {
  isFailure: () => boolean;
  jsonData: Record<string, unknown>;
} => {
  return {
    isFailure: () => {
      return false;
    },
    jsonData,
  };
};

type ClickPayFunction = () => Promise<void>;

const renderAndClickPay: ClickPayFunction = async (): Promise<void> => {
  render(
    <Invoices
      pageRoute={new Route("/settings/invoices")}
      currentProject={null}
      hasPaymentMethod={true}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Pay Invoice" }));
};

type ExpectTableBackFunction = () => Promise<void>;

const expectTableBack: ExpectTableBackFunction = async (): Promise<void> => {
  await waitFor(() => {
    expect(screen.getByTestId("invoices-table")).toBeInTheDocument();
  });
  expect(screen.queryByTestId("invoices-loader")).not.toBeInTheDocument();
};

describe("Invoices page Pay Invoice", () => {
  let reload: jest.SpyInstance;

  beforeEach(() => {
    jest.restoreAllMocks();
    postMock.mockReset().mockResolvedValue(apiResponse({}));
    getListMock.mockReset().mockResolvedValue({ data: [], count: 0 });
    confirmCardPaymentMock
      .mockReset()
      .mockResolvedValue({ paymentIntent: { status: "succeeded" } });
    loadStripeMock
      .mockReset()
      .mockResolvedValue({ confirmCardPayment: confirmCardPaymentMock });
    getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(projectId);
    getJestSpyOn(ProjectUtil, "isSubscriptionInactive").mockReturnValue(false);
    reload = getJestSpyOn(Navigation, "reload").mockImplementation(() => {
      return undefined;
    });
  });

  it("posts the invoice and customer to the pay route", async () => {
    await renderAndClickPay();

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });
    expect(postMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          data: {
            paymentProviderInvoiceId: INVOICE_ID,
            paymentProviderCustomerId: CUSTOMER_ID,
          },
        },
      }),
    );
  });

  it("reloads after a payment that went through, without touching Stripe.js", async () => {
    await renderAndClickPay();

    await waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1);
    });
    expect(loadStripeMock).not.toHaveBeenCalled();
    expect(confirmCardPaymentMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The reload replaces the page; flashing the old table first would not help.
    expect(screen.getByTestId("invoices-loader")).toBeInTheDocument();
  });

  describe("a payment for the invoice is still processing (stale-card incident)", () => {
    beforeEach(() => {
      postMock.mockResolvedValue(apiResponse({ paymentProcessing: true }));
    });

    it("explains that the bank is processing the payment instead of showing an error", async () => {
      await renderAndClickPay();

      const dialog: HTMLElement = await screen.findByRole("dialog", {
        name: "Payment is processing",
      });
      expect(dialog).toHaveTextContent(PROCESSING_MESSAGE);
      expect(
        screen.queryByText("Something is not quite right..."),
      ).not.toBeInTheDocument();
    });

    it("never loads Stripe.js, confirms a card payment, or reloads", async () => {
      await renderAndClickPay();
      await screen.findByRole("dialog", { name: "Payment is processing" });

      expect(loadStripeMock).not.toHaveBeenCalled();
      expect(confirmCardPaymentMock).not.toHaveBeenCalled();
      expect(getListMock).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    });

    it("brings the invoice table back, and closing the message leaves it there", async () => {
      await renderAndClickPay();
      await screen.findByRole("dialog", { name: "Payment is processing" });
      await expectTableBack();

      await userEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByTestId("invoices-table")).toBeInTheDocument();
      expect(screen.queryByTestId("invoices-loader")).not.toBeInTheDocument();
    });

    it("can be asked again after closing the message", async () => {
      await renderAndClickPay();
      await screen.findByRole("dialog", { name: "Payment is processing" });
      await userEvent.click(screen.getByRole("button", { name: "Close" }));

      await userEvent.click(
        await screen.findByRole("button", { name: "Pay Invoice" }),
      );

      expect(
        await screen.findByRole("dialog", { name: "Payment is processing" }),
      ).toBeInTheDocument();
      expect(postMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("the payment needs authentication", () => {
    beforeEach(() => {
      postMock.mockResolvedValue(apiResponse({ clientSecret: CLIENT_SECRET }));
    });

    it("confirms with only the client secret, keeping the card on the PaymentIntent", async () => {
      await renderAndClickPay();

      await waitFor(() => {
        expect(confirmCardPaymentMock).toHaveBeenCalledTimes(1);
      });
      expect(loadStripeMock).toHaveBeenCalledTimes(1);
      expect(confirmCardPaymentMock.mock.calls[0]).toEqual([CLIENT_SECRET]);
      // The saved-card list is no longer consulted to pick a card.
      expect(getListMock).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(reload).toHaveBeenCalledTimes(1);
      });
    });

    it("shows Stripe's message and brings the table back when confirmation fails", async () => {
      confirmCardPaymentMock.mockResolvedValue({
        error: { message: "A processing error occurred." },
      });

      await renderAndClickPay();

      const dialog: HTMLElement = await screen.findByRole("dialog", {
        name: "Something is not quite right...",
      });
      expect(dialog).toHaveTextContent("A processing error occurred.");
      await expectTableBack();
      expect(reload).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByTestId("invoices-table")).toBeInTheDocument();
    });

    it("shows a fallback message when Stripe's error has none", async () => {
      confirmCardPaymentMock.mockResolvedValue({ error: {} });

      await renderAndClickPay();

      expect(
        await screen.findByRole("dialog", {
          name: "Something is not quite right...",
        }),
      ).toHaveTextContent("Something is not quite right. Please try again");
      await expectTableBack();
    });

    it("shows the processing message when the confirmed payment is now processing", async () => {
      confirmCardPaymentMock.mockResolvedValue({
        paymentIntent: { status: "processing" },
      });

      await renderAndClickPay();

      expect(
        await screen.findByRole("dialog", { name: "Payment is processing" }),
      ).toHaveTextContent(PROCESSING_MESSAGE);
      await expectTableBack();
      expect(reload).not.toHaveBeenCalled();
    });

    it("reports a payment provider that cannot be loaded and brings the table back", async () => {
      loadStripeMock.mockResolvedValue(null);

      await renderAndClickPay();

      expect(
        await screen.findByRole("dialog", {
          name: "Something is not quite right...",
        }),
      ).toHaveTextContent("Payment provider cannot be loaded");
      await expectTableBack();
      expect(confirmCardPaymentMock).not.toHaveBeenCalled();
    });

    it("brings the table back when Stripe.js throws", async () => {
      confirmCardPaymentMock.mockRejectedValue(new Error("Stripe.js crashed"));

      await renderAndClickPay();

      expect(
        await screen.findByRole("dialog", {
          name: "Something is not quite right...",
        }),
      ).toHaveTextContent("Stripe.js crashed");
      await expectTableBack();
    });
  });

  describe("the server refused the payment", () => {
    it("shows the server's message and brings the table back", async () => {
      postMock.mockResolvedValue({
        isFailure: () => {
          return true;
        },
        message:
          "Your payment could not be completed: Your card was declined. Please update your payment method in Project Settings > Billing and try again.",
      });

      await renderAndClickPay();

      expect(
        await screen.findByRole("dialog", {
          name: "Something is not quite right...",
        }),
      ).toHaveTextContent("Your card was declined.");
      await expectTableBack();
      expect(loadStripeMock).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    });

    it("brings the table back when the request itself fails", async () => {
      postMock.mockRejectedValue(new Error("Network error"));

      await renderAndClickPay();

      expect(
        await screen.findByRole("dialog", {
          name: "Something is not quite right...",
        }),
      ).toHaveTextContent("Network error");
      await expectTableBack();
    });
  });

  it("shows the loader while the payment is being made", async () => {
    let resolvePost: (value: unknown) => void = () => {};
    postMock.mockReturnValue(
      new Promise((resolve: (value: unknown) => void) => {
        resolvePost = resolve;
      }),
    );

    await renderAndClickPay();

    expect(await screen.findByTestId("invoices-loader")).toBeInTheDocument();
    expect(screen.queryByTestId("invoices-table")).not.toBeInTheDocument();

    resolvePost(apiResponse({ paymentProcessing: true }));

    await screen.findByRole("dialog", { name: "Payment is processing" });
    await expectTableBack();
  });
});
