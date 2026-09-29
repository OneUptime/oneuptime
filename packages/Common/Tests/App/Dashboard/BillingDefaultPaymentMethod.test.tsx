import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import Billing from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/Billing";
import ProjectUtil from "../../../UI/Utils/Project";
import Navigation from "../../../UI/Utils/Navigation";
import SubscriptionPlan from "../../../Types/Billing/SubscriptionPlan";
import BillingPaymentMethod from "../../../Models/DatabaseModels/BillingPaymentMethod";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../Types/JSON";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * Production incident: autopay kept charging an old India-issued card
 * (pm_replaced_card) that declined, after the customer had added a working card
 * (pm_new_default_card). The dashboard had no way to see or choose the card autopay
 * uses, and adding a card never made it the default. These tests cover the
 * billing page's side of the fix: the Default pill, "Set as Default", and a
 * newly added card - inline or after a redirect - becoming the default.
 */

const OLD_CARD_ID: string = "pm_replaced_card";
const NEW_CARD_ID: string = "pm_new_default_card";
const THIRD_CARD_ID: string = "pm_third";
const SET_DEFAULT_PATH: string = "/billing-payment-methods/set-default";
const TENANT_HEADERS: JSONObject = { tenantid: "tenant-under-test" };

const getListMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const setupPostMock: MockFunction = getJestMockFunction();
const setDefaultPostMock: MockFunction = getJestMockFunction();
const confirmSetupMock: MockFunction = getJestMockFunction();
const retrieveSetupIntentMock: MockFunction = getJestMockFunction();
const completeActionMock: MockFunction = getJestMockFunction();
const tableErrorMock: MockFunction = getJestMockFunction();
let billingEnabled: boolean = true;
let stripeAvailable: boolean = true;
let tableRows: Array<BillingPaymentMethod> = [];
let lastTableProps: Record<string, unknown> | null = null;
const projectId: ObjectID = ObjectID.generate();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      count: (...args: Array<unknown>) => {
        return countMock(...args);
      },
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getCommonHeaders: () => {
        return TENANT_HEADERS;
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: async () => {
        return { data: { balance: 0 } };
      },
      post: (options: { url: URL }) => {
        if (options.url.toString().endsWith(SET_DEFAULT_PATH)) {
          return setDefaultPostMock(options);
        }
        return setupPostMock(options);
      },
      getFriendlyMessage: (error: unknown) => {
        const message: string | undefined = (error as { message?: string })
          ?.message;
        return message || "Server Error. Please try again";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return {
    __esModule: true,
    default: { capture: () => {}, captureRevenueEvent: () => {} },
  };
});

jest.mock("../../../UI/Config", () => {
  const config: Record<string, unknown> = {
    ...jest.requireActual("../../../UI/Config"),
  };
  Object.defineProperty(config, "BILLING_ENABLED", {
    get: () => {
      return billingEnabled;
    },
  });
  return config;
});

jest.mock(
  "@stripe/stripe-js/pure",
  () => {
    return {
      loadStripe: async () => {
        return stripeAvailable
          ? { retrieveSetupIntent: retrieveSetupIntentMock }
          : null;
      },
    };
  },
  { virtual: true },
);

jest.mock(
  "@stripe/react-stripe-js",
  () => {
    return {
      Elements: (props: { children: ReactNode }) => {
        return <>{props.children}</>;
      },
      PaymentElement: () => {
        return <div>Payment details</div>;
      },
      useStripe: () => {
        return { confirmSetup: confirmSetupMock };
      },
      useElements: () => {
        return {};
      },
    };
  },
  { virtual: true },
);

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <></>;
    },
  };
});

interface MockColumn {
  getElement?: (item: BillingPaymentMethod) => ReactElement;
}

interface MockActionButton {
  title: string;
  isVisible?: (item: BillingPaymentMethod) => boolean | undefined;
  onClick: (
    item: BillingPaymentMethod,
    onCompleteAction: () => void,
    onError: (error: Error) => void,
  ) => void;
}

