import "@testing-library/jest-dom";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it } from "@jest/globals";
import Invoices from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/Invoices";
import BillingInvoice, {
  InvoiceStatus,
} from "../../../Models/DatabaseModels/BillingInvoice";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import ActionButtonSchema from "../../../UI/Components/ActionButton/ActionButtonSchema";
import RowActions from "../../../UI/Components/ActionButton/RowActions";
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

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

type ColumnProps = {
  title: string;
};

type InvoicesTableProps = {
  columns: Array<ColumnProps>;
  selectMoreFields?: Record<string, boolean>;
  actionButtons?: Array<ActionButtonSchema<BillingInvoice>>;
};

type MakeInvoiceOptions = {
  invoiceId: string;
  customerId?: string;
  status: InvoiceStatus;
  downloadableLink?: string;
};

type MakeInvoiceFunction = (options: MakeInvoiceOptions) => BillingInvoice;

const makeInvoice: MakeInvoiceFunction = (
  options: MakeInvoiceOptions,
): BillingInvoice => {
  const invoice: BillingInvoice = new BillingInvoice();
  invoice.status = options.status;
  invoice.paymentProviderCustomerId = options.customerId || CUSTOMER_ID;
  invoice.paymentProviderInvoiceId = options.invoiceId;

  if (options.downloadableLink) {
    invoice.downloadableLink = URL.fromString(options.downloadableLink);
  }

  return invoice;
};

/*
 * The rows the table mock draws, and the props it was last given. Each test
 * sets the rows; the default is the one open invoice from the incident.
 */
let invoicesForTest: Array<BillingInvoice> = [];
let lastTableProps: InvoicesTableProps | null = null;