/*
 * The table renders the rows it is given with the page's real column
 * renderers and action buttons, so what is asserted is exactly what the page
 * hands the real ModelTable.
 */
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: {
      refreshToggle: string;
      columns: Array<MockColumn>;
      actionButtons?: Array<MockActionButton>;
      cardProps: {
        description: string;
        buttons: Array<{ title: string; onClick: () => void }>;
      };
    }) => {
      lastTableProps = props as unknown as Record<string, unknown>;
      return (
        <div
          data-testid="payment-methods-table"
          data-refresh={props.refreshToggle}
        >
          {tableRows.map((row: BillingPaymentMethod) => {
            const rowId: string = row.paymentProviderPaymentMethodId || "no-id";
            return (
              <div key={rowId} data-testid={`payment-method-row-${rowId}`}>
                {props.columns.map((column: MockColumn, index: number) => {
                  return (
                    <div key={index}>
                      {column.getElement ? column.getElement(row) : null}
                    </div>
                  );
                })}
                {(props.actionButtons || [])
                  .filter((button: MockActionButton) => {
                    return !button.isVisible || button.isVisible(row);
                  })
                  .map((button: MockActionButton) => {
                    return (
                      <button
                        key={button.title}
                        onClick={() => {
                          button.onClick(
                            row,
                            completeActionMock,
                            tableErrorMock,
                          );
                        }}
                      >
                        {button.title}
                      </button>
                    );
                  })}
              </div>
            );
          })}
          {props.cardProps.buttons.map(
            (button: { title: string; onClick: () => void }) => {
              return (
                <button key={button.title} onClick={button.onClick}>
                  {button.title}
                </button>
              );
            },
          )}
        </div>
      );
    },
  };
});

jest.mock("../../../UI/Components/Modal/Modal", () => {
  return {
    __esModule: true,
    default: (props: {
      title: string;
      children: ReactNode;
      error: string;
      submitButtonText: string;
      onSubmit: () => void;
      onClose?: () => void;
      disableSubmitButton: boolean;
      isLoading: boolean;
    }): ReactElement => {
      return (
        <section role="dialog" aria-label={props.title}>
          {props.error ? <p role="alert">{props.error}</p> : <></>}
          {props.children}
          <button
            onClick={props.onSubmit}
            disabled={props.disableSubmitButton || props.isLoading}
          >
            {props.submitButtonText}
          </button>
          {props.onClose ? (
            <button onClick={props.onClose}>Close {props.title}</button>
          ) : (
            <></>
          )}
        </section>
      );
    },
  };
});

type MakeCardFunction = (data: {
  id?: string | undefined;
  last4: string;
  isDefault?: boolean | undefined;
}) => BillingPaymentMethod;

const makeCard: MakeCardFunction = (data: {
  id?: string | undefined;
  last4: string;
  isDefault?: boolean | undefined;
}): BillingPaymentMethod => {
  const card: BillingPaymentMethod = new BillingPaymentMethod();
  card.paymentMethodType = "visa";
  card.last4Digits = data.last4;
  if (data.id !== undefined) {
    card.paymentProviderPaymentMethodId = data.id;
  }
  if (data.isDefault !== undefined) {
    card.isDefault = data.isDefault;
  }
  return card;
};

function okResponse(): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, {}, {});
}

function errorResponse(message: string): HTTPErrorResponse {
  return new HTTPErrorResponse(400, { error: message }, {});
}

function renderBilling(): { unmount: () => void } {
  return render(
    <Billing
      pageRoute={new Route("/settings/billing")}
      currentProject={null}
      hasPaymentMethod={true}
    />,
  );
}

function row(id: string): HTMLElement {
  return screen.getByTestId(`payment-method-row-${id}`);
}

function setDefaultBodies(): Array<unknown> {
  return setDefaultPostMock.mock.calls.map((call: Array<unknown>) => {
    return (call[0] as { data: unknown }).data;
  });
}

function expectSetDefaultRequest(paymentMethodId: string): void {
  expect(setDefaultPostMock).toHaveBeenCalledWith({
    url: expect.anything(),
    data: { data: { paymentProviderPaymentMethodId: paymentMethodId } },
    headers: TENANT_HEADERS,
  });
  const url: URL = (setDefaultPostMock.mock.calls[0]![0] as { url: URL }).url;
  expect(url.toString()).toMatch(/\/billing-payment-methods\/set-default$/);
}

function refreshToggle(): string | null {
  return screen
    .getByTestId("payment-methods-table")
    .getAttribute("data-refresh");
}