/*
 * The table's data fetching is a test boundary. Each invoice becomes one row
 * whose actions are drawn by RowActions - the same component ModelTable's
 * rows use for their Actions cell - from the actionButtons the page hands the
 * table. That keeps the button, the ⋯ menu and what each one runs real.
 */
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: InvoicesTableProps): ReactElement => {
      lastTableProps = props;

      return (
        <div data-testid="invoices-table">
          {invoicesForTest.map((invoice: BillingInvoice) => {
            return (
              <div
                key={invoice.paymentProviderInvoiceId}
                data-testid="invoice-row"
              >
                <RowActions<BillingInvoice>
                  item={invoice}
                  actionButtons={props.actionButtons}
                />
              </div>
            );
          })}
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
    invoicesForTest = [
      makeInvoice({ invoiceId: INVOICE_ID, status: InvoiceStatus.Open }),
    ];
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

/*
 * Invoice rows used to draw a hand-built "Actions" column with a Download and
 * a Pay Invoice button side by side. They now hand both to the table as row
 * actions, so every row shows one button and a ⋯ menu with the rest: Pay
 * Invoice on the row while the invoice still owes money, Download on the row
 * once it does not. These tests look at each kind of row the way a customer
 * does, and check that each action still runs for the invoice it sits on.
 */
describe("Invoices page row actions", () => {
  let navigate: jest.SpyInstance;

  const FIRST_PDF: string = "https://invoices.example.com/in_first.pdf";
  const SECOND_PDF: string = "https://invoices.example.com/in_second.pdf";

  type RenderInvoicesFunction = (invoices: Array<BillingInvoice>) => void;

  const renderInvoices: RenderInvoicesFunction = (
    invoices: Array<BillingInvoice>,
  ): void => {
    invoicesForTest = invoices;

    render(
      <Invoices
        pageRoute={new Route("/settings/invoices")}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );
  };

  type GetRowsFunction = () => Array<HTMLElement>;

  const getRows: GetRowsFunction = (): Array<HTMLElement> => {
    return screen.getAllByTestId("invoice-row");
  };

  type RowButtonLabelsFunction = (row: HTMLElement) => Array<string>;

  const rowButtonLabels: RowButtonLabelsFunction = (
    row: HTMLElement,
  ): Array<string> => {
    return within(row)
      .queryAllByRole("button")
      .map((button: HTMLElement) => {
        return (
          button.getAttribute("aria-label") || (button.textContent || "").trim()
        );
      });
  };

  type OpenMenuInFunction = (row: HTMLElement) => HTMLElement;

  const openMenuIn: OpenMenuInFunction = (row: HTMLElement): HTMLElement => {
    fireEvent.click(within(row).getByTestId("row-actions-more-button"));
    return screen.getByRole("menu");
  };

  type MenuLabelsFunction = (menu: HTMLElement) => Array<string>;

  const menuLabels: MenuLabelsFunction = (menu: HTMLElement): Array<string> => {
    return within(menu)
      .getAllByRole("menuitem")
      .map((item: HTMLElement) => {
        return (item.textContent || "").trim();
      });
  };

  type NavigatedToFunction = () => Array<string>;

  const navigatedTo: NavigatedToFunction = (): Array<string> => {
    return navigate.mock.calls.map((call: Array<unknown>) => {
      return String(call[0]);
    });
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    invoicesForTest = [];
    lastTableProps = null;
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
    getJestSpyOn(Navigation, "reload").mockImplementation(() => {
      return undefined;
    });
    navigate = getJestSpyOn(Navigation, "navigate").mockImplementation(() => {
      return undefined;
    });
  });

  it("hands Download and Pay Invoice to the table instead of drawing an Actions column", () => {
    renderInvoices([]);

    expect(
      lastTableProps?.columns.map((column: ColumnProps) => {
        return column.title;
      }),
    ).toEqual(["Invoice Number", "Invoice Date", "Amount", "Invoice Status"]);
    expect(
      lastTableProps?.actionButtons?.map(
        (action: ActionButtonSchema<BillingInvoice>) => {
          return action.title;
        },
      ),
    ).toEqual(["Download", "Pay Invoice"]);
  });

  it("still asks for the download link now that no column reads it", () => {
    renderInvoices([]);

    expect(lastTableProps?.selectMoreFields).toEqual(
      expect.objectContaining({
        downloadableLink: true,
        paymentProviderCustomerId: true,
        paymentProviderInvoiceId: true,
      }),
    );
  });

  it("shows Pay Invoice on an unpaid invoice's row and folds Download into the ⋯ menu", () => {
    renderInvoices([
      makeInvoice({
        invoiceId: "in_first",
        status: InvoiceStatus.Open,
        downloadableLink: FIRST_PDF,
      }),
    ]);

    const row: HTMLElement = getRows()[0]!;

    expect(rowButtonLabels(row)).toEqual(["Pay Invoice", "More actions"]);
    expect(within(row).queryByText("Download")).not.toBeInTheDocument();
    expect(menuLabels(openMenuIn(row))).toEqual(["Download"]);
  });

  it("shows just Download on a paid invoice's row, with no ⋯ menu", () => {
    renderInvoices([
      makeInvoice({
        invoiceId: "in_first",
        status: InvoiceStatus.Paid,
        downloadableLink: FIRST_PDF,
      }),
    ]);

    const row: HTMLElement = getRows()[0]!;

    expect(rowButtonLabels(row)).toEqual(["Download"]);
    expect(
      within(row).queryByTestId("row-actions-more-button"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Pay Invoice")).not.toBeInTheDocument();
  });

  it.each([
    ["paid", InvoiceStatus.Paid],
    ["draft", InvoiceStatus.Draft],
    ["void", InvoiceStatus.Void],
    ["deleted", InvoiceStatus.Deleted],
  ])(
    "never offers Pay Invoice on a %s invoice, on the row or in the menu",
    (_label: string, status: InvoiceStatus) => {
      renderInvoices([
        makeInvoice({
          invoiceId: "in_first",
          status,
          downloadableLink: FIRST_PDF,
        }),
      ]);

      const row: HTMLElement = getRows()[0]!;

      expect(rowButtonLabels(row)).toEqual(["Download"]);
      expect(screen.queryByText("Pay Invoice")).not.toBeInTheDocument();
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    },
  );

  it.each([
    ["an open", InvoiceStatus.Open],
    ["an uncollectible", InvoiceStatus.Uncollectible],
    ["a status-less", InvoiceStatus.Undefined],
  ])(
    "puts Pay Invoice on the row of %s invoice, ahead of Download",
    (_label: string, status: InvoiceStatus) => {
      renderInvoices([
        makeInvoice({
          invoiceId: "in_first",
          status,
          downloadableLink: FIRST_PDF,
        }),
      ]);

      const row: HTMLElement = getRows()[0]!;

      expect(rowButtonLabels(row)).toEqual(["Pay Invoice", "More actions"]);
      expect(menuLabels(openMenuIn(row))).toEqual(["Download"]);
    },
  );

  it("shows only Pay Invoice on an unpaid invoice that has no PDF yet", () => {
    renderInvoices([
      makeInvoice({ invoiceId: "in_first", status: InvoiceStatus.Open }),
    ]);

    const row: HTMLElement = getRows()[0]!;

    expect(rowButtonLabels(row)).toEqual(["Pay Invoice"]);
    expect(
      within(row).queryByTestId("row-actions-more-button"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Download")).not.toBeInTheDocument();
  });

  it("leaves a paid invoice with no PDF without any actions", () => {
    renderInvoices([
      makeInvoice({ invoiceId: "in_first", status: InvoiceStatus.Paid }),
    ]);

    const row: HTMLElement = getRows()[0]!;

    expect(within(row).queryByTestId("row-actions")).not.toBeInTheDocument();
    expect(rowButtonLabels(row)).toEqual([]);
  });

  it("lets every row pick its own button on a page of mixed invoices", () => {
    renderInvoices([
      makeInvoice({
        invoiceId: "in_open",
        status: InvoiceStatus.Open,
        downloadableLink: FIRST_PDF,
      }),
      makeInvoice({
        invoiceId: "in_paid",
        status: InvoiceStatus.Paid,
        downloadableLink: SECOND_PDF,
      }),
      makeInvoice({ invoiceId: "in_draft", status: InvoiceStatus.Draft }),
      makeInvoice({
        invoiceId: "in_uncollectible",
        status: InvoiceStatus.Uncollectible,
      }),
    ]);

    expect(getRows().map(rowButtonLabels)).toEqual([
      ["Pay Invoice", "More actions"],
      ["Download"],
      [],
      ["Pay Invoice"],
    ]);
  });

  it("opens that row's PDF when Download is picked from its ⋯ menu", () => {
    renderInvoices([
      makeInvoice({
        invoiceId: "in_first",
        status: InvoiceStatus.Open,
        downloadableLink: FIRST_PDF,
      }),
      makeInvoice({
        invoiceId: "in_second",
        status: InvoiceStatus.Open,
        downloadableLink: SECOND_PDF,
      }),
    ]);

    const menu: HTMLElement = openMenuIn(getRows()[1]!);

    fireEvent.click(within(menu).getByRole("menuitem", { name: "Download" }));

    expect(navigatedTo()).toEqual([URL.fromString(SECOND_PDF).toString()]);
    // Downloading is not paying.
    expect(postMock).not.toHaveBeenCalled();
  });

  it("opens that row's PDF when Download is the row's button", () => {
    renderInvoices([
      makeInvoice({
        invoiceId: "in_first",
        status: InvoiceStatus.Paid,
        downloadableLink: FIRST_PDF,
      }),
      makeInvoice({
        invoiceId: "in_second",
        status: InvoiceStatus.Paid,
        downloadableLink: SECOND_PDF,
      }),
    ]);

    fireEvent.click(
      within(getRows()[0]!).getByRole("button", { name: "Download" }),
    );

    expect(navigatedTo()).toEqual([URL.fromString(FIRST_PDF).toString()]);
  });

  it("pays the invoice on the row whose Pay Invoice was pressed", async () => {
    renderInvoices([
      makeInvoice({
        invoiceId: "in_first",
        customerId: "cus_first",
        status: InvoiceStatus.Open,
        downloadableLink: FIRST_PDF,
      }),
      makeInvoice({
        invoiceId: "in_second",
        customerId: "cus_second",
        status: InvoiceStatus.Open,
        downloadableLink: SECOND_PDF,
      }),
    ]);

    fireEvent.click(
      within(getRows()[1]!).getByRole("button", { name: "Pay Invoice" }),
    );

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });
    expect(postMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          data: {
            paymentProviderInvoiceId: "in_second",
            paymentProviderCustomerId: "cus_second",
          },
        },
      }),
    );
    // Paying is not downloading.
    expect(navigate).not.toHaveBeenCalled();
  });

  it("still swaps the table for the page loader while a row's payment is made", async () => {
    let resolvePost: (value: unknown) => void = () => {};
    postMock.mockReturnValue(
      new Promise((resolve: (value: unknown) => void) => {
        resolvePost = resolve;
      }),
    );

    renderInvoices([
      makeInvoice({
        invoiceId: "in_first",
        status: InvoiceStatus.Open,
        downloadableLink: FIRST_PDF,
      }),
    ]);

    fireEvent.click(
      within(getRows()[0]!).getByRole("button", { name: "Pay Invoice" }),
    );

    expect(await screen.findByTestId("invoices-loader")).toBeInTheDocument();
    expect(screen.queryByTestId("invoices-table")).not.toBeInTheDocument();

    resolvePost(apiResponse({ paymentProcessing: true }));

    await screen.findByRole("dialog", { name: "Payment is processing" });
    await expectTableBack();
    expect(rowButtonLabels(getRows()[0]!)).toEqual([
      "Pay Invoice",
      "More actions",
    ]);
  });
});