function setBrowserLocation(pathAndQuery: string): void {
  window.history.replaceState({}, "", pathAndQuery);
}

async function openAddPaymentMethodAndSave(): Promise<void> {
  await userEvent.click(
    await screen.findByRole("button", { name: "Add Payment Method" }),
  );
  const save: HTMLElement = await screen.findByRole("button", {
    name: "Save payment method",
  });
  await waitFor(() => {
    expect(save).not.toBeDisabled();
  });
  await userEvent.click(save);
}

describe("Billing page: choosing the payment method autopay charges", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    billingEnabled = true;
    stripeAvailable = true;
    lastTableProps = null;
    // The production state: the new card is the customer default.
    tableRows = [
      makeCard({ id: NEW_CARD_ID, last4: "4242", isDefault: true }),
      makeCard({ id: OLD_CARD_ID, last4: "1111", isDefault: false }),
    ];
    setBrowserLocation("/dashboard/project/settings/billing");
    getListMock.mockReset().mockResolvedValue({ data: [], count: 2 });
    countMock.mockReset().mockResolvedValue(2);
    getItemMock
      .mockReset()
      .mockResolvedValue({ paymentProviderPlanId: "free-plan" });
    setupPostMock
      .mockReset()
      .mockResolvedValue({ data: { setupIntent: "test-secret" } });
    setDefaultPostMock.mockReset().mockResolvedValue(okResponse());
    confirmSetupMock.mockReset().mockResolvedValue({
      setupIntent: { status: "succeeded", payment_method: NEW_CARD_ID },
    });
    retrieveSetupIntentMock.mockReset();
    completeActionMock.mockReset();
    tableErrorMock.mockReset();
    getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(projectId);
    getJestSpyOn(SubscriptionPlan, "isFreePlan").mockReturnValue(true);
    getJestSpyOn(SubscriptionPlan, "getSubscriptionPlans").mockReturnValue([]);
    getJestSpyOn(Navigation, "getCurrentURL").mockReturnValue(
      URL.fromString("https://example.com/dashboard/project/settings/billing"),
    );
  });

  afterEach(() => {
    setBrowserLocation("/");
  });

  describe("showing which card is the default", () => {
    it("asks the table for the default flag and the provider id of every row", async () => {
      renderBilling();
      await screen.findByTestId("payment-methods-table");
      expect(lastTableProps?.["selectMoreFields"]).toEqual({
        isDefault: true,
        paymentProviderPaymentMethodId: true,
      });
    });

    it("marks only the default card with a Default pill", async () => {
      renderBilling();
      await screen.findByTestId("payment-methods-table");

      const defaultPill: HTMLElement = within(row(NEW_CARD_ID)).getByTestId(
        "pill",
      );
      expect(defaultPill).toHaveTextContent("Default");
      expect(within(row(NEW_CARD_ID)).getByText("*****4242")).toBeVisible();

      expect(within(row(OLD_CARD_ID)).getByText("*****1111")).toBeVisible();
      expect(
        within(row(OLD_CARD_ID)).queryByTestId("pill"),
      ).not.toBeInTheDocument();
    });

    it("shows no Default pill when no row is flagged default", async () => {
      tableRows = [
        makeCard({ id: NEW_CARD_ID, last4: "4242" }),
        makeCard({ id: OLD_CARD_ID, last4: "1111", isDefault: false }),
      ];
      renderBilling();
      await screen.findByTestId("payment-methods-table");
      expect(screen.queryByTestId("pill")).not.toBeInTheDocument();
      expect(
        within(row(NEW_CARD_ID)).getByRole("button", {
          name: "Set as Default",
        }),
      ).toBeInTheDocument();
    });

    it("tells the customer that the default card is the one charged automatically", async () => {
      renderBilling();
      await screen.findByTestId("payment-methods-table");
      const description: string = (
        lastTableProps?.["cardProps"] as { description: string }
      ).description;
      expect(description).toContain(
        "Invoices are charged automatically to the default payment method.",
      );
      expect(description).toContain(
        "A payment method you add becomes the default.",
      );
      // The existing paid-usage wording is kept.
      expect(description).toContain(
        "It does not upgrade your subscription plan.",
      );
    });
  });

  describe("Set as Default", () => {
    it("is offered on every non-default card, and the default one offers the re-sync instead", async () => {
      tableRows = [
        makeCard({ id: NEW_CARD_ID, last4: "4242", isDefault: true }),
        makeCard({ id: OLD_CARD_ID, last4: "1111", isDefault: false }),
        makeCard({ id: THIRD_CARD_ID, last4: "5555", isDefault: false }),
      ];
      renderBilling();
      await screen.findByTestId("payment-methods-table");

      expect(
        within(row(NEW_CARD_ID)).queryByRole("button", {
          name: "Set as Default",
        }),
      ).not.toBeInTheDocument();
      expect(
        within(row(NEW_CARD_ID)).getByRole("button", {
          name: "Re-sync Autopay",
        }),
      ).toBeInTheDocument();
      expect(
        within(row(OLD_CARD_ID)).getByRole("button", {
          name: "Set as Default",
        }),
      ).toBeInTheDocument();
      expect(
        within(row(OLD_CARD_ID)).queryByRole("button", {
          name: "Re-sync Autopay",
        }),
      ).not.toBeInTheDocument();
      expect(
        within(row(THIRD_CARD_ID)).getByRole("button", {
          name: "Set as Default",
        }),
      ).toBeInTheDocument();
    });

    it("is not offered for a row without a provider payment method id", async () => {
      tableRows = [makeCard({ last4: "9999", isDefault: false })];
      renderBilling();
      await screen.findByTestId("payment-methods-table");
      expect(
        within(row("no-id")).queryByRole("button", { name: "Set as Default" }),
      ).not.toBeInTheDocument();
    });

    it("posts the chosen card to set-default and lets the table re-list itself", async () => {
      renderBilling();
      await screen.findByTestId("payment-methods-table");
      expect(refreshToggle()).toBe("0");

      await userEvent.click(
        within(row(OLD_CARD_ID)).getByRole("button", {
          name: "Set as Default",
        }),
      );

      await waitFor(() => {
        expect(refreshToggle()).toBe("1");
      });
      expect(setDefaultPostMock).toHaveBeenCalledTimes(1);
      expectSetDefaultRequest(OLD_CARD_ID);
      expect(completeActionMock).toHaveBeenCalledTimes(1);
      expect(tableErrorMock).not.toHaveBeenCalled();
      expect(setupPostMock).not.toHaveBeenCalled();
      /*
       * Listing from the page would replace the row IDs the table holds; only
       * the initial eligibility list may have run.
       */
      expect(getListMock).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByTestId("confirm-modal-description"),
      ).not.toBeInTheDocument();
    });

    it("sends the card of the row that was clicked when several are available", async () => {
      tableRows = [
        makeCard({ id: NEW_CARD_ID, last4: "4242", isDefault: true }),
        makeCard({ id: OLD_CARD_ID, last4: "1111", isDefault: false }),
        makeCard({ id: THIRD_CARD_ID, last4: "5555", isDefault: false }),
      ];
      renderBilling();
      await screen.findByTestId("payment-methods-table");

      await userEvent.click(
        within(row(THIRD_CARD_ID)).getByRole("button", {
          name: "Set as Default",
        }),
      );

      await waitFor(() => {
        expect(setDefaultPostMock).toHaveBeenCalledTimes(1);
      });
      expect(setDefaultBodies()).toEqual([
        { data: { paymentProviderPaymentMethodId: THIRD_CARD_ID } },
      ]);
    });

    it("shows the server's reason, keeps the table as is and releases the row button when the change is refused", async () => {
      setDefaultPostMock.mockResolvedValueOnce(
        errorResponse("Payment method does not belong to this project"),
      );
      renderBilling();
      await screen.findByTestId("payment-methods-table");

      await userEvent.click(
        within(row(OLD_CARD_ID)).getByRole("button", {
          name: "Set as Default",
        }),
      );

      expect(
        await screen.findByTestId("confirm-modal-description"),
      ).toHaveTextContent("Payment method does not belong to this project");
      expect(
        screen.getByRole("dialog", { name: "Something is not quite right..." }),
      ).toBeInTheDocument();
      expect(completeActionMock).toHaveBeenCalledTimes(1);
      expect(tableErrorMock).not.toHaveBeenCalled();
      expect(refreshToggle()).toBe("0");

      await userEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(
        screen.queryByTestId("confirm-modal-description"),
      ).not.toBeInTheDocument();
    });

    it("shows a network failure instead of leaving the button loading", async () => {
      setDefaultPostMock.mockRejectedValueOnce(
        new Error(
          "Error connecting to server. Please try again in few minutes.",
        ),
      );
      renderBilling();
      await screen.findByTestId("payment-methods-table");

      await userEvent.click(
        within(row(OLD_CARD_ID)).getByRole("button", {
          name: "Set as Default",
        }),
      );

      expect(
        await screen.findByTestId("confirm-modal-description"),
      ).toHaveTextContent(
        "Error connecting to server. Please try again in few minutes.",
      );
      expect(completeActionMock).toHaveBeenCalledTimes(1);
      expect(refreshToggle()).toBe("0");
    });

    it("can be retried after a failure", async () => {
      setDefaultPostMock
        .mockResolvedValueOnce(errorResponse("Stripe is unavailable"))
        .mockResolvedValueOnce(okResponse());
      renderBilling();
      await screen.findByTestId("payment-methods-table");
      const setDefault: HTMLElement = within(row(OLD_CARD_ID)).getByRole(
        "button",
        { name: "Set as Default" },
      );

      await userEvent.click(setDefault);
      await screen.findByTestId("confirm-modal-description");
      await userEvent.click(screen.getByRole("button", { name: "Close" }));

      await userEvent.click(setDefault);
      await waitFor(() => {
        expect(refreshToggle()).toBe("1");
      });
      expect(setDefaultPostMock).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByTestId("confirm-modal-description"),
      ).not.toBeInTheDocument();
    });
  });

  /*
   * The state the affected project is actually in, once the Sep-12 invoice has gone away:
   * the new card IS the customer default, so nothing on this page looks wrong,
   * while the subscription is still pinned to the old India-issued card and every
   * renewal keeps going to it. isDefault cannot see that pin - it is derived
   * from the customer default alone - so the row that looks correct is exactly
   * the row that needs the repair. Every other trigger (set another card as
   * default, delete a card, add a card) asks the customer to change something
   * they do not want to change.
   */
  describe("Re-sync Autopay, on the card that already is the default", () => {
    it("posts the default card to set-default and lets the table re-list itself", async () => {
      renderBilling();
      await screen.findByTestId("payment-methods-table");
      expect(refreshToggle()).toBe("0");

      await userEvent.click(
        within(row(NEW_CARD_ID)).getByRole("button", {
          name: "Re-sync Autopay",
        }),
      );

      await waitFor(() => {
        expect(refreshToggle()).toBe("1");
      });
      expect(setDefaultPostMock).toHaveBeenCalledTimes(1);
      expectSetDefaultRequest(NEW_CARD_ID);
      expect(completeActionMock).toHaveBeenCalledTimes(1);
      expect(tableErrorMock).not.toHaveBeenCalled();
      expect(
        screen.queryByTestId("confirm-modal-description"),
      ).not.toBeInTheDocument();
    });

    it("shows the server's reason and releases the row button when the re-sync fails", async () => {
      setDefaultPostMock.mockResolvedValueOnce(
        errorResponse(
          "Could not reach the payment provider to update your default payment method. Please try again.",
        ),
      );
      renderBilling();
      await screen.findByTestId("payment-methods-table");

      await userEvent.click(
        within(row(NEW_CARD_ID)).getByRole("button", {
          name: "Re-sync Autopay",
        }),
      );

      expect(
        await screen.findByTestId("confirm-modal-description"),
      ).toHaveTextContent("Could not reach the payment provider");
      expect(completeActionMock).toHaveBeenCalledTimes(1);
      expect(refreshToggle()).toBe("0");
    });

    it("is not offered on a default row that carries no provider payment method id", async () => {
      tableRows = [makeCard({ last4: "9999", isDefault: true })];
      renderBilling();
      await screen.findByTestId("payment-methods-table");

      expect(
        within(row("no-id")).queryByRole("button", {
          name: "Re-sync Autopay",
        }),
      ).not.toBeInTheDocument();
    });

    it("offers the repair on the default row even when it is the only card", async () => {
      /*
       * Deleting or adding a card is the only other trigger, and the only
       * card a customer has cannot be deleted at all.
       */
      tableRows = [
        makeCard({ id: NEW_CARD_ID, last4: "4242", isDefault: true }),
      ];
      renderBilling();
      await screen.findByTestId("payment-methods-table");

      await userEvent.click(
        within(row(NEW_CARD_ID)).getByRole("button", {
          name: "Re-sync Autopay",
        }),
      );

      await waitFor(() => {
        expect(setDefaultPostMock).toHaveBeenCalledTimes(1);
      });
      expectSetDefaultRequest(NEW_CARD_ID);
    });
  });

  describe("a newly added card becomes the default", () => {
    it("makes the card the customer just added the default before re-listing", async () => {
      renderBilling();
      await openAddPaymentMethodAndSave();

      await waitFor(() => {
        expect(
          screen.queryByRole("dialog", { name: "Add Payment Method" }),
        ).not.toBeInTheDocument();
      });
      expect(setDefaultPostMock).toHaveBeenCalledTimes(1);
      expectSetDefaultRequest(NEW_CARD_ID);
      expect(refreshToggle()).toBe("1");
      expect(getListMock).toHaveBeenCalledTimes(2);
      // Set-default is done before the page re-reads the saved cards.
      expect(setDefaultPostMock.mock.invocationCallOrder[0]!).toBeLessThan(
        getListMock.mock.invocationCallOrder[1]!,
      );
      expect(
        screen.queryByTestId("confirm-modal-description"),
      ).not.toBeInTheDocument();
    });

    it("keeps the save button loading until the card is the default", async () => {
      let resolveSetDefault: ((value: unknown) => void) | undefined;
      setDefaultPostMock.mockImplementationOnce(() => {
        return new Promise((resolve: (value: unknown) => void) => {
          resolveSetDefault = resolve;
        });
      });
      renderBilling();
      await openAddPaymentMethodAndSave();

      await waitFor(() => {
        expect(setDefaultPostMock).toHaveBeenCalledTimes(1);
      });
      expect(
        screen.getByRole("button", { name: "Save payment method" }),
      ).toBeDisabled();
      expect(refreshToggle()).toBe("0");

      resolveSetDefault!(okResponse());
      await waitFor(() => {
        expect(
          screen.queryByRole("dialog", { name: "Add Payment Method" }),
        ).not.toBeInTheDocument();
      });
      expect(refreshToggle()).toBe("1");
    });

    it("uses the id of an expanded payment method", async () => {
      confirmSetupMock.mockResolvedValueOnce({
        setupIntent: {
          status: "succeeded",
          payment_method: { id: "pm_expanded", object: "payment_method" },
        },
      });
      renderBilling();
      await openAddPaymentMethodAndSave();
      await waitFor(() => {
        expect(setDefaultPostMock).toHaveBeenCalledTimes(1);
      });
      expect(setDefaultBodies()).toEqual([
        { data: { paymentProviderPaymentMethodId: "pm_expanded" } },
      ]);
    });

    it("still closes the form and refreshes when the card is saved but cannot be made default, and says so", async () => {
      setDefaultPostMock.mockResolvedValueOnce(
        errorResponse("Payment method does not belong to this project"),
      );
      renderBilling();
      await openAddPaymentMethodAndSave();

      const description: HTMLElement = await screen.findByTestId(
        "confirm-modal-description",
      );
      expect(description).toHaveTextContent(
        "Your payment method was saved, but automatic payments could not be switched to it.",
      );
      expect(description).toHaveTextContent('"Set as Default"');
      expect(description).toHaveTextContent(
        "Reason: Payment method does not belong to this project",
      );
      await waitFor(() => {
        expect(
          screen.queryByRole("dialog", { name: "Add Payment Method" }),
        ).not.toBeInTheDocument();
      });
      expect(refreshToggle()).toBe("1");
      expect(getListMock).toHaveBeenCalledTimes(2);
    });

    it("does not try to make a still-processing payment method the default", async () => {
      confirmSetupMock.mockResolvedValueOnce({
        setupIntent: { status: "processing", payment_method: "pm_sepa" },
      });
      renderBilling();
      await openAddPaymentMethodAndSave();
      await waitFor(() => {
        expect(
          screen.queryByRole("dialog", { name: "Add Payment Method" }),
        ).not.toBeInTheDocument();
      });
      expect(setDefaultPostMock).not.toHaveBeenCalled();
      expect(refreshToggle()).toBe("1");
    });

    it("keeps the form open and changes nothing when the card needs more authentication", async () => {
      confirmSetupMock.mockResolvedValueOnce({
        setupIntent: { status: "requires_action", payment_method: NEW_CARD_ID },
      });
      renderBilling();
      await openAddPaymentMethodAndSave();

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Your payment method could not be verified.",
      );
      expect(
        screen.getByRole("dialog", { name: "Add Payment Method" }),
      ).toBeInTheDocument();
      expect(setDefaultPostMock).not.toHaveBeenCalled();
      expect(refreshToggle()).toBe("0");
    });

    it("changes nothing when the provider declines the card", async () => {
      confirmSetupMock.mockResolvedValueOnce({
        error: { message: "Your card was declined." },
      });
      renderBilling();
      await openAddPaymentMethodAndSave();
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Your card was declined.",
      );
      expect(setDefaultPostMock).not.toHaveBeenCalled();
      expect(refreshToggle()).toBe("0");
    });
  });

  describe("returning from a redirect-based setup", () => {
    const REDIRECT_SECRET: string = "seti_123_secret_abc";

    type RedirectQueryFunction = (status: string) => string;

    const redirectQuery: RedirectQueryFunction = (status: string): string => {
      return `setup_intent=seti_123&setup_intent_client_secret=${REDIRECT_SECRET}&redirect_status=${status}`;
    };

    beforeEach(() => {
      retrieveSetupIntentMock.mockResolvedValue({
        setupIntent: { status: "succeeded", payment_method: NEW_CARD_ID },
      });
    });

    it("does nothing on a normal page load", async () => {
      renderBilling();
      await screen.findByTestId("payment-methods-table");
      expect(retrieveSetupIntentMock).not.toHaveBeenCalled();
      expect(setDefaultPostMock).not.toHaveBeenCalled();
    });

    it("makes the returned payment method the default before the table lists, then strips the Stripe parameters", async () => {
      setBrowserLocation(
        `/dashboard/project/settings/billing?${redirectQuery("succeeded")}`,
      );
      renderBilling();
      await screen.findByTestId("payment-methods-table");

      expect(retrieveSetupIntentMock).toHaveBeenCalledWith(REDIRECT_SECRET);
      expect(setDefaultPostMock).toHaveBeenCalledTimes(1);
      expectSetDefaultRequest(NEW_CARD_ID);
      expect(setDefaultPostMock.mock.invocationCallOrder[0]!).toBeLessThan(
        getListMock.mock.invocationCallOrder[0]!,
      );
      expect(window.location.search).toBe("");
      expect(window.location.pathname).toBe(
        "/dashboard/project/settings/billing",
      );
      expect(
        screen.queryByTestId("confirm-modal-description"),
      ).not.toBeInTheDocument();
    });

    it("does it only once: a reload after the parameters are stripped does not change the default again", async () => {
      setBrowserLocation(
        `/dashboard/project/settings/billing?${redirectQuery("succeeded")}`,
      );
      const first: { unmount: () => void } = renderBilling();
      await screen.findByTestId("payment-methods-table");
      first.unmount();

      renderBilling();
      await screen.findByTestId("payment-methods-table");
      expect(retrieveSetupIntentMock).toHaveBeenCalledTimes(1);
      expect(setDefaultPostMock).toHaveBeenCalledTimes(1);
    });

    it("keeps unrelated query parameters", async () => {
      setBrowserLocation(
        `/dashboard/project/settings/billing?tab=cards&${redirectQuery("succeeded")}`,
      );
      renderBilling();
      await screen.findByTestId("payment-methods-table");
      expect(window.location.search).toBe("?tab=cards");
    });

    it("reports a failed redirect without contacting the server", async () => {
      setBrowserLocation(
        `/dashboard/project/settings/billing?${redirectQuery("failed")}`,
      );
      renderBilling();

      expect(
        await screen.findByTestId("confirm-modal-description"),
      ).toHaveTextContent("Your payment method could not be verified.");
      expect(retrieveSetupIntentMock).not.toHaveBeenCalled();
      expect(setDefaultPostMock).not.toHaveBeenCalled();
      expect(window.location.search).toBe("");
    });

    it("does not make a still-processing payment method the default", async () => {
      retrieveSetupIntentMock.mockResolvedValueOnce({
        setupIntent: { status: "processing", payment_method: "pm_bank" },
      });
      setBrowserLocation(
        `/dashboard/project/settings/billing?${redirectQuery("succeeded")}`,
      );
      renderBilling();
      await screen.findByTestId("payment-methods-table");
      expect(retrieveSetupIntentMock).toHaveBeenCalledTimes(1);
      expect(setDefaultPostMock).not.toHaveBeenCalled();
      expect(window.location.search).toBe("");
    });

    it("ignores a SetupIntent that carries no payment method", async () => {
      retrieveSetupIntentMock.mockResolvedValueOnce({
        setupIntent: { status: "succeeded", payment_method: null },
      });
      setBrowserLocation(
        `/dashboard/project/settings/billing?${redirectQuery("succeeded")}`,
      );
      renderBilling();
      await screen.findByTestId("payment-methods-table");
      expect(setDefaultPostMock).not.toHaveBeenCalled();
      expect(
        screen.queryByTestId("confirm-modal-description"),
      ).not.toBeInTheDocument();
    });

    it("explains when the SetupIntent cannot be read back, and still loads the page", async () => {
      retrieveSetupIntentMock.mockResolvedValueOnce({
        error: { message: "No such setupintent: 'seti_123'" },
      });
      setBrowserLocation(
        `/dashboard/project/settings/billing?${redirectQuery("succeeded")}`,
      );
      renderBilling();

      expect(
        await screen.findByTestId("confirm-modal-description"),
      ).toHaveTextContent("Reason: No such setupintent: 'seti_123'");
      expect(screen.getByTestId("payment-methods-table")).toBeInTheDocument();
      expect(setDefaultPostMock).not.toHaveBeenCalled();
      expect(window.location.search).toBe("");
    });

    it("explains when the returned card cannot be made the default, and still loads the page", async () => {
      setDefaultPostMock.mockResolvedValueOnce(
        errorResponse("Payment method does not belong to this project"),
      );
      setBrowserLocation(
        `/dashboard/project/settings/billing?${redirectQuery("succeeded")}`,
      );
      renderBilling();

      expect(
        await screen.findByTestId("confirm-modal-description"),
      ).toHaveTextContent(
        "Your payment method was saved, but automatic payments could not be switched to it.",
      );
      expect(screen.getByTestId("payment-methods-table")).toBeInTheDocument();
      expect(window.location.search).toBe("");
    });

    it("survives a thrown provider error while reading the SetupIntent", async () => {
      retrieveSetupIntentMock.mockRejectedValueOnce(new Error("Network error"));
      setBrowserLocation(
        `/dashboard/project/settings/billing?${redirectQuery("succeeded")}`,
      );
      renderBilling();
      expect(
        await screen.findByTestId("confirm-modal-description"),
      ).toHaveTextContent("Reason: Network error");
      expect(screen.getByTestId("payment-methods-table")).toBeInTheDocument();
    });

    it("strips the parameters without changing anything when Stripe could not be loaded", async () => {
      stripeAvailable = false;
      setBrowserLocation(
        `/dashboard/project/settings/billing?${redirectQuery("succeeded")}`,
      );
      renderBilling();
      await screen.findByTestId("payment-methods-table");
      expect(retrieveSetupIntentMock).not.toHaveBeenCalled();
      expect(setDefaultPostMock).not.toHaveBeenCalled();
      expect(window.location.search).toBe("");
    });

    it("never reaches for Stripe on an installation with billing disabled", async () => {
      billingEnabled = false;
      setBrowserLocation(
        `/dashboard/project/settings/billing?${redirectQuery("succeeded")}`,
      );
      renderBilling();
      await screen.findByTestId("payment-methods-table");
      expect(retrieveSetupIntentMock).not.toHaveBeenCalled();
      expect(setDefaultPostMock).not.toHaveBeenCalled();
    });
  });
});
